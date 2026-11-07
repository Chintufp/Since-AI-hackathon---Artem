/** B5: the unit.batch vocabulary (DECISIONS-disagree.md D-B5-03..07). No model, no network. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Condition } from '../contracts/index.ts';
import { defaultConditionParsers } from '../memory/extraction-config.ts';
import { compareConditions } from '../retrieval/index.ts';
import { actionPhrase, DEFAULT_PHRASES, parseProblemText } from './index.ts';
import { defaultInvestigationSettings } from './settings.ts';

const batchParser = defaultConditionParsers.find((p) => p.key === 'unit.batch')!;
const capture = (text: string) => {
  const m = batchParser.pattern.exec(text);
  return m ? batchParser.build(m) : undefined;
};
const ev = [{ evidenceId: 'ev_x' }];
const cond = (key: string, value: string | number, label: string): Condition => ({ key, operator: 'eq', value, label, evidence: ev, origin: 'reported' });

test('unit.batch: capture and query parsers agree on key and value for a 202x batch, and both skip the 2019 batch', () => {
  assert.deepEqual(capture('It is the 2021 batch.'), { operator: 'eq', value: '2021', label: '2021 batch' });
  assert.equal(capture('Is this one from the 2019 batch?'), undefined, 'the synthetic TRN-117 sentence stays without a batch');
  const q = parseProblemText('Is TRN-577 one of the 2021 batch units?', 'p1').conditions.find((c) => c.key === 'unit.batch');
  assert.equal(q?.value, '2021');
  assert.equal(q?.label, '2021 batch');
  assert.equal(parseProblemText('Not sure which batch this unit is from.', 'p2').conditions.some((c) => c.key === 'unit.batch'), false);
  assert.equal(parseProblemText('Unit from the 2019 batch.', 'p3').conditions.some((c) => c.key === 'unit.batch'), false);
});

test('unit.batch: distinguishing, asked with its own template, observable by the equipment roles; table.clear has words', () => {
  const s = defaultInvestigationSettings();
  assert.ok(s.distinguishingKeys.includes('unit.batch'));
  assert.equal(s.questions.conditionTemplates['unit.batch'], 'Is {asset} from the {value} batch?');
  const p = actionPhrase('table.clear', DEFAULT_PHRASES);
  assert.equal(p.imperative, 'clear the forwarding table');
  assert.equal(p.gerund, 'clearing the forwarding table');
  assert.equal(DEFAULT_PHRASES.recoveries['table.clear'], 'restored traffic');
});

test('unit.batch: a later batch conflicts with a flat "older unit" in the problem, is missing when the problem says nothing about age', () => {
  const s = defaultInvestigationSettings();
  const opts = { ageFold: s.ageFold, ignoredKeys: s.ignoredKeys, historyKeys: s.historyKeys };
  const caseConds = [cond('traffic.counters', 'zero', 'Traffic counters zero'), cond('unit.batch', '2021', '2021 batch')];
  const older = compareConditions([cond('unit.age', 'older', 'Older unit')], caseConds, opts);
  assert.deepEqual(older.conflicting.map((c) => c.label), ['2021 batch (this problem: Older unit)']);
  assert.ok(!older.missing.some((m) => m.key === 'unit.batch'));
  const silent = compareConditions([cond('traffic.counters', 'zero', 'Traffic counters zero')], caseConds, opts);
  assert.deepEqual(silent.missing.map((m) => m.key), ['unit.batch']);
  assert.equal(silent.conflicting.length, 0);
  // An inferred "older" (folded from a year) conflicts too: the fold already decided the age class from a flat year.
  const year = compareConditions([cond('unit.installed_year', 2018, 'Installed in 2018')], caseConds, opts);
  assert.equal(year.conflicting.length, 1);
  // A batch at or before the cutoff, or a case that records its age itself, is left to the ordinary comparison.
  assert.equal(compareConditions([cond('unit.age', 'older', 'Older unit')], [cond('unit.batch', '2019', '2019 batch')], opts).conflicting.length, 0);
  assert.equal(compareConditions([cond('unit.age', 'older', 'Older unit')], [cond('unit.batch', '2021', '2021 batch'), cond('unit.age', 'older', 'Older unit')], opts).conflicting.length, 0);
});

test('store health: a recorded batch counts toward the unit generation (unit.age), not as a fifth distinguishing slot', async () => {
  const { Engine } = await import('../../../apps/service/engine.ts');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const e = new Engine({ dbPath: ':memory:', clock: () => new Date('2026-11-07T12:00:00.000Z') });
  try {
    e.importData({ format: 'scenario-dir', path: join(dirname(fileURLToPath(import.meta.url)), '../../../../data/demo/experts-disagree') });
    const trn512 = e.storeHealth().cases.find((c) => c.title.startsWith('TRN-512'))!;
    assert.equal(trn512.slots.distinguishing, 0.25, 'one of unit.age (via its batch), unit.model, unit.revision, software.version');
  } finally {
    e.close();
  }
});
