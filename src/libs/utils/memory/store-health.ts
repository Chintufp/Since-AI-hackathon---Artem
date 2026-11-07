/**
 * The official store metric (BUILD_BRIEF 5.1, 5.2): how full and how correct the store is, measured from the store
 * itself, never from a human label. The bandit's reward is the measured change of completeness x correctness of the
 * cases a question touched (5.4).
 *
 * Completeness of a case: six slots (symptom, distinguishing conditions, attempt with a performer, outcome of the
 * corrective attempt, lasting, validity of the advice). Store completeness is the mean over cases weighted by how
 * often investigations cited each case in the last 30 days of the engine clock (the unweighted mean is reported too).
 *
 * Correctness: (claims supported by >=2 independent sources or by an observed outcome - contradicted claims still
 * cited by a recommendation - links made without an answer) / case claims.
 */
import type { Attempt, Case, Claim, KnowledgeStore, Outcome } from '../contracts/index.ts';
import { canSee } from './access.ts';
import { isLive } from './case-builder.ts';
import { independentSources } from './commit.ts';

export const STORE_METRIC_METHOD = 'store-metric-delta@1';
export const SLOTS = ['symptom', 'distinguishing', 'attempt', 'outcome', 'lasting', 'validity'] as const;
export type CompletenessSlot = (typeof SLOTS)[number];

export interface StoreHealthOptions {
  /** Engine clock (the retrieval window and the 90-day validity check are measured against it). */
  now: Date;
  /** Keys whose value decides applicability (InvestigationSettings.distinguishingKeys). */
  distinguishingKeys?: string[];
  /** A key counts as known when one of its aliases is (unit.age is known from an installation year). */
  keyAliases?: Record<string, string[]>;
  /** Observation key an answered outcome question records (investigation OUTCOME_KEY). */
  outcomeKey?: string;
  windowDays?: number;
  validityDays?: number;
  /** Case-to-case links made by the system (B1 pairing). Links made without an answer count against correctness. */
  links?: (store: KnowledgeStore) => { made: number; withoutAnswer: number };
  /** Only these cases (the cases a question touched). */
  caseIds?: string[];
}

export interface CaseHealth {
  caseId: string;
  title: string;
  slots: Record<CompletenessSlot, number>;
  /** Sum of slot values / 6 (the distinguishing slot counts known keys proportionally). */
  completeness: number;
  /** <= 2 slots filled. */
  singleton: boolean;
  /** Every live claim rests on one message. */
  thinPair: boolean;
  /** Investigations in the window whose candidates cite this case. */
  retrievals: number;
}

export interface StoreHealth {
  cases: CaseHealth[];
  /** Mean completeness weighted by retrievals in the window; the unweighted mean when nothing was retrieved. */
  completeness: number;
  completenessUnweighted: number;
  /** null when there is no case claim (unknown, never zero). */
  correctness: number | null;
  singletons: number;
  thinPairs: number;
  denominators: {
    cases: number;
    retrievals: number;
    windowDays: number;
    caseClaims: number;
    supportedClaims: number;
    contradictedCited: number;
    linksWithoutAnswer: number;
  };
}

const DEFAULT_KEYS = ['unit.age', 'unit.model', 'unit.revision', 'software.version'];
const DEFAULT_ALIASES: Record<string, string[]> = { 'unit.age': ['unit.installed_year'] };
const DAY = 86_400_000;
const round = (x: number): number => Math.round(x * 10_000) / 10_000;

