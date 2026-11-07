/** Brief 5.4: E10 is hash-locked. The committed result files reproduce the hash in lock.json (timestamps left out). */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { DEFAULT_RESULTS_DIR } from '../benchmarks/manifest.ts';
import { resultsSha256 } from '../experiments/common.ts';

test('E10 lock: the committed results, per-seed and decision files match lock.json', () => {
  const lock = JSON.parse(readFileSync(join(DEFAULT_RESULTS_DIR, 'e10-store-metric', 'lock.json'), 'utf8')) as { files: string[]; resultsSha256: string };
  assert.deepEqual(lock.files, ['results.json', 'per-seed.json', 'decision.json']);
  assert.equal(resultsSha256('e10-store-metric', lock.files), lock.resultsSha256);
  assert.match(lock.resultsSha256, /^[0-9a-f]{16}$/);
});
