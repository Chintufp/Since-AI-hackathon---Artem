# Scenario review notes (reviewers only)

**HIDDEN.** This file describes answer keys. It is for the independent reviewer and the evaluation owner. Implementers do not read it and nothing in it may be copied into `src/`.

Status: **unreviewed**. Authored by one Claude agent (evaluation owner) in a single pass; no human or second-agent audit has happened yet. Results scored on these keys stay provisional and cannot satisfy the promotion rule until a reviewer records the procedure and unresolved ambiguities below.

## What is here

Ten synthetic families of a Nordic telecom network-operations world. Split by family: demo 2 (`optic-forwarding-a`, `remote-power-access`), train 4 (`bgp-firmware-flaps`, `fan-temperature`, `config-rollback-private`, `cabling-pinch`), validation 2 (`weak-mains-psu`, `bgp-linecard-private`), test 2 (`transponder-laser`, `rooftop-threshold`). No family is derived from another, so `derivedFrom` is unused in the real data (the leakage check is exercised on synthetic manifests in `benchmarks/splits.test.ts`). The two test families are hash-locked in `TEST_LOCK.json`.

Each family directory: `sources/` (visible: `teams.json`, `email-NN.txt`, `slack-export/`), `people.json` (visible), `truth.json` and `incoming.json` (hidden).

Names are Finnish-style and invented; node, site and cabinet ids, codes and vendors are illustrative. The organizer example was only used as a style reference (Teams JSON with seq/time/author/role/text, plain email with headers). None of its text or identifiers was copied; a test greps the whole directory for the organizer names and incident id.

## How the keys were authored

1. Wrote each family as a spec (`benchmarks/authoring/families/*.ts`): cast, messages per provider with incident labels, truth per incident (real cause, expected claims, attempts, outcome, per-person knowledge and observability, access groups), and 3 incoming problems with keys.
2. `benchmarks/authoring/build.ts` renders the visible files and derives all source ids mechanically, so the truth `sourceIds` cannot drift from the sources. Slack `ts` values are generated from the stated day and time with a unique counter suffix. Source id forms: `teams:<seq>`, `email:<Message-ID header value including angle brackets>`, `slack:<ts>`.
3. Answers in a key are limited to what a person's recorded knowledge or observability covers. A test enforces that every yes/no answer's condition key appears in that person's `knows` or `canObserve` for some incident in the family.
4. Truth claims were listed only for statements actually present in the sources. The list is deliberately **not exhaustive** (small talk and trivia are excluded), so claim precision is a lower bound; see ambiguities.

## Label definitions

- **Claim types** (contract `ClaimType`): `observation` something seen or measured; `hypothesis` a suggested cause not confirmed; `advice` a recommended check or action (conditional advice is one claim that includes its condition); `action` something reportedly performed; `outcome` a reported result; `condition` an equipment or environment fact; `access-fact` a non-incident operational fact.
- **Attempt `performed`**: true when a person reports doing it; false when it was only proposed, advised against, or alternative. Only three attempts are `performed: false` (`firmware.downgrade`, `power.cycle.shelf`, `site.visit`).
- **Outcome `lasting`**: `confirmed` only when a later, separate observation says it held (an email three days later, a next-day Slack update). A same-day statement from the person who did the work is `unknown`. `recurred` when a later incident in the family shows the problem returned. A reported recovery is never `confirmed` by itself.
- **Case status expected** (`expectedStatus` in the evaluator): confirmed to `verified-resolved`; recurred to `recurred`; unknown with recovered/partial to `reported-recovered`; unknown with unknown to `unknown-outcome`; otherwise `open`.
- **`applicable`**: `reuse` the historical response applies and is supported; `qualified` applies with a stated caveat (unverified outcome, possibly stale, partial); `inapplicable` a lookalike that a known condition rules out; `none` no historical response applies.
- **`expectedRecommendation`**: the class the system should end with after the one consequential gap's answer is revealed, or after it proved unanswerable. `reuse` conditions match and the response worked; `qualified` apply with caveats and no question would change the action; `check-first` a consequential condition cannot be resolved and must be checked before acting (used for every unanswerable gap); `retain-uncertainty` history is inconclusive; `none` do not recommend a historical response.
- **`consequentialGap`**: the single missing fact whose answer would change the recommendation. `answerers` are people with a question-specific reason to know or observe it (recorded in `knowledge`); `unanswerable` means no answerer can respond (all unavailable in `people.json`).
- **`noQuestionNeeded`**: true when sources and observations already settle the decision; it implies no gap (a test enforces "gap iff a question is needed"). Fifteen of 30 problems are no-question, fifteen need one, so constant silence and constant asking both lose.
- **`answers`**: person to condition key (optionally `key=value`, `key@Entity`, `key=value@Entity`) to yes/no/unknown. A yes on one value of a single-valued condition implies no for another value (oracle rule).
- **Multi-step**: the contract has one gap per problem. Multi-step problems (`bgp-firmware-flaps-p1`, `cabling-pinch-p1`) list the steps in order in `distinguishingConditions` and carry answers for both keys; the first answer decides which later question matters.
- **Access**: an incident's `accessGroups` must intersect the requester's `groups` for its sources to be shown. Private Slack channels also list members. `config-rollback-private-p1` and `bgp-linecard-private-p1` are the problems where citing the related private incident would leak.

