# Overnight run report — Knowledge Twin, 7 November 2026

**For Artem.** What works, how to launch it, which experiments actually ran, what changed because of them, what is still missing, and how well the result scores against our own metrics and the Elisa challenge. Companion documents: [DECISIONS.md](DECISIONS.md) (every assumption and default, R01–R26), [OPEN_QUESTIONS.md](OPEN_QUESTIONS.md) (U01–U23), [EXPERIMENT_PLAN.md](EXPERIMENT_PLAN.md) (frozen criteria), [experiments/RESULTS.md](../../../experiments/RESULTS.md) (all numbers with denominators), worker and reviewer reports under `worker-reports/`, screenshots under `screenshots/`.

## 1. What works (verified tonight, on this Mac)

**Launch.** `pnpm demo:reset` then `pnpm desktop`. The service starts as a child process on 127.0.0.1:47831 with a SQLite file, and Snowbally appears bottom-right, drops in once (the v006 "Drop & settle" act, frames captured in `screenshots/entrance/`), then idles with the three-pose loop. Nothing else opens. Click him to open the panel. Verified from a fresh process: service healthy, Electron running, total CPU below 1% after launch; idle CPU of the collapsed companion 0.18%; open/close transitions never exceeded 10.4 ms per frame on this 120 Hz display; zero console errors across 41 mock-mode states, 18 real-service states and the reduced-motion pass; avatar hitbox identical in every state.

**The complete product path, through one shared service and persistent local state:**

1. **Import** of the supplied Teams JSON and e-mail (from `private/`, never copied into the repo), Slack-export fixtures and synthetic scenario directories into one evidence format: stable ids, revisions, authors, original text, thread position, unknown dates preserved as unknown (the Elisa times are "09:14 (date unknown)"), access scope, lineage. Re-import is idempotent (checked on every family: identical counts, duplicates reported). The e-mail is detected as a retelling of the Teams thread and does not become a second case or a second confirmation.
2. **Memory.** The TRN-042 thread becomes one case with conditions (interface up, optics normal, counters zero, older unit, SFP replaced), hypotheses (forwarding state), advice, two attempts (counter check, interface reset: advised by Erkki, performed by Veikko as reported), a reported recovery whose timing, cause and lasting effect stay unconfirmed, and person–work links (Veikko reported/performed/reported outcome firsthand, Erkki advised). A site-access fact from a mail becomes an access-fact claim with no case. Corrections retract claims and rebuild the case.
3. **Separation of one incident, a pattern and a current query.** A similar incident on another asset stays a separate case; a recurrence on the same asset after an outcome starts a new episode and marks the earlier recovery as recurred; candidates link through matching/conflicting/missing conditions, not a permanent "same solution" cluster.
4. **Investigation.** The Elisa-like problem on another older unit returns: "Check the traffic counters before replacing the SFP again." with the basis case TRN-042 shown as the red/yellow/green timeline, the caveat "Reported once; cause and lasting effect not verified", and the next step phrased as a check before the corrective action. A lookalike that conflicts ("newer unit installed last year") returns "Don't reuse the fix from TRN-042: older unit there, newer unit here" and retains uncertainty.
5. **Questions.** When the deciding fact is unknown ("not sure which unit generation this is"), one quick question is generated ("Is TRN-301 an older unit?"), paired with a person who has a question-specific reason (Erkki as network expert), checked against access, budget, cooldown, duplicates and self, and delivered. Answering No lowers applicability and the recommendation reverts to retaining uncertainty; Yes makes it applicable; Not sure records no fact and leaves the gap open; Later/Dismiss have receipts and Undo; a requester-supplied observation resolves the gap and cancels the queued question. Budgets: 3 per person per day, 30 minutes cooldown, 1 open question per person, 3 per investigation (run defaults).
6. **People with relevant experience** with reasons and case links ("Advised the interface reset in TRN-042"; "Performed the interface reset and reported recovery in TRN-042"; mentioned-only people flagged, unavailable people marked not askable). "Prepare message" produces a reviewable draft with the current symptoms, checks performed and the open question; nothing is sent, anywhere.
7. **API/MCP.** 25 HTTP routes and 8 MCP tools (`kt_investigate`, `kt_get_context`, `kt_request_clarification`, `kt_clarification_status`, `kt_cancel_clarification`, `kt_record_observation`, `kt_record_outcome`, `kt_find_people`) over the same engine, with stable decision/trace ids, identical permissions and question limits for human and agent callers (tested over HTTP and over a real stdio MCP child).
8. **Desktop ↔ service.** Every UI action is a service event: send → `POST /investigate` (idempotent id), answer/defer/dismiss/undo/cancel, observations, outcomes, settings, demo reset, directory-backed identity ("You" in Settings). Points are off by default, deduplicated per contribution, credited equally for a useful No, never read by evidence or selection.

