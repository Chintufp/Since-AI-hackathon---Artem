/**
 * E00 deterministic evaluator. Pure functions that score a system's outputs against hidden truth.
 * Imports contract TYPES only. Never imports from src/apps. Every metric is {value, numerator, denominator}
 * or null when its denominator is zero (undefined stays undefined, never 0 or 1).
 */
import type {
  Attempt,
  Case,
  ClaimType,
  Claim,
  Entity,
  EvidenceRef,
  IncomingProblems,
  Outcome,
  PeopleDirectory,
  PersonWorkLink,
  RecommendationKind,
  ScenarioTruth,
  FamilyManifestEntry,
} from '../src/libs/utils/contracts/index.ts';
import { canonicalAction } from './actions.ts';
import { gapConditionKeys } from './oracle.ts';
import { jaccard, normalizeSourceId, normName } from './text.ts';

// ---------------------------------------------------------------- shared types

export interface Metric {
  value: number;
  numerator: number;
  denominator: number;
}
export type MaybeMetric = Metric | null;

export interface FailureExample {
  /** Claim id, case id, problem id or truth incident key the failure is about. */
  id: string;
  familyId?: string;
  metric: string;
  reason: string;
}

export interface MetricReport {
  metrics: Record<string, MaybeMetric>;
  /** Raw counts reported separately (ambiguous/unknown/missing/etc). */
  counts: Record<string, number | null>;
  failures: FailureExample[];
}

export function ratio(numerator: number, denominator: number): MaybeMetric {
  return denominator > 0 ? { value: numerator / denominator, numerator, denominator } : null;
}

export interface SystemKnowledge {
  claims: Claim[];
  entities: Entity[];
  links: PersonWorkLink[];
  cases: Case[];
  attempts?: Attempt[];
  outcomes?: Outcome[];
  /** evidence id -> "provider:sourceId" as derived by the adapters (harness supplies it). */
  evidenceSourceIds: Record<string, string>;
  /** claim id -> number of independent supporting sources the system itself counted. */
  independentSupport?: Record<string, number>;
}

export interface EvalContext {
  /** Visible directory, used to resolve provider actor ids to directory person ids. */
  people?: PeopleDirectory;
}

// ---------------------------------------------------------------- helpers

type Incident = ScenarioTruth['incidents'][number];

class PersonResolver {
  private byActor = new Map<string, string>();
  private byName = new Map<string, string>();
  constructor(people?: PeopleDirectory) {
    for (const p of people?.people ?? []) {
      this.byName.set(normName(p.name), p.id);
      for (const a of p.actorIds) this.byActor.set(a, p.id);
    }
  }
  /** Returns a directory person id, or undefined when the actor cannot be resolved. */
  resolve(actor?: { id: string; displayName?: string }): string | undefined {
    if (!actor) return undefined;
    if (actor.id.startsWith('person:directory:')) return actor.id;
    return this.byActor.get(actor.id) ?? (actor.displayName ? this.byName.get(normName(actor.displayName)) : undefined);
  }
}

class TruthIndex {
  readonly incidentOf = new Map<string, string>();
  /** A retelling may copy several originals (one row per parent in truth.copies). */
  readonly copyOf = new Map<string, string[]>();
  readonly truth: ScenarioTruth;
  constructor(truth: ScenarioTruth) {
    this.truth = truth;
    for (const inc of truth.incidents) for (const s of inc.sourceIds) this.incidentOf.set(normalizeSourceId(s), inc.key);
    for (const c of truth.copies) {
      const k = normalizeSourceId(c.sourceId);
      this.copyOf.set(k, [...(this.copyOf.get(k) ?? []), normalizeSourceId(c.of)]);
    }
  }
  incident(key: string): Incident | undefined {
    return this.truth.incidents.find((i) => i.key === key);
  }
  /** Original (non-copy) sources a source ultimately retells; a non-copy is its own root. */
  roots(sourceId: string, depth = 0): string[] {
    const cur = normalizeSourceId(sourceId);
    const parents = this.copyOf.get(cur);
    if (!parents || depth > 20) return [cur];
    return [...new Set(parents.flatMap((p) => this.roots(p, depth + 1)))];
  }
  /**
   * Independent confirmations among the supporting sources of ONE claim: originals count one each; a copy adds
   * nothing when any original it retells is already counted among the supporters, otherwise it counts once.
   */
  independentCount(sources: string[]): number {
    const uniq = [...new Set(sources.map(normalizeSourceId))];
    const counted = new Set(uniq.filter((s) => !this.copyOf.has(s)));
    let n = counted.size;
    for (const s of uniq.filter((x) => this.copyOf.has(x))) {
      const rs = this.roots(s);
      if (rs.some((r) => counted.has(r))) continue;
      n++;
      for (const r of rs) counted.add(r);
    }
    return n;
  }
}

