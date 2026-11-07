# Experts disagree (generated, synthetic)

**What.** One Teams thread (`teams.json`) and the two people in it (`people.json`):

- Aarne Koskela (Field Engineer) is at TRN-512 after replacing the SFP: link up, alarms cleared, traffic counters at zero.
- Helmi Virtanen (Network Expert) asks "Which batch is it?"; Aarne answers flatly "It is the 2021 batch."
- Helmi: on the 2021 batch the interface reset does not help; clear the forwarding table on the node instead.
- Aarne: "Cleared the forwarding table." / "Traffic is back."

**By whom.** Written by the day-2 B5 build (an agent working for Artem, 7 November 2026). Nothing here comes from Elisa.
The names reuse the synthetic `data/scenarios/optic-forwarding-a` directory (same ids and actorIds), so the two people
merge with the ones already in the store. Times only, no date, like the other Teams threads.

**Why.** BUILD_BRIEF section 4, B5 ("experts disagree"): a second expert's case whose advice differs from the first
expert's (disable and re-enable the interface on older units) and that is decided by a different fact (the unit's
batch, condition key `unit.batch`). A new problem on a unit of unknown batch then has two qualified hypotheses, each
with its expert, and one question: "Is TRN-577 from the 2021 batch?". The answer picks the branch; neither expert's
case is overwritten.

**How it is used.** `POST /demo/reset` imports this directory (format `scenario-dir`; this README is not a source) when
Elisa's thread was imported (seed `elisa` with the files in `private/`), so Erkki's TRN-042 is the first expert. On a clean
clone it is left out: the other branch would be Helmi's own TRN-117 and the walkthrough texts would change
(`EngineOptions.expertsDisagreeDir` seeds it on any seed, for tests). It deliberately does not live under `data/scenarios`: it is not a family (no truth, no
incoming problems) and must not change `families.json`. Decisions: `docs/runs/2026-11-07-overnight/day2/DECISIONS-disagree.md`.
