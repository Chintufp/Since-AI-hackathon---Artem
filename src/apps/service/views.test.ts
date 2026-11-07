import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EvidenceEnvelope, InvestigationState, Principal, Problem } from '../../libs/utils/contracts/index.ts';
import { defaultInvestigationSettings, investigate, RulesAssessor } from '../../libs/utils/investigation/index.ts';
import { buildSyntheticStore, CASE_REF, cond, GROUP_SCOPE, NOW_ISO, ORG, ORG_SCOPE, requesterActor, requesterPrincipal, SYMPTOM_TEXT } from '../../libs/utils/models/testing/fixtures.ts';
import { evidenceGate, HybridRetriever } from '../../libs/utils/retrieval/index.ts';
import { resultView, visibleRationale } from './views.ts';

const PRIVATE = GROUP_SCOPE('slack-channel:PRIV');
const envelope = (id: string, accessScope: EvidenceEnvelope['accessScope']): EvidenceEnvelope => ({
  id, orgId: ORG, provider: 'synthetic', connectionId: 'test', sourceId: id, revision: '1', kind: 'message', text: `text of ${id}`,
  author: { id: 'x', displayName: 'X' }, eventTime: { known: true, iso: NOW_ISO }, ingestedAt: NOW_ISO, thread: {}, accessScope,
  lineage: { importBatchId: 'b', sourceFingerprint: id },
});

function mixed() {
  const s = buildSyntheticStore({ distractors: false, restricted: false });
  s.put('case', { ...s.get('case', CASE_REF)!, accessScope: ORG_SCOPE });
  for (const id of ['ev:c1:1', 'ev:c1:2', 'ev:c1:6']) s.put('evidence', envelope(id, ORG_SCOPE));
  for (const id of ['ev:c1:3', 'ev:c1:4', 'ev:c1:5']) s.put('evidence', envelope(id, PRIVATE));
  for (const id of ['cl_c1_hyp', 'cl_c1_adv']) s.put('claim', { ...s.get('claim', id)!, accessScope: PRIVATE });
  return s;
}

const member: Principal = { ...requesterPrincipal(), groups: ['noc', 'slack-channel:PRIV'] };

async function stateFor(principal: Principal): Promise<{ store: ReturnType<typeof mixed>; state: InvestigationState }> {
  const store = mixed();
  const settings = defaultInvestigationSettings();
  const problem: Problem = { id: 'p_view', orgId: ORG, text: `Asset-A1: ${SYMPTOM_TEXT}`, requester: requesterActor(), observations: [cond('unit.age', 'older')], createdAt: NOW_ISO };
  const state = await investigate({ problem, store, principal, deps: { retriever: new HybridRetriever(store, settings), assessor: new RulesAssessor({ store, settings }), settings, clock: () => new Date(NOW_ISO) } });
  return { store, state };
}

test('views: a state built with more access than its viewer is cut down per evidence (sources, timeline, state)', async () => {
  const { store, state } = await stateFor(member);
  assert.ok(state.recommendation.basis.some((b) => b.evidenceId === 'ev:c1:3'));
  // the same state, but the investigation was started by the requester who is not in the private channel
  const asRequester: InvestigationState = { ...state, events: state.events.map((e) => (e.type === 'investigation.started' ? { ...e, data: { ...e.data, principal: requesterPrincipal() } } : e)) };
  const r = resultView(store, asRequester, requesterPrincipal());
  const privateIds = new Set(['ev:c1:3', 'ev:c1:4', 'ev:c1:5']);
  const refs = [
    ...r.state.recommendation.basis, ...r.state.hypotheses.flatMap((h) => h.basis), ...r.people.flatMap((p) => p.reasons.flatMap((x) => x.evidence)),
    ...(r.caseView?.timeline.flatMap((n) => n.evidence) ?? []),
  ];
  assert.deepEqual(refs.filter((x) => privateIds.has(x.evidenceId)), []);
  assert.deepEqual((r.caseView?.sources ?? []).filter((x) => privateIds.has(x.evidenceId)), []);
  // the member keeps everything
  const own = resultView(store, state, member);
  assert.ok(own.state.recommendation.basis.some((b) => b.evidenceId === 'ev:c1:3'));
});

test('views: a question rationale drops cited evidence and hypothesis text the viewer cannot see', async () => {
  const { store, state } = await stateFor(member);
  const q = {
    id: 'q1', orgId: ORG, personEntityId: 'x', decisionId: 'd', status: 'queued', createdAt: NOW_ISO, updatedAt: NOW_ISO,
    candidate: {
      id: 'qc', orgId: ORG, investigationId: state.id, gapId: 'g', kind: 'quick', text: 'Is it?', answerType: 'yes-no-unknown', scope: { entityIds: [], caseId: CASE_REF },
      rationale: 'Hypothesis "Interface stuck in a degraded forwarding state (suspected, not confirmed)" from Asset-A1 applies only if older unit. If it holds, applicable. Evidence: ev:c1:1, ev:c1:3.',
      consequences: { yes: '', no: '' }, generatedBy: { route: 'rules', version: '1' }, dedupKey: 'k', recipientIds: [],
    },
  } as never;
  const outsider = visibleRationale(store, q, evidenceGate(store, requesterPrincipal()));
  assert.doesNotMatch(outsider, /Interface stuck|ev:c1:3/);
  assert.match(outsider, /Evidence: ev:c1:1\.$/);
  const insider = visibleRationale(store, q, evidenceGate(store, member));
  assert.match(insider, /Interface stuck/);
  assert.match(insider, /ev:c1:3/);
});
