/**
 * Knowledge Twin MCP server over stdio.
 *   node src/apps/service/mcp.ts [--db path|:memory:] [--agent-id id] [--agent-name name] [--agent-groups a,b]
 *                                [--quiet-hours on|off] [--clock 2026-11-08T01:00:00Z]
 * stdout carries the protocol only; diagnostics go to stderr.
 */
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createDemoClock } from './demo-clock.ts';
import { Engine } from './engine.ts';
import { defaultObservabilityPolicy, defaultQuietHours, defaultStandingGaps } from './org-config.ts';
import { createMcpServer, DEFAULT_AGENT } from './mcp-tools.ts';
import { DEFAULT_DB_PATH } from './paths.ts';

const { values } = parseArgs({
  options: {
    /** 'default' applies the documented organization observability policy (org-config.ts); 'none' disables it (tests). */
    'org-policy': { type: 'string', default: process.env.KT_ORG_POLICY ?? 'default' },
    /** B1: 'default' (or 'on') holds questions created 22:00-07:00 Helsinki time until 07:00; 'off' disables (also off with --org-policy none). */
    'quiet-hours': { type: 'string', default: process.env.KT_QUIET_HOURS ?? 'default' },
    /** B7: start the engine clock at this simulated moment (ISO 8601 with a zone); it then runs at real speed. */
    clock: { type: 'string', default: process.env.KT_CLOCK },
    /** B1: 'default' asks capture-time standing gaps; 'off' only records them (also off with --org-policy none). */
    'standing-gaps': { type: 'string', default: process.env.KT_STANDING_GAPS ?? 'default' },
    db: { type: 'string', default: process.env.KT_DB ?? DEFAULT_DB_PATH },
    'agent-id': { type: 'string' },
    'agent-name': { type: 'string' },
    'agent-groups': { type: 'string' },
  },
});

if (!['default', 'on', 'off'].includes(values['quiet-hours'])) {
  process.stderr.write(`Invalid --quiet-hours ${values['quiet-hours']} (on | off | default)\n`);
  process.exit(2);
}
const demoClock = createDemoClock();
if (values.clock) {
  // A time without a zone would be read in the machine's local zone and shift quiet hours on a judge's laptop.
  if (!/(?:Z|[+-]\d{2}:?\d{2})$/i.test(values.clock.trim())) {
    process.stderr.write(`Invalid --clock ${values.clock}: give a zone (Z or +hh:mm), e.g. 2026-11-08T01:00:00Z\n`);
    process.exit(2);
  }
  try {
    demoClock.set({ now: values.clock });
  } catch (e) {
    process.stderr.write(`Invalid --clock ${values.clock}: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(2);
  }
}

const engine = new Engine({
  demoClock,
  dbPath: values.db, investigation: values['org-policy'] === 'none' ? {} : { observability: defaultObservabilityPolicy },
  ...(values['org-policy'] === 'none' || values['quiet-hours'] === 'off' ? {} : { coordinator: { quietHours: defaultQuietHours } }),
  ...(values['org-policy'] === 'none' || values['standing-gaps'] === 'off' ? {} : { standingGaps: defaultStandingGaps }),
});
const fallback = {
  ...DEFAULT_AGENT,
  ...(values['agent-id'] ? { id: values['agent-id'] } : {}),
  ...(values['agent-name'] ? { displayName: values['agent-name'] } : {}),
  groups: values['agent-groups'] ? values['agent-groups'].split(',').map((g) => g.trim()).filter(Boolean) : [],
};
const server = createMcpServer(engine, fallback);
await server.connect(new StdioServerTransport());
process.stderr.write(`knowledge-twin MCP server ready (db: ${engine.dbPath}${values.clock ? `, clock ${demoClock.now().toISOString()} simulated` : ''})\n`);

const shutdown = async (): Promise<void> => {
  await server.close();
  engine.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.stdin.on('end', () => void shutdown());
