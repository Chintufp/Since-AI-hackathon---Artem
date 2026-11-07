/**
 * Family splits and leakage checks. Harness side only (reads hidden truth files for hashing, never for content).
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FamiliesFile, FamilyManifestEntry, Split } from '../src/libs/utils/contracts/index.ts';

export const SPLITS: Split[] = ['demo', 'train', 'validation', 'test'];

export const DEFAULT_SCENARIOS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'scenarios');

export function loadFamiliesFile(root: string = DEFAULT_SCENARIOS_DIR): FamiliesFile {
  return JSON.parse(readFileSync(join(root, 'families.json'), 'utf8')) as FamiliesFile;
}

export function loadFamilies(split: Split, root: string = DEFAULT_SCENARIOS_DIR): FamilyManifestEntry[] {
  return loadFamiliesFile(root).families.filter((f) => f.split === split);
}

export interface LeakageReport {
  ok: boolean;
  violations: string[];
  countsBySplit: Record<Split, number>;
}

/** Pure check over a manifest: unique ids, valid splits, derivedFrom exists and shares the split. */
export function checkLeakage(file: FamiliesFile): LeakageReport {
  const violations: string[] = [];
  const byId = new Map<string, FamilyManifestEntry>();
  const counts: Record<Split, number> = { demo: 0, train: 0, validation: 0, test: 0 };
  for (const f of file.families) {
    if (byId.has(f.id)) violations.push(`family "${f.id}" appears more than once (possibly in two splits)`);
    byId.set(f.id, f);
    if (!SPLITS.includes(f.split)) violations.push(`family "${f.id}" has invalid split "${f.split}"`);
    else counts[f.split]++;
  }
  const dirs = new Set<string>();
  for (const f of file.families) {
    if (dirs.has(f.dir)) violations.push(`directory "${f.dir}" is shared by two families`);
    dirs.add(f.dir);
    if (f.derivedFrom) {
      const origin = byId.get(f.derivedFrom);
      if (!origin) violations.push(`family "${f.id}" derivedFrom unknown family "${f.derivedFrom}"`);
      else if (origin.split !== f.split) {
        violations.push(`family "${f.id}" (${f.split}) derivedFrom "${origin.id}" (${origin.split}): derived families must share the split`);
      }
      if (f.derivedFrom === f.id) violations.push(`family "${f.id}" derives from itself`);
    }
  }
  return { ok: violations.length === 0, violations, countsBySplit: counts };
}

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...listFiles(p));
    else out.push(p);
  }
  return out;
}

/** Content hash of a whole family directory (paths + bytes, sorted). */
export function hashFamilyDir(root: string, dir: string): string {
  const base = join(root, dir);
  const h = createHash('sha256');
  for (const f of listFiles(base)) {
    h.update(relative(base, f));
    h.update('\u0000');
    h.update(readFileSync(f));
    h.update('\u0000');
  }
  return h.digest('hex');
}

const LOCK = 'TEST_LOCK.json';

export interface TestLock {
  note: string;
  hashes: Record<string, string>;
}

/** Records hashes of every test family. Written by the authoring build; re-freezing is a deliberate act. */
export function freezeTestLock(root: string = DEFAULT_SCENARIOS_DIR): TestLock {
  const hashes: Record<string, string> = {};
  for (const f of loadFamilies('test', root)) hashes[f.id] = hashFamilyDir(root, f.dir);
  const lock: TestLock = {
    note: 'Content hashes of held-out test families. A mismatch means a test family was edited after freezing; do not tune on test.',
    hashes,
  };
  writeFileSync(join(root, LOCK), JSON.stringify(lock, null, 2) + '\n');
  return lock;
}

export interface UntouchedReport {
  untouched: boolean;
  changed: string[];
  missing: string[];
}

/** "Test families untouched" flag: recomputes hashes and compares with TEST_LOCK.json. */
export function testFamiliesUntouched(root: string = DEFAULT_SCENARIOS_DIR): UntouchedReport {
  const lockPath = join(root, LOCK);
  const tests = loadFamilies('test', root);
  if (!existsSync(lockPath)) return { untouched: false, changed: [], missing: tests.map((t) => t.id) };
  const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as TestLock;
  const changed: string[] = [];
  const missing: string[] = [];
  for (const t of tests) {
    const expected = lock.hashes[t.id];
    if (!expected) missing.push(t.id);
    else if (expected !== hashFamilyDir(root, t.dir)) changed.push(t.id);
  }
  for (const id of Object.keys(lock.hashes)) if (!tests.some((t) => t.id === id)) missing.push(id);
  return { untouched: changed.length === 0 && missing.length === 0, changed, missing };
}