### Tags and where they are realized

| Tag | Families (problems) |
| --- | --- |
| same-incident-continuation | optic-forwarding-a (p2), cabling-pinch (p2; Slack follow-up in the sources), rooftop-threshold (next-day Slack update) |
| lookalike-different-cause | optic-forwarding-a (p1), bgp-firmware-flaps (p1), bgp-linecard-private (p1, p2), transponder-laser (XC-2 vs XC-4) |
| temporary-recovery | remote-power-access, fan-temperature, weak-mains-psu |
| recurrence | remote-power-access, bgp-firmware-flaps (p2), weak-mains-psu (p3) |
| missing-outcome | optic-forwarding-a, transponder-laser (p1) |
| duplicate-report | fan-temperature (two NOC engineers), bgp-linecard-private (Teams plus Slack), transponder-laser (Slack pair) |
| copied-retelling | optic-forwarding-a (email retells Teams, Slack retells email), config-rollback-private (email), bgp-linecard-private (email) |
| wrong-recipient-trap | remote-power-access (p2, p3), config-rollback-private (p1, p3), transponder-laser (p3) |
| changed-permissions | config-rollback-private (p1), bgp-linecard-private (p1) |
| no-question-needed | all families have at least one |
| useful-no | optic-forwarding-a (p1), config-rollback-private (p1), bgp-linecard-private (p1), rooftop-threshold (p2) |
| no-answer | remote-power-access (p2), cabling-pinch (p3), rooftop-threshold (p3) |
| access-fact | remote-power-access (p2), weak-mains-psu (p2), rooftop-threshold (p1) |
| conflicting-conditions | bgp-firmware-flaps (p1), fan-temperature (p2), config-rollback-private (p1), transponder-laser (p2) |
| multi-step | bgp-firmware-flaps (p1), cabling-pinch (p1) |

Faults covered: optical module replacement with forwarding or laser state, BGP flaps after firmware, power supply and mains instability at remote sites, fan and temperature, config rollbacks, a cabling fault. Equipment families and install years vary (2015 to 2024). Outdated advice later contradicted or qualified: filter-only advice (`fan-temperature`), rollback to v6 (`config-rollback-private`), PSU swap (`remote-power-access`, `weak-mains-psu`), patch 11.2.1 (`bgp-linecard-private`). Conditional advice: reset only on older revisions, tray swap only on FT-2, patch only on LC-2, threshold fix only after 5.1.0, snowmobile route only from 1 December to 30 April.

Condition keys come from `contracts/vocabulary.ts`. Nine extension keys (organizations extend the vocabulary by configuration) are used in keys and observations and listed in `benchmarks/scenarios.test.ts`: `interface.crc_errors`, `power.mains_sag`, `power.breaker_inspected_at_first_visit`, `power.scope`, `site.access_code_current`, `cable.condition`, `cable.guard_fitted`, `config.saved_startup`, `config.rollback_supported`.

## Ambiguities I noticed

