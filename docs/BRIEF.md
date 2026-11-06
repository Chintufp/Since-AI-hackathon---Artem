# Elisa challenge and product brief: silent operational knowledge

**Since AI Hackathon 2026 · Team reference · Updated 6 November 2026**

This file separates the challenge supplied by the organizer from our interpretation and proposed response. The detailed product vision, architecture, design rationale and implementation priorities are in [VISION.md](VISION.md). Broader early research is in [RESEARCH.md](RESEARCH.md).

## 1. Source and authority

The challenge description below is transcribed from the screenshot Artem supplied in the design conversation. Its [challenge page](https://sinceai.app/events/since-ai-hackathon-2026/elisa) is the reference location. Artem later supplied the official Elisa brief dated 3 November 2026 and a synthetic chat/email example. Those source files remain in the ignored local `private/Elisa_SinceAI2026/` folder. The official brief identifies usability with minimal specialist effort as the primary criterion, alongside relevance, entity/time linking, feasibility and agent suitability. Artem reports that the information session accepted short Yes/No questions while discouraging forms. Product and creative proposals below are our own, not organizer requirements.

The following quotation is the supplied challenge text, not an instruction to access private systems or collect people's communications.

> A network AI can identify a technical fault perfectly—and still fail because the one piece of information it needs lives in somebody’s memory, an old email or a chat between specialists. As networks become more autonomous, this invisible human context may be one of the biggest obstacles to systems that can truly operate end to end. Elisa invites you to tackle the problem of “silent knowledge”: valuable operational details that people create every day but never formally capture. How could AI recognise relevant context, connect it to the right equipment or incident, and make it usable by future automated workflows without adding more administrative work for experts? Think knowledge graphs, contextual retrieval, agents and enterprise-scale information intelligence. The potential impact goes far beyond telecom. Build a convincing approach to transforming fragmented human knowledge into dependable, machine-readable context, and you could help define how people and autonomous systems work together in complex real-world operations.

## 2. The problem in practical terms

An operational system can know that a device has failed while missing the context needed to respond correctly. That context may be a previous failed repair, an unusual configuration, a temporary restriction, a dependency on another service, or a specialist's explanation of what finally worked.

For example, an alert may resemble an incident resolved by restarting a component. The historical discussion might also say that the restart helped only temporarily, that a credential replacement was the lasting fix, or that the restart is inappropriate on another software version. Returning only the first successful-looking message can make the new response worse.

The challenge is to make that scattered knowledge usable at the moment of a decision, with enough evidence, applicability information and access control to trust it.

## 3. What the challenge explicitly asks for

| Requirement in the supplied description | What we need to demonstrate |
| --- | --- |
| Recognize relevant operational context | Distinguish useful observations, constraints, attempts and outcomes from incidental conversation. |
| Connect context to equipment or an incident | Resolve identifiers and aliases, preserve uncertainty, and distinguish one incident from a recurring pattern. |
| Make context dependable | Show sources, contradictions, applicability conditions and what remains unknown. |
| Make context machine-readable | Return structured evidence and conditions that another workflow can consume. |
| Avoid extra administrative work | Reuse existing material, automate routine processing and ask experts only for valuable missing information. |
| Support future autonomous workflows | Demonstrate how the resulting knowledge changes an automated decision. |
| Have potential beyond telecom | Use a general case/evidence model with configurable domain entities and source adapters. |

The brief mentions knowledge graphs, contextual retrieval and agents as possible approaches. It does not establish that we must use a particular database, train an RL model, connect to every platform, or build a production network controller during the hackathon.

## 4. Our proposed response

**Working repository name: Knowledge Twin.** Earlier research called the memory concept **OpsMemory**. Branding is still open; these names do not refer to a dependency we have committed to install.

Build an operational memory layer with three distinct mechanisms:

1. **Collect:** Import approved historical material, receive manual contributions and optionally synchronize explicitly enabled sources. Recover unwritten details with short, relevant questions.
2. **Organize:** Turn evidence into cases, timelines, typed claims, recurring patterns, procedures and case-specific contributions by people. Keep evidence and interpretation distinguishable.
3. **Apply:** Find relevant past cases, predict distinguishing traits, check those traits against current evidence, and provide applicable guidance or a precise unresolved question to a person or an autonomous workflow.

The desktop companion is a convenient interface. The reusable asset is the underlying knowledge and investigation service, accessible through an API and potentially MCP.

### Four problems for the pitch

| Problem | Our method | What the demo communicates |
| --- | --- | --- |
| **1. Useful knowledge is buried in ordinary conversations.** | Interpret messages in context, identify useful passages and extract structured claims. | Existing conversation becomes useful knowledge without someone filling out a form. |
| **2. Knowledge loses meaning when separated from the incident, equipment, people and outcome.** | Connect claims to entities, cases, attempted responses, conditions, source history and people's contributions. | We can explain what happened, what helped, where that knowledge applies and who has relevant experience. |
| **3. Similar problems can need different solutions, and historical advice can be incomplete or wrong.** | Retrieve candidates, predict distinguishing traits, check evidence and ask a small question when necessary. | We recommend applicable knowledge, find relevant people and handle a misleading lookalike correctly. |
| **4. Knowledge must reach people and agents without creating another administrative task.** | Serve the same memory through MCP and a minimal engineer interface; reuse answers across future incidents. | An agent receives useful context, an engineer can find a response or relevant colleague, and a small contribution improves later assistance. |

These four problems explain the system; the ten [engineering workstreams](WORKSTREAMS.md) divide implementation responsibility. Methods and visualizations should make the connections between the problems clear.

### Find relevant people as well as knowledge

The solution includes finding people related to the current problem or people who previously encountered a similar problem. Show a person's specific contribution, the related case, relevant conditions and why they may help now. Provide a way to inspect that history and prepare a contextual question for user review before contacting them. Use verified identity and source permissions; a contribution score is not an expertise ranking.

This feature matters when a stored explanation is incomplete: the system can identify both what is known and someone with relevant experience who may know the missing part.

### Optional points and an enjoyable contribution experience

**We plan to build the points feature, with a clear on/off switch.** The presenter can show it to judges and immediately switch to a quiet version. The feature should remain modular so the team can remove it later if feedback suggests it does not help.

Artem wants contributing to feel highly satisfying: fast acknowledgement, smooth transitions, small point celebrations, expressive pixel-avatar reactions and optional synchronized sounds. His “dopamine-heavy” direction is a creative description of that rewarding feel; the expected participation and learning benefit is a hypothesis to test.

Reward useful Yes and No answers, corrections, relevant nonduplicate information and missing resolutions. Preserve unknown/later/skip and personal question budgets. Keep user contribution points separate from claim certainty and the model's reward. Sound and reduced-motion controls are separate; turning rewards off leaves assistance and valid knowledge contributions working normally.

The aim is more useful voluntary contributions and a shorter adaptation phase. Measure contribution quality and burden alongside participation. Exact effects, sounds, values and animation timing will be developed with the design agent. See the [experience and points design brief](EXPERIENCE_BRIEF.md).

### Cinematic pitch video

Create a visually ambitious film with multiple screens, animated topology and a strong sense of how fragmented context becomes coherent, reusable knowledge. Show emails, chat, notes and images connecting to equipment, cases, hypotheses, responses, outcomes and people; then show one small engineer answer changing the relevant relationship and helping a later incident.

Visualize hypothesis checking, relevant-person discovery, MCP delivery and the separate learning loop. Use the white pixel avatar as the human-scale connection to the larger system. Prepare the points scene with rewards-on and quiet variants.

Artem will develop the film with director/animation agents. The [pitch-film brief](PITCH_FILM_BRIEF.md) contains a draft scene sequence and handoff deliverables. The film is a planned pitch asset, with conceptual sequences and actual implementation footage identified appropriately.

## 5. Autonomy and the adaptation phase

Our proposed pitch is **adaptation followed by demonstrable autonomous reuse**.

During adaptation, the system imports approved history, learns terminology and entity mappings, and resolves important ambiguities with lightweight expert input. During operation, it handles supported situations automatically and asks about exceptional gaps.

This is credible only if the demonstration includes an actual path that works without feedback. A user pressing Yes after every step would remain a manual dependency, regardless of how we describe the phase.

Readiness should be scoped to a recurring problem type and operating environment. Familiar, well-supported cases may be handled autonomously while unfamiliar cases still require adaptation. We should not promise that a fixed number of labels makes the entire organization autonomous.

The supplied official brief gives a strong-demo example in which knowledge is captured from a chat/email, stored with entity/source/validity context, and retrieved by an agent for a similar case. We will use that context-to-agent loop as the core demonstration; authority to carry out operational actions remains separate.

## 6. Proposed demonstration

Use synthetic or explicitly approved material. Make the provenance of the demonstration data visible.

1. Import a small historical conversation plus a local note or image about an incident.
2. Extract the observations, an initially plausible explanation, a failed or temporary workaround, and a missing outcome.
3. Let an expert contribute one useful missing detail. Update the case and keep the earlier account visible as superseded or incomplete.
4. Introduce a different incident that resembles the historical case. Do not expose its eventual answer to the system during diagnosis.
5. Retrieve the past case, state the additional traits expected if the same explanation applies, and check them using available machine evidence.
6. Return a structured context package to a small downstream workflow. Show what decision changes because of that context, and expose a relevant person with their case contribution when useful.
7. Introduce a lookalike with a conflicting version, observation or precondition. Show an alternative, a targeted check or abstention.
8. Show the contribution interaction with rewards enabled, then switch to quiet mode. Use the cinematic sequence to connect the small interaction to the wider knowledge topology.

If the downstream system or its telemetry is simulated, label it as simulated. If a response is cached, label it as cached. Recording feedback is not equivalent to having trained and evaluated a new policy.

## 7. Proposed success criteria

These are our engineering criteria, not an official Elisa rubric.

- A teammate can trace a recommendation to the original supporting evidence.
- A temporary workaround is not silently promoted into a permanent fix.
- A similar-looking but inapplicable case is rejected or qualified.
- The same mechanism serves a pasted problem and an event from an authorized feed.
- A structured result can be consumed without a person interpreting a chat transcript.
- A familiar case can complete without a new human answer.
- A missing detail can be contributed with little effort, then reused later.
- Source permissions remain effective in retrieval, summaries and people recommendations.
- Duplicate imports do not become independent corroboration or earn repeated points.
- A correction or permitted deletion changes the derived memory and future recommendations.

Measure both the benefit and the burden: useful recommendations, erroneous advice, correct abstentions, false incident merges, expert questions/minutes, autonomous coverage, latency and cost. Report dataset size and limitations alongside any result.

## 8. Boundaries and assumptions

- Collection is a substantial design problem of its own. A source icon in a diagram is not a working connector.
- Existing access to Gemini, containers and Google Cloud databases gives us implementation options; exact products, model versions and deployment settings remain to be chosen.
- A paid Google Workspace company account is not a universal prerequisite for accessing personal Gmail through authorized exports or the Gmail API. Account type, app verification and organizational restrictions are separate questions; see the [full vision](VISION.md).
- No access to third-party mailboxes, silent screen monitoring, real operational changes or automated messages to specialists is authorized by this concept document.
- Manual sharing, continuous capture and historical backfill must each have an explicit scope and permission model.
- Organization-controlled hosting is a design requirement. Storage location and model inference location must be considered separately.
- Personal data protection, confidentiality and security are part of the design. Self-hosting, redaction or an opt-in switch alone does not establish compliance.
- The prototype should begin with synthetic or approved data. Company material stays out of the public repository unless its publication is explicitly permitted.

## 9. Questions for Elisa and the organizers

1. Which next agent decision best demonstrates the context-delivery loop in the official brief?
2. Which concrete decision currently fails because the relevant human context is missing?
3. What sources, inventory records, incident IDs and outcomes will be available, and under what permissions?
4. Which context is most valuable: restrictions on planned actions, historical diagnostic experience, undocumented access conditions, or something else?
5. Which checks may be performed automatically, and which actions require separate operational approval?
6. How should we establish that a past solution actually worked, and for how long?
7. What amount of expert interruption would be acceptable during adaptation and normal operation?
8. Are there additional demo or presentation constraints beyond the supplied usability-first brief?
9. Which model endpoints, storage locations and deployment environments would be acceptable for a pilot?
10. What would make the company willing to continue with a small pilot after the event?

## 10. Event guidance and sources

The [official event page](https://sinceai.ai/hackathon) emphasizes working demonstrations and says company challenges are evaluated by their respective companies, separately from the overall final. Therefore, the general event rubric should not be presented as Elisa's exact rubric.

The [event's Devpost page](https://sinceai2026.devpost.com/) describes a functional AI prototype, meaningful technical execution and responsible implementation. Recheck submission rules and presentation logistics with the organizers before the final demo.

Other useful references:

- [Elisa challenge page](https://sinceai.app/events/since-ai-hackathon-2026/elisa): reference location for the supplied description.
- [Elisa and Google Cloud collaboration announcement](https://www.googlecloudpresscorner.com/2025-06-17-Elisa-Oyj-and-Google-Cloud-Expand-Collaboration-to-Deliver-AI-Driven-Autonomous-Networks): background on autonomous network work; not a specification of our integration access.
- [Current product vision and design rationale](VISION.md): our proposed response, with implementation choices and open issues marked.
- [Earlier challenge research](RESEARCH.md): historical comparison with other tracks, not the current product specification.

Public event and vendor guidance is time-sensitive. This document records the position on 6 November 2026 and does not substitute for later company instructions.
