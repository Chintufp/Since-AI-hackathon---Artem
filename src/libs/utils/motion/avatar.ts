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
 */
import { createCompactCoreActs } from './core-acts.ts';
import type { CoreActKey } from './core-acts.ts';
import { createMinimalKit } from './minimal-kit.ts';
import { createCompactPropActs } from './prop-acts.ts';
import type { PropActKey } from './prop-acts.ts';
import { createCompactStateActs, QUESTION_GLYPH } from './state-acts.ts';
import type { StateActKey } from './state-acts.ts';
import type { Act, DrawTarget } from './types.ts';

export type ActKey = CoreActKey | StateActKey | PropActKey;

export const SCENE_SIZE = 96;
export const CROP = { x: 26, y: 42, size: 44 } as const;
export const DISPLAY_CSS_SIZE = 88;
export const IDLE_POSE_MS = 500;

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
  private readonly acts: Record<ActKey, Act>;
  private readonly glyph: HTMLCanvasElement;
  private scale = 2;
  private animation = 0;
  private idleTimer: ReturnType<typeof setTimeout> | 0 = 0;
  private idlePose = 0;
  private visible = true;
  private mode = 'idle3';
  private lastFrame = -1;
  private looping = false;
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
    if (this.lastFrame >= 0) this.blit();
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

  private draw(act: Act, frame: number): void {
    act.render(this.target, frame);
    if (this.host.hasQuestion() && act !== this.acts.question) this.rawCtx.drawImage(this.glyph, QUESTION_GLYPH.x, QUESTION_GLYPH.y);
    this.blit();
    this.lastFrame = frame;
  }

  private stop(): void {
    if (this.animation) cancelAnimationFrame(this.animation);
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.animation = 0;
    this.idleTimer = 0;
    this.looping = false;
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
    this.looping = !!options.loop;
    this.draw(act, 0);
    let started: number | undefined;
    const frame = (t: number): void => {
      if (!this.canAnimate()) {
        this.rest();
        return;
      }
      started ??= t;
      const n = Math.max(0, Math.floor(((t - started) * act.fps) / 1000));
      if (n >= act.frames) {
        if (this.looping) {
          started = t;
          this.draw(act, 0);
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

  /** Launch behaviour (R05): the entrance once, clipped above the scene as authored, then idle. Reduced motion: still. */
  playEntranceThenRest(): void {
    if (!this.canAnimate()) {
      this.rest();
      return;
    }
    this.play('entrance');
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
    };
  }

  destroy(): void {
    this.stop();
    this.observer?.disconnect();
    globalThis.document?.removeEventListener('visibilitychange', this.onVisibility);
    this.dprQuery?.removeEventListener?.('change', this.onDprChange);
  }
}
