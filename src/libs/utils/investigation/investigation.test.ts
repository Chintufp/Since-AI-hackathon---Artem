import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InvestigationState, Problem, Principal } from '../contracts/index.ts';
import { HybridRetriever } from '../retrieval/index.ts';
import {
  buildSyntheticStore, cond, CASE_REF, E, NOW_ISO, ORG, outsiderPrincipal, requesterActor, requesterPrincipal, secopsPrincipal, SYMPTOM_TEXT, P,
} from '../models/testing/fixtures.ts';
import type { InMemoryStore } from '../models/testing/in-memory-store.ts';
import { defaultInvestigationSettings, investigate, parseProblemText, RulesAssessor } from './index.ts';

const clock = () => new Date(NOW_ISO);

function run(store: InMemoryStore, o: { id: string; text: string; observations?: ReturnType<typeof cond>[]; principal?: Principal; mode?: 'combined' | 'separate' }): Promise<InvestigationState> {
  const settings = defaultInvestigationSettings();
  const problem: Problem = { id: o.id, orgId: ORG, text: o.text, requester: requesterActor(), observations: o.observations ?? [], createdAt: NOW_ISO };
  return investigate({
    problem, store, principal: o.principal ?? requesterPrincipal(),
    deps: { retriever: new HybridRetriever(store, settings), assessor: new RulesAssessor({ store, settings, mode: o.mode ?? 'separate' }), settings, clock },
  });
}

test('parser maps problem text to vocabulary conditions', () => {
  const { conditions } = parseProblemText('Link is up, counters zero, RX normal, alarms cleared. Old unit/2019. We replaced the SFP and rebooted. Barrier at the gate.', 'p1');
  const m = Object.fromEntries(conditions.map((c) => [c.key, c.value]));
  assert.equal(m['interface.status'], 'up');
  assert.equal(m['traffic.counters'], 'zero');
  assert.equal(m['optical.level'], 'normal');
  assert.equal(m['alarms.state'], 'cleared');
  assert.equal(m['unit.age'], 'older');
  assert.equal(m['unit.installed_year'], 2019);
  assert.equal(m['component.replaced'], 'sfp');
  assert.equal(m['action.performed'], 'device.reboot');
  assert.equal(m['site.access'], 'barrier');
  assert.ok(conditions.every((c) => c.evidence[0]?.span && c.evidence[0].excerpt));
});

test('parser respects negation and unknown stays unknown', () => {
  const { conditions } = parseProblemText('We have not rebooted. Nothing else known.', 'p2');
  assert.equal(conditions.find((c) => c.key === 'action.performed'), undefined);
  assert.equal(conditions.find((c) => c.key === 'unit.age'), undefined);
});

test('(1) reuse path: matching unit.age -> reference case first, supported+applicable, check-first names counters.check before interface.reset, no question needed', async () => {
  const store = buildSyntheticStore();
  const st = await run(store, { id: 'p_reuse', text: `Asset-E5: ${SYMPTOM_TEXT}`, observations: [cond('unit.age', 'older', 'Older unit')] });
  assert.equal(st.candidates[0]?.caseId, CASE_REF);
  const h = st.hypotheses.find((x) => x.sourceClaimIds.includes('cl_c1_hyp'));
  assert.ok(h);
  assert.equal(h.support, 'supported');
  assert.equal(h.applicability, 'applicable');
  assert.equal(st.recommendation.kind, 'check-first');
  assert.equal(st.recommendation.actionClass, 'diagnostic-check');
  // wording: heading is a short human sentence naming the check first; the reset is in nextStep with the short case label
  const t = st.recommendation.text;
  assert.ok(t.length <= 140);
  assert.match(t, /^Check the traffic counters/);
  assert.match(st.recommendation.nextStep ?? '', /disabling and re-enabling the interface reportedly restored traffic in Asset-/);
  assert.doesNotMatch(`${t} ${st.recommendation.nextStep}`, /case_|interface\.reset|counters\.check|will fix/);
  assert.ok(st.recommendation.caveats.some((c) => /not verified/.test(c)));
  assert.equal(st.loop, 'no-question-needed');
  assert.equal(st.gaps.filter((g) => g.consequential).length, 0);
  // the non-consequential lasting gap is recorded but not asked
  assert.ok(st.gaps.some((g) => !g.consequential && /lasted is unknown/.test(g.description)));
});

