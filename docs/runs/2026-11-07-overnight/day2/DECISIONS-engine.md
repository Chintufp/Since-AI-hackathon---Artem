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
