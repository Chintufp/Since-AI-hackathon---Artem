/**
 * Screenshot/measurement harness (entry: dist/desktop/shots.cjs, driven by scripts/screenshot.mjs).
 * Launches the real renderer against the dev mock, walks every state at 420 and 320 px and with
 * reduced motion, saves PNGs and writes checks.json. Not part of the production app.
 */
import { app, session } from 'electron';
import { mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { allowServiceCors, createCompanionWindow, handleMouseIgnore, placeBottomRight, WINDOW } from './window.ts';

/** KT_SHOTS_REAL=<service url>: no mock; walk the real service (scripts/real-check.mjs starts it on a spare port). */
const realUrl = process.env.KT_SHOTS_REAL?.replace(/\/+$/, '');
const outDir = process.env.KT_SHOTS_OUT ?? resolve(__dirname, '../../docs/runs/2026-11-07-overnight/screenshots' + (realUrl ? '/real' : ''));
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
  if (realUrl) allowServiceCors(session.defaultSession, realUrl);
  const win = createCompanionWindow({ serviceUrl: realUrl ?? 'http://127.0.0.1:1', query: realUrl ? { shots: '1' } : { mock: '1', shots: '1' }, show: false });
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
    // Reloading while the first load is still in flight aborts it (ERR_ABORTED, -3): let it finish first.
    if (win.webContents.isLoading()) await new Promise<void>((r) => win.webContents.once('did-stop-loading', () => r()));
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

  /** KT_SHOTS_ENTRANCE=1: capture frames while the launch entrance (drop & settle) plays, right after load. */
  const captureEntrance = async (width: number): Promise<void> => {
    if (process.env.KT_SHOTS_ENTRANCE !== '1') return;
    const t0 = Date.now();
    const frames: Array<{ file: string; atMs: number; mode: string; frame: number }> = [];
    for (let i = 0; i < 10; i++) {
      const image = await win.webContents.capturePage();
      const st = await js<{ avatar: { mode: string; lastFrame: number } }>('__kt.panel.status()');
      const file = `entrance-${String(i).padStart(2, '0')}-${width}.png`;
      writeFileSync(join(outDir, file), image.toPNG());
      frames.push({ file, atMs: Date.now() - t0, mode: st.avatar.mode, frame: st.avatar.lastFrame });
      await sleep(110);
    }
    checks[`entrance_${width}`] = frames;
  };

  const walk = async (width: number): Promise<void> => {
    await load(width);
    await captureEntrance(width);
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

  if (realUrl) {
    await realRun({ url: realUrl, js, waitFor, load, act, shot, step, sleep, states, checks, consoleErrors, outDir });
    return;
  }

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

interface RealCtx {
  url: string;
  js: <T = unknown>(code: string) => Promise<T>;
  waitFor: (cond: string, ms?: number) => Promise<void>;
  load: (width: number) => Promise<void>;
  act: (code: string) => Promise<number>;
  shot: (name: string, width: number, settleMs: number) => Promise<void>;
  step: (name: string, width: number, code: string) => Promise<void>;
  sleep: (ms: number) => Promise<void>;
  states: StateRecord[];
  checks: Record<string, unknown>;
  consoleErrors: string[];
  outDir: string;
}

interface DirEntry { personEntityId: string; name: string; role?: string }
interface QView { questionId: string; investigationId: string; text: string; status: string; caseLabel: string }

/**
 * The real-service sequence at 420 px: identity, a first investigation (people, contact draft), a second one that
 * routes a question to a colleague, answering as that colleague (No, undo, Yes), then the requester again.
 * Everything is driven through the real panel; the Node side only reads the service to pick ids and to verify.
 */
async function realRun(c: RealCtx): Promise<void> {
  const { js, waitFor, act, shot, step, sleep, checks } = c;
  const W = 420;
  const get = async <T,>(path: string): Promise<T> => (await fetch(c.url + path)).json() as Promise<T>;
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

  await c.load(W);
  await js('__s.settle(4000)');
  await sleep(2000);
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
  const attempts: Array<{ text: string; asked: boolean; investigationId?: string; loop?: unknown }> = [];
  checks.secondProblemAttempts = attempts;
  for (const t of candidates) {
    text2 = t;
    await send(t);
    const st = await js<{ investigationId?: string }>('__kt.panel.status()');
    const hasAsk = await js<boolean>('!!document.querySelector(".rf-asked")');
    attempts.push({ text: t, asked: hasAsk, investigationId: st.investigationId, loopReasonShown: await js<string | null>('document.querySelector(".rf-loop-reason")?.textContent ?? null') } as never);
    if (hasAsk) break;
  }
  await shot('result-second', W, 0);
  ids.secondInvestigationId = (await js<{ investigationId?: string }>('__kt.panel.status()')).investigationId;
  checks.secondText = text2;
  checks.secondResultRows = await rowText();
  checks.secondResultTitle = await js<string>('document.querySelector(".rf-result-title").textContent');
  const asked = await js<boolean>('!!document.querySelector(".rf-asked")');
  checks.askedRowShown = asked;

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
    // (h) become the recipient, answer No, undo, answer Yes
    await chooseYou(recipient);
    await shot('settings-recipient', W, 0);
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
  checks.hitbox = { initial: base, final, allStatesEqual: c.states.every((st) => st.hitbox.every((v, i) => v === base[i])) };
  checks.consoleErrors = c.consoleErrors.concat((await js<string[]>('__kt.errors')).map((e) => 'page: ' + e));
  checks.states = c.states;
  checks.finishedAt = new Date().toISOString();
  writeFileSync(join(c.outDir, 'checks-real.json'), JSON.stringify(checks, null, 2));
  console.log(`[shots:real] wrote ${c.states.length} screenshots and checks-real.json to ${c.outDir}; console errors: ${(checks.consoleErrors as string[]).length}`);
  app.quit();
}

main().catch((e) => {
  console.error('[shots] failed', e);
  app.exit(1);
});
