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
  assert.deepEqual(demoChips(dir(['person:h', 'Helmi Virtanen'])), [], 'a directory with none of the demo people (Elisa or clean-clone stand-in) shows no chips');
  assert.deepEqual(demoChips([]), []);
});

test('B6 chips on a clean clone (D-B6-27): Ville Ranta stands in for Veikko, Erkki stays; Pekka only when Erkki is absent', () => {
  const clone = dir(['person:a', 'Aarne Koskela'], ['person:e', 'Erkki Expert'], ['person:p', 'Pekka Laine'], ['person:vr', 'Ville Ranta']);
  assert.deepEqual(demoChips(clone, 'person:vr').map((c) => [c.label, c.personEntityId, c.active]), [['Be Ville', 'person:vr', true], ['Be Erkki', 'person:e', false]]);
  assert.deepEqual(demoChips(dir(['person:vr', 'Ville Ranta'], ['person:p', 'Pekka Laine'])).map((c) => c.label), ['Be Ville', 'Be Pekka']);
  const both = dir(['person:v', 'Veikko Vikkelä'], ['person:e', 'Erkki Expert'], ['person:vr', 'Ville Ranta'], ['person:p', 'Pekka Laine']);
  assert.deepEqual(demoChips(both).map((c) => c.label), ['Be Veikko', 'Be Erkki'], 'the Elisa people win when present');
});
