import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiError, buildUrl, createApiClient, parseRoute } from './api-client.ts';
import type { FetchLike } from './api-client.ts';
import { demoPrincipal } from '../contracts/service.ts';

interface Seen { url: string; method?: string; headers?: Record<string, string>; body?: string }

function recorder(reply: { status?: number; body?: unknown } = {}) {
  const seen: Seen[] = [];
  const fetch: FetchLike = async (url, init) => {
    seen.push({ url, method: init?.method, headers: init?.headers, body: init?.body });
    const status = reply.status ?? 200;
    return { ok: status < 300, status, text: async () => JSON.stringify(reply.body ?? {}) };
  };
  return { seen, fetch };
}
const principal = demoPrincipal({ id: 'person:test:1', displayName: 'Tester' });

test('parseRoute and buildUrl fill and encode path params and drop empty query values', () => {
  assert.deepEqual(parseRoute('POST /questions/:id/answer'), { method: 'POST', path: '/questions/:id/answer' });
  assert.equal(buildUrl('http://h:1/', 'POST /questions/:id/answer', { id: 'q:1/x y' }).url, 'http://h:1/questions/q%3A1%2Fx%20y/answer');
  assert.equal(buildUrl('http://h:1', 'GET /questions', {}, { personEntityId: 'p 1', status: undefined, empty: '' }).url, 'http://h:1/questions?personEntityId=p%201');
  assert.throws(() => buildUrl('http://h', 'GET /cases/:id'), /Missing path parameter/);
});

test('POST /investigate sends JSON with the principal and attachment names only', async () => {
  const r = recorder({ body: { investigationId: 'i1' } });
  const api = createApiClient({ baseUrl: 'http://127.0.0.1:47831', fetch: r.fetch });
  await api.investigate({ text: 'blank labels', principal, attachmentNames: ['a.png'], allowQuestions: true });
  assert.equal(r.seen[0]!.url, 'http://127.0.0.1:47831/investigate');
  assert.equal(r.seen[0]!.method, 'POST');
  assert.equal(r.seen[0]!.headers!['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(r.seen[0]!.body!), { text: 'blank labels', principal, attachmentNames: ['a.png'], allowQuestions: true });
});

test('GET requests carry no body and no content-type (no CORS preflight)', async () => {
  const r = recorder({ body: [] });
  const api = createApiClient({ baseUrl: 'http://x', fetch: r.fetch });
  await api.questions({ personEntityId: 'person:me' });
  assert.equal(r.seen[0]!.url, 'http://x/questions?personEntityId=person%3Ame');
  assert.equal(r.seen[0]!.method, 'GET');
  assert.equal(r.seen[0]!.body, undefined);
  assert.deepEqual(r.seen[0]!.headers, {});
});

test('question actions map to the contract routes and bodies', async () => {
  const r = recorder({ body: {} });
  const api = createApiClient({ baseUrl: 'http://x', fetch: r.fetch });
  await api.answer('q1', { principal, value: 'yes' });
  await api.defer('q1', principal);
  await api.dismiss('q1', principal);
  await api.undo('q1', principal);
  await api.people({ investigationId: 'inv', principalId: 'p' });
  await api.contactDraft({ principal, investigationId: 'inv', personEntityId: 'pe' });
  await api.caseView('case:1');
  await api.putSettings({ points: true });
  await api.resetDemo('synthetic');
  assert.deepEqual(
    r.seen.map((s) => `${s.method} ${s.url.replace('http://x', '')}`),
    ['POST /questions/q1/answer', 'POST /questions/q1/defer', 'POST /questions/q1/dismiss', 'POST /questions/q1/undo', 'GET /people?investigationId=inv&principalId=p', 'POST /contact-draft', 'GET /cases/case%3A1', 'PUT /settings', 'POST /demo/reset'],
  );
  assert.deepEqual(JSON.parse(r.seen[0]!.body!), { principal, value: 'yes' });
  assert.deepEqual(JSON.parse(r.seen[1]!.body!), { principal });
  assert.deepEqual(JSON.parse(r.seen[8]!.body!), { seed: 'synthetic' });
});

test('non-2xx becomes an ApiError carrying the service message; network failure is "unreachable"', async () => {
  const bad = recorder({ status: 403, body: { error: 'not allowed' } });
  const api = createApiClient({ baseUrl: 'http://x', fetch: bad.fetch });
  await assert.rejects(api.question('q'), (e: unknown) => e instanceof ApiError && e.code === 'http' && e.status === 403 && e.message === 'not allowed');
  const down = createApiClient({ baseUrl: 'http://x', fetch: async () => { throw new TypeError('fetch failed'); } });
  await assert.rejects(down.health(), (e: unknown) => e instanceof ApiError && e.code === 'unreachable');
});

test('a hung service times out instead of waiting forever', async () => {
  const api = createApiClient({ baseUrl: 'http://x', timeoutMs: 20, fetch: (_u, init) => new Promise((_res, rej) => init!.signal!.addEventListener('abort', () => rej(new Error('aborted')))) });
  await assert.rejects(api.health(), (e: unknown) => e instanceof ApiError && e.code === 'timeout');
});

test('unreadable success bodies are reported, not swallowed', async () => {
  const api = createApiClient({ baseUrl: 'http://x', fetch: async () => ({ ok: true, status: 200, text: async () => '<html>' }) });
  await assert.rejects(api.health(), (e: unknown) => e instanceof ApiError && e.code === 'bad-response');
});

import { test as fixTest } from 'node:test';
import assert2 from 'node:assert/strict';
import { createServer } from 'node:http';

fixTest('stalled body times out and pre-aborted signal is honoured', async () => {
  const server = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'application/json' }); res.write('{"ok":'); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  const api = createApiClient({ baseUrl: `http://127.0.0.1:${port}`, timeoutMs: 200 });
  await assert2.rejects(api.health(), (e: unknown) => e instanceof ApiError && e.code === 'timeout');
  const ac = new AbortController();
  ac.abort();
  await assert2.rejects(api.call('GET /health', { signal: ac.signal }), (e: unknown) => e instanceof ApiError);
  server.closeAllConnections();
  server.close();
});