/** Truth-side number of independent confirmations among the given supporting sources (copies handled). */
export function truthIndependentCount(sources: string[], truth: ScenarioTruth): number {
  return new TruthIndex(truth).independentCount(sources);
}

function sourcesOf(refs: EvidenceRef[], map: Record<string, string>): string[] {
  const out: string[] = [];
  for (const r of refs) {
    const s = map[r.evidenceId];
    if (s) out.push(normalizeSourceId(s));
  }
  return out;
}

function incidentsOf(sources: string[], idx: TruthIndex): string[] {
  const counts = new Map<string, number>();
  for (const s of sources) {
    const k = idx.incidentOf.get(s);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k]) => k);
}

function tag(report: MetricReport, familyId: string | undefined): (f: Omit<FailureExample, 'familyId'>) => void {
  return (f) => report.failures.push({ ...f, familyId });
}

// ---------------------------------------------------------------- knowledge accuracy

export const MATCH_THRESHOLD = 0.5;
export const AMBIGUOUS_FLOOR = 0.3;

const CLAIM_TYPES: ClaimType[] = ['observation', 'hypothesis', 'advice', 'action', 'outcome', 'condition', 'access-fact', 'identity', 'other'];

export function knowledgeAccuracy(sys: SystemKnowledge, truth: ScenarioTruth, ctx: EvalContext = {}): MetricReport {
  const report: MetricReport = { metrics: {}, counts: {}, failures: [] };
  const fail = tag(report, truth.familyId);
  const idx = new TruthIndex(truth);
  const people = new PersonResolver(ctx.people);

  // ---- claims
  const truthClaims = truth.incidents.flatMap((inc) =>
    inc.expectedClaims.map((c, i) => ({ id: `${inc.key}#${i}`, incident: inc.key, type: c.type, statement: c.statement, by: c.by })),
  );
  const sysClaims = sys.claims.filter((c) => c.status !== 'retracted');

  const pairs: Array<{ s: number; t: number; sim: number }> = [];
  sysClaims.forEach((c, s) =>
    truthClaims.forEach((t, ti) => {
      if (c.type !== t.type) return;
      const sim = jaccard(c.statement, t.statement);
      if (sim >= MATCH_THRESHOLD) pairs.push({ s, t: ti, sim });
    }),
  );
  pairs.sort((a, b) => b.sim - a.sim || a.s - b.s || a.t - b.t);
  const matchedSys = new Map<number, number>(); // sys idx -> truth idx
  const matchedTruth = new Set<number>();
  for (const p of pairs) {
    if (matchedSys.has(p.s) || matchedTruth.has(p.t)) continue;
    matchedSys.set(p.s, p.t);
    matchedTruth.add(p.t);
  }

  type Bucket = { matched: number; falsePos: number; ambiguous: number; unknown: number; truthTotal: number; truthMatched: number };
  const buckets = new Map<string, Bucket>();
  const bucket = (t: string) => buckets.get(t) ?? buckets.set(t, { matched: 0, falsePos: 0, ambiguous: 0, unknown: 0, truthTotal: 0, truthMatched: 0 }).get(t)!;
  for (const t of CLAIM_TYPES) bucket(t);

  truthClaims.forEach((t, i) => {
    const b = bucket(t.type);
    b.truthTotal++;
    if (matchedTruth.has(i)) b.truthMatched++;
    else fail({ id: t.id, metric: 'claims.recall', reason: `missed ${t.type} claim: "${t.statement}"` });
  });
  sysClaims.forEach((c, s) => {
    const b = bucket(c.type);
    if (matchedSys.has(s)) {
      b.matched++;
      return;
    }
    if (c.type === 'other') {
      b.unknown++;
      return;
    }
    let bestSame = 0;
    let bestOther = 0;
    for (const t of truthClaims) {
      const sim = jaccard(c.statement, t.statement);
      if (t.type === c.type) bestSame = Math.max(bestSame, sim);
      else bestOther = Math.max(bestOther, sim);
    }
    if ((bestSame >= AMBIGUOUS_FLOOR && bestSame < MATCH_THRESHOLD) || bestOther >= MATCH_THRESHOLD) {
      b.ambiguous++;
      return;
    }
    b.falsePos++;
    fail({ id: c.id, metric: 'claims.precision', reason: `unsupported ${c.type} claim: "${c.statement.slice(0, 80)}"` });
  });

  const all: Bucket = { matched: 0, falsePos: 0, ambiguous: 0, unknown: 0, truthTotal: 0, truthMatched: 0 };
  for (const [t, b] of buckets) {
    if (b.matched + b.falsePos + b.truthTotal + b.ambiguous + b.unknown === 0) continue;
    report.metrics[`claims.${t}.precision`] = ratio(b.matched, b.matched + b.falsePos);
    report.metrics[`claims.${t}.recall`] = ratio(b.truthMatched, b.truthTotal);
    report.counts[`claims.${t}.ambiguous`] = b.ambiguous;
    report.counts[`claims.${t}.unknown`] = b.unknown;
    for (const k of Object.keys(all) as Array<keyof Bucket>) all[k] += b[k];
  }
  report.metrics['claims.all.precision'] = ratio(all.matched, all.matched + all.falsePos);
  report.metrics['claims.all.recall'] = ratio(all.truthMatched, all.truthTotal);
  report.counts['claims.all.ambiguous'] = all.ambiguous;
  report.counts['claims.all.unknown'] = all.unknown;

  // ---- entities
  const sysNames = new Set<string>();
  for (const e of sys.entities) {
    sysNames.add(normName(e.name));
    for (const a of e.aliases ?? []) sysNames.add(normName(a));
  }
  const truthNames = new Set(truth.entities.map((e) => normName(e.name)));
  let entFound = 0;
  for (const e of truth.entities) {
    if (sysNames.has(normName(e.name))) entFound++;
    else fail({ id: e.name, metric: 'entities.recall', reason: `entity "${e.name}" not found` });
  }
  report.metrics['entities.recall'] = ratio(entFound, truth.entities.length);
  const nonPerson = sys.entities.filter((e) => e.type !== 'person');
  const entOk = nonPerson.filter((e) => truthNames.has(normName(e.name)) || (e.aliases ?? []).some((a) => truthNames.has(normName(a)))).length;
  report.counts['entities.systemNonPerson'] = nonPerson.length;
  report.counts['entities.extraNonTruth'] = nonPerson.length - entOk; // extra entities are not penalized: truth lists only key entities

  // ---- cases: false merges / false splits
  const caseIncidents = sys.cases.map((c) => ({ c, incs: incidentsOf(sourcesOf(c.evidenceIds.map((evidenceId) => ({ evidenceId })), sys.evidenceSourceIds), idx) }));
  const mapped = caseIncidents.filter((x) => x.incs.length > 0);
  let merges = 0;
  for (const x of mapped) {
    if (x.incs.length > 1) {
      merges++;
      fail({ id: x.c.id, metric: 'cases.falseMergeRate', reason: `case merges incidents ${x.incs.join(', ')}` });
    }
  }
  report.metrics['cases.falseMergeRate'] = ratio(merges, mapped.length);
  let splits = 0;
  let touched = 0;
  let missing = 0;
  for (const inc of truth.incidents) {
    const n = mapped.filter((x) => x.incs.includes(inc.key)).length;
    if (n === 0) missing++;
    else {
      touched++;
      if (n > 1) {
        splits++;
        fail({ id: inc.key, metric: 'cases.falseSplitRate', reason: `incident spread across ${n} cases` });
      }
    }
  }
  report.metrics['cases.falseSplitRate'] = ratio(splits, touched);
  report.counts['cases.missingIncidents'] = missing;

  // ---- attribution: claim -> person
  let personWrong = 0;
  let personEval = 0;
  let unattributed = 0;
  for (const [s, t] of matchedSys) {
    const tc = truthClaims[t]!;
    if (!tc.by) continue;
    personEval++;
    const got = people.resolve(sysClaims[s]!.assertedBy);
    if (!got) unattributed++;
    else if (got !== tc.by) {
      personWrong++;
      fail({ id: sysClaims[s]!.id, metric: 'attribution.claimPerson', reason: `attributed to ${got}, truth ${tc.by}` });
    }
  }
  report.metrics['attribution.claimPersonErrorRate'] = ratio(personWrong, personEval);
  report.counts['attribution.claimPersonUnattributed'] = unattributed;

  // ---- attribution: attempts (performer and performed-state)
  if (sys.attempts) {
    let wrongPerformer = 0;
    let performerEval = 0;
    let wrongState = 0;
    let stateEval = 0;
    let spurious = 0;
    const used = new Map<string, Set<number>>(); // incident key -> consumed truth attempt indexes
    for (const a of sys.attempts) {
      const incKey = incidentsOf(sourcesOf(a.evidence, sys.evidenceSourceIds), idx)[0];
      const inc = incKey ? idx.incident(incKey) : undefined;
      const taken = incKey ? (used.get(incKey) ?? used.set(incKey, new Set()).get(incKey)!) : new Set<number>();
      // exact action first, then the canonical roll-up (truth uses a few finer actions than contracts ACTIONS)
      const pick = (same: (x: Incident['attempts'][number]) => boolean) => inc?.attempts.findIndex((x, i) => !taken.has(i) && same(x)) ?? -1;
      let ti = pick((x) => normName(x.action) === normName(a.action));
      if (ti < 0) ti = pick((x) => canonicalAction(x.action) === canonicalAction(a.action));
      const t = ti >= 0 ? inc!.attempts[ti] : undefined;
      if (!t) {
        spurious++;
        fail({ id: a.id, metric: 'attribution.attemptsNotInTruth', reason: `attempt "${a.action}" matches no truth attempt${inc ? ` of incident ${incKey}` : ' (no incident resolved)'}` });
        continue;
      }
      taken.add(ti);
      stateEval++;
      const claimedPerformed = a.performed === 'reported';
      if (a.performed !== 'unknown' && claimedPerformed !== t.performed) {
        wrongState++;
        fail({ id: a.id, metric: 'attribution.attemptPerformedState', reason: `system says ${a.performed}, truth performed=${t.performed}` });
      }
      const who = people.resolve(a.performedBy ?? a.advisedBy);
      if (who) {
        performerEval++;
        if (who !== t.by) {
          wrongPerformer++;
          fail({ id: a.id, metric: 'attribution.attemptPerformer', reason: `attributed to ${who}, truth ${t.by}` });
        }
      }
    }
    report.metrics['attribution.attemptPerformerErrorRate'] = ratio(wrongPerformer, performerEval);
    report.metrics['attribution.attemptPerformedStateErrorRate'] = ratio(wrongState, stateEval);
    report.counts['attribution.attemptsNotInTruth'] = spurious;
    report.metrics['attribution.attemptsNotInTruthRate'] = ratio(spurious, sys.attempts.length);
  }

  // ---- attribution: outcome reporter
  if (sys.outcomes) {
    let wrong = 0;
    let evalN = 0;
    for (const o of sys.outcomes) {
      const incKey = incidentsOf(sourcesOf(o.evidence, sys.evidenceSourceIds), idx)[0];
      const inc = incKey ? idx.incident(incKey) : undefined;
      if (!inc?.outcome.reportedBy) continue;
      const who = people.resolve(o.reportedBy);
      if (!who) continue;
      evalN++;
      if (who !== inc.outcome.reportedBy) {
        wrong++;
        fail({ id: o.id, metric: 'attribution.outcomeReporter', reason: `reported by ${who}, truth ${inc.outcome.reportedBy}` });
      }
    }
    report.metrics['attribution.outcomeReporterErrorRate'] = ratio(wrong, evalN);
  }

  // ---- attribution: firsthand links (mentioned-only people must not be firsthand)
  {
    const entityById = new Map(sys.entities.map((e) => [e.id, e]));
    const caseById = new Map(sys.cases.map((c) => [c.id, c]));
    let wrong = 0;
    let evalN = 0;
    for (const l of sys.links) {
      if (!l.firsthand) continue;
      const ent = entityById.get(l.personEntityId);
      const personId = ent ? (ent.actorIds ?? []).map((a) => people.resolve({ id: a })).find(Boolean) ?? people.resolve({ id: ent.id, displayName: ent.name }) : undefined;
      if (!personId) continue;
      const c = l.caseId ? caseById.get(l.caseId) : undefined;
      const srcs = [...sourcesOf(l.evidence, sys.evidenceSourceIds), ...(c ? sourcesOf(c.evidenceIds.map((evidenceId) => ({ evidenceId })), sys.evidenceSourceIds) : [])];
      const incKey = incidentsOf(srcs, idx)[0];
      const inc = incKey ? idx.incident(incKey) : undefined;
      if (!inc) continue;
      evalN++;
      const k = inc.knowledge[personId];
      if (!k || k.knows.length === 0) {
        wrong++;
        fail({ id: l.id, metric: 'attribution.firsthandLink', reason: `${personId} has no firsthand knowledge of incident ${inc.key}` });
      }
    }
    report.metrics['attribution.firsthandLinkErrorRate'] = ratio(wrong, evalN);
  }

  // ---- copy handling
  {
    const copyIds = new Set(idx.copyOf.keys());
    let over = 0;
    let relevant = 0;
    for (const c of sysClaims) {
      const srcs = sourcesOf(c.supporting, sys.evidenceSourceIds);
      if (!srcs.some((s) => copyIds.has(s))) continue;
      relevant++;
      const truthIndependent = idx.independentCount(srcs);
      const reported = sys.independentSupport?.[c.id] ?? new Set(srcs).size;
      if (reported > truthIndependent) {
        over++;
        fail({ id: c.id, metric: 'copies.overcountRate', reason: `counts ${reported} independent sources, truth ${truthIndependent}` });
      }
    }
    report.metrics['copies.overcountRate'] = ratio(over, relevant);
  }
  return report;
}

