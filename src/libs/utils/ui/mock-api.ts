/**
 * Development mock of the service API. It implements the same ApiRoutes contract (every
 * handler is typed against contracts/service.ts) behind a fake fetch, so the real ApiClient is
 * exercised unchanged. The incident is invented for UI work; it is not scenario data and every
 * result is labelled as a dev mock in `routes`. Used only with ?mock=1 / KT_MOCK=1.
 */
import type { ApiRoutes, Principal } from '../contracts/service.ts';
import type { InvestigationState } from '../contracts/investigation.ts';
import type { QuestionRecord, QuestionStatus } from '../contracts/questions.ts';
import { defaultUserSettings } from '../contracts/outcomes.ts';
import { DEFAULT_MODEL_SLOTS } from '../contracts/models.ts';
import type { ModelSlotName } from '../contracts/models.ts';
import type { CatalogEntry, InstallJobView, ModelsView, PullJobView, SlotStatusView } from '../contracts/service.ts';
import type { ParticipationEvent, ParticipationOptIn, ParticipationRating, UserSettings } from '../contracts/outcomes.ts';
import type { CaseView, PersonView, QuestionView, ResultView, TimelineNode } from '../contracts/views.ts';
import { detectPasteKind, parsePastedThread } from '../connectors/paste-thread.ts';
import { createApiClient, parseRoute } from './api-client.ts';
import type { ApiClient, FetchLike, ReqOf, ResOf, RouteKey } from './api-client.ts';

export const MOCK_BASE_URL = 'mock://dev';
const NOW = () => new Date().toISOString();
const ORG = 'org:mock';
const ME = 'person:mock:you';

const timeline = (): TimelineNode[] => [
  { id: 'problem', kind: 'problem', stage: 'observation', label: 'Problem', detail: 'After a ribbon swap, the printer fed labels but printed them blank. Head temperature was reported normal.', evidence: [], who: 'Line operator' },
  { id: 'hypothesis', kind: 'step', stage: 'hypothesis', label: 'Possible cause', detail: 'The ribbon may have been loaded ink-side in. This is a hypothesis, not a confirmed cause.', evidence: [] },
  { id: 'check', kind: 'step', stage: 'check', label: 'Suggested check', detail: 'Compare the ribbon side with the loading diagram before replacing the printhead. The record does not show that this check happened.', evidence: [] },
  { id: 'attempt', kind: 'step', stage: 'attempt', label: 'Attempted reload', detail: 'The ribbon was reloaded the other way round. Timing helps assess whether it affected the reported recovery.', evidence: [], who: 'Line technician' },
  { id: 'outcome', kind: 'reported', stage: 'outcome', label: 'Reported recovery', detail: 'Printing resumed. Its timing, cause and lasting fix remain unconfirmed.', evidence: [] },
];

const CASE: CaseView = {
  caseId: 'case:mock:pkg-117',
  title: 'PKG-117 · blank labels after ribbon swap',
  status: 'reported-recovered',
  entities: [{ id: 'entity:mock:lp3', name: 'Label printer LP-3', type: 'asset' }],
  timeline: timeline(),
  caveat: 'One reported recovery. It does not prove the cause or a lasting fix.',
  sources: [],
};

const PEOPLE: PersonView[] = [
  { personEntityId: 'person:mock:noor', name: 'Noor Ahmadi', role: 'Line technician', askable: true, reasons: [{ text: 'Reloaded the ribbon in the related case PKG-117.', caseId: CASE.caseId, firsthand: true, evidence: [] }] },
  { personEntityId: 'person:mock:priya', name: 'Priya Nair', role: 'Shift lead', askable: true, reasons: [{ text: 'Can inspect the printer status on this shift.', firsthand: true, evidence: [] }] },
  { personEntityId: 'person:mock:tomas', name: 'Tomas Reyes', role: 'Maintenance planner', askable: false, reasons: [{ text: 'Mentioned in a forwarded summary; not a firsthand participant.', caseId: CASE.caseId, firsthand: false, evidence: [] }] },
];

interface SeedQuestion { id: string; text: string; why: string; nodes: string[]; caveat: string }
const SEED_QUESTIONS: SeedQuestion[] = [
  { id: 'q:mock:timing', text: 'Did the blank prints start right after the ribbon swap?', why: 'The missing timing changes whether the ribbon is treated as the likely cause.', nodes: ['problem', 'hypothesis', 'attempt', 'outcome'], caveat: 'Timing alone won’t prove the cause or a lasting fix.' },
  { id: 'q:mock:revision', text: 'Was this the older printhead revision?', why: 'The revision changes which equipment history we compare with this incident.', nodes: ['problem', 'check'], caveat: 'A matching revision would not establish the cause.' },
];

