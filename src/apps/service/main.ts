/**
 * Knowledge Twin local service.
 *   node src/apps/service/main.ts [--port 47831] [--db path|:memory:] [--seed elisa|synthetic|empty] [--host 127.0.0.1]
 * --seed runs the demo reset (clearing the database) before listening.
 */
import { parseArgs } from 'node:util';
import { DEFAULT_SERVICE_PORT } from '../../libs/utils/contracts/index.ts';
import { Engine } from './engine.ts';
import { DEFAULT_DB_PATH } from './paths.ts';
import { startHttp } from './http.ts';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: String(DEFAULT_SERVICE_PORT) },
    host: { type: 'string', default: '127.0.0.1' },
    db: { type: 'string', default: DEFAULT_DB_PATH },
    seed: { type: 'string' },
  },
});

const port = Number(values.port);
if (!Number.isInteger(port) || port < 0 || port > 65535) {
  process.stderr.write(`Invalid --port ${values.port}\n`);
  process.exit(2);
}
if (values.seed !== undefined && !['elisa', 'synthetic', 'empty'].includes(values.seed)) {
  process.stderr.write(`Invalid --seed ${values.seed} (elisa | synthetic | empty)\n`);
  process.exit(2);
}

const engine = new Engine({ dbPath: values.db });
if (values.seed) {
  const r = await engine.resetDemo(values.seed as 'elisa' | 'synthetic' | 'empty');
  process.stderr.write(`demo seed "${values.seed}": ${r.imported.length} imports\n`);
}
const http = await startHttp({ engine, port, host: values.host });
process.stdout.write(`Knowledge Twin service listening on ${http.url} (db: ${engine.dbPath})\n`);

let closing = false;
const shutdown = async (signal: string): Promise<void> => {
  if (closing) return;
  closing = true;
  process.stderr.write(`${signal}: shutting down\n`);
  await http.close();
  engine.close();
  process.exit(0);
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
