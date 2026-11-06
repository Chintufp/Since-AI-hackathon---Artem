# Knowledge Twin — architecture reference

**Working design after the Elisa information session · 6 November 2026.**

This document accompanies [the interactive master map](master-map.html). It records proposed components, their contracts and the questions to settle. It does not claim an implemented application, trained policy or production access.

## The mental model

Approved sources become contextualized evidence. Useful passages become atomic claims. Claims bind to equipment and, where relevant, incidents. Separate incidents can connect through recurring patterns and reusable procedures. New problems retrieve candidate knowledge, predict additional observable traits, obtain evidence, and return qualified context through the companion or MCP.

There are two feedback clocks: evidence and human answers can update memory now; model weights and policies change only through training, evaluation and versioned deployment.

Cases remain the main organizing unit. Claims are the smaller units whose support, applicability and validity can differ. Useful site-access knowledge need not belong to a fault case.

## Confirmed direction and open choices

- Keep collection separate from memory organization and runtime assistance.
- Minimize specialist effort; Yes/No is a primary input, with unknown/skip/later available.
- Treat distributed questioning as participation across engineers coordinated by one service. Federated training or multi-agent RL is not assumed.
- Record evidence, contradictions, applicable entities and validity rather than assigning one truth score to a whole case.
- Organization-owned storage and approved inference boundaries are first-class requirements.
- The default avatar is a white pixel circle with dark pixel eyes, a tiny mouth and pink cheeks. A static SVG preview is provided; animation is deferred.
- Electron is the current framework direction for the whole desktop application on macOS and Windows. Shared core behavior is intended; neither platform build has been implemented or validated. PostgreSQL/pgvector/object storage, Flash-Lite, clustering algorithms and learning policies remain proposed implementation choices.

## LLM-generated labels

LLM annotation is a reasonable bootstrap for the hackathon and can also be useful in an authorized early real-data deployment. Generate scenario truth first, then conversations; annotate usefulness, claim type, entities and case pairs. Preserve teacher model/prompt version, evidence spans, label method and audit status.

The annotation label is not new evidence that an operational claim is true. Several models agreeing can reveal consistency, but not independent observation. Keep a separately reviewed evaluation set and audit ambiguous/rare cases. A teacher should only see the conversation prefix available at the evaluated moment; hidden scenario outcomes stay separate.

Split by scenario family before producing paraphrases or versions for different platforms. The provided email and Teams conversation describe one case, not two independent examples. Simulator-generated engineer feedback can test the pipeline but cannot demonstrate that real experts find the system useful.

## Where learning is used

| Task | Initial baseline | Possible learned model |
| --- | --- | --- |
| Operational usefulness | Prompted small LLM and explicit routing | Embeddings + logistic regression or another supervised classifier |
| Evidence-to-case/entity link | Exact IDs, context and candidate scoring | Pairwise classifier/ranker |
| Pattern discovery | Candidate neighbors and explicit constraints | Evaluated clustering such as agglomerative methods or HDBSCAN |
| Candidate retrieval | Hybrid exact/text/vector retrieval | Learned reranker |
| Question/check selection | Decision-value and burden heuristic | Contextual bandit |
| Multi-step investigation | Transparent policy and explicit eligibility | Sequential RL if justified by data and measured benefit |

## Proposed policy contract

**State:** current candidate hypotheses, supporting/contradicting observations, missing conditions, asset/environment, eligible tools, relevant recipients, previous answers and remaining question budget.

**Actions:** choose an eligible check; choose a question–recipient–timing action; defer or ask nothing; recommend a supported next step; or abstain. Shared coordination reserves assignments and cancels stale questions. Operational permission is not a trainable action.

**Transition:** a new observation or attributed answer changes the evidence state. Unknown/skip is missing information, not a negative truth label.

**Reward:** for an explicitly worded usefulness question, Yes=1 / No=0 is valid. For a factual question such as 'Did the fault recur?', the answer's content updates a claim; it is not automatically the usefulness reward for choosing that question. Question utility needs a defined outcome. A sequential objective may combine verified task success with time/question costs and error penalties, but no coefficients or final reward function have been selected.

**Training path:** versioned labeled data → supervised baselines → logged eligible decisions/outcomes → bandit experiment → optional multi-step RL. Define the environment before selecting PPO, DQN or another deep-RL algorithm. Avoid uncontrolled online weight updates after every click.

**Evaluation path:** independent scenario/time splits, audited labels, vector-only and heuristic baselines, coverage/error/burden together, then shadow comparison and explicit promotion or rollback. Off-policy estimators require appropriate action support, logging and assumptions.

## Utility and feedback contract

Optimize supported useful interventions per eligible opportunity, subject to agreed error, unnecessary-interruption and expert-burden limits. Track missed useful opportunities so always abstaining cannot win. Separate user/agent requests from proactive offers, deduplicate retries and keep the evaluation population fixed.

