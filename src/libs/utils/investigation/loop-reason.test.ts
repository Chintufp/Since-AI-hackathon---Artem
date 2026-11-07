import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { InvestigationState } from '../contracts/index.ts';
import { defaultInvestigationSettings, loopReasonFor } from './index.ts';

const LOOPS: Array<InvestigationState['loop']> = ['no-question-needed', 'question-open', 'deferred', 'answered', 'exhausted'];

test('loopReason: every loop value has a human line, from the state when set and from configuration otherwise', () => {
  const reasons = defaultInvestigationSettings().loopReasons;
  for (const loop of LOOPS) {
    const line = loopReasonFor({ loop }, reasons);
    assert.ok(line.length > 8, `${loop}: "${line}"`);
    assert.doesNotMatch(line, /[{}]|undefined|null|exhausted|question-open|no-question-needed/, `${loop}: "${line}"`);
    assert.equal(loopReasonFor({ loop, loopReason: 'custom line' }, reasons), 'custom line');
  }
  assert.match(loopReasonFor({ loop: 'exhausted' }, reasons), /budget/);
});
