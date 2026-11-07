# Worker report: UI/desktop

## Built

- `src/libs/utils/motion/`: TypeScript port of minimal-kit, core/state/prop acts (285 frames, 16 acts) verified draw-call-identical to the frozen v008/v006 JavaScript; `AvatarController` (integer-scale crisp canvas, 500 ms setTimeout idle with no rAF, reactions, visibility/IntersectionObserver pause, reduced-motion still, question glyph overlay, entrance-then-rest, looping processing); pixel burst.
- `src/libs/utils/ui/`: panel-motion (1:1 springs), styles.css (v008 under `#kt-panel`), panel.ts (input/question/queue/settings/receipt + result/people/case/contact), api-client.ts, mock-api.ts, icons.ts.
- `src/apps/desktop/`: Electron main/preload/renderer, click-through hit testing, tray, service child process, CORS shim, screenshot harness.
- `scripts/build.mjs`, `dev.mjs`, `screenshot.mjs`; `pnpm desktop` works.

## Tests

- `node --test 'src/libs/utils/motion/**/*.test.ts' 'src/libs/utils/ui/**/*.test.ts'`: 36 pass, 0 fail.
- `pnpm typecheck`: passes for the whole repo at the time of the run.
- Electron walk-through (`node scripts/screenshot.mjs`): 41 PNGs (420 px, 320 px, reduced motion) and `checks.json`: 0 console errors, avatar hitbox constant, idle CPU 0.15 %, max frame 10.4 ms during open/close. I inspected the PNGs and fixed: settings value alignment, contact draft typography, over-tall question/result views at both widths (scrolling inside cards), missing reward burst timing.
- Real-client path: scratch HTTP server serving the mock handlers, spawned by main as the service child; CORS preflight shim worked; badge showed 2 questions; child killed on SIGTERM.

## Limitations

- `panel.ts` has no DOM unit test (no jsdom); it is covered by the Electron walk-through.
- Not verified: Windows/Linux, tray rendering in the real menu bar, real-mouse click-through, DPR change at runtime, the real service (not built yet), non-Retina display (scale logic is unit-tested only).
- Result/question timelines scroll inside their card when long; a 320 px window shows a shorter timeline area.
- The mock is labelled `ui-dev-mock` and never claims a measured route; its incident is invented.

## Blockers

None.

## Requests

See `docs/runs/2026-11-07-overnight/contract-requests/ui.md` (informational only).

## Fix pass

Fixed (all in ui/ and desktop/shots.ts):
- Result view "A question about this" is now a read-only "Asked a colleague ... <status>" row; the requester can no longer answer the investigation's question. Mock answer/defer/dismiss/undo now reject principals that are not the recipient (403), like the engine.
- No identity: when settings.currentPersonEntityId is unset the panel does not fetch the queue (shows "Choose who you are to see your questions.") and never sends an invented principal (principal() throws a plain error instead).
- api-client: timeout now covers the body read (stalled body -> 'timeout'); already-aborted caller signal is honoured.
- Reopening the panel re-renders queue/question views (no stale "All quiet.").
- PersonView.askable=false rows show "Not available to ask right now" instead of Prepare message.
- showError uses the draft sentence only for submit(); other failures say "Nothing was changed...".
- 320px: bottom fade mask + padding on .rf-case-path / .rf-history so scrollable content is visibly cut; asked row aligned.
- screenshot harness opens the question card via the queue (shots.ts).

Checks: node --test ui tests: 24 pass, 0 fail (new: stalled body timeout, pre-aborted signal, mock non-recipient rejection). Screenshots re-run: 41 PNGs, console errors []. pnpm typecheck: ui/desktop clean; whole repo currently fails only on src/libs/utils/memory/index.ts(122) 'refreshClaimSupport' (another worker's file).
