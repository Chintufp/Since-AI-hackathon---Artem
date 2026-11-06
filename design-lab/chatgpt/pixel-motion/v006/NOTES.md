# Compact companion v006

Parent: frozen `../v005/`. This version responds to the user's rejection of the long, skeletal limbs and excessive visual detail. It is a focused replacement grammar, not a faster playback setting for the old artwork.

## Shared construction

The original white pixel orb dominates every pose. Its neutral body is 28 source pixels across. The outline, white fill, small dark face, pink cheeks and flat base shade follow `docs/assets/avatar-default.svg`: contour `#b8c5cf`, face `#243542`, cheeks `#f2a5b7`, shade `#e4edf2`.

There are no limbs at rest. A hand is a directly attached, solid, pale nub projecting at most four source pixels; a contact foot is at most 3×2 pixels. No joints, tubes, shins, articulated hands or separate shoes exist in this kit. The two prop acts each use one restrained temporary accent. Detail comes from gaze, discrete face orientation, silhouette, weight, contact and brief reactions.

All body, face, nub, prop, particle and shadow marks are integer pixel rectangles. Nominal review uses the 96px scene at 2× nearest-neighbor scale, with a 64px character cell. There are no canvas rotations, smooth artwork scaling or anti-aliased limb paths.

## Focused timing

| Selectable action | Normal duration | Principal beats |
| --- | ---: | --- |
| Little backflip | 1.5 s | Dip, push, tuck/rotate, find floor, 125ms compression, pleased settle |
| Almost a flip | 1.5 s | Push, inverted hesitation, roll through, sheepish check, warm recovery |
| Small happy hop | 1.125 s | Dip, short arc, contact, acknowledge |
| Tiny hello | 0.667 s | One-pixel settle, happy face, small attached wave |
| Attentive glance | 1.0 s | Notice, look, look back, available |
| Little stretch | 1.25 s | Small rise, yawn, release, ready |
| Drop & settle | 1.5 s | Pixel air streaks, 125ms deep impact, rebound, brief stars, hello |
| Hat moonwalk | 2.0 s | Tiny hat, side-facing glide, contact-nub weight changes, glance, return hop |
| Tiny cape hop | 1.5 s | Cape accent, crouch, short flight, soft landing, cloth lag, pleased |
| Three-pose idle | 1.5 s cycle | Exactly three fixed-location poses, 500ms each at normal speed |

These are new short authored tracks. They do not simply speed up the v005 performances. The complicated rope, skateboard, sword and wizard sequences are intentionally absent from this focused version. The old version remains available as historical reference; it is not a comparison mode inside the new player.

The idle has the same horizontal bounds, body bottom and grounded shadow in every pose. Only its top changes by one pixel. It repeats only after an explicit Play action. No random scheduler or automatic idle trick is implemented.

## Communication fit

The communication states use the same body renderer: rest, receiving, processing, question available, result available and gentle error. Their earlier timing lengths are retained. Receiving and hello now use low/high one-pixel settling, so acknowledging attention does not reuse a landing gag. The question keeps the orb identity and adds one small pixel question cue; result uses a tiny page cue instead of a correctness checkmark. Error is concerned and available, not distressed.

The intended hierarchy is immediate, modest attention when the engineer acts, followed by optional brief play when invited. Clicking the character interrupts an act to greet; selecting a communication state also interrupts immediately. This supports a companion that is easy to address. Whether it makes engineers more willing to answer questions still requires user feedback; this study does not test engagement or implement rewards. Future Yes, No and Later reactions should be equally warm and free of disappointment.

## Review sequence

The early `work/early-grammar.png` strip exposed rest, maximum wave extension, flip tuck, deep landing and maximum stretch before completing the player. Root and director accepted the construction: dominant orb, tiny filled attached nub, consistent face/outline family and no skeletal anatomy.

The director inspected the short backflip and entrance sequences. Both deepest landing poses last only 125ms. The specific correction was to remove the impact-sized squash from hello and receiving; both now use only the low/high settle. No new anatomy or secondary detail was added.

The two compact prop sources were rendered at nominal size in `work/moonwalk-strip.png` and `work/hero-strip.png`, with timed GIFs alongside. Each starts and ends at the shared neutral orb. The final source is frozen in `snapshot/` after the bounded runtime review.

Final director review captured every displayed frame at normal speed for hello, receiving, backflip, entrance, hat glide and cape hop: 124 frames across six clips. All completed without JavaScript errors. The director accepted the lighter acknowledgement, readable brief impact and compact props, with no further source correction requested. The hat is best described as a playful backward glide; subtle contact nubs intentionally replace the earlier articulated heel/toe performance.

## Player and validation

The player defaults to a stopped Little backflip. It shows one duration and a Play/Pause/Replay control. Slow view is for inspection; reduced motion cancels current animation and shows a meaningful still. The system reduced-motion preference is authoritative. Hidden/offscreen playback pauses, and returning to view does not restart it. Saved-state echoes do not reset playback; meaningful external restores remain stopped.

The proven v005 playback/state approach was adapted to this smaller registry. `check-frames.cjs` checked all 16 tracks / 285 frames, invalid frame inputs, early animation timestamps, exactly three fixed-anchor idle rasters, interruption, pause/resume, displayed duration, slow view, offscreen/hidden pause, reduced states, OS preference and host-state echo handling. All draws are finite integer rectangles. The entrance is intentionally clipped above the top of the scene during its first falling frames.

`check-browser.cjs` inspected actual Chrome rendering at 736px and 320px, including all ten selectable acts at each width, stopped default, one-shot completion, interruption, slow-view duration, user/system reduced motion and layout. It found no JavaScript errors or horizontal overflow. Root independently checked the same widths and verified that clicking an active backflip immediately starts hello and that hello completes within 750ms.

## Files and limits

- `study.html`: self-contained inline player.
- `index.html`: standalone review wrapper.
- `modules/minimal-kit.js`: the only body/face/nub grammar.
- `modules/compact-core-acts.js`: eight core tracks.
- `modules/compact-prop-acts.js`: support artist's two compact accents.
- `modules/compact-state-acts.js`: six communication states.
- `work/`: actual-frame strips and timed previews; GIF repetition is only for inspection, not the player’s default behavior.
- `frame-checks.json`, `browser-checks.json`, `screenshots/`: validation evidence.

Build with `node build.cjs`, then the visualize renderer's `render.py study.html index.html --force`. The source has no external resources or runtime module loading.

This is still an exploration player. It does not implement native Electron windows, production frequency rules, OS hit testing, sprite export or notification scheduling. The compact glide uses contact nubs rather than full anatomical heel/toe mechanics; that simplification is intentional. The quieter construction and shorter bursts are ready for the user's next selection, without claiming finished production animation.
