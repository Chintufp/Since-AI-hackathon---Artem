/**
 * desktop (R31..R36): the companion state machine with a fake clock, rAF, storage, avatar and panel
 * (no DOM): geometry, gesture classification, timers, travel, persistence, attention hooks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ActKey, AvatarStatus, CompanionAvatar, FallOptions, PoseSpec } from '../motion/avatar.ts';
import type { HeldSpec, LookView } from '../motion/poses.ts';
import type { LandingTier } from '../motion/physics.ts';
import {
  COMPANION, GEOMETRY, carrierTransform, classifyGesture, createCompanion, homeXFor, inEdgeZone, loadPlacement, nearBody,
  nextGaze, perchX, pushedSide, roomX, sliverX,
} from './companion.ts';
import type { CompanionFlags } from './companion.ts';

const W = 1512;
const H = 872;

function fakeEnv() {
  let now = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const rafs = new Map<number, (t: number) => void>();
  let rafCount = 0;
  const clock = {
    now: () => now,
    setTimeout: (fn: () => void, ms: number) => { const id = ++seq; timers.set(id, { at: now + ms, fn }); return id; },
    clearTimeout: (id: unknown) => { timers.delete(id as number); },
  };
  const raf = {
    request: (cb: (t: number) => void) => { const id = ++seq; rafs.set(id, cb); rafCount++; return id; },
    cancel: (id: number) => { rafs.delete(id); },
  };
  /** Advance time by `ms` in 16 ms frames, running due timers and one rAF round per frame. */
  const advance = (ms: number): void => {
    const end = now + ms;
    while (now < end) {
      now = Math.min(end, now + 16);
      for (const [id, t] of [...timers].sort((a, b) => a[1].at - b[1].at)) {
        if (t.at <= now && timers.has(id)) { timers.delete(id); t.fn(); }
      }
      const round = [...rafs];
      rafs.clear();
      for (const [, cb] of round) cb(now);
    }
  };
  return { clock, raf, advance, timers, rafs, get rafCount() { return rafCount; }, get now() { return now; } };
}

class FakeAvatar implements CompanionAvatar {
  calls: string[] = [];
  mode = 'idle3';
  reaction = false;
  held: HeldSpec | null = null;
  airborne = false;
  lift = 0;
  fallDistance: number | null = null;
  fall: { lift: number; onLand?: (t: LandingTier) => void; options: FallOptions } | null = null;
  play(act: ActKey): void { this.calls.push('play:' + act); this.mode = act; }
  rest(): void { this.calls.push('rest'); this.mode = this.held ? 'hold' : 'idle3'; }
  playEntranceThenRest(): void { this.calls.push('entrance'); this.reaction = true; this.airborne = true; }
  refresh(): void { this.calls.push('refresh'); }
  destroy(): void {}
  pose(spec: PoseSpec): void { this.calls.push('pose:' + spec.kind + ('frame' in spec ? spec.frame : '') + (spec.kind === 'carried' ? `:${spec.happy ? 'happy' : 'surprised'}:${spec.lift}` : '')); this.mode = 'pose:' + spec.kind; }
  look(gaze: number, view?: LookView): boolean { this.calls.push(`look:${gaze}:${view ?? 'front'}`); this.mode = gaze ? 'look' : 'idle3'; return true; }
  hold(spec: HeldSpec | null): void { this.calls.push('hold:' + (spec ? JSON.stringify(spec) : 'null')); this.held = spec; if (spec) this.mode = 'hold'; }
  run(act: ActKey, from = 0): void { this.calls.push(`run:${act}:${from}`); this.mode = act; }
  fallFrom(liftPx: number, onLand?: (tier: LandingTier) => void, options: FallOptions = {}): LandingTier {
    this.calls.push('fall:' + Math.round(liftPx));
    this.fall = { lift: liftPx, onLand, options };
    this.airborne = liftPx > 0;
    return 'settle';
  }
  /** Finish the pending fall: steps down to 0, lands, settles. */
  land(): void {
    const f = this.fall!;
    this.fall = null;
    f.options.onStep?.(f.lift / 2);
    f.options.onStep?.(0);
    this.airborne = false;
    f.onLand?.('settle');
    f.options.onSettled?.();
  }
  setBase(): void {}
  setFallDistance(px: number | null): void { this.fallDistance = px; }
  status(): AvatarStatus {
    return {
      mode: this.mode, lastFrame: 0, animating: this.reaction, reactionPlaying: this.reaction, idleLoop: false, idlePose: 0, visible: true,
      reduced: false, questionCue: false, scale: 2, falling: false, dropY: 0, dropActive: false, held: !!this.held, carried: this.mode === 'pose:carried',
      airborne: this.airborne, lift: this.lift, base: this.held ? 'hold' : 'idle3', surface: 'display',
    };
  }
}

