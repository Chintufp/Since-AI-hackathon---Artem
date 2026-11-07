/** HTTP JSON API over the engine: node:http, no framework, zod validation, JSON errors, stderr request log. */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { z, ZodError } from 'zod';
import type { ApiRoutes } from '../../libs/utils/contracts/index.ts';
import { DEFAULT_SERVICE_PORT } from '../../libs/utils/contracts/index.ts';
import type { Engine } from './engine.ts';
import { ServiceError, toServiceError } from './errors.ts';
import {
  activityQuerySchema, answerSchema, cancelSchema, clockSchema, contactDraftSchema, demoResetSchema, eventsQuerySchema, importSchema, investigateSchema,
  modelInstallSchema, modelKeySchema, modelPullSchema, modelTestSchema, observationSchema, optInSchema, outcomeSchema, participationQuerySchema, peopleQuerySchema, preferenceSchema, principalOnlySchema, questionsQuerySchema, ratingQuerySchema, settingsPatchSchema,
} from './schemas.ts';

/** A handler result that is served as-is (HTML) instead of JSON. */
export class HtmlResponse {
  readonly html: string;
  constructor(html: string) {
    this.html = html;
  }
}

type RouteKey = keyof ApiRoutes;
interface Ctx {
  params: Record<string, string>;
  query: URLSearchParams;
  body: unknown;
}
type Handler = (c: Ctx) => unknown | Promise<unknown>;

const MAX_BODY = 5 * 1024 * 1024;

const parse = <T extends z.ZodType>(schema: T, value: unknown): z.output<T> => {
  try {
    return schema.parse(value);
  } catch (e) {
    if (e instanceof ZodError) throw new ServiceError(400, `Invalid request: ${e.issues.map((i) => `${i.path.join('.') || '(body)'}: ${i.message}`).join('; ')}`);
    throw e;
  }
};
const q = (c: Ctx): Record<string, string> => Object.fromEntries(c.query.entries());

function safeDecode(v: string): string {
  try { return decodeURIComponent(v); } catch { throw new ServiceError(400, 'Malformed path'); }
}

export function buildRoutes(engine: Engine): Record<RouteKey, Handler> {
  const keys = (): string[] => Object.keys(table);
  const table: Record<RouteKey, Handler> = {
    'GET /health': () => engine.health(keys()),
    'POST /import': (c) => engine.importAndEnrich(parse(importSchema, c.body)),
    'GET /connections': () => engine.connections(),
    'GET /cases': (c) => engine.cases(q(c).principalId),
    'GET /cases/:id': (c) => engine.caseView(c.params.id!, q(c).principalId),
    'POST /investigate': (c) => engine.investigate(parse(investigateSchema, c.body)),
    'GET /investigations/:id': (c) => engine.getInvestigation(c.params.id!, q(c).principalId),
    'GET /questions': (c) => engine.questions(parse(questionsQuerySchema, q(c))),
    'GET /questions/:id': (c) => engine.question(c.params.id!),
    'POST /questions/:id/answer': (c) => engine.answer(c.params.id!, parse(answerSchema, c.body)),
    'POST /questions/:id/defer': (c) => engine.defer(c.params.id!, parse(principalOnlySchema, c.body)),
    'POST /questions/:id/dismiss': (c) => engine.dismiss(c.params.id!, parse(principalOnlySchema, c.body)),
    'POST /questions/:id/undo': (c) => engine.undo(c.params.id!, parse(principalOnlySchema, c.body)),
    'POST /questions/:id/cancel': (c) => engine.cancel(c.params.id!, parse(cancelSchema, c.body)),
    'POST /preferences': (c) => engine.recordPreference(parse(preferenceSchema, c.body)),
    'POST /observations': (c) => engine.recordObservation(parse(observationSchema, c.body)),
    'POST /outcomes': (c) => engine.recordOutcome(parse(outcomeSchema, c.body)),
    'GET /people': (c) => {
      const p = parse(peopleQuerySchema, q(c));
      return engine.people(p.investigationId, p.principalId);
    },
    'POST /contact-draft': (c) => engine.contactDraft(parse(contactDraftSchema, c.body)),
    'GET /directory': () => engine.directory(),
    'GET /settings': () => engine.getSettings(),
    'PUT /settings': (c) => engine.putSettings(parse(settingsPatchSchema, c.body) as Parameters<Engine['putSettings']>[0]),
    // R46: the rating route is listed before the :personEntityId one, because both match the path "rating".
    'GET /participation/rating': (c) => engine.participationRating(parse(ratingQuerySchema, q(c))),
    'GET /participation/:personEntityId': (c) => engine.participation(c.params.personEntityId!, parse(participationQuerySchema, q(c)).principalId),
    'GET /participation/:personEntityId/optin': (c) => engine.optIn(c.params.personEntityId!),
    'PUT /participation/:personEntityId/optin': (c) => engine.setOptIn(c.params.personEntityId!, parse(optInSchema, c.body)),
    'POST /demo/reset': (c) => {
      const b = parse(demoResetSchema, c.body ?? {});
      return engine.resetDemo(b.seed, b.defaultPerson);
    },
    'GET /events': (c) => engine.events(parse(eventsQuerySchema, q(c))),
    'GET /demo/clock': () => engine.clockStatus(),
    'POST /demo/clock': (c) => {
      const b = parse(clockSchema, c.body ?? {});
      return engine.setClock(b.now ? { now: b.now, ...(b.rate !== undefined ? { rate: b.rate } : {}) } : null);
    },
    'GET /demo/activity': (c) => engine.activity(parse(activityQuerySchema, q(c))),
    'GET /demo/activity.html': () => new HtmlResponse(engine.activityPage()),
    'GET /models': () => engine.modelsView(),
    'POST /models/pull': (c) => engine.pullModel(parse(modelPullSchema, c.body).model),
    'GET /models/pull/:id': (c) => engine.pullJob(c.params.id!),
    'POST /models/test': (c) => {
      const b = parse(modelTestSchema, c.body);
      return engine.testModelKey(b.provider, b.model);
    },
    'POST /models/key': (c) => {
      const b = parse(modelKeySchema, c.body);
      return engine.setModelKey(b.provider, b.key);
    },
    'POST /models/install': (c) => {
      parse(modelInstallSchema, c.body ?? {});
      return engine.installOllama();
    },
    'GET /models/install': () => engine.installJob(),
  };
  return table;
}

