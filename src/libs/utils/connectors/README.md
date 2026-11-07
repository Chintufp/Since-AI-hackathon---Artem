# connectors

Pure adapters that turn a source into `EvidenceEnvelope[]` (contracts/evidence.ts). No store access, no network in tests.

## Public interface (`index.ts`)
- `parseTeamsJson(payload, opts)` — Elisa format `{channel, participants[{name,role}], messages[{seq,time,author,role,text}]}`. Time-only stamps become `TimeRef{known:false, partial:'time-only', raw, sequence}`. Conversation key comes from the first message so two exports of channel "teams" never collide.
- `parseEmailText(raw, opts)` — From/To/Cc/Subject/Date/Message-ID headers + body. Without a Message-ID the source id is `fp:` + fingerprint of headers+body. Quoted parts (`>` blocks, "On ... wrote:", Original/Forwarded markers) become separate derived envelopes (`metadata.segment='quoted'`, `lineage.derivedFrom=[parent]`); the parent keeps the full original body plus `metadata.quotedSpans`.
- `parseSlackExport(data, opts)` / `readSlackExportDir(dir)` — standard layout (`users.json`, `channels.json`, `<channel>/<YYYY-MM-DD>.json`). `threadId = "<channelId>:<thread_ts>"`, `revision = edited.ts || '1'`, recipients unknown, private/IM channels become `group` scope (`slack-channel:<id>` unless `accessGroups` given; each private-channel record also carries `metadata.membershipGrants` for the channel's members from `channels.json`, or its posters when `members` is absent). Join/leave noise skipped; Slack markup resolved.
- `SlackConnector` (`slack-live.ts`) — capabilities, `status` (`'awaiting-authorization'` unless `{liveAuthorized:true, token}` is passed in config; an environment variable is never read), `card()`, pure `mapHistory` / `mapReplies`, and `fetchHistory` (injectable fetch, refuses when unauthorized). Never reports `live-verified`.
- `slack-net.ts` — the Slack clients' default fetch (`slackWebClient`, `slackDmClient`, `fetchHistory`): route label `slack-web` in `ROUTE_REGISTRY`, refused with `NetworkProviderBlockedError` before any request unless `KT_SLACK_LIVE=1`, and only to `https://slack.com`. Injected fetches (tests, the fake workspace) bypass it.
- `parsePaste({text, attachmentNames}, opts)` — provider `paste`, connection `paste:desktop`, event time unknown (never "now").
- `detectPasteKind(text)` / `parsePastedThread(text)` (`paste-thread.ts`, no node imports so the renderer can use it) — B4 "Remember this": empty, Teams JSON export, e-mail (a From/To/Subject/Message-ID header), chat thread ('[09:14] Name: text', '09:14 Name: text', 'Name  9:14 AM' header + body, plain 'Name: text' with two or more speakers and a conversational signal, so 'SFP Module: replaced / Optical Levels: ok' stays a note), else a note. A stated header date is kept verbatim with the time; a pasted thread is keyed on all its messages (keyAllMessages), so two pastes with the same opening line never collide. memory/index.ts routes format `paste` by it. `parseEmailHeaders` lives in the dependency-free `email-headers.ts`.
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

## Live Slack pull (demo, read-only)
`slack-live-pull.ts`: `checkLiveGuard` (needs `KT_SLACK_LIVE=1`, a token in `KT_SLACK_TOKEN`, a workspace name and a channel), `slackWebClient(token)` (read-method allowlist only), `pullChannelReadOnly(client, {workspace, channel, limit})` (one `auth.test`, stops on a team-name mismatch, then one channel's info, members and history plus `users.list`; returns an export-shaped payload for import format `slack-live`). Used by `scripts/slack-demo.ts --live`; tests in `slack-live-pull.test.ts` with a fake client.

## Slack sandbox poller (B4, fake-tested only)
`slack-poller.ts`: `createSlackPoller({read, dm, service, config, tracking})` with every I/O injected; `pollOnce()` imports the channel as `slack-live:<teamId>` (with the operator's people file when given), DMs each delivered question of a mapped Slack user once, and answers through `POST /questions/:id/answer` from the recipient's own reaction (+1 yes, -1 no, shrug unknown; skin tones stripped; a flip after the answer is ignored). `slackDmClient(token, fetch)` has its own allowlist (`chat.postMessage`, `reactions.get`); the read allowlist is unchanged. `pollerGuard`, `slackPeopleFrom(people.json)`, `fileTracking(path)`/`memoryTracking()`. `slack-fake.ts` `createFakeSlack()` is an in-memory workspace for tests and `pnpm demo:slack-poll --fake`. Tests: `slack-poller.test.ts`, `tests/slack-poll.test.ts` (running service, network guard on).
