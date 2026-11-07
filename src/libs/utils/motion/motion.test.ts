import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { createMinimalKit } from './minimal-kit.ts';
import { createCompactCoreActs } from './core-acts.ts';
import { createCompactStateActs } from './state-acts.ts';
import { createCompactPropActs } from './prop-acts.ts';
import { renderBurst, BURST } from './burst.ts';
import { AvatarController, scaleFor, CROP, DROP, ENTRANCE_FALL_MS, ENTRANCE_IMPACT_FRAME } from './avatar.ts';
import { renderFalling, renderFloorShadow } from './entrance-fall.ts';
import type { Act, DrawTarget } from './types.ts';

interface Rect { x: number; y: number; w: number; h: number; color: string }

/** Tiny recording context: remembers every fillRect/clearRect and can rasterize them. */
class FakeContext implements DrawTarget {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000';
  rects: Rect[] = [];
  clears = 0;
  fillRect(x: number, y: number, w: number, h: number): void {
    this.rects.push({ x, y, w, h, color: String(this.fillStyle) });
  }
  clearRect(): void {
    this.clears++;
    this.rects = [];
  }
  /** Raster of the 96x96 scene (skipping the full-scene background fill), as "x,y" -> colour. */
  raster(): Map<string, string> {
    const m = new Map<string, string>();
    for (const r of this.rects) {
      if (r.x === 0 && r.y === 0 && r.w === 96 && r.h === 96) continue;
      for (let y = Math.max(0, r.y); y < Math.min(96, r.y + r.h); y++) for (let x = Math.max(0, r.x); x < Math.min(96, r.x + r.w); x++) m.set(x + ',' + y, r.color);
    }
    return m;
  }
}

const kit = createMinimalKit();
const core = createCompactCoreActs({ kit });
const state = createCompactStateActs({ kit });
const prop = createCompactPropActs({ kit });
const all: Record<string, Act> = { ...core, ...state, ...prop };

const frameCtx = (act: Act, f: number): FakeContext => {
  const c = new FakeContext();
  act.render(c, f);
  return c;
};
const bounds = (m: Map<string, string>) => {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const k of m.keys()) {
    const [x, y] = k.split(',').map(Number) as [number, number];
    left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  return { left, right, top, bottom };
};
const signature = (m: Map<string, string>): string => [...m.entries()].sort().map(([k, v]) => k + v).join('|');

test('every act renders every frame with finite integer, non-negative-size rectangles and palette colours', () => {
  const palette = new Set(Object.values(kit.palette));
  let frames = 0;
  for (const [key, act] of Object.entries(all)) {
    assert.ok(act.frames > 0 && act.fps > 0, key);
    for (let f = 0; f < act.frames; f++) {
      const c = frameCtx(act, f);
      assert.ok(c.rects.length > 0, `${key}#${f} draws something`);
      for (const r of c.rects) {
        assert.ok(Number.isInteger(r.x) && Number.isInteger(r.y) && Number.isInteger(r.w) && Number.isInteger(r.h), `${key}#${f} integer rect ${JSON.stringify(r)}`);
        assert.ok(r.w >= 0 && r.h >= 0, `${key}#${f} size`);
        assert.ok(palette.has(r.color), `${key}#${f} colour ${r.color}`);
      }
      frames++;
    }
  }
  assert.ok(frames >= 100);
});

test('invalid frame inputs are clamped by every act', () => {
  for (const [key, act] of Object.entries(all)) {
    for (const bad of [NaN, -5, Infinity, act.frames + 50]) {
      const c = frameCtx(act, bad);
      assert.ok(c.rects.every((r) => Number.isInteger(r.x) && Number.isInteger(r.y)), `${key} ${bad}`);
    }
  }
});

test('idle3 yields exactly three distinct rasters with fixed left/right/bottom bounds', () => {
  const act = core.idle3;
  assert.equal(act.frames, 24);
  const sigs = new Set<string>();
  const bs = [];
  for (let f = 0; f < act.frames; f++) {
    const m = frameCtx(act, f).raster();
    sigs.add(signature(m));
    bs.push(bounds(m));
  }
  assert.equal(sigs.size, 3);
  // frames 0-7, 8-15, 16-23 are identical within a pose
  for (const [a, b] of [[0, 7], [8, 15], [16, 23]] as const) assert.equal(signature(frameCtx(act, a).raster()), signature(frameCtx(act, b).raster()));
  for (const b of bs) {
    assert.equal(b.left, bs[0]!.left);
    assert.equal(b.right, bs[0]!.right);
    assert.equal(b.bottom, bs[0]!.bottom);
    assert.ok(Math.abs(b.top - bs[0]!.top) <= 2);
  }
});

