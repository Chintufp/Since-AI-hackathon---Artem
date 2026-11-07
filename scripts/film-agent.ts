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

say('AGENT  →  Lumi over MCP   (real MCP client, same database as the film service)');
rule();
say(`problem: ${values.text}`);
const inv = await call('kt_investigate', { text: values.text, principal });
if (values.json) say(JSON.stringify(inv, null, 2));
const rec = inv.recommendation;
say(`\n  RECOMMENDATION   ${rec.kind} · applicability ${rec.applicability}`);
say(`  ${rec.text}`);
if (rec.nextStep) say(`  next: ${rec.nextStep}`);
say('\n  CHAIN IT RESTS ON');
for (const m of (inv.matches ?? []).slice(0, 2)) {
  say(`  ${m.title}`);
  if (m.matching?.length) say(`    matches: ${m.matching.join(', ')}`);
  if (m.missing?.length) say(`    unknown here: ${m.missing.join(', ')}`);
}
const tl = (inv.caseView?.timeline ?? []) as Array<{ stage: string; label: string; who?: string; when?: string; evidence?: Array<{ excerpt?: string }> }>;
if (tl.length) say(`  the recommendation's case, ${inv.caseView?.title ?? ''}:`);
for (const t of tl.slice(0, 6)) say(`    ${t.stage.padEnd(12)} ${t.evidence?.[0]?.excerpt ?? t.label}${t.who ? `  — ${t.who}` : ''}`);
say('\n  PEOPLE');
for (const p of (inv.people ?? []).slice(0, 4)) say(`  ${p.name}: ${(p.reasons ?? []).slice(0, 2).map((x: { text: string }) => x.text).join('; ')}`);
rule();
const cl = await call('kt_request_clarification', { investigationId: inv.investigationId, principal });
if (values.json) say(JSON.stringify(cl, null, 2));
say(`\n  STATUS     ${cl.status}`);
if (cl.text) say(`  QUESTION   "${cl.text}"`);
if (cl.personEntityId) {
  // The name from the same database, read only (the MCP result carries the id).
  const ro = new DatabaseSync(values.db, { readOnly: true });
  const row = ro.prepare("select json_extract(json, '$.name') as name from r_entity where id = ?").get(cl.personEntityId) as { name?: string } | undefined;
  ro.close();
  say(`  TO         ${row?.name ?? cl.personEntityId}`);
}
if (cl.reason) say(`  WHY        ${cl.reason}`);
say('\n  The agent never contacts anyone directly: the question reaches the person in their Lumi app,');
say('  under the same limits, access rules and receipts as a question from a colleague.');
rule();
await client.close();
process.exit(0);
