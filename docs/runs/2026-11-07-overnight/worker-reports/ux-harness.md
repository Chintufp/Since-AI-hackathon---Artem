# Worker report: ux-harness (UX pass, R31..R36)

Scope: `src/apps/desktop/shots.ts`, `scripts/screenshot.mjs`, `scripts/real-check.mjs`, `docs/runs/2026-11-07-overnight/screenshots/**` (regenerated) and this report. Nothing else was edited and nothing is committed. Most of the harness code was already in the WIP commit `0c809df` ("harness scenarios in progress"). This session ran it to completion, fixed the three measurement problems the runs exposed (below), and regenerated every output.

No contract request was needed. No companion or shell check failed in the final runs, so `contract-requests/harness.md` was not written.

## What the harness does now

`node scripts/screenshot.mjs` builds, runs `dist/desktop/shots.cjs` with the dev mock, then composes the strips and compares against HEAD (python3 + Pillow, run as `python3 -I -c`). `node scripts/real-check.mjs` does the same against a real service it starts on its own port (`KT_REAL_PORT`, default 47951, `--db :memory: --seed elisa`) and stops afterwards.

Each run uses a throwaway Electron profile, so the app's own localStorage is never touched. The window ignores the real mouse by default (no forwarding), so the real cursor on this Mac cannot steer the scenarios. The renderer's click-through decisions are still recorded through a spy on `ipcMain` for `kt:ignore-mouse`. `KT_SHOTS_FORWARD=1` applies them with the production handler instead.

### Regular states (41, as before)
- **420 px:** taken in the work-area window (R31) with `away=0`, so he stays in for still shots. Each shot is cropped to the 420x680 panel area at the window's bottom-right, around the carrier: `x = bodyX + 79 − 420`, clamped, and `y = H − 680`.
- **320 px:** taken in the column window (`KT_WINDOW_MODE=column` geometry, `COLUMN_FLAGS`), because only the column window can be 320 px wide now.
- **Reduced-motion stills (39–41):** taken in the work-area window, through the real Settings toggle.
- **Column mode:** walks the old 420 sequence again into `column/`.
- **Entrance capture:** still full window height (868 px), cropped to the 420 px around his home spot. `entrance-strip.png` uses the full height at half scale; `landing-strip.png` uses the 168 px floor region at full scale.

### Companion scenarios (work-area window, default flags, mock)
Gestures are dispatched as `PointerEvent`s inside the page, so they are deterministic. The companion is reached through `__kt.panel.companion` (`command`, `poll`, `status`, `engagement`) and `panel.status().companion`.

The scenarios, in order:
1. Launch, then leave after 4 s.
2. Proximity peek: a mousemove into the edge zone, the dwell, then return + `hello`.
3. In with the pointer far: idle CPU and rAF, then a 60 Hz mousemove flood, then the leave after 20 s.
4. `webContents.sendInputEvent` smoke test: the real input path, click-through and the toggle.
5. Press: the pose on the next paint.
6. Click: tap + toggle, with the native click suppressed.
7. Close-panel leave.
8. Drag 300 px left and release at lift 250.
9. Drag up and release at lift 600.
10. Catch mid-air.
11. Strips for the drops.
12. Roll out (measured, then captured).
13. Push past the right edge = leave.
14. Peek-return strip.
15. Away probe: the sliver is the hitbox.
16. Question arrival while away, in its own window:
    - the collapsed poll is run at once through `companion.poll()`;
    - he arrives at the perch, plays `question` and shows the glyph;
    - after `PERCH_WAIT_MS` he tucks back with the glyph held;
    - the tray state is checked over the real `kt:state` IPC;
    - a second question arrives, then the pointer brings him in.
17. Reduced motion: every transition jumps to its end state, with no rAF.
18. Reload keeps the saved spot. This runs without shots mode, so localStorage is real.

