import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Engine } from '../../../apps/service/engine.ts';
import { standingInvestigationId, parseGapId, loadCaseFacts, defaultInvestigationSettings } from '../investigation/index.ts';
import type { Principal, QuestionRecord } from '../contracts/index.ts';

/**
 * B1: orphan pieces seek their partner. Synthetic threads only (TRN-061/062): a fix posted with no symptom, and a problem
 * on the same asset reported later in another channel ("again", so it is its own episode).
 */
const FIX_061 = { channel: 'field-log', messages: [{ seq: 1, time: '2026-11-07T08:05:00+02:00', author: 'Veikko Field', text: 'Bounced the port on TRN-061.' }] };
const PROBLEM_061 = { channel: 'noc-alarms', messages: [{ seq: 1, time: '2026-11-07T09:40:00+02:00', author: 'Outi Heino', text: 'No traffic on TRN-061 again this morning. Link is up but the counters are zero.' }] };
const FIX_062 = { channel: 'field-log-2', messages: [{ seq: 1, time: '2026-11-07T08:30:00+02:00', author: 'Veikko Field', text: 'Bounced the port on TRN-062.' }] };

function setup(start = '2026-11-07T10:00:00.000Z') {
  const time = { iso: start };
  const e = new Engine({ dbPath: ':memory:', clock: () => new Date(time.iso), standingGaps: { ask: true } });
  return { e, time };
}
const person = (e: Engine, name: string): Principal => {
  const d = e.directory().find((x) => x.name === name)!;
  return { id: d.personEntityId, displayName: d.name, groups: d.groups, type: 'human' };
};
const caseOf = (e: Engine, asset: string, withAction: boolean) => e.store.list('case').find((c) => c.title.startsWith(asset) && (c.attemptIds.length > 0) === withAction)!;
const standingQs = (e: Engine): QuestionRecord[] => e.store.list('question').filter((q) => q.candidate.origin === 'standing');
const flush = () => new Promise((r) => setImmediate(r));

test('pairing: an orphan fix and an open problem on one asset -> a yes/no question to the performer; Yes links them with the answer as evidence', async () => {
  const { e } = setup();
  e.importData({ format: 'teams-json', payload: FIX_061 });
  e.importData({ format: 'teams-json', payload: PROBLEM_061 });
  await flush();
  const fix = caseOf(e, 'TRN-061', true);
  const problem = caseOf(e, 'TRN-061', false);
  assert.notEqual(fix.id, problem.id, 'two separate cases (no link was made by itself)');
  const st = e.store.get('investigation', standingInvestigationId(fix.id))!;
  assert.equal(st.origin, 'standing');
  assert.deepEqual(st.gaps.map((g) => parseGapId(g.id)?.kind).sort(), ['missing-symptom', 'pairing']);
  assert.ok(st.routes.some((r) => r.version === 'standing-gaps@1'));

  const [q] = standingQs(e);
  assert.ok(q, 'the pairing question was asked');
  assert.equal(q.candidate.text, 'Was the port bounce on TRN-061 for the no traffic problem reported this morning?');
  assert.equal(q.status, 'delivered');
  assert.equal(q.personEntityId, person(e, 'Veikko Field').id);
  assert.equal(e.store.list('pattern').length, 0, 'nothing is linked without an answer');

  const r = await e.answer(q.id, { principal: person(e, 'Veikko Field'), value: 'yes' });
  assert.match(r.receipt.detail, /now linked/);
  const [pattern] = e.store.list('pattern');
  assert.equal(pattern?.status, 'confirmed');
  assert.deepEqual(pattern?.caseIds, [fix.id, problem.id].sort());
  assert.equal(pattern?.evidence?.[0]?.evidenceId, r.answer.evidenceId);
  assert.equal(pattern?.createdBy.version, 'standing-gaps@1');
  const after = e.store.get('investigation', st.id)!;
  assert.ok(after.gaps.every((g) => g.status === 'resolved'), 'a confirmed pairing also settles the missing symptom');
});

test('a declined pairing stays unlinked and is never proposed again, also after a re-import and a later pass', async () => {
  const { e, time } = setup();
  e.importData({ format: 'teams-json', payload: FIX_061 });
  e.importData({ format: 'teams-json', payload: PROBLEM_061 });
  await flush();
  const [q] = standingQs(e);
  assert.ok(q && /^Was the port bounce/.test(q.candidate.text));
  await e.answer(q.id, { principal: person(e, 'Veikko Field'), value: 'no' });
  const [pattern] = e.store.list('pattern');
  assert.equal(pattern?.status, 'rejected');
  e.importData({ format: 'teams-json', payload: FIX_061 });
  e.importData({ format: 'teams-json', payload: PROBLEM_061 });
  time.iso = '2026-11-07T11:00:00.000Z';
  await e.upkeep();
  const st = e.store.get('investigation', standingInvestigationId(caseOf(e, 'TRN-061', true).id))!;
  assert.equal(st.gaps.filter((g) => parseGapId(g.id)?.kind === 'pairing' && g.status === 'open').length, 0);
  assert.equal(standingQs(e).filter((x) => x.candidate.dedupKey.startsWith('pairing:')).length, 1, 'the declined pair was asked once only');
  assert.ok(!e.store.list('pattern').some((p) => p.status === 'confirmed'));
});

