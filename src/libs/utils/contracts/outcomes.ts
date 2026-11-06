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
  summary: string;
  at: Iso;
}

export interface ParticipationBalance {
  personEntityId: string;
  points: number;
  events: ParticipationEvent[];
  enabled: boolean;
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
