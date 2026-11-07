# data/replays

Recorded fixtures for the `replay` and `claude-agent-arm` routes. They are never presented as measured model results and the application never reads this directory.

- `e01-claude-arm/` holds the E01 Claude-agent experimental arm: one recorded Claude Sonnet subagent pass (`claude-sonnet-subagent-2026-11-07`) over the visible sources of the train and validation families, as `ExtractionProposal`-shaped JSON per family (see its README). It is scored by `node experiments/run.ts e01` (`experiments/runners-e01.ts`), which maps the fixture evidence ids to the stored evidence records exactly (provider plus seq / Message-ID / ts) and reports the arm as provenance `replay-fixture`, route `claude-agent-arm`. It is not the proposed small GPT generator and not an application route.

Fixtures for the library `replay` route follow `src/libs/utils/models/replay.ts` (`{id, entries: {key: {inputHash, output, recordedBy}}}`).
