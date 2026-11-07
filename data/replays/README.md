# data/replays

Recorded fixtures for the `replay` and `claude-agent-arm` routes. They are never presented as measured model results and the application never reads this directory.

- `e01-claude-arm/` holds the E01 Claude-agent experimental arm: one recorded Claude Sonnet subagent pass (`claude-sonnet-subagent-2026-11-07`) over the visible sources of the train and validation families, as `ExtractionProposal`-shaped JSON per family (see its README). It is scored by `node experiments/run.ts e01` (`experiments/runners-e01.ts`), which maps the fixture evidence ids to the stored evidence records exactly (provider plus seq / Message-ID / ts) and reports the arm as provenance `replay-fixture`, route `claude-agent-arm`. It is not the proposed small GPT generator and not an application route.

- `e08-bge-m3/embeddings.json` holds the bge-m3 vectors E08 uses (one entry per text: evidence, claim statements, case cards and problem texts of the demo/train/validation family stores and the demo store; base64 float32). Recorded once with `node experiments/run.ts e08 --record` from the local Ollama; `recordedBy` names the Ollama version and the model digest.
- `e09-qwen3-4b/<family>.json` holds the raw JSON the extract model returned for each thread of the train and validation families (prompt from `memory/extractor-llm.ts`, schema-constrained, temperature 0, seed 7), with the live latency of each call. Recorded once with `node experiments/run.ts e09 --record --model qwen3:4b` (the brief's model). An earlier partial qwen3:8b recording (3 of 6 families, cut off) was deleted.

Every entry carries the hash of the exact input (model + text, or model + prompt + schema + seed); a changed input is a `ReplayMismatchError` or a missing recording, never a silently different number. E08/E09 entries also carry `outputHash`; an edited output (or a missing hash) is a `ReplayOutputMismatchError`, so re-record instead of editing. Replayed outputs are labelled route `replay`.

Fixtures for the library `replay` route follow `src/libs/utils/models/replay.ts` (`{id, entries: {key: {inputHash, outputHash?, output, recordedBy}}}`).
