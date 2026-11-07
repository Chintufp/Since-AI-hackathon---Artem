# Worker report: ux-motion (UX pass, R31..R36)

Scope: `src/libs/utils/motion/**` only. Nothing committed, the Electron app was not run, no files outside the module were edited (apart from this report).

## What I built

- `physics.ts` (new, pure): gravity derived from the R28 launch, fall time, impact speed, a closed-form ballistic release (`vx` reaches 0 at touchdown), landing tier by impact speed, roll kinematics (speed limit, acceleration, symmetric braking) and turn sequences per direction.
- `poses.ts` (new, pure): press, carried, look, settle (2 frames), roll, floor shadow tiers for the `.rf-shadow` strip, and the held still for away / perched with the authored question glyph. They use only `kit.orb`, `kit.shadow` and `kit.pixel` (plus `kit.clear`, as every authored act does). A kit spy test enforces this. The glyph's ink pixels are read from the authored question act at run time, not copied.
- `avatar.ts` additions (everything existing stays, all old tests green, the R28 entrance unchanged): base mode, `pose`, `look`, `hold`, `run`, `fallFrom`, `setBase`, `setFallDistance`, `gravity`, tall-act routing to `.rf-drop`, optional shadow strip canvas, and the new `status()` fields. Every addition is marked `desktop (R31..R36)` / `desktop (R32)` / `desktop (R33)`.
- `index.ts` exports everything new. `README.md` updates: Public interface, Behaviour (new section), Checks run, Known limitations.

## Public API

```ts
// physics.ts
FALL_REFERENCE_MS = 900; LANDING_SPEED_PX_S = { hop: 300, entrance: 900 };
ROLL_SPEED_PX_S = 900; ROLL_ACCEL_PX_S2 = 1600; TURN_STEP_PX = 22;
type LandingTier = 'settle' | 'hop' | 'entrance'; type RollDirection = 'left' | 'right';
derivedGravity(d0Px: number): number                 // 2*D0/0.9^2 px/s^2
fallDuration(liftPx: number, g: number): number       // ms
impactSpeed(liftPx: number, g: number): number        // px/s
landingTier(speedPxS: number): LandingTier
ballistic(liftPx: number, g: number, vx0?: number): { duration; impact; tier; at(tMs): { lift; vy; x; vx; landed } }
turnSequence(direction: RollDirection): readonly number[]   // right [0,7,6,5,4,3,2,1], left [0,1,...,7]
turnAt(travelPx: number, direction: RollDirection): number
rollAt(distancePx: number, tMs: number): { x; v; turn; done }   // signed distance, + = right
rollDuration(distancePx: number): number              // ms

// poses.ts (k = Kit, c = DrawTarget, 96x96 scene)
SHADOW_WIDTHS = [26, 20, 14]; SHADOW_TIER_LIFT_PX = [48, 160]; SHADOW_STRIP = { x: 26, y: 80, w: 44, h: 8 };
SETTLE_SHAPES = ['crouch', 'low']; SETTLE_FRAME_MS = 62;
pressPose(k, c); carriedPose(k, c, { happy?, gaze? }); lookPose(k, c, gaze?, view?: 'front'|'quarter');
settlePose(k, c, frame); rollPose(k, c, turn, { shadow? }); floorShadow(k, c, tier); shadowTierFor(liftPx): 0|1|2;
heldFrame(k, c, { shape?, expression?, gaze?, view?, question? }); questionGlyphRects(k)

// avatar.ts
TALL_ACTS = {hop, backflip, half, hero}; LOOP_INTERJECTIONS = {click}; LANDING_FRAMES = { hop: [11,17], entrance: [5,23] };
type BaseMode = 'idle3' | 'processing' | 'hold'; type Surface = 'display' | 'drop';
type PoseSpec = { kind:'press' } | { kind:'carried'; happy?; gaze?; lift? } | { kind:'settle'; frame } | { kind:'roll'; turn } | { kind:'look'; gaze?; view? };
interface FallOptions { onStep?(liftPx: number): void; onSettled?(): void }
interface CompanionAvatar extends Avatar {
  pose(spec: PoseSpec): void;
  look(gaze: number, view?: LookView): boolean;
  hold(spec: HeldSpec | null): void;
  run(act: ActKey, from?: number, to?: number): void;          // inclusive range
  fallFrom(liftPx: number, onLand?: (tier: LandingTier) => void, options?: FallOptions): LandingTier;
  setBase(base: BaseMode): void;
  setFallDistance(px: number | null): void;
}
AvatarOptions += { shadow?: HTMLCanvasElement | null; fallDistance?: number }
AvatarStatus += { held; carried; airborne; lift; base: BaseMode; surface: Surface }
// status().mode can now also be 'hold', 'look', 'pose:press' | 'pose:carried' | 'pose:settle' | 'pose:roll', 'fall', 'land:settle'
```

