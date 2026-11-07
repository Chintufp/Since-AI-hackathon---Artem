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
  /** Status of the question loop. */
  loop: 'no-question-needed' | 'question-open' | 'deferred' | 'answered' | 'exhausted';
  /** Short human reason for 'deferred' / 'exhausted' / 'no-question-needed' (shown in the UI). */
  loopReason?: string;
  events: TraceEvent[];
  /** Explicit list of routes used, so simulated/replayed stages are visible. */
  routes: RouteInfo[];
}
