/**
 * Screenshot/measurement harness (entry: dist/desktop/shots.cjs, driven by scripts/screenshot.mjs and
 * scripts/real-check.mjs). Not part of the production app.
 *
 * Mock run (default):
 * 1. The 41 regular states: 420 px in the work-area window (R31) with `away=0`, cropped to the 420x680 panel
 *    area around the carrier so they keep their R28 framing; 320 px in the column window (KT_WINDOW_MODE=column,
 *    the only window that is 320 px wide now); the reduced-motion stills in the work-area window.
 * 2. Column mode (R31 fallback) walks the old 420 px sequence again into `column/`.
 * 3. desktop (R31..R36) companion scenarios with the default flags: launch and leave, peek and return, leave after
 *    the pointer goes away, a `webContents.sendInputEvent` smoke test, press / click, close-panel leave, drag and
 *    release at lift 250 and 600, catch mid-air, roll out, push past the right edge, question arrival while away
 *    (perch, glyph, tuck after PERCH_WAIT_MS, tray state), reduced motion, reload keeps the saved spot.
 *    Gestures are in-page PointerEvent dispatch (deterministic). Measurements go into checks.json: frame stats,
 *    rAF counts (a counting wrapper installed before load through the DevTools protocol), idle CPU per state,
 *    a 60 Hz mousemove flood, hitbox = carrier avatar rect, click-through after every scenario, console errors.
 * Strip specs are written to `companion/strips.json` and `entrance/strips.json`; scripts/screenshot.mjs composes them.
 */
import { app, ipcMain, screen, session } from 'electron';
import type { BrowserWindow, Rectangle } from 'electron';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { allowServiceCors, createCompanionWindow, handleMouseIgnore, placeBottomRight, WINDOW, windowBounds } from './window.ts';
import { COLUMN_FLAGS, DEFAULT_FLAGS, flagsToQuery, IPC } from './flags.ts';
import type { ShellState, WindowMode } from './flags.ts';
import { derivedGravity, impactSpeed, landingTier } from '../../libs/utils/motion/physics.ts';

/** KT_SHOTS_REAL=<service url>: no mock; walk the real service (scripts/real-check.mjs starts it on a spare port). */
const realUrl = process.env.KT_SHOTS_REAL?.replace(/\/+$/, '');
const outDir = process.env.KT_SHOTS_OUT ?? resolve(__dirname, '../../docs/runs/2026-11-07-overnight/screenshots' + (realUrl ? '/real' : ''));
const hidden = process.env.KT_SHOTS_HIDDEN === '1';
/** Entrance frames are captured unless KT_SHOTS_ENTRANCE=0. */
const entranceOn = process.env.KT_SHOTS_ENTRANCE !== '0';
const serviceUrl = realUrl ?? 'http://127.0.0.1:1';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
const clamp = (v: number, a: number, b: number): number => Math.max(a, Math.min(b, v));
const pad = (n: number): string => String(n).padStart(2, '0');

/** SPEC (ux-pass/SPEC.md, harness) budgets. */
const BUDGET = { frameP95Ms: 16.7, frameMaxMs: 20, idleCpuPercent: 0.3, idleRafCalls: 0 } as const;
/** Regular shots: the R28 panel area (420x680) with his body where the column window had it (width - 79). */
const CROP = { width: WINDOW.width, height: WINDOW.height, bodyFromRight: 79 } as const;
/** Strip columns: 120 CSS px around his body (240 px at 2x); floor region 168 CSS px (336 px at 2x). */
const STRIP = { half: 60, floor: 168, dropMargin: 170 } as const;
/** In-page gesture plan. */
const GESTURE = { frames: 36, dragLeftPx: 300, liftLowPx: 250, liftHighPx: 600, idleWindowMs: 3000, floodMs: 3000, floodHz: 60 } as const;
/** The SPEC leave timings (companion.ts COMPANION) and the tolerance the harness allows on them. */
const LEAVE = { afterLaunchMs: 4000, afterIdleMs: 20000, perchWaitMs: 90000, toleranceMs: 1200 } as const;

const awayOffQuery = (): Record<string, string> => flagsToQuery({ ...DEFAULT_FLAGS, away: false });
const defaultQuery = (): Record<string, string> => flagsToQuery({ ...DEFAULT_FLAGS });

interface Geom { state: string; bodyX: number; lift: number; dx: number; gap: number; w: number; h: number }
interface StateRecord { name: string; width: number; file: string; view: string; settleMs: number; hitbox: number[]; reduced: boolean; mode: WindowMode; crop: number[]; geom: Geom | null }
interface Snap { st: string | null; x: number | null; lift: number; anim: string | null; mode: string; f: number; surface: string; held: boolean; open: boolean; rp: boolean; airborne: boolean }
interface RecResult { deltas: number[]; trace: Array<Snap & { ms: number }>; ms: number; frames: number; timedOut: boolean; error?: string; end?: number[]; mid?: unknown }
interface FrameStats { frames: number; maxMs: number; meanMs: number; p95Ms: number; over20ms: number; pass?: boolean }
interface StripFrame { file: string; css: number[]; box: number[] | null }
interface StripSpec { out: string; frames: StripFrame[]; scale: number; dedupe: boolean; maxFrames: number }
interface CompanionStatusLite { state: string; bodyX: number; lift: number; away: boolean; side: string; homeFromRight: number; homeX: number; rafActive: boolean; timers: string[]; anim: string | null; question: string | null; pointerNear: boolean }

/** Counting wrapper around requestAnimationFrame, installed before the page's scripts (Page.addScriptToEvaluateOnNewDocument). */
const RAF_COUNTER = `(() => {
  if (window.__raf) return;
  const orig = window.requestAnimationFrame.bind(window);
  const c = { calls: 0, since: performance.now(), stacks: [] };
  window.__raf = {
    orig,
    reset() { c.calls = 0; c.stacks = []; c.since = performance.now(); return true; },
    read() { return { calls: c.calls, ms: Math.round(performance.now() - c.since), stacks: c.stacks.slice() }; },
  };
  window.requestAnimationFrame = function (cb) {
    c.calls++;
    if (c.stacks.length < 3) c.stacks.push(String(new Error().stack).split('\\n').slice(2, 4).map((s) => s.trim()).join(' <- '));
    return orig(cb);
  };
})(); true;`;

/** Page helpers; the harness's own frame loops use the unwrapped rAF so they never count. */
const HELPERS = `
window.__s = {
  raf: (window.__raf && window.__raf.orig) || window.requestAnimationFrame.bind(window),
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  async settle(max = 4000) {
    const t = performance.now();
    while (performance.now() - t < max) { if (__s.idle()) break; await __s.sleep(16); }
    return Math.round(performance.now() - t);
  },
  idle() { const s = __kt.panel.status(); const c = s.companion; return !s.uiMotion.active && !s.avatar.reactionPlaying && !s.avatar.airborne && !(c && c.anim); },
  click(sel) { const el = document.querySelector(sel); if (!el) throw new Error('missing ' + sel); el.click(); },
  type(text) { const f = document.querySelector('.rf-writing'); f.focus(); f.value = text; f.dispatchEvent(new Event('input', { bubbles: true })); },
  av: () => document.querySelector('.rf-avatar'),
  hit() { const r = __s.av().getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; },
  box() { const r = __s.av().getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; },
  center() { const r = __s.av().getBoundingClientRect(); const l = Math.max(r.left, 0), rt = Math.min(r.right, innerWidth); return [Math.round((l + rt) / 2), Math.round(r.top + r.height / 2)]; },
  drop() { const d = document.querySelector('.rf-drop'); const r = d.getBoundingClientRect(); return { hidden: d.hidden, rect: [r.x, r.y, r.width, r.height].map(Math.round), transform: d.style.transform }; },
  cs: () => (window.__kt && __kt.panel.companion ? __kt.panel.companion.status() : null),
  ptr(type, x, y) {
    __s.av().dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, composed: true, pointerId: 7, pointerType: 'mouse', isPrimary: true, clientX: x, clientY: y, button: type === 'pointermove' ? -1 : 0, buttons: type === 'pointerup' ? 0 : 1 }));
  },
  move(x, y) { document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: x, clientY: y })); },
  geom() {
    const r = __s.av().getBoundingClientRect(); const c = __s.cs();
    if (!c) return null;
    return { state: c.state, bodyX: c.bodyX, lift: c.lift, dx: +(r.left + r.width / 2 - c.bodyX).toFixed(2), gap: +(innerHeight - r.bottom - c.lift).toFixed(2), w: r.width, h: r.height };
  },
  shadow() { const s = document.querySelector('.rf-shadow'); if (!s) return null; const r = s.getBoundingClientRect(); return { gap: +(innerHeight - r.bottom).toFixed(2), cx: +(r.left + r.width / 2).toFixed(2), transform: s.style.transform }; },
  snap() {
    const s = __kt.panel.status(); const c = s.companion; const a = s.avatar;
    return { st: c ? c.state : null, x: c ? Math.round(c.bodyX * 10) / 10 : null, lift: c ? Math.round(c.lift) : 0, anim: c ? c.anim : null, mode: a.mode, f: a.lastFrame, surface: a.surface, held: a.held, open: s.panelOpen, rp: a.reactionPlaying, airborne: a.airborne };
  },
  async frames(fn) {
    const d = []; let last = 0, on = true;
    const loop = (t) => { if (!on) return; if (last) d.push(t - last); last = t; __s.raf(loop); };
    __s.raf(loop);
    await __s.sleep(40); fn(); await __s.sleep(30); await __s.settle(); await __s.sleep(60); on = false;
    return d;
  },
  rec(o) {
    const d = []; const trace = []; let last = 0; let key = ''; let i = 0; const t0 = performance.now(); const maxMs = o.maxMs || 6000;
    return new Promise((resolve) => {
      const loop = (t) => {
        if (last) d.push(+(t - last).toFixed(2));
        last = t;
        const ms = performance.now() - t0;
        try { if (o.drive) o.drive(i, ms); } catch (e) { resolve({ error: String(e), deltas: d, trace, ms: Math.round(ms), frames: i, timedOut: false }); return; }
        if (window.__kt) { const s = __s.snap(); const k = [s.st, s.mode, s.f, s.surface, s.open].join('|'); if (k !== key) { key = k; trace.push(Object.assign({ ms: Math.round(ms) }, s)); } }
        i++;
        const done = o.until ? !!o.until(i, ms) : false;
        if ((done && ms >= (o.minMs || 0)) || ms >= maxMs) { resolve({ deltas: d, trace, ms: Math.round(ms), frames: i, timedOut: !done }); return; }
        __s.raf(loop);
      };
      __s.raf(loop);
    });
  },
};
true;`;

