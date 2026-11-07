# connectors

Pure adapters that turn a source into `EvidenceEnvelope[]` (contracts/evidence.ts). No store access, no network in tests.

## Public interface (`index.ts`)
- `parseTeamsJson(payload, opts)` — Elisa format `{channel, participants[{name,role}], messages[{seq,time,author,role,text}]}`. Time-only stamps become `TimeRef{known:false, partial:'time-only', raw, sequence}`. Conversation key comes from the first message so two exports of channel "teams" never collide.
- `parseEmailText(raw, opts)` — From/To/Cc/Subject/Date/Message-ID headers + body. Without a Message-ID the source id is `fp:` + fingerprint of headers+body. Quoted parts (`>` blocks, "On ... wrote:", Original/Forwarded markers) become separate derived envelopes (`metadata.segment='quoted'`, `lineage.derivedFrom=[parent]`); the parent keeps the full original body plus `metadata.quotedSpans`.
- `parseSlackExport(data, opts)` / `readSlackExportDir(dir)` — standard layout (`users.json`, `channels.json`, `<channel>/<YYYY-MM-DD>.json`). `threadId = "<channelId>:<thread_ts>"`, `revision = edited.ts || '1'`, recipients unknown, private/IM channels become `group` scope (`slack-channel:<id>` unless `accessGroups` given). Join/leave noise skipped; Slack markup resolved.
- `SlackConnector` (`slack-live.ts`) — capabilities, `status` (`'awaiting-authorization'` unless `{liveAuthorized:true, token}` is passed in config; an environment variable is never read), `card()`, pure `mapHistory` / `mapReplies`, and `fetchHistory` (injectable fetch, refuses when unauthorized). Never reports `live-verified`.
- `parsePaste({text, attachmentNames}, opts)` — provider `paste`, connection `paste:desktop`, event time unknown (never "now").
- `connectionCards()` — slack (fixture-tested/awaiting-authorization), teams and email import-only, microsoft365/github/jira/confluence planned.
- helpers: `parseTimeRef`, `timeFromEpochSeconds`, `compareTime`, `describeTime`, `splitEmailBody`, `normalizeSubject`, `makeEnvelope`.

## Dependencies
`contracts/` only (plus `node:fs` in `readSlackExportDir`).

## Configuration
`AdapterOptions {orgId, connectionId?, batchId?, ingestedAt?, accessGroups?, reference?}`. Non-empty `accessGroups` makes imports group-scoped.

## Checks run
`node --test 'src/libs/utils/connectors/**/*.test.ts'` — 8 tests: time parsing, Teams/email/Slack/paste mapping on `data/fixtures/dev-family-01`, quoted detection, Slack revision and private scope, live-connector authorization rules with a throwing fetch stub, honest connection cards.

## Known limitations
- Actor ids are provider-namespaced (`person:teams:<normalized name>`); cross-provider identity is resolved later by exact normalized display name only.
- Email: one message per file; no MIME/HTML/attachments; `Date` parsing needs a year and a clock time.
- Slack: no user-group or file content, no edits history beyond `edited.ts`, deletions are not modelled. The live fetch path has never been run against a real workspace.
