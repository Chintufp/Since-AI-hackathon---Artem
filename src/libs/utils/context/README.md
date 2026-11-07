# context

Builds conversation windows from stored or freshly parsed evidence.

## Public interface
- `assembleContexts(evidence, {aliases?}) -> AssembledContext[]` (extends `ConversationContext` with `key`, `skippedSegments`). Grouping: `thread.threadId` (Teams conversation, email subject+participants, Slack `<channel>:<thread_ts>`, paste); un-threaded Slack messages group by channel+day. Windows are ordered by known time, otherwise by sequence/position. Superseded revisions and derived quoted segments are excluded from the window (they stay in the store).
- `loadContexts(store, orgId, evidenceIds?, options)` — expands seeds to whole threads (so a Slack reply imported later sees its parent from an earlier day).
- `layoutTimeAxis(items, {x0, x1, gap?, pad?}) -> AxisLayout` (B3): the Context Layer page's time axis. Known instants on a calendar segment, clock-only items on a "same day, date unknown" segment per thread (clock minutes, then sequence), unknown and date-only items in a '?' gutter; never invents a date. Returns x per item, segments with ticks, break marks and the slider stops with what is visible at each (mirrors `retrieval/access.ts gateAt`, including B3's `atEvidence`). Self-contained so `/context.html` embeds its source text.
- `extractionText(envelope)` — original text with quoted/forwarded spans blanked to spaces. Same length as the original, so spans computed on it are valid offsets into the stored evidence.

## Dependencies
`contracts/`, `connectors/time.ts`.

## Checks run
`node --test 'src/libs/utils/context/**/*.test.ts'` — 4 tests: ordering and email window, quoted blanking keeps offsets, Slack thread across days and channel+day grouping, superseded revisions dropped. `time-axis.test.ts`: 6 tests (segment order, clock ordering, calendar ticks and no invented iso, stops and visibility, two undated threads, the embedded source text).

## Known limitations
- Partial times from different threads cannot be ordered against each other; threads are ordered by ingestion at the case level (`memory/case-builder.ts`).
- A reply chain whose participants change gets a new email window (subject plus participant set).
