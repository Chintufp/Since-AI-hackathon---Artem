/**
 * Film finale: a real MCP client (the official SDK, no model) starts the Knowledge Twin MCP server over stdio on the
 * SAME database the film service uses and calls two tools, printed large and plain:
 *   kt_investigate on a new unit -> the chain it reuses, with sources and people;
 *   kt_request_clarification   -> the agent organises one question for a person (every gate applies).
 *   pnpm film:agent --db <the film's temp db> [--text "..."] [--json]
 * The film runner prints the exact command with its --db.
 */
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { REPO_ROOT } from '../src/apps/service/paths.ts';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    db: { type: 'string' },
    text: { type: 'string', default: 'TRN-423 at Masku: link is up but no traffic after the v6 template rollout.' },
    json: { type: 'boolean', default: false },
    /** Ask this person (name prefix) if every gate allows it; otherwise the engine's choice is reported. */
    prefer: { type: 'string' },
  },
});
if (!values.db) { process.stderr.write('--db <the film database> is required (pnpm film prints it)\n'); process.exit(2); }
const say = (s = ''): void => { process.stdout.write(s + '\n'); };
const rule = () => say('─'.repeat(72));
const principal = { id: 'agent:claude-code', displayName: 'Claude Code (agent)', groups: ['noc'] };

const client = new Client({ name: 'lumi-film-agent', version: '0.1.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(REPO_ROOT, 'src/apps/service/mcp.ts'), '--db', values.db, '--quiet-hours', 'off'], stderr: 'ignore' }));
async function call<T = Record<string, any>>(name: string, args: Record<string, unknown>): Promise<T> {
  say(`\n▶ ${name}`);
  const r = await client.callTool({ name, arguments: args });
  const first = (r.content as Array<{ type: string; text: string }>)[0]!;
  if (r.isError) throw new Error(`${name}: ${first.text}`);
  return JSON.parse(first.text) as T;
}

// Few lines, large enough to read on video: the problem, Lumi's answer, the case it rests on (and who said it), and the
// question the agent organises for a person. --prefer "<name>" asks that person if every gate allows it.
const ro = new DatabaseSync(values.db, { readOnly: true });
const nameOf = (id: string): string => (ro.prepare("select json_extract(json, '$.name') as name from r_entity where id = ?").get(id) as { name?: string } | undefined)?.name ?? id;
const preferId = values.prefer ? (ro.prepare("select id from r_entity where json_extract(json, '$.type') = 'person' and json_extract(json, '$.name') like ? limit 1").get(`${values.prefer}%`) as { id?: string } | undefined)?.id : undefined;
say('AI AGENT  →  Lumi  (MCP)');
rule();
say(`  ${values.text}`);
const inv = await call('kt_investigate', { text: values.text, principal });
if (values.json) say(JSON.stringify(inv, null, 2));
const rec = inv.recommendation;
say(`\n  LUMI      ${rec.text}`);
const tl = (inv.caseView?.timeline ?? []) as Array<{ stage: string; label: string; who?: string; when?: string; evidence?: Array<{ excerpt?: string }> }>;
say(`  FROM      ${inv.caseView?.title ?? (inv.matches?.[0]?.title ?? '')}`);
for (const t of tl.slice(0, 3)) say(`            "${(t.evidence?.[0]?.excerpt ?? t.label).slice(0, 70)}"${t.who ? `  — ${t.who}` : ''}`);
say(`  PEOPLE    ${(inv.people ?? []).slice(0, 3).map((p: { name: string }) => p.name).join(', ') || '-'}`);
rule();
const cl = await call('kt_request_clarification', { investigationId: inv.investigationId, principal, ...(preferId ? { preferPersonEntityId: preferId } : {}) });
if (values.json) say(JSON.stringify(cl, null, 2));
if (cl.text) say(`\n  ASKS      "${cl.text}"`);
if (cl.personEntityId) say(`  TO        ${nameOf(cl.personEntityId)}  (in their Lumi; the agent never contacts anyone directly)`);
else if (cl.reason) say(`\n  ${cl.status}: ${cl.reason}`);
rule();
ro.close();
await client.close();
process.exit(0);
