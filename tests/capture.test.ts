/** B4 D1 "Remember this": POST /import with format 'paste' over HTTP (sniffed thread, receipt facts, idempotence, access). */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import type { ModelProvider } from '../src/libs/utils/models/providers/index.ts';
import { ROOT, startService } from './support.ts';

// Elisa-shaped thread with synthetic names, as the Teams desktop copy puts it on the clipboard.
const THREAD = [
  'Aarne Koskela  9:14 AM',
  "Hi Helmi, I'm at the site now. Changed the SFP on transmission node TRN-117.",
  'Link is up and alarms cleared, but traffic is still not coming back. Have you seen this before?',
  '',
  'Helmi Virtanen  9:16 AM',
  'Yes. Is this one of the older units?',
  '',
  'Aarne Koskela  9:16 AM',
  'Yes, installed around 2019 I think.',
  '',
  'Helmi Virtanen  9:19 AM',
  'Check whether the traffic counters are actually increasing. If they stay at zero even though the interface is UP, reset the interface on both ends.',
  '',
  'Aarne Koskela  9:21 AM',
  'Link UP. Counters zero.',
  '',
  'Aarne Koskela  9:25 AM',
  'Reset the interface on both ends. Traffic is back.',
].join('\n');

test('POST /import paste: a pasted thread becomes a case bound to the asset and both speakers, date unknown; a second paste inserts 0', async () => {
  const svc = await startService();
  try {
    const r = await svc.call('POST', '/import', { format: 'paste', payload: THREAD });
    assert.equal(r.batch.counts.inserted, 6);
    assert.equal(r.cases, 1);
    assert.ok(r.claims >= 5, `claims ${r.claims}`);
    assert.equal(r.captured.cases.length, 1);
    assert.match(r.captured.cases[0].title, /TRN-117/);
    assert.deepEqual(r.captured.entities, ['TRN-117']);
    assert.deepEqual([...r.captured.people].sort(), ['Aarne Koskela', 'Helmi Virtanen']);
    assert.equal(r.captured.from, '9:14 AM');
    assert.equal(r.captured.to, '9:25 AM');
    assert.equal(r.captured.dateKnown, false);
    assert.equal(r.captured.alreadyKnown, false);
    // Stored verbatim under the paste connection, time partial, never 'now'.
    const ev = svc.engine.store.list('evidence');
    assert.equal(ev.length, 6);
    assert.ok(ev.every((e) => e.connectionId === 'paste:desktop' && e.provider === 'teams' && !e.eventTime.known));
    assert.ok(ev.some((e) => e.text === 'Link UP. Counters zero.'));

    const again = await svc.call('POST', '/import', { format: 'paste', payload: { text: THREAD } });
    assert.equal(again.batch.counts.inserted, 0);
    assert.equal(again.captured.alreadyKnown, true);
    assert.deepEqual(again.captured.cases, r.captured.cases);
    assert.equal(svc.engine.store.list('case').length, 1);
  } finally {
    await svc.close();
  }
});

test('POST /import paste: a plain note stays one note with its author name; blank text, a path, or a non-text payload is 400', async () => {
  const svc = await startService();
  try {
    const r = await svc.call('POST', '/import', { format: 'paste', payload: { text: 'Changed the SFP on TRN-117, link is up but no traffic.', authorName: 'Aarne Koskela' } });
    assert.equal(r.batch.counts.inserted, 1);
    assert.equal(r.captured.dateKnown, false);
    const [note] = svc.engine.store.list('evidence');
    assert.equal(note!.provider, 'paste');
    assert.equal(note!.author.displayName, 'Aarne Koskela');
    await svc.call('POST', '/import', { format: 'paste', payload: '' }, 400);
    await svc.call('POST', '/import', { format: 'paste', payload: '  \n ' }, 400);
    await svc.call('POST', '/import', { format: 'paste', payload: { text: '   ' } }, 400);
    await svc.call('POST', '/import', { format: 'paste', payload: 42 }, 400);
    await svc.call('POST', '/import', { format: 'paste', path: '/etc/hosts' }, 400);
    // Other formats answer without a captured block.
    const other = await svc.call('POST', '/import', { format: 'email-text', payload: 'From: A <a@x.org>\nSubject: s\n\nhello there' });
    assert.equal(other.captured, undefined);
  } finally {
    await svc.close();
  }
});

