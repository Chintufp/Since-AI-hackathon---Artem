import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Problem } from '../contracts/index.ts';
import { Engine } from '../../../apps/service/engine.ts';
import { polishCaveat } from '../../../apps/service/views.ts';
import { HybridRetriever } from '../retrieval/index.ts';
import { TemplateQuestionGenerator } from '../questions/index.ts';
import { storeDirectory } from './directory.ts';
import {
  buildSyntheticStore, cond, CASE_REF, NOW_ISO, ORG, requesterActor, requesterPrincipal, SYMPTOM_TEXT,
} from '../models/testing/fixtures.ts';
import type { InMemoryStore } from '../models/testing/in-memory-store.ts';
import { defaultInvestigationSettings, investigate, parseProblemText, RulesAssessor, withArticle } from './index.ts';

const clock = () => new Date(NOW_ISO);
const values = (text: string): Record<string, unknown> => Object.fromEntries(parseProblemText(text, 'p').conditions.map((c) => [c.key, c.value]));

test('parser keeps the main symptom: no traffic / traffic not coming back / traffic is back', () => {
  const a = values('TRN-301: changed the SFP, link up, alarms cleared, no traffic');
  assert.equal(a['traffic.state'], 'absent');
  assert.equal(a['component.replaced'], 'sfp');
  assert.equal(a['interface.status'], 'up');
  assert.equal(a['alarms.state'], 'cleared');
  assert.equal(values('Link up but there is no traffic')['traffic.state'], 'absent');
  assert.equal(values('We see zero traffic on the port')['traffic.state'], 'absent');
  assert.equal(values('Traffic is still not coming back')['traffic.state'], 'absent');
  assert.equal(values('traffic is not flowing')['traffic.state'], 'absent');
  assert.equal(values('traffic down since morning')['traffic.state'], 'absent');
  assert.equal(values('After the reset traffic is back')['traffic.state'], 'flowing');
  assert.equal(values('traffic returned')['traffic.state'], 'flowing');
  assert.equal(values('Traffic is flowing again')['traffic.state'], 'flowing');
  assert.equal(values('counters zero, no traffic counters moving')['traffic.state'], undefined, 'a counter phrase is not the traffic state');
  assert.equal(values('Everything looks fine')['traffic.state'], undefined);
});

test('parser: a stated model is extracted conservatively', () => {
  assert.equal(values('ACC-33 is an N5 and lost voice VLAN')['unit.model'], 'N5');
  assert.equal(values('It is an N5 unit at the edge')['unit.model'], 'N5');
  assert.equal(values('the card is model MK2')['unit.model'], 'MK2');
  assert.equal(values('ACC-33 is an older unit')['unit.model'], undefined);
  assert.equal(values('ACC-33 is a TRN-12')['unit.model'], undefined, 'an asset id is not a model');
  assert.equal(values('this is not an N5 unit')['unit.model'], undefined, 'negated');
  assert.equal(values('ACC-33 is an n5')['unit.model'], undefined, 'the token must look like a model (case-sensitive)');
  assert.equal(values('model numbers vary')['unit.model'], undefined);
  const off = parseProblemText('ACC-33 is an N5', 'p', { modelParser: null }).conditions;
  assert.equal(off.find((c) => c.key === 'unit.model'), undefined);
  const c = parseProblemText('ACC-33 is an N5', 'p').conditions.find((x) => x.key === 'unit.model');
  assert.ok(c?.evidence[0]?.excerpt && c.evidence[0].span, 'carries its evidence span');
  assert.equal(withArticle('N5'), 'an N5');
  assert.equal(withArticle('U2'), 'a U2');
  assert.equal(withArticle('older unit'), 'an older unit');
});

function run(store: InMemoryStore, id: string, text: string, extra: Partial<Problem> = {}) {
  const settings = defaultInvestigationSettings();
  const problem: Problem = { id, orgId: ORG, text, requester: requesterActor(), observations: [cond('unit.age', 'older', 'Older unit')], createdAt: NOW_ISO, ...extra };
  const deps = { retriever: new HybridRetriever(store, settings), assessor: new RulesAssessor({ store, settings }), settings, clock };
  return investigate({ problem, store, principal: requesterPrincipal(), deps }).then((state) => ({ state, settings }));
}

