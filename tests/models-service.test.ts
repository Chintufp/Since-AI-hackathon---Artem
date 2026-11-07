import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { DetectResult, ModelProvider, PullProgress } from '../src/libs/utils/models/providers/index.ts';
import { ModelManager } from '../src/apps/service/models.ts';
import { DEV_FIXTURE, human, ROOT, startService } from './support.ts';

/** A local provider that never touches the network: records calls, embeds by concept counts, pulls on command. */
function fakeLocal(over: Partial<DetectResult> = {}) {
  const calls: string[] = [];
  let release: (() => void) | undefined;
  let progress: ((p: PullProgress) => void) | undefined;
  const CONCEPTS = [['traffic', 'flowing', 'counters', 'forwarding', 'passes'], ['link', 'interface', 'green', 'light', 'up'], ['nothing', 'no', 'zero', 'stayed', 'absent'], ['sfp', 'optic', 'transceiver', 'replaced']];
  const p: ModelProvider & { calls: string[]; finishPull(ok: boolean): void; progress(pct: number): void } = {
    kind: 'local',
    calls,
    async embed(model, texts) {
      calls.push(`embed ${model} x${texts.length}`);
      return texts.map((t) => {
        const w = t.toLowerCase().match(/[a-z]+/g) ?? [];
        return Float32Array.from(CONCEPTS.map((c) => w.filter((x) => c.includes(x)).length + 0.01));
      });
    },
    async generateJson() { throw new Error('not used'); },
    async generateText() { throw new Error('not used'); },
    async warm(model, keepAlive, o) { calls.push(`warm ${model} ${String(keepAlive)}${o?.embedding ? ' embed' : ''}`); },
    async unload(model) { calls.push(`unload ${model}`); },
    async detect() {
      calls.push('detect');
      return { installed: true, running: true, version: '0.40.9', totalMemBytes: 24e9, freeDiskBytes: 300e9, models: [{ name: 'qwen3:8b', sizeBytes: 5.2e9, capabilities: ['completion', 'tools'] }, { name: 'bge-m3:latest', sizeBytes: 1.2e9, capabilities: ['embedding'] }, { name: 'qwen3:14b', sizeBytes: 9.3e9, capabilities: ['completion'] }], ...over };
    },
    pull(model, onProgress) {
      calls.push(`pull ${model}`);
      progress = onProgress;
      onProgress({ status: 'pulling manifest' });
      return new Promise<void>((resolve, reject) => { release = () => resolve(); (p as { fail?: () => void }).fail = () => reject(new Error('pull model manifest: file does not exist')); });
    },
    finishPull(ok) { if (ok) release?.(); else (p as unknown as { fail: () => void }).fail(); },
    progress(pct) { progress?.({ status: 'pulling abc', total: 100, completed: pct, percent: pct }); },
  };
  return p;
}
const tick = () => new Promise((r) => setTimeout(r, 5));

test('with every slot on rules nothing model-related runs: no detect, no warm, no embedding rows, investigation route unchanged', async () => {
  const local = fakeLocal();
  const svc = await startService({ modelManager: { local }, autoModels: true });
  try {
    await svc.call('POST', '/import', { format: 'scenario-dir', path: DEV_FIXTURE });
    assert.deepEqual(await svc.engine.models.warmSlots(svc.engine.modelSlots()), []);
    await svc.engine.embeddingsIdle();
    const r = await svc.call('POST', '/investigate', { text: 'RTR-117 link up but no traffic', principal: human('person:t:r', 'Req', ['noc']) });
    assert.ok(!r.state.routes.some((x: { version: string }) => /embed/.test(x.version)));
    assert.deepEqual(local.calls, []);
    assert.equal(svc.engine.store.embeddings!.count(), 0);
  } finally {
    await svc.close();
  }
});

