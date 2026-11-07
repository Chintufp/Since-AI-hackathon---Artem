import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { installNetworkGuard } from '../models/routes.ts';
import {
  createFakeSlack, createSlackPoller, dmText, fileTracking, memoryTracking, pollerGuard, reactionValue, slackDmClient,
  DM_FOOTER, SLACK_DM_METHODS, SLACK_POLLER_SCOPES, SLACK_READ_METHODS, type ServiceLike,
} from './index.ts';

const TOKEN = 'xoxb-fake-poller-token-for-tests-only';
const TEAM = { id: 'T0SANDBOX', name: 'Kalevanet Sandbox' };

function fakeWorkspace() {
  return createFakeSlack({
    team: TEAM, channel: { id: 'C0FIELD001', name: 'field-ops' },
    users: [{ id: 'U101', real_name: 'Aarne Koskela' }, { id: 'U102', real_name: 'Helmi Virtanen' }, { id: 'U103', real_name: 'Tapio Lehto' }],
  });
}

interface FakeQ { questionId: string; personId: string; text: string; why: string; status: string; answer?: string }

/** A stand-in service: records imports and answers; refuses a different second answer with 409 like the engine. */
function fakeService(questions: FakeQ[]) {
  const imports: unknown[] = [];
  const answers: Array<{ id: string; body: any }> = [];
  const seen = new Set<string>();
  const err = (status: number, m: string) => Object.assign(new Error(m), { status });
  const svc: ServiceLike = {
    async get(path: string) {
      const u = new URL('http://x' + path);
      if (u.pathname === '/questions') {
        const pid = u.searchParams.get('personEntityId');
        const st = u.searchParams.get('status');
        return questions.filter((q) => q.personId === pid && (!st || q.status === st)) as any;
      }
      const m = /^\/questions\/(.+)$/.exec(u.pathname);
      if (m) {
        const q = questions.find((x) => x.questionId === decodeURIComponent(m[1]!));
        if (!q) throw err(404, 'unknown');
        return q as any;
      }
      throw err(404, path);
    },
    async post(path: string, body: any) {
      if (path === '/import') {
        imports.push(body);
        const msgs = body.payload.days[0].messages as Array<{ ts: string }>;
        const fresh = msgs.filter((x) => !seen.has(x.ts));
        fresh.forEach((x) => seen.add(x.ts));
        return { batch: { counts: { seen: msgs.length, inserted: fresh.length } }, cases: fresh.length ? 1 : 0 } as any;
      }
      const m = /^\/questions\/(.+)\/answer$/.exec(path);
      if (m) {
        const q = questions.find((x) => x.questionId === decodeURIComponent(m[1]!))!;
        if (body.principal.id !== `person:slack:${q.personId.replace('person:slack:', '')}` && body.principal.id !== q.personId) throw err(403, 'not the recipient');
        if (q.status === 'answered' && q.answer !== body.value) throw err(409, 'already answered');
        answers.push({ id: q.questionId, body });
        q.status = 'answered';
        q.answer = body.value;
        return {} as any;
      }
      throw err(404, path);
    },
  };
  return { svc, imports, answers };
}

const config = { workspace: TEAM.name, channel: '#field-ops', slackUserToPerson: { U102: { personId: 'person:slack:U102', displayName: 'Helmi Virtanen' } } };

test('write client: only chat.postMessage and reactions.get, refused before any fetch; the read allowlist stays read-only', async () => {
  const seen: Array<{ url: string; init: any }> = [];
  const fetchImpl = async (url: string, init: any) => { seen.push({ url, init }); return { json: async () => ({ ok: true, channel: 'D102', ts: '1.2' }) }; };
  const dm = slackDmClient(TOKEN, fetchImpl);
  await assert.rejects(() => dm.call('chat.delete' as any, {}), /not on the DM allowlist/);
  await assert.rejects(() => dm.call('conversations.open' as any, {}), /not on the DM allowlist/);
  await assert.rejects(() => dm.call('reactions.add' as any, {}), /not on the DM allowlist/);
  assert.equal(seen.length, 0);
  await dm.call('chat.postMessage', { channel: 'U102', text: 'hi' });
  assert.equal(seen[0]!.init.method, 'POST');
  assert.equal(seen[0]!.init.headers.Authorization, `Bearer ${TOKEN}`);
  assert.ok(!seen[0]!.url.includes(TOKEN));
  await dm.call('reactions.get', { channel: 'D102', timestamp: '1.2' });
  assert.equal(seen[1]!.init.method, 'GET');
  assert.ok(!(SLACK_READ_METHODS as readonly string[]).some((m) => (SLACK_DM_METHODS as readonly string[]).includes(m)), 'the read allowlist never gains a write method');
  assert.deepEqual([...SLACK_POLLER_SCOPES].sort(), ['channels:history', 'channels:read', 'chat:write', 'groups:history', 'groups:read', 'reactions:read', 'users:read']);
  assert.throws(() => slackDmClient(''), /token is required/);
});

