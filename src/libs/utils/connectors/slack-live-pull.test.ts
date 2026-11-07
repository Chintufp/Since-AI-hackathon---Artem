import { test } from 'node:test';
import assert from 'node:assert/strict';
import { importFromPath, openStore } from '../memory/index.ts';
import { checkLiveGuard, pullChannelReadOnly, slackWebClient, SlackApiError, SLACK_READ_METHODS, SLACK_READ_SCOPES, WorkspaceMismatchError, type SlackReadClient, type SlackReadMethod } from './slack-live-pull.ts';

const TOKEN = 'xoxb-fake-token-for-tests-only';

/** Fake Slack: records every method called; knows one private channel with two members and one public channel. */
function fakeSlack(team = 'Kalevanet Sandbox') {
  const calls: Array<{ method: string; params: Record<string, string> }> = [];
  const client: SlackReadClient = {
    async call(method, params = {}) {
      calls.push({ method, params });
      switch (method) {
        case 'auth.test': return { ok: true, team, team_id: 'T0SANDBOX', user_id: 'UBOT' };
        case 'conversations.list': return { ok: true, channels: [{ id: 'C0PRIVATE1', name: 'change-review', is_private: true }, { id: 'C0PUBLIC01', name: 'general', is_private: false }], response_metadata: { next_cursor: '' } };
        case 'conversations.info': return { ok: true, channel: { id: params.channel, name: params.channel === 'C0PRIVATE1' ? 'change-review' : 'general', is_private: params.channel === 'C0PRIVATE1' } };
        case 'conversations.members': return { ok: true, members: ['U1', 'U2'] };
        case 'users.list': return { ok: true, members: [{ id: 'U1', real_name: 'Sirkka Lindholm' }, { id: 'U2', real_name: 'Jarmo Heikkinen' }, { id: 'UBOT', name: 'kt-bot', is_bot: true }] };
        case 'conversations.history': return {
          ok: true, messages: [
            { ts: '1783000200.000200', user: 'U2', text: 'v7.1 patch applied on ACC-30. Uplinks and VLAN 210 are back.' },
            { ts: '1783000100.000100', user: 'U1', text: 'Do not roll back N5 units. The v6 template cannot address their port layout.' },
            { ts: '1783000000.000000', user: 'U1', subtype: 'channel_join', text: 'joined' },
          ],
        };
        default: throw new Error(`fake: unexpected ${String(method)}`);
      }
    },
  };
  return { client, calls };
}

test('guard: refuses without KT_SLACK_LIVE=1, without a token, without workspace or channel; never echoes the token', () => {
  const none = checkLiveGuard({});
  assert.equal(none.ok, false);
  assert.equal(none.missing.length, 4);
  const noLive = checkLiveGuard({ token: TOKEN, workspace: 'X', channel: '#c' });
  assert.equal(noLive.ok, false);
  assert.ok(noLive.missing.some((m) => m.startsWith('KT_SLACK_LIVE=1')));
  const noToken = checkLiveGuard({ live: '1', workspace: 'X', channel: '#c' });
  assert.ok(noToken.missing.some((m) => m.startsWith('KT_SLACK_TOKEN')));
  const blankToken = checkLiveGuard({ live: '1', token: '   ', workspace: 'X', channel: '#c' });
  assert.equal(blankToken.ok, false);
  const ok = checkLiveGuard({ live: '1', token: TOKEN, workspace: 'X', channel: '#c' });
  assert.equal(ok.ok, true);
  const printed = JSON.stringify([none, noLive, noToken, ok]);
  assert.ok(!printed.includes(TOKEN), 'the token value never appears in guard output');
  assert.ok(ok.instructions.join(' ').includes('channels:read'));
  assert.ok(!SLACK_READ_SCOPES.some((scope) => /write/.test(scope)), 'no write scope is ever requested');
});

test('workspace mismatch stops after auth.test; nothing else is read', async () => {
  const { client, calls } = fakeSlack('Some Other Team');
  await assert.rejects(() => pullChannelReadOnly(client, { workspace: 'Kalevanet Sandbox', channel: '#change-review' }), (e: unknown) => {
    assert.ok(e instanceof WorkspaceMismatchError);
    assert.equal(e.expected, 'Kalevanet Sandbox');
    assert.equal(e.actual, 'Some Other Team');
    return true;
  });
  assert.deepEqual(calls.map((c) => c.method), ['auth.test']);
});

