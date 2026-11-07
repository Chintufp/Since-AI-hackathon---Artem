# Decisions · B2 part A (models: providers, storage, retrieval)

Worktree `day2/b2`, branch off `run/2026-11-07-overnight` at e25b6af. Each entry: what, why, how to reverse.

## D-B2-01 · Baseline in this worktree is 384 pass / 1 fail / 2 skipped, not 387 pass
`src/libs/utils/investigation/elisa-text.test.ts` "elisa TRN-088 ..." fails on the untouched branch in this worktree because the Elisa files live only in git-ignored `private/`, which the worktree does not have (the test runs `resetDemo('elisa')` without a `hasElisa` guard). Verified by running it three times with every change of mine reverted. Not changed here (out of scope, and the rule is that code must work without `private/`; the test itself is the one that assumes it). Reverse: nothing to reverse; a `hasElisa` skip guard in that test would make the worktree count 386 pass / 3 skipped.

## D-B2-02 · `SlotChoice`, `ModelSlots` and `DEFAULT_MODEL_SLOTS` live in `contracts/models.ts`; `org-config.ts` re-exports the default
The type is needed by `contracts/outcomes.ts` (UserSettings.models), `contracts/service.ts` and the ui mock, none of which may import the service. `apps/service/org-config.ts` exports `DEFAULT_MODEL_SLOTS` as the organization's configuration point, as the brief asks. Reverse: move the constant back into org-config and import it in the mock from there.

## D-B2-03 · Precedence of slot choices: stored settings > `EngineOptions.models` > all rules
Same pattern as `selectorId` (the host option is the default, the stored user choice wins). `GET /settings` now always carries `models` (an additive field). A models patch merges per slot, so `PUT {models:{embed:...}}` leaves extract and phrase as they were. The `PUT /settings` request type widens `models` to `Partial<ModelSlots>` (additive). Reverse: make the host option win by swapping the spread order in `Engine.getSettings`.

## D-B2-04 · The API key never travels in settings
`settingsPatchSchema` is still `.strict()`, and each slot object is `.strict()` too, so a `key` inside `models` is a 400. Keys go through `POST /models/key` (memory only). Reverse: n/a (a brief rule).
