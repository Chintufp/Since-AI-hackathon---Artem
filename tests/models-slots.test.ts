/** The extract and phrase slots through the service, with a fake local provider (never Ollama, never the network). */
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { test } from 'node:test';
import { ProviderError, type ModelProvider } from '../src/libs/utils/models/providers/index.ts';
import { SLOT_COOLDOWN_MS } from '../src/apps/service/models.ts';
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

test('phrase=local: the question card reads the accepted wording and says "worded by local model"; a planted hallucination keeps the template', async () => {
  const req = { id: 'person:test:req2', displayName: 'Rune Requester', groups: ['noc'], type: 'human' as const };
  const TEXT = 'BGP flaps after firmware upgrade on edge router RTR-300 unit';
  // Template run first, to know the template wording the model is asked to reword.
  const plain = await startService();
  await plain.call('POST', '/import', { format: 'scenario-dir', path: DEV_FIXTURE });
  const t = await plain.call('POST', '/investigate', { text: TEXT, principal: req });
  await plain.close();
  assert.ok(t.question, 'the template run opens a question');
  assert.equal(t.question.wordedBy, undefined);
  const templateText: string = t.question.text;

  for (const [answer, worded] of [[`${templateText.replace(/\?$/, '')}, as far as you know?`, true], ['Did Mikko replace the PSU on TRN-301 in 2020?', false]] as const) {
    const local = fakeGenerator(() => ({ question: answer }));
    const svc = await startService({ modelManager: { local } });
    try {
      await svc.call('POST', '/import', { format: 'scenario-dir', path: DEV_FIXTURE });
      await svc.call('PUT', '/settings', { models: { phrase: { provider: 'local', model: 'qwen3:8b' } } });
      const r = await svc.call('POST', '/investigate', { text: TEXT, principal: req });
      const q = r.question;
      assert.ok(q);
      if (worded) {
        assert.equal(q.text, answer);
        assert.equal(q.wordedBy, 'worded by local model qwen3:8b');
        assert.equal(q.templateText, templateText);
        assert.ok(r.routes.some((x: { version: string }) => x.version === 'ollama-phrase@1:qwen3:8b'));
      } else {
        assert.equal(q.text, templateText);
        assert.equal(q.wordedBy, undefined);
        const stored = svc.engine.store.get('question', q.questionId)!;
        assert.match(stored.candidate.phrasing!.reason!, /rejected/);
      }
    } finally {
      await svc.close();
    }
  }
});

test('phrase=local with a model that times out: one wait, then the slot is skipped for the cooldown (labelled), then tried again', async () => {
  const req = { id: 'person:test:req3', displayName: 'Rune Requester', groups: ['noc'], type: 'human' as const };
  const TEXT = 'BGP flaps after firmware upgrade on edge router RTR-300 unit';
  const local = fakeGenerator(() => { throw new ProviderError('timeout', 'phrase: no answer within 20000 ms'); });
  let ms = 0;
  const svc = await startService({ modelManager: { local, monoNow: () => ms } });
  try {
    await svc.call('POST', '/import', { format: 'scenario-dir', path: DEV_FIXTURE });
    await svc.call('PUT', '/settings', { models: { phrase: { provider: 'local', model: 'qwen3:8b' } } });
    const versions = (r: { routes: Array<{ version: string }> }): string => r.routes.map((x) => x.version).join(' ');
    const a = await svc.call('POST', '/investigate', { text: TEXT, principal: req });
    assert.ok(local.calls.length >= 1);
    // the first quick candidate waits and times out; any later generate in the same request is skipped
    assert.match(versions(a), /\[fallback:phrase:(timeout|cooldown)\]/);
    assert.ok(svc.engine.models.cooling('phrase'));
    const after = local.calls.length;
    ms += 10_000;
    const b = await svc.call('POST', '/investigate', { text: `${TEXT} since this morning`, principal: { ...req, id: 'person:test:req4' } });
    assert.equal(local.calls.length, after, 'the cooling slot is not called');
    assert.match(versions(b), /\[fallback:phrase:cooldown\]/);
    assert.match(svc.engine.models.cooling('phrase')!, /skipped for 50 s/);
    ms += SLOT_COOLDOWN_MS;
    await svc.call('POST', '/investigate', { text: `${TEXT} again`, principal: { ...req, id: 'person:test:req5' } });
    assert.ok(local.calls.length > after, 'after the cooldown the model is tried again');
  } finally {
    await svc.close();
  }
});
