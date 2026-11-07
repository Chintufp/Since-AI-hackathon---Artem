/**
 * desktop (R31..R36): pure motion maths for the UX pass. Gravity is derived from the R28 launch
 * (the launch keeps falling exactly ENTRANCE_FALL_MS for its distance D0), so every later drop
 * feels like the same world. No timers, no DOM: functions of distance and time only.
 */

/** desktop (R32): the launch fall time (R28); any drop height h then takes 900 * sqrt(h / D0) ms. */
export const FALL_REFERENCE_MS = 900;
/** desktop (R32): impact speeds (CSS px/s) that pick the landing: below hop = settle, below entrance = hop, else the full plop. */
/**
 * Landing tiers by impact speed. With the launch-derived G (about 2100 px/s^2 on a 872 px work area) these
 * correspond to drops of about 48 px (settle below) and 290 px (the full entrance plop above).
 */
export const LANDING_SPEED_PX_S = { hop: 450, entrance: 1100 } as const;
/** desktop (R33): roll speed limit, acceleration (and symmetric braking) and one turn step per 22 px of travel (no-slip). */
export const ROLL_SPEED_PX_S = 900;
export const ROLL_ACCEL_PX_S2 = 1600;
export const TURN_STEP_PX = 22;

export type LandingTier = 'settle' | 'hop' | 'entrance';
export type RollDirection = 'left' | 'right';

const finite = (v: number, fallback = 0): number => (Number.isFinite(v) ? v : fallback);

/** G (CSS px/s^2) such that a fall of `d0Px` takes FALL_REFERENCE_MS from rest: G = 2 * D0 / 0.9^2. */
export function derivedGravity(d0Px: number): number {
  const d0 = Math.max(1, finite(d0Px, 1));
  const t = FALL_REFERENCE_MS / 1000;
  return (2 * d0) / (t * t);
}

/** Time (ms) to fall `liftPx` from rest under `g`. */
export function fallDuration(liftPx: number, g: number): number {
  const h = Math.max(0, finite(liftPx));
  const gg = Math.max(1e-6, finite(g, 1));
  return 1000 * Math.sqrt((2 * h) / gg);
}

/** Speed (px/s) at touchdown after falling `liftPx` from rest. */
export function impactSpeed(liftPx: number, g: number): number {
  return Math.sqrt(2 * Math.max(0, finite(g)) * Math.max(0, finite(liftPx)));
}

/** Landing tier by impact speed (px/s). */
export function landingTier(speedPxS: number): LandingTier {
  const v = Math.abs(finite(speedPxS));
  return v < LANDING_SPEED_PX_S.hop ? 'settle' : v < LANDING_SPEED_PX_S.entrance ? 'hop' : 'entrance';
}

export interface BallisticState {
  /** Height above the floor (px, >= 0). */
  lift: number;
  /** Vertical velocity (px/s, negative = downwards). */
  vy: number;
  /** Horizontal travel since release (px). */
  x: number;
  /** Horizontal velocity (px/s); reaches 0 exactly at touchdown ("sticky snow": no slide). */
  vx: number;
  landed: boolean;
}

export interface Ballistic {
  /** Fall time (ms). */
  duration: number;
  /** Speed at touchdown (px/s). */
  impact: number;
  tier: LandingTier;
  /** Closed-form state at `tMs` after release (exact, so it never drifts with frame timing). */
  at(tMs: number): BallisticState;
}

/** A release at `liftPx` from rest vertically; an optional release `vx0` decays linearly to 0 at touchdown. */
export function ballistic(liftPx: number, g: number, vx0 = 0): Ballistic {
  const h = Math.max(0, finite(liftPx));
  const gg = Math.max(1e-6, finite(g, 1));
  const duration = fallDuration(h, gg);
  const T = duration / 1000;
  const v0 = finite(vx0);
  const impact = impactSpeed(h, gg);
  return {
    duration,
    impact,
    tier: landingTier(impact),
    at(tMs) {
      const t = Math.min(T, Math.max(0, finite(tMs) / 1000));
      const landed = t >= T;
      const lift = landed ? 0 : Math.max(0, h - 0.5 * gg * t * t);
      const x = T > 0 ? v0 * (t - (t * t) / (2 * T)) : 0;
      return { lift, vy: landed ? 0 : -gg * t, x, vx: landed || T === 0 ? 0 : v0 * (1 - t / T), landed };
    },
  };
}

/** Face turn order while rolling (verified on a strip: turn 1 -> 7 rotates counter-clockwise = rolling left). */
export function turnSequence(direction: RollDirection): readonly number[] {
  return direction === 'right' ? [0, 7, 6, 5, 4, 3, 2, 1] : [0, 1, 2, 3, 4, 5, 6, 7];
}

/** Turn index after `travelPx` of rolling (one step per TURN_STEP_PX). */
export function turnAt(travelPx: number, direction: RollDirection): number {
  const seq = turnSequence(direction);
  const step = Math.floor(Math.abs(finite(travelPx)) / TURN_STEP_PX);
  return seq[step % seq.length]!;
}

export interface RollState {
  /** Signed travel from the start (px; + = right). */
  x: number;
  /** Speed (px/s, >= 0). */
  v: number;
  /** Kit `turn` to draw. */
  turn: number;
  done: boolean;
}

/** Trapezoid profile: accelerate at ROLL_ACCEL_PX_S2 up to ROLL_SPEED_PX_S, cruise, brake symmetrically. */
function rollProfile(distancePx: number): { d: number; ta: number; tc: number; vp: number; total: number } {
  const d = Math.abs(finite(distancePx));
  const a = ROLL_ACCEL_PX_S2;
  const full = (ROLL_SPEED_PX_S * ROLL_SPEED_PX_S) / a; // distance spent accelerating + braking at full speed
  if (d >= full) {
    const ta = ROLL_SPEED_PX_S / a;
    const tc = (d - full) / ROLL_SPEED_PX_S;
    return { d, ta, tc, vp: ROLL_SPEED_PX_S, total: 2 * ta + tc };
  }
  const vp = Math.sqrt(a * d);
  const ta = vp / a;
  return { d, ta, tc: 0, vp, total: 2 * ta };
}

/** Duration (ms) of a roll over `distancePx`. */
export function rollDuration(distancePx: number): number {
  return rollProfile(distancePx).total * 1000;
}

/** Roll state `tMs` after starting a roll of signed `distancePx` (+ = right). */
export function rollAt(distancePx: number, tMs: number): RollState {
  const p = rollProfile(distancePx);
  const dir: RollDirection = finite(distancePx) < 0 ? 'left' : 'right';
  const sign = dir === 'left' ? -1 : 1;
  const a = ROLL_ACCEL_PX_S2;
  const t = Math.min(p.total, Math.max(0, finite(tMs) / 1000));
  let s: number;
  let v: number;
  if (t <= p.ta) {
    s = 0.5 * a * t * t;
    v = a * t;
  } else if (t <= p.ta + p.tc) {
    s = 0.5 * a * p.ta * p.ta + p.vp * (t - p.ta);
    v = p.vp;
  } else {
    const r = p.total - t;
    s = p.d - 0.5 * a * r * r;
    v = a * r;
  }
  s = Math.min(p.d, Math.max(0, s));
  return { x: s === 0 ? 0 : sign * s, v, turn: turnAt(s, dir), done: t >= p.total };
}
