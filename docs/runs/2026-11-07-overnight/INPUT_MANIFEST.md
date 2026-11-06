# Input manifest — run 2026-11-07-overnight

Branch: `run/2026-11-07-overnight` (created from `main` at `d4c93db`). Preservation commit `9792216` committed the previously uncommitted technical documents and the selected design versions in place. Nothing on `main` was changed; nothing was pushed.

All remaining design-lab material (frame caches, screenshots, older versions, Claude alternatives) stays untracked on disk, untouched.

## Technical inputs (SHA-256 prefix · path)

| Hash | File | Role |
| --- | --- | --- |
| 3e4047a5c0e2d6d4 | docs/OVERNIGHT_TECHNICAL_HANDOFF.md | Accepted direction, E00–E10, U01–U23 |
| 7cecfdd93063ba69 | docs/ENGINEERING_DECISIONS.md | D01–D19 |
| 8392a7efaa81942c | docs/TECHNICAL_DISCUSSIONS.md | Closed/Proposed/Open checklist |
| 86fba48055c656e4 | docs/INTEGRATIONS.md | Connection scope, module layout |
| 782a01207f889477 | docs/ARCHITECTURE.md | Records and selection loop |
| bca3c48e7b91ca34 | docs/QUESTION_POLICY_DIAGRAM.md | Selection loop formulation |
| 67566fe5b963b855 | docs/BRIEF.md | Challenge and product brief |
| dcd9aecd5e4beda8 | docs/WORKSTREAMS.md | W01–W10 |
| f765f569afcb37d0 | docs/VISION.md | Product vision |
| 2353404264954798 | docs/EXPERIENCE_BRIEF.md | Points, avatar states, people view |
| a50eb019a4757e71 | docs/CLAUDE_BUILD_ORCHESTRATOR_PROMPT.md | This run's instruction |

## Design inputs (ChatGPT direction, user-confirmed 7 Nov 01:45)

| Hash | File | Role |
| --- | --- | --- |
| c41e23f5dc5f8fcc | design-lab/chatgpt/ui/v008/app.js | Panel behavior reference (frozen) |
| c62fd66366bcc13a | design-lab/chatgpt/ui/v008/motion.js | Panel spring motion (frozen) |
| 61eee86e9950b3b6 | design-lab/chatgpt/ui/v008/shell.html | Panel markup and CSS (frozen) |
| 71a931b59382a274 | design-lab/chatgpt/ui/v008/sources/minimal-kit.js | Pixel body/face kit (byte-identical to pixel-motion v006) |
| f6d5123fb4e84a68 | design-lab/chatgpt/ui/v008/sources/compact-core-acts.js | idle3, hello, backflip, half, hop, stretching, peek, entrance |
| 599ecc9a43ddfe99 | design-lab/chatgpt/ui/v008/sources/compact-state-acts.js | idle, input, processing, question, result, error |
| 83367cd242c5fdc7 | design-lab/chatgpt/pixel-motion/v006/modules/compact-prop-acts.js | moonwalk, hero (optional acts) |

The v008 `provenance.json` hashes match the files above (app.js, motion.js, shell.html).

## Supplied synthetic incident (private, never committed)

| Hash | File |
| --- | --- |
| 736473caed1255ff | private/Elisa_SinceAI2026/ELISA_HIDDEN_KNOWLEDGE_EXAMPLE_2026/teams_chat.json |
| 49e0b6a9454998e3 | private/Elisa_SinceAI2026/ELISA_HIDDEN_KNOWLEDGE_EXAMPLE_2026/email.txt |

The runtime reads these from `private/` when present. Committed fixtures under `data/` are re-authored synthetic material in the same style, not copies of the organizer files.

## Runtime inspected

- macOS 26.6.2, Apple M5, 10 cores, 24 GB RAM. Node v26.11.1, npm 11.20.0, pnpm 10.18.2, Python 3.14 (numpy only; no torch), uv available, Xcode CLT present, Google Chrome and Docker installed.
- Claude runtime: Claude Code (Fable 5.1 orchestrator, Ultracode workflows). Agent tool model options verified from the tool schema: `sonnet`, `opus`, `haiku`, `fable`. Requested "Sonnet workers / Opus 5.5 agents" map to `model: "sonnet"` and `model: "opus"`. Exact runtime IDs are not exposed to me beyond those labels.
- No ChatGPT/Codex route used. No model API calls from the application or experiment harness.
