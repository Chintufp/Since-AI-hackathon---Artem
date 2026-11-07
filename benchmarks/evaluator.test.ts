import test from 'node:test';
import assert from 'node:assert/strict';
import type { IncomingProblems, PeopleDirectory, ScenarioTruth } from '../src/libs/utils/contracts/index.ts';
import {
  accessLeakage,
  efficiency,
  incomingLinking,
  knowledgeAccuracy,
  mergeReports,
  questionValueAndBurden,
  ratio,
  recommendationQuality,
  resolutionAccuracy,
  sliceFailuresByTag,
  truthIndependentCount,
} from './evaluator.ts';
import type { SystemKnowledge } from './evaluator.ts';
import { jaccard, normalizeSourceId } from './text.ts';
import { perfectQuestionRuns, perfectRecommendations, perfectSystem, silentRecommendations, silentSystem } from './reference-systems.ts';

const people: PeopleDirectory = {
  people: [
    { id: 'person:directory:ann', name: 'Ann Field', role: 'Field Engineer', groups: ['field'], actorIds: ['person:teams:Ann Field'], available: true },
    { id: 'person:directory:bo', name: 'Bo Expert', role: 'Expert', groups: ['noc'], actorIds: ['person:teams:Bo Expert'], available: true },
    { id: 'person:directory:cy', name: 'Cy Mentioned', role: 'Lead', groups: ['noc'], actorIds: [], available: true },
  ],
};

const truth: ScenarioTruth = {
  familyId: 'fam',
  entities: [{ name: 'N-1', type: 'asset', attributes: {} }],
  incidents: [
    {
      key: 'A', title: 'A', sourceIds: ['teams:1', 'teams:2', 'email:<m1@x>'], realCause: 'x',
      expectedClaims: [
        { type: 'observation', statement: 'The link is up and alarms are cleared', by: 'person:directory:ann' },
        { type: 'advice', statement: 'Reset the interface on both ends', by: 'person:directory:bo' },
        { type: 'outcome', statement: 'Traffic is passing again after the reset', by: 'person:directory:ann' },
      ],
      attempts: [
        { action: 'interface.reset', by: 'person:directory:ann', performed: true },
        { action: 'device.reboot', by: 'person:directory:ann', performed: false },
      ],
      outcome: { result: 'recovered', lasting: 'unknown', reportedBy: 'person:directory:ann' },
      knowledge: { 'person:directory:ann': { knows: ['x'], canObserve: [] }, 'person:directory:cy': { knows: [], canObserve: [] } },
      accessGroups: ['field', 'noc'],
    },
    {
      key: 'B', title: 'B', sourceIds: ['teams:5'], realCause: 'y',
      expectedClaims: [{ type: 'observation', statement: 'Fan alarm is active', by: 'person:directory:bo' }],
      attempts: [], outcome: { result: 'recovered', lasting: 'confirmed', reportedBy: 'person:directory:bo' },
      knowledge: {}, accessGroups: ['private'],
    },
  ],
  copies: [{ sourceId: 'email:<m1@x>', of: 'teams:2' }],
};

const problems: IncomingProblems['problems'] = [
  { id: 'p-gap', text: '', requester: 'person:directory:cy', key: { relatedIncidentKeys: ['A'], applicable: 'inapplicable', consequentialGap: { description: 'd', answerers: ['person:directory:ann'], answer: 'no' }, answers: { 'person:directory:ann': { 'unit.revision=A': 'no' } }, noQuestionNeeded: false, expectedRecommendation: 'none' } },
  { id: 'p-reuse', text: '', requester: 'person:directory:cy', key: { relatedIncidentKeys: ['A'], applicable: 'reuse', answers: {}, noQuestionNeeded: true, expectedRecommendation: 'reuse' } },
  { id: 'p-none', text: '', requester: 'person:directory:cy', key: { relatedIncidentKeys: [], applicable: 'none', answers: {}, noQuestionNeeded: true, expectedRecommendation: 'none' } },
];

