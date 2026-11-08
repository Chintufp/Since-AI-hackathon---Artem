import { test } from 'node:test';
import assert from 'node:assert/strict';
import { trayIconPixels } from './tray-pixels.ts';

const at = (px: Uint8Array, x: number, y: number): number[] => Array.from(px.subarray((y * 32 + x) * 4, (y * 32 + x) * 4 + 4));

test('macOS: a black template silhouette with transparent face holes', () => {
  const px = trayIconPixels('darwin');
  assert.deepEqual(at(px, 16, 8), [0, 0, 0, 255]);
  assert.equal(at(px, 10, 13)[3], 0); // left eye cut out
  assert.equal(at(px, 0, 0)[3], 0);
});

test('Windows: a white body with a grey rim and dark eyes, visible on a dark taskbar', () => {
  const px = trayIconPixels('win32');
  assert.deepEqual(at(px, 16, 8), [255, 255, 255, 255]);
  assert.deepEqual(at(px, 10, 13), [36, 53, 66, 255]);
  assert.deepEqual(at(px, 12, 2), [154, 170, 184, 255]); // top row is rim
  assert.equal(at(px, 0, 0)[3], 0);
});
