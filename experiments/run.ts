/**
 * Experiment runner. Usage:
 *   node experiments/run.ts                list experiments and status
 *   node experiments/run.ts e00            E00: real-system rules baseline on demo+train+validation (results/e00-baseline)
 *   node experiments/run.ts e00-reference  evaluator sanity references (results/e00-reference)
 *   node experiments/run.ts e01            E01: rules extractor vs recorded Claude-agent arm (results/e01-extraction)
 *   node experiments/run.ts e02|e03|e04|e05|e06|e07|usefulness
 *   node experiments/run.ts all [--continue-despite-e00]   E00,E01,E02,E04,E03,E05,E06,E07 (+ usefulness, report) in order; stops if E00 fails (override is recorded); test split stays closed
 *   node experiments/run.ts test-final     one-shot test-split confirmation of the E02/E04 choices (refuses to run twice)
 *   node experiments/run.ts report         regenerate experiments/RESULTS.md from experiments/results/
 *
 * Experiments use the same core contracts as the application. They may read hidden keys through the
 * benchmark harness; the system under test never does. Each run writes its manifest BEFORE scoring.
 * No model or network call is made: every route is 'rules', 'local' or 'replay' (a network guard is installed).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { loadHidden } from '../benchmarks/load.ts';
import { checkLeakage, loadFamiliesFile, loadFamilies, testFamiliesUntouched } from '../benchmarks/splits.ts';
import { knowledgeAccuracy, mergeReports, questionValueAndBurden, recommendationQuality, resolutionAccuracy, sliceFailuresByTag } from '../benchmarks/evaluator.ts';
import type { MetricReport } from '../benchmarks/evaluator.ts';
import { writeManifest, writeResults } from '../benchmarks/manifest.ts';
import type { RunManifest, VariantResult } from '../benchmarks/manifest.ts';
import { installNetworkGuard } from '../src/libs/utils/models/routes.ts';
import { perfectQuestionRuns, perfectRecommendations, perfectSystem, silentRecommendations, silentSystem } from '../benchmarks/reference-systems.ts';

const RUNTIMES = join(dirname(new URL(import.meta.url).pathname), 'results', 'run-times.json');

export type ExperimentStatus = 'ready' | 'pending harness' | 'conditional';

export interface ExperimentEntry {
  id: string;
  title: string;
  status: ExperimentStatus;
  /** What blocks it, in one line. */
  needs: string;
}

