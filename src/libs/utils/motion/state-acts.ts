/** Port of compact-state-acts.js (v006): six communication states built on the shared kit. */
import type { Act, Kit } from './types.ts';

export type StateActKey = 'idle' | 'input' | 'processing' | 'question' | 'result' | 'error';

/** Where the question glyph sits in the 96px scene (used to overlay it on the idle body). */
export const QUESTION_GLYPH = { x: 64, y: 50, w: 5, h: 7 } as const;

export function createCompactStateActs({ kit: k }: { kit: Kit }): Record<StateActKey, Act> {
  const p = k.palette;
  const defs: Record<StateActKey, { label: string; frames: number; fps: number; stillFrame: number }> = {
    idle: { label: 'At rest', frames: 1, fps: 12, stillFrame: 0 },
    input: { label: 'Receiving', frames: 10, fps: 15, stillFrame: 9 },
    processing: { label: 'Processing', frames: 20, fps: 12, stillFrame: 10 },
    question: { label: 'Question available', frames: 16, fps: 12, stillFrame: 15 },
    result: { label: 'Result available', frames: 12, fps: 15, stillFrame: 11 },
    error: { label: 'Needs attention', frames: 10, fps: 12, stillFrame: 9 },
  };
  const out = {} as Record<StateActKey, Act>;
  for (const key of Object.keys(defs) as StateActKey[]) {
    const d = defs[key];
    out[key] = {
      ...d,
      beats: [],
      render: (c, value) => {
        const f = Number.isFinite(value) ? Math.max(0, Math.min(d.frames - 1, Math.floor(value))) : 0;
        k.clear(c);
        k.shadow(c, {});
        const s: { shape?: string; expression?: string; gaze?: number } = {};
        if (key === 'input') {
          s.shape = ['neutral', 'low', 'low', 'neutral', 'high', 'neutral', 'high', 'neutral', 'neutral', 'neutral'][f];
          s.expression = 'surprised';
        }
        if (key === 'processing') {
          s.gaze = [0, 0, 1, 1, 1, 0, -1, -1, -1, 0][f % 10];
          s.expression = f === 9 ? 'blink' : 'normal';
        }
        if (key === 'question') {
          s.gaze = f < 5 ? 1 : 0;
          s.shape = f >= 3 && f < 6 ? 'high' : 'neutral';
        }
        if (key === 'result') {
          s.expression = 'happy';
          s.shape = f === 1 ? 'low' : f === 3 ? 'high' : 'neutral';
        }
        if (key === 'error') {
          s.expression = 'concerned';
          s.gaze = f < 3 ? -1 : f < 6 ? 1 : 0;
        }
        k.orb(c, s);
        if (key === 'processing') {
          for (let i = 0; i < 3; i++) k.pixel(c, 43 + i * 4, 47 - (Math.floor(f / 3) % 3 === i ? 1 : 0), 2, 2, p.accent);
        }
        if (key === 'question') {
          const rows = ['.xxx.', 'x...x', '....x', '..xx.', '..x..', '.....', '..x..'];
          rows.forEach((row, y) =>
            [...row].forEach((v, x) => {
              if (v === 'x') k.pixel(c, QUESTION_GLYPH.x + x, QUESTION_GLYPH.y + y, 1, 1, p.ink);
            }),
          );
        }
        if (key === 'result') {
          k.pixel(c, 64, 66, 5, 7, p.edge);
          k.pixel(c, 65, 67, 3, 5, p.body);
          k.pixel(c, 65, 68, 2, 1, p.shade);
          k.pixel(c, 65, 70, 2, 1, p.shade);
        }
      },
    };
  }
  return out;
}
