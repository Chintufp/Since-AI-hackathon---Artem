/**
 * Screenshot/measurement harness (entry: dist/desktop/shots.cjs, driven by scripts/screenshot.mjs).
 * Launches the real renderer against the dev mock, walks every state at 420 and 320 px and with
 * reduced motion, saves PNGs and writes checks.json. Not part of the production app.
 */
import { app, session } from 'electron';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createCompanionWindow, handleMouseIgnore, placeBottomRight, WINDOW } from './window.ts';

const outDir = process.env.KT_SHOTS_OUT ?? resolve(__dirname, '../../docs/runs/2026-11-07-overnight/screenshots');
const hidden = process.env.KT_SHOTS_HIDDEN === '1';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface StateRecord { name: string; width: number; file: string; view: string; settleMs: number; hitbox: number[]; reduced: boolean }

const HELPERS = `
window.__s = {
  sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  async settle(max = 4000) {
    const t = performance.now();
    while (performance.now() - t < max) { const s = __kt.panel.status(); if (!s.uiMotion.active && !s.avatar.reactionPlaying) break; await __s.sleep(16); }
    return Math.round(performance.now() - t);
  },
  click(sel) { const el = document.querySelector(sel); if (!el) throw new Error('missing ' + sel); el.click(); },
  type(text) { const f = document.querySelector('.rf-writing'); f.focus(); f.value = text; f.dispatchEvent(new Event('input', { bubbles: true })); },
  hit() { const r = document.querySelector('.rf-avatar').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; },
  async frames(fn) {
    const d = []; let last = 0, on = true;
    const loop = (t) => { if (!on) return; if (last) d.push(t - last); last = t; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
    await __s.sleep(40); fn(); await __s.sleep(30); await __s.settle(); await __s.sleep(60); on = false;
    return d;
  },
};
true;`;