// ---- harness state ----
let win: BrowserWindow | null = null;
let current: { mode: WindowMode; query: Record<string, string>; width: number } = { mode: 'area', query: {}, width: WINDOW.width };
let shotDir = outDir;
const seqs = new Map<string, number>();
const consoleErrors: string[] = [];
const notes: string[] = [];
const states: StateRecord[] = [];
const ignoreLog: Array<{ t: number; flag: boolean }> = [];
const stateLog: Array<{ t: number; state: ShellState }> = [];
const checks: Record<string, unknown> = { startedAt: new Date().toISOString(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, platform: process.platform, arch: process.arch, budgets: BUDGET };
const geomSamples: Array<{ label: string; geom: Geom | null }> = [];
const hitProbes: Array<{ label: string; point: string; x: number; y: number; expectIgnore: boolean; lastIgnore: boolean | null; pass: boolean }> = [];
const ignoreAfter: Array<{ scenario: string; beforeMove: boolean | null; afterMove: boolean | null; pass: boolean }> = [];
const frameBudget: Record<string, FrameStats> = {};
const idle: Record<string, unknown> = {};
const strips: StripSpec[] = [];
const entranceStrips: StripSpec[] = [];
const captures: Record<string, { frames: number; reachedEnd: boolean; snaps: string[] }> = {};

const w = (): BrowserWindow => {
  if (!win || win.isDestroyed()) throw new Error('no window');
  return win;
};
const size = (): { W: number; H: number } => {
  const [W = 0, H = 0] = w().getContentSize();
  return { W, H };
};
const js = <T = unknown>(code: string): Promise<T> =>
  (w().webContents.executeJavaScript(code, true) as Promise<T>).catch((e: unknown) => {
    throw new Error(`script failed: ${code.slice(0, 160)} -> ${String(e)} ; console errors so far: ${consoleErrors.join(' | ')}`);
  });
const waitFor = async (cond: string, ms = 8000): Promise<number> => {
  const t = Date.now();
  while (Date.now() - t < ms) {
    if (await js<boolean>(`!!(${cond})`).catch(() => false)) return Date.now() - t;
    await sleep(30);
  }
  const status = await js('JSON.stringify(window.__s && __s.cs ? __s.cs() : null)').catch(() => null);
  throw new Error(`timeout waiting for ${cond}; companion: ${String(status)}`);
};
const lastIgnore = (): boolean | null => ignoreLog.at(-1)?.flag ?? null;
const cs = (): Promise<CompanionStatusLite> => js<CompanionStatusLite>('__s.cs()');
const command = (c: string): Promise<unknown> => js(`__kt.panel.companion.command(${JSON.stringify(c)})`);

const frameStats = (d: number[]): FrameStats => {
  if (!d.length) return { frames: 0, maxMs: 0, meanMs: 0, p95Ms: 0, over20ms: 0, pass: false };
  const s = [...d].sort((a, b) => a - b);
  const p95 = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] ?? 0;
  const max = Math.max(...d);
  return { frames: d.length, maxMs: +max.toFixed(1), meanMs: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(2), p95Ms: +p95.toFixed(1), over20ms: d.filter((x) => x > 20).length, pass: p95 <= BUDGET.frameP95Ms && max <= BUDGET.frameMaxMs };
};

// ---- window and load ----
async function injectRafCounter(): Promise<boolean> {
  const dbg = w().webContents.debugger;
  try {
    if (!dbg.isAttached()) dbg.attach('1.3');
    await dbg.sendCommand('Page.enable');
    await dbg.sendCommand('Page.addScriptToEvaluateOnNewDocument', { source: RAF_COUNTER });
    return true;
  } catch (e) {
    notes.push('debugger unavailable, rAF counter installed after load: ' + String(e));
    return false;
  }
}

/**
 * Park the pointer far from him: an injected input event (Chromium's last known mouse position, which it reuses
 * for the synthetic mousemoves it sends after layout changes) and the same point as an in-page mousemove.
 */
async function park(): Promise<void> {
  const x = Math.round(size().W * 0.3);
  w().webContents.sendInputEvent({ type: 'mouseMove', x, y: 120 });
  await js(`__s.move(${x}, 120)`);
}

/** Reload (or load with a new query) with the rAF counter in place before the page's scripts. */
async function load(query?: Record<string, string>): Promise<void> {
  const wc = w().webContents;
  if (current.mode === 'column') placeBottomRight(w(), current.width);
  // Reloading while the first load is still in flight aborts it (ERR_ABORTED, -3): let it finish first.
  if (wc.isLoading()) await new Promise<void>((r) => wc.once('did-stop-loading', () => r()));
  const injected = await injectRafCounter();
  if (query) current.query = query;
  await new Promise<void>((r) => {
    wc.once('did-finish-load', () => r());
    if (query) w().loadFile(join(__dirname, 'index.html'), { query }).catch(() => undefined);
    else wc.reload();
  });
  await waitFor('document.readyState === "complete" && !!document.querySelector(".rf-avatar")');
  if (injected) {
    try {
      wc.debugger.detach();
    } catch {
      /* already detached */
    }
  }
  if (!(await js<boolean>('!!window.__raf'))) await js(RAF_COUNTER);
  await js(HELPERS);
  // The harness owns the pointer: park it far from him (the launch leave needs the pointer out of his zone).
  await park();
  if (current.query.shots === '1') await waitFor('!!window.__kt');
  await sleep(100);
}

async function openWindow(mode: WindowMode, query: Record<string, string>, width: number = WINDOW.width): Promise<void> {
  const old = win;
  const next = createCompanionWindow({ serviceUrl, query, show: false, mode, width });
  win = next;
  current = { mode, query, width };
  if (old && !old.isDestroyed()) old.destroy();
  next.webContents.on('console-message', (event) => {
    const e = event as unknown as { level?: string | number; message?: string };
    const level = String(e.level);
    if (level === 'error' || level === '3') consoleErrors.push(String(e.message));
  });
  next.webContents.on('render-process-gone', (_e, d) => consoleErrors.push('render-process-gone: ' + d.reason));
  next.webContents.on('did-fail-load', (_e, code, desc) => consoleErrors.push(`did-fail-load ${code} ${desc}`));
  if (process.env.KT_SHOTS_FORWARD !== '1') {
    next.setIgnoreMouseEvents(true);
    // window.ts re-applies forward: true on blur (click-through safety); keep the isolation.
    next.on('blur', () => { if (!next.isDestroyed()) next.setIgnoreMouseEvents(true); });
  }
  if (!hidden) next.showInactive();
  else next.webContents.setBackgroundThrottling(false);
  await load();
}

const collectPageErrors = async (): Promise<void> => {
  const page = await js<string[]>('window.__kt ? __kt.errors.splice(0) : []');
  consoleErrors.push(...page.map((e) => 'page: ' + e));
};

// ---- shots ----
async function panelArea(): Promise<Rectangle> {
  const { W, H } = size();
  const height = Math.min(H, CROP.height);
  if (current.mode === 'column') return { x: 0, y: H - height, width: W, height };
  const c = await js<{ bodyX: number } | null>('__s.cs()');
  const bodyX = c?.bodyX ?? W - CROP.bodyFromRight;
  return { x: clamp(Math.round(bodyX + CROP.bodyFromRight - CROP.width), 0, W - CROP.width), y: H - height, width: CROP.width, height };
}
async function shot(name: string, width: number, settleMs: number): Promise<void> {
  await sleep(80);
  const rect = await panelArea();
  const image = await w().webContents.capturePage(rect);
  const n = (seqs.get(shotDir) ?? 0) + 1;
  seqs.set(shotDir, n);
  const file = `${pad(n)}-${name}-${width}.png`;
  writeFileSync(join(shotDir, file), image.toPNG());
  const st = await js<{ view: string; reduced: boolean; geom: Geom | null }>('({ view: __kt.panel.status().view, reduced: __kt.panel.status().reduced, geom: __s.geom() })');
  if (st.geom) geomSamples.push({ label: `shot ${file}`, geom: st.geom });
  states.push({ name, width, file: relative(outDir, join(shotDir, file)), view: st.view, settleMs, hitbox: await js<number[]>('__s.hit()'), reduced: st.reduced, mode: current.mode, crop: [rect.x, rect.y, rect.width, rect.height], geom: st.geom });
}
const act = async (code: string): Promise<number> => {
  const t = Date.now();
  await js(code);
  await js('__s.sleep(20)');
  await js('__s.settle()');
  return Date.now() - t;
};
const step = async (name: string, width: number, code: string): Promise<void> => shot(name, width, await act(code));

/** Capture the launch entrance: full window height, the 420 (or column) wide area around his home spot. */
async function captureEntrance(width: number): Promise<void> {
  if (!entranceOn || shotDir !== outDir) return;
  const dir = join(outDir, 'entrance');
  const { W, H } = size();
  const rect: Rectangle = current.mode === 'column' ? { x: 0, y: 0, width: W, height: H } : { x: W - CROP.width, y: 0, width: CROP.width, height: H };
  const t0 = Date.now();
  const frames: Array<{ file: string; atMs: number; mode: string; frame: number; falling: boolean; dropY: number; hitbox: number[]; drop: { hidden: boolean; rect: number[]; transform: string } }> = [];
  for (let i = 0; i < 20; i++) {
    const image = await w().webContents.capturePage(rect);
    const st = await js<{ avatar: { mode: string; lastFrame: number; falling: boolean; dropY: number } }>('__kt.panel.status()');
    const file = `entrance-${pad(i)}-${width}.png`;
    writeFileSync(join(dir, file), image.toPNG());
    frames.push({ file, atMs: Date.now() - t0, mode: st.avatar.mode, frame: st.avatar.lastFrame, falling: st.avatar.falling, dropY: Math.round(st.avatar.dropY), hitbox: await js<number[]>('__s.hit()'), drop: await js<{ hidden: boolean; rect: number[]; transform: string }>('__s.drop()') });
    await sleep(110);
  }
  checks[`entrance_${width}`] = { windowMode: current.mode, windowHeight: H, crop: [rect.x, rect.y, rect.width, rect.height], frames };
  if (width !== 420) return;
  // Strips (composed by scripts/screenshot.mjs): the 120 px column around his body, full height at half scale
  // for the fall; the floor region at full scale for the landing.
  const bx = W - CROP.bodyFromRight - rect.x;
  const visible = frames.findIndex((f) => f.falling && (f.drop.rect[1] ?? -1) + (f.drop.rect[3] ?? 0) > 0);
  const i0 = Math.max(0, Math.min(visible < 0 ? 0 : visible, frames.length - 16));
  entranceStrips.push({ out: 'entrance-strip.png', scale: 0.5, dedupe: false, maxFrames: 16, frames: frames.slice(i0, i0 + 16).map((f) => ({ file: f.file, css: [rect.width, rect.height], box: [bx - STRIP.half, 0, bx + STRIP.half, rect.height] })) });
  const firstLanded = frames.findIndex((f, i) => i > 0 && !f.falling && (frames[i - 1]?.falling ?? false));
  const l0 = Math.max(0, (firstLanded < 0 ? frames.length - 11 : firstLanded - 1));
  entranceStrips.push({ out: 'landing-strip.png', scale: 1, dedupe: false, maxFrames: 11, frames: frames.slice(l0, l0 + 11).map((f) => ({ file: f.file, css: [rect.width, rect.height], box: [bx - STRIP.half, rect.height - STRIP.floor, bx + STRIP.half, rect.height] })) });
}

