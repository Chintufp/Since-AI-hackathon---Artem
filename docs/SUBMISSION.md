# Knowledge Twin: submission (the one door)

**Elisa challenge, Since AI hackathon, 7–8 November 2026.** Expert knowledge lives in Teams threads and e-mails, never in the manuals. Knowledge Twin reads those messages as they are (no form, no documentation step), binds what was said to the equipment, the people and the time it concerns, and answers the next similar problem, for a person or an autonomous agent, with the earlier fix **and its caveats**. When one deciding fact is missing it asks one person one Yes/No question, within a daily budget, and never at night. Everything runs on one Mac, offline.

If you have three hours: run section 7, follow [DEMO.md](DEMO.md) for the script, then read the [slides](slides/SLIDES.md) and section 6 (what is weak). Everything else is linked, not repeated.

## 1. The 3-minute script and the two signature moments

Full click-by-click text with what appears after each step: [DEMO.md](DEMO.md). In short, as Veikko (field engineer) in the companion, Lumi:

| Time | What the judge sees |
| --- | --- |
| 0:00–0:25 | Click Lumi; click the **Be Veikko** chip in the panel footer (demo mode; Settings → You = Veikko does the same). |
| 0:25 | Paste the TRN-088 problem (older unit, SFP replaced, no traffic): **"Check the traffic counters before replacing the SFP again."**, caveat *Reported once; cause and lasting effect not verified*, basis case TRN-042 as a timeline. Erkki's rule reused on a unit Erkki never saw. |
| 0:55 | Click a timeline node: the sentence it came from, who said it, "09:22 (date unknown)". |
| 1:15 | People with relevant experience, each with what they actually did; a message draft that nothing sends. |
| 1:40 | Paste TRN-301 ("not sure which unit generation"): qualified answer, one question to Erkki: *Is TRN-301 an older unit?* |
| 2:05–2:35 | **Be Erkki** chip, tap **Yes**; **Be Veikko** chip, and the recommendation now starts with the check. |
| 2:50 | `pnpm demo:agent`: the same engine over MCP, at 03:00. |

**Signature moment 1: "An agent can't call Erkki at 3 a.m."** `pnpm demo:agent` starts the MCP server at 03:00 Helsinki with quiet hours on. The agent calls `kt_investigate`, then `kt_list_gaps` (the gap that decides applicability, who could answer, a confidence block of labels, never a number), then `kt_request_clarification` with that gap and a preference for Erkki: `queued` until 07:00. At 07:30 the question reaches Erkki's companion; **one tap**; `kt_get_context` now says "Check the traffic counters before replacing the SFP again." Recorded run: [mcp-transcript.md](runs/2026-11-07-overnight/demo/mcp-transcript.md). Run it before the walkthrough (or on a fresh `pnpm demo:reset`) for the Erkki version; after it the engine refuses to ask Erkki twice and names Helmi instead ([DEMO.md](DEMO.md), step 3). On a clone without `private/` the same script matches the generated stand-in TRN-233 (Ville Ranta, Pekka Laine), still prefers Erkki for the same question and, after his Yes, says "Consider disabling and re-enabling the interface; it reportedly restored traffic in TRN-233." (`tests/clean-clone-agent.test.ts`, D-B6-27).

