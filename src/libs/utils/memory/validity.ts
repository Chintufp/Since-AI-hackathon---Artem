/**
 * B1: time helpers for claim validity. Unknowns stay unknown: an unknown time is never defaulted to now, and an iso is
 * never synthesised for a time-only or date-only source.
 *
 * Rules (DECISIONS-engine.md D-B1-02, D-B1-03):
 * - an unknown `from` means "valid from before any dated moment";
 * - an unknown `to` means "still believed true", except on a superseded claim, which is closed at every moment (the
 *   newer claim, itself undated, holds from before any dated moment);
 * - "newer" compares known event times when both are known, otherwise import order, and says which basis it used.
 */
import type { Claim, TimeRef, TimePosition } from '../contracts/index.ts';

/** Epoch milliseconds of a fully known time; undefined for time-only, date-only or unknown times. */
export function instantOf(t: TimeRef | undefined): number | undefined {
  if (!t || !t.known || !t.iso) return undefined;
  const ms = Date.parse(t.iso);
  return Number.isFinite(ms) ? ms : undefined;
}

/** Does the claim hold at `atMs`? */
export function validAt(claim: Pick<Claim, 'validity' | 'status'>, atMs: number): boolean {
  const from = instantOf(claim.validity.from);
  if (from !== undefined && from > atMs) return false;
  const to = instantOf(claim.validity.to);
  if (to !== undefined) return atMs < to;
  return claim.status !== 'superseded';
}

export type OrderBasis = 'known-time' | 'import-order';

/**
 * Is `a` newer than `b`? Both event times known: compare them (equal is not newer). Otherwise import order: `createdAt`,
 * then the position in `importOrder` (the store's insertion order), which the caller supplies.
 */
export function isNewer(
  a: Pick<Claim, 'id' | 'validity' | 'createdAt'>, b: Pick<Claim, 'id' | 'validity' | 'createdAt'>, importOrder?: (id: string) => number,
): { newer: boolean; basis: OrderBasis } {
  const ta = instantOf(a.validity.from);
  const tb = instantOf(b.validity.from);
  if (ta !== undefined && tb !== undefined) return { newer: ta > tb, basis: 'known-time' };
  if (a.createdAt !== b.createdAt) return { newer: a.createdAt > b.createdAt, basis: 'import-order' };
  const ia = importOrder?.(a.id) ?? -1;
  const ib = importOrder?.(b.id) ?? -1;
  return { newer: ia > ib, basis: 'import-order' };
}

/** Where a time sits, without inventing anything: known iso, time-only, date-only or unknown (raw and sequence kept). */
export function timePosition(t: TimeRef | undefined): TimePosition {
  if (!t) return { kind: 'unknown' };
  const extra = { ...(t.raw !== undefined ? { raw: t.raw } : {}), ...(t.sequence !== undefined ? { sequence: t.sequence } : {}) };
  if (t.known && t.iso) return { kind: 'known', iso: t.iso, ...extra };
  if (t.partial === 'time-only') return { kind: 'time-only', ...extra };
  if (t.partial === 'date-only') return { kind: 'date-only', ...extra };
  return { kind: 'unknown', ...extra };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Short date for captions ("14 Oct") from a known time, read in UTC; for anything else the describeTime-style text. */
export function shortDate(t: TimeRef | undefined): string | undefined {
  const ms = instantOf(t);
  if (ms === undefined) return undefined;
  const d = new Date(ms);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Parse an `at` value: ISO 8601 with a zone only (the same rule as parseTimeRef); undefined otherwise. */
export function parseAt(at: string | undefined): number | undefined {
  if (!at) return undefined;
  // An unencoded '+' in a query string arrives as a space ("…T10:05:00 03:00"): read a space before a time-of-day
  // offset as '+'. Only after a clock time, so "2026-10-01 10:00" (no zone) still has no zone.
  at = at.replace(/(T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?) (\d{2}:?\d{2})$/, '$1+$2');
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?\s?(?:Z|[+-]\d{2}:?\d{2}))?$/i.test(at.trim())) return undefined;
  const ms = Date.parse(at.trim().length === 10 ? `${at.trim()}T00:00:00Z` : at.trim());
  return Number.isFinite(ms) ? ms : undefined;
}
