/**
 * desktop (R31..R36): the companion state machine. Snowbally lives at the edge of the work area
 * ("away is home"), comes in when the pointer comes near his edge, when a question arrives or when
 * asked (tray, shortcut, click), can be picked up and dropped anywhere on the floor, and remembers
 * that spot.
 *
 * One machine, one state at a time:
 *   launching -> in -> pressed -> (click | carried) -> airborne -> landing -> in
 *   in -> leaving -> away -> peeking -> (returning -> in | away)
 *   away -> arriving(question) -> perched -> (returning -> in | leaving -> away)
 *
 * The carrier is `.rf-window` (the v008 card, which contains `.rf-avatar`): a desktop CSS rule
 * anchors it at `left:0; bottom:0` and only this module moves it, by translate3d rounded to whole
 * device pixels. The card and Snowbally always move together.
 *
 * `createCompanion()` is DOM-less: the clock, rAF, storage, avatar, panel hooks and the render
 * sinks are injected (unit-tested with fakes). `attachCompanion()` binds the DOM events to it.
 */
import type { CompanionAvatar } from '../motion/avatar.ts';
import { rollAt } from '../motion/physics.ts';
import { SETTLE_FRAME_MS } from '../motion/poses.ts';
import type { HeldSpec } from '../motion/poses.ts';

export type CompanionState = 'launching' | 'in' | 'pressed' | 'carried' | 'airborne' | 'landing' | 'leaving' | 'away' | 'peeking' | 'arriving' | 'perched' | 'returning';
export type Side = 'left' | 'right';
export type CompanionCommand = 'away' | 'return' | 'toggle-away' | 'reset-position';
export type CompanionPower = 'resume' | 'unlock-screen' | 'lock-screen';
export type TravelMotion = 'roll' | 'hop';

/** desktop (R31..R36): every timing and distance of the companion, in one place (DECISIONS R31-R36). */
export const COMPANION = {
  /** R33: after the launch fall + hello he leaves after this long (unless the pointer is near / panel open). */
  LEAVE_AFTER_LAUNCH_MS: 4000,
  /** R33: he leaves after this long without interaction (pointer out of his zone, no drag, panel closed); closing the panel starts it. */
  LEAVE_AFTER_IDLE_MS: 20000,
  /** R33: a peek that the pointer abandons goes back to the sliver after this long. */
  PEEK_RETREAT_MS: 1500,
  /** R33: pointer dwell in the zone that turns a peek into a return. */
  PEEK_DWELL_MS: 400,
  /** R33: pointer this close to him while peeking = return at once. */
  PEEK_NEAR_PX: 60,
  /** R34: how long he waits at the perch with a new question. */
  PERCH_WAIT_MS: 90000,
  /** R33: proximity zone radius (window CSS px). */
  PROXIMITY_PX: 160,
  /** R32: movement that turns a press into a drag. */
  DRAG_THRESHOLD_PX: 4,
  /** R32: a quick tap (< ms) may wobble up to px and still be a click. */
  TAP_ALLOWANCE: { ms: 180, px: 8 },
  /** R32: carried face: surprised at lift-off, happy after this long. */
  CARRIED_HAPPY_MS: 400,
  /** Springy tap on a click (authored act, no jump). While one plays (TAP_HOLD_MS, slightly shorter than the act) further clicks still toggle but the next tap is queued, not cut (spam-clicking looked laggy). */
  TAP_HOLD_MS: 450,
  /** R33: leaving rolls out; returning / arriving hops in (each direction one constant). */
  LEAVE_MOTION: 'roll' as TravelMotion,
  RETURN_MOTION: 'hop' as TravelMotion,
  /** R33: the hop act (16 fps, 18 frames) and its airborne frames 4..10 (frame 11 = the touchdown squash: no sideways slide on the floor). */
  HOP_MS: 1125,
  HOP_AIR_MS: [250, 687.5] as const,
  /** R33: the longest single hop; a longer way in rolls first and hops the last stretch. */
  HOP_REACH_PX: 200,
  /** R33: the panel's own open spring (critically damped) for the make-room slide and the peek. */
  SLIDE_OMEGA: 40,
  /** R35: cursor awareness: at most one redraw per this interval; hysteresis on / off distances. */
  GAZE_MIN_INTERVAL_MS: 250,
  GAZE_ON_PX: 24,
  GAZE_OFF_PX: 12,
  /** R35: fidgets (off by default, flags.fidgets): one per 4-8 min, stretching or peek only. */
  fidgets: false,
  FIDGET_MIN_MS: 4 * 60 * 1000,
  FIDGET_MAX_MS: 8 * 60 * 1000,
  STORE_KEY: 'kt-companion.v1',
  /**
   * R33 (ux fix M2): a travel / slide / watcher / fall that gets no frame for this long is completed
   * at once in its end state (frames starved: niced launch, occluded or hidden window).
   */
  FRAME_WATCHDOG_MS: 1000,
  /** R33 (ux fix M2): on focus / visible / pageshow, a job whose last frame is older than this is completed. */
  RESUME_STALE_MS: 250,
} as const;

/**
 * desktop (R31): geometry in window CSS px. bodyX = his body centre. The card (380 px) has the
 * avatar at `right:15px`, the 88 px canvas at `left:-12px` inside the 64 px button, the body centre
 * at canvas x 44: card left = bodyX - 333. Card bottom = 30 + lift puts the canvas bottom on the
 * window bottom and his contact row 12 px above it (the floor).
 */
export const GEOMETRY = {
  CARD_OFFSET_PX: 333,
  CARD_BOTTOM_PX: 30,
  /** Make-room range: the card fits when CARD_MIN_X <= bodyX <= W - CARD_RIGHT_INSET (12 px margins). */
  CARD_MIN_X: 345,
  CARD_RIGHT_INSET: 59,
  /** Half the kit body (28 art px x 2) and half the display canvas (88 / 2). */
  BODY_HALF_PX: 28,
  CANVAS_HALF_PX: 44,
  /** Away: this much of his body stays inside the window. */
  SLIVER_PX: 12,
  /** Default home: today's spot, work-area width - 79. */
  HOME_FROM_RIGHT: 59 /* desktop (ux): just inside where the card fits, so he does not travel away from the cursor when he comes in */,
  /** A dropped home spot is clamped to [14, W - 14]. */
  HOME_CLAMP_PX: 14,
  /** Body centre height above the window bottom (12 px floor + half the body). */
  BODY_CENTER_Y_PX: 40,
  /** The pointer pinned to the outermost px of the screen counts as a push past that edge. */
  EDGE_PIN_PX: 4,
  /** Highest carry: keep the drop surface inside the window. */
  TOP_MARGIN_PX: 120,
} as const;

const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const roundDp = (v: number, dpr: number): number => {
  const d = Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
  return Math.round(v * d) / d;
};