/** Investigations in the window that cited each case among their candidates. */
export function retrievalCounts(store: KnowledgeStore, now: Date, windowDays = 30): Map<string, number> {
  const from = now.getTime() - windowDays * DAY;
  const out = new Map<string, number>();
  for (const inv of store.list('investigation')) {
    const t = Date.parse(inv.updatedAt ?? inv.createdAt);
    if (!(t >= from && t <= now.getTime() + DAY)) continue;
    for (const id of new Set(inv.candidates.map((c) => c.caseId).filter((x): x is string => !!x))) out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
}

const NON_CORRECTIVE = /check|inspect|log|monitor|measure|test|verify|look/i;

function caseHealth(store: KnowledgeStore, c: Case, o: Required<Pick<StoreHealthOptions, 'distinguishingKeys' | 'keyAliases' | 'outcomeKey' | 'validityDays'>> & { now: Date }, retrievals: number): CaseHealth {
  const claims = store.list('claim', { where: { caseId: c.id } }).filter(isLive);
  const attempts: Attempt[] = store.list('attempt', { where: { caseId: c.id } });
  const outcomes: Outcome[] = store.list('outcome', { where: { caseId: c.id } });
  const answered = store.list('observation').filter((x) => x.caseId === c.id);
  const reports = store.list('outcomeReport').filter((r) => r.caseId === c.id);

  const symptom = claims.some((x) => x.type === 'observation' && x.supporting.length > 0) ? 1 : 0;

  const known = (key: string): boolean => {
    const keys = [key, ...(o.keyAliases[key] ?? [])];
    return c.conditions.some((x) => keys.includes(x.key) && x.evidence.length > 0 && (x.value !== undefined || x.operator === 'absent'))
      || claims.some((x) => x.type === 'condition' && !!x.condition && keys.includes(x.condition.key) && (x.condition.value !== undefined || x.condition.operator === 'absent'))
      || answered.some((x) => keys.includes(x.condition.key));
  };
  const keys = o.distinguishingKeys;
  const distinguishing = keys.length ? keys.filter(known).length / keys.length : 1;

  const performed = attempts.filter((a) => a.performed === 'reported');
  const attempt = performed.some((a) => !!a.performedBy) ? 1 : 0;
  // The corrective attempt: the performed one with a reported outcome, preferring a non-diagnostic action. The case
  // builder may attach the outcome to the check that preceded the fix, so any outcome row of the case fills the slot.
  const score = (a: Attempt): number => (outcomes.some((x) => x.attemptId === a.id) ? 2 : 0) + (NON_CORRECTIVE.test(a.action) ? 0 : 1);
  const corrective = [...performed].sort((a, b) => score(b) - score(a))[0];
  const forCorrective = outcomes;
  const outcomeSlot = forCorrective.length > 0 || answered.some((x) => x.condition.key === o.outcomeKey) || reports.length > 0 ? 1 : 0;
  const lasting = forCorrective.some((x) => x.lasting !== 'unknown') || reports.some((r) => r.lasting !== 'unknown') ? 1 : 0;

  const advice = (corrective?.adviceClaimId ? claims.find((x) => x.id === corrective.adviceClaimId) : undefined) ?? claims.find((x) => x.type === 'advice');
  const checkedSince = o.now.getTime() - o.validityDays * DAY;
  const checked = !!advice && store.list('answer').some((a) => Date.parse(a.at) >= checkedSince && a.claimUpdates.some((u) => u.claimId === advice.id && u.change !== 'no-change'));
  const validity = advice && advice.validity.from?.known && (advice.validity.to || advice.validity.condition || checked) ? 1 : 0;

  const slots: Record<CompletenessSlot, number> = { symptom, distinguishing, attempt, outcome: outcomeSlot, lasting, validity };
  const total = SLOTS.reduce((n, s) => n + slots[s], 0);
  const filled = SLOTS.filter((s) => slots[s] >= 1).length;
  const thinPair = claims.length > 0 && claims.every((x) => new Set(x.supporting.map((r) => r.evidenceId)).size <= 1);
  return { caseId: c.id, title: c.title, slots, completeness: round(total / SLOTS.length), singleton: filled <= 2, thinPair, retrievals };
}

/** Support a claim gains from answers that confirmed it (an answer is attributed evidence of its own). */
function answerRefs(store: KnowledgeStore): Map<string, { support: string[]; contradict: number }> {
  const m = new Map<string, { support: string[]; contradict: number }>();
  for (const a of store.list('answer')) {
    for (const u of a.claimUpdates) {
      const e = m.get(u.claimId) ?? { support: [], contradict: 0 };
      if (u.change === 'support') e.support.push(a.evidenceId);
      if (u.change === 'contradict') e.contradict++;
      m.set(u.claimId, e);
    }
  }
  return m;
}

/** Claims behind a recommendation that still stands (anything but none / retain-uncertainty). */
function citedByRecommendation(store: KnowledgeStore): Set<string> {
  const out = new Set<string>();
  for (const inv of store.list('investigation')) {
    if (inv.recommendation.kind === 'none' || inv.recommendation.kind === 'retain-uncertainty') continue;
    for (const h of inv.hypotheses) if (h.applicability !== 'inapplicable') h.sourceClaimIds.forEach((id) => out.add(id));
  }
  return out;
}

/**
 * The store metric over the cases `principal` may see (all cases for a trusted caller). `caseIds` restricts it to the
 * cases a question touched (the reward).
 */
export function storeHealth(store: KnowledgeStore, principal: { id: string; groups: string[] } | undefined, opts: StoreHealthOptions): StoreHealth {
  const windowDays = opts.windowDays ?? 30;
  const o = {
    now: opts.now, distinguishingKeys: opts.distinguishingKeys ?? DEFAULT_KEYS, keyAliases: opts.keyAliases ?? DEFAULT_ALIASES,
    outcomeKey: opts.outcomeKey ?? 'outcome.result', validityDays: opts.validityDays ?? 90,
  };
  const only = opts.caseIds ? new Set(opts.caseIds) : undefined;
  const all = store.list('case').filter((c) => (!only || only.has(c.id)) && (!principal || canSee(c.accessScope, principal)));
  const freq = retrievalCounts(store, opts.now, windowDays);
  const cases = all.map((c) => caseHealth(store, c, o, freq.get(c.id) ?? 0));
  const weight = cases.reduce((n, c) => n + c.retrievals, 0);
  const unweighted = cases.length ? cases.reduce((n, c) => n + c.completeness, 0) / cases.length : 0;
  const weighted = weight ? cases.reduce((n, c) => n + c.completeness * c.retrievals, 0) / weight : unweighted;

  const ids = new Set(cases.map((c) => c.caseId));
  const claims: Claim[] = store.list('claim').filter((x) => !!x.caseId && ids.has(x.caseId) && isLive(x) && (!principal || canSee(x.accessScope, principal)));
  const ans = answerRefs(store);
  const cited = citedByRecommendation(store);
  const observedSupport = new Set<string>();
  for (const id of ids) {
    const atts = store.list('attempt', { where: { caseId: id } });
    for (const out of store.list('outcome', { where: { caseId: id } })) {
      if (out.basis !== 'observed' || (out.result !== 'recovered' && out.result !== 'partial')) continue;
      const a = atts.find((x) => x.id === out.attemptId);
      if (a?.adviceClaimId) observedSupport.add(a.adviceClaimId);
    }
  }
  let supported = 0, contradictedCited = 0;
  for (const x of claims) {
    const extra = ans.get(x.id);
    const refs = [...x.supporting, ...(extra?.support ?? []).map((evidenceId) => ({ evidenceId }))];
    if (observedSupport.has(x.id) || independentSources(store, refs) >= 2) supported++;
    const contradicted = x.status === 'contradicted' || (extra?.contradict ?? 0) > (extra?.support.length ?? 0);
    if (contradicted && cited.has(x.id)) contradictedCited++;
  }
  const links = opts.links?.(store) ?? { made: 0, withoutAnswer: 0 };
  const correctness = claims.length ? round((supported - contradictedCited - links.withoutAnswer) / claims.length) : null;
  return {
    cases, completeness: round(weighted), completenessUnweighted: round(unweighted), correctness,
    singletons: cases.filter((c) => c.singleton).length, thinPairs: cases.filter((c) => c.thinPair).length,
    denominators: { cases: cases.length, retrievals: weight, windowDays, caseClaims: claims.length, supportedClaims: supported, contradictedCited, linksWithoutAnswer: links.withoutAnswer },
  };
}

/** completeness x correctness, the quantity the reward is the change of (correctness null counts as 0 here). */
export const healthProduct = (h: StoreHealth): number => round(h.completeness * (h.correctness ?? 0));
/** completeness x correctness, or null when it cannot be measured (no case, or no case claim so correctness is null). */
export const healthProductOrNull = (h: StoreHealth): number | null => (h.cases.length === 0 || h.correctness === null ? null : round(h.completeness * h.correctness));
