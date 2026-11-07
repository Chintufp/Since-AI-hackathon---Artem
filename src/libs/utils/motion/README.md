# motion

Snowbally: the ChatGPT v006 compact companion (plus the v007 `click` Springy tap) and the v008/v009 avatar behaviour as reusable TypeScript. Browser-safe, no dependencies beyond the DOM canvas API.

## Public interface (`index.ts`)

- `AvatarController(canvas, { reduced(), hasQuestion() }, options?)` implements `Avatar`: `play(act, { loop? })`, `rest()`, `playEntranceThenRest()`, `refresh()`, `resize()`, `status()`, `destroy()`.
- `createMinimalKit()`, `createCompactCoreActs`, `createCompactStateActs`, `createCompactPropActs`: the authored art (frame tables, palette and integer rects unchanged).
- `renderBurst` / `BURST`: the tiny reward burst in the same pixel style (cosmetic; drawn only when Points & rewards is on).
- `scaleFor(devicePixelRatio)`: integer device scale.

## Behaviour (as v008)

- Acts draw onto a transparent 96 px raw scene (the white background fill is skipped); the 44x44 window at (26,42) is copied to the display canvas with smoothing off at `max(1, round(devicePixelRatio*2))` device pixels per art pixel. CSS box stays 88x88, so Retina output is crisp.
- Idle is three fixed poses held 500 ms by `setTimeout`. No `requestAnimationFrame` runs while idle; a reaction uses rAF only for its own frames, then returns to idle. Reactions take priority over idle.
- Hidden document, offscreen canvas (IntersectionObserver) and reduced motion pause everything and show the static first idle frame.
- The question glyph is extracted from the question act and overlaid on the idle body when `hasQuestion()`.
- `playEntranceThenRest()` with the optional `drop` canvas (R28; `.rf-drop` in the panel: the 44x86 scene column floor-aligned with the display canvas, pointer-events none): the body falls from above the window top for `ENTRANCE_FALL_MS` (900 ms) with constant acceleration via a CSS transform while the floor shadow waits on the display canvas, then the authored `entrance` frames from `ENTRANCE_IMPACT_FRAME` (5) play uncropped on the drop canvas, then idle. Without a drop canvas it plays the `entrance` act cropped as v008 did. Reduced motion: the still frame, the drop canvas is never shown. `entrance-fall.ts` holds the falling pose (stretch body + air streaks, no shadow) and the floor shadow.
- `play('processing', { loop: true })` repeats until `rest()` or another act (used while waiting for the service).
- Display scale follows `devicePixelRatio` changes (matchMedia resolution query).

## Checks run

`node --test 'src/libs/utils/motion/**/*.test.ts'` (14 tests, all pass):

- Every act, every frame (295 frames over 17 acts): finite integer rects, non-negative sizes, palette colours only; invalid frame inputs clamp.
- `parity.test.ts` replays every frame through the frozen design-lab JavaScript (ui v009 sources = pixel-motion v007 modules, v006 props; read only) and the port and requires identical draw-call sequences. `click`: 10 frames at 15 fps, deep frame 36x16, both rebounds 32 px high (the lab's measured poses).
- idle3: exactly three distinct rasters, fixed left/right/bottom bounds, top moves at most 2 px. Entrance: 24 frames, starts above the scene.
- Avatar with fake canvases/timers: 44*scale canvas, 88px CSS, `(26,42,44,44)` nearest-neighbour blit, idle = timeouts only (0 rAF), reduced = no timers, entrance runs on rAF then idles, glyph overlay, no background fill. Drop surface: 44x86 at scale, 172 px CSS, monotonic accelerating descent over ~900 ms, shadow-only display during the fall, landing frames 5–23 via the `(26,0,44,86)` blit, hidden again at idle; never shown under reduced motion; a reaction during the fall takes over.

## Known limitations

- Visual quality was judged from Electron screenshots (docs/runs/2026-11-07-overnight/screenshots), not from a user study.
- Prop acts (moonwalk, hero) are ported and exported but not used by the desktop UI.
- Sound is not implemented (none authored).
