# Knowledge Twin — technical handoff for the overnight plan

**7 November 2026 · Prepared for Artem and the general orchestration chat**

## 1. Readiness and scope

**Ready to combine into a prototype build and experiment plan. Not a finished implementation or a finalized learning algorithm.** The core concepts and constraints are settled enough to build against explicit, replaceable contracts. Remaining research choices must stay visible as unanswered questions or experimental defaults.

Artem will ask another chat to combine this technical plan with connections, UI/UX, animation and the prototype build. This document authorizes no execution by itself. This chat has prepared documentation; it has not launched implementation agents, training, model inference or overnight experiments. The latest user request explicitly asks that the selector-horizon question and the other unanswered questions be saved, rather than silently resolved.

Repository state inspected for this handoff: technical documents, diagrams and browser-based design studies exist. The root README still describes the operational pipeline, trained policy, MCP service and packaged desktop application as unimplemented. No application package manifest was found in this repository during this inspection. Existing design studies are real artifacts; they are not evidence that the backend or packaged desktop product works. Recheck the current tree before starting because other chats are working here.

Read alongside:

- [Technical chat history](TECHNICAL_DISCUSSION_HISTORY.md): how the design evolved, the reasons discussed and which alternatives were rejected, deferred or retained as experiments.
- [Technical discussions](TECHNICAL_DISCUSSIONS.md): full closed/open checklist and T01–T10 questions.
- [Engineering decisions](ENGINEERING_DECISIONS.md): D01–D19 rationale and decision scope.
- [Workstreams](WORKSTREAMS.md) and [integration contracts/layout](INTEGRATIONS.md).
- [Mathematical question-policy diagram](QUESTION_POLICY_DIAGRAM.md).
- [Experience brief](EXPERIENCE_BRIEF.md), [current design lab](../design-lab/README.md) and [film brief](PITCH_FILM_BRIEF.md). Read the latest design-lab requirements before implementing motion; current studies require pixel animation, and supersede older generic smooth-animation suggestions.

## 2. Closed decisions to preserve

Closed means agreed design direction, not completed software.

- [x] ~~Custom Slack connector for the live source; Teams/email file imports for history. Nango deferred; Git and other unimplemented connections shown as Planned.~~
- [x] ~~Generalize through common evidence contracts. Reusable logic and UI belong in focused `libs/utils/*` modules; applications compose them.~~
- [x] ~~Use existing evidence first, then questions for consequential unresolved gaps. Both active and background questioning are supported.~~
- [x] ~~A question must explain how a plausible answer could change a meaningful present or reasonably anticipated future decision.~~
- [x] ~~Search permitted sources and available machine observations before interrupting a person.~~
- [x] ~~Link people to work automatically, with source references; inferred expertise is provisional and correctable.~~
- [x] ~~Recipient suitability depends on the question. Past action questions need a reason to know that history; a general current condition may be answered by an authorized person who can observe it.~~
- [x] ~~Per-person background question budgets and minimum gaps are hard constraints. Actual numbers remain open.~~
- [x] ~~Factual Yes/No answers are scoped, attributed evidence. They are neither proof nor automatic positive/negative reward.~~
- [x] ~~Use an LLM to propose questions, with validation. Exact prompts and candidate count remain open.~~
- [x] ~~Keep RL as a question-selection optimization layer; the evidence/reuse loop also operates with a baseline selector.~~
- [x] ~~Offer Quick factual questions and optional Evaluative comparisons. Preferences, evidence, usefulness feedback and participation points have distinct meanings.~~
- [x] ~~Reconstruct who did what, how and with what outcome; test predicted distinguishing traits before recommending a response.~~
- [x] ~~Different evidence requirements apply to diagnostic checks and disruptive corrective actions. Numerical thresholds remain open.~~
- [x] ~~If an answer is unavailable, preserve the unknown. No automatic broadcast; reassign only to another suitable recipient while the gap still matters. This initial policy can be revised after evaluation.~~
- [x] ~~Compare combined versus separate historical-support/current-applicability assessments. A specialist transformer assessor is also an experiment, not a required component.~~
- [x] ~~Use synthetic scenarios with fixed hidden facts and scoped recipient knowledge; split scenario families, hide future outcomes and independently review evaluation labels.~~
- [x] ~~External agents may request clarification through the shared coordinator and report outcomes, as well as retrieve knowledge.~~
- [x] ~~Promote experimental winners using versioned results, fixed criteria and failure review; retain the baseline when improvement is inconclusive.~~
- [x] ~~This chat supplies the technical plan; another chat owns combined overnight orchestration and design integration.~~
- [x] ~~No Astra agents. Later Codex implementation agents use GPT-6.1 Sol or Terra.~~
- [x] ~~No model API calls yet. Plan a small GPT generator alternative to Gemini Flash-Lite.~~