export const EXPERIMENTS: ExperimentEntry[] = [
  { id: 'E00', title: 'Frozen scenarios, evaluator and transparent end-to-end baseline', status: 'ready', needs: 'Done: node experiments/run.ts e00 (results/e00-baseline); evaluator sanity references via e00-reference.' },
  { id: 'E01', title: 'Extraction/linking: exact identifiers + structured baseline vs context-aware proposals', status: 'ready', needs: 'Done: rules extractor vs the recorded Claude-agent arm (data/replays/e01-claude-arm, scored directly and committed) on train and validation (results/e01-extraction); rerun after extractor tuning.' },
  { id: 'E02', title: 'Retrieval: lexical baseline vs embeddings/hybrid on identical cases and filters', status: 'ready', needs: 'Done: lexical / exact / local trigram / hybrid on the real system (results/e02-retrieval, one-shot e02-test).' },
  { id: 'E03', title: 'Question selection: rules vs ranker vs contextual bandit on identical pools and gates', status: 'ready', needs: 'Done: simulator arm and family arm with trained LinUCB artifacts (results/e03-selectors, data/models/linucb-e03-seed*.json).' },
  { id: 'E04', title: 'Assessment: combined vs separate support/applicability assessors', status: 'ready', needs: 'Done: combined vs separate rules assessor (results/e04-assessor, one-shot e04-test).' },
  { id: 'E05', title: 'Question generation: templates vs freer structured proposals', status: 'ready', needs: 'Done for the template generator at pool sizes 1/2/4 (results/e05-pool-size); a freer structured generator was not built.' },
  { id: 'E06', title: 'Recipient ranking: direct contributors vs observable-condition eligibility', status: 'ready', needs: 'Done: direct-only vs question-dependent eligibility (results/e06-eligibility).' },
  { id: 'E07', title: 'Coordinator settings: budgets, cooldowns, stopping, deferred responses', status: 'ready', needs: 'Done: budgets {1,3,5} x cooldown {0,30} on train families and a simulator budget layer (results/e07-budgets).' },
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
function runE00Reference(): void {
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
  console.log(`E00 reference written: ${path}`);
}

/** Run one experiment by id; returns wall-clock seconds. */
async function runOne(id: string): Promise<number> {
  const t0 = performance.now();
  const core = await import('./runners-core.ts');
  const learn = await import('./runners-learning.ts');
  switch (id.toLowerCase()) {
    case 'e00': {
      const failed = await core.runE00();
      if (failed.length) process.exitCode = 1;
      break;
    }
    case 'e00-reference': runE00Reference(); break;
    case 'e01': await (await import('./runners-e01.ts')).runE01(); break;
    case 'e02': await core.runE02(['demo', 'train', 'validation']); break;
    case 'e04': await core.runE04(['demo', 'train', 'validation']); break;
    case 'e03': await learn.runE03(); break;
    case 'e05': await learn.runE05(); break;
    case 'e06': await learn.runE06(); break;
    case 'e07': await learn.runE07(); break;
    case 'usefulness': await learn.runUsefulness(); break;
    case 'test-final': await core.runTestFinal(); break;
    case 'report': (await import('./report.ts')).writeReport(); break;
    default: throw new Error(`unknown experiment ${id}`);
  }
  return (performance.now() - t0) / 1000;
}

async function main(cmd: string | undefined): Promise<void> {
  if (!cmd || cmd === 'list') return list();
  installNetworkGuard();
  const lock = testFamiliesUntouched();
  if (!lock.untouched) throw new Error(`test families changed since freeze: ${lock.changed.join(',')}`);
  if (cmd === 'all') {
    const order = ['e00', 'e01', 'e02', 'e04', 'e03', 'e05', 'e06', 'e07', 'usefulness'];
    const override = process.argv.includes('--continue-despite-e00');
    const times: Record<string, number> = {};
    let e00StopRuleFired = false;
    for (const id of order) {
      process.exitCode = 0;
      times[id] = await runOne(id);
      console.log(`  ${id} finished in ${times[id]!.toFixed(1)} s`);
      if (id === 'e00' && process.exitCode) {
        e00StopRuleFired = true;
        if (!override) {
          console.error('E00 stop rule fired (a leak or broken trace): fix before continuing. Nothing after E00 was run. Pass --continue-despite-e00 to run on and mark results provisional.');
          return;
        }
        console.error('E00 stop rule fired; continuing because --continue-despite-e00 was passed. All later results are PROVISIONAL.');
      }
    }
    mkdirSync(dirname(RUNTIMES), { recursive: true });
    writeFileSync(RUNTIMES, JSON.stringify({ at: new Date().toISOString(), seconds: times, e00StopRuleFired, stopRuleOverridden: e00StopRuleFired && override, note: 'wall-clock on one Mac, each experiment bounded to < 600 s' }, null, 2) + '\n');
    await runOne('report');
    return;
  }
  const known = ['e00', 'e00-reference', 'e01', 'e02', 'e03', 'e04', 'e05', 'e06', 'e07', 'usefulness', 'test-final', 'report'];
  if (!known.includes(cmd.toLowerCase())) {
    const e = EXPERIMENTS.find((x) => x.id.toLowerCase() === cmd.toLowerCase());
    console.error(e ? `${e.id} is '${e.status}': ${e.needs}` : `unknown experiment ${cmd}`);
    process.exit(2);
  }
  const secs = await runOne(cmd);
  console.log(`  ${cmd} finished in ${secs.toFixed(1)} s`);
}

if (process.argv[1]?.endsWith('run.ts')) await main(process.argv[2]);
