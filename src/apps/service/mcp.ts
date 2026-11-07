/**
 * Knowledge Twin MCP server over stdio.
 *   node src/apps/service/mcp.ts [--db path|:memory:] [--agent-id id] [--agent-name name] [--agent-groups a,b]
 * stdout carries the protocol only; diagnostics go to stderr.
 */
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Engine } from './engine.ts';
import { defaultObservabilityPolicy, defaultQuietHours } from './org-config.ts';
import { createMcpServer, DEFAULT_AGENT } from './mcp-tools.ts';
import { DEFAULT_DB_PATH } from './paths.ts';

const { values } = parseArgs({
  options: {
    /** 'default' applies the documented organization observability policy (org-config.ts); 'none' disables it (tests). */
    'org-policy': { type: 'string', default: process.env.KT_ORG_POLICY ?? 'default' },
    /** B1: 'default' holds questions created 22:00-07:00 Helsinki time until 07:00; 'off' disables (also off with --org-policy none). */
    'quiet-hours': { type: 'string', default: process.env.KT_QUIET_HOURS ?? 'default' },
    db: { type: 'string', default: process.env.KT_DB ?? DEFAULT_DB_PATH },
    'agent-id': { type: 'string' },
    'agent-name': { type: 'string' },
    'agent-groups': { type: 'string' },
  },
});

const engine = new Engine({
  dbPath: values.db, investigation: values['org-policy'] === 'none' ? {} : { observability: defaultObservabilityPolicy },
  ...(values['org-policy'] === 'none' || values['quiet-hours'] === 'off' ? {} : { coordinator: { quietHours: defaultQuietHours } }),
});
const fallback = {
  ...DEFAULT_AGENT,
  ...(values['agent-id'] ? { id: values['agent-id'] } : {}),
  ...(values['agent-name'] ? { displayName: values['agent-name'] } : {}),
  groups: values['agent-groups'] ? values['agent-groups'].split(',').map((g) => g.trim()).filter(Boolean) : [],
};
const server = createMcpServer(engine, fallback);
await server.connect(new StdioServerTransport());
process.stderr.write(`knowledge-twin MCP server ready (db: ${engine.dbPath})\n`);

const shutdown = async (): Promise<void> => {
  await server.close();
  engine.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());
process.stdin.on('end', () => void shutdown());
