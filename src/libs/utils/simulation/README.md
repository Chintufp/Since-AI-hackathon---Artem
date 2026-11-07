# simulation

The simulated activity stream behind `pnpm demo:play` (scripts/demo-play.ts): a scripted, clock-driven day played against the **running service over HTTP**. The real engine decides everything (retrieval, recommendation, who may be asked, limits); this module only plays the environment, and labels every row as simulated.

## Public interface (`index.ts`)
- `createSimClock(start, hourSeconds)` → `SimClock` (`now`, `minutes`, `advanceTo(ms)` waits `hourSeconds` real seconds per simulated hour; `0` = instant, for tests). `todayAt(h, m)`, `hhmm`.
- `buildProfiles(directory, seed)` → per-person `SimProfile` (responsiveness 0.55–0.95, topics known firsthand by role/group, hidden yes/no per topic). Same model as `models/testing/simulator.ts`; seeded, never a model call, never the scenarios' hidden answer keys. `decideReply(profile, questionText, draw)` → yes / no / unknown / later (with an optional follow-up answer) / dismiss / none, with a plausible delay in simulated minutes. `topicOf(text)` maps question wording to a topic (the API does not expose the gap key).
- `planDay({seed, families, hours, judgeEveryMinutes, extraProblems})` → `DayPlan`: evidence arrivals (directory, then Teams thread, e-mails, Slack days, staggered), simulated engineers' investigations after their family's evidence, seeded families' problems spread over the day, judge slots every `judgeEveryMinutes`. Pure and deterministic.
- `runDay({client, plan, clock, seed, sink, judgePrompts, syncServiceClock})` → `RunSummary`. Each tick: due plan events (`POST /import` with inline payloads and the family directory, `POST /investigate` as the simulated requester), due simulated replies (`POST /questions/:id/answer|defer|dismiss`), a poll of open questions (new ones are logged with who was asked and why, then a reply is scheduled unless the recipient is the judge's person), a poll of `GET /events` to mirror what the judge and MCP agents did on the same database, and `POST /demo/clock` so the engine's daily limits and cooldowns run in simulated time.
- Sinks: `jsonlSink(path)` (what `GET /demo/activity` tails), `terminalSink()`, `combinedSink`, `formatRow`.

## Judge involvement
The person chosen under Settings → You is never auto-answered. At each judge slot (default every 120 simulated minutes, and only when no question for them is open) the runner asks one scripted problem from `data/demo/judge-prompts.json` whose `targets` include that person (the requester is excluded by the coordinator, so choosing the requester steers eligibility); the log says whether the coordinator actually chose them. The coordinator's own limits (3 per person per simulated day, 30 min cooldown, 1 open) still apply.

## Dependencies
`contracts`, `models` (`createRng`, `shuffleInPlace`). Talks to the service only through HTTP (`client.ts`).

## Checks run
`node --test src/libs/utils/simulation/simulation.test.ts tests/demo-stream.test.ts`: profiles deterministic and role-driven, topic mapping, reply vocabulary and reproducibility, plan ordering and judge-slot spacing, clock maths, row format; an instant simulated day against an in-process service (real questions asked and answered by simulated people, judge left alone, JSONL served by `/demo/activity`, demo clock routes).

## Known limitations
- The topic of a question is inferred from its wording; an unfamiliar template falls back to `other` (the person says "not sure").
- Whole threads arrive at once (message-by-message arrival would change episode assignment, see `memory/README.md`).
- Budgets are counted by the service in simulated time only while the stream runs; after it ends the clock returns to real time, so a question delivered "today" in simulated time still counts for today's real daily limit.