interface MockState {
  settings: UserSettings;
  records: Map<string, QuestionRecord>;
  investigations: Map<string, ResultView & { state: InvestigationState }>;
  counter: number;
  /** R46: whether the dev user takes part in points, and their events (deterministic for the screenshot harness). */
  optIn: boolean;
  events: ParticipationEvent[];
  /** B2: models mock state (never a real key: only whether one was given). */
  installed: string[];
  pulls: Map<string, PullJobView>;
  keys: { anthropic: boolean; gemini: boolean };
  install: InstallJobView;
  /** Slot failures, as the service's status chip shows them ('busy' scenario). */
  failures: Partial<Record<ModelSlotName, string>>;
  /** B4: texts already captured through "Remember this" (a second paste is 'already known'). */
  pasted: Set<string>;
}

/**
 * Model states the mock can show (D-B2-62). 'busy': embed on local nomic-embed-text with a download at 42%, phrase on
 * local qwen3:8b failed after a timeout, extract on a hosted Gemini model without a gemini key (an anthropic key held).
 */
export type MockModelsScenario = 'default' | 'busy';

const MOCK_INSTALL: InstallJobView = { state: 'idle', brew: true, log: [], downloadUrl: 'https://ollama.com/download', setup: ['brew install ollama', 'ollama serve', 'ollama pull bge-m3'] };

function mockModels(s: MockState): ModelsView {
  const slots = s.settings.models ?? DEFAULT_MODEL_SLOTS;
  const RAM_GB = 24;
  const entry = (model: string, sizeGb: number, minRamGb: number, why: string, recommended = false): CatalogEntry => {
    const installed = s.installed.includes(model);
    const availability: CatalogEntry['availability'] = installed ? 'ready' : minRamGb > RAM_GB ? 'too-large' : 'not-downloaded';
    const label = availability === 'ready' ? 'installed · ready' : availability === 'too-large' ? 'too large for this Mac' : `not downloaded · ${sizeGb.toFixed(1)} GB · Download`;
    return { model, why, installed, sizeBytes: sizeGb * 1e9, minRamGb, ...(recommended ? { recommended } : {}), availability, label };
  };
  const status = (slot: ModelSlotName): SlotStatusView => {
    const c = slots[slot];
    if (c.provider === 'rules') return { choice: c, state: 'off', chip: 'off' };
    const failed = (reason: string): SlotStatusView => ({ choice: c, state: 'failed', chip: `failed: ${reason}`, reason });
    if (c.provider === 'api') {
      // As the service: no hosted embedding model; otherwise the key of the model's own vendor.
      if (slot === 'embed') return failed('no hosted embedding model; rules used');
      const vendor = /^gemini/i.test(c.model ?? '') ? 'gemini' : 'anthropic';
      return s.keys[vendor] ? (s.failures[slot] ? failed(s.failures[slot]!) : { choice: c, state: 'ready', chip: 'ready' }) : failed(`no ${vendor} key`);
    }
    const model = c.model ?? { embed: 'bge-m3', extract: 'qwen3:4b', phrase: 'qwen3:8b' }[slot];
    const job = [...s.pulls.values()].reverse().find((j) => j.model === model && j.state === 'running');
    if (job) return { choice: c, state: 'downloading', chip: `downloading ${job.percent ?? 0}%`, percent: job.percent ?? 0 };
    if (s.failures[slot]) return failed(s.failures[slot]!);
    return s.installed.includes(model) ? { choice: c, state: 'ready', chip: 'ready' } : { choice: c, state: 'not-downloaded', chip: 'not downloaded' };
  };
  return {
    detection: { installed: true, running: true, version: 'dev-mock', totalMemBytes: RAM_GB * 1e9, freeDiskBytes: 300e9, installedModels: s.installed.map((name) => ({ name, capabilities: name === 'bge-m3' ? ['embedding'] : ['completion'] })), setup: ['brew install ollama', 'ollama serve', 'ollama pull bge-m3'] },
    catalog: {
      embed: [entry('bge-m3', 1.2, 8, 'Multilingual, finds cases by meaning (dev mock).', true), entry('nomic-embed-text', 0.3, 4, 'Light and fast, English-first (dev mock).')],
      extract: [entry('qwen3:4b', 2.5, 8, 'Fills the extraction form with a JSON schema (dev mock).', true), entry('qwen3:8b', 5.2, 12, 'Better recall on messy threads (dev mock).')],
      phrase: [entry('qwen3:8b', 5.2, 12, 'Natural one-sentence questions (dev mock).', true), entry('qwen3:32b', 20, 32, 'Smoothest wording; needs a big Mac (dev mock).')],
    },
    slots: { embed: status('embed'), extract: status('extract'), phrase: status('phrase') },
    apiKeys: { ...s.keys },
  };
}

