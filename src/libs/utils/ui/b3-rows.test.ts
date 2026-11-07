import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ExpertCostView } from '../contracts/service.ts';
import type { ProvenanceView } from '../contracts/views.ts';
import { costRow, setProvenance } from './b3-rows.ts';

const strip: ProvenanceView = {
  claimId: 'c1', person: 'Erkki Expert', providerLabel: 'Teams', when: '09:22 (date unknown)', sources: 1, reportedOnce: true,
  stillBelievedTrue: true, route: 'rules', text: 'Erkki Expert · Teams 09:22 (date unknown) · reported once · still believed true',
};

test('provenance strip: the service text as textContent and tooltip; hidden and empty when none was sent', () => {
  const p = { textContent: 'old' as string | null, title: 'old', hidden: true };
  setProvenance(p, strip);
  assert.deepEqual(p, { textContent: strip.text, title: strip.text, hidden: false });
  setProvenance(p, undefined);
  assert.deepEqual(p, { textContent: '', title: '', hidden: true });
  // Markup in the text stays text (the panel never sets innerHTML from it).
  setProvenance(p, { ...strip, text: '<b>x</b>' });
  assert.equal(p.textContent, '<b>x</b>');
});

test('Settings cost row: first name, the counts, simulated seconds labelled, the store line and the tooltip', () => {
  const c: ExpertCostView = {
    personEntityId: 'p', name: 'Erkki Expert', asked: 3, answered: 2, deferred: 0, dismissed: 0, open: 1, cancelled: 0,
    seconds: { total: 37.6, median: 18, answers: 2, clock: 'simulated' }, reuse: { people: 3, agents: 2, total: 5 },
    line: 'Erkki Expert: asked 3 · answered 2 · 38 s (simulated) · reused 5 (3 by people, 2 by agents)',
  };
  const r = costRow(c);
  assert.equal(r.label, "Erkki's cost");
  assert.equal(r.line, 'asked 3 · answered 2 · 38 s simulated · reused 5 (3 people, 2 agents)');
  assert.equal(r.store, '');
  assert.equal(r.title, c.line);
  const withStore = costRow({ ...c, seconds: { ...c.seconds, clock: 'real' }, storeHealth: { cases: 5, completeness: 0.5, correctness: null, singletons: 1, denominators: { cases: 5, retrievals: 1, caseClaims: 1, supportedClaims: 1 }, line: 'Store: 5 cases · completeness 0.50 · correctness unknown · 1 singleton left' } });
  assert.match(withStore.line, / 38 s · /);
  assert.equal(withStore.store, 'Store: 5 cases · completeness 0.50 · correctness unknown · 1 singleton left');
  assert.equal(withStore.title, `${c.line}\nStore: 5 cases · completeness 0.50 · correctness unknown · 1 singleton left`);
});
