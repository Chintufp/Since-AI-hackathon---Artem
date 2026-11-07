import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoChips, DEMO_PERSONAS } from './demo-chips.ts';
import type { DirectoryEntry } from '../contracts/service.ts';

const dir = (...names: Array<[string, string]>): DirectoryEntry[] => names.map(([id, name]) => ({ personEntityId: id, name, groups: [], available: true }));

test('B6 chips: Be Veikko (field) and Be Erkki (expert), resolved from the directory by name', () => {
  assert.deepEqual(DEMO_PERSONAS.map((p) => [p.label, p.part]), [['Be Veikko', 'field'], ['Be Erkki', 'expert']]);
  const d = dir(['person:a', 'Aarne Koskela'], ['person:v', 'Veikko Vikkelä'], ['person:e', 'Erkki Expert']);
  const chips = demoChips(d, 'person:v');
  assert.deepEqual(chips.map((c) => [c.key, c.personEntityId, c.active]), [['veikko', 'person:v', true], ['erkki', 'person:e', false]]);
  assert.deepEqual(demoChips(d, 'person:e').map((c) => c.active), [false, true]);
  assert.deepEqual(demoChips(d, 'person:a').map((c) => c.active), [false, false], 'someone else chosen under Settings -> You');
  assert.deepEqual(demoChips(d).map((c) => c.active), [false, false], 'no identity yet');
});

test('B6 chips: accents ignored; a unique first name is enough; absent people get no chip', () => {
  assert.deepEqual(demoChips(dir(['person:v', 'Veikko Vikkela'], ['person:e', 'erkki expert'])).map((c) => c.personEntityId), ['person:v', 'person:e']);
  assert.deepEqual(demoChips(dir(['person:v', 'Veikko V.'])).map((c) => c.key), ['veikko']);
  assert.deepEqual(demoChips(dir(['person:1', 'Erkki One'], ['person:2', 'Erkki Two'])), [], 'an ambiguous first name gets no chip');
  assert.deepEqual(demoChips(dir(['person:h', 'Helmi Virtanen'])), [], 'a clean clone without the Elisa people shows no chips');
  assert.deepEqual(demoChips([]), []);
});
