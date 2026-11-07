import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Engine } from '../src/apps/service/engine.ts';
import { deriveAllowlist, installServiceGuard } from '../src/apps/service/guard.ts';
import { DEFAULT_MODEL_SLOTS, type ModelSlots } from '../src/libs/utils/contracts/index.ts';
import { NetworkProviderBlockedError } from '../src/libs/utils/models/routes.ts';

const slots = (o: Partial<ModelSlots>): ModelSlots => ({ ...DEFAULT_MODEL_SLOTS, ...o });

test('deriveAllowlist: rules -> nothing; local -> Ollama only; api needs KT_NO_API unset; slack only under KT_SLACK_LIVE=1; own origin when given', () => {
  assert.deepEqual(deriveAllowlist(DEFAULT_MODEL_SLOTS, {}), []);
  assert.deepEqual(deriveAllowlist(slots({ embed: { provider: 'local' } }), {}), ['http://127.0.0.1:11434']);
  assert.deepEqual(deriveAllowlist(slots({ extract: { provider: 'api' } }), { KT_NO_API: '1' }), []);
  assert.deepEqual(deriveAllowlist(slots({ extract: { provider: 'api' } }), {}), ['https://api.anthropic.com', 'https://generativelanguage.googleapis.com']);
  assert.deepEqual(deriveAllowlist(DEFAULT_MODEL_SLOTS, { KT_SLACK_LIVE: '1' }), ['https://slack.com']);
  assert.deepEqual(deriveAllowlist(DEFAULT_MODEL_SLOTS, {}, 'http://127.0.0.1:47996'), ['http://127.0.0.1:47996']);
});

test('the service guard refuses every host with all slots on rules, re-derives on PUT /settings, and logs the missing route', async () => {
  const g = globalThis as { fetch: unknown };
  const real = g.fetch;
  const seen: string[] = [];
  g.fetch = (u: string) => { seen.push(u); return 'ok'; };
  const engine = new Engine({ dbPath: ':memory:' });
  const log: string[] = [];
  const restore = installServiceGuard({ slots: () => engine.modelSlots(), ownOrigin: () => 'http://127.0.0.1:47996', env: {}, log: (l) => log.push(l) });
  try {
    for (const u of ['https://example.com/x', 'http://127.0.0.1:11434/api/tags', 'https://api.anthropic.com/v1/messages', 'https://slack.com/api/x']) {
      assert.throws(() => fetch(u), NetworkProviderBlockedError);
    }
    assert.deepEqual(seen, []);
    assert.equal(log.length, 4);
    assert.match(log[1]!, /127\.0\.0\.1:11434.*ollama-embed/);
    assert.match(log[3]!, /slack-web/);
    // The local pages and mcp-demo talk to the service itself.
    assert.equal(fetch('http://127.0.0.1:47996/health'), 'ok');
    // Switching embed to local allows the Ollama host and nothing else.
    engine.putSettings({ models: { embed: { provider: 'local', model: 'nomic-embed-text' } } });
    assert.equal(fetch('http://127.0.0.1:11434/api/tags'), 'ok');
    assert.throws(() => fetch('https://example.com/x'), NetworkProviderBlockedError);
    assert.throws(() => fetch('https://api.anthropic.com/v1/messages'), NetworkProviderBlockedError);
    assert.throws(() => fetch('http://127.0.0.1:11435/'), NetworkProviderBlockedError);
    // Back to rules: closed again.
    engine.putSettings({ models: { embed: { provider: 'rules' } } });
    assert.throws(() => fetch('http://127.0.0.1:11434/api/tags'), NetworkProviderBlockedError);
  } finally {
    restore();
    g.fetch = real;
    engine.close();
  }
});
