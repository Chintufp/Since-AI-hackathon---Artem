# investigation

Turns a new problem into an `InvestigationState`: candidates, hypotheses with separate support and applicability, a recommendation gated by evidence class, consequential gaps, and people with relevant experience. Everything is access-filtered by the requester's principal.

## Public interface (`index.ts`)
- `investigate({problem, store, principal, deps, previous?})` -> `InvestigationState` (persisted to the store). `deps = {retriever, assessor, generator?, selector?, settings, clock?, directory?, parser?}`. Recorded observations and answers for the investigation are always applied, so calling it again with `previous` rebuilds the state after new evidence.
- `parseProblemText(text, problemId, {lexicon})` / `DEFAULT_LEXICON`: configurable regex lexicon -> `Condition`s with the shared vocabulary keys (link up, counters zero, RX normal, alarms cleared, old unit/2019 -> `unit.age=older` + `unit.installed_year`, replaced the SFP, rebooted, barrier). Handles negation; origin `inferred` for the year rule.
- `RulesAssessor({store, settings, mode: 'separate' | 'combined'})` implements `Assessor`.
- `recommend`, `buildGaps`, `buildPeople`, `computeBudget`/`budgetViolations`, `storeDirectory`, `loadCaseFacts`/`supportFor`, `makeGapId`/`parseGapId`, `defaultInvestigationSettings`.

## Rules
- Support (history only): `contradicted` if an outcome is no-change/worse/recurred; `supported` if the action was reported performed and recovery was reported; `weak` for advice only, an unreported outcome or partial; `unknown` when nothing is recorded.
- Applicability (condition comparison only): `inapplicable` on any conflict on a distinguishing key; `qualified` when a distinguishing condition is unknown (or a non-distinguishing conflict, or nothing matched); `applicable` otherwise.
- `combined` mode collapses both into one verdict (for the E04 contrast); `separate` keeps them identifiable.
- Recommendation gates: corrective action needs `supported` + `applicable` -> `reuse`, or `check-first` when a diagnostic check preceded it in the case (text names the check before the action); `supported` + `qualified` -> `qualified` naming the missing condition with a check first; diagnostic check needs weak+ support and applicability >= qualified -> `check-first`; conflict or contradicted outcome -> `retain-uncertainty` naming it; else `none`. Wording never changes a gate (see Polish pass 2); it never says a fix will work.
- Gaps come from the hypothesis the recommendation depends on: each missing distinguishing condition is consequential with `whatAnswerChanges`; a reported-performed action without outcome is consequential; unknown lasting effect is not consequential when support is already `supported`. Conditions the requester can observe themselves (`requesterObservableKeys`) stay as gaps but the recommendation says to check them and no human question follows. Observations supplied by the requester are merged into the problem conditions, so they resolve gaps without a question.
- Gap ids are parseable (`gap|investigation|kind|case|detail`) so downstream stages never need hidden state.
- People: from `PersonWorkLink`s on relevant candidate cases and firsthand links to the problem's entities; firsthand first, "mentioned only" flagged; requester excluded; only cases the principal may see are linked; `askable` from budget, cooldown and availability.
- `state.routes` lists parser, retriever (and per-candidate retrieval), assessor and, when used, generator routes; the coordinator adds the selector route.

## Dependencies
`contracts`, `retrieval`, `models/routes`. Directory convention: a person's groups are the person entity's `accessScope.groups`; role and availability are the `role` and `available` attributes (pluggable through `PersonDirectory`).

## Configuration
`InvestigationSettings`: `distinguishingKeys`, `ignoredKeys`, `historyKeys`, `requesterObservableKeys`, `diagnosticActions`, `observability` (groups/roles -> observable keys), `coordinator` limits, `questions` templates. Defaults are neutral; nothing names an incident, device family or person.

## Checks run
`node --test 'src/libs/utils/investigation/**/*.test.ts'`: 13 tests passing (parser, reuse path, conflict via unit.age and unit.model, missing condition, requester-observable gap, access filtering, people, combined vs separate, missing/no-change outcomes, route listing).

## Known limitations
- Applicability uses a configured list of distinguishing keys, not learned ones; a case with no distinguishing conditions counts as applicable when nothing conflicts.
- Only the selected hypothesis produces gaps; competing hypotheses are compared but their own gaps are not queued.
- Procedure-only candidates are assessed as `weak` and never yield a corrective recommendation.
- `investigate` calls the generator only to set the loop status (`no-question-needed` or `deferred`); asking happens in `questions/coordinator`.

