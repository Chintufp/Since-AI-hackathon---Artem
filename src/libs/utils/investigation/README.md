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
- Recommendation gates: corrective action needs `supported` + `applicable` -> `reuse`, or `check-first` when a diagnostic check preceded it in the case (text names the check before the action); `supported` + `qualified` -> `qualified` naming the missing condition with a check first; diagnostic check needs weak+ support and applicability >= qualified -> `check-first`; conflict or contradicted outcome -> `retain-uncertainty` naming it; else `none`. Text always names the basis and what is unconfirmed; it never says a fix will work.
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
- The default unit-year lexicon rule requires a hardware context word; parser inferences (`origin: 'inferred'`) never settle a distinguishing key.
- `investigate()` defaults `previous` to the stored state, so re-running a problem is idempotent, and reuses answers from earlier investigations about the same asset (inventory facts only).
