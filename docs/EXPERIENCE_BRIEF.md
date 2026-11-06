# Engineer experience and optional points — design-agent brief

**Working product direction · 6 November 2026 · Design handoff, not an implemented feature**

Read [the product brief](BRIEF.md), [the vision](VISION.md), [the workstreams](WORKSTREAMS.md) and T10 in [the technical discussion guide](TECHNICAL_DISCUSSIONS.md). The accompanying [pitch-film brief](PITCH_FILM_BRIEF.md) covers the cinematic story.

## Intent

Make small knowledge contributions feel immediate, smooth, expressive and rewarding. Artem wants a strongly satisfying audiovisual experience: points arriving, a responsive avatar, polished transitions and short optional sounds. His phrase “dopamine-heavy” describes the desired creative feel. It is not a measured biological effect or a claim that reward effects have already accelerated learning.

The product hypothesis is that enjoyable micro-interactions encourage useful voluntary contributions and shorten the time needed to capture missing context. Evaluate the quality of those contributions alongside participation and effort.

## Build the feature; make using it optional

- The points system is in the planned build scope. Optional means the experience can be switched off, not that the feature is merely an uncommitted idea.
- A clear **Points & rewards** switch enables/disables balances, reward animations and reward sounds. The engineering question/assistance flow remains available in either mode.
- Provide separate sound mute/volume and reduced-motion controls. Core confirmations remain understandable when both sound and animation are off.
- Prepare two presentation presets: **Rewards on** and **Quiet mode**. The presenter can change between them quickly, including for judge feedback.
- Keep the reward presentation modular so it can be removed later without changing evidence, questions or learning contracts.
- Turning points off should not silently delete accepted contributions or change their meaning. Whether an existing balance is retained, hidden or explicitly cleared is a settings decision; make that behavior understandable.

## A proposed contribution interaction

1. The avatar makes a small, quiet indication that one useful question is available.
2. The engineer opens it and sees the question, a compact source/context snippet and Yes / No, with unknown/later available.
3. Selecting an answer gives immediate visual acknowledgement. Saving is represented separately from reward confirmation if the network is slow.
4. On accepted contribution credit, the button and card settle smoothly, a small point increment moves into the balance, and the avatar reacts briefly.
5. If sound is enabled, play one short, soft sound synchronized with the confirmed reward. An answer corrected or rejected later is not accompanied by a punitive sound.
6. A short explanation makes the contribution tangible: “Linked this screenshot to the incident” or “Recorded a later recurrence.” Use the actual update, not an invented progress claim.
7. Return to work without requiring another answer. An optional next contribution can be offered within the person's remaining budget.

This sequence is a storyboard proposal to discuss with Artem. Motion curves, colors, pacing, sounds, reward values and exact avatar gestures remain creative decisions.

## Credit useful participation

| Contribution | Candidate credit behavior | Important meaning |
| --- | --- | --- |
| Confirm a supported case link | Small contribution credit | The answer concerns this link, not every claim in the case. |
| Reject an incorrect link or hypothesis | Comparable credit for a useful correction | A useful No is as welcome as a useful Yes. |
| Add relevant, nonduplicate evidence | Credit after acceptance | Volume and repeated uploads alone do not earn more credit. |
| Fill in a missing resolution or applicability condition | Credit reflecting the useful addition | Preserve the source and the limits of the report. |
| Correct an earlier answer | Clear acknowledgement and an eligible correction event | Truthful correction should remain easy. |
| Unknown / later / dismiss | Neutral, respectful acknowledgement | Missing knowledge is not a negative factual label. |

Exact amounts, caps and award rules are open decisions. Show honest placeholder/example values in design previews. Deduplicate by contribution/event ID so retries do not award twice. User points, claim support and the policy's training reward are separate records.

## Visual and sound direction

- Retain the white pixel-circle face as the initial character; Artem will supply further ideas about limbs, gestures and transformations.
- Explore a small anticipatory motion, responsive button press, gentle overshoot/settling and a compact completion flourish. The exact style should fit the character rather than becoming a separate effects layer.
- Let a small burst of pixels, a point trail or a brief glow communicate completion without obscuring source text or stealing keyboard focus.
- Explore a restrained sound palette: acknowledgement, contribution credited and optional milestone. Include a silent preview of every interaction.
- Use authentic contribution summaries or local milestones; do not portray a point increment as a calibrated increase in system accuracy.
- Respect the question budget. More available points should not cause the coordinator to invent unnecessary questions.

## Finding people is part of assistance

The interface should offer **People with relevant experience**, alongside applicable knowledge. Show people who participated in this incident, helped resolve a related incident or contributed a relevant check, with a concise reason and accessible source/case link.

Example card using synthetic placeholders:

> Mira · Performed the interface check in a related incident · Same equipment revision recorded · View case / Prepare question

Distinguish firsthand experience from someone merely mentioned in a copied conversation. Known contact information and verified identities can support a user-initiated contact flow. A prepared message includes the current symptoms, checks already performed and unresolved question, and is reviewed before sending. Ranking should reflect relevant contributions and current context, not points or global popularity. Access restrictions also apply to people and case associations.

## Proposed design-agent deliverables

1. Hear Artem's design ideas and agree on the visual direction before producing a complete asset set.
2. Storyboard the compact input, one question, reward, correction, relevant-person card and expanded history.
3. Define avatar states and transitions: idle, input, processing, question available, result available, reward and error/unavailable.
4. Produce motion studies and optional sound samples with a quiet/reduced-motion counterpart.
5. Provide an asset manifest: names, dimensions, timing, loop/one-shot behavior, triggering event and export format.
6. Hand off an implementation contract separating answer submitted, contribution accepted, points credited and evidence updated events.
7. Prepare rewards-on and rewards-off demo variants with equivalent assistance capabilities.

The separate frontend task integrates these assets into the Electron application. Intended macOS and Windows behavior, scaling and idle resource use need actual testing. This document does not start an animation agent or implement the points system.

## What to observe in a small trial

Compare the two modes using useful accepted contributions, answering time, voluntary participation, corrections, duplicate/low-quality submissions and perceived interruption. Use these observations to decide whether to keep or adjust the reward experience. Faster clicking alone does not establish faster learning.
