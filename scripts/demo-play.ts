/**
 * Simulated real-time activity stream for the judge demo.
 *   pnpm demo:play [-- --seed 1 --hour-seconds 10 --hours 10 --start 07:30 --judge-every 120 --url http://127.0.0.1:47831
 *                     --families train,validation --log data/local/demo-activity.jsonl --no-clock --append --quiet]
 * Drives the RUNNING service (start it with `pnpm service` or `pnpm desktop`) through a scripted, clock-driven day:
 * synthetic Teams/e-mail/Slack evidence arrives, simulated engineers investigate, the real coordinator asks simulated
 * colleagues (within its limits), and they answer after plausible delays. Everything is simulated and labelled so;
 * no model is called; the hidden scenario answer keys are never read (only the visible problem texts and sources).
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import type { DirectoryEntry, PeopleDirectory } from '../src/libs/utils/contracts/index.ts';
import { DEFAULT_SERVICE_PORT } from '../src/libs/utils/contracts/index.ts';
import { DEFAULT_ACTIVITY_LOG } from '../src/apps/service/activity.ts';
import { REPO_ROOT } from '../src/apps/service/paths.ts';
import {
  combinedSink, createSimClock, httpClient, jsonlSink, planDay, runDay, SIMULATED_BANNER, terminalSink, todayAt,
  type FamilyInput, type JudgePrompt, type ProblemInput, type SourceInput,
} from '../src/libs/utils/simulation/index.ts';
import { loadFamiliesFile } from '../benchmarks/splits.ts';
import { loadVisibleInputs } from '../benchmarks/load.ts';

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: `http://127.0.0.1:${DEFAULT_SERVICE_PORT}` },
    seed: { type: 'string', default: '1' },
    'hour-seconds': { type: 'string', default: '10' },
    hours: { type: 'string', default: '10' },
    start: { type: 'string', default: '07:30' },
    'judge-every': { type: 'string', default: '120' },
    families: { type: 'string', default: 'train,validation' },
    log: { type: 'string', default: DEFAULT_ACTIVITY_LOG },
    'no-clock': { type: 'boolean', default: false },
    append: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
    instant: { type: 'boolean', default: false },
    /** Real seconds to wait before the day begins (so a judge can do the 3-minute walkthrough on the seeded data first). */
    delay: { type: 'string', default: '0' },
  },
});

const num = (name: string, v: string, min: number): number => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min) {
    process.stderr.write(`Invalid --${name} ${v}\n`);
    process.exit(2);
  }
  return n;
};
const seed = num('seed', values.seed, 0);
const hourSeconds = values.instant ? 0 : num('hour-seconds', values['hour-seconds'], 0);
const hours = num('hours', values.hours, 0.25);
const judgeEvery = num('judge-every', values['judge-every'], 1);
const delay = num('delay', values.delay, 0);
const [sh, sm] = values.start.split(':').map(Number);
if (!Number.isInteger(sh) || !Number.isInteger(sm) || sh! < 0 || sh! > 23 || sm! < 0 || sm! > 59) {
  process.stderr.write(`Invalid --start ${values.start} (HH:MM)\n`);
  process.exit(2);
}

const client = httpClient(values.url);
const health = await client.get<{ ok: boolean; routes: string[] }>('/health').catch(() => undefined);
if (!health?.ok) {
  process.stderr.write(`No service at ${values.url}. Start it with \`pnpm service\` (or \`pnpm desktop\`), then run \`pnpm demo:play\` again.\n`);
  process.exit(1);
}
if (!health.routes.includes('GET /demo/activity')) process.stderr.write('Note: this service has no /demo/activity route (older build); the log still goes to the file and the terminal.\n');

// ---- inputs: visible sources, directories and problem texts of the chosen families (never truth.json / answer keys) ----
const directory = await client.get<DirectoryEntry[]>('/directory');
const byName = (name: string): DirectoryEntry | undefined => directory.find((d) => d.name === name);
const wanted = new Set(values.families.split(',').map((s) => s.trim()).filter(Boolean));
const manifest = loadFamiliesFile(join(REPO_ROOT, 'data', 'scenarios'));
const families: FamilyInput[] = [];
for (const f of manifest.families) {
  const seeded = f.split === 'demo';
  if (!seeded && !wanted.has(f.split) && !wanted.has(f.id)) continue;
  if (f.split === 'test' && !wanted.has(f.id)) continue;
  const v = loadVisibleInputs(f.id);
  const people = v.people as PeopleDirectory;
  const who = (id: string): ProblemInput['requester'] => {
    const p = people.people.find((x) => x.id === id);
    return { id, name: p?.name ?? id, groups: p?.groups ?? [] };
  };
  const teams = v.teams as { channel?: string; messages: Array<{ author: string }> };
  const authors = [...new Set(teams.messages.map((m) => m.author))];
  const sources: SourceInput[] = [
    { format: 'teams-json', payload: v.teams, label: `Teams thread, ${teams.messages.length} messages (${authors.join(', ')})` },
    ...Object.entries(v.emails).map(([name, text]) => {
      const subject = /^Subject:\s*(.+)$/m.exec(text)?.[1] ?? name;
      const from = /^From:\s*(.+?)\s*<?[^<\s]*>?\s*$/m.exec(text)?.[1]?.trim() ?? 'someone';
      return { format: 'email-text' as const, payload: text, label: `E-mail "${subject}" from ${from}` };
    }),
    ...Object.entries(v.slack.days).map(([key, day]) => {
      const [channel, date] = key.split('/') as [string, string];
      const msgs = day as Array<{ subtype?: string }>;
      const ch = (v.slack.channels as Array<{ name: string; is_private?: boolean }>).find((c) => c.name === channel);
      return {
        format: 'slack-export' as const,
        payload: { users: v.slack.users, channels: v.slack.channels, days: [{ channel, date, messages: day }] },
        label: `Slack ${ch?.is_private ? 'private ' : ''}#${channel} ${date}, ${msgs.filter((m) => !m.subtype).length} messages (synthetic export)`,
      };
    }),
  ];
  families.push({
    id: f.id, description: f.description, seeded, ...(seeded ? {} : { directory: people }), sources: seeded ? [] : sources,
    problems: v.problems.map((p) => ({ id: p.id, text: p.text, requester: who(p.requester), ...(p.observations ? { observations: p.observations } : {}) })),
  });
}