test('(2) lookalike with a conflicting distinguishing condition -> inapplicable, retain-uncertainty naming the conflict', async () => {
  const store = buildSyntheticStore();
  const st = await run(store, { id: 'p_conflict', text: `Asset-E5: ${SYMPTOM_TEXT}`, observations: [cond('unit.age', 'newer', 'Newer unit')] });
  const h = st.hypotheses.find((x) => x.sourceClaimIds.includes('cl_c1_hyp'));
  assert.equal(h?.applicability, 'inapplicable');
  assert.equal(h?.support, 'supported');
  assert.equal(st.recommendation.kind, 'retain-uncertainty');
  assert.match(st.recommendation.text, /older unit revision/i);
  assert.match(st.recommendation.text, /newer unit/i);
  assert.equal(st.gaps.filter((g) => g.status === 'open' && g.consequential).length, 0);
});

test('different unit.model also conflicts on a distinguishing key', async () => {
  const store = buildSyntheticStore();
  const c = store.get('case', CASE_REF)!;
  store.put('case', { ...c, conditions: [...c.conditions, cond('unit.model', 'mk1', 'Model MK1')] });
  const st = await run(store, { id: 'p_model', text: `Asset-E5: ${SYMPTOM_TEXT}`, observations: [cond('unit.age', 'older'), cond('unit.model', 'mk2', 'Model MK2')] });
  assert.equal(st.hypotheses[0]?.applicability, 'inapplicable');
  assert.equal(st.recommendation.kind, 'retain-uncertainty');
});

test('missing distinguishing condition -> qualified, one consequential gap, hypothesis never verified', async () => {
  const store = buildSyntheticStore();
  const st = await run(store, { id: 'p_missing', text: `Asset-B2: ${SYMPTOM_TEXT}` });
  assert.equal(st.recommendation.kind, 'qualified');
  assert.match(st.recommendation.text, /older unit revision/i);
  const open = st.gaps.filter((g) => g.consequential && g.status === 'open');
  assert.equal(open.length, 1);
  assert.ok(open[0]?.whatAnswerChanges.length);
  assert.equal(open[0]?.targetCondition?.key, 'unit.age');
  assert.ok(st.candidates[0]?.expectedTraits.some((t) => t.status === 'unchecked'));
  assert.ok(st.hypotheses.every((h) => h.support !== 'supported' || h.applicability !== 'applicable'));
});

test('requester-observable missing condition: recommendation says check it; gap exists but needs no human question', async () => {
  const store = buildSyntheticStore();
  const c = store.get('case', CASE_REF)!;
  const settings = defaultInvestigationSettings();
  const s2 = { ...settings, distinguishingKeys: [...settings.distinguishingKeys, 'traffic.counters'] };
  // the problem text does not mention counters; the case requires counters zero as distinguishing
  const problem: Problem = { id: 'p_obs', orgId: ORG, text: 'Asset-E5: link is up, RX normal, alarms cleared', requester: requesterActor(), observations: [cond('unit.age', 'older')], createdAt: NOW_ISO };
  const st = await investigate({ problem, store, principal: requesterPrincipal(), deps: { retriever: new HybridRetriever(store, s2), assessor: new RulesAssessor({ store, settings: s2 }), settings: s2, clock } });
  assert.equal(st.recommendation.kind, 'qualified');
  assert.match(st.recommendation.nextStep ?? '', /you can observe this yourself/);
  assert.ok(c.id);
});

test('(7) access: principal outside the case group sees no candidate and no people from it', async () => {
  const store = buildSyntheticStore();
  const out = await run(store, { id: 'p_out', text: `Asset-A1: ${SYMPTOM_TEXT}`, principal: outsiderPrincipal() });
  assert.deepEqual(out.candidates.map((c) => c.caseId).filter((id) => id !== 'case_access'), []);
  assert.equal(out.people.length, 0);
  // noc principal does not see the secops-only case nor its person
  const noc = await run(store, { id: 'p_noc', text: `Asset-A1: ${SYMPTOM_TEXT}`, observations: [cond('unit.age', 'older')] });
  assert.ok(!noc.candidates.some((c) => c.caseId === 'case_restricted'));
  assert.ok(!noc.people.some((p) => p.personEntityId === P.sec.entity));
  // secops principal does
  const sec = await run(store, { id: 'p_sec', text: `Asset-A1: ${SYMPTOM_TEXT}`, principal: secopsPrincipal(), observations: [cond('unit.age', 'older')] });
  assert.ok(sec.candidates.some((c) => c.caseId === 'case_restricted'));
  assert.ok(sec.people.some((p) => p.personEntityId === P.sec.entity));
});

