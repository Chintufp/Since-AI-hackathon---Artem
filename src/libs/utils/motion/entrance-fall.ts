/**
 * The long launch fall (R28). The authored v006 entrance starts 3 px above its 96 px scene and is
 * on the floor by frame 5. On the desktop Snowbally instead falls from the top of the screen
 * (the window spans the work area), so the host moves this floor-aligned falling pose with a
 * CSS transform and then hands over to the authored impact frames. Nothing new is drawn: the
 * body is the entrance's 'stretch' silhouette and the two accent air streaks of frames 0-4; the
 * shadow stays on the floor (as in the authored frame 0) and is painted separately.
 */
import type { DrawTarget, Kit } from './types.ts';

/** Floor-aligned falling body with air streaks; `streak` (0|1) nudges the streaks for a little life. */
export function renderFalling(k: Kit, c: DrawTarget, streak: number): void {
  k.clear(c);
  k.orb(c, { bottom: 80, shape: 'stretch' });
  const dy = streak ? 2 : 0;
  k.pixel(c, 35, 41 - dy, 1, 5, k.palette.accent);
  k.pixel(c, 60, 47 + dy, 1, 4, k.palette.accent);
}

/** The resting shadow alone: waits on the floor while the body is still in the air. */
export function renderFloorShadow(k: Kit, c: DrawTarget): void {
  k.clear(c);
  k.shadow(c, { width: 26 });
}
