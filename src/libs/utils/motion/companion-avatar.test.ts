/** desktop (R31..R36): AvatarController companion additions, with fake canvases, rAF and timers. */
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { AvatarController, CROP, DROP, LANDING_FRAMES, TALL_ACTS } from './avatar.ts';
import type { ActKey } from './avatar.ts';
import { createMinimalKit } from './minimal-kit.ts';
import { createCompactCoreActs } from './core-acts.ts';
import { createCompactPropActs } from './prop-acts.ts';
import { SHADOW_STRIP } from './poses.ts';
import type { DrawTarget } from './types.ts';

interface Rect { x: number; y: number; w: number; h: number; color: string }
class FakeCanvas2D implements DrawTarget {
  fillStyle: string | CanvasGradient | CanvasPattern = '#000';
  imageSmoothingEnabled = true;
  rects: Rect[] = [];
  clears = 0;
  draws: unknown[][] = [];
  fillRect(x: number, y: number, w: number, h: number): void { this.rects.push({ x, y, w, h, color: String(this.fillStyle) }); }
  clearRect(): void { this.clears++; this.rects = []; }
  drawImage(...a: unknown[]): void { this.draws.push(a); }
}
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

const kit = createMinimalKit();

function setup(opts: { reduced?: boolean; question?: boolean; drop?: boolean; shadow?: boolean; fallDistance?: number } = {}) {
  const g = globalThis as Record<string, unknown>;
  const raf: Array<(t: number) => void> = [];
  const saved = { raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame, dpr: g.devicePixelRatio, doc: g.document };
  g.requestAnimationFrame = (cb: (t: number) => void) => { raf.push(cb); return raf.length; };
  g.cancelAnimationFrame = (id: number) => { raf[id - 1] = () => {}; };
  g.devicePixelRatio = 2;
  g.document = { hidden: false, addEventListener() {}, removeEventListener() {} };
  const flags = { reduced: !!opts.reduced, question: !!opts.question };
  const host = { reduced: () => flags.reduced, hasQuestion: () => flags.question };
  const canvas = new FakeCanvas();
  const drop = opts.drop === false ? null : new FakeCanvas();
  if (drop) drop.hidden = true;
  const shadow = opts.shadow ? new FakeCanvas() : null;
  const raws: FakeCanvas[] = [];
  const avatar = new AvatarController(canvas as unknown as HTMLCanvasElement, host, {
    createCanvas: (w, h) => { const c = new FakeCanvas(); c.width = w; c.height = h; raws.push(c); return c as unknown as HTMLCanvasElement; },
    drop: drop as unknown as HTMLCanvasElement | null,
    shadow: shadow as unknown as HTMLCanvasElement | null,
    fallDistance: opts.fallDistance ?? 700,
  });
  let t = 0;
  const pending = () => raf.filter((cb) => cb.toString() !== '() => {}').length;
  const pump = (dt = 1000 / 60) => { t += dt; const cbs = raf.splice(0); cbs.forEach((cb) => cb(t)); return cbs.length; };
  const restore = () => { avatar.destroy(); g.requestAnimationFrame = saved.raf; g.cancelAnimationFrame = saved.caf; g.devicePixelRatio = saved.dpr; g.document = saved.doc; };
  return { avatar, canvas, drop, shadow, raws, raf, pump, pending, flags, restore };
}
type S = ReturnType<typeof setup>;
/** Pump frames until `until` is true (or a cap), recording status().lastFrame after each frame. */
const pumpUntil = (s: S, until: () => boolean, cap = 400) => {
  const frames: number[] = [];
  for (let i = 0; i < cap && !until(); i++) { s.pump(); frames.push(s.avatar.status().lastFrame); }
  return frames;
};
const dropBlits = (s: S) => s.drop!.ctx.draws.filter((d) => d[1] === DROP.x && d[2] === DROP.y && d[3] === DROP.w && d[4] === DROP.h).length;

