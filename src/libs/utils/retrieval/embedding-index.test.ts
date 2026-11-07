import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { KnowledgeStore, RecordType, RetrievalQuery } from '../contracts/index.ts';
import { openStore } from '../memory/sqlite-store.ts';
import { ProviderError } from '../models/providers/index.ts';
import { buildSyntheticStore, CASE_REF, outsiderPrincipal, requesterPrincipal, secopsPrincipal } from '../models/testing/fixtures.ts';
import { evidenceGate } from './access.ts';
import { EmbeddingIndex, type Embedder } from './embedding-index.ts';
import { EmbeddingRetriever, HybridRetriever } from './hybrid.ts';

/** A deterministic stand-in for a meaning model: a bag of concepts, so paraphrases land close without sharing spelling. */
const CONCEPTS: string[][] = [
  ['traffic', 'flowing', 'flow', 'passes', 'counters', 'forwarding'],
  ['link', 'interface', 'green', 'light', 'up'],
  ['power', 'reboots', 'feed', 'supply'],
  ['routing', 'bgp', 'session', 'flapping', 'policy'],
  ['filtering', 'rule', 'dropped', 'firewall'],
  ['barrier', 'key', 'site'],
  ['fan', 'dust'],
  ['nothing', 'no', 'zero', 'absent', 'stay'],
];
function fakeEmbedder(): Embedder & { calls: number; texts: number } {
  const f = {
    calls: 0,
    texts: 0,
    async embed(_model: string, texts: string[]) {
      f.calls++;
      f.texts += texts.length;
      return texts.map((t) => {
        const words = t.toLowerCase().match(/[a-z]+/g) ?? [];
        return Float32Array.from(CONCEPTS.map((c) => words.filter((w) => c.includes(w)).length));
      });
    },
  };
  return f;
}

const COPY: RecordType[] = ['entity', 'case', 'claim', 'attempt', 'outcome', 'personLink'];
function sqliteCopy(): KnowledgeStore {
  const mem = buildSyntheticStore();
  const s = openStore(':memory:');
  for (const t of COPY) for (const r of mem.list(t)) s.put(t, r as never);
  return s;
}
const q = (text: string, p = requesterPrincipal()): RetrievalQuery => ({ text, conditions: [], entityIds: [], requesterPrincipal: { id: p.id, groups: p.groups }, k: 5 });

test('indexStore embeds evidence, claims and case cards once; unchanged text is skipped, changed text rewritten, gone records removed', async () => {
  const s = sqliteCopy();
  const emb = fakeEmbedder();
  const idx = new EmbeddingIndex(s, emb, 'fake-embed', { cardText: (id) => `card for ${s.get('case', id)?.title}` });
  const r1 = await idx.indexStore();
  assert.equal(r1.written, s.count('claim') + s.count('case'));
  assert.equal(s.embeddings!.list('case', 'fake-embed').length, s.count('case'));
  const r2 = await idx.indexStore();
  assert.deepEqual(r2, { written: 0, unchanged: r1.written, removed: 0 });
  s.put('claim', { ...s.get('claim', 'cl_c6_obs')!, statement: 'Fan noise on Asset-B2 again' });
  s.delete('case', 'case_access');
  const r3 = await idx.indexStore();
  assert.equal(r3.written, 1);
  assert.equal(r3.removed, 1);
  assert.equal(s.embeddings!.get('case', 'case_access', 'fake-embed'), undefined);
});