const val = (m: { value: number } | null) => m?.value;

test('text helpers: jaccard and source id normalization', () => {
  assert.equal(jaccard('Reset the interface', 'reset interface'), 1);
  assert.equal(jaccard('', 'x'), 0);
  assert.ok(jaccard('link is up', 'fan alarm active') < 0.1);
  assert.equal(normalizeSourceId('email:<a@b>'), normalizeSourceId('EMAIL:a@b'));
});

test('perfect system scores 1.0 (or 0 error rate) on every defined knowledge metric', () => {
  const sys = perfectSystem(truth, people);
  const r = knowledgeAccuracy(sys, truth, { people });
  for (const t of ['observation', 'advice', 'outcome']) {
    assert.equal(val(r.metrics[`claims.${t}.precision`]!), 1, t);
    assert.equal(val(r.metrics[`claims.${t}.recall`]!), 1, t);
  }
  assert.equal(val(r.metrics['claims.all.precision']!), 1);
  assert.equal(val(r.metrics['claims.all.recall']!), 1);
  assert.equal(val(r.metrics['entities.recall']!), 1);
  assert.equal(val(r.metrics['cases.falseMergeRate']!), 0);
  assert.equal(val(r.metrics['cases.falseSplitRate']!), 0);
  assert.equal(val(r.metrics['attribution.claimPersonErrorRate']!), 0);
  assert.equal(val(r.metrics['attribution.attemptPerformedStateErrorRate']!), 0);
  assert.equal(val(r.metrics['attribution.attemptPerformerErrorRate']!), 0);
  assert.equal(val(r.metrics['attribution.outcomeReporterErrorRate']!), 0);
  assert.equal(val(r.metrics['attribution.firsthandLinkErrorRate']!), 0);
  assert.equal(val(r.metrics['copies.overcountRate']!), 0);
  assert.equal(r.failures.length, 0);
  const res = resolutionAccuracy(sys, truth);
  assert.equal(val(res.metrics['resolution.statusAccuracy']!), 1);
  assert.equal(val(res.metrics['resolution.falseSolvedRate']!), 0);
});

test('unrelated and invented claims lower precision; missed claims lower recall; near misses are ambiguous', () => {
  const sys = perfectSystem(truth, people);
  sys.claims = sys.claims.filter((c) => c.type !== 'outcome'); // miss the outcome
  const base = sys.claims[0]!;
  sys.claims.push({ ...base, id: 'bogus', statement: 'Customer called the helpdesk about billing', type: 'observation' });
  sys.claims.push({ ...base, id: 'near', statement: 'link up reported by customers', type: 'observation' });
  const r = knowledgeAccuracy(sys, truth, { people });
  assert.equal(r.metrics['claims.observation.precision']?.denominator, 3, 'ambiguous excluded from denominator: 2 matched + 1 false');
  assert.ok(val(r.metrics['claims.observation.precision']!)! < 1);
  assert.equal(val(r.metrics['claims.outcome.recall']!), 0);
  assert.equal(r.metrics['claims.outcome.precision'], null, 'no outcome claims issued -> precision undefined, not 1');
  assert.ok(r.failures.some((f) => f.id === 'bogus'));
  assert.ok((r.counts['claims.all.ambiguous'] ?? 0) >= 1);
});

test('type confusion does not count as a match', () => {
  const sys = perfectSystem(truth, people);
  sys.claims = sys.claims.map((c) => (c.type === 'advice' ? { ...c, type: 'action' as const } : c));
  const r = knowledgeAccuracy(sys, truth, { people });
  assert.equal(val(r.metrics['claims.advice.recall']!), 0);
  assert.equal((r.counts['claims.action.ambiguous'] ?? 0) >= 1, true);
});

