import type { ActorRef, Condition, EvidenceRef, Iso, RouteInfo, SourceOrigin, TimeRef, AccessScope } from './common.ts';

export type EntityType = 'asset' | 'site' | 'person' | 'component' | 'software' | 'location' | 'organization' | 'other';

export interface Entity {
  id: string;
  orgId: string;
  type: EntityType;
  name: string;
  aliases: string[];
  /** Attributes with origin so inferred values stay distinguishable (e.g. installedYear: 2019, reported). */
  attributes: Record<string, { value: string | number | boolean; origin: SourceOrigin; evidence: EvidenceRef[] }>;
  evidence: EvidenceRef[];
  /** For person entities: the actor identities (per provider) resolved to this person. */
  actorIds?: string[];
  accessScope: AccessScope;
}

export type ClaimType =
  | 'observation' // something seen/measured, reported by a person
  | 'hypothesis' // a suggested cause, not confirmed
  | 'advice' // a recommended check/action
  | 'action' // an action reportedly performed
  | 'outcome' // reported result after an action
  | 'condition' // environment/equipment condition
  | 'access-fact' // non-incident operational fact (barrier key, site access)
  | 'identity' // who someone is / their role
  | 'other';

/**
 * 'superseded' (B1): a newer claim replaced this one (validity.to is set, supersededBy names the newer claim). The claim
 * keeps all its evidence and stays readable; it is not live for the persisted (now) case, but a past `at` inside its
 * validity window still sees it.
 */
export type ClaimStatus = 'provisional' | 'supported' | 'contradicted' | 'corrected' | 'retracted' | 'superseded';

/**
 * When a claim holds. `from` is the first evidence's event time (never defaulted to now); an unknown `from` means
 * "valid from before any dated moment"; an unknown `to` means "still believed true".
 */
export interface ClaimValidity {
  from?: TimeRef;
  to?: TimeRef;
  /** Human-readable condition under which the claim holds (e.g. 'software.version < 4.2', 'changes every October'). */
  condition?: string;
  /** B1: the claim (a superseding note) that set `condition`, when another claim bounded this one. */
  conditionedBy?: string;
  /** B1: how the newer/older order behind `to` was decided: by known event times, or by import order (undated). */
  orderBasis?: 'known-time' | 'import-order';
  /** B1: explicit validity cue found in the source (e.g. 'is now', 'every October', 'until 1 December'). */
  cue?: string;
  /** B1: the route that set `to` or `condition` from another claim (e.g. supersession-rules@1). */
  route?: RouteInfo;
}

export interface Claim {
  id: string;
  orgId: string;
  type: ClaimType;
  statement: string;
  subjectEntityIds: string[];
  caseId?: string;
  assertedBy?: ActorRef;
  origin: SourceOrigin;
  supporting: EvidenceRef[];
  contradicting: EvidenceRef[];
  validity: ClaimValidity;
  status: ClaimStatus;
  /** B1: the newer claim that superseded this one (status 'superseded'). Not the same as evidence metadata.supersededBy (a newer revision of a message). */
  supersededBy?: string;
  /**
   * B1: for a superseding note ("fixed in firmware 4.2"): the condition under which the note supersedes older advice
   * (e.g. software.version gte 4.2). A supersession bound, never a case condition.
   */
  supersessionBound?: Condition;
  extraction: { route: string; version: string };
  revision: number;
  createdAt: Iso;
  updatedAt: Iso;
  /** Structured condition when the claim expresses one (used by applicability checks). */
  condition?: Condition;
  accessScope: AccessScope;
}

export type CaseStatus = 'open' | 'reported-recovered' | 'unknown-outcome' | 'verified-resolved' | 'recurred';

export interface Gap {
  id: string;
  description: string;
  consequential: boolean;
  /** Required by the closed decision: what a plausible answer would change. */
  whatAnswerChanges: string;
  targetClaimId?: string;
  targetCondition?: { key: string; label: string };
  status: 'open' | 'resolved' | 'cancelled';
  resolvedBy?: { answerId?: string; evidenceId?: string; observationId?: string };
}

export interface Case {
  id: string;
  orgId: string;
  title: string;
  status: CaseStatus;
  entityIds: string[];
  observationClaimIds: string[];
  hypothesisClaimIds: string[];
  attemptIds: string[];
  outcomeIds: string[];
  gaps: Gap[];
  evidenceIds: string[];
  startedAt: TimeRef;
  /** Structured environment conditions known for this case (from claims). */
  conditions: Condition[];
  accessScope: AccessScope;
  createdAt: Iso;
  updatedAt: Iso;
}

export interface Attempt {
  id: string;
  orgId: string;
  caseId: string;
  action: string;
  advisedBy?: ActorRef;
  adviceClaimId?: string;
  performedBy?: ActorRef;
  performed: 'reported' | 'proposed-only' | 'unknown';
  when: TimeRef;
  evidence: EvidenceRef[];
}

export type OutcomeResult = 'recovered' | 'no-change' | 'worse' | 'partial' | 'unknown';
export type Lasting = 'unknown' | 'confirmed' | 'recurred';

export interface Outcome {
  id: string;
  orgId: string;
  caseId: string;
  attemptId?: string;
  reportedBy?: ActorRef;
  result: OutcomeResult;
  reportedAt: TimeRef;
  observationWindow?: string;
  lasting: Lasting;
  evidence: EvidenceRef[];
  /** 'reported' when a person said so; 'observed' when a system observation confirmed it. */
  basis: 'reported' | 'observed' | 'unknown';
}

export type ContributionType =
  | 'reported-problem'
  | 'advised'
  | 'performed-check'
  | 'performed-action'
  | 'reported-outcome'
  | 'observed-condition'
  | 'mentioned';

export interface PersonWorkLink {
  id: string;
  orgId: string;
  personEntityId: string;
  caseId?: string;
  claimId?: string;
  entityId?: string;
  contribution: ContributionType;
  firsthand: boolean;
  evidence: EvidenceRef[];
  recency: TimeRef;
  /** Provisional and correctable; corrections set status. */
  status: 'provisional' | 'confirmed' | 'rejected';
}

/** Reversible relationship among separate cases. Similar symptoms alone do not make one incident. */
export interface Pattern {
  id: string;
  orgId: string;
  title: string;
  caseIds: string[];
  sharedConditions: Condition[];
  distinguishingConditions: Condition[];
  createdBy: { route: string; version: string };
  status: 'candidate' | 'confirmed' | 'rejected';
  /** B1: the attributed answer that confirmed or rejected the relationship (a pairing is never linked without one). */
  evidence?: EvidenceRef[];
  answerId?: string;
  decidedAt?: Iso;
}

export interface Procedure {
  id: string;
  orgId: string;
  version: number;
  purpose: string;
  conditions: Condition[];
  steps: string[];
  verification: string[];
  supportingCaseIds: string[];
  failures: string[];
  limitations: string[];
  status: 'candidate' | 'reviewed';
}

/** A machine or human observation recorded against a case/investigation (not a question answer). */
export interface Observation {
  id: string;
  orgId: string;
  investigationId?: string;
  caseId?: string;
  condition: Condition;
  reportedBy: ActorRef | { id: 'agent' | 'system'; displayName: string };
  at: Iso;
}

export interface Correction {
  id: string;
  orgId: string;
  target: { type: 'claim' | 'link' | 'case' | 'outcome' | 'answer'; id: string };
  change: 'retract' | 'contradict' | 'confirm' | 'reassign';
  reason: string;
  by: ActorRef;
  at: Iso;
}
