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
 * cited by a recommendation - links made without an answer) / case claims. An answer to an applicability question
 * scopes the case (it applies, or it does not apply to this unit) and never supports or contradicts its claims
 * (D-B2-66); only an answer about the claim itself (an outcome report) does.
 */
import type { Attempt, Case, Claim, KnowledgeStore, Outcome } from '../contracts/index.ts';
import { canSee } from './access.ts';
import { isLive } from './case-builder.ts';
import { independentSources } from './commit.ts';
import { parseGapId } from '../investigation/gaps.ts';

export const STORE_METRIC_METHOD = 'store-metric-delta@1';
export const SLOTS = ['symptom', 'distinguishing', 'attempt', 'outcome', 'lasting', 'validity'] as const;
export type CompletenessSlot = (typeof SLOTS)[number];

export interface StoreHealthOptions {
  /** Engine clock (the retrieval window and the 90-day validity check are measured against it). */
  now: Date;
  /** Keys whose value decides applicability (InvestigationSettings.distinguishingKeys). */
  distinguishingKeys?: string[];
  /**
   * A key counts as known when one of its aliases is (unit.age is known from an installation year or a batch). A
   * distinguishing key that is an alias of another distinguishing key is not counted on its own.
   */
  keyAliases?: Record<string, string[]>;
  /** Observation key an answered outcome question records (investigation OUTCOME_KEY). */
  outcomeKey?: string;
  windowDays?: number;
  validityDays?: number;
  /**
   * Case-to-case links made by the system (B1 pairing). Links made without an answer count against correctness. When
   * absent, `pairingLinks` over the measured cases is used, so every caller (the engine, the coordinator's reward and
   * expected gain, E10) counts the same term.
   */
  links?: (store: KnowledgeStore) => { made: number; withoutAnswer: number };
  /** Only these cases (the cases a question touched). */
  caseIds?: string[];
}

