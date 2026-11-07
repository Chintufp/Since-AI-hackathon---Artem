/**
 * HTTP API and MCP contract exposed by src/apps/service. Tool names are documented
 * implementation defaults (U20 stays open). The desktop app, MCP consumers and the
 * evaluation harness all use this surface; permissions and question limits are
 * enforced inside the engine, identically for every caller.
 */
import type { ActorRef, Condition } from './common.ts';
import type { ConnectionCard, ImportBatch } from './evidence.ts';
import type { InvestigationState } from './investigation.ts';
import type { Answer, ContactDraft, PreferenceFeedback, QuestionRecord } from './questions.ts';
import type { OutcomeReport, ParticipationBalance, UserSettings } from './outcomes.ts';
import type { PeopleDirectory } from './scenarios.ts';
import type { CaseView, PersonView, QuestionView, ReceiptView, ResultView } from './views.ts';

export const DEFAULT_SERVICE_PORT = 47831;

/** Every request carries the caller principal; the service never trusts a display name for access. */
export interface Principal {
  id: string;
  displayName: string;
  groups: string[];
  type: 'human' | 'agent';
}

export interface DirectoryEntry {
  personEntityId: string;
  name: string;
  role?: string;
  groups: string[];
  available: boolean;
}

export interface ImportRequest {
  /** 'teams-json' | 'email-text' | 'slack-export' | 'slack-live' (an export-shaped payload read live, read-only) | 'scenario-dir' */
  format: 'teams-json' | 'email-text' | 'slack-export' | 'slack-live' | 'scenario-dir';
  /** Absolute path on the service machine (local prototype), or inline payload. */
  path?: string;
  payload?: unknown;
  connectionId?: string;
  accessGroups?: string[];
  /** Visible organization directory (a scenario's people.json) to apply together with an inline payload. */
  directory?: PeopleDirectory;
}

export interface ImportResponse {
  batch: ImportBatch;
  cases: number;
  claims: number;
  entities: number;
  people: number;
}

export interface InvestigateRequest {
  text: string;
  principal: Principal;
  entityIds?: string[];
  observations?: Condition[];
  attachmentNames?: string[];
  /** If false, retrieve/recommend only; do not start the question loop. */
  allowQuestions?: boolean;
}

export interface AnswerRequest {
  principal: Principal;
  value: 'yes' | 'no' | 'unknown';
  text?: string;
}

export interface OutcomeRequest {
  principal: Principal;
  investigationId: string;
  decisionId?: string;
  caseId?: string;
  attemptedAction?: string;
  result: 'recovered' | 'no-change' | 'worse' | 'partial' | 'unknown';
  lasting?: 'unknown' | 'confirmed' | 'recurred';
  text?: string;
  observations?: Condition[];
}

export interface ObservationRequest {
  principal: Principal;
  investigationId: string;
  caseId?: string;
  condition: Condition;
}

export interface ContactDraftRequest {
  principal: Principal;
  investigationId: string;
  personEntityId: string;
}

