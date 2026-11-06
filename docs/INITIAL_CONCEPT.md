# Archived initial repository concept

**Preserved from commit `3c46a8a97c1cae7714a14bd77d4874a0cc0764a1` on 6 November 2026.**

This is the earlier README, preserved verbatim below for the team to compare with the [current vision](../README.md). It is a concept and pitch-preparation document, not a record of implemented or measured behavior. In particular, its model/version/pricing claims, budget assumptions, data descriptions, live/cached demo answers and performance statements require verification. The new README distinguishes current direction, proposed implementation and open decisions.

The original concept-artifact link is retained as a historical reference; its contents were not independently reviewed for this documentation update. No keys, private source material or demo results have been added here.

---

# Knowledge Twin

**Since AI Hackathon 2026 · Elisa challenge: silent knowledge**

Elisa's digital twin models the network. Knowledge Twin models what the engineers know about it, and gives that context to AI agents at the moment they decide what to do.

- Concept page (v2): https://claude.ai/artifact/6MezBhQzv3Qo6MZSWNkcYe
- Status: concept only. We're waiting for Elisa's material (due at kickoff, Fri 6 Nov). Nothing is built yet.

---

## Pitch prep: questions judges might ask

Each answer should take about 20–30 seconds to say. Items marked **[measure]** need a real number from our build before the pitch. Never guess a number on stage. If we don't have it, say so.

**Who answers what:** the pipeline/data person takes *Technical* and *Demo and data*. The agent/UI/pitch person takes *The idea* and *Business*. Whoever presents takes *Trust and privacy*. If you don't know an answer, say "good question, we haven't tested that yet", then say what we'd try.

### The idea

**Did you build or train your own LLM?**
No. We use an existing LLM (Claude) through an API. What we built is the knowledge layer around it: the pipeline that turns messages into structured facts, the knowledge graph, the trust rules, and the interface agents call. Training a model wasn't needed, and it would have made the system worse (see the next answer).

**Why not fine-tune an LLM on the chats?**
Facts baked into model weights can't be cited, deleted, expired or permission-checked. In our graph every fact shows its source. You can delete a source and the facts built only on it disappear, which matters for GDPR. Facts like "road works until March" expire by themselves, and an agent only sees what the source audience could see. A fine-tuned model also goes stale and needs retraining, while a new fact in our graph can be used straight away.

**Isn't this just RAG, a chatbot over Slack?**
RAG returns text chunks for a person to read. We return typed claims that automation can act on. Each claim has an effect (block, require approval, precondition, downgrade, warn, inform), a trust status, a validity window, and links to the exact device or site. RAG also stays silent when knowledge is missing. Our system notices the gap and asks the right engineer.

**Why a knowledge graph and not just a vector database?**
We use both. Vectors find similar text. The graph holds the parts that need to be exact: which device a fact is about, which site that device is at, which customer service runs through it, which sources support the fact, and which newer fact replaced it. An agent asking "anything about RTR-HEL-042 before I reboot it?" needs exact links, not similar-sounding text.

**How is this different from a wiki or knowledge base?**
A wiki needs experts to stop and write documentation, and they rarely do. We capture knowledge from text people already write (chat, ticket notes, handovers), and experts only act when a fact is high-impact (one tap) or when an agent asks about a real gap (one reply).

### Technical

**What happens when the AI extracts something wrong?**
Three safety nets. First, a claim's trust status limits what it can do: a fact from one unconfirmed message can only warn, never block or skip an action. Second, the rules are enforced in code by the executor, not by the LLM, so a hallucinated instruction can't run an action by itself. Third, every claim links to its source message, so a person can check it in one click.

**How do you know "the box behind the stadium" means the right device?**
The entity resolver works in steps: known aliases, fuzzy name matching, context (which channel, which devices were mentioned nearby), then the LLM picks among the top candidates and gives a reason. Each match gets a confidence score. If confidence is low on a high-impact claim, the system asks instead of guessing. Entity linking accuracy on our test set: **[measure]**.

**How do you handle Finnish?**
The chats are Finnish and English mixed, with slang. Finnish also changes word endings (Kallio, Kallion, Kalliossa), which breaks simple text matching. The extractor returns each place or device name in its base form before matching, and we use a multilingual embedding model. How well it worked on our test set: **[measure]**.

**What about outdated or conflicting information?**
Every claim has a validity window and a status. When a newer claim replaces an older one ("the key moved"), the old one is marked superseded and kept for history. When two claims contradict each other, both get flagged and the decision goes to a person. Claims that nobody mentions again slowly lose trust, faster for things that change often, like access details.

**How would Elisa's agents use this?**
Through one call: `get_context(device, planned action, time)`. It returns relevant claims, any gaps, and who to ask. We expose it as an MCP server, which agent frameworks such as Google's ADK can call. Elisa's 2025 Google Cloud announcement says it builds its agents with ADK and the A2A protocol, so this would plug into that setup. Wrapping it as an A2A agent is our next step.

**Which LLM do you use, and why?**
Claude Opus 5.5 through Anthropic's API. We needed reliable structured output (every claim has to match a JSON schema), tool use for the agent, and handling of Finnish slang **[confirm in testing]**. The LLM sits behind one interface, so it can be swapped. Claude also runs on Google Cloud's Vertex AI, which fits Elisa's Google Cloud setup, and Gemini would work too.

**Does it scale? What does it cost?**
Most messages carry no reusable knowledge, so a cheap detection pass filters them out first and only a small share reach full extraction. Backfilling years of history isn't urgent, so it can run through the Batch API at half price. Our measured cost: **[measure]** per 1,000 messages.

