# Knowledge Twin — technical discussion guide

**Since AI Hackathon · Elisa challenge · 6 November 2026**

Use this file to start a fresh technical planning session without needing the original chat. It records the current direction, the latest questions from Artem, and the decisions to work through. Proposed algorithms, schemas and thresholds are not final decisions.

## Start a new session

Open this repository and paste:

> Read `docs/TECHNICAL_DISCUSSIONS.md` and `docs/WORKSTREAMS.md`, then consult the relevant parts of `docs/VISION.md`, `docs/ARCHITECTURE.md` and `docs/ENGINEERING_DECISIONS.md`. I want to discuss the technical design of Knowledge Twin, not start implementation yet. Begin with T01: how evidence automatically forms cases, response histories and claims, and when a short Yes/No question is worth asking. Then work through T02: recommendation thresholds and what certainty means. Use one concrete incident throughout, distinguish my decisions from your proposals, compare practical alternatives, and help me choose the simplest defensible approach. Take one topic at a time. Record agreed decisions and remaining questions when I ask you to save the discussion.

To focus a session, replace the last part with:

- **Question policy / RL:** “Focus on T05 and T06. Define the state, eligible actions, observations, rewards, baselines and metrics before choosing an algorithm.”
- **Classification / clusters:** “Focus on T03 and T04. Explain conversation context, useful/uncertain/irrelevant labels, same-incident linking and recurring-pattern membership.”
- **Storage / architecture:** “Focus on T07 and T08. Trace an evidence item from import to an MCP response and later correction.”
- **Design / animation:** “Focus on T10. I will describe my visual and animation ideas first. Help define the experience and state transitions before generating or implementing assets.”

## 1. Where the project stands

The concept is an operational memory service that turns approved conversations, notes, images and other material into source-backed knowledge. It links that knowledge to equipment and incidents, preserves conditions and contradictions, and serves relevant context to engineers and autonomous agents.

The main loop is:

**Collect → interpret → organize claims/cases/outcomes → retrieve candidates → test applicability → assist or ask selectively → record new evidence and outcomes.**

The architecture, workstream breakdown and static pixel avatar are documented. The ingestion pipeline, trained policy, MCP service and packaged desktop application remain to be implemented. A diagram or proposed schema is not an implementation.

### Current product direction

- Collection, memory organization and runtime assistance are distinct mechanisms.
- Cases organize incidents; atomic claims carry their own evidence, uncertainty, applicability and validity.
- Useful operational facts can exist outside an incident, such as a site-key location.
- Hypothesis testing is central: predict additional observable traits, check them and revise applicability.
- Engineers contribute through minimal interactions. Yes/No is the primary question format; unknown/skip/later remain available.
- The system must have a supported reuse path that works without a new human answer.
- Organization-controlled deployment and approved data/model processing boundaries are requirements.
- Electron is the current framework direction for the full desktop app on macOS and Windows. Intended parity is not yet validated.
- The avatar is a white pixel circle with a small face. Further animation and design await Artem's direction.
- Build the points experience with an on/off switch, smooth visual rewards and optional sounds. It is optional to use; participation points do not determine truth or model reward. See [the experience brief](EXPERIENCE_BRIEF.md).
- The same knowledge/investigation service should serve both the UI and external agents through API/MCP.
- Learnable classification, ranking and question selection are part of the vision. The specific algorithms and training scope remain open.

## 2. Latest clarifications to preserve

### A. Will forming cases, reconstructing solutions and confirming claims mainly use Yes/No questions?

**Artem's question:** for these three mechanisms, will the system mainly ask engineers binary questions?

**Working recommendation, still to discuss:** Yes/No should be the dominant format when asking a person. Most routine extraction and linking should instead come from existing permitted conversations, metadata and observations. Ask when a consequential ambiguity remains, not as a mandatory confirmation step for every record. We have not established a measured automatic/human processing ratio.

| Mechanism | Automatic evidence first | Possible short question | Meaning of the answer |
| --- | --- | --- | --- |
| Form a case | Incident IDs, assets, time, thread links and contextual similarity | “Is this screenshot from incident 104?” | Supports or rejects that specific evidence-to-case link. |
| Link a recurring pattern | Compare symptoms, equipment, versions and conditions across separate cases | “Does this involve the same controller revision?” | Adds an applicability fact; does not merge the incidents. |
| Reconstruct a response | Extract attempts, ordering and reported outcomes from messages | “Did traffic return immediately after the interface reset?” | Adds an attributed sequence/outcome observation; does not prove causation. |
| Assess lasting recovery | Inspect follow-up messages or authorized measurements | “Did the same fault recur during the next shift?” | Qualifies recovery over that window; either answer can be informative. |
| Resolve a disputed claim | Compare scope, time and source lineage | “Was this observation made after the firmware update?” | May explain why apparently conflicting reports differ. |

