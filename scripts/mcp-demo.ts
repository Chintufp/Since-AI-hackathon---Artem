/**
 * The agent path, without any model: a plain MCP client (the official SDK) starts the Knowledge Twin MCP server over
 * stdio on the SAME database the desktop uses and calls the tools an agent would, in the order an agent would:
 *   kt_investigate -> kt_find_people -> kt_request_clarification -> (wait for a human) kt_clarification_status -> kt_record_outcome
 *   node scripts/mcp-demo.ts [--db data/local/knowledge-twin.sqlite] [--text "..."] [--agent-id agent:claude-code] [--agent-groups noc]
 *                            [--wait 0] [--outcome] [--json]
 * Nothing here calls a model; the judge's own Claude (or any MCP client) can do the same with the .mcp.json in docs/DEMO.md.
 */
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { DEFAULT_DB_PATH, REPO_ROOT } from '../src/apps/service/paths.ts';

const { values } = parseArgs({
  options: {
    db: { type: 'string', default: DEFAULT_DB_PATH },
    text: { type: 'string', default: 'TRN-301: changed the SFP, link up, alarms cleared, no traffic. Not sure which unit generation this is.' },
    'agent-id': { type: 'string', default: 'agent:claude-code' },
    'agent-name': { type: 'string', default: 'Claude Code (judge)' },
    'agent-groups': { type: 'string', default: 'noc' },
    /** Seconds to wait for a human answer before reading the clarification status (0 = read once). */
    wait: { type: 'string', default: '0' },
    outcome: { type: 'boolean', default: false },
    json: { type: 'boolean', default: false },
  },
});

const principal = { id: values['agent-id'], displayName: values['agent-name'], groups: values['agent-groups'].split(',').map((s) => s.trim()).filter(Boolean) };
const client = new Client({ name: 'kt-demo-agent', version: '0.1.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(REPO_ROOT, 'src/apps/service/mcp.ts'), '--db', values.db, '--quiet-hours', 'off'], stderr: 'ignore' }));

const say = (s: string): void => { process.stdout.write(s + '\n'); };
const show = (label: string, v: unknown): void => { say(`\n## ${label}\n${values.json ? JSON.stringify(v, null, 2) : pretty(v)}`); };
async function call<T = Record<string, unknown>>(name: string, args: Record<string, unknown>): Promise<T> {
  say(`\n→ ${name}(${JSON.stringify(args)})`);
  const r = await client.callTool({ name, arguments: args });
  const first = (r.content as Array<{ type: string; text: string }>)[0]!;
  const parsed = JSON.parse(first.text);
  if (r.isError) throw new Error(`${name}: ${parsed.error}`);
  return parsed as T;
}
function pretty(v: unknown): string {
  const r = v as Record<string, any>;
  if (r && typeof r === 'object' && 'recommendation' in r) {
    const rec = r.recommendation;
    const lines = [
      `investigationId: ${r.investigationId}`,
      `recommendation (${rec.kind}, applicability ${rec.applicability}): ${rec.text}`,
      ...(rec.nextStep ? [`next step: ${rec.nextStep}`] : []),
      ...rec.caveats.map((c: string) => `caveat: ${c}`),
      `matches: ${(r.matches as Array<{ title: string; matching: string[]; missing: string[] }>).slice(0, 3).map((m) => `${m.title} [matching: ${m.matching.join(', ') || '-'}; unknown: ${m.missing.join(', ') || '-'}]`).join(' | ')}`,
      `people: ${(r.people as Array<{ name: string; reasons: Array<{ text: string }> }>).map((p) => `${p.name} (${p.reasons.map((x) => x.text).join('; ')})`).join(' | ') || '-'}`,
      `gaps: ${(r.gaps as Array<{ description: string; status: string }>).map((g) => `${g.description} [${g.status}]`).join(' | ') || '-'}`,
      `loop: ${r.loop}${r.loopReason ? ` — ${r.loopReason}` : ''}`,
      `routes: ${(r.routes as Array<{ route: string; version: string }>).map((x) => `${x.route}:${x.version}`).join(', ')}`,
    ];
    return lines.join('\n');
  }
  return JSON.stringify(v, null, 2);
}

try {
  const { tools } = await client.listTools();
  say(`MCP server knowledge-twin on ${values.db}: ${tools.length} tools (${tools.map((t) => t.name).join(', ')}). Agent principal ${principal.id}, groups [${principal.groups.join(', ')}]. No model is involved in this script.`);
  const inv = await call('kt_investigate', { text: values.text, principal });
  show('kt_investigate', inv);
  const people = await call<unknown[]>('kt_find_people', { investigationId: inv.investigationId, principal });
  show('kt_find_people', (people as Array<{ name: string; role?: string; askable: boolean; reasons: Array<{ text: string }> }>).map((p) => `${p.name}${p.role ? ` · ${p.role}` : ''}${p.askable ? '' : ' · not askable now'}: ${p.reasons.map((r) => r.text).join('; ')}`).join('\n'));
  const clar = await call<{ status: string; questionId?: string; text?: string; reason: string }>('kt_request_clarification', { investigationId: inv.investigationId, principal });
  show('kt_request_clarification', clar);
  if (clar.questionId) {
    const wait = Number(values.wait) || 0;
    if (wait > 0) {
      say(`\nWaiting up to ${wait} s for a human to answer "${clar.text}" in the companion (Settings → You = the person asked)…`);
      const deadline = Date.now() + wait * 1000;
      let status = await call<{ status: string }>('kt_clarification_status', { questionId: clar.questionId, principal });
      while (status.status !== 'answered' && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 2000));
        status = await call<{ status: string }>('kt_clarification_status', { questionId: clar.questionId, principal });
      }
      show('kt_clarification_status', status);
    } else {
      show('kt_clarification_status', await call('kt_clarification_status', { questionId: clar.questionId, principal }));
    }
    show('kt_get_context (after)', await call('kt_get_context', { investigationId: inv.investigationId, principal }));
  }
  if (values.outcome) {
    show('kt_record_outcome', await call('kt_record_outcome', { investigationId: inv.investigationId, result: 'recovered', attemptedAction: 'interface.reset', text: 'Counters were zero; disabled and re-enabled the interface, traffic came back (reported by the field tech).', principal }));
  }
} finally {
  await client.close();
}
