# Knowledge Twin — history of the technical-design chat

**Recorded 7 November 2026 · Discussion and documentation, not implementation**

## How to read this history

Artem requested a record of what this chat discussed, what was answered, the reasoning behind the answers, and what was rejected. This is a chronological account of the main decisions and changes of direction, reconstructed from the conversation and its saved decision notes. It is not a verbatim transcript. Wording attributed to either participant is paraphrased unless explicitly quoted.

The status distinctions matter:

- **Agreed / closed:** Artem accepted the stated scope. This does not mean implemented or validated.
- **Provisional:** a possible starting point, with details still subject to discussion or experiments.
- **Rejected / corrected:** an explicit refusal or a framing that the conversation moved away from. An assistant explanation alone is not a user-approved decision.
- **Deferred:** excluded from the current scope, without rejecting its future value.
- **Experiment:** agreed to compare, not agreed to adopt.
- **Unanswered:** no accepted answer. Implementation convenience must not silently close it.

Use [ENGINEERING_DECISIONS.md](ENGINEERING_DECISIONS.md) for current decision scope, [TECHNICAL_DISCUSSIONS.md](TECHNICAL_DISCUSSIONS.md) for the discussion checklist and [OVERNIGHT_TECHNICAL_HANDOFF.md](OVERNIGHT_TECHNICAL_HANDOFF.md) for the build/experiment proposal. This file explains how we reached that state; later decisions can supersede this snapshot.

## 1. Starting point: T01, then T02, without implementation

**Artem's request:** read the technical discussions and workstreams; discuss automatic evidence versus human questions first, then recommendation thresholds, using concrete examples and one decision at a time.

**Working questions:** How much knowledge can be reconstructed automatically? When should an engineer be asked? What support is enough to reuse a historical response?

**Boundary established:** technical discussion and saving documents were authorized. Building connectors, running experiments or starting implementation agents was not. Later requests repeatedly preserved this boundary.

**Process correction:** Artem explicitly asked that every closed point be identified as closed, followed by the next question, and that status lists cross out closed points. The intention was to make progress and remaining uncertainty easy to follow.

## 2. Historical memory should already exist in the scenario

**Initial assistant framing:** should clear statements from existing sources enter memory without new human confirmation?

**Artem's correction:** the challenge can assume the technology has already been present for some time. There is synthetic data already, more can be generated, and agents can classify or label a historical portion while reserving or generating other material for later demonstration.

**Reasoning:** the product should be able to start with useful accumulated knowledge. First-time onboarding and asking a person to approve every imported statement would distract from that intended state.

**Outcome:** prepared synthetic history became part of the planning context. Upload/onboarding was saved as a UI idea for another agent. Automatic reconstruction of the supplied TRN-042 history remained useful. Exact historical/incoming/evaluation splits and whether to include explicitly simulated past engineer answers were left open.

**Important distinction:** synthetic preparation and labels can support development and demonstration, but they are not real historical human validation. The question about adding simulated past answers was postponed when Artem asked to settle source platforms and extraction first.

## 3. Source coverage, Git and generalization

**Artem's questions:** Teams, email, Slack—what else? Could Git be included? Could companies connect many systems through a simple interface, rather than us designing a separate core for every platform?

**Explanation developed:** provider-specific adapters preserve each platform's identities, threads, timestamps, revisions and access information, then map content into a common evidence contract. The knowledge and investigation layers work above that contract.

```text
Teams / Slack / email / files and other sources
                         ↓
                   Source adapters
                         ↓
                Common evidence records
                         ↓
          Interpret context and extract claims
                         ↓
                Shared knowledge memory
```

**Reasoning:** a common setup experience and shared ingestion contract make the architecture extensible. They do not eliminate different providers' authorization requirements or the need to interpret their data correctly. Git repository content and history are also distinct from GitHub/GitLab hosting features such as reviews and discussions.

**Agreed:** generalization across source platforms and organizations is a design requirement. Artem also asked to follow the useful separation in the Turku hackathon repository: reusable elements belong in focused `libs/utils/*` modules, with applications composing them. Exact modules, language, tooling and process boundaries remained open.

**Artifact saved:** Artem asked to preserve the graph as a possible video visualization. The [reference image](assets/source-to-memory-reference.png) and [editable Mermaid source](assets/source-to-memory.mmd) were saved and linked from the film brief. Saving the reference did not decide the final film treatment.

## 4. Nango versus our own connectors

