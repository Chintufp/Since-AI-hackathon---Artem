import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { KnowledgeStore, Principal } from '../contracts/index.ts';
import { buildCaseView, importFromPath, listCases, openStore } from './index.ts';
import { defaultViewConfig, humanAction, pastAction } from './view-config.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const FIX = join(ROOT, 'data/fixtures/dev-family-01');
const SCEN = join(ROOT, 'data/scenarios');
const ELISA = join(ROOT, 'private/Elisa_SinceAI2026/ELISA_HIDDEN_KNOWLEDGE_EXAMPLE_2026');
const hasElisa = existsSync(join(ELISA, 'teams_chat.json')) && existsSync(join(ELISA, 'email.txt'));
const NOW = '2026-11-07T00:00:00Z';
const ORG = 'org1';
const anyone: Principal = { id: 'p-any', displayName: 'Any', groups: [], type: 'human' };

const imp = (s: KnowledgeStore, format: 'teams-json' | 'email-text' | 'slack-export' | 'scenario-dir', path: string) =>
  importFromPath(s, { format, path, orgId: ORG, now: NOW });

const slack = (s: KnowledgeStore, texts: string[]) =>
  importFromPath(s, {
    format: 'slack-export', orgId: ORG, now: NOW,
    payload: {
      users: [{ id: 'U1', real_name: 'Jussi Rantanen' }, { id: 'U2', real_name: 'Pia Aho' }],
      channels: [{ id: 'C1', name: 'depot', is_private: false }],
      days: [{ channel: 'depot', date: '2026-03-12', messages: texts.map((text, i) => ({ ts: `${1773300000 + i * 60}.000100`, user: i % 2 ? 'U2' : 'U1', text })) }],
    },
  });

function compactShape(s: KnowledgeStore, caseId: string) {
  const v = buildCaseView(s, caseId, anyone)!;
  const labels = v.timeline.map((n) => n.label);
  assert.ok(v.timeline.length >= 4 && v.timeline.length <= 9, `compact timeline, got ${v.timeline.length}: ${labels.join(' | ')}`);
  assert.equal(v.timeline[0]!.kind, 'problem');
  assert.equal(labels.filter((l) => l === 'Possible cause').length <= 1, true, 'one merged cause node');
  assert.equal(labels.filter((l) => l === 'Suggested checks').length <= 1, true, 'one merged checks node');
  assert.ok(!JSON.stringify(v).includes('hedged in source'));
  assert.ok(v.timeline.every((n) => !/\b[a-z]+\.[a-z]+\b/.test(n.label)), 'no dotted action names in labels');
  assert.equal(v.caveat.split(/[.!?](?:\s|$)/).filter(Boolean).length, 1, 'caveat is one sentence');
  return v;
}

test('an aside without a symptom or asset creates no case; its claims stay case-less', () => {
  const s = openStore(':memory:');
  slack(s, ['Check the van stock list first, I think there are two in the grey box.', 'Thanks, will do.']);
  assert.equal(listCases(s).length, 0);
  assert.ok(s.count('evidence') >= 2, 'evidence is still stored');
  assert.ok(s.list('claim').every((c) => !c.caseId), 'claims are case-less');
});

test('a thread with a reported symptom but no asset still gets a case; an asset alone also does', () => {
  const s = openStore(':memory:');
  slack(s, ['The depot door keeps failing to open and the alarm is not responding.']);
  assert.equal(listCases(s).length, 1);
  const t = openStore(':memory:');
  slack(t, ['Check the spares for ABC-123 in the grey box.']);
  assert.equal(listCases(t).length, 1);
});

test('dev-family-01 slack aside no longer adds a junk case (no generic Incident-in case)', () => {
  const s = openStore(':memory:');
  imp(s, 'teams-json', join(FIX, 'teams.json'));
  imp(s, 'email-text', join(FIX, 'email.txt'));
  imp(s, 'slack-export', join(FIX, 'slack-export'));
  const cases = listCases(s);
  assert.ok(cases.length >= 1 && cases.every((c) => !/^Incident in /.test(c.title)));
});

