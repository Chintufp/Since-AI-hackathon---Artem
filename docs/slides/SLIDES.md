# Knowledge Twin: slides

Twelve slides in the order of [DAY2_PLAN.md](../DAY2_PLAN.md) §4 Move 8. Every number is from [experiments/RESULTS.md](../../experiments/RESULTS.md), [E08-E10.md](../runs/2026-11-07-overnight/day2/E08-E10.md) or `pnpm test` (8 Nov 2026); sources in [SUBMISSION.md](../SUBMISSION.md) §4. The same text, as a one-file deck: [index.html](index.html) (← → to move, N for notes, F for full screen).

## Slide 1 · Knowledge Twin: the as-experienced layer

- Expert knowledge lives in Teams threads and e-mails, never in the manuals.
- We read the messages as they are. No form, no documentation step.
- What was said is bound to the equipment, the people and the time.
- A person or an agent gets the earlier fix with its caveats.
- One Mac, offline, rules by default.

show: Lumi on the desktop, the activity page behind him.

notes: Elisa asked for the as-experienced layer: what experts know but never write down. We capture it from the messages they already send, bind it to entities and time, and hand it to people and agents with its caveats. Everything you see runs locally, with no model call.

## Slide 2 · "That smiley is our problem"

- Erkki's Teams thread: 12 messages, imported unchanged.
- One case, 25 claims, bound to TRN-042, Veikko and Erkki.
- Times kept as given: 09:14–09:27, date unknown.
- The e-mail retelling is recognised: no second confirmation.

show: the `pnpm demo:reset` output, then the "Remember this" receipt in Lumi.

notes: This is Elisa's own thread, read as it is. Nobody filled anything in. The thread has clock times and no date, so we keep "date unknown" instead of inventing one. The e-mail tells the same story again; we detect that, so it does not count as an independent confirmation.

## Slide 3 · One picture

- Teams, e-mail, Slack → evidence, as observed
- → claims bound to entities, valid_from / valid_to, as experienced
- → investigation: support and applicability kept apart
- → a person (Lumi, one tap) or an agent (MCP, same limits)

show: Elisa's reference architecture, labelled with our modules (SUBMISSION.md §2).

notes: Your reference architecture, layer by layer, with the module that implements each one. Evidence is verbatim. Claims carry spans, entity bindings and a validity window. The investigation never collapses support and applicability into one score. People and agents use the same engine under the same rules.

## Slide 4 · Live: Erkki's rule reused on TRN-088

- "Check the traffic counters before replacing the SFP again."
- Caveat: reported once; cause and lasting effect not verified.
- Basis: TRN-042, a timeline from problem to reported outcome.
- Every node opens the sentence it came from.

show: the result card in Lumi after pasting the TRN-088 problem as Veikko.

notes: A unit Erkki has never seen. The rule comes back as a check before the corrective action, with an honest caveat. Click any node and you see who said it, where and when. This needs Elisa's files; on a clean clone the generated TRN-233 (Pekka Laine) plays the same part.

## Slide 5 · Hard part 01: the real knowledge

- 12 messages, 1 rule: check the counters, then bounce the interface.
- Support (did it work?) and applicability (does it fit here?) kept apart.
- Rules extractor, claim recall: 32/47 train, 14/22 validation (synthetic).

show: the TRN-042 timeline with "Suggested checks" expanded.

notes: The hard part is that the rule is one sentence among twelve messages. We keep what worked separate from where it applies, because they fail differently. Extraction is lexical rules; recall is measured on synthetic families with denominators, and paraphrases outside the lexicon are still missed.

## Slide 6 · Hard part 02: linking

- TRN-042: firsthand. "Older units, ≤2019": hedged, in Erkki's words.
- A wrong link is worse than none.
- Lookalike rejected: "Don't reuse the fix from TRN-042: older unit there, newer unit here."

show: the bindings row of the Context Layer page, then the lookalike result card.

notes: "These older units" could mean TRN-042 only, a model or an install year. We bind firmly only what was said firsthand and keep the class hedged. When a new problem conflicts on a deciding condition, we say the old fix does not apply rather than guess.

## Slide 7 · Hard part 03: time

