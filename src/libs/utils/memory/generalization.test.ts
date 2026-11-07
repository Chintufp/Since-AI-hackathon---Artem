import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseTeamsJson } from '../connectors/index.ts';
import { assembleContexts } from '../context/index.ts';
import type { KnowledgeStore } from '../contracts/index.ts';
import { defaultExtractionConfig } from './extraction-config.ts';
import { extractFromContext, type RulesClaim } from './extractor-rules.ts';
import { classifyOutcomeState, readPerformed } from './language.ts';
import { importFromPath, listCases, openStore } from './index.ts';

const cfg = defaultExtractionConfig;
const chat = (msgs: Array<[string, string]>) =>
  assembleContexts(parseTeamsJson({ channel: 'c', messages: msgs.map(([author, text], i) => ({ seq: i + 1, time: `1${i}:00`, author, text })) }, { orgId: 'o' }))[0]!;
const slack = (s: KnowledgeStore, days: Array<{ date: string; messages: Array<{ ts: string; user: string; text: string; thread_ts?: string }> }>) =>
  importFromPath(s, {
    format: 'slack-export', orgId: 'o', now: '2026-11-07T00:00:00Z',
    payload: { users: [{ id: 'U1', real_name: 'Ann Aho' }, { id: 'U2', real_name: 'Bo Berg' }], channels: [{ id: 'C1', name: 'ops', is_private: false }], days: days.map((d) => ({ channel: 'ops', ...d })) },
  });

test('outcome state classifier: recovered, no change, worse, partial, recurrence from generic cue sets', () => {
  const r = (t: string) => classifyOutcomeState(t, cfg);
  assert.deepEqual(r('Both sessions are up with no flaps.'), { result: 'recovered', recurred: false });
  assert.equal(r('Still up after ten minutes.')?.result, 'recovered');
  assert.equal(r('The unit is steady now.')?.result, 'recovered');
  assert.equal(r('Errors are still climbing, same burst pattern.')?.result, 'no-change');
  assert.equal(r('No change after the swap.')?.result, 'no-change');
  assert.equal(r('Now the uplink ports are down too.')?.result, 'worse');
  assert.equal(r('Errors dropped a lot but not to zero.')?.result, 'partial');
  assert.deepEqual(r('The alarm came back this morning.'), { result: 'no-change', recurred: true });
  assert.equal(r('It is flapping again.')?.recurred, true);
  assert.equal(r('Phones are registering again.')?.result, 'recovered', 'a positive state with "again" is a recovery, not a recurrence');
  assert.equal(r('Please check the logs.'), undefined);
});

test('performed actions in any tense become one past-tense statement with the performer named', () => {
  const names = ['Toivo'];
  assert.match(readPerformed('Rolling back the hold timers on AGG-10 now.', cfg, names)!.past, /^rolled back the hold timers on AGG-10$/);
  assert.match(readPerformed('Swapped for a clean filter.', cfg, names)!.past, /^swapped for a clean filter/);
  assert.equal(readPerformed('Filter 4.2 installed on PE-05.', cfg, names)!.verb.base, 'install');
  assert.equal(readPerformed("I'll do it from the controller.", cfg, names), undefined, 'intent is not performed');
  assert.equal(readPerformed('I did not replace it.', cfg, names), undefined, 'negation is not performed');
  assert.equal(readPerformed('Alarm cleared.', cfg, names), undefined, 'a state change of a symptom is not an action');
  const p = extractFromContext(chat([['Hanna Kallio', 'AGG-10 has peers flapping since the upgrade.'], ['Toivo Aaltonen', 'Rolling back the hold timers on AGG-10 now.'], ['Hanna Kallio', 'Both sessions are up.']]));
  const act = p.claims.find((c) => c.type === 'action')!;
  assert.equal(act.statement, 'Toivo rolled back the hold timers on AGG-10');
  assert.equal(p.claims.find((c) => c.type === 'outcome')!.statement, 'Both sessions are up after the hold timer rollback');
});

test('a comparison to another asset ("same as X last week") is a reference: it neither splits the incident nor enters the statement', () => {
  const p = extractFromContext(chat([
    ['Ann', 'ACC-30 lost the voice VLAN after the template push, same as ACC-12 last week.'],
    ['Bo', 'Rolled it back like on ACC-12. Now the uplink ports are down.'],
  ]));
  assert.deepEqual(p.incidents.map((i) => i.key), ['asset:acc-30']);
  assert.ok(!p.claims.filter((c) => c.type === 'observation').some((c) => /ACC-12/.test(c.statement)));
});