test('fallFrom 200 px lands in the hop tier: translated drop surface falls with the derived gravity, then hop frames 11-17, then idle', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup({ shadow: true });
  try {
    const landed: string[] = [];
    let settled = 0;
    const tier = s.avatar.fallFrom(200, (t) => landed.push(t), { onSettled: () => settled++ });
    assert.equal(tier, 'hop');
    let st = s.avatar.status();
    assert.equal(st.airborne, true);
    assert.equal(st.lift, 200);
    assert.equal(st.surface, 'drop');
    assert.equal(s.drop!.hidden, false);
    assert.equal(s.drop!.style.transform, 'translateY(-200.00px)');
    // body without its shadow on the drop surface; the shadow strip shows the tier
    assert.ok(!s.raws[0]!.ctx.rects.some((r) => r.color === kit.palette.shadow), 'no shadow on the airborne body');
    assert.ok(s.shadow!.ctx.draws.length > 0, 'shadow strip painted');
    assert.deepEqual(s.shadow!.ctx.draws.at(-1)!.slice(1, 5), [SHADOW_STRIP.x, SHADOW_STRIP.y, SHADOW_STRIP.w, SHADOW_STRIP.h]);
    const lifts: number[] = [];
    let ms = 0;
    for (let i = 0; i < 100 && s.avatar.status().airborne; i++) { s.pump(); ms += 1000 / 60; lifts.push(s.avatar.status().lift); }
    assert.ok(lifts.every((l, i) => i === 0 || l <= lifts[i - 1]!), 'monotonic descent');
    // T = 900 * sqrt(200 / 700) ~ 481 ms
    assert.ok(Math.abs(ms - 900 * Math.sqrt(200 / 700)) < 40, `fell in ${ms.toFixed(0)} ms`);
    assert.deepEqual(landed, ['hop']);
    st = s.avatar.status();
    assert.equal(st.mode, 'hop');
    assert.equal(st.lift, 0);
    assert.equal(s.drop!.style.transform, '');
    assert.equal(s.shadow!.ctx.draws.length > 0 && s.shadow!.ctx.clears > 0, true, 'shadow strip cleared at touchdown');
    const frames = [st.lastFrame, ...pumpUntil(s, () => s.avatar.status().mode !== 'hop')];
    const seq = frames.filter((f, i) => i === 0 || f !== frames[i - 1]);
    const landing = seq.slice(0, seq.indexOf(17) + 1);
    assert.deepEqual(landing, [11, 12, 13, 14, 15, 16, 17], `landing frames ${seq.join(',')}`);
    assert.ok(dropBlits(s) > 0);
    st = s.avatar.status();
    assert.equal(st.mode, 'idle3');
    assert.equal(st.idleLoop, true);
    assert.equal(st.surface, 'display');
    assert.equal(s.drop!.hidden, true);
    assert.equal(settled, 1);
  } finally { s.restore(); mock.timers.reset(); }
});

