# Engineering decisions for Knowledge Twin

**Working discussion queue · 6 November 2026.** Algorithms and thresholds are proposals, not final selections. No performance results are claimed.

Open [the interactive master map](master-map.html) for the connected architecture, or read [the architecture reference](ARCHITECTURE.md).

## Suggested discussion order

1. Decide the units of evidence, claim and incident; establish the source contract and permissions.
2. Decide labels and scenario splits before generating a large training corpus.
3. Define what support and applicability mean for the target workflow.
4. Agree on the question policy, burden budget and reward semantics.
5. Compare algorithms using the agreed metrics; then choose thresholds.
6. Freeze a narrow demo path before expanding connectors, clustering or RL.

## Decision index

| ID | Topic | Timing |
| --- | --- | --- |
| D01 | Source contract and first adapters | Before build |
| D02 | Conversation unit and context window | Before build |
| D03 | Label taxonomy and LLM annotation | Before build |
| D04 | Synthetic data generation and splits | Before build |
| D05 | Usefulness classifier and escalation | Prototype |
| D06 | Atomic claims and entity resolution | Before build |
| D07 | Case formation and cluster membership | Before build |
| D08 | Embedding model, distance and index | Prototype |
| D09 | Claim schema, validity and database | Before build |
| D10 | Evidence support and confirmation rules | Before build |
| D11 | Retrieval and hypothesis testing | Prototype |
| D12 | Question selection, routing and stopping | Before build |
| D13 | Rewards, binary feedback and points | Before build |
| D14 | Privacy, hosting and permissions | Before build |
| D15 | MCP contract and agent authority | Before build |
| D16 | Evaluation and training lifecycle | Before build |
| D17 | Electron application, pixel avatar and OS parity | Prototype |
| D18 | Bandit versus sequential RL scope | Later research |
| D19 | Generalization and reusable module boundaries | Direction agreed |

## D01 — Source contract and first adapters

**Timing:** Before build

**Question:** Which sources prove the value with the least integration effort?

**Status:** Connector scope agreed and closed on 6 November 2026. Detailed source contracts remain open. Design approval only; no implementation or account connection is authorized yet.

**Agreed decision:** Use a custom Slack connector as the hackathon's live source and Teams/email file imports for historical material. Defer Nango. Show other platforms, including Git/repository hosts, as **Planned** in the Connections UI. Display Slack as live and imports as available only when implemented and verified. Preserve a general source-adapter boundary so later integrations can use the same knowledge pipeline.

**Alternatives considered:** Nango-managed integration infrastructure, multiple native live connectors, and an imports-only demo. The chosen scope limits connection work while demonstrating a live source and reuse of historical evidence. Nango remains a post-hackathon option, not a rejected long-term architecture.

**Still open:** Selected Slack channels/conversations and history range; replies, attachments and edit/delete scope; authentication/setup details; exact accepted import formats; common evidence contract and access propagation. Pasted text/image routes remain separate scope questions. See [connections and reusable structure](INTEGRATIONS.md).

**Follow-up status:** Detailed source contracts remain open for the appropriate technical discussion. Artem moved demo selection/presentation to a separate session; choosing demo channels is not the next question here. Continue with T01, then T02.

**Reason to revisit:** A post-hackathon pilot needs more live providers, broader sync behavior or centrally managed integration infrastructure.

**Metrics:** Declared-scope completeness, duplicate rate and import latency.

**Experiment:** Replay the supplied case as chat and email; repeated import must not duplicate claims or credit.

## D02 — Conversation unit and context window

**Timing:** Before build

**Question:** What context is necessary to classify and interpret a message correctly?

**Proposed starting point:** Reply ancestors plus bounded nearby messages and an accessible case summary.

**Alternatives:** Fixed token windows, semantic segmentation or thread-level extraction.

**Metrics:** Recall of meaningful short replies; extraction errors per token cost.

**Experiment:** Test 'yes', 'did that', delayed replies and two incidents interleaved in one channel.

