# motion

Snowbally: the ChatGPT v006 compact companion (plus the v007 `click` Springy tap) and the v008/v009 avatar behaviour as reusable TypeScript. Browser-safe, no dependencies beyond the DOM canvas API.

## Public interface (`index.ts`)

- `AvatarController(canvas, { reduced(), hasQuestion() }, options?)` implements `Avatar`: `play(act, { loop? })`, `rest()`, `playEntranceThenRest()`, `refresh()`, `resize()`, `status()`, `destroy()`.
- `createMinimalKit()`, `createCompactCoreActs`, `createCompactStateActs`, `createCompactPropActs`: the authored art (frame tables, palette and integer rects unchanged).
- `renderBurst` / `BURST`: the tiny reward burst in the same pixel style (cosmetic; drawn only when Points & rewards is on).
- `scaleFor(devicePixelRatio)`: integer device scale.
- desktop (R31..R36), companion additions. `AvatarController` also implements `CompanionAvatar` (`Avatar` itself is unchanged):
  - `pose(spec: PoseSpec): void` with `{ kind: 'press' } | { kind: 'carried', happy?, gaze?, lift? } | { kind: 'settle', frame } | { kind: 'roll', turn } | { kind: 'look', gaze?, view? }`: a still, one draw per change.
  - `look(gaze: number, view?: 'front' | 'quarter'): boolean`: idle with gaze; redraws only on change (returns whether it drew).
  - `hold(spec: HeldSpec | null): void`: the held still (away / perched), optional authored question glyph.
  - `run(act: ActKey, from?: number, to?: number): void`: a frame range (inclusive), then the base mode.
  - `fallFrom(liftPx: number, onLand?: (tier) => void, options?: { onStep?(lift), onSettled?() }): LandingTier`.
  - `setBase('idle3' | 'processing' | 'hold')`, `setFallDistance(px | null)`, `gravity()`.
  - Options: `shadow` (the `.rf-shadow` strip canvas), `fallDistance` (D0 in CSS px).
  - `status()` adds `held, carried, airborne, lift, base, surface`.
  - Constants: `TALL_ACTS` (hop, backflip, half, hero), `LOOP_INTERJECTIONS` (click), `LANDING_FRAMES` (hop 11-17, entrance 5-23).
- `physics.ts` (pure): `derivedGravity(D0)` (= 2·D0/0.9²), `fallDuration(h, g)` (ms), `impactSpeed(h, g)`, `ballistic(h, g, vx0?)` (closed-form `at(t)`; `vx` is 0 at touchdown), `landingTier(v)` (`< 450` settle, `< 1100` hop, else entrance: about 48 px and 290 px drops with the launch-derived gravity), `turnSequence(dir)` (right 0,7,6,…,1; left 0,1,…,7), `turnAt(travel, dir)`, `rollAt(distance, t)` / `rollDuration(distance)` (accelerate at 1600 px/s² to 900 px/s, brake symmetrically, one turn step per 22 px).
- `poses.ts` (pure, only `kit.orb` / `kit.shadow` / `kit.pixel`): `pressPose` (= click frame 1), `carriedPose({ happy, gaze })`, `lookPose(gaze, view)` (= idle3 frame 0 at 0/front), `settlePose(frame)` (crouch, low; 62 ms each), `rollPose(turn)` (tuck + turn face), `floorShadow(tier)` (26 / 20 / 14 px, rows 80–88), `shadowTierFor(lift)`, `heldFrame(spec)` (glyph pixels taken from the authored question act, at their authored place; `glyphSide: 'left'` moves the same unflipped glyph into the box mirrored about x = 48, for the right-edge sliver only).

## Behaviour (as v008)

- Acts draw onto a transparent 96 px raw scene (the white background fill is skipped); the 44x44 window at (26,42) is copied to the display canvas with smoothing off at `max(1, round(devicePixelRatio*2))` device pixels per art pixel. CSS box stays 88x88, so Retina output is crisp.
- Idle is three fixed poses held 500 ms by `setTimeout`. No `requestAnimationFrame` runs while idle; a reaction uses rAF only for its own frames, then returns to idle. Reactions take priority over idle.
- Hidden document, offscreen canvas (IntersectionObserver) and reduced motion pause everything and show the static first idle frame.
- The question glyph is extracted from the question act and overlaid on the idle body when `hasQuestion()`.
- `playEntranceThenRest()` with the optional `drop` canvas (R28; `.rf-drop` in the panel: the 44x86 scene column floor-aligned with the display canvas, pointer-events none): the body falls from above the window top for `ENTRANCE_FALL_MS` (900 ms) with constant acceleration via a CSS transform while the floor shadow waits on the display canvas, then the authored `entrance` frames from `ENTRANCE_IMPACT_FRAME` (5) play uncropped on the drop canvas, then idle. Without a drop canvas it plays the `entrance` act cropped as v008 did. Reduced motion: the still frame, the drop canvas is never shown. `entrance-fall.ts` holds the falling pose (stretch body + air streaks, no shadow) and the floor shadow.
- `play('processing', { loop: true })` repeats until `rest()` or another act (used while waiting for the service).
- Display scale follows `devicePixelRatio` changes (matchMedia resolution query).

## Behaviour, desktop (R31..R36) additions

