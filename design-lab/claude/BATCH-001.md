# Claude batch 001 — summary for user review

Date: 2026-11-06/07. Coordinator: Claude orchestrator. All work is exploratory, local-only, uncommitted. Nothing is selected; the user chooses the direction.

## Candidates (latest version of each line)

| Line | Candidate | Earlier versions (frozen) | What it is |
|---|---|---|---|
| UI "margin" | `claude/ui/margin/v003/` | v001, v002 | Left margin rail holds the companion, queue badge and settings; writing surface dominates. Context rows carry six labelled kinds (Seen / Guess / To check / Tried / Reported / Unsure) as margin notes with six distinct pixel marks. Receipt "No · noted  Undo" sits in the message box; answered questions reopen from the queue. +/− toggle. 7 targets in question view, 4 words on the default surface. |
| UI "glyph" | `claude/ui/glyph/v002/` | v001 | Companion sits inline like a drop cap and *becomes* the question mark beside the question text (CL-003). Timeline context by default (times + six kinds), untimed path as alternative. Queue/settings behind a keyboard menu on the companion with a pixel pip + count. 6 targets in question view, 2 words on the default surface. |
| Motion "drop-in" | `claude/motion/drop-in/v004/` | v001, v002, v003 | Hand-authored 32×32 string-row frames: entrance (fall-stretch, streaks, squash, rebound, dizzy stars, rest), top-leading turn into a "?" with a separate dot, 10-frame return, shared acknowledge for Yes/No/Later/Dismiss, idle with retractable hip nubs, 7 reduced-motion poses. `check.js` enforces palette, one body, outline continuity, no holes, frame-edge outline, ≤20% step, area floors. |
| Motion "paper-turn" | `claude/motion/paper-turn/v002/` | v001 | Sibling study: page/coin turn with top-leading phases, anticipation and weighted release, temporary ink-soled feet. Its "?" and return were spliced into drop-in v004; the study is kept for the feet alternative and as the record of why a top-leading *return* fails (wire "?"). |

## Honest state of each candidate (from `claude/reviews/pass-003-*`)

- **margin v003:** all hard checks pass (toggle box invariant, whole-row stepping, 0 errors). Open: receipt never times out and precedes the field in Tab order; "To check" and "Reported" marks confusable at true 1×; the one-line-question gap moved above the question rather than vanishing.
- **glyph v002:** all hard checks pass. Open: "?" is still about a third as dark as the question text after blur, and has two stroke weights; pip count reads "■3 What happened?" at 352 and caps at 9 (false number); f3 foot-like step, f5 inks in; glyph keeps a chevron while margin uses +/−.
- **drop-in v004:** check.js 71/71; row-0 open-cap bug from v003 confirmed fixed; OS reduced motion honoured, state preserved on toggle, same-tick interruption. Open: "?" stands 1–2 rows lower than rest and its dot touches the 64×64 slot bottom; #4 still reads as a folded sheet; outline-style seam visible only at ×4.
- **paper-turn v002:** check.js 51/51; mid-turn reads as a lid/cap flipping (acorn, mushroom, lightbulb) rather than a page; face never hidden so no turned-away beat. Negative result recorded.

## Cross-team

- Claude reviewed ChatGPT: `pass-001-chatgpt-ui-v003.md`, `pass-001-chatgpt-pixel-motion-v002.md`, `pass-002-chatgpt-pixel-motion-v003.md`, `pass-002-chatgpt-ui-caret-v002.md`. ChatGPT adopted several findings as GPT-010..015 and built `ui/caret/v002` from Claude's CL-005.
- ChatGPT reviewed Claude: `chatgpt/reviews/claude-first-pass.md` (margin v001, drop-in v001). Every item was addressed in v002+ and scored in Claude's own pass-002/003 reviews.
- Claude ideas appended to `IDEAS.md`: CL-001..CL-007.

## Open for the user to decide (no further iteration can settle these)

UI: where the companion lives (inline glyph / margin rail / perched corner / moving caret); queue as visible badge vs pip + menu; context as timeline / labelled margin rows / untimed path; pink evidence rule or none; +/− vs chevron; full-width Yes/No vs pills.
Motion: feet vs hip nubs for idle; separate vs attached "?" dot; fold crease vs clean turn; hide the face for one frame or never; flat mouth for unavailable/thinking; 5-px plus "stars".

## Not verified anywhere in this batch

Native Electron on macOS/Windows; real OS drag/paste/file picker; screen readers; Windows fractional scaling; dark mode; frame-hold timing accuracy at real playback; how the motion candidate looks inside either UI candidate (both use the same repaired base sprite, but no combined preview exists yet).

## Suggested next bounded step (if the user picks a direction)

Build one combined preview: chosen UI + drop-in v004 in its 64×64 slot, with the entrance-slot sequence on open, the turn on question arrival, the shared ack on answer, and the static poses under reduced motion. Then decide the avatar SVG repair (9 corner outline pixels) at the source.
