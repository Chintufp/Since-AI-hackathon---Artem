import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Principal } from '../src/libs/utils/contracts/index.ts';
import { Engine, type EngineOptions } from '../src/apps/service/engine.ts';
import { startHttp, type RunningHttp } from '../src/apps/service/http.ts';

export const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DEV_FIXTURE = join(ROOT, 'data', 'fixtures', 'dev-family-01');
export const SCENARIOS = join(ROOT, 'data', 'scenarios');

export const human = (id: string, displayName: string, groups: string[] = []): Principal => ({ id, displayName, groups, type: 'human' });
export const agent = (id: string, displayName: string, groups: string[] = []): Principal => ({ id, displayName, groups, type: 'agent' });

export interface Running {
  engine: Engine;
  http: RunningHttp;
  call<T = any>(method: string, path: string, body?: unknown, expect?: number): Promise<T>;
  close(): Promise<void>;
}

/** Engine + HTTP server on an ephemeral port. dbPath defaults to ':memory:'. */
export async function startService(opts: EngineOptions = {}): Promise<Running> {
  const engine = new Engine({ dbPath: ':memory:', clock: () => new Date('2026-11-07T12:00:00.000Z'), ...opts });
  const http = await startHttp({ engine, port: 0, log: () => {} });
  const call = async (method: string, path: string, body?: unknown, expect = 200): Promise<any> => {
    const res = await fetch(http.url + path, {
      method, ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
    const json = await res.json();
    if (res.status !== expect) throw new Error(`${method} ${path} -> ${res.status} (expected ${expect}): ${JSON.stringify(json).slice(0, 400)}`);
    return json;
  };
  return { engine, http, call, close: async () => { await http.close(); engine.close(); } };
}
