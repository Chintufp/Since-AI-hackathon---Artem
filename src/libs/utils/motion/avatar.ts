/**
 * Snowbally controller: v008 avatar behaviour as a reusable module.
 *
 * Pipeline (unchanged from v008): authored acts draw onto a transparent raw 96px scene
 * (the white background fill is skipped), the 44x44 window at (26,42) is copied into the
 * display canvas with nearest-neighbour scaling at an INTEGER device scale, so artwork is crisp
 * on Retina while the CSS box stays 88x88.
 *
 * Idle is three fixed poses held for 500 ms by setTimeout: no requestAnimationFrame runs
 * while idle. A reaction (one-shot act) runs on rAF only for its own duration.
 *
 * Launch (R28): with an optional "drop" canvas (a 44x86 column of the scene, floor-aligned
 * with the display canvas and pointer-events:none) the entrance is a real fall from the top of
 * the window, accelerating like gravity, into the authored impact / spring-back / hello frames,
 * which are shown uncropped on the drop canvas. The display canvas and the hitbox never move.
 *
 * desktop (R31..R36): base mode (idle3 | processing loop | hold) that every one-shot returns to;
 * still poses (press, carried, look, settle, roll) and a held still with zero timers; drops from
 * any lift with gravity derived from the launch (physics.ts); acts taller than the display crop
 * (hop, backflip, half, hero) are routed to the drop surface; an optional floor-shadow strip.
 */
import { createCompactCoreActs } from './core-acts.ts';
import type { CoreActKey } from './core-acts.ts';
import { renderFalling, renderFloorShadow } from './entrance-fall.ts';
import { createMinimalKit } from './minimal-kit.ts';
import { createCompactPropActs } from './prop-acts.ts';
import type { PropActKey } from './prop-acts.ts';
import { createCompactStateActs, QUESTION_GLYPH } from './state-acts.ts';
import type { StateActKey } from './state-acts.ts';
import type { Act, DrawTarget, Kit } from './types.ts';
import { ballistic, derivedGravity } from './physics.ts';
import type { LandingTier } from './physics.ts';
import { carriedPose, floorShadow, heldFrame, lookPose, pressPose, rollPose, settlePose, shadowTierFor, SETTLE_FRAME_MS, SHADOW_STRIP } from './poses.ts';
import type { HeldSpec, LookView } from './poses.ts';

export type ActKey = CoreActKey | StateActKey | PropActKey;

export const SCENE_SIZE = 96;
export const CROP = { x: 26, y: 42, size: 44 } as const;
/** The drop surface: the same 44 px column from the top of the scene down to the floor (86 rows). */
export const DROP = { x: CROP.x, y: 0, w: CROP.size, h: CROP.y + CROP.size } as const;
export const DISPLAY_CSS_SIZE = 88;
export const IDLE_POSE_MS = 500;
/** Launch fall from the top of the window to the floor; eased as y = start * (1 - p^2), i.e. constant acceleration. */
export const ENTRANCE_FALL_MS = 900;
/** First authored entrance frame on the floor ('Impact'); frames before it are replaced by the long fall. */
export const ENTRANCE_IMPACT_FRAME = 5;
const STREAK_MS = 62.5;

/** desktop (R32): acts whose top rises above scene row 42 (hop 36, backflip 24, half 36, hero < 42) play on the drop surface. */
export const TALL_ACTS: ReadonlySet<ActKey> = new Set<ActKey>(['hop', 'backflip', 'half', 'hero']);
/** desktop (R32): one-shots that interject in a loop base and return to it (a direct tap while processing). */
export const LOOP_INTERJECTIONS: ReadonlySet<ActKey> = new Set<ActKey>(['click']);

export interface RunOptions {
  /** desktop (ux): raise the body by a half-sine of `px` over `ms` on the drop surface (the floor shadow stays on the display canvas). */
  lift?: { px: number; ms: number };
}
/** desktop (R32): entrance frames used as the hardest landing tier, and hop frames for the middle tier. */
export const LANDING_FRAMES = { hop: [11, 17], entrance: [5, 23] } as const;

/** desktop (R32): what every one-shot returns to. */
export type BaseMode = 'idle3' | 'processing' | 'hold';
export type Surface = 'display' | 'drop';

/** desktop (R31..R36): still poses drawn by `pose()`; one draw per change. */
export type PoseSpec =
  | { kind: 'press' }
  | { kind: 'carried'; happy?: boolean; gaze?: number; lift?: number }
  | { kind: 'settle'; frame: number }
  | { kind: 'roll'; turn: number }
  | { kind: 'look'; gaze?: number; view?: LookView };

export interface FallOptions {
  /**
   * The host moves the carrier itself (e.g. to keep the hitbox under him so he can be caught):
   * called with the current lift each frame and with 0 at touchdown; the drop surface is then
   * not translated. Without it the drop surface is translated like the R28 entrance.
   */
  onStep?: (liftPx: number) => void;
  /** Called once the landing frames are done and he is back in the base mode. */
  onSettled?: () => void;
}