### Measurements in `checks.json`
- **Frame stats:** drag, fall (250), fallHigh (600), roll, peek and arrive. Each is a page-side rAF loop that uses the *unwrapped* rAF.
- **rAF counter:** installed before the page's scripts with `Page.addScriptToEvaluateOnNewDocument`. It must read 0 over a 3 s window in `in`, `away` and `perched`.
- **Idle CPU:** `app.getAppMetrics()` over 3 s in each of those states, after a 1 s quiet period.
- **Flood:** a 60 Hz `sendInputEvent` mousemove flood for 3 s far from him, with renderer and total CPU recorded.
- **Hitbox geometry:** in 32 sampled states, the avatar rect centre equals `bodyX`, the bottom gap equals `lift` + a constant, and the rect is 64x64.
- **Hit-test probes:** mousemoves through the renderer's cached-rect hit test, then the last `kt:ignore-mouse` value.
- **Click-through after each scenario:** the window must ignore the mouse once the pointer is parked away.
- **Console:** console and page errors.
- **Work area:** a work-area change log.

## Changes made in this session (shots.ts only)
1. **Leave timing measured from the timer arm.** The pre-load script also logs every `setTimeout` of 1 s or more with its arm time in page time (`__longTimers`). "Leave after the pointer goes away" is now timed from the last (re)arm of the 20 s idle timer. The arms relative to "pointer away" are recorded too. The first full run had measured 22.7 s from the harness's own clock and failed. With the log, the arm comes −84 ms before the pointer-away mark and the leave follows 20 008 ms later.
2. **Idle CPU after a quiet second.** The first run measured `in` right after the `hello` of the peek-return and got 0.77 %. With a 1 s quiet period first, it measured 0.16 % twice. The window also records the `kt:ignore-mouse` messages and the long timers armed during it (0 and none).
3. **Hitbox stationarity checked against the window corner.** macOS changed the primary work area between and during runs (870 vs 868 px high). The window follows it, as R31 intends (`display-metrics-changed`), so a fixed window-coordinate comparison failed: column-420 and the real walk moved 2 px. The check now compares the hitbox's right and bottom insets. The raw window-coordinate result (`allStatesEqualInWindowCoords`) and the content sizes seen are still recorded. `checks.workAreaLog` logs the work area at start, at every window creation and on every `display-metrics-changed`.
4. **Committed bytes restored for unchanged PNGs.** The six PNGs that were pixel-identical to HEAD (320 px: 20, 23, 26, 28, 32, 38) were restored to their committed bytes, so git shows only real changes.

## Results (final runs: mock `09:04–09:08Z`, real `09:08–09:10Z`, Electron 45.2.3, macOS arm64, 2x display)

Mock: `[shots] wrote 60 screenshots …; console errors: 0; budget failures: 0`. Real: `wrote 18 screenshots …; console errors: 0; budget failures: 0`. Both exit 0.

| Check | SPEC budget | Measured | Result |
| --- | --- | --- | --- |
| Frames, drag | p95 ≤ 16.7, max ≤ 20 ms | 10.2 / 10.3 (36 frames) | pass |
| Frames, fall (lift 250) | same | 10.3 / 10.4 (113) | pass |
| Frames, fall (lift 600) | same | 10.0 / 10.4 (235) | pass |
| Frames, roll out | same | 9.7 / 10.2 (127) | pass |
| Frames, peek + return | same | 9.8 / 10.4 (266) | pass |
| Frames, question arrival | same | 10.2 / 10.4 (299) | pass |
| Frames, panel open / close (area 420) | same | 9.3 / 16.7, 9.2 / 9.4 | pass |
| Frames, panel open / close (column 320) | same | 9.3 / 9.4, 9.9 / 10.2 | pass |
| Frames, panel open / close (column 420) | same | 10.0 / 10.3, 10.2 / 10.4 | pass |
| Idle CPU `in` (3 s, all processes) | ≤ 0.3 % | 0.16 % (renderer 0.06) | pass |
| Idle CPU `away` | ≤ 0.3 % | 0.02 % | pass |
| Idle CPU `perched` | ≤ 0.3 % | 0.01 % | pass |
| Idle CPU, collapsed walk (away=0) | ≤ 0.3 % | 0.16 % | pass |
| rAF calls `in` / `away` / `perched` (3 s) | 0 | 0 / 0 / 0 | pass |
| rAF calls, whole reduced-motion scenario (1.27 s) | 0 | 0 | pass |
| 60 Hz mousemove flood, 3 s, far from him | report | 167 events; renderer 0.48 %, total 1.04 %; 0 rAF; window kept ignoring | reported |
| Press pose on the next paint | ≤ 1 frame | `pose:press` frame 1, state `pressed`, next rAF after 0.3 ms | pass |
| Hitbox = carrier avatar rect | every state | 32/32 sampled (in, away sliver, perched, carried at lift 125/300, landed, panel open) | pass |
| Hitbox stationary across the panel states | all equal | area-420, column-320, column-420, real: all equal | pass |
| Hit-test probes via `kt:ignore-mouse` | all | 11/11 | pass |
| Window ignores the mouse after every scenario | all | mock 20/20, real 2/2 | pass |
| Console + page errors | 0 | mock 0, real 0 | pass |
| Window bounds = primary work area | equal | `{0,33,1512,868}` = workArea | pass |

