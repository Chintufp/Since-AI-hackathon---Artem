/** The extract and phrase slots through the service, with a fake local provider (never Ollama, never the network). */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ModelProvider } from '../src/libs/utils/models/providers/index.ts';
import { DEV_FIXTURE, startService } from './support.ts';

const TEAMS = join(DEV_FIXTURE, 'teams.json');

/** generateJson answers with `answer(prompt)`; everything else is unused. */
function fakeGenerator(answer: (prompt: string) => unknown) {
  const calls: string[] = [];
  const p: ModelProvider & { calls: string[] } = {
    kind: 'local', calls,
    async embed() { throw new Error('not used'); },
    async generateJson(model, prompt) { calls.push(`json ${model}`); return answer(prompt); },
    async generateText() { throw new Error('not used'); },
    async warm() {}, async unload() {},
    async detect() { return { installed: true, running: true, models: [] }; },
    async pull() {},
  };
  return p;
}

/** The model proposes one claim the rules do not have, citing the first message verbatim. */
function extractAnswer(prompt: string) {
  const m = /\[1\] id=(\S+) author=[^\n]*\(actor ([^)]+)\)[^\n]*\n/.exec(prompt.slice(prompt.lastIndexOf('Now the real thread')))!;
  return {
    claims: [{ type: 'hypothesis', statement: 'The firmware update this morning triggered the flapping.', subjectEntityNames: ['RTR-117'], assertedByActorId: m[2], evidence: [{ evidenceId: m[1], excerpt: 'keep flapping since the firmware update this morning' }] }],
    entities: [], links: [], incidents: [], usefulness: [],
  };
}

test('extract=local: POST /import commits the rules union and reports the model route; the case view says who proposed what', async () => {
  const local = fakeGenerator(extractAnswer);
  const svc = await startService({ modelManager: { local } });
  try {
    await svc.call('PUT', '/settings', { models: { extract: { provider: 'local', model: 'qwen3:4b' } } });
    const r = await svc.call('POST', '/import', { format: 'teams-json', path: TEAMS });
    assert.deepEqual(r.extraction, { route: { route: 'local', version: 'ollama-extract@1:qwen3:4b' }, modelClaims: 1, dropped: 0 });
    assert.equal(r.cases, 1);
    assert.deepEqual(local.calls, ['json qwen3:4b']);
    const [c] = await svc.call('GET', '/cases');
    const node = c.timeline.find((n: { stage: string }) => n.stage === 'hypothesis');
    assert.match(node.detail, /proposed by local model qwen3:4b, committed by rules/);
  } finally {
    await svc.close();
  }
});

test('extract=local with the model down: the import is the rules import and says it fell back', async () => {
  const local = fakeGenerator(() => { throw new Error('connect ECONNREFUSED 127.0.0.1:11434'); });
  const svc = await startService({ modelManager: { local } });
  try {
    const plain = await startService();
    const rulesOnly = await plain.call('POST', '/import', { format: 'teams-json', path: TEAMS });
    await plain.close();
    await svc.call('PUT', '/settings', { models: { extract: { provider: 'local' } } });
    const r = await svc.call('POST', '/import', { format: 'teams-json', path: TEAMS });
    assert.equal(r.extraction.route.version, 'rules-extractor@1[fallback:extract:error]');
    assert.match(r.extraction.fallback, /ECONNREFUSED/);
    assert.equal(r.claims, rulesOnly.claims);
    assert.equal(rulesOnly.extraction, undefined);
    assert.equal(svc.engine.store.list('claim').filter((x) => x.extraction.route !== 'rules').length, 0);
  } finally {
    await svc.close();
  }
});
