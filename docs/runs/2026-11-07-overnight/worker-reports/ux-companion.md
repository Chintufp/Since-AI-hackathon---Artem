# Worker report: ux-companion (UX pass, R31..R36)

Scope: `src/libs/utils/ui/{companion.ts, attention.ts, question-watch.ts}` (new) and their tests; `panel.ts`, `styles.css`, `index.ts` and `README.md` in the same folder; wiring in `src/apps/desktop/renderer.ts`; DECISIONS R31–R36 and OPEN_QUESTIONS UX1–UX4 appended. Nothing is committed. The motion module, the desktop shell, `shots.ts` and `scripts/` were not touched.

The spec changed while I worked (commit `ae8fbff`): `LEAVE_AFTER_IDLE_MS = 20000` replaces the 1.5 s close and pointer rules, he rolls out and hops in. The code follows the new version.

## What I built

1. **`companion.ts`**
   - **State machine.** One DOM-less machine covering every SPEC state: `launching`, `in`, `pressed`, `carried`, `airborne`, `landing`, `leaving`, `away`, `peeking`, `arriving`, `perched`, `returning`. The clock, rAF, random, storage, avatar, panel hooks and render sinks are injected.
   - **Constants.** All timings and distances are in one `COMPANION` object. All geometry is in `GEOMETRY`, with pure helpers (`carrierTransform`, `homeXFor`, `sliverX`, `perchX`, `roomX`, `pushedSide`, `inEdgeZone`, `nearBody`, `classifyGesture`, `nextGaze`, `loadPlacement`).
   - **DOM binding.** `attachCompanion()` connects the page to the machine:
     - the gesture recogniser on `.rf-avatar`, using pointer capture;
     - a capture-phase click guard on the panel root, so the native click after a release the recogniser already handled never toggles a second time;
     - mousemove tracking for proximity and gaze;
     - `contextmenu` → `kt-companion:context-menu`;
     - `kt-command`, `kt-power`, `kt-area` and `resize`.
2. **`attention.ts`** (pure, injectable clock).
   - **Per question id** it stores `waitingSince`, `seen`, `announced`, `reminded` and `snoozedUntil`.
   - **Rules:** one arrival per id; one reminder per id; `Later` snoozes for `LATER_SNOOZE_MS`.
   - **Counters:** open delays (with a median), answered, deferred, dismissed, arrivals, reminders and arrivals ignored.
   - **Storage:** `kt-engagement.v1`, through the panel `storage` option.
3. **`question-watch.ts`**
   - Polls every `COLLAPSED_POLL_MS` (90 s) while the panel is collapsed and the document is visible.
   - `wake(show | return | resume | unlock-screen, awayForMs)` refreshes at once and arms one reminder after 20 min or more away.
   - `handle(ids)` runs after every panel refresh and applies the arrival and reminder rules.
4. **`panel.ts`**
   - `.rf-shadow` canvas added to the template.
   - The avatar factory is now `(canvas, host, { drop, shadow }) => CompanionAvatar`, and there is a `companion` option (default `window.__ktFlags`).
   - **Companion on:** `panel.companion` hooks and `status().companion` / `status().unseenQuestion`. `hasQuestion()` = the question view is open, or (with the companion) an unseen question is waiting. Seen is marked when the question view renders.
   - **Opening and closing:**
     - `openPanel(user)` runs make-room first and moves focus only when the open was user-initiated.
     - A direct click while an unseen question waits opens that question.
     - `setView` from closed also runs make-room.
     - `closePanel` starts the companion's idle timer and the roll back to his spot.
   - **Reactions:** the `REACTIONS` map, plus engagement counters in `respond()`.
   - **Settings:** two desktop-only rows, "Fidgets" and "Put Snowbally back in the corner".
   - **Unchanged:** R29 (Springy tap on every direct click; keyboard clicks keep the v009 path) and quiet programmatic opens.
5. **`styles.css`** (desktop-only, marked rules):
   - the carrier anchor, scoped to `#kt-panel[data-kt-companion="on"]`, so column mode and the browser are unchanged;
   - `.rf-shadow` placement (88 x 16, floor-aligned);
   - grab / grabbing cursors.

   `--kt-vh` and the `.rf-drop` rules are unchanged, and no v008 value was edited.
6. **`renderer.ts`** now passes `shadow: surfaces.shadow` to `AvatarController` and `companion: flags` to `createPanel`.

## API (signatures)

