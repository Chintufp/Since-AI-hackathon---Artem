/** desktop (ux fix M1): no keyboard focus ring after a mouse action; keyboard moves keep it. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { focusOptions, probeFocusVisible, trackModality } from './focus.ts';

test('focusOptions: pointer hides the ring, keyboard shows it, unsupported leaves the browser default', () => {
  assert.deepEqual(focusOptions('pointer', true), { preventScroll: true, focusVisible: false });
  assert.deepEqual(focusOptions('keyboard', true), { preventScroll: true, focusVisible: true });
  assert.deepEqual(focusOptions('pointer', false), { preventScroll: true });
});

test('probeFocusVisible: detects whether focus() reads the focusVisible option', () => {
  const reads = { createElement: () => ({ focus: (o?: FocusOptions) => void (o as { focusVisible?: boolean } | undefined)?.focusVisible }) };
  const ignores = { createElement: () => ({ focus: (o?: FocusOptions) => void o?.preventScroll }) };
  const throws = { createElement: () => { throw new Error('no dom'); } };
  assert.equal(probeFocusVisible(reads), true);
  assert.equal(probeFocusVisible(ignores), false);
  assert.equal(probeFocusVisible(throws), false);
  assert.equal(probeFocusVisible(null), false);
});

test('trackModality: pointerdown = pointer, keydown = keyboard, detach removes both listeners', () => {
  const t = new EventTarget();
  const m = trackModality(t);
  assert.equal(m.current(), 'pointer');
  t.dispatchEvent(new Event('keydown'));
  assert.equal(m.current(), 'keyboard');
  t.dispatchEvent(new Event('pointerdown'));
  assert.equal(m.current(), 'pointer');
  m.detach();
  t.dispatchEvent(new Event('keydown'));
  assert.equal(m.current(), 'pointer');
});