**Artem's question:** could Nango be self-hosted, and how much of Teams, Slack, email and Git would it handle? Was broad integration work justified for a hackathon?

**Comparison discussed:** an integration framework can reuse authentication and connection infrastructure, but it does not remove our evidence mapping, source semantics or access-control work. Self-hosted feature availability also matters. The researched comparison and provider references are retained in [INTEGRATIONS.md](INTEGRATIONS.md); this history records the decision rather than making a new current feature claim.

**Artem's scope correction:** judges are unlikely to connect every platform. Broad product ambition can be shown without spending the whole hackathon implementing every connector.

**Closed:** custom Slack live connector; Teams/email file imports; Nango deferred; other connections, including Git/repository hosts, shown as **Planned**.

**What was not accepted:** a planned connection should not be presented as already functioning. The capability labels preserve the distinction between live, import and planned support. Nango and other providers were not rejected permanently.

## 5. Keep technical scope separate from demo selection

**Assistant's next question:** whether the Slack demo should read selected channels and replies, import history and follow new messages.

**Artem's correction:** focus on a usable connection and the important technical decisions; decide what to show in the demo in another chat.

**Outcome:** source/platform strategy stayed closed, but detailed source contracts remained open. Demo selection and presentation moved out of this chat's active scope. This was a correction to the discussion order, not rejection of history import or new-message support.

## 6. When should the system ask people?

**Question:** should questions arise only during an active problem or also while organizing historical knowledge?

**Artem's answer:** both, but background questions should concern important gaps and avoid bothering engineers. He wanted the detailed selection algorithm discussed later.

Three eligibility requirements were then closed:

1. **Decision consequence:** explain how a plausible answer could change a meaningful present or reasonably anticipated future decision. A missing field alone is insufficient.
2. **Sources first:** check accessible conversations and available machine observations before asking a person. Ask only if the consequential gap remains unresolved.
3. **Reason to know:** identify why this particular recipient could answer this particular question.

**Reasoning:** human questions are a scarce way to obtain evidence, not a general record-completion mechanism. A potentially useful question is not automatically worth delivering immediately; timing and interruption limits still apply.

**Still open:** precise gap detection, lookup budgets, ranking, timing and stopping algorithms. These principles did not determine an implementation.

## 7. People should be linked to work, without a complicated universal expertise score

**Artem's concern:** there is no point asking someone who does not know. He suggested a graph connecting particular traits of work to particular people.

**Explanation developed:** preserve typed, source-backed contributions—who advised an action, reportedly performed it, observed an outcome or explained a system. Different contributions create different reasons to ask someone.

**Concrete example:** in TRN-042, Veikko's report makes him relevant to what was performed and what happened afterward. Erkki's advice makes him relevant to the reasoning behind the proposed response. Those are not interchangeable forms of knowledge.

**Closed:** create people-to-work links automatically from sources; keep inferred expertise provisional and correctable. Automatically extracted links also remain correctable.

**Not decided:** a graph database, one global expertise score, a complex employee model or an exact ranking function. The relationship requirement does not force a particular storage technology.

## 8. Interruption limits and the meaning of Yes/No

**Artem's answer on limits:** make per-person background budgets and minimum gaps hard constraints; decide actual numbers later.

**Reasoning:** a selection algorithm should not be able to repeatedly interrupt one person merely because its score predicts high benefit. Limits restrict the action set before selection.

**Artem's correction on certainty:** an answer is evidence, not proof. The system operates with hypotheses and revisable certainty.

**Closed:** Yes/No is an attributed answer to a scoped question. It updates support or contradiction while preserving person, time and context. It does not automatically confirm a broader diagnosis, establish causation or prove lasting recovery.

**Still open:** exact numerical limits, confidence targets, evidence-combination rules and confirmation requirements. Unknown/skip/no-answer must remain distinct from a factual No.

## 9. Compare recommendation-assessment designs rather than choose by intuition

**Choice discussed:** one combined assessment of a recommendation versus separate assessments of historical support and current applicability followed by a gate.

**Artem's answer:** try both on available challenges and see what works better; create an experiment folder later.

**Reasoning:** a response can be well supported in its original incident yet unsuitable for the new one. Either architecture must consider the same evidence and conditions; an experiment should not artificially deprive one variant of relevant information.

**Closed:** select this design through comparison. **Unanswered:** which design wins, what scores mean, where thresholds lie and which errors are acceptable. No experiment had been run.

## 10. Complexity concern: what is the core, and what is RL actually for?