const FLAGS: CompanionFlags = { companion: true, drag: true, away: true, gaze: true, fidgets: false, windowMode: 'area' };

function setup(o: { flags?: Partial<CompanionFlags>; reduced?: boolean; stored?: string; width?: number; open?: boolean; question?: boolean; motionActive?: () => boolean } = {}) {
  const env = fakeEnv();
  const avatar = new FakeAvatar();
  const store = new Map<string, string>();
  if (o.stored) store.set(COMPANION.STORE_KEY, o.stored);
  const storage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
  const events: Array<{ type: string; detail?: unknown }> = [];
  const carrier: Array<{ x: number; y: number }> = [];
  const shadow: number[] = [];
  const panelCalls: string[] = [];
  const ui = { open: !!o.open, question: !!o.question, reduced: !!o.reduced, width: o.width ?? W };
  const hooks = { returned: 0, wakes: [] as Array<[string, number]>, ignored: [] as string[] };
  const c = createCompanion({
    avatar,
    flags: { ...FLAGS, ...o.flags },
    storage,
    clock: env.clock,
    raf: env.raf,
    random: () => 0.5,
    area: () => ({ width: ui.width, height: H }),
    dpr: () => 2,
    reduced: () => ui.reduced,
    emit: (type, detail) => { events.push({ type, detail }); },
    panel: {
      isOpen: () => ui.open,
      toggle: () => { panelCalls.push('toggle'); if (!ui.open) c.makeRoom(); ui.open = !ui.open; if (ui.open) c.panelOpened(); else c.panelClosed(); },
      open: () => { panelCalls.push('open'); c.makeRoom(); ui.open = true; c.panelOpened(); },
      close: () => { panelCalls.push('close'); ui.open = false; c.panelClosed(); },
      busy: () => false,
      motionActive: o.motionActive ?? (() => false),
      hasQuestion: () => ui.question,
    },
    render: {
      carrier: (x, y) => { carrier.push({ x, y }); },
      shadow: (l) => { shadow.push(l); },
      carried: () => {},
    },
    onReturn: () => { hooks.returned++; },
    onWake: (e, ms) => { hooks.wakes.push([e, ms]); },
    onIgnored: (id) => { hooks.ignored.push(id); },
  });
  const states = () => events.filter((e) => e.type === 'kt-companion:state').map((e) => e.detail);
  return { env, avatar, c, store, events, carrier, shadow, panelCalls, ui, hooks, states };
}

/** Launch with the entrance finished at once, then the launch leave. */
function launchedAway(t = setup()) {
  t.c.start();
  t.env.advance(32);
  assert.equal(t.c.status().state, 'in');
  t.env.advance(COMPANION.LEAVE_AFTER_LAUNCH_MS + 3000);
  assert.equal(t.c.status().state, 'away');
  return t;
}

test('geometry: home, sliver, perch, make-room range and the carrier transform', () => {
  assert.equal(homeXFor(W, GEOMETRY.HOME_FROM_RIGHT), W - 79);
  assert.equal(homeXFor(W, W + 50), GEOMETRY.HOME_CLAMP_PX, 'clamped to [14, W-14]');
  assert.equal(sliverX('right', W), W + 28 - 12);
  assert.equal(sliverX('left', W), -28 + 12);
  assert.equal(perchX('right', W), W - 44);
  assert.equal(perchX('left', W), 44);
  assert.equal(roomX(100, W), 345);
  assert.equal(roomX(W - 10, W), W - 59);
  assert.equal(roomX(800, W), 800);
  // card left = bodyX - 333, card bottom = 30 + lift, both on whole device pixels (dpr 2 -> 0.5 px steps)
  assert.deepEqual(carrierTransform(W - 79, 0, 2), { x: W - 79 - 333, y: 30 });
  assert.deepEqual(carrierTransform(400.3, 10.2, 2), { x: 67.5, y: 40 });
  assert.deepEqual(carrierTransform(400.3, -5, 1), { x: 67, y: 30 }, 'never below the floor');
});

