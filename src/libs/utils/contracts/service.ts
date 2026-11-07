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
import type { OutcomeReport, ParticipationBalance, ParticipationOptIn, ParticipationRating, UserSettings } from './outcomes.ts';
import type { PeopleDirectory } from './scenarios.ts';
import type { CaseView, ContextAssertionsView, PersonView, QuestionView, ReceiptView, ResultView } from './views.ts';
import type { ModelSlotName, ModelSlots, SlotChoice } from './models.ts';

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
  /**
   * 'teams-json' | 'email-text' | 'slack-export' | 'slack-live' (an export-shaped payload read live, read-only) | 'scenario-dir'
   * | 'paste' (B4 "Remember this": payload is the pasted text, or {text, attachmentNames?, authorName?}; a chat thread,
   * an e-mail or a JSON export inside it is recognised and keeps its speakers).
   */
  format: 'teams-json' | 'email-text' | 'slack-export' | 'slack-live' | 'scenario-dir' | 'paste';
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
  /** R46: points awarded by this import to people who take part (evidence they authored that became a claim). */
  points?: Array<{ personEntityId: string; points: number }>;
  /**
   * B2: present when the extract slot is on a model. `route` is the model's route, or the rules route marked as a
   * fallback; `modelClaims` counts claims the model alone proposed (committed by rules); `dropped` counts items the
   * evidence validator removed (an excerpt that is not in the cited message, an unknown message or person).
   */
  extraction?: { route: { route: string; version: string }; modelClaims: number; dropped: number; fallback?: string };
  /**
   * B4: what a 'paste' import captured, for the receipt line: cases with titles, the entities and people it is bound
   * to, the first and last stated time (verbatim), whether any date was stated, and whether everything was already known.
   */
  captured?: ImportCaptured;
}

export interface ImportCaptured {
  cases: Array<{ id: string; title: string }>;
  entities: string[];
  people: string[];
  from?: string;
  to?: string;
  dateKnown: boolean;
  /** Nothing new: every message was already stored (a second paste of the same text). */
  alreadyKnown: boolean;
  /**
   * The paste named access groups, but some of what it holds was already stored with a wider scope (org-wide, or other
   * groups): a re-paste never narrows what is stored, so the receipt says the content is already visible more widely.
   */
  widerAccess?: boolean;
}

export interface InvestigateRequest {
  text: string;
  principal: Principal;
  entityIds?: string[];
  observations?: Condition[];
  attachmentNames?: string[];
  /** If false, retrieve/recommend only; do not start the question loop. */
  allowQuestions?: boolean;
  /** B1: answer as of this moment (ISO with zone). A past view never asks anyone (allowQuestions is forced false). */
  at?: string;
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
  /** B1: assertions bound to an entity (name or alias) with validity windows, source, person and status, evaluated at `at` (default now); access-filtered for `principalId`. */
  'GET /context': { query: { entity: string; at?: string; principalId?: string }; res: ContextAssertionsView };
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
  /** `models` is partial: only the slots named change. */
  'PUT /settings': { req: Omit<Partial<UserSettings>, 'models'> & { models?: Partial<ModelSlots> }; res: UserSettings };
  /** R46: rating among the people who take part. `personEntityId` (must be the caller: `principalId` or the settings' current person) fills `me`. */
  'GET /participation/rating': { query: { personEntityId?: string; principalId?: string }; res: ParticipationRating };
  /** Own balance only: `principalId` (or the settings' current person) must resolve to that person (403 otherwise). */
  'GET /participation/:personEntityId': { query: { principalId?: string }; res: ParticipationBalance };
  /** Whether a person takes part in points (default false). */
  'GET /participation/:personEntityId/optin': { res: ParticipationOptIn };
  /** Only that person may change it (403 otherwise). Opting out hides the rows; nothing is deleted. */
  'PUT /participation/:personEntityId/optin': { req: { principal: Principal; participates: boolean }; res: ParticipationOptIn };
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
  /** Settings -> Models: machine detection, the catalog per slot (merged with installed models) and a status chip per slot. */
  'GET /models': { res: ModelsView };
  /** Starts `ollama pull` for one model (only ever from a click); progress by polling GET /models/pull/:id. */
  'POST /models/pull': { req: { model: string }; res: PullJobView };
  'GET /models/pull/:id': { res: PullJobView };
  /** One tiny call to the api provider with the key held in memory; reports the model that answered. */
  'POST /models/test': { req: { provider: 'anthropic' | 'gemini'; model?: string }; res: ModelTestResult };
  /** Holds an api key in memory only (never SQLite, data/ or the repo). An empty key forgets it. */
  'POST /models/key': { req: { provider: 'anthropic' | 'gemini'; key: string }; res: { provider: 'anthropic' | 'gemini'; present: boolean } };
  /** Installs Ollama with Homebrew (macOS; only ever from a click), with a visible log; 'unavailable' plus the download link when Homebrew is absent. */
  'POST /models/install': { req: Record<string, never>; res: InstallJobView };
  'GET /models/install': { res: InstallJobView };
}