## D03 — Label taxonomy and LLM annotation

**Timing:** Before build

**Question:** Which labels may be weak, and which must have reviewed ground truth?

**Proposed starting point:** LLM-assisted labels with provenance: usefulness, claim type, entity links and same-incident pairs. Audit a separate test set.

**Alternatives:** One teacher, teacher+critic or task-specific teachers; model disagreement is a review signal.

**Metrics:** Agreement against audited labels, per-class recall and unsupported-label rate.

**Experiment:** Blind annotators to future messages; compare labels across scenario families and difficult negatives.

## D04 — Synthetic data generation and splits

**Timing:** Before build

**Question:** How do we prevent the model from learning generator style or seeing its test answer?

**Proposed starting point:** Scenario truth first, conversation rendering second. Split families before paraphrases or cross-platform retellings.

**Alternatives:** Template-driven generation versus constrained LLM generation.

**Metrics:** Failure-mode coverage, leakage checks and performance on held-out families.

**Experiment:** Include access facts, temporary fixes, recurrence, conflicting scopes, missing dates, irrelevant chatter and unknown outcomes.

## D05 — Usefulness classifier and escalation

**Timing:** Prototype

**Question:** What false-negative cost and inference budget should determine the thresholds?

**Proposed starting point:** Prompted Flash-Lite baseline; compare frozen embeddings + regularized logistic regression. Useful/uncertain/irrelevant routing.

**Alternatives:** Rules only; small local classifier; stronger model for uncertain windows.

**Metrics:** High-value recall at a stated precision/cost; PR-AUC; false-discard rate.

**Experiment:** Sweep thresholds on validation cases; examine costly false negatives separately.

## D06 — Atomic claims and entity resolution

**Timing:** Before build

**Question:** How small should a claim be to verify it without fragmenting meaning?

**Proposed starting point:** Typed claims with evidence spans, exact IDs first, aliases and constrained matching next.

**Alternatives:** Schema granularity; deterministic extraction versus LLM-assisted entity links.

**Metrics:** Supported claim precision/recall, entity-link errors, temporal/negation accuracy.

**Experiment:** Test vague pronouns, aliases, two similarly named devices and the same name on different platforms.

## D07 — Case formation and cluster membership

**Timing:** Before build

**Question:** Which relationships can be automatic, provisional or human-confirmed?

**Proposed starting point:** Separate same-incident linking from recurring-pattern membership. Start with candidate neighbors plus structured constraints.

**Alternatives:** Pairwise classifier, agglomerative clustering or HDBSCAN after data is sufficient.

**Metrics:** Pairwise precision/recall; false merges/splits; useful outlier detection; downstream retrieval gain.

**Experiment:** Use near-identical symptoms with different causes and one incident continued across platforms.

## D08 — Embedding model, distance and index

**Timing:** Prototype

**Question:** Which representation retrieves applicable knowledge rather than similar wording?

**Proposed starting point:** Versioned embedding model; cosine/inner-product choice matched to normalization. Exact search first if the corpus is tiny.

**Alternatives:** Model candidates, chunk/case embeddings, approximate HNSW at scale.

**Metrics:** Recall@k, latency/cost and language/entity error slices.

**Experiment:** Compare symptom+environment representations against whole-case summaries without future-answer leakage.

## D09 — Claim schema, validity and database

**Timing:** Before build

**Question:** Which validity fields are known, inferred or unavailable, and how are updates represented?

**Proposed starting point:** PostgreSQL + typed edges + pgvector + object storage; explicit evidence and claim revisions.

**Alternatives:** Neo4j or another graph engine if multi-hop query needs justify it.

**Metrics:** Correct temporal queries, provenance completeness, deletion propagation and query latency.

**Experiment:** Replay a corrected claim, moved key location and unknown-date source.

## D10 — Evidence support and confirmation rules

**Timing:** Before build

**Question:** What evidence makes a statement usable for a particular action and risk level?