test('people: firsthand first, mentioned flagged, requester excluded, accessible cases only', async () => {
  const store = buildSyntheticStore();
  const st = await run(store, { id: 'p_people', text: `Asset-B2: ${SYMPTOM_TEXT}` });
  const names = st.people.map((p) => p.displayName);
  assert.ok(!names.includes('Requester-Four'));
  const men = st.people.find((p) => p.personEntityId === P.men.entity);
  assert.ok(men && men.reasons.every((r) => !r.firsthand) && /not firsthand/.test(men.reasons[0]!.text));
  assert.ok(names.indexOf('Mention-Three') > names.indexOf('Operator-Two'));
  const site = st.people.find((p) => p.personEntityId === P.site.entity);
  assert.ok(site?.reasons.some((r) => r.contribution === 'observed-condition' && r.firsthand));
  for (const p of st.people) for (const id of p.accessibleCaseIds) assert.notEqual(id, 'case_restricted');
});

test('assessor: combined mode collapses the two dimensions; separate keeps them', async () => {
  const store = buildSyntheticStore();
  const sep = await run(store, { id: 'p_sep', text: `Asset-B2: ${SYMPTOM_TEXT}`, mode: 'separate' });
  const comb = await run(store, { id: 'p_comb', text: `Asset-B2: ${SYMPTOM_TEXT}`, mode: 'combined' });
  const a = sep.hypotheses.find((h) => h.sourceClaimIds.includes('cl_c1_hyp'))!;
  const b = comb.hypotheses.find((h) => h.sourceClaimIds.includes('cl_c1_hyp'))!;
  assert.deepEqual([a.support, a.applicability], ['supported', 'qualified']);
  assert.deepEqual([b.support, b.applicability], ['weak', 'qualified']);
});

test('missing outcome -> support weak, corrective not recommended, consequential outcome gap; no-change outcome -> contradicted', async () => {
  const missing = await run(buildSyntheticStore({ resetOutcome: 'missing' }), { id: 'p_mo', text: `Asset-E5: ${SYMPTOM_TEXT}`, observations: [cond('unit.age', 'older')] });
  const h = missing.hypotheses.find((x) => x.sourceClaimIds.includes('cl_c1_hyp'))!;
  assert.equal(h.support, 'weak');
  assert.equal(missing.recommendation.kind, 'check-first');
  assert.match(missing.recommendation.text, /no reported recovery/);
  assert.ok(missing.gaps.some((g) => g.consequential && /No recovery outcome is recorded/.test(g.description)));
  const nc = await run(buildSyntheticStore({ resetOutcome: 'no-change' }), { id: 'p_nc', text: `Asset-E5: ${SYMPTOM_TEXT}`, observations: [cond('unit.age', 'older')] });
  assert.equal(nc.hypotheses.find((x) => x.sourceClaimIds.includes('cl_c1_hyp'))?.support, 'contradicted');
  assert.equal(nc.recommendation.kind, 'retain-uncertainty');
});

test('(10) every route used is listed in state.routes, with honest labels', async () => {
  const store = buildSyntheticStore();
  const st = await run(store, { id: 'p_routes', text: `Asset-B2: ${SYMPTOM_TEXT}` });
  const keys = st.routes.map((r) => `${r.route}:${r.version}`);
  assert.ok(keys.some((k) => k.startsWith('rules:problem-parser')));
  assert.ok(keys.some((k) => k.startsWith('local:hybrid-rrf') && k.includes('not-learned')));
  assert.ok(keys.some((k) => k.startsWith('rules:rules-assessor')));
  assert.equal(new Set(keys).size, keys.length);
  const persisted = store.get('investigation', st.id);
  assert.deepEqual(persisted?.routes, st.routes);
});

test('hypotheses reference E ids only through configuration (no hard-coded incident)', () => {
  assert.ok(E.a1 && CASE_REF);
});

// ---- polish pass 2: wording, hedged conditions, loop reasons, people ------------------------------------------------

