import assert from 'node:assert/strict';
import { test } from 'node:test';
import { modelNotes } from './model-notes.ts';

test('model notes: rules-only routes say nothing; embed, phrase and fallbacks are named in plain words', () => {
  assert.deepEqual(modelNotes([{ route: 'local', version: 'hybrid(bm25@1+exact-id@1+trigram-hash[local,not-learned])' }, { route: 'rules', version: 'question-templates@1' }]), []);
  assert.deepEqual(modelNotes([
    { route: 'local', version: 'hybrid(bm25@1+exact-id@1)+embed[local:bge-m3]' },
    { route: 'local', version: 'ollama-phrase@1:qwen3:8b' },
  ]), ['Matched by meaning with local model bge-m3 (similar, not a confidence)', 'Question worded by local model qwen3:8b']);
  assert.deepEqual(modelNotes([{ route: 'local', version: 'hybrid(x+trigram-hash[local,not-learned])+embed[fallback:timeout]' }, { route: 'rules', version: 'question-templates@1[fallback:phrase:error]' }]), [
    'The embedding model was not available (timeout); matched by spelling instead', 'The phrase model was not available (error); rules were used',
  ]);
});
