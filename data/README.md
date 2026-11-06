# data

- `fixtures/` — small developer fixtures (visible sources only) used by module tests.
- `scenarios/` — synthetic scenario families authored for evaluation. Each family: `sources/` (visible), `people.json` (visible), `truth.json` and `incoming.json` keys (HIDDEN: read only by `benchmarks/` and `experiments/`).
- `models/` — versioned learned-model artifacts (JSON) trained locally.
- `local/` — git-ignored runtime state (SQLite database, settings).

Organizer-supplied material stays in `private/` (git-ignored) and is read from there at demo time only.