/** The old 19-state walk (R28 framing). The caller opened / loaded the window. */
async function walk(width: number): Promise<Record<string, unknown>> {
  const result: Record<string, unknown> = { windowMode: current.mode, bounds: w().getBounds(), expectedBounds: windowBounds(current.mode, width) };
  await captureEntrance(width);
  await js('__s.settle(4000)');
  await sleep(2600); // entrance: 0.9 s fall + 19 authored frames at 16 fps (1.2 s) plus margin
  await shot('collapsed', width, 0);
  const base = await js<number[]>('__s.hit()');
  const first = states.length - 1;
  if (width === 420 && current.mode === 'area' && shotDir === outDir) {
    // idle CPU: panel collapsed, nothing animating (companion on, away off)
    app.getAppMetrics();
    await sleep(3000);
    const metrics = app.getAppMetrics();
    checks.idleCpu = {
      windowSeconds: 3, state: 'collapsed, idle poses only (work-area window, companion on, away=0)',
      totalPercent: +metrics.reduce((a, m) => a + m.cpu.percentCPUUsage, 0).toFixed(2),
      perProcess: metrics.map((m) => ({ type: m.type, name: m.name, percent: +m.cpu.percentCPUUsage.toFixed(2) })),
      avatarStatus: await js('__kt.panel.status().avatar'),
    };
  }
  result.openFrames = frameStats(await js<number[]>('__s.frames(() => __s.click(".rf-avatar"))'));
  await shot('input', width, 0);
  await act('__s.type("The line 3 label printer prints blank labels since the ribbon swap. Head temperature looks normal."); __kt.panel.attachFiles([new File(["x"], "printer-display.png"), new File(["x"], "ribbon-change-log.txt")])');
  await shot('draft-attachments', width, 0);
  result.avatarModeRightAfterSend = await js<string>('(() => { __s.click(".rf-send"); return __kt.panel.status().avatar.mode; })()');
  await waitFor('__kt.panel.status().view === "result"');
  await step('result', width, '0');
  await step('result-node-expanded', width, '__s.click(".rf-case-path .rf-node-title[data-node=hypothesis]")');
  await step('people', width, '__s.click("[data-action=people]")');
  await step('contact-draft', width, '__s.click("[data-action=prepare][data-person=\\"person:mock:noor\\"]")');
  await step('people-back', width, '__s.click(".rf-view[data-view=contact] [data-action=back]")');
  await step('case-from-people', width, '__s.click("[data-action=view-case]")');
  await act('__s.click(".rf-view[data-view=case] [data-action=back]"); __s.click(".rf-view[data-view=people] [data-action=back]")');
  await step('result-question-card', width, '__s.click(".rf-footer [data-action=queue]"); __s.click(".rf-question-item")');
  await step('question-context', width, '__s.click("[data-action=context]")');
  await step('question-context-node', width, '__s.click(".rf-reveal .rf-node-title[data-node=attempt]")');
  await step('queue', width, '__s.click(".rf-view[data-view=question] [data-action=queue]")');
  await step('settings', width, '__s.click(".rf-footer [data-action=settings]")');
  await act('__s.click(".rf-points"); __s.click(".rf-view[data-view=settings] [data-action=input]")');
  await act('__s.click(".rf-footer [data-action=queue]"); __s.click(".rf-question-item")');
  await js('__s.click("[data-action=yes]")');
  await waitFor('__kt.panel.status().view === "receipt"');
  await sleep(140); // mid-burst (8 frames at 15 fps)
  await shot('receipt-points-burst', width, 0);
  await step('receipt-undo', width, '0');
  await step('undo-returns-to-question', width, '__s.click("[data-action=receipt-action]")');
  // error state
  await act('__kt.setFailing(true); __s.click(".rf-footer [data-action=attach]")');
  await act('__s.type("second report"); __s.click(".rf-send")');
  await waitFor('__kt.panel.status().view === "receipt"');
  await act('0');
  await shot('error-unreachable', width, 0);
  await act('__kt.setFailing(false); __s.click("[data-action=receipt-action]")');
  await waitFor('__kt.panel.status().view === "result"');
  result.closeFrames = frameStats(await js<number[]>('__s.frames(() => __s.click(".rf-avatar"))'));
  await shot('closed-again', width, 0);
  const final = await js<number[]>('__s.hit()');
  const mine = states.slice(first);
  result.hitbox = { initial: base, final, allStatesEqual: mine.every((s) => s.hitbox.every((v, i) => v === base[i])) };
  result.companion = await js('__s.cs()');
  result.ktCompanionAttr = await js<string | null>('document.getElementById("kt-panel").dataset.ktCompanion ?? null');
  await collectPageErrors();
  return result;
}

// ---- companion measurements ----
async function measureIdle(label: string): Promise<Record<string, unknown>> {
  await js('__raf.reset()');
  app.getAppMetrics();
  await sleep(GESTURE.idleWindowMs);
  const metrics = app.getAppMetrics();
  const raf = await js<{ calls: number; ms: number; stacks: string[] }>('__raf.read()');
  const c = await cs();
  const total = +metrics.reduce((a, m) => a + m.cpu.percentCPUUsage, 0).toFixed(2);
  const renderer = +metrics.filter((m) => m.type === 'Tab').reduce((a, m) => a + m.cpu.percentCPUUsage, 0).toFixed(2);
  const r = {
    label, windowSeconds: GESTURE.idleWindowMs / 1000, state: c.state, timers: c.timers, companionRaf: c.rafActive,
    avatar: await js('(() => { const a = __kt.panel.status().avatar; return { mode: a.mode, held: a.held, idleLoop: a.idleLoop, reactionPlaying: a.reactionPlaying, questionCue: a.questionCue }; })()'),
    totalCpuPercent: total, rendererCpuPercent: renderer,
    perProcess: metrics.map((m) => ({ type: m.type, name: m.name, percent: +m.cpu.percentCPUUsage.toFixed(2) })),
    rafCalls: raf.calls, rafWindowMs: raf.ms, rafStacks: raf.stacks,
    pass: { cpu: total <= BUDGET.idleCpuPercent, raf: raf.calls <= BUDGET.idleRafCalls },
  };
  idle[label] = r;
  return r;
}

const sampleGeom = async (label: string): Promise<Geom | null> => {
  const g = await js<Geom | null>('__s.geom()');
  geomSamples.push({ label, geom: g });
  return g;
};

/** Hit-test probes through the real renderer path: a mousemove at a point, then the last kt:ignore-mouse value. */
async function probe(label: string, opts: { outside?: boolean } = {}): Promise<void> {
  const { W, H } = size();
  const b = await js<{ l: number; t: number; r: number; b: number }>('__s.box()');
  const [cx = 0, cy = 0] = await js<number[]>('__s.center()');
  const points: Array<[string, number, number, boolean]> = [['center', cx, cy, false]];
  if (b.b + 2 < H) points.push(['below', cx, Math.round(b.b + 2), true]);
  if (opts.outside) {
    if (b.l - 2 >= 0) points.push(['left', Math.round(b.l - 2), cy, true]);
    if (b.r + 2 < W) points.push(['right', Math.round(b.r + 2), cy, true]);
    points.push(['above', cx, Math.round(b.t - 2), true]);
  }
  for (const [point, x, y, expectIgnore] of points) {
    await js(`__s.move(${x}, ${y})`);
    await sleep(45);
    const v = lastIgnore();
    hitProbes.push({ label, point, x, y, expectIgnore, lastIgnore: v, pass: v === expectIgnore });
  }
}

/** After every scenario the window must ignore the mouse once the pointer is off him and the panel. */
async function endScenario(name: string): Promise<void> {
  await sleep(60);
  const beforeMove = lastIgnore();
  await park();
  await sleep(80);
  const afterMove = lastIgnore();
  ignoreAfter.push({ scenario: name, beforeMove, afterMove, pass: afterMove === true });
  await collectPageErrors();
}

const waitIn = async (ms = 8000): Promise<void> => {
  await waitFor('__s.cs() && __s.cs().state === "in" && __s.idle()', ms);
};
const tierOf = (trace: Array<Snap & { ms: number }>): string => {
  if (trace.some((t) => t.mode === 'entrance')) return 'entrance';
  if (trace.some((t) => t.mode === 'hop')) return 'hop';
  if (trace.some((t) => t.mode.startsWith('land:settle') || t.mode === 'pose:settle')) return 'settle';
  return 'unknown';
};
const modesOf = (trace: Array<Snap & { ms: number }>): string[] => {
  const out: string[] = [];
  for (const t of trace) {
    const k = `${t.st}:${t.mode}`;
    if (out.at(-1) !== k) out.push(k);
  }
  return out;
};
const framesOf = (trace: Array<Snap & { ms: number }>, mode: string): number[] => {
  const f = trace.filter((t) => t.mode === mode).map((t) => t.f);
  return f.length ? [Math.min(...f), Math.max(...f)] : [];
};

/** In-page drag from his centre by (dx, dy) over GESTURE.frames frames; no release. */
const dragCode = (dx: number, dy: number, n: number = GESTURE.frames, mid = true): string => `(() => {
  const [x0, y0] = __s.center(); window.__mid = null;
  return __s.rec({
    drive: (i) => {
      if (i === 0) __s.ptr('pointerdown', x0, y0);
      else if (i <= ${n}) __s.ptr('pointermove', Math.round(x0 + ${dx} * i / ${n}), Math.round(y0 + ${dy} * i / ${n}));
      if (${mid} && i === ${n >> 1}) window.__mid = { geom: __s.geom(), shadow: __s.shadow(), avatar: (({ mode, surface, carried, lift }) => ({ mode, surface, carried, lift }))(__kt.panel.status().avatar) };
    },
    until: (i) => i > ${n},
    maxMs: 4000,
  }).then((r) => Object.assign(r, { end: [Math.round(x0 + ${dx}), Math.round(y0 + ${dy})], mid: window.__mid }));
})()`;
const releaseCode = (x: number, y: number): string =>
  `__s.rec({ drive: (i) => { if (i === 0) __s.ptr('pointerup', ${x}, ${y}); }, until: (i) => i > 2 && __s.cs().state === 'in' && __s.idle(), maxMs: 5000 })`;

