/**
 * Read-only live pull of ONE Slack channel for the demo, behind explicit guard rails:
 *  - runs only with KT_SLACK_LIVE=1 and a KT_SLACK_TOKEN set by the operator at run time (never read from anywhere else,
 *    never printed, never stored);
 *  - one `auth.test`; the returned team name must equal the `--workspace` the operator named, else nothing else is read;
 *  - only read methods exist on the client (an allowlist); the named channel's info, member list and last N messages,
 *    plus `users.list` for display names. No write scope, no post, no reaction, no other channel's history.
 * The pulled channel becomes a `SlackExportData` payload mapped by the same code as a Slack export (private channel =
 * members only through membership grants), imported with format `slack-live`.
 */
import type { SlackExportData } from './slack-export.ts';
import { slackNetworkFetch } from './slack-net.ts';
import type { SlackChannel, SlackMessage, SlackUser } from './slack-map.ts';

export const SLACK_READ_METHODS = ['auth.test', 'conversations.list', 'conversations.info', 'conversations.members', 'conversations.history', 'users.list'] as const;
export type SlackReadMethod = (typeof SLACK_READ_METHODS)[number];
/** The only scopes the demo app needs; all read-only. */
export const SLACK_READ_SCOPES = ['channels:read', 'channels:history', 'groups:read', 'groups:history', 'users:read'] as const;

export interface SlackReadClient {
  call(method: SlackReadMethod, params?: Record<string, string>): Promise<Record<string, unknown>>;
}

export class SlackApiError extends Error {
  readonly method: string;
  readonly code: string;
  constructor(method: string, code: string) {
    super(`Slack ${method} failed: ${code}`);
    this.method = method;
    this.code = code;
  }
}

export class WorkspaceMismatchError extends Error {
  readonly expected: string;
  readonly actual: string;
  constructor(expected: string, actual: string) {
    super(`Workspace mismatch: you named "${expected}" but the token belongs to "${actual}"; nothing was read.`);
    this.expected = expected;
    this.actual = actual;
  }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string> }) => Promise<{ json(): Promise<unknown> }>;

/** Slack Web API client restricted to the read allowlist. Any other method name throws before any network call. */
export function slackWebClient(token: string, fetchImpl: FetchLike = slackNetworkFetch<FetchLike>()): SlackReadClient {
  if (!token) throw new Error('A token is required');
  return {
    async call(method, params = {}) {
      if (!(SLACK_READ_METHODS as readonly string[]).includes(method)) throw new Error(`Slack method ${method} is not on the read-only allowlist`);
      const q = new URLSearchParams(params).toString();
      const res = await fetchImpl(`https://slack.com/api/${method}${q ? `?${q}` : ''}`, { method: 'GET', headers: { Authorization: `Bearer ${token}` } });
      const body = (await res.json()) as Record<string, unknown>;
      if (body.ok !== true) throw new SlackApiError(method, String(body.error ?? 'unknown_error'));
      return body;
    },
  };
}

export interface LiveGuardInput {
  live?: string | undefined;
  token?: string | undefined;
  workspace?: string | undefined;
  channel?: string | undefined;
}

export interface LiveGuardResult {
  ok: boolean;
  /** What is missing, in the operator's words (never a value). */
  missing: string[];
  /** What the operator must create or set, printed when refused. */
  instructions: string[];
}

