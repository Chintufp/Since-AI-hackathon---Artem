/**
 * Slack sandbox poller (B4 D2): a message typed in one sandbox channel becomes a case; a delivered question goes to
 * its recipient as a Slack DM; the recipient's reaction (👍 yes, 👎 no, 🤷 not sure) answers it through the service.
 *
 *   pnpm demo:slack-poll --fake [--requester "<name>"] [--say "<message>"] [--ask "<problem>"] [--reaction +1]
 *        Rehearsal with NO token and NO network: an in-script fake workspace (connectors/slack-fake.ts) runs the same
 *        poller loop against the running service. Every directory person gets a fake Slack user; the requester types
 *        the message, asks the problem in Lumi's place, the recipient "reacts", the requester asks again.
 *   pnpm demo:slack-poll --workspace "<team name>" --channel "#<channel>" --people <people.json> [--poll-ms 5000] [--limit 50] [--once]
 *        LIVE against a SANDBOX workspace. Refuses unless the shell has KT_SLACK_LIVE=1 and KT_SLACK_TOKEN (set by the
 *        operator at demo time; never read from anywhere else, never printed, logged or stored). The team name must
 *        match --workspace. Reads one channel (read allowlist), posts DMs and reads reactions (DM allowlist) only.
 *   pnpm demo:slack-poll --read-only --workspace "<team name>" --channel "#<channel>" [--poll-ms 2500]
 *        LIVE, READ ONLY (film proof): same guard (KT_SLACK_LIVE=1, KT_SLACK_TOKEN), no --people, no DMs, no reactions;
 *        reads the one channel every 2.5 s and imports new messages. Scopes: channels:read, channels:history,
 *        users:read (groups:read, groups:history for a private channel). Watch it at /pipeline.
 *   pnpm demo:slack-poll --replay docs/SLACK_FILM_CONVO.md [--every 3000]
 *        Rehearsal of the read-only path with NO token and NO network: a fake workspace "types" the conversation one
 *        line every 3 s and the same poller imports it every 2.5 s. Watch it at /pipeline.
 *   [--url http://127.0.0.1:47831]  the running service (`pnpm service --seed elisa` or `pnpm demo:judge`).
 * Rows go to the activity log (data/local/, GET /demo/activity): fake runs are labelled simulated, live runs real.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { DirectoryEntry, PeopleDirectory } from '../src/libs/utils/contracts/index.ts';
import { DEFAULT_SERVICE_PORT } from '../src/libs/utils/contracts/index.ts';
import {
  createFakeSlack, createSlackPoller, fileTracking, memoryTracking, pollerGuard, slackDmClient, slackPeopleFrom, slackWebClient,
  SLACK_POLLER_SCOPES, SLACK_READ_SCOPES, type PollReport,
} from '../src/libs/utils/connectors/index.ts';
import { DEFAULT_ACTIVITY_LOG } from '../src/apps/service/activity.ts';
import { REPO_ROOT } from '../src/apps/service/paths.ts';
import { httpClient, jsonlSink } from '../src/libs/utils/simulation/index.ts';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: `http://127.0.0.1:${DEFAULT_SERVICE_PORT}` },
    fake: { type: 'boolean', default: false },
    workspace: { type: 'string' },
    channel: { type: 'string' },
    people: { type: 'string' },
    'poll-ms': { type: 'string' },
    'read-only': { type: 'boolean', default: false },
    replay: { type: 'string' },
    every: { type: 'string', default: '3000' },
    limit: { type: 'string', default: '50' },
    once: { type: 'boolean', default: false },
    requester: { type: 'string' },
    say: { type: 'string', default: 'Changed the SFP on TRN-301. Link is up and alarms cleared, but traffic is not coming back.' },
    ask: { type: 'string', default: 'TRN-301: changed the SFP, link up, alarms cleared, no traffic. Not sure which unit generation this is.' },
    reaction: { type: 'string', default: '+1' },
  },
});
const say = (s = ''): void => { process.stdout.write(s + '\n'); };
const service = httpClient(values.url);
/** The log's rows are all flagged simulated (contract); like slack-demo.ts, `why` says when a row is real activity. */
const activity = (row: { kind: string; text: string; why: string; detail?: Record<string, unknown> }): void => {
  try {
    const now = new Date().toISOString();
    jsonlSink(DEFAULT_ACTIVITY_LOG).write({ at: now, real: now, simulated: true, ...row });
  } catch { /* the activity log is optional */ }
};
const scopes = `Scopes the sandbox app needs: ${SLACK_POLLER_SCOPES.join(', ')} (no im:write, no reactions:write).`;

