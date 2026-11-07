/** desktop (R34): attention rules, counters and the collapsed question watch (fake clock, fake storage). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ATTENTION, ENGAGEMENT_KEY, createAttention } from './attention.ts';
import { COLLAPSED_POLL_MS, createQuestionWatch } from './question-watch.ts';

function memory() {
  const m = new Map<string, string>();
  return { m, storage: { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) } };
}

test('one arrival per id; seen ids never arrive; unseen drives the glyph', () => {
  let now = 1000;
  const a = createAttention({ now: () => now });
  a.observe(['q1', 'q2']);
  assert.deepEqual(a.unseen(['q1', 'q2']), ['q1', 'q2']);
  assert.equal(a.nextArrival(['q1', 'q2']), 'q1');
  a.markAnnounced('q1');
  assert.equal(a.nextArrival(['q1', 'q2']), 'q2', 'q1 never again');
  now += 5000;
  a.markSeen('q2');
  assert.equal(a.nextArrival(['q1', 'q2']), null);
  assert.equal(a.hasUnseen(['q1', 'q2']), true, 'q1 announced but not opened');
  a.markSeen('q1');
  assert.equal(a.hasUnseen(['q1', 'q2']), false);
  assert.deepEqual(a.counters().openDelaysMs, [5000, 5000]);
  assert.equal(a.counters().arrivals, 1);
});

test('one reminder per id, only for announced or seen ids that are still open and not snoozed', () => {
  let now = 0;
  const a = createAttention({ now: () => now });
  a.observe(['q1', 'q2', 'q3']);
  assert.equal(a.nextReminder(['q1', 'q2', 'q3']), null, 'nothing was ever shown');
  a.markAnnounced('q2');
  a.markSeen('q3');
  assert.equal(a.nextReminder(['q1', 'q2', 'q3']), 'q2');
  a.markReminded('q2');
  assert.equal(a.nextReminder(['q1', 'q2', 'q3']), 'q3');
  a.record('deferred', 'q3');
  assert.equal(a.nextReminder(['q1', 'q2', 'q3']), null, 'Later snoozes');
  assert.equal(a.snoozed('q3'), true);
  now += ATTENTION.LATER_SNOOZE_MS + 1;
  assert.equal(a.snoozed('q3'), false);
  assert.equal(a.nextReminder(['q1', 'q2', 'q3']), 'q3');
  assert.equal(a.counters().reminders, 1);
});

test('Later snoozes an unseen question out of arrivals and the glyph for the deferral time', () => {
  let now = 0;
  const a = createAttention({ now: () => now });
  a.observe(['q1']);
  a.record('deferred', 'q1');
  assert.equal(a.nextArrival(['q1']), null);
  assert.equal(a.hasUnseen(['q1']), false);
  now += ATTENTION.LATER_SNOOZE_MS + 1;
  assert.equal(a.hasUnseen(['q1']), true);
});

test('counters: answered / deferred / dismissed / ignored, median open delay, persisted under kt-engagement.v1', () => {
  let now = 0;
  const { m, storage } = memory();
  const a = createAttention({ now: () => now, storage });
  a.observe(['a', 'b', 'c']);
  now = 1000;
  a.markSeen('a');
  now = 4000;
  a.markSeen('b');
  now = 10000;
  a.markSeen('c');
  a.record('answered', 'a');
  a.record('answered', 'b');
  a.record('dismissed', 'c');
  a.record('deferred', 'c');
  a.ignored('a');
  const c = a.counters();
  assert.deepEqual({ answered: c.answered, deferred: c.deferred, dismissed: c.dismissed, arrivalsIgnored: c.arrivalsIgnored }, { answered: 2, deferred: 1, dismissed: 1, arrivalsIgnored: 1 });
  assert.equal(c.medianOpenDelayMs, 4000);
  const saved = JSON.parse(m.get(ENGAGEMENT_KEY)!);
  assert.equal(saved.version, 1);
  assert.equal(saved.counters.answered, 2);
  // a fresh store reads it back: no second arrival for a after a restart
  const b = createAttention({ now: () => now, storage });
  assert.equal(b.get('a')?.seen, 1000);
  assert.equal(b.nextArrival(['a', 'b', 'c']), null);
  assert.equal(b.counters().dismissed, 1);
});

test('storage is optional and garbage is ignored', () => {
  const a = createAttention({ storage: { getItem: () => '{"version":1,"questions":{"x":{"seen":"no"}},"counters":"?"}', setItem: () => { throw new Error('full'); } } });
  a.observe(['x']);
  a.markSeen('x');
  assert.equal(a.counters().openDelaysMs.length, 1);
  const n = createAttention({ storage: null });
  n.observe(['y']);
  assert.equal(n.nextArrival(['y']), 'y');
});

test('ids are bounded (oldest dropped)', () => {
  let now = 0;
  const a = createAttention({ now: () => now });
  for (let i = 0; i < ATTENTION.MAX_IDS + 10; i++) {
    now++;
    a.observe(['q' + i]);
  }
  assert.equal(a.get('q0'), undefined);
  assert.ok(a.get('q' + (ATTENTION.MAX_IDS + 9)));
});

function watchSetup(o: { collapsed?: boolean; hidden?: boolean; accept?: boolean } = {}) {
  const ui = { collapsed: o.collapsed ?? true, hidden: !!o.hidden, accept: o.accept ?? true };
  const intervals = new Map<number, { fn: () => void; ms: number }>();
  let seq = 0;
  let refreshes = 0;
  const arrivals: Array<[string, string]> = [];
  const attention = createAttention({ now: () => 0 });
  const w = createQuestionWatch({
    attention,
    refresh: () => { refreshes++; },
    collapsed: () => ui.collapsed,
    hidden: () => ui.hidden,
    arrive: (id, kind) => { arrivals.push([id, kind]); return ui.accept; },
    clock: {
      setInterval: (fn, ms) => { intervals.set(++seq, { fn, ms }); return seq; },
      clearInterval: (id) => { intervals.delete(id as number); },
    },
  });
  const tick = () => { for (const i of [...intervals.values()]) i.fn(); };
  return { ui, intervals, w, attention, arrivals, tick, get refreshes() { return refreshes; } };
}

test('question watch: polls every 90 s only while collapsed and visible', () => {
  const t = watchSetup({ collapsed: false });
  t.w.sync();
  assert.equal(t.intervals.size, 0, 'open: the panel polls itself');
  t.ui.collapsed = true;
  t.w.sync();
  assert.equal(t.intervals.size, 1);
  assert.equal([...t.intervals.values()][0]!.ms, COLLAPSED_POLL_MS);
  t.w.sync();
  assert.equal(t.intervals.size, 1, 'idempotent');
  t.tick();
  assert.equal(t.refreshes, 1);
  t.ui.hidden = true;
  t.tick();
  assert.equal(t.refreshes, 1, 'skipped while document.hidden');
  t.ui.collapsed = false;
  t.w.sync();
  assert.equal(t.intervals.size, 0);
  t.w.destroy();
});

test('question watch: arrival for a new unseen id once; refused arrivals stay eligible', () => {
  const t = watchSetup({ accept: false });
  t.w.handle(['q1']);
  assert.deepEqual(t.arrivals, [['q1', 'arrival']]);
  assert.equal(t.attention.get('q1')?.announced, undefined, 'he was in: not announced');
  t.ui.accept = true;
  t.w.handle(['q1']);
  assert.equal(t.attention.get('q1')?.announced, 0);
  t.w.handle(['q1']);
  assert.equal(t.arrivals.length, 2, 'never repeats for that id');
});

test('question watch: wake refreshes at once; a reminder only after >= 20 min away, once', () => {
  const t = watchSetup();
  t.w.handle(['q1']); // arrival
  t.w.wake('show');
  assert.equal(t.refreshes, 1);
  t.w.wake('unlock-screen', 5 * 60 * 1000);
  t.w.handle(['q1']);
  assert.equal(t.arrivals.length, 1, 'short absence: no reminder');
  t.w.wake('resume', ATTENTION.REMIND_AFTER_AWAY_MS);
  assert.equal(t.w.status().pendingReminder, true);
  t.w.handle(['q1']);
  assert.deepEqual(t.arrivals.at(-1), ['q1', 'reminder']);
  assert.ok(t.attention.get('q1')?.reminded !== undefined);
  t.w.wake('resume', ATTENTION.REMIND_AFTER_AWAY_MS * 2);
  t.w.handle(['q1']);
  assert.equal(t.arrivals.length, 2, 'one reminder per id');
});
