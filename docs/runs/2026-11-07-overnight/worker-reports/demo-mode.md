# Worker report — demo mode (judge walkthrough, simulated stream, demo:judge)

Session: `claude/demo-mode-4c65f3` (worktree), 7 November 2026, afternoon. Scope: `docs/DEMO.md`, `scripts/demo-play.ts`, `scripts/demo-judge.mjs`, `scripts/mcp-demo.ts`, `scripts/slack-demo.ts`, `src/libs/utils/simulation/`, service additions (`demo-clock.ts`, `activity.ts`, `activity-page.ts`, routes), `data/demo/judge-prompts.json`, tests, README quick start. The panel, motion and desktop files were not edited (contract request in `contract-requests/demo-activity.md`).

## What was built

- **DEMO.md**: 3-minute script with exact clicks and texts (TRN-088 reuse → link in the timeline → people and a draft nothing sends → TRN-301 question → Erkki answers → Veikko sees the change → `pnpm demo:agent`), the 30-second framing, privacy/no-cloud, troubleshooting, the stream explained, the Slack path (synthetic export, access gate) and the agent path for a judge's own Claude (`.mcp.json`, prompt, expected tool sequence, recorded fallback transcript).
- **`pnpm demo:play`**: a clock-driven simulated day against the running service; evidence from the train/validation families arrives (directory, Teams, e-mail, Slack days), simulated engineers investigate, the real coordinator asks, simulated colleagues reply (yes/no/not sure/later/dismiss/none), the judge's person is never auto-answered and is involved at most once per two simulated hours; the engine clock runs in simulated time meanwhile; JSONL under `data/local/`; readable terminal log; `--seed` deterministic; everything labelled simulated.
- **`GET /demo/activity`**, **`/demo/activity.html`** (panel palette), **`GET|POST /demo/clock`**, inline `directory` on `POST /import`, `QuestionView.personEntityId`.
- **`pnpm demo:judge`**: reset → service → stream (after a 240 s quiet period) → browser tab → desktop; Ctrl-C stops all three children in order (stream first so the clock returns to real time).
- **`pnpm demo:agent`** (MCP SDK client driving the stdio server on the same database; no model) and **`pnpm demo:slack`** (synthetic export, members-only private channel).

## Dry run from a fresh `data/local/` (what I saw)

Environment: this Mac, port 47900 (`KT_PORT=47900`, because the main session's companion holds 47831), the worktree's own `dist/` and a per-checkout Electron user-data dir (`data/local/electron`, so two companions can coexist; `demo:judge` now always passes it). The organizer's files were reachable through a git-ignored `private` symlink into the main checkout.

| Step | Real time | Seen |
| --- | --- | --- |
| `pnpm demo:judge --hour-seconds 6` from no `data/local/` | 0–3 s | reset prints the Elisa Teams/e-mail imports (1 case, 25 + 11 claims), two demo families and the dev fixture: 6 cases, 108 claims, 67 evidence, 21 people |
| service | +1 s | `listening on http://127.0.0.1:47900`; `/health` lists 29 routes |
| stream | +2 s | banner, `You are Aarne Koskela` (default person after a reset is the first available field engineer by name), day starts 07:30 simulated; first rows within 3 s |
| desktop | +3 s | `built dist/desktop in 53 ms`; Electron process up, renderer polled `/settings`, `/questions`; Snowbally landed bottom-right next to the other instance |
| browser | +2 s | the default browser opened `/demo/activity.html`; rows appeared within 2 s, newest at the bottom, "for you" rows shaded |
| full day (10 h at 6 s/h) | 62 s | 29 investigations, 21 evidence imports, 9 questions (4 answered, 1 later, 1 dismissed, 2 unanswered), 2 for the judge (Aarne: *Is TRN-117 an older unit?* at 08:10; after switching You to Veikko: *Is TRN-042 an older unit?* at 14:10), 0 errors |
| judge's own actions during the day (over HTTP, as the companion would) | — | mirrored as `You asked: …` rows with the recommendation; the You switch was noticed within one tick |
| `pnpm demo:agent` after the day | 2 s | `kt_investigate` → qualified; `kt_request_clarification` → question-open; the stream mirrored it as an **agent** row (`Agent Claude Code (judge) (agent:claude-code) investigated over MCP: …`) |
| Ctrl-C | 1 s | `[demo:judge] stopping…`, stream reset the clock (`mode: real`), service `SIGINT: shutting down`, Electron gone; no process left |

Second run of the instant day on the seeded data (`--instant`): 1.4 s for 10 simulated hours. Real-time pacing check (1.5 h at 6 s/h): 10.8 s wall clock.

## Rough edges found and fixed during the dry run

1. **A live stream competes with the walkthrough.** With arriving families in the directory, the judge's TRN-301 question went to *Antti Korhonen (group noc)* instead of Erkki: the rules selector's tie-break between equally placed observers is string order of `questionId|personEntityId`, and Antti's id sorts first. Fix: `demo:judge` starts the day after a 240 s quiet period (R31, U24); the selector is unchanged (U26).
2. **Planned arrivals past the end of a short day** made the runner loop at 1 ms steps (it never reached "no events left"). Fixed: the plan squeezes spacing so every arrival fits inside the day, and the loop stops at the day's end and reports skipped events.
3. **`because they they …`** in question rows (the loop reason already contains "they"). Fixed.
4. The judge-question count was counted twice (slot + poll). Fixed.
5. Expanded Teams stamps: the Elisa thread has times only, so case `when` fields read "09:14 (date unknown)"; nothing to fix, mentioned in DEMO.md's "Link" step wording.

## Rough edges left (not fixed)

- **Recipient of the MCP demo question depends on the directory.** On the seeded data it is Erkki (as DEMO.md says); after the simulated day has imported more NOC people it can be another NOC person (seen: Anneli Koivisto). DEMO.md tells judges to run `pnpm demo:agent` within the walkthrough, before the day begins, or to expect "whoever the coordinator picked".
- The TRN-301 judge prompt (targets Erkki) is skipped once Erkki has answered the same question in another investigation (24 h re-ask window); the stream then reports "the coordinator chose X instead of you" or uses another prompt. Expected, logged.
- The activity page polls every 2 s and keeps at most 1000 rows per request; a very long `--hours` run grows the JSONL (a 10 h day is ~85 rows).
- `GET /questions` without a person lists every person's open questions (trusted-local read, as before); the stream relies on it.
- `open`-ing the browser tab uses the judge's default browser; on a machine with no default browser the log line tells them the URL.
- Two companions on one screen overlap at the same corner (only relevant to this dry run).

## Checks run

- `pnpm test`: 262 tests passing including the 10 new ones (`src/libs/utils/simulation/simulation.test.ts`: profiles, topics, replies, plan, clock, row format; `tests/demo-stream.test.ts`: demo clock routes, activity route and page, a full instant day against an in-process service with a judge person, seed determinism); `pnpm typecheck` clean.
- Manual: `pnpm demo:play --instant` (10 h, 0 errors), `pnpm demo:play` real time (1.5 h at 6 s/h), `pnpm demo:judge` dry run above, `pnpm demo:agent` with a mid-wait answer (transcript in `demo/mcp-transcript.md`), `pnpm demo:slack` (Elina sees ACC-12 only; Antti sees ACC-30 with the five private-channel messages).
- `git status`: nothing from `private/` or `data/local/` is tracked (the `private` symlink is ignored by `.gitignore`'s `private/` rule).
