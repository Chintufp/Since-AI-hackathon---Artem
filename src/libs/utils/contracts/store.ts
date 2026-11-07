import type { EvidenceEnvelope, ImportBatch, ConnectionCard } from './evidence.ts';
import type { Attempt, Case, Claim, Correction, Entity, Observation, Outcome, Pattern, PersonWorkLink, Procedure } from './memory.ts';
import type { InvestigationState } from './investigation.ts';
import type { Answer, PolicyDecision, PreferenceFeedback, QuestionRecord, RecipientEligibility } from './questions.ts';
import type { EvaluationRecord, OutcomeReport, ParticipationEvent, ParticipationOptIn, UserSettings } from './outcomes.ts';
import type { TraceEvent } from './common.ts';

/** Record types persisted by the knowledge store. Each has a string `id`. */
export interface RecordTypes {
  evidence: EvidenceEnvelope;
  importBatch: ImportBatch;
  connection: ConnectionCard;
  entity: Entity;
  claim: Claim;
  case: Case;
  attempt: Attempt;
  outcome: Outcome;
  personLink: PersonWorkLink;
  pattern: Pattern;
  procedure: Procedure;
  observation: Observation;
  correction: Correction;
  investigation: InvestigationState;
  question: QuestionRecord;
  decision: PolicyDecision;
  eligibility: RecipientEligibility;
  answer: Answer;
  preference: PreferenceFeedback;
  outcomeReport: OutcomeReport;
  evaluation: EvaluationRecord;
  participation: ParticipationEvent;
  participationOptin: ParticipationOptIn;
  trace: TraceEvent;
  settings: UserSettings & { id: string };
}

export type RecordType = keyof RecordTypes;

export interface ListOptions {
  /** Equality filters on top-level string/number/boolean fields. */
  where?: Record<string, string | number | boolean | undefined>;
  limit?: number;
  /** Order by a top-level field (default: insertion order). */
  orderBy?: { field: string; direction?: 'asc' | 'desc' };
}

/**
 * Storage boundary. The only implementation tonight is SQLite (node:sqlite);
 * the interface stays small so PostgreSQL could replace it.
 */
export interface KnowledgeStore {
  put<T extends RecordType>(type: T, record: RecordTypes[T]): RecordTypes[T];
  putMany<T extends RecordType>(type: T, records: RecordTypes[T][]): number;
  get<T extends RecordType>(type: T, id: string): RecordTypes[T] | undefined;
  list<T extends RecordType>(type: T, options?: ListOptions): RecordTypes[T][];
  delete(type: RecordType, id: string): boolean;
  count(type: RecordType, where?: ListOptions['where']): number;
  /** Full-text search over evidence text and claim statements (lexical baseline). */
  searchText(types: Array<'evidence' | 'claim' | 'case'>, query: string, limit?: number): Array<{ type: RecordType; id: string; score: number }>;
  /** Run fn atomically. */
  transaction<R>(fn: () => R): R;
  /** Remove every record (demo reset). */
  clear(): void;
  close(): void;
}
