import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMinimalKit } from './minimal-kit.ts';
import { createCompactCoreActs } from './core-acts.ts';
import { QUESTION_GLYPH } from './state-acts.ts';
import {
  carriedPose, floorShadow, heldFrame, lookPose, pressPose, questionGlyphRects, rollPose, settlePose, shadowTierFor,
  SHADOW_STRIP, SHADOW_TIER_LIFT_PX, SHADOW_WIDTHS,
} from './poses.ts';
import type { DrawTarget, Kit } from './types.ts';

interface Rect { x: number; y: number; w: number; h: number; color: string }
class Rec implements DrawTarget {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000';
  rects: Rect[] = [];
  fillRect(x: number, y: number, w: number, h: number): void { this.rects.push({ x, y, w, h, color: String(this.fillStyle) }); }
  clearRect(): void { this.rects = []; }
  marks(): Rect[] { return this.rects.filter((r) => !(r.x === 0 && r.y === 0 && r.w === 96 && r.h === 96)); }
  raster(): Map<string, string> {
    const m = new Map<string, string>();
    for (const r of this.marks()) for (let y = Math.max(0, r.y); y < Math.min(96, r.y + r.h); y++) for (let x = Math.max(0, r.x); x < Math.min(96, r.x + r.w); x++) m.set(x + ',' + y, r.color);
    return m;
  }
}
const kit = createMinimalKit();
const core = createCompactCoreActs({ kit });
const draw = (fn: (c: DrawTarget) => void): Rec => { const c = new Rec(); fn(c); return c; };
const sig = (m: Map<string, string>) => [...m.entries()].sort().map(([k, v]) => k + v).join('|');
const bounds = (m: Map<string, string>) => {
  let left = Infinity, right = -Infinity, top = Infinity, bottom = -Infinity;
  for (const k of m.keys()) { const [x, y] = k.split(',').map(Number) as [number, number]; left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y); }
  return { left, right, top, bottom };
};
const without = (m: Map<string, string>, color: string) => new Map([...m].filter(([, v]) => v !== color));

/** Every pose, as drawn: one entry per variant. */
const variants: Array<[string, (c: DrawTarget) => void]> = [
  ['press', (c) => pressPose(kit, c)],
  ...[false, true].flatMap((happy) => [-1, 0, 1].map((gaze) => [`carried ${happy} ${gaze}`, (c: DrawTarget) => carriedPose(kit, c, { happy, gaze })] as [string, (c: DrawTarget) => void])),
  ...[-1, 0, 1].flatMap((g) => (['front', 'quarter'] as const).map((v) => [`look ${g} ${v}`, (c: DrawTarget) => lookPose(kit, c, g, v)] as [string, (c: DrawTarget) => void])),
  ['settle 0', (c) => settlePose(kit, c, 0)],
  ['settle 1', (c) => settlePose(kit, c, 1)],
  ...[0, 1, 2, 3, 4, 5, 6, 7].map((t) => [`roll ${t}`, (c: DrawTarget) => rollPose(kit, c, t)] as [string, (c: DrawTarget) => void]),
  ...[0, 1, 2].map((t) => [`shadow ${t}`, (c: DrawTarget) => floorShadow(kit, c, t)] as [string, (c: DrawTarget) => void]),
  ['held', (c) => heldFrame(kit, c, {})],
  ['held question gaze', (c) => heldFrame(kit, c, { question: true, gaze: -1, view: 'quarter' })],
  ['held tuck', (c) => heldFrame(kit, c, { shape: 'tuck', expression: 'blink' })],
];

test('every pose draws palette colours only, with finite integer non-negative rectangles', () => {
  const palette = new Set(Object.values(kit.palette));
  for (const [name, fn] of variants) {
    const c = draw(fn);
    assert.ok(c.marks().length > 0, name);
    for (const r of c.rects) {
      assert.ok([r.x, r.y, r.w, r.h].every(Number.isInteger), `${name} ${JSON.stringify(r)}`);
      assert.ok(r.w >= 0 && r.h >= 0, name);
      assert.ok(palette.has(r.color), `${name} colour ${r.color}`);
    }
  }
});

test('poses are compositions of kit.orb / kit.shadow / kit.pixel only (a kit spy sees no other drawing call)', () => {
  const calls: string[] = [];
  const spy: Kit = {
    ...kit,
    clear: (c) => { calls.push('clear'); kit.clear(c); },
    orb: (c, o) => { calls.push('orb'); return kit.orb(c, o); },
    shadow: (c, o) => { calls.push('shadow'); kit.shadow(c, o); },
    pixel: (c, x, y, w, h, color) => { calls.push('pixel'); kit.pixel(c, x, y, w, h, color); },
    line: () => { calls.push('line'); },
    star: () => { calls.push('star'); },
  };
  pressPose(spy, new Rec()); carriedPose(spy, new Rec()); lookPose(spy, new Rec(), 1, 'quarter'); settlePose(spy, new Rec(), 1);
  rollPose(spy, new Rec(), 3); floorShadow(spy, new Rec(), 2); heldFrame(spy, new Rec(), { question: true });
  assert.ok(calls.every((n) => ['clear', 'orb', 'shadow', 'pixel'].includes(n)), calls.join(','));
});

test('press pose is the authored click frame 1 (crouch, happy) raster for raster', () => {
  assert.equal(sig(draw((c) => pressPose(kit, c)).raster()), sig(draw((c) => core.click.render(c, 1)).raster()));
});