**Tests:** 233 application tests + 77 benchmark/experiment tests pass; typecheck clean. All of it is on branch `run/2026-11-07-overnight` in small commits; `main` is untouched; nothing was pushed.

## 2. How to launch

```bash
pnpm install
```
```bash
pnpm demo:reset
```
```bash
pnpm desktop
```

Also: `pnpm service` (service alone), `pnpm mcp` (MCP stdio server; client config `{"command":"node","args":["src/apps/service/mcp.ts"]}`), `pnpm test`, `node experiments/run.ts all`, `node scripts/screenshot.mjs` (mock walkthrough), `node scripts/real-check.mjs` (real-service walkthrough). Suggested demo script: Settings → You = Veikko → paste the TRN-088 text → result, people, contact draft → paste the TRN-301 text → "Asked a colleague" → Settings → You = Erkki → Questions badge → answer → back to Veikko → re-send the TRN-301 text to see the updated recommendation.

## 3. Experiments that actually ran

All on synthetic scenario families (10 families, 30 incoming problems; 2 demo / 4 train / 2 validation / 2 test, split by family; test hash-locked). People are simulated by an oracle reading a hidden answer key authored by one Claude agent and audited once by an Opus agent. Routes: `rules` and `local` only; no model API was called by anything; a network guard throws if one is attempted. Every run has a manifest written before scoring and results with denominators.

| ID | What ran | Outcome against the frozen rule | What changed because of it |
| --- | --- | --- | --- |
| E00 | Rules baseline end to end, 3 times (provisional → after fixes → final) | 17/17 checks pass in the final run. The first run **failed** the access check: private-channel evidence reached non-members through the recommendation basis and people reasons. | The leak was fixed with a per-evidence access gate in investigation, recipients, eligibility and views; extraction was tuned on train families. Claim recall train 0.213→0.681, validation 0.182→0.636; outcome recall train 2/9→9/9; false merges train 2/5→0/7; investigations ending with no recommendation 21/24→6/24. |
| E01 | Rules extractor vs a **recorded Claude Sonnet subagent arm** on visible train/validation sources (route `claude-agent-arm`, not the small GPT, not an application route) | Before tuning the arm was ahead (recall 0.532/0.591 vs 0.213/0.182); after tuning rules lead on recall (0.681/0.636) and precision on train. 11 truth claims found by the arm and missed by rules are listed as lexicon gaps. | Rules stay the default (as frozen). The gap list is the next tuning input. |
| E02 | Lexical BM25 / exact id / hashed trigram "local" vectors / hybrid RRF | Tie on validation (recall@3 7/9 each; lookalike top-1 1/2 each); confirmed once on test. | Hybrid kept as configured default; lexical available. Not a measured improvement. |
| E03 | Rules / epsilon-greedy / LinUCB (3 seeds): simulator and family arm | Simulator: LinUCB 0.442 vs rules 0.336 mean benefit, +0.08…+0.14 on every seed, 0 ineligible selections. Family arm: no selector asked a single validation question, so the shipping criterion is **untestable**. | Rules stay. LinUCB artifacts saved under `data/models/`; `selectorId: linucb` is available behind the setting. U01 stays open. |
| E04 | Combined vs separate support/applicability assessor | Separate: eligible coverage 4/5 with false advice 1/5; combined: 0/5 coverage. Neither dominates. | Separate kept (keeps the targets identifiable). |
| E05 / E06 / E07 | Pool size 1/2/4; direct-only vs question-dependent eligibility; budgets 1/3/5 × cooldown 0/30 | 0–2 gap-relevant questions in the families: ties by construction; E07 frontier flat. | Defaults kept (pool 1, question-dependent, 3/day and 30 min). |
| Usefulness classifier | Hashed logistic regression trained on train families (local, pure TypeScript) | Validation accuracy 26/32 vs majority 25/32: predicts almost everything useful. | Saved as an artifact; **not** wired into the app. |
| E08 / E09 / E10 | Not run | No torch installed; no multi-step simulator validated; no preference stream. | — |

