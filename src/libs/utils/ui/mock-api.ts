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
import type { UserSettings } from '../contracts/outcomes.ts';
import type { CaseView, PersonView, QuestionView, ResultView, TimelineNode } from '../contracts/views.ts';
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
}

function freshState(): MockState {
  const records = new Map<string, QuestionRecord>();
  SEED_QUESTIONS.forEach((q, i) => records.set(q.id, record(q, 'queued', i)));
  return { settings: { ...defaultUserSettings, serverUrl: MOCK_BASE_URL, model: 'dev mock · no model', currentPersonEntityId: ME }, records, investigations: new Map(), counter: 0 };
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
  const settle = (rec: QuestionRecord, status: QuestionStatus, title: string, detail: string, points: number) => {
    rec.previousStatus = rec.status;
    rec.status = status;
    rec.updatedAt = NOW();
    return { title, detail, canUndo: true, ...(s.settings.points && points ? { pointsAwarded: points } : {}) };
  };
  const h: Handlers = {
    'GET /health': () => ({ ok: true as const, version: 'ui-dev-mock', store: 'memory', routes: Object.keys(h) }),
    'GET /settings': () => ({ ...s.settings }),
    'PUT /settings': ({ body }) => {
      s.settings = { ...s.settings, ...body };
      return { ...s.settings };
    },
    'GET /cases/:id': ({ params }) => {
      if (params.id !== CASE.caseId) throw new MockHttpError(404, 'Unknown case');
      return CASE;
    },
    'GET /cases': () => [CASE],
    'POST /investigate': ({ body }) => {
      const id = `inv:mock:${++s.counter}`;
      const question = viewOf(s.records.get(SEED_QUESTIONS[0]!.id)!);
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
        matches: [{ caseId: CASE.caseId, title: CASE.title, score: 0.72, matching: ['Blank output after ribbon change'], conflicting: [], missing: ['Printhead revision'] }],
        people: PEOPLE,
        question,
        loop: 'question-open',
        routes: [{ route: 'replay', version: 'ui-dev-mock' }],
        caseView: CASE,
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
      const receipt = settle(rec, 'answered', labels[body.value], rec.candidate.text, body.value === 'unknown' ? 1 : 2);
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
    'GET /people': () => PEOPLE,
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
    'POST /demo/reset': () => {
      Object.assign(s, freshState());
      return { ok: true as const, imported: [] };
    },
  };
  return h;
}

/** A FetchLike that serves the mock routes. Exported for tests and for the renderer's ?mock=1 mode. */
export function createMockFetch(): FetchLike {
  const state = freshState();
  const handlers = makeHandlers(state);
  const table = (Object.keys(handlers) as RouteKey[]).map((route) => {
    const { method, path } = parseRoute(route);
    const names: string[] = [];
    const rx = new RegExp('^' + path.replace(/:([A-Za-z]+)/g, (_m, n: string) => (names.push(n), '([^/]+)')) + '$');
    return { route, method, rx, names };
  });
  return async (input, init) => {
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
}

export function createMockApi(): ApiClient {
  return createApiClient({ baseUrl: MOCK_BASE_URL, fetch: createMockFetch(), kind: 'mock' });
}

export const mockPrincipal = (): Principal => ({ id: ME, displayName: 'You', groups: [], type: 'human' });
export type { ApiRoutes };
