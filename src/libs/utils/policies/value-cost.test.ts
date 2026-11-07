/**
 * Brief 5.3 (D-B2-67): questions ranked by value / cost within one investigation's candidates. The rules selector ranks
 * by the quantity the bandit's reward measures; LinUCB does not start from that order (D-B2-74).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { EligibleAction, InvestigationState, SelectorContext } from '../contracts/index.ts';
import { expectedGain, P_CONFIRM, type GainInput } from '../memory/store-health.ts';
import { actionKey, BURDEN, burdenOf, FEATURE_NAMES, questionCost, questionValue, RulesSelector, valuePerCost, vectorize } from './index.ts';

const clock = () => new Date('2026-11-07T12:00:00.000Z');
const state = { id: 'inv_t', orgId: 'org:t' } as InvestigationState;
const act = (q: string, p: string): EligibleAction => ({ questionId: q, personEntityId: p });
const ctx = (eligible: EligibleAction[], features: Record<string, Record<string, number>>): SelectorContext => ({ state, eligible, candidates: [], features });
const base = { consequential: 1, firsthand: 1, recipientOpenQuestions: 0, recipientAskedToday: 0, recency: 1, quietHours: 0 };
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-9, `${a} vs ${b}`);

test('cost = 1 + burden / BURDEN.open: the reward\'s burden term in units of one open question', () => {
  assert.equal(questionCost(base), 1);
  assert.equal(questionCost(undefined), 1);
  close(questionCost({ ...base, recipientAskedToday: 2 }), 3);
  close(questionCost({ ...base, recipientOpenQuestions: 1 }), 2);
  close(questionCost({ ...base, quietHours: 1 }), 1 + BURDEN.quiet / BURDEN.open);
  close(burdenOf({ ...base, recipientAskedToday: 1, recipientOpenQuestions: 1, quietHours: 1 }), BURDEN.askedToday + BURDEN.open + BURDEN.quiet);
});

test('value = consequential x p(answer) x expected gain x retrieval weight', () => {
  const f = { ...base, expectedGain: 0.02, retrievalWeight: 3 };
  close(questionValue(f), 0.06);
  assert.equal(questionValue({ ...f, consequential: 0 }), 0);
  close(questionValue({ ...f, firsthand: 0 }), 0.6 * 0.06);
  close(questionValue({ ...f, recency: 0.5 }), 0.03);
  assert.equal(questionValue({ ...f, retrievalWeight: 0 }), 0, 'a case nobody retrieves is worth nothing to ask about');
  close(valuePerCost({ ...f, recipientOpenQuestions: 1 })!, 0.03);
  assert.equal(valuePerCost(base), undefined, 'no expected gain measured: no value / cost');
});

test('expected gain in completeness x correctness under the metric\'s reading (D-B2-66)', () => {
  const g = (o: Partial<GainInput>): number => expectedGain({ kind: 'missing', completeness: 0.5, correctness: 0.1, caseClaims: 10, slots: { symptom: 1, distinguishing: 0.25, outcome: 1, lasting: 0 }, distinguishingKeys: 4, keyUnknown: true, targetSupported: false, ...o });
  // applicability: one key of four filled, correctness unchanged
  close(g({}), Math.round((1 / 24) * 0.1 * 10_000) / 10_000);
  assert.equal(g({ keyUnknown: false }), 0, 'the key is already known');
  assert.equal(g({ correctness: 0 }), 0, 'the product hides a completeness gain on a case with no supported claim');
  assert.equal(g({ correctness: null }), 0);
  // outcome: one more supported claim (an outcome report is a source of its own) if the answer is Yes, weighted by
  // P_CONFIRM; the No branch adds none (review of D-B2-67: an expectation over both answers, not the Yes branch)
  assert.equal(P_CONFIRM, 0.5);
  close(g({ kind: 'outcome' }), Math.round(0.5 * (P_CONFIRM * 1 / 10) * 10_000) / 10_000);
  close(g({ kind: 'outcome' }), Math.round(0.5 * 0.1 * 10_000) / 10_000 * P_CONFIRM);
  assert.equal(g({ kind: 'outcome', targetSupported: true }), 0);
  close(g({ kind: 'outcome', slots: { symptom: 1, distinguishing: 0.25, outcome: 0, lasting: 0 }, targetSupported: true }), Math.round((1 / 6) * 0.1 * 10_000) / 10_000);
  close(g({ kind: 'lasting' }), Math.round((1 / 6) * 0.1 * 10_000) / 10_000);
  assert.equal(g({ kind: 'pairing' }), 0);
  assert.ok(g({ correctness: -0.2 }) === 0, 'never negative');
});

test('rules selector orders the pairs that pass the gate by value / cost, then by score, then by key', () => {
  const sel = new RulesSelector({ clock });
  const a = act('q1', 'pA'), b = act('q2', 'pB'), c = act('q3', 'pC');
  // b has the higher value / cost although a sorts first and scores the same
  const d = sel.select(ctx([a, b], { [actionKey(a)]: { ...base, expectedGain: 0.001, retrievalWeight: 1 }, [actionKey(b)]: { ...base, expectedGain: 0.02, retrievalWeight: 1 } }));
  assert.deepEqual(d.chosen, b);
  assert.match(d.reason, /value\/cost 0\.0200/);
  // a busier recipient costs more: the same gain asked of someone with 3 questions today loses to half the gain asked of someone free
  const e = sel.select(ctx([a, b], { [actionKey(a)]: { ...base, expectedGain: 0.01, retrievalWeight: 1 }, [actionKey(b)]: { ...base, recipientAskedToday: 3, expectedGain: 0.02, retrievalWeight: 1 } }));
  assert.deepEqual(e.chosen, a);
  // a frequently retrieved case outranks a rarely retrieved one at the same gain
  const w = sel.select(ctx([a, b], { [actionKey(a)]: { ...base, expectedGain: 0.01, retrievalWeight: 1 }, [actionKey(b)]: { ...base, expectedGain: 0.01, retrievalWeight: 4 } }));
  assert.deepEqual(w.chosen, b);
  // all at value 0: the score decides, then the key (the previous order)
  const z = sel.select(ctx([c, b, a], { [actionKey(a)]: { ...base, expectedGain: 0, retrievalWeight: 1, firsthand: 0 }, [actionKey(b)]: { ...base, expectedGain: 0, retrievalWeight: 1 }, [actionKey(c)]: { ...base, expectedGain: 0, retrievalWeight: 1 } }));
  assert.deepEqual(z.chosen, b);
});

test('rules selector: the gate is unchanged; a high value never lets a pair below the threshold through', () => {
  const sel = new RulesSelector({ clock, threshold: 0.2 });
  const a = act('q1', 'pA'), b = act('q2', 'pB');
  // a: not consequential (score 0) but a large gain; b: passes with a small gain
  const d = sel.select(ctx([a, b], { [actionKey(a)]: { ...base, consequential: 0, expectedGain: 1, retrievalWeight: 9 }, [actionKey(b)]: { ...base, expectedGain: 0.001, retrievalWeight: 1 } }));
  assert.deepEqual(d.chosen, b);
  const only = sel.select(ctx([a], { [actionKey(a)]: { ...base, consequential: 0, expectedGain: 1, retrievalWeight: 9 } }));
  assert.equal(only.chosen, 'defer');
  assert.match(only.reason, /below threshold 0\.2/);
  // a single eligible pair is asked whatever its value (the 3-minute script and the 03:00 sequence have one each)
  const one = sel.select(ctx([b], { [actionKey(b)]: { ...base, expectedGain: 0, retrievalWeight: 1 } }));
  assert.deepEqual(one.chosen, b);
});

test('rules selector without measured value features orders exactly as before (score, then key)', () => {
  const sel = new RulesSelector({ clock });
  const a = act('q1', 'pA'), b = act('q1', 'pB');
  const d = sel.select(ctx([b, a], { [actionKey(a)]: { consequential: 1, firsthand: 1 }, [actionKey(b)]: { consequential: 1, firsthand: 1 } }));
  assert.deepEqual(d.chosen, a);
  assert.doesNotMatch(d.reason, /value\/cost/);
});

test('LinUCB does not start from the value / cost order: its vector leaves out the value features (review of D-B2-67, D-B2-74)', () => {
  // The rules order is not a prior LinUCB starts from: LinUCB has a ridge prior only and cannot represent the
  // value / cost features at all. Two pairs that differ only in value / cost look the same to it.
  for (const n of ['expectedGain', 'retrievalWeight', 'quietHours']) assert.equal((FEATURE_NAMES as readonly string[]).includes(n), false, n);
  const lo = { ...base, expectedGain: 0.001, retrievalWeight: 1 };
  const hi = { ...base, expectedGain: 0.5, retrievalWeight: 9, quietHours: 1 };
  assert.deepEqual(vectorize(lo), vectorize(hi));
  assert.ok(valuePerCost(hi)! !== valuePerCost(lo)!);
});
