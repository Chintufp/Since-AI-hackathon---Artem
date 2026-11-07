import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Principal, QuestionCandidate, QuestionRecord } from '../contracts/index.ts';
import { stableId } from '../contracts/index.ts';
import {
  buildSyntheticStore, cond, ORG, P, personPrincipal, requesterActor, SYMPTOM_TEXT, NOW_ISO,
} from '../models/testing/fixtures.ts';
import type { InMemoryStore } from '../models/testing/in-memory-store.ts';
import { defaultInvestigationSettings } from '../investigation/index.ts';
import { evaluateEligibility, evaluativePair, findRecipients } from './index.ts';
import { makeHarness, type Harness } from './testing/harness.ts';

const B2 = `Asset-B2: ${SYMPTOM_TEXT}`;
const site = (): Principal => personPrincipal(P.site, ['noc', 'field']);
const op = (): Principal => personPrincipal(P.op, ['noc', 'field']);

const seed = (store: InMemoryStore, person: string, status: QuestionRecord['status'], deliveredAt: string | undefined, tag: string): void => {
  const candidate: QuestionCandidate = {
    id: `qc_seed_${tag}`, orgId: ORG, investigationId: `inv_seed_${tag}`, gapId: `gap|inv_seed_${tag}|missing|case_ref_reset|other.key`, kind: 'quick', text: 'seed?', answerType: 'yes-no-unknown',
    scope: { entityIds: [] }, rationale: 'seed', consequences: { yes: '', no: '' }, generatedBy: { route: 'rules', version: 'seed' }, dedupKey: `seed:${tag}`, recipientIds: [person],
  };
  store.put('question', { id: `q_seed_${tag}`, orgId: ORG, candidate, personEntityId: person, decisionId: 'dec_seed', status, createdAt: deliveredAt ?? NOW_ISO, updatedAt: NOW_ISO, ...(deliveredAt ? { deliveredAt } : {}) });
};

const ago = (h: Harness, minutes: number): string => new Date(Date.parse(h.time.iso) - minutes * 60_000).toISOString();

test('(3) missing distinguishing condition -> one consequential gap -> one quick question to the firsthand person; requester excluded', async () => {
  const h = makeHarness(buildSyntheticStore());
  const st = await h.start('p3', B2);
  assert.equal(st.gaps.filter((g) => g.consequential && g.status === 'open').length, 1);
  assert.equal(st.loop, 'deferred');
  const r = await h.coordinator.request(st);
  assert.equal(r.candidates.length, 1);
  const cand = r.candidates[0]!;
  assert.equal(cand.kind, 'quick');
  assert.equal(cand.text, 'Is Asset-B2 an older unit?');
  assert.doesNotMatch(cand.rationale, /\bev_[0-9a-f]+|Evidence: /); // prose never carries raw evidence ids; the basis is structured
  assert.ok(cand.consequences.yes && cand.consequences.no);
  assert.deepEqual(cand.recipientIds, [P.site.entity]);
  assert.ok(!(cand.recipientIds as string[]).includes(P.req.entity));
  assert.equal(r.question?.personEntityId, P.site.entity);
  assert.equal(r.question?.status, 'delivered');
  assert.equal(r.decision?.propensity, 1);
  assert.equal(r.state.loop, 'question-open');
  // eligibility for the requester would fail with 'self' (and not-answerable)
  const e = evaluateEligibility({ store: h.store, settings: h.settings, directory: (h.coordinator as unknown as { ctx: never }).ctx['directory'], clock: h.clock }, r.state, cand, P.req.entity);
  assert.ok(e.violations.includes('self'));
  // evaluation record: benefit unknown (null), effort counted
  const ev = h.store.get('evaluation', r.decision!.id);
  assert.equal(ev?.assessedBenefit, null);
  assert.deepEqual(ev?.effort, { questionsAsked: 1, interruptions: 1 });
});

