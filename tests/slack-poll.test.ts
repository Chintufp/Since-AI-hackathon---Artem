/**
 * B4 D2 end to end on a FAKE Slack workspace (nothing real is contacted): the poller against the running service.
 * The network guard is on for the whole test; only the service's own loopback origin is allowed.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createFakeSlack, createSlackPoller, type FakeSlack } from '../src/libs/utils/connectors/index.ts';
import { installNetworkGuard } from '../src/libs/utils/models/routes.ts';
import { httpClient } from '../src/libs/utils/simulation/client.ts';
import { DEV_FIXTURE, human, startService, type Running } from './support.ts';

const requester = human('person:test:requester', 'Rita Requester', ['noc']);
const PROBLEM = 'BGP sessions flapping on RTR-203 after the firmware update';

async function setup(): Promise<{ svc: Running; slack: FakeSlack; poller: ReturnType<typeof createSlackPoller>; restore: () => void }> {
  const svc = await startService();
  const restore = installNetworkGuard({ allowOrigins: [new URL(svc.http.url).origin] });
  await svc.call('POST', '/import', { format: 'scenario-dir', path: DEV_FIXTURE });
  const slack = createFakeSlack({
    team: { id: 'T0SANDBOX', name: 'Kalevanet Sandbox' }, channel: { id: 'C0FIELD001', name: 'field-ops' },
    users: [{ id: 'U01', real_name: 'Hanna Mäkelä' }, { id: 'U02', real_name: 'Olli Rautio' }, { id: 'U03', real_name: 'Jukka Salo' }],
  });
  const poller = createSlackPoller({
    read: slack.read, dm: slack.dm, service: httpClient(svc.http.url),
    config: {
      workspace: 'Kalevanet Sandbox', channel: '#field-ops',
      // Slack user -> person, as people.json actorIds give it ('person:slack:U…'); the service resolves the identity.
      slackUserToPerson: { U01: { personId: 'person:slack:U01', displayName: 'Hanna Mäkelä' }, U03: { personId: 'person:slack:U03', displayName: 'Jukka Salo' } },
    },
  });
  return { svc, slack, poller, restore };
}

test('a message typed in the sandbox channel becomes a case within one poll; a second poll inserts 0', async () => {
  const { svc, slack, poller, restore } = await setup();
  try {
    slack.type('U02', 'Changed the SFP on TRN-205. Link is up and alarms cleared, but traffic is not coming back.');
    const r1 = await poller.pollOnce();
    assert.deepEqual(r1.errors, []);
    assert.equal(r1.imported!.inserted, 1);
    const cases = await svc.call('GET', '/cases');
    assert.ok(cases.some((c: { title: string }) => /TRN-205/.test(c.title)), 'the typed message is a case');
    const ev = svc.engine.store.list('evidence').filter((e) => e.connectionId === 'slack-live:T0SANDBOX');
    assert.equal(ev.length, 1);
    assert.equal(ev[0]!.author.id, 'person:slack:U02');
    assert.equal(ev[0]!.eventTime.known, true);
    const r2 = await poller.pollOnce();
    assert.equal(r2.imported!.inserted, 0);
    assert.equal(svc.engine.store.list('evidence').filter((e) => e.connectionId === 'slack-live:T0SANDBOX').length, 1);
  } finally {
    restore();
    await svc.close();
  }
});

test('a delivered question is DM\'d once; a colleague\'s 👍 is ignored; the recipient\'s 👍 answers yes and changes the requester\'s next recommendation', async () => {
  const { svc, slack, poller, restore } = await setup();
  try {
    const before = await svc.call('POST', '/investigate', { text: PROBLEM, principal: requester });
    const qid = before.question.questionId as string;
    const q = svc.engine.store.get('question', qid)!;
    assert.equal(q.status, 'delivered');
    assert.ok(svc.engine.store.get('entity', q.personEntityId)!.actorIds!.includes('person:slack:U03'), 'the recipient is Slack user U03');
    assert.ok(before.recommendation.caveats.some((c: string) => /software version 4\.2\.1/.test(c)));

    await poller.pollOnce();
    await poller.pollOnce();
    assert.equal(slack.dms.length, 1, 'DM\'d exactly once');
    assert.equal(slack.dms[0]!.user, 'U03');
    assert.ok(slack.dms[0]!.text.startsWith(before.question.text));
    assert.match(slack.dms[0]!.text, /React 👍 yes · 👎 no · 🤷 not sure$/);

    slack.react('U01', '+1'); // someone else, not the recipient
    const ignored = await poller.pollOnce();
    assert.deepEqual(ignored.answered, []);
    assert.equal(svc.engine.store.get('question', qid)!.status, 'delivered');

    slack.react('U03', '+1');
    const r = await poller.pollOnce();
    assert.deepEqual(r.answered, [{ questionId: qid, slackUserId: 'U03', value: 'yes' }]);
    const stored = svc.engine.store.get('question', qid)!;
    assert.equal(stored.status, 'answered');
    const answer = svc.engine.store.get('answer', stored.answerId!)!;
    assert.equal(answer.value, 'yes');
    assert.equal(answer.personEntityId, q.personEntityId, 'attributed to the recipient person, not to a Slack-only identity');

    const after = await svc.call('POST', '/investigate', { text: PROBLEM, principal: requester });
    assert.notDeepEqual(after.recommendation, before.recommendation, 'the requester\'s next recommendation changed');
    assert.ok(!after.recommendation.caveats.some((c: string) => /software version 4\.2\.1/.test(c)), 'the answered fact is no longer unknown');

    // A flipped reaction after the answer is ignored.
    slack.react('U03', '-1', (d) => d === slack.dms[0]);
    await poller.pollOnce();
    assert.equal(svc.engine.store.get('answer', svc.engine.store.get('question', qid)!.answerId!)!.value, 'yes');
  } finally {
    restore();
    await svc.close();
  }
});

test('🤷 from the recipient records no fact: the requester\'s recommendation stays as it was', async () => {
  const { svc, slack, poller, restore } = await setup();
  try {
    const before = await svc.call('POST', '/investigate', { text: PROBLEM, principal: requester });
    const qid = before.question.questionId as string;
    const obsBefore = svc.engine.store.list('observation').length;
    await poller.pollOnce();
    slack.react('U03', 'shrug');
    const r = await poller.pollOnce();
    assert.deepEqual(r.answered.map((a) => a.value), ['unknown']);
    assert.equal(svc.engine.store.get('question', qid)!.status, 'answered');
    const after = await svc.call('GET', `/investigations/${before.investigationId}`);
    assert.deepEqual(after.recommendation, before.recommendation);
    assert.equal(svc.engine.store.list('observation').length, obsBefore);
    const updates = svc.engine.store.get('answer', svc.engine.store.get('question', qid)!.answerId!)!.claimUpdates;
    assert.ok(updates.every((u) => u.change === 'no-change'), 'Unknown makes no factual update');
  } finally {
    restore();
    await svc.close();
  }
});

test('with the network guard on, nothing but the local service is reached (a Slack URL would throw)', async () => {
  const { svc, poller, restore } = await setup();
  try {
    await poller.pollOnce();
    await assert.rejects(async () => fetch('https://slack.com/api/auth.test'), /blocked|network/i);
  } finally {
    restore();
    await svc.close();
  }
});