/** Integer pixel scale so each authored pixel is a whole number of device pixels. */
export const scaleFor = (devicePixelRatio: number): number =>
  Math.max(1, Math.round((Number.isFinite(devicePixelRatio) && devicePixelRatio > 0 ? devicePixelRatio : 1) * 2));

export interface AvatarHost {
  reduced(): boolean;
  hasQuestion(): boolean;
}

export interface AvatarOptions {
  /** CSS size of the display canvas; v008 uses 88. */
  cssSize?: number;
  /** Canvas factory (tests, offscreen); default document.createElement('canvas'). */
  createCanvas?: (w: number, h: number) => HTMLCanvasElement;
  /**
   * Optional launch surface (R28): a canvas whose bottom edge coincides with the display canvas's
   * bottom edge and whose CSS height is cssSize * 86/44. Without it the entrance plays cropped on
   * the display canvas as before.
   */
  drop?: HTMLCanvasElement | null;
  /**
   * desktop (R32): optional floor-shadow strip (`.rf-shadow`, scene rows 80-88 of the 44 px column,
   * parked on the floor by the host). While carried / airborne the body is drawn without its shadow
   * and this canvas shows the shadow tier for the lift.
   */
  shadow?: HTMLCanvasElement | null;
  /** desktop (R32): launch distance D0 in CSS px (from the window height) for the derived gravity; default measured from the drop surface. */
  fallDistance?: number;
}

export interface PlayOptions {
  /** Repeat until rest()/another act; used while waiting for the service. */
  loop?: boolean;
}

export interface AvatarStatus {
  mode: string;
  lastFrame: number;
  animating: boolean;
  reactionPlaying: boolean;
  idleLoop: boolean;
  idlePose: number;
  visible: boolean;
  reduced: boolean;
  questionCue: boolean;
  scale: number;
  /** Launch fall in progress (drop surface moving). */
  falling: boolean;
  /** Current translateY of the drop surface in CSS px (0 when on the floor or unused). */
  dropY: number;
  /** The drop surface is showing (fall or landing frames). */
  dropActive: boolean;
  /** desktop (R33): a held still is the base (away / perched). */
  held: boolean;
  /** desktop (R32): the carried pose is showing. */
  carried: boolean;
  /** desktop (R32): in the air (launch fall or fallFrom). */
  airborne: boolean;
  /** desktop (R32): current height above the floor in CSS px. */
  lift: number;
  /** desktop (R32): what one-shots return to. */
  base: BaseMode;
  /** desktop (R32): the surface currently drawn on. */
  surface: Surface;
}

export interface Avatar {
  play(act: ActKey, options?: PlayOptions): void;
  rest(): void;
  playEntranceThenRest(): void;
  /** Redraw/re-evaluate after hasQuestion()/reduced() changed. */
  refresh(): void;
  status(): AvatarStatus;
  destroy(): void;
}

/** desktop (R31..R36): the companion additions (AvatarController implements them; `Avatar` is unchanged). */
export interface CompanionAvatar extends Avatar {
  pose(spec: PoseSpec): void;
  look(gaze: number, view?: LookView): boolean;
  hold(spec: HeldSpec | null): void;
  /** `lift`: a small vertical bounce of the body on the drop surface (px, over ms) while the frames play; the shadow stays on the floor. */
  run(act: ActKey, from?: number, to?: number, options?: RunOptions): void;
  fallFrom(liftPx: number, onLand?: (tier: LandingTier) => void, options?: FallOptions): LandingTier;
  setBase(base: BaseMode): void;
  setFallDistance(px: number | null): void;
}

const defaultCreateCanvas = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

/** The only change to the authored art: its white scene background is not painted. */
const backgroundless = (ctx: CanvasRenderingContext2D): DrawTarget => ({
  get fillStyle() {
    return ctx.fillStyle;
  },
  set fillStyle(v) {
    ctx.fillStyle = v;
  },
  clearRect: (x, y, w, h) => ctx.clearRect(x, y, w, h),
  fillRect: (x, y, w, h) => {
    if (x === 0 && y === 0 && w === SCENE_SIZE && h === SCENE_SIZE) return;
    ctx.fillRect(x, y, w, h);
  },
});

const sign = (v: number): -1 | 0 | 1 => (!Number.isFinite(v) || v === 0 ? 0 : v < 0 ? -1 : 1);

type Still =
  | { kind: 'look'; key: string; gaze: number; view: LookView }
  | { kind: Exclude<PoseSpec['kind'], 'look'>; key: string; spec: Exclude<PoseSpec, { kind: 'look' }> };

const poseKey = (spec: Exclude<PoseSpec, { kind: 'look' }>): string => {
  switch (spec.kind) {
    case 'press': return 'press';
    case 'carried': return `carried:${spec.happy ? 1 : 0}:${sign(spec.gaze ?? 0)}`;
    case 'settle': return `settle:${spec.frame >= 1 ? 1 : 0}`;
    case 'roll': return `roll:${Number.isFinite(spec.turn) ? ((Math.round(spec.turn) % 8) + 8) % 8 : 0}`;
  }
};
const heldKeyOf = (s: HeldSpec): string => [s.shape ?? 'neutral', s.expression ?? 'normal', sign(s.gaze ?? 0), s.view ?? 'front', s.question ?? '-', s.glyphSide ?? 'right'].join(':');

