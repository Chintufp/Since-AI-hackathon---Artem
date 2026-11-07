import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EvidenceEnvelope, EvidenceRef, InvestigationState, Principal, Problem } from '../contracts/index.ts';
import { HybridRetriever } from '../retrieval/index.ts';
import { canSee } from '../retrieval/access.ts';
import {
  buildSyntheticStore, CASE_REF, GROUP_SCOPE, NOW_ISO, ORG, ORG_SCOPE, P, requesterActor, requesterPrincipal, SYMPTOM_TEXT, cond,
} from '../models/testing/fixtures.ts';
import type { InMemoryStore } from '../models/testing/in-memory-store.ts';
import { defaultInvestigationSettings, investigate, RulesAssessor } from './index.ts';
import { loadCaseFacts } from './case-facts.ts';

const clock = () => new Date(NOW_ISO);
const PRIVATE = GROUP_SCOPE('slack-channel:PRIV');

const envelope = (id: string, accessScope: EvidenceEnvelope['accessScope']): EvidenceEnvelope => ({
  id, orgId: ORG, provider: 'synthetic', connectionId: 'test', sourceId: id, revision: '1', kind: 'message', text: `text of ${id}`,
  author: { id: 'x', displayName: 'X' }, eventTime: { known: true, iso: NOW_ISO }, ingestedAt: NOW_ISO, thread: {}, accessScope,
  lineage: { importBatchId: 'b', sourceFingerprint: id },
});

/**
 * One merged case (org-visible as a whole) whose symptom/age evidence is org-visible and whose cause, advice, attempts
 * and outcome evidence comes from a private channel: the shape produced when one asset id merges two incidents.
 */
function mixedStore(): InMemoryStore {
  const s = buildSyntheticStore({ distractors: false, restricted: false });
  const c = s.get('case', CASE_REF)!;
  s.put('case', { ...c, accessScope: ORG_SCOPE });
  for (const id of ['ev:c1:1', 'ev:c1:2', 'ev:c1:6']) s.put('evidence', envelope(id, ORG_SCOPE));
  for (const id of ['ev:c1:3', 'ev:c1:4', 'ev:c1:5']) s.put('evidence', envelope(id, PRIVATE));
  for (const id of ['cl_c1_hyp', 'cl_c1_adv']) s.put('claim', { ...s.get('claim', id)!, accessScope: PRIVATE });
  return s;
}

const problem = (id: string): Problem => ({ id, orgId: ORG, text: `Asset-A1: ${SYMPTOM_TEXT}`, requester: requesterActor(), observations: [cond('unit.age', 'older', 'Older unit')], createdAt: NOW_ISO });

async function run(store: InMemoryStore, principal: Principal, id = 'p_leak'): Promise<InvestigationState> {
  const settings = defaultInvestigationSettings();
  return investigate({
    problem: problem(id), store, principal,
    deps: { retriever: new HybridRetriever(store, settings), assessor: new RulesAssessor({ store, settings }), settings, clock },
  });
}

/** Every evidence reference anywhere in the persisted state. */
function allRefs(st: InvestigationState): EvidenceRef[] {
  return [
    ...st.recommendation.basis,
    ...st.hypotheses.flatMap((h) => h.basis),
    ...st.candidates.flatMap((c) => [...c.matchingConditions, ...c.conflictingConditions].flatMap((x) => x.evidence)),
    ...st.candidates.flatMap((c) => c.expectedTraits.flatMap((t) => t.basis)),
    ...st.people.flatMap((p) => p.reasons.flatMap((r) => r.evidence)),
  ];
}

const visibleTo = (store: InMemoryStore, p: Principal) => (r: EvidenceRef): boolean => {
  const e = store.get('evidence', r.evidenceId);
  return !e || canSee(e.accessScope, p);
};

test('access leak: a merged case with private evidence shows the requester no private evidence anywhere in the state', async () => {
  const store = mixedStore();
  const st = await run(store, requesterPrincipal());
  const leaked = allRefs(st).filter((r) => !visibleTo(store, requesterPrincipal())(r));
  assert.deepEqual(leaked, []);
  // the private cause/advice/attempts/outcome contribute nothing: no hypothesis, no corrective recommendation, no person reason
  assert.equal(st.hypotheses.length, 0);
  assert.ok(['none', 'retain-uncertainty'].includes(st.recommendation.kind), st.recommendation.kind);
  assert.doesNotMatch(JSON.stringify(st.recommendation), /interface|reset|re-enable/i);
  for (const p of st.people) for (const r of p.reasons) {
    assert.ok(r.evidence.every(visibleTo(store, requesterPrincipal())), `${p.displayName}: ${r.text}`);
    assert.doesNotMatch(r.text, /Advised|Performed|outcome/i, `${p.displayName}: ${r.text}`);
  }
});

test('access leak: a member of the private group still sees the full case (own scope is not over-filtered)', async () => {
  const store = mixedStore();
  const member: Principal = { ...requesterPrincipal(), groups: ['noc', 'slack-channel:PRIV'] };
  const st = await run(store, member, 'p_member');
  assert.ok(st.hypotheses.length > 0);
  assert.equal(st.recommendation.kind, 'check-first');
  assert.ok(st.recommendation.basis.some((r) => r.evidenceId === 'ev:c1:3'));
  assert.ok(st.people.some((p) => p.personEntityId === P.exp.entity));
});

test('access leak: loadCaseFacts with a gate drops claims, attempts and outcomes whose evidence is entirely invisible', () => {
  const store = mixedStore();
  const settings = defaultInvestigationSettings();
  const plain = loadCaseFacts(store, CASE_REF, undefined, settings);
  assert.ok(plain.attempts.length > 0);
  const gated = loadCaseFacts(store, CASE_REF, undefined, settings, requesterPrincipal());
  assert.equal(gated.attempts.length, 0);
  assert.equal(gated.outcomes.length, 0);
  assert.equal(gated.hypothesisClaims.length, 0);
  assert.equal(gated.adviceClaims.length, 0);
  assert.ok(gated.case);
});

test('access leak: a case whose evidence is entirely invisible is not a candidate; condition labels from hidden evidence do not leak', async () => {
  const store = mixedStore();
  for (const id of ['ev:c1:1', 'ev:c1:2', 'ev:c1:6']) store.put('evidence', envelope(id, PRIVATE));
  const st = await run(store, requesterPrincipal(), 'p_none');
  assert.ok(!st.candidates.some((c) => c.caseId === CASE_REF));
  assert.equal(st.hypotheses.length, 0);
  assert.equal(st.people.length, 0);
});

test('access leak: a partially visible condition keeps only visible references', async () => {
  const store = mixedStore();
  const c = store.get('case', CASE_REF)!;
  store.put('case', { ...c, conditions: c.conditions.map((x) => (x.key === 'traffic.counters' ? { ...x, evidence: [{ evidenceId: 'ev:c1:1' }, { evidenceId: 'ev:c1:5' }] } : x)) });
  const st = await run(store, requesterPrincipal(), 'p_part');
  const refs = st.candidates.flatMap((x) => x.matchingConditions.flatMap((m) => m.evidence));
  assert.ok(refs.length > 0);
  assert.ok(refs.every((r) => r.evidenceId !== 'ev:c1:5'));
});
