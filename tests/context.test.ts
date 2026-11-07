import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ROOT, SCENARIOS, startService, type Running } from './support.ts';

/** B1: GET /context over HTTP (with access, like every other read) and `at` on kt_investigate / kt_get_context over MCP. */
const FOLLOWUPS = join(ROOT, 'data', 'demo', 'followups');
const ACCESS_EMAIL = readFileSync(join(SCENARIOS, 'remote-power-access', 'sources', 'email-01.txt'), 'utf8');
const NEW_EMAIL = readFileSync(join(FOLLOWUPS, 'email-eino-barrier.txt'), 'utf8');
const DIRECTORY = {
  people: [
    { id: 'person:directory:eino-salo', name: 'Eino Salo', role: 'Site Access Coordinator', groups: ['access'], actorIds: ['person:email:eino.salo@kalevanet.example'], available: true },
    { id: 'person:directory:pirkko-laine', name: 'Pirkko Laine', role: 'Regional Team Lead', groups: ['field'], actorIds: ['person:email:pirkko.laine@kalevanet.example'], available: true },
  ],
};
const THREAD = {
  channel: 'teams-ctx',
  messages: [
    { seq: 1, time: '09:14', author: 'Veikko Field', text: 'Changed the SFP on transmission node TRN-778. Link is up and alarms cleared, but traffic is still not coming back.' },
    { seq: 2, time: '09:16', author: 'Veikko Field', text: 'It is one of the older units, installed around 2018 I think.' },
    { seq: 3, time: '09:19', author: 'Erkki Expert', text: 'Check whether the traffic counters are actually increasing.' },
    { seq: 4, time: '09:21', author: 'Veikko Field', text: 'Link UP. RX power looks normal. Counters zero.' },
    { seq: 5, time: '09:22', author: 'Erkki Expert', text: 'Disable the interface, wait a little, then enable it again.' },
    { seq: 6, time: '09:25', author: 'Veikko Field', text: 'Did that. Traffic is back.' },
  ],
};
const NOTE = { channel: 'teams-ctx-note', messages: [{ seq: 1, time: '2026-10-14T10:05:00+03:00', author: 'Erkki Expert', text: 'TRN-778 follow-up: the 4.2 firmware fixes the forwarding-state bug.' }] };
const AGENT = { id: 'agent:test:context', displayName: 'Context agent', groups: [] as string[] };
const ON_42 = 'TRN-903 older unit on firmware 4.2: replaced the SFP, link up, counters zero, no traffic.';

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
  dir = mkdtempSync(join(tmpdir(), 'kt-ctx-'));
  const db = join(dir, 'kt.sqlite');
  svc = await startService({ dbPath: db });
  // The access e-mails are restricted to the 'access' group; the thread and the note are organization-wide.
  await svc.call('POST', '/import', { format: 'email-text', payload: ACCESS_EMAIL, accessGroups: ['access'], directory: DIRECTORY });
  await svc.call('POST', '/import', { format: 'email-text', payload: NEW_EMAIL, accessGroups: ['access'] });
  await svc.call('POST', '/import', { format: 'teams-json', payload: THREAD });
  await svc.call('POST', '/import', { format: 'teams-json', payload: NOTE });
  client = new Client({ name: 'kt-ctx', version: '0.0.0' });
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'src/apps/service/mcp.ts'), '--db', db, '--org-policy', 'none'], stderr: 'ignore' }));
});
after(async () => {
  await client.close();
  await svc.close();
  rmSync(dir, { recursive: true, force: true });
});

const codeRow = (view: any, code: string) => view.assertions.find((a: any) => a.statement === `RBS-310: barrier code ${code}`);

