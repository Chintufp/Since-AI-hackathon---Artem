import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readManifest, readResults, validateManifest, writeManifest, writeResults } from './manifest.ts';
import type { RunManifest } from './manifest.ts';

const base: RunManifest = {
  id: 'e00-test-run',
  hypothesis: 'The perfect reference scores 1.0 where defined',
  datasetVersion: '1.0.0',
  splits: ['train'],
  visibleInputs: ['sources', 'people.json', 'problem text', 'observations'],
  variants: [{ id: 'reference-oracle', description: 'built from truth', route: 'rules' }],
  config: { matchThreshold: 0.5 },
  seeds: [1],
  route: 'rules',
  resourceCap: { maxWallSeconds: 60, networkCalls: 0 },
  metrics: ['claims.all.precision'],
  acceptanceCriteria: [],
  stopRule: 'single pass',
  startedAt: '2026-11-07T00:00:00.000Z',
};

test('manifest round trip and results require a manifest', () => {
  const root = mkdtempSync(join(tmpdir(), 'res-'));
  writeManifest(base, root);
  assert.deepEqual(readManifest('e00-test-run', root), base);
  assert.throws(() => writeResults({ manifestId: 'nope', finishedAt: 'x', variants: [], notes: [] }, root), /no manifest/);
  writeResults({ manifestId: 'e00-test-run', finishedAt: 'x', notes: ['n'], variants: [{ variantId: 'reference-oracle', provenance: 'reference-oracle', split: 'train', metrics: { m: null }, counts: {}, failures: [], failureSlicesByTag: {} }] }, root);
  assert.equal(readResults('e00-test-run', root).variants[0]!.metrics['m'], null);
});

test('manifest validation rejects incomplete, unsafe and key-exposing manifests', () => {
  assert.ok(validateManifest({}).length > 5);
  assert.ok(validateManifest({ ...base, id: '../escape' }).length > 0);
  assert.ok(validateManifest({ ...base, variants: [] }).length > 0);
  assert.ok(validateManifest({ ...base, visibleInputs: ['truth.json'] }).length > 0);
  assert.deepEqual(validateManifest(base), []);
  assert.throws(() => writeManifest({ ...base, id: 'bad id!' }, tmpdir()), /invalid manifest/);
});