- **Base mode.** Every one-shot (`play`, `run`, landings) returns to the base: the held still if `hold(spec)` is set, else the `processing` loop if it is the base, else idle3. `play('processing', { loop: true })` makes the loop the base; `play('click')` interjects and the loop resumes; any other act (`result`, `error`, `hello`, …) ends the loop as before; `rest()` ends a loop but keeps a hold. Hidden / offscreen pauses the loop and it resumes when visible again (before, hiding ended it).
- **Hold.** While held: zero timers, zero rAF. `rest()`, `refresh()`, visibility and IntersectionObserver changes redraw the same still. A one-shot during a hold returns to it; `hold(null)` returns to idle3. A frame in flight when the window is hidden or scrolled out runs its own not-animating branch at once, so a fall still reports `onStep(0)`, `onLand` and `onSettled`, and a landing still calls `onSettled`. The question glyph is not overlaid on the launch, its landing frames or the tall acts (it would hang at floor height beside a moving body).
- **Stills.** `pose()` and `look()` stop timers and rAF and draw once; the same spec again draws nothing (for the carried pose only the shadow strip is repainted when its lift tier changes). `refresh()` redraws a still in place. `look(0, 'front')` returns to the idle loop; `look()` is ignored while a reaction plays, while held or processing, and under reduced motion.
- **Surfaces.** Acts in `TALL_ACTS` (tops at scene rows 36 / 24 / 36 / <42) and the carried pose are drawn on the drop surface (44x86 via `(26,0,44,86)`) while the display canvas is cleared; afterwards the drop surface is hidden again. Without a drop surface they play cropped as before.
- **Drops.** `fallFrom(h)` uses gravity derived from the launch (`setFallDistance` / `fallDistance`, else the measured launch distance, else the drop surface's own measurement). The body (carried pose, or the entrance's falling pose with streaks for the hardest tier) is drawn without a shadow on the drop surface, which is translated up by the lift and falls (or, with `onStep`, the host moves the carrier). The shadow shows on the `.rf-shadow` strip by lift tier (or on the floor-bound display canvas without a strip). At touchdown: settle (crouch, low), hop 11–17 or entrance 5–23 on the drop surface, then the base.
- Launch (R28) is unchanged apart from status bookkeeping (`airborne`, `lift`) and remembering its distance as D0.

## Checks run

`node --test src/libs/utils/motion/` (44 tests, all pass: motion 17, parity 1, physics 5, poses 9, companion-avatar 12):

- Every act, every frame (295 frames over 17 acts): finite integer rects, non-negative sizes, palette colours only; invalid frame inputs clamp.
- `parity.test.ts` replays every frame through the frozen design-lab JavaScript (ui v009 sources = pixel-motion v007 modules, v006 props; read only) and the port and requires identical draw-call sequences. `click`: 10 frames at 15 fps, deep frame 36x16, both rebounds 32 px high (the lab's measured poses).
- idle3: exactly three distinct rasters, fixed left/right/bottom bounds, top moves at most 2 px. Entrance: 24 frames, starts above the scene.
- Avatar with fake canvases/timers: 44*scale canvas, 88px CSS, `(26,42,44,44)` nearest-neighbour blit, idle = timeouts only (0 rAF), reduced = no timers, entrance runs on rAF then idles, glyph overlay, no background fill. Drop surface: 44x86 at scale, 172 px CSS, monotonic accelerating descent over ~900 ms, shadow-only display during the fall, landing frames 5–23 via the `(26,0,44,86)` blit, hidden again at idle; never shown under reduced motion; a reaction during the fall takes over.

- Physics: D0 falls in exactly 900 ms and any h in 900·√(h/D0); tier thresholds at 450 / 1100 px/s; ballistic lift monotonic with `vx` 0 at touchdown; roll never exceeds 900 px/s or 1600 px/s², ends exactly at its distance, turn index per 22 px in both directions.
- Poses: palette-only integer rects; only `kit.orb/shadow/pixel` (kit spy); press = click frame 1 and look(0, front) = idle3 frame 0 raster for raster; carried has no shadow and nubs one row below; roll tuck top below row 42; shadow tiers 26/20/14 inside rows 80–88; held glyph = the 10 authored ink pixels.
- Companion avatar: `fallFrom(200)` → hop frames 11–17 and `fallFrom(800)` → entrance 5–23 (D0 = 700), `fallFrom(10)` → settle 0,1; fall time ≈ 900·√(h/D0); `onStep` mode; reduced = instant; a carried pose mid-air cancels the fall; `hold()` blocks `rest()` / `refresh()` timers; tall acts blit through `(26,0,44,86)`; `play('click')` and `pose(press)` + `run('click', 2)` during processing return to the loop, `result` ends it; `look()` redraws only on change; carried pose redraws once per change and the shadow strip once per tier.

## Known limitations

- Visual quality was judged from Electron screenshots (docs/runs/2026-11-07-overnight/screenshots), not from a user study.
- Prop acts (moonwalk, hero) are ported and exported but not used by the desktop UI.
- Sound is not implemented (none authored).
- desktop (R31..R36): the new behaviour is verified with fake canvases only; the harness worker checks it in Electron. With a real launch distance around 850 px the hop / entrance boundary falls at a release height of about 195 px and the settle tier only below about 21 px.
- The shadow lift tiers (48 / 160 px) and the roll's symmetric braking are this module's choices (not given numbers in the SPEC).
- If requestAnimationFrame stops firing while the page stays visible (for example a niced, starved renderer), an in-flight fall, roll or landing waits for the next frame; only hide / scroll-out recovers it at once. A roll also ends on whatever turn its distance gives (one step per 22 px), so the face jumps to front at the settle unless the host picks a distance that is a multiple of 176 px.
