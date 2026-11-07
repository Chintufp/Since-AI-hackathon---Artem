import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseTeamsJson } from '../connectors/index.ts';
import { assembleContexts } from '../context/index.ts';
import { defaultExtractionConfig } from './extraction-config.ts';
import { extractFromContext, splitSentences } from './extractor-rules.ts';

const chat = (msgs: Array<[string, string]>) =>
  assembleContexts(parseTeamsJson({ channel: 'c', messages: msgs.map(([author, text], i) => ({ seq: i + 1, time: `1${i}:00`, author, text })) }, { orgId: 'o' }))[0]!;

test('sentence splitter keeps offsets and version numbers intact', () => {
  const t = 'Version 4.2.1 is live. Counters basically zero!\n- second line here';
  const s = splitSentences(t);
  assert.deepEqual(s.map((x) => x.text), ['Version 4.2.1 is live.', 'Counters basically zero!', 'second line here']);
  for (const x of s) assert.equal(t.slice(x.start, x.end), x.text);
});

test('negation and uncertainty stay in the statement; hypotheses never become conditions', () => {
  const p = extractFromContext(chat([
    ['Ann', 'PUMP-7 is not delivering pressure after the seal swap.'],
    ['Bo', "I think it's probably the valve. Don't restart the pump unless the gauge drops."],
  ]));
  const hyp = p.claims.find((c) => c.type === 'hypothesis')!;
  assert.match(hyp.statement, /probably/);
  const adv = p.claims.find((c) => c.type === 'advice')!;
  assert.match(adv.statement, /^Don't restart/);
  assert.deepEqual((adv as { action?: Array<{ negated: boolean }> }).action?.map((a) => a.negated), [true]);
  assert.ok(!p.claims.some((c) => c.type === 'outcome'), 'a problem report is not an outcome');
});

test('configuration generalizes: other asset ids, aliases, lexicon and condition parsers', () => {
  const cfg = {
    ...defaultExtractionConfig,
    assetIdPatterns: [/\bPUMP-\d+\b/g],
    aliases: { 'PUMP-7': ['the north pump'] },
    conditionParsers: [
      ...defaultExtractionConfig.conditionParsers,
      { key: 'pressure.state', pattern: /\bpressure\s+(?:is\s+)?(low|normal)\b/i, build: (m: RegExpExecArray) => ({ operator: 'eq' as const, value: m[1]!.toLowerCase(), label: `Pressure ${m[1]!.toLowerCase()}` }) },
    ],
  };
  const ctx = chat([
    ['Ann', 'The north pump is not delivering. Pressure is low.'],
    ['Bo', 'Replace the seal.'],
    ['Ann', 'Did that. Pump works again.'],
  ]);
  const p = extractFromContext(ctx, cfg);
  assert.equal(p.incidents[0]!.key, 'asset:pump-7');
  assert.ok(p.entities.some((e) => e.name === 'PUMP-7'));
  assert.ok(p.claims.some((c) => c.condition?.key === 'pressure.state' && c.condition.value === 'low'));
  assert.ok(p.claims.some((c) => c.type === 'outcome'));
  // default config does not know the alias or the pump ids
  assert.equal(extractFromContext(ctx).entities.filter((e) => e.type === 'asset').length, 0);
});

test('incident boundaries: a different asset with its own problem statement is another incident', () => {
  const p = extractFromContext(chat([
    ['Ann', 'RTR-11 keeps failing after the update.'],
    ['Bo', 'Check the logs.'],
    ['Ann', 'Done. Traffic is back.'],
    ['Cy', 'Now RTR-22 is down and broken as well, different problem.'],
  ]));
  assert.deepEqual(p.incidents.map((i) => i.key), ['asset:rtr-11', 'asset:rtr-22']);
  assert.equal(p.incidents[0]!.evidenceIds.length, 3);
  // a mention of another asset without a problem statement stays in the incident
  const q = extractFromContext(chat([['Ann', 'RTR-11 keeps failing after the update.'], ['Bo', 'Same as RTR-22 last year, check the logs.']]));
  assert.equal(q.incidents.length, 1);
});

test('usefulness labels: small talk is irrelevant, knowledge-bearing messages are useful', () => {
  const p = extractFromContext(chat([
    ['Ann', 'Hi Bo, thanks for helping today!'],
    ['Ann', 'RTR-11 keeps failing after the update.'],
    ['Bo', 'Ok 👍'],
  ]));
  assert.deepEqual(p.usefulness.map((u) => u.label), ['irrelevant', 'useful', 'irrelevant']);
  assert.ok(p.usefulness.every((u) => u.reason.length > 0));
});

test('"I think" on a first-person fact is a hedge, not a hypothesis', () => {
  const p = extractFromContext(chat([['Ann', 'RTR-11 keeps failing.'], ['Bo', 'Which version?'], ['Ann', 'Version 2.3.4, installed around 2018 I think.']]));
  const c = p.claims.find((x) => x.condition?.key === 'unit.installed_year')!;
  assert.equal(c.type, 'condition');
  assert.equal(c.condition!.origin, 'reported');
  assert.match(c.statement, /I think/);
  assert.doesNotMatch(c.condition!.label!, /hedged/);
  assert.equal(c.condition!.label, 'Installed around 2018');
});

test('core logic contains no demo incident, telecom ids or person names (configuration only)', () => {
  const dir = dirname(fileURLToPath(import.meta.url));
  const banned = /TRN-042|Veikko|Erkki|Elisa/;
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.ts') && !x.endsWith('.test.ts'))) {
    assert.ok(!banned.test(readFileSync(join(dir, f), 'utf8')), `${f} mentions the demo scenario`);
  }
});
