/**
 * desktop (R34): attention rules for questions while Snowbally is away. Pure apart from the
 * injected clock and storage; nothing leaves the machine.
 *
 * Per question id it remembers when the id was first waiting, when its question view was first
 * opened (`seen`), when he arrived with it (`announced`), when he reminded about it (`reminded`)
 * and until when `Later` snoozed it (`snoozedUntil`). Rules:
 *   - at most one arrival per id (only ids that are unseen, never announced and not snoozed);
 *   - at most one reminder per id (a single peek on unlock / resume after >= REMIND_AFTER_AWAY_MS
 *     away), only for ids that were already announced or seen, are still open and not snoozed;
 *   - `Later` snoozes the id for LATER_SNOOZE_MS.
 * Local counters for the lab's engagement axes: time from waiting to first open, answered /
 * deferred / dismissed, arrivals, reminders and arrivals ignored. Everything is persisted under
 * `kt-engagement.v1` through the panel's `storage` option (null = memory only).
 */

export const ATTENTION = {
  /** A reminder needs the person to have been away (locked / asleep) at least this long. */
  REMIND_AFTER_AWAY_MS: 20 * 60 * 1000,
  /** `Later` snoozes the question this long (the service's default cooldown, 30 min). */
  LATER_SNOOZE_MS: 30 * 60 * 1000,
  /** Bound on remembered ids (oldest dropped first). */
  MAX_IDS: 200,
  /** Bound on remembered open delays. */
  MAX_DELAYS: 50,
} as const;

export const ENGAGEMENT_KEY = 'kt-engagement.v1';

export interface QuestionMark {
  /** First time the id was observed waiting (epoch ms). */
  waitingSince: number;
  seen?: number;
  announced?: number;
  reminded?: number;
  snoozedUntil?: number;
}

export interface EngagementCounters {
  /** Per question: ms from first waiting to the first open of its question view (most recent last). */
  openDelaysMs: number[];
  answered: number;
  deferred: number;
  dismissed: number;
  arrivals: number;
  reminders: number;
  arrivalsIgnored: number;
}

export type Outcome = 'answered' | 'deferred' | 'dismissed';

export interface Attention {
  /** Record ids that are currently open (first-waiting time for new ones). */
  observe(ids: readonly string[]): void;
  /** Open ids nobody has looked at yet (not seen, not snoozed), in queue order. */
  unseen(ids: readonly string[]): string[];
  hasUnseen(ids: readonly string[]): boolean;
  /** The id he may arrive with now, or null. */
  nextArrival(ids: readonly string[]): string | null;
  /** The id he may remind about now (the caller checks the time away), or null. */
  nextReminder(ids: readonly string[]): string | null;
  markSeen(id: string): void;
  markAnnounced(id: string): void;
  markReminded(id: string): void;
  /** He waited at the perch and nobody came. */
  ignored(id: string): void;
  record(outcome: Outcome, id: string): void;
  snoozed(id: string): boolean;
  get(id: string): Readonly<QuestionMark> | undefined;
  counters(): EngagementCounters & { medianOpenDelayMs: number | null };
}

export interface AttentionOptions {
  now?: () => number;
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
}

interface Stored {
  version: 1;
  questions: Record<string, QuestionMark>;
  counters: EngagementCounters;
}

const emptyCounters = (): EngagementCounters => ({ openDelaysMs: [], answered: 0, deferred: 0, dismissed: 0, arrivals: 0, reminders: 0, arrivalsIgnored: 0 });
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function load(storage: AttentionOptions['storage']): Stored {
  const fresh: Stored = { version: 1, questions: {}, counters: emptyCounters() };
  try {
    const raw = JSON.parse(storage?.getItem(ENGAGEMENT_KEY) ?? 'null') as Partial<Stored> | null;
    if (!raw || raw.version !== 1) return fresh;
    const questions: Record<string, QuestionMark> = {};
    for (const [id, m] of Object.entries(raw.questions ?? {})) {
      const w = num(m?.waitingSince);
      if (w === undefined) continue;
      const mark: QuestionMark = { waitingSince: w };
      for (const k of ['seen', 'announced', 'reminded', 'snoozedUntil'] as const) {
        const v = num(m[k]);
        if (v !== undefined) mark[k] = v;
      }
      questions[id] = mark;
    }
    const c = raw.counters ?? emptyCounters();
    const counters = emptyCounters();
    for (const k of ['answered', 'deferred', 'dismissed', 'arrivals', 'reminders', 'arrivalsIgnored'] as const) counters[k] = num(c[k]) ?? 0;
    counters.openDelaysMs = Array.isArray(c.openDelaysMs) ? c.openDelaysMs.filter((v): v is number => num(v) !== undefined).slice(-ATTENTION.MAX_DELAYS) : [];
    return { version: 1, questions, counters };
  } catch {
    return fresh;
  }
}

