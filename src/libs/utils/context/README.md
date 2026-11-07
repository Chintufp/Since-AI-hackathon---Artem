# context

Builds conversation windows from stored or freshly parsed evidence.

## Public interface
- `assembleContexts(evidence, {aliases?}) -> AssembledContext[]` (extends `ConversationContext` with `key`, `skippedSegments`). Grouping: `thread.threadId` (Teams conversation, email subject+participants, Slack `<channel>:<thread_ts>`, paste); un-threaded Slack messages group by channel+day. Windows are ordered by known time, otherwise by sequence/position. Superseded revisions and derived quoted segments are excluded from the window (they stay in the store).
- `loadContexts(store, orgId, evidenceIds?, options)` — expands seeds to whole threads (so a Slack reply imported later sees its parent from an earlier day).
- `extractionText(envelope)` — original text with quoted/forwarded spans blanked to spaces. Same length as the original, so spans computed on it are valid offsets into the stored evidence.

## Dependencies
`contracts/`, `connectors/time.ts`.

## Checks run
`node --test 'src/libs/utils/context/**/*.test.ts'` — 4 tests: ordering and email window, quoted blanking keeps offsets, Slack thread across days and channel+day grouping, superseded revisions dropped.

## Known limitations
- Partial times from different threads cannot be ordered against each other; threads are ordered by ingestion at the case level (`memory/case-builder.ts`).
- A reply chain whose participants change gets a new email window (subject plus participant set).
