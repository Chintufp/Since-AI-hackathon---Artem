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

## UX pass (R31–R36): open for Artem

| ID | Status | What exists now | Still open |
| --- | --- | --- | --- |
| UX1 | default | Global shortcut `CommandOrControl+Alt+S` (⌥⌘S) toggles away / back; `KT_SHORTCUT=0` turns it off | Is ⌥⌘S the right chord (it may clash with app shortcuts such as "Save all")? Alternatives that registered: `Control+Command+S`, `Alt+Shift+S` |
| UX2 | default | He stands 26 px lower than before: contact row 12 px above the work-area bottom (the shadow ends about 4 px above the Dock line) | Does the lower floor feel right next to the Dock, or should it go back up? |
| UX3 | default | Tray title shows ` ?` while he is away with an unseen question | Is a "?" in the menu bar welcome, or too noisy? On the right edge it is the only cue, since the authored glyph sits outside the window at the sliver |
| UX4 | open | No throwing: release always falls straight down ("sticky snow"); pushing past an edge is the only way to send him off by hand | Should a fast release throw him (velocity fling), and should a throw toward an edge send him away? |


## Added by the demo-mode session (7 Nov, afternoon)

| ID | Status | What exists now | Still open (Artem) |
| --- | --- | --- | --- |
| U24 | open | `pnpm demo:judge` starts the simulated day 240 s after launch so the 3-minute walkthrough runs on the seeded data (R31); `--stream-delay 0` starts it at once | Should the judges see the stream from the first second (livelier, but Erkki's question may go to another NOC person and his budget may be used by simulated requesters), or after the walkthrough (deterministic script)? Also: seed 1 and 10 s per simulated hour are my picks for the pitch; a slower day (20 s/h) reads more calmly on a projector. |
| U25 | open | Slack: synthetic export path demonstrated (`pnpm demo:slack`, private #change-review visible to members only); live connector `awaiting-authorization`, refuses without `{liveAuthorized, token}`; DEMO.md says what the live path would do and needs | Should a sandbox Slack workspace be used for the demo? If yes, name it in chat (workspace, the channel(s) and a bot token scope list: `channels:history`, `channels:read`, `groups:history`, `groups:read`, `users:read`); nothing will be connected before that. Credentials present on this Mac are not authorization. |
| U26 | open | Rules selector breaks ties between equally placed observers by `questionId|personEntityId` string order, which is why Erkki wins on the seeded directory and loses once more NOC people exist (seen in the dry run) | Prefer a role-based observer over a group-based one, or the least-loaded person, on ties? Changing it touches E03/E06 numbers; left as is. |
| U27 | open | The MCP transcript (`demo/mcp-transcript.md`) was recorded with the SDK client in `scripts/mcp-demo.ts`, not by a model choosing tools | Record one real Claude Code or Claude Desktop session with `.mcp.json` from DEMO.md before Sunday (needs your Claude account; our code never calls a model). |
| U28 | open | Live Slack path built behind guard rails (`pnpm demo:slack --live --workspace <team> --channel <#channel>`: needs KT_SLACK_LIVE=1 and KT_SLACK_TOKEN set in the shell at demo time; one `auth.test`, team name must match, read-only allowlist, one channel, last 50 messages plus members; fake-client tests). Artem answered U25 "yes, sandbox, read-only". | Which sandbox workspace and which channel will be used, and that Artem exports the token himself right before the demo (the token is never read from files, keychain or `private/`, never printed, never committed). |