export function createAttention(options: AttentionOptions = {}): Attention {
  const now = options.now ?? (() => Date.now());
  const storage = options.storage ?? null;
  const data = load(storage);
  const q = data.questions;
  const c = data.counters;

  const save = (): void => {
    try {
      storage?.setItem(ENGAGEMENT_KEY, JSON.stringify(data));
    } catch {
      /* optional */
    }
  };
  const isSnoozed = (m: QuestionMark | undefined): boolean => m?.snoozedUntil !== undefined && m.snoozedUntil > now();
  const ensure = (id: string): QuestionMark => (q[id] ??= { waitingSince: now() });
  /** Forget the oldest marks beyond MAX_IDS, never one of the ids still open (statemachine-prune-reenables-arrival). */
  const prune = (open: ReadonlySet<string>): void => {
    const ids = Object.keys(q).filter((id) => !open.has(id));
    const excess = Object.keys(q).length - ATTENTION.MAX_IDS;
    if (excess <= 0) return;
    ids.sort((a, b) => q[a]!.waitingSince - q[b]!.waitingSince);
    for (const id of ids.slice(0, excess)) delete q[id];
  };

  const has = (v: number | undefined): boolean => v !== undefined;
  const unseen = (ids: readonly string[]): string[] => ids.filter((id) => !has(q[id]?.seen) && !isSnoozed(q[id]));

  return {
    observe(ids) {
      let changed = false;
      for (const id of ids) {
        if (!q[id]) {
          q[id] = { waitingSince: now() };
          changed = true;
        }
      }
      if (changed) {
        prune(new Set(ids));
        save();
      }
    },
    unseen,
    hasUnseen: (ids) => unseen(ids).length > 0,
    nextArrival(ids) {
      return ids.find((id) => !has(q[id]?.seen) && !has(q[id]?.announced) && !isSnoozed(q[id])) ?? null;
    },
    nextReminder(ids) {
      return ids.find((id) => {
        const m = q[id];
        return !!m && (has(m.announced) || has(m.seen)) && !has(m.reminded) && !isSnoozed(m);
      }) ?? null;
    },
    markSeen(id) {
      const m = ensure(id);
      if (has(m.seen)) return;
      m.seen = now();
      c.openDelaysMs.push(Math.max(0, m.seen - m.waitingSince));
      if (c.openDelaysMs.length > ATTENTION.MAX_DELAYS) c.openDelaysMs.splice(0, c.openDelaysMs.length - ATTENTION.MAX_DELAYS);
      save();
    },
    markAnnounced(id) {
      const m = ensure(id);
      if (has(m.announced)) return;
      m.announced = now();
      c.arrivals++;
      save();
    },
    markReminded(id) {
      const m = ensure(id);
      if (has(m.reminded)) return;
      m.reminded = now();
      c.reminders++;
      save();
    },
    ignored(id) {
      ensure(id);
      c.arrivalsIgnored++;
      save();
    },
    record(outcome, id) {
      const m = ensure(id);
      if (outcome === 'answered') c.answered++;
      else if (outcome === 'dismissed') c.dismissed++;
      else {
        c.deferred++;
        m.snoozedUntil = now() + ATTENTION.LATER_SNOOZE_MS;
      }
      save();
    },
    snoozed: (id) => isSnoozed(q[id]),
    get: (id) => (q[id] ? { ...q[id] } : undefined),
    counters() {
      const d = [...c.openDelaysMs].sort((a, b) => a - b);
      const median = d.length ? (d.length % 2 ? d[(d.length - 1) / 2]! : (d[d.length / 2 - 1]! + d[d.length / 2]!) / 2) : null;
      return { ...c, openDelaysMs: [...c.openDelaysMs], medianOpenDelayMs: median };
    },
  };
}
