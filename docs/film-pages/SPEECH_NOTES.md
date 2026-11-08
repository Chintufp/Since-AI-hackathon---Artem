# What to mention in the voice-over

Short points per part. Every claim here is what the code does in the film run (checked 8 Nov).

## Part 1: capturing knowledge from chat

- Lumi reads the channel (read-only) and splits every message into sentences. Each sentence is sorted as a **problem, condition, possible cause, action or outcome**. A sentence that is none of those (oat milk, pizza, "alarms?") gives nothing, so chatter drops out by itself.
- This runs on **rules, locally**: no LLM and nothing leaves the laptop. A local model can be switched on in Admin; its output still has to pass the same rules.
- Messages join one **case through the unit id** (TRN-418). The same unit becomes a new case when the problem comes back ("again"), or after a gap once the last one was solved.

## How Lumi knows two problems are the same (questions part)

- **Finding similar cases:** the new problem is compared with every stored case card, claim and message. Matching uses exact ids, keywords (BM25) and a vector of each text's character patterns, which catches near-identical wording.
- **Embeddings:** a real embedding model (bge-m3, local) can plug into the same slot to match by meaning. The film runs without it.
- **Similar is not the same:** after matching, Lumi checks the **conditions**:
  - a condition that clearly differs (older N5 unit vs new unit) makes the old fix **not apply**;
  - a condition nobody has stated yet makes it **"applies if …"**, and that open condition is exactly what Lumi asks about.
- In one sentence: *"Text similarity finds candidates; the conditions decide whether it's the same problem."*

## Who gets asked, and why

- Lumi asks only people with **first-hand** experience: whoever reported it, did the fix or saw the outcome.
- Fewer open questions means a higher chance of being asked. Nobody is asked twice about the same thing, or outside working hours.
- The question text comes from **fixed templates** filled with the evidence (no generated wording), so it can't invent facts.
- The confirm question in the film is asked only after **4 separate messages** back the case, and it goes to the person who reported the problem.

## Why it gets better

- Each answer is scored by **how much more complete and more correct** the knowledge got.
- **Correct** means backed by 2+ independent people or by an observed outcome.
- The scoring learns which questions are worth someone's time.

## Agents (finale)

- The same knowledge is available to AI agents over **MCP**. An agent gets the case, the quotes and the people, and its own question still goes to a person through Lumi. The agent never contacts anyone directly.