Artem reported **55% of his weekly allowance remaining**. That is not an experiment budget or permission to exhaust it. The small model being evaluated is separate from the coding-agent model. D16 records GPT-6 Luna at low effort as a provisional generator candidate; neither its access route nor its performance has been established here. Do not assume a subscription provides application API access. Claude access and limits must be discovered separately.

## 3. Core architecture and records

```text
Slack / Teams imports / email imports
                 ↓
Common evidence + provenance + permissions
                 ↓
Claims, entities, cases, attempted actions and outcomes
                 ↓
Retrieve possible historical responses for a current problem
                 ↓
Inspect conditions, contradictions and predicted traits
                 ↓
Reuse supported knowledge / obtain a missing observation / defer
                 ↓
Record the new evidence and qualified outcome
```

These are logical stages, not separate required services. A simple shared backend can serve the desktop, API/MCP and evaluation harness.

| Record | Meaning and minimum proposed content |
| --- | --- |
| Evidence | Stable organization/provider/source identity, source revision, original text or reference, author, event time if known, ingestion time, thread/context links, access scope and lineage. |
| Claim / typed relationship | A scoped assertion or connection, supporting/contradicting evidence references, validity, extraction version and provisional/corrected state. Distinguish source-reported facts from inferences. |
| Case | One incident, its assets/environment, observations, hypotheses, attempts, outcomes and important unknowns. It may start with one message. |
| Pattern | A reversible relationship among separate cases. Similar symptoms alone do not establish the same incident or cause. |
| Attempt and outcome | What was proposed versus reportedly performed; by whom and when; what was reported afterward; observation window and recurrence/unknowns. Sequence does not prove causation. |
| Procedure | Stable ID/version, purpose, conditions, steps, verification, supporting cases and failures/limitations. An incomplete attempt need not become a procedure. |
| Person–work link | Person identity, contribution type, related asset/case/claim, evidence and recency. No permanent global expertise score is needed. |
| Question / decision / interaction | Target gap, rationale, recipient, eligibility context, lifecycle, selected action, attributed response, affected decision and observation window. Preference feedback uses a distinct type. |

Embeddings are replaceable search representations pointing to stable records. They are not the solution itself or a probability of success. Storage technology, exact schemas and scoring remain open. PostgreSQL with typed relationships, source storage and an optional vector index is a proposal; a graph database is not a prerequisite. A simpler local store may support the first prototype if the owner documents the substitution and preserves contracts.

Generalization must include useful facts outside incidents, such as site access instructions. Do not hard-code telecom entities, employee names or TRN-042 rules into the core. Similarity, repeated summaries, model agreement and attention weights must not manufacture corroboration.

## 4. Question and recipient algorithm

The following is the **provisional experimental design**, not a selected final algorithm.

```text
Current problem + evidence + relevant people + budget
                         ↓
Look up consequential missing facts in permitted sources
                         ↓
Generate candidate question–recipient pairs
                         ↓
Apply eligibility rules and interruption limits
                         ↓
Policy chooses one pair, or defers
                         ↓
Answer updates the evidence and investigation
                         ↓
Assess decision benefit and effort
                         ↓
Use recorded examples to improve the policy after evaluation
```

