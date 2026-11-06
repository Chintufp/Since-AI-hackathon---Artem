import type { ActorRef, Condition, EvidenceRef, Iso, SourceOrigin, TimeRef, AccessScope } from './common.ts';

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

export type ClaimStatus = 'provisional' | 'supported' | 'contradicted' | 'corrected' | 'retracted';

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
  validity: { from?: TimeRef; to?: TimeRef; condition?: string };
  status: ClaimStatus;
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
