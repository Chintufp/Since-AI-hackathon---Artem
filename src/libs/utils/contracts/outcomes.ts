import type { ModelSlots } from './models.ts';
import type { ActorRef, Condition, Iso } from './common.ts';
import type { Lasting, OutcomeResult } from './memory.ts';
import type { EligibleAction } from './questions.ts';

export type ReporterType = 'human' | 'agent' | 'system';

export interface OutcomeReport {
  id: string;
  orgId: string;
  investigationId: string;
  decisionId?: string;
  caseId?: string;
  reporter: { type: ReporterType; id: string; displayName: string };
  attemptedAction?: string;
  result: OutcomeResult;
  observedAt: Iso;
  lasting: Lasting;
  text?: string;
  observations?: Condition[];
  /** Evidence/outcome records created by this report. */
  createdEvidenceId: string;
  createdOutcomeId?: string;
}

/** Logged per decision for later evaluation/learning. Hidden truth never appears here. */
export interface EvaluationRecord {
  decisionId: string;
  investigationId: string;
  at: Iso;
  stateFeatures: Record<string, number>;
  eligible: EligibleAction[];
  action: EligibleAction | 'defer';
  propensity: number;
  response?: { value: 'yes' | 'no' | 'unknown' | 'none'; latencyMs?: number };
  /** Independently assessed benefit; null means unknown/missing, never zero. */
  assessedBenefit: { value: number; method: string } | null;
  effort: { questionsAsked: number; interruptions: number; estimatedSeconds?: number };
  missingFeedback: boolean;
}

export interface ParticipationEvent {
  id: string;
  orgId: string;
  personEntityId: string;
  /** Deduplicated by contribution event id (answerId/outcomeId) so retries never award twice. */
  contributionEventId: string;
  kind: 'answer-yes' | 'answer-no' | 'answer-unknown' | 'correction' | 'evidence' | 'outcome-report' | 'defer' | 'dismiss';
  points: number;
  /** Neutral wording only ("Answered a question (yes)"); never question, evidence or report text. */
  summary: string;
  /** The question, investigation or evidence id the contribution belongs to (an id, never text). */
  refId?: string;
  at: Iso;
}

/** One record per person: whether they take part in points. Absent means no (R46). */
export interface ParticipationOptIn {
  id: string;
  orgId: string;
  personEntityId: string;
  participates: boolean;
  /** When the current choice was made. */
  since: Iso;
}

export interface ParticipationBalance {
  personEntityId: string;
  /** False: the person does not take part; points and events are then empty (rows are kept, not served). */
  participates: boolean;
  points: number;
  events: ParticipationEvent[];
}

export interface ParticipationRow {
  personEntityId: string;
  displayName: string;
  /** All-time points. */
  balance: number;
  /** Points in the last 7 days. */
  recent: number;
  answered: number;
  outcomes: number;
  /** 1-based, by balance (ties share a rank). */
  rank: number;
}

/** Rating among the people who take part. Nobody else appears, in any field. */
export interface ParticipationRating {
  period: { recentDays: number; recentFrom: Iso };
  /** The requesting person, when they take part; null otherwise (or when no person was given). */
  me: { personEntityId: string; balance: number; recent: number; rank: number; events: ParticipationEvent[] } | null;
  participants: ParticipationRow[];
  totals: { participants: number; points: number; recent: number };
}

export interface UserSettings {
  points: boolean;
  sound: boolean;
  reducedMotion: boolean;
  /** Current user (who answers questions in the desktop app). */
  currentPersonEntityId?: string;
  serverUrl: string;
  provider: 'local';
  model: string;
  mcp: boolean;
  /** Model slots (embed / extract / phrase). Absent means every slot on rules. Never holds an API key. */
  models?: ModelSlots;
}

export const defaultUserSettings: UserSettings = {
  points: false,
  sound: false,
  reducedMotion: false,
  serverUrl: 'http://127.0.0.1:47831',
  provider: 'local',
  model: 'rules+local · no API',
  mcp: true,
};

export type Reporter = ActorRef;
