import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openStore } from '../memory/sqlite-store.ts';
import { parseEmailText, parseTeamsJson, parseSlackExport } from '../connectors/index.ts';
import { importSources } from './index.ts';

const opts = { orgId: 'o', ingestedAt: '2026-01-01T00:00:00Z' };
const teams = {
  channel: 'teams',
  messages: [
    { seq: 1, time: '10:00', author: 'Ann', text: 'The router RTR-9 keeps dropping its sessions after the update today.' },
    { seq: 2, time: '10:02', author: 'Bob', text: 'Check the logs before you roll back anything at all.' },
  ],
};
const inp = (now: string) => ({ orgId: 'o', connectionId: 'import:teams:file', sourceDescription: 't', now });

test('reimport is idempotent and counts show duplicates with denominators', () => {
  const s = openStore(':memory:');
  const a = importSources(s, parseTeamsJson(teams, opts), inp('2026-02-01T00:00:00Z'));
  assert.deepEqual(a.batch.counts, { seen: 2, inserted: 2, unchangedDuplicates: 0, revised: 0, copies: 0 });
  const before = JSON.stringify(s.list('evidence'));
  const b = importSources(s, parseTeamsJson(teams, opts), inp('2026-02-02T00:00:00Z'));
  assert.deepEqual(b.batch.counts, { seen: 2, inserted: 0, unchangedDuplicates: 2, revised: 0, copies: 0 });
  assert.equal(JSON.stringify(s.list('evidence')), before);
  assert.equal(s.count('evidence'), 2);
  assert.equal(b.batch.counts.seen, b.batch.counts.inserted + b.batch.counts.unchangedDuplicates + b.batch.counts.revised);
});

test('new revision links to the previous one and supersedes it', () => {
  const s = openStore(':memory:');
  const slack = (text: string, edited?: string) => ({
    users: [], channels: [{ id: 'C1', name: 'ops' }],
    days: [{ channel: 'ops', date: '2026-03-10', messages: [{ ts: '1773133500.000100', user: 'U1', text, ...(edited ? { edited: { ts: edited } } : {}) }] }],
  });
  const c = { orgId: 'o', connectionId: 'import:slack:export', sourceDescription: 's', now: '2026-03-10T00:00:00Z' };
  const first = importSources(s, parseSlackExport(slack('sessions flapping on RTR-9 again today'), opts), c);
  const second = importSources(s, parseSlackExport(slack('sessions flapping on RTR-9 after update', '1773134000.000000'), opts), { ...c, now: '2026-03-10T01:00:00Z' });
  assert.equal(second.batch.counts.revised, 1);
  assert.equal(second.batch.counts.inserted, 0);
  assert.equal(s.count('evidence'), 2);
  const newer = s.get('evidence', second.revised[0]!)!;
  assert.equal(newer.metadata?.previousRevisionId, first.inserted[0]);
  assert.equal(s.get('evidence', first.inserted[0]!)!.metadata?.supersededBy, newer.id);
});

test('same id with different text is stored as a new revision, never silently overwritten', () => {
  const s = openStore(':memory:');
  importSources(s, parseTeamsJson(teams, opts), inp('2026-02-01T00:00:00Z'));
  const changed = structuredClone(teams);
  changed.messages[1]!.text = 'Check the logs and then roll back the firmware at once.';
  // keep the first three messages identical so the conversation key is unchanged
  const r = importSources(s, parseTeamsJson(changed, opts), inp('2026-02-02T00:00:00Z'));
  assert.equal(r.batch.counts.revised, 1);
  assert.equal(r.batch.counts.unchangedDuplicates, 1);
});

test('copy detection: quoted chat in an email gives copiedFrom; short common texts do not', () => {
  const s = openStore(':memory:');
  const chat = importSources(s, parseTeamsJson(teams, opts), inp('2026-02-01T00:00:00Z'));
  const mail = parseEmailText(
    'From: Ann\nTo: Team\nSubject: RE: RTR-9 sessions\n\nFor the record:\n\n> Ann: The router RTR-9 keeps dropping its sessions after the update today.\n> Bob: Check the logs before you roll back anything at all.\n\nThanks',
    opts,
  );
  const r = importSources(s, mail, { orgId: 'o', connectionId: 'import:email:file', sourceDescription: 'e', now: '2026-02-02T00:00:00Z' });
  const [parent, segment] = r.evidence;
  assert.deepEqual(new Set(segment!.lineage.copiedFrom), new Set(chat.evidence.map((e) => e.id)));
  assert.deepEqual(new Set(parent!.lineage.copiedFrom), new Set(chat.evidence.map((e) => e.id)));
  assert.equal(r.batch.counts.copies, 2);
  const short = importSources(s, parseTeamsJson({ channel: 'teams', messages: [{ seq: 1, time: '1', author: 'Ann', text: 'Yes.' }, { seq: 2, time: '2', author: 'Bob', text: 'Yes.' }] }, opts), inp('2026-02-03T00:00:00Z'));
  assert.equal(short.batch.counts.copies, 0);
});

test('forwarding the same long message into another thread is a copy', () => {
  const s = openStore(':memory:');
  importSources(s, parseTeamsJson(teams, opts), inp('2026-02-01T00:00:00Z'));
  const other = { channel: 'teams', messages: [{ seq: 1, time: '11:00', author: 'Cy', text: 'The router RTR-9 keeps dropping its sessions after the update today!' }] };
  const r = importSources(s, parseTeamsJson(other, opts), inp('2026-02-02T00:00:00Z'));
  assert.equal(r.copies.length, 1);
});
