import type { ActorRef, Condition, EvidenceRef, Iso, RouteInfo, TraceEvent } from './common.ts';
import type { Gap } from './memory.ts';

/** A new problem as entered by an engineer or an agent. */
export interface Problem {
  id: string;
  orgId: string;
  text: string;
  requester: ActorRef | { id: 'agent'; displayName: string; agentId: string };
  /** Entity ids the requester named (optional; extraction fills the rest). */
  entityIds?: string[];
  observations?: Condition[];
  attachmentNames?: string[];
  createdAt: Iso;
  /**
   * B1: point in time. When set, the investigation answers "what was known at `at`": evidence dated after it, answers and
   * observations recorded after it and claims not valid at it are left out; no question is ever asked.
   */
  at?: Iso;
}

export interface ExpectedTrait {
  /** A condition that should hold if the candidate applies (prediction to check). */
  condition: { key: string; label: string; expected: string | number | boolean };
  status: 'unchecked' | 'matches' | 'conflicts' | 'unobservable';
  basis: EvidenceRef[];
}

export interface CandidateMatch {
  /** Either a case or a procedure; both may be present for a procedure derived from a case. */
  caseId?: string;
  procedureId?: string;
  score: number;
  retrieval: RouteInfo;
  matchingConditions: Condition[];
  conflictingConditions: Condition[];
  missingConditions: Array<{ key: string; label: string }>;
  expectedTraits: ExpectedTrait[];
  /** Reasons shown to the user ("same symptom set", "same equipment family"). */
  reasons: string[];
}

export interface Hypothesis {
  id: string;
  statement: string;
  /** Source case/claims this hypothesis is drawn from. */
  basis: EvidenceRef[];
  sourceClaimIds: string[];
  /** Separately observable support vs applicability (E04 keeps them identifiable). */
  support: 'supported' | 'weak' | 'contradicted' | 'unknown';
  applicability: 'applicable' | 'qualified' | 'inapplicable' | 'unknown';
  assessment: RouteInfo;
  notes: string[];
}

/**
 * B5: another related hypothesis the recommendation did not pick, with the person who advised it firsthand ("Also on
 * record: Helmi Virtanen advised clearing the forwarding table in TRN-512 (qualified, depends on 2021 batch)"). Read-only:
 * listing it changes nothing in the store.
 */
export interface AlternativeHypothesis {
  caseId: string;
  /** Short case label ("TRN-512"). */
  caseLabel: string;
  hypothesisId: string;
  /** What was advised, as a gerund phrase ("clearing the forwarding table"). */
  label: string;
  action?: string;
  /** The person whose advice it was (firsthand 'advised' on that case). */
  expert: { personEntityId?: string; displayName: string; role?: string };
  support: Hypothesis['support'];
  applicability: Hypothesis['applicability'];
  /** Plain label of the distinguishing condition that decides it here (missing, else conflicting), when there is one. */
  deciding?: string;
  /** One line for the UI. */
  text: string;
}

export type RecommendationKind = 'reuse' | 'check-first' | 'qualified' | 'retain-uncertainty' | 'none';

export interface Recommendation {
  kind: RecommendationKind;
  text: string;
  basis: EvidenceRef[];
  applicability: 'supported' | 'qualified' | 'unsupported';
  caveats: string[];
  /** Next step phrased as a check before a disruptive action, when applicable. */
  nextStep?: string;
  /** Diagnostic checks need less evidence than disruptive corrective actions. */
  actionClass: 'diagnostic-check' | 'corrective-action' | 'none';
  /**
   * B1 part B: who to ask when an access fact is missing or may be out of date (directory people whose group/role is
   * configured to observe the key). `available` false with `back` when the person's own message states a return date.
   */
  askWho?: Array<{ personEntityId: string; displayName: string; role?: string; reason: string; available: boolean; back?: string }>;
}

export interface PersonResult {
  personEntityId: string;
  displayName: string;
  role?: string;
  reasons: Array<{ text: string; contribution: string; caseId?: string; evidence: EvidenceRef[]; firsthand: boolean }>;
  /** Access-filtered: only cases the requester may see are linked. */
  accessibleCaseIds: string[];
  /** Can this person currently be asked (budget/cooldown/eligibility summary)? */
  askable: boolean;
}

export interface Budget {
  personEntityId: string;
  dailyLimit: number;
  askedToday: number;
  cooldownMinutes: number;
  lastAskedAt?: Iso;
  openQuestionIds: string[];
}

export interface InvestigationState {
  /** Stable decision/trace id for UI, API and MCP consumers. */
  id: string;
  orgId: string;
  problem: Problem;
  createdAt: Iso;
  updatedAt: Iso;
  candidates: CandidateMatch[];
  hypotheses: Hypothesis[];
  gaps: Gap[];
  recommendation: Recommendation;
  people: PersonResult[];
  questionIds: string[];
  decisionIds: string[];
  /** B5: related hypotheses the recommendation did not pick, each with its expert (absent on older states). */
  alternatives?: AlternativeHypothesis[];
  /** Status of the question loop. */
  loop: 'no-question-needed' | 'question-open' | 'deferred' | 'answered' | 'exhausted';
  /** Short human reason for 'deferred' / 'exhausted' / 'no-question-needed' (shown in the UI). */
  loopReason?: string;
  events: TraceEvent[];
  /** Explicit list of routes used, so simulated/replayed stages are visible. */
  routes: RouteInfo[];
  /**
   * B1: 'standing' for the per-case state that carries capture-time gaps (missing symptom, outcome after 24 h, pairing).
   * It is asked through the same coordinator; its requester is a system principal whose groups admit the case.
   */
  origin?: 'standing';
}