## Fix pass notes
- The default unit-year lexicon rule requires a hardware context word. (Superseded in polish pass 2: a hardware-context year folds into `unit.age` through `ageFold.olderThroughYear`, and the raw year is an ignored key.)
- `investigate()` defaults `previous` to the stored state, so re-running a problem is idempotent, and reuses answers from earlier investigations about the same asset (inventory facts only).

## Polish pass 2 (wording, gaps, loop reasons, people)
- **Wording** (`phrases.ts`, `settings.phrases`): `Recommendation.text` is a short heading (<= `phrases.maxTextLength`, 140) in plain words; details are in `nextStep` and `caveats`. Action names go through a configurable `ActionPhrase` map (imperative / gerund / noun / past; `interface.reset` -> "disable and re-enable the interface", `counters.check`, `sfp.replace`, `device.reboot`, ...) with a humanized fallback for unknown actions ("cable.replace" -> "replace the cable"). Cases are named by their short label (`shortCaseLabel`: the case's asset id such as "TRN-042", else a short title head), never a raw id. Conflicts are phrased "older unit there, newer unit here"; hedge/provenance suffixes ("(hedged in source)") are stripped by `plainLabel`. Gating semantics are unchanged (reuse / check-first / qualified / retain-uncertainty / none); only the strings changed.
  - Example (check-first): text "Check the traffic counters before replacing the SFP again." / nextStep "If the interface is up and counters stay at zero, disabling and re-enabling the interface reportedly restored traffic in TRN-042 (older unit)." / caveats ["Reported once; cause and lasting effect not verified."] plus "Unknown for this unit: ..." for each missing distinguishing condition.
  - `recoveries` (action -> "restored traffic", default "helped") and `conditions` ("key=value" -> "the interface is up") are configuration too.
- **Distinguishing keys**: `unit.installed_year` is no longer distinguishing and is an ignored key; `unit.age` is. `settings.ageFold = {yearKey, ageKey, olderValue, olderThroughYear (default 2019, null disables), hedgeMarkers}` folds a stated year into `unit.age=older` for the problem (parser) and for case conditions (retrieval `compareConditions`). A hedged year (label matches `hedgeMarkers`, or origin `inferred`) on the case side is never folded.
- **Hedged/inferred conditions** (`hedgeMarkers`, `isSoftCondition`): a missing distinguishing case condition that is hedged in its source or inferred never becomes a gap; it still appears as "Unknown for this unit" in the caveats.
- **Related candidates** (`related.ts`, `relatedMinMatchingConditions` = 2): only candidates that match at least two non-history conditions (or concern an entity of the problem) may drive the recommendation, gaps and questions, and may contribute people. Unrelated lookalikes stay in `candidates`/`hypotheses` (and the UI's match list) but are inert. The parser lexicon gained `bgp.session` and `config.changed` phrases so lookalike problems of other families match on conditions.
- **Loop states** (`settings.loopReasons`, `InvestigationState.loopReason`, filled for every loop value): `no-question-needed` -> "Existing evidence and your own observations settle the next step" (also when the only open gaps are requester-observable or hedged); `deferred` + "No one with firsthand knowledge is available to ask right now" (a consequential gap but no eligible recipient), "Everyone who could answer has already been asked", "...busy or were asked recently", or "Holding the question..."; `exhausted` only when the per-investigation question budget is used; `question-open` -> "Waiting for <name> to answer one quick question"; `answered` -> "The answer was used to update the recommendation".
- **People** (`people.ts`): from related candidate cases only; ordered by the case the recommendation depends on, then the case's candidate score, with firsthand people before mentioned-only people (always last, reason text "Mentioned in TRN-117 (not firsthand)"), then most informative contribution, recency, name. Reasons are deduplicated per (case, contribution), merged when a person performed an action and reported its outcome ("Performed the interface reset and reported recovery in TRN-042"), phrased from `phrases.contributions` with the action the person actually performed/advised, at most `maxReasonsPerPerson` (3) each and `maxPeople` (6) people.
- Exports for other modules: `shortCaseLabel`, `actionPhrase`, `plainLabel`, `conflictInWords`, `DEFAULT_PHRASES`.
