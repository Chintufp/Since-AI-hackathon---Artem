# Build brief — Day 2 build for the agents

**For the agents Artem assigns · written Saturday 7 November 2026, afternoon EET · deadline Sunday 8 November 10:00 EET**

Read first: `docs/DAY2_PLAN.md` (the moves and why), `docs/HOW_QUESTIONS_WORK.md` (how the engine decides today), `docs/DEMO.md` (the 3-minute judge script). This brief adds what changed since the plan was written and the model layer Artem decided on. Where this brief and the plan differ, this brief wins.

State on the run branch `run/2026-11-07-overnight` as of this brief (7 Nov, late afternoon): the demo-mode branch is merged (`pnpm demo:judge`, `demo:play`, `demo:agent`, `demo:slack`; its decisions renumbered R37–R42); the UX pass is done (R31–R36, harness budgets met); the companion is now called **Lumi** in every user-facing string (R43; code identifiers keep the old names); a crosses texture band is on trial (R44, `KT_TEXTURE=0` removes it); idle moves are on by default (R45, `KT_FIDGETS=0`). A second worktree `claude/points-system-cd8e53` (`.claude/worktrees/points-system-cd8e53`) holds R46: per-person opt-in points, awards for answers, corrections, evidence and outcome reports, own balance only, a rating route and the `kt_participation` MCP tool, with tests; it is **not merged** and is merged in B6. Nothing is pushed; `main` is untouched. Elisa's files live only in git-ignored `private/` and are never committed. The research folder (`/Users/artevil/School/Since AI Hackathon Research/output`) holds the original workstreams W01–W10 and the orchestrator prompt; both are already copied into `docs/` and superseded by this brief where they differ.

## 0. The build list at a glance (for Artem's approval)

| # | Item | Hours | Depends on | Drop rank |
| --- | --- | --- | --- | --- |
| B1 | Engine: validity and supersession, point-in-time `at`, access facts, quiet hours, orphan pieces seek their partner | 6–8 | – | never |
| B2 | Models: three slots × three providers, detection and catalog, `r_embedding`, case cards, bandit reward from the store metric, E08–E10 | 7–9 | – | api provider and fine-tune first |
| B3 | View: Context Layer page with the `t = x` slider, provenance strip, Erkki's cost, store health numbers | 5–6 | B1 (`at`), B2 (provenance) | never (page) |
| B4 | Capture: "Remember this" paste and drop; Slack sandbox poller and DM answers | 3 + 5 | – | Slack after api |
| B5 | Experts disagree scenario | 3 | B1 | before Slack |
| B7 | Agent-driven inquiry: an agent lists gaps, asks through the engine for the person best placed, raises or lowers confidence, under the same gates as a person | 4–5 | B1 | after B5 |
| B6 | Package: merge points branch, SUBMISSION.md, slides, demo flags, clean-clone test; Artem pushes and records | 5 | all | never |

Integration order: B1 and B2 first, then B3, B4, B5, B7, B6. Drop in this order if time runs out: fine-tuning, `api` provider, Slack, B5, B7's batch mode, burden meter, quiet hours.

## 1. Standing rules for every agent

1. Work in your own worktree off `run/2026-11-07-overnight`. Small commits with plain messages, no attribution lines. Decisions go to `docs/runs/2026-11-07-overnight/day2/DECISIONS-<area>.md` (your area only); they are folded into the main DECISIONS at integration.
2. `pnpm typecheck` clean and `pnpm test` green before every commit. New behaviour gets a test. Experiments that produce a number for the slides go through the existing harness in `experiments/` and are hash-locked like E00–E07.
3. Everything must run with the network off. Only the `api` provider (section 2) and the Slack sandbox (section 4, B4) may touch the network, and only when Artem has switched them on.
4. Nothing is ever merged silently into memory. A model proposes; `commitProposal` commits; every stored object says which route produced it.
5. Never commit anything under `private/`. Never push. Artem pushes.

## 2. The model layer: three slots, three providers

Today the engine is rules and local arithmetic only, and it stays the default. The build adds a model layer with **three slots**, each of which can be served by one of **three providers**. The slot decides *what* a model is allowed to do; the provider decides *who* runs it.

### 2.1 Slots

