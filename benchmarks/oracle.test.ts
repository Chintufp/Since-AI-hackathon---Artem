import test from 'node:test';
import assert from 'node:assert/strict';
import type { PeopleDirectory } from '../src/libs/utils/contracts/index.ts';
import { answerFor, gapConditionKeys, parseAnswerKey } from './oracle.ts';
import type { ProblemKey } from './oracle.ts';

const people: PeopleDirectory = {
  people: [
    { id: 'p:ann', name: 'Ann', role: 'r', groups: [], actorIds: [], available: true },
    { id: 'p:bo', name: 'Bo', role: 'r', groups: [], actorIds: [], available: false },
    { id: 'p:cy', name: 'Cy', role: 'r', groups: [], actorIds: [], available: true },
  ],
};

const key: ProblemKey = {
  relatedIncidentKeys: ['A'],
  applicable: 'inapplicable',
  consequentialGap: { description: 'd', answerers: ['p:ann', 'p:bo'], answer: 'no' },
  answers: {
    'p:ann': { 'unit.revision=B': 'yes', 'unit.installed_year=2019': 'no', 'traffic.state@NODE-1': 'yes', 'traffic.state=flowing@NODE-1': 'yes', 'optical.level': 'unknown' },
    'p:bo': { 'unit.revision=A': 'yes' },
  },
  noQuestionNeeded: false,
  expectedRecommendation: 'none',
  distinguishingConditions: [{ key: 'unit.revision', value: 'B' }],
};

test('parseAnswerKey splits value and scope', () => {
  assert.deepEqual(parseAnswerKey('traffic.state=flowing@N-1'), { key: 'traffic.state', value: 'flowing', scope: 'N-1' });
  const p = parseAnswerKey('optical.level');
  assert.equal(p.key, 'optical.level');
  assert.equal(p.value, undefined);
  assert.equal(p.scope, undefined);
});

test('answers come strictly from the key', () => {
  assert.equal(answerFor(key, 'p:ann', { conditionKey: 'unit.revision', expected: 'B' }, { people }), 'yes');
  assert.equal(answerFor(key, 'p:ann', { conditionKey: 'unit.installed_year', expected: 2019 }, { people }), 'no');
});

test('a yes on another value of a single-valued condition implies no', () => {
  assert.equal(answerFor(key, 'p:ann', { conditionKey: 'unit.revision', expected: 'A' }, { people }), 'no');
  // a 'no' on one value says nothing about a different value
  assert.equal(answerFor(key, 'p:ann', { conditionKey: 'unit.installed_year', expected: 2021 }, { people }), 'unknown');
});

test('unknown when the person knowledge does not cover the question', () => {
  assert.equal(answerFor(key, 'p:ann', { conditionKey: 'power.state', expected: 'normal' }, { people }), 'unknown');
  assert.equal(answerFor(key, 'p:ann', { conditionKey: 'optical.level', expected: 'normal' }, { people }), 'unknown');
  assert.equal(answerFor(key, 'p:cy', { conditionKey: 'unit.revision', expected: 'B' }, { people }), 'unknown', 'person without entry');
  assert.equal(answerFor(key, 'p:nobody', { conditionKey: 'unit.revision', expected: 'B' }, { people }), 'unknown');
});

test('unavailable people give no answer even when the key has their knowledge', () => {
  assert.equal(answerFor(key, 'p:bo', { conditionKey: 'unit.revision', expected: 'A' }, { people }), 'no-answer');
  assert.equal(answerFor(key, 'p:ann', { conditionKey: 'unit.revision', expected: 'B' }, { people, unavailable: ['p:ann'] }), 'no-answer');
});

test('an unanswerable gap gives no answer from its answerers', () => {
  const k: ProblemKey = { ...key, consequentialGap: { ...key.consequentialGap!, unanswerable: true } };
  assert.equal(answerFor(k, 'p:ann', { conditionKey: 'unit.revision', expected: 'B' }), 'no-answer');
  assert.equal(answerFor(k, 'p:cy', { conditionKey: 'unit.revision', expected: 'B' }), 'unknown');
});

test('scope selects entity-specific answers', () => {
  assert.equal(answerFor(key, 'p:ann', { conditionKey: 'traffic.state', expected: 'flowing', scopeEntity: 'NODE-1' }, { people }), 'yes');
  assert.equal(answerFor(key, 'p:ann', { conditionKey: 'traffic.state', scopeEntity: 'NODE-1' }, { people }), 'yes');
  assert.equal(answerFor(key, 'p:ann', { conditionKey: 'traffic.state', expected: 'flowing', scopeEntity: 'NODE-2' }, { people }), 'unknown');
});

test('gapConditionKeys uses decisive conditions, ignores unrelated answerer keys and already observed conditions', () => {
  assert.deepEqual(gapConditionKeys(key), ['unit.revision']);
  assert.deepEqual(gapConditionKeys(key, [{ key: 'unit.revision' }]), [], 'observed by the requester: not a gap');
  const noDistinguishing: ProblemKey = { ...key, distinguishingConditions: undefined };
  assert.deepEqual(gapConditionKeys(noDistinguishing), ['optical.level', 'traffic.state', 'unit.installed_year', 'unit.revision']);
  assert.deepEqual(gapConditionKeys({ ...key, consequentialGap: undefined, distinguishingConditions: undefined }), []);
});

test('unscoped answers are not applied to a question about another entity', () => {
  // ann's 'unit.revision=B' was written about the problem's own unit; asking about revision A of ANOTHER entity must not yield a false no
  assert.equal(answerFor(key, 'p:ann', { conditionKey: 'unit.revision', expected: 'A', scopeEntity: 'OTHER-1' }, { people }), 'unknown');
  assert.equal(answerFor(key, 'p:ann', { conditionKey: 'unit.revision', expected: 'B' }, { people }), 'yes');
});

test('boolean complements and valueless questions are answered', () => {
  const k: ProblemKey = { ...key, answers: { 'p:ann': { 'config.changed=true': 'no', 'cable.guard_fitted=false': 'yes', 'traffic.state=flowing': 'yes', 'optical.level=low': 'no' } } };
  assert.equal(answerFor(k, 'p:ann', { conditionKey: 'config.changed', expected: false }, { people }), 'yes');
  assert.equal(answerFor(k, 'p:ann', { conditionKey: 'config.changed', expected: true }, { people }), 'no');
  assert.equal(answerFor(k, 'p:ann', { conditionKey: 'cable.guard_fitted', expected: true }, { people }), 'no');
  assert.equal(answerFor(k, 'p:ann', { conditionKey: 'traffic.state' }, { people }), 'yes', 'valueless question: a known yes answers yes');
  assert.equal(answerFor(k, 'p:ann', { conditionKey: 'optical.level' }, { people }), 'unknown', 'only a no on one value: unknown for a valueless question');
});
