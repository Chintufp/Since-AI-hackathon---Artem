import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { QuestionCandidate } from '../contracts/index.ts';
import type { ModelProvider } from '../models/providers/index.ts';
import { buildSyntheticStore, SYMPTOM_TEXT } from '../models/testing/fixtures.ts';
import { PhrasedQuestionGenerator, validatePhrase } from './generator-phrased.ts';
import { makeHarness } from './testing/harness.ts';
import { storeDirectory } from '../investigation/index.ts';

const BAD = [/\s{2,}/, /\bundefined\b/i, /\bnull\b/i, /\(\s*\)/, /[{}]/, /\s[?.,]/, /\bNaN\b/];
const PLANTED = 'Did Mikko replace the PSU on TRN-301 in 2020?';

function fake(answer: (prompt: string) => unknown) {
  const prompts: string[] = [];
  const p: Pick<ModelProvider, 'kind' | 'generateJson'> & { prompts: string[] } = {
    kind: 'local', prompts,
    async generateJson(_m, prompt) { prompts.push(prompt); return answer(prompt); },
  };
  return p;
}

async function setup(answer: (prompt: string) => unknown, problem = `TRN-301: ${SYMPTOM_TEXT}`) {
  const h = makeHarness(buildSyntheticStore());
  const provider = fake(answer);
  const failures: string[] = [];
  const g = new PhrasedQuestionGenerator({ inner: h.generator, ctx: { store: h.store, settings: h.settings, directory: storeDirectory(h.store), clock: h.clock }, provider, model: 'qwen3:8b', onFailure: (r) => failures.push(r) });
  const st = await h.start('p_phrase', problem);
  const template = (await h.generator.generate(st, 4)).filter((c) => c.kind === 'quick');
  const phrased = (await g.generate(st, 4)).filter((c) => c.kind === 'quick');
  return { h, g, provider, template, phrased, failures };
}

const scan = (c: QuestionCandidate): void => {
  for (const t of [c.text, c.rationale, c.consequences.yes, c.consequences.no]) for (const re of BAD) assert.doesNotMatch(t, re);
};

test('phrase validator: the planted hallucination is rejected (person, part, number, action not in the input)', () => {
  const check = { asset: 'TRN-301', conditionLabel: 'older unit revision, 2019', inputText: 'Is TRN-301 an older unit? older unit revision, 2019 holds for TRN-301', templateText: 'Is TRN-301 an older unit?' };
  assert.equal(validatePhrase(PLANTED, check).ok, false);
  assert.deepEqual(validatePhrase('Did Mikko see the older TRN-301 unit?', check), { ok: false, reason: 'introduces "Mikko"' });
  assert.deepEqual(validatePhrase('Is the older TRN-301 fitted with a PSU?', check), { ok: false, reason: 'introduces "PSU"' });
  assert.deepEqual(validatePhrase('Was TRN-301 an older unit in 2020?', check), { ok: false, reason: 'introduces the number 2020' });
  assert.deepEqual(validatePhrase('Was the older TRN-301 replaced?', check), { ok: false, reason: 'introduces the action "replaced"' });
  assert.deepEqual(validatePhrase('Is TRN-301 an older unit from 2019?', check), { ok: true });
  assert.deepEqual(validatePhrase('Is TRN-301 one of the older units?', check), { ok: true });
  // review probes: negation, lowercase names and places, number words, actions outside the stem list
  assert.deepEqual(validatePhrase('Is TRN-301 not an older unit?', check), { ok: false, reason: 'adds the negation "not"' });
  assert.deepEqual(validatePhrase("Isn't TRN-301 an older unit?", check).ok, false);
  assert.deepEqual(validatePhrase('Is TRN-301 never an older unit?', check), { ok: false, reason: 'adds the negation "never"' });
  assert.deepEqual(validatePhrase('Is TRN-301 an older unit at the helsinki site?', check), { ok: false, reason: 'introduces "helsinki"' });
  assert.deepEqual(validatePhrase('Is TRN-301 an older unit fixed by mikko?', check).ok, false);
  assert.deepEqual(validatePhrase('Is TRN-301 an older unit with twenty ports?', check), { ok: false, reason: 'introduces the number "twenty"' });
  assert.deepEqual(validatePhrase('Should TRN-301 an older unit be decommissioned?', check), { ok: false, reason: 'introduces "decommissioned"' });
  assert.deepEqual(validatePhrase('Should the older TRN-301 unit be escalated to the vendor?', check), { ok: false, reason: 'introduces "escalated"' });
  assert.deepEqual(validatePhrase('Is TRN-301 an older unit with a faulty power supply?', check).ok, false);
  // a negation the template has may stay; plain rewording with input words passes
  const negCheck = { ...check, inputText: `${check.inputText} Is TRN-301 not an older unit revision?`, templateText: 'Is TRN-301 not an older unit revision?' };
  assert.deepEqual(validatePhrase('Is TRN-301 not one of the older unit revisions?', negCheck), { ok: true });
  assert.deepEqual(validatePhrase('Is TRN-301 still one of the older revisions from 2019?', check), { ok: true });
  // shape rules
  assert.match((validatePhrase('TRN-301 is an older unit?', check) as { reason: string }).reason, /does not open a yes\/no question/);
  assert.match((validatePhrase('Is TRN-301 an older unit.', check) as { reason: string }).reason, /question mark/);
  assert.match((validatePhrase('Is it old? Is TRN-301 an older unit?', check) as { reason: string }).reason, /more than one sentence/);
  assert.match((validatePhrase(`Is TRN-301 an older unit ${'really '.repeat(30)}?`, check) as { reason: string }).reason, /characters/);
  assert.match((validatePhrase('Is TRN-302 an older unit?', check) as { reason: string }).reason, /does not name TRN-301|introduces TRN-302/);
  assert.match((validatePhrase('Is TRN-301 working fine?', check) as { reason: string }).reason, /does not name the condition/);
  // outcome questions name the action noun and the case label instead of a condition label
  const out = { asset: 'TRN-301', actionNoun: 'the SFP swap', caseLabel: 'TRN-042', inputText: 'Did traffic return right after the SFP swap on TRN-042?', templateText: 'Did traffic return right after the SFP swap on TRN-042?' };
  assert.deepEqual(validatePhrase('Did traffic come back right after the SFP swap on TRN-042?', out), { ok: true });
  assert.match((validatePhrase('Did traffic come back right after the swap?', out) as { reason: string }).reason, /does not name/);
});