/** Capture frames of a running scenario (frame 0 before `start`), each cropped to the strip column around his body. */
async function captureLoop(name: string, o: { start?: string; until: string; region: (s: Snap) => Rectangle; max?: number; gapMs?: number; tail?: number }): Promise<StripFrame[]> {
  const dir = join(outDir, 'companion', 'frames');
  const frames: StripFrame[] = [];
  let started = !o.start;
  let tail = -1;
  const snaps: string[] = [];
  for (let i = 0; i < (o.max ?? 40); i++) {
    const snap = await js<Snap>('__s.snap()');
    snaps.push(`${snap.st}:${snap.mode}:${snap.f}`);
    const rect = o.region(snap);
    const image = await w().webContents.capturePage(rect);
    const file = `${name}-${pad(i)}.png`;
    writeFileSync(join(dir, file), image.toPNG());
    frames.push({ file: 'frames/' + file, css: [rect.width, rect.height], box: null });
    if (!started && o.start) {
      await js(o.start);
      started = true;
    } else if (tail < 0 && (await js<boolean>(`!!(${o.until})`))) tail = o.tail ?? 1;
    if (tail === 0) break;
    if (tail > 0) tail--;
    await sleep(o.gapMs ?? 40);
  }
  captures[name] = { frames: frames.length, reachedEnd: tail >= 0, snaps };
  return frames;
}
const grab = async (name: string, i: number, rect: Rectangle): Promise<StripFrame> => {
  const file = `${name}-${pad(i)}.png`;
  writeFileSync(join(outDir, 'companion', 'frames', file), (await w().webContents.capturePage(rect)).toPNG());
  return { file: 'frames/' + file, css: [rect.width, rect.height], box: null };
};
const column = (bodyX: number | null, top: number, height: number): Rectangle => {
  const { W } = size();
  const x = clamp(Math.round((bodyX ?? W - CROP.bodyFromRight) - STRIP.half), 0, W - 2 * STRIP.half);
  return { x, y: Math.max(0, Math.round(top)), width: 2 * STRIP.half, height: Math.round(height) };
};
const floorRegion = (s: Snap): Rectangle => {
  const { H } = size();
  return column(s.x, H - STRIP.floor, STRIP.floor);
};
const dropRegion = (lift: number) => (s: Snap): Rectangle => {
  const { H } = size();
  const h = Math.min(H, lift + STRIP.dropMargin);
  return column(s.x, H - h, h);
};
/** A crop of the 420x680 panel area around him (still shots of companion states). */
async function still(name: string): Promise<string> {
  const rect = await panelArea();
  const file = `${name}.png`;
  writeFileSync(join(outDir, 'companion', file), (await w().webContents.capturePage(rect)).toPNG());
  return 'companion/' + file;
}

/** Bring him in with the pointer far away, whatever state a failed step left behind. */
async function recover(): Promise<void> {
  const { W } = size();
  await js(`(() => { const c = __s.cs(); if (c && ['pressed', 'carried'].includes(c.state)) __s.ptr('pointercancel', 0, 0); if (__kt.panel.status().panelOpen) __kt.panel.close(); __s.move(${Math.round(W * 0.3)}, 120); })()`).catch(() => undefined);
  await park().catch(() => undefined);
  await sleep(200);
  const c = await cs().catch(() => null);
  if (c && c.state !== 'in') await command('return').catch(() => undefined);
  await waitIn(8000).catch(() => undefined);
}

/** Run one scenario; a failure is recorded with the companion status and the run goes on from a known state. */
async function scenario(name: string, sc: Record<string, unknown>, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    const status = await js('({ companion: __s.cs(), avatar: __kt.panel.status().avatar, open: __kt.panel.status().panelOpen })').catch(() => null);
    sc[`error:${name}`] = { error: String(e).slice(0, 600), status, pass: false };
    console.error(`[shots] scenario ${name} failed: ${String(e).slice(0, 300)}`);
    await recover();
  }
}