test('(3) answer yes -> applicable, state rebuilt, evidence envelope created and citable', async () => {
  const h = makeHarness(buildSyntheticStore());
  const st = await h.start('p3y', B2);
  const r = await h.coordinator.request(st);
  const res = await h.coordinator.answer(r.question!.id, 'yes', site());
  const hyp = res.state.hypotheses.find((x) => x.sourceClaimIds.includes('cl_c1_hyp'))!;
  assert.equal(hyp.applicability, 'applicable');
  assert.equal(res.state.recommendation.kind, 'check-first');
  assert.equal(res.state.loop, 'answered');
  assert.equal(res.question.status, 'answered');
  assert.equal(res.answer.claimUpdates[0]?.change, 'support');
  const env = h.store.get('evidence', res.answer.evidenceId)!;
  assert.equal(env.provider, 'paste');
  assert.equal(env.connectionId, 'answer:desktop');
  assert.equal(env.kind, 'observation');
  assert.equal(env.author.id, P.site.actor);
  assert.ok(res.state.gaps.find((g) => g.targetCondition?.key === 'unit.age')?.status === 'resolved');
  assert.equal(res.state.gaps.find((g) => g.targetCondition?.key === 'unit.age')?.resolvedBy?.answerId, res.answer.id);
  assert.ok(res.state.recommendation.basis.length > 0);
  // the persisted state is the rebuilt one and keeps the question/decision links
  const persisted = h.store.get('investigation', st.id)!;
  assert.deepEqual(persisted.questionIds, [r.question!.id]);
  assert.equal(persisted.decisionIds.length, 1);
});

test('(3) answer no -> inapplicable, hypothesis lowered, recommendation flips to retain-uncertainty (useful No)', async () => {
  const h = makeHarness(buildSyntheticStore());
  const st = await h.start('p3n', B2);
  assert.equal(st.recommendation.kind, 'qualified');
  const r = await h.coordinator.request(st);
  const res = await h.coordinator.answer(r.question!.id, 'no', site());
  const hyp = res.state.hypotheses.find((x) => x.sourceClaimIds.includes('cl_c1_hyp'))!;
  assert.equal(hyp.applicability, 'inapplicable');
  assert.equal(res.state.recommendation.kind, 'retain-uncertainty');
  assert.equal(res.answer.claimUpdates[0]?.change, 'contradict');
  assert.match(res.state.recommendation.text, /answered/);
});

test('(3) answer unknown -> no claim update, gap stays open, nobody is re-asked', async () => {
  const h = makeHarness(buildSyntheticStore());
  const st = await h.start('p3u', B2);
  const r = await h.coordinator.request(st);
  const res = await h.coordinator.answer(r.question!.id, 'unknown', site());
  assert.ok(res.answer.claimUpdates.every((u) => u.change === 'no-change'));
  assert.equal(h.store.list('observation').length, 0);
  assert.equal(res.question.status, 'answered');
  assert.equal(res.answer.value, 'unknown');
  const gap = res.state.gaps.find((g) => g.targetCondition?.key === 'unit.age')!;
  assert.equal(gap.status, 'open');
  assert.equal(res.state.recommendation.kind, 'qualified');
  const again = await h.coordinator.request(res.state);
  assert.equal(again.question, undefined);
  assert.equal(again.decision?.chosen, 'defer');
  assert.ok(again.eligibility.some((e) => e.violations.includes('already-asked')));
  // nobody else can be asked, but the per-investigation budget is not used: deferred, not exhausted
  assert.equal(again.state.loop, 'deferred');
  assert.match(again.state.loopReason ?? '', /already been asked/);
});

test('only the addressed recipient can answer', async () => {
  const h = makeHarness(buildSyntheticStore());
  const r = await h.coordinator.request(await h.start('p3w', B2));
  await assert.rejects(h.coordinator.answer(r.question!.id, 'yes', op()), /not the recipient/);
});