test('GET /context: both barrier codes with their windows, source, person and status; evaluated at `at`', async () => {
  const eino = encodeURIComponent('person:directory:eino-salo');
  const now = await svc.call('GET', `/context?entity=RBS-310&principalId=${eino}`);
  assert.equal(now.entity.name, 'RBS-310');
  const old = codeRow(now, '5802');
  const fresh = codeRow(now, '7731');
  assert.equal(old.status, 'superseded');
  assert.equal(old.supersededBy, fresh.claimId);
  assert.deepEqual([old.validFrom.kind, old.validFrom.iso, old.validFrom.raw], ['known', '2026-08-20T06:12:00.000Z', 'Wed, 20 Aug 2026 09:12:00 +0300']);
  assert.equal(old.validTo.iso, '2026-10-06T05:40:00.000Z');
  assert.equal(old.validityCondition, 'changes every October');
  assert.equal(old.orderBasis, 'known-time');
  assert.equal(old.validAt, false);
  assert.equal(fresh.validAt, true);
  assert.equal(fresh.assertedBy.displayName, 'Eino Salo');
  assert.equal(fresh.source.provider, 'email');
  assert.equal(fresh.source.time, '2026-10-06T05:40:00.000Z');
  assert.match(fresh.excerpt, /now 7731/);
  const sept = await svc.call('GET', `/context?entity=rbs-310&at=${encodeURIComponent('2026-09-01T00:00:00Z')}&principalId=${eino}`);
  assert.equal(sept.at, '2026-09-01T00:00:00Z');
  assert.equal(codeRow(sept, '5802').validAt, true, 'on 1 Sep the old code held');
  assert.equal(codeRow(sept, '7731').validAt, false, 'the new code is not valid before 6 Oct');
});

test('GET /context honours access: outside the group the site is unknown; bad input is a 400', async () => {
  await svc.call('GET', `/context?entity=RBS-310&principalId=${encodeURIComponent('person:directory:pirkko-laine')}`, undefined, 404);
  await svc.call('GET', '/context?entity=RBS-310', undefined, 404);
  await svc.call('GET', '/context?entity=RBS-310&at=yesterday&principalId=person:directory:eino-salo', undefined, 400);
  await svc.call('GET', '/context', undefined, 400);
});

test('GET /context for an undated asset: rows keep time-only positions (no iso), the note conditions the advice; bindings name people and hedged classes', async () => {
  const v = await svc.call('GET', '/context?entity=TRN-778');
  const advice = v.assertions.filter((a: any) => a.type === 'advice');
  assert.ok(advice.length >= 2);
  for (const a of advice) {
    assert.equal(a.validFrom.kind, 'time-only');
    assert.equal(a.validFrom.iso, undefined, 'never synthesised');
    assert.match(a.source.time, /date unknown/);
    assert.equal(a.validityCondition, 'software.version < 4.2');
    assert.equal(a.validAt, true);
  }
  const note = v.assertions.find((a: any) => a.validFrom.kind === 'known');
  assert.match(note.statement, /4\.2 firmware fixes/);
  assert.ok(v.bindings.some((b: any) => b.kind === 'firsthand' && b.entityName === 'Erkki Expert' && b.label === 'advised'));
  assert.ok(v.bindings.some((b: any) => b.kind === 'hedged-class' && /2018/.test(b.label)));
  const early = await svc.call('GET', `/context?entity=TRN-778&at=${encodeURIComponent('2026-10-01T00:00:00Z')}`);
  assert.equal(early.assertions.find((a: any) => a.claimId === note.claimId).validAt, false, 'the note is not valid before 14 Oct');
});

test('MCP: kt_investigate and kt_get_context accept `at`; the past view differs and asks nobody', async () => {
  const before = await tool('kt_investigate', { text: ON_42, principal: AGENT, at: '2026-10-01T00:00:00Z' });
  const nowR = await tool('kt_investigate', { text: ON_42, principal: AGENT });
  assert.equal(before.recommendation.kind, 'check-first');
  assert.equal(nowR.recommendation.kind, 'qualified');
  assert.equal(nowR.recommendation.caveats[0], 'Superseded on 14 Oct by Erkki Expert: fixed in firmware 4.2');
  const past = await tool('kt_get_context', { investigationId: nowR.investigationId, principal: AGENT, at: '2026-10-01T00:00:00Z' });
  assert.equal(past.investigationId, before.investigationId, 'the same problem at the same moment is the same investigation');
  assert.equal(past.recommendation.kind, 'check-first');
  assert.equal(past.question, undefined);
  const plain = await tool('kt_get_context', { investigationId: nowR.investigationId, principal: AGENT });
  assert.equal(plain.recommendation.kind, 'qualified', 'without at: the stored state');
  await assert.rejects(tool('kt_get_context', { investigationId: nowR.investigationId, principal: { ...AGENT, id: 'agent:other' }, at: '2026-10-01T00:00:00Z' }), /did not start/);
});