1. **Build the current state.** `s_t = (x_t, E_t, H_t, P_t, b_t)` contains the current problem, available evidence, candidate explanations/responses, people/contributions and remaining budget/history. Only information available at this time may enter the state.
2. **Identify consequential gaps.** Compare candidate conditions and predictions with known facts. Search sources first. Each surviving gap must explain what an answer could change. A generic desire for higher confidence is insufficient.
3. **Generate questions and recipients.** The LLM proposes structured questions with target fact/link, scope/time, evidence-backed rationale and possible answer consequences. Validate and deduplicate. Pair with people who have a question-specific reason to know or observe the answer. Two distinct questions is a proposed initial setting, not a requirement to invent a second question or show both to everyone.
4. **Enforce hard eligibility.** `A_t = {(q,p) in C_t : g(s_t,q,p)=1} ∪ {defer}`. Check access, unresolved relevance, answerability, availability, budgets, cooldowns and duplicate assignments. Recheck before delivery because state can change. No learned score can override these constraints.
5. **Select one pair or defer.** Compare a transparent rule baseline, an LLM ranker and a contextual bandit. Hold candidate generation and eligibility fixed for this comparison. Next-choice versus whole-investigation optimization is explicitly unanswered; see U01.
6. **Update evidence.** Attribute the response to the person, question and scope; revise competing hypotheses in either direction. Unknown, skipped and timed-out answers do not become No. Cancel queued questions when evidence resolves their gap. Regenerate or rerank as needed.
7. **Evaluate and learn separately.** Log the state, candidates, eligible set, chosen action, actual selection probability when randomized, response, costs and any later decision/outcome. Evaluate supported decision benefit independently of the selecting model. Train in versioned batches and evaluate before replacing a baseline.

Illustrative reward only: `r_t = ΔV_t − λ · effort_t`. The meaning/units of value, weights, delay window and missingness treatment are **unanswered**. Observed interruption cost may exist while benefit remains unknown; missing benefit is not an invented zero. Preserve component metrics even if a scalar reward is later used. Safety/access/burden limits remain hard rules.

Learning does not require presenting two factual questions and asking which the engineer prefers. In synthetic training, select an action, reveal the response from the fixed scenario state and measure its consequences. Optional Evaluative comparisons can measure question preference separately; they do not reveal incident truth. Never let the policy see hidden answers while choosing.

**Example:** In supplied TRN-042 history, Veikko reports traffic returning after following interface-reset advice; Erkki supplied the advice and suspected explanation. This supports an attributed action/outcome chain. It does not establish independently observed or lasting recovery. Veikko is a plausible recipient for an outcome question; Erkki for the reasoning behind the advice. A new lookalike remains a separate case. In a separately labeled hypothetical variant, discovering an incompatible controller revision can rule out a procedure; that valuable No lowers confidence in the candidate.

## 5. Proposed prototype boundary for the receiving orchestrator

Build one complete trace before expanding research breadth:

1. Import supplied synthetic Teams/email history into the common evidence format. Preserve unknown dates and identify copied retellings; reimport safely.
2. Show source-backed observations, hypotheses, people, attempts and reported outcomes in a case timeline. Keep unsupported fields unknown.
3. Accept a new problem; retrieve candidate cases/procedures and expose matching conditions, conflicts and missing checks.
4. Reuse sufficiently supported context without forcing a new answer. For a consequential gap, create one eligible Quick question or explicitly defer.
5. Answer in the local prototype; update the attributed evidence and recommendation state. Include No, Unknown and no-answer paths.
6. Serve the same trace through a thin API/MCP boundary; retrieve context, request/status a clarification and report an outcome against stable IDs. Exact tool names are proposed, not settled.
7. Integrate the preferred UI direction and authored pixel animation from the design track; keep uncertainty in the text and evidence view. Optional points do not alter truth or reward.

The Slack connector remains agreed scope for the combined plan. Its owner implements against the same envelope and can validate with fixtures while credentials/source permissions are unavailable. Live setup is a separate integration checkpoint; a fixture import must not appear as a live connection. Teams/email are imports; other cards remain Planned.

**Under the current no-model-API restriction:** build a provider interface and deterministic fixtures/replays for extraction, candidate generation and other model-dependent stages. Label them simulated/replayed. They establish wiring and behavior, not measured LLM quality. Local rules, parsers, coordination tests and a synthetic bandit environment can run once the other chat is instructed to build. Learned comparisons involving actual model calls require an available, authorized execution route first. Do not quietly substitute a paid API, treat a coding agent as the measured small model, or report fixture outputs as new model trials.

## 6. Experiment queue and dependencies