| Slot | What it does | Input → output | Where it plugs in | Rules fallback (already exists) |
| --- | --- | --- | --- | --- |
| `embed` | Turns text into a vector so retrieval finds cases by meaning, not spelling | text → `number[]` | `retrieval/hybrid.ts` next to BM25 and exact-id, same reciprocal-rank fusion | `retrieval/vector.ts` hashed trigrams |
| `extract` | "Fills the form": reads a thread and proposes claims, entities, links, incidents in the existing contract | `ConversationContext` → `ExtractionProposal` (`contracts/models.ts`) | implements `Extractor`; committed through `memory/commit.ts` `commitProposal` | `memory/extractor-rules.ts` (`rules-extractor@1`) |
| `phrase` | Words the one question a gap asks, in natural language, for the chosen recipient | gap + visible case facts + asset → question text, rationale, yes/no consequences | wraps `questions/generator-templates.ts`; the gap, the recipient and all gates stay as they are | the templates themselves |

The slots are deliberately narrow. The model never decides which cases are the same (the condition comparison does), never decides support or applicability (the assessor does), never picks who is asked (recipients and gates do), and never writes to memory directly.

### 2.2 Providers

| Provider | Runs where | Cost | When active |
| --- | --- | --- | --- |
| `rules` | in process | none | always available; the default for every slot |
| `local` | Ollama on this Mac (`http://127.0.0.1:11434`) | RAM while loaded, download once | only when chosen in Settings; warmed at app start, unloaded when idle |
| `api` | a hosted model over HTTPS | per call | only when chosen in Settings and a key is present; never in tests or `demo:judge` |

Model choices per slot:

| Slot | `local` (Ollama, download once) | `api` |
| --- | --- | --- |
| `embed` | **`bge-m3`** (1024 dims, ~1.2 GB; multilingual, so Finnish fragments embed well). Light alternative `nomic-embed-text` (768 dims, 274 MB) | Voyage `voyage-3.5` or Gemini `text-embedding-004`; or none, keep local |
| `extract` | **`qwen3:4b`** (~2.5 GB) with Ollama's JSON-schema `format` so the output *is* an `ExtractionProposal`; `qwen3:1.7b` if 4b is too slow on the venue Mac | `claude-haiku-5-5` with the same schema as a tool definition |
| `phrase` | **`qwen3:8b`** (already installed, 5.2 GB) | `claude-sonnet-5-5` or Gemini 2.5 Flash-Lite |

Fine-tuning the small `extract` model: possible with `mlx-lm` LoRA on the scenario families in `data/scenarios/` plus the replay proposals in `data/replays/e01-claude-arm/` (the training pairs already exist: thread in, proposal out). It is a **stretch item**, done only after everything in section 4 is green, because a model that overfits twelve synthetic families is worse on stage than a schema-constrained base model with four few-shot examples. First ship schema-constrained prompting; measure it with E08 (below); fine-tune only if the number is weak and time remains.

### 2.3 Lifecycle: nothing runs unless chosen

- **Detect first, then offer.** On opening Settings → Models the service probes the machine: is Ollama installed (`which ollama`, or a GET on `127.0.0.1:11434/api/version`), is it running, which models are already pulled (`/api/tags`), free disk, total RAM. Each catalog entry then shows one of: `installed · ready`, `not downloaded · 1.2 GB · Download`, `Ollama not installed · Install`, `too large for this Mac`. Nothing is pulled without a click.
- **Catalog, several per slot** (`data/models/catalog.json`, editable): `embed`: `bge-m3`, `nomic-embed-text`, `mxbai-embed-large`; `extract`: `qwen3:4b`, `qwen3:1.7b`, `qwen3:8b`, `llama3.2:3b`; `phrase`: `qwen3:8b`, `qwen3:14b`, `gemma3:4b`. Each entry carries size, dims or context, a one-line "why" and the minimum RAM; the recommended one is marked. Any model already in `ollama list` appears too, so Artem's `qwen3:14b` and `qwen3.8:27b` are selectable without a download.
- **Setting the user up.** If Ollama is missing, the panel offers to install it (macOS: `brew install ollama` run with a visible log, or the download link if Homebrew is absent) and starts it; if the user prefers to do it themselves, the panel shows the three commands to copy. API providers get the same treatment: a key field, a "Test" button that makes one tiny call and reports the model it reached, and a link to where the key is created.
- **Settings → Models**: one row per slot with a three-way choice (`rules` / `local` / `api`), the model name, a status chip (`off · not downloaded · downloading 43% · ready · failed`), a **Download** button (`ollama pull`, progress streamed), and for `api` a key field stored in the OS keychain (Electron `safeStorage`), never in the repo or in `data/`.
- **At app start**: for every slot set to `local`, the service checks Ollama is up (spawn `ollama serve` if not), then sends one empty request with `keep_alive: '30m'` so the first real call is instant. Slots set to `rules` or `api` start nothing; no process, no RAM.
- **Idle**: after 30 minutes without a call the service sends `keep_alive: 0` to unload; the next call reloads (a few seconds). On quit, unload everything the app loaded.
- **Failure**: any provider error or timeout (embed 5 s, extract 60 s, phrase 20 s) falls back to `rules` for that call and the result is labelled with the fallback route; the status chip turns `failed` with the reason. The demo never stalls on a model.
- **Routes**: add `'api'` to `Route` in `contracts/common.ts`; register `ollama-embed`, `ollama-extract`, `ollama-phrase`, `api-extract`, `api-phrase` in `models/routes.ts` with `learned: false`. The network guard stays installed in tests and experiments; the service only lifts it for the `api` provider when configured.
- **Honesty on screen**: a node produced with a model says so in its details (`proposed by local model qwen3:4b, committed by rules`), and the question card shows `worded by local model` when the phrase slot is on.