```ts
// companion.ts
export const COMPANION: { LEAVE_AFTER_LAUNCH_MS: 4000; LEAVE_AFTER_IDLE_MS: 20000; PEEK_RETREAT_MS: 1500; PEEK_DWELL_MS: 400; PEEK_NEAR_PX: 60;
  PERCH_WAIT_MS: 90000; PROXIMITY_PX: 160; DRAG_THRESHOLD_PX: 4; TAP_ALLOWANCE: { ms: 180; px: 8 }; CARRIED_HAPPY_MS: 400;
  LEAVE_MOTION: 'roll'; RETURN_MOTION: 'hop'; HOP_MS: 1125; HOP_AIR_MS: [250, 750]; HOP_REACH_PX: 200; SLIDE_OMEGA: 40;
  GAZE_MIN_INTERVAL_MS: 250; GAZE_ON_PX: 24; GAZE_OFF_PX: 12; fidgets: false; FIDGET_MIN_MS; FIDGET_MAX_MS; STORE_KEY: 'kt-companion.v1' };
export const GEOMETRY: { CARD_OFFSET_PX: 333; CARD_BOTTOM_PX: 30; CARD_MIN_X: 345; CARD_RIGHT_INSET: 59; BODY_HALF_PX: 28; CANVAS_HALF_PX: 44;
  SLIVER_PX: 12; HOME_FROM_RIGHT: 79; HOME_CLAMP_PX: 14; BODY_CENTER_Y_PX: 40; EDGE_PIN_PX: 4; TOP_MARGIN_PX: 120 };
createCompanion(deps: CompanionDeps): Companion
attachCompanion(c: Companion, dom: { root; avatarButton; win }): () => void
interface Companion { start(); pointerDown(x,y): boolean; pointerMove(x,y); pointerUp(x,y): boolean; pointerCancel(): boolean; pointer(x|null, y?);
  contextMenu(); command('away'|'return'|'toggle-away'|'reset-position'); power('resume'|'unlock-screen'|'lock-screen'); area();
  makeRoom(): boolean; panelOpened(); panelClosed(); questionsChanged(); arrive(id, 'arrival'|'reminder'): boolean;
  setFidgets(on); fidgets(): boolean; status(): CompanionStatus; destroy() }
CompanionStatus = { state, bodyX, lift, away, side, pointerNear, homeFromRight, homeX, rafActive, timers: string[], anim, fidgets, question }
// attention.ts
createAttention({ now?, storage? }): Attention   // observe, unseen, hasUnseen, nextArrival, nextReminder, markSeen, markAnnounced, markReminded, ignored, record, snoozed, get, counters
ATTENTION = { REMIND_AFTER_AWAY_MS: 20 min, LATER_SNOOZE_MS: 30 min, MAX_IDS: 200, MAX_DELAYS: 50 }; ENGAGEMENT_KEY = 'kt-engagement.v1'
// question-watch.ts
createQuestionWatch({ attention, refresh, collapsed, hidden, arrive, clock?, pollMs? }): { sync(); wake(reason, awayForMs?); handle(ids); status(); destroy() }
COLLAPSED_POLL_MS = 90000
// panel.ts
PanelOptions.avatar: (canvas, host, { drop, shadow }) => CompanionAvatar; PanelOptions.companion?: CompanionFlags | null
Panel.companion: { command, status, pointer, power, arrive(id?), poll(), engagement(), setFidgets } | null   // harness: __kt.panel.companion.*
PanelStatus.companion: CompanionStatus | null; PanelStatus.unseenQuestion: boolean
```

## Verified

- `pnpm typecheck` passes.
- `pnpm test`: 327/327 pass.
  - `companion.test.ts`: 31 tests, using a fake clock, rAF, avatar, panel and storage.
  - `attention.test.ts`: 9 tests, covering the attention rules, counters, persistence and question-watch.
- `node scripts/build.mjs` builds.
- **Scratch Electron run** (in the scratchpad, not committed): Electron 45, macOS arm64, a work-area transparent window, the built preload and renderer, mock and shots mode, gestures driven by in-page `PointerEvent` dispatch.
  - **Launch:** the carrier is at `translate3d(1100px, -30px)`, which is bodyX = W − 79. He reaches "in" after the entrance (2.06 s). The hitbox is 64 x 64 centred on bodyX, with its bottom at H − 6.
  - **Leaving:** he leaves 3.9 s later, rolling and tucking to the sliver (bodyX = W + 16).
  - **Away:** a held still, 0 timers, 0 rAF in 1 s.
  - **Peek and return:** pointer in the zone → peek → he hops back in and plays `hello`.
  - **Click:** press pose, then the panel opens on the waiting question, playing `click` from frame 2, with no double toggle (the native click is suppressed).
  - **Drag:** the carried pose is on the drop surface, the shadow strip is at `translateY(250px)`, and the hitbox follows him.
  - **Release:** a fall, then "in" at the new spot; `homeFromRight` is persisted.
  - **Make-room:** dragged to x = 120, then a click: he slides to 345 with the panel's spring; after close he rolls back to 120.
  - **Commands:** `away` to the left edge, then `reset-position` back to the corner.
  - **Arrival:** he arrives at the perch with the glyph at its authored place; 0 rAF while perched; pointer near → he comes in.
  - **Answers:** a click opens the question view; `Later` → receipt with `peek`; the engagement counters update.
  - **Errors:** zero console errors and zero page errors.
  - **Screenshots** (in the scratchpad): sliver, carried, panel open, perched.

