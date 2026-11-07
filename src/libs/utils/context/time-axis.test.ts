import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTimeAxis, type AxisItem } from './time-axis.ts';

const T = (id: string, raw: string, sequence: number, thread = 'teams:1'): AxisItem => ({ id, position: { kind: 'time-only', raw, sequence }, thread, stop: true });
const K = (id: string, iso: string): AxisItem => ({ id, position: { kind: 'known', iso, raw: iso }, stop: true });
const U = (id: string, sequence?: number): AxisItem => ({ id, position: { kind: 'unknown', ...(sequence !== undefined ? { sequence } : {}) }, thread: 'mail:1', stop: true });

const items: AxisItem[] = [
  K('note', '2026-10-14T07:05:00.000Z'),
  U('mail', 0),
  T('m3', '09:16', 3), T('m1', '09:14', 1), T('m2', '09:16', 2), T('m9', '09:25', 9),
  K('early', '2026-08-20T06:12:00.000Z'),
  { id: 'dateonly', position: { kind: 'date-only', raw: '1 December' } },
];

test('segments: time-only thread, then calendar, then the ? gutter; break marks between them', () => {
  const l = layoutTimeAxis(items, { x0: 100, x1: 900 });
  assert.deepEqual(l.segments.map((s) => s.kind), ['time-only', 'calendar', 'unknown']);
  assert.equal(l.segments[0]!.label, 'same day, date unknown');
  assert.equal(l.breaks.length, 2);
  assert.ok(l.segments[0]!.x1 < l.breaks[0]! && l.breaks[0]! < l.segments[1]!.x0);
  // date-only and unknown items go to the gutter, never onto the calendar.
  const gutter = l.segments[2]!;
  for (const id of ['mail', 'dateonly']) assert.ok(l.x[id]! >= gutter.x0 && l.x[id]! <= gutter.x1, id);
});

test('time-only items are ordered by clock minutes, then sequence; the same minute keeps thread order', () => {
  const l = layoutTimeAxis(items, { x0: 0, x1: 800 });
  const t = l.order.filter((id) => /^m\d/.test(id));
  assert.deepEqual(t, ['m1', 'm2', 'm3', 'm9']);
  assert.ok(l.x.m3! > l.x.m2!, 'same minute, later sequence is to the right');
  assert.deepEqual(l.segments[0]!.ticks.map((x) => x.label), ['09:14', '09:16', '09:25']);
});

test('known items sit on a calendar scale and never get a clock-segment position; no iso is invented', () => {
  const l = layoutTimeAxis(items, { x0: 0, x1: 800 });
  const cal = l.segments[1]!;
  assert.ok(l.x.early! < l.x.note!);
  assert.ok(l.x.early! >= cal.x0 && l.x.note! <= cal.x1);
  assert.deepEqual(cal.ticks.map((x) => x.label), ['20 Aug', '14 Oct']);
  for (const s of l.stops.filter((x) => x.kind === 'time-only')) {
    assert.ok(s.atEvidence);
    assert.equal(s.at, '2026-08-20T06:11:59.999Z', 'a time-only stop sends at = just before the first dated item, plus the cutoff');
    assert.match(s.label, /\(date unknown\)$/);
  }
});

test('stops and what is visible at each (mirrors gateAt)', () => {
  const l = layoutTimeAxis(items, { x0: 0, x1: 800 });
  assert.deepEqual(l.stops.map((s) => s.label), ['09:14 (date unknown)', '09:16 (date unknown)', '09:16 (date unknown)', '09:25 (date unknown)', '20 Aug', '14 Oct', 'now']);
  const at = (label: string, i = 0) => l.stops.filter((s) => s.label === label)[i]!;
  assert.deepEqual(at('09:14 (date unknown)').visible.sort(), ['m1']);
  assert.deepEqual(at('09:16 (date unknown)', 1).visible.sort(), ['m1', 'm2', 'm3']);
  // A calendar stop: dated items up to it, every undated item (B1: undated = valid from before any dated moment).
  assert.deepEqual(at('20 Aug').visible.sort(), ['dateonly', 'early', 'm1', 'm2', 'm3', 'm9', 'mail']);
  assert.deepEqual(at('now').visible.length, items.length);
  // Items without `stop` get a position but no stop.
  assert.ok(!l.stops.some((s) => s.atEvidence === 'dateonly'));
});

test('two undated threads get two clock segments; an empty input still has a now stop', () => {
  const l = layoutTimeAxis([T('a', '09:14', 1, 'x'), T('b', '14:02', 1, 'y')], { x0: 0, x1: 400 });
  assert.deepEqual(l.segments.map((s) => s.thread), ['x', 'y']);
  assert.deepEqual(l.stops.find((s) => s.atEvidence === 'b')!.visible, ['b'], 'the other undated thread is not visible');
  assert.deepEqual(layoutTimeAxis([], { x0: 0, x1: 400 }).stops.map((s) => s.kind), ['now']);
});

test('the source text runs on its own (the page embeds layoutTimeAxis.toString())', () => {
  const embedded = new Function(`return (${layoutTimeAxis.toString()})`)() as typeof layoutTimeAxis;
  assert.deepEqual(embedded(items, { x0: 0, x1: 800 }), layoutTimeAxis(items, { x0: 0, x1: 800 }));
});
