import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Engine } from '../../../apps/service/engine.ts';
import { createFakeSlack } from '../connectors/slack-fake.ts';
import { pullChannelReadOnly } from '../connectors/slack-live-pull.ts';
import { parseGapId, standingInvestigationId } from '../investigation/index.ts';

/** Film (8 Nov): the confirm standing gap. Synthetic Slack lines only; the fake workspace makes no network call. */
const LINES: Array<[string, string]> = [
  ['U1', 'TRN-418 at Kupittaa: link is up but no traffic since 08:40.'],
  ['U2', 'anyone up for lunch at 12?'],
  ['U1', 'Yes, older N5 unit, installed 2019.'],
  ['U2', 'Probably the v6 template cannot address the N5 port layout.'],
  ['U1', 'Applied the v7.1 patch on TRN-418.'],
];

async function run(confirmAfterEvidence?: number) {
  const e = new Engine({ dbPath: ':memory:', clock: () => new Date('2026-11-08T10:00:00.000Z'), standingGaps: { ask: true, ...(confirmAfterEvidence ? { confirmAfterEvidence } : {}) } });
  const slack = createFakeSlack({ team: { id: 'T1', name: 'Sandbox' }, channel: { id: 'C1', name: 'field-ops' }, users: [{ id: 'U1', real_name: 'Artem' }, { id: 'U2', real_name: 'Mark' }] });
  for (const [u, t] of LINES) slack.type(u, t);
  const pull = await pullChannelReadOnly(slack.read, { workspace: 'Sandbox', channel: '#field-ops', limit: 50 });
  e.importData({ format: 'slack-live', payload: pull.data, connectionId: 'slack-live:T1' });
  await new Promise((r) => setImmediate(r));
  return e;
}

test('confirm: off unless a threshold is set', async () => {
  const e = await run();
  assert.ok(!e.store.list('question').some((q) => parseGapId(q.candidate.gapId)?.kind === 'confirm'));
});

test('confirm: once enough messages support a symptom and a cause, the reporter is asked, phrased from the evidence; Yes supports the symptom; undo removes it', async () => {
  const e = await run(4);
  const qs = e.store.list('question').filter((x) => parseGapId(x.candidate.gapId)?.kind === 'confirm');
  assert.equal(qs.length, 1);
  const q = qs[0]!;
  assert.equal(parseGapId(q.candidate.gapId)?.kind, 'confirm');
  assert.equal(q.candidate.text, 'TRN-418 (older N5 unit): the v6 template cannot address the N5 port layout. Is that the problem?');
  const artem = e.directory().find((d) => d.name === 'Artem')!;
  assert.equal(q.personEntityId, artem.personEntityId, 'asked of the person who reported the problem');
  const principal = { id: artem.personEntityId, displayName: 'Artem', groups: [], type: 'human' as const };
  const r = await e.answer(q.id, { principal, value: 'yes' });
  const upd = r.answer.claimUpdates[0]!;
  assert.equal(upd.change, 'support');
  assert.ok(e.store.get('claim', upd.claimId)!.supporting.some((x) => x.evidenceId === r.answer.evidenceId));
  assert.ok(e.store.list('observation').some((o) => o.condition.key === 'case.confirmed' && o.condition.value === true));
  assert.ok(r.receipt.detail.includes('confirmed problem'));
  const st = e.store.get('investigation', standingInvestigationId(q.candidate.scope.caseId!))!;
  assert.equal(st.gaps.find((g) => g.id === q.candidate.gapId)!.status, 'resolved');
  await e.undo(q.id, { principal });
  assert.ok(!e.store.get('claim', upd.claimId)!.supporting.some((x) => x.evidenceId === r.answer.evidenceId));
  assert.ok(!e.store.list('observation').some((o) => o.condition.key === 'case.confirmed'));
});

test('confirm: never for history imports (only cases fed by a live connection)', async () => {
  const e = new Engine({ dbPath: ':memory:', clock: () => new Date('2026-11-08T10:00:00.000Z'), standingGaps: { ask: true, confirmAfterEvidence: 1 } });
  e.importData({ format: 'teams-json', payload: { channel: 'noc', messages: LINES.map(([u, text], i) => ({ seq: i + 1, time: `2026-11-07T08:0${i}:00+02:00`, author: u === 'U1' ? 'Artem' : 'Mark', text })) } });
  await new Promise((r) => setImmediate(r));
  assert.ok(!e.store.list('question').some((q) => parseGapId(q.candidate.gapId)?.kind === 'confirm'));
});
