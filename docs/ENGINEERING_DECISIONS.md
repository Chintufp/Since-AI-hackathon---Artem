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

## D01 — Source contract and first adapters

**Timing:** Before build

**Question:** Which sources prove the value with the least integration effort?

**Proposed starting point:** Start with Elisa JSON/email, pasted text/images and one local-file route. Define an evidence envelope before adding live connectors.

**Alternatives:** Exports versus one authorized live API; background file sync later.

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

**Proposed starting point:** Separate extraction confidence, support, applicability and authorization; provenance-aware assessment with explicit disputes.

**Alternatives:** Rules versus calibrated evidence model; task-specific required observations.

**Metrics:** False support promotion, stale advice, contradiction detection and reliability curves.

**Experiment:** Repeat one source five times, add an independent observation, then add recurrence.

## D11 — Retrieval and hypothesis testing

**Timing:** Prototype

**Question:** Which checks distinguish candidates, and how do we prevent circular confirmation?

**Proposed starting point:** Hybrid retrieval, environment filters and a small candidate set; predict additional traits before checking them.

**Alternatives:** Rank fusion/rerankers; rule-based check selection versus estimated information gain.

**Metrics:** Recall@k/nDCG@k; applicable-result precision; correct lookalike rejection; decisions improved per check.

**Experiment:** Compare vector-only, hybrid-only and hypothesis-checking versions on identical timed inputs.

## D12 — Question selection, routing and stopping

**Timing:** Before build

**Question:** When is asking worth it, who can answer firsthand, and when do we stop?

**Proposed starting point:** Shared coordinator checks machine evidence first, then ranks eligible question–recipient–timing actions or defers. Use decision impact, firsthand answerability, source independence and burden. Reserve and cancel assignments to avoid duplicate questions.

**Alternatives:** Heuristic score, learned ranker or contextual bandit.

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

**Proposed starting point:** get_context / investigate_problem return evidence, validity, disputes, gaps and conditions; writes are separately authorized.

**Alternatives:** High-level investigation tool versus composable search/check tools.

**Metrics:** Consumer decision quality, source support, integration latency and authorization failures.

**Experiment:** A small agent handles a recurrence and escalates a conflicting case using the same service.

## D16 — Evaluation and training lifecycle

**Timing:** Before build

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

**Timing:** Later research

**Question:** Does a long-horizon policy provide measurable value beyond choosing the next useful question?

**Proposed starting point:** Instrument first; use rules/supervised ranking. Evaluate a contextual bandit for the eligible question–recipient–timing decision and no-question action, with a separately measured recommendation objective. Use sequential RL only when later-state effects justify it.

**Alternatives:** Linear UCB, Thompson-style model or an eventual sequential policy after an environment is defined.

**Metrics:** Verified benefit per question/time, cumulative task success and errors on unseen scenarios.

**Experiment:** Compare policies in a documented synthetic environment; distinguish simulator success from human evidence.

## How to record a decision

Record the chosen option, alternatives tested, dataset/version, result, known limitations, owner and a reason to revisit it. A score without its task definition and test population is insufficient.

Do not optimize a single headline number. Report errors alongside autonomy, and expert burden alongside usefulness.
