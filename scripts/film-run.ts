/**
 * The filmed run (8 Nov), one command: the service on a temp database (film limits: no quiet hours, no cooldown, several
 * open questions per person), the Slack poller, and a simulation driver that waits for Artem's key. Local only; the temp
 * database is deleted on exit. Everything else is in docs/film-pages/RUN_OF_SHOW.md.
 *
 *   pnpm film --workspace "<team>" --channel "#<channel>" --artem-slack U… --mark-slack U… [--lan auto]
 *        LIVE, read only: needs KT_SLACK_LIVE=1 and KT_SLACK_TOKEN. --lan also serves the service on this Mac's LAN
 *        address (one private IPv4, never 0.0.0.0) for Mark's Mac.
 *   pnpm film --replay [--desktops]          REHEARSAL: a fake workspace; t/f/b type the trigger, the fix, the solved lines
 *   pnpm film --replay --auto [--desktops]   unattended rehearsal of the whole run, with measured latencies; stand-in
 *                                            answers for Artem and Mark are printed as such (never in a live run)
 * Keys: t trigger · f fix · b solved (replay only) · s simulated phase · r reset (retake) · q quit and clean up
 * Options: [--convo docs/film-pages/CONVO_ARTEM_MARK.md] [--port 47831] [--confirm-after 4] [--every 3000] [--poll-ms 2000]
 *          [--qpoll 1000] [--keep-db]
 *
 * The conversation file has four ```text blocks in order: before recording, the trigger line, the fix, solved.
 * Simulated colleagues ask Lumi through /investigate; the real coordinator picks the questions and recipients; the
 * driver answers as those recipients (answer text "simulated", name suffix "(simulated)"), never as Artem or Mark.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { networkInterfaces, tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { PeopleDirectory } from '../src/libs/utils/contracts/index.ts';
import { createFakeSlack, createSlackPoller, memoryTracking, slackWebClient, pollerGuard, type SlackPoller, type SlackReadClient } from '../src/libs/utils/connectors/index.ts';
import { REPO_ROOT } from '../src/apps/service/paths.ts';
import { httpClient } from '../src/libs/utils/simulation/index.ts';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: '47831' },
    replay: { type: 'boolean', default: false },
    auto: { type: 'boolean', default: false },
    desktops: { type: 'boolean', default: false },
    workspace: { type: 'string' },
    channel: { type: 'string' },
    'artem-slack': { type: 'string' },
    'mark-slack': { type: 'string' },
    lan: { type: 'string' },
    convo: { type: 'string', default: join(REPO_ROOT, 'docs/film-pages/CONVO_ARTEM_MARK.md') },
    'confirm-after': { type: 'string', default: '4' },
    every: { type: 'string', default: '3000' },
    'poll-ms': { type: 'string', default: '2000' },
    qpoll: { type: 'string', default: '1000' },
    'keep-db': { type: 'boolean', default: false },
  },
});
const say = (s = ''): void => { process.stdout.write(s + '\n'); };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const secs = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

// ---- the script ----
const blocks = [...readFileSync(values.convo, 'utf8').matchAll(/```text\n([\s\S]*?)```/g)].map((m) => m[1]!.split('\n')
  .map((l) => /^\s*([A-Za-zÀ-ÿ][\wÀ-ÿ .-]{0,30}?):\s+(.+)$/.exec(l)).filter((x): x is RegExpExecArray => !!x).map((x) => ({ who: x[1]!.trim(), text: x[2]!.trim() })));
if (blocks.length < 4) { say(`${values.convo}: expected four \`\`\`text blocks (before recording, trigger, fix, solved), found ${blocks.length}.`); process.exit(2); }
const [pre, trigger, fix, solved] = blocks as [typeof blocks[0], typeof blocks[0], typeof blocks[0], typeof blocks[0]];

// ---- live guard and identities first: refuse before starting anything ----
const ARTEM = 'person:directory:artem', MARK = 'person:directory:mark';
/** The entity ids the store resolved Artem and Mark to (the driver never answers for them). */
const REAL = new Set<string>([ARTEM, MARK]);
const slackIds = values.replay ? { artem: 'U0FILMART', mark: 'U0FILMMRK' } : { artem: values['artem-slack'], mark: values['mark-slack'] };
if (!values.replay) {
  const g = pollerGuard({ live: process.env.KT_SLACK_LIVE, token: process.env.KT_SLACK_TOKEN, workspace: values.workspace, channel: values.channel });
  const missing = [...g.missing, ...(slackIds.artem ? [] : ['--artem-slack U… (Artem\'s Slack member id)']), ...(slackIds.mark ? [] : ['--mark-slack U… (Mark\'s Slack member id)'])];
  if (missing.length) {
    say('Live run refused. Missing:');
    for (const m of missing) say(`  - ${m}`);
    say('Slack app: docs/film-pages/slack-app-manifest.yml. Member id: Slack → the person\'s profile → ⋮ → Copy member ID.');
    say('Rehearse without Slack: pnpm film --replay');
    process.exit(2);
  }
}
const directory: PeopleDirectory = {
  people: [
    { id: ARTEM, name: 'Artem', role: 'Field Engineer', groups: ['field'], actorIds: [`person:slack:${slackIds.artem}`], available: true },
    { id: MARK, name: 'Mark', role: 'Network Expert', groups: ['transport'], actorIds: [`person:slack:${slackIds.mark}`], available: true },
  ],
} as PeopleDirectory;