test('false merge, false split and missing incidents', () => {
  const merged = perfectSystem(truth, people);
  merged.cases = [{ ...merged.cases[0]!, evidenceIds: [...merged.cases[0]!.evidenceIds, 'ev:teams:5'] }];
  merged.evidenceSourceIds['ev:teams:5'] = 'teams:5';
  const m = knowledgeAccuracy(merged, truth, { people });
  assert.equal(val(m.metrics['cases.falseMergeRate']!), 1);
  assert.equal(m.counts['cases.missingIncidents'], 0);

  const split = perfectSystem(truth, people);
  const a = split.cases[0]!;
  split.cases = [{ ...a, id: 'c1', evidenceIds: ['ev:teams:1'] }, { ...a, id: 'c2', evidenceIds: ['ev:teams:2'] }, split.cases[1]!];
  const s = knowledgeAccuracy(split, truth, { people });
  assert.deepEqual([s.metrics['cases.falseSplitRate']?.numerator, s.metrics['cases.falseSplitRate']?.denominator], [1, 2]);

  const none = knowledgeAccuracy(silentSystem(), truth, { people });
  assert.equal(none.metrics['cases.falseMergeRate'], null);
  assert.equal(none.metrics['cases.falseSplitRate'], null);
  assert.equal(none.counts['cases.missingIncidents'], 2);
  assert.equal(val(none.metrics['claims.all.recall']!), 0);
  assert.equal(none.metrics['claims.all.precision'], null);
});

test('attribution errors: wrong person, performed state, outcome reporter, firsthand link', () => {
  const sys = perfectSystem(truth, people);
  const bo = { id: 'person:teams:Bo Expert', displayName: 'Bo Expert' };
  sys.claims = sys.claims.map((c) => (c.type === 'observation' && c.caseId === 'case:A' ? { ...c, assertedBy: bo } : c));
  sys.attempts = sys.attempts!.map((a) => (a.action === 'device.reboot' ? { ...a, performed: 'reported' as const } : a));
  sys.outcomes = sys.outcomes!.map((o) => (o.caseId === 'case:A' ? { ...o, reportedBy: bo } : o));
  sys.links = sys.links.map((l) => (l.personEntityId === 'ent:person:directory:cy' ? { ...l, firsthand: true } : l));
  const r = knowledgeAccuracy(sys, truth, { people });
  assert.equal(r.metrics['attribution.claimPersonErrorRate']?.numerator, 1);
  assert.equal(r.metrics['attribution.attemptPerformedStateErrorRate']?.numerator, 1);
  assert.equal(r.metrics['attribution.outcomeReporterErrorRate']?.numerator, 1);
  assert.equal(r.metrics['attribution.firsthandLinkErrorRate']?.numerator, 1);
  assert.ok(r.failures.some((f) => f.metric === 'attribution.firsthandLink'));
});

test('copies: counting a retelling as independent confirmation is flagged', () => {
  const sys = perfectSystem(truth, people);
  const c = sys.claims.find((x) => x.type === 'advice')!;
  c.supporting = [{ evidenceId: 'ev:teams:2' }, { evidenceId: 'ev:email:<m1@x>' }];
  delete sys.independentSupport![c.id];
  const lenient = knowledgeAccuracy(sys, truth, { people });
  assert.equal(lenient.metrics['copies.overcountRate']?.numerator, 1, 'two raw supporting refs, one independent root');
  sys.independentSupport![c.id] = 1;
  const honest = knowledgeAccuracy(sys, truth, { people });
  assert.equal(val(honest.metrics['copies.overcountRate']!), 0);
  // no claims touch a copy -> undefined
  const none = knowledgeAccuracy({ ...perfectSystem(truth, people), claims: [] }, truth, { people });
  assert.equal(none.metrics['copies.overcountRate'], null);
});