/** R46: fixed points data: three colleagues who take part (Tomas does not), and the dev user's own events. */
const POINTS_FIXED = '2026-11-06T09:00:00.000Z';
const MY_EVENTS = (): ParticipationEvent[] => [
  { id: 'part:mock:1', orgId: ORG, personEntityId: ME, contributionEventId: 'answer:mock:seed-1', kind: 'answer-no', points: 2, summary: 'Answered a question (no)', refId: 'q:mock:seed-1', at: '2026-11-05T14:12:00.000Z' },
  { id: 'part:mock:2', orgId: ORG, personEntityId: ME, contributionEventId: 'outrep:mock:seed-1', kind: 'outcome-report', points: 3, summary: 'Reported an outcome (recovered)', refId: 'inv:mock:seed', at: '2026-11-06T08:40:00.000Z' },
  { id: 'part:mock:3', orgId: ORG, personEntityId: ME, contributionEventId: 'answer:mock:seed-2', kind: 'answer-unknown', points: 0, summary: 'Answered a question (not sure)', refId: 'q:mock:seed-2', at: POINTS_FIXED },
];
const OTHERS: Array<{ personEntityId: string; displayName: string; balance: number; recent: number; answered: number; outcomes: number }> = [
  { personEntityId: 'person:mock:noor', displayName: 'Noor Ahmadi', balance: 14, recent: 6, answered: 4, outcomes: 2 },
  { personEntityId: 'person:mock:priya', displayName: 'Priya Nair', balance: 7, recent: 2, answered: 2, outcomes: 1 },
];

function mockRating(s: MockState): ParticipationRating {
  const mine = s.events.reduce((n, e) => n + e.points, 0);
  const rows = [...OTHERS, ...(s.optIn ? [{ personEntityId: ME, displayName: 'Dev User', balance: mine, recent: mine, answered: s.events.filter((e) => e.kind.startsWith('answer')).length, outcomes: s.events.filter((e) => e.kind === 'outcome-report').length }] : [])]
    .sort((a, b) => b.balance - a.balance || a.displayName.localeCompare(b.displayName))
    .map((r, i, all) => ({ ...r, rank: i > 0 && all[i - 1]!.balance === r.balance ? i : i + 1 }));
  const me = rows.find((r) => r.personEntityId === ME);
  return {
    period: { recentDays: 7, recentFrom: '2026-10-31T09:00:00.000Z' },
    me: me ? { personEntityId: ME, balance: me.balance, recent: me.recent, rank: me.rank, events: [...s.events].reverse().slice(0, 10) } : null,
    participants: rows,
    totals: { participants: rows.length, points: rows.reduce((n, r) => n + r.balance, 0), recent: rows.reduce((n, r) => n + r.recent, 0) },
  };
}

function freshState(): MockState {
  const records = new Map<string, QuestionRecord>();
  SEED_QUESTIONS.forEach((q, i) => records.set(q.id, record(q, 'queued', i)));
  return { settings: { ...defaultUserSettings, serverUrl: MOCK_BASE_URL, model: 'dev mock · no model', currentPersonEntityId: ME }, records, investigations: new Map(), counter: 0, optIn: true, events: MY_EVENTS(), installed: ['qwen3:8b'], pulls: new Map(), keys: { anthropic: false, gemini: false }, install: { ...MOCK_INSTALL }, failures: {}, pasted: new Set() };
}

function record(q: SeedQuestion, status: QuestionStatus, i: number): QuestionRecord {
  const at = NOW();
  return {
    id: q.id, orgId: ORG, personEntityId: ME, decisionId: `decision:mock:${i}`, status, createdAt: at, updatedAt: at,
    candidate: {
      id: q.id, orgId: ORG, investigationId: 'inv:mock:seed', gapId: `gap:mock:${i}`, kind: 'quick', text: q.text, answerType: 'yes-no-unknown',
      scope: { entityIds: ['entity:mock:lp3'], caseId: CASE.caseId }, rationale: q.why, consequences: { yes: 'Recorded as an attributed observation.', no: 'Recorded as an attributed observation.' },
      generatedBy: { route: 'rules', version: 'ui-dev-mock' }, dedupKey: q.id, recipientIds: [ME],
    },
  };
}

