# motion

Snowbally: the ChatGPT v006 compact companion and the v008 avatar behaviour as reusable TypeScript. Browser-safe, no dependencies beyond the DOM canvas API.

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
- `playEntranceThenRest()` plays the `entrance` act once (clipped above the scene as authored), then idles; with reduced motion it is the still frame.
- `play('processing', { loop: true })` repeats until `rest()` or another act (used while waiting for the service).
- Display scale follows `devicePixelRatio` changes (matchMedia resolution query).

## Checks run

`node --test 'src/libs/utils/motion/**/*.test.ts'` (14 tests, all pass):

- Every act, every frame (285 frames over 16 acts): finite integer rects, non-negative sizes, palette colours only; invalid frame inputs clamp.
- `parity.test.ts` replays every frame through the frozen design-lab JavaScript (read only) and the port and requires identical draw-call sequences.
- idle3: exactly three distinct rasters, fixed left/right/bottom bounds, top moves at most 2 px. Entrance: 24 frames, starts above the scene.
- Avatar with fake canvases/timers: 44*scale canvas, 88px CSS, `(26,42,44,44)` nearest-neighbour blit, idle = timeouts only (0 rAF), reduced = no timers, entrance runs on rAF then idles, glyph overlay, no background fill.

## Known limitations

- Visual quality was judged from Electron screenshots (docs/runs/2026-11-07-overnight/screenshots), not from a user study.
- Prop acts (moonwalk, hero) are ported and exported but not used by the desktop UI.
- Sound is not implemented (none authored).