test('geometry: proximity zone, near body, deliberate push past an edge', () => {
  assert.equal(inEdgeZone('right', W, H, W - 100, H - 60), true);
  assert.equal(inEdgeZone('right', W, H, W - 200, H - 60), false);
  assert.equal(inEdgeZone('right', W, H, W - 20, H - 260), false, 'floor level +- 160');
  assert.equal(inEdgeZone('left', W, H, 150, H - 40), true);
  assert.equal(nearBody(500, 0, H, 520, H - 40), true);
  assert.equal(nearBody(500, 0, H, 700, H - 40), false);
  assert.equal(pushedSide(W + 1, W - 30, W), 'right', 'centre past the edge');
  assert.equal(pushedSide(W - 40, W - 2, W), 'right', 'pointer pinned to the screen edge');
  assert.equal(pushedSide(-3, 30, W), 'left');
  assert.equal(pushedSide(W - 100, W - 100, W), null);
});

test('gesture classification: 4 px threshold with the quick-tap allowance', () => {
  assert.equal(classifyGesture(0, 1000), 'press');
  assert.equal(classifyGesture(4, 1000), 'press', 'any hold time');
  assert.equal(classifyGesture(6, 100), 'press', 'quick tap wobble');
  assert.equal(classifyGesture(6, 300), 'drag');
  assert.equal(classifyGesture(9, 50), 'drag');
});

test('gaze hysteresis: turns at 24 px, holds down to 12 px, front when far', () => {
  assert.equal(nextGaze(0, 20, true), 0);
  assert.equal(nextGaze(0, 30, true), 1);
  assert.equal(nextGaze(1, 15, true), 1);
  assert.equal(nextGaze(1, 5, true), 0);
  assert.equal(nextGaze(-1, -13, true), -1);
  assert.equal(nextGaze(1, -30, true), -1);
  assert.equal(nextGaze(1, 40, false), 0);
});

test('persistence: defaults on garbage, round trip of the dropped spot', () => {
  assert.deepEqual(loadPlacement({ getItem: () => '{nope' }), { version: 1, homeFromRight: 79, awaySide: null });
  assert.deepEqual(loadPlacement(null), { version: 1, homeFromRight: 79, awaySide: null });
  assert.deepEqual(loadPlacement({ getItem: () => JSON.stringify({ version: 1, homeFromRight: 500, awaySide: 'left', fidgets: true }) }), { version: 1, homeFromRight: 500, awaySide: 'left', fidgets: true });
  const t = setup({ stored: JSON.stringify({ version: 1, homeFromRight: 700, awaySide: 'left' }) });
  t.c.start();
  assert.equal(t.c.status().bodyX, W - 700, 'starts at the stored home spot');
  assert.equal(t.c.status().side, 'left');
});

test('launch: carrier at home before the entrance, D0 = window height, "in" after it, away after 4 s by rolling then tucking', () => {
  const t = setup();
  t.c.start();
  t.avatar.playEntranceThenRest();
  assert.equal(t.c.status().state, 'launching');
  assert.deepEqual(t.carrier.at(-1), { x: W - 79 - 333, y: 30 });
  assert.equal(t.avatar.fallDistance, H);
  t.env.advance(500);
  assert.equal(t.c.status().state, 'launching', 'still falling / landing');
  t.avatar.reaction = false;
  t.avatar.airborne = false;
  t.env.advance(32);
  assert.equal(t.c.status().state, 'in');
  assert.deepEqual(t.c.status().timers, ['idle']);
  t.env.advance(COMPANION.LEAVE_AFTER_LAUNCH_MS - 100);
  assert.equal(t.c.status().state, 'in');
  t.env.advance(200);
  assert.equal(t.c.status().state, 'leaving');
  assert.equal(t.c.status().side, 'right', 'nearer edge');
  t.env.advance(1500);
  const s = t.c.status();
  assert.equal(s.state, 'away');
  assert.equal(s.bodyX, sliverX('right', W));
  assert.ok(t.avatar.calls.some((x) => x === 'pose:roll'), 'rolled');
  assert.ok(t.avatar.calls.includes('pose:settle0') && t.avatar.calls.includes('pose:settle1'), '2-frame tuck');
  assert.equal(t.avatar.calls.at(-1), 'hold:{}');
  assert.equal(s.rafActive, false, 'no rAF while away');
  assert.deepEqual(s.timers, [], 'no timers while away');
  assert.deepEqual(t.states().at(-1), { away: true, question: false });
  assert.equal(JSON.parse(t.store.get(COMPANION.STORE_KEY)!).awaySide, 'right');
});

