# investigation-fixes-4

Owned paths touched: `src/libs/utils/investigation/` (problem-parser, phrases, settings, gaps, recommend, people, investigate, index, README, new `fixes-4.test.ts`), `src/libs/utils/questions/` (generator-templates, coordinator), `src/libs/utils/retrieval/conditions.ts`, `src/apps/service/engine.ts`, `src/apps/service/views.ts`, `scripts/demo-reset.ts` (doc comment only).

Gates: `pnpm typecheck` clean; `pnpm test` 247 pass (233 baseline + 14 added or concurrent); `node --test 'benchmarks/**/*.test.ts' 'experiments/**/*.test.ts'` 77 pass.

## Fixes (each has a regression test in `investigation/fixes-4.test.ts`)
1. Main symptom: lexicon rules `traffic-absent` / `traffic-flowing` (configurable). "TRN-301: changed the SFP, link up, alarms cleared, no traffic" now gives component.replaced, interface.status=up, alarms.state=cleared and traffic.state=absent. "no traffic counters" is not a traffic state.
2. Model: configurable `ModelParserConfig` (default patterns, case-sensitive token pattern, asset-id exclusion). New `settings.problemStated` (default key unit.model): a case that records a different model is an ordinary distinguishing conflict (retain-uncertainty naming both). A case that records none while the problem states one gets a consequential missing condition "Earlier unit's model is N5", question template `problemStatedTemplates` ("Is ACC-12 an N5?", article by sound: "an N5"), answers recorded as match/conflict. Attributed answers are kept beside the stated condition and win on their key.
3. Loop: `Engine.investigate` restores loop 'answered' + its reason when the stored state was answered and the refresh needs no new question.
4. Contact draft: first bullet is the sentence containing the first requester-observable symptom; all valued conditions; valueless skipped. Lexicon labels support `{value}` ("Installed in 2018", "Component replaced: sfp").
5. Caveat wording: `polishCaveat` in views.ts, applied to result views, question views, `cases()` and `caseView()`. Root cause is in `memory/case-view.ts` (not mine); the sentence is reworded at the service layer. People reason evidence is ordered so the span mentioning the action/check comes first.
6. After a No on a applicability question: kind stays retain-uncertainty, applicability 'unsupported'; caveats now add "<case> does not apply to this unit, going by the answer you received: ..." and the receipt says "The earlier case does not apply to this unit, so the recommendation stays uncertain." (outcome question: "No recovery is reported in the earlier case ..."). No enum words in prose.

## config-rollback-private p1 (in-memory service, family dir imported, member principal groups noc / change-review / slack-channel:C001CO)
Text used: "ACC-33 is an N5 and lost voice VLAN 210 after the template v7 push. Can I roll it back to v6 like Jarmo did on ACC-12?" (I saw this text and the incoming observation shape by grepping incoming.json while exploring; I did not read truth.json.)
- Extraction records only `unit.installed_year=2019` for ACC-12 (the "N3" in the case text is not extracted; that is memory/extraction, not mine), so there is no direct conflict; the model is the unknown.
- Before: qualified, "Confirm the unit details (older unit, installed 2019)", question "Is this true for ACC-33: older unit, installed 2019?".
- Now: kind qualified, text "Confirm the unit details (older unit, installed 2019; earlier unit's model is N5) before rolling back the config."; open question to Antti Korhonen: "Is ACC-12 an N5?" (loopReason "Asked Antti Korhonen because they reported a problem on ACC-12").
- Answer No (recipient): receipt "You answered no to "Is ACC-12 an N5?". The earlier case does not apply to this unit, so the recommendation stays uncertain."; recommendation retain-uncertainty, text "Don't reuse the fix from ACC-12: another model there, model N5 here."; caveat "ACC-12 does not apply to this unit, going by the answer you received: another model there, model N5 here."; loop 'answered', and a re-POST keeps 'answered' / "The answer was used to update the recommendation".
- Answer Yes: qualified, nextStep "...reportedly helped in ACC-12 (earlier unit's model is N5, confirmed)...", the older-unit gap is the next open one.
- Case caveat: "Recovery is reported, not verified (timing, cause and lasting unconfirmed); 5 of 6 source records are independent (copies and retellings are not counted)."

## Elisa checks (own instance: `main.ts --port 47994 --db :memory: --seed elisa`, requester Veikko Vikkelä, no groups)
TRN-088 ("At site now. Replaced the SFP on TRN-088, an older unit from 2018. Link is up, alarms cleared, RX power normal, but no traffic. Counters zero."):
- check-first: "Check the traffic counters before replacing the SFP again."
- nextStep: "If the interface is up and counters stay at zero, disabling and re-enabling the interface reportedly restored traffic in TRN-042 (older unit)."
- caveats: ["Reported once; cause and lasting effect not verified."]; loop no-question-needed ("Existing evidence and your own observations settle the next step"); no question.
- top matches TRN-042 (matching includes "Traffic absent", "Older unit"), TRN-117; case caveat "...; 8 of 9 source records are independent (copies and retellings are not counted)."
TRN-301 ("TRN-301: changed the SFP, link up, alarms cleared, no traffic"):
- qualified: "Confirm the unit details (older unit) before disabling and re-enabling the interface."
- nextStep: "Disabling and re-enabling the interface reportedly restored traffic in TRN-042, but it is not known whether that applies here. Check the unit details (older unit) and check the traffic counters."
- caveats: ["Reported once; cause and lasting effect not verified.", "Unknown for this unit: older unit."]
- loop question-open ("Asked Erkki Expert because they can observe this through their role (Network Expert)"), question "Is TRN-301 an older unit?"; matches TRN-117 then TRN-042, TRN-042 matching now includes "Traffic absent" (the main symptom).
People for both: Erkki Expert (Advised the interface reset in TRN-042), Aarne Koskela, Helmi Virtanen, Tapio Lehto.

## Not done / limits
- The model of the earlier unit is not extracted from case text (memory layer); handled as a question. If extraction later records unit.model, the direct-conflict path applies without change.
- Caveat wording is fixed at the service layer, not in `memory/case-view.ts`; any consumer reading `buildCaseView` directly still sees the old sentence.
- A re-POST after an answer that leaves another open gap asks the next question (kept: that is new information needed, not a lost attribution).
- The model token pattern is conservative (uppercase, 1-3 letters + 1-3 digits); lowercase "n5" and models shaped like asset ids are not recognised.