test('fallFrom 800 px lands in the entrance tier (frames 5-23 on the drop surface); 10 px lands with the composed 2-frame settle', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup();
  try {
    assert.equal(s.avatar.fallFrom(800), 'entrance');
    // without a shadow strip the display canvas stays on the floor and shows the shadow alone
    assert.ok(s.raws[0]!.ctx.rects.some((r) => r.color === kit.palette.accent), 'air streaks on the falling body');
    pumpUntil(s, () => !s.avatar.status().airborne);
    const st = s.avatar.status();
    assert.equal(st.mode, 'entrance');
    const frames = [st.lastFrame, ...pumpUntil(s, () => s.avatar.status().mode !== 'entrance')];
    const seq = frames.filter((f, i) => i === 0 || f !== frames[i - 1]);
    const [from, to] = LANDING_FRAMES.entrance;
    assert.deepEqual(seq.slice(0, seq.indexOf(to) + 1), Array.from({ length: to - from + 1 }, (_, i) => from + i), `entrance frames ${seq.join(',')}`);
    assert.equal(s.avatar.status().mode, 'idle3');
  } finally { s.restore(); mock.timers.reset(); }
  const r = setup();
  try {
    let tierAt = '';
    assert.equal(r.avatar.fallFrom(10, (t) => (tierAt = t)), 'settle');
    pumpUntil(r, () => !r.avatar.status().airborne);
    assert.equal(tierAt, 'settle');
    assert.equal(r.avatar.status().mode, 'land:settle');
    assert.equal(r.avatar.status().surface, 'drop');
    const frames = [r.avatar.status().lastFrame, ...pumpUntil(r, () => r.avatar.status().mode !== 'land:settle')];
    assert.deepEqual(frames.filter((f, i) => i === 0 || f !== frames[i - 1]).slice(0, 2), [0, 1]);
    assert.equal(r.avatar.status().mode, 'idle3');
  } finally { r.restore(); mock.timers.reset(); }
});

test('fallFrom with onStep: the host moves the carrier, the drop surface is not translated; reduced motion lands at once', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup();
  try {
    const steps: number[] = [];
    s.avatar.fallFrom(300, undefined, { onStep: (l) => steps.push(l) });
    pumpUntil(s, () => !s.avatar.status().airborne);
    assert.equal(s.drop!.style.transform ?? '', '');
    assert.ok(steps.length > 5 && steps[0] === 300 && steps.at(-1) === 0);
  } finally { s.restore(); mock.timers.reset(); }
  const r = setup({ reduced: true });
  try {
    const got: string[] = [];
    r.avatar.fallFrom(800, (t) => got.push(t), { onSettled: () => got.push('settled') });
    assert.deepEqual(got, ['entrance', 'settled']);
    assert.equal(r.raf.length, 0);
    assert.equal(r.avatar.status().airborne, false);
  } finally { r.restore(); mock.timers.reset(); }
});

test('a pointerdown mid-air (carried pose) cancels the fall and keeps the current lift readable first', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup({ shadow: true });
  try {
    s.avatar.fallFrom(400);
    s.pump(); s.pump(); s.pump();
    const lift = s.avatar.status().lift;
    assert.ok(lift > 0 && lift < 400);
    s.avatar.pose({ kind: 'carried', lift });
    const st = s.avatar.status();
    assert.equal(st.airborne, false);
    assert.equal(st.carried, true);
    assert.equal(st.lift, lift);
    assert.equal(s.pending(), 0, 'no rAF while carried');
  } finally { s.restore(); mock.timers.reset(); }
});

test('hold(): a still that rest(), refresh() and timers respect (zero timers, zero rAF); one-shots return to it; null releases it', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup();
  try {
    s.avatar.hold({ gaze: -1 });
    let st = s.avatar.status();
    assert.equal(st.held, true);
    assert.equal(st.base, 'hold');
    assert.equal(st.mode, 'hold');
    assert.equal(st.animating, false);
    s.avatar.rest();
    s.avatar.refresh();
    mock.timers.tick(5000);
    st = s.avatar.status();
    assert.equal(st.mode, 'hold');
    assert.equal(st.idleLoop, false, 'rest() started no idle timer');
    assert.equal(st.animating, false);
    assert.equal(s.raf.length, 0);
    // a one-shot (the question act at the perch) returns to the hold
    s.avatar.play('question');
    assert.equal(s.avatar.status().mode, 'question');
    pumpUntil(s, () => s.avatar.status().mode !== 'question');
    st = s.avatar.status();
    assert.equal(st.mode, 'hold');
    assert.equal(st.animating, false);
    // the same hold again draws nothing
    const draws = s.canvas.ctx.draws.length;
    s.avatar.hold({ gaze: -1 });
    assert.equal(s.canvas.ctx.draws.length, draws);
    s.avatar.hold(null);
    st = s.avatar.status();
    assert.equal(st.held, false);
    assert.equal(st.mode, 'idle3');
    assert.equal(st.idleLoop, true);
  } finally { s.restore(); mock.timers.reset(); }
});

