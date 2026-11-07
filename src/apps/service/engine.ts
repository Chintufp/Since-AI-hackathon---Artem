/**
 * The engine: one set of typed functions mirroring ApiRoutes. The HTTP server and the MCP server are thin adapters over
 * this class, so permissions, question limits, ids and trace events behave identically for every caller.
 */
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  AccessScope, Answer, ApiRoutes, CaseView, Condition, ConnectionCard, ContactDraft, ContactDraftRequest, CoordinatorSettings, ImportRequest, ImportResponse,
  InvestigateRequest, InvestigationState, KnowledgeStore, ObservationRequest, OutcomeReport, OutcomeRequest, ParticipationBalance, PeopleDirectory,
  PersonView, PreferenceFeedback, Principal, Problem, QuestionRecord, QuestionView, ReceiptView, Selector, TraceEvent, UserSettings,
} from '../../libs/utils/contracts/index.ts';
import { defaultCoordinatorSettings, defaultUserSettings, freshId, stableId, textFingerprint } from '../../libs/utils/contracts/index.ts';
import { connectionCards } from '../../libs/utils/connectors/index.ts';
import {
  defaultInvestigationSettings, investigate, parseProblemText, questionsForInvestigation, RulesAssessor, startedBy, storeDirectory,
  type InvestigationSettings, type PersonDirectory,
} from '../../libs/utils/investigation/index.ts';
import { buildCaseView, importFromPath, listCases, openStore } from '../../libs/utils/memory/index.ts';
import { TemplateQuestionGenerator, QuestionCoordinator, type RequestResult } from '../../libs/utils/questions/index.ts';
import { createSelector, SELECTOR_IDS } from '../../libs/utils/policies/index.ts';
import { HybridRetriever, canSee } from '../../libs/utils/retrieval/index.ts';
import { awardPoints, balanceOf, revokeContribution, type ParticipationKind } from '../../libs/utils/participation/index.ts';
import { applyDirectory } from './directory.ts';
import { resetDemo } from './demo.ts';
import { DEFAULT_DB_PATH } from './paths.ts';
import { badRequest, conflict, forbidden, notFound, toServiceError } from './errors.ts';
import { ACTIVE_QUESTION, personView, questionView, resultView, type InvestigationResult } from './views.ts';

export { DEFAULT_DB_PATH, REPO_ROOT } from './paths.ts';
export const SERVICE_VERSION = '0.1.0';
const SETTINGS_ID = 'user';
const ANONYMOUS: Principal = { id: 'anonymous', displayName: 'Anonymous', groups: [], type: 'human' };

export type ExtendedSettings = UserSettings & { selectorId: string };

export interface EngineOptions {
  /** SQLite path or ':memory:'. Default data/local/knowledge-twin.sqlite. */
  dbPath?: string;
  /** Use an already-open store (tests); the engine then does not close it. */
  store?: KnowledgeStore;
  orgId?: string;
  clock?: () => Date;
  /** Organization configuration for investigation (distinguishing keys, observability groups, templates ...). */
  investigation?: Partial<InvestigationSettings>;
  /** Overrides for the question limits (daily limit, cooldown, max open, per-investigation cap). */
  coordinator?: Partial<CoordinatorSettings>;
  /** Directory holding Elisa's example files (teams_chat.json, email.txt) for the demo reset. */
  elisaDir?: string;
  /** Directory holding families.json + family folders. */
  scenariosDir?: string;
  fixturesDir?: string;
}

export interface ClarificationResult {
  state: InvestigationState;
  /** Open (queued/delivered) question for this investigation, when one exists. */
  question?: QuestionRecord;
  status: 'question-open' | 'deferred' | 'not-needed' | 'exhausted';
  reason: string;
}

const actorOf = (p: Principal) => ({ id: p.id, displayName: p.displayName });
const scopeOfPrincipal = (p: Principal): AccessScope =>
  p.groups.length > 0 ? { visibility: 'group', groups: [...p.groups] } : { visibility: 'private', principals: [p.id] };