/** The Ollama install started from Settings -> Models. */
export interface InstallJobView {
  state: 'idle' | 'running' | 'done' | 'failed' | 'unavailable';
  /** Homebrew was found (the install runs `brew install ollama`). */
  brew: boolean;
  /** The last lines of the installer's output. */
  log: string[];
  /** Where to download Ollama by hand. */
  downloadUrl: string;
  /** The commands to copy instead. */
  setup: string[];
  error?: string;
  startedAt?: string;
  finishedAt?: string;
}

/** One row of the model catalog (data/models/catalog.json), or an installed model that is not in it. */
export interface CatalogEntry {
  model: string;
  recommended?: boolean;
  sizeBytes?: number;
  dims?: number;
  contextTokens?: number;
  minRamGb?: number;
  why?: string;
  /** Found in `ollama list`. */
  installed: boolean;
  /** Not in the catalog file: listed because it is installed. */
  fromInstalled?: boolean;
  /** 'installed · ready' | 'not downloaded · 1.2 GB' | 'Ollama not installed' | 'too large for this Mac' */
  availability: 'ready' | 'not-downloaded' | 'ollama-missing' | 'too-large';
  label: string;
}

export interface SlotStatusView {
  choice: SlotChoice;
  /** off · not downloaded · downloading N% · ready · failed: <reason> */
  state: 'off' | 'not-downloaded' | 'downloading' | 'ready' | 'failed';
  chip: string;
  percent?: number;
  reason?: string;
}

export interface ModelsView {
  detection: {
    installed: boolean;
    running: boolean;
    version?: string;
    binaryPath?: string;
    freeDiskBytes?: number;
    totalMemBytes?: number;
    note?: string;
    installedModels: Array<{ name: string; sizeBytes?: number; capabilities: string[] }>;
    /** How to set Ollama up by hand (shown when it is missing). */
    setup: string[];
  };
  catalog: Record<ModelSlotName, CatalogEntry[]>;
  slots: Record<ModelSlotName, SlotStatusView>;
  /** Which api vendors have a key in memory (never the key). */
  apiKeys: { anthropic: boolean; gemini: boolean };
}

export interface PullJobView {
  jobId: string;
  model: string;
  state: 'running' | 'done' | 'failed';
  status: string;
  percent?: number;
  completedBytes?: number;
  totalBytes?: number;
  error?: string;
  startedAt: string;
  finishedAt?: string;
}

export interface ModelTestResult {
  ok: boolean;
  provider: 'anthropic' | 'gemini';
  /** The model that answered (as the provider names it). */
  model?: string;
  error?: string;
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
  kt_get_context: 'GET /investigations/:id (with at: the stored problem re-run at that moment)',
  kt_request_clarification: 'POST /investigate (allowQuestions=true) or re-run loop',
  kt_clarification_status: 'GET /questions/:id',
  kt_cancel_clarification: 'POST /questions/:id/cancel',
  kt_record_observation: 'POST /observations',
  kt_record_outcome: 'POST /outcomes',
  kt_find_people: 'GET /people',
  kt_participation: 'GET /participation/rating',
} as const;

export type McpToolName = keyof typeof MCP_TOOLS;

export const demoPrincipal = (actor: ActorRef, groups: string[] = ['noc', 'field']): Principal => ({
  id: actor.id,
  displayName: actor.displayName,
  groups,
  type: 'human',
});