**Proposed priority order.** Run a small screening batch, inspect failures, then spend remaining resources on informative comparisons. Avoid the full Cartesian product of models, prompts, selectors and thresholds. Every run gets a manifest containing the question, variants, dataset/split version, configuration, seeds, model/route if applicable, resource cap and frozen metrics.

| ID / priority | Comparison and controlled inputs | Main evaluation / dependency |
| --- | --- | --- |
| E00 / foundation | Frozen synthetic scenarios, evaluator and transparent end-to-end baseline. No learned variant required. | Scenario truth consistency, causal/time visibility, recipient knowledge, source deduplication, permissions and complete traces. Required before other comparisons. |
| E01 / first | Extraction/linking: exact identifiers + structured baseline versus context-aware LLM proposals. Compare short replies, interleaved incidents and corrections. | Claim/link precision and recall, false incident merges/splits, wrong action/person/outcome attribution. Actual LLM arm waits for authorized inference; fixture tests alone cannot answer it. |
| E02 / first | Retrieval: exact/lexical baseline versus embeddings and hybrid retrieval using the same cases and structured filters. | Relevant-response recall at a stated k, misleading-lookalike rate and downstream applicable recommendation coverage/error. Embedding arm needs an available permitted local model/index or approved route. |
| E03 / first | Question selection: rules, LLM ranker and contextual bandit on identical candidate pools, features and hard gates. | Benefit, missed opportunities, errors and questions/time per investigation on held-out families. A bandit can be tested locally on a documented simulator; LLM ranker requires its own authorized route. Report generator fixtures separately. |
| E04 / first | Assessment: one combined support/applicability assessor versus separate assessments with the same evidence and candidate set. | Unsupported/inapplicable recommendations, useful coverage, calibration by impact and failure slices. Test on validation data; retain an untouched test set. Model-dependent arms remain conditional. |
| E05 / next | Question generation: templates-assisted versus freer structured LLM proposals; vary candidate count under comparable budgets. | Consequential/answerable/grounded/neutral question rate, duplicates, hallucinated premises and downstream selection benefit. Change generation separately from E03. |
| E06 / next | Recipient ranking: direct contributors only versus question-dependent broader observable-condition eligibility. Also evaluate ranking within the agreed eligibility rule. | Answerable routing, wrong-person contacts, burden distribution and useful observations. Direct-only is an experimental baseline, not a reversal of accepted general-condition eligibility. |
| E07 / next | Coordinator settings: budgets, cooldowns, stopping, deferred responses and limited reassignment. | Duplicate/obsolete questions, burden, time to supported decision and missed opportunities. Synthetic settings are provisional; no live delivery settings adopted from convenience defaults. |
| E11 / conditional (was E08) | Prompted transformer LLM action/outcome assessor versus a smaller pretrained transformer adapted on reviewed labels. | False solved, temporary-versus-lasting recovery, wrong attribution, missing outcomes, calibration and compute. Requires suitable labels, available model/runtime and a bounded training allocation. Attention is not confidence. |
| E12 / conditional (was E09) | Next-choice policy versus sequential RL on scenarios where early observations affect later choices and delayed outcomes. | Whole-investigation benefit/error/effort under identical observation and action budgets. Requires a tested multi-step environment; do not manufacture an advantage with reward leakage. U01 remains unanswered. |
| E13 / conditional (was E10) | Optional Evaluative preferences and alternate reward/feature designs. | Preference quality and extra burden; ablate whether they improve factual decision outcomes. Do not mix preference labels with factual evidence or rely on preference alone as utility. |

Dependencies: E00 precedes all scored comparisons. (E08-E10 now name the BUILD_BRIEF B2 model experiments, see `experiments/README.md`; the conditional ideas above moved to E11-E13.) Reliable extraction and retrieval are required before claiming integrated improvements, but policy experiments may use explicitly labeled fixed candidate/evidence fixtures to isolate selection. E11 does not block the prototype. E12 follows a working multi-step simulator and a documented next-choice baseline. Expand to more families, repeats and failure cases before adding many closely related model variants.

### Data and evaluator contract