export class Engine {
  readonly store: KnowledgeStore;
  readonly orgId: string;
  readonly dbPath: string;
  private readonly ownsStore: boolean;
  private readonly clock: () => Date;
  private readonly opts: EngineOptions;
  private readonly selectors = new Map<string, Selector>();
  private readonly directoryFiles = new Set<string>();

  constructor(opts: EngineOptions = {}) {
    this.opts = opts;
    this.orgId = opts.orgId ?? 'org:local';
    this.clock = opts.clock ?? (() => new Date());
    if (opts.store) {
      this.store = opts.store;
      this.ownsStore = false;
      this.dbPath = ':provided:';
    } else {
      this.dbPath = opts.dbPath ?? DEFAULT_DB_PATH;
      if (this.dbPath !== ':memory:') mkdirSync(dirname(this.dbPath), { recursive: true });
      this.store = openStore(this.dbPath);
      this.ownsStore = true;
    }
  }

  close(): void {
    if (this.ownsStore) this.store.close();
  }

  // ---- wiring -------------------------------------------------------------------------------

  private now(): Date {
    return this.clock();
  }

  getSettings(): ExtendedSettings {
    const rec = this.store.get('settings', SETTINGS_ID);
    const { id: _id, ...rest } = (rec ?? {}) as Partial<UserSettings> & { id?: string; selectorId?: string };
    return { ...defaultUserSettings, selectorId: this.opts.coordinator?.selectorId ?? defaultCoordinatorSettings.selectorId, ...rest };
  }

  private invSettings(): InvestigationSettings {
    const s = this.getSettings();
    const base = this.opts.investigation ?? {};
    return defaultInvestigationSettings({
      ...base,
      coordinator: { ...defaultCoordinatorSettings, ...(base.coordinator ?? {}), ...(this.opts.coordinator ?? {}), selectorId: s.selectorId },
    });
  }

  private selector(id: string): Selector {
    let sel = this.selectors.get(id);
    if (!sel) {
      try {
        sel = createSelector(id, { rules: { clock: this.clock }, epsilon: { clock: this.clock } });
      } catch (e) {
        throw badRequest(e instanceof Error ? e.message : String(e));
      }
      this.selectors.set(id, sel);
    }
    return sel;
  }

  private wiring() {
    const settings = this.invSettings();
    const directory: PersonDirectory = storeDirectory(this.store);
    const retriever = new HybridRetriever(this.store, settings);
    const assessor = new RulesAssessor({ store: this.store, settings });
    const generator = new TemplateQuestionGenerator({ store: this.store, settings, directory, clock: this.clock });
    const selector = this.selector(settings.coordinator.selectorId);
    const coordinator = new QuestionCoordinator({ store: this.store, settings, selector, generator, retriever, assessor, directory, clock: this.clock });
    return { settings, directory, retriever, assessor, generator, selector, coordinator };
  }

  /**
   * Effective principal. Groups a caller claims are honoured, except that a person known to the directory with groups
   * can never exceed those groups. (The prototype does not authenticate callers; a deployment would.)
   */
  effective(p: Principal): Principal {
    const dir = storeDirectory(this.store);
    const personId = dir.resolve(p.id);
    const person = personId ? dir.get(personId) : undefined;
    if (!person) return p;
    return { ...p, groups: p.groups.filter((g) => person.groups.includes(g)) };
  }

  /** Principal for reads that carry only an id (or nothing): the directory person, else the settings' current person, else anonymous. */
  private principalFor(id?: string): Principal {
    const dir = storeDirectory(this.store);
    const wanted = id ?? this.getSettings().currentPersonEntityId;
    if (!wanted) return ANONYMOUS;
    const personId = dir.resolve(wanted);
    const person = personId ? dir.get(personId) : undefined;
    return person ? { id: person.id, displayName: person.name, groups: person.groups, type: 'human' } : { id: wanted, displayName: wanted, groups: [], type: 'human' };
  }

  // ---- trace --------------------------------------------------------------------------------