export class AvatarController implements CompanionAvatar {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly raw: HTMLCanvasElement;
  private readonly rawCtx: CanvasRenderingContext2D;
  private readonly target: DrawTarget;
  private readonly host: AvatarHost;
  private readonly options: Required<Pick<AvatarOptions, 'cssSize'>> & AvatarOptions;
  private readonly kit: Kit;
  private readonly acts: Record<ActKey, Act>;
  private readonly glyph: HTMLCanvasElement;
  /** desktop (fidelity-10): acts whose body leaves the floor (entrance and the tall acts); no glyph overlay. */
  private readonly travelling: ReadonlySet<Act>;
  private readonly drop: HTMLCanvasElement | null;
  private readonly dropCtx: CanvasRenderingContext2D | null;
  // desktop (R32): optional floor-shadow strip and its own scratch scene.
  private readonly shadowCanvas: HTMLCanvasElement | null;
  private readonly shadowCtx: CanvasRenderingContext2D | null;
  private readonly shadowRaw: HTMLCanvasElement | null;
  private readonly shadowTarget: DrawTarget | null;
  private shadowTier = -1;
  private scale = 2;
  private animation = 0;
  private idleTimer: ReturnType<typeof setTimeout> | 0 = 0;
  private idlePose = 0;
  private visible = true;
  private mode = 'idle3';
  private lastFrame = -1;
  private looping = false;
  private dropActive = false;
  private falling = false;
  private dropY = 0;
  // desktop (R31..R36): base mode, stills and airborne state.
  private heldSpec: HeldSpec | null = null;
  private heldKey = '';
  private processingBase = false;
  private still: Still | null = null;
  private airborne = false;
  private lift = 0;
  private fallDistance: number | null;
  private launchDistance: number | null = null;
  private onDone: (() => void) | null = null;
  /**
   * desktop (shell-01): the rAF callback in flight. When the window is hidden (or scrolled out) its
   * callback would never run, so its own `!canAnimate()` branch is run at once instead: a fall
   * still reports onStep(0) / onLand / onSettled and a landing still calls its onSettled.
   */
  private pending: ((t: number) => void) | null = null;
  private observer: IntersectionObserver | null = null;
  private readonly onVisibility = (): void => {
    if (this.hidden()) this.interrupt();
    else if (!this.animation && !this.idleTimer && !this.still) this.settle();
  };
  private dprQuery: MediaQueryList | null = null;
  private readonly onDprChange = (): void => {
    this.resize();
    this.watchDpr();
  };