Measure helpful/assessed recommendations with feedback coverage, unnecessary proactive offers, missed opportunities, questions/minutes and task outcomes. In a labeled evaluation set, report useful coverage over all opportunities. In a pilot, missing feedback remains unknown; audit both offers and abstentions and report counts, scenario mix and uncertainty.

MCP context returned is exposure. Agent-reported context use is adoption. Human-reported helpfulness and independently observed outcomes are different evidence. Link these events by decision/trace ID, case and claim versions; retain reporter type, provenance and time. An agent rewarding its own advice is not independent validation.

Question utility is useful new evidence or improvement to a consequential decision, evaluated against hidden scenario truth or independent review. A factual No can be valuable. Reduced self-reported model uncertainty is only a proxy. Weights, thresholds, delayed-credit rules and missing-data handling remain open decisions.

A claim's factual support is separate from its recommendation usefulness. Repeated reads, copied messages and circular summaries are not independent observations. Engineers may describe different validity windows rather than disagreeing about the same event. Propagate corrections through typed source dependencies rather than assigning one confidence score to the entire graph.

## Component contracts

### Collect approved context

**Status:** Direction

Bring historical and new context into one evidence format, without making engineers document every incident.

**Inputs**

- Selected chat/email exports, MBOX/EML, local notes and files
- Pasted text or images; optional voice
- Explicitly activated, scoped source synchronization

**Outputs**

- Evidence envelope: source ID, item ID, original/reference, actors, thread links, timestamps and access scope

**Proposed approach:** Adapters first. Preserve structure; use explicit OCR only when direct text is unavailable. Start with supplied JSON/email and manual input.

**Rules**

- Authorization precedes collection. Source text is data, not agent instructions.
- No silent screen monitoring. Private sources stay within organization-approved storage and inference boundaries.
- Reimports must be idempotent; quote copies are not independent corroboration.

**Evaluate with**

- Import completeness within declared scope
- Duplicate suppression
- Permission leakage tests

**Discussion items:** D01, D14 in [the decision queue](ENGINEERING_DECISIONS.md).

### Assemble conversation context

**Status:** Proposed baseline

Make short replies such as 'yes' and 'did that' interpretable before filtering or extraction.

**Inputs**

- New source item
- Reply ancestors and nearby messages
- Accessible case summary and mentioned entities

**Outputs**

- Bounded context window with explicit message IDs
- Links to omitted context when available

**Proposed approach:** Reply-aware windows plus a source-linked rolling summary. Revisit provisional items when new messages arrive. Window size and retention are to be evaluated.

**Rules**

- Do not classify every sentence independently.
- Keep source/event time distinct from ingestion time; preserve unknown dates.
- A rolling summary cannot replace the cited messages.

**Evaluate with**

- Recall of meaningful short replies
- Extraction quality versus context cost
- Time to incorporate late evidence

**Discussion items:** D02, D03 in [the decision queue](ENGINEERING_DECISIONS.md).

### Classify usefulness

**Status:** Algorithm open

Detect operationally useful context, including access facts and constraints that are not faults.

**Inputs**

- Conversation window
- Entity and source context
- Optional embedding and metadata features

**Outputs**

- Useful: extract candidate claims
- Uncertain: retain temporarily and reconsider
- Irrelevant: do not promote to shared operational memory

**Proposed approach:** Prototype with a prompted small LLM. Compare a frozen embedding + regularized logistic regression student on labeled windows. Tune two routing thresholds on validation data.

**Rules**

- Classification decides usefulness, not truth or cluster membership.
- 'Going to dinner' is usually irrelevant; 'the site key is at reception' can be valuable without an incident.
- Uncertainty is an explicit route, not a forced yes/no decision.

**Evaluate with**

- Operational-information recall
- Precision-recall curve / PR-AUC
- False-discard rate by information type
- Escalation rate and inference cost

**Discussion items:** D03, D04, D05 in [the decision queue](ENGINEERING_DECISIONS.md).

### Extract atomic claims

**Status:** Proposed baseline

Turn useful passages into separately testable statements while keeping the incident narrative intact.

**Inputs**

- Relevant conversation context
- Source spans, image regions and entities

**Outputs**

- Typed claim candidates with original wording and normalized form
- Evidence references, attribution and uncertainty
- Suggested conditions and unresolved entity references

**Proposed approach:** Gemini Flash-Lite candidate with schema-constrained output and deterministic validation. Exact version and quality thresholds remain open.

**Rules**

- Schema-valid output can still be wrong.
- Separate 'service recovered' from 'this action caused lasting recovery'.
- Store extraction confidence separately from evidential support.
- The readable history is a sourced sequence of events, not hidden model reasoning.

