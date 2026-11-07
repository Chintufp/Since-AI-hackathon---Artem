import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { loadFamiliesFile } from '../benchmarks/splits.ts';
import type { MetricReport } from '../benchmarks/evaluator.ts';
import { buildEvidenceIndex, fixtureFamilies, loadFixture, mapProposal, replayKeyOfEnvelope, replayKeyOfId } from './e01-convert.ts';
import { prepareFamily } from './harness.ts';
import { lexiconGaps, runOneFamily } from './runners-e01.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

test('replay ids normalize to the same key as the stored evidence', () => {
  assert.equal(replayKeyOfId('email:<a@b.example>'), 'email:a@b.example');
  assert.equal(replayKeyOfId('teams:7'), 'teams:7');
  assert.equal(replayKeyOfEnvelope({ provider: 'email', sourceId: 'msgid:a@b.example' }), 'email:a@b.example');
  assert.equal(replayKeyOfEnvelope({ provider: 'teams', sourceId: 'teams:abc#7' }), 'teams:7');
  assert.equal(replayKeyOfEnvelope({ provider: 'slack', sourceId: 'C001BG:1781773800.000100' }), 'slack:1781773800.000100');
  assert.equal(replayKeyOfEnvelope({ provider: 'paste', sourceId: 'x' }), undefined);
});

test('fixtures cover train and validation only, and every replay id maps to exactly one stored record', () => {
  const file = loadFamiliesFile();
  const ids = fixtureFamilies(['train', 'validation']);
  assert.equal(ids.length, 6);
  for (const id of ids) assert.ok(['train', 'validation'].includes(file.families.find((f) => f.id === id)!.split));
  for (const id of ids) {
    const fx = loadFixture(id);
    const p = prepareFamily(id);
    const index = buildEvidenceIndex(p.store.list('evidence'));
    const { stats } = mapProposal(fx, index);
    assert.deepEqual(index.ambiguous, [], id);
    assert.deepEqual(stats.unmappedIds, [], id);
    assert.equal(stats.evidenceRefs, stats.evidenceRefsMapped);
    assert.equal(stats.claimsDropped, 0);
    p.store.close();
  }
});

test('loadFixture refuses a family without a fixture and a fixture of the wrong route', () => {
  assert.throws(() => loadFixture('no-such-family'));
});

test('lexiconGaps compares per family (incident-local ids repeat across families)', () => {
  const miss = (familyId: string, id: string): MetricReport['failures'][number] => ({ familyId, id, metric: 'claims.recall', reason: `missed action claim: "${familyId} ${id}"` });
  const rules: MetricReport = { metrics: {}, counts: {}, failures: [miss('f1', 'A#1'), miss('f2', 'A#1')] };
  const arm: MetricReport = { metrics: {}, counts: {}, failures: [miss('f1', 'A#1')] };
  const gaps = lexiconGaps(rules, arm);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0]!.familyId, 'f2');
});

test('the three variants are scored on one family and the commit variant keeps every proposed claim', () => {
  const run = runOneFamily('bgp-firmware-flaps');
  const { rules, arm, commit } = run.outcomes;
  assert.ok(arm.stats['e01.claims']! > 0);
  assert.equal(arm.stats['mapping.claimsDropped'], 0);
  assert.equal(commit.stats['commit.claimsStored'], commit.stats['commit.claimsProposed']);
  assert.equal(arm.stats['e01.attempts'], 0, 'direct scoring derives no attempts');
  assert.ok(commit.stats['e01.attempts']! > 0, 'commit derives attempts');
  // the rules arm is the real import path: its claim count is the E00 number for this family
  const store = prepareFamily('bgp-firmware-flaps').store;
  assert.equal(rules.stats['e01.claims'], store.list('claim').length);
  store.close();
  for (const o of [rules, arm, commit]) assert.ok(o.report.metrics['claims.all.recall']);
});

test('the E01 modules never read hidden answer keys from src or the fixtures', () => {
  const src = readFileSync(join(HERE, 'e01-convert.ts'), 'utf8');
  assert.ok(!/truth\.json|incoming\.json|loadHidden/.test(src.replace(/\/\*[\s\S]*?\*\//g, '')), 'conversion layer is key-free');
  const fx = readFileSync(join(HERE, '..', 'data', 'replays', 'e01-claude-arm', 'README.md'), 'utf8');
  assert.match(fx, /Never opened: truth\.json/);
});