// ---- LAN address (only a private IPv4 of this Mac) ----
let lanHost: string | undefined;
if (values.lan) {
  const isPrivate = (ip: string) => /^10\./.test(ip) || /^192\.168\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  const mine = Object.values(networkInterfaces()).flat().filter((a) => a && a.family === 'IPv4' && !a.internal).map((a) => a!.address);
  lanHost = values.lan === 'auto' ? mine.find(isPrivate) : values.lan;
  if (!lanHost || !isPrivate(lanHost) || !mine.includes(lanHost)) { say(`--lan: no private IPv4 of this Mac matches (${values.lan}); found: ${mine.join(', ') || 'none'}.`); process.exit(2); }
}

// ---- 1. service on a temp database ----
const url = `http://127.0.0.1:${values.port}`;
const service = httpClient(url);
const db = join(tmpdir(), `lumi-film-${Date.now()}.db`);
const children: ChildProcess[] = [];
const svc = spawn(process.execPath, [join(REPO_ROOT, 'src/apps/service/main.ts'), '--port', values.port, '--db', db, '--seed', 'elisa', '--film', '--quiet-hours', 'off',
  '--confirm-after', values['confirm-after'], ...(lanHost ? ['--lan-host', lanHost] : [])], { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, KT_AUTO_MODELS: '0' } });
children.push(svc);
let svcErr = '';
svc.stderr!.on('data', (d: Buffer) => { svcErr = (svcErr + d.toString()).slice(-2000); });
let cleaned = false;
const cleanup = (code = 0): never => {
  if (!cleaned) {
    cleaned = true;
    for (const c of children) c.kill('SIGTERM');
    if (!values['keep-db']) for (const ext of ['', '-wal', '-shm']) rmSync(db + ext, { force: true });
    say(values['keep-db'] ? `\nStopped. Database kept: ${db}` : '\nStopped. Temp database deleted.');
  }
  process.exit(code);
};
process.on('SIGINT', () => cleanup(0));
for (let i = 0; ; i++) {
  if (await service.get<{ ok: boolean }>('/health').then((h) => h.ok, () => false)) break;
  if (i > 80 || svc.exitCode !== null) { say(`Service did not start on ${url}:\n${svcErr}`); cleanup(1); }
  await sleep(250);
}
const markUrl = lanHost ? `http://${lanHost}:${values.port}` : url;
say(`Service: ${url}${lanHost ? ` and ${markUrl} (LAN)` : ''} · temp db ${db}`);
say(`         film limits on (no quiet hours, no cooldown); confirm question at ${values['confirm-after']} supporting messages`);
say(`Pages:   ${url}/pipeline   ${url}/pipeline/questions`);
say(`Artem's Lumi:  KT_NO_SERVICE=1 KT_PERSON=Artem KT_QUESTION_POLL_MS=${values.qpoll} KT_FILM_ARRIVE=1 pnpm desktop`);
say(`Mark's Lumi:   KT_NO_SERVICE=1 KT_SERVICE_URL=${markUrl} KT_PERSON=Mark KT_QUESTION_POLL_MS=${values.qpoll} KT_FILM_ARRIVE=1 pnpm desktop`);
say(`Finale:  pnpm film:agent --db ${db}`);

