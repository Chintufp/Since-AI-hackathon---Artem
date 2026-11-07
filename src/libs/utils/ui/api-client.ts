/**
 * Typed fetch wrapper over contracts/service.ts ApiRoutes. The renderer never builds URLs or
 * bodies by hand: every call goes through `call(route, ...)`, so the compiler checks request
 * and response shapes against the shared contract.
 */
import type { ApiRoutes, Principal } from '../contracts/service.ts';

export type RouteKey = keyof ApiRoutes;
export type ReqOf<K extends RouteKey> = ApiRoutes[K] extends { req: infer R } ? R : undefined;
export type ResOf<K extends RouteKey> = ApiRoutes[K]['res'];
export type QueryOf<K extends RouteKey> = ApiRoutes[K] extends { query: infer Q } ? Q : undefined;

export interface CallOptions<K extends RouteKey> {
  params?: Record<string, string>;
  query?: QueryOf<K> extends undefined ? never : Partial<QueryOf<K>>;
  body?: ReqOf<K>;
  signal?: AbortSignal;
}

export type ApiErrorCode = 'unreachable' | 'timeout' | 'http' | 'bad-response';

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly route: string;
  constructor(code: ApiErrorCode, route: string, message: string, status = 0) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.route = route;
    this.status = status;
  }
}

/** The subset of fetch the client uses; also what the dev mock implements. */
export type FetchLike = (
  input: string,
  init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface ApiClientOptions {
  baseUrl: string;
  fetch?: FetchLike;
  timeoutMs?: number;
  kind?: 'service' | 'mock';
}

export interface ApiClient {
  readonly baseUrl: string;
  readonly kind: 'service' | 'mock';
  call<K extends RouteKey>(route: K, options?: CallOptions<K>): Promise<ResOf<K>>;
  health(): Promise<ResOf<'GET /health'>>;
  getSettings(): Promise<ResOf<'GET /settings'>>;
  putSettings(patch: ReqOf<'PUT /settings'>): Promise<ResOf<'PUT /settings'>>;
  investigate(req: ReqOf<'POST /investigate'>): Promise<ResOf<'POST /investigate'>>;
  caseView(id: string): Promise<ResOf<'GET /cases/:id'>>;
  questions(query: { personEntityId?: string; status?: string }): Promise<ResOf<'GET /questions'>>;
  question(id: string): Promise<ResOf<'GET /questions/:id'>>;
  answer(id: string, req: ReqOf<'POST /questions/:id/answer'>): Promise<ResOf<'POST /questions/:id/answer'>>;
  defer(id: string, principal: Principal): Promise<ResOf<'POST /questions/:id/defer'>>;
  dismiss(id: string, principal: Principal): Promise<ResOf<'POST /questions/:id/dismiss'>>;
  undo(id: string, principal: Principal): Promise<ResOf<'POST /questions/:id/undo'>>;
  people(query: { investigationId: string; principalId: string }): Promise<ResOf<'GET /people'>>;
  contactDraft(req: ReqOf<'POST /contact-draft'>): Promise<ResOf<'POST /contact-draft'>>;
  directory(): Promise<ResOf<'GET /directory'>>;
  resetDemo(seed?: 'elisa' | 'synthetic' | 'empty'): Promise<ResOf<'POST /demo/reset'> & { defaultPersonEntityId?: string }>;
}

/** Split "POST /questions/:id/answer" into method and path template. */
export function parseRoute(route: string): { method: string; path: string } {
  const space = route.indexOf(' ');
  return { method: route.slice(0, space), path: route.slice(space + 1) };
}

export function buildUrl(baseUrl: string, route: string, params: Record<string, string> = {}, query: Record<string, unknown> = {}): { url: string; method: string } {
  const { method, path } = parseRoute(route);
  const filled = path.replace(/:([A-Za-z]+)/g, (_m, name: string) => {
    const v = params[name];
    if (v === undefined) throw new Error(`Missing path parameter :${name} for ${route}`);
    return encodeURIComponent(v);
  });
  const search = Object.entries(query)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .join('&');
  return { url: baseUrl.replace(/\/+$/, '') + filled + (search ? '?' + search : ''), method };
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const doFetch: FetchLike = options.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const timeoutMs = options.timeoutMs ?? 20000;

  async function call<K extends RouteKey>(route: K, o: CallOptions<K> = {}): Promise<ResOf<K>> {
    const { url, method } = buildUrl(options.baseUrl, route, o.params, (o.query ?? {}) as Record<string, unknown>);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    if (o.signal?.aborted) controller.abort();
    else o.signal?.addEventListener('abort', () => controller.abort(), { once: true });
    const hasBody = o.body !== undefined && method !== 'GET';
    let res;
    try {
      res = await doFetch(url, {
        method,
        // Content-Type only when there is a body, so simple GETs stay preflight-free.
        headers: hasBody ? { 'content-type': 'application/json' } : {},
        body: hasBody ? JSON.stringify(o.body) : undefined,
        signal: controller.signal,
      });
    } catch {
      clearTimeout(timer);
      const aborted = controller.signal.aborted;
      throw new ApiError(aborted ? 'timeout' : 'unreachable', route, aborted ? 'The service did not answer in time' : 'Couldn’t reach the service', 0);
    }
    let text: string;
    try {
      text = await res.text();
    } catch {
      throw new ApiError(controller.signal.aborted ? 'timeout' : 'unreachable', route, controller.signal.aborted ? 'The service did not answer in time' : 'Couldn’t reach the service', 0);
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      let message = `Service answered ${res.status}`;
      try {
        const parsed = JSON.parse(text) as { error?: unknown; message?: unknown };
        const m = parsed.error ?? parsed.message;
        if (typeof m === 'string') message = m;
      } catch {
        /* keep default */
      }
      throw new ApiError('http', route, message, res.status);
    }
    try {
      return (text ? JSON.parse(text) : undefined) as ResOf<K>;
    } catch {
      throw new ApiError('bad-response', route, 'The service sent an unreadable answer', res.status);
    }
  }

  return {
    baseUrl: options.baseUrl,
    kind: options.kind ?? 'service',
    call,
    health: () => call('GET /health'),
    getSettings: () => call('GET /settings'),
    putSettings: (patch) => call('PUT /settings', { body: patch }),
    investigate: (req) => call('POST /investigate', { body: req }),
    caseView: (id) => call('GET /cases/:id', { params: { id } }),
    questions: (query) => call('GET /questions', { query }),
    question: (id) => call('GET /questions/:id', { params: { id } }),
    answer: (id, req) => call('POST /questions/:id/answer', { params: { id }, body: req }),
    defer: (id, principal) => call('POST /questions/:id/defer', { params: { id }, body: { principal } }),
    dismiss: (id, principal) => call('POST /questions/:id/dismiss', { params: { id }, body: { principal } }),
    undo: (id, principal) => call('POST /questions/:id/undo', { params: { id }, body: { principal } }),
    people: (query) => call('GET /people', { query }),
    contactDraft: (req) => call('POST /contact-draft', { body: req }),
    directory: () => call('GET /directory'),
    resetDemo: (seed) => call('POST /demo/reset', { body: seed ? { seed } : {} }),
  };
}
