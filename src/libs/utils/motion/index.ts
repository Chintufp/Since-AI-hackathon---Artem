export { AvatarController, scaleFor, CROP, DROP, SCENE_SIZE, DISPLAY_CSS_SIZE, IDLE_POSE_MS, ENTRANCE_FALL_MS, ENTRANCE_IMPACT_FRAME, TALL_ACTS, LOOP_INTERJECTIONS, LANDING_FRAMES } from './avatar.ts';
export { renderFalling, renderFloorShadow } from './entrance-fall.ts';
export type { Avatar, AvatarHost, AvatarOptions, AvatarStatus, ActKey, PlayOptions, CompanionAvatar, BaseMode, Surface, PoseSpec, FallOptions } from './avatar.ts';
// desktop (R31..R36): physics and composed poses for the companion.
export {
  derivedGravity, fallDuration, impactSpeed, landingTier, ballistic, turnSequence, turnAt, rollAt, rollDuration,
  FALL_REFERENCE_MS, LANDING_SPEED_PX_S, ROLL_SPEED_PX_S, ROLL_ACCEL_PX_S2, TURN_STEP_PX,
} from './physics.ts';
export type { LandingTier, RollDirection, Ballistic, BallisticState, RollState } from './physics.ts';
export {
  pressPose, carriedPose, lookPose, settlePose, rollPose, floorShadow, shadowTierFor, heldFrame, questionGlyphRects,
  SHADOW_WIDTHS, SHADOW_TIER_LIFT_PX, SHADOW_STRIP, SETTLE_SHAPES, SETTLE_FRAME_MS, BODY_CENTRE_X,
} from './poses.ts';
export type { LookView, ShadowTier, CarriedSpec, HeldSpec, GlyphSide } from './poses.ts';
export { createMinimalKit, PALETTE } from './minimal-kit.ts';
export { createCompactCoreActs } from './core-acts.ts';
export { createCompactStateActs, QUESTION_GLYPH } from './state-acts.ts';
export { createCompactPropActs } from './prop-acts.ts';
export { renderBurst, BURST } from './burst.ts';
export type { Act, DrawTarget, Kit } from './types.ts';
