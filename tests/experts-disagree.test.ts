/**
 * B5 "experts disagree" (BUILD_BRIEF section 4; DECISIONS-disagree.md). Expert A's case (Elisa's TRN-042 when the
 * git-ignored files are present, else an inline synthetic older-units thread) and Helmi Virtanen's generated TRN-512
 * thread (data/demo/experts-disagree). A problem on a unit of unknown batch gets two qualified hypotheses with different
 * advisers and ONE question, "Is TRN-577 from the 2021 batch?"; the answer picks the branch and neither expert's case is
 * overwritten. No model, no network.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { stableId, type Principal } from '../src/libs/utils/contracts/index.ts';
import { Engine } from '../src/apps/service/engine.ts';
import { agentResult } from '../src/apps/service/mcp-tools.ts';
import { defaultObservabilityPolicy } from '../src/apps/service/org-config.ts';
import { ROOT } from './support.ts';

const ELISA = join(ROOT, 'private/Elisa_SinceAI2026/ELISA_HIDDEN_KNOWLEDGE_EXAMPLE_2026/teams_chat.json');
const useElisa = existsSync(ELISA) && !process.env.KT_TEST_NO_PRIVATE;
const DISAGREE = join(ROOT, 'data/demo/experts-disagree');
const PROBLEM = 'Replaced the SFP on TRN-577, link up, alarms cleared, no traffic, counters zero. Not sure which batch this unit is from.';
const REQUESTER: Principal = { id: 'person:test:sanna-lind', displayName: 'Sanna Lind', groups: ['field'], type: 'human' };

/** Synthetic stand-in for expert A (no organizer names): older units -> disable and re-enable the interface. */
const OLDER_UNITS_THREAD = {
  channel: 'teams-test-older-units',
  participants: [{ name: 'Ville Ranta', role: 'Field Engineer' }, { name: 'Pekka Laine', role: 'Network Expert' }],
  messages: [
    { seq: 1, time: '10:02', author: 'Ville Ranta', role: 'Field Engineer', text: 'Hi Pekka, at the site. Changed the SFP on transmission node TRN-233.\nLink is up and alarms cleared, but traffic is still not coming back.' },
    { seq: 2, time: '10:04', author: 'Pekka Laine', role: 'Network Expert', text: 'Is this one of the older units?' },
    { seq: 3, time: '10:05', author: 'Ville Ranta', role: 'Field Engineer', text: 'Yes, it is one of the older units.' },
    { seq: 4, time: '10:07', author: 'Pekka Laine', role: 'Network Expert', text: 'Sometimes after changing the SFP the forwarding state does not recover on those.\nDisable the interface, wait a little, then enable it again.' },
    { seq: 5, time: '10:15', author: 'Ville Ranta', role: 'Field Engineer', text: 'Did that. Traffic is back.' },
  ],
};
const EXPERT_A = useElisa ? { name: 'Erkki Expert', asset: 'TRN-042' } : { name: 'Pekka Laine', asset: 'TRN-233' };

function engine(): Engine {
  const e = new Engine({ dbPath: ':memory:', investigation: { observability: defaultObservabilityPolicy } });
  e.setClock({ now: '2026-11-07T10:00:00.000Z' });
  if (useElisa) e.importData({ format: 'teams-json', path: ELISA, connectionId: 'import:teams:file' });
  else e.importData({ format: 'teams-json', payload: OLDER_UNITS_THREAD, connectionId: 'import:teams:test' });
  e.importData({ format: 'scenario-dir', path: DISAGREE });
  return e;
}

const caseOf = (e: Engine, asset: string) => e.store.list('case').find((c) => c.title.startsWith(asset))!;
/** What each expert's case says (the case row, its claims, attempts and outcomes): must survive either answer unchanged. */
const record = (e: Engine, caseId: string) => ({
  case: JSON.stringify(e.store.get('case', caseId)),
  claims: e.store.list('claim', { where: { caseId } }).map((c) => `${c.id}|${c.type}|${c.statement}|${c.assertedBy?.displayName ?? ''}`).sort(),
  attempts: e.store.list('attempt', { where: { caseId } }).map((x) => JSON.stringify(x)).sort(),
  outcomes: e.store.list('outcome', { where: { caseId } }).map((x) => JSON.stringify(x)).sort(),
});
const hypothesisOf = (state: { id: string; hypotheses: Array<{ id: string; applicability: string; support: string }> }, caseId: string) => state.hypotheses.find((h) => h.id === stableId('hyp', state.id, caseId))!;