export const homeXFor = (width: number, homeFromRight: number): number => clamp(width - homeFromRight, GEOMETRY.HOME_CLAMP_PX, Math.max(GEOMETRY.HOME_CLAMP_PX, width - GEOMETRY.HOME_CLAMP_PX));
export const sliverX = (side: Side, width: number): number => (side === 'right' ? width + GEOMETRY.BODY_HALF_PX - GEOMETRY.SLIVER_PX : -GEOMETRY.BODY_HALF_PX + GEOMETRY.SLIVER_PX);
export const perchX = (side: Side, width: number): number => (side === 'right' ? width - GEOMETRY.CANVAS_HALF_PX : GEOMETRY.CANVAS_HALF_PX);
export const edgeX = (side: Side, width: number): number => (side === 'right' ? width : 0);
/** The nearest bodyX at which the card fits (the card is never mirrored). */
export const roomX = (x: number, width: number): number => Math.min(Math.max(x, GEOMETRY.CARD_MIN_X), width - GEOMETRY.CARD_RIGHT_INSET);
export const fitsCard = (x: number, width: number): boolean => Math.abs(roomX(x, width) - x) < 0.5;
export const nearerSide = (x: number, width: number): Side => (x >= width / 2 ? 'right' : 'left');

/** Carrier translate (card left, card bottom above the window bottom), rounded to whole device pixels. */
export function carrierTransform(bodyX: number, lift: number, dpr: number): { x: number; y: number } {
  return { x: roundDp(bodyX - GEOMETRY.CARD_OFFSET_PX, dpr), y: roundDp(GEOMETRY.CARD_BOTTOM_PX + Math.max(0, lift), dpr) };
}

/** A deliberate push past a side edge: his centre (more than half his body) beyond it, or the pointer pinned to it. */
export function pushedSide(bodyX: number, pointerX: number, width: number): Side | null {
  if (bodyX > width || pointerX >= width - GEOMETRY.EDGE_PIN_PX) return 'right';
  if (bodyX < 0 || pointerX <= GEOMETRY.EDGE_PIN_PX - 1) return 'left';
  return null;
}

/** Pointer near the sliver: within PROXIMITY_PX of the edge horizontally and of floor level vertically. */
export function inEdgeZone(side: Side, width: number, height: number, px: number, py: number, radius: number = COMPANION.PROXIMITY_PX): boolean {
  const dx = side === 'right' ? width - px : px;
  return dx >= -radius && dx <= radius && Math.abs(py - (height - GEOMETRY.BODY_CENTER_Y_PX)) <= radius;
}

/** Pointer within `radius` of his body centre. */
export function nearBody(bodyX: number, lift: number, height: number, px: number, py: number, radius: number = COMPANION.PROXIMITY_PX): boolean {
  const dx = px - bodyX;
  const dy = py - (height - GEOMETRY.BODY_CENTER_Y_PX - lift);
  return dx * dx + dy * dy <= radius * radius;
}

/** Press vs drag: beyond DRAG_THRESHOLD_PX is a drag, except a quick tap within TAP_ALLOWANCE. */
export function classifyGesture(distPx: number, elapsedMs: number): 'press' | 'drag' {
  if (distPx <= COMPANION.DRAG_THRESHOLD_PX) return 'press';
  if (elapsedMs < COMPANION.TAP_ALLOWANCE.ms && distPx <= COMPANION.TAP_ALLOWANCE.px) return 'press';
  return 'drag';
}

/** Gaze with hysteresis: turn at GAZE_ON_PX, come back to front inside GAZE_OFF_PX. */
export function nextGaze(current: -1 | 0 | 1, dx: number, near: boolean): -1 | 0 | 1 {
  if (!near) return 0;
  if (current === 1 && dx >= COMPANION.GAZE_OFF_PX) return 1;
  if (current === -1 && dx <= -COMPANION.GAZE_OFF_PX) return -1;
  if (dx > COMPANION.GAZE_ON_PX) return 1;
  if (dx < -COMPANION.GAZE_ON_PX) return -1;
  return current !== 0 && Math.abs(dx) >= COMPANION.GAZE_OFF_PX ? current : 0;
}

export interface Placement {
  version: 1;
  homeFromRight: number;
  awaySide: Side | null;
  /** Settings row "Fidgets"; absent = the flag default. */
  fidgets?: boolean;
}

export function loadPlacement(storage: Pick<Storage, 'getItem'> | null): Placement {
  const fresh: Placement = { version: 1, homeFromRight: GEOMETRY.HOME_FROM_RIGHT, awaySide: null };
  try {
    const raw = JSON.parse(storage?.getItem(COMPANION.STORE_KEY) ?? 'null') as Partial<Placement> | null;
    if (!raw || raw.version !== 1) return fresh;
    const h = typeof raw.homeFromRight === 'number' && Number.isFinite(raw.homeFromRight) ? raw.homeFromRight : fresh.homeFromRight;
    const side = raw.awaySide === 'left' || raw.awaySide === 'right' ? raw.awaySide : null;
    return { version: 1, homeFromRight: h, awaySide: side, ...(typeof raw.fidgets === 'boolean' ? { fidgets: raw.fidgets } : {}) };
  } catch {
    return fresh;
  }
}

export interface CompanionFlags {
  companion: boolean;
  drag: boolean;
  away: boolean;
  gaze: boolean;
  fidgets: boolean;
  windowMode?: string;
}

export interface CompanionClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(id: unknown): void;
}
export interface CompanionRaf {
  request(cb: (t: number) => void): number;
  cancel(id: number): void;
}

export interface CompanionPanelHooks {
  isOpen(): boolean;
  /** Toggle the panel for a direct click (user-initiated). */
  toggle(): void;
  /** Open for a user action (e.g. a click on him at the perch). */
  open(): void;
  close(): void;
  busy(): boolean;
  /** panel-motion still animating (the spring has not settled). */
  motionActive(): boolean;
  /** An unseen question is waiting (attention). */
  hasQuestion(): boolean;
}

export interface CompanionRender {
  /** Write the carrier transform (already device-pixel rounded). */
  carrier(x: number, y: number): void;
  /** Keep the `.rf-shadow` strip on the floor while he is lifted by `lift` px. */
  shadow(lift: number): void;
  /** Carrying started / ended (grabbing cursor). */
  carried(on: boolean): void;
}

export interface CompanionDeps {
  avatar: CompanionAvatar;
  flags: CompanionFlags;
  panel: CompanionPanelHooks;
  render: CompanionRender;
  area(): { width: number; height: number };
  dpr(): number;
  reduced(): boolean;
  storage: Pick<Storage, 'getItem' | 'setItem'> | null;
  emit(type: string, detail?: unknown): void;
  clock?: CompanionClock;
  raf?: CompanionRaf;
  random?: () => number;
  /** He came back in (refresh questions now). */
  onReturn?(): void;
  /** Unlock / resume, with how long the person was away (ms). */
  onWake?(event: CompanionPower, awayForMs: number): void;
  /** He waited at the perch with `id` and nobody came. */
  onIgnored?(id: string): void;
}