test('launch leave waits while the pointer is near or the panel is open', () => {
  const t = setup();
  t.c.start();
  t.env.advance(32);
  t.c.pointer(W - 79, H - 40);
  t.env.advance(COMPANION.LEAVE_AFTER_LAUNCH_MS + 1000);
  assert.equal(t.c.status().state, 'in');
  t.c.pointer(200, 200); // pointer leaves: the idle timer (20 s) starts
  t.env.advance(COMPANION.LEAVE_AFTER_IDLE_MS - 500);
  assert.equal(t.c.status().state, 'in');
  t.env.advance(600);
  assert.equal(t.c.status().state, 'leaving');
});

test('proximity: peek to the perch with gaze, return after the dwell with hello', () => {
  const t = launchedAway();
  t.avatar.calls = [];
  t.c.pointer(W - 120, H - 50);
  assert.equal(t.c.status().state, 'peeking');
  assert.ok(t.avatar.calls.includes('hold:{"gaze":-1,"view":"front"}'), 'looks toward the pointer (left of him)');
  t.env.advance(200);
  assert.equal(t.c.status().bodyX < sliverX('right', W), true, 'sliding out');
  t.env.advance(COMPANION.PEEK_DWELL_MS);
  assert.equal(t.c.status().state, 'returning');
  t.env.advance(COMPANION.HOP_MS + 100);
  const s = t.c.status();
  assert.equal(s.state, 'in');
  assert.equal(s.bodyX, W - 79);
  assert.ok(t.avatar.calls.includes('run:hop:0'), 'hops in');
  assert.equal(t.avatar.calls.at(-1), 'play:hello');
  assert.equal(t.hooks.returned, 1, 'questions refreshed on return');
  assert.deepEqual(t.states().at(-1), { away: false, question: false });
});

test('proximity: within 60 px returns at once; an abandoned peek goes back after PEEK_RETREAT_MS', () => {
  const t = launchedAway();
  t.c.pointer(W - 120, H - 50);
  t.env.advance(100);
  t.c.pointer(t.c.status().bodyX - 10, H - 40);
  assert.equal(t.c.status().state, 'returning');

  const u = launchedAway();
  u.c.pointer(W - 120, H - 50);
  u.env.advance(100);
  u.c.pointer(200, 200);
  u.env.advance(COMPANION.PEEK_DWELL_MS + 100);
  assert.equal(u.c.status().state, 'peeking', 'dwell needs the pointer in the zone');
  u.env.advance(COMPANION.PEEK_RETREAT_MS + 300);
  assert.equal(u.c.status().state, 'away');
  assert.equal(u.c.status().bodyX, sliverX('right', W));
});

test('click: press pose on pointerdown, toggle + run(click, 2) on release within the threshold', () => {
  const t = setup();
  t.c.start();
  t.env.advance(32);
  const x = W - 79, y = H - 40;
  assert.equal(t.c.pointerDown(x, y), true);
  assert.equal(t.avatar.calls.at(-1), 'pose:press');
  assert.equal(t.c.status().state, 'pressed');
  t.env.advance(600); // any hold time
  t.c.pointerMove(x + 3, y);
  assert.equal(t.c.status().state, 'pressed');
  assert.equal(t.c.pointerUp(x + 3, y), true, 'native click suppressed');
  assert.deepEqual(t.panelCalls, ['toggle']);
  assert.equal(t.avatar.calls.at(-1), 'run:click:2');
  assert.equal(t.c.status().state, 'in');
});

