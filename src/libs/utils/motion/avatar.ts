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

const defaultCreateCanvas = (w: number, h: number): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
};

export class AvatarController implements Avatar {
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
  private readonly drop: HTMLCanvasElement | null;
  private readonly dropCtx: CanvasRenderingContext2D | null;
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
  private observer: IntersectionObserver | null = null;
  private readonly onVisibility = (): void => {
    if (this.hidden()) this.rest();
    else if (!this.animation && !this.idleTimer) this.rest();
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
    const rawCtx = this.rawCtx;
    // The only change to the authored art: its white scene background is not painted.
    this.target = {
      get fillStyle() {
        return rawCtx.fillStyle;
      },
      set fillStyle(v) {
        rawCtx.fillStyle = v;
      },
      clearRect: (x, y, w, h) => rawCtx.clearRect(x, y, w, h),
      fillRect: (x, y, w, h) => {
        if (x === 0 && y === 0 && w === SCENE_SIZE && h === SCENE_SIZE) return;
        rawCtx.fillRect(x, y, w, h);
      },
    };
    const kit = createMinimalKit();
    this.kit = kit;
    this.acts = { ...createCompactCoreActs({ kit }), ...createCompactStateActs({ kit }), ...createCompactPropActs({ kit }) };
    // Extract the question glyph from the accepted artwork instead of authoring a new sprite.
    this.glyph = make(QUESTION_GLYPH.w, QUESTION_GLYPH.h);
    this.acts.question.render(this.target, this.acts.question.stillFrame);
    this.glyph.getContext('2d')!.drawImage(this.raw, QUESTION_GLYPH.x, QUESTION_GLYPH.y, QUESTION_GLYPH.w, QUESTION_GLYPH.h, 0, 0, QUESTION_GLYPH.w, QUESTION_GLYPH.h);

    this.resize();
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver((entries) => {
        const was = this.visible;
        this.visible = entries[entries.length - 1]?.isIntersecting !== false;
        if (!this.visible) this.rest();
        else if (!was && !this.animation) this.rest();
      });
      this.observer.observe(canvas);
    }
    globalThis.document?.addEventListener('visibilitychange', this.onVisibility);
    this.watchDpr();
    this.rest();
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
    if (this.lastFrame >= 0) this.present();
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

  private showDrop(): void {
    if (!this.drop) return;
    this.drop.hidden = false;
    this.dropActive = true;
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

  private draw(act: Act, frame: number): void {
    act.render(this.target, frame);
    if (this.host.hasQuestion() && act !== this.acts.question) this.rawCtx.drawImage(this.glyph, QUESTION_GLYPH.x, QUESTION_GLYPH.y);
    this.present();
    this.lastFrame = frame;
  }

  private stop(): void {
    if (this.animation) cancelAnimationFrame(this.animation);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.animation = 0;
    this.idleTimer = 0;
    this.looping = false;
    this.hideDrop();
  }

  rest(): void {
    this.stop();
    this.mode = 'idle3';
    this.idlePose = 0;
    this.draw(this.acts.idle3, 0);
    this.canvas.setAttribute('aria-label', this.host.hasQuestion() ? 'White pixel companion with a question available' : 'White pixel companion at rest');
    if (!this.canAnimate()) return;
    // One paint per authored pose, not a continuous requestAnimationFrame loop.
    const nextPose = (): void => {
      this.idleTimer = 0;
      if (!this.canAnimate()) {
        this.rest();
        return;
      }
      this.idlePose = (this.idlePose + 1) % 3;
      this.draw(this.acts.idle3, this.idlePose * 8);
      this.idleTimer = setTimeout(nextPose, IDLE_POSE_MS);
    };
    this.idleTimer = setTimeout(nextPose, IDLE_POSE_MS);
  }

  play(key: ActKey, options: PlayOptions = {}): void {
    this.stop();
    const act = this.acts[key];
    this.mode = key;
    if (!act || !this.canAnimate()) {
      this.rest();
      return;
    }
    this.run(act, 0, !!options.loop);
  }

  /** Play `act` from frame `from` on rAF; loop or return to idle when it ends. The current surface is kept. */
  private run(act: Act, from: number, loop: boolean): void {
    this.looping = loop;
    this.draw(act, from);
    let started: number | undefined;
    const frame = (t: number): void => {
      if (!this.canAnimate()) {
        this.rest();
        return;
      }
      started ??= t;
      const n = from + Math.max(0, Math.floor(((t - started) * act.fps) / 1000));
      if (n >= act.frames) {
        if (this.looping) {
          started = t;
          this.draw(act, from);
          this.animation = requestAnimationFrame(frame);
          return;
        }
        this.rest();
        return;
      }
      if (n !== this.lastFrame) this.draw(act, n);
      this.animation = requestAnimationFrame(frame);
    };
    this.animation = requestAnimationFrame(frame);
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
      this.rest();
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
    this.falling = true;
    this.dropY = start;
    this.drop.style.willChange = 'transform';
    this.drop.style.transform = `translateY(${start}px)`;
    let streak = -1;
    let t0: number | undefined;
    const fall = (t: number): void => {
      if (!this.canAnimate()) {
        this.rest();
        return;
      }
      t0 ??= t;
      const elapsed = t - t0;
      const p = Math.min(1, elapsed / ENTRANCE_FALL_MS);
      this.dropY = start * (1 - p * p);
      this.drop!.style.transform = `translateY(${this.dropY.toFixed(2)}px)`;
      const s = Math.floor(elapsed / STREAK_MS) % 2;
      if (s !== streak) {
        streak = s;
        renderFalling(this.kit, this.target, s);
        this.blitDrop();
        this.lastFrame = -1;
      }
      if (p < 1) {
        this.animation = requestAnimationFrame(fall);
        return;
      }
      // Touchdown: the authored frames from 'Impact' on, uncropped, with the shadow in the frames.
      this.falling = false;
      this.dropY = 0;
      this.drop!.style.transform = '';
      this.drop!.style.willChange = '';
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      this.run(act, ENTRANCE_IMPACT_FRAME, false);
    };
    this.animation = requestAnimationFrame(fall);
  }

  refresh(): void {
    if (this.animation) return;
    this.rest();
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
    };
  }

  destroy(): void {
    this.stop();
    this.observer?.disconnect();
    globalThis.document?.removeEventListener('visibilitychange', this.onVisibility);
    this.dprQuery?.removeEventListener?.('change', this.onDprChange);
  }
}