export interface CaseHealth {
  caseId: string;
  title: string;
  slots: Record<CompletenessSlot, number>;
  /** Distinguishing keys of the slot that are still unknown for this case (aliases folded into their key). */
  unknownKeys: string[];
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
  /** The case claims counted as supported (>=2 independent sources or an observed outcome). */
  supportedClaimIds: string[];
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
// B5 (D-B5-06): a production batch, like an installation year, tells the unit's generation, so it counts toward unit.age
// and is not a slot of its own (a distinguishing key that is another key's alias is left out of the denominator).
const DEFAULT_ALIASES: Record<string, string[]> = { 'unit.age': ['unit.installed_year', 'unit.batch'] };
const DAY = 86_400_000;
const round = (x: number): number => Math.round(x * 10_000) / 10_000;

/** Investigations in the window that cited each case among their candidates. */
export function retrievalCounts(store: KnowledgeStore, now: Date, windowDays = 30, excludeInvestigationId?: string): Map<string, number> {
  const from = now.getTime() - windowDays * DAY;
  const out = new Map<string, number>();
  for (const inv of store.list('investigation')) {
    if (inv.id === excludeInvestigationId) continue;
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

  // A key is filled by a recorded value, a recorded absence, or an answered applicability question on this case: a Yes
  // records the value (the current unit's, which matches the case). A No ("does the earlier unit share this unit's X?")
  // says only that the case's value differs from this unit's: it is neither the case's value nor a statement that the
  // key does not apply. The metric counts it as filling the key all the same, an approximation of brief 5.1's "a value
  // or an explicit 'not applicable'" (D-B2-75): the question was settled by an attributed answer, and the key is not
  // asked again. Limited to the asked key and its aliases.
  const known = (key: string): boolean => {
    const keys = [key, ...(o.keyAliases[key] ?? [])];
    return c.conditions.some((x) => keys.includes(x.key) && x.evidence.length > 0 && (x.value !== undefined || x.operator === 'absent'))
      || claims.some((x) => x.type === 'condition' && !!x.condition && keys.includes(x.condition.key) && (x.condition.value !== undefined || x.condition.operator === 'absent'))
      || answered.some((x) => keys.includes(x.condition.key));
  };
  const keys = slotKeys(o.distinguishingKeys, o.keyAliases);
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
  return { caseId: c.id, title: c.title, slots, unknownKeys: keys.filter((k) => !known(k)), completeness: round(total / SLOTS.length), singleton: filled <= 2, thinPair, retrievals };
}

/**
 * Whether an answer was given to an applicability question (a `missing` gap: "does the earlier unit share this unit's
 * <key>?"). Such an answer says whether the earlier case matches the current unit, not whether the case was right
 * (D-B2-66, superseding D-B2-51): its Yes records the value and its No records that the case's value differs from
 * this unit's (both fill the distinguishing slot through the answered Observation; for the No that approximates brief
 * 5.1's "explicit not applicable", D-B2-75), and neither supports nor contradicts the case's claims.
 */
export function isApplicabilityAnswer(store: KnowledgeStore, answer: { questionId: string }): boolean {
  const q = store.get('question', answer.questionId);
  return !!q && parseGapId(q.candidate.gapId)?.kind === 'missing';
}

/**
 * Support a claim gains from answers that confirmed it (an answer is attributed evidence of its own), and the answers
 * that contradicted it. Applicability answers are left out (see isApplicabilityAnswer): only an answer about the claim
 * itself (an outcome report: "did it recover?") supports or contradicts it.
 */
function answerRefs(store: KnowledgeStore): Map<string, { support: string[]; contradict: number }> {
  const m = new Map<string, { support: string[]; contradict: number }>();
  for (const a of store.list('answer')) {
    if (isApplicabilityAnswer(store, a)) continue;
    for (const u of a.claimUpdates) {
      const e = m.get(u.claimId) ?? { support: [], contradict: 0 };
      if (u.change === 'support') e.support.push(a.evidenceId);
      if (u.change === 'contradict') e.contradict++;
      m.set(u.claimId, e);
    }
  }
  return m;
}

/**
 * Brief 5.2 "links made without an answer": the system's case-to-case links are B1's pairing Patterns. A confirmed one
 * touching a measured case without the answer that confirmed it counts against correctness. The coordinator writes a
 * pairing only with its answer, so this is 0 by construction today; it is counted, not assumed (D-B6-29).
 */
export function pairingLinks(store: KnowledgeStore, caseIds: Set<string>): { made: number; withoutAnswer: number } {
  const made = store.list('pattern').filter((x) => x.status === 'confirmed' && x.caseIds.some((id) => caseIds.has(id)));
  return { made: made.length, withoutAnswer: made.filter((x) => !x.answerId).length };
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
  const supportedClaimIds: string[] = [];
  for (const x of claims) {
    const extra = ans.get(x.id);
    const refs = [...x.supporting, ...(extra?.support ?? []).map((evidenceId) => ({ evidenceId }))];
    if (observedSupport.has(x.id) || independentSources(store, refs) >= 2) {
      supported++;
      supportedClaimIds.push(x.id);
    }
    const contradicted = x.status === 'contradicted' || (extra?.contradict ?? 0) > (extra?.support.length ?? 0);
    if (contradicted && cited.has(x.id)) contradictedCited++;
  }
  const links = opts.links?.(store) ?? pairingLinks(store, ids);
  const correctness = claims.length ? round((supported - contradictedCited - links.withoutAnswer) / claims.length) : null;
  return {
    cases, completeness: round(weighted), completenessUnweighted: round(unweighted), correctness, supportedClaimIds,
    singletons: cases.filter((c) => c.singleton).length, thinPairs: cases.filter((c) => c.thinPair).length,
    denominators: { cases: cases.length, retrievals: weight, windowDays, caseClaims: claims.length, supportedClaims: supported, contradictedCited, linksWithoutAnswer: links.withoutAnswer },
  };
}

/** completeness x correctness, the quantity the reward is the change of (correctness null counts as 0 here). */
export const healthProduct = (h: StoreHealth): number => round(h.completeness * (h.correctness ?? 0));
/** completeness x correctness, or null when it cannot be measured (no case, or no case claim so correctness is null). */
export const healthProductOrNull = (h: StoreHealth): number | null => (h.cases.length === 0 || h.correctness === null ? null : round(h.completeness * h.correctness));

/** The keys the distinguishing slot counts: a distinguishing key that is an alias of another distinguishing key is left out. */
export function slotKeys(distinguishingKeys: string[] = DEFAULT_KEYS, aliases: Record<string, string[]> = DEFAULT_ALIASES): string[] {
  const aliased = new Set(Object.entries(aliases).filter(([k]) => distinguishingKeys.includes(k)).flatMap(([, a]) => a));
  return distinguishingKeys.filter((k) => !aliased.has(k));
}

/** The distinguishing key a condition key counts toward (unit.installed_year and unit.batch count toward unit.age). */
export function canonicalKey(key: string, aliases: Record<string, string[]> = DEFAULT_ALIASES): string {
  return Object.entries(aliases).find(([, a]) => a.includes(key))?.[0] ?? key;
}

/**
 * Chance that an outcome question is answered Yes, for the expected gain. No answer history is used: an uninformed 0.5
 * (the store records no base rate of recoveries that could be read without an answer key).
 */
export const P_CONFIRM = 0.5;

/** What one case looks like to a candidate question, for the expected gain (brief 5.3). */
export interface GainInput {
  /** Gap kind of the question (investigation/gaps.ts GapKind). */
  kind: string;
  /** The case's completeness (0..1) and correctness (null = unknown, counts as 0 as in healthProduct). */
  completeness: number;
  correctness: number | null;
  /** Case claims (the correctness denominator). */
  caseClaims: number;
  slots: Pick<Record<CompletenessSlot, number>, 'symptom' | 'distinguishing' | 'outcome' | 'lasting'>;
  /** Number of distinguishing keys the slot counts (an alias of another key is not counted). */
  distinguishingKeys: number;
  /** missing: whether the gap's key is still unknown for the case (CaseHealth.unknownKeys). */
  keyUnknown?: boolean;
  /** outcome: whether the claim the answer would confirm is already supported (then a confirmation adds nothing). */
  targetSupported?: boolean;
}

/**
 * Brief 5.3: the gain in completeness x correctness of the case a question touches if its gap is filled, under the
 * metric's own reading (D-B2-66). Pure.
 * - missing (applicability): either answer fills the key (a Yes the value, a No that the case differs, D-B2-75): completeness +1/(6k)
 *   when the key is unknown; correctness unchanged (an applicability answer is not a source for the claim).
 * - outcome: the outcome slot (+1/6 when empty: either answer fills it) and, when the claim a Yes would confirm is not
 *   supported yet, one more supported claim (+1/n: an outcome report is an attributed source of its own) weighted by
 *   P_CONFIRM, the chance of a Yes. The No branch adds no supported claim and is taken as 0 for correctness: a No
 *   contradicts the claim, and the rebuilt investigation stops recommending it (on the demo store an outcome No
 *   measures 0, tests/store-health.test.ts). So the gain is an expectation over both answers, not the Yes branch alone
 *   (review of D-B2-67).
 * - lasting: the lasting slot (+1/6 when empty). missing-symptom: the symptom slot (+1/6 when empty).
 * - pairing and anything else: 0 (a confirmed link with its answer neither adds nor costs correctness).
 * gain = (c + dc)(r + dr) - c r. With a case whose correctness is 0 a completeness-only gap gains 0: the product hides it,
 * as it does in the measured reward.
 */
export function expectedGain(i: GainInput): number {
  const c = i.completeness;
  const r = i.correctness ?? 0;
  const slot = 1 / SLOTS.length;
  let dc = 0;
  let dr = 0;
  if (i.kind === 'missing') dc = i.keyUnknown && i.distinguishingKeys > 0 ? slot / i.distinguishingKeys : 0;
  else if (i.kind === 'outcome') {
    dc = i.slots.outcome < 1 ? slot : 0;
    dr = i.targetSupported === false && i.caseClaims > 0 ? P_CONFIRM / i.caseClaims : 0;
  } else if (i.kind === 'lasting') dc = i.slots.lasting < 1 ? slot : 0;
  else if (i.kind === 'missing-symptom') dc = i.slots.symptom < 1 ? slot : 0;
  return round(Math.max(0, (c + dc) * (r + dr) - c * r));
}