async function ask(e: Engine) {
  const r = await e.investigate({ text: PROBLEM, principal: REQUESTER, allowQuestions: true });
  const a = caseOf(e, EXPERT_A.asset);
  const h = caseOf(e, 'TRN-512');
  const before = { a: record(e, a.id), h: record(e, h.id) };
  assert.ok(before.a.claims.length > 0 && before.h.claims.length > 0 && before.a.attempts.length > 0 && before.h.attempts.length > 0);
  return { r, a, h, before };
}

async function answer(e: Engine, questionId: string, personEntityId: string, value: 'yes' | 'no', investigationId: string) {
  const who = e.directory().find((d) => d.personEntityId === personEntityId)!;
  await e.answer(questionId, { principal: { id: who.personEntityId, displayName: who.name, groups: who.groups, type: 'human' }, value });
  return e.getInvestigation(investigationId, REQUESTER.id);
}

test(`experts disagree (${useElisa ? 'TRN-042 from private/' : 'inline older-units thread'} + Helmi on the 2021 batch): two qualified hypotheses, one batch question, the answer picks the branch, nothing overwritten`, async () => {
  const e = engine();
  try {
    const { r, a, h, before } = await ask(e);
    // Two related hypotheses, both qualified, with different advisers.
    assert.equal(hypothesisOf(r.state, h.id).applicability, 'qualified');
    assert.equal(hypothesisOf(r.state, a.id).applicability, 'qualified');
    assert.equal(r.caseView?.title, h.title, 'the batch branch is the one asked about');
    const alt = r.alternatives?.find((x) => x.caseId === a.id);
    assert.ok(alt, 'expert A is listed under the recommendation');
    assert.equal(alt.expert.displayName, EXPERT_A.name);
    assert.equal(alt.applicability, 'qualified');
    assert.match(alt.text, new RegExp(`^${EXPERT_A.name} advised disabling and re-enabling the interface in ${EXPERT_A.asset} \\(qualified, depends on older unit\\)$`));
    assert.deepEqual(agentResult(r).alternatives, r.alternatives, 'the MCP result carries the alternatives');
    const helmiAdvised = r.state.people.find((p) => p.displayName === 'Helmi Virtanen')?.reasons.find((x) => x.contribution === 'advised' && x.caseId === h.id);
    assert.ok(helmiAdvised?.firsthand, 'Helmi advised the TRN-512 response firsthand');
    // One open question, about the batch, to someone who is not the requester.
    assert.equal(r.question?.text, 'Is TRN-577 from the 2021 batch?');
    const recipient = r.question.personEntityId!;
    assert.ok(recipient && recipient !== REQUESTER.id);
    const open = e.store.list('question').filter((q) => q.candidate.investigationId === r.investigationId && ['queued', 'delivered', 'pending', 'deferred'].includes(q.status));
    assert.equal(open.length, 1);
    const names = r.people.map((p) => p.name);
    assert.ok(names.includes('Helmi Virtanen') && names.includes(EXPERT_A.name), names.join(', '));

    // Yes: the forwarding-table clear is recommended; expert A's case is still on record.
    const yes = await answer(e, r.question.questionId, recipient, 'yes', r.investigationId);
    assert.equal(yes.recommendation.kind, 'reuse');
    assert.match(yes.recommendation.text, /clearing the forwarding table/);
    assert.equal(hypothesisOf(yes.state, h.id).applicability, 'applicable');
    // The answered 2021 batch also rules out expert A's older-unit branch (D-B5-13); his case stays listed, as inapplicable.
    const aAfterYes = yes.alternatives?.find((x) => x.caseId === a.id);
    assert.equal(aAfterYes?.expert.displayName, EXPERT_A.name);
    assert.equal(aAfterYes?.applicability, 'inapplicable');
    assert.equal(hypothesisOf(yes.state, a.id).applicability, 'inapplicable');
    assert.ok(yes.recommendation.caveats.includes(`${EXPERT_A.asset} does not apply: older unit there, 2021 batch, answered here.`), yes.recommendation.caveats.join(' | '));
    assert.deepEqual({ a: record(e, a.id), h: record(e, h.id) }, before, 'a yes overwrites neither expert');
  } finally {
    e.close();
  }

  // No (fresh engine): Helmi's case does not apply, expert A's hypothesis becomes the recommendation.
  const f = engine();
  try {
    const { r, a, h, before } = await ask(f);
    assert.equal(r.question?.text, 'Is TRN-577 from the 2021 batch?');
    const no = await answer(f, r.question.questionId, r.question.personEntityId!, 'no', r.investigationId);
    assert.equal(hypothesisOf(no.state, h.id).applicability, 'inapplicable');
    assert.equal(no.caseView?.title, a.title, "expert A's case is now the basis");
    assert.equal(no.recommendation.kind, 'qualified');
    assert.match(no.recommendation.text, /disabling and re-enabling the interface/);
    const helmi = no.alternatives?.find((x) => x.caseId === h.id);
    assert.equal(helmi?.expert.displayName, 'Helmi Virtanen');
    assert.equal(helmi?.text, 'Helmi Virtanen advised clearing the forwarding table in TRN-512 (inapplicable, depends on 2021 batch)');
    assert.deepEqual({ a: record(f, a.id), h: record(f, h.id) }, before, 'a no overwrites neither expert');
  } finally {
    f.close();
  }
});

