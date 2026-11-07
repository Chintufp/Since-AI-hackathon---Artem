import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EvidenceEnvelope, InvestigationState, Problem } from '../contracts/index.ts';
import { HybridRetriever } from '../retrieval/index.ts';
import { buildSyntheticStore, E, NOW_ISO, ORG, ORG_SCOPE, requesterActor, requesterPrincipal, makeLink, P, known } from '../models/testing/fixtures.ts';
import type { InMemoryStore } from '../models/testing/in-memory-store.ts';
import { TemplateQuestionGenerator } from '../questions/generator-templates.ts';
import { storeDirectory } from './directory.ts';
import { actionIsGrounded, casePhrase, DEFAULT_PHRASES, defaultInvestigationSettings, investigate, RulesAssessor } from './index.ts';

const clock = () => new Date(NOW_ISO);

const envelope = (id: string, text: string): EvidenceEnvelope => ({
  id, orgId: ORG, provider: 'synthetic', connectionId: 'test', sourceId: id, revision: '1', kind: 'message', text,
  author: { id: 'x', displayName: 'X' }, eventTime: { known: true, iso: NOW_ISO }, ingestedAt: NOW_ISO, thread: {}, accessScope: ORG_SCOPE,
  lineage: { importBatchId: 'b', sourceFingerprint: id },
});

/**
 * A rectifier incident whose attempt was labelled with a different component by extraction ("swapped module 2" read as an
 * SFP replacement). The case's own evidence never mentions an SFP.
 */
function rectifierStore(): InMemoryStore {
  const s = buildSyntheticStore({ restricted: false });
  s.put('evidence', envelope('ev:rect:1', 'Rectifier module 2 is warm and its fan is loud. DC voltage swings between 46 and 53 volts.'));
  s.put('evidence', envelope('ev:rect:2', 'Swapped module 2. Voltage is steady now, no resets for 25 minutes.'));
  const c = s.get('case', 'case_power')!;
  s.put('case', { ...c, title: 'Intermittent DC low alarms at a cabinet', evidenceIds: ['ev:rect:1', 'ev:rect:2'], conditions: [] });
  s.put('claim', { ...s.get('claim', 'cl_c2_hyp')!, statement: 'Sounds like module 2 is failing', supporting: [{ evidenceId: 'ev:rect:1' }] });
  s.put('attempt', { ...s.get('attempt', 'at_c2')!, action: 'sfp.replace', evidence: [{ evidenceId: 'ev:rect:2' }] });
  s.put('outcome', { ...s.get('outcome', 'out_c2')!, evidence: [{ evidenceId: 'ev:rect:2' }] });
  s.put('personLink', makeLink({ id: 'lk_rect', personEntityId: P.site.entity, caseId: 'case_power', entityId: E.d4, contribution: 'performed-action', evidence: [{ evidenceId: 'ev:rect:2' }], recency: known('2026-04-02T10:00:00.000Z') }));
  return s;
}

async function run(store: InMemoryStore): Promise<InvestigationState> {
  const settings = defaultInvestigationSettings();
  const problem: Problem = { id: 'p_rect', orgId: ORG, text: 'Asset-D4 is flapping again with DC low alarms after the rectifier work', requester: requesterActor(), observations: [], createdAt: NOW_ISO };
  const generator = new TemplateQuestionGenerator({ store, settings, directory: storeDirectory(store), clock });
  return investigate({ problem, store, principal: requesterPrincipal(), deps: { retriever: new HybridRetriever(store, settings), assessor: new RulesAssessor({ store, settings }), generator, settings, clock } });
}

const SFP = /\bsfp\b|transceiver/i;

test('grounding: an action label the case evidence never mentions is worded neutrally in every sentence', async () => {
  const st = await run(rectifierStore());
  assert.equal(st.candidates[0]?.caseId, 'case_power');
  assert.match(st.recommendation.text, /earlier step/, st.recommendation.text);
  const sentences = [
    st.recommendation.text, st.recommendation.nextStep ?? '', ...st.recommendation.caveats, ...st.hypotheses.map((h) => h.statement),
    ...st.gaps.map((g) => g.description + g.whatAnswerChanges), ...st.people.flatMap((p) => p.reasons.map((r) => r.text)),
  ];
  for (const t of sentences) assert.doesNotMatch(t, SFP, t);
  assert.ok(st.recommendation.text.length > 0);
  // the neutral wording is used instead
  assert.match(sentences.join(' '), /an action/); // the people list names no action
});

test('grounding: the same action label is kept when the evidence mentions it', async () => {
  const s = rectifierStore();
  s.put('evidence', envelope('ev:rect:2', 'Swapped the SFP on the unit. Voltage is steady now, no resets for 25 minutes.'));
  const st = await run(s);
  assert.match([st.recommendation.text, st.recommendation.nextStep ?? '', ...st.recommendation.caveats].join(' '), /SFP/);
});

test('grounding: questions never name an action the evidence does not mention', async () => {
  const s = rectifierStore();
  // no recovery outcome: the corrective attempt becomes a consequential outcome gap, so a question is generated
  s.delete('outcome', 'out_c2');
  const st = await run(s);
  const settings = defaultInvestigationSettings();
  const generator = new TemplateQuestionGenerator({ store: s, settings, directory: storeDirectory(s), clock });
  const asked = await generator.generate(st, 8);
  assert.ok(asked.length > 0, 'an outcome question exists');
  for (const c of asked) for (const t of [c.text, c.rationale, c.consequences.yes, c.consequences.no]) assert.doesNotMatch(t, SFP, t);
});

test('grounding: helper semantics (configured terms, own-name fallback, unreadable evidence keeps the label)', () => {
  const p = DEFAULT_PHRASES;
  assert.equal(actionIsGrounded('sfp.replace', 'swapped module 2', p), false);
  assert.equal(actionIsGrounded('sfp.replace', 'changed the sfp', p), true);
  assert.equal(actionIsGrounded('cable.replace', 'we fixed the cable', p), true);
  assert.equal(actionIsGrounded('cable.replace', 'we fixed the antenna', p), false);
  assert.equal(actionIsGrounded('sfp.replace', undefined, p), true);
  assert.equal(casePhrase('sfp.replace', 'swapped module 2', p).noun, 'the earlier step');
  assert.equal(casePhrase('sfp.replace', 'changed the sfp', p).noun, 'the SFP replacement');
});