test('hold() draws the question glyph on the held still when asked (or when the host has a question)', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup();
  try {
    s.avatar.hold({ question: true });
    assert.ok(s.raws[0]!.ctx.rects.some((r) => r.x === 65 && r.y === 50 && r.color === kit.palette.ink));
    s.avatar.hold({ question: false });
    assert.ok(!s.raws[0]!.ctx.rects.some((r) => r.x === 65 && r.y === 50));
    s.flags.question = true;
    s.avatar.hold({});
    assert.ok(s.raws[0]!.ctx.rects.some((r) => r.x === 65 && r.y === 50 && r.color === kit.palette.ink), 'follows hasQuestion()');
  } finally { s.restore(); mock.timers.reset(); }
});

test('tall acts (hop, backflip, half, hero) play on the drop surface through the (26,0,44,86) rect, then return to the display canvas', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup();
  try {
    // why they are tall: their tops rise above the display crop row 42
    const acts = { ...createCompactCoreActs({ kit }), ...createCompactPropActs({ kit }) };
    for (const key of TALL_ACTS) {
      const act = acts[key as keyof typeof acts]!;
      let top = 96;
      for (let f = 0; f < act.frames; f++) {
        const rec = { fillStyle: '' as unknown, rects: [] as Rect[], fillRect(x: number, y: number, w: number, h: number) { if (!(w === 96 && h === 96)) this.rects.push({ x, y, w, h, color: String(this.fillStyle) }); }, clearRect() {} };
        act.render(rec as unknown as DrawTarget, f);
        top = Math.min(top, ...rec.rects.map((r) => r.y));
      }
      assert.ok(top < CROP.y, `${key} top ${top}`);
    }
    for (const key of ['hop', 'backflip', 'half', 'hero'] as ActKey[]) {
      const before = dropBlits(s);
      s.avatar.play(key);
      assert.equal(s.avatar.status().surface, 'drop', key);
      assert.equal(s.drop!.hidden, false);
      pumpUntil(s, () => s.avatar.status().mode !== key);
      assert.ok(dropBlits(s) > before + 5, `${key} blitted through the drop rect`);
      assert.equal(s.avatar.status().surface, 'display');
      assert.equal(s.drop!.hidden, true);
      assert.equal(s.avatar.status().mode, 'idle3');
    }
    // short acts stay on the display canvas
    s.avatar.play('hello');
    assert.equal(s.avatar.status().surface, 'display');
    assert.equal(s.drop!.hidden, true);
  } finally { s.restore(); mock.timers.reset(); }
});

test('play(click) during the processing loop interjects and returns to the loop; another act ends the loop', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup();
  try {
    s.avatar.play('processing', { loop: true });
    assert.equal(s.avatar.status().base, 'processing');
    s.pump(); s.pump();
    s.avatar.play('click');
    assert.equal(s.avatar.status().mode, 'click');
    pumpUntil(s, () => s.avatar.status().mode !== 'click');
    let st = s.avatar.status();
    assert.equal(st.mode, 'processing', 'the loop resumed');
    assert.equal(st.base, 'processing');
    assert.equal(st.reactionPlaying, true);
    // the press + run(click, 2) path keeps the loop as well
    s.avatar.pose({ kind: 'press' });
    assert.equal(s.avatar.status().lastFrame, 1);
    s.avatar.run('click', 2);
    assert.equal(s.avatar.status().lastFrame, 2);
    pumpUntil(s, () => s.avatar.status().mode !== 'click');
    assert.equal(s.avatar.status().mode, 'processing');
    // the outcome ends the loop (unchanged panel behaviour)
    s.avatar.play('result');
    assert.equal(s.avatar.status().base, 'idle3');
    pumpUntil(s, () => s.avatar.status().mode !== 'result');
    st = s.avatar.status();
    assert.equal(st.mode, 'idle3');
    assert.equal(st.idleLoop, true);
    // explicit base
    s.avatar.setBase('processing');
    assert.equal(s.avatar.status().mode, 'processing');
    s.avatar.setBase('idle3');
    assert.equal(s.avatar.status().mode, 'idle3');
    s.avatar.play('processing', { loop: true });
    s.avatar.rest();
    assert.equal(s.avatar.status().base, 'idle3', 'rest() still ends the loop');
  } finally { s.restore(); mock.timers.reset(); }
});