async function main(): Promise<void> {
  mkdirSync(outDir, { recursive: true });
  for (const f of readdirSync(outDir)) if (/^\d\d-.*\.png$/.test(f)) rmSync(join(outDir, f));
  const consoleErrors: string[] = [];
  const states: StateRecord[] = [];
  const checks: Record<string, unknown> = { startedAt: new Date().toISOString(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node, platform: process.platform, arch: process.arch };
  let seq = 0;

  handleMouseIgnore(() => win);
  await app.whenReady();
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  const win = createCompanionWindow({ serviceUrl: 'http://127.0.0.1:1', query: { mock: '1', shots: '1' }, show: false });
  win.webContents.on('console-message', (event) => {
    const e = event as unknown as { level?: string | number; message?: string };
    const level = String(e.level);
    if (level === 'error' || level === '3') consoleErrors.push(String(e.message));
  });
  win.webContents.on('render-process-gone', (_e, d) => consoleErrors.push('render-process-gone: ' + d.reason));
  win.webContents.on('did-fail-load', (_e, code, desc) => consoleErrors.push(`did-fail-load ${code} ${desc}`));
  if (!hidden) win.showInactive();
  else win.webContents.setBackgroundThrottling(false);

  const js = <T = unknown>(code: string): Promise<T> =>
    (win.webContents.executeJavaScript(code, true) as Promise<T>).catch((e: unknown) => {
      throw new Error(`script failed: ${code.slice(0, 160)} -> ${String(e)} ; console errors so far: ${consoleErrors.join(' | ')}`);
    });
  const waitFor = async (cond: string, ms = 8000): Promise<void> => {
    const t = Date.now();
    while (Date.now() - t < ms) { if (await js<boolean>(`!!(${cond})`).catch(() => false)) return; await sleep(30); }
    throw new Error('timeout waiting for ' + cond);
  };
  const load = async (width: number): Promise<void> => {
    placeBottomRight(win, width);
    win.webContents.reload();
    await waitFor('window.__kt && document.readyState === "complete"');
    await js(HELPERS);
    await sleep(100);
  };
  const act = async (code: string): Promise<number> => {
    const t = Date.now();
    await js(code);
    await js('__s.sleep(20)');
    await js('__s.settle()');
    return Date.now() - t;
  };
  const shot = async (name: string, width: number, settleMs: number): Promise<void> => {
    await sleep(80);
    const image = await win.webContents.capturePage();
    const file = `${String(++seq).padStart(2, '0')}-${name}-${width}.png`;
    writeFileSync(join(outDir, file), image.toPNG());
    const st = await js<{ view: string; reduced: boolean }>('__kt.panel.status()');
    states.push({ name, width, file, view: st.view, settleMs, hitbox: await js<number[]>('__s.hit()'), reduced: st.reduced });
  };
  const step = async (name: string, width: number, code: string): Promise<void> => shot(name, width, await act(code));

  const frameStats = (d: number[]) => {
    const s = [...d].sort((a, b) => a - b);
    return { frames: d.length, maxMs: +Math.max(...d).toFixed(1), meanMs: +(d.reduce((a, b) => a + b, 0) / d.length).toFixed(2), p95Ms: +(s[Math.floor(s.length * 0.95)] ?? 0).toFixed(1), over20ms: d.filter((x) => x > 20).length };
  };

  const walk = async (width: number): Promise<void> => {
    await load(width);
    await js('__s.settle(4000)');
    await sleep(2000); // entrance (24 frames at 16 fps = 1.5 s) plus margin
    await shot('collapsed', width, 0);
    const base = await js<number[]>('__s.hit()');
    if (width === 420) {
      // idle CPU: panel collapsed, nothing animating
      app.getAppMetrics();
      await sleep(3000);
      const metrics = app.getAppMetrics();
      checks.idleCpu = {
        windowSeconds: 3, state: 'collapsed, idle poses only',
        totalPercent: +metrics.reduce((a, m) => a + m.cpu.percentCPUUsage, 0).toFixed(2),
        perProcess: metrics.map((m) => ({ type: m.type, name: m.name, percent: +m.cpu.percentCPUUsage.toFixed(2) })),
        avatarStatus: await js('__kt.panel.status().avatar'),
      };
    }
    checks[`openFrames_${width}`] = frameStats(await js<number[]>('__s.frames(() => __s.click(".rf-avatar"))'));
    await shot('input', width, 0);
    await act('__s.type("The line 3 label printer prints blank labels since the ribbon swap. Head temperature looks normal."); __kt.panel.attachFiles([new File(["x"], "printer-display.png"), new File(["x"], "ribbon-change-log.txt")])');
    await shot('draft-attachments', width, 0);
    const processing = await js<string>('(() => { __s.click(".rf-send"); return __kt.panel.status().avatar.mode; })()');
    checks[`avatarModeRightAfterSend_${width}`] = processing;
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
    checks[`closeFrames_${width}`] = frameStats(await js<number[]>('__s.frames(() => __s.click(".rf-avatar"))'));
    await shot('closed-again', width, 0);
    const final = await js<number[]>('__s.hit()');
    checks.hitbox ??= {};
    (checks.hitbox as Record<string, unknown>)[String(width)] = { initial: base, final, allStatesEqual: states.filter((s) => s.width === width).every((s) => s.hitbox.every((v, i) => v === base[i])) };
    const page = await js<string[]>('__kt.errors');
    consoleErrors.push(...page.map((e) => 'page: ' + e));
  };

  await walk(420);
  await walk(320);

  // reduced motion: enable through the real setting, then repeat the key transitions
  await load(WINDOW.width);
  await sleep(1800);
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

  checks.consoleErrors = consoleErrors;
  checks.states = states;
  checks.finishedAt = new Date().toISOString();
  writeFileSync(join(outDir, 'checks.json'), JSON.stringify(checks, null, 2));
  console.log(`[shots] wrote ${states.length} screenshots and checks.json to ${outDir}; console errors: ${consoleErrors.length}`);
  app.quit();
}

main().catch((e) => {
  console.error('[shots] failed', e);
  app.exit(1);
});