**Evaluate with**

- Evidence-supported extraction precision/recall
- Unsupported claim rate
- Entity, negation and temporal accuracy

**Discussion items:** D05, D06 in [the decision queue](ENGINEERING_DECISIONS.md).

### Form and update cases

**Status:** Direction

Collect related observations and attempts into a case that can evolve as new information arrives.

**Inputs**

- Claim candidates
- Asset/thread/incident identifiers
- Existing cases and authorized context

**Outputs**

- New case or reversible link to an existing case
- Open, unknown-outcome or documented-resolution state
- Structured problem description and evidence timeline

**Proposed approach:** Exact identifiers and temporal constraints first; semantic candidate retrieval and pairwise scoring for ambiguous links. Useful asset facts can exist without an incident.

**Rules**

- Same incident and similar problem are different relations.
- A case can remain provisional before a cause is established.
- One source item can contain claims about multiple cases.
- Do not force all useful context into problem clusters.

**Evaluate with**

- Same-incident link precision/recall
- False merge and false split rates
- Time to detect a meaningful new case

**Discussion items:** D06, D07 in [the decision queue](ENGINEERING_DECISIONS.md).

### Resolve entities and case links

**Status:** Algorithm open

Bind claims to the right equipment, service, people and incident, with uncertainty preserved.

**Inputs**

- Extracted mentions
- Approved inventory and identity mappings
- Candidate cases and evidence

**Outputs**

- Entity links with source and method
- Same-incident / related-pattern / unresolved relationships

**Proposed approach:** Known IDs and aliases, then constrained similarity and model-assisted scoring. A binary answer may supply a positive or negative evidence-to-case pair.

**Rules**

- Shared display names do not establish identity.
- A No for case A is not automatically a Yes for case B.
- Ambiguous links are reversible; cross-platform conversation continuation needs more than text similarity.

**Evaluate with**

- Entity linking accuracy
- High-impact false-link rate
- Pairwise link precision/recall

**Discussion items:** D06, D07, D14 in [the decision queue](ENGINEERING_DECISIONS.md).

### Discover recurring patterns

**Status:** Algorithm open

Group recurring situations for retrieval and analysis without asserting a common cause merely from similarity.

**Inputs**

- Case symptom/environment embeddings
- Structured conditions and must-link/cannot-link feedback

**Outputs**

- Candidate pattern memberships
- Outliers/new patterns
- Connections to procedures and counterexamples

**Proposed approach:** Start with nearest-neighbor candidate groups plus entity/environment checks. Compare HDBSCAN or agglomerative clustering when data supports it. Do not choose cluster count or distance threshold by intuition alone.

**Rules**

- Cluster membership is not causal proof.
- Same-case evidence is merged conservatively; recurring incidents remain separate cases.
- A case may relate to several patterns; a pattern may have several procedures.
- Keep diagnosis-time representations separate from later resolution text.

**Evaluate with**

- Pairwise precision/recall for related cases
- False merges and outlier coverage
- Retrieval gain on held-out incidents
- Silhouette only as a secondary geometry diagnostic

**Discussion items:** D07, D08 in [the decision queue](ENGINEERING_DECISIONS.md).

### Organization-owned memory

**Status:** Proposed baseline

Keep operational facts, their evidence and their evolution independently inspectable and correctable.

**Inputs**

- Evidence, claims, entities, cases and relations
- Observations, answers, corrections and permission changes

**Outputs**

- Permission-filtered context for search, questions and MCP
- Versioned case histories and procedures

**Proposed approach:** PostgreSQL tables/JSONB and typed edges; pgvector for semantic candidates; object storage for permitted originals. A dedicated graph database is optional after query evaluation.

**Rules**

- Embeddings are search indexes, not the source of truth.
- Storage location and inference location are separate organization choices.
- Track source-to-claim dependencies for deletion, corrections and access revocation.
- Facts remain outside model weights initially.

**Evaluate with**

- Permission enforcement
- Correction/deletion propagation latency
- Query latency and provenance completeness

**Discussion items:** D09, D14 in [the decision queue](ENGINEERING_DECISIONS.md).

### Reconcile evidence and validity

**Status:** Direction

Update what is currently supported without silently rewriting history.

**Inputs**

- New claims and direct observations
- Engineer answers with question context
- Source changes, dates and environment changes

**Outputs**

- Updated claim support and applicability
- Disputed or superseded claims
- Revalidation needs and downstream invalidation

**Proposed approach:** Explicit transition rules plus model-proposed relationships. Compare scope and time before calling two claims contradictory; assess independent provenance.

**Rules**

- Temporary recovery followed by recurrence can make both reports true.
- Many quotations of one source are one underlying account.
- No fixed vote count proves a cause.
- Unknown dates remain unknown; unbounded valid_to means still believed applicable, not eternally true.