test('run(act, from, to) plays a frame range and returns to the base', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup();
  try {
    s.avatar.run('entrance', 5, 9);
    const frames = [s.avatar.status().lastFrame, ...pumpUntil(s, () => s.avatar.status().mode !== 'entrance')];
    const seq = frames.filter((f, i) => i === 0 || f !== frames[i - 1]);
    assert.deepEqual(seq.slice(0, 5), [5, 6, 7, 8, 9]);
    assert.equal(s.avatar.status().mode, 'idle3');
  } finally { s.restore(); mock.timers.reset(); }
});

test('look() redraws only on change, holds no timers while looking, and gaze 0 / front returns to the idle loop', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup();
  try {
    const n = () => s.canvas.ctx.draws.length;
    let before = n();
    assert.equal(s.avatar.look(0), false, 'idle already looks ahead');
    assert.equal(n(), before);
    assert.equal(s.avatar.look(1), true);
    assert.equal(n(), before + 1);
    before = n();
    assert.equal(s.avatar.look(1), false);
    assert.equal(s.avatar.look(0.4), false, 'same sign');
    assert.equal(n(), before);
    let st = s.avatar.status();
    assert.equal(st.mode, 'look');
    assert.equal(st.animating, false);
    assert.equal(s.avatar.look(1, 'quarter'), true);
    assert.equal(n(), before + 1);
    s.avatar.refresh();
    assert.equal(s.avatar.status().mode, 'look', 'refresh keeps the look');
    assert.equal(s.avatar.look(0), true);
    st = s.avatar.status();
    assert.equal(st.mode, 'idle3');
    assert.equal(st.idleLoop, true);
    // ignored while a reaction plays, while held, under reduced motion
    s.avatar.play('hello');
    assert.equal(s.avatar.look(-1), false);
    s.avatar.hold({});
    assert.equal(s.avatar.look(-1), false);
    s.avatar.hold(null);
    s.flags.reduced = true;
    assert.equal(s.avatar.look(-1), false);
  } finally { s.restore(); mock.timers.reset(); }
});

test('carried pose: drawn once per change on the drop surface without its shadow; the shadow strip follows the lift tier', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup({ shadow: true });
  try {
    assert.equal(s.shadow!.width, SHADOW_STRIP.w * 4);
    assert.equal(s.shadow!.height, SHADOW_STRIP.h * 4);
    assert.equal(s.shadow!.style.height, '16px');
    s.avatar.pose({ kind: 'carried', happy: false, gaze: 1, lift: 10 });
    let st = s.avatar.status();
    assert.equal(st.carried, true);
    assert.equal(st.surface, 'drop');
    assert.equal(st.animating, false);
    assert.equal(s.raf.length, 0);
    assert.ok(!s.raws[0]!.ctx.rects.some((r) => r.color === kit.palette.shadow));
    const body = dropBlits(s);
    const shadowDraws = s.shadow!.ctx.draws.length;
    s.avatar.pose({ kind: 'carried', happy: false, gaze: 1, lift: 20 });
    assert.equal(dropBlits(s), body, 'same pose: no body redraw');
    assert.equal(s.shadow!.ctx.draws.length, shadowDraws, 'same tier: no shadow redraw');
    s.avatar.pose({ kind: 'carried', happy: false, gaze: 1, lift: 300 });
    assert.equal(dropBlits(s), body);
    assert.equal(s.shadow!.ctx.draws.length, shadowDraws + 1, 'tier change: one shadow redraw');
    assert.equal(s.avatar.status().lift, 300);
    s.avatar.pose({ kind: 'carried', happy: true, gaze: 1, lift: 300 });
    assert.equal(dropBlits(s), body + 1, 'expression change: one body redraw');
    s.avatar.refresh();
    assert.equal(s.avatar.status().carried, true, 'refresh keeps the carried pose');
    s.avatar.rest();
    st = s.avatar.status();
    assert.equal(st.carried, false);
    assert.equal(st.surface, 'display');
    assert.equal(s.shadow!.ctx.clears > 0, true);
  } finally { s.restore(); mock.timers.reset(); }
});

