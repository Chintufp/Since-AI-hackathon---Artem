/**
 * B3: the Context Layer page's time axis, as a pure function. It never invents a date: known instants go on a calendar
 * segment, clock-only items ("09:14", date unknown) on a "same day, date unknown" segment per thread ordered by clock
 * minutes then sequence, and items with no usable time (unknown, date-only) in a '?' gutter. Segments are laid out left
 * to right as: time-only threads, calendar, gutter (B1's rule: an undated source is valid from before any dated moment;
 * the gutter sits at the end because nothing places it in time). The slider's stops come from the same layout.
 *
 * `layoutTimeAxis` is self-contained (no imports, no outer references) on purpose: the page embeds its source text
 * (`layoutTimeAxis.toString()`), so the browser runs exactly the function these tests check.
 */

export interface AxisItem {
  id: string;
  position: { kind: 'known' | 'time-only' | 'date-only' | 'unknown'; iso?: string; raw?: string; sequence?: number };
  /** Thread key (evidence thread id); time-only items of different threads get different segments. */
  thread?: string;
  /** A slider stop sits on this item (evidence diamonds); validity end points are items without a stop. */
  stop?: boolean;
}

export interface AxisSegment {
  kind: 'time-only' | 'calendar' | 'unknown';
  x0: number;
  x1: number;
  label: string;
  thread?: string;
  ticks: Array<{ x: number; label: string }>;
}

export interface AxisStop {
  x: number;
  label: string;
  kind: 'time-only' | 'calendar' | 'now';
  /** ISO moment to send as `at` (absent for now). */
  at?: string;
  /** Evidence cutoff to send as `atEvidence` (time-only stops). */
  atEvidence?: string;
  /** Item ids visible at this stop (mirrors retrieval/access.ts gateAt). */
  visible: string[];
}

export interface AxisLayout {
  x0: number;
  x1: number;
  segments: AxisSegment[];
  /** x of every item id. */
  x: Record<string, number>;
  /** Left-to-right order of the items. */
  order: string[];
  stops: AxisStop[];
  /** Break marks between segments (x of the gap centre). */
  breaks: number[];
}