**Artem's concern:** the people system and question/RL machinery were becoming difficult to follow. He asked whether agents could realistically establish the relationships and which parts created the most friction.

**Discussion outcome:** separate the necessary evidence-and-reuse loop from optional sophistication. Source-backed contribution links can be useful without a complete social graph. A baseline can retrieve, investigate, ask and update evidence without a trained policy.

**Artem's follow-up:** why retain Yes/No questions without RL? What are we optimizing? How do problems connect to responses, and how do we distinguish similar-looking incidents?

**Explanation:** questions have value as evidence collection independently of reinforcement learning. RL addresses the allocation problem: which worthwhile question, to which suitable person, is worth the effort now? Factual answers and decision utility are different labels. A No that prevents bad advice can be highly valuable.

**Artem's mental model:** detectives assembling a jigsaw—collecting evidence, connecting historical actions and outcomes, and testing whether a response fits a new problem.

**Explicit correction to an assistant proposal:** Artem did not want RL reduced to something the product might simply discard. He wanted to retain RL for optimizing question choice, potentially including recipient choice.

**Closed:** keep RL as the planned optimization layer, while allowing the core loop to work with a baseline. **Not closed:** the exact algorithm, action representation, reward or training horizon.

## 11. Generalized records, not one solution attached to an embedding cluster

**Artem's question:** a narrative list of symptoms, hypotheses, advice, actions and outcomes did not look like a generalized data structure. Was the current problem a cluster of evidence embeddings? Was the solution also an embedding?

**Explanation developed:** distinguish the durable records from their search representations:

| Object | Role in the proposed model |
| --- | --- |
| Evidence | Original source item or passage, with provenance and access scope. |
| Claim / relationship | A scoped assertion or link supported or contradicted by evidence. |
| Case | One incident, which can start with one message and later gain observations, hypotheses, actions and outcomes. |
| Pattern | A proposed relationship among separate cases, without assuming a shared cause. |
| Attempt / outcome | What was advised, what was reportedly done and what followed, preserving attribution and uncertainty. |
| Procedure | Readable reusable steps, conditions, verification and supporting/failing cases, with a stable ID/version. |
| Embedding | A replaceable search representation pointing back to one of these records or passages. |

**Reasoning:** an embedding can find a plausible match, but cannot by itself establish incident identity, causation, applicability or success. Stable records remain inspectable and correctable when embeddings are rebuilt. A historical attempt need not be promoted into a general procedure.

**Status:** this became the working architectural explanation. Exact schemas, database and relationship-scoring rules remained proposals, not a fully approved implementation contract.

## 12. What makes the questions investigative rather than generic?

**Artem's question:** what binds evidence together, tells the system what it does not know and causes it to ask the correct questions? Are they fixed or generated?

**Explanation:** explicit relationships connect evidence, cases, actions, people and outcomes. Compare candidate explanations/procedures with current observations and conditions. A gap becomes useful when its answer can distinguish candidates or change a decision.

**Hypothetical example used:** a procedure requires controller revision A, while the current revision is unknown. Search records first. If still unresolved, ask someone able to observe the revision. Yes satisfies one condition; No may rule out that procedure; Unknown preserves the gap. This version requirement was an illustrative variant, not a fact added to the supplied TRN-042 source.

**Proposed mechanism:** structured gap categories and validation, with an LLM proposing context-specific questions. Each candidate identifies a target fact/link, source-backed rationale and possible consequences of answers. Common categories include incident identity, whether an action happened, whether recovery lasted and whether a response applies now.

**Correction to the optimization framing:** continually increasing confidence in the first proposed solution is not the goal. Correctly ruling it out improves the investigation. Similarity, model confidence and repeated source retellings must not be treated as independent evidence.

## 13. Learning from answers versus asking people to compare questions

**Artem's first concern:** training should not require every engineer to compare two questions and choose a favorite. He asked whether learning could choose both questions and recipients.

**Explanation:** training can use the outcome of the one selected interaction. In a controlled synthetic world, fixed hidden facts and recipient knowledge determine what an answer can reveal; the evaluator assesses decision benefit and effort. Live benefit may arrive later or remain unobserved. Pairwise preference labels are not required for factual-question selection.

**Artem later reconsidered:** perhaps optional comparisons, like choosing between two alternatives, could still be useful—although they might burden engineers.

**Final agreed direction:** Quick factual questions plus an optional Evaluative comparison category. This was a refinement, not a permanent rejection of all A/B comparisons.