test('a model conflict with the case unit is never qualified or reused', async () => {
  const store = buildSyntheticStore();
  const c = store.get('case', CASE_REF)!;
  store.put('case', { ...c, conditions: [...c.conditions, cond('unit.model', 'N3', 'Model N3')] });
  const { state } = await run(store, 'p_model_conflict', `Asset-E5 is an N5: ${SYMPTOM_TEXT}`);
  assert.equal(state.hypotheses.find((h) => h.sourceClaimIds.includes('cl_c1_hyp'))?.applicability, 'inapplicable');
  assert.equal(state.recommendation.kind, 'retain-uncertainty');
  assert.match(state.recommendation.text, /N3/);
  assert.match(state.recommendation.text, /N5/);
  assert.equal(state.candidates[0]?.conflictingConditions.some((x) => x.key === 'unit.model'), true);
});

test('an unrecorded case model with a stated model is the consequential gap; the question is templated; answers settle it', async () => {
  const store = buildSyntheticStore();
  const { state, settings } = await run(store, 'p_model_gap', `Asset-E5 is an N5: ${SYMPTOM_TEXT}`);
  assert.equal(state.recommendation.kind, 'qualified');
  const gap = state.gaps.find((g) => g.status === 'open' && g.consequential);
  assert.equal(gap?.targetCondition?.key, 'unit.model');
  assert.match(state.recommendation.text, /model is N5/i);
  const gen = new TemplateQuestionGenerator({ store, settings, directory: storeDirectory(store), clock });
  const qs = await gen.generate(state, 4);
  assert.equal(qs[0]?.text, 'Is Asset-A1 an N5?');
  assert.doesNotMatch(qs[0]?.rationale ?? '', /undefined|\{/);
  // "yes" (attributed answer) matches, "no" conflicts; both leave the stated model visible in the labels.
  const answer = (value: string) => ({ ...cond('unit.model', value, `answered ${value}`), operator: 'eq' as const });
  const yes = await run(store, 'p_model_yes', `Asset-E5 is an N5: ${SYMPTOM_TEXT}`, {
    observations: [cond('unit.age', 'older', 'Older unit'), answer('__answer:matches-case')],
  });
  assert.equal(yes.state.recommendation.kind, 'check-first');
  assert.match(yes.state.recommendation.nextStep ?? '', /confirmed/);
  const no = await run(store, 'p_model_no', `Asset-E5 is an N5: ${SYMPTOM_TEXT}`, {
    observations: [cond('unit.age', 'older', 'Older unit'), answer('__answer:differs-from-case')],
  });
  assert.equal(no.state.recommendation.kind, 'retain-uncertainty');
  assert.match(no.state.recommendation.text, /another model there, model N5 here/);
  assert.ok(no.state.recommendation.caveats.some((c) => /does not apply to this unit, going by the answer you received/.test(c)), no.state.recommendation.caveats.join(' | '));
  assert.ok(no.state.recommendation.caveats.every((c) => !/inapplicable|unsupported|retain-uncertainty/.test(c)), 'no enum words in prose');
});

test('a model stated nowhere never adds a gap on the unit model', async () => {
  const store = buildSyntheticStore();
  const { state } = await run(store, 'p_no_model', `Asset-E5: ${SYMPTOM_TEXT}`);
  assert.ok(!state.gaps.some((g) => g.targetCondition?.key === 'unit.model'));
});

test('caveat wording: independent source records are explained, not a raw "x independent of y"', () => {
  assert.equal(
    polishCaveat('Recovery is reported, not verified; 8 independent of 9 source record(s).'),
    'Recovery is reported, not verified; 8 of 9 source records are independent (copies and retellings are not counted).',
  );
  assert.match(polishCaveat('x; 1 independent of 1 source record(s); 2 claim(s) retracted.'), /1 of 1 source record is independent \(copies/);
  assert.equal(polishCaveat('No outcome has been reported.'), 'No outcome has been reported.');
});

const DEV = new URL('../../../../data/fixtures/dev-family-01', import.meta.url).pathname;
const rita = { id: 'person:test:requester', displayName: 'Rita Requester', groups: ['noc'], type: 'human' as const };

async function devEngine(): Promise<Engine> {
  const e = new Engine({ dbPath: ':memory:' });
  await e.resetDemo('empty');
  e.importData({ format: 'scenario-dir', path: DEV });
  return e;
}

test('re-POSTing the same text after the answer keeps the answered loop and its reason', async () => {
  const e = await devEngine();
  const text = 'BGP sessions flapping on RTR-203 after the firmware update';
  const r = await e.investigate({ text, principal: rita, allowQuestions: true });
  assert.ok(r.question, 'a question is open');
  const q = e.store.get('question', r.question.questionId)!;
  const who = e.store.get('entity', q.personEntityId)!;
  await e.answer(q.id, { principal: { id: who.id, displayName: who.name, groups: ['noc'], type: 'human' }, value: 'no' });
  const after = e.getInvestigation(r.investigationId, rita.id);
  assert.equal(after.loop, 'answered');
  const again = await e.investigate({ text, principal: rita, allowQuestions: true });
  assert.equal(again.investigationId, r.investigationId);
  if (again.state.gaps.some((g) => g.status === 'open' && g.consequential)) return; // a new open gap may legitimately ask again
  assert.equal(again.loop, 'answered');
  assert.equal(again.loopReason, after.loopReason);
  assert.equal(e.getInvestigation(r.investigationId, rita.id).loop, 'answered', 'and it persists');
  e.close();
});

test('contact draft: main symptom first, every valued condition, valueless ones skipped', async () => {
  const e = await devEngine();
  const text = 'Ticket opened this morning. RTR-203: changed the SFP, BGP sessions flapping, link up, alarms cleared, no traffic. Unit from 2018.';
  const r = await e.investigate({
    text, principal: rita, allowQuestions: false,
    observations: [{ key: 'unit.installed_year', operator: 'present', label: 'Installed year' } as never],
  });
  const person = r.people[0];
  assert.ok(person, 'someone with experience');
  const body = e.contactDraft({ principal: rita, investigationId: r.investigationId, personEntityId: person.personEntityId }).body;
  const see = body.split('What I see now:\n')[1]!.split('\n\n')[0]!.split('\n');
  assert.match(see[0]!, /^- RTR-203: changed the SFP, BGP sessions flapping, link up, alarms cleared, no traffic$/);
  for (const need of ['No traffic', 'Interface up', 'Alarms cleared', 'Installed in 2018']) assert.ok(see.some((l) => l.includes(need)), `${need} in ${see.join(' | ')}`);
  assert.ok(!see.some((l) => /^- Installed year$/.test(l)), 'a condition without a value is skipped');
  assert.ok(!see.some((l) => l.includes('Ticket opened')), 'the preface is not the symptom');
  e.close();
});

test('people reasons put the evidence span that mentions the action first', async () => {
  const store = buildSyntheticStore();
  const link = store.get('personLink', 'lk2')!;
  store.put('personLink', { ...link, evidence: [{ evidenceId: 'ev:c1:9', excerpt: 'Arrived at the site around noon.' }, { evidenceId: 'ev:c1:4', excerpt: 'I reset the interface and traffic came back.' }] });
  const { state } = await run(store, 'p_excerpt', `Asset-E5: ${SYMPTOM_TEXT}`);
  const reason = state.people.flatMap((p) => p.reasons).find((r) => /reset/i.test(r.text) && r.evidence.length > 1);
  assert.ok(reason, JSON.stringify(state.people.map((p) => p.reasons.map((r) => [r.text, r.evidence.map((e) => e.excerpt)]))));
  assert.match(reason.evidence[0]?.excerpt ?? '', /reset the interface/);
});
