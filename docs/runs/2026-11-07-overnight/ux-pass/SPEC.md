# UX pass build spec — Snowbally lives at the edge, comes when needed, can be picked up

Source: three proposals and two judge syntheses (`design-round.json`), Artem's brief and addendum (`BRIEF.md`), and the spikes below. Decisions here are the build contract; each becomes a DECISIONS.md entry (R31–R36) with its reversing flag.

## Spike results (verified on this Mac, Electron 45, macOS, 2x display)

- `BrowserWindow.setHiddenInMissionControl` exists and works; `setFocusable` exists.
- `globalShortcut.register` succeeds for `CommandOrControl+Alt+S` (chosen default), `Control+Command+S`, `Alt+Shift+S`.
- With the carrier translated fully out of the viewport, the avatar's IntersectionObserver reports not visible and the idle timer stops (0 timers). Do **not** rely on it for partial slivers: use the explicit `hold()` API below.
- Full-work-area transparent click-through window: idle CPU 0.27 % total (narrow window 0.19 %), capture works, hit-testing works.
- `webContents.sendInputEvent` mouseDown/mouseMove reach the page as pointer events and `setPointerCapture` works; the harness drives gestures with in-page `PointerEvent` dispatch (deterministic) and keeps one `sendInputEvent` smoke test for click-through.
- Act tops (scene rows): backflip 24, half 36, hop 36 (above crop row 42 → cropped on the display canvas); click 48, hello 51, stretching 48, peek 51, idle3 51 (fine). Tall acts must play on `.rf-drop`.
- `turn` 1→7 rotates the face counter-clockwise (= rolling **left**). Rolling right uses 0,7,6,5,4,3,2,1. One turn step per 22 px of travel (no-slip, π·28/8 ≈ 11 source px ≈ 22 CSS px at 2x).

## Geometry and terms

