import type { ActorRef, Iso } from './common.ts';

export type QuestionKind = 'quick' | 'evaluative';
export type AnswerValue = 'yes' | 'no' | 'unknown';

export interface QuestionCandidate {
  id: string;
  orgId: string;
  investigationId: string;
  gapId: string;
  kind: QuestionKind;
  text: string;
  answerType: 'yes-no' | 'yes-no-unknown';
  targetClaimId?: string;
  scope: { entityIds: string[]; caseId?: string; timeWindow?: string };
  rationale: string;
  consequences: { yes: string; no: string };
  generatedBy: { route: string; version: string };
  /** Normalized key for duplicate suppression. */
  dedupKey: string;
  /** Candidate recipients, each with a question-specific reason to know/observe. */
  recipientIds: string[];
  /** B2 phrase slot: the template's own wording, kept when a model's wording replaced `text`. */
  templateText?: string;
  /**
   * B2 phrase slot: who worded `text`. 'model' only when the model's sentence passed the validator; 'template' with a
   * reason when the phrase slot was on but its wording was rejected or the call failed. Absent with the slot on rules.
   */
  phrasing?: { by: 'model' | 'template'; reason?: string };
}

export type EligibilityViolation =
  | 'access'
  | 'budget'
  | 'cooldown'
  | 'duplicate'
  | 'not-answerable'
  | 'unavailable'
  | 'already-asked'
  | 'gap-resolved'
  | 'self';

export interface RecipientEligibility {
  questionId: string;
  personEntityId: string;
  eligible: boolean;
  /** Question-specific reasons this person could know/observe the answer. */
  reasons: string[];
  violations: EligibilityViolation[];
  evaluatedAt: Iso;
}

export interface EligibleAction {
  questionId: string;
  personEntityId: string;
}

/** The selector's output. Hard eligibility is applied before, never by, the selector. */
export interface PolicyDecision {
  id: string;
  orgId: string;
  investigationId: string;
  selector: { id: string; version: string; route: 'rules' | 'local' | 'replay' };
  eligible: EligibleAction[];
  chosen: EligibleAction | 'defer';
  /** Actual selection probability when randomized; 1 for deterministic rules. */
  propensity: number;
  /** Visible features used (never hidden scenario truth). */
  features?: Record<string, number>;
  reason: string;
  at: Iso;
}

export type QuestionStatus = 'queued' | 'delivered' | 'answered' | 'deferred' | 'dismissed' | 'cancelled' | 'expired';

export interface QuestionRecord {
  id: string;
  orgId: string;
  candidate: QuestionCandidate;
  personEntityId: string;
  decisionId: string;
  status: QuestionStatus;
  answerId?: string;
  cancelReason?: 'gap-resolved' | 'duplicate' | 'obsolete' | 'requester' | 'agent';
  createdAt: Iso;
  updatedAt: Iso;
  deliveredAt?: Iso;
  /** Previous status, to support Undo of dismiss/answer in the UI. */
  previousStatus?: QuestionStatus;
  /**
   * B2 (BUILD_BRIEF 5.4): the measured reward of the answer. `before`/`after` are completeness x correctness of the
   * touched cases before the answer was stored and after the rebuild (again after an outcome lands, for outcome
   * questions); `value` = delta - burden is what the selector learned from.
   */
  reward?: { method: string; cases: string[]; before: number; after: number; delta: number; burden: number; value: number; at: Iso; outcomeAt?: Iso };
}

export interface ClaimUpdate {
  claimId: string;
  change: 'support' | 'contradict' | 'no-change';
  note: string;
}

export interface Answer {
  id: string;
  orgId: string;
  questionId: string;
  personEntityId: string;
  value: AnswerValue;
  text?: string;
  at: Iso;
  /** Attributed, scoped updates; Unknown produces no factual update. */
  claimUpdates: ClaimUpdate[];
  /** The evidence record created for this answer so it is citable. */
  evidenceId: string;
}

/** Separate type: preference between two questions, never factual evidence. */
export interface PreferenceFeedback {
  id: string;
  orgId: string;
  personEntityId: string;
  comparedQuestionIds: [string, string];
  preferred: 'a' | 'b' | 'equal' | 'neither' | 'unsure';
  at: Iso;
}

export interface CoordinatorSettings {
  dailyLimitPerPerson: number;
  cooldownMinutes: number;
  maxOpenQuestionsPerPerson: number;
  maxQuestionsPerInvestigation: number;
  /** 'rules' | 'bandit' | 'ranker' — the selector in use; baseline always available. */
  selectorId: string;
}

export const defaultCoordinatorSettings: CoordinatorSettings = {
  dailyLimitPerPerson: 3,
  cooldownMinutes: 30,
  maxOpenQuestionsPerPerson: 1,
  maxQuestionsPerInvestigation: 3,
  selectorId: 'rules',
};

export interface ContactDraft {
  id: string;
  investigationId: string;
  personEntityId: string;
  to: ActorRef;
  subject: string;
  body: string;
  /** Always true: drafts are reviewed by the user; nothing is sent by the system. */
  requiresReview: true;
  createdAt: Iso;
}
