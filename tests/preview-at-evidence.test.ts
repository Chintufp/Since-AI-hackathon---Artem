/**
 * B3: the Context Layer slider's two additions to POST /investigate. `preview: true` computes the result and persists
 * nothing (no investigation record, no trace event, no question); `atEvidence` moves through an undated thread by an
 * evidence cutoff, without inventing a date for it. Runs on the synthetic demo store (no private files needed).
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { EvidenceEnvelope, EvidenceRef } from '../src/libs/utils/contracts/index.ts';
import { earliestDated, evidenceGate, gateAt } from '../src/libs/utils/retrieval/access.ts';
import { agent, human, startService, type Running } from './support.ts';

let svc: Running;
let thread: EvidenceEnvelope[];
const bot = agent('agent:test:slider', 'Slider agent');
const TEXT = 'TRN-117: replaced the SFP, link up, counters zero, no traffic.';

before(async () => {
  svc = await startService();
  await svc.call('POST', '/demo/reset', { seed: 'synthetic' });
  const store = svc.engine.store;
  const first = store.list('evidence').find((e) => e.text.includes('TRN-117') && e.eventTime.partial === 'time-only')!;
  thread = store.list('evidence').filter((e) => e.thread.threadId === first.thread.threadId).sort((a, b) => (a.eventTime.sequence ?? 0) - (b.eventTime.sequence ?? 0));
});
after(async () => svc.close());

const counts = () => {
  const s = svc.engine.store;
  return { inv: s.list('investigation').length, trace: s.list('trace').length, q: s.list('question').length, dec: s.list('decision').length };
};

test('a preview investigation is computed but persists nothing', async () => {
  const before0 = counts();
  const r = await svc.call('POST', '/investigate', { text: TEXT, principal: human('person:test:p', 'Pia Preview'), preview: true });
  assert.ok(r.recommendation.text.length > 0, 'the result is computed');
  assert.equal(svc.engine.store.get('investigation', r.investigationId), undefined, 'no investigation record');
  assert.deepEqual(counts(), before0, 'no investigation, trace, question or decision record');
  // A preview with a moment and a cutoff persists nothing either.
  await svc.call('POST', '/investigate', { text: TEXT, principal: bot, at: '2026-10-01T00:00:00Z', atEvidence: thread.at(-1)!.id, preview: true });
  assert.deepEqual(counts(), before0);
  // The same request without preview is stored (the control).
  const real = await svc.call('POST', '/investigate', { text: TEXT, principal: bot, allowQuestions: false });
  assert.ok(svc.engine.store.get('investigation', real.investigationId));
  assert.ok(counts().inv > before0.inv);
});

test('atEvidence: before the advice the agent is told nothing; after the outcome it reuses the fix', async () => {
  const told = async (ev: EvidenceEnvelope) =>
    (await svc.call('POST', '/investigate', { text: TEXT, principal: bot, at: '2026-10-01T00:00:00Z', atEvidence: ev.id, allowQuestions: false, preview: true })).recommendation;
  const early = await told(thread[0]!);
  assert.equal(early.kind, 'none', `first message: ${early.text}`);
  const late = await told(thread.at(-1)!);
  assert.equal(late.kind, 'reuse', `last message: ${late.text}`);
  assert.match(late.text, /interface/);
  // Unknown evidence ids are refused.
  await svc.call('POST', '/investigate', { text: TEXT, principal: bot, atEvidence: 'ev_nope', preview: true }, 400);
});

test('gateAt with atEvidence: same thread up to the cutoff; every other thread hidden, dated or not', () => {
  const store = svc.engine.store;
  const base = evidenceGate(store, { id: 'x', groups: [] });
  const cutAt = thread[3]!;
  const g = gateAt(store, base, Date.parse('2026-10-01T00:00:00Z'), cutAt.id);
  const ref = (e: EvidenceEnvelope): EvidenceRef => ({ evidenceId: e.id });
  assert.deepEqual(thread.map((e) => g.ref(ref(e))), thread.map((_, i) => i <= 3));
  const otherUndated = store.list('evidence').find((e) => !e.eventTime.known && e.thread.threadId !== cutAt.thread.threadId && base.ref(ref(e)));
  assert.ok(otherUndated);
  assert.equal(g.ref(ref(otherUndated)), false, 'undated evidence of another thread is not visible');
  const dated = store.list('evidence').filter((e) => e.eventTime.known && e.eventTime.iso && base.ref(ref(e)));
  const earlier = dated.find((e) => Date.parse(e.eventTime.iso!) <= Date.parse('2026-10-01T00:00:00Z'));
  const later = dated.find((e) => Date.parse(e.eventTime.iso!) > Date.parse('2026-10-01T00:00:00Z'));
  assert.ok(earlier && later);
  // Review: a moment inside an undated thread cannot be ordered against dated sources of other threads either.
  assert.equal(g.ref(ref(earlier)), false, 'dated evidence of another thread before at is not visible');
  assert.equal(g.ref(ref(later)), false, 'dated evidence after at is not');
  // Without the cutoff, dated evidence follows at (B1).
  assert.equal(gateAt(store, base, Date.parse('2026-10-01T00:00:00Z')).ref(ref(earlier)), true);
  // Without the cutoff, B1's rule: every undated item is visible.
  assert.equal(gateAt(store, base, Date.parse('2026-10-01T00:00:00Z')).ref(ref(otherUndated)), true);
});

test('review: atEvidence the requester may not see is refused exactly like an unknown id (no existence oracle)', async () => {
  const store = svc.engine.store;
  const ev = thread[0]!;
  // Restrict one copy of the thread's first message to a group the requester lacks.
  const hidden = { ...ev, id: `${ev.id}_restricted`, accessScope: { visibility: 'group' as const, groups: ['nobody-has-this'] } };
  store.put('evidence', hidden);
  const outsider = human('person:test:o', 'Olli Outsider');
  const unknown = await svc.call('POST', '/investigate', { text: TEXT, principal: outsider, atEvidence: 'ev_nope', preview: true }, 400);
  const restricted = await svc.call('POST', '/investigate', { text: TEXT, principal: outsider, atEvidence: hidden.id, preview: true }, 400);
  assert.equal(String(restricted.error ?? restricted.message ?? '').replace(hidden.id, 'X'), String(unknown.error ?? unknown.message ?? '').replace('ev_nope', 'X'));
  await svc.call('POST', '/investigate', { text: TEXT, principal: { ...outsider, groups: ['nobody-has-this'] }, atEvidence: hidden.id, preview: true });
});

test('review: earliestDated is the first dated source the gate lets through; without at a cutoff reads just before it', async () => {
  const store = svc.engine.store;
  const base = evidenceGate(store, { id: 'x', groups: [] });
  const first = earliestDated(store, base);
  const dated = store.list('evidence').filter((e) => e.eventTime.known && e.eventTime.iso && base.ref({ evidenceId: e.id })).map((e) => Date.parse(e.eventTime.iso!));
  assert.equal(first, Math.min(...dated));
  // Without at, the cutoff alone gives the same answer as at = 1 ms before the first dated source.
  const a = await svc.call('POST', '/investigate', { text: TEXT, principal: bot, atEvidence: thread.at(-1)!.id, allowQuestions: false, preview: true });
  const b = await svc.call('POST', '/investigate', { text: TEXT, principal: bot, at: new Date(first! - 1).toISOString(), atEvidence: thread.at(-1)!.id, allowQuestions: false, preview: true });
  assert.equal(a.investigationId, b.investigationId, 'the same moment, so the same problem id');
  assert.deepEqual(a.recommendation, b.recommendation);
});