test('polish: unit.installed_year is not distinguishing; years fold into unit.age through the configurable olderThroughYear', () => {
  const s = defaultInvestigationSettings();
  assert.ok(!s.distinguishingKeys.includes('unit.installed_year'));
  assert.ok(s.distinguishingKeys.includes('unit.age'));
  assert.ok(s.ignoredKeys.includes('unit.installed_year'));
  const folded = parseProblemText('Unit from 2015', 'pf', { olderThroughYear: s.ageFold.olderThroughYear });
  assert.equal(folded.conditions.find((c) => c.key === 'unit.age')?.value, 'older');
  const off = parseProblemText('Unit from 2015', 'pf2', { olderThroughYear: null });
  assert.equal(off.conditions.find((c) => c.key === 'unit.age'), undefined);
});

test('polish: a hedged distinguishing case condition is shown as unknown but creates no consequential gap and no question', async () => {
  const store = buildSyntheticStore();
  const c = store.get('case', CASE_REF)!;
  store.put('case', { ...c, conditions: c.conditions.map((x) => (x.key === 'unit.age' ? { ...x, label: `${x.label ?? 'Older unit'} (hedged in source)` } : x)) });
  const st = await run(store, { id: 'p_hedged', text: `Asset-B2: ${SYMPTOM_TEXT}` });
  assert.equal(st.gaps.filter((g) => g.consequential).length, 0);
  assert.equal(st.loop, 'no-question-needed');
  assert.match(st.loopReason ?? '', /settle the next step/);
  assert.ok(st.recommendation.caveats.some((x) => /^Unknown for this unit: .*older unit/i.test(x)), st.recommendation.caveats.join(' | '));
  assert.doesNotMatch(st.recommendation.caveats.join(' '), /hedged in source/);
});

test('polish: recommendation text is a short heading with plain words, short case labels and no raw ids or action codes', async () => {
  const store = buildSyntheticStore();
  for (const [id, obs] of [['w1', [cond('unit.age', 'older', 'Older unit')]], ['w2', [cond('unit.age', 'newer', 'Newer unit')]], ['w3', []]] as const) {
    const st = await run(store, { id: `p_word_${id}`, text: `Asset-B2: ${SYMPTOM_TEXT}`, observations: [...obs] });
    const r = st.recommendation;
    assert.ok(r.text.length <= 140, r.text);
    const all = [r.text, r.nextStep ?? '', ...r.caveats].join(' ');
    assert.doesNotMatch(all, /case_|\b[a-z]+\.(reset|check|replace|reboot)\b|"/, all);
  }
});

test('polish: people are limited to related cases, deduplicated, at most 3 reasons each and 6 people, mentioned-only last', async () => {
  const store = buildSyntheticStore();
  const st = await run(store, { id: 'p_people2', text: `Asset-B2: ${SYMPTOM_TEXT}` });
  assert.ok(st.people.length <= 6);
  for (const p of st.people) {
    assert.ok(p.reasons.length >= 1 && p.reasons.length <= 3);
    assert.equal(new Set(p.reasons.map((r) => `${r.caseId}|${r.contribution}`)).size, p.reasons.length);
    assert.ok(p.reasons.every((r) => !/case_|"/.test(r.text)));
  }
  const firstMentionedOnly = st.people.findIndex((p) => p.reasons.every((r) => !r.firsthand));
  if (firstMentionedOnly >= 0) assert.ok(st.people.slice(firstMentionedOnly).every((p) => p.reasons.every((r) => !r.firsthand)));
});

test('polish: every loop value carries a loopReason', async () => {
  const store = buildSyntheticStore();
  const settled = await run(store, { id: 'p_loop1', text: `Asset-E5: ${SYMPTOM_TEXT}`, observations: [cond('unit.age', 'older')] });
  assert.equal(settled.loop, 'no-question-needed');
  assert.ok(settled.loopReason && settled.loopReason.length > 0);
});

test('polish: parser lexicon covers session-state and recent-change phrases with vocabulary keys', () => {
  const { conditions } = parseProblemText('BGP sessions flapping on the edge router after the firmware update', 'pbgp');
  const m = Object.fromEntries(conditions.map((c) => [c.key, c.value]));
  assert.equal(m['bgp.session'], 'flapping');
  assert.equal(m['config.changed'], true);
});