test('press, settle and roll poses are stills on the display canvas; status reports the new fields', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup();
  try {
    s.avatar.pose({ kind: 'press' });
    let st = s.avatar.status();
    assert.equal(st.mode, 'pose:press');
    assert.equal(st.surface, 'display');
    assert.equal(st.animating, false);
    for (let t = 0; t < 8; t++) {
      s.avatar.pose({ kind: 'roll', turn: t });
      assert.equal(s.avatar.status().lastFrame, t);
    }
    s.avatar.pose({ kind: 'settle', frame: 1 });
    st = s.avatar.status();
    assert.equal(st.lastFrame, 1);
    for (const k of ['held', 'carried', 'airborne', 'lift', 'base', 'surface'] as const) assert.ok(k in st, k);
    assert.deepEqual([st.held, st.carried, st.airborne, st.lift, st.base, st.surface], [false, false, false, 0, 'idle3', 'display']);
    mock.timers.tick(3000);
    assert.equal(s.avatar.status().mode, 'pose:settle', 'a pose stays until the next call');
  } finally { s.restore(); mock.timers.reset(); }
});

// ---- desktop (UX fixes, motion area) ----

/** Flip document.hidden and run the controller's visibilitychange handler (the fake document does not dispatch). */
const hideWindow = (s: S) => {
  (globalThis.document as { hidden: boolean }).hidden = true;
  (s.avatar as unknown as { onVisibility: () => void }).onVisibility();
};

test('shell-01: hiding the window mid-fall still reports onStep(0), onLand and onSettled, in that order, and leaves him on the floor', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup();
  try {
    const calls: string[] = [];
    s.avatar.fallFrom(200, (t) => calls.push('land:' + t), { onStep: (l) => calls.push('step:' + (l === 0 ? 0 : 'air')), onSettled: () => calls.push('settled') });
    s.pump();
    s.pump();
    assert.equal(s.avatar.status().airborne, true);
    calls.length = 0;
    hideWindow(s);
    assert.deepEqual(calls, ['step:0', 'land:hop', 'settled']);
    const st = s.avatar.status();
    assert.equal(st.airborne, false);
    assert.equal(st.lift, 0);
    assert.equal(st.reactionPlaying, false);
    assert.equal(st.mode, 'idle3');
    assert.equal(s.pending(), 0, 'no frame left in flight');
    s.pump();
    assert.deepEqual(calls, ['step:0', 'land:hop', 'settled'], 'each callback once');
  } finally { s.restore(); mock.timers.reset(); }
});

test('shell-01: hiding the window during the landing frames (hop tier and composed settle) still calls onSettled once', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    for (const lift of [200, 10]) {
      const s = setup();
      try {
        let settled = 0;
        s.avatar.fallFrom(lift, undefined, { onSettled: () => settled++ });
        pumpUntil(s, () => !s.avatar.status().airborne);
        assert.ok(s.avatar.status().reactionPlaying, `landing in flight (${lift})`);
        hideWindow(s);
        assert.equal(settled, 1, `onSettled after hide (${lift})`);
        assert.equal(s.avatar.status().mode, 'idle3');
        assert.equal(s.drop!.hidden, true);
        s.pump();
        assert.equal(settled, 1);
      } finally { s.restore(); }
    }
  } finally { mock.timers.reset(); }
});

