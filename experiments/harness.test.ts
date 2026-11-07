import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadHidden, loadVisibleInputs } from '../benchmarks/load.ts';
import { testFamiliesUntouched } from '../benchmarks/splits.ts';
import { RulesSelector } from '../src/libs/utils/policies/index.ts';
import { runVariant } from './common.ts';
import type { VariantRun } from './common.ts';
import { benchmarkSourceId, runFamily } from './harness.ts';
import { decideE02, decideE04 } from './runners-core.ts';
import { budgetSim, simArm } from './runners-learning.ts';

test('benchmarkSourceId maps adapter ids to the benchmark form', () => {
  assert.equal(benchmarkSourceId('teams', 'teams:2534577ad676#7'), 'teams:7');
  assert.equal(benchmarkSourceId('email', 'msgid:f01@kalevanet.example'), 'email:f01@kalevanet.example');
  assert.equal(benchmarkSourceId('slack', 'C001BG:1781773800.000100'), 'slack:1781773800.000100');
});

test('the visible inputs given to the system carry no answer key', () => {
  const v = loadVisibleInputs('bgp-firmware-flaps');
  for (const p of v.problems) assert.deepEqual(Object.keys(p).filter((k) => !['id', 'text', 'requester', 'observations'].includes(k)), []);
});

test('runFamily drives the real system and returns evaluator-shaped output with complete traces', async () => {
  const run = await runFamily('bgp-firmware-flaps', { selector: new RulesSelector() });
  const hidden = loadHidden('bgp-firmware-flaps');
  assert.equal(run.problems.length, hidden.incoming.problems.length);
  assert.equal(run.recommendations.length, run.problems.length);
  assert.ok(run.problems.every((p) => p.traceComplete), 'every investigation has a start event and decisions');
  assert.ok(run.knowledge.cases.length > 0 && run.knowledge.claims.length > 0);
  // evidence ids carry truth-style source ids, so every case resolves to at least one truth incident
  for (const c of run.knowledge.cases) assert.ok((run.caseIncidents[c.id] ?? []).length >= 1, `case ${c.title} maps to a truth incident`);
  // a question is never asked of someone the directory marks unavailable (hard rule)
  const unavailable = new Set(hidden.people.people.filter((p) => !p.available).map((p) => p.id));
  for (const p of run.problems) for (const q of p.questions) assert.ok(!unavailable.has(q.recipientId));
});

test('runVariant on validation scores with denominators and never opens the test split', async () => {
  const vr = await runVariant('baseline', 'validation', {});
  assert.equal(vr.result.metrics['recommendation.kindAccuracy']?.denominator, 6);
  assert.equal(vr.result.provenance, 'measured');
  assert.equal(testFamiliesUntouched().untouched, true);
});

type M = { value: number; numerator: number; denominator: number } | null;
const fake = (metrics: Record<string, M>): VariantRun => ({ variantId: 'x', split: 'validation', runs: [], extras: {}, result: {} as never, scored: { metrics, counts: {}, failures: [], failureSlicesByTag: {}, perFamily: {}, latenciesMs: [] } });
const m = (value: number): M => ({ value, numerator: Math.round(value * 10), denominator: 10 });

test('E04 frozen rule: tie keeps separate; combined needs lower false advice at equal or better coverage', () => {
  const tie = decideE04({ separate: fake({ 'recommendation.falseAdviceRate': m(0.2), 'recommendation.eligibleCoverage': m(0.5) }), combined: fake({ 'recommendation.falseAdviceRate': m(0.2), 'recommendation.eligibleCoverage': m(0.5) }) }, 'validation');
  assert.equal(tie.shipped, 'separate');
  const better = decideE04({ separate: fake({ 'recommendation.falseAdviceRate': m(0.3), 'recommendation.eligibleCoverage': m(0.5) }), combined: fake({ 'recommendation.falseAdviceRate': m(0.1), 'recommendation.eligibleCoverage': m(0.5) }) }, 'validation');
  assert.equal(better.shipped, 'combined');
  const tradeoff = decideE04({ separate: fake({ 'recommendation.falseAdviceRate': m(0.3), 'recommendation.eligibleCoverage': m(0.6) }), combined: fake({ 'recommendation.falseAdviceRate': m(0.1), 'recommendation.eligibleCoverage': m(0.2) }) }, 'validation');
  assert.equal(tradeoff.shipped, 'separate');
});

test('E02 frozen rule: hybrid ships only if recall@3 is not lower and lookalike rate is not higher', () => {
  const mk = (r: number, l: number | null) => fake({ '@3.linking.recall': m(r), 'retrieval.lookalikeTop1Rate': l === null ? null : m(l) });
  assert.equal(decideE02({ 'hybrid-rrf': mk(0.8, 0.5), 'lexical-bm25': mk(0.8, 0.5) }, 'validation').shipped, 'hybrid');
  assert.equal(decideE02({ 'hybrid-rrf': mk(0.7, 0.5), 'lexical-bm25': mk(0.8, 0.5) }, 'validation').shipped, 'lexical');
  assert.equal(decideE02({ 'hybrid-rrf': mk(0.9, 0.6), 'lexical-bm25': mk(0.8, 0.5) }, 'validation').shipped, 'lexical');
  assert.equal(decideE02({ 'hybrid-rrf': mk(0.9, null), 'lexical-bm25': mk(0.8, null) }, 'validation').shipped, 'lexical', 'a null rate cannot confirm the condition');
});

test('simulator arm asserts zero ineligible selections for every selector and seed', () => {
  const sim = simArm();
  assert.equal(sim.rows.length, 12);
  assert.ok(sim.rows.every((r) => r.ineligible === 0));
});

test('budget layer: the daily limit is never exceeded', () => {
  for (const seed of [1, 2]) {
    for (const limit of [1, 3]) assert.ok(budgetSim(limit, 30, seed).maxPerPersonPerDay <= limit);
  }
});

test('E00 tolerates only the listed undetectable leak sources, each with a reason', async () => {
  const { KNOWN_UNDETECTABLE_LEAKS } = await import('./runners-core.ts');
  assert.ok(KNOWN_UNDETECTABLE_LEAKS.length >= 1);
  for (const k of KNOWN_UNDETECTABLE_LEAKS) {
    assert.ok(['demo', 'train', 'validation'].includes(k.split));
    assert.match(k.sourceId, /^[a-z]+:.+/);
    assert.ok(k.why.length > 20);
  }
});
