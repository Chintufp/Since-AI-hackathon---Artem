/**
 * Simulated clock for the activity stream. Simulated time moves in explicit steps (`advanceTo`); each step waits the
 * corresponding real time (`hourSeconds` real seconds per simulated hour; 0 = instant, for tests and dry runs).
 */
export interface SimClock {
  /** Simulated start (ms since epoch). */
  readonly startMs: number;
  /** Real seconds per simulated hour (0 = instant). */
  readonly hourSeconds: number;
  /** Simulated seconds per real second (1 when instant). */
  readonly rate: number;
  /** Current simulated time. */
  now(): Date;
  /** Simulated minutes since the start. */
  minutes(): number;
  /** Move simulated time forward to `ms` (never backwards), waiting the real equivalent. */
  advanceTo(ms: number): Promise<void>;
}

export function createSimClock(start: string | Date, hourSeconds: number, sleep: (ms: number) => Promise<void> = (ms) => new Promise((r) => setTimeout(r, ms))): SimClock {
  const startMs = typeof start === 'string' ? Date.parse(start) : start.getTime();
  if (!Number.isFinite(startMs)) throw new RangeError(`Invalid simulated start ${String(start)}`);
  if (!(hourSeconds >= 0)) throw new RangeError(`Invalid hourSeconds ${hourSeconds}`);
  let cursor = startMs;
  const rate = hourSeconds > 0 ? 3600 / hourSeconds : 1;
  return {
    startMs,
    hourSeconds,
    rate,
    now: () => new Date(cursor),
    minutes: () => (cursor - startMs) / 60_000,
    async advanceTo(ms) {
      if (ms <= cursor) return;
      if (hourSeconds > 0) await sleep(((ms - cursor) / 3_600_000) * hourSeconds * 1000);
      cursor = ms;
    },
  };
}

/** "Today at HH:MM local" as an ISO string, so a stream run on the judge's machine reads as today's day. */
export function todayAt(hour: number, minute = 0, base: Date = new Date()): string {
  const d = new Date(base);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

/** HH:MM in local time for the log. */
export function hhmm(ms: number | string | Date): string {
  const d = typeof ms === 'number' ? new Date(ms) : typeof ms === 'string' ? new Date(ms) : ms;
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