test('POST /import paste with the pasting person\'s groups: the case is private to that group', async () => {
  const svc = await startService();
  try {
    const r = await svc.call('POST', '/import', { format: 'paste', payload: THREAD, accessGroups: ['field-team'] });
    assert.equal(r.captured.cases.length, 1); // described to its owner with the import's own groups
    const outsider = await svc.call('GET', '/cases?principalId=person:nobody');
    assert.equal(outsider.length, 0);
  } finally {
    await svc.close();
  }
});

test('POST /import paste with extract=local and the model down: still the rules capture, with its receipt facts', async () => {
  const local: ModelProvider = {
    kind: 'local',
    async embed() { throw new Error('not used'); },
    async generateJson() { throw new Error('connect ECONNREFUSED 127.0.0.1:11434'); },
    async generateText() { throw new Error('not used'); },
    async warm() {}, async unload() {},
    async detect() { return { installed: true, running: true, models: [] }; },
    async pull() {},
  };
  const svc = await startService({ modelManager: { local } });
  try {
    await svc.call('PUT', '/settings', { models: { extract: { provider: 'local' } } });
    const r = await svc.call('POST', '/import', { format: 'paste', payload: THREAD });
    assert.match(r.extraction.route.version, /fallback/);
    assert.equal(r.captured.cases.length, 1);
    assert.deepEqual([...r.captured.people].sort(), ['Aarne Koskela', 'Helmi Virtanen']);
  } finally {
    await svc.close();
  }
});

const ELISA = join(ROOT, 'private/Elisa_SinceAI2026/ELISA_HIDDEN_KNOWLEDGE_EXAMPLE_2026/teams_chat.json');

test('done line: the Elisa thread copied as text gives one case bound to its node and both people, date unknown', { skip: !existsSync(ELISA) && 'private Elisa files absent' }, async () => {
  const j = JSON.parse(readFileSync(ELISA, 'utf8')) as { messages: Array<{ time: string; author: string; text: string }> };
  const text = j.messages.map((m) => `[${m.time}] ${m.author}: ${m.text}`).join('\n');
  const svc = await startService();
  try {
    const r = await svc.call('POST', '/import', { format: 'paste', payload: text });
    assert.equal(r.captured.cases.length, 1);
    assert.equal(r.captured.entities.length, 1);
    assert.equal(r.captured.people.length, 2);
    assert.match(r.captured.cases[0].title, new RegExp(r.captured.entities[0]));
    assert.equal(r.captured.dateKnown, false);
  } finally {
    await svc.close();
  }
});

test('POST /import paste: two pastes opening with the same greeting stay separate; an author object in the payload is ignored', async () => {
  const svc = await startService();
  try {
    await svc.call('POST', '/import', { format: 'paste', payload: 'Aarne Koskela  9:00 AM\nHi Helmi, quick one.\n\nHelmi Virtanen  9:01 AM\nIs TRN-117 one of the older units?' });
    const r = await svc.call('POST', '/import', { format: 'paste', payload: 'Aarne Koskela  2:00 PM\nHi Helmi, quick one.\n\nHelmi Virtanen  2:03 PM\nRTR-555 is flapping again since noon.' });
    assert.equal(r.batch.counts.revised, 0);
    assert.equal(r.batch.counts.inserted, 2);
    assert.equal(r.captured.from, '2:00 PM');
    const ids = svc.engine.store.list('evidence').map((e) => e.sourceId);
    assert.equal(new Set(ids).size, ids.length);
    const n = await svc.call('POST', '/import', { format: 'paste', payload: { text: 'The link on TRN-117 is up but no traffic.', author: { id: 'person:slack:U102', displayName: 'Erkki Expert', provider: 'slack' } } });
    assert.equal(n.batch.counts.inserted, 1);
    const note = svc.engine.store.list('evidence').find((e) => e.provider === 'paste')!;
    assert.notEqual(note.author.id, 'person:slack:U102');
    assert.notEqual(note.author.displayName, 'Erkki Expert');
  } finally {
    await svc.close();
  }
});

test('POST /import paste: re-pasting org-wide content with a group says it is already visible more widely', async () => {
  const svc = await startService();
  try {
    assert.equal((await svc.call('POST', '/import', { format: 'paste', payload: THREAD })).captured.widerAccess, undefined);
    const r = await svc.call('POST', '/import', { format: 'paste', payload: THREAD, accessGroups: ['secret'] });
    assert.equal(r.captured.alreadyKnown, true);
    assert.equal(r.captured.widerAccess, true);
  } finally {
    await svc.close();
  }
});