test('search: a paraphrase finds the reference case by meaning; the restricted lookalike is never returned to someone outside its group', async () => {
  const s = sqliteCopy();
  const idx = new EmbeddingIndex(s, fakeEmbedder(), 'fake-embed');
  await idx.indexStore();
  const visibleTo = (p: { id: string; groups: string[] }) => new Set(s.list('case').filter((c) => evidenceGate(s, p).scope(c.accessScope)).map((c) => `case:${c.id}`));
  const text = 'green light, nothing flowing';
  const forRequester = await idx.search(text, visibleTo(requesterPrincipal()), evidenceGate(s, requesterPrincipal()));
  assert.equal(forRequester.name, 'embed:fake-embed');
  assert.equal(forRequester.hits[0]!.key, `case:${CASE_REF}`);
  assert.ok(!forRequester.hits.some((h) => h.key === 'case:case_restricted'));
  // even when the caller passes a wider visible set, the claim and card hits of the hidden case fail the gate
  const all = new Set(s.list('case').map((c) => `case:${c.id}`));
  const leaky = await idx.search('filtering rule dropped the traffic', all, evidenceGate(s, outsiderPrincipal()));
  assert.ok(!leaky.hits.some((h) => h.key === 'case:case_restricted'), 'gate holds');
  const sec = await idx.search('filtering rule dropped the traffic', visibleTo(secopsPrincipal()), evidenceGate(s, secopsPrincipal()));
  assert.equal(sec.hits[0]!.key, 'case:case_restricted', 'its own group finds it');
});

test('hybrid with the embed slot: the list replaces trigrams, the route says +embed[local:<model>], the reason says similar in meaning', async () => {
  const s = sqliteCopy();
  const index = new EmbeddingIndex(s, fakeEmbedder(), 'fake-embed');
  await index.indexStore();
  const h = new HybridRetriever(s, { embedding: { index } });
  const out = await h.search(q('green light, nothing flowing'));
  assert.equal(out[0]!.caseId, CASE_REF);
  assert.match(h.route.version, /\+embed\[local:fake-embed\]$/);
  assert.ok(out[0]!.reasons.includes('similar in meaning (local model fake-embed)'));
  assert.ok(!out.some((c) => c.reasons.some((r) => r.includes('trigram'))));
  for (const p of [requesterPrincipal(), outsiderPrincipal()]) {
    const res = await new HybridRetriever(s, { embedding: { index } }).search(q('filtering rule dropped the traffic, link up, counters zero', p));
    assert.ok(!res.some((c) => c.caseId === 'case_restricted'), `hidden for ${p.displayName}`);
  }
  const er = new EmbeddingRetriever(s, { embedding: { index } });
  assert.equal((await er.search(q('green light, nothing flowing')))[0]!.caseId, CASE_REF);
  assert.equal(er.route.version, 'embed@1[local:fake-embed]');
});

test('a failing or slow embedder falls back to trigrams for that call, labelled; a store without a vector table does too', async () => {
  const s = sqliteCopy();
  const good = fakeEmbedder();
  await new EmbeddingIndex(s, good, 'fake-embed').indexStore();
  const failing: Embedder = { embed: async () => { throw new ProviderError('model-missing', "model 'fake-embed' not found"); } };
  const h = new HybridRetriever(s, { embedding: { index: new EmbeddingIndex(s, failing, 'fake-embed') } });
  const out = await h.search(q('link is up but counters zero and no traffic'));
  assert.equal(out[0]!.caseId, CASE_REF);
  assert.match(h.route.version, /trigram-hash\[local,not-learned\]\)\+embed\[fallback:model-missing\]$/);
  assert.equal(h.lastEmbeddingFailure, 'model-missing');
  const slow: Embedder = { embed: () => new Promise(() => {}) };
  const failures: string[] = [];
  const h2 = new HybridRetriever(s, { embedding: { index: new EmbeddingIndex(s, slow, 'fake-embed'), timeoutMs: 30, onFailure: (r) => failures.push(r) } });
  await h2.search(q('link is up but counters zero'));
  assert.match(h2.route.version, /embed\[fallback:timeout\]$/);
  assert.equal(failures.length, 1);
  const mem = buildSyntheticStore();
  const h3 = new HybridRetriever(mem, { embedding: { index: new EmbeddingIndex(mem, good, 'fake-embed') } });
  assert.equal((await h3.search(q('link is up but counters zero')))[0]!.caseId, CASE_REF);
  assert.match(h3.route.version, /embed\[fallback:no-table\]$/);
});