test('dev-family-01: compact timeline, short title, plain condition labels, retelling adds no repeats', () => {
  const s = openStore(':memory:');
  imp(s, 'teams-json', join(FIX, 'teams.json'));
  imp(s, 'email-text', join(FIX, 'email.txt'));
  const c = listCases(s).find((x) => x.title.includes('RTR-117'))!;
  const v = compactShape(s, c.id);
  assert.match(v.title, /^RTR-117 · /);
  assert.ok(v.title.length <= 60);
  const cause = v.timeline.find((n) => n.label === 'Possible cause')!;
  const bullets = cause.detail.split('\n').slice(1);
  assert.equal(new Set(bullets).size, bullets.length, 'no repeated cause bullets');
  assert.ok(c.conditions.every((x) => !/hedged|UP$|DOWN$/.test(x.label ?? '')));
  const conds = v.timeline.find((n) => n.label === 'Reported conditions')!;
  assert.ok(!/\(hedged/.test(conds.detail));
  assert.ok(v.timeline.some((n) => n.stage === 'attempt'));
});

test('Elisa email: still a retelling, no duplicate causes; compact timeline with plain conditions', { skip: !hasElisa && 'private Elisa files absent' }, () => {
  const s = openStore(':memory:');
  imp(s, 'teams-json', join(ELISA, 'teams_chat.json'));
  imp(s, 'email-text', join(ELISA, 'email.txt'));
  const mail = s.list('evidence').find((e) => e.provider === 'email' && e.metadata?.segment !== 'quoted')!;
  assert.ok(mail.lineage.copiedFrom?.length || mail.metadata?.retellingOf, 'email is a retelling');
  const cases = listCases(s);
  assert.equal(cases.length, 1);
  const v = compactShape(s, cases[0]!.id);
  assert.equal(v.title, 'TRN-042 · no traffic after SFP change');
  assert.ok(v.timeline.length >= 5 && v.timeline.length <= 8);
  const byLabel = (l: string) => v.timeline.find((n) => n.label === l)!;
  assert.equal(byLabel('Reported problem').kind, 'problem');
  assert.match(byLabel('Reported problem').detail, /traffic is still not coming back/);
  const conds = byLabel('Reported conditions');
  assert.equal(conds.kind, 'step');
  for (const l of ['Interface up', 'Optical level normal', 'Traffic counters zero', 'Older unit (installed around 2019)', 'SFP replaced before the problem']) assert.ok(conds.detail.includes(l), l);
  assert.match(conds.detail, /likely/);
  const cause = byLabel('Possible cause');
  assert.equal(cause.detail.split('\n').length - 1, 4, 'four distinct hypotheses, email adds none');
  assert.equal((cause.detail.match(/older|old units/gi) ?? []).length, 1, 'the retold "older units" hypothesis is not repeated');
  assert.ok(byLabel('Suggested checks').detail.includes("Don't reboot"));
  const attempts = v.timeline.filter((n) => n.stage === 'attempt').map((n) => n.label);
  assert.deepEqual(attempts, ['Attempted counter check', 'Attempted interface reset'], 'the SFP change is a condition, not an attempt');
  const resetNode = v.timeline.find((n) => n.label === 'Attempted interface reset')!;
  assert.match(resetNode.detail, /Advised by Erkki/);
  assert.match(resetNode.detail, /Performed by Veikko/);
  const out = v.timeline.at(-1)!;
  assert.equal(out.kind, 'reported');
  assert.equal(out.label, 'Reported outcome');
  assert.match(out.detail, /after the interface reset/);
  assert.match(out.detail, /Timing, cause and whether it lasted are unconfirmed/);
  assert.ok(v.caveat.length < 140);
});

test('outcome unknown is grey and no green node exists without an outcome', () => {
  const s = openStore(':memory:');
  slack(s, ['RTR-77 BGP sessions keep flapping after the firmware update.', 'Check the logs first before rolling back.']);
  const v = buildCaseView(s, listCases(s)[0]!.id, anyone)!;
  assert.equal(v.timeline.at(-1)!.kind, 'unknown');
  assert.equal(v.timeline.at(-1)!.label, 'Outcome unknown');
  assert.ok(!v.timeline.some((n) => n.kind === 'reported'));
  assert.equal(v.title, 'RTR-77 · BGP flapping after firmware update');
});

test('action labels: configured map with a humanizing fallback; overridable per organization', () => {
  assert.equal(humanAction('interface.reset'), 'interface reset');
  assert.equal(humanAction('counters.check'), 'counter check');
  assert.equal(humanAction('sfp.replace'), 'SFP replacement');
  assert.equal(humanAction('device.reboot'), 'reboot');
  assert.equal(humanAction('fan.tray_swap'), 'fan tray swap');
  assert.equal(pastAction('sfp.replace'), 'SFP replaced');
  assert.equal(pastAction('fan.swap'), 'Fan swap performed');
  const s = openStore(':memory:');
  slack(s, ['RTR-5 keeps flapping.', 'Please reboot the router.', 'I rebooted the router.']);
  const cfg = { ...defaultViewConfig, actionLabels: { ...defaultViewConfig.actionLabels, 'device.reboot': 'restart' } };
  const v = buildCaseView(s, listCases(s)[0]!.id, anyone, cfg)!;
  assert.ok(v.timeline.some((n) => n.label === 'Attempted restart'));
});

test('every demo family: case views are compact, titled with the asset id, and never show hedging in labels', () => {
  const dirs = readdirSync(SCEN, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(SCEN, d.name, 'sources')));
  assert.ok(dirs.length >= 5);
  let checked = 0;
  for (const d of dirs) {
    const s = openStore(':memory:');
    imp(s, 'scenario-dir', join(SCEN, d.name, 'sources'));
    for (const c of listCases(s)) {
      const v = buildCaseView(s, c.id, anyone);
      if (!v) continue; // private-channel case: hidden from this principal
      checked++;
      assert.ok(v.timeline.length <= 10, `${d.name}: ${v.timeline.length} nodes`);
      assert.ok(!/^Incident in /.test(v.title), `${d.name}: ${v.title}`);
      assert.ok(!JSON.stringify(v.timeline).includes('hedged in source'));
      assert.ok(v.timeline.filter((n) => n.label === 'Possible cause').length <= 1);
      assert.ok(c.conditions.every((x) => !/hedged/.test(x.label ?? '')));
    }
  }
  assert.ok(checked >= 5, `only ${checked} visible cases checked`);
});