// ---------------------------------------------------------------- resolution accuracy

export type ExpectedCaseStatus = 'verified-resolved' | 'recurred' | 'reported-recovered' | 'unknown-outcome' | 'open';

export function expectedStatus(outcome: Incident['outcome']): ExpectedCaseStatus {
  if (outcome.lasting === 'confirmed') return 'verified-resolved';
  if (outcome.lasting === 'recurred') return 'recurred';
  if (outcome.result === 'recovered' || outcome.result === 'partial') return 'reported-recovered';
  if (outcome.result === 'unknown') return 'unknown-outcome';
  return 'open';
}

export function resolutionAccuracy(
  sys: Pick<SystemKnowledge, 'cases' | 'evidenceSourceIds'> & { outcomes?: Outcome[] },
  truth: ScenarioTruth,
): MetricReport & { confusion: Record<string, number> } {
  const report: MetricReport & { confusion: Record<string, number> } = { metrics: {}, counts: {}, failures: [], confusion: {} };
  const fail = tag(report, truth.familyId);
  const idx = new TruthIndex(truth);
  let falseSolved = 0;
  let notConfirmed = 0;
  let correct = 0;
  let evalN = 0;
  for (const c of sys.cases) {
    const key = incidentsOf(sourcesOf(c.evidenceIds.map((evidenceId) => ({ evidenceId })), sys.evidenceSourceIds), idx)[0];
    const inc = key ? idx.incident(key) : undefined;
    if (!inc) continue;
    const want = expectedStatus(inc.outcome);
    evalN++;
    const cell = `${want}|${c.status}`;
    report.confusion[cell] = (report.confusion[cell] ?? 0) + 1;
    if (c.status === want) correct++;
    else fail({ id: c.id, metric: 'resolution.statusAccuracy', reason: `status ${c.status}, truth ${want}` });
    if (inc.outcome.lasting !== 'confirmed') {
      notConfirmed++;
      if (c.status === 'verified-resolved') {
        falseSolved++;
        fail({ id: c.id, metric: 'resolution.falseSolvedRate', reason: `claimed verified-resolved but truth lasting=${inc.outcome.lasting}` });
      }
    }
  }
  report.metrics['resolution.statusAccuracy'] = ratio(correct, evalN);
  report.metrics['resolution.falseSolvedRate'] = ratio(falseSolved, notConfirmed);

  if (sys.outcomes) {
    let falseConfirmed = 0;
    let denom = 0;
    for (const o of sys.outcomes) {
      const key = incidentsOf(sourcesOf(o.evidence, sys.evidenceSourceIds), idx)[0];
      const inc = key ? idx.incident(key) : undefined;
      if (!inc || inc.outcome.lasting === 'confirmed') continue;
      denom++;
      if (o.lasting === 'confirmed') {
        falseConfirmed++;
        fail({ id: o.id, metric: 'resolution.falseConfirmedOutcomeRate', reason: `outcome marked lasting=confirmed, truth ${inc.outcome.lasting}` });
      }
    }
    report.metrics['resolution.falseConfirmedOutcomeRate'] = ratio(falseConfirmed, denom);
  }
  return report;
}