// ---- 2. Slack ----
const pollMs = Math.max(1000, Number(values['poll-ms']) || 2000);
// Every history read passes through here: it remembers what it saw (for the trigger time) and, after a reset, hides the
// lines that came after the pre-recording ones in the previous take.
let historyFilter: ((ts: number) => boolean) | undefined;
let lastHistory: Array<{ ts: string; text?: string }> = [];
// Slack allows users.list / conversations.list about 20 times a minute: everything except the history is cached for a
// minute, so only conversations.history runs every poll.
const slow = new Map<string, { at: number; r: Record<string, unknown> }>();
const wrap = (read: SlackReadClient): SlackReadClient => ({
  async call(method, params) {
    if (method !== 'conversations.history') {
      const key = method + JSON.stringify(params ?? {});
      const hit = slow.get(key);
      if (hit && Date.now() - hit.at < 60_000) return hit.r;
      const r = await read.call(method, params);
      slow.set(key, { at: Date.now(), r });
      return r;
    }
    const r = await read.call(method, params);
    lastHistory = (r.messages as Array<{ ts: string; text?: string }>) ?? [];
    return historyFilter ? { ...r, messages: lastHistory.filter((m) => historyFilter!(Number(m.ts))) } : r;
  },
});
const noDm = { call: async (m: string) => { throw new Error(`read-only: ${m}`); } };
let fake: ReturnType<typeof createFakeSlack> | undefined;
let typedAt = new Map<string, number>();
function newFake(): ReturnType<typeof createFakeSlack> {
  const f = createFakeSlack({ team: { id: 'T0FILM0001', name: 'Film Sandbox' }, channel: { id: 'C0FILM0001', name: 'field-ops' },
    users: [{ id: slackIds.artem!, real_name: 'Artem' }, { id: slackIds.mark!, real_name: 'Mark' }], startTs: Math.floor(Date.now() / 1000) - 3600 });
  for (const l of pre) f.type(l.who === 'Mark' ? slackIds.mark! : slackIds.artem!, l.text); // already in the channel before recording
  return f;
}
function newPoller(): SlackPoller {
  const read = values.replay ? (fake = newFake()).read : slackWebClient(process.env.KT_SLACK_TOKEN as string);
  return createSlackPoller({ read: wrap(read), dm: noDm, service, tracking: memoryTracking(),
    config: { workspace: values.replay ? 'Film Sandbox' : values.workspace!, channel: values.replay ? '#field-ops' : values.channel!, slackUserToPerson: {}, directory, pollMs, refreshMs: 30_000 } });
}
let stopPoll = new AbortController();
function runPoller(): void {
  stopPoll = new AbortController();
  const p = newPoller();
  void p.run({ signal: stopPoll.signal, onReport: (r) => {
    if (r.imported?.inserted) say(`  [poller] ${r.imported.inserted} new message(s) imported`);
    if (r.errors.length) say(`  [poller] ${r.errors.join('; ')}`);
    if (r.fatal) { say(`  [poller] ${r.fatal}`); cleanup(2); }
  } });
}
runPoller();
say(values.replay ? 'Slack:   REPLAY (fake workspace; the pre-recording lines are already in its history).' : `Slack:   LIVE read only, "${values.workspace}" ${values.channel}, every ${pollMs} ms; the channel history is imported first.`);
function typeLine(who: string, text: string): void {
  if (!fake) return;
  fake.type(who === 'Mark' ? slackIds.mark! : slackIds.artem!, text);
  typedAt.set(text, Date.now());
  say(`  [slack, replay] ${who}: ${text}`);
}
async function typeBlock(lines: typeof pre, label: string): Promise<void> {
  if (!fake) { say(`  (live: ${label} is typed in Slack)`); return; }
  for (const [i, l] of lines.entries()) { if (i) await sleep(Math.max(300, Number(values.every) || 3000)); typeLine(l.who, l.text); }
}

