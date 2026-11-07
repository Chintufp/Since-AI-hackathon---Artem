import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installNetworkGuard } from '../routes.ts';
import {
  ApiProvider, ApiProviderDisabledError, EmbeddingCache, OllamaProvider, ProviderError, textHash, withFallback, type FetchFn, type OllamaSystem,
} from './index.ts';

interface Call { url: string; body: any }
const sys: OllamaSystem = { which: async () => '/usr/local/bin/ollama', totalMem: () => 24e9, freeDisk: async () => 300e9 };

/** A fake fetch answering by path; records every call. */
function fake(routes: Record<string, (body: any, signal?: AbortSignal) => Response | Promise<Response>>): { fetch: FetchFn; calls: Call[] } {
  const calls: Call[] = [];
  const fetch: FetchFn = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, body });
    const path = new URL(url).pathname;
    const h = routes[path];
    if (!h) return new Response(JSON.stringify({ error: 'no route' }), { status: 404 });
    return h(body, init?.signal);
  };
  return { fetch, calls };
}
const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
/** Never answers until aborted. */
const hang = (_b: unknown, signal?: AbortSignal) => new Promise<Response>((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason)));

test('ollama embed: one batched POST /api/embed with keep_alive, Float32 vectors back', async () => {
  const f = fake({ '/api/embed': (b) => json({ model: b.model, embeddings: b.input.map((t: string) => [t.length, 1, 0]) }) });
  const p = new OllamaProvider({ fetch: f.fetch, system: sys });
  const v = await p.embed('bge-m3', ['ab', 'abcd']);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0]!.url, 'http://127.0.0.1:11434/api/embed');
  assert.deepEqual(f.calls[0]!.body, { model: 'bge-m3', input: ['ab', 'abcd'], keep_alive: '30m' });
  assert.ok(v[0] instanceof Float32Array);
  assert.deepEqual([...v[1]!], [4, 1, 0]);
});

test('ollama generateJson sends think:false, temperature 0, a seed, the schema as format; a missing model is model-missing', async () => {
  const f = fake({ '/api/generate': (b) => (b.model === 'gone' ? json({ error: "model 'gone' not found" }, 404) : json({ response: '{"answer":"yes"}', done: true })) });
  const p = new OllamaProvider({ fetch: f.fetch, system: sys });
  const schema = { type: 'object', properties: { answer: { type: 'string' } }, required: ['answer'] };
  assert.deepEqual(await p.generateJson('qwen3:4b', 'Q?', schema, { seed: 3 }), { answer: 'yes' });
  const b = f.calls[0]!.body;
  assert.equal(b.stream, false);
  assert.equal(b.think, false);
  assert.deepEqual(b.format, schema);
  assert.deepEqual(b.options, { temperature: 0, seed: 3 });
  assert.equal(b.keep_alive, '30m');
  await assert.rejects(p.generateJson('gone', 'Q?', schema), (e: ProviderError) => e.code === 'model-missing');
});

test('ollama warm/unload are empty requests with keep_alive (embed models through /api/embed)', async () => {
  const f = fake({ '/api/generate': () => json({ done: true }), '/api/embed': () => json({ embeddings: [] }) });
  const p = new OllamaProvider({ fetch: f.fetch, system: sys });
  await p.warm('qwen3:8b');
  await p.unload('qwen3:8b');
  await p.warm('bge-m3', '30m', { embedding: true });
  assert.deepEqual(f.calls.map((c) => [new URL(c.url).pathname, c.body]), [
    ['/api/generate', { model: 'qwen3:8b', keep_alive: '30m' }],
    ['/api/generate', { model: 'qwen3:8b', keep_alive: 0 }],
    ['/api/embed', { model: 'bge-m3', input: [], keep_alive: '30m' }],
  ]);
});

