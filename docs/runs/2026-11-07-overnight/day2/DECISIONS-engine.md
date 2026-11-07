# Decisions · B1 part A · Engine: time (validity, supersession, point-in-time `at`, GET /context, follow-ups)

Made by the B1 implementer on branch `day2/b1` (7–8 November 2026). Each entry: what, why, how to reverse. Folded into the main DECISIONS at integration.

## D-B1-01 · 'superseded' is not live for the stored case

`ClaimStatus` gains `'superseded'`; `isLive` (provisional | supported) is unchanged, so a superseded claim drops out of the persisted case's attempts, outcomes and conditions. The stored case is the *now* view. A past `at` re-derives what it needs from claims valid at `at` (candidate conditions and case facts; see D-B1-12).
Why: one meaning for the stored case; everything that reads it today (views, recipients, gaps) keeps showing the current state.
Reverse: add `'superseded'` to `isLive` in `memory/case-builder.ts` and filter by `validAt` at query time instead.

## D-B1-02 · Validity rule: unknown from, unknown to

`memory/validity.ts validAt(claim, atMs)`: an unknown `from` is "valid from before any dated moment"; a known `from` after `at` is not valid; a known `to` is exclusive; an unknown `to` is "still believed true", **except on a superseded claim**, which is then closed at every moment (its newer claim, itself undated, already holds from before any dated moment, so both cannot hold).
Why: the whole Elisa TRN-042 thread is time-only; without this rule it would vanish at every `at`. Never defaults an unknown time to now.
Reverse: change `validAt`; its test pins the rule.

## D-B1-03 · "Newer" compares known times, else import order, and says so

