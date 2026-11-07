import type { EvidenceEnvelope } from '../contracts/index.ts';
import { textFingerprint } from '../contracts/index.ts';
import { parseTimeRef } from './time.ts';
import { makeEnvelope, normName, resolveAccess, type AdapterOptions } from './types.ts';

export interface TeamsExport {
  channel?: string;
  note?: string;
  participants?: Array<{ name: string; role?: string }>;
  messages: Array<{ seq?: number; time?: string; author: string; role?: string; text: string }>;
}

export const TEAMS_CONNECTION_ID = 'import:teams:file';

/**
 * Elisa-style Teams export. Time-only stamps stay partial (known:false) with their sequence number;
 * a missing date is never replaced by "now".
 */
export function parseTeamsJson(payload: unknown, opts: AdapterOptions): EvidenceEnvelope[] {
  const data = payload as TeamsExport;
  if (!data || !Array.isArray(data.messages)) throw new Error('teams-json: expected {messages: [...]}');
  const connectionId = opts.connectionId ?? TEAMS_CONNECTION_ID;
  const channel = data.channel ?? 'teams';
  const roles = new Map<string, string>();
  for (const p of data.participants ?? []) if (p.role) roles.set(normName(p.name), p.role);
  // Conversation key is derived from the first message so two different exports of channel "teams" never collide.
  const convKey = textFingerprint(data.messages.slice(0, 1).map((m) => `${m.author}|${m.text}`).join('||')).slice(0, 12);
  const threadId = `teams:${channel}:${convKey}`;
  return data.messages.map((m, idx) => {
    const seq = m.seq ?? idx + 1;
    const role = m.role ?? roles.get(normName(m.author));
    return makeEnvelope({
      orgId: opts.orgId,
      provider: 'teams',
      connectionId,
      sourceId: `${channel}:${convKey}#${seq}`,
      kind: 'message',
      text: m.text,
      reference: opts.reference ? `${opts.reference}#seq=${seq}` : undefined,
      author: { id: `person:teams:${normName(m.author)}`, displayName: m.author, ...(role ? { role } : {}), provider: 'teams' },
      eventTime: parseTimeRef(m.time, seq),
      ingestedAt: opts.ingestedAt,
      batchId: opts.batchId,
      thread: { threadId, channel, position: seq },
      accessScope: resolveAccess(opts.accessGroups),
    });
  });
}