test('GET /models: detection, catalog merged with installed models, per-slot chips; installed-only models are selectable', async () => {
  const local = fakeLocal();
  const svc = await startService({ modelManager: { local } });
  try {
    await svc.call('PUT', '/settings', { models: { embed: { provider: 'local', model: 'bge-m3' }, extract: { provider: 'local', model: 'qwen3:4b' }, phrase: { provider: 'api', model: 'claude-sonnet-5-5' } } });
    const v = await svc.call('GET', '/models');
    assert.equal(v.detection.running, true);
    assert.equal(v.detection.version, '0.40.9');
    assert.deepEqual(v.detection.setup, ['brew install ollama', 'ollama serve', 'ollama pull bge-m3']);
    const embed = v.catalog.embed.map((e: { model: string }) => e.model);
    assert.deepEqual(embed, ['bge-m3', 'nomic-embed-text', 'mxbai-embed-large']);
    assert.equal(v.catalog.embed[0].label, 'installed · ready');
    assert.match(v.catalog.embed[1].label, /^not downloaded · 274 MB · Download$/);
    assert.ok(v.catalog.embed[0].recommended);
    const phrase = v.catalog.phrase.map((e: { model: string }) => e.model);
    assert.ok(phrase.includes('qwen3:14b') && phrase.indexOf('qwen3:14b') === 1, 'catalog entry, marked installed');
    assert.ok(v.catalog.extract.some((e: { model: string; fromInstalled?: boolean }) => e.model === 'qwen3:14b' && e.fromInstalled), 'installed model offered to extract too');
    assert.ok(!v.catalog.extract.some((e: { model: string }) => e.model === 'bge-m3'), 'an embedding model is not offered for extract');
    assert.deepEqual([v.slots.embed.chip, v.slots.extract.chip, v.slots.phrase.chip], ['ready', 'not downloaded', 'failed: no anthropic key']);
    assert.deepEqual(v.apiKeys, { anthropic: false, gemini: false });
    await svc.call('PUT', '/settings', { models: { embed: { provider: 'rules' } } });
    assert.equal((await svc.call('GET', '/models')).slots.embed.chip, 'off');
  } finally {
    await svc.close();
  }
});

test('GET /models on a Mac without Ollama: entries say Ollama not installed, local slots fail with the reason; too-large models are flagged', async () => {
  const local = fakeLocal({ installed: false, running: false, models: [], version: undefined as unknown as string, totalMemBytes: 8e9 });
  const svc = await startService({ modelManager: { local } });
  try {
    await svc.call('PUT', '/settings', { models: { phrase: { provider: 'local' } } });
    const v = await svc.call('GET', '/models');
    assert.equal(v.catalog.phrase[0].availability, 'ollama-missing');
    assert.equal(v.slots.phrase.chip, 'failed: Ollama not installed');
    const m = new ModelManager({ local: fakeLocal({ totalMemBytes: 8e9 }) });
    const cat = m.catalog(await m.local.detect());
    assert.equal(cat.phrase.find((e) => e.model === 'qwen3:14b')!.availability, 'ready', 'installed wins');
    assert.equal(cat.phrase.find((e) => e.model === 'gemma3:4b')!.availability, 'not-downloaded');
    assert.equal(cat.extract.find((e) => e.model === 'qwen3:8b')!.availability, 'ready');
    const small = new ModelManager({ local: fakeLocal({ totalMemBytes: 8e9, models: [] }) });
    assert.equal(small.catalog(await small.local.detect()).phrase.find((e) => e.model === 'qwen3:14b')!.availability, 'too-large');
  } finally {
    await svc.close();
  }
});

test('POST /models/pull starts a job only on request; the chip shows downloading N%; a failure is reported', async () => {
  const local = fakeLocal();
  const svc = await startService({ modelManager: { local } });
  try {
    assert.ok(!local.calls.some((c) => c.startsWith('pull')), 'nothing pulled before a click');
    await svc.call('PUT', '/settings', { models: { extract: { provider: 'local', model: 'qwen3:4b' } } });
    const job = await svc.call('POST', '/models/pull', { model: 'qwen3:4b' });
    assert.equal(job.state, 'running');
    local.progress(43);
    assert.equal((await svc.call('GET', `/models/pull/${job.jobId}`)).percent, 43);
    assert.equal((await svc.call('GET', '/models')).slots.extract.chip, 'downloading 43%');
    assert.equal((await svc.call('POST', '/models/pull', { model: 'qwen3:4b' })).jobId, job.jobId, 'one job per model');
    local.finishPull(true);
    await tick();
    const done = await svc.call('GET', `/models/pull/${job.jobId}`);
    assert.deepEqual([done.state, done.percent], ['done', 100]);
    const bad = await svc.call('POST', '/models/pull', { model: 'nope:1b' });
    local.finishPull(false);
    await tick();
    const failed = await svc.call('GET', `/models/pull/${bad.jobId}`);
    assert.equal(failed.state, 'failed');
    assert.match(failed.error, /file does not exist/);
    await svc.call('GET', '/models/pull/pull-999', undefined, 404);
    await svc.call('POST', '/models/pull', { model: 'qwen3:4b; rm -rf /' }, 400);
  } finally {
    await svc.close();
  }
});

