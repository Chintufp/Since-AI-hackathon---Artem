/**
 * The agent path, without any model: a plain MCP client (the official SDK) starts the Knowledge Twin MCP server over
 * stdio on the SAME database the desktop uses and calls the tools an agent would, in the order an agent would.
 *
 * Default: the 03:00 sequence (BUILD_BRIEF B7). The MCP server starts at 03:00 Helsinki time (--clock) with quiet hours
 * ON. kt_investigate -> kt_list_gaps (gaps and the confidence block) -> the gap that decides applicability ->
 * kt_find_people -> kt_request_clarification with preferPersonEntityId = Erkki -> the question is queued by quiet hours
 * until 07:00 -> the clock moves to 07:30 (the service's demo clock when a service on KT_PORT serves the same database, so
 * the companion delivers Erkki's question; else the MCP server is restarted at 07:30, since it delivers on its own clock)
 * -> waiting for Erkki's tap (kt_clarification_status) -> kt_get_context and kt_list_gaps show the new next step ->
 * kt_record_outcome (--outcome).
 *   node scripts/mcp-demo.ts [--db data/local/knowledge-twin.sqlite] [--text "..."] [--agent-id agent:claude-code] [--agent-groups noc]
 *                            [--prefer "Erkki"] [--wait 180] [--simulate-tap] [--answer yes|no] [--outcome] [--json]
 *                            [--night 2026-11-08T01:00:00Z] [--morning 2026-11-08T05:30:00Z] [--port 47831] [--keep-clock] [--day]
 * --simulate-tap answers as the person asked, through the engine (rehearsals without the panel). --day runs on real time
 * with quiet hours off (the walkthrough at any hour, D-B1-35). Run it after `pnpm demo:reset` (ids are deterministic:
 * a second run finds the question already answered). Nothing here calls a model.
 */
import { resolve, join } from 'node:path';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { DEFAULT_SERVICE_PORT } from '../src/libs/utils/contracts/index.ts';
import { DEFAULT_DB_PATH, REPO_ROOT } from '../src/apps/service/paths.ts';

const { values } = parseArgs({
  // `pnpm demo:agent -- --simulate-tap` passes the separator through; it is not an argument.
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    db: { type: 'string', default: DEFAULT_DB_PATH },
    text: { type: 'string', default: 'TRN-301: changed the SFP, link up, alarms cleared, no traffic. Not sure which unit generation this is.' },
    'agent-id': { type: 'string', default: 'agent:claude-code' },
    'agent-name': { type: 'string', default: 'Claude Code (judge)' },
    'agent-groups': { type: 'string', default: 'noc' },
    /** Name (or part of it) of the person the agent prefers to ask, as kt_find_people lists them. */
    prefer: { type: 'string', default: 'Erkki' },
    /** Seconds to wait for the tap before reading the clarification status once more. */
    wait: { type: 'string', default: '180' },
    'simulate-tap': { type: 'boolean', default: false },
    answer: { type: 'string', default: 'yes' },
    outcome: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
    /** 03:00 Helsinki (EET) on 8 Nov; and 07:30 the same morning. */
    night: { type: 'string', default: '2026-11-08T01:00:00Z' },
    morning: { type: 'string', default: '2026-11-08T05:30:00Z' },
    port: { type: 'string', default: process.env.KT_PORT ?? String(DEFAULT_SERVICE_PORT) },
    /** Leave the service's demo clock at 07:30 afterwards (default: back to real time). */
    'keep-clock': { type: 'boolean', default: false },
    /** Real time, quiet hours off: the daytime walkthrough. */
    day: { type: 'boolean', default: false },
  },
});
if (!['yes', 'no', 'unknown'].includes(values.answer)) throw new Error(`--answer must be yes, no or unknown, not ${values.answer}`);

const principal = { id: values['agent-id'], displayName: values['agent-name'], groups: values['agent-groups'].split(',').map((s) => s.trim()).filter(Boolean) };
const say = (s: string): void => { process.stdout.write(s + '\n'); };
const show = (label: string, v: unknown): void => { say(`\n## ${label}\n${values.json ? JSON.stringify(v, null, 2) : pretty(v)}`); };
const hel = (iso: string): string => new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Helsinki', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(iso));