- **Window**: one BrowserWindow = primary display `workArea` exactly (no margin), transparent, frameless, always on top ('floating'), visible on all workspaces, hidden in Mission Control, `showInactive()`. Re-applied on `screen` `display-metrics-changed` / `display-added` / `display-removed`. `KT_WINDOW_MODE=column` keeps today's 420 px work-area-height window (R28) as the documented fallback (everything below degrades to "no drag, no away", flags off).
- **Floor**: his contact row sits 12 CSS px above the window bottom (so the shadow ends ~4 px above the Dock line). This lowers him 26 px compared with today; harness baselines are regenerated, not loosened.
- **Carrier**: `.rf-window` (the v008 card, which already contains `.rf-avatar`) is positioned `left:0; bottom:0; transform:none` by a desktop CSS rule and moved only by JS `transform: translate3d(Xpx, -Ypx, 0)` with X, Y rounded to whole device pixels. The card and Snowbally always move together. panel-motion never writes `.rf-window`'s transform (verified), so there is no conflict.
- **bodyX**: his body centre in window CSS px. Card left = bodyX − 333 (avatar `right:15px`, canvas `left:-12px`, body centre at canvas x 44). Card bottom = 30 + lift.
- **Home spot**: `bodyX` where he stands when "in". Default: work-area width − 79 (today's position). Stored.
- **Away**: he is tucked at a side edge: only a 12 px sliver of his body is inside the window (`bodyX = W + 44 − 12` on the right, `−44 + 12` on the left). Static, zero timers, zero rAF.
- **Perch**: the position where the full 88 px canvas is just inside the window at his edge (`bodyX = W − 44` right / `44` left). Used for peeking with the authored question glyph at its authored place (the glyph is never relocated).
- **Proximity zone**: pointer within 160 px of the sliver (window coords, floor level ± 160 px).
- **Make-room**: the card fits only when 345 ≤ bodyX ≤ W − 59. Opening the panel from a spot outside that range slides the carrier to the clamped bodyX with the panel's own critically damped spring (ω 40) while he plays `hop` (on the drop surface); after the panel closes and settles he rolls back to his spot. The card is **never mirrored**.
- **Persistence**: localStorage key `kt-companion.v1` = `{ version: 1, homeFromRight: number, awaySide: 'left'|'right'|null }` through the panel's `storage` option (null in shots mode → defaults).

## States (one machine, `src/libs/utils/ui/companion.ts`)

`launching → in (grounded) → pressed → (click | carried) → airborne → landing → in`
`in → leaving → away → peeking → (returning → in | away)`
`away → arriving(question) → perched → (returning → in | leaving → away)`

Timings (constants, all in one `COMPANION` object with DECISIONS entries):
- `LEAVE_AFTER_LAUNCH_MS = 4000` (after the fall + hello), `LEAVE_AFTER_CLOSE_MS = 1500`, `LEAVE_AFTER_POINTER_MS = 1500`, `PEEK_DWELL_MS = 400`, `PERCH_WAIT_MS = 90000`, `PROXIMITY_PX = 160`, `DRAG_THRESHOLD_PX = 4`, `TAP_ALLOWANCE = { ms: 180, px: 8 }`, `ROLL_SPEED_PX_S = 900`, `ROLL_ACCEL_PX_S2 = 1600`, `TURN_STEP_PX = 22`, `COLLAPSED_POLL_MS = 90000`.
- Gravity is **derived from R28**: the launch stays exactly `ENTRANCE_FALL_MS = 900` for its distance `D0` (the measured launch fall), so for any drop height h: `T = 900 · sqrt(h / D0)`, i.e. `G = 2·D0 / 0.9²` px/s². One constant, computed from the window at load.

### Launch
Unchanged R28 fall and landing at the home spot (he lands where he will stand; the fall starts above the window at that x). After the hello and `LEAVE_AFTER_LAUNCH_MS` he leaves (see Leaving) to the nearer side edge, unless the pointer is in his zone or the panel is open. Reduced motion: still at home, then away without animation.

### Press, click
- `pointerdown` on `.rf-avatar`: draw `click` frame 1 synchronously (press pose: the authored 2 px dip), pin click-through off, `setPointerCapture`. The frozen 2 px CSS press dip of panel-motion stays.
- Release within `DRAG_THRESHOLD_PX` (any hold time) = click: toggle the panel (v009) and continue the tap with `run(click, from 2)`. No hold-to-lift, no double-click gesture.
- A capture-phase `click` listener suppresses the native click that follows a drag (`suppressNextClick`), including after `pointercancel` / `lostpointercapture`.

### Drag (carried)
- Beyond the threshold he lifts: carried pose = `orb({ shape:'stretch', expression:'surprised' → 'happy' after 400 ms, gaze: sign of horizontal velocity, feet:[{side:-1,lift:-1},{side:1,lift:-1}] })` (feet nubs one row below the body = dangling). Drawn on the drop surface (tall enough), one draw per pose change only; the carrier transform follows the pointer 1:1 each `pointermove` (no rAF needed; Chromium coalesces to one per frame).
- The floor shadow stays on the floor: a separate `.rf-shadow` canvas (44x8 scene rows 80–88 only, same integer scale) parked at his x on the floor; its width tier shrinks with lift (26 → 20 → 14 px) using `kit.shadow` widths only.
- He can be caught mid-air (the hitbox is the carrier; pointerdown during airborne cancels the fall).
- Horizontal position persists on release as the new home spot (clamped to [14, W−14]). Dragging past a side edge by more than half his body and releasing = deliberate leave to that edge (no velocity fling).

### Release and landing
- Release at lift h: ballistic fall with the derived G, `vx` = 0 at touchdown ("sticky snow": no slide). Landing tiers by impact speed: v < 450 px/s (a drop under ~48 px) → composed 2-frame settle (`crouch`, `low`, 62 ms each); v < 1100 px/s (under ~290 px) → `hop` frames 11–17; otherwise `entrance` frames 5–23 (the full plop with stars). All on `.rf-drop`. Then back to the base mode.

### Base mode and routing
- Every one-shot returns to the **base mode**: `processing` loop while the panel is busy, otherwise `idle3` when in, `hold(still)` when away/perched.
- `avatar.play()` routes any act whose top is above scene row 42 (`hop`, `backflip`, `half`, `hero`) to `.rf-drop`; everything else stays on the display canvas as today.
- `play('click')` while the processing loop runs must not kill the loop: the loop is the base mode and resumes.

### Leaving and returning (roll)
- Roll = `tuck` body with the turn sequence, one step per 22 px of travel, speed-limited (`ROLL_SPEED_PX_S`, accel `ROLL_ACCEL_PX_S2`), rightward = 0,7,6,…,1, leftward = 0,1,…,7; on the display canvas (tuck top is below row 42). He rolls to the perch, then tucks to the sliver with a 2-frame settle. Away = `hold()` still with zero timers.
- Returning: slide/roll from the sliver to the home spot, finishing with `hello`.
- Reduced motion: leave/return/peek jump to the end state.

### Away is home, proximity
- After leaving he stays away. Pointer enters the proximity zone → **peek**: he moves out to the perch (the whole face visible) with `gaze` toward the pointer; after `PEEK_DWELL_MS` dwell, or when the pointer comes within 60 px, he **returns** fully to the home spot and plays `hello`.
- He leaves again `LEAVE_AFTER_POINTER_MS` after the pointer leaves the zone, provided the panel is closed and no drag is in progress. Closing the panel sends him away after `LEAVE_AFTER_CLOSE_MS` unless the pointer is near.
- Arrival never steals focus: no `focus()`, `showInactive()` only; he never opens the panel by himself.

### Questions while away (attention)
- `src/libs/utils/ui/attention.ts` (pure, injectable clock): store of question ids `seen / announced / reminded / snoozedUntil`; at most **one arrival per id**, one reminder per id (a single peek on `unlock-screen` / `resume` after ≥ 20 min away), `Later` snoozes for the deferral time. Local-only counters for the lab's axes: time to first open, answered / deferred / dismissed, arrivals ignored.
- Question watch: while the panel is collapsed, poll `/questions` every `COLLAPSED_POLL_MS` (skipped when `document.hidden`); on show / unlock / return refresh immediately. Document the change (today: no timer while collapsed) and keep idle CPU ≤ 0.3 %.
- New unseen question while away: he **arrives** to the perch, plays `question` once (glyph at its authored place, since the whole canvas is visible), then holds still with the glyph for `PERCH_WAIT_MS` or until the pointer enters the zone. If ignored, he tucks back to the sliver; the static glyph stays visible on the sliver (drawn as part of the held frame) and the tray shows `setTitle(' ?')`. Never repeats for that id.
- `hasQuestion()` for the collapsed body now means "an unseen question is waiting" (or the question view is open), so the glyph shows on the idle body when in.
- Answered → after the receipt, `returnToAway` follows the normal close rule.

### Reaction map (panel events)
Yes / No → `hello` (equal warmth); Not sure / Later → `peek`; Dismiss → composed 2-frame low settle; Undo → `peek`; result → `result`; error → `error`; input → `input`; points reward → opt-in `hop` (on `.rf-drop`). Never: yawn (`stretching`) or sheepish (`half`) as answer reactions.

### Fidgets
Off by default (`COMPANION.fidgets = false`). When on: at most one per 4–8 min, `stretching` or `peek` only, never while away, while a glyph shows, while the pointer is near, or while the panel is open. Rejected from the brief: 45–90 s cadence, hover = peek.

### Cursor awareness when in
Within 160 px: `look(gaze)` still draw (−1 / 0 / 1 and `view:'quarter'` for the right side only, since the kit's quarter view faces right) with hysteresis so it redraws at most ~4 times per second; one draw per change, no rAF. Off under reduced motion.

### Return paths
Click on the sliver (returns), drag him out of the sliver, tray "Bring Snowbally back" / "Send Snowbally away", global shortcut `CommandOrControl+Alt+S` (toggle; registration failure is logged and the accelerator omitted), second-instance → return, right-click on him → `Menu.popup` with the same items. "Hide completely" (today's `win.hide`) stays in the tray as the do-not-disturb option, labelled as stopping questions.

## Click-through safety
- Renderer hit test = O(1) against two cached rects (carrier avatar rect, open surface rect), recomputed when the carrier moves or the panel spring settles; replaces `elementFromPoint`.
- Pin `setIgnoreMouseEvents(false)` only between pointerdown and pointerup / pointercancel / lostpointercapture; re-check on drag end and on `kt:show`.
- Main forces `setIgnoreMouseEvents(true, {forward:true})` on `render-process-gone`, `unresponsive`, `blur`, `lock-screen`.
- Harness asserts the window ignores the mouse after every scenario.

## Module ownership (exclusive paths per worker)

- **motion** (`src/libs/utils/motion/`): `physics.ts` (new: derived G, ballistic step, landing tier, roll kinematics, turn sequence by direction; pure, tested), `poses.ts` (new: carried, press, look, settle, roll frame, shadow tiers; only `kit.orb/shadow/pixel`), `avatar.ts` additions: `pose(spec)`, `look(gaze, view?)`, `hold(spec|null)` (a still that visibility/intersection handlers respect; zero timers), `run(act, from, to?)`, `fallFrom(liftPx, onLand)` (generalising R28), tall-act routing to `.rf-drop`, base-mode return, `status()` gains `held, carried, airborne, lift, base`. Entrance behaviour and all existing tests stay green; parity untouched.
- **desktop** (`src/apps/desktop/`): `flags.ts` (new: COMPANION on/off, DRAG, AWAY, GAZE, FIDGETS, SHORTCUT; passed as query params like `mock`), `window.ts` (work-area bounds, Mission Control, display listeners, `KT_WINDOW_MODE=column`), `main.ts` (tray items, `setTitle`, shortcut, powerMonitor `resume`/`unlock-screen`/`lock-screen`, commands, click-through resets), `preload.ts` (adds `onCommand(cb)`, `reportState({away, question})`, `showContextMenu()`, `onPower(cb)`; nothing else), `renderer.ts` (cached-rect hit test, pin during drag, wiring). README updated.
- **companion** (`src/libs/utils/ui/companion.ts`, `attention.ts`, `question-watch.ts` new; `panel.ts` hooks: `.rf-shadow` canvas in the template, avatar action via the gesture recogniser, `respond()` reaction map, `hasQuestion` semantics, `openPanel` make-room, `closePanel` leave timer, Settings rows "Fidgets" and "Put Snowbally back in the corner" marked desktop; `styles.css` desktop (R31) rules for the carrier, `.rf-shadow`, `.rf-drop` stays, grab cursors). Frozen v008 values untouched.
- **harness** (`src/apps/desktop/shots.ts` + `scripts/`): scenarios drag / fall / roll-out / peek / return / question-arrival-while-away / reduced; frame stats (p95 ≤ 16.7 ms, max ≤ 20 ms); rAF counter 0 in idle, away, perched; idle CPU ≤ 0.3 % in each; hitbox equals the carrier avatar rect in every state; saved spot after reload; ignore-state check after each scenario; zero console errors; full-height entrance capture kept; regular shots cropped to the panel area around the carrier.

## Acceptance (what "done" means)
1. `pnpm typecheck`, `pnpm test` green; new unit tests for physics, poses (kit-only), gesture recogniser, attention rules, state machine (fake clock).
2. Harness JSON shows every budget above met, and strips for: drag + release plop, roll out, peek, return, question arrival at the perch.
3. A fresh `pnpm desktop`: fall → hello → he rolls off to the right edge; cursor near the corner → he peeks and comes in; click → Springy tap + panel; drag him to the left, release high → plop; close panel → he leaves; `pnpm demo:reset` seeds a question → he comes to the perch with the glyph.
4. DECISIONS R31–R36 written (window+floor+carrier; press/click/drag/gravity; away/peek/return; attention and poll; reaction map and fidgets; return paths and shortcut), each naming its flag. OPEN_QUESTIONS entries for the shortcut choice, the 26 px lowering, the tray '?', throwing.