test('outcome question goes to firsthand actor/reporter/advisor of that case, not to those only mentioned', async () => {
  const h = makeHarness(buildSyntheticStore({ resetOutcome: 'missing' }));
  const st = await h.start('p_out', `Asset-E5: ${SYMPTOM_TEXT}`, [cond('unit.age', 'older')]);
  const gap = st.gaps.find((g) => g.consequential)!;
  const recs = findRecipients({ store: h.store, settings: h.settings, directory: (h.coordinator as unknown as { ctx: never }).ctx['directory'], clock: h.clock }, st, gap);
  assert.deepEqual(recs.map((x) => x.personEntityId).sort(), [P.exp.entity, P.op.entity].sort());
  assert.ok(recs.every((x) => x.firsthand));
  const r = await h.coordinator.request(st);
  assert.match(r.question!.candidate.text, /^Did traffic return right after the interface reset on Asset-/);
  const res = await h.coordinator.answer(r.question!.id, 'yes', r.question!.personEntityId === P.op.entity ? op() : personPrincipal(P.exp, ['noc', 'field']));
  assert.equal(res.state.hypotheses.find((x) => x.sourceClaimIds.includes('cl_c1_hyp'))?.support, 'supported');
  assert.equal(res.state.recommendation.kind, 'check-first');
  const h2 = makeHarness(buildSyntheticStore({ resetOutcome: 'missing' }));
  const r2 = await h2.coordinator.request(await h2.start('p_out2', `Asset-E5: ${SYMPTOM_TEXT}`, [cond('unit.age', 'older')]));
  const res2 = await h2.coordinator.answer(r2.question!.id, 'no', r2.question!.personEntityId === P.op.entity ? op() : personPrincipal(P.exp, ['noc', 'field']));
  assert.equal(res2.state.hypotheses.find((x) => x.sourceClaimIds.includes('cl_c1_hyp'))?.support, 'contradicted');
  assert.equal(res2.state.recommendation.kind, 'retain-uncertainty');
});

test('current-condition questions also go to people the ObservabilityPolicy marks able to observe; requester still excluded', async () => {
  const settings = { observability: { groups: { field: ['unit.age'] }, roles: {} } };
  const h = makeHarness(buildSyntheticStore(), { settings });
  const st = await h.start('p_pol', `Asset-E5: ${SYMPTOM_TEXT}`);
  const r = await h.coordinator.request(st);
  const ids = r.candidates[0]!.recipientIds.sort();
  assert.deepEqual(ids, [P.exp.entity, P.op.entity, P.site.entity].sort());
  assert.ok(!(ids as string[]).includes(P.req.entity));
  assert.ok(r.eligibility.every((e) => e.reasons[0]?.startsWith('Directory:')));
});

test('(4) requester-supplied observation resolves the gap -> queued question cancelled with gap-resolved', async () => {
  const h = makeHarness(buildSyntheticStore());
  const st = await h.start('p4', B2);
  const r = await h.coordinator.request(st, { deliver: false });
  assert.equal(r.question?.status, 'queued');
  const out = await h.coordinator.recordObservation(st.id, cond('unit.age', 'older', 'Older unit (requester observed)'), requesterActor());
  const q = h.store.get('question', r.question!.id)!;
  assert.equal(q.status, 'cancelled');
  assert.equal(q.cancelReason, 'gap-resolved');
  assert.equal(out.cancelled.length, 1);
  assert.equal(out.state.recommendation.kind, 'check-first');
  const gap = out.state.gaps.find((g) => g.targetCondition?.key === 'unit.age')!;
  assert.equal(gap.status, 'resolved');
  assert.ok(gap.resolvedBy?.observationId && gap.resolvedBy.evidenceId);
  assert.ok(h.store.get('evidence', gap.resolvedBy.evidenceId!));
  // a delivered question is cancelled the same way
  const h2 = makeHarness(buildSyntheticStore());
  const st2 = await h2.start('p4b', B2);
  const r2 = await h2.coordinator.request(st2);
  assert.equal(r2.question?.status, 'delivered');
  await h2.coordinator.recordObservation(st2.id, cond('unit.age', 'older'), requesterActor());
  assert.equal(h2.store.get('question', r2.question!.id)?.cancelReason, 'gap-resolved');
  await assert.rejects(h2.coordinator.undo(r2.question!.id, site()), /System cancellations/);
});

