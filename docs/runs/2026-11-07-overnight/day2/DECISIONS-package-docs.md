# Decisions · B6 · Package docs (SUBMISSION.md, slides)

Written to this file instead of `DECISIONS-package.md`, because that file may be created on another branch (B6 flags) at the same time; fold both in at integration. Numbered from D-B6-20 so the two files do not collide.

## D-B6-20 · SUBMISSION.md is the one door; it links and does not duplicate

`docs/SUBMISSION.md` carries the script only as a seven-row table plus the two signature moments, and links DEMO.md for the click-by-click text, RESULTS.md and E08-E10.md for full tables, the service README for routes. Reason: one page for a judge with three hours; a second copy of the script would drift from DEMO.md. Reverse: inline DEMO.md's script.

## D-B6-21 · What is called synthetic

Called synthetic: the 10 scenario families in `data/scenarios/` (TRN-117 / `optic-forwarding-a`, RBS-310 / `remote-power-access` included), `data/demo/followups/` (Erkki's 14 Oct firmware note, Eino's 6 Oct code 7731, two problems), `data/demo/followups-synthetic/` (Helmi's TRN-117 firmware note), `data/demo/experts-disagree/` (Helmi's TRN-512 2021-batch thread), the simulated day (`demo:play`) and every simulated answer in E03–E10 (an oracle reading an agent-authored key). Called Elisa's: `teams_chat.json`, `email.txt` and the organizer deck, held only in git-ignored `private/`. The slides say "synthetic" on the slide or in the notes wherever a synthetic source carries the point (slides 5, 7, 8, 11). Reason: the follow-ups README and E08-E10.md already say so; Elisa's example has no dates, so every dated story is ours.

## D-B6-22 · Numbers left as "not measured"

Real engineers' benefit, real seconds spent by a real Erkki, a live Slack round trip against a real workspace, and a clean-clone run of `pnpm demo:judge` on this branch: no file records them, so SUBMISSION.md §4 says "not measured". Erkki's cost on screen is a live count from the demo store, not a measured number, so no value is quoted. Questions per point gained is quoted as "undefined" (E10: 0 points gained for 9 questions per selector), not as a number.

## D-B6-23 · "The hash of the locked run" on slide 11

Slide 11 quotes the sha256 prefixes of the two hash-locked test families in `data/scenarios/TEST_LOCK.json` (transponder-laser 9f202253…, rooftop-threshold 73e145d0…), the lock E00 checks on every run. The E08–E10 results are additionally pinned by their committed results and manifests: E08 re-run at 0bc1ca6 (fixtureSha256 f9c12a9c4330cd09), E09 at d5a1c32 (outputs hash-locked, D-B2-61), E10 at 11ee275 (familiesSha256 885928361d0f3da7). These are kept here, not on the slide, to stay within five lines. Reverse: put the commit ids on the slide instead.

## D-B6-24 · The plan's slide text updated to what is true now

DAY2_PLAN's slide list says "8 MCP tools" and "Snowbally"; the slides say 12 MCP tools (D-INT-15) and Lumi (R43). Slide 7 uses DEMO.md's measured stops (09:14–09:18 nothing, 09:19 check first, 09:25 qualified) rather than the plan's "before 09:16". The "Be Veikko / Be Erkki" chips are not described: the script on this branch uses Settings → You, and the chips are another branch's work.

## D-B6-25 · index.html is generated from SLIDES.md

`docs/slides/index.html` was generated from `SLIDES.md` by a small script (kept outside the repository), so the text is identical: titles, bullets, the "show:" line, speaker notes (hidden; N toggles). One file, no external fonts or scripts, light background, 1600×900 stage scaled to the window, ← → / Home / End / click, F for full screen, print to PDF gives one slide per page. Checked in a browser: on all 12 slides the bullet list ends above the "show:" line (lowest: slide 1 at 713 px of 758). After any edit to SLIDES.md, regenerate or edit both.

## D-B6-26 · Verification

`pnpm typecheck` clean and `pnpm test` 604/604 (0 skipped, Elisa files present in this checkout) on ced868d before the commits; `node --test experiments/*.test.ts` 23/23. The commits touch only docs/SUBMISSION.md, docs/slides/ and this file.