Scenarios (all pass):
- **Launch:** in after 1999 ms; leaving 4027 ms later (SPEC 4000); away on the right at `bodyX` 1528 = W + 28 − 12 (the companion's body-sliver deviation).
- **Peek:** `peeking:hold → returning:hop → in:hello → in:idle3` in 2.2 s.
- **Leave after the pointer goes away:** 20 008 ms from the timer arm (19 924 ms by the harness clock); SPEC 20 000 ± 1200.
- **sendInputEvent smoke:**
  - over him the window stops ignoring the mouse (`false`);
  - mouseDown gives `pose:press`; the release opens the panel, and a second click closes it;
  - after moving away the window ignores the mouse again (`true`).
- **Click:** opens the panel and continues `click` from frame 2; the following native click is suppressed, so the panel stays open.
- **Close-panel leave:** 20 189 ms after the close.
- **Drag 300 px left, release at lift 250:**
  - while carried: `pose:carried` on the drop surface, and the shadow strip stays on the floor (same floor gap as at rest);
  - impact 1035 px/s gives the **hop** tier (frames 11–17), as expected;
  - he lands at `bodyX` 1133, and the home spot is saved as `homeFromRight` 379.
- **Release at lift 600:** impact 1604 px/s gives the **entrance** tier (frames 5–23); the fall plus the plop takes 1967 ms.
- **Catch mid-air:** caught at lift 513 (state `carried`), carried down to 20 px and released; lands in the settle tier, as expected.
- **Roll out:** 1133 → 1528 in 1057 ms; 16 roll-pose changes, then the 2-frame settle, then `away:hold`.
- **Push past the right edge:** the pointer stops at x 1510, he leaves to the right, and the home spot is unchanged (379).
- **Question arrival while away:**
  - `q:mock:timing` arrives at the perch (1468 = W − 44); his only timer is `perch`; the glyph cue is held;
  - he tucks back 89.4 s after the harness saw him perched (SPEC 90 s, within tolerance), still held with the question;
  - the last tray state over IPC is `{away: true, question: true}`;
  - engagement counters: arrivals 1, arrivals ignored 1.
- **Second arrival:** `q:mock:revision` follows `away → arriving:hop → perched:question → perched:hold`; the pointer at the perch makes him return.
- **Reduced motion:**
  - `away` is reached at once; a pointer in the zone moves him straight to the perch (`peeking`, x 1468), and after the dwell he is in;
  - a drag from lift 250 lands at once;
  - an arrival reaches `perched` at once;
  - 0 rAF over the whole scenario.
- **Reload keeps the spot:** dropped at 1233, saved `{version:1, homeFromRight:279, awaySide:null, fidgets:false}`, at 1233 again after the reload.
- **Column mode:** the 320 and 420 walks have stationary hitboxes, bounds equal `windowBounds('column')`, and the companion is null (R28 panel).
- **Real service (Elisa seed):**
  - the full walk ran: identity, two investigations, the question routed to Erkki Expert, No, Undo, Yes; the status is `answered` and the requester sees the same investigation;
  - he arrived at the perch with the routed question: `q_63dd53ed2287f01c41ba`, as expected (`real/arrival-perched-real-420.png`);
  - hitbox stationary across all 18 states.

Strips (composed by `scripts/screenshot.mjs`):
- `companion/drag-release-strip.png`
- `companion/drop-high-strip.png` (extra: the entrance-tier drop)
- `companion/roll-out-strip.png`
- `companion/peek-return-strip.png`
- `companion/question-arrival-strip.png` (arrival, perch with the glyph, tuck)
- `entrance/entrance-strip.png`
- `entrance/landing-strip.png`

Companion stills are in `companion/`: `away-sliver`, `press`, `click-open`, `perched-glyph`, `sliver-after-question`, `reduced-away`, `reduced-perched`. The raw frames are in `companion/frames/`, 187 PNGs (0.9 MB).

## Baselines: what changed against the committed PNGs and why (`compare.json`, `real/compare-real.json`)

- **320 px (20–38, column window):** 6 pixel-identical and 12 with tiny differences (≤ 0.003 % of pixels: the text caret and the idle pose phase). 34-receipt-points-burst differs by 0.5 %, because the capture lands at a different moment of the burst.
- **`column/` (the old 420 walk in column mode, compared with the committed top-level 420 PNGs):** 4 identical and 13 with ≤ 0.004 % changed. `01-collapsed` differs by 0.08 %, from the idle pose phase, and `15-receipt-points-burst` by 0.39 %, from the burst moment. So the R28 fallback is unchanged.
- **420 px in the work-area window (01–19, 39–41; real 01–18): all changed, on purpose.**
  1. **The floor (SPEC Geometry).**
     - On screen the card and Snowbally sit at the same x (within 1 px) and **26 px lower**: the card bottom was 57.5 px above the work-area bottom and is now 31.5 px.
     - Inside the crop this shows as 12 px left and 14 px lower. The reason is that the crop is now flush with the work-area corner, while the old column window stood 12 px in from the right and bottom.
     - The crop is not shifted to the old screen region, because that would cut his floor shadow, which ends about 4 px above the Dock line.
  2. **The question glyph on the idle body (R34).** With the companion on, `hasQuestion()` means "an unseen question is waiting". The mock has unseen questions, so the glyph shows wherever the panel is not on the question view. The entrance and landing strips also show it from the touchdown on.
  3. **Settings (14, 39; real 02, 10):** two desktop rows were added, "Fidgets" and "Position: Put Snowbally back in the corner", so the card is taller.

## Not verified
- Real hardware input: a real mouse or trackpad on the area window. The scenarios use in-page events, and the one smoke test uses `sendInputEvent`, which is injected into the page. Because the window is isolated from the real mouse by default, real forwarding (`forward: true`) was not part of these runs. `KT_SHOTS_FORWARD=1` exists for that but was not run.
- The tray, the global shortcut, power events and the context menu from main. `createShell` is not created in the harness, so the companion is driven through `panel.companion.command`. The tray state is checked only as the `kt:state` IPC the renderer sends.
- The `kt:state` event at the arrival itself. The question flag was already `true` from launch, because the mock has unseen questions from the start, so the arrival emitted no new state. Only the last state `{away:true, question:true}` is checked.
- The 90 s collapsed poll timer itself. The arrival is triggered with `companion.poll()` instead of waiting 90 s; the 90 s `perch` wait is waited out for real.
- Glyph visibility on the right-edge sliver. Its pixels are outside the window, so only `held` and `unseen` are checked (companion deviation 2 / OPEN_QUESTIONS UX3).
- Multiple displays, and a real display change. Work-area changes happened on their own during some runs and are only logged.
- `pnpm desktop` by hand: SPEC acceptance item 3 is a manual check.

## Deviations, with reasons
1. **The leave timing uses the timer arm in page time**, not the harness's wall clock (see change 1). The SPEC asks for "leave after the pointer goes away", and that is measured exactly. The offset from "pointer away" to the arm is also recorded: −84 ms.
2. **Idle CPU is measured 1 s after the state is reached** (`GESTURE.idleQuietMs`). The SPEC says "3 s windows"; the quiet second keeps the end of the previous act out of the window. The first run without it measured 0.77 % in `in`.
3. **Hitbox stationarity uses the window's bottom-right insets** (see change 3), because the window follows a changing work area. The window-coordinate result is kept in the JSON.
4. **Column mode is opened with `mode: 'column'` and `COLUMN_FLAGS`**, which is what `flagsFromEnv({ KT_WINDOW_MODE: 'column' })` yields, rather than by setting the env var for a separate process.
5. **One extra strip (`drop-high-strip.png`)** for the lift-600 entrance-tier drop. **Strip scale:** drop columns and the entrance column are 120 CSS px (240 px at 2x); the entrance and the high drop are at half scale so the full height stays readable.
6. **The 60 Hz flood is reported, not budgeted** (the SPEC gives no number). It passes as long as no rAF runs.
