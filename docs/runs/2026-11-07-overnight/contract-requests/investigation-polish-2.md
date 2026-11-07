# Requests from investigation-polish (round 2)

No contract change is required for my own work (`InvestigationState.loopReason` already exists). Two small follow-ups belong to the service owner (`src/apps/service/views.ts`), which I do not own:

1. **ResultView.loopReason**: `buildResultView` should pass `loopReason: state.loopReason` (the field exists in `contracts/views.ts`). It is filled for every loop value.
2. **ResultView.matches titles**: use the short case label instead of the full case title: import `shortCaseLabel` from `../../libs/utils/investigation/index.ts` and set `title: caseId ? shortCaseLabel(store, store.get('case', caseId)) : <procedure purpose>` in `titleOf`. (With the current ingest, case titles are already short, "TRN-042 · no traffic after SFP change", but the label alone, "TRN-042", is what the recommendation and people now use.)
3. `engine.ts` maps `loop === 'exhausted'` to status `exhausted`; with the new meaning (only when the question budget is used) that is now accurate. `state.loopReason` is the natural text for the `reason` of a deferred/exhausted clarification.