One person's answer may be sufficient for a low-impact link under an agreed policy. Repeated agreement does not automatically establish a lasting resolution or general procedure. Several people repeating one original report are not several independent observations.

Unwritten explanations may occasionally need optional text or voice. Keep that separate from the default binary feedback interaction. The product should avoid turning every gap into a form.

### B. Only recommend knowledge above an appropriate certainty threshold

**Artem's position:** users should receive suggestions only when the system passes a suitable certainty threshold.

**Working interpretation:** preserve lower-support candidates internally as provisional knowledge, and gate recommendations on evidence and current applicability. Clarification requests are visibly questions, not low-confidence solutions disguised as recommendations. Asking also requires sufficient expected benefit and an available question budget.

Do not select one arbitrary percentage for the whole system. First define the event the score predicts: correct case link, supported claim, applicable procedure or helpful recommendation. Those are different targets. Similarity and an LLM's self-reported confidence are not automatically calibrated correctness probabilities.

Candidate gates to discuss:

1. Is the proposed statement supported by accessible source evidence?
2. Does it apply to the present asset, environment, time and symptoms?
3. Are consequential contradictions or missing preconditions unresolved?
4. Is offering it likely to help this decision enough to justify the interruption?
5. Does the proposed action stay within the authorized workflow?

These may combine deterministic eligibility rules and evaluated scores. A supported recommendation to perform a diagnostic check has different requirements from a recommendation to execute a disruptive fix. Keep “suggest a check” and “suggest a solution” explicit in the interface. If a threshold is not met, investigate further, ask one useful question, wait or abstain according to policy.

Numerical thresholds, calibration method, accepted error levels and the treatment of uncertain high-impact warnings remain open.

### C. Use available assistants, but design the collaboration carefully

**Artem's position:** he has access to paid Claude and ChatGPT tools and wants to use available assistant capacity for bounded tasks while focusing personally on difficult technical choices. He also wants a separate design/animation discussion and eventual specialist agent.

This is a resource and delegation preference, not a request to start implementation agents immediately. No specific subscription quota, API entitlement or concurrency limit is assumed here. Check the actual tool/account constraints when selecting an implementation route.

Useful assignments include parser implementation, synthetic scenario production, interface work against mocks, evaluation harnesses, documentation and design assets after art direction is agreed. Keep a coordinated owner for evidence semantics, shared schemas, reward definitions and evaluation criteria.

Multiple models can propose interpretations or review labels, but their agreement is not independent operational evidence. Use assistant capacity to compare approaches, identify counterexamples and inspect failures, not to manufacture confidence through repeated agreement.

## 3. Recommended discussion order

| Topic | Main question | Expected decision artifact | Related workstreams / decisions |
| --- | --- | --- | --- |
| T01 | What do we infer automatically, what remains provisional, and what is worth asking a person? | Evidence-to-case/claim state transitions and a small question catalogue. | W03–W05, W07 / D06, D07, D10, D12 |
| T02 | What must be true before we recommend a check or solution? | Eligibility rules, score meanings and a threshold-evaluation plan. | W05–W06 / D10, D11, D16 |
| T03 | How do we recognize useful context and phrase it without changing meaning? | Context-window strategy, labels, annotation rules and classifier baseline. | W02 / D02–D05 |
| T04 | How do we form incidents, discover patterns and connect responses? | Linking/clustering definitions, storage relationships and retrieval representations. | W03–W04, W06 / D06–D09, D11 |
| T05 | Which question should go to which person, when, and when should we stop? | Coordinator action/state contract and initial routing policy. | W07 / D12, D13 |
| T06 | What does the learning policy optimize and how do we know it improves? | Reward/metric definitions, logs, baselines and training/evaluation plan. | W06–W07, W10 / D13, D16, D18 |
| T07 | How is the memory stored, revised and kept accessible only to permitted users? | Minimal schema, source dependencies and update/deletion behavior. | W01, W03–W05, W10 / D01, D09, D14 |
| T08 | What does an autonomous agent request, receive and report through MCP? | Tool contracts and one complete consumer trace. | W08 / D15 |
| T09 | Which collection routes prove the idea with the least integration work? | Adapter boundaries, evidence envelope and first input formats. | W01 / D01, D14 |
| T10 | How should the companion feel, move and explain its state? | Interaction storyboard, avatar states and design-agent brief. | W09 / D17 |

