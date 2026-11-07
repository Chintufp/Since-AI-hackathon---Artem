import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  connectionCards, parseEmailText, parsePaste, parseSlackExport, parseTeamsJson, parseTimeRef, readSlackExportDir, SlackConnector,
  splitEmailBody, cleanSlackText,
} from './index.ts';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../../../data/fixtures/dev-family-01');
const opts = { orgId: 'org1', ingestedAt: '2026-01-01T00:00:00Z' };

test('time parsing never invents dates', () => {
  assert.deepEqual(parseTimeRef('09:14', 1), { known: false, raw: '09:14', sequence: 1, partial: 'time-only' });
  assert.equal(parseTimeRef('2026-03-02').partial, 'date-only');
  assert.equal(parseTimeRef('Tue, 3 Mar 2026 09:14:00 +0000').known, true);
  assert.deepEqual(parseTimeRef(undefined), { known: false });
  assert.equal(parseTimeRef('yesterday').known, false);
});

test('teams adapter: time-only stamps stay partial, ids are stable and distinct per conversation', () => {
  const data = JSON.parse(readFileSync(join(FIX, 'teams.json'), 'utf8'));
  const a = parseTeamsJson(data, opts);
  const b = parseTeamsJson(data, opts);
  assert.equal(a.length, 12);
  assert.deepEqual(a.map((e) => e.id), b.map((e) => e.id));
  assert.equal(a[0]!.eventTime.known, false);
  assert.equal(a[0]!.eventTime.partial, 'time-only');
  assert.equal(a[0]!.eventTime.sequence, 1);
  assert.equal(a[0]!.author.role, 'Network Technician');
  const other = parseTeamsJson({ channel: 'teams', messages: [{ seq: 1, time: '09:00', author: 'X', text: 'different conversation entirely' }] }, opts);
  assert.notEqual(other[0]!.id, a[0]!.id);
  assert.throws(() => parseTeamsJson({}, opts));
});

test('email adapter: headers, derived source id, quoted segment as separate derived envelope', () => {
  const raw = readFileSync(join(FIX, 'email.txt'), 'utf8');
  const out = parseEmailText(raw, opts);
  assert.equal(out.length, 2);
  const [mail, quoted] = out;
  assert.equal(mail!.author.displayName, 'Hanna Mäkelä');
  assert.equal(mail!.recipients?.[0]?.displayName, 'Maintenance Team');
  assert.match(mail!.sourceId, /^fp:/);
  assert.equal(mail!.metadata?.messageIdDerived, true);
  assert.equal(mail!.eventTime.known, false);
  assert.equal(quoted!.metadata?.segment, 'quoted');
  assert.deepEqual(quoted!.lineage.derivedFrom, [mail!.id]);
  assert.ok(!quoted!.text.includes('>'));
  assert.equal(parseEmailText(raw, opts)[0]!.id, mail!.id);
  const withId = parseEmailText('From: A <a@x.org>\nTo: B\nSubject: s\nMessage-ID: <abc@x>\n\nhello there friend', opts)[0]!;
  assert.equal(withId.sourceId, 'msgid:abc@x');
  assert.equal(withId.author.displayName, 'A');
});

test('quoted detection: "On ... wrote:" tail and forwarded blocks', () => {
  const r = splitEmailBody('Thanks, will do.\n\nOn Mon, 2 Mar 2026, Bob wrote:\n> first line of the old mail here\n> second line');
  assert.equal(r.fresh, 'Thanks, will do.');
  assert.equal(r.quoted.length, 1);
  assert.match(r.quoted[0]!.text, /first line of the old mail/);
  const f = splitEmailBody('FYI\n\n---------- Forwarded message ----------\nFrom: x\nSubject: y\n\nbody of the forwarded mail');
  assert.equal(f.quoted[0]!.kind, 'forwarded');
  assert.equal(splitEmailBody('plain text only').quoted.length, 0);
});