test('hedges, closure remarks and asides do not become incident claims', () => {
  const p = extractFromContext(chat([
    ['Ann', 'PUMP-7 stopped delivering after the seal swap.'],
    ['Bo', 'That is probably it. I think we can close the ticket. By the way, has anyone seen my charger? I think I left it in room 3.'],
  ]));
  assert.ok(!p.claims.some((c) => c.type === 'hypothesis'), 'a pointing-back hedge and a closure remark carry no claim');
  assert.ok(p.claims.filter((c) => c.type === 'other').length >= 2);
});

test('episodes: a new problem on the same asset after a recovery is a new case and marks the earlier recovery as recurred', () => {
  const s = openStore(':memory:');
  slack(s, [
    { date: '2026-03-01', messages: [
      { ts: '1772355600.000100', user: 'U1', text: 'CAB-90 has a high temperature alarm.', thread_ts: '1772355600.000100' },
      { ts: '1772359200.000200', user: 'U2', text: 'Replaced the filter. Alarm cleared.', thread_ts: '1772355600.000100' },
    ] },
    { date: '2026-03-04', messages: [
      { ts: '1772614800.000100', user: 'U1', text: 'CAB-90 temperature alarm again, inlet 58.', thread_ts: '1772614800.000100' },
      { ts: '1772618400.000200', user: 'U2', text: 'Replaced fan tray 2. Inlet is down to 44.', thread_ts: '1772614800.000100' },
    ] },
  ]);
  const cases = listCases(s);
  assert.equal(cases.length, 2, 'two episodes on one asset');
  const byStatus = Object.fromEntries(cases.map((c) => [c.status, c]));
  assert.ok(byStatus['recurred'], 'the first recovery recurred');
  assert.ok(byStatus['reported-recovered'], 'the second episode is reported recovered');
  assert.equal(s.list('attempt', { where: { caseId: byStatus['recurred']!.id } })[0]?.action, 'filter.replace');
});

test('lasting: a recovery held for days (a later separate report) is confirmed; a same-session check is not', () => {
  const s = openStore(':memory:');
  slack(s, [{ date: '2026-03-01', messages: [
    { ts: '1772355600.000100', user: 'U1', text: 'RTR-50 sessions keep flapping after the update.', thread_ts: '1772355600.000100' },
    { ts: '1772359200.000200', user: 'U2', text: 'Rolling back the timers on RTR-50 now.', thread_ts: '1772355600.000100' },
    { ts: '1772359800.000300', user: 'U2', text: 'Done. Sessions are up.', thread_ts: '1772355600.000100' },
    { ts: '1772360400.000400', user: 'U1', text: 'Still up after ten minutes.', thread_ts: '1772355600.000100' },
  ] }]);
  const c1 = listCases(s)[0]!;
  assert.equal(c1.status, 'reported-recovered');
  assert.ok(s.list('outcome', { where: { caseId: c1.id } }).every((o) => o.lasting === 'unknown'));
  slack(s, [{ date: '2026-03-05', messages: [{ ts: '1772700000.000100', user: 'U1', text: 'No flaps for four days after the rollback on RTR-50, sessions are still stable.', thread_ts: '1772700000.000100' }] }]);
  const cases = listCases(s);
  const main = cases.find((c) => c.id === c1.id)!;
  assert.equal(cases.length, 1, 'the follow-up joins the episode');
  assert.equal(main.status, 'verified-resolved');
  assert.ok(s.list('outcome', { where: { caseId: c1.id } }).some((o) => o.lasting === 'confirmed'));
});

test('organizations extend the lexicon through configuration: their own verbs, states and aside markers', () => {
  const custom = {
    ...cfg,
    language: {
      ...cfg.language,
      verbs: [...cfg.language.verbs, 'descale'],
      states: { ...cfg.language.states, recovered: new RegExp(`${cfg.language.states.recovered.source}|\\bpressure (?:holds|is back)\\b`, 'i') },
    },
  };
  const ctx = chat([['Ann', 'BOIL-2 has no pressure and keeps failing.'], ['Bo', 'Descaled the heat exchanger on BOIL-2.'], ['Ann', 'Pressure holds.']]);
  const withDefault = extractFromContext(ctx);
  const withCustom = extractFromContext(ctx, custom);
  assert.ok(!withDefault.claims.some((c) => c.type === 'action'), 'unknown verb: no action');
  assert.equal(withCustom.claims.find((c) => c.type === 'action')?.statement, 'Bo descaled the heat exchanger on BOIL-2');
  assert.ok(withCustom.claims.some((c) => c.type === 'outcome' && /Pressure holds after the heat exchanger descaling/.test(c.statement)));
});