- Separate prepared historical memory, incoming observations, training/validation scenarios and hidden held-out families. Keep related variants and copied source narratives in one family/split. Do not train on the supplied example and call its paraphrase an unseen test.
- Store fixed scenario truth, event timeline, recipient knowledge/observability, permissible actions and outcome rules separately from policy inputs. Answers are generated/revealed from those facts; an unconstrained LLM must not invent a different world after each question.
- Include positive recurrence, similar symptoms with different causes, failed/temporary recovery, copied reports, conflicting time windows, no-answer cases, useful non-incident facts, no-question-needed cases and questions that should have been asked. This prevents rewarding either constant silence or excessive questioning.
- Review label definitions and evaluation answer keys independently of the system under test. Record reviewer/procedure and unresolved ambiguity. Unreviewed synthetic results remain provisional and cannot satisfy the agreed promotion rule.
- Preserve generator/prompt/model versions, splits and available-time cutoffs. Fix validation criteria before opening test results; do not tune on the holdout.
- Logs from a deterministic policy do not automatically support off-policy estimates for actions it never chose. Record real propensities for randomized policies; do not invent action coverage.
- Report simulated outcomes as simulated. Correctly reconstructing a report of success and establishing a real-world successful fix are different targets.

### Metrics to report together

| Metric family | Concrete quantity and interpretation |
| --- | --- |
| Knowledge accuracy | Precision/recall of supported claims and typed links against reviewed labels; false case merges/splits; false action/person/outcome attribution. Report unknown/ambiguous labels separately. |
| Resolution accuracy | False claims of solved status; confusion among reported recovery, sustained recovery, recurrence and unknown outcome over a specified observation window. |
| Recommendation quality and coverage | Supported applicable recommendations / recommendations issued; correctly helped eligible opportunities / all eligible opportunities; unsuitable advice and missed useful opportunities. Freeze opportunity definitions and avoid counting retries as new successes. |
| Question value and burden | Independently assessed correct decision improvements, questions and estimated/measured answer time per investigation, per-person interruptions, wrong-recipient rate, unanswered rate and missed consequential gaps. Include optional evaluations in burden. |
| Calibration | For each defined probabilistic target, calibration and a proper scoring rule such as Brier score on reviewed labels. Do not score arbitrary similarity or ordinal support labels as probabilities. Keep support and applicability targets identifiable. |
| Efficiency | Calls, tokens, latency and measured/estimated resource cost. Distinguish local estimates, application API costs and subscription quota; report what is actually observable. |
| Hard constraints | Access leakage, duplicate delivery, hard-budget/cooldown violations and provenance misuse are failure checks, not errors a reward gain can compensate for. |

Show denominators, missing-feedback counts, scenario slices and uncertainty/repeat variation where meaningful. Numerical acceptance margins, error ceilings and burden ceilings remain unanswered. Until set before scoring, report comparisons without declaring an accepted winner. Prefer the simpler baseline when differences are inconclusive.

## 7. Suggested agent orchestration for the other chat

This is a dependency/ownership proposal, not a request to spawn agents now. Use actual available concurrency and budget; the roles below can be sequential or combined. Do not create one agent or microservice for every row.

| Role | Owns / produces | Starts after |
| --- | --- | --- |
| Technical integrator | Shared contracts, minimal storage/state semantics, run manifest, integration branch and decision log. Arbitrates schema changes. | Inspect current repo and agree global run scope. |
| Scenario/evaluation owner | Synthetic datasets, hidden truth, split manifests, metric definitions, evaluator and failure reports. Evaluation truth must not leak through agent prompts/files to implementation or tuning roles. | Draft contracts and evaluation targets. |
| Ingestion/memory owner | Parsers, normalization, lineage, typed links, case histories and correction handling; E01 baseline. | Contract examples. Coordinate Slack ownership with general plan. |
| Investigation/question owner | Retrieval, applicability gates, person routing, coordinator, rule baseline and experiment adapters; E02–E07 as budget permits. | Contracts and visible fixtures; scored results require E00. |
| UI/API integration owner | Common view models and service calls, asynchronous question lifecycle, outcome reporting and design integration. | Contract stubs; can work before real inference exists. |
| Experiment/review owner | Bounded bandit/assessment comparisons, reproducible reports, held-out review and promotion recommendation. | Evaluator and relevant baseline; E11/E12 only after prerequisites. |