  constructor(canvas: HTMLCanvasElement, host: AvatarHost, options: AvatarOptions = {}) {
    this.canvas = canvas;
    this.host = host;
    this.options = { cssSize: DISPLAY_CSS_SIZE, ...options };
    const make = options.createCanvas ?? defaultCreateCanvas;
    this.ctx = canvas.getContext('2d')!;
    this.raw = make(SCENE_SIZE, SCENE_SIZE);
    this.rawCtx = this.raw.getContext('2d')!;
    this.rawCtx.imageSmoothingEnabled = false;
    this.drop = options.drop ?? null;
    this.dropCtx = this.drop ? this.drop.getContext('2d')! : null;
    this.target = backgroundless(this.rawCtx);
    this.shadowCanvas = options.shadow ?? null;
    this.shadowCtx = this.shadowCanvas ? this.shadowCanvas.getContext('2d')! : null;
    this.shadowRaw = this.shadowCanvas ? make(SCENE_SIZE, SCENE_SIZE) : null;
    this.shadowTarget = this.shadowRaw ? backgroundless(this.shadowRaw.getContext('2d')!) : null;
    this.fallDistance = options.fallDistance && options.fallDistance > 0 ? options.fallDistance : null;
    const kit = createMinimalKit();
    this.kit = kit;
    this.acts = { ...createCompactCoreActs({ kit }), ...createCompactStateActs({ kit }), ...createCompactPropActs({ kit }) };
    this.travelling = new Set<Act>([this.acts.entrance, ...[...TALL_ACTS].map((k) => this.acts[k])]);
    // Extract the question glyph from the accepted artwork instead of authoring a new sprite.
    this.glyph = make(QUESTION_GLYPH.w, QUESTION_GLYPH.h);
    this.acts.question.render(this.target, this.acts.question.stillFrame);
    this.glyph.getContext('2d')!.drawImage(this.raw, QUESTION_GLYPH.x, QUESTION_GLYPH.y, QUESTION_GLYPH.w, QUESTION_GLYPH.h, 0, 0, QUESTION_GLYPH.w, QUESTION_GLYPH.h);

    this.resize();
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver((entries) => {
        const was = this.visible;
        this.visible = entries[entries.length - 1]?.isIntersecting !== false;
        if (!this.visible) this.interrupt();
        else if (!was && !this.animation && !this.still) this.settle();
      });
      this.observer.observe(canvas);
    }
    globalThis.document?.addEventListener('visibilitychange', this.onVisibility);
    this.watchDpr();
    this.settle();
  }

  /** (Re)allocate the display canvas at an integer device scale; the CSS box stays cssSize. */
  resize(): void {
    this.scale = scaleFor(globalThis.devicePixelRatio ?? 1);
    const px = CROP.size * this.scale;
    if (this.canvas.width !== px) this.canvas.width = px;
    if (this.canvas.height !== px) this.canvas.height = px;
    this.canvas.style.width = this.options.cssSize + 'px';
    this.canvas.style.height = this.options.cssSize + 'px';
    this.ctx.imageSmoothingEnabled = false;
    if (this.drop) {
      const w = DROP.w * this.scale, h = DROP.h * this.scale;
      if (this.drop.width !== w) this.drop.width = w;
      if (this.drop.height !== h) this.drop.height = h;
      this.drop.style.width = this.options.cssSize + 'px';
      this.drop.style.height = this.dropCssHeight() + 'px';
      this.dropCtx!.imageSmoothingEnabled = false;
    }
    if (this.shadowCanvas) {
      // desktop (R32): the shadow strip at the same integer scale (CSS 88 x 16).
      const w = SHADOW_STRIP.w * this.scale, h = SHADOW_STRIP.h * this.scale;
      if (this.shadowCanvas.width !== w) this.shadowCanvas.width = w;
      if (this.shadowCanvas.height !== h) this.shadowCanvas.height = h;
      this.shadowCanvas.style.width = this.options.cssSize + 'px';
      this.shadowCanvas.style.height = (this.options.cssSize * SHADOW_STRIP.h) / SHADOW_STRIP.w + 'px';
      const tier = this.shadowTier;
      this.shadowTier = -2;
      this.paintShadow(tier);
    }
    if (this.lastFrame >= 0 || this.still) this.present();
  }

  /** CSS height of the drop surface: the scene column from its top row to the floor. */
  dropCssHeight(): number {
    return (this.options.cssSize * DROP.h) / CROP.size;
  }

  private watchDpr(): void {
    this.dprQuery?.removeEventListener?.('change', this.onDprChange);
    if (typeof matchMedia !== 'function') return;
    this.dprQuery = matchMedia(`(resolution: ${globalThis.devicePixelRatio ?? 1}dppx)`);
    this.dprQuery.addEventListener?.('change', this.onDprChange, { once: true });
  }

  /** desktop (shell-01): request a frame and remember it as the one in flight. */
  private schedule(cb: (t: number) => void): void {
    this.pending = cb;
    this.animation = requestAnimationFrame(cb);
  }

  /** desktop (shell-01): animation can no longer run: finish what is in flight through its own fallback, or settle. */
  private interrupt(): void {
    const p = this.pending;
    this.pending = null;
    if (p) p(globalThis.performance?.now?.() ?? Date.now());
    else if (!this.still) this.settle();
  }

  private hidden(): boolean {
    return !!globalThis.document?.hidden;
  }

  private canAnimate(): boolean {
    return !this.host.reduced() && this.visible && !this.hidden();
  }

  private blit(): void {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.drawImage(this.raw, CROP.x, CROP.y, CROP.size, CROP.size, 0, 0, CROP.size * this.scale, CROP.size * this.scale);
  }

  private blitDrop(): void {
    if (!this.drop || !this.dropCtx) return;
    this.dropCtx.clearRect(0, 0, this.drop.width, this.drop.height);
    this.dropCtx.imageSmoothingEnabled = false;
    this.dropCtx.drawImage(this.raw, DROP.x, DROP.y, DROP.w, DROP.h, 0, 0, DROP.w * this.scale, DROP.h * this.scale);
  }

  /** Copy the raw scene to whichever surface is current. */
  private present(): void {
    if (this.dropActive) this.blitDrop();
    else this.blit();
  }

  /** desktop (R32): paint the floor-shadow strip at `tier` (-1 = empty); one draw per change. */
  private paintShadow(tier: number): void {
    if (!this.shadowCanvas || !this.shadowCtx || !this.shadowRaw || !this.shadowTarget || tier === this.shadowTier) return;
    this.shadowTier = tier;
    this.shadowCtx.clearRect(0, 0, this.shadowCanvas.width, this.shadowCanvas.height);
    if (tier < 0) return;
    floorShadow(this.kit, this.shadowTarget, tier);
    this.shadowCtx.imageSmoothingEnabled = false;
    const s = SHADOW_STRIP;
    this.shadowCtx.drawImage(this.shadowRaw, s.x, s.y, s.w, s.h, 0, 0, s.w * this.scale, s.h * this.scale);
  }

  private showDrop(): void {
    if (!this.drop) return;
    this.drop.hidden = false;
    this.dropActive = true;
  }

  /** desktop (R32): move drawing to the drop surface and clear the display canvas (one body on screen). */
  private toDrop(): void {
    if (!this.drop) return;
    this.showDrop();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  private hideDrop(): void {
    this.falling = false;
    this.dropY = 0;
    if (!this.dropActive) return;
    this.dropActive = false;
    if (!this.drop || !this.dropCtx) return;
    this.dropCtx.clearRect(0, 0, this.drop.width, this.drop.height);
    this.drop.style.transform = '';
    this.drop.style.willChange = '';
    this.drop.hidden = true;
  }

  private overlayGlyph(): void {
    if (this.host.hasQuestion()) this.rawCtx.drawImage(this.glyph, QUESTION_GLYPH.x, QUESTION_GLYPH.y);
  }

  private draw(act: Act, frame: number): void {
    act.render(this.target, frame);
    // desktop (fidelity-10): the glyph sits at floor height, so it is left off while the body travels
    // (the launch and its landing frames, and the tall acts on the drop surface).
    if (act !== this.acts.question && !this.dropActive && !this.travelling.has(act)) this.overlayGlyph();
    this.present();
    this.lastFrame = frame;
  }

  private stop(): void {
    if (this.animation) cancelAnimationFrame(this.animation);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.animation = 0;
    this.pending = null;
    this.idleTimer = 0;
    this.looping = false;
    this.onDone = null;
    this.still = null;
    this.airborne = false;
    this.lift = 0;
    this.paintShadow(-1);
    this.hideDrop();
  }

  /** desktop (R32): stop whatever plays and show the base mode (hold still, processing loop or idle3). */
  private settle(): void {
    this.stop();
    if (this.heldSpec) {
      this.drawHeld();
      return;
    }
    if (this.processingBase && this.canAnimate()) {
      this.mode = 'processing';
      this.animate(this.acts.processing, 0, this.acts.processing.frames - 1, true);
      return;
    }
    this.mode = 'idle3';
    this.idlePose = 0;
    this.draw(this.acts.idle3, 0);
    this.canvas.setAttribute('aria-label', this.host.hasQuestion() ? 'White pixel companion with a question available' : 'White pixel companion at rest');
    if (!this.canAnimate()) return;
    // One paint per authored pose, not a continuous requestAnimationFrame loop.
    const nextPose = (): void => {
      this.idleTimer = 0;
      if (!this.canAnimate()) {
        this.settle();
        return;
      }
      this.idlePose = (this.idlePose + 1) % 3;
      this.draw(this.acts.idle3, this.idlePose * 8);
      this.idleTimer = setTimeout(nextPose, IDLE_POSE_MS);
    };
    this.idleTimer = setTimeout(nextPose, IDLE_POSE_MS);
  }

  /** desktop (R33): the held still: zero timers, zero rAF. */
  private drawHeld(): void {
    const spec = this.heldSpec!;
    const question = spec.question ?? this.host.hasQuestion();
    this.mode = 'hold';
    this.idlePose = 0;
    heldFrame(this.kit, this.target, { ...spec, question });
    this.present();
    this.lastFrame = 0;
    this.canvas.setAttribute('aria-label', question ? 'White pixel companion with a question available' : 'White pixel companion at rest');
  }

  /** Stop everything and return to the base: a processing loop ends here; a hold is kept (desktop R33). */
  rest(): void {
    this.processingBase = false;
    this.settle();
  }

  play(key: ActKey, options: PlayOptions = {}): void {
    const act = this.acts[key];
    // desktop (R32): a processing loop becomes the base; a tap interjects and returns to it, other acts end it.
    if (act && options.loop && key === 'processing') this.processingBase = true;
    else if (this.processingBase && !LOOP_INTERJECTIONS.has(key)) this.processingBase = false;
    this.stop();
    this.mode = key;
    if (!act || !this.canAnimate()) {
      this.settle();
      return;
    }
    this.startAct(key, 0, act.frames - 1, !!options.loop);
  }

  /** desktop (R32): play frames `from`..`to` (inclusive) of `key`, then return to the base mode (which is kept). */
  run(key: ActKey, from = 0, to?: number, options: RunOptions = {}): void {
    const act = this.acts[key];
    this.stop();
    if (!act || !this.canAnimate()) {
      this.settle();
      return;
    }
    const last = act.frames - 1;
    const int = (v: number, d: number): number => (Number.isFinite(v) ? Math.floor(v) : d);
    const a = Math.max(0, Math.min(last, int(from, 0)));
    const b = Math.max(a, Math.min(last, int(to ?? last, last)));
    this.mode = key;
    const lift = options.lift;
    if (lift && lift.px > 0 && lift.ms > 0 && this.drop && this.dropCtx) {
      // The body bounces on the drop surface; the resting shadow waits on the display canvas (as in the entrance).
      renderFloorShadow(this.kit, this.target);
      this.blit();
      this.showDrop();
      const drop = this.drop;
      this.animate(act, a, b, false, undefined, (elapsed) => {
        const u = Math.min(1, elapsed / lift.ms);
        const y = u < 1 ? -lift.px * Math.sin(Math.PI * u) : 0;
        drop.style.transform = y ? `translateY(${y.toFixed(2)}px)` : '';
      });
      return;
    }
    this.startAct(key, a, b, false);
  }

  /** desktop (R32): tall acts go to the drop surface (their tops are above the display crop). */
  private startAct(key: ActKey, from: number, to: number, loop: boolean, onDone?: () => void): void {
    if (TALL_ACTS.has(key)) this.toDrop();
    this.animate(this.acts[key], from, to, loop, onDone);
  }

  /** Play `act` frames `from`..`to` on rAF; loop or return to the base when it ends. The current surface is kept. */
  private animate(act: Act, from: number, to: number, loop: boolean, onDone?: () => void, onTick?: (elapsedMs: number) => void): void {
    this.looping = loop;
    this.onDone = onDone ?? null;
    this.draw(act, from);
    let started: number | undefined;
    const finish = (): void => {
      const done = this.onDone;
      this.settle();
      done?.();
    };
    const frame = (t: number): void => {
      if (!this.canAnimate()) {
        finish();
        return;
      }
      started ??= t;
      onTick?.(t - started);
      const n = from + Math.max(0, Math.floor(((t - started) * act.fps) / 1000));
      if (n > to) {
        if (this.looping) {
          started = t;
          this.draw(act, from);
          this.schedule(frame);
          return;
        }
        finish();
        return;
      }
      if (n !== this.lastFrame) this.draw(act, n);
      this.schedule(frame);
    };
    this.schedule(frame);
  }

  /** Where the fall starts: the drop surface fully above the top of the window (CSS px, negative). */
  private fallStart(): number {
    const rect = (this.drop as { getBoundingClientRect?: () => { top: number; height: number } } | null)?.getBoundingClientRect?.();
    if (rect && rect.height > 0) return -(rect.top + rect.height);
    return -2 * this.dropCssHeight();
  }

  /**
   * Launch behaviour (R05/R28). With a drop surface: fall from the top of the window with constant
   * acceleration (the floor shadow waits on the display canvas), then the authored impact, spring
   * back, stars and hello uncropped, then idle. Without one: the authored entrance cropped, as v008.
   * Reduced motion / hidden: still.
   */
  playEntranceThenRest(): void {
    if (!this.canAnimate()) {
      this.settle();
      return;
    }
    if (!this.drop || !this.dropCtx) {
      this.play('entrance');
      return;
    }
    this.stop();
    this.mode = 'entrance';
    const act = this.acts.entrance;
    // Floor shadow on the display canvas; the falling body on the drop surface.
    renderFloorShadow(this.kit, this.target);
    this.blit();
    this.showDrop();
    const start = this.fallStart();
    this.launchDistance = -start; // desktop (R32): D0 for the derived gravity
    this.falling = true;
    this.airborne = true;
    this.dropY = start;
    this.lift = -start;
    this.drop.style.willChange = 'transform';
    this.drop.style.transform = `translateY(${start}px)`;
    let streak = -1;
    let t0: number | undefined;
    const fall = (t: number): void => {
      if (!this.canAnimate()) {
        this.settle();
        return;
      }
      t0 ??= t;
      const elapsed = t - t0;
      const p = Math.min(1, elapsed / ENTRANCE_FALL_MS);
      this.dropY = start * (1 - p * p);
      this.lift = -this.dropY;
      this.drop!.style.transform = `translateY(${this.dropY.toFixed(2)}px)`;
      const s = Math.floor(elapsed / STREAK_MS) % 2;
      if (s !== streak) {
        streak = s;
        renderFalling(this.kit, this.target, s);
        this.blitDrop();
        this.lastFrame = -1;
      }
      if (p < 1) {
        this.schedule(fall);
        return;
      }
      // Touchdown: the authored frames from 'Impact' on, uncropped, with the shadow in the frames.
      this.falling = false;
      this.airborne = false;
      this.lift = 0;
      this.dropY = 0;
      this.drop!.style.transform = '';
      this.drop!.style.willChange = '';
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.animate(act, ENTRANCE_IMPACT_FRAME, act.frames - 1, false);
    };
    this.schedule(fall);
  }

  // ---- desktop (R31..R36): companion additions ----

  /** desktop (R32): set the base mode one-shots return to; a running one-shot finishes first. */
  setBase(base: BaseMode): void {
    if (base === 'hold') {
      this.hold(this.heldSpec ?? {});
      return;
    }
    const was = this.status().base;
    this.heldSpec = null;
    this.heldKey = '';
    this.processingBase = base === 'processing';
    if (this.animation && !this.looping) return;
    if (was === base && (this.animation || this.idleTimer)) return;
    // A gesture pose (press / carried / roll / settle) is the host's; it returns to the base on its next call.
    if (this.still && this.still.kind !== 'look') return;
    this.settle();
  }

  /** desktop (R32): launch distance D0 (CSS px) for the derived gravity; null = measure from the drop surface. */
  setFallDistance(px: number | null): void {
    this.fallDistance = px !== null && Number.isFinite(px) && px > 0 ? px : null;
  }

  /** desktop (R32): px/s^2, so that D0 falls in exactly ENTRANCE_FALL_MS. */
  gravity(): number {
    return derivedGravity(this.fallDistance ?? this.launchDistance ?? -this.fallStart());
  }

  /** desktop (R31..R36): draw a still pose (no timers, no rAF) on its surface; one draw per change. */
  pose(spec: PoseSpec): void {
    if (spec.kind === 'look') {
      this.look(spec.gaze ?? 0, spec.view);
      return;
    }
    const key = poseKey(spec);
    if (this.still && this.still.key === key && !this.animation) {
      if (spec.kind === 'carried') {
        this.lift = Math.max(0, spec.lift ?? 0);
        this.paintShadow(shadowTierFor(this.lift));
        this.still = { kind: 'carried', key, spec };
      }
      return;
    }
    this.stop();
    this.still = { kind: spec.kind, key, spec } as Still;
    this.drawPose(spec);
  }

  private drawPose(spec: Exclude<PoseSpec, { kind: 'look' }>): void {
    const k = this.kit;
    this.mode = 'pose:' + spec.kind;
    switch (spec.kind) {
      case 'press':
        pressPose(k, this.target);
        this.overlayGlyph();
        this.lastFrame = 1; // the click frame it equals
        break;
      case 'carried':
        carriedPose(k, this.target, { happy: !!spec.happy, gaze: spec.gaze ?? 0 });
        this.toDrop();
        this.lift = Math.max(0, spec.lift ?? 0);
        this.paintShadow(shadowTierFor(this.lift));
        this.lastFrame = 0;
        break;
      case 'settle':
        settlePose(k, this.target, spec.frame);
        this.overlayGlyph();
        this.lastFrame = spec.frame >= 1 ? 1 : 0;
        break;
      case 'roll':
        rollPose(k, this.target, spec.turn);
        this.lastFrame = Number.isFinite(spec.turn) ? ((Math.round(spec.turn) % 8) + 8) % 8 : 0;
        break;
    }
    this.present();
  }

  /**
   * desktop (R33): idle with gaze toward the pointer (-1 / 0 / 1; 'quarter' faces right). Redraws
   * only on change; gaze 0 + front returns to the idle loop. Ignored while anything else plays,
   * while held / processing, and under reduced motion. Returns whether it drew.
   */
  look(gaze: number, view: LookView = 'front'): boolean {
    const g = sign(gaze);
    const v: LookView = view === 'quarter' ? 'quarter' : 'front';
    if (this.host.reduced() || this.animation || this.heldSpec || this.processingBase || (this.still && this.still.kind !== 'look')) return false;
    const key = `look:${g}:${v}`;
    if (key === (this.still?.key ?? 'look:0:front')) return false;
    if (g === 0 && v === 'front') {
      this.settle();
      return true;
    }
    this.stop();
    this.still = { kind: 'look', key, gaze: g, view: v };
    this.drawLook(g, v);
    return true;
  }

  private drawLook(gaze: number, view: LookView): void {
    this.mode = 'look';
    lookPose(this.kit, this.target, gaze, view);
    this.overlayGlyph();
    this.present();
    this.lastFrame = 0;
  }

  /**
   * desktop (R33): hold a still as the base (away / perched): zero timers, zero rAF; rest(),
   * refresh(), visibility and intersection changes all keep it. A running one-shot finishes first.
   * null releases it (back to idle3).
   */
  hold(spec: HeldSpec | null): void {
    if (!spec) {
      if (!this.heldSpec) return;
      this.heldSpec = null;
      this.heldKey = '';
      if (this.animation && !this.looping) return;
      this.settle();
      return;
    }
    const key = heldKeyOf(spec);
    if (this.heldSpec && key === this.heldKey && this.mode === 'hold' && !this.animation && !this.still) return;
    this.heldSpec = { ...spec };
    this.heldKey = key;
    if (this.animation && !this.looping) return;
    this.settle();
  }

  /**
   * desktop (R32): release at `liftPx` above the floor: a ballistic fall with the derived gravity,
   * then the landing tier by impact speed (settle / hop 11-17 / entrance 5-23, on the drop surface),
   * then the base mode. Returns the tier. `onLand(tier)` fires at touchdown.
   */
  fallFrom(liftPx: number, onLand?: (tier: LandingTier) => void, options: FallOptions = {}): LandingTier {
    const h = Math.max(0, Number.isFinite(liftPx) ? liftPx : 0);
    const fall = ballistic(h, this.gravity());
    const tier = fall.tier;
    this.stop();
    if (!this.canAnimate()) {
      options.onStep?.(0);
      this.settle();
      onLand?.(tier);
      options.onSettled?.();
      return tier;
    }
    const translate = !options.onStep && !!this.drop;
    // Without a drop surface and without a moving carrier there is nothing to show in the air.
    const airTime = this.drop || options.onStep ? fall.duration : 0;
    const drawBody = (streak: number): void => {
      if (tier === 'entrance') renderFalling(this.kit, this.target, streak);
      else carriedPose(this.kit, this.target, { happy: false });
      this.present();
    };
    const touchdown = (): void => {
      this.airborne = false;
      this.lift = 0;
      this.falling = false;
      this.dropY = 0;
      if (translate && this.drop) {
        this.drop.style.transform = '';
        this.drop.style.willChange = '';
      }
      this.paintShadow(-1);
      if (this.drop) this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      options.onStep?.(0);
      this.land(tier, options.onSettled);
      onLand?.(tier);
    };
    if (airTime <= 0) {
      touchdown();
      return tier;
    }
    this.mode = 'fall';
    this.airborne = true;
    this.lift = h;
    // The body goes on the drop surface (or, without one, on the display canvas the host carries).
    this.toDrop();
    if (this.shadowCanvas) this.paintShadow(shadowTierFor(h));
    else if (translate) {
      // The display canvas stays on the floor and keeps the shadow, like the launch.
      floorShadow(this.kit, this.target, shadowTierFor(h));
      this.blit();
    }
    let floorTier = shadowTierFor(h);
    const apply = (lift: number): void => {
      this.lift = lift;
      if (!this.shadowCanvas && translate && shadowTierFor(lift) !== floorTier) {
        floorTier = shadowTierFor(lift);
        floorShadow(this.kit, this.target, floorTier);
        this.blit();
      }
      if (translate) {
        this.falling = true;
        this.dropY = -lift;
        this.drop!.style.willChange = 'transform';
        this.drop!.style.transform = `translateY(${this.dropY.toFixed(2)}px)`;
      } else options.onStep?.(lift);
      if (this.shadowCanvas) this.paintShadow(shadowTierFor(lift));
    };
    apply(h);
    let streak = 0;
    drawBody(streak);
    this.lastFrame = -1;
    let t0: number | undefined;
    const step = (t: number): void => {
      if (!this.canAnimate()) {
        options.onStep?.(0);
        this.settle();
        onLand?.(tier);
        options.onSettled?.();
        return;
      }
      t0 ??= t;
      const elapsed = t - t0;
      const st = fall.at(elapsed);
      if (!st.landed && elapsed < airTime) {
        apply(st.lift);
        const s = Math.floor(elapsed / STREAK_MS) % 2;
        if (tier === 'entrance' && s !== streak) {
          streak = s;
          drawBody(s);
        }
        this.schedule(step);
        return;
      }
      this.animation = 0;
      touchdown();
    };
    this.schedule(step);
    return tier;
  }

  /** desktop (R32): the landing after touchdown, then the base mode. */
  private land(tier: LandingTier, onSettled?: () => void): void {
    if (tier !== 'settle') {
      const [from, to] = LANDING_FRAMES[tier];
      const key: ActKey = tier;
      this.mode = key;
      this.toDrop();
      this.animate(this.acts[key], from, to, false, onSettled);
      return;
    }
    this.mode = 'land:settle';
    this.toDrop();
    const paint = (i: number): void => {
      settlePose(this.kit, this.target, i);
      this.overlayGlyph();
      this.present();
      this.lastFrame = i;
    };
    paint(0);
    this.onDone = onSettled ?? null;
    let t0: number | undefined;
    const finish = (): void => {
      const done = this.onDone;
      this.settle();
      done?.();
    };
    const step = (t: number): void => {
      if (!this.canAnimate()) {
        finish();
        return;
      }
      t0 ??= t;
      const i = Math.floor((t - t0) / SETTLE_FRAME_MS);
      if (i >= 2) {
        finish();
        return;
      }
      if (i !== this.lastFrame) paint(i);
      this.schedule(step);
    };
    this.schedule(step);
  }

  refresh(): void {
    if (this.animation) return;
    // desktop (R31..R36): a still pose / look is redrawn in place (question glyph may have changed), not replaced.
    const still = this.still;
    if (still) {
      if (still.kind === 'look') this.drawLook(still.gaze, still.view);
      else this.drawPose(still.spec);
      return;
    }
    this.settle();
  }

  status(): AvatarStatus {
    return {
      mode: this.mode,
      lastFrame: this.lastFrame,
      animating: !!this.animation || !!this.idleTimer,
      reactionPlaying: !!this.animation,
      idleLoop: !!this.idleTimer,
      idlePose: this.idlePose,
      visible: this.visible,
      reduced: this.host.reduced(),
      questionCue: this.host.hasQuestion(),
      scale: this.scale,
      falling: this.falling,
      dropY: this.dropY,
      dropActive: this.dropActive,
      held: !!this.heldSpec,
      carried: this.still?.kind === 'carried',
      airborne: this.airborne,
      lift: this.lift,
      base: this.heldSpec ? 'hold' : this.processingBase ? 'processing' : 'idle3',
      surface: this.dropActive ? 'drop' : 'display',
    };
  }

  destroy(): void {
    this.stop();
    this.observer?.disconnect();
    globalThis.document?.removeEventListener('visibilitychange', this.onVisibility);
    this.dprQuery?.removeEventListener?.('change', this.onDprChange);
  }
}
