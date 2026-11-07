import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { EvidenceEnvelope } from '../contracts/index.ts';
import { mapSlackMessage, usersById, type SlackChannel, type SlackMessage, type SlackUser } from './slack-map.ts';
import type { AdapterOptions } from './types.ts';

export interface SlackExportData {
  users: SlackUser[];
  channels: SlackChannel[];
  /** One entry per <channel>/<YYYY-MM-DD>.json file. */
  days: Array<{ channel: string; date: string; messages: SlackMessage[] }>;
}

export const SLACK_EXPORT_CONNECTION_ID = 'import:slack:export';

/** Read the standard Slack export layout from a directory (users.json, channels.json, <channel>/<date>.json). */
export function readSlackExportDir(dir: string): SlackExportData {
  const readJson = <T>(f: string, fallback: T): T => (existsSync(f) ? (JSON.parse(readFileSync(f, 'utf8')) as T) : fallback);
  const users = readJson<SlackUser[]>(join(dir, 'users.json'), []);
  const channels = readJson<SlackChannel[]>(join(dir, 'channels.json'), []).concat(
    readJson<SlackChannel[]>(join(dir, 'groups.json'), []).map((c) => ({ ...c, is_private: true })),
  );
  const days: SlackExportData['days'] = [];
  for (const c of channels) {
    const cdir = join(dir, c.name);
    if (!existsSync(cdir) || !statSync(cdir).isDirectory()) continue;
    for (const f of readdirSync(cdir).filter((x) => /^\d{4}-\d{2}-\d{2}\.json$/.test(x)).sort()) {
      days.push({ channel: c.name, date: f.slice(0, 10), messages: JSON.parse(readFileSync(join(cdir, f), 'utf8')) as SlackMessage[] });
    }
  }
  return { users, channels, days };
}

/** Standard Slack export -> envelopes. threadId = "<channelId>:<thread_ts>", revision = edited.ts || '1'. */
export function parseSlackExport(data: SlackExportData, opts: AdapterOptions): EvidenceEnvelope[] {
  const users = usersById(data.users);
  const byName = new Map(data.channels.map((c) => [c.name, c]));
  const out: EvidenceEnvelope[] = [];
  const connectionId = opts.connectionId ?? SLACK_EXPORT_CONNECTION_ID;
  for (const day of data.days) {
    const channel = byName.get(day.channel) ?? { id: day.channel, name: day.channel };
    for (const m of day.messages) {
      const e = mapSlackMessage(m, { ...opts, connectionId, channel, users, reference: `${opts.reference ?? 'slack-export'}/${day.channel}/${day.date}.json#${m.ts}` });
      if (e) out.push(e);
    }
  }
  return out;
}