The general orchestrator owns design/animation, Slack setup and full-app packaging assignments. Coordinate through saved artifacts and explicit contracts; do not assume Claude sees private Codex chat state or has the same tools. Assign exclusive file ownership or separate worktrees for overlapping changes. Keep one owner for root tooling, shared types and integration. Preserve other agents' uncommitted work and frozen design versions.

Proposed shared interfaces to freeze first: `EvidenceEnvelope`, typed memory records, `InvestigationState`, `QuestionCandidate`, `RecipientEligibility`, `PolicyDecision`, factual `Answer`, separate `PreferenceFeedback`, `OutcomeReport` and `EvaluationRecord`. Include organization/access scope, stable IDs, provenance, version and unavailable/error states where applicable. Names and language are defaults for review, not new product decisions.

Shared modules remain under `libs/utils/*`; apps depend on libraries, libraries never depend on apps/experiments/scripts, and apps do not import each other. Experiment code consumes the same contracts but keeps hidden evaluator data outside runtime inputs. No requirement to create every proposed folder upfront.

Each assignment should contain: objective, owned paths, inputs/outputs, non-goals, dependencies, resource cap, stop condition and completion evidence. Each experiment should produce a manifest, metrics with denominators, trace/failure examples, limitations and a short recommendation. Record completed, failed, skipped and blocked runs honestly. Do not turn an unavailable expensive comparison into an unmarked mock success.

## 8. Unanswered questions — deliberately preserved

**All entries below remain open.** The user explicitly asked to save these. A suggested build default is not user approval. The full detailed queue remains in T01–T10 and D01–D19; this register consolidates the questions needed for the handoff. It does not require Artem to answer every implementation detail before a reversible prototype can be built.

| ID | Unanswered question | Suggested handling, not a decision |
| --- | --- | --- |
| U01 | **Should the initial selector optimize the next useful question, while keeping optimization of an entire investigation as a separate experiment?** | Unanswered. Both can ask several adaptive questions. Next-choice focuses on the immediate decision; sequential RL learns delayed whole-investigation value. Implement a replaceable baseline; preserve E12 (sequential RL, formerly E09). |
| U02 | What exactly does the learned policy choose: question only, question–recipient pair, timing/defer, or a broader strategy? | Pair/defer loop is provisional; use explicit timing gates initially. |
| U03 | How many question candidates, with which prompts, templates, validation and features? What if only one or none is useful? | Small validated pool; two is an experiment setting, never a forced quota. E05. |
| U04 | What exact benefit defines the reward; what are its units, weights, delay window and treatment of unknown outcomes? | Keep benefit, error and effort separately observable before selecting a scalar. |
| U05 | Which selector/model wins, and when/how is it updated? What evidence justifies sequential RL? | Compare rules, ranker and bandit; batch updates and E12 are proposals. |
| U06 | Which certainty targets and labels should exist? Combined or separate support/applicability; what thresholds for linking, checks and fixes? | E04; no invented universal confidence percentage. |
| U07 | What false-advice, missed-opportunity and interruption rates are acceptable, and what improvement margin permits promotion? | Product acceptance targets needed before declaring a winner or real delivery. |
| U08 | What are the actual per-person limits, cooldowns, active-investigation exceptions if any, retry counts and stop rules? | Parameterize synthetic trials. Hard background limits remain mandatory; live settings need agreement. |
| U09 | How far can routing broaden, which person–work features matter, and how are identities/aliases/corrections represented? | Source-backed eligibility is closed; detailed schema/ranking open. E06. |
| U10 | What are the exact evidence units, claim/link types, provenance and revision/validity rules? Which links can be automatic? | Freeze a minimal reversible schema before parallel builds; preserve uncertainty. |
| U11 | How much conversation context, which relevance/semantic labels, and how are generated annotations audited? | E01; retain negations, uncertainty, identifiers and original sources. |
| U12 | How are incident identity, recurring patterns and response links scored? Is explicit clustering needed initially? | Compare exact/contextual linking; reversible candidate relationships may suffice for prototype. |
| U13 | Which retrieval representation, embedding model/index and structured conditions work best? | E02; lexical baseline first when no permitted embedding route exists. |
| U14 | What historical/incoming/training/validation/test sizes and families; how much agent labeling; any explicitly simulated prior engineer answers? | Synthetic direction agreed; exact composition and review workflow open. Demo selection remains the other chat's work. |
| U15 | Which specialist transformer, adaptation method, labels and compute would make E11 worthwhile? | Conditional experiment; no custom transformer required to build the core. |
| U16 | What role should optional Evaluative A/B preferences have in training, and how often may they appear? | Separate preference stream; no mandatory comparison and include its burden. E13. |
| U17 | Which Slack sources/history/events, authentication/setup, thread/attachment handling and Teams/email formats? | Adapter owner proposes bounded contracts; source-platform choice stays closed. |
| U18 | Which database, exact modules, language/package tooling and deployment split? | Reuse current agreed UI direction and keep one simple backend; `libs/utils` boundary is closed. |
| U19 | How do corrections, deletion, revoked access and identity mapping propagate to claims, indexes, questions and recommendations? | Define a minimal dependency/invalidation trace; access filtering must hold at retrieval and delivery. |
| U20 | What are the API/MCP tool names, caller authorization, async request/status/cancel lifecycle and outcome-reporting contract? | One shared service; clarification capability agreed, detailed contract open. |
| U21 | What exact Connections/onboarding, people/evidence views, avatar states, points behavior and OS packaging are selected? | General/design orchestrator owns selection; preserve current preferred studies and pixel-animation requirements. |
| U22 | Which experiment order, sample counts, repeat seeds and stopping rules fit the overnight budget? | Staged queue above is a recommendation; no unlimited combinations. |
| U23 | What small GPT model and execution route are actually available under the no-API restriction? | Discover before model trials. A stub is acceptable for wiring but cannot answer a model-quality comparison. |