**Reasoning:** a preference can inform wording or perceived usefulness, but does not answer the underlying operational question. Preferences, factual evidence, recommendation helpfulness, observed outcomes and optional user points stay distinct. Evaluative interactions also count toward burden.

**Still open:** comparison frequency, precise controls, training use and whether preference data improves downstream decisions enough to justify its effort.

## 14. Attention and transformers

**Artem's proposal:** perhaps attention or transformers could assess whether a problem was solved and how.

**Explanation:** the proposed LLM stages already use transformer models. A more specialized assessor could be compared on action/outcome attribution and support, but attention weights themselves do not establish certainty.

**Artem's answer:** leave this as an experiment.

**Closed experiment scope:** compare a prompted LLM assessor with a smaller pretrained transformer adapted for the task, subject to data and compute availability. Examine false solved claims, wrong action/outcome attribution, temporary recovery, recurrence, missing outcomes, calibration and cost.

**Not adopted:** a required new transformer architecture, a model trained from scratch, or a claim that attention measures truth. Exact model, labels and adaptation method remained unanswered.

## 15. Make the algorithm understandable as one loop

**Artem's request:** show the algorithm with a title and explanation at every step, in a simple vertical flow. Then create a mathematical diagram with a style inspired by the supplied scientific figure.

**Provisional loop captured:**

```text
Current problem + evidence + relevant people
                 ↓
Generate candidate question–recipient pairs
                 ↓
Apply eligibility rules and interruption limits
                 ↓
Policy chooses one pair, or defers
                 ↓
Answer updates the evidence
                 ↓
Assess decision benefit and effort
                 ↓
Use recorded examples to improve the policy
```

Source lookup precedes human eligibility; budgets and interaction history belong in the state. Updating the evidence after an answer and updating the learned policy after evaluation are separate feedback paths.

**Artifact created:** [QUESTION_POLICY_DIAGRAM.md](QUESTION_POLICY_DIAGRAM.md), with [PNG](assets/question-policy-diagram.png), [SVG](assets/question-policy-diagram.svg) and [rendering source](assets/question-policy-diagram.py). The equations are a design notation, not an implemented algorithm. The utility formula is illustrative; its terms and weights were not agreed. The reference figure did not imply adopting its BYOL architecture.

## 16. Artem's consolidated answers refined the algorithm

Artem then responded to a packet of pending questions. These answers closed several directions while preserving implementation choices:

| Topic | Artem's answer / clarification | Result and reasoning |
| --- | --- | --- |
| Candidate generation | An LLM makes sense. | Closed direction; prompts, templates and candidate count remain experimental. |
| Recipient breadth | It depends on the problem; a general observable condition may be answerable by someone less related to the original incident. | Closed clarification: past case participation is not mandatory for every question. Ability to observe/know matters; mere access is insufficient. |
| What RL selects | Could the LLM generate two questions and RL guide the choice? | Small candidate pool, eligible recipient pairs, one selected pair or defer, then update/regenerate became the proposal. Two is not a mandatory quota. |
| Optional comparisons | Quick and Evaluative categories could work. | Closed category distinction; exact UX and learning use open. |
| Product objective | Recover invisible knowledge: whether/how it was solved, who solved it and whom to consult. Test expected traits before suggesting a historical solution. | Closed direction; assess both support and applicability, including contradictions. |
| Next choice versus full investigation | The question was unclear. | Explain the difference; do not interpret confusion as agreement. |
| Synthetic training/evaluation | Yes. | Closed: fixed hidden facts, recipient knowledge, family splits, hidden future outcomes and independent label review. Sizes/workflow open. |
| No useful answer | Start with preserving unknowns and limited reassignment, then revise if poor. | Closed initial policy: no automatic broadcast; another suitable recipient and a still-important gap are required. |
| Checks versus disruptive fixes | Yes; also review the metrics. | Closed different evidence requirements. Numerical thresholds remain unanswered. |
| Number of experiments | As many as possible. | Breadth preference, bounded by resources; not unlimited combinations or spending. |
| Agent-requested clarification | Fine to include. | Closed capability through the shared coordinator; exact API/MCP lifecycle open. |
| Accepting experimental winners | Agree with fixed criteria, versioned results and failure review. | Closed promotion policy; retain baseline if inconclusive. Numerical criteria still open. |

**Important nuance:** avoiding uncertain solution notifications does not prohibit all questions under uncertainty. A consequential factual question can be the step that resolves whether a solution is applicable.