  private trace(traceId: string, type: string, actor: TraceEvent['actor'], data: Record<string, unknown> = {}): TraceEvent {
    const e: TraceEvent = { id: freshId('evt'), at: this.now().toISOString(), type, traceId, ...(actor ? { actor } : {}), data };
    this.store.put('trace', e);
    const inv = this.store.get('investigation', traceId);
    if (inv) this.store.put('investigation', { ...inv, events: [...inv.events, e] });
    return e;
  }

  /** Mirror events embedded in an investigation state into the trace table so GET /events sees them. */
  private sync(state: InvestigationState): InvestigationState {
    for (const e of state.events) if (!this.store.get('trace', e.id)) this.store.put('trace', e);
    return state;
  }

  // ---- ownership ----------------------------------------------------------------------------

  private mustState(id: string): InvestigationState {
    const s = this.store.get('investigation', id);
    if (!s) throw notFound(`Unknown investigation ${id}`);
    return s;
  }

  private isOwner(state: InvestigationState, principalId: string): boolean {
    const starter = startedBy(state);
    if (!starter) return false;
    if (starter.id === principalId) return true;
    const dir = storeDirectory(this.store);
    const a = dir.resolve(principalId);
    return !!a && a === dir.resolve(starter.id);
  }

  /** Investigations belong to the principal that started them (the same identity, or the same directory person). */
  private owned(id: string, principalId?: string): InvestigationState {
    const state = this.mustState(id);
    if (principalId !== undefined && !this.isOwner(state, principalId)) throw forbidden(`Principal ${principalId} did not start investigation ${id}`);
    return state;
  }

  private view(state: InvestigationState): InvestigationResult {
    return resultView(this.store, this.sync(state), ANONYMOUS);
  }

  // ---- routes -------------------------------------------------------------------------------

  health(routes: string[]): ApiRoutes['GET /health']['res'] {
    return { ok: true, version: SERVICE_VERSION, store: this.dbPath, routes };
  }

