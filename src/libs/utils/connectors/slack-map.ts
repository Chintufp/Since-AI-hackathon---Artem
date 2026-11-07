import type { AttachmentRef, EvidenceEnvelope } from '../contracts/index.ts';
import { timeFromEpochSeconds } from './time.ts';
import { makeEnvelope, resolveAccess, type AdapterOptions } from './types.ts';

/** Minimal shapes of Slack payloads (export files and Web API responses share them). */
export interface SlackUser { id: string; name?: string; real_name?: string; profile?: { real_name?: string; display_name?: string }; is_bot?: boolean }
export interface SlackChannel { id: string; name: string; is_private?: boolean; is_group?: boolean; is_im?: boolean; is_mpim?: boolean }
export interface SlackFile { id: string; name?: string; title?: string; mimetype?: string; size?: number; url_private?: string }
export interface SlackMessage {
  ts: string; user?: string; bot_id?: string; username?: string; text?: string; thread_ts?: string; reply_count?: number;
  edited?: { user?: string; ts: string }; subtype?: string; files?: SlackFile[]; type?: string;
}

export interface SlackMapContext extends AdapterOptions {
  channel: SlackChannel;
  users: Record<string, SlackUser>;
  /** Workspace id used in the connection id when none is given, e.g. "T0123". */
  workspaceId?: string;
}

/** Subtypes that carry no knowledge (membership noise). */
const SKIP_SUBTYPES = new Set(['channel_join', 'channel_leave', 'channel_topic', 'channel_purpose', 'channel_name', 'group_join', 'group_leave', 'pinned_item']);

export const isPrivateChannel = (c: SlackChannel): boolean => !!(c.is_private || c.is_group || c.is_im || c.is_mpim);

export function userName(u: SlackUser | undefined, id: string): string {
  return u?.profile?.real_name || u?.real_name || u?.profile?.display_name || u?.name || id;
}

/** Resolve Slack markup (<@U1>, <#C1|name>, <http://x|label>, entities) to readable text. */
export function cleanSlackText(text: string, users: Record<string, SlackUser>): string {
  return text
    .replace(/<@([UW][A-Z0-9]+)(?:\|[^>]*)?>/g, (_m, id: string) => `@${userName(users[id], id)}`)
    .replace(/<#[A-Z0-9]+\|([^>]+)>/g, '#$1')
    .replace(/<(?:https?|mailto):[^|>]+\|([^>]+)>/g, '$1')
    .replace(/<((?:https?|mailto):[^>]+)>/g, '$1')
    .replace(/<!(here|channel|everyone)(?:\|[^>]*)?>/g, '@$1')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
}

/** Map one Slack message to an envelope; returns undefined for membership noise or empty messages. */
export function mapSlackMessage(m: SlackMessage, ctx: SlackMapContext): EvidenceEnvelope | undefined {
  if (m.subtype && SKIP_SUBTYPES.has(m.subtype)) return undefined;
  const text = cleanSlackText(m.text ?? '', ctx.users);
  const files = m.files ?? [];
  if (!text.trim() && !files.length) return undefined;
  const workspace = ctx.workspaceId ?? 'export';
  const connectionId = ctx.connectionId ?? `slack:${workspace}`;
  const authorId = m.user ?? m.bot_id ?? 'unknown';
  const u = m.user ? ctx.users[m.user] : undefined;
  const display = m.user ? userName(u, m.user) : m.username ?? m.bot_id ?? 'unknown';
  const priv = isPrivateChannel(ctx.channel);
  const attachments: AttachmentRef[] = files.map((f) => ({
    id: f.id, name: f.name ?? f.title ?? f.id, mimeType: f.mimetype, reference: f.url_private, sizeBytes: f.size,
  }));
  const threadTs = m.thread_ts;
  return makeEnvelope({
    orgId: ctx.orgId,
    provider: 'slack',
    connectionId,
    sourceId: `${ctx.channel.id}:${m.ts}`,
    revision: m.edited?.ts ?? '1',
    kind: 'message',
    text,
    reference: ctx.reference ?? `slack://channel/${ctx.channel.id}/p${m.ts.replace('.', '')}`,
    author: { id: `person:slack:${authorId}`, displayName: display, provider: 'slack', ...(u?.is_bot || m.bot_id ? { role: 'bot' } : {}) },
    // Slack exports do not list recipients: leave them unknown rather than guessing channel members.
    eventTime: timeFromEpochSeconds(m.ts, Number(m.ts)),
    ingestedAt: ctx.ingestedAt,
    batchId: ctx.batchId,
    thread: {
      ...(threadTs ? { threadId: `${ctx.channel.id}:${threadTs}`, parentId: threadTs !== m.ts ? `${ctx.channel.id}:${threadTs}` : undefined } : {}),
      channel: ctx.channel.name,
    },
    accessScope: priv
      ? resolveAccess(ctx.accessGroups?.length ? ctx.accessGroups : [`slack-channel:${ctx.channel.id}`], { visibility: 'group' })
      : resolveAccess(ctx.accessGroups),
    attachments,
    metadata: {
      slackTs: m.ts,
      ...(m.reply_count !== undefined ? { replyCount: m.reply_count } : {}),
      ...(m.subtype ? { subtype: m.subtype } : {}),
      ...(m.edited ? { edited: true, editedAt: m.edited.ts } : {}),
    },
  });
}

export function usersById(users: SlackUser[]): Record<string, SlackUser> {
  return Object.fromEntries(users.map((u) => [u.id, u]));
}