test('ollama detect: version, tags with size and capabilities, RAM and disk; server down is reported, not thrown', async () => {
  const f = fake({
    '/api/version': () => json({ version: '0.40.9' }),
    '/api/tags': () => json({ models: [{ name: 'qwen3:8b', size: 5_200_000_000, details: { family: 'qwen3', parameter_size: '8.2B' }, capabilities: ['completion', 'tools'] }, { name: 'bge-m3:latest', size: 1_200_000_000, capabilities: ['embedding'] }] }),
  });
  const d = await new OllamaProvider({ fetch: f.fetch, system: sys }).detect();
  assert.equal(d.running, true);
  assert.equal(d.installed, true);
  assert.equal(d.version, '0.40.9');
  assert.equal(d.models.length, 2);
  assert.deepEqual(d.models[1]!.capabilities, ['embedding']);
  assert.equal(d.totalMemBytes, 24e9);
  assert.equal(d.freeDiskBytes, 300e9);
  const down: FetchFn = async () => { throw new TypeError('fetch failed'); };
  const d2 = await new OllamaProvider({ fetch: down, system: { ...sys, which: async () => undefined } }).detect();
  assert.deepEqual([d2.installed, d2.running, d2.models.length], [false, false, 0]);
});

test('ollama pull streams NDJSON progress (split across chunks) and rejects on an error line', async () => {
  const lines = ['{"status":"pulling manifest"}', '{"status":"pulling abc","digest":"sha256:abc","total":200,"completed":50}', '{"status":"pulling abc","digest":"sha256:abc","total":200,"completed":200}', '{"status":"verifying sha256 digest"}', '{"status":"success"}'];
  const text = lines.join('\n') + '\n';
  const stream = (t: string) => new ReadableStream<Uint8Array>({
    start(c) {
      const bytes = new TextEncoder().encode(t);
      for (let i = 0; i < bytes.length; i += 17) c.enqueue(bytes.slice(i, i + 17));
      c.close();
    },
  });
  const f = fake({ '/api/pull': (b) => new Response(stream(b.model === 'bad' ? '{"status":"pulling manifest"}\n{"error":"pull model manifest: file does not exist"}\n' : text)) });
  const p = new OllamaProvider({ fetch: f.fetch, system: sys });
  const seen: Array<number | undefined> = [];
  const statuses: string[] = [];
  await p.pull('bge-m3', (x) => { seen.push(x.percent); statuses.push(x.status); });
  assert.deepEqual(f.calls[0]!.body, { model: 'bge-m3', stream: true });
  assert.deepEqual(seen.filter((x) => x !== undefined), [25, 100]);
  assert.equal(statuses.at(-1), 'success');
  await assert.rejects(p.pull('bad', () => {}), /file does not exist/);
});

test('timeout or error falls back to rules, labelled with the fallback route and the reason', async () => {
  const f = fake({ '/api/embed': hang, '/api/generate': () => json({ error: 'boom' }, 500) });
  const p = new OllamaProvider({ fetch: f.fetch, system: sys });
  const route = { route: 'local' as const, version: 'ollama-embed@1:bge-m3' };
  const rulesRoute = { route: 'local' as const, version: 'trigram-hash@1' };
  const failures: string[] = [];
  const r = await withFallback('embed', () => p.embed('bge-m3', ['x'], { timeoutMs: 30 }), () => [new Float32Array([1])], { route, rulesRoute, onFailure: (s, _r, c) => failures.push(`${s}:${c}`) });
  assert.equal(r.route.version, 'trigram-hash@1[fallback:embed:timeout]');
  assert.equal(r.fallback?.code, 'timeout');
  assert.deepEqual(r.fallback?.from, route);
  assert.deepEqual(failures, ['embed:timeout']);
  // the outer deadline holds even when the provider ignores its own timeout
  const r2 = await withFallback('phrase', () => new Promise<string>(() => {}), () => 'template', { route, rulesRoute: { route: 'rules', version: 'question-templates@1' }, timeoutMs: 20 });
  assert.equal(r2.value, 'template');
  assert.equal(r2.route.version, 'question-templates@1[fallback:phrase:timeout]');
  const r3 = await withFallback('phrase', () => p.generateText('qwen3:8b', 'x'), () => 'template', { route, rulesRoute: { route: 'rules', version: 'question-templates@1' } });
  assert.equal(r3.fallback?.code, 'http');
  assert.match(r3.fallback!.reason, /boom/);
  const ok = await withFallback('phrase', async () => 'model text', () => 'template', { route, rulesRoute });
  assert.deepEqual(ok, { value: 'model text', route });
});