**Evaluate with**

- Contradiction/supersession accuracy
- False promotion of unsupported claims
- Stale advice rejection

**Discussion items:** D09, D10 in [the decision queue](ENGINEERING_DECISIONS.md).

### Retrieve candidate knowledge

**Status:** Proposed baseline

Find relevant cases, claims and constraints for a new problem or a planned action.

**Inputs**

- Original and normalized query
- Asset, environment, version, action and time
- Caller permissions

**Outputs**

- Ranked eligible candidate cases/claims
- Source evidence and applicability conditions

**Proposed approach:** Hybrid full-text/exact search and vector similarity; rank fusion then optional reranking. Choose embedding model, top-k and fusion method on evaluation data.

**Rules**

- Filter permissions before model context construction.
- Similarity is a retrieval score, not probability of a true cause.
- Return relevant disputes and constraints, not only positive solutions.
- No future outcome text may leak into a diagnosis-time query.

**Evaluate with**

- Recall@k and nDCG@k
- Applicable-result precision
- Latency/cost and restricted-result leakage

**Discussion items:** D08, D11, D14 in [the decision queue](ENGINEERING_DECISIONS.md).

### Form competing hypotheses

**Status:** Direction

Turn similarity into a testable explanation of whether historical knowledge applies now.

**Inputs**

- Candidate cases and source-backed explanations
- Current observations and known constraints

**Outputs**

- Hypothesis records
- Predicted additional observations
- Contradicting conditions and discriminating checks

**Proposed approach:** Source-grounded model proposes a small candidate set. Choose checks by expected decision value, observability and effort; numerical information gain is a later evaluated option.

**Rules**

- Record predictions before evaluating newly obtained/held-out observations.
- Facts already used to retrieve a case do not count as new confirmation.
- No fabricated alternatives just to show multiple options.
- Multiple LLMs agreeing are not independent operational evidence.

**Evaluate with**

- Accuracy of predicted traits on held-out evidence
- Diagnostic value per check
- Correct rejection of lookalikes

**Discussion items:** D10, D11, D12 in [the decision queue](ENGINEERING_DECISIONS.md).

### Obtain distinguishing evidence

**Status:** Direction

Check what a hypothesis predicts using available authorized observations.

**Inputs**

- Candidate tests and preconditions
- Permitted logs, inventory and existing conversation evidence

**Outputs**

- Observed match, contradiction, unknown or not-applicable
- Question candidates when a human can resolve a useful gap

**Proposed approach:** Prefer existing evidence and permitted read-only checks. Queue a targeted question when the expected decision benefit exceeds effort and interruption cost.

**Rules**

- Missing is not absent; unknown is not failure.
- Do not repeat a question already answered in the source.
- A test's observation and its interpretation are stored separately.
- Permission to retrieve context does not authorize remediation.

**Evaluate with**

- Outcome-changing observations per check
- Avoidable human questions
- Check latency and failed-tool handling

**Discussion items:** D10, D12, D15 in [the decision queue](ENGINEERING_DECISIONS.md).

### Assess applicability

**Status:** Algorithm open

Choose a response based on evidence, uncertainty, environment and action impact.

**Inputs**

- Hypotheses and test results
- Procedure conditions and known failures
- Organization policy

**Outputs**

- Supported candidate(s) with qualifications
- Next check or explicit unresolved gap
- Machine-readable decision record

**Proposed approach:** Transparent baseline rules and calibrated scoring where data exists. Thresholds depend on action impact; compare against vector-only retrieval.

**Rules**

- Extraction confidence, evidential support and applicability are separate dimensions.
- A procedure can be useful without claiming universal causality.
- Question budget exhausted means retain uncertainty, not force acceptance.
- Safety/permissions are hard eligibility constraints, not learned rewards.

**Evaluate with**

- Incorrect advice versus autonomous coverage
- Calibration/reliability by task
- Correct abstention and missed useful answers

**Discussion items:** D10, D11, D15 in [the decision queue](ENGINEERING_DECISIONS.md).

### Serve agents through MCP

**Status:** Direction

Let an operational agent use the same evidence service as the companion.

**Inputs**

- Asset/problem/planned action/time
- Authenticated caller scope

**Outputs**

- Relevant claims and sources
- Validity, conflicts, preconditions and missing checks
- Applicable procedure or useful question
- Decision/trace and claim-version references for later adoption/outcome feedback

**Proposed approach:** Thin API/MCP adapter over the investigation service. Draft tools: get_context, investigate_problem, get_case_evidence, record_observation, record_outcome and submit_feedback.

**Rules**

