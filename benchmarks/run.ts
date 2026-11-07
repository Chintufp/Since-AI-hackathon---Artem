/**
 * Benchmark entry point: node benchmarks/run.ts [check|reference]
 *  check     validate data layout, leakage and the frozen test lock (exit 1 on any violation)
 *  reference score the hand-built reference oracle and the silent system on every family (evaluator sanity)
 * Scoring a real system under test is done by experiments/run.ts through the same evaluator.
 */
import { loadHidden } from './load.ts';
import { checkLeakage, loadFamiliesFile, testFamiliesUntouched } from './splits.ts';
import { knowledgeAccuracy, mergeReports, questionValueAndBurden, recommendationQuality, resolutionAccuracy } from './evaluator.ts';
import type { MetricReport } from './evaluator.ts';
import { perfectQuestionRuns, perfectRecommendations, perfectSystem, silentRecommendations, silentSystem } from './reference-systems.ts';

function check(): number {
  const file = loadFamiliesFile();
  const leak = checkLeakage(file);
  const lock = testFamiliesUntouched();
  console.log(`families: ${file.families.length}  by split: ${JSON.stringify(leak.countsBySplit)}`);
  console.log(`leakage: ${leak.ok ? 'none' : leak.violations.join('; ')}`);
  console.log(`test families untouched since freeze: ${lock.untouched}${lock.untouched ? '' : ` (changed: ${lock.changed.join(',')}; missing: ${lock.missing.join(',')})`}`);
  return leak.ok && lock.untouched ? 0 : 1;
}

function line(name: string, r: MetricReport): void {
  console.log(`  ${name}`);
  for (const [k, m] of Object.entries(r.metrics)) console.log(`    ${k.padEnd(46)} ${m ? `${m.value.toFixed(3)}  (${m.numerator}/${m.denominator})` : 'null (undefined)'}`);
}

function reference(): void {
  // The frozen test split stays closed unless explicitly requested.
  const includeTest = process.argv.includes('--include-test');
  const files = loadFamiliesFile().families.filter((f) => includeTest || f.split !== 'test');
  if (!includeTest) console.log('(test split excluded; pass --include-test to open it)');
  for (const [label, perfect] of [['reference-oracle (built from truth; NOT a measured model)', true], ['silent (no output, never asks)', false]] as const) {
    const reports: MetricReport[] = [];
    for (const f of files) {
      const { people, truth, incoming } = loadHidden(f.id);
      const sys = perfect ? perfectSystem(truth, people) : silentSystem();
      reports.push(knowledgeAccuracy(sys, truth, { people }), resolutionAccuracy(sys, truth));
      reports.push(recommendationQuality(perfect ? perfectRecommendations(incoming.problems) : silentRecommendations(incoming.problems), incoming.problems, () => f.id));
      reports.push(questionValueAndBurden(perfect ? perfectQuestionRuns(incoming.problems, people) : incoming.problems.map((p) => ({ problemId: p.id, questions: [] })), incoming.problems, 0, () => f.id, { unavailable: people.people.filter((x) => !x.available).map((x) => x.id) }));
    }
    console.log(`\n${label}: all ${files.length} families pooled`);
    line('metrics', mergeReports(reports));
  }
}

const cmd = process.argv[2] ?? 'check';
if (cmd === 'check') process.exit(check());
else if (cmd === 'reference') reference();
else {
  console.error('usage: node benchmarks/run.ts [check|reference [--include-test]]');
  process.exit(2);
}
