import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FamiliesFile } from '../src/libs/utils/contracts/index.ts';
import { DEFAULT_SCENARIOS_DIR, SPLITS, checkLeakage, loadFamilies, loadFamiliesFile, testFamiliesUntouched } from './splits.ts';

const file = loadFamiliesFile();

test('real families: no leakage, expected split sizes', () => {
  const r = checkLeakage(file);
  assert.deepEqual(r.violations, []);
  assert.equal(r.ok, true);
  assert.deepEqual(r.countsBySplit, { demo: 2, train: 4, validation: 2, test: 2 });
  assert.ok(file.families.length >= 10);
  for (const s of SPLITS) assert.equal(loadFamilies(s).length, r.countsBySplit[s]);
});

test('every real family appears in exactly one split and one directory', () => {
  const seen = new Set<string>();
  for (const s of SPLITS) for (const f of loadFamilies(s)) {
    assert.ok(!seen.has(f.id), `${f.id} in two splits`);
    seen.add(f.id);
  }
  assert.equal(seen.size, file.families.length);
});

test('leakage check catches duplicate family, wrong-split derivation and unknown origin', () => {
  const mk = (over: Partial<FamiliesFile['families'][number]>[]): FamiliesFile => ({
    version: '0', generatedBy: 't',
    families: over.map((o, i) => ({ id: `f${i}`, split: 'train', dir: `f${i}`, description: '', tags: [], ...o })),
  });
  assert.equal(checkLeakage(mk([{}, {}])).ok, true);
  assert.equal(checkLeakage(mk([{ id: 'x' }, { id: 'x', split: 'test', dir: 'y' }])).ok, false, 'same family in two splits');
  const wrong = checkLeakage(mk([{ id: 'a', split: 'train' }, { id: 'b', split: 'test', derivedFrom: 'a' }]));
  assert.equal(wrong.ok, false);
  assert.match(wrong.violations.join(' '), /share the split/);
  assert.equal(checkLeakage(mk([{ id: 'a', derivedFrom: 'missing' }])).ok, false);
  assert.equal(checkLeakage(mk([{ id: 'a', derivedFrom: 'a' }])).ok, false);
  assert.equal(checkLeakage(mk([{ id: 'a', derivedFrom: 'b' }, { id: 'b' }])).ok, true, 'derived from a same-split family is fine');
  assert.equal(checkLeakage(mk([{ id: 'a', dir: 'same' }, { id: 'b', dir: 'same' }])).ok, false, 'shared directory');
});

test('test families are untouched since freezing; editing one is detected', () => {
  assert.equal(testFamiliesUntouched().untouched, true);
  const tmp = mkdtempSync(join(tmpdir(), 'scn-'));
  cpSync(DEFAULT_SCENARIOS_DIR, tmp, { recursive: true });
  assert.equal(testFamiliesUntouched(tmp).untouched, true);
  const target = join(tmp, loadFamilies('test', tmp)[0]!.dir, 'truth.json');
  writeFileSync(target, readFileSync(target, 'utf8') + ' ');
  const r = testFamiliesUntouched(tmp);
  assert.equal(r.untouched, false);
  assert.equal(r.changed.length, 1);
  // editing a train family does not trip the flag
  const tmp2 = mkdtempSync(join(tmpdir(), 'scn-'));
  cpSync(DEFAULT_SCENARIOS_DIR, tmp2, { recursive: true });
  const t2 = join(tmp2, loadFamilies('train', tmp2)[0]!.dir, 'truth.json');
  writeFileSync(t2, readFileSync(t2, 'utf8') + ' ');
  assert.equal(testFamiliesUntouched(tmp2).untouched, true);
});