### Trust and privacy

**Isn't this monitoring employees?**
It only reads channels the organisation has approved and switched on, and each channel shows a notice that capture is on. It stores facts about equipment, not about people. Authors appear as roles ("field technician"), and personal details are dropped before anything is stored, so "Jussi is on sick leave" never enters the graph. The expertise map is used only to route questions, and engineers can opt out.

**What about GDPR and deletion requests?**
Because every claim knows its sources, deleting a source retracts the claims that only it supported, and the rest get re-scored. We store claims and short quotes, never whole conversations. A real deployment would still need Elisa's privacy, security and legal review, and probably a DPIA. We're not claiming it's compliant out of the box.

**You're sending internal chats to an external AI service?**
In the prototype, yes, but only synthetic data. For a real deployment, Elisa chooses where the model runs. For example, Claude on Vertex AI can run in an EU region inside Elisa's own Google Cloud setup, and the LLM can be swapped for another model if policy requires it.

**Who can see what?**
Each claim inherits the permissions of its source. An agent or person never sees a fact from a channel they couldn't read. Every `get_context` call is logged with the claims that shaped the action.

**What about passwords and door codes in chats?**
The policy gate drops secrets before storage. "portin koodi on 4471" (the gate code is 4471) becomes "the gate has a keypad code; see the site access system". The code itself never enters the graph. Secrets stored in our test: **[measure]**. The target is zero.

### Experts and adoption

**Why would experts answer the agent's questions?**
Because it asks rarely: only before a risky action, and only when there's a real gap. It asks someone who has worked on that exact site, in the chat they already use, and one line is enough. Answering once means nobody asks them that question again, at 23:00 or ever. Unanswered questions fall back to the normal on-call process.

**Doesn't confirming claims create admin work again?**
Only high-impact claims, the ones that could block or pause automation, get a confirmation request, with one tap in the original thread. Everything else flows in automatically and gains trust from corroboration and outcomes. Expert time per stored claim in our demo: **[measure]**.

**What if the expert who answered was wrong?**
The claim gets corrected the same way as any other. A contradicting message or a bad outcome ("did that, didn't help") lowers its status and flags it. And because it's linked to a source, anyone can see who said it and when.

### Business

**What's the business value?**
Fewer unnecessary site visits (the false-alarm case), fewer outages caused by automation itself (the hospital-link case), faster fixes, and less dependence on knowledge that only one person holds. Elisa reports that automation has already cut customer-impacting incidents by more than 80%. Our bet is that much of what remains depends on context that lives in people, and that's what stops a network from running itself end to end. In our test: **[measure]** correct actions out of 12 events, against **[measure]** for the baseline agent.

**Who at Elisa would use this?**
The main users are Elisa's own AI agents and automation workflows. NOC engineers and field technicians see the same facts in their tickets and work orders. Operations managers get a map of knowledge that only one person holds, which shows where expertise will be lost when someone leaves or retires.

**Does it work outside telecom?**
Yes. Device types and claim types are configuration. Swap the network inventory for a power grid, a hospital's equipment register, a shipyard or a paper mill. Any complex operation with equipment, incidents and experts who know things nobody wrote down has the same problem.

**What doesn't work yet? What's the biggest risk?**
Be honest here. We tested on synthetic data that we wrote ourselves, which flatters the system. Entity matching against real inventory names is unproven, and we haven't measured how often real experts would answer. The next step is running the same metrics on real, anonymised Elisa data.

### Demo and data

**Is the data real?**
No. It's a synthetic Helsinki-area network that we generated, with real district names and invented IDs, customers and messages. We built it with planted knowledge and traps (outdated facts, contradictions, secrets, sarcasm) so we know the right answer for every message. If Elisa's material was used, say exactly which parts.

**Are the numbers on the slide real?**
Only say yes if they came from our evaluation run. Say which data they're from (synthetic or Elisa's) and how many events or messages they cover.

**Was Act 3 really live?**
Yes. A teammate typed the reply on a phone, and the extraction, matching and graph update ran live. Acts 1 and 2 used cached responses, so the demo couldn't fail on stage. Say that openly if asked.

**What would you build next with three more months?**
Run on real, anonymised Elisa data. Wrap the context service as an A2A agent for Elisa's multi-agent setup. Add technicians' voice notes as a source. Measure expert answer rates and the business impact (avoided site visits, prevented incidents) in a pilot with one NOC team.

---

## LLM budget: $500 in Claude credits

- **Model:** Claude Opus 5.5 (`claude-opus-5-5`) for extraction, reconciliation and the demo agent. It costs $4 per million input tokens and $20 per million output tokens. Thinking tokens count as output.
- **Rough estimate before we build:** generating the synthetic corpus costs about $5–10. One full extraction run over about 400 items costs about $3–5. One demo-agent event costs about $0.10. Even with 20+ iterations, we should stay well under $500, so the budget is no reason to use a weaker model.
- **Habits that keep it that way:**
  - Log `usage` tokens for every API call. That gives us the real cost number the judges may ask for.
  - Tune prompts on a 20-message dev set, not the whole corpus.
  - Use prompt caching for the long, fixed system prompt (schema plus inventory aliases).
  - Cache the demo responses for Acts 1 and 2.
  - Check usage in the Claude Console on Saturday morning.
- **API key:** keep it in a `.env` file listed in `.gitignore`, never in the repo or on a slide.