// ---- 3. trigger → question latency, and the questions for Artem and Mark ----
interface Q { questionId: string; investigationId: string; personEntityId: string; text: string; status: string; deliveredAt?: string }
let confirmAt: number | undefined, triggerAt: number | undefined;
const seen = new Set<string>();
const watcher = setInterval(() => void (async () => {
  for (const [pid, name] of [[ARTEM, 'Artem'], [MARK, 'Mark']] as const) {
    const qs = await service.get<Q[]>(`/questions?personEntityId=${encodeURIComponent(pid)}`).catch(() => [] as Q[]);
    for (const q of qs) {
      if (seen.has(q.questionId)) continue;
      seen.add(q.questionId);
      say(`  [lumi → ${name}] "${q.text}" (${q.status})`);
      if (pid === ARTEM && /Is this a problem\?$/.test(q.text) && confirmAt === undefined) {
        confirmAt = q.deliveredAt ? Date.parse(q.deliveredAt) : Date.now();
        // The trigger's own time: typed (replay) or its Slack timestamp (live: the first message after the pre-lines).
        const preTexts = new Set(pre.map((l) => l.text));
        const slackTs = lastHistory.filter((m) => !preTexts.has(m.text ?? '')).map((m) => Number(m.ts) * 1000).sort((a, b) => a - b)[0];
        triggerAt = typedAt.get(trigger[0]!.text) ?? slackTs;
        if (triggerAt) say(`  [latency] trigger message → question stored and delivered: ${secs(confirmAt - triggerAt)} (poll ${pollMs} ms)`);
      }
    }
  }
})(), 250);

// ---- 4. the simulated phase ----
const SIM = [
  { by: 'Aarne Koskela', text: 'TRN-420 at Raisio: link is up but no traffic after the v6 template rollout.', asset: 'TRN-420', older: true },
  { by: 'Liisa Mäkelä', text: 'TRN-421 at Naantali: link up, alarms cleared, no traffic since the v6 template change.', asset: 'TRN-421', older: true },
  { by: 'Kaisa Hautala', text: 'TRN-422 at Lieto: link is up but no traffic after the v6 template rollout.', asset: 'TRN-422', older: false },
  { by: 'Marja Niemi', text: 'TRN-425 at Kupittaa: link is up but no traffic, older N5 unit, after the v6 template rollout.', asset: 'TRN-425', older: true },
];
interface Dir { personEntityId: string; name: string; groups: string[] }
let simRunning = false;
const simInv = new Set<string>();
const answered = new Set<string>();
async function simulate(): Promise<void> {
  if (simRunning) return;
  simRunning = true;
  say('\n== SIMULATED phase: colleagues ask Lumi; the engine picks questions and people; simulated answers after ~3 s ==');
  const dir = await service.get<Dir[]>('/directory');
  for (const d of dir) if (d.name === 'Artem' || d.name === 'Mark') REAL.add(d.personEntityId);
  const answerer = setInterval(() => void (async () => {
    const open = await service.get<Q[]>('/questions?status=delivered').catch(() => [] as Q[]);
    for (const q of open) {
      if (!simInv.has(q.investigationId) || answered.has(q.questionId) || REAL.has(q.personEntityId)) continue;
      answered.add(q.questionId);
      const s = SIM.find((x) => q.text.includes(x.asset));
      const value = /older|N5|2019/i.test(q.text) ? (s?.older === false ? 'no' : 'yes') : 'yes';
      const p = dir.find((d) => d.personEntityId === q.personEntityId);
      setTimeout(() => void service.post(`/questions/${encodeURIComponent(q.questionId)}/answer`, {
        principal: { id: q.personEntityId, displayName: `${p?.name ?? q.personEntityId} (simulated)`, groups: p?.groups ?? [], type: 'human' }, value, text: 'simulated',
      }).then(() => say(`  [simulated] ${p?.name ?? q.personEntityId} answered ${value}: "${q.text}"`), (e) => say(`  [simulated] answer refused: ${String(e)}`)), 3000);
    }
  })(), 1000);
  for (const s of SIM) {
    const p = dir.find((d) => d.name === s.by);
    if (!p) { say(`  [simulated] ${s.by} is not in the directory; skipped`); continue; }
    const r = await service.post<{ investigationId: string; recommendation: { kind: string }; question?: { text: string; personEntityId: string } }>('/investigate', {
      text: s.text, principal: { id: p.personEntityId, displayName: `${s.by} (simulated)`, groups: p.groups, type: 'human' }, allowQuestions: true,
    });
    simInv.add(r.investigationId);
    const to = r.question ? (dir.find((d) => d.personEntityId === r.question!.personEntityId)?.name ?? r.question.personEntityId) : undefined;
    say(`  [simulated] ${s.by} asks Lumi: "${s.text}" → ${r.recommendation.kind}${r.question ? `; Lumi asks ${to}${REAL.has(r.question.personEntityId) ? ' (real: answers in their own Lumi)' : ''}: "${r.question.text}"` : '; no question needed'}`);
    await sleep(5000);
  }
  setTimeout(() => { clearInterval(answerer); simRunning = false; }, 30_000);
}