test('(5) daily limit reached -> ineligible -> defer', async () => {
  const h = makeHarness(buildSyntheticStore(), { settings: { coordinator: { dailyLimitPerPerson: 2, cooldownMinutes: 30, maxOpenQuestionsPerPerson: 5, maxQuestionsPerInvestigation: 3, selectorId: 'rules' } } });
  seed(h.store, P.site.entity, 'answered', ago(h, 300), 'a');
  seed(h.store, P.site.entity, 'answered', ago(h, 200), 'b');
  const r = await h.coordinator.request(await h.start('p5a', B2));
  assert.equal(r.decision?.chosen, 'defer');
  assert.equal(r.question, undefined);
  assert.ok(r.eligibility[0]?.violations.includes('budget'));
  assert.equal(r.state.loop, 'deferred');
});

test('(5) cooldown active -> ineligible; cooldown elapsed -> eligible', async () => {
  const h = makeHarness(buildSyntheticStore(), { settings: { coordinator: { dailyLimitPerPerson: 5, cooldownMinutes: 30, maxOpenQuestionsPerPerson: 5, maxQuestionsPerInvestigation: 3, selectorId: 'rules' } } });
  seed(h.store, P.site.entity, 'answered', ago(h, 10), 'c');
  const r = await h.coordinator.request(await h.start('p5b', B2));
  assert.equal(r.decision?.chosen, 'defer');
  assert.deepEqual(r.eligibility[0]?.violations, ['cooldown']);
  h.time.iso = new Date(Date.parse(h.time.iso) + 25 * 60_000).toISOString();
  const later = await h.coordinator.request(r.state);
  assert.ok(later.question);
});

test('(5) maxOpen 1 enforced', async () => {
  const h = makeHarness(buildSyntheticStore());
  seed(h.store, P.site.entity, 'delivered', ago(h, 300), 'd');
  const r = await h.coordinator.request(await h.start('p5c', B2));
  assert.equal(r.decision?.chosen, 'defer');
  assert.ok(r.eligibility[0]?.violations.includes('budget'));
  assert.deepEqual(r.state.people.find((p) => p.personEntityId === P.site.entity)?.askable, false);
});

test('(6) duplicate dedupKey is not asked twice (same person elsewhere, and another person in the same investigation)', async () => {
  const h = makeHarness(buildSyntheticStore(), { settings: { observability: { groups: { field: ['unit.age'] }, roles: {} } } });
  const r1 = await h.coordinator.request(await h.start('p6a', B2));
  assert.ok(r1.question);
  const key = r1.question!.candidate.dedupKey;
  // another investigation about the same asset: same dedupKey, same person -> duplicate
  await h.coordinator.answer(r1.question!.id, 'unknown', personPrincipal({ actor: h.store.get('entity', r1.question!.personEntityId)!.actorIds![0]!, name: 'x' }, ['noc', 'field']));
  h.time.iso = new Date(Date.parse(h.time.iso) + 3 * 3600_000).toISOString();
  const st2 = await h.start('p6b', `Asset-B2 again: ${SYMPTOM_TEXT}`);
  const r2 = await h.coordinator.request(st2);
  const answeredPerson = r1.question!.personEntityId;
  const own = r2.eligibility.find((e) => e.personEntityId === answeredPerson)!;
  // answered elsewhere: time-bounded cooldown (the answer itself is reused as evidence), not a permanent duplicate
  assert.ok(own.violations.includes('cooldown') && !own.violations.includes('duplicate'));
  assert.equal(r2.candidates[0]?.dedupKey, key);
  // duplicate means same person (any investigation) or same investigation (any person); other people elsewhere stay askable
  assert.ok(r2.eligibility.filter((e) => e.personEntityId !== answeredPerson).every((e) => !e.violations.includes('duplicate')));
  assert.ok(r2.eligibility.length >= 2);
});

test('(6) active question for the same dedupKey blocks a second recipient in the same investigation', async () => {
  const h = makeHarness(buildSyntheticStore(), { settings: { observability: { groups: { field: ['unit.age'] }, roles: {} } } });
  const st = await h.start('p6c', `Asset-E5: ${SYMPTOM_TEXT}`);
  const r = await h.coordinator.request(st);
  assert.ok(r.question);
  const other = [P.exp.entity, P.op.entity, P.site.entity].find((p) => p !== r.question!.personEntityId)!;
  const e = evaluateEligibility({ store: h.store, settings: h.settings, directory: (h.coordinator as unknown as { ctx: never }).ctx['directory'], clock: h.clock }, r.state, r.question!.candidate, other);
  assert.ok(e.violations.includes('duplicate'));
});