test('missing symptom: a fix with no symptom and no partner -> a free-text question in the Later pile; the words become evidence on the case', async () => {
  const { e } = setup();
  e.importData({ format: 'teams-json', payload: FIX_062 });
  await flush();
  const [q] = standingQs(e);
  assert.ok(q);
  assert.equal(q.candidate.answerType, 'free-text');
  assert.equal(q.status, 'deferred', 'Later pile only: never an interruption');
  assert.equal(q.deliveredAt, undefined);
  assert.equal(q.candidate.text, 'You bounced the port on TRN-062 this morning. What was the problem: what did you see before that?');
  const later = e.questions({ personEntityId: q.personEntityId });
  assert.ok(later.some((v) => v.questionId === q.id && v.deferred && v.answerType === 'free-text'));

  // A bare Yes/No (no words) is refused and leaves the question where it was (Later), so the gap is not used up.
  await assert.rejects(e.answer(q.id, { principal: person(e, 'Veikko Field'), value: 'yes' }), /own words/);
  await assert.rejects(e.answer(q.id, { principal: person(e, 'Veikko Field'), value: 'no', text: '  ' }), /own words/);
  assert.equal(e.store.get('question', q.id)!.status, 'deferred');
  const r = await e.answer(q.id, { principal: person(e, 'Veikko Field'), value: 'yes', text: 'Alarm said no traffic, link was up' });
  assert.equal(r.receipt.title, 'Recorded: your description');
  const c = caseOf(e, 'TRN-062', true);
  const ev = e.store.get('evidence', r.answer.evidenceId)!;
  assert.ok(c.evidenceIds.includes(ev.id), 'stored as attributed evidence on the case');
  assert.match(ev.text, /Alarm said no traffic, link was up/);
  assert.equal(ev.author.displayName, 'Veikko Field');
  const obs = e.store.list('observation').find((o) => o.caseId === c.id && o.condition.key === 'case.symptom');
  assert.equal(obs?.condition.value, 'Alarm said no traffic, link was up');
  // Undo withdraws it again.
  await e.undo(q.id, { principal: person(e, 'Veikko Field') });
  assert.ok(!caseOf(e, 'TRN-062', true).evidenceIds.includes(ev.id));
  assert.equal(e.store.get('investigation', standingInvestigationId(c.id))!.gaps.find((g) => parseGapId(g.id)?.kind === 'missing-symptom')?.status, 'open');
});

test('outcome after 24 h: a fix with no outcome becomes a yes/no question to the performer a day later; the answer is an outcome on the case', async () => {
  const { e, time } = setup();
  e.importData({ format: 'teams-json', payload: FIX_062 });
  await flush();
  const c = caseOf(e, 'TRN-062', true);
  const st0 = e.store.get('investigation', standingInvestigationId(c.id))!;
  assert.ok(!st0.gaps.some((g) => parseGapId(g.id)?.kind === 'outcome'), 'not before 24 hours');
  time.iso = '2026-11-08T07:00:00.000Z'; // 25 hours after the 06:30Z fix
  const asked = await e.upkeep();
  const q = asked.find((x) => parseGapId(x.candidate.gapId)?.kind === 'outcome');
  assert.ok(q, 'the outcome gap is raised and asked');
  assert.equal(q.status, 'delivered');
  assert.equal(q.candidate.answerType, 'yes-no-unknown');
  assert.match(q.candidate.text, /^Did .* right after the port bounce on TRN-062\?$/);
  assert.equal(q.personEntityId, person(e, 'Veikko Field').id);
  await e.answer(q.id, { principal: person(e, 'Veikko Field'), value: 'yes' });
  const facts = loadCaseFacts(e.store, c.id, undefined, defaultInvestigationSettings());
  assert.ok(facts.primaryOutcomes.some((o) => o.result === 'recovered' && o.id.startsWith('overlay:')), 'every investigation citing the case sees the reported outcome');
});