### Notes for the companion and harness workers
- `Avatar` is **unchanged**. The new methods are on `CompanionAvatar`, which `AvatarController` implements. The panel factory type `(canvas, host, surfaces) => Avatar` has to become `=> CompanionAvatar` (and `surfaces` gains `shadow`) for the panel to call them. This is on the companion side; `renderer.ts` already builds an `AvatarController`.
- Press → click: `pose({ kind: 'press' })` on pointerdown (draws click frame 1, `lastFrame` 1), then `run('click', 2)` on release. Both keep a processing loop.
- Drag: `pose({ kind: 'carried', happy, gaze, lift })` on every pointermove is cheap. The body is redrawn only when happy/gaze change, and the shadow strip only when the lift tier changes.
- Release: by default `fallFrom(lift)` translates `.rf-drop` up by the lift while the carrier is already back at the floor (like the entrance). To keep the hitbox under him (so he can be caught mid-air), pass `{ onStep: (lift) => moveCarrier(lift) }`. The drop surface is then not translated. Read `status().lift` before `pose(carried)` to continue a catch from the current height.
- Gravity: call `setFallDistance(D0)` (or pass `fallDistance`) with the launch distance from the window height. Otherwise the measured launch distance (or the drop surface's own measurement) is used.
- Away / perched: `hold({ ... })` (the glyph follows `hasQuestion()` unless `question` is given). `hold(null)` releases. Roll steps: `pose({ kind: 'roll', turn: rollAt(d, t).turn })` from the host's own rAF, then `pose({ kind: 'settle', frame: 0|1 })`.

## Verified

- `pnpm typecheck`: clean.
- `node --test src/libs/utils/motion/`: 44/44 (motion 17, parity 1, physics 5, poses 9, companion-avatar 12).
- `pnpm test`: 287/287 at the time of the run (it includes other workers' in-progress files).
- The frozen files (`minimal-kit.ts`, `core-acts.ts`, `state-acts.ts`, `prop-acts.ts`, `parity.test.ts`) have no diff.
- Specific checks from the brief, all with fake canvases:
  - `fallFrom(200)` lands in the hop tier with lastFrame 11..17; `fallFrom(800)` lands in the entrance tier with lastFrame 5..23 (D0 = 700 px); `fallFrom(10)` uses the settle frames 0, 1.
  - `hold()` blocks the timers of `rest()` and `refresh()` (0 timers, 0 rAF after 5 s of mock time).
  - The tall acts blit through `(26,0,44,86)`, and their tops are measured above row 42.
  - `play('click')` during the processing loop returns to the loop, while `result` ends it.
  - `look()` redraws only on change.
  - All poses use palette colours and integer rectangles.
  - Press equals click frame 1, and look(0, front) equals idle3 frame 0, raster for raster.

## Not verified

- Nothing ran in Electron (that is the harness job). So these are unmeasured: real frame times, CPU, the visual look of the carried pose and of the drops, the `.rf-shadow` placement, and IntersectionObserver behaviour with real slivers.
- How the companion code will actually call this API. That code was being written in parallel.

## Deviations and choices (with reasons)

1. **`Avatar` is unchanged and the additions are on `CompanionAvatar`.** Adding required members to `Avatar` could break fakes that other workers write at the same time.
2. **Loop base rule.** `play('processing', { loop: true })` makes the loop the base, and only `LOOP_INTERJECTIONS` (`click`) return to it. Any other `play()` ends the loop, and so does `rest()`. This keeps today's panel flow working (processing → `result` / `error` / `hello` ends it) and meets the SPEC rule for click. An explicit `setBase()` is also available.
3. **Hidden or offscreen pauses the processing loop instead of ending it.** It resumes when visible. Before, hiding ended the loop.
4. **New constants not given numbers in the SPEC:**
   - `SHADOW_TIER_LIFT_PX = [48, 160]` (when the shadow steps from 26 to 20 to 14 px)
   - `SETTLE_FRAME_MS = 62` (the SPEC says 62 ms)
   - `LANDING_FRAMES`
   - `TALL_ACTS`
   - `LOOP_INTERJECTIONS`

   They should be listed in DECISIONS R32 next to the SPEC constants.
5. **The roll brakes symmetrically** (trapezoid profile) instead of arriving at full speed. The SPEC names only a speed limit and an acceleration; braking avoids a hard stop before the 2-frame settle. To arrive at full speed instead, change `rollProfile` in `physics.ts`.
6. **Airborne body.** For the hop and settle tiers it is the carried pose with a surprised face and no shadow. For the entrance tier it is the R28 falling pose with streaks (`renderFalling`), so a high drop looks like the launch.
7. **`fallFrom` without a drop surface and without `onStep`** skips the airborne phase and lands at once (on the display canvas, cropped), because nothing could show him in the air.
8. **Tier boundaries in practice.** With a real D0 of about 850 px, the hop / entrance boundary is at a release height of about 195 px and the settle tier is below about 21 px. The brief's examples (200 → hop, 800 → entrance) are exact with D0 ≤ 820 px; the tests use D0 = 700. On the real display, a 200 px release lands in the entrance tier. Worth a look in the harness.

## Relayed user request

The run's relayed user request asks that the demo show the Slack connection and MCP communication (for example with Claude). That is outside this worker's scope (motion module only) and was not worked on here. It needs a demo / harness step owned by another worker.
