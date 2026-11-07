import type { Iso, TimeRef } from '../contracts/index.ts';

/**
 * Parse a source timestamp without ever inventing information.
 * - clock time only ("09:14", "9.14")-> known:false, partial:'time-only', raw kept
 * - date only ("2026-03-02")   -> known:false, partial:'date-only'
 * - ISO 8601 / RFC 2822 date+time that states a zone -> known:true, iso
 * - zoneless or ambiguous (slash dates) -> known:false, raw kept (never guessed)
 * - anything else / missing    -> known:false (raw kept when present)
 */
export function parseTimeRef(raw: string | undefined | null, sequence?: number): TimeRef {
  const base: TimeRef = { known: false };
  if (raw !== undefined && raw !== null && String(raw).trim() !== '') base.raw = String(raw);
  if (sequence !== undefined) base.sequence = sequence;
  const s = String(raw ?? '').trim();
  if (!s) return base;
  // '9.14' (the Finnish clock) is a time too.
  if (/^\d{1,2}[:.]\d{2}([:.]\d{2})?(\s?[AaPp]\.?[Mm]\.?)?$/.test(s)) return { ...base, partial: 'time-only' };
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return { ...base, partial: 'date-only' };
  // known:true only when the string states its own zone: ISO 8601 with Z/offset, or RFC 2822 with a zone.
  // Zoneless date-times and slash dates (12/03 is 12 March or 3 December) are never guessed: raw kept, known:false.
  const iso = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?\s?(Z|[+-]\d{2}(:?\d{2})?)$/i.test(s);
  const rfc = /^(?:[A-Za-z]{3},\s+)?\d{1,2}\s+[A-Za-z]{3}\s+\d{4}\s+\d{2}:\d{2}(:\d{2})?\s+(?:[+-]\d{4}|GMT|UTC|UT|Z)$/.test(s);
  if (iso || rfc) {
    const t = Date.parse(iso ? s.replace(' ', 'T').replace(/\s/g, '') : s);
    if (!Number.isNaN(t)) return { known: true, iso: new Date(t).toISOString(), raw: base.raw, ...(sequence !== undefined ? { sequence } : {}) };
  }
  return base;
}

/** Slack-style epoch seconds ("1731000000.000200") to a known TimeRef. */
export function timeFromEpochSeconds(ts: string | number | undefined, sequence?: number): TimeRef {
  if (ts === undefined || ts === '') return { known: false, ...(sequence !== undefined ? { sequence } : {}) };
  const n = Number(ts);
  if (!Number.isFinite(n)) return parseTimeRef(String(ts), sequence);
  const iso: Iso = new Date(Math.round(n * 1000)).toISOString();
  return { known: true, iso, raw: String(ts), ...(sequence !== undefined ? { sequence } : {}) };
}

/** Sort key: known time first by instant, otherwise by sequence. Returns [group, value]. */
export function compareTime(a: TimeRef, b: TimeRef): number {
  if (a.known && b.known && a.iso && b.iso) return a.iso < b.iso ? -1 : a.iso > b.iso ? 1 : (a.sequence ?? 0) - (b.sequence ?? 0);
  return (a.sequence ?? 0) - (b.sequence ?? 0);
}

/** Display string that never fakes a date. */
export function describeTime(t: TimeRef): string {
  if (t.known && t.iso) return t.iso;
  if (t.partial === 'time-only' && t.raw) return `${t.raw} (date unknown)`;
  if (t.partial === 'date-only' && t.raw) return `${t.raw} (time unknown)`;
  if (t.raw) return `${t.raw} (unconfirmed)`;
  return 'time unknown';
}