// ---------------------------------------------------------------- recommendation quality

type Problem = IncomingProblems['problems'][number];
const ISSUED: RecommendationKind[] = ['reuse', 'check-first', 'qualified'];

export interface RecommendationOutput {
  problemId: string;
  kind: RecommendationKind;
}

export function recommendationQuality(outputs: RecommendationOutput[], problems: Problem[], familyOf: (problemId: string) => string | undefined = () => undefined): MetricReport {
  const report: MetricReport = { metrics: {}, counts: {}, failures: [] };
  const byProblem = new Map(outputs.map((o) => [o.problemId, o]));
  let kindOk = 0;
  let evalN = 0;
  let issued = 0;
  let supported = 0;
  let falseAdvice = 0;
  let eligible = 0;
  let helped = 0;
  let reuseExpected = 0;
  let missed = 0;
  let noOutput = 0;
  for (const p of problems) {
    const out = byProblem.get(p.id);
    const f = (metric: string, reason: string) => report.failures.push({ id: p.id, familyId: familyOf(p.id), metric, reason });
    if (!out) {
      noOutput++;
      f('recommendation.output', 'no recommendation output for problem');
      continue;
    }
    evalN++;
    if (out.kind === p.key.expectedRecommendation) kindOk++;
    else f('recommendation.kindAccuracy', `kind ${out.kind}, expected ${p.key.expectedRecommendation}`);
    const isIssued = ISSUED.includes(out.kind);
    const applicableToday = p.key.applicable === 'reuse' || p.key.applicable === 'qualified';
    if (isIssued) {
      issued++;
      if (applicableToday) supported++;
    }
    // Any issued advice (reuse, check-first or qualified) on an inapplicable lookalike / no-precedent problem is false advice.
    if (isIssued && (p.key.applicable === 'inapplicable' || p.key.applicable === 'none')) {
      falseAdvice++;
      f('recommendation.falseAdviceRate', `${out.kind} issued but key says ${p.key.applicable}`);
    }
    if (applicableToday) {
      eligible++;
      if (isIssued) helped++;
    }
    if (p.key.expectedRecommendation === 'reuse') {
      reuseExpected++;
      if (out.kind === 'none' || out.kind === 'retain-uncertainty') {
        missed++;
        f('recommendation.missedOpportunityRate', `${out.kind} but key expects reuse`);
      }
    }
  }
  report.metrics['recommendation.kindAccuracy'] = ratio(kindOk, evalN);
  // Constant-majority-class baseline over the same evaluated problems, to read kindAccuracy against.
  const classCounts = new Map<string, number>();
  for (const p of problems) if (byProblem.has(p.id)) classCounts.set(p.key.expectedRecommendation, (classCounts.get(p.key.expectedRecommendation) ?? 0) + 1);
  const majority = [...classCounts.values()].reduce((m, n) => Math.max(m, n), 0);
  report.metrics['recommendation.majorityBaselineKindAccuracy'] = ratio(majority, evalN);
  report.metrics['recommendation.supportedApplicableRate'] = ratio(supported, issued);
  report.metrics['recommendation.falseAdviceRate'] = ratio(falseAdvice, issued);
  report.metrics['recommendation.eligibleCoverage'] = ratio(helped, eligible);
  report.metrics['recommendation.missedOpportunityRate'] = ratio(missed, reuseExpected);
  report.counts['recommendation.problemsWithoutOutput'] = noOutput;
  return report;
}

