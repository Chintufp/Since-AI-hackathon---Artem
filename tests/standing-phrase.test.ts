/**
 * Integration review (D-INT-07, D-INT-12): B1's standing questions with B2's phrase model on local. A fake local
 * provider records every phrase call; nothing reaches Ollama.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { ModelProvider } from '../src/libs/utils/models/providers/index.ts';
import type { Principal, QuestionRecord } from '../src/libs/utils/contracts/index.ts';
import { Engine } from '../src/apps/service/engine.ts';
import { parseGapId } from '../src/libs/utils/investigation/index.ts';

const fix = (asset: string, channel: string, time: string) => ({ channel, messages: [{ seq: 1, time, author: 'Veikko Field', text: `Bounced the port on ${asset}.` }] });
const PROBLEM_061 = { channel: 'noc-alarms', messages: [{ seq: 1, time: '2026-11-07T09:40:00+02:00', author: 'Outi Heino', text: 'No traffic on TRN-061 again this morning. Link is up but the counters are zero.' }] };

interface Call { asset: string; timeoutMs: number }

function phraseEngine(reply: (prompt: string) => string) {
  const calls: Call[] = [];
  const local = {
    kind: 'local',
    async generateJson(_m: string, prompt: string, _s: unknown, o?: { timeoutMs?: number }) {
      calls.push({ asset: (/TRN-\d+/.exec(prompt) ?? ['?'])[0], timeoutMs: o?.timeoutMs ?? -1 });
      return { question: reply(prompt) };
    },
    async embed() { return []; },
    async generateText() { return ''; },
    async warm() {},
    async unload() {},
    async detect() { return { installed: true, running: true, version: '0.40.9', totalMemBytes: 24e9, freeDiskBytes: 300e9, models: [{ name: 'qwen3:8b', sizeBytes: 5.2e9, capabilities: ['completion'] }] }; },
  } as unknown as ModelProvider;
  const time = { iso: '2026-11-07T10:00:00.000Z' };
  const e = new Engine({ dbPath: ':memory:', clock: () => new Date(time.iso), standingGaps: { ask: true }, modelManager: { local } });
  e.putSettings({ models: { phrase: { provider: 'local', model: 'qwen3:8b' } } });
  return { e, time, calls };
}
const veikko = (e: Engine): Principal => {
  const d = e.directory().find((x) => x.name === 'Veikko Field')!;
  return { id: d.personEntityId, displayName: d.name, groups: d.groups, type: 'human' };
};
const standingQs = (e: Engine): QuestionRecord[] => e.store.list('question').filter((q) => q.candidate.origin === 'standing');
const kindOf = (q: QuestionRecord) => parseGapId(q.candidate.gapId)?.kind;
const flush = () => new Promise((r) => setImmediate(r));

test('phrase=local: pairing and missing-symptom questions keep the template wording and never reach the model (D-INT-07)', async () => {
  const { e, calls } = phraseEngine(() => 'Was TRN-061 bounced?');
  try {
    e.importData({ format: 'teams-json', payload: fix('TRN-061', 'field-log', '2026-11-07T08:05:00+02:00') });
    e.importData({ format: 'teams-json', payload: PROBLEM_061 });
    await flush();
    await e.upkeep();
    const qs = standingQs(e);
    assert.ok(qs.some((q) => kindOf(q) === 'pairing'), 'the pairing question was asked');
    for (const q of qs) {
      assert.ok(kindOf(q) === 'pairing' || kindOf(q) === 'missing-symptom');
      assert.equal(q.candidate.phrasing, undefined, 'no phrasing mark: the model was never asked');
      assert.equal(q.candidate.templateText, undefined);
    }
    assert.equal(q0(qs, 'pairing').candidate.text, 'Was the port bounce on TRN-061 for the no traffic problem reported this morning?', 'the computed "when" words stay');
    assert.deepEqual(calls, []);
  } finally {
    e.close();
  }
});
const q0 = (qs: QuestionRecord[], kind: string): QuestionRecord => qs.find((q) => kindOf(q) === kind)!;

test('phrase=local: a standing outcome question is phrased through the same validator (a reply that drops the action keeps the template)', async () => {
  for (const [reply, accepted] of [['Did the problem clear on TRN-062 right after the port bounce?', true], ['Did the problem clear on TRN-062?', false]] as const) {
    const { e, time, calls } = phraseEngine(() => reply);
    try {
      e.importData({ format: 'teams-json', payload: fix('TRN-062', 'field-log-2', '2026-11-07T08:30:00+02:00') });
      await flush();
      time.iso = '2026-11-08T07:00:00.000Z'; // 25 h after the fix: the outcome gap is due
      const asked = await e.upkeep();
      const q = asked.find((x) => kindOf(x) === 'outcome')!;
      assert.ok(q, 'the outcome question was asked');
      assert.equal(q.candidate.templateText ?? q.candidate.text, 'Did the problem clear right after the port bounce on TRN-062?');
      if (accepted) {
        assert.equal(q.candidate.text, reply);
        assert.deepEqual(q.candidate.phrasing, { by: 'model' });
      } else {
        assert.equal(q.candidate.text, 'Did the problem clear right after the port bounce on TRN-062?');
        assert.equal(q.candidate.phrasing?.by, 'template');
        assert.match(q.candidate.phrasing?.reason ?? '', /does not name the action/);
      }
      // One phrase call per question asked: the eligibility pre-check uses the templates (D-INT-12).
      assert.deepEqual(calls.map((c) => c.asset), ['TRN-062']);
    } finally {
      e.close();
    }
  }
});

test('an answer and the standing pass after it share one wiring, so one phrase budget per request (D-INT-12)', async () => {
  const { e, time, calls } = phraseEngine(() => 'Did the problem clear on TRN-062 right after the port bounce?');
  try {
    e.importData({ format: 'teams-json', payload: fix('TRN-062', 'a', '2026-11-07T08:30:00+02:00') });
    e.importData({ format: 'teams-json', payload: fix('TRN-063', 'b', '2026-11-07T08:40:00+02:00') });
    await flush();
    time.iso = '2026-11-08T07:00:00.000Z';
    await e.upkeep();
    const q = standingQs(e).find((x) => x.status === 'delivered')!;
    assert.ok(q);
    assert.equal(calls.length, 1, 'only the asked question was phrased; TRN-063 was checked with the templates');
    let wirings = 0;
    const self = e as unknown as { wiring: () => unknown };
    const orig = self.wiring.bind(e);
    self.wiring = () => { wirings++; return orig(); };
    await e.answer(q.id, { principal: veikko(e), value: 'yes' });
    assert.equal(wirings, 1, 'askStanding reuses the answer request\'s wiring (and its PhrasedQuestionGenerator budget)');
    assert.equal(calls.length, 1, 'no new standing question was asked, so the model was not called again');
  } finally {
    e.close();
  }
});