**Closed answer-semantics decision — 6 November 2026:** An engineer's Yes/No answer is attributed evidence about the scoped question; it does not automatically prove or confirm a broader claim. Use it to update evidential support for claims and competing hypotheses, preserving who answered and the relevant conditions. Certainty remains revisable. For TRN-042, a report that traffic returned supports that reported outcome without establishing causation or lasting recovery. Exact certainty measures, evidence combination and confirmation requirements remain open.

**Closed decision on how to choose — 6 November 2026:** Evaluate the alternatives experimentally before choosing the recommendation-assessment design. The final design remains open pending evidence. Artem wants to use experiments for suitable unresolved technical choices; an experiment folder can be created later. No experiment implementation or run is authorized now.

**Closed experiment-scope decision — 7 November 2026:** Keep the proposed transformer action/outcome assessor as an experiment. Compare a prompted transformer LLM with a smaller pretrained transformer adapted to assess claim–history support; do not adopt a specialist model as a required architecture component. Use the same available evidence and task definitions. Proposed evaluation covers unsupported resolution claims, incorrect action–outcome links, temporary recovery/recurrence, missing outcomes, calibration and cost/latency. Exact models, labels, adaptation method and training resources remain open; no experiment implementation or run is authorized by this decision. Attention weights and relevance scores are not certainty estimates. This model-choice comparison is separate from the still-open combined-versus-separate support/applicability comparison.

**Proposed comparison:** A single combined recommendation assessment versus separate historical-support and current-applicability assessments followed by a gate. Both variants must consider the same source evidence and current conditions; the combined variant must not be artificially denied applicability information. Use matched cases and information available at the same decision time. Exact variant definitions, metrics, test set, thresholds and selection criteria remain to be agreed. Potential measurements include unsupported/inapplicable recommendations, useful coverage, abstentions, engineer questions and cost/latency.

**Closed risk-policy decision — 7 November 2026:** Diagnostic checks and potentially disruptive corrective actions have different evidence requirements. Higher-impact advice requires stronger support and applicability checks. Numerical thresholds, accepted error rates and calibration remain open.

**Proposed starting point:** Separate extraction confidence, support, applicability and authorization; provenance-aware assessment with explicit disputes.

**Alternatives:** Combined versus separate support/applicability assessment (to be compared experimentally); rules versus calibrated evidence model; task-specific required observations.

**Metrics:** False support promotion, stale advice, contradiction detection and reliability curves.

**Experiment:** Repeat one source five times, add an independent observation, then add recurrence.

## D11 — Retrieval and hypothesis testing

**Timing:** Prototype

**Question:** Which checks distinguish candidates, and how do we prevent circular confirmation?

**Closed product-direction clarification — 7 November 2026:** Reconstruct supported operational knowledge: whether a problem was resolved, how, who contributed and whom to consult. Before recommending a past response for a newly observed problem, propose candidate explanations, state additional traits expected under each, seek available observations and revise support before offering sufficiently supported advice. An uncertain candidate is not a solution notification. Reused retrieval symptoms and repeated reports are not independent confirming tests; contradictions and missing observations remain visible. This preserves the agreed path for a consequential, targeted human question when existing sources cannot resolve a gap. It does not require eliminating all uncertainty before asking, nor maximizing model confidence regardless of correctness. Exact scoring and RL reward remain open.

**Proposed starting point:** Hybrid retrieval, environment filters and a small candidate set; predict additional traits before checking them.

**Alternatives:** Rank fusion/rerankers; rule-based check selection versus estimated information gain.

**Metrics:** Recall@k/nDCG@k; applicable-result precision; correct lookalike rejection; decisions improved per check.

**Experiment:** Compare vector-only, hybrid-only and hypothesis-checking versions on identical timed inputs.

## D12 — Question selection, routing and stopping

**Timing:** Before build

**Question:** When is asking worth it, who can answer firsthand, and when do we stop?

**Closed subdecision — 6 November 2026:** Questions may arise both during active investigations and while organizing historical knowledge in the background. Background questions must target important gaps and keep engineer interruptions low. This closes the question-trigger context only; it does not settle selection criteria, budgets or algorithms.