let client!: Client;
async function connect(clock?: string): Promise<void> {
  client = new Client({ name: 'kt-demo-agent', version: '0.1.0' });
  const args = [join(REPO_ROOT, 'src/apps/service/mcp.ts'), '--db', values.db, '--quiet-hours', values.day ? 'off' : 'on', ...(clock ? ['--clock', clock] : [])];
  await client.connect(new StdioClientTransport({ command: process.execPath, args, stderr: 'ignore' }));
}
async function call<T = Record<string, any>>(name: string, args: Record<string, unknown>, quiet = false): Promise<T> {
  if (!quiet) say(`\n→ ${name}(${JSON.stringify(args)})`);
  const r = await client.callTool({ name, arguments: args });
  const first = (r.content as Array<{ type: string; text: string }>)[0]!;
  if (r.isError) throw new Error(`${name}: ${first.text}`);
  return JSON.parse(first.text) as T;
}

function pretty(v: unknown): string {
  const r = v as Record<string, any>;
  if (r && typeof r === 'object' && 'recommendation' in r && 'matches' in r) {
    const rec = r.recommendation;
    return [
      `investigationId: ${r.investigationId}`,
      `recommendation (${rec.kind}, applicability ${rec.applicability}): ${rec.text}`,
      ...(rec.nextStep ? [`next step: ${rec.nextStep}`] : []),
      ...rec.caveats.map((c: string) => `caveat: ${c}`),
      `matches: ${(r.matches as Array<{ title: string; matching: string[]; missing: string[] }>).slice(0, 3).map((m) => `${m.title} [matching: ${m.matching.join(', ') || '-'}; unknown: ${m.missing.join(', ') || '-'}]`).join(' | ')}`,
      `people: ${(r.people as Array<{ name: string; reasons: Array<{ text: string }> }>).map((p) => `${p.name} (${p.reasons.map((x) => x.text).join('; ')})`).join(' | ') || '-'}`,
      `gaps: ${(r.gaps as Array<{ description: string; status: string }>).map((g) => `${g.description} [${g.status}]`).join(' | ') || '-'}`,
      ...(r.question ? [`question: "${r.question.text}" → ${r.question.status}`] : []),
      `loop: ${r.loop}${r.loopReason ? ` — ${r.loopReason}` : ''}`,
      `routes: ${(r.routes as Array<{ route: string; version: string }>).map((x) => `${x.route}:${x.version}`).join(', ')}`,
    ].join('\n');
  }
  if (r && typeof r === 'object' && 'gaps' in r && 'confidence' in r) {
    const lines = [`recommendation: ${r.recommendation.kind} — ${r.recommendation.text}`];
    if (r.quietHours) lines.push(`quiet hours: ${r.quietHours.now ? `on now; a question asked now is held until ${r.quietHours.heldUntil} (${hel(r.quietHours.heldUntil)} Helsinki)` : 'not now'}`);
    if (!r.gaps.length) lines.push('open gaps: none');
    for (const g of r.gaps) {
      lines.push(`gap [decides ${g.decides}${g.requesterCanCheck ? ', you can check it yourself' : ''}] ${g.description}`, `  id: ${g.id}`, `  an answer changes: ${g.whatAnswerChanges}`);
      if (g.question) lines.push(`  question: "${g.question.templateText}"${g.question.agentWording ? ` (agent wording: "${g.question.agentWording}")` : ''}`);
      if (g.notAskedBecause) lines.push(`  not asked: ${g.notAskedBecause}`);
      if (g.openQuestion) lines.push(`  open question: ${g.openQuestion.questionId} to ${g.openQuestion.name}, ${g.openQuestion.status}`);
      for (const p of g.whoCouldAnswer) lines.push(`  who could answer: ${p.name}${p.role ? ` · ${p.role}` : ''} (${p.firsthand ? 'firsthand' : 'not firsthand'}; ${p.because ?? p.reasons[0]}) ${p.askableNow ? 'askable now' : `not now: ${p.blockedWhy.join('; ')}`}`);
    }
    const c = r.confidence;
    if (c) {
      lines.push(`confidence in "${c.statement}"`);
      lines.push(`  support: ${c.support.label} (${c.support.reasons.join('; ') || '-'}); moved by: ${c.support.movedByGapIds.length ? c.support.movedByGapIds.map((x: string) => x.split('|')[2]).join(', ') + ' gap' : 'no open gap'}; evidence: ${c.support.evidenceRefs.length} refs`);
      lines.push(`  applicability: ${c.applicability.label} (${c.applicability.reasons.join('; ') || '-'}); moved by: ${c.applicability.movedByGapIds.length ? c.applicability.movedByGapIds.map((x: string) => x.split('|')[2]).join(', ') + ' gap' : 'no open gap'}${c.applicability.settledBy.length ? `; settled by an answer (${c.applicability.settledBy.map((s: { answerId?: string; observationId?: string }) => s.answerId ?? s.observationId ?? 'observation').join(', ')})` : ''}`);
    }
    return lines.join('\n');
  }
  return typeof v === 'string' ? v : JSON.stringify(v, null, 2);
}

