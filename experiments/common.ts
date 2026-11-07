/**
 * Shared helpers for experiment runners: running a variant over a split, extra (harness-side) metrics, decision records.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { FamilyManifestEntry, Split } from '../src/libs/utils/contracts/index.ts';
import { ratio } from '../benchmarks/evaluator.ts';
import type { MaybeMetric } from '../benchmarks/evaluator.ts';
import { loadHidden } from '../benchmarks/load.ts';
import { DEFAULT_RESULTS_DIR } from '../benchmarks/manifest.ts';
import type { RunManifest, VariantResult } from '../benchmarks/manifest.ts';
import { loadFamiliesFile } from '../benchmarks/splits.ts';
import { runFamily } from './harness.ts';
import type { FamilyRun, HarnessOptions } from './harness.ts';
import { scoreRuns, toVariantResult } from './scoring.ts';
import type { Scored } from './scoring.ts';

export const DATASET_VERSION = (): string => loadFamiliesFile().version;
export const familiesOf = (split: Split): FamilyManifestEntry[] => loadFamiliesFile().families.filter((f) => f.split === split);

export const fmt = (m: MaybeMetric | undefined): string => (m ? `${m.value.toFixed(3)} (${m.numerator}/${m.denominator})` : 'n/a');
export const val = (m: MaybeMetric | undefined): number | null => (m ? m.value : null);

export interface VariantRun {
  variantId: string;
  split: Split;
  runs: FamilyRun[];
  scored: Scored;
  extras: Record<string, MaybeMetric>;
  result: VariantResult;
}

/** Harness-side extras that need the answer key: routing of questions to people who can answer, duplicates, burden. */
export function extraMetrics(runs: FamilyRun[]): { metrics: Record<string, MaybeMetric>; counts: Record<string, number> } {
  let gapProblems = 0;
  let routed = 0;
  let benefitSum = 0;
  let investigations = 0;
  let questions = 0;
  let duplicates = 0;
  let cancelledDup = 0;
  let cancelledObsolete = 0;
  let deferredUnanswered = 0;
  let maxPerPerson = 0;
  let loopCapped = 0;
  const perPerson: Record<string, number> = {};
  for (const run of runs) {
    const { people, incoming } = loadHidden(run.familyId);
    const unavailable = new Set(people.people.filter((x) => !x.available).map((x) => x.id));
    for (const pr of run.problems) {
      investigations++;
      questions += pr.questions.length;
      const key = incoming.problems.find((p) => p.id === pr.problemId)?.key;
      const seen = new Set<string>();
      for (const q of pr.questions) {
        const sig = `${q.conditionKey}|${q.recipientId}`;
        if (seen.has(sig)) duplicates++;
        seen.add(sig);
        perPerson[`${run.familyId}|${q.recipientId}`] = (perPerson[`${run.familyId}|${q.recipientId}`] ?? 0) + 1;
        if (q.benefit !== null) benefitSum += q.benefit;
        if (!q.answered) deferredUnanswered++;
      }
      cancelledDup += pr.questionStatus['cancelled:duplicate'] ?? 0;
      cancelledObsolete += (pr.questionStatus['cancelled:obsolete'] ?? 0) + (pr.questionStatus['cancelled:gap-resolved'] ?? 0);
      if (pr.loopEnd === 'round-cap') loopCapped++;
      const gap = key?.consequentialGap;
      if (gap && !gap.unanswerable && gap.answerers.some((a) => !unavailable.has(a))) {
        gapProblems++;
        if (pr.questions.some((q) => gap.answerers.includes(q.recipientId))) routed++;
      }
    }
  }
  maxPerPerson = Object.values(perPerson).reduce((m, n) => Math.max(m, n), 0);
  return {
    metrics: {
      'routing.answerableRoutingRate': ratio(routed, gapProblems),
      'benefit.meanPerInvestigation': ratio(benefitSum, investigations),
    },
    counts: {
      'burden.duplicateQuestions': duplicates,
      'burden.cancelledDuplicate': cancelledDup,
      'burden.cancelledObsoleteOrResolved': cancelledObsolete,
      'burden.unansweredQuestions': deferredUnanswered,
      'burden.maxQuestionsToOnePersonPerFamily': maxPerPerson,
      'burden.questionsTotal': questions,
      'burden.investigationLoopsHittingRoundCap': loopCapped,
    },
  };
}

export async function runFamilies(split: Split, opts: HarnessOptions | (() => HarnessOptions)): Promise<FamilyRun[]> {
  const runs: FamilyRun[] = [];
  for (const f of familiesOf(split)) runs.push(await runFamily(f.id, typeof opts === 'function' ? opts() : opts));
  return runs;
}