test('a stated later batch rules out the older-unit branch and asks nothing about the age; a hedged batch states nothing (D-B5-13, D-B5-16)', async () => {
  const e = engine();
  try {
    const a = caseOf(e, EXPERT_A.asset);
    const h = caseOf(e, 'TRN-512');
    const base = 'Replaced the SFP on TRN-577, link up, alarms cleared, no traffic, counters zero.';
    const later = await e.investigate({ text: `${base} Unit from the 2022 batch.`, principal: REQUESTER, allowQuestions: true });
    assert.equal(hypothesisOf(later.state, a.id).applicability, 'inapplicable');
    assert.equal(hypothesisOf(later.state, h.id).applicability, 'inapplicable');
    assert.equal(later.question, undefined, 'no "Is TRN-577 an older unit?": the stated batch already answers it');
    const stated = await e.investigate({ text: `${base} It is the 2021 batch.`, principal: REQUESTER, allowQuestions: true });
    assert.equal(stated.recommendation.kind, 'reuse');
    assert.equal(hypothesisOf(stated.state, a.id).applicability, 'inapplicable');
    const hedged = await e.investigate({ text: `${base} Not sure if it is the 2021 batch.`, principal: REQUESTER, allowQuestions: true });
    assert.equal(hedged.question?.text, 'Is TRN-577 from the 2021 batch?', 'a hedged batch is still the open question');
  } finally {
    e.close();
  }
});

test('the access gate drops an alternative whose case the viewer can no longer see, in getInvestigation()', async () => {
  const e = new Engine({ dbPath: ':memory:', investigation: { observability: defaultObservabilityPolicy } });
  e.setClock({ now: '2026-11-07T10:00:00.000Z' });
  try {
    // Expert A's thread is restricted to the 'core' group; the requester is in it at first.
    if (useElisa) e.importData({ format: 'teams-json', path: ELISA, connectionId: 'import:teams:file', accessGroups: ['core'] });
    else e.importData({ format: 'teams-json', payload: OLDER_UNITS_THREAD, connectionId: 'import:teams:test', accessGroups: ['core'] });
    e.importData({ format: 'scenario-dir', path: DISAGREE });
    const a = caseOf(e, EXPERT_A.asset);
    const insider: Principal = { ...REQUESTER, groups: ['field', 'core'] };
    const r = await e.investigate({ text: PROBLEM, principal: insider, allowQuestions: false });
    assert.ok(r.alternatives?.some((x) => x.caseId === a.id), 'the insider sees expert A listed');
    // Access changes: the 'core' evidence moves to a group the requester is not in.
    for (const ev of e.store.list('evidence')) {
      if (ev.accessScope.groups?.includes('core')) e.store.put('evidence', { ...ev, accessScope: { visibility: 'group', groups: ['restricted-test-group'] } });
    }
    const again = e.getInvestigation(r.investigationId, insider.id);
    assert.ok(!(again.alternatives ?? []).some((x) => x.caseId === a.id), JSON.stringify(again.alternatives));
    assert.doesNotMatch(JSON.stringify(again.alternatives ?? []), new RegExp(EXPERT_A.name));
  } finally {
    e.close();
  }
});