test('shell-01: the intersection observer going not-visible also finishes an in-flight fall', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const g = globalThis as Record<string, unknown>;
  const saved = g.IntersectionObserver;
  let fire: ((e: Array<{ isIntersecting: boolean }>) => void) | null = null;
  g.IntersectionObserver = class { constructor(cb: typeof fire) { fire = cb; } observe() {} disconnect() {} };
  const s = setup();
  try {
    let settled = 0;
    const steps: number[] = [];
    s.avatar.fallFrom(400, undefined, { onStep: (l) => steps.push(l), onSettled: () => settled++ });
    s.pump();
    fire!([{ isIntersecting: false }]);
    assert.equal(steps.at(-1), 0);
    assert.equal(settled, 1);
    assert.equal(s.avatar.status().airborne, false);
  } finally { s.restore(); g.IntersectionObserver = saved; mock.timers.reset(); }
});

test('shell-01: hiding while idle or holding a still pose is unchanged (settles / keeps the pose)', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup();
  try {
    s.avatar.pose({ kind: 'press' });
    hideWindow(s);
    assert.equal(s.avatar.status().mode, 'pose:press');
    (globalThis.document as { hidden: boolean }).hidden = false;
    s.avatar.rest();
    hideWindow(s);
    assert.equal(s.avatar.status().mode, 'idle3');
    assert.equal(s.avatar.status().idleLoop, false, 'no idle timer while hidden');
  } finally { s.restore(); mock.timers.reset(); }
});

test('fidelity-10: the question glyph is not overlaid on travelling frames (launch landing, tall acts) but stays on resting acts', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup({ question: true });
  try {
    const glyph = s.raws[1]!;
    const raw = s.raws[0]!.ctx;
    const overlays = () => raw.draws.filter((d) => d[0] === glyph).length;
    for (const key of ['hop', 'backflip', 'half', 'hero', 'entrance'] as ActKey[]) {
      s.avatar.play(key);
      const before = overlays();
      pumpUntil(s, () => s.avatar.status().mode !== key);
      // the final settle back to idle3 overlays once
      assert.ok(overlays() - before <= 1, `${key}: ${overlays() - before} overlays`);
    }
    s.avatar.fallFrom(800);
    pumpUntil(s, () => !s.avatar.status().airborne);
    const before = overlays();
    pumpUntil(s, () => s.avatar.status().mode !== 'entrance');
    assert.ok(overlays() - before <= 1, 'no glyph during the entrance-tier landing');
    // resting / short acts keep it
    s.avatar.play('hello');
    const h = overlays();
    s.pump(); s.pump(); s.pump(); s.pump(); s.pump(); s.pump();
    assert.ok(overlays() > h, 'glyph overlays a short act on the display canvas');
  } finally { s.restore(); mock.timers.reset(); }
});

test('M3m: hold({ glyphSide: "left" }) draws the glyph left of the body and is a distinct held key', () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  const s = setup();
  try {
    s.avatar.hold({ question: true });
    assert.ok(s.raws[0]!.ctx.rects.some((r) => r.x === 65 && r.y === 50 && r.color === kit.palette.ink));
    s.avatar.hold({ question: true, glyphSide: 'left' });
    const ink = s.raws[0]!.ctx.rects.filter((r) => r.color === kit.palette.ink && r.y >= 50 && r.y < 57 && (r.x < 34 || r.x > 61));
    assert.equal(ink.length, 10);
    assert.ok(ink.every((r) => r.x >= CROP.x && r.x < 34), 'left of the body, inside the display crop');
  } finally { s.restore(); mock.timers.reset(); }
});