test('resolution: verified-resolved when truth lasting is unknown is a false solved claim', () => {
  const sys = perfectSystem(truth, people);
  sys.cases[0] = { ...sys.cases[0]!, status: 'verified-resolved' };
  sys.outcomes = sys.outcomes!.map((o) => (o.caseId === 'case:A' ? { ...o, lasting: 'confirmed' as const } : o));
  const r = resolutionAccuracy(sys, truth);
  assert.deepEqual([r.metrics['resolution.falseSolvedRate']?.numerator, r.metrics['resolution.falseSolvedRate']?.denominator], [1, 1]);
  assert.equal(val(r.metrics['resolution.statusAccuracy']!), 0.5);
  assert.equal(r.confusion['reported-recovered|verified-resolved'], 1);
  assert.equal(val(r.metrics['resolution.falseConfirmedOutcomeRate']!), 1);
  assert.equal(resolutionAccuracy(silentSystem(), truth).metrics['resolution.falseSolvedRate'], null);
});

test('recommendation quality: perfect, silent, and false advice', () => {
  const perfect = recommendationQuality(perfectRecommendations(problems), problems);
  assert.equal(val(perfect.metrics['recommendation.kindAccuracy']!), 1);
  assert.equal(val(perfect.metrics['recommendation.falseAdviceRate']!), 0);
  assert.equal(val(perfect.metrics['recommendation.missedOpportunityRate']!), 0);

  const silent = recommendationQuality(silentRecommendations(problems), problems);
  assert.equal(silent.metrics['recommendation.falseAdviceRate'], null, 'nothing issued -> undefined');
  assert.equal(val(silent.metrics['recommendation.missedOpportunityRate']!), 1);
  assert.equal(val(silent.metrics['recommendation.eligibleCoverage']!), 0);

  const eager = recommendationQuality(problems.map((p) => ({ problemId: p.id, kind: 'reuse' as const })), problems);
  assert.deepEqual([eager.metrics['recommendation.falseAdviceRate']?.numerator, eager.metrics['recommendation.falseAdviceRate']?.denominator], [2, 3]);
  assert.ok(eager.failures.some((f) => f.id === 'p-gap' && f.metric === 'recommendation.falseAdviceRate'));
  assert.equal(eager.metrics['recommendation.supportedApplicableRate']?.numerator, 1);

  const missing = recommendationQuality([], problems);
  assert.equal(missing.metrics['recommendation.kindAccuracy'], null);
  assert.equal(missing.counts['recommendation.problemsWithoutOutput'], 3);
});

test('question value and burden: gap found, unnecessary, wrong recipient, unanswered', () => {
  const perfect = questionValueAndBurden(perfectQuestionRuns(problems), problems, 0);
  assert.equal(val(perfect.metrics['question.gapFoundRate']!), 1);
  assert.equal(val(perfect.metrics['question.unnecessaryQuestionRate']!), 0);
  assert.equal(val(perfect.metrics['question.wrongRecipientRate']!), 0);
  assert.equal(val(perfect.metrics['question.unansweredRate']!), 0);
  assert.equal(perfect.counts['question.hardRuleViolations'], 0);

  const silent = questionValueAndBurden(problems.map((p) => ({ problemId: p.id, questions: [] })), problems, 0);
  assert.equal(val(silent.metrics['question.gapFoundRate']!), 0, 'constant silence misses the gap');
  assert.equal(val(silent.metrics['question.unnecessaryQuestionRate']!), 0);
  assert.equal(silent.metrics['question.wrongRecipientRate'], null);
  assert.equal(silent.metrics['question.unansweredRate'], null);
  assert.equal(silent.counts['question.missedConsequentialGaps'], 1);

  const chatty = questionValueAndBurden(
    [
      { problemId: 'p-gap', questions: [{ conditionKey: 'unit.revision', recipientId: 'person:directory:cy', answered: false }, { conditionKey: 'unit.revision', recipientId: 'person:directory:ann', answered: true }] },
      { problemId: 'p-reuse', questions: [{ conditionKey: 'x.y', recipientId: 'person:directory:cy', answered: true }] },
    ],
    problems,
    2,
  );
  assert.equal(val(chatty.metrics['question.gapFoundRate']!), 1);
  assert.equal(val(chatty.metrics['question.wrongRecipientRate']!), 0.5);
  assert.deepEqual([chatty.metrics['question.unnecessaryQuestionRate']?.numerator, chatty.metrics['question.unnecessaryQuestionRate']?.denominator], [1, 1], 'p-none had no run so it is not evaluated');
  assert.equal(chatty.counts['question.hardRuleViolations'], 2);
  assert.equal(chatty.counts['question.maxInterruptionsPerPerson'], 2);
  assert.ok(chatty.metrics['question.unansweredRate']!.value > 0);
});

