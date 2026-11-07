/** B7: request options are filters over the same loop; plan() writes nothing; a refused preference names who instead. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSyntheticStore, P, SYMPTOM_TEXT } from '../models/testing/fixtures.ts';
import { makeHarness } from './testing/harness.ts';

const B2 = `Asset-B2: ${SYMPTOM_TEXT}`;
const counts = (h: ReturnType<typeof makeHarness>) => ['decision', 'evaluation', 'eligibility', 'question'].map((t) => h.store.count(t as 'decision'));

test('dryRun and plan() write nothing and pick the same pair request() then asks', async () => {
  const h = makeHarness(buildSyntheticStore());
  const st = await h.start('p-dry', B2);
  const before = counts(h);
  const dry = await h.coordinator.request(st, { dryRun: true });
  const plan = await h.coordinator.plan(st);
  assert.deepEqual(counts(h), before, 'nothing stored by a dry run or a plan');
  assert.equal(dry.question, undefined);
  assert.notEqual(plan.chosen, 'defer');
  const real = await h.coordinator.request(st);
  assert.equal(real.question?.personEntityId, (plan.chosen as { personEntityId: string }).personEntityId);
  assert.equal(real.question?.personEntityId, P.site.entity);
});

test('a preferred person who is not a recipient is refused, with who would be asked instead; nothing is asked', async () => {
  const h = makeHarness(buildSyntheticStore());
  const st = await h.start('p-pref', B2);
  const before = counts(h);
  const r = await h.coordinator.request(st, { preferPersonEntityId: P.op.entity });
  assert.equal(r.question, undefined);
  assert.ok(r.refused);
  assert.ok(r.refused.violations.includes('not-answerable'));
  assert.equal(r.refused.wouldAsk?.personEntityId, P.site.entity);
  assert.equal(r.refused.wouldAsk?.text, 'Is Asset-B2 an older unit?');
  assert.deepEqual(counts(h), before, 'a refusal records no decision, eligibility or question');
  const ev = h.store.list('trace').filter((e) => e.traceId === st.id && e.type === 'clarification.refused');
  assert.equal(ev.length, 1);
});

test('a preferred person who is an eligible recipient is asked; gapId keeps only that gap', async () => {
  const h = makeHarness(buildSyntheticStore());
  const st = await h.start('p-pref-ok', B2);
  const gapId = st.gaps.find((g) => g.consequential && g.status === 'open')!.id;
  const r = await h.coordinator.request(st, { preferPersonEntityId: P.site.entity, gapId });
  assert.equal(r.question?.personEntityId, P.site.entity);
  assert.equal(r.question?.candidate.gapId, gapId);
  const none = await h.coordinator.plan(st, { gapId: 'gap|nope|missing|x|y' });
  assert.equal(none.candidates.length, 0);
  assert.equal(none.chosen, 'defer');
});

test('excludePersonIds drops a person; the per-person budget still applies to everyone', async () => {
  const h = makeHarness(buildSyntheticStore());
  const st = await h.start('p-excl', B2);
  const p = await h.coordinator.plan(st, { excludePersonIds: [P.site.entity] });
  assert.equal(p.chosen, 'defer');
  assert.ok(p.eligibility.some((e) => e.personEntityId === P.site.entity && e.eligible), 'still eligible by the gates, only excluded by the call');
});