**Closed first eligibility requirement — 6 November 2026:** A question is eligible only if the system can explain how at least one plausible answer could change a meaningful present or reasonably anticipated future decision. This applies to active-investigation and background questions. Missing data, record completeness or low confidence alone are insufficient. This is a necessary requirement, not sufficient permission to interrupt someone; the additional agreed requirements and remaining details are recorded below.

**Closed second eligibility requirement — 6 November 2026:** Check accessible conversation history and available machine observations before asking an engineer. A human question is eligible only if the consequential gap remains unresolved after that check. This applies to background and active-investigation questions. Exact lookup methods and budgets remain open.

**Closed third eligibility requirement — 6 November 2026:** A recipient needs a question-specific reason to be likely to know the answer. Link people to relevant work traits, systems, incidents, actions and contributions so the service can explain that reason. A person suitable for explaining a procedure is not automatically a firsthand witness to its outcome. This closes the recipient-relevance principle; detailed evidence assessment and ranking remain open.

**User direction:** Artem suggests a graph for these people-to-work relationships and requires linking particular work traits to particular people. The relationship requirement is agreed. A typed graph representation is a proposal; it does not select a graph database or a ranking algorithm.

**Closed relationship-construction decision — 6 November 2026:** Create people-to-work links automatically from source-supported contributions. Keep broader inferred expertise provisional and correctable. Retain the supporting source and distinguish the type of contribution, such as reporting an action, advising it or observing an outcome. Automatically extracted links must remain correctable too; an attributed report is not independent confirmation. Exact relationship schema, evidence thresholds, storage and ranking remain open. Design only; implementation is not authorized.

**Closed generation direction — 7 November 2026:** Use an LLM to generate question candidates, constrained by a meaningful target gap, source/context and validation. Exact prompts, template assistance and candidate count remain experimental. Generating candidates is separate from deciding which question–person pair to select.

**Closed recipient-scope clarification — 7 November 2026:** Eligibility depends on the question. Historical actions and outcomes call for relevant firsthand contributions; a generally observable current condition may be answerable by an authorized person who can observe it, without previous participation in the incident. Supported relevant knowledge may qualify a person for an explanation question. Do not require a past case link for every question, and do not equate access or thread membership alone with answerability. Record the specific reason to know or observe; retain limits and defer when no suitable recipient exists. Exact features and ranking remain open.

**Closed initial no-answer policy — 7 November 2026:** Unknown, Skip and timeout preserve unresolved facts. Do not automatically broadcast. Reassignment requires another suitable person and a still-consequential gap. Evaluate this initial policy and revise it if results justify a change; no permanent retry count or timeout has been selected.

**Closed background-burden requirement — 6 November 2026:** Per-person question budgets and minimum gaps between background questions are hard constraints. The selection algorithm cannot override them because a question appears valuable. Actual numbers, counting windows, configuration ownership and active-investigation limits remain open for later. This is a design decision only; no implementation is authorized.

**Answer semantics — closed:** Engineer answers are attributed evidence that updates support for claims/hypotheses, not automatic proof; see D10 for the active T02 discussion. Remaining T01 details and ranking/learning algorithms stay open.

**Proposed starting point:** Shared coordinator checks machine evidence first, then ranks eligible question–recipient–timing actions or defers. Use decision impact, firsthand answerability, source independence and burden. Reserve and cancel assignments to avoid duplicate questions.

**Open algorithm alternatives:** Heuristic score, LLM/learned ranker or contextual bandit, with sequential RL scope still under discussion. The agreed LLM generator and eligibility rules do not select one ranking algorithm.

**Metrics:** Useful evidence per question; expert minutes; unnecessary interruptions; recipient load.

**Experiment:** Compare routing across question families: case link, diagnostic trait, applicability and outcome. Include a knowledgeable unavailable person, a responsive uninformed person, duplicate evidence and a gap that is not worth asking about.