test('access: recipient who may not see the cited case is ineligible', async () => {
  const h = makeHarness(buildSyntheticStore(), { settings: { observability: { groups: { secops: ['unit.age'] }, roles: {} } } });
  const r = await h.coordinator.request(await h.start('p_acc', `Asset-E5: ${SYMPTOM_TEXT}`));
  const e = r.eligibility.find((x) => x.personEntityId === P.sec.entity)!;
  assert.ok(e.violations.includes('access'));
  assert.equal(r.decision?.chosen, 'defer');
});

test('unavailable recipient is ineligible', async () => {
  const store = buildSyntheticStore();
  const e = store.get('entity', P.site.entity)!;
  store.put('entity', { ...e, attributes: { ...e.attributes, available: { value: false, origin: 'reported', evidence: [] } } });
  const h = makeHarness(store);
  const r = await h.coordinator.request(await h.start('p_un', B2));
  assert.ok(r.eligibility[0]?.violations.includes('unavailable'));
  assert.equal(r.decision?.chosen, 'defer');
});

test('lifecycle: defer/dismiss/undo/cancel keep previousStatus; undo of an answer withdraws it', async () => {
  const h = makeHarness(buildSyntheticStore());
  const st = await h.start('p_life', B2);
  const r = await h.coordinator.request(st);
  const qid = r.question!.id;
  const d = h.coordinator.defer(qid, site());
  assert.equal(d.status, 'deferred');
  assert.equal(d.previousStatus, 'delivered');
  assert.equal((await h.coordinator.undo(qid, site())).status, 'delivered');
  assert.equal(h.coordinator.dismiss(qid, site()).status, 'dismissed');
  assert.equal((await h.coordinator.undo(qid, site())).status, 'delivered');
  const res = await h.coordinator.answer(qid, 'no', site());
  assert.equal(res.state.recommendation.kind, 'retain-uncertainty');
  const undone = await h.coordinator.undo(qid, site());
  assert.equal(undone.status, 'delivered');
  assert.equal(undone.answerId, undefined);
  assert.equal(h.store.list('answer').length, 0);
  const back = h.store.get('investigation', st.id)!;
  assert.equal(back.recommendation.kind, 'qualified');
  const c = h.coordinator.cancel(qid, 'requester');
  assert.equal(c.status, 'cancelled');
  assert.equal(c.cancelReason, 'requester');
  await assert.rejects(h.coordinator.answer(qid, 'yes', site()), /cancelled/);
});

test('no-question-needed: reuse path asks nobody; requester-observable gaps never become questions', async () => {
  const h = makeHarness(buildSyntheticStore());
  const st = await h.start('p_nq', `Asset-E5: ${SYMPTOM_TEXT}`, [cond('unit.age', 'older')]);
  const r = await h.coordinator.request(st);
  assert.equal(r.candidates.length, 0);
  assert.equal(r.state.loop, 'no-question-needed');
  assert.equal(h.store.list('question').length, 0);
});

test('evaluative pair is optional and only built from >= 2 factual candidates', async () => {
  const off = makeHarness(buildSyntheticStore({ resetOutcome: 'missing' }));
  const stOff = await off.start('p_ev0', B2);
  const cands0 = await off.generator.generate(stOff, 4);
  assert.equal(cands0.filter((c) => c.kind === 'evaluative').length, 0);
  assert.equal(cands0.length, 2);
  const on = makeHarness(buildSyntheticStore({ resetOutcome: 'missing' }), { settings: { questions: { ...off.settings.questions, evaluativePairs: true } } });
  const stOn = await on.start('p_ev1', B2);
  const cands = await on.generator.generate(stOn, 4);
  assert.equal(cands.filter((c) => c.kind === 'evaluative').length, 1);
  const ev = evaluativePair(cands[0]!, cands[1]!);
  assert.match(ev.rationale, /not evidence/);
  // coordinator never asks an evaluative candidate as a factual question
  const r = await on.coordinator.request(stOn);
  assert.ok(r.candidates.every((c) => c.kind === 'quick'));
  void stableId;
});