// ---------------------------------------------------------------- question value and burden

export interface QuestionRun {
  problemId: string;
  questions: Array<{ conditionKey: string; recipientId: string; /** false when timed out, unavailable or no-answer */ answered: boolean }>;
}

/**
 * hardRuleViolations: violations counted by the system's own policy layer. A question addressed to a person who
 * is unavailable in the visible directory (opts.unavailable) is an eligibility violation and is added to it.
 * A gap that nobody available can answer (gap.unanswerable, or every answerer unavailable) leaves the
 * gapFound denominator: asking no one is correct there.
 */
export function questionValueAndBurden(
  runs: QuestionRun[],
  problems: Problem[],
  hardRuleViolations: number,
  familyOf: (problemId: string) => string | undefined = () => undefined,
  opts: { unavailable?: ReadonlySet<string> | string[] } = {},
): MetricReport {
  const unavailable = new Set(opts.unavailable ?? []);
  let askedUnavailable = 0;
  const report: MetricReport = { metrics: {}, counts: {}, failures: [] };
  const runBy = new Map(runs.map((r) => [r.problemId, r]));
  let gapProblems = 0;
  let gapFound = 0;
  let noQProblems = 0;
  let unnecessary = 0;
  let questionsOnGapProblems = 0;
  let wrongRecipient = 0;
  let totalQuestions = 0;
  let unanswered = 0;
  let unreachableGaps = 0;
  let investigations = 0;
  const perPerson: Record<string, number> = {};
  for (const p of problems) {
    const run = runBy.get(p.id);
    if (!run) continue;
    investigations++;
    const f = (metric: string, reason: string) => report.failures.push({ id: p.id, familyId: familyOf(p.id), metric, reason });
    totalQuestions += run.questions.length;
    for (const q of run.questions) {
      perPerson[q.recipientId] = (perPerson[q.recipientId] ?? 0) + 1;
      if (!q.answered) unanswered++;
    }
    for (const q of run.questions) {
      if (unavailable.has(q.recipientId)) {
        askedUnavailable++;
        f('question.askedUnavailable', `asked ${q.recipientId}, who is unavailable (hard eligibility rule)`);
      }
    }
    const gap = p.key.consequentialGap;
    if (gap) {
      const reachable = !gap.unanswerable && gap.answerers.some((a) => !unavailable.has(a));
      if (reachable) {
        gapProblems++;
        const keys = new Set(gapConditionKeys(p.key, p.observations));
        if (run.questions.some((q) => keys.has(q.conditionKey))) gapFound++;
        else f('question.gapFoundRate', `consequential gap not asked about (${[...keys].join(', ')})`);
      } else unreachableGaps++;
      for (const q of run.questions) {
        questionsOnGapProblems++;
        if (!gap.answerers.includes(q.recipientId)) {
          wrongRecipient++;
          f('question.wrongRecipientRate', `asked ${q.recipientId}, answerers ${gap.answerers.join(', ')}`);
        }
      }
    }
    if (p.key.noQuestionNeeded) {
      noQProblems++;
      if (run.questions.length > 0) {
        unnecessary++;
        f('question.unnecessaryQuestionRate', `asked ${run.questions.length} question(s) where none was needed`);
      }
    }
  }
  report.metrics['question.gapFoundRate'] = ratio(gapFound, gapProblems);
  report.metrics['question.unnecessaryQuestionRate'] = ratio(unnecessary, noQProblems);
  report.metrics['question.wrongRecipientRate'] = ratio(wrongRecipient, questionsOnGapProblems);
  report.metrics['question.questionsPerInvestigation'] = ratio(totalQuestions, investigations);
  report.metrics['question.unansweredRate'] = ratio(unanswered, totalQuestions);
  report.counts['question.missedConsequentialGaps'] = gapProblems - gapFound;
  report.counts['question.hardRuleViolations'] = hardRuleViolations + askedUnavailable;
  report.counts['question.askedUnavailable'] = askedUnavailable;
  report.counts['question.gapsNobodyAvailableCanAnswer'] = unreachableGaps;
  report.counts['question.maxInterruptionsPerPerson'] = Object.values(perPerson).reduce((m, n) => Math.max(m, n), 0);
  report.counts['question.investigationsEvaluated'] = investigations;
  return report;
}

