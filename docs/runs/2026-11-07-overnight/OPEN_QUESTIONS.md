# U01–U23 after the overnight run

Status of each deliberately unanswered question from the technical handoff. "Default" means a reversible run default exists in code; none of these is closed by implementation.

| ID | Status | What exists now | Still open |
| --- | --- | --- | --- |
| U01 | open | Next-choice selector (rules, LinUCB) operates repeatedly after answers; E09 not run | Whole-investigation optimization vs next-choice |
| U02 | default | Policy chooses a question–person pair or defer; timing via hard gates | Broader strategies, timing as an action |
| U03 | default | Template generator, pool ≤ 4, E05 compares 1/2/4 | Prompts/validation for a freer generator (needs an inference route) |
| U04 | open | Harness benefit = 1 if an answer moves applicability to the key's class, 0 if not, null if unanswered (named as an experimental operationalization) | Real units, weights, delay window |
| U05 | open | E03 compares rules / epsilon-greedy / LinUCB on simulator and families; artifacts saved | Update cadence, sequential RL justification |
| U06 | default | Separate support and applicability labels (supported/weak/contradicted; applicable/qualified/inapplicable); E04 compares combined vs separate | Numeric thresholds, calibration targets |
| U07 | open | Provisional run acceptance margins in EXPERIMENT_PLAN.md | Product acceptance targets |
| U08 | default | daily 3 / cooldown 30 min / max open 1 / max 3 per investigation; E07 sweeps | Live settings |
| U09 | default | Firsthand links + question-dependent observability policy (configurable) | Identity aliases, corrections at scale |
| U10 | default | contracts/memory.ts claim/evidence/validity/revision schema | Automatic link rules beyond exact ids |
| U11 | default | Thread/subject/day windows; usefulness labels; quoted email parts stripped for extraction | Audit of generated annotations |
| U12 | default | Case identity = asset + thread; patterns are candidate records only | Scoring of incident identity, clustering |
| U13 | default | BM25 + exact id + hashed trigram vectors, RRF hybrid (E02) | Learned embeddings |
| U14 | default | 10 families: 2 demo / 4 train / 2 validation / 2 test; authored by one Claude agent, reviewed once by an Opus agent | Human review of labels, larger corpus |
| U15 | open | Not run (no torch installed; E08 conditional) | Specialist transformer |
| U16 | default | Evaluative pairs optional, separate PreferenceFeedback type, never evidence | Frequency, training role |
| U17 | default | Slack export + live mapping fixtures; status awaiting-authorization | Live scope, auth, attachments |
| U18 | default | TypeScript, pnpm, node:sqlite, Electron, one service | Deployment split |
| U19 | default | Corrections retract/contradict claims and rebuild cases; access filtering at retrieval, people and delivery | Revoked access propagation to queued questions |
| U20 | default | 25 HTTP routes, 8 MCP tools (`kt_*`), async request/status/cancel | Caller authentication |
| U21 | default | v008 panel + v006 Snowbally, points off by default, reduced motion, tray | Windows packaging, sounds |
| U22 | default | E00, E02, E04, E03, E05, E06, E07 bounded; 3 seeds | More repeats |
| U23 | open | No small GPT route available; rules/local/replay routes only | Generator model and execution route |