export async function runVariant(variantId: string, split: Split, opts: HarnessOptions | (() => HarnessOptions)): Promise<VariantRun> {
  const runs = await runFamilies(split, opts);
  const scored = scoreRuns({ families: familiesOf(split), runs });
  const ex = extraMetrics(runs);
  const result = toVariantResult(variantId, 'measured', split, scored, ex.counts);
  result.metrics = { ...result.metrics, ...ex.metrics };
  return { variantId, split, runs, scored, extras: ex.metrics, result };
}

export interface Decision {
  experiment: string;
  hypothesis: string;
  criterion: string;
  outcome: string;
  shipped: string;
  detail: Record<string, string>;
}

export function writeExtra(runId: string, name: string, data: unknown, root = DEFAULT_RESULTS_DIR): string {
  const dir = join(root, runId);
  mkdirSync(dir, { recursive: true });
  const p = join(dir, name);
  writeFileSync(p, JSON.stringify(data, null, 2) + '\n');
  return p;
}

/** Compact per-problem table written next to results.json (harness outputs plus the expected class, harness side). */
export function problemTable(vr: VariantRun): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const run of vr.runs) {
    const { incoming } = loadHidden(run.familyId);
    for (const p of run.problems) {
      const k = incoming.problems.find((x) => x.id === p.problemId)?.key;
      out.push({
        variant: vr.variantId, split: vr.split, problem: p.problemId, expected: k?.expectedRecommendation, noQuestionNeeded: k?.noQuestionNeeded,
        first: p.firstRecommendation, final: p.finalRecommendation, loopEnd: p.loopEnd, topCaseIncidents: run.caseIncidents[p.rankedCaseIds[0] ?? ''] ?? [],
        questions: p.questions.map((q) => ({ cond: q.conditionKey, to: q.recipientId, reply: q.reply, benefit: q.benefit, text: q.text })),
        latencyMs: Math.round(p.latencyMs * 100) / 100,
      });
    }
  }
  return out;
}

export function baseManifest(partial: Pick<RunManifest, 'id' | 'hypothesis' | 'splits' | 'variants' | 'config' | 'seeds' | 'metrics' | 'acceptanceCriteria' | 'stopRule'> & Partial<RunManifest>): RunManifest {
  return {
    datasetVersion: DATASET_VERSION(),
    visibleInputs: ['sources/ (through the scenario-dir importer)', 'people.json', 'incoming problem text', 'incoming observations'],
    route: 'rules',
    resourceCap: { maxWallSeconds: 600, networkCalls: 0 },
    startedAt: new Date().toISOString(),
    ...partial,
  };
}

/** Pool several splits into one scored variant (used where nothing is fitted, so train data is not a leak). */
export async function runVariantPooled(variantId: string, splits: Split[], opts: HarnessOptions | (() => HarnessOptions), label: Split | 'train+validation' = 'validation'): Promise<VariantRun> {
  const runs: FamilyRun[] = [];
  const fams: FamilyManifestEntry[] = [];
  for (const sp of splits) {
    runs.push(...(await runFamilies(sp, opts)));
    fams.push(...familiesOf(sp));
  }
  const scored = scoreRuns({ families: fams, runs });
  const ex = extraMetrics(runs);
  const result = toVariantResult(variantId, 'measured', label as Split, scored, { ...ex.counts, 'pooled.families': runs.length });
  result.metrics = { ...result.metrics, ...ex.metrics };
  return { variantId, split: label as Split, runs, scored, extras: ex.metrics, result };
}

/** Timestamp fields left out of a results lock: they change on every re-run while the numbers do not. */
const LOCK_VOLATILE = new Set(['startedAt', 'finishedAt', 'at']);
const stripVolatile = (v: unknown): unknown =>
  Array.isArray(v) ? v.map(stripVolatile)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([k]) => !LOCK_VOLATILE.has(k)).map(([k, x]) => [k, stripVolatile(x)]))
    : v;

/** sha256 (16 hex) over a run's result files with their timestamps removed, in the given order. */
export function resultsSha256(runId: string, files: string[], root = DEFAULT_RESULTS_DIR): string {
  const h = createHash('sha256');
  for (const f of files) h.update(f + '\n' + JSON.stringify(stripVolatile(JSON.parse(readFileSync(join(root, runId, f), 'utf8')))) + '\n');
  return h.digest('hex').slice(0, 16);
}

/**
 * Hash-lock a run's results (brief 5.4 "hash-locked"): lock.json records the hash of its result files without
 * timestamps, so a re-run that reproduces the numbers reproduces the hash, and a test can check the committed files.
 */
export function writeResultsLock(runId: string, files: string[], root = DEFAULT_RESULTS_DIR): string {
  return writeExtra(runId, 'lock.json', { runId, method: 'sha256 (first 16 hex) of each file name and its JSON without startedAt/finishedAt/at, in this order', files, resultsSha256: resultsSha256(runId, files, root) }, root);
}