## D13 — Rewards, binary feedback and points

**Timing:** Before build

**Question:** What is rewarded for each learning task, and which signal can be gamed?

**Proposed starting point:** Optimize supported useful assistance per eligible opportunity with error, unnecessary-interruption and burden limits. Binary helpfulness remains valid; factual Yes/No answers are evidence. Separate MCP exposure, agent adoption, human usefulness and observed outcomes. The points experience is planned for implementation with an on/off switch; its rewards remain independent of policy utility and claim support. See [the experience brief](EXPERIENCE_BRIEF.md).

**Alternatives:** Binary helpfulness target; verified terminal outcome; a weighted reward after units and weights are agreed.

**Metrics:** Useful coverage; helpful/assessed recommendations with feedback coverage; unnecessary offers; missed useful opportunities; error and expert effort. Report human, agent and measured outcomes separately.

**Experiment:** An agent reads but ignores context; uses context without outcome proof; a No falsifies a bad hypothesis; a correct offer was unnecessary; abstention misses a useful warning. Include unknown outcomes and delayed recurrence.

## D14 — Privacy, hosting and permissions

**Timing:** Before build

**Question:** Where do originals, prompts, embeddings, identity maps, logs and backups go?

**Proposed starting point:** Organization-owned data plane; approved inference endpoint; source-derived permissions and dependency-aware correction/deletion.

**Alternatives:** Private/on-premise model versus approved cloud model; storage backends behind interfaces.

**Metrics:** Unauthorized retrieval/question leakage, deletion propagation and retained-data inventory.

**Experiment:** A caller lacks one source in a mixed case; verify no summary or person recommendation leaks it.

## D15 — MCP contract and agent authority

**Timing:** Before build

**Question:** Which decisions belong to our service, the operational agent and the engineer?

**Closed capability direction — 7 November 2026:** External agents may request human clarification through the shared coordinator, in addition to retrieval and outcome reporting. The same access, recipient-selection, duplicate-suppression and interruption limits apply. Track the investigation, questions, attempted actions and attributed outcomes. Exact tools, asynchronous lifecycle and authorization contracts remain open; this is not direct database or unrestricted messaging authority and does not implement the extension.

**Proposed starting point:** get_context / investigate_problem return evidence, validity, disputes, gaps and conditions; writes are separately authorized.

**Alternatives:** High-level investigation tool versus composable search/check tools.

**Metrics:** Consumer decision quality, source support, integration latency and authorization failures.

**Experiment:** A small agent handles a recurrence and escalates a conflicting case using the same service.

## D16 — Evaluation and training lifecycle

**Timing:** Before build

**User direction — 6 November 2026:** Use comparative experiments to resolve suitable open technical choices. Record hypotheses, alternatives and evaluation criteria before running them; create the experiment directories later, when implementation is authorized. The D10 comparison is the first concrete candidate. This does not assume a dataset size, compute budget, paid entitlement or permission to run experiments now.

**User direction — 7 November 2026:** Discuss the question-selection algorithm, then identify the other technical choices that need comparative experiments. Artem intends a later overnight agent build/test run after that planning. This turn authorizes design and experiment planning only; no agent run, experiment directory, implementation, model training or automatic promotion is started.

**Closed evaluation-data direction — 7 November 2026:** Use synthetic scenarios with fixed hidden facts and scoped recipient knowledge; split by scenario family, hide future outcomes and independently review evaluation labels before accepting results. Distinguish simulated results from real human evidence. Exact datasets, sample sizes and labeling/review workflows remain to be designed.

**Closed promotion decision — 7 November 2026:** Use versioned results, fixed evaluation criteria and failure review to select an experimental winner. Keep the baseline if improvement is inconclusive. Freeze evaluation scenarios before comparing variants. Numerical acceptance criteria and policy-update cadence remain open.