test('incoming linking and access leakage', () => {
  const sys = perfectSystem(truth, people);
  const good = incomingLinking([{ problemId: 'p-gap', linkedCaseIds: ['case:A'] }, { problemId: 'p-reuse', linkedCaseIds: ['case:A'] }], sys, truth, problems);
  assert.equal(val(good.metrics['linking.recall']!), 1);
  assert.equal(val(good.metrics['linking.precision']!), 1);
  const bad = incomingLinking([{ problemId: 'p-gap', linkedCaseIds: ['case:B'] }], sys, truth, problems);
  assert.equal(val(bad.metrics['linking.recall']!), 0);
  assert.equal(val(bad.metrics['linking.precision']!), 0);

  const leak = accessLeakage([{ problemId: 'p-gap', requesterId: 'person:directory:cy', sourceIds: ['teams:1', 'teams:5'] }], truth, people);
  assert.deepEqual([leak.metrics['access.leakageRate']?.numerator, leak.metrics['access.leakageRate']?.denominator], [1, 2]);
  assert.equal(accessLeakage([], truth, people).metrics['access.leakageRate'], null);
});

test('efficiency reports unmeasured values as null, never zero', () => {
  const e = efficiency({ latenciesMs: [10, 20, 30, 40, 100] });
  assert.equal(e.counts['efficiency.p50LatencyMs'], 30);
  assert.equal(e.counts['efficiency.p95LatencyMs'], 100);
  assert.equal(e.counts['efficiency.tokens'], null);
  assert.equal(e.metrics['efficiency.meanLatencyMs']?.value, 40);
  const none = efficiency({ latenciesMs: [] });
  assert.equal(none.metrics['efficiency.meanLatencyMs'], null);
  assert.equal(none.counts['efficiency.p50LatencyMs'], null);
});

test('ratio, merge and failure slices', () => {
  assert.equal(ratio(1, 0), null);
  assert.deepEqual(ratio(1, 4), { value: 0.25, numerator: 1, denominator: 4 });
  const a = recommendationQuality(perfectRecommendations(problems), problems);
  const b = recommendationQuality(silentRecommendations(problems), problems);
  const merged = mergeReports([a, b]);
  assert.equal(merged.metrics['recommendation.kindAccuracy']?.denominator, 6);
  const slices = sliceFailuresByTag(
    [{ id: 'x', familyId: 'f1', metric: 'm', reason: 'r' }, { id: 'y', familyId: 'zzz', metric: 'm', reason: 'r' }],
    [{ id: 'f1', split: 'train', dir: 'f1', description: '', tags: ['useful-no', 'multi-step'] }],
  );
  assert.equal(slices['useful-no']?.count, 1);
  assert.equal(slices['multi-step']?.count, 1);
  assert.equal(slices['untagged']?.count, 1);
});

test('qualified advice on an inapplicable problem is false advice; majority baseline is reported', () => {
  const q = recommendationQuality([{ problemId: 'p-gap', kind: 'qualified' }, { problemId: 'p-reuse', kind: 'reuse' }, { problemId: 'p-none', kind: 'none' }], problems);
  assert.equal(q.metrics['recommendation.falseAdviceRate']?.numerator, 1);
  assert.ok(q.failures.some((f) => f.id === 'p-gap' && f.metric === 'recommendation.falseAdviceRate'));
  const base = q.metrics['recommendation.majorityBaselineKindAccuracy']!;
  assert.deepEqual([base.numerator, base.denominator], [2, 3], 'two of three expected labels are "none"/"reuse"... majority class size 2 (none)');
});

