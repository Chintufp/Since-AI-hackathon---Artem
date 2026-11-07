import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { DEV_FIXTURE, ROOT, agent, human, startService, type Running } from './support.ts';

const TEXT = 'BGP sessions flapping on RTR-117 after the firmware update';
const RESTRICTED_MARKER = /hold[- ]timer/i;
const insiderGroups = ['core'];
const outsiderGroups = ['field'];

let dir: string;
let svc: Running;
let client: Client;

async function tool<T = any>(name: string, args: Record<string, unknown>): Promise<T> {
  const r = await client.callTool({ name, arguments: args });
  const parsed = JSON.parse((r.content as Array<{ text: string }>)[0]!.text);
  if (r.isError) throw new Error(`${name}: ${parsed.error}`);
  return parsed as T;
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'kt-perm-'));
  const db = join(dir, 'kt.sqlite');
  svc = await startService({ dbPath: db });
  // The whole chat is restricted to the 'core' group.
  await svc.call('POST', '/import', { format: 'teams-json', path: join(DEV_FIXTURE, 'teams.json'), accessGroups: insiderGroups });
  client = new Client({ name: 'kt-perm', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'src/apps/service/mcp.ts'), '--db', db], stderr: 'ignore' }));
});
after(async () => {
  await client.close();
  await svc.close();
  rmSync(dir, { recursive: true, force: true });
});

test('HTTP: a principal outside the access group gets no restricted candidates or people', async () => {
  const inside = await svc.call('POST', '/investigate', { text: TEXT, principal: human('person:test:in', 'Ines Insider', insiderGroups), allowQuestions: false });
  assert.ok(inside.matches.length > 0 && inside.people.length > 0, 'the group member sees the case and its people');
  assert.match(JSON.stringify(inside), RESTRICTED_MARKER, 'the marker really is in the restricted content, so its absence below means something');
  const outside = await svc.call('POST', '/investigate', { text: TEXT, principal: human('person:test:out', 'Otto Outsider', outsiderGroups), allowQuestions: false });
  assert.deepEqual(outside.matches, []);
  assert.deepEqual(outside.people, []);
  assert.equal(outside.recommendation.kind, 'none');
  assert.equal(outside.caseView, undefined);
  assert.doesNotMatch(JSON.stringify(outside), RESTRICTED_MARKER);
  assert.deepEqual(await svc.call('GET', '/cases'), [], 'listing without a principal shows only organization-wide cases');
  const id = inside.investigationId;
  await svc.call('GET', `/investigations/${id}?principalId=person:test:out`, undefined, 403);
  await svc.call('GET', `/people?investigationId=${id}&principalId=person:test:out`, undefined, 403);
  await svc.call('POST', '/contact-draft', { principal: human('person:test:out', 'Otto Outsider', outsiderGroups), investigationId: id, personEntityId: inside.people[0].personEntityId }, 403);
  await svc.call('POST', '/observations', { principal: human('person:test:out', 'Otto Outsider', outsiderGroups), investigationId: id, condition: { key: 'software.version', operator: 'eq', value: '1' } }, 403);
});

test('MCP: the same rules hold for an agent outside the access group', async () => {
  const inside = await tool('kt_investigate', { text: TEXT, principal: { id: 'agent:in', displayName: 'Inside agent', groups: insiderGroups } });
  assert.ok(inside.matches.length > 0 && inside.people.length > 0);
  const outside = await tool('kt_investigate', { text: TEXT, principal: { id: 'agent:out', displayName: 'Outside agent', groups: outsiderGroups } });
  assert.deepEqual(outside.matches, []);
  assert.deepEqual(outside.people, []);
  assert.equal(outside.recommendation.kind, 'none');
  assert.doesNotMatch(JSON.stringify(outside), RESTRICTED_MARKER);
  const people = await tool('kt_find_people', { investigationId: outside.investigationId, principal: { id: 'agent:out', displayName: 'Outside agent', groups: outsiderGroups } });
  assert.deepEqual(people, []);
  await assert.rejects(tool('kt_get_context', { investigationId: inside.investigationId, principal: { id: 'agent:out', displayName: 'Outside agent', groups: outsiderGroups } }), /did not start/);
  await assert.rejects(tool('kt_find_people', { investigationId: inside.investigationId, principal: { id: 'agent:out', displayName: 'Outside agent', groups: outsiderGroups } }), /did not start/);
  // The default (group-less) agent is an outsider too.
  const dflt = await tool('kt_investigate', { text: TEXT });
  assert.deepEqual(dflt.people, []);
});

test('MCP and HTTP agree: identical principal and text give identical recommendation and people', async () => {
  const a = { id: 'agent:same', displayName: 'Same', groups: insiderGroups };
  const viaMcp = await tool('kt_investigate', { text: TEXT, principal: a });
  const viaHttp = await svc.call('POST', '/investigate', { text: TEXT, principal: { ...a, type: 'agent' }, allowQuestions: false });
  assert.equal(viaHttp.investigationId, viaMcp.investigationId);
  assert.equal(viaHttp.recommendation.kind, viaMcp.recommendation.kind);
  assert.deepEqual(viaHttp.people.map((p: { personEntityId: string }) => p.personEntityId), viaMcp.people.map((p: { personEntityId: string }) => p.personEntityId));
});

test('question limits apply to an agent: a cancelled question does not free the person from cooldown', async () => {
  const a = { id: 'agent:asker', displayName: 'Asker', groups: insiderGroups };
  const { investigationId } = await tool('kt_investigate', { text: TEXT, principal: a });
  const first = await tool('kt_request_clarification', { investigationId, principal: a });
  assert.equal(first.status, 'question-open');
  const again = await tool('kt_request_clarification', { investigationId, principal: a });
  assert.equal(again.questionId, first.questionId, 'a second request never opens a second question');
  await tool('kt_cancel_clarification', { questionId: first.questionId, principal: a });
  const second = await tool('kt_request_clarification', { investigationId, principal: a });
  assert.equal(second.status, 'deferred');
  assert.match(second.reason, /cooldown|budget/);
  assert.equal(second.questionId, undefined);
});

test('question limits apply identically over HTTP: per-person daily limit holds across investigations', async () => {
  const limited = await startService({ coordinator: { dailyLimitPerPerson: 1, cooldownMinutes: 0 } });
  try {
    await limited.call('POST', '/import', { format: 'scenario-dir', path: DEV_FIXTURE });
    const asked: string[] = [];
    const texts = [TEXT, `${TEXT}, second unit`, `${TEXT}, third unit`, `${TEXT}, fourth unit`];
    for (const [i, text] of texts.entries()) {
      const p = i % 2 === 0 ? human(`person:t:${i}`, `Requester ${i}`, []) : agent(`agent:t:${i}`, `Agent ${i}`, []);
      const r = await limited.call('POST', '/investigate', { text, principal: p });
      if (r.question) asked.push(limited.engine.store.get('question', r.question.questionId)!.personEntityId);
    }
    const counts = new Map<string, number>();
    for (const q of limited.engine.store.list('question')) if (q.deliveredAt) counts.set(q.personEntityId, (counts.get(q.personEntityId) ?? 0) + 1);
    assert.ok(asked.length > 0, 'at least one question was asked');
    assert.ok([...counts.values()].every((n) => n <= 1), `nobody is asked more than the daily limit: ${JSON.stringify([...counts])}`);
  } finally {
    await limited.close();
  }
});