export interface CompanionStatus {
  state: CompanionState;
  bodyX: number;
  lift: number;
  away: boolean;
  side: Side;
  pointerNear: boolean;
  homeFromRight: number;
  homeX: number;
  rafActive: boolean;
  timers: string[];
  anim: string | null;
  fidgets: boolean;
  question: string | null;
}

export interface Companion {
  /** Place the carrier at home and set the fall distance; call before playEntranceThenRest. */
  start(options?: { entrance?: boolean }): void;
  pointerDown(x: number, y: number): boolean;
  pointerMove(x: number, y: number): void;
  /** Returns true when the native click that follows must be suppressed. */
  pointerUp(x: number, y: number): boolean;
  pointerCancel(): boolean;
  /** Pointer position anywhere in the window (null = left the window). */
  pointer(x: number | null, y?: number): void;
  contextMenu(): void;
  command(command: CompanionCommand): void;
  power(event: CompanionPower): void;
  /** Work area changed: re-clamp and re-anchor. */
  area(): void;
  /** Before the panel opens: bring him in / slide to where the card fits. Returns true when he moves. */
  makeRoom(): boolean;
  panelOpened(): void;
  panelClosed(): void;
  /** The unseen-question state may have changed (re-emits `kt-companion:state` when it did). */
  questionsChanged(): void;
  /** Window focus / visible / pageshow: complete any motion whose frames stopped (ux fix M2). */
  resume(): void;
  /** A question wants him (arrival / reminder); true when he goes (only from away). */
  arrive(id: string, kind: 'arrival' | 'reminder'): boolean;
  setFidgets(on: boolean): void;
  fidgets(): boolean;
  status(): CompanionStatus;
  destroy(): void;
}

const AWAY_STATES: ReadonlySet<CompanionState> = new Set<CompanionState>(['leaving', 'away', 'peeking', 'arriving', 'perched']);
const EDGE_STATES: ReadonlySet<CompanionState> = new Set<CompanionState>(['away', 'peeking', 'arriving', 'perched', 'leaving', 'returning']);

const defaultClock: CompanionClock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id as ReturnType<typeof setTimeout>),
};
const defaultRaf: CompanionRaf = {
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
};