export function layoutTimeAxis(items: AxisItem[], opts: { x0: number; x1: number; gap?: number; pad?: number }): AxisLayout {
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const gap = opts.gap ?? 22;
  const pad = opts.pad ?? 14;
  const minutes = (raw?: string): number => {
    const m = /(\d{1,2}):(\d{2})/.exec(raw ?? '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : Number.NaN;
  };
  const seq = (it: AxisItem): number => (typeof it.position.sequence === 'number' ? it.position.sequence : Number.MAX_SAFE_INTEGER);
  const short = (iso: string): string => {
    const d = new Date(iso);
    return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  };
  const ms = (it: AxisItem): number => (it.position.iso ? Date.parse(it.position.iso) : Number.NaN);
  const known = items.filter((it) => it.position.kind === 'known' && Number.isFinite(ms(it)));
  const timeOnly = items.filter((it) => it.position.kind === 'time-only' && Number.isFinite(minutes(it.position.raw)));
  const placed = new Set([...known, ...timeOnly].map((it) => it.id));
  const unknown = items.filter((it) => !placed.has(it.id));
  const threads: string[] = [];
  for (const it of timeOnly) if (!threads.includes(it.thread ?? '')) threads.push(it.thread ?? '');

  // Widths: each time-only thread 1.5, the calendar 1.4 (0.6 for a single moment), the gutter 0.4; gaps between them.
  const moments = new Set(known.map(ms)).size;
  const parts: Array<{ kind: AxisSegment['kind']; thread?: string; weight: number }> = [
    ...threads.map((t) => ({ kind: 'time-only' as const, thread: t, weight: 1.5 })),
    ...(known.length ? [{ kind: 'calendar' as const, weight: moments > 1 ? 1.4 : 0.6 }] : []),
    ...(unknown.length ? [{ kind: 'unknown' as const, weight: 0.4 }] : []),
  ];
  const total = parts.reduce((s, p) => s + p.weight, 0) || 1;
  const usable = opts.x1 - opts.x0 - gap * Math.max(0, parts.length - 1);
  const x: Record<string, number> = {};
  const segments: AxisSegment[] = [];
  const breaks: number[] = [];
  let cursor = opts.x0;
  for (const part of parts) {
    const w = (usable * part.weight) / total;
    const seg: AxisSegment = { kind: part.kind, x0: cursor, x1: cursor + w, label: '', ticks: [] };
    const inner0 = seg.x0 + pad;
    const inner1 = Math.max(inner0, seg.x1 - pad);
    if (part.kind === 'time-only') {
      seg.thread = part.thread;
      const mine = timeOnly.filter((it) => (it.thread ?? '') === part.thread)
        .sort((a, b) => minutes(a.position.raw) - minutes(b.position.raw) || seq(a) - seq(b));
      const lo = minutes(mine[0]!.position.raw);
      const hi = minutes(mine[mine.length - 1]!.position.raw);
      const span = hi - lo;
      let last = -Infinity;
      for (const it of mine) {
        const base = span > 0 ? inner0 + ((minutes(it.position.raw) - lo) / span) * (inner1 - inner0) : (inner0 + inner1) / 2;
        // Same clock minute: keep thread order visible with a small nudge.
        const px = Math.max(base, last + 5);
        x[it.id] = px;
        last = px;
        const label = it.position.raw ?? '';
        if (!seg.ticks.some((t) => t.label === label)) seg.ticks.push({ x: px, label });
      }
      seg.label = 'same day, date unknown';
    } else if (part.kind === 'calendar') {
      const mine = [...known].sort((a, b) => ms(a) - ms(b) || seq(a) - seq(b));
      const lo = ms(mine[0]!);
      const hi = ms(mine[mine.length - 1]!);
      for (const it of mine) {
        x[it.id] = hi > lo ? inner0 + ((ms(it) - lo) / (hi - lo)) * (inner1 - inner0) : (inner0 + inner1) / 2;
        const label = short(it.position.iso!);
        if (!seg.ticks.some((t) => t.label === label)) seg.ticks.push({ x: x[it.id]!, label });
      }
      seg.label = 'dated';
    } else {
      const mine = [...unknown].sort((a, b) => seq(a) - seq(b) || a.id.localeCompare(b.id));
      mine.forEach((it, i) => {
        x[it.id] = mine.length === 1 ? (seg.x0 + seg.x1) / 2 : inner0 + (i / (mine.length - 1)) * (inner1 - inner0);
      });
      seg.ticks.push({ x: (seg.x0 + seg.x1) / 2, label: '?' });
      seg.label = 'time unknown';
    }
    segments.push(seg);
    cursor = seg.x1 + gap;
    if (part !== parts[parts.length - 1]) breaks.push(seg.x1 + gap / 2);
  }

  const order = Object.keys(x).sort((a, b) => x[a]! - x[b]!);
  const byId = new Map(items.map((it) => [it.id, it] as const));
  const firstKnown = known.length ? Math.min(...known.map(ms)) : undefined;
  // What is visible at each stop, with gateAt's rule: dated items by `at`; undated items only of the cutoff's thread up
  // to it (time-only stops), every undated item at a calendar stop, everything at now.
  const visibleAt = (stop: Omit<AxisStop, 'visible' | 'x' | 'label'>): string[] => items.filter((it) => {
    if (stop.kind === 'now') return true;
    const t = ms(it);
    const atMs = stop.at ? Date.parse(stop.at) : Number.POSITIVE_INFINITY;
    if (it.position.kind === 'known' && Number.isFinite(t)) return t <= atMs;
    if (stop.kind === 'calendar') return true;
    const cut = byId.get(stop.atEvidence ?? '');
    if (!cut) return false;
    if (it.id === cut.id) return true;
    if ((it.thread ?? '') !== (cut.thread ?? '') || cut.thread === undefined) return false;
    return seq(it) < seq(cut) || (seq(it) === seq(cut) && (x[it.id] ?? 0) <= (x[cut.id] ?? 0));
  }).map((it) => it.id);

  const stops: AxisStop[] = [];
  for (const id of order) {
    const it = byId.get(id)!;
    if (!it.stop) continue;
    if (it.position.kind === 'time-only' && placed.has(id)) {
      const at = firstKnown !== undefined ? new Date(firstKnown - 1).toISOString() : undefined;
      const s = { kind: 'time-only' as const, atEvidence: id, ...(at ? { at } : {}) };
      stops.push({ ...s, x: x[id]!, label: `${it.position.raw} (date unknown)`, visible: visibleAt(s) });
    } else if (it.position.kind === 'known' && placed.has(id)) {
      if (stops.some((s) => s.kind === 'calendar' && s.at === new Date(ms(it)).toISOString())) continue;
      const s = { kind: 'calendar' as const, at: new Date(ms(it)).toISOString() };
      stops.push({ ...s, x: x[id]!, label: short(it.position.iso!), visible: visibleAt(s) });
    }
  }
  stops.push({ kind: 'now', x: opts.x1, label: 'now', visible: visibleAt({ kind: 'now' }) });
  return { x0: opts.x0, x1: opts.x1, segments, x, order, stops, breaks };
}