## Not verified

- **Real input:** a real mouse or trackpad, including real pointer capture outside the window and how the `EDGE_PIN_PX` push feels at the screen edge.
- **Shell paths not exercised:** the tray, the shortcut and real lock or resume. I drove `kt-command` / `kt-power` only through the `panel.companion` hooks, not from main.
- **The demo flow:** a full `pnpm desktop` with `pnpm demo:reset` against the real service. The arrival then depends on the 90 s poll, or on an immediate refresh when he comes back.
- **Budgets:** idle CPU and frame-time budgets with the companion (the harness worker's job).
- **The screenshot harness:** I did not run `scripts/screenshot.mjs`. Its existing flows will behave differently now:
  - he leaves 4 s after launch;
  - `panel.open()` no longer moves focus;
  - the avatar sits 26 px lower.

  The harness worker regenerates those baselines. The flag `away=0` keeps him in for still shots.

## Deviations, with reasons

1. **Sliver measured on the body, not the canvas.** The SPEC formula `bodyX = W + 44 − 12` puts the 88 px canvas 12 px inside, but the body (28 art px = 56 CSS px wide) starts 16 px into the canvas, so nothing of him would show. I keep 12 px of the body visible (`W + 28 − 12` / `−28 + 12`), as the SPEC's words say. This also leaves 16 px of hitbox inside, which "click on the sliver" needs.
2. **Glyph on the right-edge sliver is not visible.** The authored glyph sits right of the body (canvas x 76–86) and is never relocated. On the right edge it is therefore outside the window, and the tray ` ?` carries the signal there; on the left edge it is visible. The perch shows it (verified). Listed as OPEN_QUESTIONS UX3.
3. **Push past an edge.** The SPEC rule is "more than half his body past the edge". Because the pointer stops at the screen edge, that is only reachable when he was grabbed left of his centre. So I also count the pointer pinned to the outermost `EDGE_PIN_PX` = 4 px as a deliberate push.
4. **Constants not in the SPEC:**
   - `PEEK_RETREAT_MS` = 1500: an abandoned peek retreats after this; the 20 s idle rule is meant for "in";
   - `HOP_REACH_PX` = 200: a longer way in rolls first, then hops the last 200 px; one hop across the whole screen would look wrong;
   - `CARRIED_HAPPY_MS` = 400 (from the SPEC text);
   - `GAZE_*`, `TOP_MARGIN_PX`;
   - `LATER_SNOOZE_MS` = 30 min: the API has no deferral time, so I used the service's default cooldown.

   All are listed in R33–R35.
5. **Peek re-arm.** After he leaves, the pointer must leave his zone once before it can make him peek. Otherwise "Send away" with the cursor in the corner would bring him straight back.
6. **Click at the perch or while peeking opens the panel.** A click there is user-initiated, and make-room brings him in with the hop. A click on the bare sliver only returns him. A direct click while an unseen question waits opens that question rather than restoring the last view, since the glyph promised it.
7. **Make-room hop wins over the tap.** When make-room slides him, the tap continuation (`run('click', 2)`) is skipped so the `hop` plays; the SPEC asks for both.
8. **The reaction map applies in every mode.** The `REACTIONS` constant also covers column mode (it is panel behaviour, not window behaviour). Everything else of the companion, including the collapsed poll and the new glyph meaning, runs only when the companion is on, so the column fallback stays R28.
9. **Fidgets setting persisted.** It is an optional field `fidgets` in `kt-companion.v1`; the SPEC schema lists only `homeFromRight` and `awaySide`.
10. **Panel settle detection.** `kt-companion:moved` on "panel spring settled" is detected by polling `panel-motion`'s `status().active` once per frame, only while it animates. `panel-motion.ts` has no settle callback and is not mine to change.
11. **Programmatic API never moves focus.** `panel.open()` and `toggle()` (programmatic) no longer move focus, per the SPEC; before, they focused the view.