export function createCompanion(deps: CompanionDeps): Companion {
  const { avatar, flags, panel, render } = deps;
  const clock = deps.clock ?? defaultClock;
  const raf = deps.raf ?? defaultRaf;
  const random = deps.random ?? Math.random;
  const awayOn = flags.away;

  const saved = loadPlacement(deps.storage);
  let homeFromRight = saved.homeFromRight;
  let side: Side = saved.awaySide ?? 'right';
  let fidgetsOn = saved.fidgets ?? flags.fidgets;
  /** fidelity-05: only a Settings choice is stored; otherwise the FIDGETS flag stays the reversing switch. */
  let fidgetsExplicit = saved.fidgets !== undefined;

  let W = 0;
  let H = 0;
  const readArea = (): void => {
    const a = deps.area();
    W = Math.max(1, a.width);
    H = Math.max(1, a.height);
  };
  readArea();

  let st: CompanionState = 'in';
  let bodyX = homeXFor(W, homeFromRight);
  let lift = 0;
  let ptr: { x: number; y: number } | null = null;
  let pointerNear = false;
  /** R33: after he leaves, the pointer must be outside his zone once before it can make him peek. */
  let peekArmed = false;
  let zoneSince = 0;
  let gazeShown: -1 | 0 | 1 = 0;
  let gazeWanted: -1 | 0 | 1 = 0;
  let gazeAt = -Infinity;
  let perchedId: string | null = null;
  let lockedAt: number | null = null;
  let lastAlive = clock.now();
  let tapUntil = 0;
  let tapQueued = false;
  /** The Springy tap from its squash frame. A click while one plays queues exactly one more tap after it (never cut mid-way). */
  const tap = (): void => {
    const now = clock.now();
    if (now < tapUntil) {
      tapQueued = true;
      return;
    }
    tapUntil = now + COMPANION.TAP_HOLD_MS;
    tapQueued = false;
    avatar.run('click', 2);
    timer('tap', COMPANION.TAP_HOLD_MS, () => {
      if (!tapQueued || destroyed || st !== 'in') return;
      tapQueued = false;
      tap();
    });
  };
  let lastState = { away: false, question: false };
  let destroyed = false;
  /** A gesture cancelled internally (command / lock): the native pointerup + click that follow are swallowed. */
  let swallowUp = false;
  /** goHome() started from an edge state and has not called onReturn yet. */
  let returningFromEdge = false;
  /** Bumped on every release / catch: callbacks of an older fall are ignored. */
  let fallToken = 0;
  let fallStepAt = 0;
  let fallForce: (() => void) | null = null;

  interface Gesture { x0: number; y0: number; t0: number; bodyX0: number; lift0: number; from: CompanionState; lastX: number; gaze: -1 | 0 | 1; happy: boolean; pointerX: number }
  let gesture: Gesture | null = null;

  // ---- timers and rAF (named slots; nothing runs while idle, away or perched except the perch wait) ----
  const timers = new Map<string, unknown>();
  const timer = (name: string, ms: number, fn: () => void): void => {
    clear(name);
    timers.set(name, clock.setTimeout(() => {
      timers.delete(name);
      if (!destroyed) fn();
    }, ms));
  };
  const clear = (...names: string[]): void => {
    for (const n of names) {
      if (timers.has(n)) {
        clock.clearTimeout(timers.get(n));
        timers.delete(n);
      }
    }
  };
  const clearAll = (): void => {
    for (const id of timers.values()) clock.clearTimeout(id);
    timers.clear();
  };

  let animId = 0;
  let animKind: string | null = null;
  /** The running rAF job: `finish` puts the end state (position) in place when its frames stop. */
  interface Job { finish: () => void; done?: () => void }
  let job: Job | null = null;
  let lastTick = clock.now();
  const watchers = new Map<string, { id: number; then: () => void }>();
  /**
   * ux fix M2: a frame watchdog, armed while a job or watcher runs and re-armed on every frame. When
   * no rAF tick arrives for FRAME_WATCHDOG_MS (a starved / suspended renderer) everything pending is
   * completed at once in its end state, like the reduced-motion paths.
   */
  const armWatchdog = (): void => {
    lastTick = clock.now();
    timer('frame-watchdog', COMPANION.FRAME_WATCHDOG_MS, flush);
  };
  const syncWatchdog = (): void => {
    if (!job && watchers.size === 0) clear('frame-watchdog');
  };
  const stopAnim = (): void => {
    if (animId) raf.cancel(animId);
    animId = 0;
    animKind = null;
    job = null;
    syncWatchdog();
  };
  /** One rAF job at a time: `step(elapsedMs)` returns true when done; `finish` jumps to its end (watchdog). */
  const animate = (kind: string, step: (elapsed: number, dt: number) => boolean, done?: () => void, finish: () => void = () => {}): void => {
    stopAnim();
    animKind = kind;
    const j: Job = { finish, done };
    job = j;
    let t0: number | undefined;
    let prev: number | undefined;
    const frame = (t: number): void => {
      animId = 0;
      if (destroyed || job !== j) return;
      t0 ??= t;
      const dt = prev === undefined ? 1 / 60 : Math.min(0.032, Math.max(0, (t - prev) / 1000));
      prev = t;
      if (step(t - t0, dt)) {
        job = null;
        animKind = null;
        syncWatchdog();
        done?.();
        return;
      }
      armWatchdog();
      animId = raf.request(frame);
    };
    armWatchdog();
    animId = raf.request(frame);
  };
  // Independent watchers ('launch' end, 'panel' spring settle): poll once per frame only while they run.
  const watch = (name: string, until: () => boolean, then: () => void): void => {
    stopWatch(name);
    const frame = (): void => {
      watchers.delete(name);
      if (destroyed) return;
      if (until()) {
        syncWatchdog();
        then();
        return;
      }
      watchers.set(name, { id: raf.request(frame), then });
      armWatchdog();
    };
    watchers.set(name, { id: raf.request(frame), then });
    armWatchdog();
  };
  const stopWatch = (...names: string[]): void => {
    for (const n of names.length ? names : [...watchers.keys()]) {
      const w = watchers.get(n);
      if (w) raf.cancel(w.id);
      watchers.delete(n);
    }
    syncWatchdog();
  };
  /** ux fix M2: complete the running job (and any job its `done` chains) and every watcher now. */
  function flush(): void {
    clear('frame-watchdog');
    for (let n = 0; n < 16 && !destroyed && (job || watchers.size > 0); n++) {
      const j = job;
      if (j) {
        if (animId) raf.cancel(animId);
        animId = 0;
        animKind = null;
        job = null;
        j.finish();
        j.done?.();
        continue;
      }
      const [name, w] = [...watchers][0]!;
      raf.cancel(w.id);
      watchers.delete(name);
      w.then();
    }
    syncWatchdog();
  }
  /** ux fix M2: focus / visible / pageshow: whatever stopped getting frames completes now. */
  function resume(): void {
    if (destroyed) return;
    const now = clock.now();
    if ((job || watchers.size > 0) && now - lastTick > COMPANION.RESUME_STALE_MS) flush();
    if (fallForce && st === 'airborne' && now - fallStepAt > COMPANION.RESUME_STALE_MS) fallForce();
  }

  // ---- geometry and output ----
  const homeX = (): number => homeXFor(W, homeFromRight);
  const persist = (): void => {
    try {
      deps.storage?.setItem(COMPANION.STORE_KEY, JSON.stringify({ version: 1, homeFromRight, awaySide: AWAY_STATES.has(st) ? side : null, ...(fidgetsExplicit ? { fidgets: fidgetsOn } : {}) } satisfies Placement));
    } catch {
      /* optional */
    }
  };
  const place = (x: number, l: number = lift): void => {
    bodyX = x;
    lift = Math.max(0, l);
    const p = carrierTransform(bodyX, lift, deps.dpr());
    render.carrier(p.x, p.y);
    render.shadow(p.y - GEOMETRY.CARD_BOTTOM_PX);
    deps.emit('kt-companion:moved');
  };
  const isAway = (): boolean => AWAY_STATES.has(st);
  const emitState = (): void => {
    if (destroyed) return;
    const next = { away: isAway(), question: panel.hasQuestion() };
    if (next.away === lastState.away && next.question === lastState.question) return;
    lastState = next;
    deps.emit('kt-companion:state', { ...next });
  };
  const setState = (s: CompanionState): void => {
    if (s === st) return;
    const was = st;
    st = s;
    if (was === 'in') {
      clear('idle', 'gaze', 'fidget');
      gazeShown = 0;
      gazeWanted = 0;
    }
    if (s === 'in') {
      syncIdle();
      armFidget();
    }
    if (AWAY_STATES.has(s) !== AWAY_STATES.has(was)) persist();
    emitState();
  };
  const heldSpec = (gaze = 0): HeldSpec => {
    const g = deps.reduced() || !flags.gaze ? 0 : gaze;
    return g ? { gaze: g, view: g > 0 ? 'quarter' : 'front' } : {};
  };
  /**
   * ux fix M3 (R33 deviation): the authored question glyph sits right of his body, so on the RIGHT
   * sliver it would be outside the window. That one still (tucked at the right edge) draws the
   * authored glyph rects mirrored to the left of the body; the glyph is shown only while a question
   * is unseen (the avatar's hasQuestion), every other still keeps the authored place.
   */
  const awaySpec = (): HeldSpec => (side === 'right' ? { ...heldSpec(), glyphSide: 'left' } : heldSpec());

  // ---- leave timer (R33: LEAVE_AFTER_IDLE_MS without interaction; launch uses its own delay) ----
  const canLeave = (): boolean => awayOn && st === 'in' && !panel.isOpen() && !gesture && !pointerNear;
  function syncIdle(ms: number = COMPANION.LEAVE_AFTER_IDLE_MS, restart = false): void {
    if (!canLeave()) {
      clear('idle');
      return;
    }
    if (timers.has('idle') && !restart) return;
    timer('idle', ms, () => {
      if (!canLeave()) return;
      if (panel.busy()) {
        syncIdle();
        return;
      }
      leave();
    });
  }

  // ---- fidgets (R35; off by default) ----
  function armFidget(): void {
    clear('fidget');
    if (!fidgetsOn || st !== 'in') return;
    const ms = COMPANION.FIDGET_MIN_MS + random() * (COMPANION.FIDGET_MAX_MS - COMPANION.FIDGET_MIN_MS);
    timer('fidget', ms, () => {
      const quiet = st === 'in' && !panel.isOpen() && !pointerNear && !panel.hasQuestion() && !deps.reduced() && !gesture && !animKind && !avatar.status().reactionPlaying;
      if (quiet) avatar.play(random() < 0.5 ? 'stretching' : 'peek');
      armFidget();
    });
  }

  // ---- travel ----
  /** Roll (tuck + turn per 22 px, speed-limited) on the display canvas to `to`. */
  function roll(to: number, done: () => void): void {
    const from = bodyX;
    const d = to - from;
    if (deps.reduced() || Math.abs(d) < 1) {
      place(to, 0);
      done();
      return;
    }
    animate('roll', (ms) => {
      const r = rollAt(d, ms);
      avatar.pose({ kind: 'roll', turn: r.turn });
      place(from + r.x, 0);
      return r.done;
    }, done, () => place(to, 0));
  }
  /** One hop (the authored act on the drop surface) carrying him sideways during its airborne frames. */
  function hop(to: number, done: () => void): void {
    const from = bodyX;
    if (deps.reduced() || Math.abs(to - from) < 1) {
      place(to, 0);
      done();
      return;
    }
    avatar.run('hop');
    const [a, b] = COMPANION.HOP_AIR_MS;
    animate('hop', (ms) => {
      const p = clamp((ms - a) / (b - a), 0, 1);
      place(from + (to - from) * p * p * (3 - 2 * p), 0);
      return ms >= COMPANION.HOP_MS;
    }, done, () => place(to, 0));
  }
  function travel(to: number, motion: TravelMotion, done: () => void): void {
    if (motion === 'roll' || deps.reduced()) {
      roll(to, done);
      return;
    }
    const d = to - bodyX;
    if (Math.abs(d) <= COMPANION.HOP_REACH_PX) {
      hop(to, done);
      return;
    }
    roll(to - Math.sign(d) * COMPANION.HOP_REACH_PX, () => hop(to, done));
  }
  /** Critically damped spring (the panel's open spring) to `to`; the pose is the caller's. */
  function slide(kind: string, to: number, done?: () => void): void {
    if (deps.reduced()) {
      place(to, 0);
      done?.();
      return;
    }
    let v = 0;
    const omega = COMPANION.SLIDE_OMEGA;
    animate(kind, (_ms, dt) => {
      const d = bodyX - to;
      const b = v + omega * d;
      const e = Math.exp(-omega * dt);
      const x = to + (d + b * dt) * e;
      v = (v - omega * b * dt) * e;
      if (Math.abs(x - to) < 0.5 && Math.abs(v) < 15) {
        place(to, 0);
        return true;
      }
      place(x, 0);
      return false;
    }, done, () => place(to, 0));
  }
  /** Two-frame settle (crouch, low) moving to `to`, then `done`. */
  function tuck(to: number, done: () => void): void {
    const from = bodyX;
    if (deps.reduced()) {
      place(to, 0);
      done();
      return;
    }
    let frame = -1;
    animate('tuck', (ms) => {
      const i = Math.floor(ms / SETTLE_FRAME_MS);
      if (i >= 2) {
        place(to, 0);
        return true;
      }
      if (i !== frame) {
        frame = i;
        avatar.pose({ kind: 'settle', frame: i });
        place(i === 0 ? from + (to - from) / 2 : to, 0);
      }
      return false;
    }, done, () => place(to, 0));
  }

  // ---- leaving / away / returning ----
  function toAway(): void {
    stopAnim();
    place(sliverX(side, W), 0);
    perchedId = null;
    setState('away');
    pointerNear = nearNow();
    peekArmed = !pointerNear;
    avatar.hold(awaySpec());
  }
  function leave(to: Side = nearerSide(bodyX, W)): void {
    if (!awayOn || destroyed) return;
    clear('idle', 'gaze', 'fidget', 'dwell', 'retreat', 'perch');
    stopWatch('launch', 'panel');
    side = to;
    setState('leaving');
    const perch = perchX(side, W);
    const sliver = sliverX(side, W);
    if (deps.reduced()) {
      toAway();
      return;
    }
    const outward = side === 'right' ? bodyX >= perch : bodyX <= perch;
    const tuckIn = (): void => tuck(sliver, toAway);
    if (outward) tuckIn();
    else if (COMPANION.LEAVE_MOTION === 'roll') roll(perch, tuckIn);
    else travel(perch, COMPANION.LEAVE_MOTION, tuckIn);
  }
  function goHome(options: { hello?: boolean; open?: boolean } = {}): void {
    clear('idle', 'dwell', 'retreat', 'perch');
    stopWatch('launch', 'panel');
    const fromEdge = EDGE_STATES.has(st) && (st !== 'returning' || returningFromEdge);
    returningFromEdge = fromEdge;
    setState('returning');
    avatar.hold(null);
    const finish = (): void => {
      setState('in');
      if (options.hello !== false) avatar.play('hello');
      if (returningFromEdge) {
        returningFromEdge = false;
        deps.onReturn?.();
      }
      if (options.open && !panel.isOpen()) panel.open();
      syncIdle(COMPANION.LEAVE_AFTER_IDLE_MS, true);
    };
    travel(panel.isOpen() || options.open ? roomX(homeX(), W) : homeX(), COMPANION.RETURN_MOTION, finish);
  }
  function peek(): void {
    clear('retreat');
    setState('peeking');
    zoneSince = clock.now();
    timer('dwell', COMPANION.PEEK_DWELL_MS, () => {
      if (st === 'peeking' && pointerNear) goHome({ hello: true });
    });
    avatar.hold(heldSpec(peekGaze()));
    slide('peek', perchX(side, W));
  }
  const peekGaze = (): number => (ptr ? Math.sign(ptr.x - bodyX) : side === 'right' ? -1 : 1);
  function retreat(): void {
    if (!(st === 'peeking' || st === 'perched')) return;
    stopAnim();
    setState('leaving');
    tuck(sliverX(side, W), toAway);
  }

  // ---- launch ----
  function launched(): void {
    if (st !== 'launching') return;
    setState('in');
    if (canLeave()) syncIdle(COMPANION.LEAVE_AFTER_LAUNCH_MS, true);
  }

  // ---- proximity and gaze ----
  const nearNow = (): boolean => {
    if (!ptr) return false;
    if (EDGE_STATES.has(st) && st !== 'returning') return inEdgeZone(side, W, H, ptr.x, ptr.y);
    return nearBody(bodyX, lift, H, ptr.x, ptr.y);
  };
  function applyGaze(): void {
    if (st !== 'in' || !flags.gaze || deps.reduced() || !ptr) {
      gazeWanted = 0;
    } else {
      gazeWanted = nextGaze(gazeWanted, ptr.x - bodyX, pointerNear);
    }
    const shown = avatar.status().mode === 'look' ? gazeShown : 0;
    if (gazeWanted === shown) return;
    const wait = gazeAt + COMPANION.GAZE_MIN_INTERVAL_MS - clock.now();
    if (wait > 0) {
      if (!timers.has('gaze')) timer('gaze', wait, applyGaze);
      return;
    }
    gazeAt = clock.now();
    if (avatar.look(gazeWanted, gazeWanted > 0 ? 'quarter' : 'front')) gazeShown = gazeWanted;
  }

  function pointer(x: number | null, y = 0): void {
    if (destroyed) return;
    ptr = x === null ? null : { x, y };
    lastAlive = clock.now();
    if (gesture) return;
    const was = pointerNear;
    pointerNear = nearNow();
    switch (st) {
      case 'in':
        if (pointerNear !== was) syncIdle(COMPANION.LEAVE_AFTER_IDLE_MS, true);
        if (flags.gaze && (pointerNear || was || gazeShown !== 0)) applyGaze();
        break;
      case 'away':
        if (!pointerNear) peekArmed = true;
        else if (peekArmed && awayOn) peek();
        break;
      case 'peeking':
        if (pointerNear && !was) {
          clear('retreat');
          zoneSince = clock.now();
          timer('dwell', COMPANION.PEEK_DWELL_MS, () => {
            if (st === 'peeking' && pointerNear) goHome({ hello: true });
          });
        } else if (!pointerNear && was) {
          clear('dwell');
          timer('retreat', COMPANION.PEEK_RETREAT_MS, retreat);
        }
        if (ptr && pointerNear && nearBody(bodyX, 0, H, ptr.x, ptr.y, COMPANION.PEEK_NEAR_PX)) goHome({ hello: true });
        else if (pointerNear && clock.now() - zoneSince >= COMPANION.PEEK_DWELL_MS) goHome({ hello: true });
        else if (pointerNear && clock.now() - gazeAt >= COMPANION.GAZE_MIN_INTERVAL_MS) {
          gazeAt = clock.now();
          avatar.hold(heldSpec(peekGaze()));
        }
        break;
      case 'perched':
        if (pointerNear) goHome({ hello: true });
        break;
      default:
        break;
    }
  }

  // ---- gesture ----
  function pointerDown(x: number, y: number): boolean {
    if (destroyed) return false;
    const caught = st === 'airborne';
    const from = st;
    clear('idle', 'gaze', 'dwell', 'retreat', 'happy', 'perch', 'fall');
    stopAnim();
    stopWatch('launch');
    swallowUp = false;
    fallToken++;
    fallForce = null;
    const l = caught ? lift : 0;
    gesture = { x0: x, y0: y, t0: clock.now(), bodyX0: bodyX, lift0: l, from, lastX: x, gaze: 0, happy: false, pointerX: x };
    if (caught) {
      startCarry();
      return true;
    }
    if (clock.now() >= tapUntil) avatar.pose({ kind: 'press' }); // a tap still playing is not cut by the next press
    st = 'pressed';
    emitState();
    return true;
  }
  function startCarry(): void {
    if (!gesture) return;
    if (avatar.status().held) avatar.hold(null);
    perchedId = null;
    clear('perch');
    st = 'carried';
    emitState();
    render.carried(true);
    gesture.happy = false;
    avatar.pose({ kind: 'carried', happy: false, gaze: 0, lift: gesture.lift0 });
    timer('happy', COMPANION.CARRIED_HAPPY_MS, () => {
      if (st !== 'carried' || !gesture) return;
      gesture.happy = true;
      avatar.pose({ kind: 'carried', happy: true, gaze: gesture.gaze, lift });
    });
  }
  function pointerMove(x: number, y: number): void {
    const g = gesture;
    if (!g) return;
    const dx = x - g.x0;
    const dy = y - g.y0;
    g.pointerX = x;
    if (st === 'pressed') {
      if (!flags.drag || classifyGesture(Math.hypot(dx, dy), clock.now() - g.t0) === 'press') return;
      startCarry();
    }
    if (st !== 'carried') return;
    const vx = x - g.lastX;
    g.lastX = x;
    if (Math.abs(vx) >= 1) g.gaze = vx > 0 ? 1 : -1;
    const nx = clamp(g.bodyX0 + dx, -GEOMETRY.CANVAS_HALF_PX, W + GEOMETRY.CANVAS_HALF_PX);
    const nl = clamp(g.lift0 - dy, 0, Math.max(0, H - GEOMETRY.TOP_MARGIN_PX));
    avatar.pose({ kind: 'carried', happy: g.happy, gaze: g.gaze, lift: nl });
    place(nx, nl);
  }
  function click(from: CompanionState): void {
    switch (from) {
      case 'away':
      case 'leaving':
        goHome({ hello: true });
        return;
      case 'peeking':
      case 'perched':
      case 'arriving':
        // A click on him at the perch is a request: open (make-room brings him in with the hop).
        // fidelity-03: when his spot is farther than one hop, he travels in first and the panel opens on arrival.
        st = from;
        if (panel.isOpen()) goHome({ hello: true });
        else if (Math.abs(roomX(homeX(), W) - bodyX) > COMPANION.HOP_REACH_PX) goHome({ hello: true, open: true });
        else panel.open();
        return;
      default: {
        pointerNear = nearNow();
        setState('in');
        if (returningFromEdge) {
          // statemachine-makeroom-skips-onreturn: the press cut goHome's finish; still refresh on return.
          returningFromEdge = false;
          deps.onReturn?.();
        }
        panel.toggle();
        // make-room plays the hop while it slides; otherwise the tap continues from frame 2.
        if (animKind !== 'room') tap();
        syncIdle(COMPANION.LEAVE_AFTER_IDLE_MS, true);
      }
    }
  }
  function release(): void {
    const g = gesture!;
    clear('happy');
    render.carried(false);
    const pushed = awayOn ? pushedSide(bodyX, g.pointerX, W) : null;
    if (!pushed) {
      const x = clamp(bodyX, GEOMETRY.HOME_CLAMP_PX, W - GEOMETRY.HOME_CLAMP_PX);
      homeFromRight = W - x;
      persist();
      if (x !== bodyX) place(x, lift);
    }
    st = 'airborne';
    emitState();
    // statemachine-fall-onsettled-dropped / ux fix M2: the fall is the avatar's; a 'fall' guard re-armed on
    // every step completes it on the floor when its steps stop (frames starved, or a panel reaction cut it).
    const token = ++fallToken;
    let over = false;
    let landing = '';
    const live = (): boolean => !over && token === fallToken && !destroyed;
    const settled = (): void => {
      if (!live()) return;
      over = true;
      fallForce = null;
      clear('fall');
      if (st !== 'landing' && st !== 'airborne') return;
      if (lift > 0) place(bodyX, 0);
      if (pushed) {
        st = 'in';
        leave(pushed);
        return;
      }
      pointerNear = nearNow();
      setState('in');
      if (panel.isOpen()) makeRoom();
      syncIdle(COMPANION.LEAVE_AFTER_IDLE_MS, true);
    };
    const signature = (): string => {
      const a = avatar.status();
      return a.reactionPlaying ? `${a.mode}:${a.lastFrame}` : '';
    };
    const guard = (): void => {
      if (!live()) return;
      // On the floor a landing act may still be drawing: wait while its frames advance.
      const now = signature();
      if (st === 'landing' && now && now !== landing) {
        landing = now;
        timer('fall', COMPANION.FRAME_WATCHDOG_MS, guard);
        return;
      }
      settled();
    };
    const tick = (): void => {
      fallStepAt = clock.now();
      timer('fall', COMPANION.FRAME_WATCHDOG_MS, guard);
    };
    fallForce = settled;
    tick();
    avatar.fallFrom(lift, () => {
      if (!live()) return;
      tick();
      landing = signature();
      if (st === 'airborne') st = 'landing';
    }, {
      onStep: (l) => {
        if (!live()) return;
        tick();
        place(bodyX, l);
      },
      onSettled: settled,
    });
  }
  function pointerUp(_x: number, _y: number): boolean {
    const g = gesture;
    if (!g) {
      // statemachine-internal-cancel-no-click-suppress: a command / lock cancelled this press; swallow its click.
      const swallow = swallowUp;
      swallowUp = false;
      return swallow;
    }
    if (st === 'pressed') {
      gesture = null;
      click(g.from);
      return true;
    }
    if (st === 'carried') {
      release();
      gesture = null;
      return true;
    }
    gesture = null;
    return true;
  }
  function pointerCancel(): boolean {
    const g = gesture;
    if (!g) return false;
    if (st === 'carried') {
      release();
      gesture = null;
      return true;
    }
    gesture = null;
    // Pressed and cancelled: back to where he was.
    if (g.from === 'perched' || g.from === 'arriving') {
      // statemachine-cancel-consumes-arrival: back on the perch with the glyph and a fresh wait (the act is not replayed).
      st = 'arriving';
      atPerch(false);
    } else if (AWAY_STATES.has(g.from)) {
      toAway();
    } else {
      st = 'in';
      pointerNear = nearNow();
      tap();
      syncIdle(COMPANION.LEAVE_AFTER_IDLE_MS, true);
    }
    emitState();
    return true;
  }

  // ---- panel ----
  function makeRoom(): boolean {
    if (destroyed || gesture) return false;
    clear('idle', 'dwell', 'retreat', 'perch');
    const fromEdge = EDGE_STATES.has(st);
    const to = roomX(fromEdge ? homeX() : bodyX, W);
    if (fromEdge) {
      stopAnim();
      avatar.hold(null);
      const refresh = st !== 'returning' || returningFromEdge;
      returningFromEdge = false;
      if (Math.abs(to - bodyX) > COMPANION.HOP_REACH_PX) {
        // fidelity-03: farther than one hop he travels in (roll, then the last hop), never the spring zip.
        setState('returning');
        travel(to, COMPANION.RETURN_MOTION, () => {
          setState('in');
          syncIdle(COMPANION.LEAVE_AFTER_IDLE_MS, true);
        });
        if (refresh) deps.onReturn?.();
        return true;
      }
      setState('in');
      if (refresh) deps.onReturn?.();
    }
    if (st === 'airborne' || st === 'landing') return false;
    if (Math.abs(to - bodyX) < 0.5 && lift === 0) return false;
    avatar.play('hop');
    slide('room', to);
    return true;
  }
  function panelOpened(): void {
    clear('idle', 'fidget');
    watch('panel', () => !panel.motionActive(), () => deps.emit('kt-companion:moved'));
  }
  function panelClosed(): void {
    watch('panel', () => !panel.motionActive(), () => {
      deps.emit('kt-companion:moved');
      if (st !== 'in') return;
      const home = homeX();
      if (Math.abs(bodyX - home) >= 1) {
        setState('returning');
        roll(home, () => {
          // statemachine-roll-home-leaves-roll-pose: hand the roll pose back (hello, then the base mode;
          // run() keeps a processing base, unlike rest()).
          avatar.run('hello');
          setState('in');
          syncIdle(COMPANION.LEAVE_AFTER_IDLE_MS, true);
        });
        return;
      }
      syncIdle(COMPANION.LEAVE_AFTER_IDLE_MS, true);
      armFidget();
    });
  }

  // ---- questions ----
  function atPerch(act = true): void {
    if (st !== 'arriving') return;
    stopAnim();
    place(perchX(side, W), 0);
    st = 'perched';
    emitState();
    avatar.hold({ question: true });
    if (act && !deps.reduced()) avatar.run('question');
    timer('perch', COMPANION.PERCH_WAIT_MS, () => {
      if (st !== 'perched') return;
      if (perchedId) deps.onIgnored?.(perchedId);
      retreat();
    });
    // The pointer may already be near: then he comes in.
    if (ptr) pointer(ptr.x, ptr.y);
  }
  function arrive(id: string, _kind: 'arrival' | 'reminder'): boolean {
    if (!awayOn || st !== 'away' || panel.isOpen() || gesture) return false;
    perchedId = id;
    setState('arriving');
    avatar.hold({ ...heldSpec(), question: true });
    travel(perchX(side, W), COMPANION.RETURN_MOTION, atPerch);
    return true;
  }

  // ---- commands, power, area ----
  function cancelInternally(): void {
    if (!gesture) return;
    pointerCancel();
    swallowUp = true;
  }
  function command(c: CompanionCommand): void {
    if (destroyed) return;
    cancelInternally();
    const away = isAway();
    if (c === 'reset-position') {
      homeFromRight = GEOMETRY.HOME_FROM_RIGHT;
      side = 'right';
      persist();
      goHome({ hello: true });
      return;
    }
    if (c === 'away' || (c === 'toggle-away' && !away)) {
      if (!awayOn || (away && st !== 'peeking' && st !== 'perched')) return;
      if (panel.isOpen()) panel.close();
      if (st === 'launching') st = 'in';
      leave(away ? side : nearerSide(bodyX, W));
      return;
    }
    goHome({ hello: true });
  }
  function power(e: CompanionPower): void {
    if (e === 'lock-screen') {
      lockedAt = clock.now();
      cancelInternally();
      return;
    }
    const since = lockedAt ?? lastAlive;
    lockedAt = null;
    lastAlive = clock.now();
    deps.onWake?.(e, Math.max(0, clock.now() - since));
  }
  function area(): void {
    readArea();
    avatar.setFallDistance(H);
    if (gesture) return;
    switch (st) {
      case 'away':
        place(sliverX(side, W), 0);
        break;
      case 'perched':
      case 'peeking':
        stopAnim();
        place(perchX(side, W), 0);
        break;
      case 'leaving':
        toAway();
        break;
      case 'arriving':
        atPerch();
        break;
      case 'returning':
        stopAnim();
        place(homeX(), 0);
        setState('in');
        if (returningFromEdge) {
          returningFromEdge = false;
          deps.onReturn?.();
        }
        break;
      default: {
        const x = panel.isOpen() ? roomX(homeX(), W) : homeX();
        if (animKind === 'room') stopAnim();
        place(x, st === 'airborne' ? lift : 0);
      }
    }
  }

  return {
    start() {
      readArea();
      st = 'launching';
      place(homeX(), 0);
      avatar.setFallDistance(H);
      // The entrance (or the still under reduced motion) ends with him idle: then he is "in".
      watch('launch', () => { const s = avatar.status(); return !s.reactionPlaying && !s.airborne; }, launched);
      emitState();
    },
    pointerDown,
    pointerMove,
    pointerUp,
    pointerCancel,
    pointer,
    contextMenu: () => deps.emit('kt-companion:context-menu'),
    command,
    power,
    area,
    makeRoom,
    panelOpened,
    panelClosed,
    questionsChanged: emitState,
    resume,
    arrive,
    setFidgets(on) {
      fidgetsOn = on;
      fidgetsExplicit = true;
      persist();
      armFidget();
    },
    fidgets: () => fidgetsOn,
    status: () => ({
      state: st,
      bodyX,
      lift,
      away: isAway(),
      side,
      pointerNear,
      homeFromRight,
      homeX: homeX(),
      rafActive: !!animId || watchers.size > 0,
      timers: [...timers.keys()],
      anim: animKind,
      fidgets: fidgetsOn,
      question: perchedId,
    }),
    destroy() {
      if (destroyed) return;
      if (gesture || st === 'carried') render.carried(false);
      destroyed = true;
      clearAll();
      stopAnim();
      stopWatch();
    },
  };
}

