import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { Engine } from '../../../apps/service/engine.ts';
import { actionPhrase, basisCaseId, DEFAULT_PHRASES } from './index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const ELISA = join(ROOT, 'private/Elisa_SinceAI2026/ELISA_HIDDEN_KNOWLEDGE_EXAMPLE_2026');
const hasElisa = existsSync(join(ELISA, 'teams_chat.json')) && existsSync(join(ELISA, 'email.txt'));

const requester = { id: 'ent_bfc503c11994c003a9cd', displayName: 'Veikko Vikkelä', groups: [] as string[], type: 'human' as const };
const BAD = [/\s{2,}/, /\bundefined\b/i, /\bnull\b/i, /\(\s*\)/, /[{}]/, /\bNaN\b/, /\brollbacking\b/i, /\b(swaping|reseting)\b/i, /\b[a-z]+\.[a-z_]+\b/];

async function engine(): Promise<Engine> {
  const e = new Engine({ dbPath: ':memory:' });
  await e.resetDemo('elisa');
  return e;
}

test('elisa TRN-088: the heading and timeline follow the basis case and no repeat of the already-done action is advised', { skip: !hasElisa && 'private Elisa files absent' }, async () => {
  const eng = await engine();
  const r = await eng.investigate({ text: 'At site now. Replaced the SFP on TRN-088, an older unit from 2018. Link is up, alarms cleared, RX power normal, but no traffic. Counters zero.', principal: requester, allowQuestions: true });
  const id = basisCaseId(r.state);
  const basis = id ? eng.store.get('case', id) : undefined;
  assert.ok(basis);
  assert.equal(r.caseView?.title, basis.title, 'ResultView.caseView is the recommendation basis case');
  const text = [r.recommendation.text, r.recommendation.nextStep ?? '', ...r.recommendation.caveats].join(' ');
  assert.doesNotMatch(r.recommendation.text, /^Consider replacing the SFP/i, 'must not tell the requester to repeat the SFP replacement they just did');
  assert.doesNotMatch(text, /\b(consider|try) (replacing|to replace) the SFP/i);
  assert.match(r.recommendation.text, /^Check the traffic counters/);
  for (const line of [text, r.loopReason ?? '', ...r.people.flatMap((p) => p.reasons.map((x) => x.text))]) for (const re of BAD) assert.doesNotMatch(line, re, line);
});

test('elisa RBS-310 rectifier problem: text mentions only module/power items of its own case, caveats in plain words', async () => {
  const eng = await engine();
  const r = await eng.investigate({ text: 'RBS-310 is flapping again with DC low alarms after the rectifier work', principal: requester, allowQuestions: true });
  const lines = [r.recommendation.text, r.recommendation.nextStep ?? '', ...r.recommendation.caveats, ...r.people.flatMap((p) => p.reasons.map((x) => x.text)), r.loopReason ?? ''];
  for (const line of lines) {
    assert.doesNotMatch(line, /\bSFP\b|weak support|interface/i, line);
    assert.doesNotMatch(line, /\brecurred\b|\bmodule\.swap\b/, line);
    for (const re of BAD) assert.doesNotMatch(line, re, line);
  }
  const reasons = r.people.map((p) => p.reasons.map((x) => x.text));
  for (const rs of reasons) assert.equal(new Set(rs).size, rs.length, `a person's reasons are unique: ${rs.join(' | ')}`);
  assert.ok(!r.people.some((p) => p.reasons.some((x) => /performed the module swap and reported recovery/i.test(x.text))), 'a recurred outcome is not "recovery"');
});

test('phrases: noun-only compound verbs read as two-word verbs', () => {
  assert.equal(actionPhrase('config.rollback', DEFAULT_PHRASES).gerund, 'rolling back the config');
  const fb = actionPhrase('cable.rollback', { actions: {} });
  assert.equal(fb.gerund, 'rolling back the cable');
  assert.equal(fb.past, 'rolled back the cable');
  assert.equal(actionPhrase('module.swap', { actions: {} }).gerund, 'swapping the module');
});
