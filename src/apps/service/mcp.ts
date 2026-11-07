/**
 * Knowledge Twin MCP server over stdio.
 *   node src/apps/service/mcp.ts [--db path|:memory:] [--agent-id id] [--agent-name name] [--agent-groups a,b]
 * stdout carries the protocol only; diagnostics go to stderr.
 */
import { parseArgs } from 'node:util';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { Engine } from './engine.ts';
import { createMcpServer, DEFAULT_AGENT } from './mcp-tools.ts';
import { DEFAULT_DB_PATH } from './paths.ts';

const { values } = parseArgs({
  options: {
    db: { type: 'string', default: process.env.KT_DB ?? DEFAULT_DB_PATH },
    'agent-id': { type: 'string' },
    'agent-name': { type: 'string' },
    'agent-groups': { type: 'string' },
  },
});

const engine = new Engine({ dbPath: values.db });
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