- MCP is an interface, not the memory or learning algorithm.
- Reads and writes have separate permissions.
- An operational agent communicates with the engineer under its approved workflow.
- Operational execution requires separate authority.
- A context read only proves exposure. Agent-reported use and independently supported help require separate events.

**Evaluate with**

- Schema-valid and source-supported responses
- Consumer task success
- Authorization and integration tests

**Discussion items:** D15 in [the decision queue](ENGINEERING_DECISIONS.md).

### Observe what happened

**Status:** Direction

Close the evidence loop and distinguish a useful suggestion from a lasting resolution.

**Inputs**

- Action record
- Telemetry or attributed report
- Optional binary usefulness/resolution feedback

**Outputs**

- Outcome observations with window and source
- Case updates and possible procedure revisions
- Task-specific labels or delayed rewards

**Proposed approach:** Explicit event records; later evidence may qualify an earlier result. Missing-resolution cases accept a short manual or voice contribution.

**Rules**

- Ticket closed is not proof of root cause.
- Helped and resolved can both be binary, but remain different questions.
- Do not infer an action was performed merely because it was suggested.
- Correlation after an action is recorded with its evidence limits.
- An agent saying it used knowledge is adoption evidence, not independent proof that the knowledge helped.

**Evaluate with**

- Reported versus independently observed resolution
- Recurrence within a defined window
- Outcome attribution completeness

**Discussion items:** D10, D13, D16 in [the decision queue](ENGINEERING_DECISIONS.md).

### Coordinate targeted questions

**Status:** Policy open

Distribute tiny questions across relevant engineers without broadcasting every uncertainty to everyone.

**Inputs**

- Unresolved high-value claims/checks
- Case participation and permitted expertise links
- Availability, cooldown and personal question budget

**Outputs**

- One neutral, scoped question
- Eligible recipient and delivery timing
- Logged candidate set and decision context
- No-question/defer decision when expected benefit does not justify burden

**Proposed approach:** Start with a shared coordinator ranking eligible (question, recipient, timing) actions by likely firsthand answerability, decision impact, evidence independence and burden. Include defer/no-question. Reserve assignments, expire stale questions and cancel resolved duplicates. Later compare a contextual bandit with this baseline.

**Rules**

- Distributed participation uses shared coordination; no federated training or consensus network is assumed.
- Source independence is about provenance, not number of people.
- Do not reveal restricted case details in a question.
- Stop when useful uncertainty is resolved; never ask until the model receives agreement.
- Choose a person for this particular gap, not a global popularity or employee ranking.

**Evaluate with**

- Useful evidence per question
- Interruptions/minutes per engineer
- Response/skip rate and load distribution
- Downstream decision improvement

**Discussion items:** D12, D13, D14 in [the decision queue](ENGINEERING_DECISIONS.md).

### Engineer answers quickly

**Status:** Direction

Get a small, interpretable contribution without a documentation task.

**Inputs**

- Question with equipment/time context
- Optional source snippet and why this person was asked

**Outputs**

- Answer linked to question, claim, person and time
- Optional explanation or evidence
- Skip/dismiss events kept distinct from negative labels

**Proposed approach:** Two primary buttons, with unknown/later/dismiss options. User-configured question budget is a ceiling, not a quota. Reuse already stated answers.

**Rules**

- Yes/No is sufficient for many labels; uncertainty must still be expressible.
- A person's answer is attributed evidence, not universal truth.
- Equal participation credit for useful confirmations and corrections.
- Points, answer count and seniority do not automatically weight truth.

**Evaluate with**

- Answer time and completion rate
- Correction rate after review
- Question comprehension and avoidable repeat prompts

**Discussion items:** D12, D13, D17 in [the decision queue](ENGINEERING_DECISIONS.md).

### Electron desktop application

**Status:** Direction

Provide a low-friction input and question surface, with a full evidence history on expansion.

**Inputs**

- Pasted text/images, dropped files and optional voice
- Question queue and active case

**Outputs**

- Manual problem or contribution
- Binary answers and correction events
- Expanded history and user-reviewed contact draft

**Proposed approach:** Electron is the current framework direction for the whole desktop application on macOS and Windows. Share the compact input and expanded history UI; adapt OS entry points, permissions and window behavior. Default avatar: white pixel circle, small dark eyes/mouth and pink cheeks. Animation is deferred; no platform build is implemented or validated yet.

**Rules**

- Do not steal focus or force questions.
- Click to open; snooze/dismiss; quiet pending state.
- Points toggle is independent of assistance and source permissions.
- No automatic messaging of colleagues without authorization.

**Evaluate with**

- Time to submit context or answer
- Idle resource use
- Usability and interruption burden
- Same core workflow on validated macOS and Windows builds

**Discussion items:** D17 in [the decision queue](ENGINEERING_DECISIONS.md).

### Build labeled datasets

**Status:** Proposed bootstrap

