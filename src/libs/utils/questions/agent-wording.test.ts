/** B7: an accepted agent wording replaces only the text of that gap's next question, and only while it still passes. */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InvestigationState, TraceEvent } from '../contracts/index.ts';
import { buildSyntheticStore, SYMPTOM_TEXT } from '../models/testing/fixtures.ts';
import { AGENT_WORDING_EVENT, AgentWordedGenerator, checkAgentWording, templateFor } from './agent-wording.ts';
import { makeHarness } from './testing/harness.ts';

const B2 = `Asset-B2: ${SYMPTOM_TEXT}`;

function propose(h: ReturnType<typeof makeHarness>, st: InvestigationState, gapId: string, text: string, accepted: boolean, at: string): InvestigationState {
  const e: TraceEvent = { id: `evt-${at}`, at, type: AGENT_WORDING_EVENT, traceId: st.id, data: { gapId, text, accepted, by: 'agent:t', at } };
  h.store.put('trace', e);
  return h.store.put('investigation', { ...st, events: [...st.events, e] });
}

test('the wrapper uses an accepted wording, keeps the template\'s consequences, and says the agent worded it', async () => {
  const h = makeHarness(buildSyntheticStore());
  const st0 = await h.start('aw-1', B2);
  const gap = st0.gaps.find((g) => g.consequential && g.status === 'open')!;
  const t = (await templateFor(h.generator, st0, gap.id))!;
  assert.equal(t.candidate.text, 'Is Asset-B2 an older unit?');
  const ctx = { store: h.store, settings: h.settings, directory: { get: () => undefined, resolve: () => undefined, all: () => [] } as never, clock: h.clock };
  assert.equal(checkAgentWording(ctx, st0, t.facts, 'Is Asset-B2 one of the older units?').ok, true);
  assert.equal(checkAgentWording(ctx, st0, t.facts, 'Did Matti replace card X-9 on 14 October?').ok, false);
  const w = new AgentWordedGenerator({ inner: h.generator, templates: h.generator, ctx: { store: h.store, settings: h.settings, directory: ctx.directory, clock: h.clock } });
  assert.equal((await w.generate(st0, 4))[0]!.text, t.candidate.text, 'no proposal: the template');
  const st1 = propose(h, st0, gap.id, 'Is Asset-B2 one of the older units?', true, '2026-01-01T00:00:01Z');
  const st2 = propose(h, st1, gap.id, 'Did Matti replace card X-9 on 14 October?', false, '2026-01-01T00:00:02Z');
  const [c] = await w.generate(st2, 4);
  assert.equal(c!.text, 'Is Asset-B2 one of the older units?');
  assert.equal(c!.templateText, t.candidate.text);
  assert.deepEqual(c!.consequences, t.candidate.consequences);
  assert.equal(c!.dedupKey, t.candidate.dedupKey);
  assert.equal(c!.phrasing?.by, 'agent');
  assert.equal(c!.generatedBy.version, 'agent-worded@1');
  assert.equal(w.route.version, 'agent-worded@1');
});

test('the template sentence itself is not marked as agent-worded', async () => {
  const h = makeHarness(buildSyntheticStore());
  const st0 = await h.start('aw-2', B2);
  const gap = st0.gaps.find((g) => g.consequential && g.status === 'open')!;
  const st1 = propose(h, st0, gap.id, 'Is  Asset-B2 an older unit?', true, '2026-01-01T00:00:01Z');
  const w = new AgentWordedGenerator({ inner: h.generator, templates: h.generator, ctx: { store: h.store, settings: h.settings, directory: { get: () => undefined, resolve: () => undefined, all: () => [] } as never, clock: h.clock } });
  const [c] = await w.generate(st1, 4);
  assert.equal(c!.phrasing, undefined);
  assert.equal(c!.generatedBy.version, 'question-templates@1');
});