test('an investigation question outranks a standing one for the same person; standing waits until the person is free', async () => {
  const { e, time } = setup();
  e.importData({ format: 'teams-json', payload: FIX_061 });
  e.importData({ format: 'teams-json', payload: PROBLEM_061 });
  await flush();
  const veikko = person(e, 'Veikko Field');
  const [pairing] = standingQs(e);
  assert.equal(pairing?.status, 'delivered');

  // Veikko already has an open standing question; the investigation still reaches him.
  const inv = await e.investigate({ text: 'No traffic on TRN-061, link up, counters zero. Bounce the port like before?', principal: person(e, 'Outi Heino') });
  const iq = e.store.list('question').find((q) => q.candidate.investigationId === inv.investigationId);
  assert.ok(iq, 'the investigation asked');
  assert.equal(iq.personEntityId, veikko.id);
  assert.equal(iq.status, 'delivered');

  // While the investigation question is open, no further standing question goes to him (not even to Later).
  await e.answer(pairing!.id, { principal: veikko, value: 'no' });
  assert.equal(standingQs(e).filter((q) => q.id !== pairing!.id).length, 0);
  await e.answer(iq.id, { principal: veikko, value: 'yes' });
  assert.equal(standingQs(e).filter((q) => q.id !== pairing!.id).length, 0, 'cooldown after the investigation question');
  time.iso = '2026-11-07T10:31:00.000Z';
  const asked = await e.upkeep();
  assert.equal(asked.length, 1);
  assert.equal(parseGapId(asked[0]!.candidate.gapId)?.kind, 'missing-symptom');
  assert.equal(asked[0]!.status, 'deferred');
});

test('without standingGaps.ask the gaps are recorded but nobody is asked (the library default)', async () => {
  const e = new Engine({ dbPath: ':memory:', clock: () => new Date('2026-11-07T10:00:00.000Z') });
  e.importData({ format: 'teams-json', payload: FIX_062 });
  await flush();
  assert.ok(e.store.list('investigation').some((s) => s.origin === 'standing'));
  assert.equal(e.store.list('question').length, 0);
});

test('outcome after 24 h on an undated message counts from capture time (ingestedAt), never from an invented message time', async () => {
  const { e, time } = setup('2026-11-07T10:00:00.000Z');
  e.importData({ format: 'teams-json', payload: { channel: 'undated', messages: [{ seq: 1, time: '08:05', author: 'Veikko Field', text: 'Bounced the port on TRN-064.' }] } });
  await flush();
  const c = caseOf(e, 'TRN-064', true);
  const kinds = () => e.store.get('investigation', standingInvestigationId(c.id))!.gaps.filter((g) => g.status === 'open').map((g) => parseGapId(g.id)?.kind);
  time.iso = '2026-11-08T09:59:00.000Z';
  await e.upkeep();
  assert.ok(!kinds().includes('outcome'), '23 h 59 min after capture: not yet');
  time.iso = '2026-11-08T10:00:00.000Z';
  await e.upkeep();
  assert.ok(kinds().includes('outcome'), '24 h after capture');
});

test('pairing rationale: hours only from known times; time-only messages say the times are unknown', async () => {
  const { e } = setup();
  e.importData({ format: 'teams-json', payload: FIX_061 });
  e.importData({ format: 'teams-json', payload: PROBLEM_061 });
  await flush();
  const known = e.store.get('investigation', standingInvestigationId(caseOf(e, 'TRN-061', true).id))!.gaps.find((g) => parseGapId(g.id)?.kind === 'pairing')!;
  assert.match(known.description, / 2 hours apart and records no fix\.$/);
  const { e: e2 } = setup();
  const timeOnly = (t: { channel: string; messages: { time: string }[] }, hhmm: string) => ({ ...t, messages: t.messages.map((m) => ({ ...m, time: hhmm })) });
  e2.importData({ format: 'teams-json', payload: timeOnly(FIX_061, '08:05') });
  e2.importData({ format: 'teams-json', payload: timeOnly(PROBLEM_061, '09:40') });
  await flush();
  const undated = e2.store.get('investigation', standingInvestigationId(caseOf(e2, 'TRN-061', true).id))!.gaps.find((g) => parseGapId(g.id)?.kind === 'pairing')!;
  assert.doesNotMatch(undated.description, /hours apart/);
  assert.match(undated.description, /message times unknown; captured within a day of each other/);
});

test('pairing never names a partner case more restricted than the orphan fix (a group-scoped problem for an org-visible fix)', async () => {
  const { e } = setup();
  e.importData({ format: 'teams-json', payload: FIX_061 });
  e.importData({ format: 'teams-json', payload: PROBLEM_061, accessGroups: ['secret'] } as any);
  await flush();
  const problem = caseOf(e, 'TRN-061', false);
  assert.equal(problem.accessScope.visibility, 'group');
  const st = e.store.get('investigation', standingInvestigationId(caseOf(e, 'TRN-061', true).id))!;
  assert.ok(!st.gaps.some((g) => parseGapId(g.id)?.kind === 'pairing'), 'no pairing gap');
  assert.ok(st.gaps.every((g) => !g.id.includes(problem.id) && !g.description.includes('no traffic')));
});

test('an installation is not a fix: no missing-symptom question for "Installed the new unit"', async () => {
  const { e } = setup();
  e.importData({ format: 'teams-json', payload: { channel: 'field-log-3', messages: [{ seq: 1, time: '2026-08-11T08:30:00+03:00', author: 'Veikko Field', text: 'Installed the new card on PE-09.' }] } });
  await flush();
  assert.ok(!e.store.list('investigation').some((s) => s.origin === 'standing' && s.gaps.some((g) => parseGapId(g.id)?.kind === 'missing-symptom' && g.status === 'open')));
});