function describe(r: PollReport, label: string): void {
  const parts = [
    r.imported ? `channel: ${r.imported.seen} messages, ${r.imported.inserted} new` : '',
    r.dmsSent.length ? `DMs sent: ${r.dmsSent.map((d) => d.slackUserId).join(', ')}` : '',
    r.answered.length ? `answered: ${r.answered.map((a) => `${a.value} by ${a.slackUserId}`).join(', ')}` : '',
    r.closed.length ? `stopped tracking: ${r.closed.map((c) => c.reason).join('; ')}` : '',
    r.errors.length ? `errors: ${r.errors.join('; ')}` : '',
    r.skippedWrites ? `no Slack writes: ${r.skippedWrites}` : '',
    r.fatal ?? '',
  ].filter(Boolean);
  say(`${label}${parts.join(' · ') || 'nothing new'}`);
}

const health = await service.get<{ ok: boolean }>('/health').catch(() => undefined);
if (!health?.ok) {
  process.stderr.write(`No service at ${values.url}. Start it with \`pnpm service --seed elisa\` or \`pnpm demo:judge\`.\n`);
  process.exit(1);
}

/** The DM side of a read-only run: never called (no mapped people, nothing tracked), and it refuses if it ever is. */
const noDm = { call: async (m: string) => { throw new Error(`read-only run: ${m} is not allowed`); } };

if (values.replay) {
  // ---- rehearsal of the read-only film path: a fake workspace types the script line by line ----
  // The first fenced block of the file is the conversation, one "Name: message" per line.
  const file = readFileSync(values.replay, 'utf8');
  const block = /```[a-z]*\n([\s\S]*?)```/.exec(file)?.[1] ?? file;
  const lines = block.split('\n').map((l) => /^\s*([A-Za-zÀ-ÿ][\wÀ-ÿ .-]{0,30}?):\s+(.+)$/.exec(l)).filter((m): m is RegExpExecArray => !!m);
  if (!lines.length) { say(`${values.replay}: no "Name: message" lines found.`); process.exit(2); }
  const names = [...new Set(lines.map((m) => m[1]!.trim()))];
  const users = names.map((n, i) => ({ id: `U0FILM${String(i + 1).padStart(3, '0')}`, real_name: n }));
  const teamId = `T0FILM${Date.now().toString(36).toUpperCase().slice(-5)}`;
  const slack = createFakeSlack({ team: { id: teamId, name: 'Film Sandbox' }, channel: { id: 'C0FILM0001', name: 'field-ops' }, users, startTs: Math.floor(Date.now() / 1000) });
  const pollMs = Math.max(500, Number(values['poll-ms'] ?? 2500) || 2500);
  const poller = createSlackPoller({ read: slack.read, dm: noDm, service, tracking: memoryTracking(), config: { workspace: 'Film Sandbox', channel: '#field-ops', slackUserToPerson: {}, pollMs, refreshMs: 0 } });
  say(`REPLAY (fake workspace, no token, no network): ${lines.length} lines from ${values.replay}, one every ${values.every} ms; polling every ${pollMs} ms.`);
  say(`Watch: ${values.url}/pipeline?connection=slack-live:${teamId}`);
  const every = Math.max(200, Number(values.every) || 3000);
  let i = 0;
  const typer = setInterval(() => {
    const m = lines[i++];
    if (!m) { clearInterval(typer); return; }
    slack.type(users[names.indexOf(m[1]!.trim())]!.id, m[2]!.trim());
    say(`  ${m[1]!.trim()}: ${m[2]!.trim()}`);
  }, every);
  const stop = new AbortController();
  // Stop a couple of polls after the last line.
  const end = setInterval(() => { if (i > lines.length) { clearInterval(end); setTimeout(() => stop.abort(), pollMs * 2); } }, 200);
  await poller.run({ signal: stop.signal, onReport: (r) => { if (r.imported?.inserted || r.errors.length) describe(r, '  poll: '); } });
  say('Replay done.');
  process.exit(0);
}