`isNewer(a, b)`: both `validity.from` known → compare instants (equal is not newer), basis `known-time`; otherwise import order (`createdAt`, then the store's insertion order), basis `import-order`. The basis is stored on the closed claim as `validity.orderBasis` and shown by GET /context.
Why: `compareTime` falls back to thread sequence, which cannot order a dated follow-up against a time-only thread.
Reverse: `memory/validity.ts`.

## D-B1-04 · Condition.qualifier (additive)

`Condition.qualifier?: string` says what a key is about inside one entity when the entity has several (barrier vs lockbox code at the same site). The newer-value rule compares key + qualifier.
Why: one email gives a barrier code and a lockbox code for RBS-310; with the key alone the second would close the first.
Reverse: drop the field and the qualifier comparison in `memory/supersession.ts`.

## D-B1-05 · GET /context lists every status and marks validAt

Rows are all claims whose subjects include the entity plus all claims of its (visible) cases, any status, each with `validAt` for the requested moment (default: the engine clock). A claim is listed only when the principal may see its record scope and at least one supporting evidence; `supersededBy` and a `validityCondition` set by a note are omitted when the principal may not see that other claim. Undated rows sort first (valid from before any dated moment), then by known time. Bindings: firsthand person links on those cases/claims (not rejected, visible evidence) and hedged or inferred class conditions (unit age/model/revision/installed year/software version) of the entity. Time positions come from `timePosition()`, which never builds an iso for time-only or date-only sources.
Reverse: `memory/context-assertions.ts`.

## D-B1-06 · Short caption dates are read in UTC

`shortDate()` renders a known instant as "14 Oct" in UTC (no organization time zone is configured yet). Unknown times are never given a date; captions then use `describeTime()` text.
Reverse: pass a time zone to `shortDate`.

## D-B1-07 · A "fixed in firmware X" note bounds older advice; it does not close it for everyone

A sentence matching `validityCues.fixedInVersion` ("fixed in firmware 4.2", "the 4.2 firmware fixes ...") is checked before access facts and before outcome classification and becomes one claim of type `other` (caseless) with `supersessionBound = software.version gte 4.2`; the other sentences of that message become `other` claims too (they explain the note, they are not new advice for the case). `memory/supersession.ts` then gives every older live hypothesis/advice claim with an overlapping subject `validity.condition = "software.version < 4.2"` and `validity.conditionedBy = <note id>`; their status stays as it was. The recommendation reads the bound only when the problem states a version inside it (D-B1-13).
Why: Erkki's note says units already on 4.2 should not see the bug; for a unit of unknown version his advice still stands (TRN-088 keeps "Check the traffic counters ..."). Closing the advice for everyone would make TRN-042 unusable for every older unit.
Reverse: set `status: 'superseded'` in rule (b) instead of the condition, or remove the note patterns from `defaultValidityCues.fixedInVersion`.

## D-B1-08 · Newer-value rule: listed keys only; undated order needs an explicit cue

Rule (a) applies only to condition keys in `validityCues.newerValueKeys` (`site.access_code`, `software.version`) and compares key + qualifier (D-B1-04). When the newer/older order rests on known event times it fires on its own; when it rests on import order (an undated source) the newer claim must carry a replacement cue (`validityCues.replaces`: "is now", "no longer", "new code since", "changed the lock" ...). Both directions are checked, so importing the older email after the newer one still closes the older value.
Why: state readings (interface up/down) change every minute and are not replaced facts; an undated re-import must not silently close a claim that only looks older because it was imported first.
Reverse: edit `newerValueKeys`, or drop the `import-order` cue check in `applySupersession`.

## D-B1-09 · An access fact that gives a code carries it as site.access_code

An access-fact sentence with a code (`validityCues.accessCode`: barrier|gate|lockbox|door|hatch|access code ... digits) gets the condition `site.access_code eq <digits>` with qualifier = what it opens (barrier, lockbox ...) instead of `site.access eq <kind>`; the statement stays verbatim. Sentences without a code keep `site.access`. `site.access_code` is added to `contracts/vocabulary.ts`.
Why: both "Road barrier code: 5802" and "Barrier code at RBS-310 is now 7731" were `site.access eq barrier`, so the newer-value rule could never see the change. A first version emitted a second claim per code; E00 then counted the extra claims (access-fact precision on the demo split 2/3 -> 2/4) and a person-link id moved, so it was replaced by this one-claim form, with which E00's result files change only in timestamps and latencies (17/17 checks pass).
Reverse: in the access-fact branch of `extractor-rules.ts` always use `site.access`.

## D-B1-10 · Message-level cues: "every October", "until <date>"

"every <Month>" anywhere in a message lands on the nearest preceding access fact of that message (the code claim preferred) as `validity.condition = "changes every October"`, and the cue sentence is added to that claim's evidence. "until <date>" / "from <date> to <date>" in a claim's own sentence set `validity.to` as a **date-only** time (raw kept, no year or zone invented), which the validity rule treats as unknown. A replacement cue anywhere in a message marks that message's access facts (`validity.cue`).
Why: in Eino's email "changes every October" is a separate sentence with no access cue.
Reverse: `applyValidityCues` in `extractor-rules.ts`.

## D-B1-11 · Links of a superseded claim stay

`rebuildCase` keeps the person link of a superseded claim (only retracted, corrected or contradicted claims reject their links).
Why: the person still said it; the window closed, the attribution did not.
Reverse: `case-builder.ts`, links section.

## D-B1-12 · What a past `at` sees

`Problem.at` (and `at` on POST /investigate, kt_investigate, kt_get_context) re-runs the same pipeline as of that moment:
- an evidence gate at the moment (`retrieval/access.ts gateAt`): evidence with a known event time after `at` is invisible; undated (time-only, date-only, unknown) evidence stays visible;
- observations and answers recorded after `at` are left out (this investigation's, and answers reused from other investigations);
- `loadCaseFacts` and `buildCorpus` keep only claims valid at `at` (`validAt`); superseded claims whose window covers `at` count, closed ones do not. Without `at` (now), only superseded claims are dropped; every other status behaves as before;
- a candidate case's conditions at a past `at` come from its condition claims valid then (live or superseded), not from the stored (now) case;
- attempts and outcomes are still the stored ones (built from live claims), filtered by the gate at `at`. A superseded action or outcome claim is therefore not re-derived into an attempt for a past `at` (none exist today; the newer-value rule touches only access codes and software versions).
- The moment is part of the problem id (only when given, so every existing id is unchanged), `allowQuestions` is forced false, and the state carries `problem.at`; anything that later counts reuse must skip states with `problem.at`.
Reverse: drop `at` from `Engine.investigate`; the library changes are inert without it.

## D-B1-13 · The superseded caveat and the cap

`recommend.ts applyBounds`: when the basis case's hypothesis/advice claims are bounded by a visible note valid at the moment and the problem states a value inside the bound (`software.version` 4.2 or later for `gte 4.2`, numeric version compare), the recommendation gets the first caveat "Superseded on 14 Oct by Erkki Expert: fixed in firmware 4.2" (date from the note's own known time, `describeTime` text when unknown; the product word from the note's cue) and is capped: `qualified` with the case's diagnostic check as the step when it has one, otherwise `none`; the next step names the asserter to ask. `retain-uncertainty`/`none` only gain the caveat. A problem that states no version is not affected (TRN-088 keeps "Check the traffic counters ...").
Reverse: remove `applyBounds` from `recommend()`.

## D-B1-14 · Problem parser reads a stated version

`DEFAULT_LEXICON` gains `software-version` ("firmware 4.2", "on 4.2", "running 4.2", "fw 4.2", "version 4.2"; not followed by a unit such as dB or %) and `software-version-after` ("4.2 firmware").
Reverse: delete the two rules.

## D-B1-15 · E00 after this build

`node experiments/run.ts e00`: 17/17 checks pass; `checks.json` is unchanged and `results.json`/`problems.json` differ only in run timestamps and latencies (the rewritten files were not committed, so the hash-locked results stay as they were). Claim, entity, link and case counts per family are unchanged; the follow-ups are not part of any experiment split.

## D-B1-16 · Generated follow-ups are imported by every non-empty demo reset

`data/demo/followups/` (README, Erkki's 14 Oct Teams note, Eino's 6 Oct e-mail, problems.json) is imported as a `scenario-dir` after Elisa's files, the demo families and the developer fixture, for seeds `elisa` and `synthetic` (`EngineOptions.followupsDir` overrides the path). `problems.json` and the README are not sources (`listScenarioSources` reads `teams*.json` and `.txt/.eml` only). Verified on a reset demo database: TRN-088 still gets "Check the traffic counters before replacing the SFP again.", the firmware 4.2 problem gets the superseded caveat, 5802 is closed by 7731 on 6 Oct; tests/e2e, elisa-text, fixes-4, identity pass with the follow-ups imported.
Reverse: delete the follow-ups block in `service/demo.ts`.

---

# B1 part B: access facts, quiet hours, standing gaps

## D-B1-17 · Access intent is a problem-only key and never a case condition

`DEFAULT_LEXICON` gains `access-intent` (driving out to, drive to, heading to, site visit, barrier, gate, code(s), key(s), lockbox, access) as key `intent.access` (value `site`; documented in `vocabulary.ts`). `investigate()` takes every `intent.*` key out of the parsed conditions before retrieval and matching, and `contactDraft` leaves it out of the symptom list, so no existing match, gap or E00 number moves.
Why: the intent describes what the requester wants, not the incident; as a condition it would count as a missing/matching key against cases.
Reverse: delete the rule and the two filters.

## D-B1-18 · When access facts answer a problem

`investigation/access-facts.ts lookupAccessFacts` answers only when (a) the intent is present, (b) a problem entity resolves among the entities the requester may see, (c) the text names the thing asked for (barrier, gate, code, key, lockbox, access; "I will drive out to swap the rectifier" alone is not an access question) and (d) every stated condition is an identity-like key (`ignoredKeys`: site.id, site.access ...). A problem that also states an incident condition keeps the incident path unchanged. When access answers, the incident candidates stay listed but inert: no basis case, no incident gaps, people = who handles the key.
Why: the brief's p2 ("driving out ... barrier code?") would otherwise get the rectifier recommendation; an incident report that mentions a visit must not lose its recommendation to a code.
Reverse: drop the `access` branch in `investigate()`.

## D-B1-19 · Which access facts count, and how they read

An access fact counts when it is bound to a problem entity (`subjectEntityIds`; a fact with no subject, such as Slack's "leave keys at the front desk", never does), its status is provisional, supported or superseded, it is valid at the moment (`validAt`, so a superseded code counts only inside its window) and some supporting evidence passes the investigation's gate (time-aware with `at`). The kind asked about (barrier, gate, lockbox, door, hatch) picks codes with that qualifier; with none named every code is listed. Text: "Barrier code at RBS-310: 7731 (Eino Salo, 6 Oct; replaces 5802 from 20 Aug; changes every October)." The asserter is the directory name of `assertedBy`, the date `shortDate(validity.from)`; a replaced code is any visible claim whose `supersededBy` is this one, named only as "replaces"; the recurring change is the fact's own `validity.condition`, else one inherited from a fact it replaced (the landlord's habit outlives one code). Caveats: when the next change is expected, plus up to three code-less notes about the same access point ("If the barrier is jammed, call the landlord's caretaker."). Basis: the supporting refs of the current code and the codes it replaced.
Reverse: `lookupAccessFacts`.

## D-B1-20 · A lapsed recurring change, and a missing fact, name who to ask

A recurring change ("every October") whose first occurrence after the fact's known `from` is at or before the moment makes the fact lapsed: `check-first`, action class `none`, "... It has probably changed since 1 Oct.", next step "Ask Eino Salo (...) for the current code before you go." No code on file: `none`, "No door code for RBS-310 is on file." with the same next step. An undated fact with a recurring change is never called lapsed (unknown stays unknown); it gets a caveat instead. Who to ask comes only from the directory policy for `site.access_code` (org-config: group `access`, role `Site Access Coordinator`; the `field` group is not given the key, so Pirkko never qualifies), available people first, the requester excluded, carried as the additive `Recommendation.askWho` and as the people list. The loop is `deferred` with "Eino Salo handles access codes but is on leave (back 1 Dec)"; the coordinator keeps that line when there is no case gap to ask about. No clarification question is raised for a missing access fact: there is no case to cite and the only person who handles codes is unavailable.
Reverse: org-config `site.access_code` entries; `whoHandles`.

## D-B1-21 · "Back 1 Dec" is read on demand, not stored

`ValidityCueLexicon.leave` (optional) matches a person's own statement ("I am on leave from 3 November to 1 December"). For an unavailable directory person `returnDate` reads the newest visible evidence that person authored and says "back 1 Dec" while the stated window covers the moment (year from the message's own date; a passed end or a start still ahead says nothing). Nothing is written to the store, so claim and entity counts (E00) do not move. Availability itself stays the directory's current `available` attribute, also for a past `at`.
Why: people.json has only `available:false`; a person attribute claim would change hash-locked E00 counts.
Reverse: drop `leave` from `defaultValidityCues`.

## D-B1-22 · Quiet hours are organization configuration, wired by the hosts, never a library default

`org-config.ts defaultQuietHours = { start: '22:00', end: '07:00', timeZone: 'Europe/Helsinki' }` is passed as `coordinator.quietHours` by `main.ts`, `mcp.ts` (both: `--quiet-hours off` or `KT_QUIET_HOURS=off` disables it, and `--org-policy none` disables it with the rest of the organization configuration) and `scripts/demo-reset.ts`. `defaultCoordinatorSettings` has no `quietHours` (experiments spread it for the hash-locked E00, and tests without a fixed clock run at night). Equal start and end mean no quiet hours.
Reverse: drop the `coordinator` option in the three hosts.

## D-B1-23 · Held questions: queued with deliverAfter, delivered by deliverDue

`questions/quiet-hours.ts`: `inQuiet` and `nextWindow` read local wall time through `Intl.DateTimeFormat` parts and convert the local window back to UTC (two-step offset), so the March/October clock changes come from the time-zone data. `coordinator.request()`: a question created inside quiet hours stays `queued` with the additive `QuestionRecord.deliverAfter` = the next window, a `question.held` trace event, loop `question-open` and the line "Queued until 07:00: nobody is woken at night". `deliverNow` never delivers before `deliverAfter`. `coordinator.deliverDue()` delivers every queued question whose `deliverAfter` has come through the same eligibility re-check (`deliveredAt` = now, so the daily limit and the cooldown count from the window; a gap resolved overnight cancels it as `gap-resolved`) and sets the investigation's waiting line. There is no timer: `Engine` calls it on `setClock` (after moving the demo clock), on `GET /questions` and `GET /questions/:id`, `investigate`, `getInvestigation`, `requestClarification` and `clarificationStatus` (the MCP status tool). A held question still counts as open for its recipient (one open per person) and for its investigation.
Reverse: remove the quiet branch in `request()`; `deliverDue` is then a no-op.

## D-B1-24 · The inbox hides a held question; the requester sees it queued

`Engine.questions()` (the panel's poll) leaves out `queued` questions whose `deliverAfter` is in the future, because the panel treats `queued` as open. `QuestionView` gains the additive `deliverAfter` (only while queued) and `answerType` (only for free text), so the requester's result shows the question queued for 07:00 next to the loop line.
Reverse: the filter in `Engine.questions()`.
