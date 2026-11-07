/**
 * Experiment runner skeleton. Usage:
 *   node experiments/run.ts            list experiments and status
 *   node experiments/run.ts e00        run E00 (frozen scenarios + evaluator sanity references)
 *
 * Experiments use the same core contracts as the application. They may read hidden keys through the
 * benchmark harness; the system under test never does. E01-E10 are placeholders until the harness
 * wiring lands (see README.md): each one needs its manifest written BEFORE scoring.
 */
import { loadHidden } from '../benchmarks/load.ts';
import { checkLeakage, loadFamiliesFile, loadFamilies, testFamiliesUntouched } from '../benchmarks/splits.ts';
import { knowledgeAccuracy, mergeReports, questionValueAndBurden, recommendationQuality, resolutionAccuracy, sliceFailuresByTag } from '../benchmarks/evaluator.ts';
import type { MetricReport } from '../benchmarks/evaluator.ts';
import { writeManifest, writeResults } from '../benchmarks/manifest.ts';
import type { RunManifest, VariantResult } from '../benchmarks/manifest.ts';
import { perfectQuestionRuns, perfectRecommendations, perfectSystem, silentRecommendations, silentSystem } from '../benchmarks/reference-systems.ts';

export type ExperimentStatus = 'ready' | 'pending harness' | 'conditional';

export interface ExperimentEntry {
  id: string;
  title: string;
  status: ExperimentStatus;
  /** What blocks it, in one line. */
  needs: string;
}

export const EXPERIMENTS: ExperimentEntry[] = [
  { id: 'E00', title: 'Frozen scenarios, evaluator and transparent end-to-end baseline', status: 'ready', needs: 'Evaluator, oracle, splits and reference systems are runnable; the end-to-end baseline arm plugs in via the harness.' },
  { id: 'E01', title: 'Extraction/linking: exact identifiers + structured baseline vs context-aware proposals', status: 'pending harness', needs: 'Ingest + memory modules wired to produce SystemKnowledge; any LLM arm waits for an authorized route (replay fixtures are labeled).' },
  { id: 'E02', title: 'Retrieval: lexical baseline vs embeddings/hybrid on identical cases and filters', status: 'pending harness', needs: 'Retrieval module and a permitted local embedding model or index.' },
  { id: 'E03', title: 'Question selection: rules vs ranker vs contextual bandit on identical pools and gates', status: 'pending harness', needs: 'Candidate generator, eligibility gates and the oracle-driven simulator loop.' },
  { id: 'E04', title: 'Assessment: combined vs separate support/applicability assessors', status: 'pending harness', needs: 'Assessor interfaces over the same evidence and candidate set.' },
  { id: 'E05', title: 'Question generation: templates vs freer structured proposals', status: 'pending harness', needs: 'Generator route (rules/local/replay) and E03 held fixed.' },
  { id: 'E06', title: 'Recipient ranking: direct contributors vs observable-condition eligibility', status: 'pending harness', needs: 'Recipient ranker and the eligibility rules.' },
  { id: 'E07', title: 'Coordinator settings: budgets, cooldowns, stopping, deferred responses', status: 'pending harness', needs: 'Coordinator service and the multi-question simulator.' },
  { id: 'E08', title: 'Prompted LLM vs adapted small transformer outcome assessor', status: 'conditional', needs: 'Reviewed labels, an available model runtime and a bounded training allocation.' },
  { id: 'E09', title: 'Next-choice policy vs sequential RL on multi-step scenarios', status: 'conditional', needs: 'A tested multi-step simulator and a documented next-choice baseline (U01 stays open).' },
  { id: 'E10', title: 'Optional evaluative preferences and alternate reward/feature designs', status: 'conditional', needs: 'Separate preference records; never mixed with factual evidence.' },
];

function list(): void {
  console.log('Experiment queue (status as of this file):');
  for (const e of EXPERIMENTS) console.log(`  ${e.id.padEnd(4)} ${e.status.padEnd(15)} ${e.title}\n       needs: ${e.needs}`);
  console.log('\nResults convention: experiments/results/<run-id>/{manifest.json,results.json}. Manifest first, then scoring.');
}