test('slack export adapter: threads, revisions, access, noise, markup', () => {
  const data = readSlackExportDir(join(FIX, 'slack-export'));
  const out = parseSlackExport(data, opts);
  assert.equal(out.length, 7); // channel_join skipped
  assert.ok(out.every((e) => e.provider === 'slack' && e.recipients === undefined));
  assert.ok(out.every((e) => e.accessScope.visibility === 'org'));
  const thread = out.filter((e) => e.thread.threadId === out.find((x) => x.metadata?.replyCount === 2)!.thread.threadId);
  assert.equal(thread.length, 3); // parent + reply day 1 + reply day 2
  assert.ok(out.find((e) => e.text.includes('welcome back'))!.text.includes('@Hanna Mäkelä'));
  const edited = structuredClone(data);
  edited.days[0]!.messages[2]!.edited = { user: 'U02', ts: '1773133999.000000' };
  const rev = parseSlackExport(edited, opts);
  assert.equal(rev.find((e) => e.metadata?.edited)!.revision, '1773133999.000000');
  assert.equal(out.find((e) => e.sourceId.endsWith(edited.days[0]!.messages[2]!.ts))!.revision, '1');
  const priv = structuredClone(data);
  priv.channels[0]!.is_private = true;
  const p = parseSlackExport(priv, opts);
  assert.deepEqual(p[0]!.accessScope, { visibility: 'group', groups: ['slack-channel:C100'] });
  assert.equal(cleanSlackText('<#C1|ops> see <https://x.io|the doc> &amp; <@U9>', {}), '#ops see the doc & @U9');
});

test('slack live connector: no authorization from env alone; pure mapping on fixture payloads; no network', async () => {
  process.env.SLACK_BOT_TOKEN = 'xoxb-should-not-be-used';
  const c = new SlackConnector({ orgId: 'org1', workspaceId: 'T0123' });
  assert.equal(c.status, 'awaiting-authorization');
  assert.equal(c.authorized, false);
  assert.equal(new SlackConnector({ liveAuthorized: true }).authorized, false, 'token is also required');
  await assert.rejects(() => c.fetchHistory({ id: 'C1', name: 'x' }, [], (() => { throw new Error('network touched'); }) as never));
  const channel = { id: 'C100', name: 'ops-network' };
  const history = { ok: true, messages: [{ ts: '1773133500.000100', user: 'U01', text: 'RTR-117 flapping', thread_ts: '1773133500.000100', reply_count: 1 }, { ts: '1773133000.000000', subtype: 'channel_join', user: 'U01', text: 'joined' }] };
  const mapped = c.mapHistory(history, channel, [{ id: 'U01', real_name: 'Hanna' }]);
  assert.equal(mapped.length, 1);
  assert.equal(mapped[0]!.author.displayName, 'Hanna');
  assert.equal(mapped[0]!.connectionId, 'slack:T0123');
  const replies = c.mapReplies({ messages: [{ ts: '1773133600.000200', user: 'U01', text: 'reply one is here' }, { ts: '1773133500.000100', user: 'U01', text: 'RTR-117 flapping' }] }, channel);
  assert.equal(replies[0]!.text, 'RTR-117 flapping');
  assert.equal(replies[1]!.thread.threadId, 'C100:1773133500.000100');
  const live = new SlackConnector({ liveAuthorized: true, token: 't' });
  assert.equal(live.status, 'fixture-tested', 'authorized but never live-verified');
  const got = await live.fetchHistory(channel, [], async () => ({ json: async () => history }));
  assert.equal(got.length, 1);
  delete process.env.SLACK_BOT_TOKEN;
});

test('paste adapter keeps time unknown and records attachment names', () => {
  const [e] = parsePaste({ text: 'Barrier code is with the duty manager', attachmentNames: ['photo.jpg'] }, opts);
  assert.equal(e!.provider, 'paste');
  assert.equal(e!.connectionId, 'paste:desktop');
  assert.equal(e!.eventTime.known, false);
  assert.equal(e!.attachments?.[0]?.name, 'photo.jpg');
});

test('connection cards are honest about status', () => {
  const cards = connectionCards();
  const by = Object.fromEntries(cards.map((c) => [c.id, c.status]));
  assert.equal(by['import:teams:file'], 'import-only');
  assert.equal(by['import:email:file'], 'import-only');
  assert.equal(by['jira'], 'planned');
  assert.ok(cards.some((c) => c.provider === 'slack' && c.status === 'awaiting-authorization'));
  assert.ok(!cards.some((c) => c.status === 'live-verified'));
});
