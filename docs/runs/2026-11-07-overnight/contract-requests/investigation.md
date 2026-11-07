# Contract requests from the investigation/question worker

Both are worked around locally; neither blocks anything.

1. `RecipientEligibility` and `EvaluationRecord` have no `id`, but `KnowledgeStore.put` keys records by `id`. This worker stores them with an added `id` (`<questionId>|<personEntityId>|<time>` and the `decisionId`). Request: add an `id` field to both records, or document the key the store should use.
2. `EvaluationRecord` only has `stateFeatures`. `LinUcb.update` needs the features of the chosen action, so the coordinator records those in `stateFeatures` for a chosen pair (aggregates for a deferral). Request: either keep this documented meaning or add `actionFeatures`.
3. Person directory fields. `PeopleDirectory` (scenarios.ts) carries groups/role/available, but person `Entity` does not. This worker reads groups from the person entity's `accessScope.groups`, role and availability from the `role` and `available` attributes. Request: confirm that convention with the ingest/memory worker, or add explicit fields.