Start with T01 and T02. T03–T04 and T07 then establish the objects the question policy acts on. T05–T06 define the learning problem. T08 can use draft contracts; T09 can start once the evidence envelope is agreed. T10 can proceed separately against explicit UI mocks.

## 4. Questions to work through in each session

### T01 — Automatic formation and minimal human questions

- What is the unit of evidence: message, passage, conversation window, attachment or observation?
- Which links can be automatic from exact identifiers, and which require contextual scoring?
- What does a provisional case/claim look like, and how can a false link be reversed?
- How do we reconstruct actions and outcomes while preserving unknown ordering and uncertainty?
- Which missing facts change a practical decision enough to justify a question?
- When is an attributed Yes/No sufficient, and when do we need a different source or later observation?
- What happens when no one answers or the question budget is zero?

**Finish with:** one incident traced from input to provisional claims, clarification and revised memory, including a path with no new human answer.

### T02 — Recommendation gates and certainty

- Which exact prediction needs a score, and what does its label mean?
- Which conditions are hard eligibility rules rather than learned thresholds?
- Do automatic linking, diagnostic checks and solution suggestions need separate operating points?
- How do we assess support, applicability and likely usefulness without treating them as interchangeable?
- Which validation examples contain convincing but wrong matches, stale advice or missing conditions?
- What error/burden limits should guide threshold selection, and how much useful coverage is lost?
- How do we communicate “not enough evidence” without implying that the historical claim is false?

**Finish with:** a policy table for recommend/check/ask/wait/abstain and an evaluation plan, not an invented confidence percentage.

### T03 — Classification and normalization

- Which labels cover useful facts, hypotheses, attempts, outcomes and irrelevant chatter?
- How much surrounding conversation is needed for short replies and interleaved incidents?
- Should the first comparison be prompted Flash-Lite versus frozen embeddings plus a supervised baseline?
- How will LLM-generated labels be audited, versioned and separated from test truth?
- Which identifiers, negations and uncertainty expressions must survive normalization?
- What costly false negatives deserve a separate evaluation slice?

**Finish with:** label definitions, example annotations and a baseline comparison. Exact model/version selection remains subject to task evaluation and available endpoints.

### T04 — Cases, patterns, responses and retrieval

- What distinguishes one incident from a repeated type of incident?
- Which structured constraints supplement semantic similarity: asset, date, version, site or thread?
- Do we need clustering in the first prototype, or can candidate linking represent the initial patterns?
- How can one case have competing hypotheses and one procedure apply to several patterns?
- What belongs in symptom/environment embeddings versus response/procedure representations?
- How are false merges, false splits, outliers and later corrections handled?
- Which traits were already used in retrieval, and which additional checks can meaningfully test the hypothesis?

**Finish with:** examples of same incident, related incidents and misleading lookalikes, plus the relationships to store.

### T05 — Distributed question coordination

- How do we generate neutral questions addressing one specific gap?
- How do we identify someone likely to know firsthand without creating a global employee score?
- Which evidence is already available from approved machine observations or conversation history?
- How do access rules, availability, cooldowns and question budgets restrict candidates?
- What is the baseline for ranking question–recipient–timing actions, including asking nothing?
- How are assignments reserved, expired or canceled to prevent duplicates?
- How do we distinguish contradictions from answers about different times or environments?
- What ends questioning, and what triggers re-evaluation later?

**Finish with:** a coordinator trace for two hypotheses, several possible recipients and a bounded question budget. Distributed participation initially uses shared coordination; it does not require one RL agent per engineer.

### T06 — Metrics, rewards and learning algorithm

- Define an eligible recommendation opportunity and avoid counting retries as new successes.
- How do we distinguish MCP context returned, agent-reported use, human helpfulness and observed outcomes?
- What counts as useful assistance, an unnecessary intervention and a missed useful opportunity?
- What gives a question value if its factual answer is No?
- How do delayed, missing, contradictory and self-reported outcomes enter training?
- Which parts are supervised prediction, which are contextual action selection, and which genuinely need sequential planning?
- What heuristic baseline must a learned policy improve on?
- What evidence would justify a contextual bandit, and later sequential RL?
- How will scenario/time splits, logged action probabilities when applicable, shadow evaluation and rollback work?

**Finish with:** state/actions/observations, task-specific reward definitions, metrics with denominators, a baseline and an experiment. Do not choose a deep-RL algorithm merely because binary feedback is available.