**What the results do not show.** No real engineer benefit (U04): people are simulated. Denominators are tiny (one validation problem moves a rate by 0.17). Validation was touched once by extractor tuning (two words, removed; see R23). The test split was opened once, before tuning. Recommendation **kind** accuracy stayed at or below the majority-class baseline on every split (train 3/12 vs 6/12 majority) even after extraction improved: the assessor/applicability rules, not extraction, are now the binding constraint. Questions asked fell to 2/24 across the families; the question loop is exercised and verified on the demo data and in tests, but the synthetic families rarely trigger it, so E03/E05/E06 are uninformative.

## 4. How well it works against our metrics

Scores are from the final E00 run (`experiments/RESULTS.md`), on synthetic data; "demo / train / validation".

| Metric family (handoff §6) | Measured | Reading |
| --- | --- | --- |
| Knowledge accuracy | claim recall 0.48 / 0.68 / 0.64; precision 0.41 / 0.55 / 0.41; false merges 1/3, 0/7, 1/4; false splits 0; attempt performer errors 0 on train and validation | Good for a rules extractor built in one night; precision is the weak side (hypothesis fragments). Copies are never counted as independent. |
| Resolution accuracy | false "solved" 0/2, 0/4, 0/3; outcome recall 2/4, 9/9, 3/4; case status accuracy 7/7 train, 4/4 validation | The system never calls a reported recovery verified; lasting needs a separate later report. |
| Recommendation quality and coverage | kind accuracy 1/6, 3/12, 3/6 (majority 3/6, 6/12, 4/6); false advice 0, 3/9, 1/5; eligible coverage 1/5, 6/9, 4/5 | Coverage improved a lot; kind choice is still weak and false advice on train rose with coverage. This is the next thing to work on. |
| Question value and burden | questions per investigation 0, 2/12, 0; wrong recipient rests on 1 question; hard-rule violations 0 everywhere | Rules (budgets, cooldowns, access, duplicates, self) never violated. Value cannot be estimated from these counts. |
| Calibration | not scored | No probabilistic targets were defined (U06); nothing is presented as a probability. |
| Efficiency | mean latency per investigation 0.9–6 ms; whole experiment queue under 3 s on this Mac; no tokens, no API calls | Trivially cheap; the app feels instant. |
| Hard constraints | access leak found by E00 and closed; one residual that is not system-detectable (e-mail without ACL, R25); duplicate delivery 0; budget violations 0 | Gates hold outside the learned selector. |

**Design and experience metrics (D17, experience brief).** Same workflow verified only on macOS (Windows not built: no environment). Idle CPU 0.18%, transitions under 10.4 ms per frame, reduced motion settles instantly with a static pose, keyboard: Escape closes, Cmd/Ctrl+Enter sends, focus returns to the question after Back/Undo; 320 px and 420 px both pass with no overflow; touch targets 44 px in coarse-pointer mode. The avatar artwork is byte-for-byte the v006 pixel kit (draw-call-identical port), scaled by an integer for Retina, never resampled.

## 5. How well it solves the Elisa challenge

The challenge: capture silent, human-generated contextual metadata (expert knowledge living in chats and e-mails) without extra work for specialists, link it to entities and time, and make it usable by people and autonomous agents. Primary criterion: usability with minimal specialist effort; then relevance, entity/time linking, feasibility, agent suitability.