test('entrance has 24 frames and starts above the scene', () => {
  const act = core.entrance;
  assert.equal(act.frames, 24);
  const first = frameCtx(act, 0);
  const minY = Math.min(...first.rects.filter((r) => !(r.w === 96 && r.h === 96)).map((r) => r.y));
  assert.ok(minY < 0, 'orb top starts above the scene (clipped as authored)');
  const last = frameCtx(act, 23).raster();
  assert.ok(bounds(last).bottom >= 80);
  assert.ok(Math.min(...frameCtx(act, 23).rects.map((r) => r.y)) >= 0);
});

test('question glyph lives where the avatar overlay expects it', () => {
  const m = frameCtx(state.question, state.question.stillFrame).raster();
  assert.equal(m.get('65,50'), kit.palette.ink);
});

test('burst draws finite integer rectangles on a small canvas', () => {
  for (let f = 0; f < BURST.frames; f++) {
    const c = new FakeContext();
    renderBurst(c, f);
    for (const r of c.rects) assert.ok([r.x, r.y, r.w, r.h].every(Number.isInteger));
  }
});

test('scaleFor gives integer device scales so the 88px CSS box stays crisp', () => {
  assert.equal(scaleFor(1), 2);
  assert.equal(scaleFor(2), 4);
  assert.equal(scaleFor(3), 6);
  assert.equal(scaleFor(1.5), 3);
  assert.equal(scaleFor(0), 2);
  assert.equal(scaleFor(NaN), 2);
});

// --- AvatarController behaviour with fake canvases and timers ---

class FakeCanvas {
  width = 44;
  height = 44;
  hidden = false;
  style: Record<string, string> = {};
  attrs: Record<string, string> = {};
  ctx = new FakeCanvas2D();
  getContext(): FakeCanvas2D { return this.ctx; }
  setAttribute(k: string, v: string): void { this.attrs[k] = v; }
}
class FakeCanvas2D extends FakeContext {
  imageSmoothingEnabled = true;
  draws: unknown[][] = [];
  drawImage(...a: unknown[]): void { this.draws.push(a); }
}

function setup(opts: { reduced?: boolean; question?: boolean; dpr?: number; drop?: boolean } = {}) {
  const g = globalThis as Record<string, unknown>;
  const raf: Array<(t: number) => void> = [];
  const saved = { raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame, dpr: g.devicePixelRatio, doc: g.document };
  g.requestAnimationFrame = (cb: (t: number) => void) => { raf.push(cb); return raf.length; };
  g.cancelAnimationFrame = (id: number) => { raf[id - 1] = () => {}; };
  g.devicePixelRatio = opts.dpr ?? 2;
  g.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const host = { reduced: () => !!opts.reduced, hasQuestion: () => !!opts.question };
  const canvas = new FakeCanvas();
  const drop = opts.drop ? new FakeCanvas() : null;
  if (drop) drop.hidden = true;
  const raws: FakeCanvas[] = [];
  const avatar = new AvatarController(canvas as unknown as HTMLCanvasElement, host, {
    createCanvas: (w, h) => { const c = new FakeCanvas(); c.width = w; c.height = h; raws.push(c); return c as unknown as HTMLCanvasElement; },
    drop: drop as unknown as HTMLCanvasElement | null,
  });
  const restore = () => { avatar.destroy(); g.requestAnimationFrame = saved.raf; g.cancelAnimationFrame = saved.caf; g.devicePixelRatio = saved.dpr; g.document = saved.doc; };
  const pump = (t: number) => { const cbs = raf.splice(0); cbs.forEach((cb) => cb(t)); return cbs.length; };
  return { avatar, canvas, drop, raws, raf, pump, restore };
}

test('avatar allocates 44*scale pixels, keeps CSS 88x88 and draws nearest-neighbour from the (26,42,44,44) crop', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup({ dpr: 2 });
  try {
    assert.equal(s.canvas.width, CROP.size * 4);
    assert.equal(s.canvas.style.width, '88px');
    assert.equal(s.canvas.ctx.imageSmoothingEnabled, false);
    const last = s.canvas.ctx.draws.at(-1)!;
    assert.deepEqual(last.slice(1), [26, 42, 44, 44, 0, 0, 176, 176]);
  } finally { s.restore(); mock.timers.reset(); }
});