/** E00: validates the data, then scores two reference variants. Test split stays closed. */
function runE00(): void {
  const file = loadFamiliesFile();
  const leak = checkLeakage(file);
  if (!leak.ok) throw new Error(`leakage: ${leak.violations.join('; ')}`);
  const lock = testFamiliesUntouched();
  if (!lock.untouched) throw new Error(`test families changed since freeze: ${lock.changed.join(',')}`);

  const splits = ['demo', 'train', 'validation'] as const;
  const manifest: RunManifest = {
    id: 'e00-reference',
    hypothesis: 'The evaluator scores a system built from hidden truth at 1.0 (0.0 error) wherever a score is defined, and exposes constant silence as missed gaps/opportunities.',
    datasetVersion: file.version,
    splits: [...splits],
    visibleInputs: ['sources/', 'people.json', 'incoming problem text', 'incoming observations'],
    variants: [
      { id: 'reference-oracle', description: 'Reconstructed from truth.json. A sanity reference, not a system under test.', route: 'rules' },
      { id: 'silent', description: 'Emits nothing and never asks.', route: 'rules' },
    ],
    config: { claimMatch: 'same ClaimType and token Jaccard >= 0.5', ambiguousBand: [0.3, 0.5] },
    seeds: [0],
    route: 'rules',
    resourceCap: { maxWallSeconds: 60, networkCalls: 0 },
    metrics: ['claims.all.precision', 'claims.all.recall', 'cases.falseMergeRate', 'cases.falseSplitRate', 'resolution.falseSolvedRate', 'recommendation.falseAdviceRate', 'recommendation.missedOpportunityRate', 'question.gapFoundRate', 'question.unnecessaryQuestionRate'],
    acceptanceCriteria: ['reference-oracle: every defined metric at its perfect value'],
    stopRule: 'Single deterministic pass.',
    startedAt: new Date().toISOString(),
  };
  writeManifest(manifest);

  const variants: VariantResult[] = [];
  for (const split of splits) {
    const fams = loadFamilies(split);
    for (const perfect of [true, false]) {
      const reports: MetricReport[] = [];
      for (const f of fams) {
        const { people, truth, incoming } = loadHidden(f.id);
        const sys = perfect ? perfectSystem(truth, people) : silentSystem();
        reports.push(knowledgeAccuracy(sys, truth, { people }), resolutionAccuracy(sys, truth));
        reports.push(recommendationQuality(perfect ? perfectRecommendations(incoming.problems) : silentRecommendations(incoming.problems), incoming.problems, () => f.id));
        reports.push(questionValueAndBurden(perfect ? perfectQuestionRuns(incoming.problems, people) : incoming.problems.map((p) => ({ problemId: p.id, questions: [] })), incoming.problems, 0, () => f.id, { unavailable: people.people.filter((x) => !x.available).map((x) => x.id) }));
      }
      const merged = mergeReports(reports);
      variants.push({
        variantId: perfect ? 'reference-oracle' : 'silent',
        provenance: 'reference-oracle',
        split,
        metrics: merged.metrics,
        counts: merged.counts,
        failures: merged.failures,
        failureSlicesByTag: sliceFailuresByTag(merged.failures, fams),
      });
    }
  }
  const path = writeResults({
    manifestId: manifest.id,
    finishedAt: new Date().toISOString(),
    variants,
    notes: [
      'Reference variants are built from hidden truth to validate the evaluator; they say nothing about any model.',
      'Test split was not opened. It is frozen by hash in data/scenarios/TEST_LOCK.json.',
      'Answer keys are unreviewed: results stay provisional until the reviewer signs off (see data/scenarios/REVIEW.md).',
    ],
  });
  console.log(`E00 written: ${path}`);
}

const cmd = process.argv[2];
if (!process.argv[1]?.endsWith('run.ts')) {
  // imported as a module: expose EXPERIMENTS only
} else if (!cmd || cmd === 'list') list();
else if (cmd.toLowerCase() === 'e00') runE00();
else {
  const e = EXPERIMENTS.find((x) => x.id.toLowerCase() === cmd.toLowerCase());
  console.error(e ? `${e.id} is '${e.status}': ${e.needs}` : `unknown experiment ${cmd}`);
  process.exit(2);
}