// ---------------------------------------------------------------- incoming linking and access

/** Does the case a problem was linked to point at the right historical incident(s)? */
export function incomingLinking(
  links: Array<{ problemId: string; linkedCaseIds: string[] }>,
  sys: Pick<SystemKnowledge, 'cases' | 'evidenceSourceIds'>,
  truth: ScenarioTruth,
  problems: Problem[],
): MetricReport {
  const report: MetricReport = { metrics: {}, counts: {}, failures: [] };
  const fail = tag(report, truth.familyId);
  const idx = new TruthIndex(truth);
  const caseIncs = new Map(sys.cases.map((c) => [c.id, incidentsOf(sourcesOf(c.evidenceIds.map((evidenceId) => ({ evidenceId })), sys.evidenceSourceIds), idx)]));
  const linkBy = new Map(links.map((l) => [l.problemId, l]));
  let relevantFound = 0;
  let relevantTotal = 0;
  let linkedCorrect = 0;
  let linkedTotal = 0;
  for (const p of problems) {
    const l = linkBy.get(p.id);
    const want = new Set(p.key.relatedIncidentKeys);
    relevantTotal += want.size;
    const got = new Set((l?.linkedCaseIds ?? []).flatMap((c) => caseIncs.get(c) ?? []));
    for (const w of want) {
      if (got.has(w)) relevantFound++;
      else fail({ id: p.id, metric: 'linking.recall', reason: `related incident ${w} not linked` });
    }
    for (const g of got) {
      linkedTotal++;
      if (want.has(g)) linkedCorrect++;
      else fail({ id: p.id, metric: 'linking.precision', reason: `linked unrelated incident ${g}` });
    }
  }
  report.metrics['linking.recall'] = ratio(relevantFound, relevantTotal);
  report.metrics['linking.precision'] = ratio(linkedCorrect, linkedTotal);
  return report;
}

