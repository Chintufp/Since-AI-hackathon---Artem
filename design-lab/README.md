# Shared companion design lab

This is the shared workspace for ChatGPT/Codex and Claude design exploration. Production implementation and final art direction are not approved. Preserve existing work and create new versions for each meaningful iteration.

## Two teams

- `chatgpt/`: ChatGPT's UI, pixel-motion studies, screenshots, reviews of Claude, and work log.
- `claude/`: Claude's independent alternatives, screenshots, reviews of ChatGPT, and work log.
- `IDEAS.md`: shared append-only experiment list. Both teams can propose ideas.
- `CLAUDE_ORCHESTRATOR_PROMPT.md`: copy-ready instruction for the Claude coordinator.

Only write inside your team's folder, except appending new uniquely identified ideas to `IDEAS.md`. Read both folders. Do not rewrite another team's artifacts. Give a single agent ownership of each working version. One coordinator per team maintains its work log.

## Current review checkpoints

- Preferred compact UI direction: [ChatGPT UI v003](chatgpt/ui/v003/index.html), with [notes](chatgpt/ui/v003/NOTES.md) and [interaction checks](chatgpt/ui/v003/interaction-check.json).
- UI comparison: [Perched and Caret](chatgpt/comparisons/window-v001/index.html). Caret is ChatGPT's implementation of Claude's CL-005 idea; it is an alternative, not a replacement for the preferred baseline.
- Current pixel-animation exploration: [ChatGPT pixel-motion v003](chatgpt/pixel-motion/v003/index.html), now using authored poses. Earlier v002 is preserved. The physical feel remains open to user judgment.
- Independent Claude candidates: [Margin window](claude/ui/margin/v001/index.html) and [Drop-in pixel motion](claude/motion/drop-in/v001/index.html). These are draft alternatives with open findings in the cross-review.
- Critique record: [pass 001](chatgpt/reviews/pass-001.md), [pass 002](chatgpt/reviews/pass-002.md), [pass 003](chatgpt/reviews/pass-003.md).
- Claude's [team log](claude/WORK_LOG.md) records its independent alternatives and active review work. ChatGPT's [first Claude review](chatgpt/reviews/claude-first-pass.md) covers actually rendered output. Claude's critiques of ChatGPT are in `claude/reviews/`; [our response](chatgpt/reviews/claude-feedback-response.md) turns their useful findings into new shared experiments.

## Current user requirements

**Latest feedback checkpoint:** the user called the compact input shown in `chatgpt/ui/v001/screenshots/` “much better.” Preserve its single-window composition, sparse controls and integrated pixel companion as the preferred starting point. This is directional feedback, not final approval of animation, detailed interactions or every visual choice. Keep independent alternatives in separate branches/versions.

- Electron desktop concept for macOS and Windows. These studies are local previews, not verified native builds.
- One compact white window for pasted text, images, dropped files, questions, context and settings.
- Default input: one open writing surface, one short placeholder, attachment and send controls. Avoid redundant headings, help text, nested boxes, and a permanent file-drop panel.
- A white pixel-circle companion with a small face. Personality comes from behavior, not an audible voice.
- **All animation uses pixel art.** Character, limbs, body deformation, particles, stars, dancing and transformations use deliberate pixel frames. Crisp grid, nearest-neighbor enlargement, no smooth vector artwork or blurred resampling. Window motion follows a stepped rhythm while keeping text readable.
- Entrance idea: falling stretch, air streaks, impact squash, recovery, brief dizzy stars, then a quiet resting pose.
- Transformation idea: top begins turning before bottom, then settles into another recognizable form. Explore question and result forms while preserving identity.
- Quiet, responsive, interruptible motion. Reduced motion has meaningful static poses. Avoid guilt or punishment for No, Later or Dismiss.
- Minimal question: one question, Yes/No, optional unknown/defer/dismiss. Context/history grows upward while its bottom toggle remains anchored.
- Context distinguishes observations, hypotheses, proposed checks, attempts, reported outcomes and uncertainty.
- Small question queue and settings affordances. Demo server/provider/model/MCP settings stay in the same window. Use placeholders for credentials; no real connections, uploads or secret persistence in studies.
- Optional points, off by default and independent of evidence truth.

Read `../docs/TECHNICAL_DISCUSSIONS.md` (T10), `../docs/WORKSTREAMS.md` (W09), `../README.md` (UI direction), and `../docs/assets/avatar-default.svg` for context. Latest explicit user direction above overrides older smooth-animation proposals.

## Version contract

Use paths such as `claude/ui/origami/v001/` or `chatgpt/pixel-motion/v001/`.

Each reviewable version should contain:

- Editable source (`study.html` for a conversation fragment or normal app source).
- A self-contained `index.html` browser preview where practical.
- `screenshots/` with input, question, context and relevant animation frames.
- `NOTES.md`: status (draft/reviewed/selected/rejected), author, parent version, hypothesis, changes, validation actually performed, open issues and linked review.

Frozen versions are immutable. Copy to the next version before revising after a review. Clearly name exploratory branches; several alternatives can coexist. Preserve negative results so other agents do not repeat them.

## Collaboration loop

1. Read the latest work and shared ideas. Record an experiment in your team's `WORK_LOG.md`.
2. Build one bounded, visually distinct experiment. Share an early rendered draft.
3. Inspect actual screenshots and animation frames. Source-only review is insufficient for aesthetic claims.
4. Critique the other team's work in your own `reviews/` directory, naming the exact target version. Prioritize concrete visible issues; never invent a review of a missing artifact.
5. Add promising alternatives to `IDEAS.md`. Another agent can pick one up and link the resulting version in its team log.
6. Revise into a new version, render the same states, and compare. Stop a batch when it is coherent and reviewable, then ask for user direction. Do not declare subjective perfection or run unbounded decorative variations.

Use idea IDs prefixed `GPT-` or `CL-`. Append complete rows, never replace the list or change another author's rows. If concurrent edits conflict, preserve both contributions and report the conflict. Avoid maintaining a shared mutable status column: claims and results belong to each team's log.

Files are the handoff channel. ChatGPT and Claude do not automatically share private chat messages or process state. Only claim collaboration that is evidenced by saved work/reviews. Do not edit production code, alter credentials, install services, or publish/commit artifacts as part of this design exploration.