Create training material before substantial real feedback exists, while tracking which labels are trustworthy.

**Inputs**

- Scenario specifications and generated conversations
- LLM-generated labels and evidence spans
- Audited labels and authorized engineer feedback

**Outputs**

- Task-specific versioned training/validation/test splits
- Label provenance, abstentions and disagreement queue

**Proposed approach:** Write scenario facts/outcomes first; render noisy multi-message conversations. Let a capable LLM annotate usefulness, entity links, case pairs and claim types. Audit a sample and disagreements; keep a separately reviewed test set.

**Rules**

- LLM labels are acceptable bootstrap labels, not proof that an operational claim is true.
- Annotators label only information visible at the evaluated time; hidden scenario truth is held separately for outcomes.
- Split scenario families before paraphrases, templates or cross-platform retellings.
- Real data requires an approved model endpoint; no automatic external upload.

**Evaluate with**

- Agreement with audited labels by task
- Rare-event and contradiction coverage
- Label leakage and duplicate checks
- Teacher-to-student performance gap

**Discussion items:** D03, D04, D16 in [the decision queue](ENGINEERING_DECISIONS.md).

### Train classifiers and rankers

**Status:** Proposed baseline

Learn cheap repeatable decisions from explicit labels without training the entire foundation model.

**Inputs**

- Audited/LLM-labeled windows and case pairs
- Frozen embeddings plus selected structured features
- Versioned splits and label-quality metadata

**Outputs**

- Usefulness classifier
- Evidence/case linking model
- Optional candidate reranker

**Proposed approach:** Start with regularized logistic regression for binary tasks; tune regularization and thresholds on validation splits. Compare to prompted LLM and simple rules. Add model complexity only when errors justify it.

**Rules**

- Task labels remain separate: belongs, useful and resolved do not collapse into one target.
- Keep embeddings/model versions recorded.
- Use evaluation to choose how weak labels are filtered or weighted.
- This training is distinct from memory updates and from RL.

**Evaluate with**

- PR-AUC and class-specific recall/precision
- Pairwise link errors
- nDCG@k for ranking
- Calibration, latency and cost

**Discussion items:** D04, D05, D07, D11 in [the decision queue](ENGINEERING_DECISIONS.md).

### Log decisions and outcomes

**Status:** Direction

Make policy improvement and evaluation possible without treating every interaction as an immediate training update.

**Inputs**

- Question/recommendation candidate set
- Chosen action, eligible recipients and policy version
- Feedback, observation windows and delayed outcomes
- MCP exposure, agent-reported use, human helpfulness and observed outcomes with reporter provenance

**Outputs**

- Decision episodes and task-specific examples
- Reward eligibility/censoring information
- Logged selection probabilities when randomized

**Proposed approach:** Append structured records with source permissions, data minimization and retention. Separate operational evidence from preference labels and policy rewards.

**Rules**

- No answer is missing/censored, not reward zero.
- A claim-denying No can still be a useful question outcome.
- User points are not the model reward.
- Sensitive payloads do not belong in generic diagnostic logs.
- Join delayed signals by decision/trace ID and claim version. Deduplicate retries; preserve disagreements.

**Evaluate with**

- Decision/outcome linkage completeness
- Propensity coverage when applicable
- Delayed-feedback and missingness rates

**Discussion items:** D13, D14, D16 in [the decision queue](ENGINEERING_DECISIONS.md).

### Learn question / suggestion policy

**Status:** Later experiment

Learn which eligible question, recipient or recommendation is useful in the current context.

**Inputs**

- State features and eligible action features
- Logged actions, propensities and meaningful binary outcomes

**Outputs**

- Versioned action-ranking policy
- Measured change in utility and burden

**Proposed approach:** Candidate: linear UCB or Thompson-style contextual bandit, chosen after feature/reward design. Start with a rule baseline and synthetic replay. Explore only eligible, low-impact options.

**Rules**

- Never reward agreement as a proxy for truth.
- Permission and operational safety stay outside policy optimization.
- Offline comparison needs overlap/support and correct logging assumptions.
- LLM-simulated engineers are useful for plumbing tests, not proof of human benefit.
- MCP exposure is not usefulness; agent-reported adoption and human/observed outcomes are different signals.

**Evaluate with**

- Supported useful interventions per eligible opportunity
- Recommendation usefulness with assessed/unknown counts
- Unnecessary proactive offers and missed useful opportunities
- Questions/minutes and per-person load
- Offline estimate uncertainty / controlled comparison

**Discussion items:** D12, D13, D16 in [the decision queue](ENGINEERING_DECISIONS.md).

### Sequential diagnostic policy

**Status:** Research option

Optimize a sequence of checks and questions when early actions affect later information and outcomes.

**Inputs**

