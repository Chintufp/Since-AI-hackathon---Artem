import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { MCP_TOOLS } from '../src/libs/utils/contracts/index.ts';
import { DEV_FIXTURE, ROOT, startService, type Running } from './support.ts';

let dir: string;
let svc: Running;
let client: Client;
const AGENT = { id: 'agent:test:researcher', displayName: 'Research agent', groups: ['noc'] };
const TEXT = 'BGP sessions flapping on RTR-203 after the firmware update';

async function tool<T = any>(name: string, args: Record<string, unknown>): Promise<T> {
  const r = await client.callTool({ name, arguments: args });
  const first = (r.content as Array<{ type: string; text: string }>)[0]!;
  const parsed = JSON.parse(first.text);
  if (r.isError) throw new Error(`${name}: ${parsed.error}`);
  return parsed as T;
}

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'kt-mcp-'));
  const db = join(dir, 'kt.sqlite');
  svc = await startService({ dbPath: db });
  await svc.call('POST', '/import', { format: 'scenario-dir', path: DEV_FIXTURE });
  client = new Client({ name: 'kt-test', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'src/apps/service/mcp.ts'), '--db', db, '--org-policy', 'none'], stderr: 'ignore' }));
});
after(async () => {
  await client.close();
  await svc.close();
  rmSync(dir, { recursive: true, force: true });
});

test('lists the 8 contract tools, each with a meaning-bearing description', async () => {
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), Object.keys(MCP_TOOLS).sort());
  assert.equal(tools.length, 8);
  const inv = tools.find((t) => t.name === 'kt_investigate')!;
  assert.match(inv.description ?? '', /not (a )?verified|not adoption/i);
});

test('kt_investigate ids and views match the HTTP view of the same investigation', async () => {
  const r = await tool('kt_investigate', { text: TEXT, principal: AGENT });
  assert.match(r.investigationId, /^inv_/);
  assert.equal(r.ids.investigationId, r.investigationId);
  assert.equal(r.question, undefined, 'agents are not asking people unless they say so');
  const http = await svc.call('GET', `/investigations/${r.investigationId}?principalId=${encodeURIComponent(AGENT.id)}`);
  assert.equal(http.investigationId, r.investigationId);
  assert.equal(http.recommendation.kind, r.recommendation.kind);
  assert.deepEqual(http.state.decisionIds, r.ids.decisionIds);
  assert.deepEqual(http.state.questionIds, r.ids.questionIds);
  assert.deepEqual(http.state.gaps.map((g: { id: string }) => g.id), r.gaps.map((g: { id: string }) => g.id));
  // HTTP /investigate for the same agent text resolves to the same id as well.
  const viaHttp = await svc.call('POST', '/investigate', { text: TEXT, principal: { ...AGENT, type: 'agent' }, allowQuestions: false });
  assert.equal(viaHttp.investigationId, r.investigationId);
  const ctx = await tool('kt_get_context', { investigationId: r.investigationId, principal: AGENT });
  assert.equal(ctx.investigationId, r.investigationId);
});

test('kt_find_people equals GET /people; kt_record_outcome is visible through HTTP', async () => {
  const { investigationId } = await tool('kt_investigate', { text: TEXT, principal: AGENT });
  const people = await tool<Array<{ personEntityId: string }>>('kt_find_people', { investigationId, principal: AGENT });
  const http = await svc.call('GET', `/people?investigationId=${investigationId}&principalId=${encodeURIComponent(AGENT.id)}`);
  assert.deepEqual(people.map((p) => p.personEntityId), http.map((p: { personEntityId: string }) => p.personEntityId));
  assert.ok(people.length > 0);
  const rep = await tool('kt_record_outcome', { investigationId, result: 'partial', attemptedAction: 'logs.check', text: 'hold timer expired in logs', principal: AGENT });
  assert.equal(rep.investigationId, investigationId);
  assert.equal(rep.reporter.type, 'agent');
  const events = await svc.call('GET', `/events?traceId=${investigationId}`);
  assert.ok(events.some((e: { type: string }) => e.type === 'outcome.reported'));
  assert.equal(svc.engine.store.get('outcomeReport', rep.id)?.investigationId, investigationId);
  const retry = await tool('kt_record_outcome', { investigationId, result: 'partial', attemptedAction: 'logs.check', text: 'hold timer expired in logs', principal: AGENT });
  assert.equal(retry.id, rep.id);
});

test('clarification: request, status, cancel match the HTTP question view', async () => {
  const { investigationId } = await tool('kt_investigate', { text: TEXT, principal: AGENT });
  const c = await tool('kt_request_clarification', { investigationId, principal: AGENT });
  assert.equal(c.status, 'question-open');
  const http = await svc.call('GET', `/questions/${encodeURIComponent(c.questionId)}`);
  assert.equal(http.investigationId, investigationId);
  assert.equal(http.text, c.text);
  const st = await tool('kt_clarification_status', { questionId: c.questionId, principal: AGENT });
  assert.equal(st.status, http.status);
  const cancelled = await tool('kt_cancel_clarification', { questionId: c.questionId, reason: 'found it myself', principal: AGENT });
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancelReason, 'agent');
  assert.equal((await svc.call('GET', `/questions/${encodeURIComponent(c.questionId)}`)).status, 'cancelled');
  // Another principal cannot touch it.
  await assert.rejects(tool('kt_clarification_status', { questionId: c.questionId, principal: { id: 'agent:other', displayName: 'Other', groups: ['noc'] } }), /did not start/);
});

test('kt_record_observation resolves a gap and returns the rebuilt investigation', async () => {
  const { investigationId } = await tool('kt_investigate', { text: 'BGP flaps after the firmware upgrade on RTR-203', principal: AGENT });
  const r = await tool('kt_record_observation', { investigationId, principal: AGENT, condition: { key: 'software.version', operator: 'eq', value: '4.2.1', label: 'Software 4.2.1' } });
  assert.equal(r.investigationId, investigationId);
  assert.ok(r.gaps.filter((g: { id: string }) => g.id.includes('software.version')).every((g: { status: string }) => g.status !== 'open'));
  await assert.rejects(tool('kt_get_context', { investigationId: 'inv_missing', principal: AGENT }), /Unknown investigation/);
});