/** The SPEC companion scenarios (work-area window, default flags, mock). */
async function companionRun(): Promise<Record<string, unknown>> {
  const sc: Record<string, unknown> = {};
  await openWindow('area', { mock: '1', shots: '1', ...defaultQuery() });
  const { W, H } = size();
  const far = { x: Math.round(W * 0.3), y: 120 };
  const zone = { x: W - 150, y: H - 50 };
  const g = derivedGravity(H);
  sc.window = { bounds: w().getBounds(), workArea: windowBounds('area'), boundsEqualWorkArea: JSON.stringify(w().getBounds()) === JSON.stringify(windowBounds('area')), contentSize: [W, H], derivedGravityPxS2: Math.round(g) };

  // -- launch: fall, hello, "in", leave after LEAVE_AFTER_LAUNCH_MS to the nearer edge
  await scenario('launch', sc, async () => {
  const tLaunch = Date.now();
  await waitFor('__s.cs() && __s.cs().state === "in"', 10000);
  const tIn = Date.now();
  await sampleGeom('in after launch');
  await waitFor('__s.cs().state === "leaving"', LEAVE.afterLaunchMs + 4000);
  const tLeaving = Date.now();
  await waitFor('__s.cs().state === "away"', 5000);
  const away = await cs();
  sc.launch = { launchToInMs: tIn - tLaunch, inToLeavingMs: tLeaving - tIn, side: away.side, bodyX: away.bodyX, expectedSliverX: W + 28 - 12, pass: Math.abs(tLeaving - tIn - LEAVE.afterLaunchMs) <= LEAVE.toleranceMs && away.side === 'right' };
  await sleep(300);
  await sampleGeom('away (sliver)');
  await measureIdle('away');
  await still('away-sliver');
  await endScenario('launch-and-leave');
  });

  // -- proximity peek: pointer into the zone, dwell, return + hello (measured)
  await scenario('peek', sc, async () => {
    await js(`__s.move(${far.x}, ${far.y})`);
    const r = await js<RecResult>(`__s.rec({ drive: (i) => { if (i === 0) __s.move(${zone.x}, ${zone.y}); }, until: (i) => i > 2 && __s.cs().state === 'in' && __s.idle(), maxMs: 6000 })`);
    frameBudget.peek = frameStats(r.deltas);
    const seq = modesOf(r.trace);
    sc.peek = { ms: r.ms, timedOut: r.timedOut, states: [...new Set(r.trace.map((t) => t.st))], sequence: seq, hello: r.trace.some((t) => t.mode === 'hello'), pass: !r.timedOut && r.trace.some((t) => t.st === 'peeking') && r.trace.some((t) => t.mode === 'hello') };
    await sampleGeom('in after peek-return');
    await probe('in (pointer near)', { outside: true });
    await endScenario('peek-return');
  });

  // -- in, pointer far: idle CPU / rAF, 60 Hz mousemove flood, then leave after LEAVE_AFTER_IDLE_MS
  await scenario('leave-after-pointer', sc, async () => {
    const tFar = Date.now(); // endScenario moved the pointer far: the idle timer restarted
    await waitFor('__s.idle()', 4000);
    await measureIdle('in');
    // 60 Hz mousemove flood far from him, through the real input path
    await js('__raf.reset()');
    app.getAppMetrics();
    let sent = 0;
    const t0 = Date.now();
    await new Promise<void>((done) => {
      const id = setInterval(() => {
        if (Date.now() - t0 >= GESTURE.floodMs) {
          clearInterval(id);
          done();
          return;
        }
        w().webContents.sendInputEvent({ type: 'mouseMove', x: far.x + (sent % 40), y: far.y + (sent % 25) });
        sent++;
      }, 1000 / GESTURE.floodHz);
    });
    const m = app.getAppMetrics();
    const raf = await js<{ calls: number }>('__raf.read()');
    idle.flood = {
      events: sent, seconds: GESTURE.floodMs / 1000, state: (await cs()).state,
      rendererCpuPercent: +m.filter((x) => x.type === 'Tab').reduce((a, x) => a + x.cpu.percentCPUUsage, 0).toFixed(2),
      totalCpuPercent: +m.reduce((a, x) => a + x.cpu.percentCPUUsage, 0).toFixed(2),
      perProcess: m.map((x) => ({ type: x.type, name: x.name, percent: +x.cpu.percentCPUUsage.toFixed(2) })),
      rafCalls: raf.calls, lastIgnore: lastIgnore(),
    };
    await waitFor('__s.cs().state === "leaving"', LEAVE.afterIdleMs + 6000);
    const tLeave = Date.now();
    await waitFor('__s.cs().state === "away"', 5000);
    sc.leaveAfterPointer = { pointerAwayToLeavingMs: tLeave - tFar, expectedMs: LEAVE.afterIdleMs, pass: Math.abs(tLeave - tFar - LEAVE.afterIdleMs) <= LEAVE.toleranceMs };
    await endScenario('leave-after-pointer');
  });

  // -- webContents.sendInputEvent smoke test (real input path, click-through)
  await scenario('sendInputEvent-smoke', sc, async () => {
    await command('return');
    await waitIn();
    const [x, y] = await js<number[]>('__s.center()');
    const wc = w().webContents;
    wc.sendInputEvent({ type: 'mouseMove', x: x!, y: y! });
    await sleep(80);
    const overHim = lastIgnore();
    wc.sendInputEvent({ type: 'mouseDown', x: x!, y: y!, button: 'left', clickCount: 1 });
    await sleep(30);
    const pressedMode = await js<string>('__kt.panel.status().avatar.mode');
    wc.sendInputEvent({ type: 'mouseUp', x: x!, y: y!, button: 'left', clickCount: 1 });
    await sleep(350);
    const opened = await js<boolean>('__kt.panel.status().panelOpen');
    await js('__s.settle()');
    const [x2, y2] = await js<number[]>('__s.center()');
    wc.sendInputEvent({ type: 'mouseMove', x: x2!, y: y2! });
    wc.sendInputEvent({ type: 'mouseDown', x: x2!, y: y2!, button: 'left', clickCount: 1 });
    await sleep(30);
    wc.sendInputEvent({ type: 'mouseUp', x: x2!, y: y2!, button: 'left', clickCount: 1 });
    await sleep(350);
    const closed = !(await js<boolean>('__kt.panel.status().panelOpen'));
    await js('__s.settle()');
    wc.sendInputEvent({ type: 'mouseMove', x: far.x, y: far.y });
    await sleep(120);
    const afterFar = lastIgnore();
    sc.sendInputEventSmoke = { overHimIgnore: overHim, pressedMode, opened, closedAgain: closed, ignoreAfterMovingAway: afterFar, pass: overHim === false && opened && closed && afterFar === true };
    await endScenario('sendInputEvent-smoke');
  });

  // -- press (pose on the next paint) and click (tap + toggle, native click suppressed); close-panel leave
  await scenario('press-click', sc, async () => {
    await waitIn();
    const press = await js<{ mode: string; frame: number; st: string; nextPaintMs: number; xy: number[] }>(`(() => {
      const [x, y] = __s.center(); __s.ptr('pointerdown', x, y);
      const a = __kt.panel.status().avatar; const st = __s.cs().state; const t = performance.now();
      return new Promise((r) => __s.raf(() => r({ mode: a.mode, frame: a.lastFrame, st, nextPaintMs: +(performance.now() - t).toFixed(2), xy: [x, y] })));
    })()`);
    await still('press');
    const [px = 0, py = 0] = press.xy;
    const click = await js<{ open: boolean; mode: string; frame: number; st: string }>(`(() => { __s.ptr('pointerup', ${px}, ${py}); const s = __kt.panel.status(); return { open: s.panelOpen, mode: s.avatar.mode, frame: s.avatar.lastFrame, st: __s.cs().state }; })()`);
    // The native click that follows a real release must not toggle a second time.
    await js(`__s.av().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, clientX: ${px}, clientY: ${py} }))`);
    await sleep(120);
    const stillOpen = await js<boolean>('__kt.panel.status().panelOpen');
    await js('__s.settle()');
    await sleep(200);
    await still('click-open');
    await sampleGeom('in, panel open');
    await probe('in, panel open');
    sc.press = { ...press, pass: press.mode === 'pose:press' && press.frame === 1 && press.st === 'pressed' && press.nextPaintMs <= BUDGET.frameP95Ms };
    sc.click = { ...click, nativeClickSuppressed: stillOpen, pass: click.open && (click.mode === 'click' || click.mode === 'hop') && stillOpen };
    // close-panel leave: pointer away first (panel open keeps him in), then close; the idle timer starts on close
    await js(`__s.move(${far.x}, ${far.y})`);
    await sleep(100);
    const [cx = 0, cy = 0] = await js<number[]>('__s.center()');
    await js(`(() => { __s.ptr('pointerdown', ${cx}, ${cy}); __s.ptr('pointerup', ${cx}, ${cy}); })()`);
    const tClose = Date.now();
    const closedNow = !(await js<boolean>('__kt.panel.status().panelOpen'));
    await endScenario('press-click');
    await waitFor('__s.cs().state === "leaving"', LEAVE.afterIdleMs + 6000);
    const tLeave = Date.now();
    await waitFor('__s.cs().state === "away"', 5000);
    sc.closePanelLeave = { closed: closedNow, closeToLeavingMs: tLeave - tClose, expectedMs: LEAVE.afterIdleMs, pass: closedNow && Math.abs(tLeave - tClose - LEAVE.afterIdleMs) <= LEAVE.toleranceMs };
    await endScenario('close-panel-leave');
  });

  // -- drag 300 px left and release at lift 250 (carried pose, shadow on the floor, fall, hop tier)
  await recover();
  const shadowRest = await js<{ gap: number; cx: number; transform: string } | null>('__s.shadow()');
  const dropScenario = async (label: string, dx: number, lift: number): Promise<Record<string, unknown>> => {
    await waitIn();
    const before = await cs();
    const d = await js<RecResult>(dragCode(dx, -lift));
    const carried = await cs();
    await sampleGeom(`${label}: carried at lift ${Math.round(carried.lift)}`);
    const [ex = 0, ey = 0] = d.end ?? [];
    const f = await js<RecResult>(releaseCode(ex, ey));
    const after = await cs();
    await sampleGeom(`${label}: landed`);
    const expectedTier = landingTier(impactSpeed(carried.lift, g));
    const mid = d.mid as { geom: Geom | null; shadow: { gap: number; cx: number; transform: string } | null; avatar: { mode: string; surface: string; carried: boolean; lift: number } } | null;
    const tier = tierOf(f.trace);
    const r = {
      dragFrames: frameStats(d.deltas), fallFrames: frameStats(f.deltas), fallMs: f.ms, timedOut: f.timedOut,
      bodyXBefore: before.bodyX, liftAtRelease: carried.lift, stateWhileCarried: carried.state, mid,
      shadowOnFloor: !!mid?.shadow && !!shadowRest && Math.abs(mid.shadow.gap - shadowRest.gap) <= 0.5,
      shadowRest,
      carriedPose: mid?.avatar.mode === 'pose:carried' && mid.avatar.surface === 'drop',
      impactSpeedPxS: Math.round(impactSpeed(carried.lift, g)), expectedTier, tier,
      landingFrames: { hop: framesOf(f.trace, 'hop'), entrance: framesOf(f.trace, 'entrance') },
      sequence: modesOf(f.trace),
      after: { state: after.state, bodyX: after.bodyX, homeFromRight: after.homeFromRight, homeX: after.homeX },
    };
    return { ...r, pass: !f.timedOut && carried.state === 'carried' && r.shadowOnFloor && r.carriedPose && tier === expectedTier && after.state === 'in' && Math.abs(after.bodyX - (before.bodyX + dx)) <= 1 };
  };
  await scenario('drag-release', sc, async () => {
    const low = await dropScenario('drag-left-250', -GESTURE.dragLeftPx, GESTURE.liftLowPx);
    frameBudget.drag = low.dragFrames as FrameStats;
    frameBudget.fall = low.fallFrames as FrameStats;
    sc.dragRelease250 = { ...low, expectedHomeFromRight: CROP.bodyFromRight + GESTURE.dragLeftPx, homeSaved: Math.abs(((low.after as { homeFromRight: number }).homeFromRight) - (CROP.bodyFromRight + GESTURE.dragLeftPx)) <= 1 };
    await endScenario('drag-release-250');
    const high = await dropScenario('drag-up-600', 0, GESTURE.liftHighPx);
    frameBudget.fallHigh = high.fallFrames as FrameStats;
    sc.dragRelease600 = high;
    await endScenario('drag-release-600');
  });

  // -- catch mid-air
  await scenario('catch-mid-air', sc, async () => {
    await waitIn();
    const d = await js<RecResult>(dragCode(0, -GESTURE.liftHighPx, 24, false));
    const [ex = 0, ey = 0] = d.end ?? [];
    await js(`__s.ptr('pointerup', ${ex}, ${ey})`);
    await waitFor('__s.cs().state === "airborne" && __s.cs().lift < 520', 2000);
    const caught = await js<{ st: string; lift: number; liftBefore: number; xy: number[] }>(`(() => { const liftBefore = __s.cs().lift; const [x, y] = __s.center(); __s.ptr('pointerdown', x, y); const c = __s.cs(); return { st: c.state, lift: c.lift, liftBefore, xy: [x, y] }; })()`);
    const [cx = 0, cy = 0] = caught.xy;
    // carry him down to about 20 px and let go: the settle tier
    const yLow = Math.round(cy + caught.lift - 20);
    await js(`(() => { for (let i = 1; i <= 8; i++) __s.ptr('pointermove', ${cx}, Math.round(${cy} + (${yLow} - ${cy}) * i / 8)); })()`);
    const lowLift = (await cs()).lift;
    const f = await js<RecResult>(releaseCode(cx, yLow));
    sc.catchMidAir = { caughtState: caught.st, liftWhenCaught: Math.round(caught.lift), liftBefore: Math.round(caught.liftBefore), releasedAtLift: Math.round(lowLift), tier: tierOf(f.trace), expectedTier: landingTier(impactSpeed(lowLift, g)), sequence: modesOf(f.trace), final: (await cs()).state, pass: caught.st === 'carried' && caught.lift > 0 && !f.timedOut };
    await endScenario('catch-mid-air');
  });

  // -- strips: drag + release plop at 250, and the high drop at 600 (from the default spot)
  await scenario('strips-drops', sc, async () => {
    await command('reset-position');
    await waitIn();
    const rest = await js<Snap>('__s.snap()');
    const region = dropRegion(GESTURE.liftLowPx);
    const frames: StripFrame[] = [await grab('drag', 0, region(rest))];
    const [x0 = 0, y0 = 0] = await js<number[]>('__s.center()');
    await js(`__s.ptr('pointerdown', ${x0}, ${y0})`);
    frames.push(await grab('drag', 1, region(await js<Snap>('__s.snap()'))));
    const n = GESTURE.frames;
    for (let k = 1; k <= 4; k++) {
      await js(`(() => { for (let i = ${(k - 1) * (n / 4) + 1}; i <= ${k * (n / 4)}; i++) __s.ptr('pointermove', Math.round(${x0} - ${GESTURE.dragLeftPx} * i / ${n}), Math.round(${y0} - ${GESTURE.liftLowPx} * i / ${n})); })()`);
      await sleep(k === 4 ? 450 : 60); // the last one: the happy face after CARRIED_HAPPY_MS
      frames.push(await grab('drag', 1 + k, region(await js<Snap>('__s.snap()'))));
    }
    const ex = Math.round(x0 - GESTURE.dragLeftPx);
    const ey = Math.round(y0 - GESTURE.liftLowPx);
    const fall = await captureLoop('drag-fall', { start: `__s.ptr('pointerup', ${ex}, ${ey})`, until: '__s.cs().state === "in" && __s.idle()', region, max: 200, tail: 1 });
    strips.push({ out: 'drag-release-strip.png', scale: 1, dedupe: true, maxFrames: 18, frames: [...frames, ...fall.slice(1)] });
    await endScenario('strip-drag-release');
    await waitIn();
    const high = dropRegion(GESTURE.liftHighPx);
    const [hx = 0, hy = 0] = await js<number[]>('__s.center()');
    const hf: StripFrame[] = [await grab('drop-high', 0, high(await js<Snap>('__s.snap()')))];
    await js(`(() => { __s.ptr('pointerdown', ${hx}, ${hy}); for (let i = 1; i <= 24; i++) __s.ptr('pointermove', ${hx}, Math.round(${hy} - ${GESTURE.liftHighPx} * i / 24)); })()`);
    await sleep(450);
    const hfall = await captureLoop('drop-high', { start: `__s.ptr('pointerup', ${hx}, ${hy - GESTURE.liftHighPx})`, until: '__s.cs().state === "in" && __s.idle()', region: high, max: 200, tail: 1 });
    strips.push({ out: 'drop-high-strip.png', scale: 0.5, dedupe: true, maxFrames: 18, frames: [...hf, ...hfall] });
    await endScenario('strip-drop-high');
  });

  // -- roll out (measured, then captured) from the dragged spot
  await scenario('roll-out', sc, async () => {
    await waitIn();
    const before = await cs();
    const r = await js<RecResult>(`__s.rec({ drive: (i) => { if (i === 0) __kt.panel.companion.command('away'); }, until: () => __s.cs().state === 'away', maxMs: 6000 })`);
    frameBudget.roll = frameStats(r.deltas);
    const after = await cs();
    const rolls = r.trace.filter((t) => t.mode === 'pose:roll').length;
    sc.rollOut = { fromBodyX: before.bodyX, toBodyX: after.bodyX, ms: r.ms, timedOut: r.timedOut, rollPoseChanges: rolls, sequence: modesOf(r.trace), side: after.side, pass: !r.timedOut && after.state === 'away' && rolls > 0 };
    await endScenario('roll-out');
    await command('return');
    await waitIn();
    const frames = await captureLoop('roll', { start: `__kt.panel.companion.command('away')`, until: '__s.cs().state === "away"', region: floorRegion, max: 200, tail: 1 });
    strips.push({ out: 'roll-out-strip.png', scale: 1, dedupe: true, maxFrames: 18, frames });
    await endScenario('strip-roll-out');
  });

  // -- push past the right edge = leave (no velocity fling)
  await scenario('push-right-edge', sc, async () => {
    await command('return');
    await waitIn();
    const before = await cs();
    const [x0 = 0, y0 = 0] = await js<number[]>('__s.center()');
    const dx = W - 2 - x0;
    const d = await js<RecResult>(dragCode(dx, 0, 24, false));
    const [ex = 0, ey = 0] = d.end ?? [];
    await js(`__s.ptr('pointerup', ${ex}, ${ey})`);
    await waitFor('__s.cs().state === "away"', 6000);
    const after = await cs();
    sc.pushPastRightEdge = { pointerEndX: ex, side: after.side, state: after.state, homeFromRightBefore: before.homeFromRight, homeFromRightAfter: after.homeFromRight, pass: after.state === 'away' && after.side === 'right' && after.homeFromRight === before.homeFromRight };
    await endScenario('push-right-edge');
  });

  // -- peek-return strip
  await scenario('strip-peek', sc, async () => {
    await js(`__s.move(${far.x}, ${far.y})`);
    await sleep(100);
    const frames = await captureLoop('peek', { start: `__s.move(${zone.x}, ${zone.y})`, until: '__s.cs().state === "in" && __s.idle()', region: floorRegion, max: 200, tail: 1 });
    strips.push({ out: 'peek-return-strip.png', scale: 1, dedupe: true, maxFrames: 18, frames });
    await endScenario('strip-peek-return');
  });

  // -- away probe: the sliver is the hitbox (the probe itself makes him peek; last step of this session)
  await scenario('away-probe', sc, async () => {
    await command('away');
    await waitFor('__s.cs().state === "away"', 6000);
    await sleep(200);
    await sampleGeom('away (sliver, after commands)');
    await probe('away (sliver)');
    await endScenario('away-probe');
  });
  sc.stateEvents = stateLog.slice(-12);
  return sc;
}