test('drag: carried 1:1 with the floor shadow, release falls from the lift, the spot persists', () => {
  const t = setup();
  t.c.start();
  t.env.advance(32);
  const x0 = W - 79, y0 = H - 40;
  t.c.pointerDown(x0, y0);
  t.c.pointerMove(x0 - 50, y0 - 120);
  assert.equal(t.c.status().state, 'carried');
  assert.equal(t.c.status().bodyX, x0 - 50);
  assert.equal(t.c.status().lift, 120);
  assert.deepEqual(t.carrier.at(-1), carrierTransform(x0 - 50, 120, 2));
  assert.equal(t.shadow.at(-1), 120, 'the strip is pushed back down by the lift');
  assert.ok(t.avatar.calls.includes('pose:carried:surprised:120'));
  t.env.advance(COMPANION.CARRIED_HAPPY_MS + 20);
  assert.ok(t.avatar.calls.some((c) => c.startsWith('pose:carried:happy')), 'happy after 400 ms');
  t.c.pointerMove(x0 - 400, y0 - 300);
  assert.equal(t.c.pointerUp(x0 - 400, y0 - 300), true);
  assert.equal(t.c.status().state, 'airborne');
  assert.equal(t.avatar.calls.at(-1), 'fall:300');
  assert.equal(JSON.parse(t.store.get(COMPANION.STORE_KEY)!).homeFromRight, 79 + 400);
  t.avatar.land();
  assert.equal(t.c.status().state, 'in');
  assert.equal(t.c.status().lift, 0);
  assert.deepEqual(t.carrier.at(-1), carrierTransform(x0 - 400, 0, 2));
  assert.equal(t.c.status().homeX, x0 - 400);
});

test('catch mid-air: pointerdown while airborne cancels the fall and carries from the current height', () => {
  const t = setup();
  t.c.start();
  t.env.advance(32);
  t.c.pointerDown(800, H - 40);
  t.c.pointerMove(800, H - 340);
  t.c.pointerUp(800, H - 340);
  t.avatar.fall!.options.onStep!(180);
  assert.equal(t.c.status().lift, 180);
  t.c.pointerDown(800, H - 220);
  assert.equal(t.c.status().state, 'carried');
  assert.ok(t.avatar.calls.at(-1)!.startsWith('pose:carried') && t.avatar.calls.at(-1)!.endsWith(':180'));
  t.c.pointerMove(800, H - 240);
  assert.equal(t.c.status().lift, 200);
});

test('drag past the edge = deliberate leave to that edge; the home spot is kept', () => {
  const t = setup();
  t.c.start();
  t.env.advance(32);
  const x0 = W - 79;
  t.c.pointerDown(x0, H - 40);
  t.c.pointerMove(W - 1, H - 100);
  t.c.pointerUp(W - 1, H - 100);
  t.avatar.land();
  assert.equal(t.c.status().state, 'leaving');
  t.env.advance(1000);
  assert.equal(t.c.status().state, 'away');
  assert.equal(t.c.status().side, 'right');
  assert.equal(t.c.status().homeFromRight, 79);

  const u = setup();
  u.c.start();
  u.env.advance(32);
  u.c.pointerDown(W - 79, H - 40);
  u.c.pointerMove(2, H - 60);
  assert.equal(u.c.status().bodyX, 2);
  u.c.pointerUp(2, H - 60);
  u.avatar.land();
  u.env.advance(1500);
  assert.equal(u.c.status().state, 'away');
  assert.equal(u.c.status().side, 'left');
  assert.equal(u.c.status().bodyX, sliverX('left', W));
});

test('click on the sliver returns him; a drag pulls him out of it', () => {
  const t = launchedAway();
  t.c.pointerDown(W - 5, H - 40);
  t.c.pointerUp(W - 5, H - 40);
  assert.equal(t.c.status().state, 'returning');
  t.env.advance(COMPANION.HOP_MS + 100);
  assert.equal(t.c.status().state, 'in');
  assert.equal(t.avatar.held, null);

  const u = launchedAway();
  u.c.pointerDown(W - 5, H - 40);
  u.c.pointerMove(W - 300, H - 140);
  assert.equal(u.c.status().state, 'carried');
  assert.equal(u.avatar.held, null, 'the hold is released for the carry');
  u.c.pointerUp(W - 300, H - 140);
  u.avatar.land();
  assert.equal(u.c.status().state, 'in');
  assert.equal(u.c.status().away, false);
});