test('pull reads one channel with only read methods and maps a private channel to members-only evidence', async () => {
  const { client, calls } = fakeSlack();
  const r = await pullChannelReadOnly(client, { workspace: 'kalevanet sandbox', channel: '#change-review', limit: 50 });
  assert.equal(r.team.id, 'T0SANDBOX');
  assert.equal(r.channel.id, 'C0PRIVATE1');
  assert.equal(r.channel.is_private, true);
  assert.deepEqual(r.channel.members, ['U1', 'U2']);
  assert.equal(r.messages.length, 3);
  assert.equal(r.messages[0]!.ts, '1783000000.000000', 'oldest first');
  const methods = calls.map((c) => c.method);
  for (const m of methods) assert.ok((SLACK_READ_METHODS as readonly string[]).includes(m), `${m} is a read method`);
  assert.ok(!methods.some((m) => /post|write|react|update|delete|invite|kick|join/.test(m)));
  assert.equal(calls.filter((c) => c.method === 'conversations.history').length, 1, 'exactly one channel history');
  assert.deepEqual(calls.filter((c) => c.method === 'conversations.history').map((c) => c.params.channel), ['C0PRIVATE1']);
  assert.equal(calls.find((c) => c.method === 'conversations.history')!.params.limit, '50');
  // The same mapping as the export path: private channel => group scope + membership grants; join noise dropped.
  const store = openStore(':memory:');
  const res = importFromPath(store, { format: 'slack-live', payload: r.data, connectionId: 'slack-live:T0SANDBOX', orgId: 'org:test', now: '2026-11-07T12:00:00.000Z' });
  assert.equal(res.batch.counts.inserted, 2);
  assert.match(res.batch.sourceDescription, /Slack live/);
  const evidence = store.list('evidence');
  assert.equal(evidence.length, 2);
  for (const e of evidence) {
    assert.equal(e.connectionId, 'slack-live:T0SANDBOX');
    assert.deepEqual(e.accessScope, { visibility: 'group', groups: ['slack-channel:C0PRIVATE1'] });
  }
  const people = store.list('entity', { where: { type: 'person' } });
  const sirkka = people.find((p) => p.name === 'Sirkka Lindholm')!;
  assert.ok(sirkka.accessScope.groups?.includes('slack-channel:C0PRIVATE1'), 'member got the channel membership');
  assert.ok(!people.some((p) => p.name === 'kt-bot'), 'the bot is not a person');
  store.close();
});

test('a channel id is read through conversations.info without listing channels; a public channel is org-wide', async () => {
  const { client, calls } = fakeSlack();
  const r = await pullChannelReadOnly(client, { workspace: 'Kalevanet Sandbox', channel: 'C0PUBLIC01' });
  assert.ok(!calls.some((c) => c.method === 'conversations.list'));
  assert.equal(r.channel.is_private, false);
  const store = openStore(':memory:');
  importFromPath(store, { format: 'slack-live', payload: r.data, orgId: 'org:test' });
  for (const e of store.list('evidence')) assert.deepEqual(e.accessScope, { visibility: 'org' });
  assert.equal(store.list('evidence')[0]!.connectionId, 'slack-live');
  store.close();
});

test('the web client only knows read methods, sends the token as a header, and surfaces Slack errors without it', async () => {
  const seen: Array<{ url: string; auth: string }> = [];
  const fetchImpl = async (url: string, init: { headers: Record<string, string> }) => {
    seen.push({ url, auth: init.headers.Authorization ?? '' });
    return { json: async () => (url.includes('auth.test') ? { ok: true, team: 'T', team_id: 'T1' } : { ok: false, error: 'missing_scope' }) };
  };
  const c = slackWebClient(TOKEN, fetchImpl as never);
  await c.call('auth.test');
  assert.equal(seen[0]!.url, 'https://slack.com/api/auth.test');
  assert.equal(seen[0]!.auth, `Bearer ${TOKEN}`);
  await assert.rejects(() => c.call('conversations.history', { channel: 'C1', limit: '5' }), (e: unknown) => e instanceof SlackApiError && e.code === 'missing_scope' && !e.message.includes(TOKEN));
  await assert.rejects(() => c.call('chat.postMessage' as SlackReadMethod, { channel: 'C1', text: 'hi' }), /not on the read-only allowlist/);
  assert.equal(seen.length, 2, 'the refused write never reached the network');
  assert.throws(() => slackWebClient(''), /token is required/);
});
