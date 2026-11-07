# Decisions · Day 2 B6 (package: the three demo-mode flags)

Branch `day2/b6-flags`, from `run/2026-11-07-overnight` at `ced868d` (B1–B5, B7, points R46 and demo mode R37–R42 merged:
604 tests, 42 routes, 12 MCP tools). After this branch: 615 tests (11 new), routes and MCP tools unchanged.
Each entry: what was decided, why, and how to reverse it.

## D-B6-01 · Demo mode is one desktop flag, `KT_DEMO`, and `pnpm demo:judge` is what turns it on

There was no demo-mode switch before: demo mode meant "launched by `demo:judge`" (which already sets `KT_NO_API=1`). The
three flags hang off one new entry in the existing desktop flag set (`src/apps/desktop/flags.ts`: `FLAG_NAMES`,
`DEFAULT_FLAGS.demo = false`, `COLUMN_FLAGS.demo = false`, env `KT_DEMO`, query `demo=1`), so it travels like every other
flag: main reads the env, the renderer gets it as a query param, the companion and the panel read `window.__ktFlags`.
`scripts/demo-judge.mjs` sets `KT_DEMO=1` in the desktop's env unless the operator set `KT_DEMO` already
(`KT_DEMO=0 pnpm demo:judge` keeps the product behaviour). It is not forced off in the column fallback (the chips work
there; the away behaviour is off in the column anyway). The service does not know about it: none of the three needs it
(the chips write Settings → You through the existing route; the label lives on a page the service already serves).
The renderer's `?mock=1` dev mode passes the flag to the mock (D-B6-02). **Reverse:** drop `'demo'` from `FLAG_NAMES`
and the `KT_DEMO` line in `demo-judge.mjs`; every flag-gated path falls back to the product default.

## D-B6-02 · "Be Veikko / Be Erkki" chips write Settings → You, through the same path as the select

In demo mode the panel prepends a chip row (`.rf-demo-chips`, "Demo · Be Veikko · Be Erkki") to the footer; without
the flag the footer markup and the `TEMPLATE` are untouched (the row is created in code, not in the template). A chip
calls `switchPerson(id)`, the function the Settings → You change handler now also uses (PUT /settings
`currentPersonEntityId`, clear the question cache and the open nodes, forget the points view, refresh /questions).
Because `principal()` is built from `settings.currentPersonEntityId`, the chip state is what `/investigate` receives as
principal and whose `/questions?personEntityId` the queue shows, with nothing else changed. I chose the persisted setting
over a panel-local principal because (a) Settings → You stays the one real mechanism (DAY2_PLAN 6.1) and the chips are a
shortcut to it, so the chip and the select can never disagree; (b) the simulated stream reads Settings → You every tick
to know whom never to auto-answer (R40), which a panel-local principal would break.
The people are resolved from the directory by `demoChips()` (`ui/demo-chips.ts`, pure): exact name with accents
ignored, else a unique first name; a persona not in the directory gets no chip, and with neither the row stays hidden
(a clean clone without Elisa's files). The active chip has `aria-pressed="true"` (dark). The row adds a second footer
line, so in demo mode the surface grid's footer row is `auto` instead of 48 px and the card re-fits when the row
appears (checked in a browser on the `?mock=1&demo=1` page: chips, tools and Remember this all visible; without
`demo` the footer is 48 px with no chip row). The dev mock grows the two people only when created with `{demo: true}`,
and a Veikko investigation that may ask opens the revision question for Erkki, so the mock shows the ask-as-one,
answer-as-the-other loop; mock answers by anyone but the dev user earn no points. **Reverse:** remove the
`demoMode` block in `panel.ts` (and the CSS block marked B6); `switchPerson` can stay.

## D-B6-03 · Lumi starts in and leaves after 120 s without pointer or keyboard activity; one constant

`COMPANION.DEMO_LEAVE_AFTER_IDLE_MS = 120000` sits with every other companion timing. `leaveDelays(flags)` (pure)
returns `{launchMs: 4000, idleMs: 20000}` normally and 120 s for both in demo mode; the ten call sites inside
`createCompanion` that read `COMPANION.LEAVE_AFTER_IDLE_MS` / `LEAVE_AFTER_LAUNCH_MS` now read those delays (the constants
and their tests are unchanged, and so is every non-demo timing: all 47 earlier companion tests pass untouched).
"Start in" is the existing launch: he lands at home in state `in`; demo mode only stretches the launch leave from 4 s to
120 s. I read "expanded" as "in, visible at home", not "panel open": an open panel blocks the idle leave by design
(R33), so opening it would keep him in forever, and it would put a card over the judge's screen before anyone asked.
Activity: in demo mode any pointer move inside the window (the window covers the work area, so this is any mouse
movement the window sees) and any key press (`keydown` in `attachCompanion`, `Companion.activity()`) record the time;
when the idle timer fires, `idleLeftMs(lastActivityAt, now, idleMs)` (pure) says how much is still left and the timer
re-arms for that instead of leaving. This avoids restarting a timer on every mousemove. A pointer leaving the window is
not activity. Outside demo mode `activity()` is a no-op and `lastActivityAt` stays `-Infinity`, so the timer leaves when
it fires, as before. After the first leave he behaves as the product does (away is home, peek, perch). **Reverse:**
`KT_DEMO=0`, or set the constant to 20000.

## D-B6-04 · The simulated day is labelled on the second screen only; the panel shows real-time state

The activity page (`/demo/activity.html`, the second screen `demo:judge` opens) gets a sticky dark banner at the top:
**Simulated day** (`SIMULATED_DAY_LABEL`, exported from `activity-page.ts`), the simulated clock read from
`GET /demo/clock` every 2 s (`simulated 09:40 · 360× speed`, or `not running · real clock 14:02` before the day
begins and after it ends), and "not real people, not real time · the companion shows real time only". It stays visible
while the rows scroll. The companion was already free of the stream (R41: the panel was never edited for it); a test now
pins that: the panel `TEMPLATE` has neither the label nor the word "simulated", and no companion source (`panel.ts`,
`api-client.ts`, the desktop renderer and its page) contains the label or reads `/demo/activity` or `/demo/clock`.
One known exception, left as is: the Settings row "Erkki's cost" (B3 `costRow`) appends " simulated" to its seconds when
the service measured them on the simulated clock; that is a unit label on a real store number, not the stream.
The stream's questions to the judge's own person still reach the companion like any question, since they are real
records in the store (R40). **Reverse:** remove the `.sim` banner; the old header and meta line remain.