### 2.4 What each slot must obey

- `embed`: deterministic for a given model and text; cached by `(model, sha256(text))`; cosine is shown as "similar", never as confidence.
- `extract`: output validated with zod against `ExtractionProposal`; every claim, entity and link must carry at least one `EvidenceRef` whose `excerpt` is a substring of the cited evidence text, or it is dropped (the model cannot invent evidence); `confidence` is informational; the rules extractor runs too and the commit keeps the union, with provenance per claim. Run on import and on "Remember this".
- `phrase`: input is the gap, the visible case facts and the asset; output must be one yes/no-answerable sentence under 160 characters that names the asset and the condition label, introduces no entity, number or action absent from the input, and keeps `consequences.yes/no` from the template. A validator checks all of this; on failure the template text is used.

## 3. Storage with embeddings and the reconstruction chain

### 3.1 New table

`r_embedding` beside the existing `r_*` tables in `data/local/knowledge-twin.sqlite`:

```
r_embedding { id, kind: 'evidence'|'claim'|'case', refId, model, dims, textHash, vector (float32 blob), created_seq }
```

Index on `(kind, model)`. Search is a brute-force cosine over the org's rows (thousands, milliseconds); no vector extension needed. Rows are rebuilt on `demo:reset` and on case rebuild, skipped when `textHash` is unchanged.

### 3.2 Three granularities

1. **Evidence**: one row per message or mail, verbatim text. Finds a thread from one sentence ("green light but nothing flowing").
2. **Claim**: one row per claim statement. Finds Erkki's advice on its own.
3. **Case card**: one row per case, from a generated paragraph built out of the structured rows, not the chat: asset and its attributes, symptom conditions, attempts in order with who advised and who performed, outcome and whether it lasted, and the hedged class if any. Example: *"TRN-042, older transmission unit (≤2019 per Erkki, hedged). SFP replaced, interface up, optical normal, counters zero, no traffic. Erkki advised an interface reset; Veikko performed it; traffic returned; lasting unknown."* This is the problem embedding: the reconstructed situation. Regenerated whenever the case changes (new outcome, answered question, supersession).

### 3.3 Query

The problem text is embedded once. Nearest case cards, plus nearest evidence and claims aggregated to their case, enter the existing reciprocal-rank fusion with BM25 and exact asset-id match. Everything after retrieval is unchanged: matching, conflicting and missing conditions, support, applicability, recommendation, gaps, one question.

### 3.4 Where confidence lives

Not in one number. Three things the store already keeps, each with evidence refs:

- **Applicability**: conditions matched vs. conflicting vs. unknown, with distinguishing keys deciding (`investigation/assessor.ts`).
- **Support**: a corrective attempt with a reported or verified recovery, lasting or recurred (`investigation/case-facts.ts`).
- **Claim status**: provisional, supported by independent messages, contradicted, retracted, and after Move 1, superseded with a validity window.