export interface ApiRoutes {
  'GET /health': { res: { ok: true; version: string; store: string; routes: string[] } };
  'POST /import': { req: ImportRequest; res: ImportResponse };
  'GET /connections': { res: ConnectionCard[] };
  'GET /cases': { res: CaseView[] };
  'GET /cases/:id': { res: CaseView };
  'POST /investigate': { req: InvestigateRequest; res: ResultView & { state: InvestigationState } };
  'GET /investigations/:id': { res: ResultView & { state: InvestigationState } };
  'GET /questions': { query: { personEntityId?: string; status?: string }; res: QuestionView[] };
  'GET /questions/:id': { res: QuestionView };
  'POST /questions/:id/answer': { req: AnswerRequest; res: { answer: Answer; receipt: ReceiptView; question: QuestionRecord } };
  'POST /questions/:id/defer': { req: { principal: Principal }; res: { receipt: ReceiptView; question: QuestionRecord } };
  'POST /questions/:id/dismiss': { req: { principal: Principal }; res: { receipt: ReceiptView; question: QuestionRecord } };
  'POST /questions/:id/undo': { req: { principal: Principal }; res: { question: QuestionRecord } };
  'POST /questions/:id/cancel': { req: { principal: Principal; reason?: string }; res: { question: QuestionRecord } };
  'POST /preferences': { req: { principal: Principal; feedback: Omit<PreferenceFeedback, 'id' | 'at' | 'orgId'> }; res: PreferenceFeedback };
  'POST /observations': { req: ObservationRequest; res: { investigation: ResultView & { state: InvestigationState } } };
  'POST /outcomes': { req: OutcomeRequest; res: OutcomeReport };
  'GET /people': { query: { investigationId: string; principalId: string }; res: PersonView[] };
  'POST /contact-draft': { req: ContactDraftRequest; res: ContactDraft };
  /** Visible organization directory (ids, names, roles, groups, availability); never knowledge or answers. */
  'GET /directory': { res: DirectoryEntry[] };
  'GET /settings': { res: UserSettings };
  'PUT /settings': { req: Partial<UserSettings>; res: UserSettings };
  'GET /participation/:personEntityId': { res: ParticipationBalance };
  'POST /demo/reset': { req: { seed?: 'elisa' | 'synthetic' | 'empty'; defaultPerson?: string }; res: { ok: true; imported: ImportResponse[]; defaultPersonEntityId?: string } };
  'GET /events': { query: { since?: string; traceId?: string }; res: Array<{ id: string; at: string; type: string; traceId: string }> };
  /** The engine's clock: real time, or a simulated moment advancing at `rate` simulated seconds per real second. */
  'GET /demo/clock': { res: DemoClockView };
  /** Moves the clock (the simulated activity stream does this); `{}` returns to real time. 409 when the host fixed the clock. */
  'POST /demo/clock': { req: { now?: string | null; rate?: number }; res: DemoClockView };
  /** Tail of the simulated activity log (JSONL under data/local/, written by scripts/demo-play.ts). Read-only; always labelled simulated. */
  'GET /demo/activity': { query: { since?: number; limit?: number }; res: ActivityView };
  /** Standalone local page (text/html) that polls GET /demo/activity, for a browser tab next to the companion. */
  'GET /demo/activity.html': { res: string };
}

export interface DemoClockView {
  mode: 'real' | 'simulated';
  now: string;
  rate: number;
  setAt?: string;
}

export interface ActivityRowView {
  seq: number;
  /** Simulated time. */
  at: string;
  /** Real time the row was written. */
  real: string;
  /** evidence | investigation | question | answer | judge | clock | note | summary */
  kind: string;
  text: string;
  who?: string;
  why?: string;
  detail?: Record<string, unknown>;
  simulated: true;
  /** Involves the person chosen under Settings → You. */
  forYou?: boolean;
}

export interface ActivityView {
  simulated: true;
  source: string;
  present: boolean;
  total: number;
  rows: ActivityRowView[];
}

/** MCP tool names (documented defaults). Each maps to one API route above. */
export const MCP_TOOLS = {
  kt_investigate: 'POST /investigate',
  kt_get_context: 'GET /investigations/:id',
  kt_request_clarification: 'POST /investigate (allowQuestions=true) or re-run loop',
  kt_clarification_status: 'GET /questions/:id',
  kt_cancel_clarification: 'POST /questions/:id/cancel',
  kt_record_observation: 'POST /observations',
  kt_record_outcome: 'POST /outcomes',
  kt_find_people: 'GET /people',
} as const;

export type McpToolName = keyof typeof MCP_TOOLS;

export const demoPrincipal = (actor: ActorRef, groups: string[] = ['noc', 'field']): Principal => ({
  id: actor.id,
  displayName: actor.displayName,
  groups,
  type: 'human',
});
