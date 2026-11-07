import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Engine } from '../../../apps/service/engine.ts';
import type { Condition, EvidenceEnvelope } from '../contracts/index.ts';
import { buildSyntheticStore, CASE_REF, E, GROUP_SCOPE, known, makeLink, makePerson, NOW_ISO, ORG, ORG_SCOPE, P, personPrincipal, SYMPTOM_TEXT, ev } from '../models/testing/fixtures.ts';
import { defaultInvestigationSettings, storeDirectory } from '../investigation/index.ts';
import { evaluateEligibility } from './eligibility.ts';
import { makeHarness } from './testing/harness.ts';

const PRIV = GROUP_SCOPE('slack-channel:PRIV');
const clock = () => new Date(NOW_ISO);
const envelope = (id: string, accessScope: typeof ORG_SCOPE, text = `text of ${id}`): EvidenceEnvelope => ({
  id, orgId: ORG, provider: 'synthetic', connectionId: 'test', sourceId: id, revision: '1', kind: 'message', text,
  author: { id: 'x', displayName: 'X' }, eventTime: { known: true, iso: NOW_ISO }, ingestedAt: NOW_ISO, thread: {}, accessScope,
  lineage: { importBatchId: 'b', sourceFingerprint: id },
});
const PROBLEM = 'Asset-A1: link is up but counters zero and no traffic, RX normal, alarms cleared';

function orgCaseStore() {
  const s = buildSyntheticStore({ distractors: false, restricted: false });
  s.put('case', { ...s.get('case', CASE_REF)!, accessScope: ORG_SCOPE });
  for (const id of ['cl_c1_hyp', 'cl_c1_adv', 'cl_c1_obs', 'cl_c1_age']) s.put('claim', { ...s.get('claim', id)!, accessScope: ORG_SCOPE });
  for (const id of ['ev:c1:1', 'ev:c1:2', 'ev:c1:3', 'ev:c1:4', 'ev:c1:5', 'ev:c1:6']) s.put('evidence', envelope(id, ORG_SCOPE, id === 'ev:c1:4' ? 'reset the interface' : `text ${id}`));
  return s;
}

test('recipients: a person known only through private evidence is never named in the requester loop status or asked', async () => {
  const s = orgCaseStore();
  s.put('entity', makePerson({ id: P.op.entity, name: P.op.name, role: 'field technician', groups: ['noc', 'field'], actorId: P.op.actor, available: false }));
  s.put('entity', makePerson({ id: P.exp.entity, name: P.exp.name, role: 'senior engineer', groups: ['noc', 'field'], actorId: P.exp.actor, available: false }));
  s.put('entity', makePerson({ id: 'ent_person_ghost', name: 'Ghost-Seven', role: 'contractor', groups: ['noc'], actorId: 'person:directory:ghost' }));
  s.put('evidence', envelope('ev:ghost', PRIV, 'SECRET ghost note'));
  s.put('personLink', makeLink({ id: 'lkG', personEntityId: 'ent_person_ghost', caseId: CASE_REF, entityId: E.a1, contribution: 'observed-condition', evidence: [ev('ev:ghost')], recency: known('2026-06-01T09:00:00.000Z') }));
  const eng = new Engine({ store: s, clock, orgId: ORG });
  const principal = { id: P.req.actor, displayName: P.req.name, groups: ['noc'], type: 'human' as const };
  const r = await eng.investigate({ text: PROBLEM, principal, allowQuestions: true });
  assert.ok(!JSON.stringify(r).includes('Ghost'), 'Ghost must not appear anywhere in the requester result');
  assert.ok(!s.list('question').some((q) => q.personEntityId === 'ent_person_ghost'), 'no question may be delivered to a person known only via private evidence');
});

test('eligibility: a recipient who cannot see the evidence behind the asked condition is ineligible (access)', async () => {
  const s = orgCaseStore();
  s.put('evidence', envelope('ev:c1:2', PRIV, 'SECRET-AGE unit is older revision 2019'));
  s.put('entity', makePerson({ id: P.req.entity, name: P.req.name, role: 'network engineer', groups: ['noc', 'slack-channel:PRIV'], actorId: P.req.actor }));
  s.put('entity', makePerson({ id: 'ent_person_ghost', name: 'Ghost-Seven', role: 'contractor', groups: ['noc'], actorId: 'person:directory:ghost' }));
  s.put('personLink', makeLink({ id: 'lkG', personEntityId: 'ent_person_ghost', caseId: CASE_REF, entityId: E.a1, contribution: 'observed-condition', evidence: [ev('ev:c1:1')], recency: known('2026-06-01T09:00:00.000Z') }));
  const eng = new Engine({ store: s, clock, orgId: ORG });
  const principal = { id: P.req.actor, displayName: P.req.name, groups: ['noc', 'slack-channel:PRIV'], type: 'human' as const };
  const r = await eng.investigate({ text: PROBLEM, principal, allowQuestions: true });
  for (const q of s.list('question').filter((x) => x.personEntityId === 'ent_person_ghost')) {
    assert.fail(`question went to a recipient who cannot see its evidence: ${q.candidate.text}`);
  }
  const gap = r.state.gaps.find((g) => g.targetCondition?.key === 'unit.age');
  assert.ok(gap, 'the unit.age gap exists');
  {
    const cand = { id: 'qc_x', orgId: ORG, investigationId: r.state.id, gapId: gap.id, kind: 'quick' as const, text: 't', answerType: 'yes-no-unknown' as const, scope: { entityIds: [] }, rationale: '', consequences: { yes: '', no: '' }, generatedBy: { route: 'r', version: '1' }, dedupKey: 'k', recipientIds: [] };
    const e = evaluateEligibility({ store: s, settings: defaultInvestigationSettings(), directory: storeDirectory(s), clock }, r.state, cand, 'ent_person_ghost');
    assert.ok(e.violations.includes('access'), JSON.stringify(e.violations));
  }
});

test('answer: a yes/no to a folded unit.age question is recorded even when the case stores only the installed year', async () => {
  const s = buildSyntheticStore();
  const c = s.get('case', CASE_REF)!;
  const year: Condition = { key: 'unit.installed_year', operator: 'eq', value: 2019, origin: 'reported', label: 'Installed 2019', evidence: [ev('ev:c1:2')] };
  s.put('case', { ...c, conditions: [...c.conditions.filter((x) => x.key !== 'unit.age'), year] });
  const h = makeHarness(s);
  const st = await h.start('p_fold', `Asset-B2: ${SYMPTOM_TEXT}`);
  const r = await h.coordinator.request(st);
  const q = r.question;
  assert.ok(q, 'a question is asked');
  const gap = st.gaps.find((g) => g.id === q.candidate.gapId);
  assert.equal(gap?.targetCondition?.key, 'unit.age');
  const res = await h.coordinator.answer(q.id, 'yes', personPrincipal(P.site, ['noc', 'field']));
  assert.equal(s.list('observation', { where: { investigationId: st.id } }).length, 1, 'the answer must become an observation');
  assert.equal(res.state.gaps.find((g) => g.id === q.candidate.gapId)?.status, 'resolved');
  assert.equal(res.recommendationChanged, res.state.recommendation.text !== st.recommendation.text || res.state.recommendation.kind !== st.recommendation.kind);
});
