# Prompt for the build session (copy everything below the line)

---

ultracode

You are the build orchestrator for Knowledge Twin, Artem's entry to the Elisa Since AI Hackathon 2026. Deadline: Sunday 8 November 2026, 10:00 EET, submission via sinceai.app. Repo: `/Users/artevil/Since-AI-hackathon---Artem`, branch `run/2026-11-07-overnight`. I (Artem) am recording the pitch video in parallel and will check in between items; do not wait for me unless an item says so.

Read first, in this order, before planning anything:
1. `docs/BUILD_BRIEF.md`: the approved build list (section 0), the model layer (2), storage and embeddings (3), the items B1–B7 (4), the official metric (5). It wins over every other document where they differ.
2. `docs/HOW_QUESTIONS_WORK.md`: how the engine decides today.
3. `docs/DAY2_PLAN.md`: the reasoning behind the moves and the judges' rubric.
4. `docs/DEMO.md` and `docs/runs/2026-11-07-overnight/{REPORT,DECISIONS,OPEN_QUESTIONS}.md`: what exists and what was decided (R01–R46).
5. `src/libs/utils/contracts/*.ts`: the contracts every item must keep.

Then orchestrate with workflows, phase by phase, one workflow per phase:
- Phase 1, understand: parallel readers over the modules each item touches; return a map of entry points, contracts and existing tests per item. No code.
- Phase 2, implement B1 and B2 in parallel, each in its own git worktree off the run branch, each as a pipeline: implement → run `pnpm typecheck` and `pnpm test` → adversarial review by two independent reviewers prompted to refute (correctness, contract drift, hidden network calls) → fix → re-test. Use Opus for design-heavy agents (B1 memory rules, B2 provider layer and bandit reward, reviewers) and Sonnet for mechanical stages (tests, settings UI wiring, data generation, docs).
- Phase 3, integrate B1 and B2 into the run branch (resolve conflicts, full test run), then B3, B4 D1, B5 and B7 in parallel worktrees with the same pipeline. B4 D2 (Slack) only after I name the workspace and channel in chat; until then build it against the fake client only.
- Phase 4, B6: merge `claude/points-system-cd8e53` (points off by default), write `docs/SUBMISSION.md`, the slides, the demo flags, then a clean-clone test of `pnpm demo:judge` and `pnpm demo:agent`. A completeness critic agent checks every "Done:" line of the brief against the code and lists what is missing; what it finds becomes the next round.
- After every phase, before starting the next: tell me in five lines what landed, what failed, the test count, and what you decided on your own.

Standing rules (also in the brief, section 1): small commits with plain messages and no attribution lines; decisions to `docs/runs/2026-11-07-overnight/day2/DECISIONS-<area>.md`; typecheck clean and tests green before every commit; everything runs with the network off except the `api` provider and the Slack sandbox, and only when I switch them on; nothing merged into memory without a route label; never commit anything under `private/`; never push, I push. Keep the drop order of the brief: if the clock forces it, drop fine-tuning, then the `api` provider, then Slack, then B5, then B7 batch mode, then the burden meter, then quiet hours. Never drop B1, B3's page, B6 or anything the 3-minute script uses.

What done looks like: on a clean clone, `pnpm demo:judge` runs the 3-minute script with the Context Layer page, the provenance strip and the store-health numbers; `pnpm demo:agent` shows the 03:00 sequence with `kt_list_gaps` and a queued question answered at 07:30; with every model slot on `rules` nothing new runs and all tests pass; with `embed=local` the paraphrased problem "green light, nothing flowing" finds TRN-042; `docs/SUBMISSION.md` is the one door for a judge with three hours; E08, E09 and E10 numbers are hash-locked and on the slides with denominators.

Start with phase 1 now.
