# Worker report: ingestion / memory (W1)

## Built
- `src/libs/utils/memory/`: SQLite store (`node:sqlite`, FTS5 with term-overlap fallback, nested transactions, expression indexes), rules extractor with a full `ExtractionConfig`, commit, case rebuild, corrections, case view, access helpers, `importFromPath` / `listCases` public API.
- `src/libs/utils/connectors/`: Teams JSON, email text (quoted/forwarded segments), Slack export, Slack live connector (pure mapping, explicit authorization only), paste, connection cards.
- `src/libs/utils/ingest/`: idempotent `importSources`, revisions, copy detection (fingerprint and quoted chunks), retelling heuristic.
- `src/libs/utils/context/`: windows by thread / channel+day, ordering, quoted stripping that keeps offsets.
- `data/fixtures/dev-family-01/` and `data/fixtures/README.md`.
- READMEs in each module directory.

## Checks
- `node --test` over the four module directories: 37 passed, 0 failed, 0 skipped (store 5, extractor 7, pipeline 8, connectors 8, ingest 5, context 4). The Elisa tests ran against `private/Elisa_SinceAI2026/...` and passed (they skip if the files are absent).
- `pnpm typecheck`: no errors in my paths. The repo-wide run still reports two errors in another worker's `src/libs/utils/questions/questions.test.ts` (lines 39 and 142), not touched by me.
- Store benchmark: 5k puts under 2 s asserted in a test.

## Limitations
See each README. Main ones: lexical rules only; case identity is the asset id; attempts collapse per (case, action); cross-provider person identity by exact name; `lasting` never inferred as confirmed; retelling thresholds tuned on two examples only; the Slack live fetch path was never run against a real workspace (status never `live-verified`).

## Blockers
None.

## Contract requests
None required. Notes for the orchestrator: (1) `ConversationContext` has no field for stripped text, so extraction uses `extractionText(envelope)` from `context/`; (2) `ProposedClaim` carries no action/outcome detail, so the rules extractor adds optional `action`/`outcome` fields on its claims and commit falls back to re-deriving from the statement for other extractors; (3) `ListOptions.where` accepts dotted JSON paths and the aliases `sourceFingerprint`, `sourceKey`, `threadId` for evidence.

## Fix pass

Fixed all 6 major and the 2 minor findings (see src/libs/utils/memory/README.md "Fix pass"). New tests: memory/fixpass.test.ts (8 tests, one per finding). Full module suites: 45 pass, 0 fail; pnpm typecheck passes. Changed existing test expectations: the private-channel mix now expects the org case to stay visible to outsiders (with private sources filtered); the revision test checks advice claims only. Limitations: case title/entity name from a private source becomes visible once an org-wide source supports it; a no-change report by another person after a recovery marks it 'recurred'.