// ---- 5. reset (retake): same service and port, a cleared database, the pre-recording lines again ----
async function reset(): Promise<void> {
  say('\n== RESET: clearing the database (re-seeded), re-importing the pre-recording lines; both Lumis stay connected ==');
  stopPoll.abort();
  if (!values.replay) {
    // Keep the channel's pre-recording lines (up to the last one of them), hide everything typed in the previous take.
    const last = pre.at(-1)!.text;
    const cutoff = Math.max(...lastHistory.filter((m) => (m.text ?? '').trim() === last).map((m) => Number(m.ts)), 0);
    const resetAt = Date.now() / 1000;
    if (!cutoff) say(`  could not find the last pre-recording line in the channel ("${last}"); only new messages will be read`);
    historyFilter = (ts) => ts <= cutoff || ts > resetAt;
  }
  await service.post('/demo/reset', { seed: 'elisa' });
  seen.clear(); answered.clear(); simInv.clear(); typedAt = new Map(); confirmAt = undefined; triggerAt = undefined;
  runPoller();
}

// ---- 6. rehearsal desktops: two local Lumis (Artem's, Mark's), read over a local DevTools port ----
const cdpPorts = { artem: 9351, mark: 9352 };
async function launchDesktops(): Promise<void> {
  say('Building the desktop app…');
  await new Promise<void>((res, rej) => spawn(process.execPath, [join(REPO_ROOT, 'scripts/build.mjs')], { stdio: 'ignore' }).on('exit', (c) => (c === 0 ? res() : rej(new Error(`build exit ${c}`)))));
  const electron = createRequire(import.meta.url)('electron') as unknown as string;
  for (const [who, port] of [['artem', cdpPorts.artem], ['mark', cdpPorts.mark]] as const) {
    const dir = join(tmpdir(), `lumi-film-electron-${who}`);
    mkdirSync(dir, { recursive: true });
    children.push(spawn(electron, [join(REPO_ROOT, 'dist/desktop/main.cjs'), `--user-data-dir=${dir}`, `--remote-debugging-port=${port}`], {
      stdio: 'ignore', env: { ...process.env, KT_NO_SERVICE: '1', KT_SERVICE_URL: who === 'mark' ? markUrl : url, KT_PERSON: who === 'mark' ? 'Mark' : 'Artem', KT_QUESTION_POLL_MS: values.qpoll, KT_FILM_ARRIVE: '1' },
    }));
  }
  say(`Launched two local Lumis (Artem, Mark); DevTools on ${cdpPorts.artem} and ${cdpPorts.mark} for the measurement only.`);
}
/** One DevTools call on a Lumi's page (rehearsal measurement only). */
async function cdp(port: number, method: string, params: Record<string, unknown>): Promise<any> {
  const pages = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as Array<{ type: string; webSocketDebuggerUrl: string }>;
  const page = pages.find((p) => p.type === 'page');
  if (!page) return undefined;
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
  const out = await new Promise<any>((r) => { ws.onmessage = (m) => r(JSON.parse(String(m.data)).result); ws.send(JSON.stringify({ id: 1, method, params })); });
  ws.close();
  return out;
}
/** What one Lumi shows: panel open, the view, the question heading, the companion state. */
async function lumiState(port: number): Promise<{ open: boolean; view: string; q: string; away?: string } | undefined> {
  try {
    const expr = `JSON.stringify({ open: !!document.querySelector('[aria-label="Close panel"]'), view: document.querySelector('.rf-stage')?.dataset.view ?? '', q: document.querySelector('section[data-view="question"] h2')?.textContent ?? '' })`;
    return JSON.parse((await cdp(port, 'Runtime.evaluate', { expression: expr }))?.result?.value ?? '{}');
  } catch { return undefined; }
}
async function capture(port: number, name: string): Promise<void> {
  try {
    const r = await cdp(port, 'Page.captureScreenshot', { format: 'png' });
    if (r?.data) { const f = join(tmpdir(), `lumi-film-${name}.png`); (await import('node:fs')).writeFileSync(f, Buffer.from(r.data, 'base64')); say(`  [capture] ${f}`); }
  } catch { /* measurement only */ }
}
async function measureArrival(): Promise<void> {
  for (let i = 0; i < 120; i++) {
    const s = await lumiState(cdpPorts.artem);
    if (s?.open && s.view === 'question' && /Is this a problem\?/.test(s.q)) {
      const from = triggerAt ?? Date.now();
      say(`  [latency] trigger message → Artem's Lumi open on the question by itself: ${secs(Date.now() - from)}`);
      await sleep(1200);
      await capture(cdpPorts.artem, 'artem-question');
      return;
    }
    await sleep(250);
  }
  say(`  [latency] Artem's Lumi did not open on the question within 30 s (last state: ${JSON.stringify(await lumiState(cdpPorts.artem))})`);
}