/** Question arrival while away: arrival to the perch with the glyph, wait PERCH_WAIT_MS, tuck with the glyph, tray state. */
async function questionRun(): Promise<Record<string, unknown>> {
  const sc: Record<string, unknown> = {};
  await openWindow('area', { mock: '1', shots: '1', ...defaultQuery() });
  await waitFor('__s.cs() && __s.cs().state === "away"', 15000);
  await sleep(300);
  const s0 = stateLog.length;
  // 1) arrival (captured for the strip): the collapsed poll runs now instead of in 90 s
  await js('window.__sawQ = false');
  const arrival = await captureLoop('arrival', { start: '__kt.panel.companion.poll()', until: '(window.__sawQ = window.__sawQ || __kt.panel.status().avatar.mode === "question") && __s.cs().state === "perched" && __kt.panel.status().avatar.mode === "hold" && __s.idle()', region: floorRegion, max: 200, tail: 1 });
  const tPerched = Date.now();
  // What runs right after he reaches the perch (state, act, frame, companion timers), for 1.5 s.
  sc.afterPerchTrace = (await js<RecResult>(`__s.rec({ maxMs: 1500 })`)).trace.map((t) => `${t.ms} ${t.st} ${t.mode}:${t.f} x=${t.x} ${t.surface}`);
  sc.afterPerchStatus = await cs();
  const perched = await cs();
  const glyph = await js<{ questionCue: boolean; held: boolean; unseen: boolean }>('(() => { const s = __kt.panel.status(); return { questionCue: s.avatar.questionCue, held: s.avatar.held, unseen: s.unseenQuestion }; })()');
  await sampleGeom('perched');
  await measureIdle('perched');
  const perchedShot = await still('perched-glyph');
  // 2) ignored: after PERCH_WAIT_MS he tucks back with the glyph on the sliver (frames captured for the strip)
  const wait = Math.max(0, tPerched + LEAVE.perchWaitMs - 700 - Date.now());
  await sleep(wait);
  const tuck = await captureLoop('arrival-tuck', { until: '__s.cs().state === "away"', region: floorRegion, max: 200, tail: 1 });
  const tAway = Date.now();
  const tucked = await cs();
  const glyphAway = await js<{ questionCue: boolean; held: boolean; unseen: boolean; mode: string }>('(() => { const s = __kt.panel.status(); return { questionCue: s.avatar.questionCue, held: s.avatar.held, unseen: s.unseenQuestion, mode: s.avatar.mode }; })()');
  const sliverShot = await still('sliver-after-question');
  const lastState = stateLog.at(-1)?.state ?? null;
  strips.push({ out: 'question-arrival-strip.png', scale: 1, dedupe: true, maxFrames: 20, frames: [...arrival, ...tuck] });
  sc.arrival = {
    questionId: perched.question, perchedBodyX: perched.bodyX, perchTimers: perched.timers, glyph, perchedShot,
    perchedToAwayMs: tAway - tPerched, expectedPerchWaitMs: LEAVE.perchWaitMs, tuckedState: tucked.state, glyphOnSliver: glyphAway, sliverShot,
    trayStateEvents: stateLog.slice(s0), lastTrayState: lastState,
    engagement: await js('__kt.panel.companion.engagement()'),
    pass: perched.state === 'perched' && !!perched.question && tucked.state === 'away' && glyphAway.held && glyphAway.unseen && lastState?.away === true && lastState.question === true && Math.abs(tAway - tPerched - LEAVE.perchWaitMs) <= LEAVE.toleranceMs + 700,
  };
  await endScenario('question-arrival-and-tuck');
  // 3) the second seed question arrives (measured), then the pointer on him at the perch brings him in
  await js('window.__sawQ = false');
  const r = await js<RecResult>(`__s.rec({ drive: (i) => { if (i === 0) __kt.panel.companion.poll(); }, until: (i) => (window.__sawQ = window.__sawQ || __kt.panel.status().avatar.mode === 'question') && i > 2 && __s.cs().state === 'perched' && __kt.panel.status().avatar.mode === 'hold' && __s.idle(), maxMs: 8000 })`);
  frameBudget.arrive = frameStats(r.deltas);
  const second = await cs();
  sc.secondArrival = { questionId: second.question, state: second.state, timedOut: r.timedOut, sequence: modesOf(r.trace) };
  if (second.state === 'perched') {
    await probe('perched');
    await sleep(100);
    const st = await cs();
    (sc.secondArrival as Record<string, unknown>).afterPointer = st.state;
    await waitIn(6000).catch(() => undefined);
  }
  await endScenario('second-arrival-pointer-in');
  return sc;
}

/** Reduced motion: leave / peek / return / drop / arrival jump to their end states; no rAF at all. */
async function reducedRun(): Promise<Record<string, unknown>> {
  await openWindow('area', { mock: '1', shots: '1', ...defaultQuery() });
  const { W, H } = size();
  await waitFor('__s.cs() && ["in", "leaving", "away"].includes(__s.cs().state)', 10000);
  await act('__s.click(".rf-avatar")');
  await act('__s.click(".rf-footer [data-action=settings]"); __s.click(".rf-motion")');
  await act('__s.click(".rf-avatar")');
  await waitIn(8000);
  await sleep(300);
  await js('__raf.reset()');
  const out: Record<string, unknown> = { reduced: await js<boolean>('__kt.panel.status().reduced') };
  out.awayImmediately = await js<string>('(() => { __kt.panel.companion.command("away"); return __s.cs().state; })()');
  out.awayShot = await still('reduced-away');
  await js(`__s.move(${Math.round(W * 0.3)}, 120)`);
  out.peekImmediately = await js<{ st: string; x: number }>(`(() => { __s.move(${W - 150}, ${H - 50}); const c = __s.cs(); return { st: c.state, x: c.bodyX }; })()`);
  await sleep(700);
  out.afterDwell = (await cs()).state;
  await js(`__s.move(${Math.round(W * 0.3)}, 120)`);
  await waitIn(4000).catch(() => undefined);
  const [x0 = 0, y0 = 0] = await js<number[]>('__s.center()');
  out.drop = await js<{ carried: string; landed: string; lift: number }>(`(() => {
    __s.ptr('pointerdown', ${x0}, ${y0});
    for (let i = 1; i <= 10; i++) __s.ptr('pointermove', ${x0}, ${y0} - 25 * i);
    const carried = __s.cs().state; __s.ptr('pointerup', ${x0}, ${y0 - 250});
    const c = __s.cs(); return { carried, landed: c.state, lift: c.lift };
  })()`);
  await sleep(300);
  await js('__kt.panel.companion.command("away")');
  out.arrival = await js<{ arrived: boolean; st: string }>('(async () => { await __kt.panel.companion.poll(); return { arrived: true, st: __s.cs().state }; })()');
  await sleep(200);
  out.perchedShot = await still('reduced-perched');
  const raf = await js<{ calls: number; ms: number; stacks: string[] }>('__raf.read()');
  out.rafCalls = raf.calls;
  out.rafWindowMs = raf.ms;
  out.rafStacks = raf.stacks;
  const pass = raf.calls === 0 && out.awayImmediately === 'away' && (out.drop as { landed: string }).landed === 'in';
  out.pass = pass;
  await endScenario('reduced-motion');
  return out;
}

/** Reload keeps the saved spot (localStorage, so not in shots mode: the page is driven without __kt). */
async function persistenceRun(): Promise<Record<string, unknown>> {
  const q = { mock: '1', ...defaultQuery() };
  await openWindow('area', q);
  await js('localStorage.clear()');
  await load();
  const { W } = size();
  await sleep(2600);
  const bodyX = async (): Promise<number> => js<number>('(() => { const r = __s.av().getBoundingClientRect(); return r.left + r.width / 2; })()');
  const atLaunch = await bodyX();
  const [x0 = 0, y0 = 0] = await js<number[]>('__s.center()');
  await js(`(() => { __s.ptr('pointerdown', ${x0}, ${y0}); for (let i = 1; i <= 20; i++) __s.ptr('pointermove', ${x0} - 10 * i, ${y0}); __s.ptr('pointerup', ${x0 - 200}, ${y0}); })()`);
  await sleep(700);
  const dropped = await bodyX();
  const saved = await js<string | null>('localStorage.getItem("kt-companion.v1")');
  await load();
  await sleep(2600);
  const afterReload = await bodyX();
  await endScenario('reload-keeps-spot');
  return { windowWidth: W, atLaunch, dropped, saved: saved ? (JSON.parse(saved) as unknown) : null, afterReload, pass: Math.abs(dropped - (atLaunch - 200)) <= 1 && Math.abs(afterReload - dropped) <= 1 };
}

// ---- strips / summary ----
function writeStrips(): void {
  if (strips.length) writeFileSync(join(outDir, 'companion', 'strips.json'), JSON.stringify(strips, null, 2));
  if (entranceStrips.length) writeFileSync(join(outDir, 'entrance', 'strips.json'), JSON.stringify(entranceStrips, null, 2));
}

function summarise(sc: Record<string, unknown>, full = true): Array<{ name: string; value: unknown; budget: string; pass: boolean }> {
  const rows: Array<{ name: string; value: unknown; budget: string; pass: boolean }> = [];
  const walks = (checks.walks ?? {}) as Record<string, { openFrames?: FrameStats; closeFrames?: FrameStats }>;
  for (const [k, v] of Object.entries(walks)) {
    for (const [n, f] of [['open', v.openFrames], ['close', v.closeFrames]] as const) {
      if (f) rows.push({ name: `frames panel ${n} ${k} (p95 / max ms)`, value: `${f.p95Ms} / ${f.maxMs} (${f.frames} frames)`, budget: `<= ${BUDGET.frameP95Ms} / <= ${BUDGET.frameMaxMs}`, pass: !!f.pass });
    }
  }
  if (full) addCompanionRows(rows);
  for (const [k, v] of Object.entries(sc)) {
    const p = (v as { pass?: unknown } | null)?.pass;
    if (typeof p === 'boolean') rows.push({ name: `scenario ${k}`, value: p ? 'ok' : 'failed', budget: 'pass', pass: p });
  }
  const badIgnore = ignoreAfter.filter((s) => !s.pass);
  rows.push({ name: 'window ignores the mouse after every scenario', value: `${ignoreAfter.length - badIgnore.length}/${ignoreAfter.length}`, budget: 'all', pass: ignoreAfter.length > 0 && badIgnore.length === 0 });
  rows.push({ name: 'console errors', value: consoleErrors.length, budget: '0', pass: consoleErrors.length === 0 });
  return rows;
}

