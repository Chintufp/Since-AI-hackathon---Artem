# ingest

Idempotent import of envelopes into the knowledge store, with revision handling and copy detection.

## Public interface
- `importSources(store, envelopes, {orgId, connectionId, sourceDescription, now?}) -> ImportResult` (`batch`, `evidence`, `inserted`, `revised`, `duplicates`, `copies`).
  - Identity is the envelope id = `stableId(orgId, provider, connectionId, sourceId, revision)`. Same id and same text: counted in `unchangedDuplicates`, nothing written. Same id with different text: stored as a new revision (`revision+<fingerprint>`), never overwritten.
  - New revision of a known source (`metadata.sourceKey`): inserted, `metadata.previousRevisionId` set, the old record gets `metadata.supersededBy`.
  - Copies: whole-text fingerprint match (>= 5 words, different thread) and quoted-segment chunk match (lines/windows of up to 3 lines, chat prefixes stripped) set `lineage.copiedFrom`. When a quoted segment matches, the parent email gets `copiedFrom` too.
  - Retelling heuristic (`findRetelling`): an email/note whose content words are >= 30% contained (and >= 8 shared) in another thread gets `metadata.retellingOf {evidenceIds, containment, sharedTerms, method}`. This is a heuristic, not lineage; it only prevents the retelling from counting as independent confirmation.
  - `ImportBatch.counts`: `seen = inserted + unchangedDuplicates + revised`; `copies` counts records carrying `copiedFrom`.

## Dependencies
`contracts/`. Uses store indexes on `lineage.sourceFingerprint` and `metadata.sourceKey` (provided by `memory/sqlite-store.ts`; any `KnowledgeStore` works, `searchText` is used for the heuristic).

## Checks run
`node --test 'src/libs/utils/ingest/**/*.test.ts'` — 5 tests: idempotent reimport (identical evidence, counts show duplicates), revision chain, same-id-different-text, quoted-chat copy detection, short-text non-copies, forwarded long message.

## Known limitations
- Copies are detected directionally (a later import points to earlier evidence); importing the retelling first and the original second does not back-link the original.
- The retelling thresholds (0.3 containment, 8 shared words) were set by looking at one real example and the synthetic fixture; they are not tuned.
- One `ImportBatch` record is written per call, so a reimport adds a batch record (evidence and memory are unchanged).
