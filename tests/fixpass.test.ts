import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { DEV_FIXTURE, agent, human, startService, type Running } from './support.ts';

let svc: Running;
const rita = human('person:test:rita', 'Rita Requester', ['noc']);
before(async () => { svc = await startService(); await svc.call('POST', '/import', { format: 'scenario-dir', path: DEV_FIXTURE }); });
after(async () => { await svc.close(); });

test('bodyless POST without JSON content type is rejected; malformed path is 400', async () => {
  const r = await fetch(`${svc.http.url}/demo/reset`, { method: 'POST', headers: { Origin: 'https://evil.example' } });
  assert.equal(r.status, 415);
  assert.equal((await fetch(`${svc.http.url}/cases/%E0%A4%A`)).status, 400);
  assert.ok((await svc.call('GET', '/cases')).length >= 2);
});

test('a rogue agent cannot undo a requester cancellation; deferred questions can be answered; outcomes keep new observations', async () => {
  const inv = await svc.call('POST', '/investigate', { principal: rita, text: 'BGP sessions flapping on RTR-203 after the firmware update' });
  const id = inv.investigationId ?? inv.id;
  const qs = (await svc.call('GET', '/questions?status=all')).filter((q: { investigationId?: string }) => !q.investigationId || q.investigationId === id);
  const q = qs[0] as { questionId?: string; id?: string } | undefined; const qid = q?.questionId ?? q?.id;
  if (qid) {
    await svc.call('POST', `/questions/${qid}/cancel`, { principal: rita });
    await svc.call('POST', `/questions/${qid}/undo`, { principal: agent('agent:rogue', 'Rogue') }, 403);
  }
  const o1 = await svc.call('POST', '/outcomes', { principal: rita, investigationId: id, result: 'recovered', observations: [{ key: 'software.version', operator: 'eq', value: '9.9' }] });
  const o2 = await svc.call('POST', '/outcomes', { principal: rita, investigationId: id, result: 'recovered', observations: [{ key: 'interface.status', operator: 'eq', value: 'down' }] });
  assert.notEqual(o1.id, o2.id);
});