// ---- fix pass ----------------------------------------------------------------------------------

test('fix: a year unrelated to the hardware does not infer unit.age; a unit year folds into the age class', async () => {
  const { parseProblemText } = await import('../investigation/problem-parser.ts');
  const keys = (t: string): string[] => parseProblemText(t, 'x').conditions.map((c) => c.key);
  assert.ok(!keys('Asset-B2: link is up but counters zero. Customer since 2018.').includes('unit.age'));
  assert.ok(!keys('Asset-B2 link is up. Contract from 2018 renewed.').includes('unit.installed_year'));
  assert.ok(keys('Asset-B2 installed in 2018').includes('unit.installed_year'));
  const h = makeHarness(buildSyntheticStore());
  const st = await h.start('pyr', `${B2}. Customer account open since 2018.`);
  assert.equal(st.recommendation.kind, 'qualified');
  assert.equal(st.gaps.filter((g) => g.consequential && g.status === 'open').length, 1);
  // a hardware-context year is folded into the age class through the configurable olderThroughYear (2019): it settles unit.age
  const st2 = await h.start('pyr2', `${B2}. Unit installed in 2018.`);
  assert.equal(st2.recommendation.kind, 'check-first');
  assert.equal(st2.gaps.filter((g) => g.consequential && g.status === 'open').length, 0);
});

test('fix: an answer in one investigation is reused as attributed evidence in a later investigation on the same asset', async () => {
  const h = makeHarness(buildSyntheticStore());
  const st = await h.start('pc1', B2);
  const r = await h.coordinator.request(st);
  await h.coordinator.answer(r.question!.id, 'yes', site());
  const st2 = await h.start('pc2', B2);
  assert.equal(st2.recommendation.kind, 'check-first');
  assert.equal(st2.gaps.filter((g) => g.status === 'open' && g.consequential).length, 0);
  assert.ok(st2.hypotheses.some((x) => x.applicability === 'applicable'));
  const r2 = await h.coordinator.request(st2);
  assert.equal(r2.question, undefined);
  assert.equal(r2.state.loop, 'no-question-needed');
});

test('fix: after an unknown answer elsewhere the person is on cooldown (not permanently duplicate), and can be asked later', async () => {
  const h = makeHarness(buildSyntheticStore());
  const st = await h.start('pu1', B2);
  const r = await h.coordinator.request(st);
  await h.coordinator.answer(r.question!.id, 'unknown', site());
  const st2 = await h.start('pu2', B2);
  const r2 = await h.coordinator.request(st2);
  assert.equal(r2.question, undefined);
  const v = r2.eligibility.flatMap((e) => e.violations);
  assert.ok(v.includes('cooldown') && !v.includes('duplicate'));
  assert.notEqual(r2.state.loop, 'exhausted');
});

test('fix: answers about conditions with non-eq operators use agreement with the case condition', async () => {
  for (const [operator, value] of [['lte', 2019], ['absent', undefined]] as const) {
    const mk = (): InMemoryStore => {
      const store = buildSyntheticStore();
      const c = store.get('case', 'case_ref_reset')!;
      store.put('case', { ...c, conditions: c.conditions.map((x) => (x.key === 'unit.age'
        ? { ...x, key: 'unit.age', operator, ...(value === undefined ? {} : { value }), label: operator === 'lte' ? 'Installed in 2019 or earlier' : 'No legacy unit' } : x)) });
      return store;
    };
    const h = makeHarness(mk());
    const st = await h.start(`pop_${operator}`, B2);
    const r = await h.coordinator.request(st);
    assert.ok(r.question, `question for ${operator}`);
    assert.doesNotMatch(r.question!.candidate.text, /^Was \S+ installed in/);
    const no = await h.coordinator.answer(r.question!.id, 'no', site());
    assert.equal(no.state.gaps.find((g) => g.targetCondition?.key === 'unit.age')?.status, 'resolved');
    assert.equal(no.state.recommendation.kind, 'retain-uncertainty');
    // yes -> the case condition holds -> applicable (fresh store)
    const h2 = makeHarness(mk());
    const st2 = await h2.start(`pop2_${operator}`, B2);
    const r2 = await h2.coordinator.request(st2);
    const yes = await h2.coordinator.answer(r2.question!.id, 'yes', site());
    assert.equal(yes.state.hypotheses.find((x) => x.sourceClaimIds.includes('cl_c1_hyp'))?.applicability, 'applicable');
  }
});

