/**
 * Tiny reward burst in the avatar's pixel style: integer rectangles from the shared palette,
 * no smoothing, six stepped frames. Drawn only when Points & rewards is on; purely cosmetic.
 */
import { PALETTE } from './minimal-kit.ts';
import type { DrawTarget } from './types.ts';

export const BURST = { width: 24, height: 12, frames: 8, fps: 15 } as const;

const DIRECTIONS: Array<[number, number, string]> = [
  [-1, -1, PALETTE.star],
  [1, -1, PALETTE.accent],
  [-1, 0, PALETTE.accent],
  [1, 0, PALETTE.star],
  [0, -1, PALETTE.star],
  [-1, 1, PALETTE.accent],
  [1, 1, PALETTE.star],
];

export function renderBurst(c: DrawTarget, frame: number): void {
  const f = Number.isFinite(frame) ? Math.max(0, Math.min(BURST.frames - 1, Math.floor(frame))) : 0;
  c.clearRect(0, 0, BURST.width, BURST.height);
  const cx = BURST.width / 2;
  const cy = BURST.height / 2;
  const reach = f * 1.5;
  const size = f < 5 ? 2 : 1;
  if (f === BURST.frames - 1) return;
  for (const [dx, dy, color] of DIRECTIONS) {
    c.fillStyle = color;
    c.fillRect(Math.round(cx + dx * reach - size / 2), Math.round(cy + dy * Math.floor(reach / 2) - size / 2), size, size);
  }
}