test('idle uses setTimeout holds only: no rAF, three poses cycling every 500 ms', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup();
  try {
    assert.equal(s.raf.length, 0, 'no requestAnimationFrame while idle');
    assert.equal(s.avatar.status().idlePose, 0);
    mock.timers.tick(500);
    assert.equal(s.avatar.status().idlePose, 1);
    mock.timers.tick(500);
    assert.equal(s.avatar.status().idlePose, 2);
    mock.timers.tick(500);
    assert.equal(s.avatar.status().idlePose, 0);
    assert.equal(s.raf.length, 0);
  } finally { s.restore(); mock.timers.reset(); }
});

test('reduced motion: static still frame, no timers and no rAF, entrance does not play', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup({ reduced: true });
  try {
    s.avatar.playEntranceThenRest();
    s.avatar.play('hello');
    assert.equal(s.raf.length, 0);
    assert.equal(s.avatar.status().animating, false);
    assert.equal(s.avatar.status().mode, 'idle3');
  } finally { s.restore(); mock.timers.reset(); }
});

test('entrance plays once on rAF through all 24 frames, then returns to idle holds', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup();
  try {
    s.avatar.playEntranceThenRest();
    assert.equal(s.avatar.status().mode, 'entrance');
    assert.equal(s.avatar.status().reactionPlaying, true);
    const seen = new Set<number>();
    let t = 0;
    for (let i = 0; i < 200 && s.avatar.status().reactionPlaying; i++) {
      s.pump(t);
      seen.add(s.avatar.status().lastFrame);
      t += 1000 / 60;
    }
    assert.equal(s.avatar.status().reactionPlaying, false);
    assert.equal(s.avatar.status().idleLoop, true);
    assert.ok(seen.size >= 20, `drew ${seen.size} distinct frames`);
  } finally { s.restore(); mock.timers.reset(); }
});

test('a reaction interrupts idle and the question glyph overlays the idle body only when a question exists', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup({ question: true });
  try {
    const rawCtx = s.raws[0]!.ctx;
    assert.ok(rawCtx.draws.some((d) => d[0] === s.raws[1] as unknown), 'glyph drawn over idle');
    s.avatar.play('hello');
    assert.equal(s.avatar.status().idleLoop, false);
    assert.equal(s.avatar.status().mode, 'hello');
  } finally { s.restore(); mock.timers.reset(); }
});

test('raw scene never paints the 96x96 white background fill', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup();
  try {
    const rects = s.raws[0]!.ctx.rects;
    assert.ok(rects.length > 0);
    assert.ok(!rects.some((r) => r.x === 0 && r.y === 0 && r.w === 96 && r.h === 96));
  } finally { s.restore(); mock.timers.reset(); }
});

test('falling pose and floor shadow draw palette-only integer rects; the body is floor-aligned and the shadow alone sits at the floor', () => {
  const palette = new Set(Object.values(kit.palette));
  for (const streak of [0, 1]) {
    const c = new FakeContext();
    renderFalling(kit, c, streak);
    assert.ok(c.rects.every((r) => [r.x, r.y, r.w, r.h].every(Number.isInteger) && palette.has(r.color)));
    const b = bounds(c.raster());
    assert.equal(b.bottom, 79, 'body bottom row as the authored floor (bottom 80)');
    assert.ok(!c.rects.some((r) => r.color === kit.palette.shadow), 'no shadow while in the air');
    assert.ok(c.rects.some((r) => r.color === kit.palette.accent), 'air streaks');
  }
  const sh = new FakeContext();
  renderFloorShadow(kit, sh);
  const marks = sh.rects.filter((r) => !(r.x === 0 && r.y === 0 && r.w === 96 && r.h === 96));
  assert.ok(marks.length > 0 && marks.every((r) => r.color === kit.palette.shadow));
  assert.ok(bounds(sh.raster()).top >= 80);
});

