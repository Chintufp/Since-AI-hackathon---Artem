import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPanelMotion } from './panel-motion.ts';
import type { PanelMotionOptions } from './panel-motion.ts';

/** Minimal DOM stand-ins: enough surface for the spring loop; no layout engine. */
class FakeEl {
  style: Record<string, string> = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  children: FakeEl[] = [];
  inert = false;
  h: number;
  w: number;
  constructor(h = 0, w = 380) {
    this.h = h;
    this.w = w;
  }
  get firstElementChild(): FakeEl | undefined { return this.children[0]; }
  getBoundingClientRect() { return { width: this.w, height: this.h, top: 0, bottom: this.h }; }
  querySelectorAll(sel: string): FakeEl[] { return sel === '.rf-node-detail' ? this.children : []; }
  setAttribute(k: string, v: string) { this.attrs[k] = v; }
}

function harness(opts: { reduced?: boolean; natural?: number; historyHeight?: number } = {}) {
  const g = globalThis as Record<string, unknown>;
  const pending: Array<(t: number) => void> = [];
  const saved = { raf: g.requestAnimationFrame, caf: g.cancelAnimationFrame };
  g.requestAnimationFrame = (cb: (t: number) => void) => { pending.push(cb); return pending.length; };
  g.cancelAnimationFrame = (id: number) => { if (id > 0) pending[id - 1] = () => {}; };
  const els = { surface: new FakeEl(200), skin: new FakeEl(), content: new FakeEl(), footer: new FakeEl(), canvas: new FakeEl(), reveal: new FakeEl() };
  const history = new FakeEl(opts.historyHeight ?? 120);
  const state = { natural: opts.natural ?? 200, reduced: !!opts.reduced };
  const motion = createPanelMotion({
    ...(els as unknown as Pick<PanelMotionOptions, 'surface' | 'skin' | 'content' | 'footer' | 'canvas' | 'reveal'>),
    history: () => history as unknown as HTMLElement,
    naturalHeight: () => state.natural,
    reduced: () => state.reduced,
  });
  let t = 0;
  /** Run frames until the loop stops; returns the number of 60 Hz frames used. */
  const run = (max = 600): number => {
    let n = 0;
    while (pending.length && n < max) {
      const cbs = pending.splice(0);
      t += 1000 / 60;
      cbs.forEach((cb) => cb(t));
      n++;
    }
    return n;
  };
  const frame = (): void => { const cbs = pending.splice(0); t += 1000 / 60; cbs.forEach((cb) => cb(t)); };
  return { motion, els, history, state, run, frame, pending, restore: () => { g.requestAnimationFrame = saved.raf; g.cancelAnimationFrame = saved.caf; } };
}

test('panel close spring settles within a second, hides the surface and stops the rAF loop', () => {
  const h = harness();
  try {
    h.motion.panel(false);
    const frames = h.run();
    assert.ok(frames > 3 && frames < 60, `settled in ${frames} frames`);
    const s = h.motion.status();
    assert.equal(s.panelProgress, 0);
    assert.equal(s.active, false);
    assert.equal(h.pending.length, 0, 'no rAF scheduled once settled');
    assert.equal(h.els.surface.style.visibility, 'hidden');
    assert.equal(h.els.surface.style.pointerEvents, 'none');
    assert.equal(h.els.surface.inert, true);
  } finally { h.restore(); }
});

test('panel open settles to full opacity with no clip path', () => {
  const h = harness();
  try {
    h.motion.panel(false, false);
    assert.equal(h.motion.status().panelProgress, 0);
    h.motion.panel(true);
    h.run();
    assert.equal(h.motion.status().panelProgress, 1);
    assert.equal(h.els.surface.style.clipPath, 'none');
    assert.equal(h.els.content.style.opacity, '1');
    assert.equal(h.els.surface.inert, false);
  } finally { h.restore(); }
});

test('reversal mid-flight keeps velocity continuity and ends at the new target', () => {
  const h = harness();
  try {
    h.motion.panel(false);
    for (let i = 0; i < 4; i++) h.frame();
    const mid = h.motion.status();
    assert.ok(mid.panelProgress > 0 && mid.panelProgress < 1);
    assert.ok(mid.panelVelocity < 0, 'closing');
    h.motion.panel(true);
    h.frame();
    const after = h.motion.status();
    assert.ok(Math.abs(after.panelProgress - mid.panelProgress) < 0.2, 'no jump on reversal');
    h.run();
    assert.equal(h.motion.status().panelProgress, 1);
    assert.equal(h.motion.status().panelTarget, 1);
  } finally { h.restore(); }
});

test('critically damped spring never overshoots its target', () => {
  const h = harness();
  try {
    h.motion.panel(false);
    let min = 1;
    while (h.pending.length) { h.frame(); min = Math.min(min, h.motion.status().panelProgress); }
    assert.ok(min >= 0);
  } finally { h.restore(); }
});

test('reduced motion settles instantly without scheduling frames', () => {
  const h = harness({ reduced: true });
  try {
    h.motion.panel(false);
    assert.equal(h.pending.length, 0);
    assert.equal(h.motion.status().panelProgress, 0);
    h.motion.press(true);
    assert.equal(h.pending.length, 0);
  } finally { h.restore(); }
});

test('context reveal springs to the history height and back', () => {
  const h = harness({ historyHeight: 120 });
  try {
    h.motion.context(true);
    h.run();
    assert.equal(h.motion.status().contextHeight, 120);
    assert.equal(h.els.reveal.style.height, '120px');
    h.motion.context(false);
    h.run();
    assert.equal(h.motion.status().contextHeight, 0);
    assert.equal(h.els.reveal.style.height, '0px');
  } finally { h.restore(); }
});

test('node details expand to their full height and collapse; opening another closes the first', () => {
  const h = harness();
  try {
    const mk = (id: string, full: number) => { const el = new FakeEl(); el.dataset.node = id; el.children.push(new FakeEl(full)); return el; };
    const container = new FakeEl();
    container.children.push(mk('a', 40), mk('b', 60));
    h.motion.registerDetails(null, container as unknown as HTMLElement);
    h.motion.node('a');
    h.run();
    let d = h.motion.status().detailHeights;
    assert.deepEqual(d.map((x) => x.value), [40, 0]);
    h.motion.node('b');
    h.run();
    d = h.motion.status().detailHeights;
    assert.deepEqual(d.map((x) => x.value), [0, 60]);
    assert.equal(container.children[0]!.attrs['aria-hidden'], 'true');
    assert.equal(container.children[1]!.attrs['aria-hidden'], 'false');
  } finally { h.restore(); }
});

test('view transition animates height toward the new natural height then clears the flag', () => {
  const h = harness({ natural: 200 });
  try {
    h.motion.view(false);
    h.state.natural = 300;
    h.motion.view(true);
    assert.equal(h.motion.status().viewTransition, true);
    h.run();
    const s = h.motion.status();
    assert.equal(s.viewTransition, false);
    assert.equal(s.panelHeight, 300);
  } finally { h.restore(); }
});

test('press pulse is an immediate dip that eases back', () => {
  const h = harness();
  try {
    h.motion.press(true);
    assert.equal(h.els.canvas.style.transform, 'translateY(2px)');
    h.motion.press(false);
    h.run();
    assert.equal(h.els.canvas.style.transform, 'translateY(0px)');
  } finally { h.restore(); }
});
