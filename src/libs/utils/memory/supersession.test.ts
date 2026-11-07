import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Claim, KnowledgeStore } from '../contracts/index.ts';
import { defaultExtractionConfig } from './extraction-config.ts';
import { extractFromContext } from './extractor-rules.ts';
import { applyCorrection, importFromPath, openStore } from './index.ts';
import { validAt } from './validity.ts';
import { parseTeamsJson } from '../connectors/teams-json.ts';

const ORG = 'org1';
const NOW = '2026-11-07T12:00:00Z';

const OLD_EMAIL = `From: Eino Salo <eino.salo@example.test>
To: Ilmari Karjalainen <ilmari@example.test>
Date: Wed, 20 Aug 2026 09:12:00 +0300
Subject: RBS-310 site access (barrier and cabinet key)

Hi Ilmari,

Access to RBS-310 as agreed:

- Road barrier code: 5802. The landlord changes it every October and I normally get the new code by email around the 5th.
- Cabinet key is in the lockbox on the left gatepost, lockbox code 1946.

Eino`;

const NEW_EMAIL = `From: Eino Salo <eino.salo@example.test>
To: Ilmari Karjalainen <ilmari@example.test>
Date: Tue, 6 Oct 2026 08:40:00 +0300
Subject: RBS-310 barrier code

Hi Ilmari,

Barrier code at RBS-310 is now 7731, the landlord changed the lock.

Eino`;

const THREAD = {
  channel: 'teams-sup-test',
  messages: [
    { seq: 1, time: '09:14', author: 'Veikko Field', text: 'Changed the SFP on TRN-777. Link is up and alarms cleared, but traffic is still not coming back.' },
    { seq: 2, time: '09:18', author: 'Erkki Expert', text: 'Sometimes after changing the SFP the interface comes up normally, but the forwarding state does not recover correctly.' },
    { seq: 3, time: '09:22', author: 'Erkki Expert', text: 'Disable the interface, wait a little, then enable it again.' },
    { seq: 4, time: '09:25', author: 'Veikko Field', text: 'Did that. Traffic is back.' },
  ],
};

const NOTE = {
  channel: 'teams-sup-note',
  messages: [{ seq: 1, time: '2026-10-14T10:05:00+03:00', author: 'Erkki Expert', text: 'TRN-777 follow-up: the 4.2 firmware fixes the forwarding-state bug. Units already on 4.2 should not see it; if they do, it is something else.' }],
};

const email = (s: KnowledgeStore, payload: string) => importFromPath(s, { format: 'email-text', payload, orgId: ORG, now: NOW });
const teams = (s: KnowledgeStore, payload: unknown) => importFromPath(s, { format: 'teams-json', payload, orgId: ORG, now: NOW });
const code = (s: KnowledgeStore, value: string): Claim | undefined =>
  s.list('claim').find((c) => c.type === 'access-fact' && c.condition?.key === 'site.access_code' && c.condition.value === value);

test('newer value closes the older one: barrier 5802 -> 7731 via site.access_code; the old claim stays readable with its window', () => {
  const s = openStore(':memory:');
  email(s, OLD_EMAIL);
  const before = code(s, '5802')!;
  assert.ok(before, 'the code is its own access fact');
  assert.equal(before.condition?.qualifier, 'barrier');
  assert.equal(before.validity.condition, 'changes every October', 'the "every October" sentence lands on the barrier code');
  assert.equal(code(s, '1946')?.condition?.qualifier, 'lockbox');
  email(s, NEW_EMAIL);
  const old = s.get('claim', before.id)!;
  const fresh = code(s, '7731')!;
  assert.equal(old.status, 'superseded');
  assert.equal(old.supersededBy, fresh.id);
  assert.equal(old.validity.to?.iso, '2026-10-06T05:40:00.000Z');
  assert.equal(old.validity.orderBasis, 'known-time');
  assert.equal(old.validity.route?.version, 'supersession-rules@1');
  assert.equal(old.revision, before.revision + 1);
  assert.deepEqual(old.supporting.map((r) => r.evidenceId), before.supporting.map((r) => r.evidenceId), 'evidence kept');
  assert.equal(validAt(old, Date.parse('2026-09-01T00:00:00Z')), true);
  assert.equal(validAt(old, Date.parse('2026-10-20T00:00:00Z')), false);
  assert.equal(validAt(fresh, Date.parse('2026-10-20T00:00:00Z')), true);
  assert.equal(code(s, '1946')?.status, 'provisional', 'a lockbox code is not closed by a barrier code');
  assert.equal(old.statement, 'Road barrier code: 5802.', 'the statement stays verbatim');
  assert.equal(fresh.statement, 'Barrier code at RBS-310 is now 7731, the landlord changed the lock.');
  assert.ok(s.list('claim').filter((c) => c.condition?.key === 'site.access').every((c) => c.status !== 'superseded'), 'access facts without a code stay');
});

test('import order does not matter when both are dated: the older email imported last is still the one closed', () => {
  const s = openStore(':memory:');
  email(s, NEW_EMAIL);
  email(s, OLD_EMAIL);
  assert.equal(code(s, '5802')?.status, 'superseded');
  assert.equal(code(s, '7731')?.status, 'provisional');
});