test('a verbatim copy of a message adds dependent support to the original claims and never a new performer or claim', () => {
  const s = openStore(':memory:');
  slack(s, [{ date: '2026-03-01', messages: [
    { ts: '1772355600.000100', user: 'U1', text: 'CAB-90 has a high temperature alarm.', thread_ts: '1772355600.000100' },
    { ts: '1772359200.000200', user: 'U2', text: 'Replaced the filter on CAB-90. Alarm cleared.', thread_ts: '1772355600.000100' },
    { ts: '1772362800.000300', user: 'U1', text: 'Replaced the filter on CAB-90. Alarm cleared.' },
  ] }]);
  const claims = s.list('claim');
  assert.ok(!claims.some((c) => c.type === 'action' && /^Ann\b/.test(c.statement)), 'the copier is not made a performer');
  assert.equal(claims.filter((c) => c.type === 'action').length, 1);
  const action = claims.find((c) => c.type === 'action')!;
  assert.equal(action.assertedBy?.displayName, 'Bo Berg');
  assert.equal(action.supporting.length, 2, 'the copy is recorded as extra support');
  assert.equal(action.status, 'provisional', 'a copy is not an independent confirmation');
});

test('episodes: a different fault on the same asset after an outcome is a new case even inside the same thread or chat', () => {
  const s = openStore(':memory:');
  slack(s, [
    { date: '2026-03-01', messages: [
      { ts: '1772355600.000100', user: 'U1', text: 'CAB-90 has a high temperature alarm.', thread_ts: '1772355600.000100' },
      { ts: '1772359200.000200', user: 'U2', text: 'Replaced the filter. Alarm cleared.', thread_ts: '1772355600.000100' },
    ] },
    { date: '2026-03-06', messages: [
      { ts: '1772787600.000300', user: 'U1', text: 'CAB-90 door sensor is failing, door open alarm raised.', thread_ts: '1772355600.000100' },
    ] },
  ]);
  assert.equal(listCases(s).length, 2, 'a new fault in the old thread is its own case');
  const s2 = openStore(':memory:');
  const p = extractFromContext(chat([
    ['Ann', 'RTR-50 sessions keep flapping after the update.'],
    ['Bo', 'Rolled back the timers on RTR-50.'],
    ['Bo', 'Sessions are up.'],
    ['Ann', 'RTR-50 fan tray alarm raised, fan 2 failing.'],
  ]));
  assert.equal(p.incidents.length, 2, 'undated chat: the unrelated fault starts a second incident');
  assert.ok(s2);
});

test('lasting: one self-report in the same message as the action is not a separate confirmation', () => {
  const s = openStore(':memory:');
  slack(s, [{ date: '2026-03-01', messages: [
    { ts: '1772355600.000100', user: 'U1', text: 'RTR-50 sessions keep flapping after the update.', thread_ts: '1772355600.000100' },
    { ts: '1772359200.000200', user: 'U2', text: 'Rolled back the timers on RTR-50. Sessions are up and have been stable for two days.', thread_ts: '1772355600.000100' },
  ] }]);
  const c = listCases(s)[0]!;
  assert.equal(c.status, 'reported-recovered');
  assert.ok(s.list('outcome', { where: { caseId: c.id } }).every((o) => o.lasting !== 'confirmed'));
});

test('"<Verb> done on both ends" reports finished work by the speaker and resolves the object from the advice before it', () => {
  const p = extractFromContext(chat([
    ['Ann', 'LNK-12 shows no traffic after the module swap.'],
    ['Bo', 'Reset the interface on both ends, shut and no shut.'],
    ['Ann', 'Ok, doing the reset now, far end first.'],
    ['Ann', 'Reset done on both ends. Traffic is passing again.'],
  ]));
  const act = p.claims.find((c) => c.type === 'action' && (c as RulesClaim).action?.[0]?.name === 'interface.reset');
  assert.ok(act, 'a performed action');
  const speaker = p.claims.find((c) => c.type === 'action')!.assertedByActorId;
  assert.equal(act!.assertedByActorId, speaker);
  assert.notEqual(act!.assertedByActorId, p.claims.find((c) => c.type === 'advice')!.assertedByActorId, 'performed by the speaker, not the adviser');
  assert.ok(!p.claims.some((c) => c.type === 'advice' && /^Reset done/.test(c.statement)));
});