test('api keys live in memory only: never in settings, SQLite, traces or the response; test reports the model that answered', async () => {
  const calls: string[] = [];
  const apiFetch = async (url: string, init?: { body?: string }) => {
    calls.push(url);
    const body = JSON.parse(init?.body ?? '{}');
    return new Response(JSON.stringify({ model: body.model, content: [{ type: 'text', text: 'ok' }] }), { status: 200 });
  };
  const svc = await startService({ modelManager: { local: fakeLocal(), apiFetch } });
  try {
    const before = await svc.call('POST', '/models/test', { provider: 'anthropic' });
    assert.deepEqual(before, { ok: false, provider: 'anthropic', error: 'no anthropic key' });
    assert.equal(calls.length, 0);
    const SECRET = 'sk-test-not-a-real-key-123';
    assert.deepEqual(await svc.call('POST', '/models/key', { provider: 'anthropic', key: SECRET }), { provider: 'anthropic', present: true });
    const t = await svc.call('POST', '/models/test', { provider: 'anthropic', model: 'claude-haiku-5-5' });
    assert.deepEqual(t, { ok: true, provider: 'anthropic', model: 'claude-haiku-5-5' });
    assert.equal((await svc.call('GET', '/models')).apiKeys.anthropic, true);
    const dump = JSON.stringify([svc.engine.store.list('settings'), svc.engine.store.list('trace'), await svc.call('GET', '/settings'), await svc.call('GET', '/models')]);
    assert.ok(!dump.includes(SECRET), 'the key is nowhere in stored or served data');
    await svc.call('PUT', '/settings', { apiKey: SECRET }, 400);
    assert.deepEqual(await svc.call('POST', '/models/key', { provider: 'anthropic', key: '' }), { provider: 'anthropic', present: false });
  } finally {
    await svc.close();
  }
  // nothing under data/ or the repo's tracked dirs holds the key
  const scan = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? scan(p) : [p];
  });
  for (const f of scan(join(ROOT, 'data', 'models'))) assert.ok(!readFileSync(f, 'utf8').includes('sk-test-not-a-real-key'), f);
});

test('demo:judge (noApi): a stored api slot and a handed key reach no hosted model; the chip says why', async () => {
  const calls: string[] = [];
  const apiFetch = async (url: string) => { calls.push(url); return new Response('{}', { status: 200 }); };
  const svc = await startService({ modelManager: { local: fakeLocal(), apiFetch, noApi: true } });
  try {
    await svc.call('POST', '/import', { format: 'scenario-dir', path: DEV_FIXTURE });
    assert.deepEqual(await svc.call('POST', '/models/key', { provider: 'anthropic', key: 'sk-test-not-a-real-key-456' }), { provider: 'anthropic', present: false });
    await svc.call('PUT', '/settings', { models: { phrase: { provider: 'api', model: 'claude-sonnet-5-5' }, extract: { provider: 'api' } } });
    const v = await svc.call('GET', '/models');
    assert.equal(v.slots.phrase.chip, 'failed: hosted models are off in this run');
    const r = await svc.call('POST', '/investigate', { text: 'BGP flaps after firmware upgrade on edge router RTR-300 unit', principal: human('person:test:judge', 'Judge', ['noc']) });
    assert.ok(r.routes.every((x: { route: string }) => x.route !== 'api'));
    assert.equal((await svc.call('POST', '/models/test', { provider: 'anthropic' })).ok, false);
    assert.equal(calls.length, 0);
  } finally {
    await svc.close();
  }
});

