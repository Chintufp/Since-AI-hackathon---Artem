/**
 * desktop (R31..R36): still poses for the companion, composed ONLY from kit.orb / kit.shadow /
 * kit.pixel parameters (no new anatomy, no new sprite): press, carried, look, landing settle,
 * roll, the floor shadow strip and the away / perched held frame. Pure functions of their
 * arguments onto a 96x96 scene, like the authored acts.
 */
import { createCompactStateActs, QUESTION_GLYPH } from './state-acts.ts';
import type { DrawTarget, Kit } from './types.ts';

export type LookView = 'front' | 'quarter';
export type ShadowTier = 0 | 1 | 2;

/** desktop (R32): floor shadow widths by lift tier (26 = the resting width, 20 = the acts' airborne width, 14 = high). */
export const SHADOW_WIDTHS = [26, 20, 14] as const;
/** desktop (R32): lift (CSS px) at which the floor shadow steps down to tier 1 and tier 2. */
export const SHADOW_TIER_LIFT_PX = [48, 160] as const;
/** desktop (R32): the `.rf-shadow` canvas shows scene rows 80-88 of the 44 px column only. */
export const SHADOW_STRIP = { x: 26, y: 80, w: 44, h: 8 } as const;
/** desktop (R32): the composed 2-frame landing settle (a soft touchdown), 62 ms per frame. */
export const SETTLE_SHAPES = ['crouch', 'low'] as const;
export const SETTLE_FRAME_MS = 62;

const sign = (v: number): -1 | 0 | 1 => (!Number.isFinite(v) || v === 0 ? 0 : v < 0 ? -1 : 1);

/** Press: the look of the authored click frame 1 (crouch, happy) with its resting shadow. */
export function pressPose(k: Kit, c: DrawTarget): void {
  k.clear(c);
  k.shadow(c, { width: SHADOW_WIDTHS[0] });
  k.orb(c, { shape: 'crouch', expression: 'happy' });
}

export interface CarriedSpec {
  /** surprised at lift-off, happy after a moment. */
  happy?: boolean;
  /** -1 | 0 | 1: the sign of the horizontal velocity. */
  gaze?: number;
}

/** Carried / airborne: stretched body, feet nubs one row below the body (dangling), no shadow (it stays on the floor). */
export function carriedPose(k: Kit, c: DrawTarget, { happy = false, gaze = 0 }: CarriedSpec = {}): void {
  k.clear(c);
  k.orb(c, {
    shape: 'stretch',
    expression: happy ? 'happy' : 'surprised',
    gaze: sign(gaze),
    feet: [{ side: -1, lift: -1 }, { side: 1, lift: -1 }],
  });
}

/** Idle with gaze: idle3 frame 0 with `gaze` / `view`; raster-identical to idle3 frame 0 at gaze 0, front. */
export function lookPose(k: Kit, c: DrawTarget, gaze = 0, view: LookView = 'front'): void {
  k.clear(c);
  k.shadow(c, { width: SHADOW_WIDTHS[0] });
  k.orb(c, { shape: 'neutral', gaze: sign(gaze), view: view === 'quarter' ? 'quarter' : 'front' });
}

/** Landing settle frame 0 (crouch) or 1 (low), on the floor with its shadow. */
export function settlePose(k: Kit, c: DrawTarget, frame: number): void {
  const i = frame >= 1 ? 1 : 0;
  k.clear(c);
  k.shadow(c, { width: SHADOW_WIDTHS[0] });
  k.orb(c, { shape: SETTLE_SHAPES[i] });
}

/** Rolling: the tuck body with the kit's turn face (0 = front), on the floor. */
export function rollPose(k: Kit, c: DrawTarget, turn: number, { shadow = true }: { shadow?: boolean } = {}): void {
  k.clear(c);
  if (shadow) k.shadow(c, { width: SHADOW_WIDTHS[0] });
  const t = Number.isFinite(turn) ? ((Math.round(turn) % 8) + 8) % 8 : 0;
  k.orb(c, { shape: 'tuck', turn: t });
}

/** Shadow tier for a height above the floor. */
export function shadowTierFor(liftPx: number): ShadowTier {
  const h = Number.isFinite(liftPx) ? Math.max(0, liftPx) : 0;
  return h < SHADOW_TIER_LIFT_PX[0] ? 0 : h < SHADOW_TIER_LIFT_PX[1] ? 1 : 2;
}

/** The floor shadow alone (kit.shadow at its authored floor row), for the `.rf-shadow` strip. */
export function floorShadow(k: Kit, c: DrawTarget, tier: number): void {
  const i = tier >= 2 ? 2 : tier >= 1 ? 1 : 0;
  k.clear(c);
  k.shadow(c, { width: SHADOW_WIDTHS[i] });
}

export interface HeldSpec {
  shape?: 'neutral' | 'low' | 'high' | 'tuck' | 'crouch';
  expression?: 'normal' | 'happy' | 'blink' | 'surprised';
  gaze?: number;
  view?: LookView;
  /** Draw the authored question glyph at its authored place (never relocated). */
  question?: boolean;
}

const glyphCache = new WeakMap<Kit, Array<{ x: number; y: number; w: number; h: number }>>();

/** The question glyph's ink pixels, taken from the authored question act (not re-authored). */
export function questionGlyphRects(k: Kit): ReadonlyArray<{ x: number; y: number; w: number; h: number }> {
  let rects = glyphCache.get(k);
  if (rects) return rects;
  rects = [];
  const out = rects;
  let fill = '';
  const rec: DrawTarget = {
    get fillStyle() {
      return fill;
    },
    set fillStyle(v) {
      fill = String(v);
    },
    clearRect: () => {
      out.length = 0;
    },
    fillRect: (x, y, w, h) => {
      const g = QUESTION_GLYPH;
      if (fill === k.palette.ink && x >= g.x && y >= g.y && x + w <= g.x + g.w && y + h <= g.y + g.h) out.push({ x, y, w, h });
    },
  };
  const q = createCompactStateActs({ kit: k }).question;
  q.render(rec, q.stillFrame);
  glyphCache.set(k, rects);
  return rects;
}

/** Away / perched still: a resting body with optional gaze / view, plus the question glyph when asked. */
export function heldFrame(k: Kit, c: DrawTarget, spec: HeldSpec = {}): void {
  k.clear(c);
  k.shadow(c, { width: SHADOW_WIDTHS[0] });
  k.orb(c, {
    shape: spec.shape ?? 'neutral',
    expression: spec.expression ?? 'normal',
    gaze: sign(spec.gaze ?? 0),
    view: spec.view === 'quarter' ? 'quarter' : 'front',
  });
  if (spec.question) for (const r of questionGlyphRects(k)) k.pixel(c, r.x, r.y, r.w, r.h, k.palette.ink);
}
