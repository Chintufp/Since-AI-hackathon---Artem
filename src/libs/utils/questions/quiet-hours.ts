/**
 * B1: quiet hours. Local wall-clock hours (in an IANA time zone) in which no question is delivered; a question created
 * inside them waits for the next window. Local time comes from Intl.DateTimeFormat parts; everything else is UTC math,
 * so daylight-saving changes are handled by the time-zone data, not by fixed offsets.
 */
import type { QuietHours } from '../contracts/index.ts';

const minutesOf = (hhmm: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  if (!m) throw new RangeError(`Invalid quiet-hours time ${hhmm} (HH:MM)`);
  return Number(m[1]) * 60 + Number(m[2]);
};

interface LocalParts { y: number; mo: number; d: number; h: number; mi: number }

function localParts(at: Date, timeZone: string): LocalParts {
  const f = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const p = Object.fromEntries(f.formatToParts(at).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  return { y: p.year as number, mo: (p.month as number) - 1, d: p.day as number, h: (p.hour as number) % 24, mi: p.minute as number };
}

/** Offset (ms) of `timeZone` from UTC at the instant `ms`. */
function offsetAt(ms: number, timeZone: string): number {
  const l = localParts(new Date(ms), timeZone);
  return Date.UTC(l.y, l.mo, l.d, l.h, l.mi) - Math.floor(ms / 60_000) * 60_000;
}

/** The UTC instant of a local wall-clock time (y, mo, d, minutes) in `timeZone`. */
function instantOfLocal(y: number, mo: number, d: number, minutes: number, timeZone: string): number {
  const naive = Date.UTC(y, mo, d, 0, minutes);
  let t = naive - offsetAt(naive, timeZone);
  t = naive - offsetAt(t, timeZone);
  return t;
}

/** Is `now` inside the quiet hours? Equal start and end mean no quiet hours. */
export function inQuiet(now: Date, qh: QuietHours): boolean {
  const s = minutesOf(qh.start);
  const e = minutesOf(qh.end);
  if (s === e) return false;
  const l = localParts(now, qh.timeZone);
  const t = l.h * 60 + l.mi;
  return s < e ? t >= s && t < e : t >= s || t < e;
}

/** The next moment quiet hours end (the next delivery window), at or after `now`; `now` itself outside quiet hours. */
export function nextWindow(now: Date, qh: QuietHours): Date {
  if (!inQuiet(now, qh)) return now;
  const s = minutesOf(qh.start);
  const e = minutesOf(qh.end);
  const l = localParts(now, qh.timeZone);
  const t = l.h * 60 + l.mi;
  // Across midnight and still before midnight: the window opens tomorrow (local date).
  const addDay = s > e && t >= s ? 1 : 0;
  const day = new Date(Date.UTC(l.y, l.mo, l.d + addDay));
  return new Date(instantOfLocal(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), e, qh.timeZone));
}

/** "07:00" for a loop line. */
export const windowLabel = (qh: QuietHours): string => qh.end;