test('make-room: opening from a spot where the card does not fit slides with the hop; closing rolls back to the spot', () => {
  const t = setup({ stored: JSON.stringify({ version: 1, homeFromRight: W - 100, awaySide: null }) });
  t.c.start();
  t.env.advance(32);
  assert.equal(t.c.status().bodyX, 100);
  t.c.pointerDown(100, H - 40);
  t.c.pointerUp(100, H - 40);
  assert.deepEqual(t.panelCalls, ['toggle']);
  assert.equal(t.c.status().anim, 'room');
  assert.ok(t.avatar.calls.includes('play:hop'));
  assert.ok(!t.avatar.calls.includes('run:click:2'), 'the hop plays while he slides');
  t.env.advance(600);
  assert.equal(t.c.status().bodyX, 345);
  assert.equal(t.c.status().anim, null);
  // close: rolls back to the spot after the panel settles, then the idle timer runs
  t.ui.open = false;
  t.c.panelClosed();
  t.env.advance(32);
  assert.equal(t.c.status().state, 'returning');
  t.env.advance(1500);
  assert.equal(t.c.status().state, 'in');
  assert.equal(t.c.status().bodyX, 100);
  assert.deepEqual(t.c.status().timers, ['idle']);
});

test('make-room from away brings him in; programmatic open from the default spot does not move him', () => {
  const t = launchedAway();
  assert.equal(t.c.makeRoom(), true);
  assert.equal(t.c.status().state, 'in');
  assert.equal(t.c.status().away, false);
  t.env.advance(600);
  assert.equal(t.c.status().bodyX, W - 79);

  const u = setup();
  u.c.start();
  u.env.advance(32);
  assert.equal(u.c.makeRoom(), false);
});

test('panel: no leave while open; closing starts the 20 s idle timer; the pointer near pauses it', () => {
  const t = setup({ open: true });
  t.c.start();
  t.env.advance(32);
  t.env.advance(COMPANION.LEAVE_AFTER_LAUNCH_MS + 30000);
  assert.equal(t.c.status().state, 'in');
  t.ui.open = false;
  t.c.panelClosed();
  t.env.advance(32);
  assert.deepEqual(t.c.status().timers, ['idle']);
  t.c.pointer(W - 79, H - 40);
  assert.deepEqual(t.c.status().timers, []);
  t.env.advance(60000);
  assert.equal(t.c.status().state, 'in');
  t.c.pointer(10, 10);
  t.env.advance(COMPANION.LEAVE_AFTER_IDLE_MS + 100);
  assert.equal(t.c.status().state, 'leaving');
});

test('panel spring settle dispatches kt-companion:moved', () => {
  let active = true;
  const t = setup({ motionActive: () => active });
  t.c.start();
  t.env.advance(32);
  t.c.panelOpened();
  const moved = () => t.events.filter((e) => e.type === 'kt-companion:moved').length;
  const before = moved();
  t.env.advance(100);
  assert.equal(moved(), before);
  active = false;
  t.env.advance(32);
  assert.equal(moved(), before + 1);
  assert.equal(t.c.status().rafActive, false);
});

test('question arrival from away: hop to the perch, question act, wait, ignored -> back with the glyph', () => {
  const t = launchedAway();
  t.ui.question = true;
  t.c.questionsChanged();
  assert.deepEqual(t.states().at(-1), { away: true, question: true }, 'tray "?"');
  assert.equal(t.c.arrive('q1', 'arrival'), true);
  assert.equal(t.c.status().state, 'arriving');
  t.env.advance(COMPANION.HOP_MS + 100);
  const s = t.c.status();
  assert.equal(s.state, 'perched');
  assert.equal(s.bodyX, perchX('right', W), 'the whole canvas is inside: glyph at its authored place');
  assert.ok(t.avatar.calls.includes('hold:{"question":true}'));
  assert.equal(t.avatar.calls.at(-1), 'run:question:0');
  assert.deepEqual(s.timers, ['perch']);
  assert.equal(s.rafActive, false, 'no rAF while perched');
  t.env.advance(COMPANION.PERCH_WAIT_MS + 500);
  assert.equal(t.c.status().state, 'away');
  assert.deepEqual(t.hooks.ignored, ['q1']);
  assert.deepEqual(t.states().at(-1), { away: true, question: true });
});

