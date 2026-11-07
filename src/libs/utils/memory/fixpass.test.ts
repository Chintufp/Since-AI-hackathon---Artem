import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Correction, KnowledgeStore } from '../contracts/index.ts';
import { parseTimeRef } from '../connectors/time.ts';
import { applyCorrection, buildCaseView, importFromPath, listCases, openStore } from './index.ts';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../../../data/fixtures/dev-family-01');
const ORG = 'org1';
const NOW = '2026-11-07T00:00:00Z';
const anyone = { id: 'p', groups: [] as string[] };
const by = { id: 'u:rev', displayName: 'Reviewer', kind: 'human' } as unknown as Correction['by'];
const corr = (target: Correction['target'], change: Correction['change']): Correction => ({ id: `c-${target.id}-${change}`, orgId: ORG, target, change, reason: 'test', by, at: NOW });

function teams(messages: Array<[string, string]>, channel = 'ops') {
  return {
    channel,
    participants: [{ name: 'Ann Lee', role: 'engineer' }, { name: 'Bob Kay', role: 'engineer' }],
    messages: messages.map(([author, text], i) => ({ seq: i + 1, time: `09:${String(10 + i).padStart(2, '0')}`, author, role: 'engineer', text })),
  };
}
const run = (s: KnowledgeStore, payload: unknown, format: 'teams-json' | 'slack-export' = 'teams-json') =>
  importFromPath(s, { format, payload, orgId: ORG, now: NOW });
const fx = (s: KnowledgeStore, format: 'teams-json' | 'email-text', file: string) => importFromPath(s, { format, path: join(FIX, file), orgId: ORG, now: NOW });

test('human link rejection survives rebuild', () => {
  const s = openStore(':memory:');
  fx(s, 'teams-json', 'teams.json');
  const link = s.list('personLink').find((l) => l.claimId && l.caseId)!;
  applyCorrection(s, corr({ type: 'link', id: link.id }, 'retract'));
  assert.equal(s.get('personLink', link.id)!.status, 'rejected');
  fx(s, 'teams-json', 'teams.json');
  assert.equal(s.get('personLink', link.id)!.status, 'rejected');
});

test('human claim confirm survives reimport', () => {
  const s = openStore(':memory:');
  fx(s, 'teams-json', 'teams.json');
  const cl = s.list('claim').find((c) => c.type === 'outcome' && c.status === 'provisional')!;
  applyCorrection(s, corr({ type: 'claim', id: cl.id }, 'confirm'));
  assert.equal(s.get('claim', cl.id)!.status, 'supported');
  fx(s, 'teams-json', 'teams.json');
  assert.equal(s.get('claim', cl.id)!.status, 'supported');
});

test('copy lineage does not depend on import order', () => {
  const out: string[] = [];
  for (const order of [['teams.json', 'email.txt'], ['email.txt', 'teams.json']]) {
    const s = openStore(':memory:');
    for (const f of order) fx(s, f.endsWith('json') ? 'teams-json' : 'email-text', f);
    const mail = s.list('evidence').find((e) => e.provider === 'email' && e.metadata?.segment !== 'quoted')!;
    assert.ok((mail.lineage.copiedFrom?.length ?? 0) > 0 || mail.metadata?.retellingOf, order.join('>'));
    const c = listCases(s).find((x) => x.title.includes('RTR-117'))!;
    out.push(buildCaseView(s, c.id, anyone)!.caveat);
    const again = importFromPath(s, { format: 'email-text', path: join(FIX, 'email.txt'), orgId: ORG, now: NOW });
    assert.equal(again.batch.counts.inserted, 0);
  }
  assert.equal(out[0], out[1]);
});

test('an outcome is never attributed to a later attempt', () => {
  const s = openStore(':memory:');
  run(s, teams([['Ann Lee', 'RTR-900 interface is down, no traffic on the uplink.'], ['Bob Kay', 'It recovered by itself, traffic is back now.'], ['Ann Lee', 'I rebooted the router anyway to be safe.']]));
  const o = s.list('outcome')[0]!;
  assert.equal(o.attemptId, undefined);
});

test('private mention does not hide org case or entity', () => {
  const s = openStore(':memory:');
  fx(s, 'teams-json', 'teams.json');
  const priv = (text: string, ts: string, n: string) => importFromPath(s, { format: 'slack-export', orgId: ORG, now: NOW, payload: {
    users: [{ id: 'U9', real_name: 'Priv Person' }], channels: [{ id: 'G1', name: 'secret', is_private: true }],
    days: [{ channel: 'secret', date: n, messages: [{ ts, user: 'U9', text }] }] } });
  priv('Gate code for the RTR-117 site is in the lockbox.', '1775000000.000100', '2026-04-01');
  priv('RTR-117 BGP sessions are flapping again, neighbors keep going down.', '1775100000.000100', '2026-04-02');
  const cases = listCases(s, anyone);
  assert.ok(cases.length >= 1);
  const v = buildCaseView(s, cases[0]!.id, anyone)!;
  assert.ok(v.entities.some((e) => e.name === 'RTR-117'));
  assert.ok(v.sources.every((x) => x.provider !== 'slack'));
});

test('parseTimeRef never invents instants', () => {
  assert.equal(parseTimeRef('2026-03-10 09:14').known, false);
  assert.equal(parseTimeRef('12/03/2026 09:14').known, false);
  const z = parseTimeRef('2026-03-10T09:14:00+02:00');
  assert.equal(z.known, true);
  assert.equal(z.iso, '2026-03-10T07:14:00.000Z');
  assert.equal(parseTimeRef('Tue, 10 Mar 2026 09:14:00 +0200').iso, '2026-03-10T07:14:00.000Z');
});

test('a done-claim is not supported by the advice it refers to', () => {
  const s = openStore(':memory:');
  fx(s, 'teams-json', 'teams.json');
  for (const c of s.list('claim').filter((x) => x.type === 'action' && /refers to advice/.test(x.statement))) {
    assert.equal(c.status, 'provisional');
    assert.equal(new Set(c.supporting.map((r) => r.evidenceId)).size, 1);
  }
});

test('a later failure report downgrades an earlier recovery', () => {
  const s = openStore(':memory:');
  run(s, teams([['Ann Lee', 'RTR-901 BGP sessions keep flapping since this morning.'], ['Ann Lee', 'I restarted the router.'], ['Ann Lee', 'Sessions are stable now.'], ['Bob Kay', 'Still flapping on my side, the reboot did not help.']]));
  const c = s.list('case')[0]!;
  assert.notEqual(c.status, 'reported-recovered');
  assert.ok(s.list('outcome').filter((o) => o.result === 'recovered').every((o) => o.lasting === 'recurred'));
});
