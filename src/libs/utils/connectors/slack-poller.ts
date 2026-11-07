/**
 * B4 D2: Slack sandbox poller. Every I/O is injected: the read client (slack-live-pull.ts, read-only allowlist), a
 * SEPARATE write client for direct messages (its own two-method allowlist, never part of SLACK_READ_METHODS), the
 * running service (the httpClient of simulation/client.ts) and the tracking store. One poll:
 *  1. reads the sandbox channel and imports it as format 'slack-live' under one stable connection 'slack-live:<teamId>'
 *     (Slack ids are stable, so a second poll inserts nothing);
 *  2. for each mapped Slack user, lists their DELIVERED questions (queued ones wait for quiet hours to end) and sends
 *     each one once as a DM: the question, one line of why, and "React 👍 yes · 👎 no · 🤷 not sure";
 *  3. reads the reactions on every waiting DM, counts only the recipient's own reaction, and answers through
 *     POST /questions/:id/answer with the Slack identity as principal (the service resolves it through the directory's
 *     actorIds and applies the same recipient check, eligibility, undo and attribution as the panel).
 * Nothing here runs unless a script builds it; the service never starts a poller on its own.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { checkLiveGuard, pullChannelReadOnly, SlackApiError, SLACK_READ_SCOPES, type LiveGuardInput, type LiveGuardResult, type SlackReadClient } from './slack-live-pull.ts';

/** The write side's whole allowlist: post the DM, read its reactions. */
export const SLACK_DM_METHODS = ['chat.postMessage', 'reactions.get'] as const;
export type SlackDmMethod = (typeof SLACK_DM_METHODS)[number];
/** Scopes for the poller's app: the read-only pull's scopes plus chat:write and reactions:read (no im:write). */
export const SLACK_POLLER_SCOPES = [...SLACK_READ_SCOPES, 'chat:write', 'reactions:read'] as const;

/**
 * The live poller's guard: the same four conditions as the read-only pull (KT_SLACK_LIVE=1, KT_SLACK_TOKEN,
 * --workspace, --channel), with the poller's own setup steps. Pure; the token value is never part of the result.
 */
export function pollerGuard(i: LiveGuardInput): LiveGuardResult {
  const base = checkLiveGuard(i);
  return {
    ok: base.ok,
    missing: base.missing.map((m) => m.replace('a live, read-only pull', 'the live sandbox poller')),
    instructions: [
      'Create a sandbox Slack workspace (never a production one) and one channel in it for the demo.',
      `Create a Slack app in it with ONLY these bot scopes: ${SLACK_POLLER_SCOPES.join(', ')}. Nothing else (no im:write, no reactions:write).`,
      'Install the app to the sandbox workspace and invite its bot to the demo channel.',
      'Give each demo person a Slack user in the workspace and put that user id (U…) in their people.json actorIds as person:slack:U….',
      'In the terminal you run the demo from: export KT_SLACK_LIVE=1 and export KT_SLACK_TOKEN=<the bot token> (the value is never printed, logged or committed).',
      'Run: pnpm demo:slack-poll --workspace "<team name>" --channel "#<channel>" --people <path to people.json>',
    ],
  };
}

export interface SlackDmClient {
  call(method: SlackDmMethod, params: Record<string, string>): Promise<Record<string, unknown>>;
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ json(): Promise<unknown> }>;