The UI reads these as the provenance strip under every headline: `Erkki Expert · Teams 09:22 (date unknown) · reported once · still believed true`.

### 3.5 Reconstruction

The chain of events is the data model, not a summary: evidence rows in thread order → claims cut from them with spans → attempts linking an advice claim to the action that followed and to its outcome row → person-work links (who reported, advised, performed, observed) → gaps with "what an answer would change" → answers stored as new attributed evidence on the investigation → validity windows and supersession (Move 1) so the same chain can be replayed at any `t`. The Context Layer page (section 4, B3) draws exactly this.

## 4. What to build for the demo, in order

Each item names its area, what done looks like, and the files it touches. Items with different letters can run in parallel in separate worktrees; items under one letter are one session.

### B1 · Engine: time, access, quiet hours (Move 1 + Move 3 engine half)

- `Claim.validity.to`, `supersededBy`, status `superseded`; memory rules close an older claim when a newer one of the same type, subject, condition key and different value arrives; explicit cues ("fixed in firmware 4.2", "no longer", "new code since", "changed the lock", "every October", "until 1 December") set `to` or `condition`.
- `at?: Iso` on `POST /investigate`, `kt_investigate`, `kt_get_context`; only claims valid at `at` feed hypotheses; a superseded basis yields the caveat "Superseded on 14 Oct by Erkki Expert: fixed in firmware 4.2" and drops to `qualified`/`none`.
- `GET /context?entity=…&at=…`: the assertions bound to an entity valid at `at`, with source, person, time, status.
- Access facts retrievable: the parser recognises dispatch/site/access intent; the investigation returns access-fact claims valid at `at` as a `reuse` recommendation of action class `none`, and names who to ask when missing (never Pirkko).
- `quietHours` in org-config (22:00–07:00): questions created inside are `queued`, delivered at the next window; the demo clock makes 03:00 real.
- Generated follow-up data in `data/demo/followups/` with a README (Erkki 14 Oct firmware note; Eino 6 Oct new barrier code 7731) and the two problems that use them.
- **Orphan pieces seek their partner (capture-time gaps).** Today gaps exist only inside an investigation. Add a pass at commit time that records standing gaps on the case itself, each with the question it would take: (a) a corrective attempt with no symptom in the thread → `missing-symptom` gap, free-text question to the performer, lowest priority, Later pile only; (b) a problem thread with advice and no outcome after 24 h → the existing `outcome` gap raised at capture time, yes/no to the person who was to perform it; (c) a candidate pairing between an open problem and an orphan fix on the same asset within a window, ranked by time proximity and embedding similarity → `pairing` gap, yes/no to the performer ("Was the port bounce on TRN-061 for the no-traffic alarm this morning?"); Yes links the two with the answer as evidence, No records them as distinct, nothing is ever linked without an answer. Standing gaps go through the same recipients, budgets and quiet hours; an active investigation's questions always outrank them. Tests: one per kind, plus one showing a declined pairing stays unlinked.
- Done: tests for supersession, before/after answers, access-fact retrieval, quiet-hour queueing, standing gaps; E00 still passes.

### B2 · Models: slots, providers, embeddings, numbers (section 2 and 3)

- `models/providers/` with `ollama.ts` (embed, generate with JSON schema, pull with progress, warm, unload) and `api.ts` (Anthropic and Gemini, same interface), a `ModelSlots` config in org-config with `rules` defaults, and the lifecycle of 2.3 in the service.
- `retrieval/embedding-index.ts` and `r_embedding` (3.1–3.3); the case-card generator in `memory/case-card.ts`.
- `memory/extractor-llm.ts` implementing `Extractor` through a provider with schema output and the evidence-substring validator (2.4).
- `questions/generator-phrased.ts` wrapping the template generator with the phrase validator.
- Settings → Models UI in the desktop panel (2.3), with the status chip.
- Reward for the bandit from section 5.4 (measured delta of completeness and correctness), written by the service after each answer; live `selector.update` wired; E10 as in 5.4.
- **E08** retrieval: `bge-m3` vs. trigram vs. BM25 vs. fusion on the existing hash-locked split, recall@3 and the lookalike-rejection rate. **E09** extraction: `qwen3:4b` schema-constrained vs. rules on the E01 families, same metrics as E01. Both numbers go on the honest-numbers slide with denominators.
- Done: with every slot on `rules` nothing new runs and all tests pass unchanged; with `embed=local` the paraphrased judge problem ("green light, nothing flowing") finds TRN-042; with `extract=local` the Elisa thread imports with the model's proposal labelled and the rules union intact; with `phrase=local` the question to Erkki reads naturally and the validator rejects a planted hallucination in a test.