/** The service on KT_PORT, when it serves the same database file (else it is somebody else's and is left alone). */
async function sameDbService(): Promise<string | undefined> {
  const url = `http://127.0.0.1:${values.port}`;
  try {
    const h = (await (await fetch(`${url}/health`, { signal: AbortSignal.timeout(1500) })).json()) as { store?: string };
    return h.store && resolve(REPO_ROOT, h.store) === resolve(REPO_ROOT, values.db) ? url : undefined;
  } catch {
    return undefined;
  }
}

/** Erkki's tap without the panel: the same engine call the companion makes when he taps the answer. */
async function simulateTap(service: string | undefined, questionId: string, personEntityId: string): Promise<void> {
  if (service) {
    const dir = (await (await fetch(`${service}/directory`)).json()) as Array<{ personEntityId: string; name: string; groups: string[] }>;
    const p = dir.find((x) => x.personEntityId === personEntityId)!;
    const res = await fetch(`${service}/questions/${encodeURIComponent(questionId)}/answer`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ principal: { id: p.personEntityId, displayName: p.name, groups: p.groups, type: 'human' }, value: values.answer }),
    });
    if (!res.ok) throw new Error(`answer failed: ${res.status} ${await res.text()}`);
    return;
  }
  const { Engine } = await import('../src/apps/service/engine.ts');
  const { defaultObservabilityPolicy, defaultQuietHours } = await import('../src/apps/service/org-config.ts');
  const at = new Date(values.morning).getTime() + 60_000;
  const engine = new Engine({ dbPath: values.db, clock: () => new Date(at), investigation: { observability: defaultObservabilityPolicy }, coordinator: { quietHours: defaultQuietHours } });
  try {
    const p = engine.directory().find((x) => x.personEntityId === personEntityId)!;
    await engine.answer(questionId, { principal: { id: p.personEntityId, displayName: p.name, groups: p.groups, type: 'human' }, value: values.answer as 'yes' });
  } finally {
    engine.close();
  }
}