test('phrased generator: a planted hallucination is rejected, the template text is used and the candidate says why', async () => {
  const { template, phrased, g, provider } = await setup(() => ({ question: PLANTED }));
  assert.ok(template.length >= 1);
  assert.equal(provider.prompts.length, template.length);
  assert.match(provider.prompts[0]!, /Question to reword: Is TRN-301 an older unit\?/);
  for (const [i, c] of phrased.entries()) {
    assert.equal(c.text, template[i]!.text);
    assert.deepEqual(c.consequences, template[i]!.consequences);
    assert.deepEqual(c.generatedBy, template[i]!.generatedBy);
    assert.equal(c.phrasing?.by, 'template');
    assert.match(c.phrasing!.reason!, /^model wording rejected: /);
    assert.equal(c.templateText, undefined);
    scan(c);
  }
  assert.equal(g.route.version, 'question-templates@1');
});

test('phrased generator: a good paraphrase is accepted, keeps consequences, dedup and recipients, and carries the template text', async () => {
  const { template, phrased, g } = await setup(() => ({ question: 'Is TRN-301 one of the older units?' }));
  const [t, p] = [template[0]!, phrased[0]!];
  assert.equal(p.text, 'Is TRN-301 one of the older units?');
  assert.equal(p.templateText, t.text);
  assert.deepEqual(p.consequences, t.consequences);
  assert.equal(p.dedupKey, t.dedupKey);
  assert.equal(p.id, t.id);
  assert.deepEqual(p.recipientIds, t.recipientIds);
  assert.deepEqual(p.generatedBy, { route: 'local', version: 'ollama-phrase@1:qwen3:8b' });
  assert.deepEqual(p.phrasing, { by: 'model' });
  assert.equal(g.route.version, 'ollama-phrase@1:qwen3:8b');
  scan(p);
});

test('phrased generator: a failing model falls back to the template, labels the route and reports the failure', async () => {
  const { template, phrased, g, failures } = await setup(() => { throw new Error('connect ECONNREFUSED'); });
  assert.equal(phrased[0]!.text, template[0]!.text);
  assert.match(phrased[0]!.phrasing!.reason!, /phrase model failed: connect ECONNREFUSED/);
  assert.equal(g.route.version, 'question-templates@1[fallback:phrase:error]');
  assert.equal(failures.length, template.length);
});

test('phrased generator: the prompt carries only what the requester may see of the case', async () => {
  const { provider } = await setup(() => ({ question: 'nope' }));
  const prompt = provider.prompts[0]!;
  assert.match(prompt, /Asset: TRN-301/);
  assert.match(prompt, /Earlier case: /);
  assert.doesNotMatch(prompt, /\bundefined\b/);
});

test('phrased generator: a model that returns the template sentence unchanged does not get the credit', async () => {
  const { template, phrased, g } = await setup(() => ({ question: 'Is TRN-301 an older unit?' }));
  assert.equal(phrased[0]!.text, template[0]!.text);
  assert.deepEqual(phrased[0]!.phrasing, { by: 'template', reason: 'the model kept the template wording' });
  assert.deepEqual(phrased[0]!.generatedBy, template[0]!.generatedBy);
  assert.equal(g.route.version, 'question-templates@1');
});