test('lifecycle: warm local slots at start (empty request, keep_alive 30m), idle unload, unload everything on shutdown; rules/api start nothing', async () => {
  const local = fakeLocal();
  const m = new ModelManager({ local, idleMs: 30 });
  const warmed = await m.warmSlots({ embed: { provider: 'local', model: 'bge-m3' }, extract: { provider: 'rules' }, phrase: { provider: 'api', model: 'claude-sonnet-5-5' } });
  assert.deepEqual(warmed, [{ slot: 'embed', model: 'bge-m3', ok: true }]);
  assert.deepEqual(local.calls, ['detect', 'warm bge-m3 30m embed']);
  assert.deepEqual(m.loadedModels(), ['bge-m3']);
  await new Promise((r) => setTimeout(r, 60));
  assert.ok(local.calls.includes('unload bge-m3'), 'idle unload after the idle window');
  assert.deepEqual(m.loadedModels(), []);
  local.calls.length = 0;
  const m2 = new ModelManager({ local });
  await m2.warmSlots({ embed: { provider: 'rules' }, extract: { provider: 'local' }, phrase: { provider: 'local', model: 'qwen3:8b' } });
  m2.touch('qwen3:8b');
  await m2.shutdown();
  assert.deepEqual(local.calls.filter((c) => c.startsWith('unload')).sort(), ['unload qwen3:4b', 'unload qwen3:8b']);
  assert.deepEqual(await new ModelManager({ local: fakeLocal() }).warmSlots({ embed: { provider: 'rules' }, extract: { provider: 'api' }, phrase: { provider: 'rules' } }), []);
  // Ollama installed but down: the service starts it, then warms
  let up = false;
  let started = 0;
  const down = fakeLocal();
  const detect = down.detect.bind(down);
  down.detect = async () => (up ? detect() : { installed: true, running: false, models: [] });
  const m3 = new ModelManager({ local: down, startServer: () => { started++; up = true; return undefined; } });
  const r3 = await m3.warmSlots({ embed: { provider: 'rules' }, extract: { provider: 'rules' }, phrase: { provider: 'local' } });
  assert.equal(started, 1);
  assert.deepEqual(r3, [{ slot: 'phrase', model: 'qwen3:8b', ok: true }]);
  m3.dispose();
});

test('lifecycle: concurrent warm-ups spawn one `ollama serve` and shutdown stops it; the provider is built only when used', async () => {
  let n = 0;
  const local = fakeLocal();
  const detect = local.detect.bind(local);
  // every warm-up first sees Ollama down, then up
  local.detect = async () => (++n % 2 === 1 ? { installed: true, running: false, models: [] } : detect());
  const kills: string[] = [];
  let spawned = 0;
  const child = { exitCode: null, kill: (sig: string) => { kills.push(sig); return true; } } as unknown as import('node:child_process').ChildProcess;
  const m = new ModelManager({ local, startServer: () => { spawned++; return child; } });
  const slots = { embed: { provider: 'rules' }, extract: { provider: 'rules' }, phrase: { provider: 'local' } } as const;
  await Promise.all([m.warmSlots(slots), m.warmSlots(slots), m.warmSlots(slots)]);
  assert.equal(spawned, 1);
  await m.shutdown();
  assert.deepEqual(kills, ['SIGTERM']);
  // lazily built: a manager that is never asked for its local provider constructs none
  assert.equal(Reflect.get(new ModelManager(), 'localProvider'), undefined);
});

test('lifecycle: an embedding model used by a call (not warmed) is unloaded through /api/embed', async () => {
  const { OllamaProvider } = await import('../src/libs/utils/models/providers/index.ts');
  const used: Array<[string, boolean | undefined]> = [];
  const fetch = async () => new Response(JSON.stringify({ embeddings: [[0.1, 0.2]] }), { status: 200 });
  const p = new OllamaProvider({ fetch, onUse: (model, o) => used.push([model, o?.embedding]) });
  await p.embed('bge-m3', ['green light']);
  assert.deepEqual(used, [['bge-m3', true]]);
  const local = fakeLocal();
  const unloads: Array<[string, boolean | undefined]> = [];
  local.unload = async (model, o) => { unloads.push([model, o?.embedding]); };
  const m = new ModelManager({ local });
  m.touch('bge-m3', true);
  await m.unload('bge-m3');
  assert.deepEqual(unloads, [['bge-m3', true]]);
});