### T07 — Storage, updates and permissions

- What are the minimum tables/records for sources, evidence, claims, cases, entities, procedures, questions and decisions?
- How do typed edges express support, contradiction, supersession and applicability?
- How are event time, validity and unknown timestamps represented?
- What source lineage prevents copied summaries from becoming independent corroboration?
- Which derived records and indexes need re-evaluation after corrections, deletion or access changes?
- What is held in object storage, structured tables and regenerable vector indexes?
- Can the first workload be handled by PostgreSQL and typed relationships before introducing another database?

**Finish with:** a minimal schema and one update/deletion trace, including permission filtering before retrieval output reaches the model or user.

### T08 — MCP and autonomous use

- Should the first tool be high-level investigation, context retrieval, or both?
- What context must the caller provide: asset, action, symptoms, environment and time?
- How does the response express support, conditions, conflicts and missing checks?
- Where does authority to execute an operational action live?
- How does a consumer report adoption and outcomes against the correct decision and claim versions?
- How do UI and MCP consumers obtain consistent results under the same access rules?

**Finish with:** request/response examples for a supported recurrence and a conflicting lookalike, plus a clearly labeled simulated consumer if needed.

### T09 — Collection boundaries

- Which first inputs demonstrate fragmented knowledge: supplied chat/email, a local note and an image?
- What common evidence envelope preserves source IDs, authorship where allowed, timestamps and scope?
- How do deduplication, threading, incremental updates and deletion propagation work?
- What metadata is missing from a screenshot, and how is that uncertainty retained?
- Which future live connectors or continuous capture modes require a separate explicit activation flow?

**Finish with:** the first adapter contracts and fixtures. No mailbox access or background monitoring is implied by this planning session.

### T10 — Engineer experience and animation

Read [the experience brief](EXPERIENCE_BRIEF.md) for the latest rewards/points direction and [the pitch-film brief](PITCH_FILM_BRIEF.md) for the separate cinematic production task. Include people with relevant experience alongside knowledge recommendations.

- What visual personality and motion ideas does Artem want? Hear them before committing the design.
- What are the compact window, expanded history and question queue interactions?
- Which avatar states need distinct poses or motion, and which should stay quiet?
- How do questions appear without stealing focus, and how can a person answer later or dismiss them?
- How does the expanded view show source-backed history, alternatives and missing evidence?
- How should reduced motion, idle resource use and intended macOS/Windows behavior be evaluated?
- What asset format, state names and transition events should the design agent deliver to the UI implementer?

**Finish with:** a storyboard and asset/state contract. Avatar emotion should communicate application state; factual certainty remains explicit in the content. Points remain optional.

## 5. Common example for the discussion

Use the supplied synthetic TRN-042 scenario as an anchor. It describes an interface that is up after an SFP replacement, normal optical levels and cleared alarms, but no restored traffic. An older unit is suspected, an expert proposes a forwarding-state explanation and a counter check/interface reset, and the engineer reports traffic returning afterward. Preserve which statements are observations, hypotheses, advice and reported outcomes. Do not add independent telemetry, a full event date or lasting recovery that the supplied material does not establish.

For experiments, create explicitly labeled variants:

1. A genuine recurrence with the necessary matching conditions.
2. A similar symptom caused by a different problem.
3. An outcome that looks successful but recurs later.
4. One report copied into several channels.
5. Two engineers describing different time windows.
6. Useful site-access information with no fault incident.
7. A case where nobody answers a question.

Keep variant truth separate from what the system knows at each decision point. The supplied email and chat represent the same example, not independent successful trials. The source materials are in the ignored local `private/Elisa_SinceAI2026/` folder; do not assume a fresh clone contains them or publish them as part of a discussion update.

## 6. Record decisions without losing open questions

For each topic, capture:

```text
Topic / date:
User requirements:
Decision status: open / proposed / agreed / superseded
Concrete decision:
Alternatives considered:
Example and counterexample:
Input/output contract:
Evidence needed to validate:
Metric and denominator:
Known limitations:
Next bounded task / owner:
Related Dxx and Wxx items:
Reason to revisit:
```

Update the existing engineering decision entry when a choice is made, rather than leaving contradictory decisions in separate files. The discussion guide preserves questions; `ENGINEERING_DECISIONS.md` tracks decisions and experiments; `WORKSTREAMS.md` defines delegation boundaries; `VISION.md` communicates the current overall vision. The root README and `docs/README.md` provide navigation.
