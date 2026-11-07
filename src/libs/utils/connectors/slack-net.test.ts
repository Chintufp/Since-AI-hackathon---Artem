import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ROUTE_REGISTRY, NetworkProviderBlockedError, installNetworkGuard } from '../models/routes.ts';
import { slackNetworkFetch, SLACK_ROUTE } from './slack-net.ts';
import { slackWebClient } from './slack-live-pull.ts';
import { slackDmClient } from './slack-poller.ts';
import { SlackConnector } from './slack-live.ts';

const TOKEN = 'xoxb-test-not-a-real-token';
type F = (url: string, init?: unknown) => Promise<{ json(): Promise<unknown> }>;

/** Replaces globalThis.fetch with a recorder for one test; returns the calls and a restore function. */
function recordFetch(): { calls: string[]; restore: () => void } {
  const g = globalThis as { fetch: unknown };
  const original = g.fetch;
  const calls: string[] = [];
  g.fetch = async (url: string) => { calls.push(url); return { json: async () => ({ ok: true, messages: [] }) }; };
  return { calls, restore: () => { g.fetch = original; } };
}

test('the Slack connectors carry a registered route label (slack-web, not a model)', () => {
  assert.equal(ROUTE_REGISTRY['slack-web']!.route, 'api');
  assert.equal(ROUTE_REGISTRY['slack-web']!.learned, false);
  assert.equal(SLACK_ROUTE.version, 'slack-web@1');
});

test('default Slack clients refuse before any request without KT_SLACK_LIVE=1', async (t) => {
  const prev = process.env.KT_SLACK_LIVE;
  delete process.env.KT_SLACK_LIVE;
  const rec = recordFetch();
  t.after(() => { rec.restore(); if (prev === undefined) delete process.env.KT_SLACK_LIVE; else process.env.KT_SLACK_LIVE = prev; });
  await assert.rejects(() => slackWebClient(TOKEN).call('conversations.history', { channel: 'C1' }), NetworkProviderBlockedError);
  await assert.rejects(() => slackDmClient(TOKEN).call('reactions.get', { channel: 'D1', timestamp: '1.2' }), NetworkProviderBlockedError);
  const live = new SlackConnector({ liveAuthorized: true, token: TOKEN } as never);
  await assert.rejects(() => live.fetchHistory({ id: 'C1', name: 'x' }), NetworkProviderBlockedError);
  assert.deepEqual(rec.calls, [], 'no request left the process');
});

test('with KT_SLACK_LIVE=1 the guarded fetch reaches slack.com only, through globalThis.fetch (so installNetworkGuard still applies)', async (t) => {
  const rec = recordFetch();
  t.after(rec.restore);
  const f = slackNetworkFetch<F>({ KT_SLACK_LIVE: '1' });
  await f('https://slack.com/api/auth.test');
  assert.deepEqual(rec.calls, ['https://slack.com/api/auth.test']);
  await assert.rejects(() => f('https://example.com/api/auth.test'), NetworkProviderBlockedError);
  assert.equal(rec.calls.length, 1);
  rec.restore();
  const restoreGuard = installNetworkGuard();
  t.after(restoreGuard);
  await assert.rejects(() => f('https://slack.com/api/auth.test'));
});