## 17. Metrics and training logic

The discussion moved away from rewarding agreement or rising self-confidence toward independently assessed evidence and decisions.

**Proposed scorecard:** knowledge/link accuracy; incorrect claims of resolution; supported applicable recommendations together with coverage and missed opportunities; calibration for defined probability targets; question benefit and burden; runtime/model cost. Access and hard-limit compliance are constraints, not tradeable reward bonuses.

**Reasoning:** measuring only successful recommendations could reward silence on difficult cases. Measuring only answer rate could reward easy, unnecessary questions. Measuring only confidence could reward unjustified certainty. A valuable No must be able to score positively, while unknown benefit must not be silently manufactured as zero.

**Training design proposed:** a controlled simulator reveals answers from fixed facts, logs the selected question–recipient interaction and measures consequences. Compare rules, an LLM ranker and a contextual bandit with the same candidate pool and eligibility rules. Keep test families separate from training/validation and inspect failure cases before promotion.

**Still unanswered:** exact metric definitions/targets, scalar reward, weights, delayed credit, missing-feedback treatment, numerical acceptance criteria and whether the initial learned selector optimizes the next decision or the whole investigation.

## 18. Resource limits changed the execution proposal

**Artem's instruction:** he had 55% of his weekly premium allowance remaining; do not launch Astra agents. GPT-6.1 Sol or Terra should be enough for later implementation agents.

**Then clarified:** do not use model APIs yet; use a small GPT model as the planned alternative to Gemini Flash-Lite.

**Closed constraints:** no Astra; later Codex coding agents use Sol/Terra; no model API calls yet; small GPT generator direction. The remaining allowance is not a numeric run cap or permission to consume all of it.

**Assistant proposal only:** GPT-6 Luna at low effort was recorded as a candidate following model-documentation lookup. It was not invoked, selected through an experiment or established as available through the user's account. Coding-agent access, subscription usage and application API access are distinct.

**Not authorized:** silently using a paid API, interpreting model preferences as a launch request, or presenting fixture/replayed outputs as actual small-model experiments.

## 19. Overnight handoff, with unanswered questions preserved

**Artem's request:** write down the technical state and summarize it in chat so another chat can combine these experiments with design, connections and an overnight prototype build.

**Action completed:** [OVERNIGHT_TECHNICAL_HANDOFF.md](OVERNIGHT_TECHNICAL_HANDOFF.md) was created and linked from the documentation index, technical discussion guide, workstreams and engineering decisions.

It contains agreed decisions, proposed record/service contracts, the question loop, a complete prototype trace, experiments E00–E10, dependencies and agent ownership, evaluation rules, resource constraints and morning review checks. These are planning artifacts; no experiment results were claimed.

**Artem's explicit final correction:** save the question about next-useful-question optimization versus whole-investigation optimization as unanswered, together with the other outstanding questions.

**Action completed:** the handoff preserves U01–U23 and run inputs R1–R4. The chat was described as ready to hand off technical direction, while the exact selector, reward, thresholds and resource allocation remained unresolved. Other chats' UI/pixel-motion work was identified for integration; it was not represented as work built by this technical chat.

## 20. Rejected, corrected, deferred and experimental ideas at a glance

This table deliberately avoids treating every alternative we did not choose as an explicit rejection by Artem.

