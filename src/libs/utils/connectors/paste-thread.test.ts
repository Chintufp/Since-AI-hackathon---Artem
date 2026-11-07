import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectPasteKind, parsePastedThread, parseTeamsJson } from './index.ts';

// An Elisa-shaped thread with synthetic names: field engineer reports, expert asks, short replies, advice, recovery.
const MSGS: Array<[string, string, string]> = [
  ['09:14', 'Aarne Koskela', "Hi Helmi, I'm at the site now. Changed the SFP on transmission node TRN-117.\nLink is up and alarms cleared, but traffic is still not coming back."],
  ['09:16', 'Helmi Virtanen', 'Is this one of the older units?'],
  ['09:16', 'Aarne Koskela', 'Yes, installed around 2019 I think.'],
  ['09:19', 'Helmi Virtanen', 'Check whether the traffic counters are actually increasing.\nIf they stay at zero, reset the interface.'],
  ['09:25', 'Aarne Koskela', 'Did that. Traffic is back 👍'],
];

const bracket = MSGS.map(([t, a, x]) => `[${t}] ${a}: ${x}`).join('\n');
const bare = MSGS.map(([t, a, x]) => `${t} ${a}: ${x}`).join('\n');
const teamsCopy = MSGS.map(([t, a, x]) => `${a}  ${Number(t.slice(0, 2))}:${t.slice(3)} AM\n${x}\n`).join('\n');
const plain = MSGS.map(([, a, x]) => `${a}: ${x}`).join('\n');

test('paste sniffing: the four clipboard thread shapes give the same speakers and verbatim text', () => {
  for (const [label, text] of [['bracket', bracket], ['bare', bare], ['teams copy', teamsCopy], ['plain', plain]] as const) {
    assert.equal(detectPasteKind(text), 'thread', label);
    const t = parsePastedThread(text)!;
    assert.equal(t.channel, 'pasted');
    assert.deepEqual(t.messages.map((m) => m.author), MSGS.map((m) => m[1]), label);
    assert.deepEqual(t.messages.map((m) => m.text), MSGS.map((m) => m[2]), label); // multi-line bodies kept, emoji kept
    assert.deepEqual(t.messages.map((m) => m.seq), [1, 2, 3, 4, 5]);
  }
  assert.deepEqual(parsePastedThread(bracket)!.messages.map((m) => m.time), MSGS.map((m) => m[0]));
  assert.equal(parsePastedThread(teamsCopy)!.messages[0]!.time, '9:14 AM');
  assert.equal(parsePastedThread(plain)!.messages[0]!.time, undefined);
});

test('paste sniffing: a parsed thread keeps time-only stamps partial through the Teams adapter', () => {
  const env = parseTeamsJson(parsePastedThread(teamsCopy)!, { orgId: 'org1', connectionId: 'paste:desktop' });
  assert.equal(env.length, 5);
  assert.equal(env[0]!.provider, 'teams');
  assert.equal(env[0]!.eventTime.known, false);
  assert.equal(env[0]!.eventTime.partial, 'time-only');
  assert.equal(env[1]!.author.displayName, 'Helmi Virtanen');
});

test('paste sniffing: e-mail, JSON export, note and empty', () => {
  assert.equal(detectPasteKind('From: Hanna <h@x.org>\nTo: Team\nSubject: TRN-117\n\nThe link flaps.'), 'email');
  assert.equal(detectPasteKind(JSON.stringify({ channel: 'teams', messages: [{ author: 'A', text: 'x' }] })), 'teams-json');
  assert.equal(detectPasteKind('{"not": "an export"}'), 'note');
  assert.equal(detectPasteKind('   \n '), 'empty');
  // A problem description, even a labelled one, is a note: never a thread.
  assert.equal(detectPasteKind('Changed the SFP on TRN-117, link is up but no traffic. Any idea?'), 'note');
  assert.equal(detectPasteKind('Problem: no traffic on TRN-117\nSteps: changed the SFP\nStatus: link up'), 'note');
  // One speaker without times is a note, and 'Veikko: hi' style lines are not e-mail headers.
  assert.equal(detectPasteKind('Aarne Koskela: the link is up\nAarne Koskela: still no traffic'), 'note');
  assert.equal(detectPasteKind('Aarne: the link is up\nHelmi: reset the interface'), 'thread');
  // Free text before the first speaker makes it a note.
  assert.equal(detectPasteKind(`Look at this:\n${bracket}`), 'note');
});

