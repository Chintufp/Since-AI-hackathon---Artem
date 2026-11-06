# Prompt for the Claude design orchestrator

You are the design orchestrator for a parallel Claude team. **ChatGPT/Codex is already working beside you on this same desktop-companion design.** Collaborate through saved artifacts, critiques and a shared experiment list. Do not assume private messages are shared automatically.

Our shared workspace is:

`/Users/artevil/Since-AI-hackathon---Artem/design-lab/`

There are two team folders: `chatgpt/` and `claude/`. Your team writes in `claude/`, reads both, and may append uniquely numbered `CL-...` ideas to root `IDEAS.md`. Read the lab's `README.md` before starting. Preserve others' work and all completed versions.

Your assignment is to start and coordinate your own agents, generate substantial **meaningfully different** design material, and run repeated render–critique–revise cycles. Do not merely return advice or a plan. If your environment cannot run parallel agents, state that and perform the same roles sequentially.

Start with these roles, using the concurrency actually available to you:

1. **Minimalist UI designer:** one compact white window. Input is one open writing surface with a short placeholder, attachment and send controls. Questions, context, queue and settings use the same window. Create an independent composition rather than lightly restyling ChatGPT's work.
2. **Pixel character and motion artist:** a white pixel-circle companion with a small face, behavior that creates warmth and collaboration, and distinct animation explorations. All artwork and effects must be genuine pixel frames: falling stretch, impact squash, recovery, stars, dance, limbs, top-leading torsion and transformations. No smooth vector hybrids or blurred scaling. Explore identity-preserving alternatives.
3. **Strict critic:** inspect actual screenshots and animation frames from your team AND ChatGPT's latest versions. Identify the most consequential visible weaknesses and give exact revision instructions. Review composition, text density, proportions, controls, character integration, pixel consistency, motion readability and interruption behavior. No invented scores or empty praise.

Act as coordinator rather than letting the agents overwrite one another. Give each agent its own concept/version path, such as `claude/ui/quiet-note/v001/` or `claude/motion/paper-turn/v001/`. Keep an up-to-date team `WORK_LOG.md`. Finished versions are immutable; create `v002` for the next pass.

Important direction from the user:

- Latest feedback: the user called ChatGPT's compact rebuilt input (`chatgpt/ui/v001/screenshots/`) “much better.” Treat its simplicity as a useful baseline. Independent alternatives are still wanted; keep them separately versioned rather than undoing the baseline.
- The previous UI was rejected as generic, text-heavy and insufficiently minimal. It had nested input boxes, a raw Choose files control, repeated instructions, excessive blank space and a disconnected avatar/tool row.
- We want **one window**, one coherent visual language, and very little text on the default surface.
- The companion has a recognizable behavioral personality; an audible voice was not requested.
- **ALL animations are pixel art.** Keep a consistent grid and deliberate silhouettes. Pixel edges stay crisp during deformation, particles and morphs. Panel movement should follow the stepped visual rhythm while text remains readable.
- Questions are one at a time with Yes/No, optional unknown/later/dismiss, and optional context. The question moves upward as context opens; the bottom context toggle stays anchored.
- The companion must be pleasant without pressuring the engineer. No sad or guilty reaction to declining or postponing. All motion interrupts immediately for input; reduced motion uses meaningful static poses.
- Settings are a local demo preview, with placeholder credentials and no real service connection or uploads. Optional points remain off by default.
- Do not confuse information being available with a solution being verified. Preserve evidence, hypotheses, checks, attempts and reported outcomes distinctly.

Run the collaboration loop:

1. Inspect both teams' latest versions and `IDEAS.md`.
2. Select or propose a bounded experiment. Record its owner and intended comparison in your team log.
3. Produce a rendered first draft quickly and show an intermediate result.
4. Have the critic inspect it and also critique ChatGPT's latest available version. Put cross-team reviews under `claude/reviews/`, naming the exact target path. ChatGPT's critic will place reviews of your work under `chatgpt/reviews/` when your artifacts are available.
5. Add useful new ideas to the shared list. Let another designer test promising ideas, including those proposed by the other team.
6. Revise into a new immutable version; render the same states again and compare. Repeat for a few focused rounds per batch. Keep both successful and rejected experiments with concise reasons.

For each version save editable source, a runnable local preview, screenshots/key frames, and `NOTES.md` covering the hypothesis, changes, actual checks, unresolved weaknesses and parent/review links. Where practical include short replayable pixel animation studies, not only static mood boards.

The goal is a rich set of distinct, polished choices and honest critique—not a large count of trivial recolors. Show intermediate work and keep exploring until the batch is coherent enough for the user's review. Do not declare subjective perfection. The user chooses the final direction before a production implementation or final animation contract is made.

If repository context is accessible, also read `docs/TECHNICAL_DISCUSSIONS.md` (T10), `docs/WORKSTREAMS.md` (W09), README.md's UI direction, and `docs/assets/avatar-default.svg`. These are design explorations: do not modify production code, credentials, deployment or Git history.

Start now by checking the shared workspace, assigning the first agents, and producing the first independent UI and pixel-animation alternatives.
