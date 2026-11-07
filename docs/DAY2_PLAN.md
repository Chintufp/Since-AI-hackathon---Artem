# Day 2 — fit against Elisa's rubric and the 24-hour plan

**For Artem · written Saturday 7 November 2026, 09:30 EET · deadline Sunday 8 November 10:00 (about 24 h 30 min)**

What I read: the official brief (PDF), Joni's deck (`private/organizer/`), the run report, DECISIONS R01–R32, the UX pass brief and spec, the demo-mode branch (`claude/demo-mode-4c65f3`, 8 commits, finished 09:05), the contracts and the investigation, memory, retrieval, questions and MCP modules, the E00–E07 results, and the real-service screenshots. What I ran: `pnpm typecheck` (clean) and `pnpm test` (287 pass) on the run branch with your uncommitted UX files present. What I did not do: launch the app (your UX session is working in this folder), and I committed nothing.

## 1. Verdict in six lines

1. The base is stronger than most entries will be: Elisa's own Teams thread and e-mail go in as they are, every answer carries who said it, where, when, whether it was verified and under which condition, access is enforced per piece of evidence, an agent gets the same engine over MCP under the same limits, and all of it is deterministic, local and covered by 287 tests and hash-locked experiments.
2. Against the rubric it is strong on "no documentation step", feasibility and the agent interface. It is weak on exactly the two things Joni named: **capture from the channels specialists already use** (today: file import; Slack fixture-only; no in-app "remember this") and **time** ("when does it stop being true?"): `validity.to` is never set anywhere, nothing supersedes anything, there is no point-in-time query.
3. The demo tells Story 2 (Erkki) and not Story 1 (the barrier). The barrier data exists (`remote-power-access`, with Eino's mail, a code that changes every October and a person on leave), but access facts without a case are invisible to an investigation.
4. Judges "think knowledge graphs" and drew a reference architecture with `valid_from`/`valid_to` and a `t = x` line. We have the data for that picture and no picture.
5. Deliverables: demo yes (two branches that still need merging), documentation yes (twenty files; no single judge entry), **slides: none**, repo not pushed, no recorded fallback video.
6. The plan: make their own reference architecture run live with a time slider, add validity and supersession, make both of their stories run end to end with a real agent, show capture in front of them, then spend the rest on the required package. Snowbally is already good enough; freeze him by mid-afternoon.

## 2. Scorecard against the official criteria

| Criterion (official order) | Today | Evidence | Gap | After the plan |
| --- | --- | --- | --- | --- |
| **Usability: minimal extra work, ideally from Teams/e-mail** (primary) | 6/10 | Thread and mail imported unchanged; one Yes/No question, 3/day, 30 min cooldown, Not sure/Later/Undo; companion stays out of the way | Capture is a file import; nothing is captured from a channel in front of the judge; the ask goes through our own surface, not theirs; no "remember this" in the app | 8/10 with in-app capture; 9/10 with a live Slack sandbox (needs your authorization, U25) |
| **Relevance of captured context** | 6/10 | Right next step, right caveats, lookalike rejected on the Elisa case and the demo families | Lexical extraction and problem parsing; a judge who paraphrases ("green light, nothing flowing") may get nothing; kind accuracy at majority baseline on unseen synthetic families | 7/10 with the disagreement scenario and the provenance strip; 8/10 if the optional local-model route lands |
| **Linking: right entity, right time validity** | 6/10 | Every claim bound to assets/people/sites with evidence spans; "older units" kept hedged rather than generalised; a later report flips an outcome to recurred | `valid_to` never set; no supersession; no "what was believed at t"; the barrier code that changes every October is stored as timeless | 9/10 with Move 1 and Move 2 |
| **Technical feasibility** | 8/10 | One TypeScript codebase, SQLite, Electron, MCP, 287 tests, deterministic, instant | "Rules only" can read as a toy to AI architects unless framed as model-agnostic; macOS only | 9/10 with the framing on the slides (and the optional Ollama route as proof) |
| **Suitability for agentic operations** | 7/10 | 8 MCP tools over the same engine; agents cannot read restricted evidence or exceed budgets (tested); async clarification | No real agent has driven it (U27); the "3 a.m." case is not demonstrated; access facts not retrievable for a dispatch decision | 9/10 with Move 3 |

Deliverables: demo ✔ (merge needed) · docs ✔ (one judge entry needed) · **slides ✗** · repo ✔ (not pushed) · video (not required, strongly advised).

## 3. What judges would see today

**Good.** The 3-minute script on the demo-mode branch is solid and honest: capture (the reset prints what was captured), reuse with caveats on TRN-088, the timeline bound to messages and people, people with their actual contributions, the one question reaching Erkki, Erkki's tap changing Veikko's next step, `pnpm demo:agent` over MCP, the private Slack channel gate. The companion is polished and never nags. The documentation is unusually candid about limits.

**Weak.** Switching "You" between Veikko and Erkki through Settings is clunky to watch. Snowbally's new "away is home" behaviour hides the product when a judge sits down. The simulated day can look like fake activity if it runs during the script. No slide deck. The strongest Elisa phrases (locked barrier, "still believed true", "an agent can't call Erkki at 3 a.m.") are not answered on screen. Two parallel branches with colliding decision numbers (run branch R31–R32 and the UX pass's planned R31–R36 vs demo-mode's R31–R35; U24–U27).

## 4. The plan: eight moves, ranked by impact per hour

### Move 1 · "Still believed true": validity, supersession, point-in-time (5–7 h)

Their words: *"Firmware fixes the bug and the barrier gets a new lock. When does it stop being true?"* and *"valid_to defaults to still believed true"*.

- **Contract.** `Claim.validity` already has `from/to/condition`. Add `supersededBy?: string` and a `'superseded'` claim status. Nothing is deleted or rewritten; the old claim keeps its evidence and gets a `to`.
- **Memory rules** (`memory/extractor-rules.ts`, `memory/commit.ts`): (a) a newer claim of the same type on the same subject entity with the same condition key and a different value closes the older one (phrasing-independent, so it is robust); (b) explicit cues set `to` or `condition` ("fixed in firmware 4.2", "no longer", "new code since", "changed the lock", "every October", "until 1 December"); (c) a correction already retracts; keep that.
- **Investigation.** `at?: Iso` on `POST /investigate`, `kt_investigate`, `kt_get_context` (default now). Only claims valid at `at` feed candidates and hypotheses. A superseded basis produces the caveat "Superseded on 14 Oct by Erkki Expert: fixed in firmware 4.2" and drops the branch to `qualified`/`none`.
- **New route** `GET /context?entity=TRN-042&at=…`: the assertions bound to an entity (and its hedged classes) valid at `at`, with source, person, time, status. This is the "context assertion" of their diagram, as JSON, and it feeds Move 2.
- **Generated data, documented as the brief asks** (`data/demo/followups/`, with a README saying what was generated and how): (1) Erkki, Teams, 14 Oct 2026: "Update on the SFP thing: the 4.2 firmware fixes the forwarding-state bug. Units already on 4.2 shouldn't see it; if they do, it's something else." (2) Eino, mail, 6 Oct 2026: "Barrier code at RBS-310 is now 7731 (landlord changed the lock)." Plus two problems: a TRN unit "on firmware 4.2, counters zero" (answer: the TRN-042 fix is superseded for 4.2 units; ask Erkki) and "Driving to RBS-310 Thursday, barrier code?" (answer: 7731, Eino, 6 Oct, replaces 5802 from 20 Aug, changes every October).
- **Tests.** Supersession closes validity; same query before/after the superseding message gives different answers; the old claim remains readable with its window; E00 still passes.

### Move 2 · Their reference architecture, alive: the Context Layer page (4–6 h)

A page served by the service like the demo-mode activity page (`/context.html?entity=TRN-042`), plain SVG in the panel's palette. Rows, top to bottom, exactly as in `reference_architecture.png`: **as-observed** (evidence records as diamonds on a time axis: 09:14 … 09:27, the mail), **as-experienced** (claims as bars from `valid_from` to `valid_to`, open-ended bars fading to the right with the label "still believed true", superseded bars greyed with an arrow to the superseder, colour by claim type), **bindings** (entity chips: `TRN-042 · firsthand`; `older transmission units ≤ 2019 · hedged · Erkki: "several cases" · recorded: 1`), **people** (who asserted what). A draggable `t = x` line; the card on the right shows "what an agent is told at t" from `POST /investigate` with `at`. Clicking a bar shows the sentence it came from. Link it from the case view ("Open the context layer", desktop only). This single page is the slide that explains the product, in their own drawing, with real data.

### Move 3 · Both stories, one agent, including 3 a.m. (5–7 h)

Their words: *"An agent can't call Erkki at 3 a.m."* and Story 1, the locked barrier.

- **Access facts become retrievable.** The problem parser recognises dispatch/site/access intent ("driving out to", "barrier", "code", "key", "gate") and a site/asset mention; the investigation returns access-fact claims bound to that entity and valid at `at`, with person, date and status, as a `reuse` recommendation of action class `none` (information), and lists who to ask when a fact is missing (Eino is on leave until 1 Dec and his mail says Pirkko does not handle codes: the recipient logic must not pick her). `remote-power-access-p2` is already in the demo family for exactly this.
- **Quiet hours.** `quietHours` in `org-config` (default 22:00–07:00): a question created in quiet hours is `queued`, delivered at the next window; the attention module on the UX branch already handles arrival. The demo clock from the demo-mode branch makes "03:00" real on stage.
- **A real agent.** Claude Code with the `.mcp.json` from DEMO.md (U27): at 03:00 simulated time the agent calls `kt_investigate`, gets the qualified answer, calls `kt_request_clarification`; nothing reaches Erkki; at 07:30 Snowbally hops in on Erkki's desk with the one question; one tap; the agent reads `kt_clarification_status`, continues with `kt_get_context`, and records `kt_record_outcome` when the tech reports back. Record it (screen + companion) as the fallback video and transcript.

### Move 4 · Capture in front of them (3 h, plus 5 h if you authorize Slack)

- **D1, do it:** "Remember this" in the panel. Paste a copied Teams thread or an e-mail, or drop a `.txt`/`.eml`/`.json` on the card or on Snowbally; `POST /import` with the paste adapter already exists. Receipt: "Captured: 1 case · 7 claims · bound to TRN-042, Erkki Expert, Veikko Vikkelä · 09:14–09:27 (date unknown)" and a hop. The judge watches a conversation become a case with no form.
- **D2, your call (U25):** a sandbox Slack workspace and app (30 min of your time; scopes `channels:history`, `channels:read`, `groups:history`, `groups:read`, `users:read`, `chat:write`, `reactions:read`). A poller feeds the existing live connector (read side is fixture-tested) so a thread typed in Slack is captured within seconds, and the one question goes to the expert as a Slack DM answered with 👍 / 👎 / 🤷 reactions. That is capture and ask "in the channel they already use", the primary criterion, live. Risks: venue Wi-Fi, rate limits; D1 and Snowbally remain the fallback. Nothing is connected before you name the workspace in chat.

### Move 5 · Experts disagree (3 h)

The brief itself suggests "conflicting advice from two experts". One generated Teams thread: Helmi: "On the 2021 batch (TRN-5xx) the bounce doesn't help; you have to clear the forwarding table." A problem on a unit of unknown batch returns two qualified hypotheses, each with its expert, and one question: "Is TRN-5xx from the 2021 batch?" The answer picks the branch; neither expert is overwritten; both stay visible with their sources. One test.

### Move 6 · Provenance strip and burden meter (3 h)

- Under every result heading, one line: `Erkki Expert · Teams 09:22 (date unknown) · reported once · still believed true`. All of it already exists in the node details; it belongs under the headline, because that is where a judge's eye stops.
- "Erkki's cost" in Settings and on the activity page: `This week: asked 2 · answered 2 · about 10 s · his knowledge reused 7× by 4 people and 1 agent`, from the service events. It is the primary criterion as a number and a slide.

### Move 7 · Optional: a local model route, as proof of model-agnosticism (6–8 h, stretch)

Ollama is installed on this Mac with `qwen3:8b`, `qwen3:14b` and `qwen3.8:27b` (M5, 24 GB). A route `local` / `ollama:qwen3-14b` that emits the E01 proposal JSON (the format of `data/replays/e01-claude-arm/`), validated with zod and committed through the existing `commitProposal`, labelled "proposed by a local model", never merging silently. Run E01 against it for a number on the slide. No cloud, no API, consistent with your local-first rule. Do it last, drop it first.

### Move 8 · The package (5 h, required)

- Merge demo-mode into the run branch once the UX pass is frozen; renumber its R31–R35 and U24–U27 behind the UX entries; push the branch; test `pnpm demo:judge` on a clean clone.
- `docs/SUBMISSION.md`, one page: the 3-minute script, Elisa's layers mapped to our modules, what is synthetic, the numbers with denominators, the limits. Everything else links from it.
- Slides, 12 at most, mirroring Joni's deck: (1) Knowledge Twin: the as-experienced layer. (2) "That smiley is our problem": what we captured from it, no form. (3) One picture: Teams/e-mail → evidence → claims bound to entities with valid_from/valid_to → investigation → person or agent. (4) Live: Erkki's rule reused on TRN-088. (5) Hard part 01, the real knowledge: 12 messages, 1 rule, support and applicability kept apart. (6) Hard part 02, linking: TRN-042 firsthand vs "older units" hedged; a wrong link is worse than none, so the lookalike is rejected. (7) Hard part 03, time: the Context Layer page. (8) Hard part 04, trust: reported vs verified, who said it where, experts disagree. (9) Hard part 05, people: one tap, 3 a day, Not sure/Later/Undo, Snowbally, the burden meter. (10) Agent-ready: 8 MCP tools, same limits, the 3 a.m. sequence. (11) Honest numbers: tests, frozen experiments, what is weak. (12) "Is this documented somewhere?": Yes. Nobody had to write it down. Pilot ask: one team, one Slack or Teams scope, two weeks.
- A 2–3 minute screen recording of the script and the agent session, in case the live demo breaks.

## 5. The two signature moments of the pitch

1. **"What did we know at t?"** On the Context Layer page, drag the line: before 09:16 the agent is told nothing; after 09:22, "check the counters, then bounce the interface, reported once"; after 14 Oct, "superseded for firmware 4.2". Then switch the entity to RBS-310: 20 Aug "5802", 6 Oct "7731". Four answers, one slider, their diagram.
2. **"An agent can't call Erkki at 3 a.m."** Demo clock 03:00. Claude Code investigates over MCP, the question is queued. 07:30: Snowbally hops in on Erkki's desk with one question. One tap. The agent continues and records the outcome. Close on Veikko's line: *"Is this documented somewhere?"*, and Snowbally opens the case: *Yes. Erkki, Teams, 09:22. Nobody wrote it down.*

## 6. Rethinks of existing parts

1. **Persona switching.** Add "Be Veikko / Be Erkki" chips in the panel footer in demo mode, or let D2 deliver Erkki's question in Slack. Settings → You stays as the real mechanism.
2. **Away is home.** Keep it as the product default; add a demo flag that starts him in and leaves after 120 s idle, so a judge who sits down sees the product. Freeze the UX pass by 15:00 Saturday whatever its state; every hour after that is worth more elsewhere.
3. **Simulated day.** Second screen only, 20 s per simulated hour, started after the script (U24). Label it "simulated" on the page itself.
4. **The result card.** The caveat "reported once; cause and lasting effect not verified" reads as weakness to someone who wants confident agents. The provenance strip (Move 6) turns it into a strength: it shows what verification would take.
5. **Documentation.** Twenty files is a liability on a 3-hour review; `SUBMISSION.md` is the one door.
6. **Recommendation kind accuracy at the majority baseline.** Do not chase it with rules in 24 h; say it on the numbers slide, next to the hash-locked test split and the network guard. The honesty is itself unusual.
7. **Decision numbering.** The demo-mode branch and the UX pass both started at R31. Renumber at merge time; new work writes its decisions to `docs/runs/2026-11-07-overnight/day2/DECISIONS-<area>.md` and gets folded in at integration, so nobody conflicts in one file.
8. **Access facts.** They are stored and never retrieved by an investigation. Move 3 fixes it; without it, Story 1 cannot be shown.
9. **Points.** Keep off by default; one sentence on the people slide; show the burst only if a judge asks.

## 7. Schedule (EET)

| When | What | Who |
| --- | --- | --- |
| Sat 09:30–10:30 | Read this; decide D2 (Slack sandbox) and the UX freeze time; start the three sessions below | you |
| 10:30–15:00 | S1 engine: Move 1 + access facts and quiet hours of Move 3. S2 view: Move 2 + Move 6. S3 package: `SUBMISSION.md`, slide skeleton, merge plan, push, clean-clone test. UX pass finishes and freezes | three sessions in worktrees + the UX session |
| 15:00–18:00 | Move 4 D1 capture; Move 5 disagreement; integrate the branches; full script run; screenshots | one integration session |
| 18:00–21:00 | Record the agent session and the video; finish slides; clean-clone test again | you + one session |
| 21:00–24:00 | Stretch: Move 7 or D2 if everything above is green; otherwise sleep | optional |
| Sun 07:30–09:30 | Two dry runs of the 3-minute script and the agent sequence; upload by 09:30 | you |

## 8. What only you can do

1. Decide the Slack sandbox (D2). If yes: create the workspace and app, and name them in chat; nothing is connected before that.
2. Your own Claude Code or Desktop for the real agent session (our code never calls a model).
3. Confirm the UX pass freeze time (I suggest 15:00) and that pushing the run branch to `origin` is fine.
4. Bring your Mac to the judging: the demo is macOS-only and reads Elisa's files from `private/`.

## 9. Risks and what to drop first

Drop in this order if time runs out: Move 7, D2, Move 5, the burden meter, the quiet-hours rule. Never drop: Move 8, Move 1, Move 2, the agent recording. Watch the merge (DECISIONS and OPEN_QUESTIONS will conflict), the venue network (everything must run offline; D2 is the only online piece), and the clock (upload at 09:30, not 09:59).