### B3 · View: the Context Layer page, provenance strip, burden meter (Move 2 + Move 6)

- `/context.html?entity=TRN-042` served by the service, plain SVG in the panel's palette, rows exactly as Elisa's reference architecture: as-observed (evidence diamonds on a time axis), as-experienced (claims as bars from `valid_from` to `valid_to`, open bars fading right with "still believed true", superseded bars greyed with an arrow), bindings (entity chips, firsthand vs. hedged), people. A draggable `t = x` line; the card on the right shows what an agent is told at `t` from `POST /investigate` with `at`. Clicking a bar shows the sentence it came from. Linked from the case view.
- Provenance strip under every result heading.
- "Erkki's cost" in Settings and on the activity page: asked, answered, seconds spent, reuse count by people and agents, from service events.
- Done: the page renders both stories (TRN-042 and RBS-310) from real data with the slider; screenshots in `docs/runs/2026-11-07-overnight/day2/screenshots/`.

### B4 · Capture in front of the judge (Move 4)

- D1 "Remember this": paste a Teams thread or an e-mail, or drop `.txt`/`.eml`/`.json` on the card or on Lumi; `POST /import` with the paste adapter; receipt line and a hop.
- D2 Slack sandbox: Artem creates the workspace and app and names them in chat; scopes `channels:history`, `channels:read`, `groups:history`, `groups:read`, `users:read`, `chat:write`, `reactions:read`. A poller feeds the existing live connector so a thread typed in Slack is captured within seconds; the one question goes to the expert as a DM answered with 👍 / 👎 / 🤷 reactions; the answer lands as attributed evidence exactly like a tap in the panel. Guarded by `KT_SLACK_LIVE=1` and `KT_SLACK_TOKEN`; D1 and Lumi remain the offline fallback.
- Done: a judge pastes the Elisa thread and sees a case with no form; a message typed in the sandbox channel becomes a case and Erkki's 👍 in Slack changes Veikko's next step.

### B5 · Experts disagree (Move 5)

- One generated Teams thread (Helmi on the 2021 batch, clear the forwarding table), a problem on a unit of unknown batch, two qualified hypotheses each with its expert, one question "Is TRN-5xx from the 2021 batch?", the answer picks the branch, neither expert overwritten. One test.

### B7 · Agent-driven inquiry: gain or lose confidence through the right people

What exists: `kt_investigate` (no human asked by default), `kt_find_people` (who has experience, with reasons), `kt_request_clarification` (the engine picks at most one question for one person), `kt_clarification_status`, `kt_cancel_clarification`, `kt_record_observation`, `kt_record_outcome`. An answer already moves applicability (Yes → applicable, No → inapplicable) and support, so an agent can already gain or lose confidence, but only one gap at a time and never choosing which.

Build:

- `kt_list_gaps(investigationId)`: every open gap with `whatAnswerChanges`, whether it decides applicability, who could answer (from recipients, with firsthand flag and whether they can be asked now), and a `confidence` block: current support and applicability and which gap would move each.
- `kt_request_clarification` gains optional `gapId` and `preferPersonEntityId`. The engine honours the preference only if that person is an eligible recipient for that gap; otherwise it answers `{status: 'refused', reason}` and names who it would ask instead. Every gate stays: budget 3/day per person, one open, 3 per investigation, cooldown, access, quiet hours. The agent never gets a channel to a person; the question still travels through Lumi or the Slack DM.
- `kt_propose_question(investigationId, gapId, text)`: the agent's own wording, accepted only if it passes the phrase validator of section 2.4 (names the asset and the condition, yes/no answerable, introduces nothing absent from the gap and the visible case). Otherwise the template text is used and the agent is told so.
- Batch mode (drop first): `kt_request_clarification` with `gapIds[]` asks up to 3 gaps of one investigation, each to its own best person, respecting all per-person budgets; status is polled per question.
- `kt_store_health`: the completeness and correctness numbers of section 5 for the cases the calling principal may see, plus the count of singletons; so an agent can decide to fill the store on a quiet night by asking orphan-partner questions within budget.
- Confidence semantics in every response: `applicability` and `support` are labels with reasons and evidence refs; a cosine or a model confidence is never returned as a confidence.
- Tests: an agent asks for a person who is not a recipient and is refused; an agent's hallucinated wording is rejected and the template is used; three gaps go to three people without exceeding anyone's budget; a No answer lowers applicability to inapplicable and the next `kt_investigate` says so.
- Demo: in the 03:00 sequence the agent calls `kt_list_gaps`, chooses the gap that decides applicability, requests Erkki by preference, is queued by quiet hours, and at 07:30 Erkki's one tap changes the agent's next step.