| Idea or framing | Accurate status | Why / replacement |
| --- | --- | --- |
| Start by deciding whether every historical statement needs fresh human confirmation | Initial framing corrected by Artem | First account for prepared synthetic history and existing operational memory; settle source extraction. |
| Keep discussing demo channels/presentation in this technical chat | Discussion scope corrected by Artem | Work on usable architecture; demo selection belongs to another session. |
| Implement broad live connector coverage for the hackathon | Narrowed scope | Slack live plus Teams/email imports provides a bounded initial scope; other cards Planned. |
| Adopt Nango now | Deferred, not permanently rejected | Current connector scope does not require that integration investment. |
| Remove RL from the intended core direction or leave its inclusion undecided | Corrected by Artem | Retain it as the optimization layer; retain a working baseline underneath. |
| Require a historical incident link for every recipient | Overly narrow routing corrected by Artem | Some current conditions can be observed by a suitable person without past involvement. |
| Treat Yes as proof and No as failure/reward penalty | Evidence semantics corrected | Both are scoped evidence; either can improve a decision. |
| Treat current problems/solutions as just embedding clusters/keys | Conceptual question clarified | Cases, claims, attempts and procedures are durable records; embeddings retrieve them. |
| Continually maximize confidence in the first solution | Optimization framing corrected in discussion | Test alternatives and contradictions; ruling out bad advice is valuable. |
| Make a complex people graph or graph database a prerequisite | Not adopted | Contribution relationships are needed; implementation and storage remain open. |
| Require every engineer to compare two questions | Not adopted as the normal interaction | Deliver one selected factual question; optional Evaluative comparisons remain supported. |
| Generate exactly two questions every time | Provisional experiment, not a rule | Candidate count is open; one or zero useful candidates is valid. |
| Adopt a specialist transformer as required architecture | Experiment only | Compare against prompted assessment before adopting; attention is not certainty. |
| Pick combined or separate recommendation scores immediately | Decision deferred to experiment | Fairly compare both on the same evidence/current conditions. |
| Use one confidence threshold for all actions | Not the accepted risk policy | Checks and disruptive fixes have different evidence requirements; numbers remain open. |
| Broadcast after an unanswered question | Excluded by the accepted initial policy | Preserve the unknown; consider only justified, limited reassignment. |
| Astra agents for the later run | Explicitly disallowed | Use Sol/Terra for later Codex implementation agents. |
| Use model APIs now / keep Gemini Flash-Lite as the initial route | Explicit current constraint / superseded route | No model APIs yet; plan a small GPT candidate with access still to establish. |
| Launch the overnight work from this discussion | Not requested or performed | Prepare a handoff; Artem gives the combined build/run instruction in the other chat. |
| Treat next-question optimization as settled | Explicitly left unanswered | Preserve U01 and compare longer-horizon learning if appropriate. |

## 21. What remained unanswered at the end

The authoritative detailed register is [handoff section 8](OVERNIGHT_TECHNICAL_HANDOFF.md#8-unanswered-questions--deliberately-preserved). Its snapshot at the end of this discussion is:

| IDs | Unanswered area |
| --- | --- |
| U01–U05 | Next-choice versus full-investigation horizon; exact policy action; generation/count/features; reward and missing/delayed benefit; selector and update process. |
| U06–U09 | Certainty labels and thresholds; accepted errors/burden; numerical limits/retries/stopping; recipient ranking and identity details. |
| U10–U13 | Evidence/schema/revision contracts; conversation context and labels; case/pattern linking; retrieval and embedding choices. |
| U14–U16 | Dataset composition and review; simulated past answers; specialist transformer setup; Evaluative preference use/frequency. |
| U17–U20 | Detailed source contracts; database/modules/tooling/deployment; correction/deletion/access propagation; API/MCP lifecycle. |
| U21–U23 | Final UI/design/packaging selections; experiment allocation and stopping; available small-model execution route. |
| R1–R4 | Overnight hard stop, resource cap, actual execution scope and integration ownership/available routes. |

The next-choice/full-investigation distinction was explained as follows: both approaches can ask multiple adaptive questions. A next-choice selector evaluates the value of the next interaction; a sequential policy can learn that an early question is worthwhile because it enables a later useful action. **The explanation did not settle which should be the initial learned objective.**

## 22. Artifacts and work actually completed in this chat

- Saved decisions, rationales and open questions in [technical discussions](TECHNICAL_DISCUSSIONS.md), [engineering decisions](ENGINEERING_DECISIONS.md) and [workstreams](WORKSTREAMS.md), with related architecture/experience/film notes.
- Saved the [integration/generalization plan](INTEGRATIONS.md), including the `libs/utils` boundary and connection capability distinctions.
- Preserved the [source-to-memory reference](assets/source-to-memory-reference.png) and [editable graph](assets/source-to-memory.mmd).
- Produced the [mathematical question-policy diagram and explanation](QUESTION_POLICY_DIAGRAM.md). Its Python source renders a documentation figure; it is not a policy implementation.
- Produced the [overnight technical handoff](OVERNIGHT_TECHNICAL_HANDOFF.md), including the unanswered register and staged experiment proposal.
- Added this history at Artem's request.

**No implementation agents, model inference APIs, training or overnight experiments were launched by this chat. No algorithm winner was established.** Existing work by other chats must be inspected separately rather than inferred from this record.

The lasting design logic is: preserve evidence and uncertainty, reconstruct actions and outcomes, test whether past knowledge applies, ask only consequential questions of suitable people within hard limits, and use learning to improve that choice after measurable evaluation. The details still marked open remain open.