test('embed=api: the chip says no hosted embedding model and the retrieval route carries the fallback label', async () => {
  const svc = await startService({ modelManager: { local: fakeLocal() } });
  try {
    await svc.call('POST', '/import', { format: 'scenario-dir', path: DEV_FIXTURE });
    await svc.call('POST', '/models/key', { provider: 'anthropic', key: 'sk-test-not-a-real-key-789' });
    await svc.call('PUT', '/settings', { models: { embed: { provider: 'api' } } });
    assert.equal((await svc.call('GET', '/models')).slots.embed.chip, 'failed: no hosted embedding model; rules used');
    const r = await svc.call('POST', '/investigate', { text: 'green light, nothing flowing', principal: human('person:test:emb', 'Emb', ['noc']) });
    assert.ok(r.routes.some((x: { version: string }) => x.version.endsWith('+embed[fallback:unsupported]')));
  } finally {
    await svc.close();
  }
});

test('embed=local: imports index evidence, claims and case cards; a paraphrase is found by meaning; demo reset rebuilds the rows', async () => {
  const local = fakeLocal();
  const svc = await startService({ modelManager: { local }, autoModels: true });
  try {
    await svc.call('PUT', '/settings', { models: { embed: { provider: 'local', model: 'bge-m3' } } });
    await svc.call('POST', '/import', { format: 'scenario-dir', path: join(ROOT, 'data', 'scenarios', 'optic-forwarding-a') });
    await svc.engine.embeddingsIdle();
    const t = svc.engine.store.embeddings!;
    assert.ok(t.list('case', 'bge-m3').length >= 1);
    assert.ok(t.list('claim', 'bge-m3').length > 0 && t.list('evidence', 'bge-m3').length > 0);
    const before = local.calls.filter((c) => c.startsWith('embed')).length;
    assert.deepEqual(await svc.engine.refreshEmbeddings(), { written: 0, unchanged: t.count('bge-m3'), removed: 0 }, 'unchanged text is not re-embedded');
    assert.equal(local.calls.filter((c) => c.startsWith('embed')).length, before);
    const r = await svc.call('POST', '/investigate', { text: 'green light on the optic but nothing flowing', principal: human('person:t:r', 'Req', ['noc', 'field']), allowQuestions: false });
    assert.ok(r.state.routes.some((x: { version: string }) => x.version.endsWith('+embed[local:bge-m3]')), JSON.stringify(r.state.routes));
    assert.ok(r.state.candidates.some((c: { reasons: string[] }) => c.reasons.includes('similar in meaning (local model bge-m3)')));
    await svc.call('POST', '/demo/reset', { seed: 'empty' });
    assert.equal(t.count(), 0, 'reset wipes the vectors');
  } finally {
    await svc.close();
  }
});

test('POST /models/install: runs the installer with a visible log, then starts ollama serve; without Homebrew it offers the download page', async () => {
  let finish: ((ok: boolean) => void) | undefined;
  const started: string[] = [];
  const installer = {
    brewPath: async () => '/opt/homebrew/bin/brew',
    run: (brew: string, onLine: (l: string) => void) => new Promise<void>((resolve, reject) => {
      onLine('==> Downloading ollama');
      finish = (ok) => (ok ? resolve() : reject(new Error('brew install ollama exited with code 1')));
    }),
  };
  const svc = await startService({ modelManager: { local: fakeLocal(), installer, startServer: () => { started.push('serve'); return undefined; } } });
  try {
    assert.equal((await svc.call('GET', '/models/install')).state, 'idle');
    const j = await svc.call('POST', '/models/install', {});
    assert.equal(j.state, 'running');
    assert.equal(j.brew, true);
    assert.deepEqual(j.log, ['$ /opt/homebrew/bin/brew install ollama', '==> Downloading ollama']);
    // a second click while it runs is the same job
    assert.equal((await svc.call('POST', '/models/install', {})).startedAt, j.startedAt);
    finish!(true);
    await tick();
    const done = await svc.call('GET', '/models/install');
    assert.equal(done.state, 'done');
    assert.deepEqual(started, ['serve']);
    await svc.call('POST', '/models/install', { brew: 'rm -rf /' }, 400);
  } finally {
    await svc.close();
  }
  const none = await startService({ modelManager: { local: fakeLocal(), installer: { brewPath: async () => undefined, run: async () => { throw new Error('never'); } } } });
  try {
    const j = await none.call('POST', '/models/install', {});
    assert.equal(j.state, 'unavailable');
    assert.equal(j.downloadUrl, 'https://ollama.com/download');
    assert.deepEqual(j.setup, ['brew install ollama', 'ollama serve', 'ollama pull bge-m3']);
  } finally {
    await none.close();
  }
});