let movedServiceClock: string | undefined;
await connect(values.day ? undefined : values.night);
try {
  const { tools } = await client.listTools();
  say(`MCP server knowledge-twin on ${values.db}: ${tools.length} tools (${tools.map((t) => t.name).join(', ')}). Agent principal ${principal.id}, groups [${principal.groups.join(', ')}]. No model is involved in this script.`);
  if (!values.day) say(`The MCP server's clock starts at ${values.night} (${hel(values.night)} Helsinki), quiet hours on (22:00-07:00): nobody is woken at night.`);

  const inv = await call('kt_investigate', { text: values.text, principal });
  show('kt_investigate', inv);
  const investigationId = inv.investigationId as string;

  const gaps = await call('kt_list_gaps', { investigationId, principal });
  show('kt_list_gaps', gaps);
  const gap = (gaps.gaps as Array<any>).find((g) => g.decidesApplicability && g.askable) ?? (gaps.gaps as Array<any>).find((g) => g.askable);
  if (!gap) {
    say('\nNo open gap needs a person (was this database already used by a run? `pnpm demo:reset` starts over).');
  } else {
    say(`\nThe agent chooses the gap that decides ${gap.decides}: ${gap.description}`);
    const people = await call<Array<{ personEntityId: string; name: string; role?: string; askable: boolean; reasons: Array<{ text: string }> }>>('kt_find_people', { investigationId, principal });
    show('kt_find_people', people.map((p) => `${p.name}${p.role ? ` · ${p.role}` : ''} (${p.personEntityId})${p.askable ? '' : ' · not askable now'}: ${p.reasons.map((r) => r.text).join('; ')}`).join('\n'));
    const wanted = people.find((p) => p.name.toLowerCase().includes(values.prefer.toLowerCase()));
    if (!wanted) say(`\n${values.prefer} is not among the people with experience; the engine chooses.`);
    let clar = await call('kt_request_clarification', { investigationId, gapId: gap.id, ...(wanted ? { preferPersonEntityId: wanted.personEntityId } : {}), principal });
    show('kt_request_clarification', clar);
    if (clar.status === 'refused' && clar.wouldAsk) {
      const who = clar.refused?.name ?? values.prefer;
      const instead = clar.wouldAsk.name ?? clar.wouldAsk.personEntityId;
      say(`\nRefused: ${clar.reason}\nThe agent takes the engine's suggestion.`);
      // Presenter note: after the judge walkthrough Erkki has already been asked this question (nobody is asked the
      // same thing twice within 24 h), so the tap moves to someone else; say who, plainly (D-B7-15).
      say(`\n>>> PRESENTER: ${who} cannot be asked now (${(clar.refused?.why ?? []).join('; ') || 'a gate blocks it'}). If you did the walkthrough, ${who} was already asked this question.`);
      say(`>>> The tap moves to ${instead}: in the companion switch You to ${instead}. For ${who}, run on a fresh database: pnpm demo:reset, then pnpm demo:agent first.`);
      clar = await call('kt_request_clarification', { investigationId, gapId: gap.id, preferPersonEntityId: clar.wouldAsk.personEntityId, principal });
      show('kt_request_clarification', clar);
    }
    if (clar.questionId) {
      const asked = (people.find((p) => p.personEntityId === clar.personEntityId)?.name ?? clar.personEntityId) as string;
      const service = await sameDbService();
      if (clar.deliverAfter) {
        say(`\nQueued by quiet hours: deliverAfter ${clar.deliverAfter} (${hel(clar.deliverAfter)} Helsinki). Loop: ${clar.loopReason}.`);
        say(`\n--- the clock moves to ${values.morning} (${hel(values.morning)} Helsinki) ---`);
        if (service) {
          // A running activity stream (demo:play) drives the same clock on every tick; resetting it to real time
          // afterwards would fight the stream, so the clock is only handed back when it was on real time before.
          const was = await fetch(`${service}/demo/clock`).then((r) => r.json() as Promise<{ mode?: string }>).catch(() => ({ mode: undefined }));
          if (was.mode === 'simulated') {
            say(`Note: the service's clock is already simulated, most likely by the activity stream (demo:play / demo:judge). The stream moves it back on its next tick, so delivery and the tap may be timed on the stream's day. For a clean run, start demo:agent before the stream begins (demo:judge waits --stream-delay, 240 s) or run demo:judge with --no-stream.`);
          }
          const res = await fetch(`${service}/demo/clock`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ now: values.morning }) });
          if (!res.ok) throw new Error(`POST /demo/clock: ${res.status} ${await res.text()}`);
          if (was.mode !== 'simulated') movedServiceClock = service;
          say(`The service on ${service} serves this database: its demo clock is now ${hel(values.morning)}, so the companion delivers ${asked}'s question.`);
        } else {
          say(`No service on port ${values.port} serves ${values.db}: the MCP engine delivers on its own clock, so the MCP server restarts with --clock ${values.morning}.`);
          await client.close();
          await connect(values.morning);
        }
      }
      say(`\nWaiting for ${asked}'s tap in the companion (Settings → You = ${asked})…`);
      let status = await call('kt_clarification_status', { questionId: clar.questionId, principal });
      show('kt_clarification_status', status);
      if (values['simulate-tap'] && (status.status === 'delivered' || status.status === 'queued')) {
        say(`\n[--simulate-tap] ${asked} taps "${values.answer === 'yes' ? 'Yes' : values.answer === 'no' ? 'No' : 'Not sure'}" (the same engine call the companion makes${service ? `, through ${service}` : ', in-process on the same database'}).`);
        await simulateTap(service, clar.questionId, clar.personEntityId);
      }
      const deadline = Date.now() + (Number(values.wait) || 0) * 1000;
      let polls = 0;
      while (status.status !== 'answered' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        status = await call('kt_clarification_status', { questionId: clar.questionId, principal }, true);
        polls++;
      }
      if (polls) say(`\n→ kt_clarification_status (polled ${polls} more time${polls === 1 ? '' : 's'})`);
      show('kt_clarification_status', status);
      show('kt_get_context (after)', await call('kt_get_context', { investigationId, principal }));
      show('kt_list_gaps (after)', await call('kt_list_gaps', { investigationId, principal }));
    }
  }
  if (values.outcome) {
    show('kt_record_outcome', await call('kt_record_outcome', { investigationId, result: 'recovered', attemptedAction: 'interface.reset', text: 'Counters were zero; disabled and re-enabled the interface, traffic came back (reported by the field tech).', principal }));
  }
} finally {
  await client.close();
  if (movedServiceClock && !values['keep-clock']) {
    await fetch(`${movedServiceClock}/demo/clock`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }).catch(() => undefined);
    say(`\n(The service's demo clock is back on real time; --keep-clock leaves it at ${hel(values.morning)}.)`);
  }
}
