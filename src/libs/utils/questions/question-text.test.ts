import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Condition, Principal, QuestionCandidate } from '../contracts/index.ts';
import { buildSyntheticStore, CASE_REF, P, personPrincipal, SYMPTOM_TEXT } from '../models/testing/fixtures.ts';
import type { InMemoryStore } from '../models/testing/in-memory-store.ts';
import { GENERIC_CONDITION_TEMPLATE } from './generator-templates.ts';
import { makeHarness } from './testing/harness.ts';

const site = (): Principal => personPrincipal(P.site, ['noc', 'field']);
const BAD = [/\s{2,}/, /\bundefined\b/i, /\bnull\b/i, /\(\s*\)/, /[{}]/, /\s[?.,]/, /\bNaN\b/];

function scan(c: Pick<QuestionCandidate, 'text' | 'rationale' | 'consequences'>, where: string): void {
  for (const [field, text] of Object.entries({ text: c.text, rationale: c.rationale, yes: c.consequences.yes, no: c.consequences.no })) {
    for (const re of BAD) assert.doesNotMatch(text, re, `${where}: ${field} "${text}" matches ${re}`);
    assert.equal(text, text.trim(), `${where}: ${field} has surrounding whitespace`);
  }
}

/** A case condition in the shapes real data produces: value present, value missing, other operators, blank label. */
const shapes: Array<[string, Partial<Condition>]> = [
  ['value present', {}],
  ['eq without value', { value: undefined as unknown as string }],
  ['value empty string', { value: '' }],
  ['present operator', { operator: 'present', value: undefined as unknown as string }],
  ['gte operator', { operator: 'gte', value: 2019 }],
];

function storeWith(over: Partial<Condition>): InMemoryStore {
  const s = buildSyntheticStore();
  const c = s.get('case', CASE_REF)!;
  s.put('case', { ...c, conditions: c.conditions.map((x) => (x.key === 'unit.age' ? ({ ...x, ...over } as Condition) : x)) });
  return s;
}

test('question text: no generated question has empty slots, double spaces, undefined, null or empty parentheses', async () => {
  let asked = 0;
  for (const [name, over] of shapes) {
    const h = makeHarness(storeWith(over));
    const st = await h.start(`p_${name.replace(/\W/g, '')}`, `Asset-B2: ${SYMPTOM_TEXT}`);
    const cands = await h.generator.generate(st, 8);
    for (const c of cands) {
      scan(c, name);
      asked++;
    }
    const r = await h.coordinator.request(st);
    if (r.question) {
      scan(r.question.candidate, `${name} (queued)`);
      // after an answer the rebuilt state yields questions too; none may have empty slots
      const res = await h.coordinator.answer(r.question.id, 'yes', site());
      for (const c of await h.generator.generate(res.state, 8)) scan(c, `${name} (after answer)`);
      const again = await h.coordinator.request(res.state);
      if (again.question) scan(again.question.candidate, `${name} (follow-up)`);
    }
  }
  assert.ok(asked >= shapes.length, `scanned ${asked} candidates`);
});

test('question text: a missing slot falls back to the generic template naming the unknown thing', async () => {
  const h = makeHarness(storeWith({ value: undefined as unknown as string }));
  const st = await h.start('p_fallback', `Asset-B2: ${SYMPTOM_TEXT}`);
  const [c] = await h.generator.generate(st, 4);
  assert.ok(c);
  assert.match(c.text, /^Is this true for Asset-B2: .+\?$/);
  assert.ok(GENERIC_CONDITION_TEMPLATE.includes('{asset}') && GENERIC_CONDITION_TEMPLATE.includes('{label}'));
});

test('question text: a filled slot keeps the specific wording', async () => {
  const h = makeHarness(buildSyntheticStore());
  const st = await h.start('p_specific', `Asset-B2: ${SYMPTOM_TEXT}`);
  const [c] = await h.generator.generate(st, 4);
  assert.equal(c?.text, 'Is Asset-B2 an older unit?');
});

test('question text: standing gaps (pairing, missing symptom, outcome after 24 h) have no empty slots either', async () => {
  const { Engine } = await import('../../../apps/service/engine.ts');
  const { parseGapId } = await import('../investigation/index.ts');
  const time = { iso: '2026-11-07T10:00:00.000Z' };
  const e = new Engine({ dbPath: ':memory:', clock: () => new Date(time.iso) });
  e.importData({ format: 'teams-json', payload: { channel: 'f1', messages: [{ seq: 1, time: '08:05', author: 'Veikko Field', text: 'Bounced the port on TRN-061.' }] } });
  e.importData({ format: 'teams-json', payload: { channel: 'f2', messages: [{ seq: 1, time: '2026-11-07T08:05:00+02:00', author: 'Veikko Field', text: 'Bounced the port on TRN-063.' }] } });
  e.importData({ format: 'teams-json', payload: { channel: 'p1', messages: [{ seq: 1, time: '2026-11-07T09:40:00+02:00', author: 'Outi Heino', text: 'No traffic on TRN-063 again this morning. Counters are zero.' }] } });
  time.iso = '2026-11-08T12:00:00.000Z';
  await e.upkeep();
  const h = makeHarness(e.store as unknown as InMemoryStore);
  const kinds = new Set<string>();
  for (const st of e.store.list('investigation').filter((s) => s.origin === 'standing')) {
    // every open standing gap, one at a time (the generator offers the most useful kind first)
    for (const g of st.gaps.filter((x) => x.status === 'open')) {
      for (const c of await h.generator.generate({ ...st, gaps: [g] }, 8)) {
        scan(c, `standing ${parseGapId(c.gapId)?.kind}`);
        kinds.add(parseGapId(c.gapId)?.kind as string);
      }
    }
  }
  assert.deepEqual([...kinds].sort(), ['missing-symptom', 'outcome', 'pairing']);
});