test('guard: refuses without KT_SLACK_LIVE=1, a token, a workspace or a channel; never echoes the token', () => {
  const none = pollerGuard({});
  assert.equal(none.ok, false);
  assert.equal(none.missing.length, 4);
  assert.equal(pollerGuard({ token: TOKEN, workspace: 'X', channel: '#c' }).ok, false);
  assert.equal(pollerGuard({ live: '1', workspace: 'X', channel: '#c' }).ok, false);
  assert.equal(pollerGuard({ live: '1', token: TOKEN, channel: '#c' }).ok, false);
  const ok = pollerGuard({ live: '1', token: TOKEN, workspace: 'X', channel: '#c' });
  assert.equal(ok.ok, true);
  assert.ok(!JSON.stringify([none, ok]).includes(TOKEN));
  assert.match(ok.instructions.join(' '), /chat:write, reactions:read/);
});

test('reaction names and DM text', () => {
  assert.equal(reactionValue('+1'), 'yes');
  assert.equal(reactionValue('+1::skin-tone-4'), 'yes');
  assert.equal(reactionValue('thumbsup'), 'yes');
  assert.equal(reactionValue('-1::skin-tone-2'), 'no');
  assert.equal(reactionValue('shrug'), 'unknown');
  assert.equal(reactionValue('tada'), undefined);
  const t = dmText({ text: 'Is TRN-205 one of the older units?', why: 'The reset only helped on older units.\nMore detail' });
  assert.deepEqual(t.split('\n'), ['Is TRN-205 one of the older units?', 'Why: The reset only helped on older units.', DM_FOOTER]);
});

test('poll: channel imported under one stable connection; a delivered question is DM\'d once; queued ones wait', async () => {
  const restore = installNetworkGuard();
  try {
    const slack = fakeWorkspace();
    const qs: FakeQ[] = [
      { questionId: 'q1', personId: 'person:slack:U102', text: 'Is TRN-205 one of the older units?', why: 'Older units need the reset.', status: 'delivered' },
      { questionId: 'q2', personId: 'person:slack:U102', text: 'Held by quiet hours', why: '', status: 'queued' },
    ];
    const { svc, imports } = fakeService(qs);
    const poller = createSlackPoller({ read: slack.read, dm: slack.dm, service: svc, config });
    slack.type('U101', 'Changed the SFP on TRN-205. Link is up, but traffic is not coming back.');
    const r1 = await poller.pollOnce();
    assert.deepEqual(r1.errors, []);
    assert.deepEqual(r1.imported, { seen: 1, inserted: 1, cases: 1 });
    assert.equal((imports[0] as any).connectionId, 'slack-live:T0SANDBOX');
    assert.equal((imports[0] as any).format, 'slack-live');
    assert.deepEqual(r1.dmsSent, [{ questionId: 'q1', slackUserId: 'U102' }]);
    assert.equal(slack.dms.length, 1);
    assert.equal(slack.dms[0]!.user, 'U102');
    assert.match(slack.dms[0]!.text, /^Is TRN-205 one of the older units\?\nWhy: Older units need the reset\.\nReact 👍 yes/);
    const r2 = await poller.pollOnce();
    assert.deepEqual(r2.imported, { seen: 1, inserted: 0, cases: 0 });
    assert.equal(slack.dms.length, 1, 'never DM\'d twice');
    assert.ok(slack.calls.every((c) => c.side === 'dm' ? (SLACK_DM_METHODS as readonly string[]).includes(c.method) : (SLACK_READ_METHODS as readonly string[]).includes(c.method)));
  } finally {
    restore();
  }
});

