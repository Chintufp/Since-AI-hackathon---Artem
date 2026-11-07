/**
 * Scoring of harness runs with the frozen benchmark evaluator (hidden keys are read here, harness side only).
 */
import type { FamilyManifestEntry, IncomingProblems, Split } from '../src/libs/utils/contracts/index.ts';
import {
  accessLeakage, efficiency, incomingLinking, knowledgeAccuracy, mergeReports, questionValueAndBurden, ratio, recommendationQuality, resolutionAccuracy, sliceFailuresByTag,
} from '../benchmarks/evaluator.ts';
import type { MaybeMetric, MetricReport } from '../benchmarks/evaluator.ts';
import { loadHidden } from '../benchmarks/load.ts';
import type { VariantResult } from '../benchmarks/manifest.ts';
import type { FamilyRun } from './harness.ts';

type Problem = IncomingProblems['problems'][number];

/**
 * Problems realising the tag `lookalike-different-cause`, from the evaluation owner's per-problem tag table
 * (data/scenarios/REVIEW.md, harness-side document). Families tagged but absent from this table (the sealed test
 * family) use all of their problems.
 */
const LOOKALIKE_PROBLEMS: Record<string, string[]> = {
  'optic-forwarding-a': ['optic-forwarding-a-p1'],
  'bgp-firmware-flaps': ['bgp-firmware-flaps-p1'],
  'bgp-linecard-private': ['bgp-linecard-private-p1', 'bgp-linecard-private-p2'],
};

export interface ScoreOptions {
  /** Metrics are computed per family, then pooled (numerators and denominators summed). */
  families: FamilyManifestEntry[];
  runs: FamilyRun[];
  /** Ranked-list cutoffs used for linking recall/precision. */
  linkingKs?: number[];
}

export interface Scored {
  metrics: Record<string, MaybeMetric>;
  counts: Record<string, number | null>;
  failures: MetricReport['failures'];
  failureSlicesByTag: VariantResult['failureSlicesByTag'];
  perFamily: Record<string, Record<string, MaybeMetric>>;
  /** Mean and spread of per-problem latency. */
  latenciesMs: number[];
}

function accessibleRelated(p: Problem, truthIncidents: Array<{ key: string; accessGroups: string[] }>, groups: string[]): string[] {
  const g = new Set(groups);
  return p.key.relatedIncidentKeys.filter((k) => truthIncidents.find((i) => i.key === k)?.accessGroups.some((x) => g.has(x)));
}

const prefix = (r: MetricReport, pre: string): MetricReport => ({
  metrics: Object.fromEntries(Object.entries(r.metrics).map(([k, v]) => [`${pre}${k}`, v])),
  counts: Object.fromEntries(Object.entries(r.counts).map(([k, v]) => [`${pre}${k}`, v])),
  failures: r.failures.map((f) => ({ ...f, metric: `${pre}${f.metric}` })),
});