// Elisa-style texts by people already in the demo directory (the developer fixture has no authored problems).
const extra: Array<ProblemInput & { family?: string }> = [
  { id: 'x-trn-088', family: 'elisa-style', text: 'At site now. Replaced the SFP on TRN-088, an older unit from 2018. Link is up, alarms cleared, RX power normal, but no traffic. Counters zero.', requester: 'Kaisa Hautala' },
  { id: 'x-rtr-203', family: 'dev-family-01', text: 'RTR-203 BGP sessions flapping after the firmware update, hold timers look default. Roll back like RTR-117?', requester: 'Tapio Lehto' },
  { id: 'x-trn-233', family: 'elisa-style', text: 'TRN-233 is a 2021 unit. After the SFP swap the link is up, alarms cleared, counters zero. Same thing as TRN-042?', requester: 'Ilmari Karjalainen' },
].flatMap((p) => {
  const d = byName(p.requester as unknown as string);
  return d ? [{ ...p, requester: { id: d.personEntityId, name: d.name, groups: d.groups } }] : [];
}) as Array<ProblemInput & { family?: string }>;

const promptsFile = join(REPO_ROOT, 'data', 'demo', 'judge-prompts.json');
const judgePrompts: JudgePrompt[] = existsSync(promptsFile) ? (JSON.parse(readFileSync(promptsFile, 'utf8')) as { prompts: JudgePrompt[] }).prompts : [];

const plan = planDay({ seed, families, hours, judgeEveryMinutes: judgeEvery, extraProblems: extra });
const clock = createSimClock(todayAt(sh!, sm!), hourSeconds);
if (!values.append) writeFileSync(values.log, '');
const sink = combinedSink(jsonlSink(values.log), ...(values.quiet ? [] : [terminalSink()]));

let stop = false;
const onSignal = (): void => {
  if (stop) process.exit(130);
  stop = true;
  process.stderr.write('\nStopping the simulated day (clock returns to real time)…\n');
};
process.on('SIGINT', onSignal);
process.on('SIGTERM', onSignal);

process.stdout.write(`${SIMULATED_BANNER}\nService ${values.url} · log ${values.log} · ${families.filter((f) => !f.seeded).length} arriving families, ${families.filter((f) => f.seeded).length} already seeded · ${plan.events.length} planned events\n\n`);
if (delay > 0 && !stop) {
  // Quiet period first: the seeded data and the people in it stay exactly as the walkthrough expects (no new NOC people
  // competing for the one question, no budgets used) until the judge has done the 3-minute script.
  const until = new Date(Date.now() + delay * 1000);
  sink.write({ kind: 'clock', at: clock.now().toISOString(), real: new Date().toISOString(), simulated: true, text: `Simulated day begins in ${Math.round(delay)} s (at ${until.toTimeString().slice(0, 5)} real time): do the 3-minute walkthrough in the companion first; the data stays as seeded until then`, detail: { delaySeconds: delay } });
  const step = 1000;
  for (let waited = 0; waited < delay * 1000 && !stop; waited += step) await new Promise((r) => setTimeout(r, Math.min(step, delay * 1000 - waited)));
}
try {
  if (stop) process.exit(130);
  const summary = await runDay({ client, plan, clock, seed, sink, judgePrompts, syncServiceClock: !values['no-clock'], shouldStop: () => stop });
  process.stdout.write(`\nDone. ${summary.questionsAsked} questions asked, ${summary.answered} answered, ${summary.judgeQuestions} for the judge, ${summary.errors} errors. Log: ${values.log}\n`);
  process.exitCode = summary.errors ? 1 : 0;
} finally {
  if (!values['no-clock']) await client.post('/demo/clock', {}).catch(() => undefined);
}