**Run-level inputs for the general orchestration chat:**

- **R1 — Hard stop:** What time/date in Europe/Helsinki must the run stop and leave a reviewable state?
- **R2 — Resources:** What cap applies across coding agents, Claude, model experiments and local compute? The reported 55% remaining is not that cap. Use bounded batches; do not infer permission for unbounded work.
- **R3 — Execution scope:** The other chat receives the actual build/run instruction. Preserve the existing no-model-API rule unless Artem explicitly changes it. Record scope for local edits/tests/training, account connections and any external delivery/deployment; planning alone grants none of those. Do not repeatedly ask for actions already authorized there.
- **R4 — Ownership/routes:** Which agent owns integration/shared contracts, which design artifacts should be adopted, and which Codex/Claude/local runtimes are available? Inspect existing work before asking Artem for discoverable information.

U01–U23 stay visible even if the orchestrator chooses temporary implementation defaults. Record a default with its reason, tests and reversibility; mark a research result experimental until promotion criteria are met. Do not mark an unanswered product tradeoff closed merely because a branch implements one option.

## 9. Morning review / completion evidence

The combined run should leave a reproducible local launch path, a runnable end-to-end trace, a saved experiment report and an explicit unresolved list. Minimum review cases:

- Source import is idempotent and source citations lead to the underlying evidence; copies do not become independent confirmations.
- Advice, performed actions and reported/lasting outcomes remain distinct; recurrence and unknowns are visible.
- A same-incident continuation links correctly; a similar separate incident stays separate; conflicting conditions can reject a historical response.
- The same core supports a no-new-question reuse path, a useful clarification path, a valuable No and Unknown/no-answer/defer paths.
- Recipient eligibility, access, budgets and duplicate/obsolete question handling are enforced outside the learned selector.
- UI and API/MCP return consistent qualified context and trace IDs; optional preferences/points do not change factual evidence.
- Actual UI states are reviewed against the design artifacts; packaged OS claims are limited to platforms actually tested.
- Every reported gain names the dataset/split, baseline, metric and limitation. Simulator, replay and actual model results are distinguished. No unrun model/API experiment is presented as completed.
- A baseline remains available. Model-dependent or compute-heavy extras do not prevent delivery of the core prototype.

**Handoff complete; no experiment winner or selector horizon is closed by this document.** The next work belongs to the combined orchestration chat after Artem instructs it to build and run within the preserved constraints.