export function scoreRuns(opts: ScoreOptions): Scored {
  const ks = opts.linkingKs ?? [1, 3];
  const perFamilyReports: Array<{ id: string; report: MetricReport }> = [];
  const latencies: number[] = [];
  for (const run of opts.runs) {
    const { people, truth, incoming } = loadHidden(run.familyId);
    const problems = incoming.problems.filter((p) => run.problems.some((r) => r.problemId === p.id));
    const familyOf = () => run.familyId;
    const unavailable = people.people.filter((x) => !x.available).map((x) => x.id);
    const reports: MetricReport[] = [];
    reports.push(knowledgeAccuracy(run.knowledge, truth, { people }), resolutionAccuracy(run.knowledge, truth));
    reports.push(recommendationQuality(run.recommendations, problems, familyOf));
    const violations = run.problems.reduce((n, p) => n + p.blockedSelections, 0);
    reports.push(questionValueAndBurden(run.questionRuns, problems, violations, familyOf, { unavailable }));
    // incoming linking from the ranked candidate list of the first investigation, at several cutoffs
    for (const k of ks) {
      const links = run.problems.map((p) => ({ problemId: p.problemId, linkedCaseIds: p.rankedCaseIds.slice(0, k) }));
      reports.push(prefix(incomingLinking(links, run.knowledge, truth, problems), `@${k}.`));
      const acc = problems.map((p) => ({ ...p, key: { ...p.key, relatedIncidentKeys: accessibleRelated(p, truth.incidents, people.people.find((x) => x.id === p.requester)?.groups ?? []) } }));
      reports.push(prefix(incomingLinking(links, run.knowledge, truth, acc), `@${k}.accessible.`));
    }
    const shown = run.problems.map((p) => ({ problemId: p.problemId, requesterId: p.requesterId, sourceIds: p.shownSourceIds }));
    reports.push(accessLeakage(shown, truth, people));
    // Shown evidence whose own stored access scope the requester fails: a leak the system could have detected itself.
    const totalShown = run.problems.reduce((n, p) => n + p.shownSourceIds.length, 0);
    const restrictedShown = run.problems.reduce((n, p) => n + p.shownRestrictedSourceIds.length, 0);
    reports.push({
      metrics: { 'access.shownRestrictedEvidenceRate': ratio(restrictedShown, totalShown) }, counts: {},
      failures: run.problems.flatMap((p) => p.shownRestrictedSourceIds.map((s) => ({ id: p.problemId, familyId: run.familyId, metric: 'access.shownRestrictedEvidenceRate', reason: `evidence ${s} has a stored access scope that excludes requester ${p.requesterId}` }))),
    });
    // lookalike-different-cause: is the top-1 candidate a wrong incident?
    const entry = opts.families.find((f) => f.id === run.familyId);
    const tagged = entry?.tags.includes('lookalike-different-cause') ?? false;
    const lookIds = LOOKALIKE_PROBLEMS[run.familyId] ?? (tagged ? problems.map((p) => p.id) : []);
    let lookN = 0;
    let lookWrong = 0;
    const lookFailures: MetricReport['failures'] = [];
    for (const pid of lookIds) {
      const pr = run.problems.find((p) => p.problemId === pid);
      const key = problems.find((p) => p.id === pid)?.key;
      const top = pr?.rankedCaseIds[0];
      if (!pr || !key || !top) continue;
      lookN++;
      const incs = run.caseIncidents[top] ?? [];
      if (!incs.some((i) => key.relatedIncidentKeys.includes(i))) {
        lookWrong++;
        lookFailures.push({ id: pid, familyId: run.familyId, metric: 'retrieval.lookalikeTop1Rate', reason: `top-1 case maps to incident ${incs.join('/') || 'none'}, related: ${key.relatedIncidentKeys.join(',')}` });
      }
    }
    reports.push({ metrics: { 'retrieval.lookalikeTop1Rate': ratio(lookWrong, lookN) }, counts: {}, failures: lookFailures });
    // questions asked and burden extras
    const answered = run.problems.flatMap((p) => p.questions).filter((q) => q.answered).length;
    const asked = run.problems.flatMap((p) => p.questions).length;
    reports.push({ metrics: { 'question.answeredRate': ratio(answered, asked) }, counts: { 'question.asked': asked, 'question.answered': answered }, failures: [] });
    for (const p of run.problems) latencies.push(p.latencyMs);
    perFamilyReports.push({ id: run.familyId, report: mergeReports(reports) });
  }
  const merged = mergeReports(perFamilyReports.map((p) => p.report));
  const eff = efficiency({ latenciesMs: latencies });
  const metrics = { ...merged.metrics, ...eff.metrics };
  const counts = { ...merged.counts };
  for (const k of Object.keys(counts)) if (k.startsWith('efficiency.')) delete counts[k];
  Object.assign(counts, eff.counts);
  return {
    metrics, counts, failures: merged.failures,
    failureSlicesByTag: sliceFailuresByTag(merged.failures, opts.families),
    perFamily: Object.fromEntries(perFamilyReports.map((p) => [p.id, p.report.metrics])),
    latenciesMs: latencies,
  };
}

export function toVariantResult(variantId: string, provenance: VariantResult['provenance'], split: Split, s: Scored, extraCounts: Record<string, number | null> = {}): VariantResult {
  return {
    variantId, provenance, split,
    metrics: s.metrics,
    counts: { ...s.counts, ...extraCounts },
    // keep a few examples of EACH failing metric (a flat cut would keep only the first families' failures)
    failures: (() => {
      const per = new Map<string, number>();
      return s.failures.filter((x) => {
        const n = per.get(x.metric) ?? 0;
        per.set(x.metric, n + 1);
        return n < 6;
      });
    })(),
    failureSlicesByTag: s.failureSlicesByTag,
  };
}