- Drag t: 09:14–09:18 nothing; 09:19 check the counters; 09:25 bounce, reported once.
- From 14 Oct: superseded for firmware 4.2, by Erkki.
- RBS-310 barrier code: 5802 from 20 Aug, 7731 from 6 Oct.
- Nothing is deleted: the old claim keeps its window.

show: `/context.html?entity=TRN-042`, dragging the t line; then `?entity=RBS-310`.

notes: Your question: when does it stop being true? Drag the line and the card shows what an agent is told at that moment. The firmware note and the new barrier code close the older claims without erasing them. The dated follow-ups are synthetic, because Elisa's example has no dates.

## Slide 8 · Hard part 04: trust

- Reported vs verified: a recovery stays "reported" until a later message confirms it.
- Under every headline: "Erkki Expert · Teams 09:22 (date unknown) · reported once · still believed true".
- Experts disagree: Erkki (older units) and Helmi (2021 batch). Both kept.
- One question picks the branch; neither expert is overwritten.

show: the provenance strip; the TRN-577 result with "Also on record".

notes: A hunch and a verified fix look the same in chat. We keep them apart and say who, where, when and how often. When two experts disagree, we keep both, name the fact that decides between them and ask one person. Helmi's thread is synthetic.

## Slide 9 · Hard part 05: people

- One Yes/No question, only when a fact decides the answer.
- 3 a day per person, 30 minutes apart, one open; nothing between 22:00 and 07:00.
- Not sure · Later · Dismiss · Undo. Nobody fills in a form.
- Erkki's cost on screen: asked, answered, seconds, reuse.

show: Erkki's question card in Lumi; the cost card on the activity page.

notes: If Erkki has to fill in a form, he won't. So the ask is one tap, rare, and never at night. Erkki's cost is counted from the store, so the burden is visible. Points exist, opt-in and off by default. Real seconds from real engineers: not measured.

## Slide 10 · Agent-ready

- 12 MCP tools over the same engine: same access rules, same budgets.
- 03:00: `kt_investigate` → `kt_list_gaps` → ask Erkki → queued until 07:00.
- 07:30: one tap in Lumi. The agent's next step changes.
- The agent never gets a channel to Erkki.

show: `pnpm demo:agent` beside Erkki's companion (fallback: mcp-transcript.md).

notes: An agent can't call Erkki at 3 a.m., and here it doesn't. It finds the gap that decides applicability, asks for the right person, and the engine holds the question until morning. Confidence comes back as labels with reasons, never as a similarity score. A refused preference names who to ask instead.

## Slide 11 · Honest numbers

- 641/641 tests. Hash-locked: test split 9f202253…, 73e145d0…; E10 results 9248c650….
- E08 bge-m3: recall@3 7/9, as baseline; lookalike rejected 1/2; paraphrase (TRN-117) rank 1 vs 5.
- E09 qwen3:4b: claim recall 33/47 vs rules 32/47 (train), 14/22 both (validation); 6/6 imports over 60 s.
- Live Ollama, once, Elisa's data: TRN-042 rank 1 (as rules); thread import 41.8 s of 60 s, 1 new claim; phrase echoed the template.
- E10, 5 cases × 3 seeds: correctness 3/180 → 3/180; touched-case completeness +12.49 (3/5 answers) / +16.66 pts (4/6); bandit 0/3.
- Weak: kind accuracy 3/12 vs 6/12 baseline; simulated people; synthetic data.

show: the E08–E10 tables (E08-E10.md) and experiments/RESULTS.md.

notes: Every number has its denominator; E08–E10 run offline from recorded, hash-locked outputs. The models are opt-in because they have not earned the default: bge-m3 only wins the paraphrase, and on Elisa's store it ties rules; qwen3:4b adds one claim. The local runs on Elisa's data are one observation each, not scored. Questions are now ranked by value / cost, and an applicability No no longer counts as a contradiction: the answers of one simulated day fill keys, but the product stays 0 because the touched cases have no supported claim yet. Decision quality after retrieval is our weakest part.

## Slide 12 · "Is this documented somewhere?"

- Yes. Erkki, Teams, 09:22.
- Nobody had to write it down.
- Pilot ask: one team, one Slack or Teams scope, two weeks.

show: Lumi opening the TRN-042 case for Veikko.

notes: Veikko's question, answered from the thread itself. What we ask for is small: one team, one channel scope, two weeks, so we can measure what we could not here: real answers, real seconds and whether the store gets fuller.