test('fix: ClaimUpdate.claimId is always a real Claim id (outcome questions too)', async () => {
  const h = makeHarness(buildSyntheticStore({ resetOutcome: 'missing' }));
  const st = await h.start('pcl', `Asset-A1: ${SYMPTOM_TEXT}, older unit`);
  const r = await h.coordinator.request(st);
  assert.ok(r.question);
  const res = await h.coordinator.answer(r.question!.id, 'yes', op());
  assert.ok(res.answer.claimUpdates.length > 0);
  for (const u of res.answer.claimUpdates) assert.ok(h.store.get('claim', u.claimId), `claim ${u.claimId} exists`);
});

test('fix: investigate() on the same problem again keeps questions, decisions, resolved gaps and events', async () => {
  const h = makeHarness(buildSyntheticStore());
  const st = await h.start('pd', B2);
  const r = await h.coordinator.request(st);
  await h.coordinator.answer(r.question!.id, 'yes', site());
  const before = h.store.get('investigation', st.id)!;
  const again = await h.start('pd', B2);
  assert.equal(again.questionIds.length, before.questionIds.length);
  assert.equal(again.decisionIds.length, before.decisionIds.length);
  assert.ok(again.events.length >= before.events.length);
  assert.ok(again.gaps.some((g) => g.status === 'resolved'));
});

test('fix: undoing a requester cancellation requires the requester or an agent', async () => {
  const h = makeHarness(buildSyntheticStore());
  const st = await h.start('pun', B2);
  const r = await h.coordinator.request(st);
  const qid = r.question!.id;
  h.coordinator.cancel(qid, 'requester');
  const outsider = personPrincipal({ actor: 'person:directory:outsider', name: 'Outsider' } as never, ['other']);
  await assert.rejects(h.coordinator.undo(qid, outsider), /requester or an agent/);
  const requester = personPrincipal(P.req, ['noc']);
  assert.equal((await h.coordinator.undo(qid, requester)).status, 'delivered');
});

// ---- polish pass 2: loop states and reasons -----------------------------------------------------------------------

test('polish: no eligible recipient -> deferred (not exhausted) with a plain reason', async () => {
  const store = buildSyntheticStore();
  const site0 = store.get('entity', P.site.entity)!;
  store.put('entity', { ...site0, attributes: { ...site0.attributes, available: { value: false, origin: 'reported', evidence: [] } } });
  const h = makeHarness(store);
  const st = await h.start('pl_def', B2);
  const r = await h.coordinator.request(st);
  assert.equal(r.question, undefined);
  assert.equal(r.state.loop, 'deferred');
  assert.ok(r.state.loopReason && r.state.loopReason.length > 0);
});

test('polish: exhausted only when the per-investigation question budget is used', async () => {
  const h = makeHarness(buildSyntheticStore(), { settings: { coordinator: { ...defaultInvestigationSettings().coordinator, maxQuestionsPerInvestigation: 1 } } });
  const st = await h.start('pl_exh', B2);
  const r = await h.coordinator.request(st);
  assert.equal(r.state.loop, 'question-open');
  assert.match(r.state.loopReason ?? '', /^Asked Site-Five because they observed conditions on Asset-B2$/); // changed from /Waiting for .* to answer/: the line now says why this person was asked
  const res = await h.coordinator.answer(r.question!.id, 'unknown', site());
  assert.equal(res.state.loop, 'answered');
  assert.ok(res.state.loopReason);
  const again = await h.coordinator.request(res.state);
  assert.equal(again.state.loop, 'exhausted');
  assert.match(again.state.loopReason ?? '', /budget/);
});