test('question arrival: refused while in or with the panel open; pointer near the perch brings him in', () => {
  const t = setup();
  t.c.start();
  t.env.advance(32);
  assert.equal(t.c.arrive('q1', 'arrival'), false);

  const u = launchedAway();
  u.c.arrive('q1', 'arrival');
  u.env.advance(COMPANION.HOP_MS + 100);
  u.c.pointer(W - 100, H - 60);
  assert.equal(u.c.status().state, 'returning');
  u.env.advance(COMPANION.HOP_MS + 100);
  assert.equal(u.c.status().state, 'in');
  assert.deepEqual(u.c.status().timers.includes('perch'), false);
});

test('click at the perch opens the panel (user-initiated) and make-room brings him in', () => {
  const t = launchedAway();
  t.c.arrive('q1', 'arrival');
  t.env.advance(COMPANION.HOP_MS + 100);
  t.c.pointerDown(W - 44, H - 40);
  t.c.pointerUp(W - 44, H - 40);
  assert.deepEqual(t.panelCalls, ['open']);
  assert.equal(t.c.status().state, 'in');
  t.env.advance(600);
  assert.equal(t.c.status().bodyX, W - 79);
});

test('commands: toggle-away, return, reset-position (also persisted)', () => {
  const t = setup({ stored: JSON.stringify({ version: 1, homeFromRight: 900, awaySide: null }) });
  t.c.start();
  t.env.advance(32);
  t.c.command('toggle-away');
  assert.equal(t.c.status().state, 'leaving');
  assert.equal(t.c.status().side, 'left', 'nearer edge of his spot');
  t.env.advance(2000);
  assert.equal(t.c.status().state, 'away');
  t.c.command('away');
  assert.equal(t.c.status().state, 'away', 'already away: no-op');
  t.c.command('toggle-away');
  assert.equal(t.c.status().state, 'returning');
  t.env.advance(3000);
  assert.equal(t.c.status().state, 'in');
  assert.equal(t.c.status().bodyX, W - 900);
  t.c.command('reset-position');
  t.env.advance(3000);
  assert.equal(t.c.status().bodyX, W - 79);
  assert.equal(JSON.parse(t.store.get(COMPANION.STORE_KEY)!).homeFromRight, 79);
});

test('command away while the panel is open closes it first', () => {
  const t = setup({ open: true });
  t.c.start();
  t.env.advance(32);
  t.c.command('away');
  assert.deepEqual(t.panelCalls, ['close']);
  t.env.advance(2000);
  assert.equal(t.c.status().state, 'away');
});

test('reduced motion: leave, peek and return jump to their end states without rAF', () => {
  const t = setup({ reduced: true });
  t.c.start();
  t.env.advance(32);
  const before = t.env.rafCount;
  t.c.command('away');
  assert.equal(t.c.status().state, 'away');
  assert.equal(t.c.status().bodyX, sliverX('right', W));
  t.c.pointer(W - 100, H - 60);
  assert.equal(t.c.status().state, 'peeking');
  assert.equal(t.c.status().bodyX, perchX('right', W));
  assert.ok(t.avatar.calls.includes('hold:{}'), 'no gaze under reduced motion');
  t.env.advance(COMPANION.PEEK_DWELL_MS + 50);
  assert.equal(t.c.status().state, 'in');
  assert.equal(t.c.status().bodyX, W - 79);
  assert.equal(t.env.rafCount - before, 0);
});

test('flags: away off = never leaves; drag off = a long press is still a click', () => {
  const t = setup({ flags: { away: false } });
  t.c.start();
  t.env.advance(60000);
  assert.equal(t.c.status().state, 'in');
  t.c.command('away');
  assert.equal(t.c.status().state, 'in');
  assert.equal(t.c.arrive('q', 'arrival'), false);

  const u = setup({ flags: { drag: false } });
  u.c.start();
  u.env.advance(32);
  u.c.pointerDown(500, 500);
  u.c.pointerMove(600, 400);
  assert.equal(u.c.status().state, 'pressed');
  u.c.pointerUp(600, 400);
  assert.deepEqual(u.panelCalls, ['toggle']);
});