- **Minimal specialist effort.** The specialists did nothing: the Teams thread and the e-mail were imported as they are. The only ask is one Yes/No question when a decision actually depends on it, within a per-person budget, with Not sure / Later / Dismiss and Undo, and nothing is asked when the asker could check it themselves. The companion is a small window that stays out of the way until clicked. **Strong on the demo; unmeasured with real people.**
- **Relevance.** On the Elisa example and the demo families the right case comes back with the right next step and the right caveats, and the lookalike with a conflicting condition is rejected. On the synthetic families, recommendation kind accuracy is still at the majority-class level: the retrieval is good (recall@3 0.78–1.0), the decision rules after retrieval are not yet. **Partial.**
- **Entity and time linking.** Every claim is bound to entities (assets, people, sites) with evidence spans; times are kept as given, including "time only, date unknown"; validity windows and revisions exist; a later report changes "reported recovered" to "recurred". The locked-barrier type of fact (site access) is captured outside any fault case. **Strong, with a known gap: identity is by display name within a provider.**
- **Feasibility.** One TypeScript codebase, one local process, SQLite, no cloud, no model calls, 310 passing tests, all deterministic; the whole experiment queue runs in seconds. Replacing a rules stage with a model is a provider interface away. **Strong.**
- **Agent suitability.** The same engine is an MCP server with investigate / context / clarification / observation / outcome tools, stable ids and the same limits as humans; an agent cannot see restricted evidence or bypass question budgets (tested). Exposure is logged separately from adoption. **Strong at the interface level; no real agent used it yet.**

Honest overall: the prototype demonstrates the whole loop on the organizer's example and on synthetic data, with evidence-backed, qualified answers and a pleasant, fast companion. It does not yet show that its recommendations are right more often than a trivial baseline on unseen synthetic incidents, and it shows nothing about real engineers.

## 6. Limitations that remain

- Slack: **fixture-tested, awaiting authorization**. Export and live-payload mapping are tested on fixtures; no workspace was read, no app installed.
- No authentication: callers assert their identity; loopback only. `GET /investigations/:id` and `GET /questions/:id` accept an optional principal (reviewer finding, left as a contract-level follow-up).
- Extraction is lexical rules; paraphrases outside the cue lexicons are missed; hypothesis precision is low; person identity is by normalized display name.
- Windows not built or tested; tray icon verified in code, not in the real menu bar; click-through uses forwarded mouse moves (macOS behavior).
- No sounds; points are a separate record with a switch and a subtle burst only.
- Synthetic evaluation data authored by one agent, audited once; no human review; tiny denominators.
- E08/E09/E10 not run; U01–U23 open (see register).

## 7. Where the review artifacts are

- `docs/runs/2026-11-07-overnight/`: this report, DECISIONS.md, PLAN.md, INPUT_MANIFEST.md, EXPERIMENT_PLAN.md, OPEN_QUESTIONS.md, `worker-reports/` (every worker, reviewer and fix pass), `contract-requests/`, `screenshots/` (mock, `real/`, `entrance/`).
- `experiments/RESULTS.md` and `experiments/results/<id>/{manifest.json,results.json}` (+ archives of the provisional runs); `data/models/` artifacts; `data/replays/e01-claude-arm/`.
- `data/scenarios/` (families; `REVIEW.md` is hidden-side), `benchmarks/` (evaluator, oracle, splits).
- Module READMEs under `src/libs/utils/*/`, `src/apps/*/`.

## 8. Next useful steps

1. Improve recommendation kind selection (assessor/applicability rules) using the E00 failure examples; this is now the binding constraint.
2. Feed the E01 lexicon-gap list into the extractor; add a second, human-reviewed pass over the scenario keys.
3. A real Slack scope with explicit authorization, then one small trial with the two question modes (rewards on/off) and real answer-time measurements.
4. Require a principal on every read route; add real authentication before anything leaves localhost.