test('launch with a drop surface: accelerating fall from above the window, then the authored impact frames uncropped, then idle', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup({ drop: true });
  try {
    const drop = s.drop!;
    assert.equal(drop.hidden, true, 'drop hidden while idle');
    assert.equal(drop.width, DROP.w * 4);
    assert.equal(drop.height, DROP.h * 4);
    assert.equal(drop.style.height, '172px');
    s.avatar.playEntranceThenRest();
    let st = s.avatar.status();
    assert.equal(st.mode, 'entrance');
    assert.equal(st.falling, true);
    assert.equal(drop.hidden, false);
    assert.ok(st.dropY < 0, 'starts above');
    const start = st.dropY;
    // the display canvas shows only the floor shadow during the fall
    const rawRects = s.raws[0]!.ctx.rects;
    assert.ok(rawRects.length > 0 && rawRects.every((r) => r.color === kit.palette.shadow), 'display: shadow only');
    const ys: number[] = [];
    let t = 0;
    s.pump(t);
    for (let i = 0; i < 100 && s.avatar.status().falling; i++) {
      t += 1000 / 60;
      s.pump(t);
      ys.push(s.avatar.status().dropY);
    }
    assert.ok(ys.length >= 50, `fall took ${ys.length} frames`);
    assert.ok(ys.every((y, i) => i === 0 || y >= ys[i - 1]!), 'monotonic descent');
    const steps = ys.map((y, i) => (i === 0 ? y - start : y - ys[i - 1]!));
    assert.ok(steps.slice(1, 10).reduce((a, b) => a + b, 0) < steps.slice(-10).reduce((a, b) => a + b, 0), 'accelerates');
    assert.ok(t >= ENTRANCE_FALL_MS - 20);
    // touchdown: authored frames from 'Impact' on the drop surface, display cleared
    st = s.avatar.status();
    assert.equal(st.falling, false);
    assert.equal(st.dropActive, true);
    assert.equal(st.lastFrame, ENTRANCE_IMPACT_FRAME);
    assert.equal(drop.style.transform, '');
    const blits = drop.ctx.draws.filter((d) => d[1] === DROP.x && d[2] === DROP.y && d[3] === DROP.w && d[4] === DROP.h);
    assert.ok(blits.length > 0, 'drop blits use the 44x86 column');
    const seen = new Set<number>();
    for (let i = 0; i < 200 && s.avatar.status().dropActive; i++) {
      t += 1000 / 60;
      s.pump(t);
      seen.add(s.avatar.status().lastFrame);
    }
    assert.ok(seen.has(23) && !seen.has(4), `landing frames ${[...seen].join(',')}`);
    st = s.avatar.status();
    assert.equal(st.mode, 'idle3');
    assert.equal(st.idleLoop, true);
    assert.equal(drop.hidden, true, 'drop hidden again');
    assert.equal(drop.ctx.clears > 0, true);
  } finally { s.restore(); mock.timers.reset(); }
});

test('launch with a drop surface under reduced motion: still, drop never shown; a reaction during the fall takes over', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const r = setup({ drop: true, reduced: true });
  try {
    r.avatar.playEntranceThenRest();
    assert.equal(r.drop!.hidden, true);
    assert.equal(r.avatar.status().falling, false);
  } finally { r.restore(); }
  const s = setup({ drop: true });
  try {
    s.avatar.playEntranceThenRest();
    s.pump(0); s.pump(100);
    assert.equal(s.avatar.status().falling, true);
    s.avatar.play('hello');
    assert.equal(s.drop!.hidden, true);
    assert.equal(s.avatar.status().falling, false);
    assert.equal(s.avatar.status().mode, 'hello');
  } finally { s.restore(); mock.timers.reset(); }
});

test('click (Springy tap, v007): ten frames at 15 fps, deep squash 36x16 and two 32 px rebounds, ends neutral', () => {
  const act = core.click;
  assert.equal(act.frames, 10);
  assert.equal(act.fps, 15);
  assert.equal(act.stillFrame, 9);
  const size = (f: number) => { const b = bounds(new Map([...frameCtx(act, f).raster()].filter(([, v]) => v !== kit.palette.shadow))); return { w: b.right - b.left + 1, h: b.bottom - b.top + 1 }; };
  assert.deepEqual(size(2), { w: 36, h: 16 }, 'deep frame');
  assert.equal(size(4).h, 32, 'first rebound');
  assert.equal(size(6).h, 32, 'second rebound');
  assert.equal(signature(frameCtx(act, 9).raster()), signature(frameCtx(act, 7).raster()));
});