/** Pure check of the guard rails. The token value is never part of the result. */
export function checkLiveGuard(i: LiveGuardInput): LiveGuardResult {
  const missing: string[] = [];
  if (i.live !== '1') missing.push('KT_SLACK_LIVE=1 (explicit opt-in for a live, read-only pull)');
  if (!i.token || !i.token.trim()) missing.push('KT_SLACK_TOKEN (the sandbox app\'s bot token, exported in this shell at demo time)');
  if (!i.workspace || !i.workspace.trim()) missing.push('--workspace <exact team name of the sandbox workspace>');
  if (!i.channel || !i.channel.trim()) missing.push('--channel <#channel name or C… id in that workspace>');
  const instructions = [
    'Create a sandbox Slack workspace (never a production one).',
    `Create a Slack app in it with ONLY these bot scopes: ${SLACK_READ_SCOPES.join(', ')} (no chat:write, no reactions:write, nothing else).`,
    'Install the app to the sandbox workspace and invite its bot to the one channel to demonstrate.',
    'In the terminal you run the demo from: export KT_SLACK_LIVE=1 and export KT_SLACK_TOKEN=<the bot token> (the value is never printed, logged or committed).',
    'Run: pnpm demo:slack --live --workspace "<team name>" --channel "#<channel>"',
  ];
  return { ok: missing.length === 0, missing, instructions };
}

export interface PullOptions {
  workspace: string;
  /** "#name", "name" or a channel id (C…/G…). */
  channel: string;
  /** Messages to read (default 50, max 200). */
  limit?: number;
}

export interface PullResult {
  team: { id: string; name: string };
  channel: SlackChannel;
  users: SlackUser[];
  messages: SlackMessage[];
  /** Export-shaped payload for the import pipeline (format `slack-live`). */
  data: SlackExportData;
  /** Methods called, in order (for the log and the tests). */
  calls: SlackReadMethod[];
}

const isChannelId = (s: string): boolean => /^[CGD][A-Z0-9]{6,}$/.test(s);

/** Read one channel. Throws WorkspaceMismatchError before reading anything when the team name is not the one named. */
export async function pullChannelReadOnly(client: SlackReadClient, opts: PullOptions): Promise<PullResult> {
  const calls: SlackReadMethod[] = [];
  const call = async (m: SlackReadMethod, p?: Record<string, string>) => { calls.push(m); return client.call(m, p); };
  const auth = await call('auth.test');
  const team = { id: String(auth.team_id ?? ''), name: String(auth.team ?? '') };
  const want = opts.workspace.trim().toLowerCase();
  if (team.name.trim().toLowerCase() !== want) throw new WorkspaceMismatchError(opts.workspace, team.name);

  const wanted = opts.channel.trim().replace(/^#/, '');
  let channel: SlackChannel | undefined;
  if (isChannelId(wanted)) {
    const info = (await call('conversations.info', { channel: wanted })).channel as SlackChannel | undefined;
    if (info) channel = info;
  } else {
    let cursor = '';
    for (let page = 0; page < 10 && !channel; page++) {
      const r = await call('conversations.list', { types: 'public_channel,private_channel', exclude_archived: 'true', limit: '200', ...(cursor ? { cursor } : {}) });
      const list = (r.channels as SlackChannel[] | undefined) ?? [];
      channel = list.find((c) => c.name === wanted);
      cursor = String((r.response_metadata as { next_cursor?: string } | undefined)?.next_cursor ?? '');
      if (!cursor) break;
    }
  }
  if (!channel) throw new Error(`Channel "${opts.channel}" was not found in workspace "${team.name}" (is the app's bot invited to it?)`);

  const members = ((await call('conversations.members', { channel: channel.id, limit: '200' })).members as string[] | undefined) ?? [];
  const users = ((await call('users.list', { limit: '200' })).members as SlackUser[] | undefined) ?? [];
  const limit = String(Math.min(200, Math.max(1, Math.floor(opts.limit ?? 50))));
  const messages = (((await call('conversations.history', { channel: channel.id, limit })).messages as SlackMessage[] | undefined) ?? [])
    .slice()
    .sort((a, b) => Number(a.ts) - Number(b.ts));
  const full: SlackChannel = { id: channel.id, name: channel.name, is_private: !!(channel.is_private || channel.is_group), members };
  const date = messages.length ? new Date(Number(messages[0]!.ts) * 1000).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
  const data: SlackExportData = { users, channels: [full], days: [{ channel: full.name, date, messages }] };
  return { team, channel: full, users, messages, data, calls };
}