function viewOf(rec: QuestionRecord): QuestionView {
  const seed = SEED_QUESTIONS.find((s) => s.id === rec.id) ?? SEED_QUESTIONS[0]!;
  const nodes = timeline().filter((n) => seed.nodes.includes(n.id));
  return {
    questionId: rec.id, investigationId: rec.candidate.investigationId, caseLabel: 'PKG-117', text: rec.candidate.text, kind: rec.candidate.kind, why: seed.why,
    timeline: nodes, caveat: seed.caveat, status: rec.status, deferred: rec.status === 'deferred',
  };
}

const OPEN: QuestionStatus[] = ['queued', 'delivered', 'deferred'];

type Ctx<K extends RouteKey> = { params: Record<string, string>; query: Record<string, string>; body: ReqOf<K> };
type Handlers = { [K in RouteKey]?: (ctx: Ctx<K>) => ResOf<K> };

class MockHttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function makeHandlers(s: MockState): Handlers {
  const assertRecipient = (rec: QuestionRecord, principal: { id: string }): void => {
    if (principal.id !== rec.personEntityId) throw new MockHttpError(403, `Principal ${principal.id} is not the recipient`);
  };
  const need = (id: string): QuestionRecord => {
    const r = s.records.get(id);
    if (!r) throw new MockHttpError(404, `Unknown question ${id}`);
    return r;
  };
  const settle = (rec: QuestionRecord, status: QuestionStatus, title: string, detail: string, points: number, summary?: string) => {
    rec.previousStatus = rec.status;
    rec.status = status;
    rec.updatedAt = NOW();
    // R46: points only for a person who takes part; the display switch (settings.points) is the panel's business.
    const awarded = s.optIn ? points : 0;
    if (s.optIn && summary) s.events.push({ id: `part:mock:${++s.counter}`, orgId: ORG, personEntityId: ME, contributionEventId: `${status}:${rec.id}`, kind: points ? 'answer-yes' : 'answer-unknown', points: awarded, summary, refId: rec.id, at: NOW() });
    return { title, detail, canUndo: true, ...(awarded ? { pointsAwarded: awarded } : {}) };
  };
  const optInView = (): ParticipationOptIn => ({ id: 'optin:mock:you', orgId: ORG, personEntityId: ME, participates: s.optIn, since: POINTS_FIXED });
  const h: Handlers = {
    'GET /health': () => ({ ok: true as const, version: 'ui-dev-mock', store: 'memory', routes: Object.keys(h) }),
    // As the service: GET /settings always carries the model slots (rules by default).
    'GET /settings': () => ({ ...s.settings, models: s.settings.models ?? DEFAULT_MODEL_SLOTS }),
    'PUT /settings': ({ body }) => {
      const { models, ...plain } = body;
      s.settings = { ...s.settings, ...plain, ...(models ? { models: { ...(s.settings.models ?? DEFAULT_MODEL_SLOTS), ...models } } : {}) };
      return { ...s.settings };
    },
    'GET /cases/:id': ({ params }) => {
      if (params.id !== CASE.caseId) throw new MockHttpError(404, 'Unknown case');
      return CASE;
    },
    'GET /cases': () => [CASE],
    // B4 "Remember this": the same sniffing as the service, a made-up case per asset token, nothing stored for real.
    'POST /import': ({ body }) => {
      if (body.format !== 'paste') throw new MockHttpError(400, 'The mock imports pasted text only');
      // Same validation as the service's importSchema: inline text only (no path), a string or {text}, at most 1 MB.
      const p = body.payload as unknown;
      const text = typeof p === 'string' ? p : p && typeof p === 'object' && typeof (p as { text?: unknown }).text === 'string' ? (p as { text: string }).text : undefined;
      if (body.path !== undefined || text === undefined || text.length > 1_000_000 || detectPasteKind(text) === 'empty') {
        throw new MockHttpError(400, 'paste needs payload text (a string or {text}) that is not blank');
      }
      const kind = detectPasteKind(text);
      const thread = kind === 'thread' ? parsePastedThread(text) : null;
      const messages = thread?.messages ?? [{ author: 'Unknown author', text }];
      const already = s.pasted.has(text);
      s.pasted.add(text);
      const assets = [...new Set(text.match(/\b[A-Z]{2,6}-\d{1,6}\b/g) ?? [])];
      const people = thread ? [...new Set(messages.map((m) => m.author))] : [];
      const times = thread ? messages.map((m) => (m as { time?: string }).time).filter((t): t is string => !!t) : [];
      const n = messages.length;
      const cases = assets.length ? [{ id: `case:mock:paste:${assets[0]}`, title: `${assets[0]} · pasted ${kind === 'thread' ? 'thread' : 'note'}` }] : [];
      return {
        batch: {
          id: `batch:mock:${++s.counter}`, orgId: ORG, connectionId: 'paste:desktop', startedAt: NOW(), finishedAt: NOW(), sourceDescription: kind === 'thread' ? 'Pasted thread' : 'Pasted text',
          counts: { seen: n, inserted: already ? 0 : n, unchangedDuplicates: already ? n : 0, revised: 0, copies: 0 },
        },
        cases: cases.length, claims: already ? 0 : n * 2, entities: assets.length, people: people.length,
        captured: { cases, entities: assets, people, ...(times[0] ? { from: times[0] } : {}), ...(times.length > 1 && times.at(-1) !== times[0] ? { to: times.at(-1)! } : {}), dateKnown: false, alreadyKnown: already },
      };
    },
    'POST /investigate': ({ body }) => {
      const id = `inv:mock:${++s.counter}`;
      const question = viewOf(s.records.get(SEED_QUESTIONS[0]!.id)!);
      const quiet = /\bno one to ask\b/i.test(body.text);
      const result: ResultView = {
        investigationId: id,
        recommendation: {
          kind: 'check-first',
          text: 'Check which way the ribbon is loaded before swapping the printhead.',
          applicability: 'A similar case matched on symptom and equipment family. The printhead revision is not confirmed.',
          caveats: ['The earlier recovery was reported once; its cause was not verified.'],
          nextStep: 'Compare the ribbon side with the loading diagram.',
          actionClass: 'diagnostic-check',
        },
        matches: [
          { caseId: CASE.caseId, title: CASE.title, score: 0.72, matching: ['Blank output after ribbon change'], conflicting: [], missing: ['Printhead revision'], startedAt: '2026-09-18T08:10:00.000Z' },
          { caseId: 'case_mock_alt1', title: 'PKG-204 · faint print after ribbon swap', score: 0.66, matching: ['Ribbon changed'], conflicting: ['Output faint, not blank'], missing: [], startedAt: '2025-11-02T09:00:00.000Z' },
          { caseId: 'case_mock_alt2', title: 'PKG-118 · blank labels, old printhead', score: 0.64, matching: ['Blank output'], conflicting: [], missing: ['Printhead older than 2019'], startedAt: '2026-03-27T13:40:00.000Z' },
        ],
        people: PEOPLE,
        ...(quiet ? { loopReason: 'No one to ask right now: nobody with firsthand knowledge is available' } : { question }),
        loop: quiet ? 'deferred' : 'question-open',
        routes: [{ route: 'replay', version: 'ui-dev-mock' }],
        caseView: CASE,
        // B3: the provenance strip, so the screenshot harness shows it under the heading.
        provenance: {
          claimId: 'claim_mock_advice', person: 'Noor Ahmadi', providerLabel: 'Teams', when: '09:22 (date unknown)', sources: 1,
          reportedOnce: true, stillBelievedTrue: true, route: 'rules', text: 'Noor Ahmadi · Teams 09:22 (date unknown) · reported once · still believed true',
        },
        // B5: another expert's advice on record, shown under the recommendation as "Also on record: ...".
        alternatives: [{
          caseId: 'case_mock_alt2', caseLabel: 'PKG-118', hypothesisId: 'hyp_mock_alt2', label: 'reseating the printhead cable', action: 'cable.reseat',
          expert: { personEntityId: 'person:mock:priya', displayName: 'Priya Nair', role: 'Shift lead' }, support: 'supported', applicability: 'qualified',
          deciding: 'printhead older than 2019', text: 'Priya Nair advised reseating the printhead cable in PKG-118 (qualified, depends on printhead older than 2019)',
        }],
      };
      const state: InvestigationState = {
        id, orgId: ORG, createdAt: NOW(), updatedAt: NOW(),
        problem: { id: `problem:${id}`, orgId: ORG, text: body.text, requester: { id: body.principal.id, displayName: body.principal.displayName }, attachmentNames: body.attachmentNames, createdAt: NOW() },
        candidates: [], hypotheses: [], gaps: [],
        recommendation: { kind: 'check-first', text: result.recommendation.text, basis: [], applicability: 'qualified', caveats: result.recommendation.caveats, nextStep: result.recommendation.nextStep, actionClass: 'diagnostic-check' },
        people: [], questionIds: [question.questionId], decisionIds: [], loop: 'question-open', events: [], routes: [{ route: 'replay', version: 'ui-dev-mock' }],
      };
      const full = { ...result, state };
      s.investigations.set(id, full);
      return full;
    },
    'GET /investigations/:id': ({ params }) => {
      const r = s.investigations.get(params.id);
      if (!r) throw new MockHttpError(404, 'Unknown investigation');
      return r;
    },
    'GET /questions': ({ query }) =>
      [...s.records.values()]
        .filter((r) => (query.personEntityId ? r.personEntityId === query.personEntityId : true))
        .filter((r) => (query.status ? r.status === query.status : OPEN.includes(r.status)))
        .map(viewOf),
    'GET /questions/:id': ({ params }) => viewOf(need(params.id)),
    'POST /questions/:id/answer': ({ params, body }) => {
      const rec = need(params.id);
      assertRecipient(rec, body.principal);
      const labels = { yes: 'Recorded: Yes', no: 'Recorded: No', unknown: 'Recorded: Not sure' } as const;
      const receipt = settle(rec, 'answered', labels[body.value], rec.candidate.text, body.value === 'unknown' ? 0 : 2, `Answered a question (${body.value === 'unknown' ? 'not sure' : body.value})`);
      const answer = { id: `answer:mock:${++s.counter}`, orgId: ORG, questionId: rec.id, personEntityId: rec.personEntityId, value: body.value, text: body.text, at: NOW(), claimUpdates: [], evidenceId: `evidence:mock:${s.counter}` };
      rec.answerId = answer.id;
      return { answer, receipt, question: { ...rec } };
    },
    'POST /questions/:id/defer': ({ params, body }) => {
      const rec = need(params.id);
      assertRecipient(rec, body.principal);
      return { receipt: settle(rec, 'deferred', 'Saved for later', rec.candidate.text, 0), question: { ...rec } };
    },
    'POST /questions/:id/dismiss': ({ params, body }) => {
      const rec = need(params.id);
      assertRecipient(rec, body.principal);
      return { receipt: settle(rec, 'dismissed', 'Question dismissed', rec.candidate.text, 0), question: { ...rec } };
    },
    'POST /questions/:id/undo': ({ params, body }) => {
      const rec = need(params.id);
      assertRecipient(rec, body.principal);
      rec.status = rec.previousStatus ?? 'queued';
      s.events = s.events.filter((e) => e.contributionEventId !== `answered:${rec.id}`);
      delete rec.previousStatus;
      delete rec.answerId;
      rec.updatedAt = NOW();
      return { question: { ...rec } };
    },
    'POST /questions/:id/cancel': ({ params }) => {
      const rec = need(params.id);
      rec.status = 'cancelled';
      return { question: { ...rec } };
    },
    'GET /directory': () => [
      { personEntityId: ME, name: 'Dev User', role: 'Line technician', groups: [], available: true },
      ...PEOPLE.map((p) => ({ personEntityId: p.personEntityId, name: p.name, ...(p.role ? { role: p.role } : {}), groups: [], available: p.askable })),
    ],
    'GET /people': () => PEOPLE,
    // B1: one undated assertion and one dated note that conditions it (dev data, synthetic).
    'GET /context': ({ query }) => {
      if (query.entity !== 'LP-3') throw new MockHttpError(404, `Unknown entity ${query.entity}`);
      const at = query.at ?? NOW();
      const noteAt = '2026-10-14T07:05:00.000Z';
      return {
        entity: { id: 'ent:mock:lp-3', name: 'LP-3', type: 'asset' },
        ...(query.at ? { at: query.at } : {}),
        assertions: [
          {
            claimId: 'claim:mock:advice', type: 'advice' as const, statement: 'Check which way the ribbon is loaded before swapping the printhead.', status: 'provisional' as const,
            validFrom: { kind: 'time-only' as const, raw: '09:22', sequence: 3 }, validityCondition: 'printhead.revision < B', validAt: true,
            assertedBy: { id: 'person:mock:noor', displayName: 'Noor Ahmadi' },
            source: { evidenceId: 'ev:mock:1', provider: 'teams', time: '09:22 (date unknown)', position: { kind: 'time-only' as const, raw: '09:22', sequence: 3 } },
            excerpt: 'Check which way the ribbon is loaded before swapping the printhead.', caseId: CASE.caseId,
          },
          {
            claimId: 'claim:mock:note', type: 'other' as const, statement: 'Revision B printheads fix the blank-label fault.', status: 'provisional' as const,
            validFrom: { kind: 'known' as const, iso: noteAt }, validAt: at >= noteAt,
            assertedBy: { id: 'person:mock:noor', displayName: 'Noor Ahmadi' },
            source: { evidenceId: 'ev:mock:2', provider: 'teams', time: noteAt, position: { kind: 'known' as const, iso: noteAt } },
            excerpt: 'Revision B printheads fix the blank-label fault.',
          },
        ],
        bindings: [{ entityName: 'Noor Ahmadi', kind: 'firsthand' as const, label: 'advised', byPerson: 'Noor Ahmadi', recorded: { kind: 'time-only' as const, raw: '09:22' }, evidence: [] }],
      };
    },
    'POST /contact-draft': ({ body }) => {
      const person = PEOPLE.find((p) => p.personEntityId === body.personEntityId);
      if (!person) throw new MockHttpError(404, 'Unknown person');
      return {
        id: `draft:mock:${++s.counter}`, investigationId: body.investigationId, personEntityId: person.personEntityId, to: { id: person.personEntityId, displayName: person.name, role: person.role },
        subject: 'Question about label printer LP-3 printing blank labels',
        body: `Hi ${person.name.split(' ')[0]},\n\nLP-3 on line 3 feeds labels but prints them blank after a ribbon swap. Head temperature looks normal.\n\nSo far: nothing has been confirmed; reloading the ribbon the other way round helped in PKG-117, but the cause was never verified.\n\nStill unclear: was this the older printhead revision?\n\nCould you tell me what you saw, or point me to someone who did?\n\nThanks`,
        requiresReview: true, createdAt: NOW(),
      };
    },
    // B3: Erkki's cost (dev data, deterministic for the screenshot harness)
    'GET /costs': ({ query }) => {
      const who = query.personEntityId ?? 'person:mock:noor';
      const name = PEOPLE.find((p) => p.personEntityId === who)?.name ?? 'Dev User';
      return {
        personEntityId: who, name, asked: 3, answered: 2, deferred: 1, dismissed: 0, open: 0, cancelled: 0,
        seconds: { total: 21, median: 9, answers: 2, clock: 'real' as const }, reuse: { people: 3, agents: 2, total: 5 },
        storeHealth: {
          cases: 14, completeness: 0.83, completenessBefore: 0.71, answeredSince: 5, correctness: 0.92, singletons: 2,
          denominators: { cases: 14, retrievals: 9, caseClaims: 120, supportedClaims: 110 },
          line: 'Store: 14 cases · completeness 0.71 → 0.83 after 5 questions · correctness 0.92 · 2 singletons left',
        },
        line: `${name}: asked 3 · answered 2 · 21 s · reused 5 (3 by people, 2 by agents)`,
      };
    },
    // R46: points (dev data; the rating is deterministic for the screenshot harness)
    'GET /participation/rating': ({ query }) => {
      if (query.personEntityId && query.personEntityId !== ME) throw new MockHttpError(403, 'Only your own points');
      const r = mockRating(s);
      return query.personEntityId ? r : { ...r, me: null };
    },
    'GET /participation/:personEntityId': ({ params, query }) => {
      if (params.personEntityId !== ME || (query.principalId && query.principalId !== ME)) throw new MockHttpError(403, 'Only your own points');
      return s.optIn ? { personEntityId: ME, participates: true, points: s.events.reduce((n, e) => n + e.points, 0), events: [...s.events] } : { personEntityId: ME, participates: false, points: 0, events: [] };
    },
    'GET /participation/:personEntityId/optin': ({ params }) => {
      if (params.personEntityId !== ME) return { id: '', orgId: ORG, personEntityId: params.personEntityId!, participates: false, since: '' };
      return optInView();
    },
    'PUT /participation/:personEntityId/optin': ({ params, body }) => {
      if (params.personEntityId !== ME || body.principal.id !== ME) throw new MockHttpError(403, 'Only you can change whether you take part');
      s.optIn = body.participates;
      return optInView();
    },
    'POST /demo/reset': () => {
      Object.assign(s, freshState());
      return { ok: true as const, imported: [] };
    },
    // B2: Settings -> Models. A fixed machine with Ollama running and qwen3:8b installed; downloads finish at once.
    'GET /models': () => mockModels(s),
    'POST /models/pull': ({ body }) => {
      const job = { jobId: `pull-mock-${++s.counter}`, model: body.model, state: 'done' as const, status: 'success', percent: 100, startedAt: NOW(), finishedAt: NOW() };
      s.pulls.set(job.jobId, job);
      if (!s.installed.includes(body.model)) s.installed.push(body.model);
      return job;
    },
    'GET /models/pull/:id': ({ params }) => {
      const j = s.pulls.get(params.id!);
      if (!j) throw new MockHttpError(404, `Unknown download ${params.id}`);
      return j;
    },
    'POST /models/test': ({ body }) => (s.keys[body.provider] ? { ok: true, provider: body.provider, model: body.model ?? 'dev mock model' } : { ok: false, provider: body.provider, error: `no ${body.provider} key` }),
    'POST /models/key': ({ body }) => {
      s.keys[body.provider] = body.key.trim().length > 0;
      return { provider: body.provider, present: s.keys[body.provider] };
    },
    // Ollama is already installed in the mock: the install finishes at once with a short log.
    'POST /models/install': () => {
      s.install = { ...MOCK_INSTALL, state: 'done', brew: true, log: ['$ brew install ollama', '==> ollama is already installed (dev mock)'], startedAt: NOW(), finishedAt: NOW() };
      return s.install;
    },
    'GET /models/install': () => s.install,
  };
  return h;
}