test('reactions: only the recipient counts; 👍 answers yes once; a later flip is ignored; 🤷 answers unknown', async () => {
  const slack = fakeWorkspace();
  const qs: FakeQ[] = [
    { questionId: 'q1', personId: 'person:slack:U102', text: 'First?', why: '', status: 'delivered' },
  ];
  const { svc, answers } = fakeService(qs);
  const poller = createSlackPoller({ read: slack.read, dm: slack.dm, service: svc, config });
  await poller.pollOnce();
  const dm = slack.react('U103', '+1'); // a colleague, not the recipient
  slack.react('UBOT', '-1', (d) => d === dm);
  assert.deepEqual((await poller.pollOnce()).answered, []);
  assert.equal(answers.length, 0);
  slack.react('U102', '+1::skin-tone-3', (d) => d === dm);
  const r = await poller.pollOnce();
  assert.deepEqual(r.answered, [{ questionId: 'q1', slackUserId: 'U102', value: 'yes' }]);
  assert.deepEqual(answers[0]!.body, { principal: { id: 'person:slack:U102', displayName: 'Helmi Virtanen', groups: [], type: 'human' }, value: 'yes' });
  slack.unreact('U102', '+1::skin-tone-3', dm);
  slack.react('U102', '-1', (d) => d === dm);
  await poller.pollOnce();
  assert.equal(answers.length, 1, 'a flipped reaction after the answer is ignored');
  assert.equal(poller.tracked().q1!.state, 'answered');

  qs.push({ questionId: 'q2', personId: 'person:slack:U102', text: 'Second?', why: '', status: 'delivered' });
  await poller.pollOnce();
  slack.react('U102', 'shrug');
  await poller.pollOnce();
  assert.equal(answers.at(-1)!.body.value, 'unknown');
});

test('reactions: 👍 and 👎 at once waits; a question answered in the panel or gone stops being tracked', async () => {
  const slack = fakeWorkspace();
  const qs: FakeQ[] = [
    { questionId: 'q1', personId: 'person:slack:U102', text: 'One?', why: '', status: 'delivered' },
    { questionId: 'q2', personId: 'person:slack:U102', text: 'Two?', why: '', status: 'delivered' },
  ];
  const { svc, answers } = fakeService(qs);
  const poller = createSlackPoller({ read: slack.read, dm: slack.dm, service: svc, config });
  await poller.pollOnce();
  const d1 = slack.react('U102', '+1', (d) => d.text.startsWith('One?'));
  slack.react('U102', '-1', (d) => d === d1);
  await poller.pollOnce();
  assert.equal(answers.length, 0);
  qs[1]!.status = 'answered'; // answered in the panel meanwhile
  const r = await poller.pollOnce();
  assert.deepEqual(r.closed.map((c) => c.questionId), ['q2']);
  assert.equal(poller.tracked().q2!.state, 'closed');
});

test('tracking survives a restart (file under a data/local-like folder): nothing is DM\'d twice', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kt-poller-'));
  try {
    const file = join(dir, 'local', 'slack-poller.json');
    const slack = fakeWorkspace();
    const { svc } = fakeService([{ questionId: 'q1', personId: 'person:slack:U102', text: 'One?', why: '', status: 'delivered' }]);
    await createSlackPoller({ read: slack.read, dm: slack.dm, service: svc, config, tracking: fileTracking(file) }).pollOnce();
    assert.equal(JSON.parse(readFileSync(file, 'utf8')).q1.ts, slack.dms[0]!.ts);
    await createSlackPoller({ read: slack.read, dm: slack.dm, service: svc, config, tracking: fileTracking(file) }).pollOnce();
    assert.equal(slack.dms.length, 1);
    assert.ok(!readFileSync(file, 'utf8').includes(TOKEN));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a stage failure is reported in words and the next stages still run', async () => {
  const slack = createFakeSlack({ team: { id: 'T0OTHER', name: 'Some Other Team' }, channel: { id: 'C0FIELD001', name: 'field-ops' }, users: [{ id: 'U102', real_name: 'Helmi Virtanen' }] });
  const { svc } = fakeService([{ questionId: 'q1', personId: 'person:slack:U102', text: 'One?', why: '', status: 'delivered' }]);
  const t = memoryTracking();
  const r = await createSlackPoller({ read: slack.read, dm: slack.dm, service: svc, config, tracking: t }).pollOnce();
  assert.match(r.errors[0]!, /^read channel: Workspace mismatch/);
  assert.equal(r.dmsSent.length, 1);
  assert.ok(t.records.q1);
});
