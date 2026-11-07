/**
 * The engine: one set of typed functions mirroring ApiRoutes. The HTTP server and the MCP server are thin adapters over
 * this class, so permissions, question limits, ids and trace events behave identically for every caller.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type {
  AccessScope, Answer, ApiRoutes, CaseView, Condition, ConnectionCard, ContactDraft, ContactDraftRequest, CoordinatorSettings, ImportRequest, ImportResponse,
  InvestigateRequest, InvestigationState, KnowledgeStore, ObservationRequest, OutcomeReport, OutcomeRequest, ParticipationBalance, ParticipationOptIn, ParticipationRating, PeopleDirectory,
  PersonView, PreferenceFeedback, Principal, Problem, QuestionGenerator, QuestionRecord, QuestionView, ReceiptView, Selector, TraceEvent, UserSettings, DirectoryEntry } from '../../libs/utils/contracts/index.ts';
import { DEFAULT_MODEL_SLOTS, defaultCoordinatorSettings, defaultUserSettings, freshId, stableId, textFingerprint } from '../../libs/utils/contracts/index.ts';
import type { ExpertCostView, InstallJobView, ModelSlotName, ModelSlots, ModelsView, ModelTestResult, PullJobView } from '../../libs/utils/contracts/index.ts';
import { fallbackRoute, vendorOf, type ApiVendor, type ModelProvider } from '../../libs/utils/models/providers/index.ts';
import { EmbeddingIndex, type IndexReport } from '../../libs/utils/retrieval/index.ts';
import { caseCard, createLlmExtractor, enrichWithModel, RULES_ROUTE, storeHealth, type EnrichItem, type EnrichReport, type StoreHealth } from '../../libs/utils/memory/index.ts';
import { DEFAULT_LOCAL_MODELS, ModelManager, NO_API_REASON, type ModelManagerOptions } from './models.ts';
import { connectionCards } from '../../libs/utils/connectors/index.ts';
import {
  defaultInvestigationSettings, investigate, investigationId, OUTCOME_KEY, parseGapId, parseProblemText, questionsForInvestigation, RulesAssessor, startedBy, storeDirectory,
  type InvestigationSettings, type PersonDirectory,
} from '../../libs/utils/investigation/index.ts';
import { buildCaseView, contextAssertions, defaultStandingGapSettings, importFromPath, listCases, openStore, parseAt, recordStandingGaps, resolveContextEntity, type ImportFromPathResult, type StandingGapSettings } from '../../libs/utils/memory/index.ts';
import {
  AGENT_WORDING_EVENT, AgentWordedGenerator, checkAgentWording, evaluateEligibility, PhrasedQuestionGenerator, TemplateQuestionGenerator, QuestionCoordinator, templateFor,
  type BatchItem, type RequestResult,
} from '../../libs/utils/questions/index.ts';
import { createSelector, LinUcb, SELECTOR_IDS } from '../../libs/utils/policies/index.ts';
import { HybridRetriever, canSee, earliestDated, evidenceGate, visibleCase } from '../../libs/utils/retrieval/index.ts';
import { buildPeople } from '../../libs/utils/investigation/index.ts';
import type { CandidateMatch } from '../../libs/utils/contracts/investigation.ts';
import { awardPoints, balanceOf, getOptIn, participates, rating, revokeContribution, setOptIn, type ParticipationKind } from '../../libs/utils/participation/index.ts';
import { applyDirectory } from './directory.ts';
import { capturedSummary } from './capture.ts';
import { resetDemo } from './demo.ts';
import { DEFAULT_ACTIVITY_LOG, readActivity, type ActivityResponse } from './activity.ts';
import { activityPage } from './activity-page.ts';
import { caseProvenance } from './provenance-strip.ts';
import { contextPage } from './context-page.ts';
import { expertCost, storeHealthLine } from './costs.ts';
import { createDemoClock, type DemoClock, type DemoClockStatus } from './demo-clock.ts';
import { DEFAULT_DB_PATH } from './paths.ts';
import { badRequest, conflict, forbidden, notFound, toServiceError } from './errors.ts';
import { ACTIVE_QUESTION, personView, polishCaveat, questionView, resultView, type InvestigationResult } from './views.ts';
import { gapsView, notAskedReason, violationWords, type GapsView } from './inquiry.ts';
import { inQuiet, nextWindow } from '../../libs/utils/questions/quiet-hours.ts';

export { DEFAULT_DB_PATH, REPO_ROOT } from './paths.ts';
export const SERVICE_VERSION = '0.1.0';
const SETTINGS_ID = 'user';
const RECOMMENDATION_PROSE: Record<string, string> = {
  reuse: 'The recommendation is to reuse the earlier fix',
  'check-first': 'The recommendation now starts with a check',
  qualified: 'The recommendation was updated, with conditions',
  'retain-uncertainty': 'The recommendation stays uncertain',
  none: 'There is no recommendation yet',
};
/** Cut at a word boundary and add an ellipsis. */
const clip = (text: string, max: number): string => {
  const t = text.replace(/\s+/g, ' ').trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max / 2 ? cut.slice(0, at) : cut).replace(/[\s,.;:-]+$/, '')}…`;
};
const ANONYMOUS: Principal = { id: 'anonymous', displayName: 'Anonymous', groups: [], type: 'human' };

export type ExtendedSettings = UserSettings & { selectorId: string };

export interface EngineOptions {
  /** SQLite path or ':memory:'. Default data/local/knowledge-twin.sqlite. */
  dbPath?: string;
  /** Use an already-open store (tests); the engine then does not close it. */
  store?: KnowledgeStore;
  orgId?: string;
  /** Fixed clock (tests). When given, the demo clock routes cannot move time. */
  clock?: () => Date;
  /** Movable demo clock (default: a fresh one in real time); the simulated activity stream drives it through POST /demo/clock. */
  demoClock?: DemoClock;
  /** JSONL file written by the simulated activity stream and tailed by GET /demo/activity. */
  activityLogPath?: string;
  /** Organization configuration for investigation (distinguishing keys, observability groups, templates ...). */
  investigation?: Partial<InvestigationSettings>;
  /** Overrides for the question limits (daily limit, cooldown, max open, per-investigation cap). */
  coordinator?: Partial<CoordinatorSettings>;
  /** Directory holding Elisa's example files (teams_chat.json, email.txt) for the demo reset. */
  elisaDir?: string;
  /** Directory holding families.json + family folders. */
  scenariosDir?: string;
  fixturesDir?: string;
  /** B1: generated dated follow-ups imported by the demo reset (default data/demo/followups). */
  followupsDir?: string;
  /** B1: follow-ups imported only when Elisa's thread is absent (default data/demo/followups-synthetic). */
  followupsSyntheticDir?: string;
  /** B6 final: the generated older-units stand-in imported on the default seed when Elisa's thread is absent (default data/demo/older-units-synthetic). */
  olderUnitsSyntheticDir?: string;
  /** B5: the generated "experts disagree" thread imported by the demo reset (default data/demo/experts-disagree). */
  expertsDisagreeDir?: string;
  /**
   * B1: capture-time standing gaps. They are always recorded on import (and on clock moves); `ask: true` (wired by the
   * service, the MCP server and the demo scripts from org-config) also asks them through the coordinator.
   */
  standingGaps?: Partial<StandingGapSettings> & { ask?: boolean };
  /** Model slots used when the user has not chosen any (default DEFAULT_MODEL_SLOTS: every slot on rules). */
  models?: Partial<ModelSlots>;
  /** The model lifecycle manager, or options for one (tests inject a fake local provider here). */
  modelManager?: ModelManager | ModelManagerOptions;
  /**
   * Background model work without a request: indexing embeddings after imports/answers/outcomes and warming a slot
   * switched to local. Off by default so tests never reach a model; main.ts turns it on. Requests that need a model
   * (an investigation with embed=local, GET /models, a pull) work either way.
   */
  autoModels?: boolean;
  /**
   * Where live LinUCB state is kept between restarts (BUILD_BRIEF 5.4). Default: linucb-live.json next to a file
   * database (data/local/), none for ':memory:' or a provided store. `false` turns persistence off. Never data/models.
   */
  linucbStatePath?: string | false;
}

export interface ClarificationResult {
  state: InvestigationState;
  /** Open (queued/delivered) question for this investigation, when one exists. */
  question?: QuestionRecord;
  /** 'refused' (B7): the preferred person cannot be asked for this gap; nothing was asked. */
  status: 'question-open' | 'deferred' | 'not-needed' | 'exhausted' | 'refused';
  reason: string;
  /** B7: on a refusal, who the engine would ask instead (when anyone is eligible now). */
  wouldAsk?: { personEntityId: string; name: string; because?: string; gapId: string; text: string };
  /** B7: on a refusal, the preferred person's gates. */
  refused?: { personEntityId: string; name: string; violations: string[]; why: string[] };
  /** B7 batch mode: one entry per requested gap, in order. */
  questions?: Array<{
    gapId: string; status: 'question-open' | 'deferred' | 'not-needed' | 'exhausted'; reason: string;
    questionId?: string; questionStatus?: string; personEntityId?: string; name?: string; text?: string; deliverAfter?: string;
  }>;
}

/** B7: options of kt_request_clarification. */
export interface ClarificationOptions {
  gapId?: string;
  preferPersonEntityId?: string;
  /** Batch mode: up to 3 gaps of this investigation, each to its own best person. */
  gapIds?: string[];
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
  private readonly inlineDirectories: PeopleDirectory[] = [];
  private readonly demoClock: DemoClock;
  /** Model slots' lifecycle: detection, catalog, warm/idle/unload, pulls, api keys in memory. */
  readonly models: ModelManager;
  private embedQueue: Promise<IndexReport | undefined> = Promise.resolve(undefined);

  constructor(opts: EngineOptions = {}) {
    this.opts = opts;
    this.orgId = opts.orgId ?? 'org:local';
    this.demoClock = opts.demoClock ?? createDemoClock();
    this.clock = opts.clock ?? (() => this.demoClock.now());
    this.models = opts.modelManager instanceof ModelManager ? opts.modelManager : new ModelManager({ now: this.clock, ...(opts.modelManager ?? {}) });
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
    this.models.dispose();
    if (this.ownsStore) this.store.close();
  }

  // ---- wiring -------------------------------------------------------------------------------

  private now(): Date {
    return this.clock();
  }

  /** Visible organization directory: ids, names, roles, groups, availability. Never knowledge or answers. */
  directory(): DirectoryEntry[] {
    return storeDirectory(this.store)
      .all()
      .map((p) => ({ personEntityId: p.id, name: p.name, ...(p.role ? { role: p.role } : {}), groups: p.groups, available: p.available }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  getSettings(): ExtendedSettings {
    const rec = this.store.get('settings', SETTINGS_ID);
    const { id: _id, ...rest } = (rec ?? {}) as Partial<UserSettings> & { id?: string; selectorId?: string };
    const models: ModelSlots = { ...DEFAULT_MODEL_SLOTS, ...(this.opts.models ?? {}), ...(rest.models ?? {}) };
    return { ...defaultUserSettings, selectorId: this.opts.coordinator?.selectorId ?? defaultCoordinatorSettings.selectorId, ...rest, models };
  }

  /** The effective model slots (stored choice, else the host's EngineOptions.models, else every slot on rules). */
  modelSlots(): ModelSlots {
    return this.getSettings().models ?? DEFAULT_MODEL_SLOTS;
  }

  private invSettings(): InvestigationSettings {
    const s = this.getSettings();
    const base = this.opts.investigation ?? {};
    return defaultInvestigationSettings({
      ...base,
      coordinator: { ...defaultCoordinatorSettings, ...(base.coordinator ?? {}), ...(this.opts.coordinator ?? {}), selectorId: s.selectorId },
    });
  }

  /** File holding live LinUCB state, or undefined when persistence is off. */
  linucbStatePath(): string | undefined {
    if (this.opts.linucbStatePath === false) return undefined;
    if (this.opts.linucbStatePath) return this.opts.linucbStatePath;
    return this.ownsStore && this.dbPath !== ':memory:' ? join(dirname(this.dbPath), 'linucb-live.json') : undefined;
  }

  private selector(id: string): Selector {
    let sel = this.selectors.get(id);
    if (!sel) {
      try {
        sel = createSelector(id, { rules: { clock: this.clock }, epsilon: { clock: this.clock } });
      } catch (e) {
        throw badRequest(e instanceof Error ? e.message : String(e));
      }
      // Live learning survives a restart: the LinUCB state saved after each measured reward is loaded back.
      const path = sel.id === 'linucb' ? this.linucbStatePath() : undefined;
      if (path && existsSync(path)) {
        try {
          sel = LinUcb.fromArtifact(JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>);
        } catch {
          // A state file from another build (feature list changed) or a broken one: start fresh, keep the file for inspection.
        }
      }
      this.selectors.set(id, sel);
    }
    return sel;
  }

  /** Saves live LinUCB state after a reward (only LinUCB has state worth keeping; the rules selector is a fixed prior). */
  private selectorUpdated(sel: Selector): void {
    const path = sel.id === 'linucb' ? this.linucbStatePath() : undefined;
    if (!path || !(sel instanceof LinUcb)) return;
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, `${JSON.stringify(sel.toModelArtifact({ id: 'linucb-live', dataset: { id: 'live', split: 'live', families: [] } }), null, 2)}\n`);
    } catch {
      // Persistence is a convenience; learning in memory continues.
    }
  }

  /**
   * The store metric (BUILD_BRIEF 5.1, 5.2) over the cases the principal may see (all cases without one). B7: a
   * principal (an agent over MCP) or a person id; the evidence gate applies as for every other read, so an outsider
   * counts fewer cases.
   */
  storeHealth(who?: string | Principal): StoreHealth {
    const p = who === undefined ? undefined : typeof who === 'string' ? this.principalFor(who) : this.effective(who);
    // §5.2 "links made without an answer" (D-B6-29): the system's case-to-case links are B1's pairing Patterns. A
    // confirmed one without the answer that confirmed it counts against correctness. The coordinator only writes a
    // pairing with its answer, so this is 0 by construction today; it is counted, not assumed.
    const links = (store: KnowledgeStore): { made: number; withoutAnswer: number } => {
      const made = store.list('pattern').filter((x) => x.orgId === this.orgId && x.status === 'confirmed');
      return { made: made.length, withoutAnswer: made.filter((x) => !x.answerId).length };
    };
    const opts = { now: this.now(), distinguishingKeys: this.invSettings().distinguishingKeys, outcomeKey: OUTCOME_KEY, links };
    if (!p) return storeHealth(this.store, undefined, opts);
    const gate = evidenceGate(this.store, p);
    const caseIds = listCases(this.store, p, this.orgId).filter((c) => !!visibleCase(c, gate)).map((c) => c.id);
    return storeHealth(this.store, p, { ...opts, caseIds });
  }

  /**
   * The embed slot's index when embed=local and the store keeps vectors: a cheap view over r_embedding with the
   * engine's cached provider and embedding cache. Undefined otherwise (the trigram list stays).
   */
  embeddingIndex(): EmbeddingIndex | undefined {
    const choice = this.modelSlots().embed;
    if (choice.provider !== 'local' || !this.store.embeddings) return undefined;
    return new EmbeddingIndex(this.store, this.models.local, choice.model ?? DEFAULT_LOCAL_MODELS.embed, {
      cache: this.models.cache, cardText: (id) => caseCard(this.store, id),
    });
  }

  /**
   * Bring r_embedding in line with the store (new evidence, claims, rebuilt case cards; unchanged text is skipped).
   * Serialized; failures go to the embed slot's status chip. Resolves undefined when embed is not local.
   */
  refreshEmbeddings(): Promise<IndexReport | undefined> {
    this.embedQueue = this.embedQueue.then(async () => {
      const index = this.embeddingIndex();
      if (!index) return undefined;
      try {
        const r = await index.indexStore();
        this.models.clearFailure('embed');
        return r;
      } catch (e) {
        this.models.recordFailure('embed', e instanceof Error ? e.message : String(e));
        return undefined;
      }
    });
    return this.embedQueue;
  }

  /** Resolves when queued embedding work has finished (tests, demo scripts). */
  embeddingsIdle(): Promise<IndexReport | undefined> {
    return this.embedQueue;
  }

  private afterChange(): void {
    if (this.opts.autoModels) void this.refreshEmbeddings();
  }

  private wiring() {
    const settings = this.invSettings();
    const directory: PersonDirectory = storeDirectory(this.store);
    const index = this.embeddingIndex();
    const retriever = new HybridRetriever(this.store, index
      ? { ...settings, embedding: { index, onFailure: (reason, code) => this.models.recordFailure('embed', reason, code), skip: () => this.models.cooling('embed') } }
      : this.modelSlots().embed.provider === 'api' ? { ...settings, embedUnavailable: 'unsupported' } : settings);
    const assessor = new RulesAssessor({ store: this.store, settings });
    const qctx = { store: this.store, settings, directory, clock: this.clock };
    const templates = new TemplateQuestionGenerator(qctx);
    const phrase = this.slotModel('phrase');
    const generator: QuestionGenerator = !phrase ? templates
      : 'unavailable' in phrase ? templates
      : new PhrasedQuestionGenerator({
        inner: templates, ctx: qctx, provider: phrase.provider, model: phrase.model,
        onFailure: (reason, code) => this.models.recordFailure('phrase', reason, code), skip: () => this.models.cooling('phrase'),
      });
    if (phrase && 'unavailable' in phrase) this.models.recordFailure('phrase', phrase.unavailable);
    const selector = this.selector(settings.coordinator.selectorId);
    // B7: an agent's accepted wording (kt_propose_question) replaces the text of that gap's next question.
    const worded = new AgentWordedGenerator({ inner: generator, templates, ctx: qctx });
    const coordinator = new QuestionCoordinator({ store: this.store, settings, selector, generator: worded, retriever, assessor, directory, clock: this.clock, onSelectorUpdated: (sel) => this.selectorUpdated(sel) });
    return { settings, directory, retriever, assessor, templates, generator, selector, coordinator };
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

  /**
   * B1: deliver questions held by quiet hours whose window has come. Called on clock moves, question listings, requests,
   * investigations and status reads (there is no timer: the demo clock and the panel's poll drive it).
   */
  private deliverDue(): void {
    if (!this.store.list('question', { where: { status: 'queued' } }).some((q) => q.deliverAfter)) return;
    this.wiring().coordinator.deliverDue();
  }

  private standingSettings(): StandingGapSettings {
    const { ask: _ask, ...rest } = this.opts.standingGaps ?? {};
    return { ...defaultStandingGapSettings, diagnosticActions: this.invSettings().diagnosticActions, ...rest };
  }

  /**
   * B1: ask open standing gaps through the same coordinator (recipients, eligibility, budgets, quiet hours). A state is
   * requested only when some recipient is eligible now, so a busy person leaves no decision records behind; a person with
   * an open question (an investigation's, or another standing one) is not eligible. Most useful kind first.
   */
  async askStanding(w: ReturnType<Engine['wiring']> = this.wiring()): Promise<QuestionRecord[]> {
    if (!this.opts.standingGaps?.ask) return [];
    const ctx = { store: this.store, settings: w.settings, directory: w.directory, clock: this.clock };
    const rank = (st: InvestigationState): number => {
      const kinds = st.gaps.filter((g) => g.status === 'open').map((g) => parseGapId(g.id)?.kind);
      return kinds.includes('outcome') ? 0 : kinds.includes('pairing') ? 1 : 2;
    };
    const states = this.store.list('investigation').filter((st) => st.origin === 'standing' && st.gaps.some((g) => g.status === 'open'))
      .sort((a, b) => rank(a) - rank(b) || a.id.localeCompare(b.id));
    const out: QuestionRecord[] = [];
    for (const st of states) {
      if (questionsForInvestigation(this.store, st.id).some((q) => ACTIVE_QUESTION.has(q.status))) continue;
      // Who could be asked does not depend on the wording: the pre-check uses the templates, so only the question that
      // is actually requested goes to the phrase model (integration review, D-INT-12).
      const cands = await w.templates.generate(st, w.settings.questions.maxCandidates);
      if (!cands.some((c) => c.recipientIds.some((pid) => evaluateEligibility(ctx, st, c, pid).eligible))) continue;
      const r = await w.coordinator.request(st);
      if (r.question) out.push(r.question);
    }
    return out;
  }

  /**
   * B1: upkeep at the engine's now: deliver questions whose quiet-hours window has come, re-record standing gaps (a 24 h
   * outcome gap becomes due as the clock moves) and ask them. Run on clock moves; callable by hosts and tests.
   */
  async upkeep(): Promise<QuestionRecord[]> {
    this.deliverDue();
    recordStandingGaps(this.store, { orgId: this.orgId, now: this.now().toISOString(), settings: this.standingSettings() });
    return this.askStanding();
  }

  // ---- trace --------------------------------------------------------------------------------

  /** B1 review: background upkeep never fails silently; the failure is a trace event (the request itself succeeded). */
  private standingFailed(after: 'import' | 'clock', e: unknown): void {
    try {
      this.trace('standing', 'standing.failed', { id: 'system', displayName: 'standing gaps' }, { after, error: e instanceof Error ? e.message : String(e) });
    } catch { /* the store itself is gone (closed); nothing left to record into */ }
  }

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
    return resultView(this.store, this.sync(state), ANONYMOUS, this.wiring().settings.loopReasons);
  }

  // ---- routes -------------------------------------------------------------------------------

  health(routes: string[]): ApiRoutes['GET /health']['res'] {
    return { ok: true, version: SERVICE_VERSION, store: this.dbPath, routes };
  }

  /**
   * The provider and model serving a slot, `{unavailable}` when the slot names a provider that cannot run now (api
   * without a key), or undefined for rules.
   */
  slotModel(slot: ModelSlotName): { provider: ModelProvider; model: string } | { unavailable: string; code: string } | undefined {
    const choice = this.modelSlots()[slot];
    if (choice.provider === 'rules') return undefined;
    if (choice.provider === 'local') return { provider: this.models.local, model: choice.model ?? DEFAULT_LOCAL_MODELS[slot] };
    const api = this.models.api();
    const model = choice.model ?? (slot === 'extract' ? 'claude-haiku-5-5' : 'claude-sonnet-5-5');
    if (!api || !this.models.hasKey(vendorOf(model))) return { unavailable: this.models.noApi ? NO_API_REASON : `no ${vendorOf(model)} key`, code: 'disabled' };
    return { provider: api, model };
  }

  /**
   * POST /import and "Remember this": the rules import, then (extract slot on a model) the model's proposal for the
   * same threads, validated and committed as a union within the slot's 60 s. On a failure or timeout the import stays
   * rules-only and the response says so with the fallback route. With extract on rules this is importData exactly.
   */
  async importAndEnrich(req: ImportRequest): Promise<ImportResponse> {
    const sm = this.slotModel('extract');
    if (!sm) return this.importData(req);
    let items: EnrichItem[] = [];
    let scope: AccessScope = { visibility: 'org' };
    const res = this.importData(req, (it, sc) => { items = it; scope = sc; });
    let report: EnrichReport;
    const cooling = 'unavailable' in sm ? undefined : this.models.cooling('extract');
    if ('unavailable' in sm || cooling) {
      const why = 'unavailable' in sm ? { reason: sm.unavailable, code: sm.code } : { reason: cooling!, code: 'cooldown' };
      this.models.recordFailure('extract', why.reason, why.code);
      report = { route: fallbackRoute(RULES_ROUTE, 'extract', why.code), threads: items.length, modelClaimIds: [], dropped: [], fallback: why };
    } else {
      const extractor = createLlmExtractor({ provider: sm.provider, model: sm.model });
      report = await enrichWithModel(this.store, items, extractor, {
        orgId: this.orgId, accessScope: scope, now: this.now().toISOString(),
        onFailure: (reason, code) => this.models.recordFailure('extract', reason, code),
      });
      if (!report.fallback) this.models.clearFailure('extract');
      this.reapplyDirectory();
    }
    this.trace(res.batch.id, 'import.enriched', { id: 'system', displayName: 'import' }, {
      route: report.route, modelClaims: report.modelClaimIds.length, dropped: report.dropped.length, ...(report.fallback ? { fallback: report.fallback.reason } : {}),
    });
    // Integration (D-INT-04): model claims can fill or open standing gaps, so they are re-recorded over the union, then asked.
    if (report.modelClaimIds.length) recordStandingGaps(this.store, { orgId: this.orgId, now: this.now().toISOString(), settings: this.standingSettings() });
    if (this.opts.standingGaps?.ask) void this.askStanding().catch((e) => this.standingFailed('import', e));
    this.afterChange();
    return {
      ...res,
      extraction: { route: report.route, modelClaims: report.modelClaimIds.length, dropped: report.dropped.length, ...(report.fallback ? { fallback: report.fallback.reason } : {}) },
    };
  }

  importData(req: ImportRequest, onCommitted?: (items: EnrichItem[], scope: AccessScope) => void): ImportResponse {
    if (req.path && !existsSync(req.path)) throw badRequest(`Path does not exist: ${req.path}`);
    const batchesBefore = new Set(this.store.list('importBatch').map((b) => b.id));
    let res: ImportResponse;
    let ids: ImportFromPathResult['ids'];
    try {
      ({ ids, ...res } = importFromPath(this.store, {
        format: req.format, ...(req.path ? { path: req.path } : {}), ...(req.payload !== undefined ? { payload: req.payload } : {}),
        ...(req.connectionId ? { connectionId: req.connectionId } : {}), ...(req.accessGroups ? { accessGroups: req.accessGroups } : {}),
        orgId: this.orgId, now: this.now().toISOString(), standing: this.standingSettings(), ...(onCommitted ? { onCommitted } : {}),
      }));
    } catch (e) {
      throw badRequest(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (req.format === 'scenario-dir' && req.path) this.loadDirectoryFile(join(req.path, 'people.json'));
    // B4: a poller re-sends its people file with each channel import; an equal file is kept once, not appended again.
    if (req.directory && !this.inlineDirectories.some((d) => JSON.stringify(d) === JSON.stringify(req.directory))) this.inlineDirectories.push(req.directory);
    this.reapplyDirectory();
    // A scenario directory imports several sources, each its own batch; the response's batch id is their combination.
    const points = this.awardEvidence(new Set(this.store.list('importBatch').map((b) => b.id).filter((id) => !batchesBefore.has(id))));
    this.trace(res.batch.id, 'import.completed', { id: 'system', displayName: 'import' }, { format: req.format, counts: res.batch.counts, cases: res.cases, claims: res.claims, people: res.people, ...(points.length ? { points } : {}) });
    // Integration (D-INT-04): on the model path the standing gaps are asked after the model's union (importAndEnrich).
    if (this.opts.standingGaps?.ask && !onCommitted) void this.askStanding().catch((e) => this.standingFailed('import', e));
    this.afterChange();
    if (req.format === 'paste' && ids) res = { ...res, captured: capturedSummary(this.store, ids, res.batch, req.accessGroups) };
    return points.length ? { ...res, points } : res;
  }

  /**
   * R46: evidence a person authored that became a claim earns once per evidence record, at import, when that person
   * takes part at the time. The summary names nothing from the evidence; only the evidence id is kept as a reference.
   */
  private awardEvidence(batchIds: Set<string>): Array<{ personEntityId: string; points: number }> {
    if (!batchIds.size) return [];
    const dir = storeDirectory(this.store);
    const supported = new Set<string>();
    for (const c of this.store.list('claim')) for (const ref of c.supporting) supported.add(ref.evidenceId);
    const totals = new Map<string, number>();
    for (const e of this.store.list('evidence')) {
      if (!batchIds.has(e.lineage.importBatchId) || !supported.has(e.id)) continue;
      const who = dir.resolve(e.author.id);
      if (!who) continue;
      const n = this.award({ personEntityId: who, contributionEventId: `evidence:${e.id}`, kind: 'evidence', summary: 'Shared evidence that became knowledge', refId: e.id });
      if (n > 0) totals.set(who, (totals.get(who) ?? 0) + n);
    }
    return [...totals].map(([personEntityId, points]) => ({ personEntityId, points }));
  }

  private loadDirectoryFile(file: string): void {
    if (existsSync(file)) this.directoryFiles.add(file);
  }

  /** Later imports can widen a person's scope; the visible directory is the authority for groups, so re-apply it. */
  private reapplyDirectory(): void {
    for (const d of this.inlineDirectories) applyDirectory(this.store, this.orgId, d);
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
      .filter((v): v is CaseView => v !== undefined)
      .map((v) => ({ ...v, caveat: polishCaveat(v.caveat) }));
  }

  caseView(id: string, principalId?: string): CaseView {
    const principal = this.principalFor(principalId);
    const v = buildCaseView(this.store, id, principal);
    if (!v) throw notFound(`Unknown case ${id}`);
    // Artem 7 Nov: the people with relevant experience belong on the case page. The same people module as an
    // investigation runs, with this one case as the only candidate.
    const c = this.store.get('case', id);
    let people: PersonView[] = [];
    if (c) {
      const { settings, directory } = this.wiring();
      const gate = evidenceGate(this.store, principal);
      const candidate: CandidateMatch = { caseId: id, score: 1, retrieval: { route: 'rules', version: 'case-view' }, matchingConditions: [], conflictingConditions: [], missingConditions: [], expectedTraits: [], reasons: [] };
      try {
        people = buildPeople({ store: this.store, directory, principal, gate, candidates: [candidate], selectedCaseId: id, entityIds: c.entityIds, settings, now: this.clock() }).map((p) => personView(p, gate));
      } catch { people = []; }
    }
    const provenance = caseProvenance(this.store, id, evidenceGate(this.store, principal));
    return { ...v, caveat: polishCaveat(v.caveat), people, ...(provenance ? { provenance } : {}) };
  }

  /**
   * B1: GET /context. Assertions bound to an entity (id, name or alias among the entities the principal may see),
   * with validity windows, source and status, evaluated at `at` (default now). Access as for every other read.
   */
  contextAssertions(entity: string, at?: string, principalId?: string): ApiRoutes['GET /context']['res'] {
    const atMs = at === undefined ? this.now().getTime() : parseAt(at);
    if (atMs === undefined) throw badRequest(`Invalid at: ${at} (ISO 8601 with a zone, e.g. 2026-10-20T12:00:00Z)`);
    const principal = this.principalFor(principalId);
    const ent = resolveContextEntity(this.store, entity, principal);
    if (!ent) throw notFound(`Unknown entity ${entity}`);
    return contextAssertions(this.store, ent, principal, atMs, at);
  }

  async investigate(req: InvestigateRequest): Promise<InvestigationResult> {
    // B3: a preview persists nothing, so it does not run the quiet-hours delivery either.
    const preview = req.preview === true;
    if (!preview) this.deliverDue();
    const principal = this.effective(req.principal);
    const w = this.wiring();
    const observations = req.observations ?? [];
    // B1: a point-in-time view is its own investigation (the moment is part of the id) and never asks anyone.
    let at: string | undefined;
    if (req.at !== undefined) {
      const ms = parseAt(req.at);
      if (ms === undefined) throw badRequest(`Invalid at: ${req.at} (ISO 8601 with a zone, e.g. 2026-10-20T12:00:00Z)`);
      at = new Date(ms).toISOString();
    }
    // B3: an evidence cutoff is a point-in-time view inside an undated thread. Only that thread up to the cutoff counts
    // (gateAt); without `at` the moment is just before the earliest dated source the requester can see (else now), so
    // claim validity is read before any dated change. An id the requester may not see is refused like an unknown one.
    const atEvidence = req.atEvidence;
    if (atEvidence !== undefined) {
      const gate = evidenceGate(this.store, principal);
      if (!this.store.get('evidence', atEvidence) || !gate.ref({ evidenceId: atEvidence })) throw badRequest(`Unknown atEvidence: ${atEvidence}`);
      if (at === undefined) {
        const first = earliestDated(this.store, gate);
        at = new Date(first !== undefined ? first - 1 : this.now().getTime()).toISOString();
      }
    }
    const problemId = stableId('prob', this.orgId, principal.id, req.text.trim(), (req.entityIds ?? []).join(','), JSON.stringify(observations.map((o) => [o.key, o.operator, o.value ?? null])), (req.attachmentNames ?? []).join('|'), ...(at ? [`at:${at}`] : []), ...(atEvidence ? [`ev:${atEvidence}`] : []), ...(preview ? ['preview'] : []));
    const problem: Problem = {
      id: problemId, orgId: this.orgId, text: req.text.trim(),
      requester: principal.type === 'agent' ? { id: 'agent', displayName: principal.displayName, agentId: principal.id } : actorOf(principal),
      ...(req.entityIds ? { entityIds: req.entityIds } : {}), ...(observations.length ? { observations } : {}),
      ...(req.attachmentNames ? { attachmentNames: req.attachmentNames } : {}), createdAt: this.now().toISOString(), ...(at ? { at } : {}),
      ...(atEvidence ? { atEvidence } : {}),
    };
    if (preview) {
      try {
        const state = await investigate({ problem, store: this.store, principal, deps: { retriever: w.retriever, assessor: w.assessor, selector: w.selector, settings: w.settings, clock: this.clock, directory: w.directory }, persist: false });
        return resultView(this.store, state, ANONYMOUS, w.settings.loopReasons);
      } catch (e) {
        throw toServiceError(e);
      }
    }
    let state: InvestigationState;
    // The id is derived from the whole request, so a repeat carries no new observations or attachments: what the stored
    // state says about the question loop (an answer already used) must survive the refresh.
    const prior = this.store.get('investigation', investigationId(problemId));
    try {
      state = await investigate({ problem, store: this.store, principal, deps: { retriever: w.retriever, assessor: w.assessor, generator: w.generator, selector: w.selector, settings: w.settings, clock: this.clock, directory: w.directory } });
      if (req.allowQuestions !== false && !at) state = (await w.coordinator.request(state)).state;
      if (prior?.loop === 'answered' && state.loop === 'no-question-needed') {
        state = this.store.put('investigation', { ...state, loop: 'answered', loopReason: prior.loopReason ?? w.settings.loopReasons.answered });
      }
    } catch (e) {
      throw toServiceError(e);
    }
    return this.view(state);
  }

  getInvestigation(id: string, principalId?: string): InvestigationResult {
    // Known gap (see worker report): an absent principalId is still accepted because the typed GET contract carries no
    // principal and tests/e2e.test.ts reads without one. A deployment must authenticate callers.
    this.deliverDue();
    return this.view(this.owned(id, principalId));
  }

  /**
   * B1: the stored problem of an investigation re-run as of `at` (its own investigation id; no question is asked).
   * Only the principal that started the investigation may do this, as for every other read of it.
   */
  async contextAt(id: string, at: string, principalId?: string): Promise<InvestigationResult> {
    const state = this.owned(id, principalId);
    const starter = startedBy(state) ?? this.principalFor(principalId);
    const p = state.problem;
    return this.investigate({
      text: p.text, principal: starter, ...(p.entityIds ? { entityIds: p.entityIds } : {}), ...(p.observations ? { observations: p.observations } : {}),
      ...(p.attachmentNames ? { attachmentNames: p.attachmentNames } : {}), allowQuestions: false, at,
    });
  }

  /**
   * Run the clarification loop for an existing investigation. Limits and eligibility are the coordinator's, whoever asks.
   * B7: `gapId` asks about that gap only; `preferPersonEntityId` asks that person only when they are an eligible
   * recipient for it, else the call is refused and names who would be asked instead; `gapIds` (max 3) is batch mode.
   * The agent never reaches a person directly: the question travels through the companion (or the Slack DM) as always.
   */
  async requestClarification(principalIn: Principal, investigationId: string, opts: ClarificationOptions = {}): Promise<ClarificationResult> {
    this.deliverDue();
    const principal = this.effective(principalIn);
    const state0 = this.owned(investigationId, principal.id);
    const w = this.wiring();
    if (opts.gapIds?.length) {
      // Batch mode picks each gap's own best person: a single gap or a preferred person would be silently dropped (D-B7-14).
      if (opts.gapId !== undefined || opts.preferPersonEntityId !== undefined) throw badRequest('gapIds (batch mode) cannot be combined with gapId or preferPersonEntityId: pass either gapIds, or gapId with an optional preferPersonEntityId');
      return this.requestBatch(state0, opts.gapIds, w);
    }
    const dir = w.directory;
    const pref = opts.preferPersonEntityId !== undefined ? (dir.resolve(opts.preferPersonEntityId) ?? opts.preferPersonEntityId) : undefined;
    if (pref !== undefined && !dir.get(pref)) throw notFound(`Unknown person ${opts.preferPersonEntityId}: not in the directory (kt_find_people or kt_list_gaps list who could answer)`);
    if (opts.gapId !== undefined) {
      const gap = state0.gaps.find((g) => g.id === opts.gapId);
      if (!gap) throw notFound(`Unknown gap ${opts.gapId} in investigation ${investigationId}`);
      // A gap no question is built for (resolved, the requester can check it, not consequential) asks nobody and leaves
      // the investigation's loop line alone (another gap may still need a person).
      if (gap.status !== 'open' || !(await templateFor(w.templates, state0, gap.id))) {
        return { state: state0, status: 'not-needed', reason: notAskedReason({ store: this.store, settings: w.settings, directory: dir, clock: this.clock }, gap) };
      }
    }
    let r: RequestResult;
    try {
      r = await w.coordinator.request(state0, { ...(opts.gapId ? { gapId: opts.gapId } : {}), ...(pref ? { preferPersonEntityId: pref } : {}) });
    } catch (e) {
      throw toServiceError(e);
    }
    this.sync(r.state);
    const nameOf = (id: string): string => dir.get(id)?.name ?? id;
    if (r.refused) {
      const f = r.refused;
      const why = f.excluded ? ['already chosen for another gap in this call'] : violationWords(f.violations);
      const instead = f.wouldAsk ? ` The engine would ask ${nameOf(f.wouldAsk.personEntityId)}${f.wouldAsk.because ? ` (${f.wouldAsk.because})` : ''} instead: pass that preferPersonEntityId, or none.` : ' Nobody else can be asked about it now either.';
      const quiet = r.plan?.quietUntil && f.wouldAsk ? ` Quiet hours: a question asked now waits, queued, until ${r.plan.quietUntil}.` : '';
      return {
        state: r.state, status: 'refused',
        reason: `${nameOf(f.personEntityId)} cannot be asked about this gap: ${why.join('; ')}.${instead}${quiet}`,
        refused: { personEntityId: f.personEntityId, name: nameOf(f.personEntityId), violations: f.violations, why },
        ...(f.wouldAsk ? { wouldAsk: { personEntityId: f.wouldAsk.personEntityId, name: nameOf(f.wouldAsk.personEntityId), ...(f.wouldAsk.because ? { because: f.wouldAsk.because } : {}), gapId: f.wouldAsk.gapId, text: f.wouldAsk.text } } : {}),
      };
    }
    if (r.question) {
      const q = r.question;
      const held = q.status === 'queued' && q.deliverAfter ? ` It is held by quiet hours until ${q.deliverAfter} (${r.state.loopReason ?? 'nobody is woken at night'}).` : '';
      const other = (opts.gapId && q.candidate.gapId !== opts.gapId) || (pref && q.personEntityId !== pref)
        ? ' This is the question already open for this investigation (one at a time); cancel it with kt_cancel_clarification to ask another, or use gapIds for several gaps at once.' : '';
      // The preference was not used because a question is already open: still say whether that person could be asked (D-B7-14).
      let prefNote = '';
      if (pref && q.personEntityId !== pref) {
        const p = await w.coordinator.plan(r.state, { ...(opts.gapId ? { gapId: opts.gapId } : {}), preferPersonEntityId: pref });
        prefNote = p.preferred && !p.preferred.eligible
          ? ` ${nameOf(pref)} cannot be asked about ${opts.gapId ? 'this gap' : 'any open gap'}: ${violationWords(p.preferred.violations).join('; ')}.`
          : ` ${nameOf(pref)} could be asked once this question is answered or cancelled.`;
      }
      return { state: r.state, question: q, status: 'question-open', reason: `Question ${q.id} is ${q.status}.${held}${other}${prefNote}` };
    }
    const violations = [...new Set(r.eligibility.flatMap((e) => e.violations))];
    const why = r.decision?.reason ?? '';
    if (r.state.loop === 'no-question-needed') return { state: r.state, status: 'not-needed', reason: 'No open consequential gap needs a person to answer.' };
    const reason = `${violations.length ? `Blocked by: ${violations.join(', ')}. ` : ''}${why}`.trim() || `Loop status: ${r.state.loop}.`;
    return { state: r.state, status: r.state.loop === 'exhausted' ? 'exhausted' : 'deferred', reason };
  }

  /** B7 batch mode (D-B7-03): each gap to its own best person, every per-person gate as usual, at most 3 per investigation. */
  private async requestBatch(state0: InvestigationState, gapIdsIn: string[], w: ReturnType<Engine['wiring']>): Promise<ClarificationResult> {
    if (gapIdsIn.length > 3) throw badRequest('At most 3 gapIds per call');
    const ctx = { store: this.store, settings: w.settings, directory: w.directory, clock: this.clock };
    const nameOf = (id: string): string => w.directory.get(id)?.name ?? id;
    const gapIds = [...new Set(gapIdsIn)];
    const items: NonNullable<ClarificationResult['questions']> = [];
    const askable: string[] = [];
    for (const id of gapIds) {
      const gap = state0.gaps.find((g) => g.id === id);
      if (!gap) throw notFound(`Unknown gap ${id} in investigation ${state0.id}`);
      if (gap.status !== 'open' || !(await templateFor(w.templates, state0, id))) items.push({ gapId: id, status: 'not-needed', reason: notAskedReason(ctx, gap) });
      else askable.push(id);
    }
    let out: { state: InvestigationState; items: BatchItem[] } = { state: state0, items: [] };
    try {
      if (askable.length) out = await w.coordinator.requestMany(state0, askable);
    } catch (e) {
      throw toServiceError(e);
    }
    this.sync(out.state);
    for (const it of out.items) {
      const q = it.result?.question;
      if (q) {
        const cur = this.store.get('question', q.id) ?? q;
        items.push({
          gapId: it.gapId, status: 'question-open', reason: `Question ${cur.id} is ${cur.status}.`, questionId: cur.id, questionStatus: cur.status,
          personEntityId: cur.personEntityId, name: nameOf(cur.personEntityId), text: cur.candidate.text,
          ...(cur.status === 'queued' && cur.deliverAfter ? { deliverAfter: cur.deliverAfter } : {}),
        });
      } else if (it.skipped) {
        items.push({ gapId: it.gapId, status: 'exhausted', reason: 'The investigation already has its 3 questions.' });
      } else {
        const v = [...new Set((it.result?.eligibility ?? []).flatMap((e) => e.violations))];
        items.push({ gapId: it.gapId, status: 'deferred', reason: v.length ? `Nobody eligible: ${violationWords(v).join('; ')}.` : (it.result?.decision?.reason ?? 'Nobody eligible now.') });
      }
    }
    const ordered = gapIds.map((id) => items.find((x) => x.gapId === id)!).filter(Boolean);
    const opened = ordered.filter((x) => x.status === 'question-open');
    const status: ClarificationResult['status'] = opened.length ? 'question-open' : ordered.every((x) => x.status === 'exhausted') ? 'exhausted' : ordered.every((x) => x.status === 'not-needed') ? 'not-needed' : 'deferred';
    const state = this.store.get('investigation', state0.id) ?? out.state;
    return { state, status, reason: `${opened.length} of ${ordered.length} gaps asked.`, questions: ordered };
  }

  /** B7: the open gaps of an investigation the principal started, who could answer each, and the confidence labels. */
  async listGaps(principalIn: Principal, investigationId: string): Promise<GapsView> {
    this.deliverDue();
    const principal = this.effective(principalIn);
    const state = this.owned(investigationId, principal.id);
    const w = this.wiring();
    const ctx = { store: this.store, settings: w.settings, directory: w.directory, clock: this.clock };
    const templates = await w.templates.generateDetailed(state, state.gaps.length + 1);
    return gapsView(ctx, state, templates, 'support (what history shows) and applicability (whether it fits this case) are labels with reasons and evidence, never a number; a hypothesis is never a verified cause.');
  }

  /**
   * B7: the agent's own wording for the question of one gap. Accepted only through the phrase validator (BUILD_BRIEF
   * 2.4) against the gap, the visible case facts and the asset; remembered as a 'question.proposed' trace event and used
   * for that gap's next question ("worded by the agent" on the card). Otherwise the template text is used.
   */
  async proposeQuestion(principalIn: Principal, investigationId: string, gapId: string, text: string): Promise<{
    gapId: string; accepted: boolean; text: string; usedText: string | null; templateText?: string; reasons?: string[]; appliesTo: string;
  }> {
    const principal = this.effective(principalIn);
    const state = this.owned(investigationId, principal.id);
    const gap = state.gaps.find((g) => g.id === gapId);
    if (!gap) throw notFound(`Unknown gap ${gapId} in investigation ${investigationId}`);
    const w = this.wiring();
    const ctx = { store: this.store, settings: w.settings, directory: w.directory, clock: this.clock };
    const clean = text.replace(/\s+/g, ' ').trim();
    const t = gap.status === 'open' ? await templateFor(w.templates, state, gapId) : undefined;
    if (!t) return { gapId, accepted: false, text: clean, usedText: null, reasons: [notAskedReason(ctx, gap)], appliesTo: 'no question is asked for this gap' };
    const verdict = checkAgentWording(ctx, state, t.facts, clean);
    this.trace(state.id, AGENT_WORDING_EVENT, { id: principal.id, displayName: principal.displayName }, {
      gapId, text: clean, accepted: verdict.ok, ...(verdict.ok ? {} : { reason: verdict.reason }), by: principal.id, at: this.now().toISOString(),
    });
    const open = questionsForInvestigation(this.store, state.id).find((q) => ACTIVE_QUESTION.has(q.status) && q.candidate.gapId === gapId);
    const appliesTo = open ? `the next question for this gap (question ${open.id} is already ${open.status} with its own wording)` : 'the next question for this gap';
    return verdict.ok
      ? { gapId, accepted: true, text: clean, usedText: clean, templateText: t.candidate.text, appliesTo }
      : { gapId, accepted: false, text: clean, usedText: t.candidate.text, templateText: t.candidate.text, reasons: [verdict.reason], appliesTo };
  }

  /**
   * B7: the store metric for an agent: the cases the principal may see, completeness and correctness with their
   * denominators, singletons, and the open standing gaps (orphan pieces) on those cases, which the engine asks of their
   * performers within the same budgets and quiet hours.
   */
  storeHealthView(principalIn: Principal): StoreHealth & { standingGaps: { open: number; byKind: Record<string, number> }; quietHours?: { now: boolean; heldUntil?: string } } {
    const p = this.effective(principalIn);
    const h = this.storeHealth(p);
    const visible = new Set(h.cases.map((c) => c.caseId));
    const byKind: Record<string, number> = {};
    let open = 0;
    for (const st of this.store.list('investigation')) {
      if (st.origin !== 'standing') continue;
      for (const g of st.gaps) {
        const parsed = parseGapId(g.id);
        if (g.status !== 'open' || !parsed || !visible.has(parsed.caseId)) continue;
        open++;
        byKind[parsed.kind] = (byKind[parsed.kind] ?? 0) + 1;
      }
    }
    const qh = this.invSettings().coordinator.quietHours;
    const now = this.now();
    const quietHours = qh ? (inQuiet(now, qh) ? { now: true, heldUntil: nextWindow(now, qh).toISOString() } : { now: false }) : undefined;
    return { ...h, standingGaps: { open, byKind }, ...(quietHours ? { quietHours } : {}) };
  }

  async recordObservation(req: ObservationRequest): Promise<{ investigation: InvestigationResult }> {
    const principal = this.effective(req.principal);
    const state = this.owned(req.investigationId, principal.id);
    if (req.caseId) this.assertCaseVisible(req.caseId, principal);
    const w = this.wiring();
    try {
      const r = await w.coordinator.recordObservation(state.id, req.condition as Condition, actorOf(principal), req.caseId);
      // R46: an observation a person records for their own investigation is a contribution (one award per key and value).
      const who = storeDirectory(this.store).resolve(principal.id);
      if (who) this.award({ personEntityId: who, contributionEventId: stableId('obs-award', state.id, req.condition.key, String(req.condition.value ?? '')), kind: 'correction', summary: 'Recorded an observation', refId: state.id });
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
    if (who) this.award({ personEntityId: who, contributionEventId: id, kind: 'outcome-report', summary: `Reported an outcome (${req.result})`, refId: state.id });
    const w = this.wiring();
    for (const c of req.observations ?? []) {
      try {
        await w.coordinator.recordObservation(state.id, c as Condition, actorOf(principal), req.caseId);
      } catch (e) {
        throw toServiceError(e);
      }
    }
    // BUILD_BRIEF 5.4: an outcome question's reward is measured again once the outcome lands.
    w.coordinator.rewardOutcome(state.id);
    this.afterChange();
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
    this.deliverDue();
    // B4: a provider identity ('person:slack:U…') or directory id names the same person as on the answer path.
    const person = query.personEntityId ? (storeDirectory(this.store).resolve(query.personEntityId) ?? query.personEntityId) : undefined;
    const where = person ? { personEntityId: person } : undefined;
    const wanted = query.status === 'all' ? undefined : query.status ? [query.status] : ['queued', 'delivered', 'deferred'];
    const now = this.now().getTime();
    return this.store.list('question', where ? { where } : {})
      .filter((q) => !wanted || wanted.includes(q.status))
      // B1: a question held by quiet hours is not in anyone's inbox before its window (the panel treats queued as open).
      .filter((q) => !(q.status === 'queued' && q.deliverAfter && Date.parse(q.deliverAfter) > now))
      .map((q) => this.questionFor(q));
  }

  question(id: string): QuestionView {
    this.deliverDue();
    return this.questionFor(this.mustQuestion(id));
  }

  /** Viewed as the recipient, so the timeline never shows the recipient more than the recipient may see. */
  private questionFor(q: QuestionRecord): QuestionView {
    const p = this.principalFor(q.personEntityId);
    return questionView(this.store, q, p);
  }

  /** R46: points go only to a person who takes part at the time of the contribution; `settings.points` is the device's display switch, not this. */
  private award(a: { personEntityId: string; contributionEventId: string; kind: ParticipationKind; summary: string; refId?: string }): number {
    const r = awardPoints(this.store, { orgId: this.orgId, at: this.now().toISOString(), participates: participates(this.store, a.personEntityId), ...a });
    return r.awarded;
  }

  async answer(questionId: string, req: { principal: Principal; value: 'yes' | 'no' | 'unknown'; text?: string }): Promise<{ answer: Answer; receipt: ReceiptView; question: QuestionRecord }> {
    const principal = this.effective(req.principal);
    let q = this.mustQuestion(questionId);
    this.recipientCheck(q, principal);
    // B1 review: a free-text question (standing missing symptom) needs words; a bare Yes/No would use up the gap and
    // record nothing. 'unknown' (Not sure) is still accepted and records nothing, as for any question.
    if (q.candidate.answerType === 'free-text' && req.value !== 'unknown' && !req.text?.trim()) {
      throw badRequest('This question asks for your own words: write what you saw, or answer Not sure');
    }
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
      const points = this.award({ personEntityId: q.personEntityId, contributionEventId: r.answer.id, kind, summary: `Answered a question (${req.value === 'unknown' ? 'not sure' : req.value})`, refId: q.id });
      const receipt = this.receipt(req.value, r.question, r.state, points, r.recommendationChanged);
      this.afterChange();
      // The standing pass shares this request's wiring, so the answer has one phrase budget (D-B2-57), not two (D-INT-12).
      await this.askStanding(w);
      return { answer: r.answer, receipt, question: r.question };
    } catch (e) {
      throw toServiceError(e);
    }
  }

  /** Plain prose only: what was recorded, and what it did to the recommendation. No status words or identifiers. */
  private receipt(value: 'yes' | 'no' | 'unknown', q: QuestionRecord, state: InvestigationState | undefined, points: number | undefined, changed?: boolean): ReceiptView {
    const label = { yes: 'Recorded: Yes', no: 'Recorded: No', unknown: 'Recorded: Not sure' }[value];
    const gapKind = parseGapId(q.candidate.gapId)?.kind;
    const asked = `"${q.candidate.text.replace(/\s+/g, ' ').trim()}"`;
    const lead = value === 'unknown' ? `You were not sure about ${asked}.` : `You answered ${value} to ${asked}.`;
    if (state?.origin === 'standing') {
      // B1: a standing gap changes the case record, never a recommendation.
      const a = q.answerId ? this.store.get('answer', q.answerId) : undefined;
      const detail = gapKind === 'missing-symptom'
        ? (a?.text && value !== 'unknown' ? `You described the problem: "${clip(a.text, 120)}". It is kept as your report on the case.` : 'Nothing was recorded, and you will not be asked this again.')
        : gapKind === 'pairing'
        ? value === 'yes' ? `${lead} The two cases are now linked, with your answer as the evidence.`
          : value === 'no' ? `${lead} The two cases stay separate and will not be suggested together again.` : `${lead} Nothing was linked.`
        : value === 'unknown' ? `${lead} No outcome was recorded.` : `${lead} The outcome is recorded on the case as your report.`;
      return { title: gapKind === 'missing-symptom' && value !== 'unknown' ? 'Recorded: your description' : label, detail, canUndo: true, ...(points ? { pointsAwarded: points } : {}) };
    }
    const effect = value === 'unknown'
      ? 'No new fact was recorded, and you will not be asked this again.'
      : state && value === 'no' && state.recommendation.kind === 'retain-uncertainty' && gapKind === 'missing' ? 'The earlier case does not apply to this unit, so the recommendation stays uncertain.'
      : state && value === 'no' && state.recommendation.kind === 'retain-uncertainty' && gapKind === 'outcome' ? 'No recovery is reported in the earlier case, so the recommendation stays uncertain.'
      : state && changed === false ? 'Your answer was recorded, and the recommendation did not change.'
      : state ? `${RECOMMENDATION_PROSE[state.recommendation.kind] ?? 'The recommendation was updated'}.` : 'Your answer was saved as your own report.';
    return { title: label, detail: `${lead} ${effect}`, canUndo: true, ...(points ? { pointsAwarded: points } : {}) };
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
      this.award({ personEntityId: q.personEntityId, contributionEventId: `${to}:${questionId}`, kind: to, summary: to === 'defer' ? 'Saved a question for later' : 'Dismissed a question', refId: q.id });
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
    this.deliverDue();
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
    const state = this.owned(investigationId, principalId);
    const gate = evidenceGate(this.store, startedBy(state) ?? this.principalFor(principalId));
    return state.people.map((p) => personView(p, gate));
  }

  contactDraft(req: ContactDraftRequest): ContactDraft {
    const principal = this.effective(req.principal);
    const state = this.owned(req.investigationId, principal.id);
    const person = state.people.find((p) => p.personEntityId === req.personEntityId);
    if (!person) throw forbidden(`${req.personEntityId} is not among the people available to this requester for ${state.id}`);
    const settings = this.invSettings();
    const recorded = this.store.list('observation', { where: { investigationId: state.id } });
    const parsed = parseProblemText(state.problem.text, state.problem.id, {
      olderThroughYear: settings.ageFold.olderThroughYear, ...(settings.modelParser !== undefined ? { modelParser: settings.modelParser } : {}),
    }).conditions.filter((c) => !c.key.startsWith('intent.'));
    // A condition is shown with its value; one without a value ("Installed year" observed but not stated) says nothing and is skipped.
    const parsedSet = new Set<Condition>(parsed);
    const label = (c: Condition): string => {
      const base = c.label ?? c.key;
      const v = c.value === undefined ? '' : String(c.value);
      return !parsedSet.has(c) && v && typeof c.value !== 'boolean' && !base.toLowerCase().includes(v.toLowerCase()) ? `${base}: ${v}` : base;
    };
    const all = [...parsed, ...(state.problem.observations ?? []), ...recorded.map((o) => o.condition)].filter((c) => c.value !== undefined);
    const uniq = (xs: string[]): string[] => [...new Set(xs)];
    const performedKeys = new Set(['action.performed', 'component.replaced']);
    const isCheck = (c: Condition): boolean => performedKeys.has(c.key) || c.key.endsWith('.check') || settings.diagnosticActions.some((a) => String(c.value ?? '') === a);
    // The main symptom opens the list in the requester's own words: the sentence that holds the first symptom the requester can observe.
    const firstSymptom = parsed.filter((c) => settings.requesterObservableKeys.includes(c.key) && c.evidence[0]?.span)
      .sort((a, b) => (a.evidence[0]?.span?.start ?? 0) - (b.evidence[0]?.span?.start ?? 0))[0];
    const sentences = [...state.problem.text.matchAll(/[^.!?\n]+[.!?]*/g)].map((m) => ({ start: m.index ?? 0, text: m[0].trim() })).filter((x) => x.text);
    const at = firstSymptom?.evidence[0]?.span?.start;
    const main = (at === undefined ? sentences[0] : [...sentences].reverse().find((x) => x.start <= at) ?? sentences[0])?.text.replace(/[.!?]+$/, '');
    const symptoms = uniq([...(main ? [main] : []), ...all.filter((c) => !isCheck(c)).map(label)]);
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
      subject: `Question: ${clip(state.problem.text, 70)}`, body, requiresReview: true, createdAt: this.now().toISOString(),
    };
    this.trace(state.id, 'contact-draft.created', { id: principal.id, displayName: principal.displayName }, { draftId: draft.id, personEntityId: person.personEntityId, sent: false });
    return draft;
  }

  // ---- settings, participation, events ------------------------------------------------------------

  putSettings(patch: Omit<Partial<ExtendedSettings>, 'models'> & { models?: Partial<ModelSlots> }): ExtendedSettings {
    if (patch.selectorId !== undefined) this.selector(patch.selectorId);
    const current = this.getSettings();
    // A models patch changes only the slots it names.
    const { models: modelsPatch, ...plain } = patch;
    const next: ExtendedSettings = { ...current, ...plain, ...(modelsPatch ? { models: { ...(current.models ?? DEFAULT_MODEL_SLOTS), ...modelsPatch } } : {}) };
    this.store.put('settings', { id: SETTINGS_ID, ...next });
    this.trace('settings', 'settings.updated', { id: 'system', displayName: 'settings' }, { keys: Object.keys(patch) });
    if (modelsPatch) {
      // A slot leaving a provider forgets that slot's old failure; a slot switched to local is warmed (auto mode only).
      for (const slot of Object.keys(modelsPatch) as ModelSlotName[]) this.models.clearFailure(slot);
      if (this.opts.autoModels) {
        // Only the slots this patch names; the others were warmed (or not) already.
        const changed: ModelSlots = { ...DEFAULT_MODEL_SLOTS };
        for (const k of Object.keys(modelsPatch) as ModelSlotName[]) changed[k] = next.models![k];
        void this.models.warmSlots(changed).then(() => (modelsPatch.embed ? this.refreshEmbeddings() : undefined));
      }
    }
    return next;
  }

  // ---- models (Settings -> Models) -------------------------------------------------------------

  modelsView(): Promise<ModelsView> {
    return this.models.view(this.modelSlots());
  }

  /** Only ever called from a click (POST /models/pull). */
  pullModel(model: string): PullJobView {
    this.trace('models', 'models.pull', { id: 'system', displayName: 'models' }, { model });
    return this.models.startPull(model);
  }

  pullJob(id: string): PullJobView {
    const j = this.models.pullJob(id);
    if (!j) throw notFound(`Unknown download ${id}`);
    return j;
  }

  /** Only ever called from a click (POST /models/install). */
  installOllama(): Promise<InstallJobView> {
    this.trace('models', 'models.install', { id: 'system', displayName: 'models' }, {});
    return this.models.startInstall();
  }

  installJob(): InstallJobView {
    return this.models.installJob();
  }

  /** Memory only: the key is never stored, traced or returned. */
  setModelKey(provider: ApiVendor, key: string): { provider: ApiVendor; present: boolean } {
    const r = this.models.setKey(provider, key);
    this.trace('models', 'models.key', { id: 'system', displayName: 'models' }, { provider, present: r.present });
    return r;
  }

  testModelKey(provider: ApiVendor, model?: string): Promise<ModelTestResult> {
    return this.models.testKey(provider, model);
  }

  /** R46: a person's own balance; the caller (`principalId`, else the settings' current person) must be that person. */
  participation(personEntityId: string, principalId?: string): ParticipationBalance {
    this.mustBeSelf(personEntityId, principalId);
    return balanceOf(this.store, personEntityId);
  }

  private mustBeSelf(personEntityId: string, principalId: string | undefined): void {
    const p = this.principalFor(principalId);
    const dir = storeDirectory(this.store);
    const self = dir.resolve(p.id) ?? p.id;
    if (self !== personEntityId && self !== (dir.resolve(personEntityId) ?? personEntityId)) throw forbidden(`Principal ${p.id} may only read their own points`);
  }

  optIn(personEntityId: string): ParticipationOptIn {
    return getOptIn(this.store, personEntityId) ?? { id: '', orgId: this.orgId, personEntityId, participates: false, since: '' };
  }

  /** Only the person themselves may change whether they take part. Opting out keeps the rows; nothing is deleted. */
  setOptIn(personEntityId: string, req: { principal: Principal; participates: boolean }): ParticipationOptIn {
    const principal = this.effective(req.principal);
    const dir = storeDirectory(this.store);
    if ((dir.resolve(principal.id) ?? principal.id) !== personEntityId) throw forbidden(`Principal ${principal.id} may only change their own participation`);
    const rec = setOptIn(this.store, { orgId: this.orgId, personEntityId, participates: req.participates, at: this.now().toISOString() });
    this.trace('participation', 'participation.optin', { id: principal.id, displayName: principal.displayName }, { personEntityId, participates: req.participates });
    return rec;
  }

  /** Rating among the people who take part. `personEntityId` (which must be the caller) fills `me`. */
  participationRating(query: { personEntityId?: string; principalId?: string }): ParticipationRating {
    if (query.personEntityId) this.mustBeSelf(query.personEntityId, query.principalId);
    const dir = storeDirectory(this.store);
    return rating(this.store, { displayName: (id) => dir.get(id)?.name, now: this.now(), ...(query.personEntityId ? { personEntityId: query.personEntityId } : {}) });
  }

  /** Read-only rating for agents: the public rows (people who take part) and totals; never anyone's events. */
  participationForAgents(personEntityId?: string): Omit<ParticipationRating, 'me'> & { person?: { personEntityId: string; participates: boolean; balance?: number; rank?: number } } {
    const { me: _me, ...pub } = this.participationRating({});
    if (!personEntityId) return pub;
    const row = pub.participants.find((r) => r.personEntityId === personEntityId);
    return { ...pub, person: row ? { personEntityId, participates: true, balance: row.balance, rank: row.rank } : { personEntityId, participates: false } };
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
    this.inlineDirectories.length = 0;
    if (keep) this.store.put('settings', keep);
    this.trace('demo', 'demo.reset', { id: 'system', displayName: 'demo' });
  }

  async resetDemo(seed: 'elisa' | 'synthetic' | 'empty' | undefined, defaultPerson?: string): Promise<ApiRoutes['POST /demo/reset']['res'] & { defaultPersonEntityId?: string }> {
    const r = await resetDemo(this, seed, this.opts, defaultPerson);
    // B3: the store-health baseline for "completeness 0.71 -> 0.83 after 5 questions" (in memory; D-B3-08).
    this.healthBaselines.clear();
    const at = this.now().toISOString();
    this.healthBaselines.set('', { at, health: this.storeHealth() });
    // Review: the Settings row asks as the current person, so every directory person gets the reset's "before" too
    // (otherwise it would be taken at the first Settings opening and miss the answers given before it).
    for (const d of this.directory()) {
      try {
        this.healthBaselines.set(d.personEntityId, { at, health: this.storeHealth(d.personEntityId) });
      } catch {
        // a person the metric cannot be computed for gets the lazy baseline (D-B3-08)
      }
    }
    return r;
  }

  private readonly healthBaselines = new Map<string, { at: string; health: StoreHealth }>();

  /**
   * B3: GET /costs. The person's cost and reuse (`costs.ts`), plus the store line (BUILD_BRIEF 5.5) over the cases the
   * principal may see. Default person: the most-asked person, else the settings' current person.
   */
  costs(query: { personEntityId?: string; principalId?: string }): ExpertCostView {
    const dir = storeDirectory(this.store);
    let id = query.personEntityId ? dir.resolve(query.personEntityId) ?? query.personEntityId : undefined;
    if (!id) {
      const asked = new Map<string, number>();
      for (const q of this.store.list('question')) asked.set(q.personEntityId, (asked.get(q.personEntityId) ?? 0) + 1);
      id = [...asked.entries()].filter(([p]) => !!dir.get(p)).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? (this.getSettings().currentPersonEntityId || undefined);
    }
    if (!id || !dir.get(id)) throw notFound(`Unknown person ${query.personEntityId ?? '(none: no one was asked and no current person is set)'}`);
    const view = expertCost(this.store, id, { simulated: this.clockStatus().mode === 'simulated' });
    try {
      const key = query.principalId ?? '';
      const health = this.storeHealth(query.principalId);
      if (!this.healthBaselines.has(key)) this.healthBaselines.set(key, { at: this.now().toISOString(), health });
      const base = this.healthBaselines.get(key)!;
      const answeredSince = this.store.list('answer').filter((a) => a.at > base.at).length;
      return { ...view, storeHealth: storeHealthLine(health, { health: base.health, answeredSince }) };
    } catch {
      return view; // the cost stands on its own; the store line is optional
    }
  }

  // ---- demo clock and simulated activity (read-only views for the judge) ---------------------------

  clockStatus(): DemoClockStatus {
    return this.opts.clock ? { mode: 'real', now: this.now().toISOString(), rate: 1 } : this.demoClock.status();
  }

  /** Move the engine's clock to a simulated moment (the activity stream does this); `null` returns to real time. */
  setClock(input: { now: string; rate?: number } | null): DemoClockStatus {
    if (this.opts.clock) throw conflict('The service clock is fixed by its host and cannot be moved');
    try {
      const s = this.demoClock.set(input);
      this.trace('demo', 'demo.clock', { id: 'system', displayName: 'demo' }, { mode: s.mode, now: s.now, rate: s.rate });
      void this.upkeep().catch((e) => this.standingFailed('clock', e));
      return s;
    } catch (e) {
      throw badRequest(e instanceof Error ? e.message : String(e));
    }
  }

  activityLogPath(): string {
    return this.opts.activityLogPath ?? DEFAULT_ACTIVITY_LOG;
  }

  activity(query: { since?: number; limit?: number }): ActivityResponse {
    return readActivity(this.activityLogPath(), query);
  }

  activityPage(): string {
    return activityPage();
  }

  /** B3: the Context Layer page; it holds no data (it fetches GET /context and POST /investigate per viewer). */
  contextPage(): string {
    return contextPage();
  }
}

export type { InvestigationResult };
export { SELECTOR_IDS };