// ---- DOM binding (desktop renderer) ----

export interface CompanionDom {
  root: HTMLElement;
  avatarButton: HTMLElement;
  win: Window;
}

const COMMANDS: ReadonlySet<string> = new Set(['away', 'return', 'toggle-away', 'reset-position']);
const POWER: ReadonlySet<string> = new Set(['resume', 'unlock-screen', 'lock-screen']);
/** How long a suppressed native click may take to arrive after the gesture handled the release. */
const SUPPRESS_CLICK_MS = 400;

/**
 * Bind the companion to the page: the gesture recogniser on `.rf-avatar` (pointer capture, a
 * capture-phase click guard so the native click after a handled release never toggles twice),
 * pointer tracking for proximity / gaze, right-click, and the shell's `kt-command` / `kt-power` /
 * `kt-area` CustomEvents. Returns the detach function.
 */
export function attachCompanion(c: Companion, { root, avatarButton, win }: CompanionDom): () => void {
  const doc = win.document;
  let suppress = false;
  let suppressTimer: ReturnType<typeof setTimeout> | 0 = 0;
  const armSuppress = (): void => {
    suppress = true;
    if (suppressTimer) clearTimeout(suppressTimer);
    suppressTimer = setTimeout(() => {
      suppress = false;
      suppressTimer = 0;
    }, SUPPRESS_CLICK_MS);
  };
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    suppress = false;
    if (!c.pointerDown(e.clientX, e.clientY)) return;
    try {
      avatarButton.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic pointer */
    }
  };
  const onMove = (e: PointerEvent): void => c.pointerMove(e.clientX, e.clientY);
  const onUp = (e: PointerEvent): void => {
    if (c.pointerUp(e.clientX, e.clientY)) armSuppress();
  };
  const onCancel = (): void => {
    if (c.pointerCancel()) armSuppress();
  };
  const onClick = (e: MouseEvent): void => {
    if (!suppress || !(e.target instanceof Element) || !e.target.closest('.rf-avatar')) return;
    suppress = false;
    e.stopImmediatePropagation();
    e.preventDefault();
  };
  const onMouse = (e: MouseEvent): void => c.pointer(e.clientX, e.clientY);
  const onLeave = (): void => c.pointer(null);
  const onContext = (e: MouseEvent): void => {
    e.preventDefault();
    // statemachine-gesture-survives-blur-and-contextmenu: a ctrl-click press ends here (the menu takes the mouseup).
    if (c.pointerCancel()) armSuppress();
    c.contextMenu();
  };
  // The window lost focus mid-gesture (main forces click-through on blur): end the gesture.
  const onBlur = (): void => {
    if (c.pointerCancel()) armSuppress();
  };
  // ux fix M2: frames come back (or never stopped): complete whatever stopped getting them.
  const onResume = (): void => c.resume();
  const onVisibility = (): void => {
    if (doc.visibilityState === 'visible') c.resume();
  };
  const onCommand = (e: Event): void => {
    const command = (e as CustomEvent<{ command?: unknown } | undefined>).detail?.command;
    if (typeof command === 'string' && COMMANDS.has(command)) c.command(command as CompanionCommand);
  };
  const onPower = (e: Event): void => {
    const event = (e as CustomEvent<{ event?: unknown } | undefined>).detail?.event;
    if (typeof event === 'string' && POWER.has(event)) c.power(event as CompanionPower);
  };
  const onArea = (): void => c.area();

  avatarButton.addEventListener('pointerdown', onDown);
  avatarButton.addEventListener('pointermove', onMove);
  avatarButton.addEventListener('pointerup', onUp);
  avatarButton.addEventListener('pointercancel', onCancel);
  avatarButton.addEventListener('lostpointercapture', onCancel);
  avatarButton.addEventListener('contextmenu', onContext);
  root.addEventListener('click', onClick, true);
  doc.addEventListener('mousemove', onMouse, { passive: true });
  doc.documentElement.addEventListener('mouseleave', onLeave);
  win.addEventListener('kt-command', onCommand);
  win.addEventListener('kt-power', onPower);
  win.addEventListener('kt-area', onArea);
  win.addEventListener('resize', onArea);
  win.addEventListener('blur', onBlur);
  win.addEventListener('focus', onResume);
  win.addEventListener('pageshow', onResume);
  doc.addEventListener('visibilitychange', onVisibility);
  return () => {
    if (suppressTimer) clearTimeout(suppressTimer);
    avatarButton.removeEventListener('pointerdown', onDown);
    avatarButton.removeEventListener('pointermove', onMove);
    avatarButton.removeEventListener('pointerup', onUp);
    avatarButton.removeEventListener('pointercancel', onCancel);
    avatarButton.removeEventListener('lostpointercapture', onCancel);
    avatarButton.removeEventListener('contextmenu', onContext);
    root.removeEventListener('click', onClick, true);
    doc.removeEventListener('mousemove', onMouse);
    doc.documentElement.removeEventListener('mouseleave', onLeave);
    win.removeEventListener('kt-command', onCommand);
    win.removeEventListener('kt-power', onPower);
    win.removeEventListener('kt-area', onArea);
    win.removeEventListener('resize', onArea);
    win.removeEventListener('blur', onBlur);
    win.removeEventListener('focus', onResume);
    win.removeEventListener('pageshow', onResume);
    doc.removeEventListener('visibilitychange', onVisibility);
  };
}