if (values.fake) {
  // ---- rehearsal: in-script fake workspace, same poller, the running service ----
  say('FAKE Slack workspace (rehearsal): no token, no network; the same poller loop runs against the local service.');
  say(scopes);
  const dir = await service.get<DirectoryEntry[]>('/directory');
  if (dir.length < 2) { say('The directory has fewer than two people; seed the service first (pnpm service --seed elisa).'); process.exit(1); }
  const users = dir.map((d, i) => ({ id: `U0FAKE${String(i + 1).padStart(3, '0')}`, real_name: d.name }));
  const slackOf = new Map(dir.map((d, i) => [d.personEntityId, users[i]!.id]));
  const directory: PeopleDirectory = {
    people: dir.map((d) => ({ id: d.personEntityId, name: d.name, role: d.role ?? '', groups: d.groups, actorIds: [`person:slack:${slackOf.get(d.personEntityId)!}`], available: d.available })),
  };
  const requester = dir.find((d) => d.name === values.requester) ?? dir.find((d) => /field/i.test(d.role ?? "")) ?? dir[0]!;
  const slack = createFakeSlack({ team: { id: 'T0FAKE0001', name: 'Fake Sandbox' }, channel: { id: 'C0FAKE0001', name: 'field-ops' }, users });
  const poller = createSlackPoller({
    read: slack.read, dm: slack.dm, service, tracking: memoryTracking(),
    config: { workspace: 'Fake Sandbox', channel: '#field-ops', slackUserToPerson: slackPeopleFrom(directory), directory },
  });
  const principal = { id: requester.personEntityId, displayName: requester.name, groups: requester.groups, type: 'human' as const };
  type Inv = { recommendation: { kind: string; text: string; nextStep?: string }; question?: { questionId: string; text: string } };

  say(`\n1. ${requester.name} types in #field-ops: "${values.say}"`);
  slack.type(slackOf.get(requester.personEntityId)!, values.say ?? '');
  const r1 = await poller.pollOnce();
  describe(r1, '   poll: ');
  const cases = await service.get<Array<{ title: string }>>('/cases');
  const match = /\b[A-Z]{2,6}-\d{1,6}\b/.exec(values.say!)?.[0];
  say(`   case: ${cases.filter((c) => !match || c.title.includes(match)).map((c) => c.title).join(' | ') || '(no case formed)'}`);
  activity({ kind: 'evidence', text: `Fake Slack #field-ops: ${requester.name} typed a message → ${r1.imported?.inserted ?? 0} new, case ${match ?? ''}`, why: 'route: slack-live on a fake workspace (rehearsal; nothing contacted)' });

  say(`\n2. ${requester.name} asks Lumi: "${values.ask}"`);
  const before = await service.post<Inv>('/investigate', { text: values.ask, principal, allowQuestions: true });
  say(`   next step: (${before.recommendation.kind}) ${before.recommendation.text}`);
  say(`   question: ${before.question ? before.question.text : '(none)'}`);
  const r2 = await poller.pollOnce();
  describe(r2, '   poll: ');
  const dm = slack.dms.at(-1);
  if (!dm) { say('   No delivered question for a mapped person (quiet hours hold questions until 07:00 Helsinki, or no gap was found). Stopping.'); process.exit(0); }
  const recipient = users.find((u) => u.id === dm.user)!;
  say(`   DM to ${recipient.real_name}:\n     ${dm.text.split('\n').join('\n     ')}`);

  say(`\n3. ${recipient.real_name} reacts :${values.reaction}: on the DM; a colleague reacts too (ignored).`);
  const colleague = users.find((u) => u.id !== dm.user && u.id !== slackOf.get(requester.personEntityId)) ?? users[0]!;
  slack.react(colleague.id, '-1', (d) => d === dm);
  slack.react(recipient.id, values.reaction!, (d) => d === dm);
  const r3 = await poller.pollOnce();
  describe(r3, '   poll: ');
  activity({ kind: 'answer', text: `Fake Slack DM: ${recipient.real_name} reacted :${values.reaction}: → ${r3.answered.map((a) => a.value).join(', ') || 'no answer'}`, why: 'route: Slack DM reaction on a fake workspace → POST /questions/:id/answer (rehearsal)' });

  say(`\n4. ${requester.name} asks again:`);
  const after = await service.post<Inv>('/investigate', { text: values.ask, principal, allowQuestions: true });
  say(`   next step: (${after.recommendation.kind}) ${after.recommendation.text}`);
  say(after.recommendation.text !== before.recommendation.text || after.recommendation.kind !== before.recommendation.kind ? '   The answer changed the next step.' : '   Same next step (the answer filled a fact without changing the advice).');
  say('\nNothing was sent anywhere: the workspace was in memory. The fake people mapping was added to the service directory for this run.');
  process.exit(0);
}