- Multi-step investigation episodes
- Well-defined environment and terminal outcomes
- Action eligibility constraints

**Outputs**

- Policy for next check, question, wait, recommend or abstain

**Proposed approach:** Define the MDP/POMDP abstraction before selecting a deep RL algorithm. Compare against the heuristic and contextual-bandit baselines. Exact algorithm and sample requirements remain open.

**Rules**

- We are not committing to PPO/DQN merely because the interface has feedback.
- Reward components require defensible evidence and separate reporting.
- Do not learn operational permissions or execute disruptive exploration.
- This stage is not required for a working hackathon knowledge loop.

**Evaluate with**

- Verified task success
- Cumulative question/time cost
- Wrong-action rate
- Generalization to unseen scenario families

**Discussion items:** D13, D16, D18 in [the decision queue](ENGINEERING_DECISIONS.md).

### Evaluate and calibrate

**Status:** Direction

Decide whether a new model or policy earns its complexity and is ready for limited deployment.

**Inputs**

- Candidate models/policies
- Separately reviewed held-out scenarios
- Permission, stale-knowledge and contradiction tests

**Outputs**

- Task metrics and failure slices
- Calibrated thresholds where supported
- Promotion or rejection of the candidate version

**Proposed approach:** Chronological/scenario-family splits; replay only information known at each step. Compare vector-only retrieval, hybrid retrieval, hypothesis checks and learned policies on the same inputs.

**Rules**

- Do not evaluate solely with the model that generated the labels.
- Report synthetic versus real evidence and sample sizes.
- Autonomous coverage and correctness must be reported together.
- A better self-reported confidence score is not evaluation.

**Evaluate with**

- Evidence support, applicable retrieval and false merges
- Brier/log loss plus reliability plots where meaningful
- Autonomous coverage, expert minutes and errors
- Latency/cost and access-control failures
- Useful coverage versus unnecessary proactive offers, including abstentions and missing feedback

**Discussion items:** D10, D11, D16 in [the decision queue](ENGINEERING_DECISIONS.md).

### Version and deploy deliberately

**Status:** Proposed baseline

Let evidence update memory immediately while model changes follow an evaluated release path.

**Inputs**

- Approved model/policy version
- Evaluation results and rollback target

**Outputs**

- New classifier/ranker/question policy
- Audit of behavior changes and monitoring

**Proposed approach:** Batch retraining, shadow evaluation and explicit promotion for the prototype. Avoid uncontrolled per-click weight updates.

**Rules**

- Memory update and weight update run on different clocks.
- Retain reproducible model/prompt/embedding versions.
- Reevaluate when device/software/source distributions change.
- Self-hosted storage and approved inference provider are independent configuration choices.

**Evaluate with**

- Regression and drift indicators
- Rollback readiness
- Performance by environment/problem family

**Discussion items:** D14, D16, D18 in [the decision queue](ENGINEERING_DECISIONS.md).

## Proposed storage schema

### evidence_items

Permitted source material and its provenance.

- id, organization_id, source_id, source_item_id
- content_ref, content_hash, media_type, source_span
- author_ref, thread_ref, event_time?, received_at
- access_scope_id, retention_policy_id, deletion_state

One item can support many claims; a claim can have several source items.

### claims + claim_revisions

Atomic statements and evolving interpretation.

- claim_id, revision_id, claim_type, statement_original, statement_normalized
- subject_entity_id?, predicate, value_json, attribution
- conditions_json, valid_from?, valid_to?, recorded_at, superseded_at?
- support_status, extraction_score?, scoring_method/version
- access_scope_id, extractor_model_version, prompt_version

Keep support status, extraction confidence, applicability and operational approval separate.

### claim_evidence

Why a source matters to a particular claim.

- claim_revision_id, evidence_id, source_span
- relation: supports / contradicts / qualifies / reports
- provenance_group_id, directness, assessment_method

Provenance groups prevent an email retelling and quoted chat from becoming independent votes.

### entities + entity_links

Assets, sites, services and verified person identities.

- entity_id, organization_id, entity_type, external_id?, aliases
- from_entity_id, relation_type, to_entity_id
- valid_from?, valid_to?, source_evidence_id

Person contribution is scoped to a case; ownership/identity needs its own evidence.

### cases + case_events + case_claims

One incident, its environment and its history.

- case_id, title, status, original_problem, normalized_problem
- asset_refs, environment_json, time_range?, access_scope_id
- event_id, event_type, event_time?, claim_id, evidence_id
- link_state: proposed / accepted / rejected; linking_method

Same incident links merge context conservatively. Similar recurrence is a relation between separate cases.

### patterns + memberships + procedures

Recurring relationships and reusable responses.

- pattern_id, descriptor, version, membership_case_id, link_state
- procedure_id, version, preconditions_json, steps_json
- verification_json, rollback_ref?, applicability_scope
- supporting_claim_ids, counterexample_case_ids