**Experiment breadth — 7 November 2026:** Artem wants as many useful experiments as available resources allow. Preserve the candidate areas: question selection, extraction/linking, case matching/retrieval, combined versus separate support/applicability, and the transformer action/outcome assessor. Plan staged comparisons and prioritize decision-relevant tests; this is not unlimited compute authorization or a requirement to run every combination. Exact ordering and run caps remain open.

**Closed delegation model constraint — 7 November 2026:** Artem reports 55% of his premium-plan weekly allowance remaining. Do not launch Astra agents. For later Codex delegation use `gpt-6.1-sol` or `gpt-6.1-terra`; this user instruction explicitly authorizes those model overrides when agents are eventually launched. Do not silently substitute Astra or treat the reported remaining allowance as a spending budget or permission to exhaust it. Claude execution routes/resources and numeric run caps remain separate inputs. No agents are launched by this discussion.

**Closed model-execution constraint — 7 November 2026:** Do not make model API calls yet. Use a small GPT model as the planned question-generator alternative to Gemini Flash-Lite. This direction does not start inference, launch agents, authorize API credentials or change the discussion-only boundary. Keep the model being evaluated separate from the Sol/Terra implementation agents. Proposed candidate: `gpt-6-luna` at low reasoning effort, supported as a starting point for scoped work by the [official OpenAI model-selection guidance](https://developers.openai.com/api/docs/guides/model-selection), checked 7 November 2026. Exact generator model/access route remains provisional; do not infer API availability from subscription or agent-tool access. Gemini Flash-Lite is not the initial execution route under this instruction.

**Planning ownership — 7 November 2026:** This discussion will settle the core algorithm questions, then prepare the technical experiment/orchestration plan for later Codex and Claude agent work. Artem will ask another agent to own the general overnight orchestration file, including connectors and animation/UI/UX integration. The technical plan should supply contracts, dependencies, bounded assignments, evaluation outputs and integration checkpoints to that broader plan. This establishes planning scope only; it does not launch agents or experiments.

**Handoff update — 7 November 2026:** Artem requested that the technical summary and experiment plan now be saved for the general orchestration chat, while explicitly preserving unanswered questions. The [overnight technical handoff](OVERNIGHT_TECHNICAL_HANDOFF.md) records this plan, including U01 on next-choice versus whole-investigation optimization. Preparing the handoff does not close D18, choose a reward/threshold, start implementation or relax the no-model-API/no-Astra constraints.

**Question:** What evidence is enough to promote a new model or claim improved autonomy?

**Proposed starting point:** Scenario/time splits, reviewed test labels, task-specific metrics, versioned batch training and shadow comparison.

**Alternatives:** Offline replay and later controlled live comparison; off-policy estimators only when assumptions hold.

**Metrics:** Coverage and error together; calibration; expert time; cost; dataset size and confidence intervals where justified.

**Experiment:** Ablate each new component and test unseen environment changes.

## D17 — Electron application, pixel avatar and OS parity

**Timing:** Prototype

**Question:** How do we make contributions pleasant while allowing uninterrupted work?

**Proposed starting point:** Electron is the current desktop application framework direction for macOS and Windows. White pixel-circle avatar with small face, compact input and expandable history. Static SVG preview now; animation direction to be developed with Artem. Build optional points with smooth reward effects, avatar reactions and optional sounds, plus a quiet preset. See [the experience brief](EXPERIENCE_BRIEF.md).

**Alternatives:** Core UI may be developed in a browser first. Revisit the desktop framework only if measured constraints justify it; adapt menu-bar/Dock and notification-area/taskbar integration per OS.

**Metrics:** Same core workflow on both packaged builds, time per answer, focus/dismissal behavior, usability and idle CPU/memory.

**Experiment:** On macOS and Windows, open the avatar, paste/drop an image, answer or defer a question, expand the source chain and close/reopen. Check scaling and permissions. Do not claim tested parity before running these checks.

## D18 — Bandit versus sequential RL scope

**Timing:** Policy design now; training and evaluation after the experiment plan is agreed

**Closed role decision — 7 November 2026:** Retain RL as a planned optimization layer for choosing worthwhile questions. The evidence, linking, retrieval and answer-update loop must also operate with a baseline selector. Factual Yes/No answers update evidence; they are not automatically the reward for choosing the question. This settles RL's architectural role, not a particular algorithm or a claim of measured improvement.

**Clarification:** Explicit eligibility, permission and burden rules remain outside the learned selector. This does not make LLM extraction, interpretation or learned selection deterministic. Broader recipient expertise remains provisional and correctable under D12.

**Current selector proposal:** A contextual bandit over eligible question–recipient pairs, including defer, compared with a fixed-rule baseline. Recipient choice is a proposed part of the learned action, not a settled scoring method. Hold candidate generation and eligibility rules constant for the first comparison. Sequential RL remains a comparison candidate if the evaluation depends on multi-step investigation outcomes.

**Detailed selection pipeline — proposed, not agreed:**

1. Freeze the current investigation state: permitted observations, candidate responses, contradictions, consequential unknowns, previous questions and budget state. Use only information available at that decision time.
2. Search accessible sources and available machine observations for each consequential gap. Update evidence when an answer is found; retain only unresolved gaps worth considering for human clarification.
3. Generate structured question candidates using the agreed LLM generator; template assistance remains a proposed technique. Each candidate identifies the target claim/link, scope/time, rationale with source references, possible answer effects, and a semantic key for duplicate detection. Candidate generation is separate from RL selection and is itself evaluated.
4. Build a question-specific recipient pool from relevant contributions, supported knowledge or ability to observe the requested condition. Distinguish performing an action, observing an outcome, advising a procedure and explicit responsibility. Historical participation is not required for a broadly observable present condition. Inferred expertise stays provisional. Feature values describe the question–person relationship, with missingness explicit, rather than a global employee score.
5. Filter pairs by source access, question-specific answerability evidence, availability and applicable budget/cooldown rules. Exclude already-resolved, redundant, expired or duplicate-pending questions. Consider all remaining pairs jointly, plus defer; do not commit to a question before considering whether anyone can usefully answer it.
6. Compare selectors on identical candidate pools: an explicit rule ranking, an LLM ranker and a contextual bandit using shared case features plus question/recipient features. Relevant features include decision consequence, gap type, novelty, contribution type, directness, recency and current burden. Precise features, weights, model family and exploration method remain experimental. Initial exploration belongs in the synthetic environment; live exploration remains a separate future decision.
7. Recheck eligibility and whether the gap remains open immediately before delivery; reserve one assignment through the shared coordinator. An answer adds attributed evidence and triggers reassessment. Cancel obsolete candidates. Unknown, skip and timeout do not mean No; reassignment requires a still-consequential gap and another eligible recipient, not an automatic broadcast.
8. Record the selected pair/defer, candidate set, model version, selection probability where applicable, answer, effort and downstream outcome. Train on an independently defined decision-benefit target, not the selector's self-rating, Yes counts or confidence gain. Synthetic hidden facts support controlled evaluation; real missing benefit stays unknown even when interruption cost is observed. Include no-question scenarios and missed useful opportunities so constant asking and constant silence can both fail evaluation.

**Closed feedback-category direction — 7 November 2026:** Offer a Quick category for small factual questions and an optional Evaluative category that can contain A/B question comparisons. Comparison responses supply preference labels for a ranker/reward model, not answers to the underlying factual questions or proof of downstream benefit. They are optional rather than a mandatory extra step after every answer. Preserve neither/tie/unknown/skip where appropriate, and include evaluative interactions in burden accounting. Exact layout, sampling frequency and training use remain open. See the experience brief for the UI handoff.

**Current two-candidate proposal — open:** Have the LLM propose a small set of distinct semantic questions; two is a useful initial experiment setting, not an agreed fixed count. Form eligible recipient pairs for each, let the selector choose one pair or defer, then regenerate/reassess after evidence changes. Ordinary engineers see the selected question; displaying two for preference comparison belongs to the optional Evaluative category. Compare candidate counts under matched effort/compute budgets without requiring a second question when only one is worthwhile.

**Provisional acceptance — 7 November 2026:** Artem tentatively accepts this small-pool selection/update loop as an experiment starting point, while adding the no-API and small-GPT-generator constraints in D16. Treat it as the provisional baseline, not a final candidate count, selector, training objective or launch instruction. The next unresolved choice is next-decision versus whole-investigation optimization.

**Horizon explanation / next question — open:** A next-choice selector asks which eligible pair will best improve the next decision. It may still participate in an adaptive multi-question investigation by choosing again after each answer. A sequential policy instead learns which choices produce better whole-investigation outcomes, including delayed benefits of an early question. Artem requested this distinction be explained; no bandit-versus-sequential choice has been accepted. Proposed next decision: use the small LLM candidate pool → select one eligible pair/defer → update/regenerate loop as the first comparison setup, leaving exact count, selector and longer-horizon optimization to experiments.

**Proposed training design within the agreed data direction:** Begin with synthetic incidents whose hidden facts, plausible outcomes and each simulated person's knowledge are defined independently of the selector. Reveal only information available at the decision time. Select one action, reveal its response and assess supported decision benefit and effort; factual-question training does not require pairwise preference labels. Evaluative comparisons are a separate optional signal. A factual No can be valuable. Missing answers have unknown benefit; observed interruption cost can still be recorded. Keep scenario-family splits, held-out outcomes and repeat-run variation visible. Simulated success does not establish real engineer benefit. Later human interaction logs should preserve context, eligible actions, selected action, actual selection probability when randomized, responses and delayed outcomes. Offline comparisons need appropriate action coverage and logging assumptions. Reward components, observation windows, weights, model family and experiment acceptance criteria remain open.

**Agent workflow capability — closed; contract open:** An external agent may request an investigation, request a targeted clarification through the shared coordinator, and report attempted actions and outcomes under one trace ID. Source access, question budgets, duplicate suppression and answer attribution remain enforced by the service. See D15/T08 for the accepted direction and remaining tool/lifecycle details. This grants no arbitrary database access or direct human messaging authority.

**Question:** Does a long-horizon policy provide measurable value beyond choosing the next useful question?

**Proposed starting point:** Instrument first; use rules/supervised ranking. Evaluate a contextual bandit for the eligible question–recipient–timing decision and no-question action, with a separately measured recommendation objective. Use sequential RL only when later-state effects justify it.

**Alternatives:** Linear UCB, Thompson-style model or an eventual sequential policy after an environment is defined.

**Metrics:** Verified benefit per question/time, cumulative task success and errors on unseen scenarios.

**Experiment:** Compare policies in a documented synthetic environment; distinguish simulator success from human evidence.

## D19 — Generalization and reusable module boundaries

**Status:** User-established direction, 6 November 2026. Detailed module layout remains proposed.

**Decision:** Generalize across source platforms and organizations. Following the inspected Turku hackathon structure, put reusable logic and UI elements in focused `libs/utils/*` modules. Apps compose these modules; libraries do not import applications, benchmarks, experiments, scripts or deployment code. App-to-app imports and cyclic module dependencies are excluded.

**Rationale:** New sources, UI surfaces and evaluation runners should reuse the same evidence semantics and investigation behavior. Inject organization/provider configuration rather than hard-coding the demo environment.

**Open choices:** Exact modules, language/package tooling and deployment split. D01 settles the hackathon connector approach; a later integration framework is deferred. See [the proposed layout and connection contract](INTEGRATIONS.md).

**Acceptance check:** A new source can feed the common evidence contract without introducing a separate claim or recommendation engine; the UI, API/MCP and evaluation harness use the same core behavior.

## How to record a decision

Record the chosen option, alternatives tested, dataset/version, result, known limitations, owner and a reason to revisit it. A score without its task definition and test population is insufficient.

Do not optimize a single headline number. Report errors alongside autonomy, and expert burden alongside usefulness.