test('clean clone (no Elisa files): the demo reset leaves the thread out, so the walkthrough texts stay; seeded on request, the 4.2 story still holds (D-B5-05, D-B5-13)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kt-b5-clean-'));
  const TRN088 = 'At site now. Replaced the SFP on TRN-088, an older unit from 2018. Link is up, alarms cleared, RX power normal, but no traffic. Counters zero.';
  const TRN077 = 'TRN-077 older unit on firmware 4.2: changed the module, link up, counters zero, no traffic.';
  try {
    for (const seeded of [false, true]) {
      const e = new Engine({
        dbPath: join(dir, `kt-${seeded}.sqlite`), elisaDir: join(dir, 'no-elisa-here'), investigation: { observability: defaultObservabilityPolicy },
        ...(seeded ? { expertsDisagreeDir: DISAGREE } : {}),
      });
      e.setClock({ now: '2026-11-07T10:00:00.000Z' });
      try {
        for (const seed of [undefined, 'synthetic'] as const) {
          await e.resetDemo(seed);
          assert.equal(e.store.list('case').some((c) => c.title.startsWith('TRN-512')), seeded, `TRN-512 seeded=${seeded} seed=${seed}`);
          const liisa = e.directory().find((p) => p.name === 'Liisa Mäkelä')!;
          const principal: Principal = { id: liisa.personEntityId, displayName: liisa.name, groups: liisa.groups, type: 'human' };
          if (!seeded) {
            const r = await e.investigate({ text: TRN088, principal, allowQuestions: false });
            assert.equal(r.recommendation.text, 'You already did the SFP replacement; TRN-117 has no other reported fix.');
          }
          const ilmari = e.directory().find((p) => p.name === 'Ilmari Karjalainen')!;
          const fw: any = await e.investigate({ text: TRN077, principal: { id: ilmari.personEntityId, displayName: ilmari.name, groups: ilmari.groups, type: 'human' } });
          assert.ok(fw.state.recommendation.caveats.includes('Superseded on 14 Oct by Helmi Virtanen: fixed in firmware 4.2'), `4.2 caveat seeded=${seeded}`);
          assert.match(fw.state.recommendation.nextStep ?? '', /ask Helmi Virtanen/);
        }
      } finally {
        e.close();
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('elisa reset with the thread: the judge steps and prompt recipients (TRN-088, TRN-301, TRN-117, TRN-577) are pinned (D-B5-10, D-B5-17)', { skip: !useElisa }, async () => {
  const e = new Engine({ dbPath: ':memory:', investigation: { observability: defaultObservabilityPolicy } });
  e.setClock({ now: '2026-11-07T10:00:00.000Z' });
  try {
    const as = (name: string): Principal => {
      const d = e.directory().find((p) => p.name === name)!;
      return { id: d.personEntityId, displayName: d.name, groups: d.groups, type: 'human' };
    };
    const nameOf = (id?: string) => e.directory().find((p) => p.personEntityId === id)?.name;
    await e.resetDemo('elisa'); // a fresh reset per prompt, as judge-prompts.json records its targets
    const t088 = await e.investigate({ text: 'At site now. Replaced the SFP on TRN-088, an older unit from 2018. Link is up, alarms cleared, RX power normal, but no traffic. Counters zero.', principal: as('Veikko Vikkelä'), allowQuestions: true });
    assert.equal(t088.recommendation.text, 'Check the traffic counters before replacing the SFP again.');
    assert.ok(t088.recommendation.caveats.includes('TRN-512 does not apply: 2021 batch there, older unit here.'));
    assert.equal(t088.question, undefined);
    await e.resetDemo('elisa'); // a fresh reset per prompt, as judge-prompts.json records its targets
    const t301 = await e.investigate({ text: 'TRN-301: changed the SFP, link up, alarms cleared, no traffic. Not sure which unit generation this is.', principal: as('Veikko Vikkelä'), allowQuestions: true });
    assert.equal(t301.question?.text, 'Is TRN-301 an older unit?');
    assert.equal(nameOf(t301.question?.personEntityId), 'Erkki Expert');
    // Known limit (D-B5-17): TRN-117's own "2019 batch" is not parsed, so its prompt asks about the 2021 batch.
    await e.resetDemo('elisa'); // a fresh reset per prompt, as judge-prompts.json records its targets
    const t117 = await e.investigate({ text: 'TRN-117: replaced the SFP again this morning, link up, alarms cleared, counters zero. Not sure which unit generation this is.', principal: as('Marja Niemi'), allowQuestions: true });
    assert.equal(t117.question?.text, 'Is TRN-117 from the 2021 batch?');
    assert.equal(nameOf(t117.question?.personEntityId), 'Helmi Virtanen');
    await e.resetDemo('elisa'); // a fresh reset per prompt, as judge-prompts.json records its targets
    const t577 = await e.investigate({ text: PROBLEM, principal: as('Liisa Mäkelä'), allowQuestions: true });
    assert.equal(t577.question?.text, 'Is TRN-577 from the 2021 batch?');
    assert.equal(nameOf(t577.question?.personEntityId), 'Erkki Expert');
  } finally {
    e.close();
  }
});
