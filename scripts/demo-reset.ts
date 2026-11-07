/**
 * Reset the local demo database: clear it (settings are kept) and import the Elisa example (when present under
 * private/), the demo scenario families and the developer fixture.
 *   node scripts/demo-reset.ts [--db path] [--seed elisa|synthetic|empty]
 */
import { parseArgs } from 'node:util';
import { Engine } from '../src/apps/service/engine.ts';
import { defaultObservabilityPolicy } from '../src/apps/service/org-config.ts';
import { DEFAULT_DB_PATH } from '../src/apps/service/paths.ts';

const { values } = parseArgs({ options: { db: { type: 'string', default: DEFAULT_DB_PATH }, seed: { type: 'string' } } });
if (values.seed !== undefined && !['elisa', 'synthetic', 'empty'].includes(values.seed)) {
  process.stderr.write(`Invalid --seed ${values.seed} (elisa | synthetic | empty)\n`);
  process.exit(2);
}

const engine = new Engine({ dbPath: values.db, investigation: { observability: defaultObservabilityPolicy } });
try {
  const r = await engine.resetDemo(values.seed as 'elisa' | 'synthetic' | 'empty' | undefined);
  process.stdout.write(`Demo reset on ${engine.dbPath}\n`);
  for (const i of r.imported) {
    process.stdout.write(`  ${i.batch.sourceDescription}: ${i.cases} cases, ${i.claims} claims, ${i.entities} entities, ${i.people} people (seen ${i.batch.counts.seen}, inserted ${i.batch.counts.inserted})\n`);
  }
  const s = engine.store;
  process.stdout.write(`Totals: ${s.count('case')} cases, ${s.count('claim')} claims, ${s.count('evidence')} evidence, ${s.count('entity', { type: 'person' })} people\n`);
} finally {
  engine.close();
}