test('paste sniffing: a body line with a time and a "Label:" line inside a timed thread stay body text', () => {
  const text = 'Aarne Koskela  9:14 AM\nDid that at 9:20\nNote: counters zero\n\nHelmi Virtanen  9:22 AM\nGood.';
  const t = parsePastedThread(text)!;
  assert.equal(t.messages.length, 2);
  assert.equal(t.messages[0]!.text, 'Did that at 9:20\nNote: counters zero');
});

test('paste sniffing: labelled problem notes are notes, never threads with made-up people', () => {
  for (const note of [
    'Optics: ok\nFirmware: 4.2.1\nTraffic: none',
    'SFP Module: replaced\nOptical Levels: ok\nTraffic Counters: zero',
    'SFP Module: replaced on TRN-301\nOptical Levels: ok',
    'Interface: TRN-301 ge-0/0/1\nOptical Level: -3 dBm\nStatus Check: failed',
    'Monday: changed SFP\nTuesday: still no traffic',
  ]) assert.equal(detectPasteKind(note), 'note', note);
  // Real two-person exchanges still are threads, with or without full names.
  assert.equal(detectPasteKind('Veikko: changed SFP on TRN-301\nErkki: check counters'), 'thread');
  assert.equal(detectPasteKind('Veikko Vikkelä: changed the SFP on TRN-301, link up, no traffic\nErkki Expert: check the counters'), 'thread');
});

test('paste sniffing: a stated date in a header is kept verbatim with the time; 9.14 is a time-only stamp', () => {
  const bracketDate = '[11/7 9:14 AM] Aarne Koskela\nLink is up, no traffic.\n[11/7 9:16 AM] Helmi Virtanen\nReset the interface.';
  assert.deepEqual(parsePastedThread(bracketDate)!.messages.map((m) => m.time), ['11/7 9:14 AM', '11/7 9:16 AM']);
  const fiHeader = 'Aarne Koskela  7.11. 09:14\nLink is up, no traffic.\n\nHelmi Virtanen  7.11. 09:16\nReset the interface.';
  assert.equal(detectPasteKind(fiHeader), 'thread');
  assert.deepEqual(parsePastedThread(fiHeader)!.messages.map((m) => m.time), ['7.11. 09:14', '7.11. 09:16']);
  const env = parseTeamsJson(parsePastedThread(fiHeader)!, { orgId: 'org1' });
  assert.equal(env[0]!.eventTime.known, false); // zoneless: kept raw, never guessed
  const dotted = parseTeamsJson(parsePastedThread('[9.14] Aarne Koskela: link up\n[9.16] Helmi Virtanen: reset it')!, { orgId: 'org1' });
  assert.equal(dotted[0]!.eventTime.partial, 'time-only');
});

test('paste sniffing: two different threads opening with the same line are two conversations; a re-paste in another shape is the same one', () => {
  const a = parseTeamsJson(parsePastedThread('Aarne Koskela  9:00 AM\nHi Helmi, quick one.\n\nHelmi Virtanen  9:01 AM\nSure, about TRN-117?')!, { orgId: 'o' });
  const b = parseTeamsJson(parsePastedThread('Aarne Koskela  2:00 PM\nHi Helmi, quick one.\n\nHelmi Virtanen  2:03 PM\nRTR-555 is flapping again.')!, { orgId: 'o' });
  assert.notEqual(a[1]!.sourceId, b[1]!.sourceId);
  assert.notEqual(a[0]!.thread!.threadId, b[0]!.thread!.threadId);
  const again = parseTeamsJson(parsePastedThread(teamsCopy)!, { orgId: 'o' });
  const other = parseTeamsJson(parsePastedThread(bracket)!, { orgId: 'o' });
  assert.deepEqual(again.map((e) => e.sourceId), other.map((e) => e.sourceId));
});
