#!/usr/bin/env node
/**
 * The 3-minute demo video, recorded from the real screen (8 Nov). Needs the live film run (pnpm film … on port 47831,
 * the 8 pre-recording lines already in #field-ops, certainty 3 / 4), Safari signed in to Slack, and nobody touching the
 * Mac while it runs. It drives a real cursor and real key presses (movie/capture/bin/mouse, CGEvents), types Artem's
 * lines into Slack key by key, lets the real pipeline and Lumi react, runs the simulated colleagues (answers stored as
 * "simulated"), and ends on the MCP agent in Terminal. Then it puts the 5 s logo intro in front.
 *
 *   node scripts/film-video.mjs [--dry]   --dry: cursor and pages only; nothing typed into Slack, no recording
 *   output: <out>/lumi-demo.mp4 and <out>/cues.txt (what happens when, for the voiceover)
 * Staging said out loud: the white background behind Lumi is Lumi's own window turned white (DevTools, port 9351);
 * Lumi's own clicks (Yes, send) are real clicks on the real app.
 */
import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const REPO = '/Users/artevil/Since-AI-hackathon---Artem';
const OUT = process.env.FILM_OUT ?? join(REPO, 'data', 'local', 'film-video');
const FILM = process.env.FILM_ASSETS; // intro.mp4 lives here
const SERVICE = `http://127.0.0.1:${process.env.FILM_PORT ?? 47831}`;
const M = join(REPO, 'movie/capture/bin/mouse');
const DRY = process.argv.includes('--dry');
const REC = !DRY || process.argv.includes('--rec');
/** Lumi's own sends (Remember this, a question): always in a take; in a dry run only against a preview service. */
const LUMI_SENDS = !DRY || (process.env.FILM_PORT ?? '47831') !== '47831';
const REC_SECONDS = Number(process.env.FILM_REC ?? 162);
/** Screen point of the "case json" summary on /pipeline after scrolling to the bottom (measured in the dry run). */
const DETAILS = { x: Number(process.env.FILM_DETAILS_X ?? 54), y: Number(process.env.FILM_DETAILS_Y ?? 583) };
const CDP = 9351;
mkdirSync(OUT, { recursive: true });
const CUES = join(OUT, 'cues.txt');
/** Where Part 1 (capture) and Part 2 (confidence) begin in the take, for the title cards. */
const MARK = { part1: 9, part2: 37 };
writeFileSync(CUES, '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
let T0 = Date.now();
const t = () => (Date.now() - T0) / 1000;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const cue = (text) => { const v = t() + 5 + (t() >= MARK.part1 ? 2.5 : 0) + (t() >= MARK.part2 ? 2.5 : 0); const line = `${mmss(v)}  ${text}`; console.log(line); appendFileSync(CUES, line + '\n'); };
const at = async (s) => { const w = s - t(); if (w > 0) await sleep(w * 1000); };

// ---- hands ----
const mouse = (...a) => execFileSync(M, a.map(String));
const move = (x, y, ms = 700) => mouse('move', Math.round(x), Math.round(y), Math.round(ms));
/** Clicks only inside the safe area (never the Dock, the menu bar or off-screen). */
const click = () => {
  const [x, y] = execFileSync(M, ['pos']).toString().trim().split(' ').map(Number);
  if (y < 40 || y > 885 || x < 2 || x > 1508) { console.log(`  (click at ${x},${y} refused: outside the safe area)`); return; }
  mouse('click');
};
const key = (code, mods) => (mods ? mouse('key', code, mods) : mouse('key', code));
async function glide(x, y, ms) { move(x + rnd(-3, 3), y + rnd(-2, 2), ms ?? rnd(550, 900)); await sleep(rnd(120, 260)); }
async function typeHuman(text, speed = 1) {
  for (const ch of text) {
    mouse('type', ch);
    await sleep(speed * (ch === ' ' ? rnd(50, 120) : /[.,:?]/.test(ch) ? rnd(90, 180) : rnd(15, 60)));
  }
}

// ---- Lumi (DevTools) ----
async function cdp(expression) {
  const pages = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
  const page = pages.find((p) => p.type === 'page');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const out = await new Promise((r) => { ws.onmessage = (m) => r(JSON.parse(String(m.data)).result?.result?.value); ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } })); });
  ws.close();
  return out;
}
/** Type into Lumi key by key through DevTools (Input.insertText per character, same rhythm as typeHuman). */
async function typeLumi(text, speed = 1) {
  const pages = await (await fetch(`http://127.0.0.1:${CDP}/json`)).json();
  const ws = new WebSocket(pages.find((x) => x.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let id = 0;
  for (const ch of text) {
    await new Promise((res) => { const my = ++id; ws.onmessage = (m) => { if (JSON.parse(String(m.data)).id === my) res(); }; ws.send(JSON.stringify({ id: my, method: 'Input.insertText', params: { text: ch } })); });
    await sleep(speed * (ch === ' ' ? rnd(60, 130) : /[.,:?]/.test(ch) ? rnd(100, 190) : rnd(40, 95)));
  }
  ws.close();
}
/** Screen point of the centre of an element in Lumi's window. */
async function lumiAt(selector) {
  // Only an element that is really visible and on top at its centre (a hidden panel's buttons never count).
  return cdp(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e || e.disabled || e.closest('[hidden]')) return null; const r = e.getBoundingClientRect(); if (!r.width || !r.height) return null; const cx = r.x + r.width / 2, cy = r.y + r.height / 2; const top = document.elementFromPoint(cx, cy); if (!top || !(top === e || e.contains(top))) return null; return { x: screenX + cx, y: screenY + cy }; })()`);
}
/** Make Lumi's app the active one, so key presses go to him (Safari stays behind). */
const focusLumi = () => { try { execFileSync('osascript', ['-e', `tell application "System Events" to set frontmost of (first process whose unix id is ${lumi.pid}) to true`]); } catch { /* best effort */ } };
const white = (on) => cdp(`document.documentElement.style.background = document.body.style.background = ${on ? "'#ffffff'" : "'transparent'"}; 1`);
const lumiState = () => cdp(`({ open: !!document.querySelector('[aria-label="Close panel"]'), view: document.querySelector('.rf-stage')?.dataset.view ?? '', q: document.querySelector('section[data-view="question"] h2')?.textContent ?? '' })`);

let lumi;
async function launchLumi() {
  try { execFileSync('pkill', ['-f', 'lumi-film-artem-ud']); } catch { /* none running */ }
  await sleep(800);
  const ud = join(OUT, 'lumi-film-artem-ud');
  rmSync(ud, { recursive: true, force: true });
  const electron = createRequire(join(REPO, 'package.json'))('electron');
  lumi = spawn(electron, [join(REPO, 'dist/desktop/main.cjs'), `--user-data-dir=${ud}`, `--remote-debugging-port=${CDP}`], {
    stdio: 'ignore', detached: true,
    env: { ...process.env, KT_NO_SERVICE: '1', KT_SERVICE_URL: SERVICE, KT_PERSON: ARTEM_ID, KT_QUESTION_POLL_MS: '1000', KT_FILM_ARRIVE: '1' },
  });
  for (let i = 0; i < 60; i++) { try { await cdp('1'); return; } catch { await sleep(250); } }
  throw new Error('Lumi did not start');
}

// ---- Safari ----
const osa = (script) => execFileSync('osascript', ['-e', script]).toString().trim();
// The film window and its tabs are found by URL, so other Safari windows or a closed tab never get in the way.
// tab(1) white (no web page needed: Lumi's own window is the white stage), tab(2) Slack, tab(3) /pipeline, tab(4) /pipeline/questions.
const FILMWIN = Number(osa(`tell application "Safari"
  repeat with w in every window
    repeat with t in every tab of w
      if (URL of t) ends with "47831/pipeline/questions" then return id of w
    end repeat
  end repeat
  return 0
end tell`));
if (!FILMWIN) { console.log('No Safari window with the film tabs (Slack #field-ops · /pipeline · /pipeline/questions).'); process.exit(2); }
const URLS = { 1: '47831/pipeline', 2: 'C0CFSG604RL', 3: '47831/pipeline', 4: '47831/pipeline/questions' };
const tab = (n) => osa(`tell application "Safari"
  set w to window id ${FILMWIN}
  set index of w to 1
  repeat with t in every tab of w
    if (URL of t) ends with "${URLS[n]}" then
      set current tab of w to t
      exit repeat
    end if
  end repeat
end tell`);
const safariFront = () => osa(`tell application "Safari"
  activate
  set index of window id ${FILMWIN} to 1
end tell`);
const scroll = async (dy, steps = 6) => { for (let i = 0; i < steps; i++) { mouse('scroll', Math.round(dy / steps)); await sleep(45); } };

// ---- service ----
const get = async (p) => (await fetch(SERVICE + p)).json();
const post = async (p, body) => { const r = await fetch(SERVICE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`${p} ${r.status}`); return r.json(); };

// ---- simulated colleagues (same as pnpm film's s key) ----
const SIM = [
  { by: 'Aarne Koskela', text: 'TRN-420 at Raisio: link is up but no traffic after the v6 template rollout.', asset: 'TRN-420', older: true },
  { by: 'Kaisa Hautala', text: 'TRN-422 at Lieto: link is up but no traffic after the v6 template rollout.', asset: 'TRN-422', older: false },
  { by: 'Marja Niemi', text: 'TRN-425 at Kupittaa: link is up but no traffic, older N5 unit, after the v6 template rollout.', asset: 'TRN-425', older: true },
];
async function simulate() {
  const dir = await get('/directory');
  const real = new Set(dir.filter((d) => /^(Artem|Mark)\b/.test(d.name)).map((d) => d.personEntityId));
  const inv = new Set(); const done = new Set();
  const answerer = setInterval(async () => {
    const open = await get('/questions?status=delivered').catch(() => []);
    for (const q of open) {
      if (!inv.has(q.investigationId) || done.has(q.questionId) || real.has(q.personEntityId)) continue;
      done.add(q.questionId);
      const s = SIM.find((x) => q.text.includes(x.asset));
      const value = /older|N5|2019/i.test(q.text) ? (s?.older === false ? 'no' : 'yes') : 'yes';
      const p = dir.find((d) => d.personEntityId === q.personEntityId);
      setTimeout(() => void post(`/questions/${encodeURIComponent(q.questionId)}/answer`, { principal: { id: q.personEntityId, displayName: `${p?.name ?? q.personEntityId} (simulated)`, groups: p?.groups ?? [], type: 'human' }, value, text: 'simulated' }).catch(() => {}), 2500);
    }
  }, 700);
  for (const s of SIM) {
    const p = dir.find((d) => d.name === s.by);
    if (!p) continue;
    const r = await post('/investigate', { text: s.text, principal: { id: p.personEntityId, displayName: `${s.by} (simulated)`, groups: p.groups, type: 'human' }, allowQuestions: true });
    inv.add(r.investigationId);
    await sleep(5500);
  }
  setTimeout(() => clearInterval(answerer), 25_000);
}

// Safety: whatever happens, the film Lumi (and its white background) goes away when this script ends.
const killLumi = () => { try { execFileSync('pkill', ['-9', '-f', 'lumi-film-artem-ud']); } catch { /* none */ } };
process.on('exit', killLumi);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, () => process.exit(130));
process.on('uncaughtException', (e) => { console.error(e); process.exit(1); });
process.on('unhandledRejection', (e) => { console.error(e); process.exit(1); });

// ---- pre-flight ----
const pre = await get('/pipeline.json');
const c0 = pre.cases[0];
console.log(`pre-flight: ${pre.raw.length} messages; ${c0 ? `${c0.title} certainty ${c0.certainty.messages}/${c0.certainty.threshold} asked ${c0.certainty.asked}` : 'no case'}`);
if (!DRY && (!c0 || c0.certainty.asked || c0.certainty.messages !== 3)) { console.log('Not in the pre-recording state (need certainty 3/4, nothing asked). Reset the live run (r) first.'); process.exit(2); }
const health = await get('/health');
// Artem's person as the store names him (with Slack ids mapped it is his Slack name, e.g. "Artem Sergeyev").
const ARTEM_ID = (await get('/directory')).find((d) => /^Artem\b/.test(d.name))?.personEntityId;
if (!ARTEM_ID) { console.log('No Artem in the directory.'); process.exit(2); }
console.log(`Artem's Lumi person: ${ARTEM_ID}`);
const db = health.store;
// Slack's banner off, Safari at the white tab.
safariFront(); tab(2); await sleep(1200);
// Slack's bottom banners (Slackbot news, notifications) closed; the pages at actual size.
for (let i = 0; i < 2; i++) { try { move(1489, 875, 300); click(); await sleep(900); } catch { /* none */ } }
tab(3); await sleep(500); key(29, 'cmd'); await sleep(400); // actual size (⌘0), so the measured click points hold
tab(1); await sleep(500);
move(756, 520, 400);

// ---- RECORD ----
let rec;
rmSync(join(OUT, 'take.mov'), { force: true }); // screencapture never overwrites an existing file
if (REC) rec = spawn('/usr/sbin/screencapture', ['-v', '-V', String(REC_SECONDS), '-x', join(OUT, 'take.mov')], { stdio: 'ignore' });
const recDone = rec ? new Promise((res) => rec.on('exit', res)) : Promise.resolve();
T0 = Date.now();
await launchLumi();
await white(true);
const ONLY_LUMI = process.argv.includes('--only-lumi');
if (ONLY_LUMI) { await sleep(3500); T0 = Date.now() - 107000; }
let p;
if (!ONLY_LUMI) {
cue('WHITE · Lumi drops in, says hello and runs off to the edge (hook)');
await at(3.5); await glide(700, 560, 1300); await glide(980, 640, 1200);
await at(6); await glide(1440, 760, 1400); cue('the cursor comes near: Lumi peeks'); await sleep(1300); await glide(1150, 600, 1000);

// PART 1 · capture
await at(9); MARK.part1 = t(); await white(false); safariFront(); tab(2); cue('SLACK · #field-ops: oat milk, alarms, pizza, and in between a real problem');
await glide(560, 482, 1000); await glide(640, 570, 900); await glide(820, 706, 1100);
await at(16); tab(3); cue('PIPELINE · 1. raw: every message, chatter in grey');
await glide(260, 330, 900); await sleep(1600);
await at(21); cue('2. filtered: only the useful passages, each with its message id'); await glide(640, 360, 1000); await sleep(1800);
await at(26); cue('3. linked: one case, TRN-418 · certainty 3 / threshold 4'); await glide(1000, 340, 900); await glide(1000, 580, 900); await sleep(1500);
await at(31); cue('4. hypothesis: Mark\'s "probably the v6 template…", what supports it, what is open'); await glide(1320, 340, 900); await glide(1320, 470, 1000); await sleep(1500);

// PART 2 · confidence
await at(37); MARK.part2 = t(); tab(2); cue('SLACK · Artem sends one more message: "Yes, older N5 unit, installed 2019."');
await glide(900, 781, 900); click(); await sleep(350);
const TRIGGER = 'Yes, older N5 unit, installed 2019.';
if (!DRY) { await typeHuman(TRIGGER, 0.8); await sleep(300); key(36); } else await sleep(2600);
const sentAt = t();
await sleep(800); tab(3); cue('PIPELINE · certainty 4 / threshold 4: enough to ask someone');
await glide(1000, 580, 900);
for (let i = 0; i < 20; i++) { const pj = await get('/pipeline.json'); if (pj.cases[0]?.certainty?.asked) break; await sleep(400); }
await sleep(1200);
await white(true); cue('WHITE · Lumi comes in from the side with the hypothesis: "… Is this a problem?"');
await glide(760, 520, 1000);
let opened = false;
for (let i = 0; i < 48; i++) { const st = await lumiState(); if (st.open && st.view === 'question') { opened = true; break; } await sleep(250); }
cue(opened ? `the card is open, ${(t() - sentAt).toFixed(1)} s after the Slack message` : 'THE CARD DID NOT OPEN');
await sleep(3000);
p = await lumiAt('[data-action="context"]'); if (p) { await glide(p.x, p.y, 1100); click(); cue('Why this question? the Slack messages behind it'); }
await sleep(3800);
p = await lumiAt('section[data-view="question"] [data-action="yes"]'); if (p) { await glide(p.x, p.y, 1000); await sleep(350); click(); cue('Artem taps Yes: a confirmed problem, with his answer as evidence'); }
await sleep(3200);

await at(68); await white(false); safariFront(); tab(2); cue('SLACK · "Applied the v7.1 patch on TRN-418."');
await glide(900, 781, 800); click();
if (!DRY) { await typeHuman('Applied the v7.1 patch on TRN-418.', 0.6); await sleep(250); key(36); } else await sleep(2500);
await sleep(600); tab(4); cue('QUESTIONS · colleagues (simulated) hit the same symptom; Lumi decides what to ask and whom');
if (!DRY) void simulate();
await glide(300, 290, 900); await glide(900, 300, 1200);
await at(80); await glide(700, 470, 1000); cue('latest question: who was asked and why, who else could, the answer, what changed');
await at(86); await glide(500, 650, 1000); cue('all questions'); await sleep(2500);

await at(92); tab(2); cue('SLACK · solved: "traffic is back", "still stable 2 h"');
await glide(900, 781, 800); click();
if (!DRY) { await typeHuman('TRN-418 traffic is back after the patch, alarms cleared.', 0.35); key(36); await sleep(600); await typeHuman('TRN-418 traffic still stable 2 h after the v7.1 patch. Closing it.', 0.35); key(36); } else await sleep(5000);
await sleep(1600); tab(4); await sleep(1800); cue('WHAT WE KNOW · problem → condition → cause → fix → outcome');
await glide(1400, 240, 1000); await glide(200, 240, 1500); await sleep(800);

} // end of the parts before Lumi himself
// LUMI himself
await at(107); await white(true); cue('WHITE · Lumi: ask him in plain words');
// Lumi himself: aim at the part of him that is on screen (away, only a sliver at the edge shows).
const avatar = async () => cdp(`(() => { const e = document.querySelector('[data-action="avatar"]'); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width) return null; const x = Math.min(r.x + r.width / 2, innerWidth - 6), y = r.y + r.height / 2; return { x: screenX + x, y: screenY + y }; })()`);
let a = await avatar(); if (a) { await glide(Math.min(a.x, 1500), a.y, 1100); await sleep(600); click(); }
await sleep(1400); a = await avatar(); if (a) { await glide(a.x, a.y, 500); click(); }
await sleep(900);
// 1. Remember this: a note becomes knowledge, nobody is asked.
p = await lumiAt('.rf-writing'); if (p) { focusLumi(); await glide(p.x, p.y, 600); click(); cue('Remember this: tell him something worth keeping'); await typeLumi('N5 units: never roll back to the v6 template, apply v7.1.', 0.5); }
p = await lumiAt('.rf-footer [data-action="remember"]'); if (p) { await glide(p.x, p.y, 600); if (LUMI_SENDS) click(); }
await sleep(3000);
// 2. Back to writing (the pencil, only while it is labelled "Write a message"; in the writing view it would attach files).
p = await lumiAt('[aria-label="Write a message"]'); if (p) { await glide(p.x, p.y, 700); click(); await sleep(800); }
p = await lumiAt('.rf-writing'); if (p) { focusLumi(); await glide(p.x, p.y, 600); click(); cue('ask him in plain words'); await typeLumi('TRN-430: link up, no traffic after the v6 rollout.', 0.6); }
p = await lumiAt('.rf-footer [data-action="send"]'); if (p) { await glide(p.x, p.y, 500); if (LUMI_SENDS) click(); }
await sleep(4200); cue('his answer: what to check first, from which case, what is still unknown');
p = await lumiAt('.rf-row-button[data-action="people"]'); if (p) { await glide(p.x, p.y, 900); click(); cue('people with relevant experience, and why each'); await sleep(3600); }
p = await lumiAt('section[data-view="people"] [data-action="back"]'); if (p) { await glide(p.x, p.y, 700); click(); await sleep(700); }
p = await lumiAt('.rf-footer [data-action="queue"]'); if (p) { await glide(p.x, p.y, 700); click(); cue('his questions for you'); await sleep(2400); }
// 3. Play: close, pick him up, carry him, let go.
a = await avatar(); if (a) { await glide(a.x, a.y, 600); click(); }
await sleep(900); a = await avatar(); if (a && a.y < 885) { await glide(a.x, a.y - 4, 400); mouse('down'); cue('and he is fun to have around'); mouse('move', 760, 420, 1500, 'drag'); await sleep(120); mouse('up'); }
await sleep(2200); a = await avatar(); if (a) { await glide(a.x + 60, Math.min(a.y - 80, 800), 900); }
await sleep(1000);

await at(148); cue('TERMINAL · an AI agent asks Lumi over MCP');
osa(`tell application "Terminal"
  activate
  do script "cd ${REPO} && clear && pnpm -s film:agent --db '${db}'"
  set bounds of front window to {120, 60, 1392, 880}
end tell`);
// Bigger text for this one window only (⌘+, like a person would; the Terminal profile is not touched).
await sleep(400); for (let k = 0; k < 4; k++) { key(24, 'cmd'); await sleep(120); }
await sleep(Math.max(0, (REC_SECONDS - t()) * 1000) + 1500);

// ---- finish ----
await recDone;
killLumi();
console.log(`recorded ${t().toFixed(1)} s`);
writeFileSync(join(OUT, 'markers.json'), JSON.stringify(MARK));
if (!DRY && FILM && existsSync(join(OUT, 'take.mov'))) {
  // intro · hook · card 1 · Part 1 · card 2 · Part 2 and the rest. The cards sit between cuts of the one continuous take.
  const final = join(OUT, 'lumi-demo.mp4');
  const a = MARK.part1.toFixed(3), b = MARK.part2.toFixed(3);
  const take = (from, to) => `[1:v]trim=start=${from}${to ? `:end=${to}` : ''},setpts=PTS-STARTPTS,fps=60,scale=1920:1248:flags=lanczos,format=yuv420p`;
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', join(FILM, 'intro.mp4'), '-i', join(OUT, 'take.mov'), '-i', join(FILM, 'card1.mp4'), '-i', join(FILM, 'card2.mp4'), '-filter_complex',
    `[0:v]fps=60,format=yuv420p[i];${take(0, a)}[h];[2:v]fps=60,format=yuv420p[c1];${take(a, b)}[p1];[3:v]fps=60,format=yuv420p[c2];${take(b)}[p2];[i][h][c1][p1][c2][p2]concat=n=6:v=1:a=0[v]`,
    '-map', '[v]', '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', final]);
  console.log(`video: ${final}`);
}
console.log(`cues: ${CUES}`);