  importData(req: ImportRequest): ImportResponse {
    if (req.path && !existsSync(req.path)) throw badRequest(`Path does not exist: ${req.path}`);
    let res: ImportResponse;
    try {
      res = importFromPath(this.store, {
        format: req.format, ...(req.path ? { path: req.path } : {}), ...(req.payload !== undefined ? { payload: req.payload } : {}),
        ...(req.connectionId ? { connectionId: req.connectionId } : {}), ...(req.accessGroups ? { accessGroups: req.accessGroups } : {}),
        orgId: this.orgId, now: this.now().toISOString(),
      });
    } catch (e) {
      throw badRequest(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (req.format === 'scenario-dir' && req.path) this.loadDirectoryFile(join(req.path, 'people.json'));
    this.reapplyDirectory();
    this.trace(res.batch.id, 'import.completed', { id: 'system', displayName: 'import' }, { format: req.format, counts: res.batch.counts, cases: res.cases, claims: res.claims, people: res.people });
    return res;
  }

  private loadDirectoryFile(file: string): void {
    if (existsSync(file)) this.directoryFiles.add(file);
  }

  /** Later imports can widen a person's scope; the visible directory is the authority for groups, so re-apply it. */
  private reapplyDirectory(): void {
    for (const f of this.directoryFiles) {
      try {
        applyDirectory(this.store, this.orgId, JSON.parse(readFileSync(f, 'utf8')) as PeopleDirectory);
      } catch {
        this.directoryFiles.delete(f);
      }
    }
  }

  connections(): ConnectionCard[] {
    const batches = this.store.list('importBatch');
    return connectionCards().map((c) => {
      const mine = batches.filter((b) => b.connectionId === c.id).sort((a, b) => (b.finishedAt ?? b.startedAt).localeCompare(a.finishedAt ?? a.startedAt));
      const last = mine[0];
      return last ? { ...c, lastImportBatchId: last.id, lastSyncAt: last.finishedAt ?? last.startedAt } : c;
    });
  }

  cases(principalId?: string): CaseView[] {
    const p = this.principalFor(principalId);
    return listCases(this.store, p, this.orgId)
      .map((c) => buildCaseView(this.store, c.id, p))
      .filter((v): v is CaseView => v !== undefined);
  }

  caseView(id: string, principalId?: string): CaseView {
    const v = buildCaseView(this.store, id, this.principalFor(principalId));
    if (!v) throw notFound(`Unknown case ${id}`);
    return v;
  }

  async investigate(req: InvestigateRequest): Promise<InvestigationResult> {
    const principal = this.effective(req.principal);
    const w = this.wiring();
    const observations = req.observations ?? [];
    const problemId = stableId('prob', this.orgId, principal.id, req.text.trim(), (req.entityIds ?? []).join(','), JSON.stringify(observations.map((o) => [o.key, o.operator, o.value ?? null])), (req.attachmentNames ?? []).join('|'));
    const problem: Problem = {
      id: problemId, orgId: this.orgId, text: req.text.trim(),
      requester: principal.type === 'agent' ? { id: 'agent', displayName: principal.displayName, agentId: principal.id } : actorOf(principal),
      ...(req.entityIds ? { entityIds: req.entityIds } : {}), ...(observations.length ? { observations } : {}),
      ...(req.attachmentNames ? { attachmentNames: req.attachmentNames } : {}), createdAt: this.now().toISOString(),
    };
    let state: InvestigationState;
    try {
      state = await investigate({ problem, store: this.store, principal, deps: { retriever: w.retriever, assessor: w.assessor, generator: w.generator, selector: w.selector, settings: w.settings, clock: this.clock, directory: w.directory } });
      if (req.allowQuestions !== false) state = (await w.coordinator.request(state)).state;
    } catch (e) {
      throw toServiceError(e);
    }
    return this.view(state);
  }

  getInvestigation(id: string, principalId?: string): InvestigationResult {
    return this.view(this.owned(id, principalId));
  }

  /** Run the clarification loop for an existing investigation. Limits and eligibility are the coordinator's, whoever asks. */
  async requestClarification(principalIn: Principal, investigationId: string): Promise<ClarificationResult> {
    const principal = this.effective(principalIn);
    const state0 = this.owned(investigationId, principal.id);
    const w = this.wiring();
    let r: RequestResult;
    try {
      r = await w.coordinator.request(state0);
    } catch (e) {
      throw toServiceError(e);
    }
    this.sync(r.state);
    if (r.question) return { state: r.state, question: r.question, status: 'question-open', reason: `Question ${r.question.id} is ${r.question.status}.` };
    const violations = [...new Set(r.eligibility.flatMap((e) => e.violations))];
    const why = r.decision?.reason ?? '';
    if (r.state.loop === 'no-question-needed') return { state: r.state, status: 'not-needed', reason: 'No open consequential gap needs a person to answer.' };
    const reason = `${violations.length ? `Blocked by: ${violations.join(', ')}. ` : ''}${why}`.trim() || `Loop status: ${r.state.loop}.`;
    return { state: r.state, status: r.state.loop === 'exhausted' ? 'exhausted' : 'deferred', reason };
  }

  async recordObservation(req: ObservationRequest): Promise<{ investigation: InvestigationResult }> {
    const principal = this.effective(req.principal);
    const state = this.owned(req.investigationId, principal.id);
    if (req.caseId) this.assertCaseVisible(req.caseId, principal);
    const w = this.wiring();
    try {
      const r = await w.coordinator.recordObservation(state.id, req.condition as Condition, actorOf(principal), req.caseId);
      return { investigation: this.view(r.state) };
    } catch (e) {
      throw toServiceError(e);
    }
  }

  private assertCaseVisible(caseId: string, p: Principal): void {
    const c = this.store.get('case', caseId);
    if (!c || !canSee(c.accessScope, p)) throw notFound(`Unknown case ${caseId}`);
  }

  async recordOutcome(req: OutcomeRequest): Promise<OutcomeReport> {
    const principal = this.effective(req.principal);
    const state = this.owned(req.investigationId, principal.id);
    if (req.caseId) this.assertCaseVisible(req.caseId, principal);
    const now = this.now().toISOString();
    const lasting = req.lasting ?? 'unknown';
    const id = stableId('outrep', state.id, principal.id, req.caseId ?? '', req.decisionId ?? '', req.attemptedAction ?? '', req.result, lasting, req.text ?? '', JSON.stringify((req.observations ?? []).map((o) => [o.key, o.operator, o.value ?? null])));
    const text = `Outcome reported by ${principal.displayName}${req.attemptedAction ? ` after ${req.attemptedAction}` : ''}: ${req.result} (lasting effect: ${lasting}).${req.text ? ` Note: ${req.text}` : ''}`;
    const evidenceId = stableId('ev', this.orgId, 'paste', 'outcome:service', id, '1');
    const existing = this.store.get('outcomeReport', id);
    if (existing) return existing;
    this.store.put('evidence', {
      id: evidenceId, orgId: this.orgId, provider: 'paste', connectionId: 'outcome:service', sourceId: id, revision: '1', kind: 'observation', text,
      author: actorOf(principal), eventTime: { known: true, iso: now }, ingestedAt: now, thread: { threadId: state.id, subject: state.problem.text.slice(0, 80) },
      accessScope: scopeOfPrincipal(principal), lineage: { importBatchId: `outcome:service:${state.id}`, sourceFingerprint: textFingerprint(text) },
      metadata: { investigationId: state.id, ...(req.caseId ? { triedCaseId: req.caseId } : {}) },
    });
    // The report is its own record. It is never written into the historical case: a different incident that tried a
    // past response does not change what happened in the past one.
    const report: OutcomeReport = {
      id, orgId: this.orgId, investigationId: state.id, ...(req.decisionId ? { decisionId: req.decisionId } : {}), ...(req.caseId ? { caseId: req.caseId } : {}),
      reporter: { type: principal.type, id: principal.id, displayName: principal.displayName }, ...(req.attemptedAction ? { attemptedAction: req.attemptedAction } : {}),
      result: req.result, observedAt: now, lasting, ...(req.text ? { text: req.text } : {}), ...(req.observations?.length ? { observations: req.observations as Condition[] } : {}),
      createdEvidenceId: evidenceId,
    };
    this.store.put('outcomeReport', report);
    this.trace(state.id, 'outcome.reported', { id: principal.id, displayName: principal.displayName }, { reportId: id, result: req.result, lasting, ...(req.decisionId ? { decisionId: req.decisionId } : {}) });
    const who = storeDirectory(this.store).resolve(principal.id);
    if (who) this.award({ personEntityId: who, contributionEventId: id, kind: 'outcome-report', summary: `Reported an outcome (${req.result})` });
    const w = this.wiring();
    for (const c of req.observations ?? []) {
      try {
        await w.coordinator.recordObservation(state.id, c as Condition, actorOf(principal), req.caseId);
      } catch (e) {
        throw toServiceError(e);
      }
    }
    return report;
  }

  // ---- questions ----------------------------------------------------------------------------

  private mustQuestion(id: string): QuestionRecord {
    const q = this.store.get('question', id);
    if (!q) throw notFound(`Unknown question ${id}`);
    return q;
  }

  private recipientCheck(q: QuestionRecord, principal: Principal): void {
    if (storeDirectory(this.store).resolve(principal.id) !== q.personEntityId) throw forbidden(`Principal ${principal.id} is not the recipient of question ${q.id}`);
  }

  questions(query: { personEntityId?: string; status?: string }): QuestionView[] {
    const where = query.personEntityId ? { personEntityId: query.personEntityId } : undefined;
    const wanted = query.status === 'all' ? undefined : query.status ? [query.status] : ['queued', 'delivered', 'deferred'];
    return this.store.list('question', where ? { where } : {})
      .filter((q) => !wanted || wanted.includes(q.status))
      .map((q) => this.questionFor(q));
  }

  question(id: string): QuestionView {
    return this.questionFor(this.mustQuestion(id));
  }

  /** Viewed as the recipient, so the timeline never shows the recipient more than the recipient may see. */
  private questionFor(q: QuestionRecord): QuestionView {
    const p = this.principalFor(q.personEntityId);
    return questionView(this.store, q, p);
  }

  private award(a: { personEntityId: string; contributionEventId: string; kind: ParticipationKind; summary: string }): number {
    const r = awardPoints(this.store, { orgId: this.orgId, at: this.now().toISOString(), enabled: this.getSettings().points, ...a });
    return r.awarded;
  }

  async answer(questionId: string, req: { principal: Principal; value: 'yes' | 'no' | 'unknown'; text?: string }): Promise<{ answer: Answer; receipt: ReceiptView; question: QuestionRecord }> {
    const principal = this.effective(req.principal);
    let q = this.mustQuestion(questionId);
    this.recipientCheck(q, principal);
    if (q.status === 'deferred') q = (await this.undo(questionId, { principal })).question;
    if (q.status === 'answered' && q.answerId) {
      const prev = this.store.get('answer', q.answerId);
      if (prev && prev.value === req.value) {
        // A retry of the same answer is idempotent: same answer, no new points.
        return { answer: prev, receipt: this.receipt(req.value, q, this.store.get('investigation', q.candidate.investigationId), undefined), question: q };
      }
      throw conflict(`Question ${questionId} was already answered "${prev?.value}"; undo it first to change the answer`);
    }
    if (!ACTIVE_QUESTION.has(q.status)) throw conflict(`Question ${questionId} is ${q.status}; only queued/delivered questions can be answered`);
    const w = this.wiring();
    try {
      const r = await w.coordinator.answer(questionId, req.value, principal, req.text);
      this.sync(r.state);
      const kind: ParticipationKind = req.value === 'yes' ? 'answer-yes' : req.value === 'no' ? 'answer-no' : 'answer-unknown';
      const points = this.award({ personEntityId: q.personEntityId, contributionEventId: r.answer.id, kind, summary: `Answered "${req.value}": ${q.candidate.text}` });
      return { answer: r.answer, receipt: this.receipt(req.value, r.question, r.state, points), question: r.question };
    } catch (e) {
      throw toServiceError(e);
    }
  }

  private receipt(value: 'yes' | 'no' | 'unknown', q: QuestionRecord, state: InvestigationState | undefined, points: number | undefined): ReceiptView {
    const label = { yes: 'Recorded: Yes', no: 'Recorded: No', unknown: 'Recorded: Not sure' }[value];
    const effect = value === 'unknown'
      ? 'No factual update was made; the question stays unresolved and you will not be asked again.'
      : state ? `The recommendation is now "${state.recommendation.kind}".` : 'Your answer was recorded as attributed evidence.';
    return { title: label, detail: `${q.candidate.text} ${effect}`, canUndo: true, ...(points ? { pointsAwarded: points } : {}) };
  }

  private async settle(questionId: string, principalIn: Principal, to: 'defer' | 'dismiss'): Promise<{ receipt: ReceiptView; question: QuestionRecord }> {
    const principal = this.effective(principalIn);
    let q = this.mustQuestion(questionId);
    this.recipientCheck(q, principal);
    if (q.status === 'deferred' && to === 'dismiss') q = (await this.undo(questionId, { principal })).question;
    if (!ACTIVE_QUESTION.has(q.status)) throw conflict(`Question ${questionId} is ${q.status}`);
    const w = this.wiring();
    try {
      const question = to === 'defer' ? w.coordinator.defer(questionId, principal) : w.coordinator.dismiss(questionId, principal);
      this.award({ personEntityId: q.personEntityId, contributionEventId: `${to}:${questionId}`, kind: to, summary: to === 'defer' ? 'Saved a question for later' : 'Dismissed a question' });
      const detail = q.candidate.text;
      return { question, receipt: to === 'defer' ? { title: 'Saved for later', detail, canUndo: true } : { title: 'Question dismissed', detail, canUndo: true } };
    } catch (e) {
      throw toServiceError(e);
    }
  }

  defer(questionId: string, req: { principal: Principal }) {
    return this.settle(questionId, req.principal, 'defer');
  }
  dismiss(questionId: string, req: { principal: Principal }) {
    return this.settle(questionId, req.principal, 'dismiss');
  }

  async undo(questionId: string, req: { principal: Principal }): Promise<{ question: QuestionRecord }> {
    const principal = this.effective(req.principal);
    const q = this.mustQuestion(questionId);
    if (!q.previousStatus) throw conflict('Nothing to undo');
    if (q.status === 'cancelled') {
      if (!this.isOwner(this.mustState(q.candidate.investigationId), principal.id)) throw forbidden('Only the requester that started the investigation can undo its cancellation');
    } else this.recipientCheck(q, principal);
    const w = this.wiring();
    try {
      const question = await w.coordinator.undo(questionId, principal);
      if (q.answerId) revokeContribution(this.store, q.answerId);
      revokeContribution(this.store, `defer:${questionId}`);
      revokeContribution(this.store, `dismiss:${questionId}`);
      const st = this.store.get('investigation', q.candidate.investigationId);
      if (st) this.sync(st);
      this.trace(q.candidate.investigationId, 'question.undone', { id: principal.id, displayName: principal.displayName }, { questionId, restoredTo: question.status });
      return { question };
    } catch (e) {
      throw toServiceError(e);
    }
  }

  cancel(questionId: string, req: { principal: Principal; reason?: string }): { question: QuestionRecord } {
    const principal = this.effective(req.principal);
    const q = this.mustQuestion(questionId);
    const state = this.mustState(q.candidate.investigationId);
    if (!this.isOwner(state, principal.id)) throw forbidden('Only the requester that started the investigation can cancel its question');
    if (!ACTIVE_QUESTION.has(q.status)) throw conflict(`Question ${questionId} is ${q.status}`);
    try {
      const question = this.wiring().coordinator.cancel(questionId, principal.type === 'agent' ? 'agent' : 'requester');
      this.trace(state.id, 'question.cancelled', { id: principal.id, displayName: principal.displayName }, { questionId, by: principal.type, ...(req.reason ? { reason: req.reason } : {}) });
      return { question };
    } catch (e) {
      throw toServiceError(e);
    }
  }

  /** Status of one clarification question for the investigation's requester (never for anyone else). */
  clarificationStatus(principalIn: Principal, questionId: string): { questionId: string; investigationId: string; status: string; text: string; cancelReason?: string; answer?: { value: string; answeredBy: string; at: string } } {
    const principal = this.effective(principalIn);
    const q = this.mustQuestion(questionId);
    this.owned(q.candidate.investigationId, principal.id);
    const a = q.answerId ? this.store.get('answer', q.answerId) : undefined;
    return {
      questionId: q.id, investigationId: q.candidate.investigationId, status: q.status, text: q.candidate.text,
      ...(q.cancelReason ? { cancelReason: q.cancelReason } : {}),
      ...(a ? { answer: { value: a.value, answeredBy: a.personEntityId, at: a.at } } : {}),
    };
  }

  recordPreference(req: { principal: Principal; feedback: Omit<PreferenceFeedback, 'id' | 'at' | 'orgId'> }): PreferenceFeedback {
    const principal = this.effective(req.principal);
    const who = storeDirectory(this.store).resolve(principal.id);
    if (who !== req.feedback.personEntityId) throw forbidden('A preference can only be recorded by the person it belongs to');
    const f = req.feedback;
    const rec: PreferenceFeedback = { ...f, id: stableId('pref', who, ...f.comparedQuestionIds), orgId: this.orgId, at: this.now().toISOString() };
    this.store.put('preference', rec);
    return rec;
  }

  // ---- people and contact draft -----------------------------------------------------------------

  people(investigationId: string, principalId: string): PersonView[] {
    return this.owned(investigationId, principalId).people.map(personView);
  }

  contactDraft(req: ContactDraftRequest): ContactDraft {
    const principal = this.effective(req.principal);
    const state = this.owned(req.investigationId, principal.id);
    const person = state.people.find((p) => p.personEntityId === req.personEntityId);
    if (!person) throw forbidden(`${req.personEntityId} is not among the people available to this requester for ${state.id}`);
    const settings = this.invSettings();
    const recorded = this.store.list('observation', { where: { investigationId: state.id } });
    const parsed = parseProblemText(state.problem.text, state.problem.id).conditions;
    const label = (c: Condition): string => c.label ?? `${c.key} ${c.operator} ${String(c.value ?? '')}`.trim();
    const all = [...parsed, ...(state.problem.observations ?? []), ...recorded.map((o) => o.condition)];
    const uniq = (xs: string[]): string[] => [...new Set(xs)];
    const performedKeys = new Set(['action.performed', 'component.replaced']);
    const isCheck = (c: Condition): boolean => performedKeys.has(c.key) || c.key.endsWith('.check') || settings.diagnosticActions.some((a) => String(c.value ?? '') === a);
    const symptoms = uniq(all.filter((c) => !isCheck(c)).map(label));
    const done = uniq(all.filter(isCheck).map(label));
    const gap = state.gaps.find((g) => g.status === 'open' && g.consequential);
    const open = questionsForInvestigation(this.store, state.id).find((q) => ACTIVE_QUESTION.has(q.status) && q.personEntityId === person.personEntityId);
    const unresolved = open ? open.candidate.text : gap ? `${gap.description} (${gap.whatAnswerChanges})` : 'Whether a past response I found applies to this case.';
    const bullets = (xs: string[], none: string): string => (xs.length ? xs.map((x) => `- ${x}`).join('\n') : `- ${none}`);
    const first = person.displayName.split(' ')[0] ?? person.displayName;
    const body = [
      `Hi ${first},`, '',
      `I am looking into: "${state.problem.text}"`, '',
      'What I see now:', bullets(symptoms, 'Nothing structured recorded beyond the description above.'), '',
      'Checks already performed:', bullets(done, 'None recorded yet.'), '',
      'Still unresolved:', `- ${unresolved}`, '',
      'Could you tell me what you saw, or point me to someone who did?', '',
      `Thanks,\n${principal.displayName}`,
    ].join('\n');
    const draft: ContactDraft = {
      id: stableId('draft', state.id, person.personEntityId), investigationId: state.id, personEntityId: person.personEntityId,
      to: { id: person.personEntityId, displayName: person.displayName, ...(person.role ? { role: person.role } : {}) },
      subject: `Question: ${state.problem.text.replace(/\s+/g, ' ').slice(0, 70)}`, body, requiresReview: true, createdAt: this.now().toISOString(),
    };
    this.trace(state.id, 'contact-draft.created', { id: principal.id, displayName: principal.displayName }, { draftId: draft.id, personEntityId: person.personEntityId, sent: false });
    return draft;
  }

  // ---- settings, participation, events ------------------------------------------------------------

  putSettings(patch: Partial<ExtendedSettings>): ExtendedSettings {
    if (patch.selectorId !== undefined) this.selector(patch.selectorId);
    const next: ExtendedSettings = { ...this.getSettings(), ...patch };
    this.store.put('settings', { id: SETTINGS_ID, ...next });
    this.trace('settings', 'settings.updated', { id: 'system', displayName: 'settings' }, { keys: Object.keys(patch) });
    return next;
  }

  participation(personEntityId: string): ParticipationBalance {
    return balanceOf(this.store, personEntityId, this.getSettings().points);
  }

  events(query: { since?: string; traceId?: string }): Array<{ id: string; at: string; type: string; traceId: string }> {
    return this.store.list('trace', query.traceId ? { where: { traceId: query.traceId } } : {})
      .filter((e) => !query.since || e.at > query.since)
      .sort((a, b) => a.at.localeCompare(b.at))
      .slice(-1000)
      .map((e) => ({ id: e.id, at: e.at, type: e.type, traceId: e.traceId }));
  }

  // ---- demo -----------------------------------------------------------------------------------

  /** Remove every record (keeping the user's settings) ready for a fresh import. Used by the demo reset. */
  resetStore(): void {
    const keep = this.store.get('settings', SETTINGS_ID);
    this.store.clear();
    this.directoryFiles.clear();
    if (keep) this.store.put('settings', keep);
    this.trace('demo', 'demo.reset', { id: 'system', displayName: 'demo' });
  }

  async resetDemo(seed: 'elisa' | 'synthetic' | 'empty' | undefined): Promise<ApiRoutes['POST /demo/reset']['res']> {
    return resetDemo(this, seed, this.opts);
  }
}

export type { InvestigationResult };
export { SELECTOR_IDS };
