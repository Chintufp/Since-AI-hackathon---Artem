# memory-polish-2 worker report

Owned paths touched: `src/libs/utils/memory/` only (new: `case-label.ts`, `view-config.ts`, `case-view.test.ts`; changed: `case-view.ts`, `case-builder.ts`, `commit.ts`, `extractor-rules.ts`, `extraction-config.ts`, `index.ts`, `README.md`, tests). No contract change needed, no contract request filed.

## Done
1. **No junk case.** `commit.ts` attaches an incident to a case only when it has an observation claim or an asset key. The van-stock Slack aside keeps its evidence and claims, case-less. Tests: aside -> 0 cases and case-less claims; symptom without asset -> 1 case; asset alone -> 1 case.
2. **Compact timeline** (`case-view.ts`). Elisa TRN-042 now has 7 nodes: Reported problem (red, sentence plus reporter/time) -> Reported conditions -> Possible cause (4 bullets, author each) -> Suggested checks (4 bullets) -> Attempted counter check -> Attempted interface reset (advised by / performed by as reported / time) -> Reported outcome (green; "after the interface reset", timing/cause/whether it lasted unconfirmed). The SFP change before the problem sits in conditions as "SFP replaced before the problem". Outcome unknown (grey) is shown whenever no outcome exists. Action labels come from `ViewConfig.actionLabels` with a humanizing fallback.
3. **Short titles.** `Case.title` and `CaseView.title` are now e.g. "TRN-042 · no traffic after SFP change" (rebuildCase recomputes it from live claims; the long sentence stays in the Problem node and the observation claim). Symptom and "after ..." phrases come from `ViewConfig`; fallback is the first content words of the problem sentence (demo families: "AGG-014 · BGP flapping", "RBS-310 · flapping DC low alarms"). Caveat is one sentence: "Recovery is reported, not verified (timing, cause and lasting unconfirmed); 8 independent of 9 source record(s)."
4. **Plain condition labels.** "Interface up", no "(hedged in source)"; the view merges "Older unit (installed around 2019)" and lists hedged ones under "Reported as likely rather than certain". Stored legacy labels are cleaned at display time.
5. **Elisa RE: email** still links as a retelling (asserted) and adds no repeated Possible cause or Suggested checks bullets (dedupe by word overlap and by "restates a message that already yielded this claim type").

Verified against private Elisa files, dev-family-01, and the 10 demo families in `data/scenarios/*/sources` (sources only; `truth.json` never read), plus a live in-memory service seeded `elisa` on port 47902 (stopped). Slack aside case no longer appears in the demo seed.

## Decisions and deviations
- **Hedging and `Condition.origin`:** I first marked hedged conditions `origin: 'inferred'`, but that changed investigation behavior (tests/permissions.test.ts "cooldown" test failed, since investigation treats `inferred` as not settling a key). Reverted: origin stays `reported`; the hedge is detected at view time from the verbatim statement with `ExtractionConfig.hedges`. If you want origin to carry hedging, the investigation module must first agree on its meaning.
- `Case.title` changed from the long sentence to the short label (rebuildCase). Investigation prose quoting titles now reads the short label; retrieval still indexes the long sentence through claim statements.
- Tests updated deliberately: `extractor-rules.test.ts` (hedge test now expects a plain label and the hedge kept in the statement); `pipeline.test.ts` (outcome detail regex made case-insensitive for "Timing"). Everything else unchanged.
- Existing databases keep old case titles until a case is rebuilt (any import/correction); `node scripts/demo-reset.ts` reseeds cleanly. The shared service/demo DB was not touched.

## Limitations
- Fallback title wording is mechanical ("HUB-07 · aila sees no CRC errors"); a symptom phrase in `ViewConfig.symptoms` gives nicer text.
- Same person restating the same outcome for the same attempt merges into one node; a different person's confirmation stays separate.
- Extraction quirks seen but not in scope: RTR-117 "Short version" retell gives Hanna as adviser of her own log check; attempt times show raw ISO for known dates.
- Hypothesis sentences like "Usually the SFP is fine." are still extracted as possible causes (rules extractor).

## Checks
`pnpm typecheck` clean; `pnpm test`: 187 pass, 0 fail (175 before, plus 8 new case-view tests and others' additions).
