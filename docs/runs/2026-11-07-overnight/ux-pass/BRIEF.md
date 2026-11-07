# UX pass brief — a companion people want to answer (7 Nov 2026, morning)

Artem's request, verbatim in spirit: *make the whole thing feel more responsive and improve the overall user experience: be able to move Snowbally, make him smoothly go outside the screen and somehow be able to return him; remember the main goal of making him so responsive and expressive that people just like communicating with him, answering and engaging with him. There is a lot of room for improvement in user experience.*

## What exists (do not re-invent)

- **Art and behaviour are frozen lab outputs.** Body: ChatGPT pixel-motion v006 compact kit (`src/libs/utils/motion/minimal-kit.ts`, `core-acts.ts`, `state-acts.ts`, `prop-acts.ts`), ported byte-identically (parity test). Acts available: `idle3` (three-pose standing loop), `click` (Springy tap, 0.67 s), `hello` (tiny wave), `backflip`, `half` (almost a flip, sheepish), `hop` (small happy hop), `stretching`, `peek` (attentive glance), `entrance` (drop & settle); states `input` (receiving), `processing` (loop), `question` (question available, glyph), `result`, `error`; props `moonwalk`, `hero`. The kit's `orb()` takes `shape` (neutral/low/high/crouch/deep/stretch/tuck), `expression` (normal/happy/blink/yawn/effort/surprised/sheepish), `gaze` (−1/0/1), `view` (front/quarter), `turn`, `hands`, `feet`, `x`, `bottom`. New *poses* may be composed from these parameters; new *anatomy* may not.
- **Panel is the ChatGPT UI v008/v009 design** (`src/libs/utils/ui/panel.ts`, `styles.css`, `panel-motion.ts`): 380 px card anchored above-left of the avatar, avatar at the card's bottom-right (`right:14px; bottom:-25px`), 64 px fixed hitbox, critically damped springs for open/close/context. Views: input, result, people, case, contact, question, queue, settings, receipt. Avatar click toggles with the Springy tap (R29).
- **Launch (R28):** the window spans the work-area height; Snowbally falls from behind the menu bar for 0.9 s with constant acceleration (`AvatarController.playEntranceThenRest`, drop canvas `.rf-drop`), lands with the authored impact/spring/stars/hello, then idles. Reduced motion: still.
- **Desktop shell** (`src/apps/desktop/`): Electron 45, frameless transparent always-on-top window 420 px wide at the right edge, click-through everywhere except Snowbally and the open panel (`setIgnoreMouseEvents(true, {forward:true})` driven by renderer hit-tests), tray menu (Show/Hide, Reset demo, Quit), service child process.
- **Performance budget (verified, must hold):** idle CPU ≤ 0.3 % with no rAF while idle; open/close frames ≤ 20 ms (measured ~9 ms at 120 Hz); zero console errors; hitbox stationary across states (the harness checks it). Harness: `scripts/screenshot.mjs` (mock) and `scripts/real-check.mjs` (real service) via `src/apps/desktop/shots.ts`.
- **Engagement signals already modelled:** questions arrive in a queue with a per-person daily limit (3), cooldown, one open question at a time; answers Yes/No/Not sure/Later/Dismiss with Undo; optional points with a pixel burst; the question glyph on the idle body.

## Goals (in priority order)

1. **Responsiveness:** every pointer interaction with Snowbally answers within one frame with a visible pose change (press, release, hover, drag start/end), and the panel never feels detached from him.
2. **Movable:** he can be dragged along the screen and remembers where he was put. He lives on a floor (the bottom edge of the work area); gravity is real (R28's fall and landing are reused when he is released in the air).
3. **Leave and return:** a smooth way to send him off-screen (he is in the way sometimes) and at least two obvious ways to bring him back, one of them discoverable without reading anything. While away, a new question must still reach the person.
4. **Expressive, warm, never nagging:** reactions use the frozen acts; new poses only from kit parameters; idle fidgets are rare and quiet; nothing plays while reduced motion is on; no sound.
5. **Engagement:** the moments that matter for the product are question arrival, answering, and coming back later. Each should feel acknowledged.

## Addendum (Artem, later the same morning)

*It would be cool if the snowball wasn't on the screen all the time: he can be outside, and come when he needs to ask a question or when the cursor is close to that corner.*

So **away is his home state**, not an exception:

- Default after launch (after the fall and the hello): he waits a moment, then leaves the screen by the nearest edge/corner and stays out.
- He comes in when (a) a question for the current person arrives (he comes in with the glyph, waits a bounded time for attention, then leaves again if ignored, without repeating more often than the question policy allows), (b) the cursor comes close to his corner (a proximity zone at the edge; he peeks, then comes fully in if the cursor stays or moves closer; leaves again when the cursor goes away and nothing is open), (c) the tray item / shortcut / a click on his edge tab asks for him.
- While the panel is open he stays; closing the panel sends him away after a short delay unless the cursor is still near.
- The person can still drag him anywhere and he remembers that spot as the place he comes back to.
- A visible, tiny hint that he exists must remain at his edge (so a newcomer discovers him), and his arrival must never steal focus or cover what the person is doing.

## Hard constraints

- No new sprite anatomy, no limb drawings, no rotations or smoothing of the pixel art; integer device scale stays.
- Frozen v008/v009 panel values stay (type, spacing, colours, springs). Desktop-only additions must be marked as such in CSS/code comments, as before.
- Budgets above hold; measure them in the harness.
- Every setting is local (localStorage `storage` option of the panel or the user settings contract); nothing leaves the machine; no API calls to models.
- macOS primary display; multiple displays not required.
- Keep it reversible: each behaviour is a small module or a flag, documented in DECISIONS.md.

## Ideas on the table (not decisions)

- Full-work-area transparent click-through window so he can be anywhere along the floor and the panel opens next to him.
- Drag with a 4 px threshold (click vs drag), carried pose while dragging, fall + plop on release; off-edge drag = leave.
- Away mode: he rolls/hops off the nearest edge; a tiny pixel tab stays at the edge (click = return); tray and a global shortcut return him; a new question makes him peek in with the glyph.
- Cursor awareness within ~160 px: gaze and quarter view toward the pointer (one draw per change, no rAF); hover = `peek`.
- Reaction map: press = crouch pose, click = Springy tap, question arrives = `hop` + glyph, Yes/No = `hello`, Not sure = `stretching`, Later = `peek`, Dismiss = `half`, result = `result`, error = `error`, double-click = `backflip`.
- Idle fidgets every 45–90 s: one of `stretching`/`peek`/`hop`, only while the panel is closed.