test('the network guard still blocks the default fetch of a provider (it is looked up at call time)', async () => {
  const restore = installNetworkGuard();
  try {
    const p = new OllamaProvider({ system: sys });
    await assert.rejects(p.embed('bge-m3', ['x']), /Blocked network/);
  } finally {
    restore();
  }
});

test('api provider refuses without explicit enable and a key; never touches fetch then', async () => {
  const f = fake({});
  const schema = { type: 'object' };
  for (const p of [new ApiProvider({ enabled: false, keys: { anthropic: 'k' }, fetch: f.fetch }), new ApiProvider({ enabled: true, keys: {}, fetch: f.fetch }), new ApiProvider({ enabled: 'yes' as unknown as boolean, keys: { anthropic: 'k' }, fetch: f.fetch })]) {
    await assert.rejects(p.generateJson('claude-haiku-5-5', 'x', schema), ApiProviderDisabledError);
    await assert.rejects(p.generateText('claude-sonnet-5-5', 'x'), ApiProviderDisabledError);
    await assert.rejects(p.test('claude-haiku-5-5'), ApiProviderDisabledError);
  }
  await assert.rejects(new ApiProvider({ enabled: true, keys: { anthropic: 'k' }, fetch: f.fetch }).generateText('gemini-2.5-flash-lite', 'x'), /no gemini key/);
  assert.equal(f.calls.length, 0);
});

test('api provider (enabled, fake fetch): Anthropic schema as a forced tool, Gemini response schema', async () => {
  const f = fake({
    '/v1/messages': (b) => json({ model: b.model, content: b.tools ? [{ type: 'tool_use', name: 'emit', input: { answer: 'no' } }] : [{ type: 'text', text: ' Is TRN-301 an older unit? ' }] }),
    '/v1beta/models/gemini-2.5-flash-lite:generateContent': () => json({ modelVersion: 'gemini-2.5-flash-lite', candidates: [{ content: { parts: [{ text: '{"answer":"yes"}' }] } }] }),
  });
  const p = new ApiProvider({ enabled: true, keys: { anthropic: 'ak', gemini: 'gk' }, fetch: f.fetch });
  const schema = { type: 'object', properties: { answer: { type: 'string' } } };
  assert.deepEqual(await p.generateJson('claude-haiku-5-5', 'x', schema), { answer: 'no' });
  assert.deepEqual(f.calls[0]!.body.tools[0].input_schema, schema);
  assert.deepEqual(f.calls[0]!.body.tool_choice, { type: 'tool', name: 'emit' });
  assert.equal(await p.generateText('claude-sonnet-5-5', 'x'), 'Is TRN-301 an older unit?');
  assert.deepEqual(await p.generateJson('gemini-2.5-flash-lite', 'x', schema), { answer: 'yes' });
  assert.deepEqual(f.calls[2]!.body.generationConfig.responseJsonSchema, schema);
  assert.deepEqual(await p.test('claude-haiku-5-5'), { model: 'claude-haiku-5-5', vendor: 'anthropic' });
});

test('embedding cache: keyed by (model, sha256(text)); only uncached texts reach the provider', async () => {
  let n = 0;
  const provider = { embed: async (_m: string, texts: string[]) => { n += texts.length; return texts.map((t) => Float32Array.from([t.length])); } };
  const c = new EmbeddingCache();
  const a = await c.embed(provider, 'bge-m3', ['one', 'three', 'one']);
  assert.equal(n, 2);
  const b = await c.embed(provider, 'bge-m3', ['three']);
  assert.equal(n, 2);
  assert.equal(b[0], a[1]);
  await c.embed(provider, 'nomic-embed-text', ['three']);
  assert.equal(n, 3, 'another model is another key');
  assert.equal(textHash('x'), textHash('x'));
  assert.equal(textHash('x').length, 64);
});