### B6 · Package (Move 8)

- `docs/SUBMISSION.md`, one page: the script, Elisa's layers mapped to our modules, what is synthetic, the numbers with denominators, the model layer and what is on by default, the limits.
- Slides, 12 at most, in the order of DAY2_PLAN §4 Move 8; slide 11 carries E08/E09.
- Demo-mode flags: "Be Veikko / Be Erkki" chips in the panel footer; start Lumi in and leave after 120 s idle; simulated day on the second screen only, labelled.
- Merge `claude/points-system-cd8e53` (R46) into the run branch first; points stay off by default.
- Clean-clone test of `pnpm demo:judge` after integration; Artem pushes.
- The video is Artem's: the agent sequence (03:00 queued question, 07:30 one tap, agent continues) and the Context Layer slider are the two signature moments; record the companion and the screen.

### Integration and drop order

Integrate B1 and B2 first (B3 depends on B1's `at` and B2's provenance data), then B3, B4, B5, B7, B6. Drop in this order if time runs out: fine-tuning, `api` provider, D2, B5, burden meter, quiet hours. Never drop: B1, B3's page, B6, the video.

## 5. The official metric: how full and how correct the store is

Everything the question machinery does serves one number pair, measured from the store itself, never from a human label.

### 5.1 Completeness

Every case has six slots, each "filled" only when at least one evidence excerpt backs it:

| Slot | Filled when |
| --- | --- |
| symptom | ≥1 observation condition with evidence |
| distinguishing conditions | every key in `distinguishingKeys` (unit.age, unit.model, unit.revision, software.version) has a value or an explicit "not applicable" |
| attempt | ≥1 attempt with who performed it |
| outcome | ≥1 outcome row for the corrective attempt |
| lasting | the outcome's `lasting` is known |
| validity | the advice claim has a `from` and either a `to`, a condition, or a supersession check newer than 90 days |

`completeness(case) = filled slots / 6`. A **singleton** is a case with ≤2 slots filled; a **thin pair** is a case whose claims each rest on one message. The store-level number is the weighted mean over cases, weighted by how often each case was retrieved in the last 30 days (a case nobody asks about costs nothing to leave thin).

### 5.2 Correctness

`correctness(store) = (claims supported by ≥2 independent sources or by an observed outcome − contradicted claims still cited by a recommendation − links made without an answer) / all cited claims`. A wrong link counts negative; an absent link counts zero. That encodes "a wrong link is worse than none".

### 5.3 What a question is for

`value(question) = expected gain in completeness·correctness of the cases it touches, weighted by their retrieval frequency`, and `cost(question) = burden on the recipient (asked today, open questions, quiet hours)`. Questions are ranked by value / cost. Investigation gaps rank first because their cases are being retrieved right now; standing gaps (section 4, B1, orphan pieces) fill the remaining budget.

### 5.4 What the bandit optimises

The LinUCB reward for a question becomes the **measured delta** of the two scores after its answer arrives (and, for outcome questions, after the outcome lands), minus a burden term, computed by the service and written to the question record. This replaces the hand-labelled `assessedBenefit`, which is `null` in live use today, so the live coordinator can finally call `selector.update` and learn. The rules selector keeps the same formula as its fixed prior. E10 reports: completeness and correctness of the demo store before and after a simulated day, questions asked per point gained, and the bandit against the rules on the same store, hash-locked.

### 5.5 On screen

The activity page and the slides show the two numbers with their denominators: "Store: 14 cases · completeness 0.71 → 0.83 after 5 questions · correctness 0.92 · 2 singletons left". Erkki's cost sits beside them. That is the primary criterion as a number: knowledge got fuller and the expert spent 20 seconds.