test('cursor awareness: look() toward the pointer, quarter only to the right, at most ~4 redraws per second', () => {
  const t = setup();
  t.c.start();
  t.env.advance(32);
  const x = W - 79, y = H - 40;
  t.avatar.calls = [];
  t.c.pointer(x + 60, y);
  assert.deepEqual(t.avatar.calls, ['look:1:quarter']);
  t.c.pointer(x - 60, y);
  t.c.pointer(x + 60, y);
  t.c.pointer(x - 60, y);
  assert.deepEqual(t.avatar.calls, ['look:1:quarter'], 'rate-limited');
  t.env.advance(COMPANION.GAZE_MIN_INTERVAL_MS + 20);
  assert.deepEqual(t.avatar.calls, ['look:1:quarter', 'look:-1:front']);
  t.env.advance(COMPANION.GAZE_MIN_INTERVAL_MS + 20);
  t.c.pointer(x + 500, y - 400);
  assert.equal(t.avatar.calls.at(-1), 'look:0:front', 'front again when far');

  const g = setup({ flags: { gaze: false } });
  g.c.start();
  g.env.advance(32);
  g.avatar.calls = [];
  g.c.pointer(W - 20, H - 40);
  assert.deepEqual(g.avatar.calls, []);
});

test('fidgets: off by default; when on, stretching or peek every 4-8 min only while quiet', () => {
  const t = setup({ flags: { away: false } });
  t.c.start();
  t.env.advance(32);
  t.env.advance(10 * 60 * 1000);
  assert.ok(!t.avatar.calls.some((c) => c === 'play:stretching' || c === 'play:peek'));
  t.c.setFidgets(true);
  assert.equal(JSON.parse(t.store.get(COMPANION.STORE_KEY)!).fidgets, true);
  t.env.advance(COMPANION.FIDGET_MIN_MS + (COMPANION.FIDGET_MAX_MS - COMPANION.FIDGET_MIN_MS) / 2 + 100);
  assert.ok(t.avatar.calls.includes('play:peek') || t.avatar.calls.includes('play:stretching'));
  // never with a glyph showing
  t.ui.question = true;
  t.avatar.calls = [];
  t.env.advance(COMPANION.FIDGET_MAX_MS + 100);
  assert.ok(!t.avatar.calls.some((c) => c === 'play:stretching' || c === 'play:peek'));
});

test('power: lock then unlock reports the time away; area change re-anchors the sliver', () => {
  const t = launchedAway();
  t.c.power('lock-screen');
  t.env.advance(25 * 60 * 1000);
  t.c.power('unlock-screen');
  assert.equal(t.hooks.wakes.length, 1);
  assert.equal(t.hooks.wakes[0]![0], 'unlock-screen');
  assert.ok(t.hooks.wakes[0]![1] >= 25 * 60 * 1000);
  t.ui.width = 1200;
  t.c.area();
  assert.equal(t.c.status().bodyX, sliverX('right', 1200));
  assert.equal(t.avatar.fallDistance, H);
});

test('sent away with the cursor in his corner: no peek until the pointer has left the zone once', () => {
  const t = setup();
  t.c.start();
  t.env.advance(32);
  t.c.pointer(W - 100, H - 60);
  t.c.command('away');
  t.env.advance(2000);
  assert.equal(t.c.status().state, 'away');
  t.c.pointer(W - 90, H - 60);
  assert.equal(t.c.status().state, 'away');
  t.c.pointer(400, 300);
  t.c.pointer(W - 90, H - 60);
  assert.equal(t.c.status().state, 'peeking');
});

test('pointer cancel during a press restores the state; during a carry it drops him', () => {
  const t = launchedAway();
  t.c.pointerDown(W - 5, H - 40);
  assert.equal(t.c.pointerCancel(), true);
  assert.equal(t.c.status().state, 'away');
  assert.equal(t.avatar.calls.at(-1), 'hold:{}');

  const u = setup();
  u.c.start();
  u.env.advance(32);
  u.c.pointerDown(600, H - 40);
  u.c.pointerMove(600, H - 140);
  u.c.pointerCancel();
  assert.equal(u.avatar.calls.at(-1), 'fall:100');
});

test('every carrier move dispatches kt-companion:moved; nothing runs after destroy', () => {
  const t = setup();
  t.c.start();
  const moved = t.events.filter((e) => e.type === 'kt-companion:moved').length;
  assert.equal(moved, t.carrier.length);
  t.c.destroy();
  t.env.advance(10000);
  assert.equal(t.env.rafs.size, 0);
  assert.equal(t.env.timers.size, 0);
});