**Signature moment 2: the Context Layer slider.** `http://127.0.0.1:47831/context.html?entity=TRN-042`: Elisa's reference architecture drawn from live data (as observed, as experienced, bindings, people) with a draggable `t` line. 09:14–09:18 the agent is told nothing; 09:19–09:22 "Check the traffic counters first"; 09:25 bounce the interface, reported once; from 14 Oct *Superseded on 14 Oct by Erkki Expert: fixed in firmware 4.2*. Then `?entity=RBS-310`: barrier code 5802 from 20 Aug, 7731 from 6 Oct. On a clone without `private/`: `?entity=TRN-233` (generated stand-in, Pekka Laine's 14 Oct firmware note) or `?entity=TRN-117` (Helmi's); RBS-310 is the same. Screenshots: [day2/screenshots/context-*.png](runs/2026-11-07-overnight/day2/screenshots/).

## 2. Elisa's layers mapped to our modules

Paths are under `src/libs/utils/` unless they start with `src/apps/`.

| Elisa's layer | What it does here | Where |
| --- | --- | --- |
| **Capture** (channels people already use) | Teams JSON, e-mail text, Slack export, Slack live (sandbox, off by default), paste/drop "Remember this" | `connectors/` (`teams-json.ts`, `email-text.ts`, `slack-export.ts`, `slack-live.ts`, `slack-poller.ts`, `paste.ts`), `src/apps/service/capture.ts` |
| **Evidence** (as observed) | One record per message, verbatim, stable id, author, time as given ("date unknown" stays unknown), access scope, copies detected | `ingest/` (`import.ts`, `copies.ts`), `memory/sqlite-store.ts` |
| **Claims bound to entities, with validity** (as experienced) | Claims cut from evidence with spans; bound to assets, sites, people (firsthand vs hedged class); `validity.from/to`, condition, supersession | `memory/extractor-rules.ts`, `memory/commit.ts`, `memory/validity.ts`, `memory/supersession.ts`, `memory/context-assertions.ts`, `context/` |
| **Investigation** | Retrieval (BM25 + exact id + trigram, optional bge-m3, rank fusion), matching/conflicting/missing conditions, support and applicability kept apart, gaps, point-in-time `at` | `retrieval/hybrid.ts`, `retrieval/embedding-index.ts`, `investigation/assessor.ts`, `investigation/case-facts.ts`, `investigation/gaps.ts`, `investigation/access-facts.ts`, `investigation/alternatives.ts` |
| **Person or agent** | One Yes/No question to the best-placed person under budgets and quiet hours; Lumi companion; HTTP API (42 routes); MCP server (12 tools) | `questions/` (`coordinator.ts`, `recipients.ts`, `quiet-hours.ts`, `generator-templates.ts`), `src/apps/desktop/`, `src/apps/service/http.ts`, `src/apps/service/mcp-tools.ts` |
| Store health (our metric) | Completeness of six slots per case, correctness, reward for the bandit | `memory/store-health.ts`, `src/apps/service/costs.ts` |

Route list: [src/apps/service/README.md](../src/apps/service/README.md). Architecture: [ARCHITECTURE.md](ARCHITECTURE.md). How questions are decided: [HOW_QUESTIONS_WORK.md](HOW_QUESTIONS_WORK.md).

## 3. What is synthetic and what is Elisa's

**From Elisa's material, held only in git-ignored `private/`, never in the repository:** the Teams thread `teams_chat.json` (12 messages, TRN-042) and `email.txt`, and the organizer deck. On a machine that has them, `pnpm demo:reset` imports them unchanged: the thread gives the TRN-042 case with 25 claims; the e-mail adds 11 claims and is recognised as a retelling of the thread, not a second confirmation (reset output in [DEMO.md](DEMO.md)).

**Synthetic, written by our agents, labelled as such in the repository:**

- The 10 scenario families in `data/scenarios/` (30 problems; demo 2, train 4, validation 2, test 2 families), including TRN-117 (`optic-forwarding-a`, the TRN-042 stand-in for seed `synthetic` and the E08 paraphrase probe), and the RBS-310 barrier family (`remote-power-access`). Answer keys authored by one agent, audited once, unreviewed by a human.
- The dated follow-ups in `data/demo/followups/`: Erkki's 14 Oct firmware 4.2 note and Eino's 6 Oct barrier code 7731 ([README](../data/demo/followups/README.md)). Elisa's example has no dates; these exist to show validity and supersession.
- `data/demo/followups-synthetic/`: the same firmware note by Helmi on TRN-117, used only when Elisa's thread is absent.
- `data/demo/experts-disagree/`: Helmi's 2021-batch thread (TRN-512), seeded only next to Elisa's TRN-042.
- `data/demo/older-units-synthetic/`: Ville Ranta and Pekka Laine on TRN-233 (older units: disable and re-enable the interface) and Pekka's 14 Oct firmware note, invented names, seeded only on the default seed when Elisa's thread is absent, so a clean clone has the older-unit case the agent path and the field chip need ([README](../data/demo/older-units-synthetic/README.md), D-B6-27).
- The simulated day (`pnpm demo:play`, started by `demo:judge` after 240 s): simulated engineers and colleagues, every row labelled simulated. The people answering in E03–E10 are an oracle reading the answer key, not engineers.

## 4. The numbers, with denominators

All from files in the repository or a command run on 7–8 Nov 2026; full tables in [experiments/RESULTS.md](../experiments/RESULTS.md) and [E08-E10.md](runs/2026-11-07-overnight/day2/E08-E10.md). All on synthetic data; the test split is hash-locked (`data/scenarios/TEST_LOCK.json`) and was not reopened for E08–E10.

| What | Number | Source |
| --- | --- | --- |
| Tests | **641/641** pass (`pnpm test`, Elisa files present), typecheck clean; experiment harness 24/24 (`node --test experiments/*.test.ts`); E00 17/17 checks. On a clean clone without `private/`: 612 pass, 0 fail, 5 skipped (the Elisa-only tests) of 617 at db4cfa9 (not re-run since) | run on 8 Nov 2026 after the round-5 fixes (D-B2-74..78); D-B6-26, D-B6-28, D-B6-33 |
| Interfaces | 42 HTTP routes, 12 MCP tools | DECISIONS-integration D-INT-15 |
| E00 rules baseline | 17/17 checks; claim recall 32/47 train, 14/22 validation; false "solved" 0/6 train, 0/4 validation; access leakage 0/87 train, 0/47 validation, 1/42 demo (an e-mail with no ACL metadata, a known limit) | RESULTS.md, E00 |
| E08 retrieval recall@3 | 7/9 validation, 16/18 train, 8/8 demo, the same for all five retrievers (BM25, trigram, bge-m3, hybrid, hybrid+bge-m3) | E08-E10.md |
| E08 lookalike rejection | 1/2 validation, 1/1 train, 1/1 demo, all five retrievers | RESULTS.md, E08 |
| E08 paraphrase probe | "green light, nothing flowing": TRN-117 at rank **1** with bge-m3, rank 5 with trigram/hybrid, not in the top 8 with BM25 | E08-E10.md |
| E09 extraction, qwen3:4b vs rules | claim recall train: rules 32/47, model alone 17/47, rules ∪ model 33/47; validation 14/22, 6/22, 14/22. Precision train 32/58 → 33/75 with the union. 6/6 imports exceed the 60 s budget (mean 36.5 s per call, 24 calls) | E08-E10.md |
| E10 store, before → after one simulated day | 5 cases × 3 seeds, the same for both selectors: completeness 0.45 → 0.45; correctness 0.0167 → 0.0167 (supported claims 3/180 → 3/180, summed over 3 seeds); product 0.0075 → 0.0075, gain 0 points; cases 5 → 17 (the day imports the train and validation families) | E08-E10.md |
| E10 per answer, the two scores apart | questions 9 per selector (3 per seed); answered rules 5/9, LinUCB 6/9. Product deltas 0 points on 5/5 and 6/6 answers, none negative (was −6.77 and −13.54 points before an applicability No stopped counting as a contradiction, D-B2-66). Completeness of the touched cases: rules +12.49 points (3/5 answers raised it), LinUCB +16.66 (4/6); one key of the four-key slot is 1/24 = 4.17 points. Correctness 0 points on every answer: the touched cases have no supported claim, so the product hides the gain. Mean reward (delta − burden): rules −0.008 over 5, LinUCB −0.0033 over 6 | E08-E10.md, D-B2-66..68 |
| E10 questions per point gained | product: undefined (0 points gained); per completeness point on the touched cases: rules 9/12.49 = 0.72, LinUCB 9/16.66 = 0.54 | E08-E10.md |
| E10 bandit vs rules | LinUCB gains more per question on **0/3** seeds; rules stay the default. Hash-locked: `lock.json` resultsSha256 9248c6506f594c97 over results, per-seed and decision files without timestamps (`tests/e10-lock.test.ts`); inputs familiesSha256 885928361d0f3da7; re-runs reproduce the numbers | E08-E10.md, D-B2-78 |
| Value / cost on one store question | demo store: the RTR-117 outcome question measures +2.25 points answered Yes (product 0.0226 → 0.0451) and 0 answered No; on RTR-203 the expected gain of the outcome question (0.0113, Yes weighted 0.5) is above the version question's (0.0017), so the outcome is asked first | `tests/store-health.test.ts`, D-B2-67, D-B2-74 |
| Live local models, recorded once (8 Nov, this Mac, Ollama 0.40.9, seed `elisa`) | **embed=local** (bge-m3), "green light, nothing flowing": TRN-042 rank **1** (0.667; next TRN-512 0.328), as with rules (0.625; next RBS-310 0.259); query 42 ms. **extract=local** (qwen3:4b) on Elisa's 12-message thread: 41.8 s of the 60 s budget, no fallback; 5 claims proposed, 3 kept, 4 items dropped by the evidence validator, 1 new claim committed with the model's route; rules claims 121 → 121. **phrase=local** (qwen3:4b): 0.98 s, returned the template sentence unchanged, so the card shows template wording; the second pass crashed on a fractional timeout, fixed afterwards (D-B2-77) | E08-E10.md, D-B2-70..73 |
| Recommendation kind accuracy | 3/12 train vs majority baseline 6/12; 3/6 validation vs 4/6 | RESULTS.md, E00 |
| Clean clone without `private/` | `pnpm install --offline` from the local store; `demo:reset` 6 cases (with the stand-in); `demo:agent` runs the full 03:00 → 07:30 sequence to *answered*; service routes /health, /context.html, /context?entity=TRN-233 (13 assertions), GET /costs (*Store: 6 cases · completeness 0.47 · correctness 0.01 · 2 singletons left*); `demo:judge` launched the companion on 652e2a4 (before the stand-in); the Electron UI was not clicked through | D-B6-28 |
| Real engineers, real Erkki seconds, live Slack round trip | **not measured** | – |

## 5. The model layer: three slots × three providers, off by default

| Slot | What it may do | `rules` (default) | `local` (Ollama, opt-in) | `api` (opt-in) |
| --- | --- | --- | --- | --- |
| `embed` | text → vector for retrieval | hashed trigrams | `bge-m3` | hosted embedding |
| `extract` | thread → proposed claims, validated against the evidence | `rules-extractor@1` | `qwen3:4b` with JSON schema | hosted model, same schema |
| `phrase` | words the one question | templates | `qwen3:8b` | hosted model |

A model never decides which cases are the same, whether advice applies, who is asked, or writes to memory: it proposes, `commitProposal` commits, and every stored object names its route. Ollama runs only when a slot is set to `local` in Settings → Models; `api` only with a key and a click. `pnpm demo:judge` sets `KT_NO_API=1`, so hosted models stay off whatever the settings say. Any provider error or timeout falls back to rules for that call, labelled. Spec: [BUILD_BRIEF.md](BUILD_BRIEF.md) §2; decisions: [DECISIONS-models.md](runs/2026-11-07-overnight/day2/DECISIONS-models.md).

**On by default, no model involved:**

- **Service network guard** (D-INT-20). The service installs the guard at startup, before it listens, and re-derives the allowlist from the model slots on every fetch, so a change in Settings takes effect on the next call. Every slot on `rules`: no host is allowed. A `local` slot: only Ollama at `127.0.0.1:11434`. An `api` slot: the two hosted-model hosts, and only when `KT_NO_API` is not 1. `slack.com` only under `KT_SLACK_LIVE=1`. A refused call is logged with the route it was missing. Tests and experiments run under the same guard.
- **Questions ranked by value / cost** (brief §5.3, D-B2-67, D-B2-74). Among one investigation's candidates that pass the rules gate, the rules selector asks the highest value / cost: value = consequential × p(answer) × expected gain in completeness × correctness of the touched case × retrieval weight; cost = 1 + burden / 0.02, with burden = 0.02 per question asked today + 0.02 per open question + 0.05 inside quiet hours (the reward's burden term; "today" is the local day of the quiet hours' time zone, D-B2-76). The 3-minute script and the 03:00 sequence have one eligible question each and ask the same questions as before.
- **The measured reward** (brief §5.4): after each answer the service writes the change of completeness × correctness of the touched case minus burden to the question record, and `selector.update` learns from it. An answer to an applicability question scopes the case and is not counted for or against its claims (D-B2-66).

**The three local done-lines, recorded once** (8 Nov, Ollama 0.40.9 on this Mac, seed `elisa`, `KT_NO_API=1`, slots set back to rules afterwards; one run each, no answer key, model outputs not in the repository; [E08-E10.md](runs/2026-11-07-overnight/day2/E08-E10.md), D-B2-70..73):

- `embed=local` finds TRN-042 for "green light, nothing flowing": **met**, rank 1 (0.667), but rules also rank it 1 (0.625) on Elisa's store; bge-m3 changes places 2–3 to the two same-symptom cases. The synthetic probe (rank 5 → 1, E08) stays the case where it wins.
- `extract=local` imports Elisa's thread, labelled, rules intact: **met**, 41.8 s of the 60 s budget; 1 new claim committed with the model's route, 4 proposals dropped by the evidence validator, 121 rules claims before and after.
- `phrase=local` words the question to Erkki naturally: **not met by the model**. qwen3:4b returned the template sentence unchanged (0.98 s), so the card shows template wording. The crash it exposed in the second pass (a fractional timeout) is fixed (D-B2-77) and not re-recorded.

## 6. Limits and what is weak

- **Decision quality after retrieval.** Recommendation kind accuracy is below the majority baseline on unseen synthetic families (3/12 vs 6/12 train). Retrieval is good; the assessor rules are the binding constraint.
- **Models do not yet earn their place.** bge-m3 ties on the labelled splits and only wins the paraphrase probe; qwen3:4b adds 1 claim of recall on train, none on validation, costs precision and does not fit the 60 s budget on this Mac.
- **The store metric's product did not move.** One simulated day gained 0 points of completeness × correctness on the 5 demo cases. The answers did raise completeness of the cases they touched (+12.49 points for rules, +16.66 for LinUCB), but those cases have no claim on two independent sources yet, so correctness is 0 and the product hides the gain, as the brief's product defines it. The correctness denominator is all live case claims (our reading of the brief's "all cited claims", D-B2-29), and an applicability "No" counts as filling the asked key, an approximation of the brief's "explicit not applicable" (D-B2-75).
- **No real people.** Every answer in the experiments is simulated; denominators are tiny (one validation problem moves a rate by 0.17).
- **Extraction is lexical.** Paraphrases outside the cue lexicons are missed; person identity is by display name; batches before 2020 are not parsed (D-B5-17).
- **Elisa's TRN-042 story needs `private/`.** A fresh clone shows the same flows on the generated TRN-233 stand-in (default seed) or synthetic TRN-117 (seed `synthetic`); the experts-disagree step (TRN-512) needs Elisa's TRN-042 and is not shown on a clone.
- **Value / cost ranks within one investigation only.** The selector compares the candidates of one investigation state. Investigation gaps come before standing gaps by flow (an investigation asks at once; standing questions skip anyone with an open question), and standing states keep a fixed kind order (outcome, pairing, missing symptom), not value / cost. The chance of a Yes to an outcome question is an uninformed 0.5. LinUCB is rewarded with the measured version of the same quantity but does not start from the rules order: its features leave out the value terms (D-B2-74). The ranking changed one pick on a developer fixture that the simulated stream also shows: on RTR-203 the outcome question ("Did the problem clear right after the earlier step on RTR-117?") is now asked before the software-version question (D-B2-67).
- **Models on Elisa's material: one run each, not scored.** The three local done-lines were run once against the live Ollama (§5). On Elisa's store bge-m3 ties rules for TRN-042, qwen3:4b fits the budget on the 12-message thread (the E09 families do not), and the phrase model echoed the template. No answer key, no replay fixture, and the outputs stay outside the repository, so these are observations, not experiment numbers (D-B2-70..73).
- **Platform and trust.** macOS only; no authentication (callers assert identity, loopback only); live Slack is sandbox-only behind `KT_SLACK_LIVE=1` and no live run against a real workspace is recorded in the repository. With every slot on rules the service guard also blocks Ollama detection on Settings → Models until a slot is set to local (D-INT-20).

## 7. How to run, and where each document lives

```bash
pnpm install        # needs the network once (packages and Electron's binary); later installs work with --offline
pnpm demo:reset     # re-import everything: Elisa files if present, synthetic families, follow-ups
pnpm demo:judge     # service on 127.0.0.1:47831, Lumi, activity page, simulated day after 240 s; KT_NO_API=1
pnpm demo:agent     # in a second terminal: the 03:00 MCP sequence (quiet hours on)
```

Also `pnpm test`, `pnpm typecheck`, `node experiments/run.ts e08|e09|e10` (replays hash-locked model outputs, offline; E10 reproduces its lock.json hash), `pnpm demo:slack` (synthetic Slack export and the private-channel gate).

| Document | What it is |
| --- | --- |
| [DEMO.md](DEMO.md) | The judge walkthrough, extras (Remember this, experts disagree, points, Slack), troubleshooting |
| [slides/SLIDES.md](slides/SLIDES.md), [slides/index.html](slides/index.html) | The 12-slide deck, text and one-file HTML |
| [BUILD_BRIEF.md](BUILD_BRIEF.md), [DAY2_PLAN.md](DAY2_PLAN.md) | What was built on day 2 and why; the rubric scorecard |
| [experiments/RESULTS.md](../experiments/RESULTS.md), [E08-E10.md](runs/2026-11-07-overnight/day2/E08-E10.md) | Every number with its denominator |
| [REPORT.md](runs/2026-11-07-overnight/REPORT.md) | The overnight run: what works, experiments E00–E07, limits |
| [day2/DECISIONS-*.md](runs/2026-11-07-overnight/day2/) | Every day-2 decision (engine, models, view, capture, disagree, inquiry, integration, package) |
| [src/apps/service/README.md](../src/apps/service/README.md) | HTTP routes and MCP launch flags |