/** A FetchLike that serves the mock routes. Exported for tests and for the renderer's ?mock=1 mode. */
/** Put the mock's models into a scenario (the screenshot harness and tests); 'default' is the fresh state. */
function applyModelsScenario(s: MockState, scenario: MockModelsScenario): void {
  const fresh = freshState();
  s.installed = fresh.installed; s.pulls = fresh.pulls; s.keys = fresh.keys; s.failures = fresh.failures;
  s.settings = { ...s.settings, models: { ...DEFAULT_MODEL_SLOTS } };
  if (scenario !== 'busy') return;
  s.settings = { ...s.settings, models: { embed: { provider: 'local', model: 'nomic-embed-text' }, extract: { provider: 'api', model: 'gemini-2.5-flash-lite' }, phrase: { provider: 'local', model: 'qwen3:8b' } } };
  s.pulls.set('pull-mock-busy', { jobId: 'pull-mock-busy', model: 'nomic-embed-text', state: 'running', status: 'pulling 970aa74c0a90', percent: 42, startedAt: NOW() });
  s.keys = { anthropic: true, gemini: false };
  s.failures = { phrase: 'phrase: no answer within 20000 ms' };
}

export function createMockFetch(opts: { models?: MockModelsScenario } = {}): FetchLike & { setModelsScenario(scenario: MockModelsScenario): void } {
  const state = freshState();
  if (opts.models) applyModelsScenario(state, opts.models);
  const handlers = makeHandlers(state);
  const table = (Object.keys(handlers) as RouteKey[]).map((route) => {
    const { method, path } = parseRoute(route);
    const names: string[] = [];
    const rx = new RegExp('^' + path.replace(/:([A-Za-z]+)/g, (_m, n: string) => (names.push(n), '([^/]+)')) + '$');
    return { route, method, rx, names };
  });
  const fetchLike: FetchLike = async (input, init) => {
    const url = new URL(input.replace(/^mock:/, 'http:'));
    const method = init?.method ?? 'GET';
    const hit = table.find((t) => t.method === method && t.rx.test(url.pathname));
    const reply = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, text: async () => JSON.stringify(body) });
    if (!hit) return reply(404, { error: `No mock for ${method} ${url.pathname}` });
    const match = hit.rx.exec(url.pathname)!;
    const params: Record<string, string> = {};
    hit.names.forEach((n, i) => (params[n] = decodeURIComponent(match[i + 1]!)));
    const query = Object.fromEntries(url.searchParams.entries());
    let body: unknown;
    try {
      body = init?.body ? JSON.parse(init.body) : undefined;
    } catch {
      return reply(400, { error: 'Bad JSON' });
    }
    await new Promise((r) => setTimeout(r, 0));
    try {
      const handler = handlers[hit.route] as (c: { params: Record<string, string>; query: Record<string, string>; body: unknown }) => unknown;
      return reply(200, handler({ params, query, body }));
    } catch (e) {
      if (e instanceof MockHttpError) return reply(e.status, { error: e.message });
      throw e;
    }
  };
  return Object.assign(fetchLike, { setModelsScenario: (scenario: MockModelsScenario) => applyModelsScenario(state, scenario) });
}

export function createMockApi(): ApiClient {
  return createApiClient({ baseUrl: MOCK_BASE_URL, fetch: createMockFetch(), kind: 'mock' });
}

export const mockPrincipal = (): Principal => ({ id: ME, displayName: 'You', groups: [], type: 'human' });
export type { ApiRoutes };