/** Hard-rule check: a shown source must belong to an incident the requester's groups may see. */
export function accessLeakage(
  shown: Array<{ problemId: string; requesterId: string; sourceIds: string[] }>,
  truth: ScenarioTruth,
  people: PeopleDirectory,
): MetricReport {
  const report: MetricReport = { metrics: {}, counts: {}, failures: [] };
  const fail = tag(report, truth.familyId);
  const idx = new TruthIndex(truth);
  let leaks = 0;
  let total = 0;
  for (const s of shown) {
    const groups = new Set(people.people.find((p) => p.id === s.requesterId)?.groups ?? []);
    for (const src of s.sourceIds) {
      const incKey = idx.incidentOf.get(normalizeSourceId(src));
      const inc = incKey ? idx.incident(incKey) : undefined;
      if (!inc) continue;
      total++;
      if (!inc.accessGroups.some((g) => groups.has(g))) {
        leaks++;
        fail({ id: s.problemId, metric: 'access.leakageRate', reason: `source ${src} (incident ${inc.key}, groups ${inc.accessGroups.join('/')}) shown to ${s.requesterId}` });
      }
    }
  }
  report.metrics['access.leakageRate'] = ratio(leaks, total);
  return report;
}

// ---------------------------------------------------------------- efficiency

export function efficiency(input: { latenciesMs: number[]; calls?: number; tokens?: number }): MetricReport {
  const report: MetricReport = { metrics: {}, counts: {}, failures: [] };
  const xs = [...input.latenciesMs].sort((a, b) => a - b);
  const pick = (q: number) => (xs.length ? xs[Math.min(xs.length - 1, Math.ceil(q * xs.length) - 1)]! : null);
  const sum = xs.reduce((a, b) => a + b, 0);
  report.metrics['efficiency.meanLatencyMs'] = ratio(sum, xs.length);
  report.counts['efficiency.p50LatencyMs'] = pick(0.5);
  report.counts['efficiency.p95LatencyMs'] = pick(0.95);
  report.counts['efficiency.maxLatencyMs'] = xs.length ? xs[xs.length - 1]! : null;
  report.counts['efficiency.samples'] = xs.length;
  report.counts['efficiency.calls'] = input.calls ?? null; // null = not measured (never invented as 0)
  report.counts['efficiency.tokens'] = input.tokens ?? null;
  return report;
}

