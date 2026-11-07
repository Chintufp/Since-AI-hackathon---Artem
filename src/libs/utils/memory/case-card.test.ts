import assert from 'node:assert/strict';
import { test } from 'node:test';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Attempt, Case, Claim, Condition, Entity, Outcome } from '../contracts/index.ts';
import { caseCard } from './case-card.ts';
import { importFromPath, listCases, openStore } from './index.ts';

const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const scope = { visibility: 'org' as const };
const erkki = { id: 'person:x:erkki', displayName: 'Erkki Expert' };
const veikko = { id: 'person:x:veikko', displayName: 'Veikko Vikkelä' };
const cond = (key: string, value: string | number, label: string, origin: 'reported' | 'inferred' = 'reported'): Condition => ({ key, operator: 'eq', value, label, origin, evidence: [] });
const claim = (id: string, c: Condition, statement: string, by = veikko): Claim => ({
  id, orgId: 'o', type: 'condition', statement, subjectEntityIds: ['ent:trn042'], caseId: 'case:042', assertedBy: by, origin: c.origin,
  supporting: [], contradicting: [], validity: {}, status: 'provisional', extraction: { route: 'rules', version: 'rules-extractor@1' },
  revision: 1, createdAt: 'x', updatedAt: 'x', condition: c, accessScope: scope,
});

/** The TRN-042 shape from BUILD_BRIEF 3.2, as structured rows only (no chat text anywhere). */
function trn042() {
  const s = openStore(':memory:');
  const entity: Entity = { id: 'ent:trn042', orgId: 'o', type: 'asset', name: 'TRN-042', aliases: [], attributes: {}, evidence: [], accessScope: scope };
  s.put('entity', entity);
  const age = cond('unit.age', 'older', 'Older unit', 'inferred');
  const year = cond('unit.installed_year', 2019, 'Installed 2019');
  const claims = [
    claim('cl:1', age, 'It is an older unit, installed around 2019 I think', erkki),
    claim('cl:2', year, 'installed around 2019 I think', erkki),
    claim('cl:3', cond('component.replaced', 'sfp', 'SFP replaced'), 'Replaced the SFP'),
    claim('cl:4', cond('interface.status', 'up', 'Interface up'), 'Link is up'),
    claim('cl:5', cond('optical.level', 'normal', 'Optical level normal'), 'RX power normal'),
    claim('cl:6', cond('traffic.counters', 'zero', 'Traffic counters zero'), 'Counters zero'),
  ];
  for (const c of claims) s.put('claim', c);
  const c: Case = {
    id: 'case:042', orgId: 'o', title: 'TRN-042 · no traffic after SFP change', status: 'reported-recovered', entityIds: ['ent:trn042'],
    observationClaimIds: [], hypothesisClaimIds: [], attemptIds: ['att:1', 'att:2'], outcomeIds: ['out:1'], gaps: [], evidenceIds: [],
    startedAt: { known: false }, conditions: claims.map((x) => x.condition!), accessScope: scope, createdAt: 'x', updatedAt: 'x',
  };
  s.put('case', c);
  const attempts: Attempt[] = [
    { id: 'att:1', orgId: 'o', caseId: c.id, action: 'sfp.replace', performedBy: veikko, performed: 'reported', when: { known: false }, evidence: [] },
    { id: 'att:2', orgId: 'o', caseId: c.id, action: 'interface.reset', advisedBy: erkki, performedBy: veikko, performed: 'reported', when: { known: false }, evidence: [] },
  ];
  for (const a of attempts) s.put('attempt', a);
  const out: Outcome = { id: 'out:1', orgId: 'o', caseId: c.id, attemptId: 'att:2', reportedBy: veikko, result: 'recovered', reportedAt: { known: false }, lasting: 'unknown', evidence: [], basis: 'reported' };
  s.put('outcome', out);
  return s;
}

test('case card: the TRN-042 situation reconstructed from structured rows (asset, hedged class, symptoms, advised/performed, outcome, lasting)', () => {
  const s = trn042();
  const card = caseCard(s, 'case:042')!;
  assert.equal(
    card,
    'TRN-042, older unit (installed around 2019; per Erkki Expert, hedged). SFP replaced, interface up, optical level normal, traffic counters zero. '
      + 'Erkki Expert advised an interface reset; Veikko Vikkelä performed it; recovered; lasting unknown.',
  );
  assert.equal(caseCard(s, 'case:042'), card, 'deterministic');
  assert.equal(caseCard(s, 'case:missing'), undefined);
});

test('case card follows the rows: a recurred outcome, an advice not reported as done, a retracted claim drops out', () => {
  const s = trn042();
  s.put('outcome', { ...s.get('outcome', 'out:1')!, lasting: 'recurred' });
  s.put('attempt', { id: 'att:3', orgId: 'o', caseId: 'case:042', action: 'counters.check', advisedBy: erkki, performed: 'proposed-only', when: { known: false }, evidence: [] });
  s.put('claim', { ...s.get('claim', 'cl:5')!, status: 'retracted' });
  const card = caseCard(s, 'case:042')!;
  assert.match(card, /recovered; recurred later\./);
  assert.match(card, /Erkki Expert advised a counter check; not reported as done\./);
  assert.match(card, /optical level normal/, 'still a case condition row');
  s.put('case', { ...s.get('case', 'case:042')!, conditions: s.get('case', 'case:042')!.conditions.filter((x) => x.key !== 'optical.level') });
  assert.doesNotMatch(caseCard(s, 'case:042')!, /optical/);
});

test('case card on an imported synthetic family names its asset and attempt chain without any chat sentence', () => {
  const s = openStore(':memory:');
  importFromPath(s, { format: 'scenario-dir', path: join(ROOT, 'data/scenarios/optic-forwarding-a'), orgId: 'o', now: '2026-11-07T00:00:00Z' });
  const c = listCases(s).find((x) => x.title.startsWith('TRN-117'))!;
  const card = caseCard(s, c.id)!;
  assert.match(card, /^TRN-117\. /);
  assert.match(card, /advised an interface reset; .+ performed it; recovered; lasting unknown\./);
  for (const e of s.list('evidence')) assert.ok(!card.includes(e.text.slice(0, 40)), 'no chat text copied');
});