/** Slack Web API client for DMs and reactions only. Any other method throws before any network call. */
export function slackDmClient(token: string, fetchImpl: FetchLike = fetch as unknown as FetchLike): SlackDmClient {
  if (!token) throw new Error('A token is required');
  return {
    async call(method, params) {
      if (!(SLACK_DM_METHODS as readonly string[]).includes(method)) throw new Error(`Slack method ${method} is not on the DM allowlist`);
      const auth = { Authorization: `Bearer ${token}` };
      const res = method === 'chat.postMessage'
        ? await fetchImpl(`https://slack.com/api/${method}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(params) })
        : await fetchImpl(`https://slack.com/api/${method}?${new URLSearchParams(params).toString()}`, { method: 'GET', headers: auth });
      const body = (await res.json()) as Record<string, unknown>;
      if (body.ok !== true) throw new SlackApiError(method, String(body.error ?? 'unknown_error'));
      return body;
    },
  };
}

/** The running service, as simulation/client.ts httpClient gives it. Errors carry `status` (409, 403, 404 …). */
export interface ServiceLike {
  get<T = unknown>(path: string): Promise<T>;
  post<T = unknown>(path: string, body: unknown): Promise<T>;
}

export interface SlackPersonMapping {
  /** Directory person id ('person:directory:…'), entity id, or 'person:slack:U…'; the service resolves any of them. */
  personId: string;
  displayName: string;
}

export interface SlackPollerConfig {
  workspace: string;
  channel: string;
  /** Slack user id (U…) -> person. Only these people are DM'd. */
  slackUserToPerson: Record<string, SlackPersonMapping>;
  /** Pause between polls in run() (default 5000 ms). */
  pollMs?: number;
  /** Channel messages read per poll (default 50, max 200). */
  limit?: number;
}

export type ReactionValue = 'yes' | 'no' | 'unknown';

export interface DmRecord {
  questionId: string;
  slackUserId: string;
  /** DM channel (D…) and message ts returned by chat.postMessage. */
  channel: string;
  ts: string;
  postedAt: string;
  state: 'waiting' | 'answered' | 'closed';
  value?: ReactionValue;
  reason?: string;
}

export interface TrackingStore {
  load(): Record<string, DmRecord>;
  save(records: Record<string, DmRecord>): void;
}

export function memoryTracking(initial: Record<string, DmRecord> = {}): TrackingStore & { records: Record<string, DmRecord> } {
  const t = { records: { ...initial }, load: () => ({ ...t.records }), save: (r: Record<string, DmRecord>) => { t.records = { ...r }; } };
  return t;
}

/** Tracking map in a small JSON file (data/local/…, git-ignored), so a restart never DMs the same question twice. */
export function fileTracking(path: string): TrackingStore {
  return {
    load: () => {
      try {
        return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Record<string, DmRecord>) : {};
      } catch {
        return {};
      }
    },
    save: (records) => {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify(records, null, 2) + '\n');
    },
  };
}

/** Slack reaction name -> answer. Skin tones ('+1::skin-tone-3') are the same reaction. */
export function reactionValue(name: string): ReactionValue | undefined {
  const base = name.replace(/::skin-tone-\d+$/, '');
  if (base === '+1' || base === 'thumbsup') return 'yes';
  if (base === '-1' || base === 'thumbsdown') return 'no';
  if (base === 'shrug' || base === 'man-shrugging' || base === 'woman-shrugging' || base === 'person_shrugging') return 'unknown';
  return undefined;
}

export const DM_FOOTER = 'React 👍 yes · 👎 no · 🤷 not sure';

/** The DM: the question as the recipient sees it, one line of why, how to answer. */
export function dmText(q: { text: string; why?: string }): string {
  const why = (q.why ?? '').split('\n').map((l) => l.trim()).find(Boolean);
  const line = why ? (why.length > 200 ? why.slice(0, 199) + '…' : why) : '';
  return [q.text, ...(line ? [`Why: ${line}`] : []), DM_FOOTER].join('\n');
}

interface QuestionLite { questionId: string; text: string; why?: string; status: string }

export interface PollReport {
  team?: { id: string; name: string };
  imported?: { seen: number; inserted: number; cases: number };
  dmsSent: Array<{ questionId: string; slackUserId: string }>;
  answered: Array<{ questionId: string; slackUserId: string; value: ReactionValue }>;
  closed: Array<{ questionId: string; reason: string }>;
  /** Stage failures in plain words (never a token). The next poll tries again. */
  errors: string[];
}

export interface SlackPollerDeps {
  read: SlackReadClient;
  dm: SlackDmClient;
  service: ServiceLike;
  config: SlackPollerConfig;
  tracking?: TrackingStore;
  now?: () => Date;
}