// ---------------------------------------------------------------- slices

export function sliceFailuresByTag(failures: FailureExample[], families: FamilyManifestEntry[]): Record<string, { count: number; ids: string[] }> {
  const tagsOf = new Map(families.map((f) => [f.id, f.tags as string[]]));
  const out: Record<string, { count: number; ids: string[] }> = {};
  for (const f of failures) {
    const tags = (f.familyId && tagsOf.get(f.familyId)) || ['untagged'];
    for (const t of tags) {
      const e = out[t] ?? (out[t] = { count: 0, ids: [] });
      e.count++;
      if (!e.ids.includes(f.id)) e.ids.push(f.id);
    }
  }
  return out;
}

/** Merge several reports into one (metrics must be disjoint or are summed by numerator/denominator). */
export function mergeReports(reports: MetricReport[]): MetricReport {
  const out: MetricReport = { metrics: {}, counts: {}, failures: [] };
  for (const r of reports) {
    for (const [k, m] of Object.entries(r.metrics)) {
      const prev = out.metrics[k];
      if (!prev) out.metrics[k] = m;
      else if (m) out.metrics[k] = ratio(prev.numerator + m.numerator, prev.denominator + m.denominator);
    }
    for (const [k, v] of Object.entries(r.counts)) {
      const prev = out.counts[k];
      out.counts[k] = prev == null ? v : v == null ? prev : prev + v;
    }
    out.failures.push(...r.failures);
  }
  return out;
}