test('look pose at gaze 0 / front is raster-identical to idle3 frame 0; other gazes differ only in the face', () => {
  const idle = draw((c) => core.idle3.render(c, 0)).raster();
  assert.equal(sig(draw((c) => lookPose(kit, c, 0, 'front')).raster()), sig(idle));
  const ink = kit.palette.ink;
  const outline = (m: Map<string, string>) => sig(new Map([...m].filter(([, v]) => v === kit.palette.edge || v === kit.palette.shadow)));
  const faces = new Set<string>();
  for (const g of [-1, 0, 1]) for (const v of ['front', 'quarter'] as const) {
    const m = draw((c) => lookPose(kit, c, g, v)).raster();
    assert.equal(outline(m), outline(idle), 'same body and shadow');
    faces.add(sig(new Map([...m].filter(([, col]) => col === ink))));
  }
  assert.equal(faces.size, 6, 'six distinct faces');
});

test('carried pose: stretched body with dangling feet one row below it and no shadow', () => {
  const m = draw((c) => carriedPose(kit, c, { gaze: 1 })).raster();
  assert.ok(![...m.values()].includes(kit.palette.shadow), 'shadow stays on the floor');
  const nubs = [...m].filter(([, v]) => v === kit.palette.nub).map(([k]) => k.split(',').map(Number) as [number, number]);
  assert.ok(nubs.length > 0);
  const body = bounds(without(m, kit.palette.nub));
  assert.equal(body.bottom, 79);
  assert.equal(body.bottom - body.top + 1, kit.shapes.stretch!.length);
  assert.ok(nubs.some(([, y]) => y === 80) && nubs.every(([, y]) => y >= 79 && y <= 81), 'feet nubs hang below the body');
  const happy = draw((c) => carriedPose(kit, c, { happy: true })).raster();
  const surprised = draw((c) => carriedPose(kit, c, { happy: false })).raster();
  assert.notEqual(sig(happy), sig(surprised));
});

test('settle poses: crouch then low, on the floor with the resting shadow', () => {
  for (const [f, shape] of [[0, 'crouch'], [1, 'low']] as const) {
    const m = draw((c) => settlePose(kit, c, f)).raster();
    const b = bounds(without(m, kit.palette.shadow));
    assert.equal(b.bottom, 79);
    assert.equal(b.bottom - b.top + 1, kit.shapes[shape]!.length);
    assert.ok([...m.values()].includes(kit.palette.shadow));
  }
});

test('roll pose: the tuck body with eight distinct turn faces; tuck top stays below the display crop (row 42)', () => {
  const faces = new Set<string>();
  for (let t = 0; t < 8; t++) {
    const m = draw((c) => rollPose(kit, c, t)).raster();
    const b = bounds(without(m, kit.palette.shadow));
    assert.equal(b.bottom, 79);
    assert.ok(b.top >= 42);
    faces.add(sig(m));
  }
  assert.equal(faces.size, 8);
  assert.equal(sig(draw((c) => rollPose(kit, c, 9)).raster()), sig(draw((c) => rollPose(kit, c, 1)).raster()), 'turn wraps');
  assert.ok(![...draw((c) => rollPose(kit, c, 2, { shadow: false })).raster().values()].includes(kit.palette.shadow));
});

test('floor shadow tiers: 26 / 20 / 14 px wide, entirely inside the .rf-shadow strip (scene rows 80-88 of the 44 px column)', () => {
  assert.deepEqual([...SHADOW_WIDTHS], [26, 20, 14]);
  for (let t = 0; t < 3; t++) {
    const m = draw((c) => floorShadow(kit, c, t)).raster();
    assert.ok([...m.values()].every((v) => v === kit.palette.shadow));
    const b = bounds(m);
    assert.equal(b.right - b.left + 1, SHADOW_WIDTHS[t]);
    assert.ok(b.top >= SHADOW_STRIP.y && b.bottom < SHADOW_STRIP.y + SHADOW_STRIP.h);
    assert.ok(b.left >= SHADOW_STRIP.x && b.right < SHADOW_STRIP.x + SHADOW_STRIP.w);
  }
  assert.equal(shadowTierFor(0), 0);
  assert.equal(shadowTierFor(SHADOW_TIER_LIFT_PX[0] - 1), 0);
  assert.equal(shadowTierFor(SHADOW_TIER_LIFT_PX[0]), 1);
  assert.equal(shadowTierFor(SHADOW_TIER_LIFT_PX[1]), 2);
  assert.equal(shadowTierFor(NaN), 0);
});

test('held frame: idle body (raster = idle3 frame 0 by default) plus the authored question glyph at its authored place when asked', () => {
  assert.equal(sig(draw((c) => heldFrame(kit, c)).raster()), sig(draw((c) => core.idle3.render(c, 0)).raster()));
  const glyph = questionGlyphRects(kit);
  assert.equal(glyph.length, 10, 'ten ink pixels in the authored glyph');
  const q = draw((c) => heldFrame(kit, c, { question: true })).raster();
  assert.equal(q.get('65,50'), kit.palette.ink);
  const inGlyph = (m: Map<string, string>) => [...m].filter(([k]) => { const [x, y] = k.split(',').map(Number) as [number, number]; return x >= QUESTION_GLYPH.x && x < QUESTION_GLYPH.x + QUESTION_GLYPH.w && y >= QUESTION_GLYPH.y && y < QUESTION_GLYPH.y + QUESTION_GLYPH.h; });
  assert.equal(inGlyph(q).length, 10);
  assert.equal(inGlyph(draw((c) => heldFrame(kit, c, { question: false })).raster()).length, 0);
});
