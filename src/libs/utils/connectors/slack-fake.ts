/**
 * B4 D2: an in-memory Slack workspace for the poller's tests and for `pnpm demo:slack-poll --fake` (rehearsal with no
 * token and no network). It answers the read allowlist and the DM allowlist exactly like the Web API shapes the
 * poller reads, records every call, and lets a script "type" into the channel and "react" to a DM.
 */
import type { SlackReadClient, SlackReadMethod } from './slack-live-pull.ts';
import type { SlackDmClient, SlackDmMethod } from './slack-poller.ts';
import type { SlackMessage, SlackUser } from './slack-map.ts';

export interface FakeSlackOptions {
  team: { id: string; name: string };
  channel: { id: string; name: string; is_private?: boolean };
  users: SlackUser[];
  botUserId?: string;
  /** First message timestamp (epoch seconds); each typed message adds one second. */
  startTs?: number;
}

export interface FakeDm { channel: string; ts: string; user: string; text: string; reactions: Array<{ name: string; users: string[] }> }

export function createFakeSlack(o: FakeSlackOptions) {
  const calls: Array<{ side: 'read' | 'dm'; method: string; params: Record<string, string> }> = [];
  const messages: SlackMessage[] = [];
  const dms: FakeDm[] = [];
  let clock = o.startTs ?? 1794043800; // 2026-11-07T08:10:00Z
  const nextTs = () => `${clock++}.000100`;
  const bot = o.botUserId ?? 'UBOT';

  const read: SlackReadClient = {
    async call(method: SlackReadMethod, params: Record<string, string> = {}) {
      calls.push({ side: 'read', method, params });
      switch (method) {
        case 'auth.test': return { ok: true, team: o.team.name, team_id: o.team.id, user_id: bot };
        case 'conversations.list': return { ok: true, channels: [o.channel], response_metadata: { next_cursor: '' } };
        case 'conversations.info': return { ok: true, channel: o.channel };
        case 'conversations.members': return { ok: true, members: o.users.map((u) => u.id) };
        case 'users.list': return { ok: true, members: [...o.users, { id: bot, name: 'lumi-bot', is_bot: true }] };
        case 'conversations.history': {
          const limit = Math.max(1, Number(params.limit ?? 50));
          return { ok: true, messages: messages.slice(-limit).reverse() };
        }
        default: throw new Error(`fake slack: unexpected read method ${String(method)}`);
      }
    },
  };

  const dm: SlackDmClient = {
    async call(method: SlackDmMethod, params: Record<string, string>) {
      calls.push({ side: 'dm', method, params });
      if (method === 'chat.postMessage') {
        const user = params.channel!;
        if (!o.users.some((u) => u.id === user)) return Promise.reject(new Error('fake slack: channel_not_found'));
        const d: FakeDm = { channel: `D${user.slice(1)}`, ts: nextTs(), user, text: params.text ?? '', reactions: [] };
        dms.push(d);
        return { ok: true, channel: d.channel, ts: d.ts, message: { text: d.text } };
      }
      if (method === 'reactions.get') {
        const d = dms.find((x) => x.channel === params.channel && x.ts === params.timestamp);
        if (!d) throw new Error('fake slack: message_not_found');
        return { ok: true, type: 'message', channel: d.channel, message: { ts: d.ts, text: d.text, reactions: d.reactions.map((r) => ({ ...r, count: r.users.length })) } };
      }
      throw new Error(`fake slack: unexpected DM method ${String(method)}`);
    },
  };

  return {
    read, dm, calls, messages, dms,
    /** A person types a message in the channel. */
    type(user: string, text: string): SlackMessage {
      const m: SlackMessage = { ts: nextTs(), user, text, type: 'message' };
      messages.push(m);
      return m;
    },
    /** `user` reacts with `name` ('+1', '-1', 'shrug', '+1::skin-tone-3' …) on the DM that carries `questionText` (or the last DM). */
    react(user: string, name: string, dmMatch?: (d: FakeDm) => boolean): FakeDm {
      const d = dmMatch ? dms.find(dmMatch) : dms.at(-1);
      if (!d) throw new Error('fake slack: no such DM');
      const r = d.reactions.find((x) => x.name === name);
      if (r) { if (!r.users.includes(user)) r.users.push(user); } else d.reactions.push({ name, users: [user] });
      return d;
    },
    /** Remove a reaction (a person changes their mind). */
    unreact(user: string, name: string, d: FakeDm): void {
      const r = d.reactions.find((x) => x.name === name);
      if (r) r.users = r.users.filter((u) => u !== user);
      d.reactions = d.reactions.filter((x) => x.users.length);
    },
  };
}

export type FakeSlack = ReturnType<typeof createFakeSlack>;
