import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stableId, textFingerprint } from './ids.ts';

test('stableId is deterministic and prefixed', () => {
  assert.equal(stableId('ev', 'a', 'b'), stableId('ev', 'a', 'b'));
  assert.notEqual(stableId('ev', 'a', 'b'), stableId('ev', 'a', 'c'));
  assert.match(stableId('ev', 'x'), /^ev_[0-9a-f]{20}$/);
});

test('textFingerprint ignores whitespace, case and punctuation', () => {
  assert.equal(textFingerprint('Link is UP,  counters zero!'), textFingerprint('link is up counters zero'));
});
