import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createKeychain, parseKeyPayload, sendKeyToService } from './keychain.ts';

/** A reversible stand-in for safeStorage (never the real keychain in tests). */
const fakeSafe = (available = true) => ({
  isEncryptionAvailable: () => available,
  encryptString: (s: string) => Buffer.from([...Buffer.from(s, 'utf8')].map((b) => b ^ 0x5a)),
  decryptString: (b: Buffer) => Buffer.from([...b].map((x) => x ^ 0x5a)).toString('utf8'),
});

test('keychain: payloads are validated (vendor list, printable, length); an empty key means forget', () => {
  assert.deepEqual(parseKeyPayload({ vendor: 'anthropic', key: ' sk-ant-abc ' }), { vendor: 'anthropic', key: 'sk-ant-abc' });
  assert.deepEqual(parseKeyPayload({ vendor: 'gemini', key: '' }), { vendor: 'gemini', key: '' });
  assert.equal(parseKeyPayload({ vendor: 'openai', key: 'x' }), undefined);
  assert.equal(parseKeyPayload({ vendor: 'anthropic', key: 'a b' }), undefined);
  assert.equal(parseKeyPayload({ vendor: 'anthropic', key: 'x'.repeat(401) }), undefined);
  assert.equal(parseKeyPayload({ vendor: 'anthropic' }), undefined);
  assert.equal(parseKeyPayload(null), undefined);
});

test('keychain: the file holds only ciphertext; load decrypts; forget removes; no encryption means nothing is written', () => {
  let file: string | undefined;
  const io = { read: () => file, write: (t: string) => { file = t; } };
  const k = createKeychain(fakeSafe(), io);
  assert.deepEqual(k.save('anthropic', 'sk-ant-secret'), { stored: true });
  assert.ok(file && !file.includes('sk-ant-secret'));
  assert.deepEqual(k.load(), [{ vendor: 'anthropic', key: 'sk-ant-secret' }]);
  k.forget('anthropic');
  assert.deepEqual(k.load(), []);
  let other: string | undefined;
  const none = createKeychain(fakeSafe(false), { read: () => other, write: (t) => { other = t; } });
  assert.deepEqual(none.save('gemini', 'g-key'), { stored: false });
  assert.equal(other, undefined);
});

test('keychain: the key reaches the service through POST /models/key only', async () => {
  const calls: Array<{ url: string; body: string }> = [];
  const r = await sendKeyToService('http://127.0.0.1:1', 'gemini', 'g-key', async (url, init) => { calls.push({ url, body: init.body }); return { ok: true, json: async () => ({ provider: 'gemini', present: true }) }; });
  assert.deepEqual(r, { present: true });
  assert.deepEqual(calls, [{ url: 'http://127.0.0.1:1/models/key', body: '{"provider":"gemini","key":"g-key"}' }]);
});
