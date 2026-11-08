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
const SERVICE = 'http://127.0.0.1:47831';
const M = join(REPO, 'movie/capture/bin/mouse');
const DRY = process.argv.includes('--dry');
const REC = !DRY || process.argv.includes('--rec');
const REC_SECONDS = 184;
/** Screen point of the "case json" summary on /pipeline after scrolling to the bottom (measured in the dry run). */
const DETAILS = { x: Number(process.env.FILM_DETAILS_X ?? 54), y: Number(process.env.FILM_DETAILS_Y ?? 583) };
const CDP = 9351;
mkdirSync(OUT, { recursive: true });
const CUES = join(OUT, 'cues.txt');
writeFileSync(CUES, '');

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
let T0 = Date.now();
const t = () => (Date.now() - T0) / 1000;
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
const cue = (text) => { const line = `${mmss(t() + 5)}  ${text}`; console.log(line); appendFileSync(CUES, line + '\n'); };
const at = async (s) => { const w = s - t(); if (w > 0) await sleep(w * 1000); };

// ---- hands ----
const mouse = (...a) => execFileSync(M, a.map(String));
const move = (x, y, ms = 700) => mouse('move', Math.round(x), Math.round(y), Math.round(ms));
const click = () => mouse('click');
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
/** Screen point of the centre of an element in Lumi's window. */
async function lumiAt(selector) {
  return cdp(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); if (!r.width) return null; return { x: screenX + r.x + r.width / 2, y: screenY + r.y + r.height / 2 }; })()`);
}
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
    env: { ...process.env, KT_NO_SERVICE: '1', KT_PERSON: 'Artem', KT_QUESTION_POLL_MS: '1000', KT_FILM_ARRIVE: '1' },
  });
  for (let i = 0; i < 60; i++) { try { await cdp('1'); return; } catch { await sleep(250); } }
  throw new Error('Lumi did not start');
}

// ---- Safari ----
const osa = (script) => execFileSync('osascript', ['-e', script]).toString().trim();
const tab = (n) => osa(`tell application "Safari" to set current tab of front window to tab ${n} of front window`);
const safariFront = () => osa('tell application "Safari" to activate');
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
  const real = new Set(dir.filter((d) => d.name === 'Artem' || d.name === 'Mark').map((d) => d.personEntityId));
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
if (REC) rec = spawn('/usr/sbin/screencapture', ['-v', '-V', String(REC_SECONDS), '-x', join(OUT, 'take.mov')], { stdio: 'ignore' });
const recDone = rec ? new Promise((res) => rec.on('exit', res)) : Promise.resolve();
T0 = Date.now();
await launchLumi();
await white(true);
cue('WHITE · Lumi drops in, says hello, goes to the edge (hook)');
await at(4); await glide(700, 560, 1400); await glide(980, 640, 1300);
await at(7.5); await glide(1440, 760, 1500); cue('cursor comes near: Lumi peeks'); await sleep(1600); await glide(1180, 600, 1300);

await at(12); await white(false); safariFront(); tab(2); cue('SLACK · #field-ops: the conversation so far (oat milk, alarms, pizza, the N5 idea)');
await glide(520, 400, 900); await glide(560, 482, 900); await glide(640, 570, 900); await glide(700, 660, 900); await glide(820, 706, 1000);

await at(26); tab(3); cue('PIPELINE · 1. raw (all 8 messages, chatter grey)');
await glide(260, 300, 900); await sleep(1500);
await at(31); cue('2. filtered (only the useful passages, with their message ids)'); await glide(640, 320, 1000); await sleep(1700);
await at(36); cue('3. linked (case TRN-418, symptom / condition / action / outcome, certainty 3 / threshold 4)'); await glide(1000, 300, 900); await glide(1000, 380, 700); await sleep(1500);
await at(42); cue('4. hypothesis (Mark\'s "probably the v6 template…", supporting lines, what is open)'); await glide(1320, 300, 900); await glide(1320, 420, 900); await sleep(1300);
await at(48); cue('stored record: the case as stored (claims, evidence ids, links)');
// "case json" sits under the table: scroll down, click it open, look, click it shut, back to the top.
await glide(DETAILS.x, DETAILS.y, 900); click(); await sleep(2600); await scroll(250); await sleep(1500); await scroll(-250); await sleep(400);
await glide(DETAILS.x, DETAILS.y, 500); click(); await sleep(500); await scroll(-1500); await sleep(500);

await at(57); tab(2); cue('SLACK · Artem types the trigger: "Yes, older N5 unit, installed 2019."');
await glide(900, 781, 900); click(); await sleep(400);
const TRIGGER = 'Yes, older N5 unit, installed 2019.';
if (!DRY) { await typeHuman(TRIGGER); await sleep(300); key(36); } else await sleep(2600);
const sentAt = t();
await sleep(900); tab(3); cue('PIPELINE · certainty 4 / threshold 4: Lumi asks');
await glide(1000, 390, 900);
for (let i = 0; i < 16; i++) { const p = await get('/pipeline.json'); if (p.cases[0]?.certainty?.asked) break; await sleep(500); }
await sleep(1500);
await white(true); cue('WHITE · Lumi comes in by himself with the hypothesis: "… Is this a problem?"');
await glide(760, 520, 1100);
let opened = false;
for (let i = 0; i < 40; i++) { const s = await lumiState(); if (s.open && s.view === 'question') { opened = true; break; } await sleep(250); }
cue(opened ? `the card is open (${(t() - sentAt).toFixed(1)} s after the Slack message)` : 'the card did not open in time');
await sleep(2500);
let p = await lumiAt('[data-action="context"]'); if (p) { await glide(p.x, p.y, 1100); click(); cue('Why this question? (the Slack messages behind it)'); }
await sleep(4200);
p = await lumiAt('section[data-view="question"] [data-action="yes"]'); if (p) { await glide(p.x, p.y, 1000); await sleep(400); click(); cue('Artem: Yes · the case is recorded as a confirmed problem'); }
await sleep(3500);

await at(90); await white(false); safariFront(); tab(2); cue('SLACK · Artem: "Applied the v7.1 patch on TRN-418."');
await glide(900, 781, 800); click();
if (!DRY) { await typeHuman('Applied the v7.1 patch on TRN-418.'); await sleep(250); key(36); } else await sleep(2500);
await sleep(700); tab(4); cue('QUESTIONS · colleagues (simulated) hit the same symptom; Lumi picks the question and who can know');
if (!DRY) void simulate();
await glide(400, 260, 900);
await at(100); await glide(760, 520, 1100); cue('open condition → question → who can know (score, reasons, gates)');
await at(108); await glide(1200, 560, 1000); await sleep(2000);
await at(113); cue('answers arrive (tagged simulated) → evidence → result'); await scroll(500); await sleep(2500); await glide(700, 600, 900);
await at(120); await scroll(400); cue('ALL QUESTIONS: every question, who asked, to whom, why, the answer'); await glide(800, 700, 1000); await sleep(1500); await scroll(-900);

await at(126); tab(2); cue('SLACK · solved: "traffic is back", "still stable 2 h"');
await glide(900, 781, 800); click();
if (!DRY) { await typeHuman('TRN-418 traffic is back after the patch, alarms cleared.', 0.4); key(36); await sleep(700); await typeHuman('TRN-418 traffic still stable 2 h after the v7.1 patch. Closing it.', 0.4); key(36); } else await sleep(5000);
await sleep(1500); tab(4); await sleep(2600); cue('CHAIN · problem → condition → cause → action → outcome, complete');
await glide(1350, 230, 1000); await glide(200, 230, 1600); await sleep(1200);

await at(141); await white(true); cue('WHITE · Lumi himself: ask him in plain words');
const avatar = async () => lumiAt('[data-action="avatar"]');
let a = await avatar(); if (a) { await glide(Math.min(a.x, 1500), a.y, 1200); await sleep(700); click(); }
await sleep(1500); a = await avatar(); if (a) { await glide(a.x, a.y, 500); click(); }
await sleep(1000);
p = await lumiAt('.rf-writing'); if (p) { await glide(p.x, p.y, 600); click(); await typeHuman('TRN-430: link up, no traffic after the v6 rollout.', 0.7); }
p = await lumiAt('[data-action="send"]'); if (p) { await glide(p.x, p.y, 500); if (!DRY) click(); }
await sleep(4500); cue('his answer: what to check, from whose experience, what is still unknown');
await sleep(1500); a = await avatar(); if (a) { await glide(a.x, a.y, 600); click(); }
await sleep(900); a = await avatar(); if (a) { await glide(a.x, a.y - 4, 400); mouse('down'); cue('pick him up, carry him across'); mouse('move', 820, 430, 1500, 'drag'); await sleep(150); mouse('up'); }
await sleep(1800);

await at(164); cue('TERMINAL · an AI agent asks Lumi over MCP');
osa(`tell application "Terminal"
  activate
  do script "cd ${REPO} && clear && pnpm -s film:agent --db '${db}'"
  set bounds of front window to {120, 60, 1392, 880}
end tell`);
// Bigger text for this one window only (⌘+, like a person would; the Terminal profile is not touched).
await sleep(400); for (let i = 0; i < 4; i++) { key(24, 'cmd'); await sleep(120); }
await sleep(Math.max(0, (REC_SECONDS - t()) * 1000) + 1500);

// ---- finish ----
await recDone;
killLumi();
console.log(`recorded ${t().toFixed(1)} s`);
if (!DRY && FILM && existsSync(join(OUT, 'take.mov'))) {
  const final = join(OUT, 'lumi-demo.mp4');
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', join(FILM, 'intro.mp4'), '-i', join(OUT, 'take.mov'), '-filter_complex',
    '[1:v]fps=60,scale=1920:1248:flags=lanczos,format=yuv420p[b];[0:v]fps=60,format=yuv420p[a];[a][b]concat=n=2:v=1:a=0[v]', '-map', '[v]', '-c:v', 'libx264', '-crf', '18', '-preset', 'slow', final]);
  console.log(`video: ${final}`);
}
console.log(`cues: ${CUES}`);