Many-to-many: cases ↔ patterns ↔ procedures. No mandatory one-cluster/one-fix mapping.

### hypotheses + checks + observations

Testable explanations for the current investigation.

- hypothesis_id, case_id, candidate_refs, explanation
- predicted_trait, contradiction_condition, created_before_check_at
- check_id, evidence_method, eligibility, cost_estimate?
- observation_state: match / contradiction / unknown / not_applicable

An observation references evidence. Reusing a retrieval symptom is not a fresh test.

### questions + responses

The precise meaning of each tiny human answer.

- question_id, claim_id/check_id, wording, recipient_ref
- eligibility_context, policy_version, offered_at, expires_at?
- response: yes / no / unknown / skipped / later
- answered_at, respondent_ref, evidence_ref?, revision_ref

A response is attributed evidence. Question dismissal does not imply a false claim.

### decision_logs + outcomes + rewards

Training and evaluation records with explicit targets.

- decision_id, context_ref, eligible_actions, selected_action
- policy_version, selection_probability?, decision_time
- outcome_type, outcome_value, observed_at, source_ref
- reward_definition_version, reward_value?, feedback_missing_reason

Preference, factual observation and reward remain distinguishable. User points live separately.

### embeddings + model_versions

Regenerable search/learning representations.

- record_id, record_type, representation_kind
- model_id, dimensions, normalized?, vector
- content_revision, created_at, access_scope_id
- model_version, dataset_version, eval_report_ref

Embed symptoms/environment separately where useful; retain exact text and provenance elsewhere.

## Claim example and limits

For TRN-042, keep 'traffic did not recover after SFP replacement', 'older unit, approximately 2019', 'forwarding-state issue suspected', 'interface reset advised', and 'traffic returned afterward' as distinguishable claims/events with source links. The unit age remains uncertain. The outcome is reported by the engineer; independent telemetry and lasting recovery are not supplied.

Do not fabricate an event date from the file or briefing date. Keep the supplied message sequence and times, with date unknown. Validity and time-aware querying must explicitly handle missing information.

## Prototype boundary

First prove one complete path: import existing context → extract/link claims → preserve uncertainty → obtain one useful missing observation if needed → update evidence → serve qualified context to an agent through MCP → record the outcome. Demonstrate a second held-out recurrence and a lookalike that should be rejected or qualified.

Live mailbox productization, broad screen capture, a dedicated graph database, advanced animation, sequential RL and many connectors can follow. The master map includes the full vision so its interfaces are visible; it is not a commitment to build every block during the hackathon.

## Sources

- [Elisa official brief, version 3 November 2026](../private/Elisa_SinceAI2026/Elisa_x_SinceAI_2026_Challenge_Brief_FINAL.pdf): User-supplied local source. Primary criterion: usability/minimal expert work. Context assertions bind to entities and time validity.
- [Elisa synthetic Teams example](../private/Elisa_SinceAI2026/ELISA_HIDDEN_KNOWLEDGE_EXAMPLE_2026/teams_chat.json): One case, 12 messages, illustrative people/equipment. Times only; no event date supplied. Email is another rendering, not an independent trial.
- [LLMs for text annotation — Gilardi et al.](https://arxiv.org/abs/2303.15056): Evidence that LLM annotation can be useful on studied tasks; not a guarantee for telecom truth verification.
- [Active Learning Literature Survey — Settles](https://burrsettles.com/pub/settles.activelearning.pdf): Background on choosing informative labels and variable annotation costs.
- [Contextual bandits — Li et al.](https://arxiv.org/abs/1003.0146): A candidate framework for context-dependent choices; the paper's application is news recommendation, not this system.
- [Probability calibration — scikit-learn](https://scikit-learn.org/stable/modules/calibration.html): Reliability requires evaluation; similarity and model self-confidence are not calibrated truth probabilities.
- [Logistic regression — scikit-learn](https://scikit-learn.org/stable/modules/generated/sklearn.linear_model.LogisticRegression.html): Candidate supervised baseline for explicit classification tasks.
- [HDBSCAN — scikit-learn](https://scikit-learn.org/stable/modules/generated/sklearn.cluster.HDBSCAN.html): Optional clustering candidate; choose against task metrics rather than adopting it automatically.
- [MCP server concepts](https://modelcontextprotocol.io/docs/learn/server-concepts): Interface concepts; the proposed tools are not yet implemented.
- [Electron desktop framework](https://www.electronjs.org/docs/latest/): Cross-platform framework for the desktop application. Shared behavior is intended; project builds and OS parity are not implemented or validated.

Local private-source links are intentionally not public repository assets. Public references support method descriptions, not claims that these methods have already succeeded in this project.