1. **Email source id brackets.** Truth uses the header value exactly (`email:<id@kalevanet.example>`). The evaluator normalizes by stripping angle brackets, so either adapter convention scores identically.
2. **`by` fields** in truth are directory person ids (`person:directory:<slug>`), not display names. The evaluator resolves system actors through `people.json` actor ids and names.
3. **Expected recommendation is the post-answer class.** An implementation that reports a correct interim `check-first` and then updates will be scored on its final output only. A reviewer may prefer an interim/final pair; the contract has no field for it.
4. **Single gap per problem** forces multi-step into ordered conditions (see above).
5. **Truth claim list is not exhaustive.** True but unlisted claims lower precision. Ambiguous (Jaccard 0.3 to 0.5) and `other`-typed claims are reported separately, but a faithful extractor can still be penalized for a legitimate extra claim.
6. **Same-day vs lasting outcomes.** I used a rule (same-day self-report is `unknown`; a separate later observation is `confirmed`). Some reviewers may count the NOC confirmation in `fan-temperature` and `remote-power-access` as independent support; I did not, because both later recurred.
7. **Time visibility.** Teams is time-only by design. Order between a Teams incident and a later Slack or email incident is stated in prose ("last week", "three weeks after") and by Slack/email dates. Nothing requires inventing a date for Teams.
8. **Copy semantics.** A "copy" is a retelling with no new observation. In `optic-forwarding-a` the Slack post retells the email which retells Teams; both are copies of the original report. Independent confirmation is only a separate observer or a later observation.
9. **Private channel vs groups.** Visibility is modeled twice (Slack `members` and incident `accessGroups` against person `groups`). They agree in the two private-channel families; a reviewer should confirm no other family needs a group restriction (for example `transponder-laser` and `optic-forwarding-a` are visible to all roles shown).
10. **Requester as answerer.** A test forbids the requester from being the only answerer of their own gap, even where a real on-site requester could observe it (for example the engineer physically at a switch). This is a design choice to keep recipient ranking testable.
11. **Unknown answers for mentioned people.** For wrong-recipient traps (a mentioned person), the key says `unknown`. A real person might say "no, that was not me"; the key does not model that distinction.
12. **Paraphrase independence.** All ten families were written by one author, so shared phrasing and structure may help a learned system on validation/test more than truly independent authorship would.

## Items a reviewer should double-check

- `optic-forwarding-a-p2`: expected `reuse` after the NOC observation; arguably `qualified` because recovery is one observation window.
- `transponder-laser-p1`: expected `reuse` after Joonas answers yes; he is the only source, so `qualified` is defensible.
- `fan-temperature-p1` expects `qualified` with `laterOutcome: temporary`; the filter-first advice is historically temporary-only. `fan-temperature-p3` expects `retain-uncertainty` with `applicable: none`.
- `remote-power-access-p1` and `weak-mains-psu-p3` expect `qualified` without a question although a mains/breaker check might justify one; the sources already name the finding.
- `bgp-firmware-flaps-p3`, `bgp-linecard-private-p3`: gap answered yes from NOC observation; confirm the answerer's `canObserve` is realistic.
- `config-rollback-private-p3` is no-question because the saved-to-startup fact is in the visible Teams message and email; Tuula (approver, no firsthand knowledge) is the trap.
- `rooftop-threshold-p2` (`useful-no`): the answer is firmware version, observable by the NOC engineer; confirm `none` (rather than `retain-uncertainty`) is the right final class.
- Access-fact codes and the "call 24 hours ahead" style rules are synthetic; confirm none resembles a real site.
- Confirm `accessGroups` for each incident against the cast (especially `transponder-laser` incident B and `optic-forwarding-a` incident A, which include `planning`).
- Verify every `lasting` value against the rule in "Label definitions".
- Re-run `node --test 'benchmarks/**/*.test.ts'` after any edit; edits to a test family require `node benchmarks/authoring/build.ts` and will intentionally change `TEST_LOCK.json` (re-freezing is a deliberate, recorded act).


## Fix pass notes

- **`changed-permissions` is realized only as static restricted access.** `config-rollback-private` and `bgp-linecard-private` model a private channel whose group excludes the requester; no source models a grant or revocation over time. The contract tag list cannot be renamed here, so treat slices for this tag as "restricted access", not "permission change over time". A membership change is not modeled.
- Answer keys changed in the fix pass (non-test families only; `TEST_LOCK.json` unchanged): `optic-forwarding-a-p2` now lists Helmi (who can observe traffic.state) as an answerer; `bgp-firmware-flaps-p1` lists Hanna as an answerer of the second step; `config-rollback-private-p1` decisive condition is `config.rollback_supported=false` (unit.model is already observed by the requester); the `optic-forwarding-a` handover email is now recorded as a copy of both Teams messages 1 and 9 (two `copies` rows).
- **Open item in a frozen test family, deliberately not edited:** `transponder-laser-p1`: `ismo-vainio` can observe a gap condition in truth but is not an answerer and has no stated answer. The audit test covers demo/train/validation only. Re-freezing the test split is a recorded decision for the orchestrator.
- Truth uses 12 extension actions beyond contracts `ACTIONS` (see `benchmarks/actions.ts`), each declared with its canonical roll-up.