function addCompanionRows(rows: Array<{ name: string; value: unknown; budget: string; pass: boolean }>): void {
  for (const [k, f] of Object.entries(frameBudget)) rows.push({ name: `frames ${k} (p95 / max ms)`, value: `${f.p95Ms} / ${f.maxMs} (${f.frames} frames)`, budget: `<= ${BUDGET.frameP95Ms} / <= ${BUDGET.frameMaxMs}`, pass: !!f.pass });
  for (const k of ['in', 'away', 'perched']) {
    const r = idle[k] as { totalCpuPercent: number; rafCalls: number; timers: string[] } | undefined;
    rows.push({ name: `idle CPU ${k} (3 s, all processes)`, value: r?.totalCpuPercent ?? null, budget: `<= ${BUDGET.idleCpuPercent} %`, pass: !!r && r.totalCpuPercent <= BUDGET.idleCpuPercent });
    rows.push({ name: `rAF calls ${k} (3 s)`, value: r?.rafCalls ?? null, budget: '0', pass: !!r && r.rafCalls === 0 });
  }
  const flood = idle.flood as { rendererCpuPercent: number; totalCpuPercent: number; rafCalls: number; events: number } | undefined;
  rows.push({ name: '60 Hz mousemove flood far from him, renderer CPU (report only)', value: flood ? `${flood.rendererCpuPercent} % renderer, ${flood.totalCpuPercent} % total, ${flood.events} events, ${flood.rafCalls} rAF` : null, budget: 'reported', pass: !!flood && flood.rafCalls === 0 });
  const geomOk = geomSamples.filter((s) => s.geom);
  const gap0 = geomOk[0]?.geom?.gap ?? 0;
  const badGeom = geomOk.filter((s) => Math.abs(s.geom!.dx) > 0.5 || Math.abs(s.geom!.gap - gap0) > 0.5 || s.geom!.w !== 64 || s.geom!.h !== 64);
  rows.push({ name: 'hitbox = carrier avatar rect (geometry, every sampled state)', value: `${geomOk.length - badGeom.length}/${geomOk.length}`, budget: 'all', pass: geomOk.length > 0 && badGeom.length === 0 });
  const badProbe = hitProbes.filter((p) => !p.pass);
  rows.push({ name: 'hit-test probes through the renderer (kt:ignore-mouse)', value: `${hitProbes.length - badProbe.length}/${hitProbes.length}`, budget: 'all', pass: hitProbes.length > 0 && badProbe.length === 0 });
}

async function mockRun(): Promise<void> {
  // KT_SHOTS_ONLY=companion: only the companion scenarios; =question: only the question arrival (debug loops).
  if (process.env.KT_SHOTS_ONLY === 'question') {
    checks.question = await questionRun();
    return;
  }
  if (process.env.KT_SHOTS_ONLY !== 'companion') await regularStates();
  await companionScenarios();
}

async function regularStates(): Promise<void> {
  // 1) the regular states, 420 in the work-area window (away off: still shots), cropped around the carrier
  await openWindow('area', { mock: '1', shots: '1', ...awayOffQuery() });
  const walks: Record<string, unknown> = {};
  walks['area-420'] = await walk(420);
  // 2) 320: only the column window is that narrow now (KT_WINDOW_MODE=column, R28 fallback, companion off)
  await openWindow('column', { mock: '1', shots: '1', ...flagsToQuery({ ...COLUMN_FLAGS }) }, 320);
  walks['column-320'] = await walk(320);
  // 3) reduced motion stills through the real setting (work-area window, away off)
  await openWindow('area', { mock: '1', shots: '1', ...awayOffQuery() });
  await js('__s.settle(4000)');
  await sleep(2600);
  await act('__s.click(".rf-avatar")');
  await act('__s.click(".rf-footer [data-action=settings]"); __s.click(".rf-motion")');
  await shot('reduced-settings', 420, 0);
  await act('__s.click(".rf-view[data-view=settings] [data-action=input]"); __s.type("blank labels after ribbon swap"); __s.click(".rf-send")');
  await waitFor('__kt.panel.status().view === "result"');
  const reducedTimings: Record<string, number> = {};
  reducedTimings.nodeExpand = await act('__s.click(".rf-case-path .rf-node-title[data-node=hypothesis]")');
  await shot('reduced-result-node', 420, reducedTimings.nodeExpand);
  reducedTimings.people = await act('__s.click("[data-action=people]")');
  reducedTimings.close = await act('__s.click(".rf-avatar")');
  await shot('reduced-collapsed', 420, reducedTimings.close);
  checks.reducedMotion = { timingsMs: reducedTimings, status: await js('__kt.panel.status()'), nonZeroTimingsIncludeIpcRoundTrip: true };
  await collectPageErrors();
  // 4) column mode (KT_WINDOW_MODE=column) walks the old 420 sequence into column/
  shotDir = join(outDir, 'column');
  await openWindow('column', { mock: '1', shots: '1', ...flagsToQuery({ ...COLUMN_FLAGS }) }, 420);
  walks['column-420'] = await walk(420);
  shotDir = outDir;
  checks.walks = walks;
}

async function companionScenarios(): Promise<void> {
  const sc: Record<string, unknown> = {};
  Object.assign(sc, await companionRun());
  const failed = (e: unknown): Record<string, unknown> => {
    console.error('[shots] scenario failed: ' + String(e).slice(0, 300));
    return { error: String(e).slice(0, 600), pass: false };
  };
  const q = await questionRun().catch((e: unknown) => ({ arrival: failed(e), secondArrival: null }));
  sc.questionArrival = q.arrival;
  sc.secondArrival = q.secondArrival;
  sc.reducedMotion = await reducedRun().catch(failed);
  sc.reloadKeepsSpot = await persistenceRun().catch(failed);
  const walks = (checks.walks ?? {}) as Record<string, { hitbox: { allStatesEqual: boolean }; companion: unknown; bounds: unknown; expectedBounds: unknown } | undefined>;
  const col420 = walks['column-420'];
  const col320 = walks['column-320'];
  if (col420 && col320) sc.columnMode = { pass: col420.hitbox.allStatesEqual && col320.hitbox.allStatesEqual && col420.companion === null && col320.companion === null && JSON.stringify(col420.bounds) === JSON.stringify(col420.expectedBounds) && JSON.stringify(col320.bounds) === JSON.stringify(col320.expectedBounds) };
  checks.companion = { scenarios: sc, captures, frames: frameBudget, idle, geomSamples, hitProbes, ignoreAfterScenario: ignoreAfter, ignoreMessages: ignoreLog.length, trayStateEvents: stateLog };
  checks.summary = summarise(sc);
}

// ---- real service ----
interface DirEntry { personEntityId: string; name: string; role?: string }
interface QView { questionId: string; investigationId: string; text: string; status: string; caseLabel: string }

/** Real service: he arrives at the perch with the routed question for the current person (default flags). */
async function realArrival(questionId: string | null): Promise<Record<string, unknown>> {
  await openWindow('area', { shots: '1', ...defaultQuery() });
  try {
    await waitFor('__s.cs() && __s.cs().state === "away"', 15000);
    await sleep(300);
    await js('__kt.panel.companion.poll()');
    await js('window.__sawQ = false');
    await waitFor('(window.__sawQ = window.__sawQ || __kt.panel.status().avatar.mode === "question") && __s.cs().state === "perched" && __kt.panel.status().avatar.mode === "hold" && __s.idle()', 8000);
    const c = await cs();
    const file = 'arrival-perched-real-420.png';
    writeFileSync(join(outDir, file), (await w().webContents.capturePage(await panelArea())).toPNG());
    const glyph = await js<{ questionCue: boolean; unseen: boolean }>('(() => { const s = __kt.panel.status(); return { questionCue: s.avatar.questionCue, unseen: s.unseenQuestion }; })()');
    await endScenario('real-arrival');
    return { state: c.state, question: c.question, expectedQuestion: questionId, file, glyph, pass: c.state === 'perched' && c.question === questionId };
  } catch (e) {
    return { error: String(e), pass: false };
  } finally {
    await collectPageErrors();
    await openWindow('area', { shots: '1', ...awayOffQuery() });
  }
}

/**
 * The real-service sequence at 420 px: identity, a first investigation (people, contact draft), a second one that
 * routes a question to a colleague, the companion's arrival with it while away, answering as that colleague
 * (No, undo, Yes), then the requester again. Everything is driven through the real panel; the Node side only
 * reads the service to pick ids and to verify.
 */