test('unavailable answerers: asking no one is correct, asking them is a hard-rule violation', () => {
  const unavailable = ['person:directory:ann'];
  const silent = questionValueAndBurden(problems.map((p) => ({ problemId: p.id, questions: [] })), problems, 0, undefined, { unavailable });
  assert.equal(silent.metrics['question.gapFoundRate'], null, 'the only gap is unreachable so it leaves the denominator');
  assert.equal(silent.counts['question.gapsNobodyAvailableCanAnswer'], 1);
  const asked = questionValueAndBurden([{ problemId: 'p-gap', questions: [{ conditionKey: 'unit.revision', recipientId: 'person:directory:ann', answered: false }] }], problems, 1, undefined, { unavailable });
  assert.equal(asked.counts['question.askedUnavailable'], 1);
  assert.equal(asked.counts['question.hardRuleViolations'], 2);
  const flagged = questionValueAndBurden(problems.map((p) => ({ problemId: p.id, questions: [] })), [{ ...problems[0]!, key: { ...problems[0]!.key, consequentialGap: { ...problems[0]!.key.consequentialGap!, unanswerable: true } } }], 0);
  assert.equal(flagged.metrics['question.gapFoundRate'], null);
  const ref = perfectQuestionRuns(problems, { people: people.people.map((p) => (p.id === 'person:directory:ann' ? { ...p, available: false } : p)) });
  assert.deepEqual(ref.find((r) => r.problemId === 'p-gap')!.questions, []);
});

test('multi-parent copies: a retelling of two originals adds no independent source to either', () => {
  const t: ScenarioTruth = { ...truth, copies: [{ sourceId: 'email:<m1@x>', of: 'teams:1' }, { sourceId: 'email:<m1@x>', of: 'teams:2' }] };
  assert.equal(truthIndependentCount(['teams:1', 'email:<m1@x>'], t), 1);
  assert.equal(truthIndependentCount(['teams:2', 'email:<m1@x>'], t), 1);
  assert.equal(truthIndependentCount(['teams:1', 'teams:2', 'email:<m1@x>'], t), 2);
  assert.equal(truthIndependentCount(['email:<m1@x>'], t), 1, 'a lone copy still counts once');
});

test('canonical-action systems are matched against finer truth actions; unmatched attempts are a metric', () => {
  const t: ScenarioTruth = { ...truth, incidents: [{ ...truth.incidents[0]!, attempts: [{ action: 'component.replace.rectifier', by: 'person:directory:bo', performed: true }] }, truth.incidents[1]!] };
  const base = perfectSystem(t, people);
  const mk = (action: string): SystemKnowledge => ({ ...base, attempts: [{ id: 'a1', orgId: 'o', caseId: 'case:A', action, performedBy: { id: 'person:teams:Ann Field', displayName: 'Ann Field' }, performed: 'reported', when: { known: false }, evidence: [{ evidenceId: 'ev:teams:1' }] }] });
  const ok = knowledgeAccuracy(mk('other'), t, { people });
  assert.equal(ok.counts['attribution.attemptsNotInTruth'], 0);
  assert.equal(ok.metrics['attribution.attemptPerformerErrorRate']?.numerator, 1, 'matched, and the performer is wrong (Ann, truth Bo)');
  const bad = knowledgeAccuracy(mk('sfp.replace'), t, { people });
  assert.equal(bad.counts['attribution.attemptsNotInTruth'], 1);
  assert.equal(bad.metrics['attribution.attemptsNotInTruthRate']?.value, 1);
  assert.ok(bad.failures.some((f) => f.metric === 'attribution.attemptsNotInTruth'));
});