test('a backfilled code between an older and a newer one re-closes the older at the backfilled date: one code at a time', () => {
  const MID = OLD_EMAIL.replace('Wed, 20 Aug 2026 09:12:00 +0300', 'Tue, 1 Sep 2026 09:00:00 +0300').replace('5802', '6000').replace('lockbox code 1946', 'lockbox code 1947');
  const s = openStore(':memory:');
  email(s, OLD_EMAIL);
  email(s, NEW_EMAIL);
  email(s, MID);
  const o = code(s, '5802')!, m = code(s, '6000')!, n = code(s, '7731')!;
  assert.equal(o.supersededBy, m.id);
  assert.equal(o.validity.to?.iso, m.validity.from?.iso);
  assert.equal(m.supersededBy, n.id);
  const live = (iso: string) => [o, m, n].filter((c) => validAt(s.get('claim', c.id)!, Date.parse(iso))).map((c) => c.condition?.value);
  assert.deepEqual(live('2026-08-25T00:00:00Z'), ['5802']);
  assert.deepEqual(live('2026-09-15T00:00:00Z'), ['6000']);
  assert.deepEqual(live('2026-10-20T00:00:00Z'), ['7731']);
});

test('undated values need an explicit replacement cue before import order may close anything', () => {
  const undated = (body: string) => `From: A <a@example.test>\nTo: B <b@example.test>\nSubject: XYZ-77 access\n\n${body}\n`;
  const s = openStore(':memory:');
  email(s, undated('The gate code at XYZ-77 is 1111.'));
  email(s, undated('Gate code at XYZ-77: 2222.'));
  assert.equal(code(s, '1111')?.status, 'provisional', 'no cue, undated: both stay');
  email(s, undated('The gate code at XYZ-77 is now 3333.'));
  assert.equal(code(s, '1111')?.status, 'superseded');
  assert.equal(code(s, '1111')?.validity.orderBasis, 'import-order');
});

test('corrected, retracted and human-confirmed claims are never superseded', () => {
  const s = openStore(':memory:');
  email(s, OLD_EMAIL);
  const c = code(s, '5802')!;
  applyCorrection(s, { id: 'corr1', orgId: ORG, target: { type: 'claim', id: c.id }, change: 'retract', reason: 'wrong', by: { id: 'p', displayName: 'P' }, at: NOW });
  const lockbox = code(s, '1946')!;
  applyCorrection(s, { id: 'corr2', orgId: ORG, target: { type: 'claim', id: lockbox.id }, change: 'confirm', reason: 'right', by: { id: 'p', displayName: 'P' }, at: NOW });
  email(s, NEW_EMAIL);
  email(s, NEW_EMAIL.replace('Barrier code at RBS-310 is now 7731', 'Lockbox code at RBS-310 is now 5555').replace('Subject: RBS-310 barrier code', 'Subject: RBS-310 lockbox code'));
  assert.equal(s.get('claim', c.id)!.status, 'retracted');
  assert.equal(s.get('claim', c.id)!.supersededBy, undefined);
  assert.notEqual(s.get('claim', lockbox.id)!.status, 'superseded');
});

test('the cue "the 4.2 firmware fixes" is a superseding note, not an outcome', () => {
  const ev = parseTeamsJson(NOTE, { orgId: ORG, ingestedAt: NOW, batchId: 'b' });
  const p = extractFromContext({ evidence: ev }, defaultExtractionConfig);
  assert.equal(p.claims.filter((c) => c.type === 'outcome').length, 0, 'no recovery of the old case');
  assert.equal(p.claims.filter((c) => c.type === 'advice' || c.type === 'observation').length, 0, 'the rest of the note belongs to it');
  const note = p.claims.find((c) => c.supersessionBound);
  assert.ok(note);
  assert.equal(note.type, 'other');
  assert.deepEqual([note.supersessionBound!.key, note.supersessionBound!.operator, note.supersessionBound!.value], ['software.version', 'gte', '4.2']);
  const variant = parseTeamsJson({ channel: 'v', messages: [{ seq: 1, author: 'E', text: 'TRN-777: this was fixed in firmware 4.2, so the forwarding-state bug is fixed.' }] }, { orgId: ORG, ingestedAt: NOW, batchId: 'b' });
  const pv = extractFromContext({ evidence: variant }, defaultExtractionConfig);
  assert.equal(pv.claims.filter((c) => c.type === 'outcome').length, 0);
  assert.equal(pv.claims.find((c) => c.supersessionBound)?.supersessionBound?.value, '4.2');
});

test('a firmware note bounds the older advice and hypothesis of its asset; nothing is closed for everyone', () => {
  const s = openStore(':memory:');
  teams(s, THREAD);
  const before = s.list('claim').filter((c) => c.type === 'advice' || c.type === 'hypothesis');
  assert.ok(before.length >= 2);
  const outcomesBefore = s.list('outcome').length;
  teams(s, NOTE);
  const note = s.list('claim').find((c) => c.supersessionBound)!;
  assert.equal(note.caseId, undefined, 'the note is not a case condition');
  assert.equal(note.validity.from?.iso, '2026-10-14T07:05:00.000Z');
  for (const b of before) {
    const now = s.get('claim', b.id)!;
    assert.equal(now.status, b.status, 'status unchanged');
    assert.equal(now.validity.condition, 'software.version < 4.2');
    assert.equal(now.validity.conditionedBy, note.id);
  }
  assert.equal(s.list('outcome').length, outcomesBefore, 'the note adds no outcome');
  assert.ok(s.list('case').every((c) => !c.conditions.some((x) => x.key === 'software.version')), 'no software.version case condition');
});