const ACTIVE = new Set(['queued', 'delivered', 'deferred']);
const statusOf = (e: unknown): number | undefined => (e && typeof e === 'object' && 'status' in e ? Number((e as { status: unknown }).status) : undefined);
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function createSlackPoller(deps: SlackPollerDeps) {
  const tracking = deps.tracking ?? memoryTracking();
  const now = deps.now ?? (() => new Date());
  const { config, service } = deps;
  let records = tracking.load();
  const persist = () => tracking.save(records);

  async function importChannel(report: PollReport): Promise<void> {
    const pull = await pullChannelReadOnly(deps.read, { workspace: config.workspace, channel: config.channel, limit: config.limit ?? 50 });
    report.team = pull.team;
    const res = await service.post<{ batch: { counts: { seen: number; inserted: number } }; cases: number }>('/import', {
      format: 'slack-live', payload: pull.data, connectionId: `slack-live:${pull.team.id}`,
    });
    report.imported = { seen: res.batch.counts.seen, inserted: res.batch.counts.inserted, cases: res.cases };
  }

  async function sendQuestions(report: PollReport): Promise<void> {
    for (const [slackUserId, person] of Object.entries(config.slackUserToPerson)) {
      const list = await service.get<QuestionLite[]>(`/questions?personEntityId=${encodeURIComponent(person.personId)}&status=delivered`);
      for (const q of list) {
        if (q.status !== 'delivered' || records[q.questionId]) continue;
        const res = await deps.dm.call('chat.postMessage', { channel: slackUserId, text: dmText(q) });
        records[q.questionId] = { questionId: q.questionId, slackUserId, channel: String(res.channel ?? slackUserId), ts: String(res.ts ?? ''), postedAt: now().toISOString(), state: 'waiting' };
        persist(); // before the next post: a crash here never sends this question again
        report.dmsSent.push({ questionId: q.questionId, slackUserId });
      }
    }
  }

  const close = (r: DmRecord, reason: string, report: PollReport) => {
    records[r.questionId] = { ...r, state: 'closed', reason };
    report.closed.push({ questionId: r.questionId, reason });
  };

  async function collectReactions(report: PollReport): Promise<void> {
    for (const r of Object.values(records)) {
      if (r.state !== 'waiting') continue;
      const person = config.slackUserToPerson[r.slackUserId];
      let q: QuestionLite;
      try {
        q = await service.get<QuestionLite>(`/questions/${encodeURIComponent(r.questionId)}`);
      } catch (e) {
        if (statusOf(e) === 404) { close(r, 'question no longer exists', report); continue; }
        throw e;
      }
      // Answered in the panel, cancelled as obsolete, dismissed: stop tracking; the DM is left as it is.
      if (!ACTIVE.has(q.status)) { close(r, `question is ${q.status}`, report); continue; }
      const got = await deps.dm.call('reactions.get', { channel: r.channel, timestamp: r.ts, full: 'true' });
      const reactions = ((got.message as { reactions?: Array<{ name: string; users?: string[] }> } | undefined)?.reactions) ?? [];
      // Only the recipient's own reactions count; a colleague's or the bot's never answer for them.
      const values = new Set(reactions.filter((x) => (x.users ?? []).includes(r.slackUserId)).map((x) => reactionValue(x.name)).filter((v): v is ReactionValue => !!v));
      if (values.size !== 1) continue; // none yet, or 👍 and 👎 at once: wait for one
      const value = [...values][0]!;
      const principal = { id: `person:slack:${r.slackUserId}`, displayName: person?.displayName ?? r.slackUserId, groups: [] as string[], type: 'human' as const };
      try {
        await service.post(`/questions/${encodeURIComponent(r.questionId)}/answer`, { principal, value });
      } catch (e) {
        const s = statusOf(e);
        if (s === 409 || s === 403 || s === 404) { close(r, `answer refused (${s}): ${msg(e)}`, report); continue; }
        throw e;
      }
      // A later flip of the reaction is ignored: tracking stops here (undo stays in the panel).
      records[r.questionId] = { ...r, state: 'answered', value };
      report.answered.push({ questionId: r.questionId, slackUserId: r.slackUserId, value });
    }
  }

  async function pollOnce(): Promise<PollReport> {
    records = tracking.load();
    const report: PollReport = { dmsSent: [], answered: [], closed: [], errors: [] };
    for (const [stage, run] of [['read channel', importChannel], ['send questions', sendQuestions], ['read reactions', collectReactions]] as const) {
      try {
        await run(report);
      } catch (e) {
        report.errors.push(`${stage}: ${msg(e)}`);
      }
      persist();
    }
    return report;
  }

  /** Poll until the signal aborts; each report goes to onReport. */
  async function run(opts: { signal?: AbortSignal; onReport?: (r: PollReport) => void } = {}): Promise<void> {
    while (!opts.signal?.aborted) {
      opts.onReport?.(await pollOnce());
      await new Promise<void>((resolve) => {
        const t = setTimeout(resolve, config.pollMs ?? 5000);
        opts.signal?.addEventListener('abort', () => { clearTimeout(t); resolve(); }, { once: true });
      });
    }
  }

  return { pollOnce, run, tracked: () => ({ ...records }) };
}

export type SlackPoller = ReturnType<typeof createSlackPoller>;
