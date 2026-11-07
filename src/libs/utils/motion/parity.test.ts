/**
 * Pixel parity: replays every frame of every act through the frozen design-lab JavaScript
 * (read only) and through the TypeScript port, and requires identical draw call sequences.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createMinimalKit } from './minimal-kit.ts';
import { createCompactCoreActs } from './core-acts.ts';
import { createCompactStateActs } from './state-acts.ts';
import { createCompactPropActs } from './prop-acts.ts';

const root = join(import.meta.dirname, '../../../..');
const ui = join(root, 'design-lab/chatgpt/ui/v009/sources'); // v009 sources = pixel-motion v007 modules (v006 + the 'click' Springy tap)
const pm = join(root, 'design-lab/chatgpt/pixel-motion/v006/modules');
const have = existsSync(join(ui, 'minimal-kit.js')) && existsSync(join(pm, 'compact-prop-acts.js'));

type Call = string;
const recorder = () => {
  const calls: Call[] = [];
  let fill = '';
  return {
    calls,
    ctx: {
      get fillStyle() { return fill; },
      set fillStyle(v: string) { fill = v; },
      fillRect: (...a: number[]) => calls.push(`F${fill}:${a.join(',')}`),
      clearRect: (...a: number[]) => calls.push(`C:${a.join(',')}`),
    },
  };
};

test('TypeScript port draws exactly what the frozen v009/v007 (+v006 props) sources draw', { skip: !have }, () => {
  const read = (p: string) => readFileSync(p, 'utf8');
  const lib = new Function(
    read(join(ui, 'minimal-kit.js')) + read(join(ui, 'compact-core-acts.js')) + read(join(ui, 'compact-state-acts.js')) + read(join(pm, 'compact-prop-acts.js')) +
      '; return {createMinimalKit, createCompactCoreActs, createCompactStateActs, createCompactPropActs};',
  )();
  const oldKit = lib.createMinimalKit();
  const newKit = createMinimalKit();
  const old = { ...lib.createCompactCoreActs({ kit: oldKit }), ...lib.createCompactStateActs({ kit: oldKit }), ...lib.createCompactPropActs({ kit: oldKit }) };
  const now = { ...createCompactCoreActs({ kit: newKit }), ...createCompactStateActs({ kit: newKit }), ...createCompactPropActs({ kit: newKit }) } as Record<string, { frames: number; fps: number; stillFrame: number; render(c: never, f: number): void }>;
  assert.deepEqual(Object.keys(now).sort(), Object.keys(old).sort());
  let frames = 0;
  for (const key of Object.keys(old)) {
    assert.equal(now[key]!.frames, old[key].frames, key);
    assert.equal(now[key]!.fps, old[key].fps, key);
    assert.equal(now[key]!.stillFrame, old[key].stillFrame, key);
    for (let f = 0; f < old[key].frames; f++) {
      const a = recorder(), b = recorder();
      old[key].render(a.ctx, f);
      now[key]!.render(b.ctx as never, f);
      assert.deepEqual(b.calls, a.calls, `${key}#${f}`);
      frames++;
    }
  }
  assert.ok(frames > 250);
});