// ---- live, sandbox only ----
const guard = pollerGuard({ live: process.env.KT_SLACK_LIVE, token: process.env.KT_SLACK_TOKEN, workspace: values.workspace, channel: values.channel });
if (values['read-only']) {
  // ---- live, read only: one channel, imported every few seconds; nothing is ever written to Slack ----
  if (!guard.ok) {
    say('Live read-only poller refused. Missing:');
    for (const m of guard.missing) say(`  - ${m}`);
    say('Setup (sandbox workspace only):');
    say(`  1. https://api.slack.com/apps → Create New App → From a manifest (docs/film-pages/slack-app-manifest.yml), in the sandbox workspace.`);
    say(`  2. OAuth & Permissions → Bot Token Scopes: ${SLACK_READ_SCOPES.join(', ')} (groups:* only matter for a private channel). Install to Workspace; copy the Bot User OAuth Token (xoxb-…).`);
    say(`  3. In Slack, in the demo channel: /invite @<app name>. Then in your terminal: export KT_SLACK_LIVE=1; export KT_SLACK_TOKEN=<paste> (never committed, never printed).`);
    say('To rehearse with no workspace: pnpm demo:slack-poll --replay docs/SLACK_FILM_CONVO.md');
    process.exit(2);
  }
  const pollMs = Math.max(1000, Number(values['poll-ms'] ?? 2500) || 2500);
  const poller = createSlackPoller({
    read: slackWebClient(process.env.KT_SLACK_TOKEN as string), dm: noDm, service, tracking: memoryTracking(),
    config: { workspace: values.workspace!, channel: values.channel!, slackUserToPerson: {}, pollMs, limit: Math.min(200, Math.max(1, Number(values.limit) || 50)) },
  });
  say(`LIVE read-only poller: workspace "${values.workspace}", channel "${values.channel}", every ${pollMs} ms. No DMs, nothing posted.`);
  say(`Watch: ${values.url}/pipeline`);
  const stop = new AbortController();
  for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { say('Stopping after this poll.'); stop.abort(); });
  let fatal = false;
  await poller.run({ signal: stop.signal, onReport: (r) => {
    if (r.imported?.inserted || r.errors.length || r.fatal) describe(r, `[${new Date().toTimeString().slice(0, 8)}] `);
    if (r.imported?.inserted) activity({ kind: 'evidence', text: `Slack sandbox "${r.team?.name}" ${values.channel}: ${r.imported.inserted} new messages`, why: 'route: slack-live read-only poller (read allowlist). This row is real activity, not simulated.', detail: { route: 'slack-live', connectionId: `slack-live:${r.team?.id}`, counts: r.imported } });
    if (r.fatal) fatal = true;
  } });
  process.exit(fatal ? 2 : 0);
}
if (!guard.ok || !values.people) {
  say('Live Slack poller refused. Missing:');
  for (const m of guard.missing) say(`  - ${m}`);
  if (!values.people) say('  - --people <people.json with actorIds person:slack:U… for every person who should get DMs>');
  say('What to set up (sandbox only):');
  guard.instructions.forEach((line, i) => say(`  ${i + 1}. ${line}`));
  say('To rehearse with no workspace: pnpm demo:slack-poll --fake');
  process.exit(2);
}
const token = process.env.KT_SLACK_TOKEN as string; // only to build the two clients; never printed or logged
const directory = JSON.parse(readFileSync(values.people, 'utf8')) as PeopleDirectory;
const slackUserToPerson = slackPeopleFrom(directory);
if (!Object.keys(slackUserToPerson).length) { say(`${values.people} has no person:slack:U… actor ids; nobody would get a DM.`); process.exit(2); }
const pollMs = Math.max(1000, Number(values['poll-ms'] ?? 5000) || 5000);
say(`LIVE sandbox poller: workspace "${values.workspace}", channel "${values.channel}", every ${pollMs} ms; DMs to ${Object.values(slackUserToPerson).map((p) => p.displayName).join(', ')}.`);
say(scopes);
const tracking = fileTracking(join(REPO_ROOT, 'data', 'local', 'slack-poller.json'));
const poller = createSlackPoller({
  read: slackWebClient(token), dm: slackDmClient(token), service, tracking,
  config: { workspace: values.workspace!, channel: values.channel!, slackUserToPerson, directory, pollMs, limit: Math.min(200, Math.max(1, Number(values.limit) || 50)) },
});
const onReport = (r: PollReport): void => {
  describe(r, `[${new Date().toTimeString().slice(0, 8)}] `);
  if (r.imported?.inserted) activity({ kind: 'evidence', text: `Slack sandbox "${r.team?.name}" ${values.channel}: ${r.imported.inserted} new messages`, why: 'route: slack-live poller (read allowlist). This row is real activity, not simulated.', detail: { route: 'slack-live', connectionId: `slack-live:${r.team?.id}`, counts: r.imported } });
  for (const d of r.dmsSent) activity({ kind: 'question', text: `Slack DM sent to ${slackUserToPerson[d.slackUserId]?.displayName ?? d.slackUserId}`, why: 'route: chat.postMessage (DM allowlist). Real activity.', detail: { questionId: d.questionId } });
  for (const a of r.answered) activity({ kind: 'answer', text: `Slack reaction from ${slackUserToPerson[a.slackUserId]?.displayName ?? a.slackUserId}: ${a.value}`, why: 'route: reactions.get → POST /questions/:id/answer. Real activity.', detail: { questionId: a.questionId } });
};
let fatal = false;
const report = (r: PollReport): void => { onReport(r); if (r.fatal) fatal = true; };
if (values.once) {
  report(await poller.pollOnce());
  process.exit(fatal ? 2 : 0);
}
const stop = new AbortController();
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.on(sig, () => { say('Stopping after this poll.'); stop.abort(); });
await poller.run({ signal: stop.signal, onReport: report });
process.exit(fatal ? 2 : 0);