if (values.desktops) await launchDesktops();

// ---- keys ----
say('\nKeys: t trigger · f fix · b solved (replay) · s simulated phase · r reset · q quit');
if (process.stdin.isTTY && !values.auto) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.on('data', (k: Buffer) => {
    const c = k.toString();
    if (c === 'q' || c === '\u0003') cleanup(0);
    if (c === 's') void simulate();
    if (c === 'r') void reset();
    if (c === 't' && values.replay) { void typeBlock(trigger, 'the trigger'); if (values.desktops) void measureArrival(); }
    if (c === 'f' && values.replay) void typeBlock(fix, 'the fix');
    if (c === 'b' && values.replay) void typeBlock(solved, 'solved');
  });
}

// ---- unattended rehearsal ----
async function standIn(pid: string, name: string, pick: (q: Q) => boolean): Promise<void> {
  const qs = await service.get<Q[]>(`/questions?personEntityId=${encodeURIComponent(pid)}&status=delivered`);
  for (const q of qs.filter(pick)) {
    await service.post(`/questions/${encodeURIComponent(q.questionId)}/answer`, { principal: { id: pid, displayName: name, groups: [], type: 'human' }, value: 'yes' });
    say(`  [rehearsal stand-in for ${name}'s tap] Yes: "${q.text}"`);
  }
}
if (values.auto) {
  await sleep(pollMs * 2 + 2000);
  const before = await service.get<{ cases: Array<{ title: string; certainty: { messages: number; threshold?: number; asked: boolean } }> }>('/pipeline.json');
  const c0 = before.cases[0];
  say(`\n  [check] after the pre-recording lines: ${c0 ? `${c0.title}, certainty ${c0.certainty.messages}/${c0.certainty.threshold}, asked: ${c0.certainty.asked}` : 'no case'}`);
  if (values.desktops) { await sleep(6000); say(`  [check] Artem's Lumi before the trigger: ${JSON.stringify(await lumiState(cdpPorts.artem))}`); await capture(cdpPorts.artem, 'artem-before'); }
  say('\n== TRIGGER ==');
  const arrival = values.desktops ? measureArrival() : Promise.resolve();
  await typeBlock(trigger, 'the trigger');
  for (let i = 0; i < 60 && confirmAt === undefined; i++) await sleep(250);
  await arrival;
  await sleep(2000);
  await standIn(ARTEM, 'Artem', (q) => /Is this a problem\?$/.test(q.text));
  say('\n== FIX ==');
  await typeBlock(fix, 'the fix');
  await sleep(pollMs + 1000);
  await simulate();
  await sleep(6000);
  await standIn(MARK, 'Mark', () => true);
  say('\n== SOLVED ==');
  await typeBlock(solved, 'solved');
  await sleep(pollMs * 2 + 2000);
  await standIn(MARK, 'Mark', () => true);
  clearInterval(watcher);
  stopPoll.abort();
  say('\n== FINALE (MCP) ==');
  await new Promise<void>((res) => spawn(process.execPath, [join(REPO_ROOT, 'scripts/film-agent.ts'), '--db', db], { stdio: 'inherit' }).on('exit', () => res()));
  say('\nAuto rehearsal done.');
  cleanup(0);
}