interface CompiledRoute {
  key: RouteKey;
  method: string;
  rx: RegExp;
  names: string[];
}

function compile(keys: RouteKey[]): CompiledRoute[] {
  return keys.map((key) => {
    const [method, path] = key.split(' ') as [string, string];
    const names: string[] = [];
    const rx = new RegExp('^' + path.replace(/\./g, '\\.').replace(/:([A-Za-z]+)/g, (_m, n: string) => (names.push(n), '([^/]+)')) + '/?$');
    return { key, method, rx, names };
  });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY) throw new ServiceError(413, 'Request body too large');
    chunks.push(chunk as Buffer);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new ServiceError(400, 'Request body is not valid JSON');
  }
}

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export interface HttpOptions {
  engine: Engine;
  port?: number;
  host?: string;
  /** Request log sink (default stderr). Pass `() => {}` to silence. */
  log?: (line: string) => void;
}

export interface RunningHttp {
  server: Server;
  url: string;
  port: number;
  close(): Promise<void>;
}

export function startHttp(opts: HttpOptions): Promise<RunningHttp> {
  const { engine } = opts;
  const log = opts.log ?? ((l: string) => process.stderr.write(l + '\n'));
  const table = buildRoutes(engine);
  const routes = compile(Object.keys(table) as RouteKey[]);

  const send = (res: ServerResponse, status: number, body: unknown): void => {
    const html = body instanceof HtmlResponse;
    const text = html ? body.html : JSON.stringify(body);
    res.writeHead(status, { 'content-type': html ? 'text/html; charset=utf-8' : 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text), 'cache-control': 'no-store' });
    res.end(text);
  };

  const server = createServer(async (req, res) => {
    const started = Date.now();
    const method = req.method ?? 'GET';
    let status = 200;
    let path = '/';
    try {
      const url = new URL(req.url ?? '/', 'http://local');
      path = url.pathname;
      // DNS-rebinding guard: only answer requests addressed to a loopback host name.
      const host = (req.headers.host ?? '').replace(/:\d+$/, '');
      if (!LOCAL_HOSTS.has(host)) throw new ServiceError(403, 'Only loopback host names are served');
      const pathMatches = routes.filter((r) => r.rx.test(path));
      const hit = pathMatches.find((r) => r.method === method);
      if (!hit) throw pathMatches.length ? new ServiceError(405, `Method ${method} not allowed for ${path}`) : new ServiceError(404, `No route ${method} ${path}`);
      const m = hit.rx.exec(path)!;
      const params: Record<string, string> = {};
      hit.names.forEach((n, i) => (params[n] = safeDecode(m[i + 1]!)));
      let body: unknown;
      if (method === 'POST' || method === 'PUT') {
        // Requiring JSON keeps cross-site form posts (which cannot send this type without a preflight) out.
        const ct = req.headers['content-type'] ?? '';
        const raw = await readBody(req);
        if (!/^application\/json/i.test(ct)) throw new ServiceError(415, 'Content-Type must be application/json');
        body = raw;
      }
      const result = await table[hit.key]({ params, query: url.searchParams, body });
      send(res, 200, result);
    } catch (e) {
      const err = toServiceError(e);
      status = err.status;
      send(res, status, { error: err.message });
    }
    log(`${method} ${path} ${status} ${Date.now() - started}ms`);
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port ?? DEFAULT_SERVICE_PORT, opts.host ?? '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port;
      resolve({
        server, port, url: `http://127.0.0.1:${port}`,
        close: () => new Promise<void>((r) => { server.closeAllConnections(); server.close(() => r()); }),
      });
    });
  });
}