async function realRun(url: string): Promise<void> {
  const W = 420;
  const get = async <T,>(path: string): Promise<T> => (await fetch(url + path)).json() as Promise<T>;
  const directory = await get<DirEntry[]>('/directory');
  const byName = (n: string): DirEntry => {
    const d = directory.find((x) => x.name === n);
    if (!d) throw new Error('not in directory: ' + n);
    return d;
  };
  const veikko = byName('Veikko Vikkelä');
  const ids: Record<string, unknown> = {};
  checks.ids = ids;
  const chooseYou = async (d: DirEntry): Promise<void> => {
    await act('__s.click(".rf-footer [data-action=settings]")');
    await js(`(() => { const s = document.querySelector('.rf-you'); s.value = ${JSON.stringify(d.personEntityId)}; s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    const t = Date.now();
    while (Date.now() - t < 8000) {
      if ((await get<{ currentPersonEntityId?: string }>('/settings')).currentPersonEntityId === d.personEntityId) break;
      await sleep(50);
    }
    await sleep(250);
  };
  const send = async (text: string): Promise<void> => {
    await act('__s.click(".rf-footer [data-action=attach]")');
    await act(`__s.type(${JSON.stringify(text)})`);
    await js('__s.click(".rf-send")');
    await waitFor('__kt.panel.status().view === "result"', 30000);
    await act('0');
  };
  const rowText = (): Promise<string[]> => js<string[]>('[...document.querySelectorAll(".rf-view[data-view=result] .rf-result-rows > *")].map((n) => n.textContent.trim())');

  await openWindow('area', { shots: '1', ...awayOffQuery() });
  await js('__s.settle(4000)');
  await sleep(2600);
  await shot('collapsed', W, 0);
  const base = await js<number[]>('__s.hit()');
  checks.settingsAtStart = await get('/settings');

  await act('__s.click(".rf-avatar")');
  await chooseYou(veikko);
  await shot('settings-you', W, 0);

  // (c) first problem
  await act('__s.click(".rf-view[data-view=settings] [data-action=input]")');
  const text1 = 'At site now. Replaced the SFP on TRN-088, an older unit from 2018. Link is up, alarms cleared, RX power normal, but no traffic. Counters zero.';
  await act(`__s.type(${JSON.stringify(text1)})`);
  await shot('input', W, 0);
  await js('__s.click(".rf-send")');
  await waitFor('__kt.panel.status().view === "result"', 30000);
  await step('result', W, '0');
  ids.investigationId = (await js<{ investigationId?: string }>('__kt.panel.status()')).investigationId;
  checks.firstResultRows = await rowText();
  checks.firstResultTitle = await js<string>('document.querySelector(".rf-result-title").textContent');

  // (d) expand the Possible cause node (by its label, whatever the node id)
  await step('result-node-expanded', W, `(() => { const b = [...document.querySelectorAll('.rf-case-path .rf-node-title')].find((n) => /possible cause/i.test(n.textContent)) ?? document.querySelectorAll('.rf-case-path .rf-node-title')[1]; if (!b) throw new Error('no timeline node'); window.checks_node = b.textContent.trim(); b.click(); })()`);
  checks.expandedNode = await js<string | null>('window.checks_node ?? null');
  // (d2) the last timeline node, expanded and scrolled into view
  await step('result-last-node', W, `(() => { const t = [...document.querySelectorAll('.rf-case-path .rf-node-title')]; const b = t[t.length - 1]; if (!b) throw new Error('no timeline node'); window.checks_last = b.textContent.trim(); b.click(); b.scrollIntoView({ block: 'center' }); })()`);
  checks.lastNode = await js<string | null>('window.checks_last ?? null');

  // (e) people
  await step('people', W, '__s.click("[data-action=people]")');
  checks.peopleShown = await js<string[]>('[...document.querySelectorAll(".rf-person small")].map((n) => n.textContent)');

  // (f) message for Erkki Expert (first askable person if he is not listed)
  const prepared = await js<string>(`(() => { const rows = [...document.querySelectorAll('.rf-person')]; const row = rows.find((r) => r.querySelector('small').textContent.startsWith('Erkki Expert') && r.querySelector('[data-action=prepare]')) ?? rows.find((r) => r.querySelector('[data-action=prepare]')); if (!row) return ''; row.querySelector('[data-action=prepare]').click(); return row.querySelector('small').textContent; })()`);
  checks.contactDraftFor = prepared || null;
  if (prepared) {
    await act('0');
    await waitFor('__kt.panel.status().view === "contact"', 15000);
    await act('0');
    await shot('contact-draft', W, 0);
    checks.contactDraftText = await js<string>('document.querySelector(".rf-draft-subject").textContent + " || " + document.querySelector(".rf-draft-body").textContent');
  }

  // (g) second problem that leaves a gap and routes a question
  // The brief's text first; engines that settle on 'check first' for it never open a question, so a lookalike
  // that has a consequential gap about something only a colleague can know is tried next (recorded in checks).
  const candidates = [
    'TRN-301: changed the SFP, link up, alarms cleared, no traffic. Not sure which unit generation this is.',
    'RBS-310 is flapping again with DC low alarms after the rectifier work',
  ];
  let text2 = candidates[0]!;
  const attempts: Array<{ text: string; asked: boolean; investigationId?: string; loopReasonShown?: string | null }> = [];
  checks.secondProblemAttempts = attempts;
  for (const t of candidates) {
    text2 = t;
    await send(t);
    const st = await js<{ investigationId?: string }>('__kt.panel.status()');
    const hasAsk = await js<boolean>('!!document.querySelector(".rf-asked")');
    attempts.push({ text: t, asked: hasAsk, investigationId: st.investigationId, loopReasonShown: await js<string | null>('document.querySelector(".rf-loop-reason")?.textContent ?? null') });
    if (hasAsk) break;
  }
  await shot('result-second', W, 0);
  ids.secondInvestigationId = (await js<{ investigationId?: string }>('__kt.panel.status()')).investigationId;
  checks.secondText = text2;
  checks.secondResultRows = await rowText();
  checks.secondResultTitle = await js<string>('document.querySelector(".rf-result-title").textContent');
  checks.askedRowShown = await js<boolean>('!!document.querySelector(".rf-asked")');

  // find the question and its recipient from the service
  let question: QView | undefined;
  let recipient: DirEntry | undefined;
  for (const d of directory) {
    const qs = await get<QView[]>(`/questions?personEntityId=${encodeURIComponent(d.personEntityId)}&status=all`);
    const hit = qs.find((q) => q.investigationId === ids.secondInvestigationId);
    if (hit) { question = hit; recipient = d; break; }
  }
  ids.questionId = question?.questionId ?? null;
  ids.recipient = recipient ? { personEntityId: recipient.personEntityId, name: recipient.name, role: recipient.role } : null;
  checks.question = question ?? null;

  if (question && recipient) {
    // (h) become the recipient; desktop (R34): he arrives at the perch with that question while away
    await chooseYou(recipient);
    await shot('settings-recipient', W, 0);
    checks.realArrival = await realArrival(question.questionId);
    await js('__s.settle(4000)');
    await sleep(2600);
    await act('__s.click(".rf-avatar")');
    // answer No, undo, answer Yes
    await step('queue', W, '__s.click(".rf-footer [data-action=queue]")');
    checks.badgeForRecipient = await js<string>('document.querySelector(".rf-count").textContent');
    checks.queueTexts = await js<string[]>('[...document.querySelectorAll(".rf-question-item")].map((n) => n.textContent)');
    await step('question', W, '__s.click(".rf-question-item")');
    await step('question-context', W, '__s.click("[data-action=context]")');
    await js('__s.click("[data-action=no]")');
    await waitFor('__kt.panel.status().view === "receipt"', 15000);
    await act('0');
    await shot('receipt-no', W, 0);
    checks.receiptNo = await js<string>('document.querySelector(".rf-view[data-view=receipt] .rf-receipt-title").textContent');
    await step('undo-returns-to-question', W, '__s.click("[data-action=receipt-action]")');
    await js('__s.click("[data-action=yes]")');
    await waitFor('__kt.panel.status().view === "receipt"', 15000);
    await act('0');
    await shot('receipt-yes', W, 0);
    checks.receiptYes = await js<string>('document.querySelector(".rf-view[data-view=receipt] .rf-receipt-title").textContent');
    checks.answeredStatus = (await get<QView[]>(`/questions?personEntityId=${encodeURIComponent(recipient.personEntityId)}&status=all`)).find((q) => q.questionId === question!.questionId)?.status ?? null;
    checks.badgeAfterAnswer = await js<string>('document.querySelector(".rf-count").textContent');

    // (i) back to Veikko; the same text maps to the same investigation, which now reflects the answer
    await chooseYou(veikko);
    await send(text2);
    await shot('result-after-answer', W, 0);
    checks.sameInvestigation = (await js<{ investigationId?: string }>('__kt.panel.status()')).investigationId === ids.secondInvestigationId;
    checks.afterAnswerRows = await rowText();
    checks.afterAnswerTitle = await js<string>('document.querySelector(".rf-result-title").textContent');
  }

  // (j) collapsed
  await act('__s.click(".rf-avatar")');
  await shot('collapsed-end', W, 0);
  const final = await js<number[]>('__s.hit()');
  checks.hitbox = { initial: base, final, allStatesEqual: states.every((st) => st.hitbox.every((v, i) => v === base[i])) };
  await endScenario('real-walk');
  checks.summary = summarise({ realArrival: checks.realArrival, realHitbox: { pass: (checks.hitbox as { allStatesEqual: boolean }).allStatesEqual } }, false);
}

async function main(): Promise<void> {
  // Never touch the real app's localStorage (the reload scenario uses it): a throwaway profile per run.
  const profile = mkdtempSync(join(tmpdir(), 'kt-shots-'));
  app.setPath('userData', profile);
  app.on('window-all-closed', () => undefined);
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (/^\d\d-.*\.png$/.test(f) || /^arrival-.*\.png$/.test(f)) rmSync(join(outDir, f));
  if (!realUrl) {
    for (const d of ['column', 'companion']) rmSync(join(outDir, d), { recursive: true, force: true });
    mkdirSync(join(outDir, 'column'), { recursive: true });
    mkdirSync(join(outDir, 'companion', 'frames'), { recursive: true });
    mkdirSync(join(outDir, 'entrance'), { recursive: true });
  }
  // desktop (R31): the renderer's click-through decisions are recorded (kt:ignore-mouse spy) for the "ignores the
  // mouse" and hit-test checks. By default the harness does not apply them: the window ignores the real mouse
  // entirely (no forwarding), so the real cursor and real clicks on this Mac can neither feed the companion's
  // proximity, gaze or gestures nor land on him while the in-page scenarios run (in-page events and
  // webContents.sendInputEvent are injected into the page directly and still arrive). KT_SHOTS_FORWARD=1 applies
  // them with the production handler (handleMouseIgnore, forward: true).
  const forward = process.env.KT_SHOTS_FORWARD === '1';
  if (forward) handleMouseIgnore(() => win);
  checks.mouseForwarding = forward ? 'production handler (applied, forward: true)' : 'isolated (recorded, not applied; the window ignores the real mouse)';
  ipcMain.on(IPC.ignoreMouse, (_e, flag: unknown) => ignoreLog.push({ t: Date.now(), flag: flag === true }));
  ipcMain.on(IPC.state, (_e, s: unknown) => stateLog.push({ t: Date.now(), state: s as ShellState }));
  await app.whenReady();
  checks.cursorAtStart = screen.getCursorScreenPoint();
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  if (realUrl) allowServiceCors(session.defaultSession, realUrl);

  if (realUrl) await realRun(realUrl);
  else await mockRun();

  if (win && !win.isDestroyed()) await collectPageErrors().catch(() => undefined);
  checks.consoleErrors = consoleErrors;
  checks.notes = notes;
  checks.states = states;
  checks.finishedAt = new Date().toISOString();
  writeStrips();
  const name = realUrl ? 'checks-real.json' : 'checks.json';
  writeFileSync(join(outDir, name), JSON.stringify(checks, null, 2));
  const summary = (checks.summary as Array<{ name: string; value: unknown; pass: boolean }> | undefined) ?? [];
  for (const r of summary) console.log(`[shots] ${r.pass ? 'pass' : 'FAIL'}  ${r.name}: ${typeof r.value === 'string' ? r.value : JSON.stringify(r.value)}`);
  console.log(`[shots${realUrl ? ':real' : ''}] wrote ${states.length} screenshots and ${name} to ${outDir}; console errors: ${consoleErrors.length}; budget failures: ${summary.filter((r) => !r.pass).length}`);
  rmSync(profile, { recursive: true, force: true });
  app.quit();
}

main().catch((e) => {
  console.error('[shots] failed', e);
  try {
    checks.fatal = String(e);
    checks.consoleErrors = consoleErrors;
    checks.states = states;
    writeFileSync(join(outDir, realUrl ? 'checks-real.partial.json' : 'checks.partial.json'), JSON.stringify(checks, null, 2));
  } catch {
    /* best effort */
  }
  app.exit(1);
});
