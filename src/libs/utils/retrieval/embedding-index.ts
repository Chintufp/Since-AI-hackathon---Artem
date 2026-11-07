/**
 * Embedding index (BUILD_BRIEF 3.1-3.3): a cheap view over r_embedding plus an embedder. Three granularities:
 * evidence text, claim statements and case cards. Search embeds the query once, takes a brute-force cosine over the
 * stored rows of one model, aggregates evidence and claim hits to their case by max, and keeps only what the
 * requester may see. Cosine is "similar in meaning", never a confidence.
 *
 * Dependencies: contracts, models (providers' types and cache). The case-card text is injected (it lives in memory/).
 */
import type { EmbeddingKind, EmbeddingTable, KnowledgeStore } from '../contracts/index.ts';
import { EmbeddingCache, textHash, type CallOptions } from '../models/providers/index.ts';
import type { EvidenceGate } from './access.ts';
import type { RankedList } from './hybrid.ts';

export interface Embedder {
  embed(model: string, texts: string[], opts?: CallOptions): Promise<Float32Array[]>;
}

export interface EmbeddingIndexOptions {
  /** Case card text for a case id (memory/case-card.ts caseCard); without it, cases are indexed by title. */
  cardText?: (caseId: string) => string | undefined;
  cache?: EmbeddingCache;
  /** Texts per embed request while indexing (default 32). */
  batch?: number;
  /** Per-batch timeout while indexing (default 60 s: the first batch may load the model). */
  indexTimeoutMs?: number;
  /** Timeout for the query embedding (default 5 s, the embed slot's budget). */
  queryTimeoutMs?: number;
  /** Hits below this cosine are dropped (default 0.3). */
  minCosine?: number;
}

export interface IndexReport {
  written: number;
  unchanged: number;
  removed: number;
}

export const embedListName = (model: string): string => `embed:${model}`;

function cosineF32(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length);
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  return na > 0 && nb > 0 ? dot / Math.sqrt(na * nb) : 0;
}

export class EmbeddingIndex {
  readonly store: KnowledgeStore;
  readonly model: string;
  private readonly embedder: Embedder;
  private readonly opts: EmbeddingIndexOptions;
  private readonly cache: EmbeddingCache;

  constructor(store: KnowledgeStore, embedder: Embedder, model: string, opts: EmbeddingIndexOptions = {}) {
    this.store = store;
    this.embedder = embedder;
    this.model = model;
    this.opts = opts;
    this.cache = opts.cache ?? new EmbeddingCache();
  }

  /** False when the store has no vector table (the in-memory test store). */
  get available(): boolean {
    return !!this.store.embeddings;
  }

  private table(): EmbeddingTable {
    const t = this.store.embeddings;
    if (!t) throw new Error('this store has no embedding table');
    return t;
  }

  /** The texts the index holds for the current store: evidence text, live claim statements, case cards. */
  texts(): Array<{ kind: EmbeddingKind; refId: string; text: string }> {
    const out: Array<{ kind: EmbeddingKind; refId: string; text: string }> = [];
    for (const e of this.store.list('evidence')) if (e.text?.trim()) out.push({ kind: 'evidence', refId: e.id, text: e.text });
    for (const c of this.store.list('claim')) {
      if ((c.status === 'provisional' || c.status === 'supported') && c.statement.trim()) out.push({ kind: 'claim', refId: c.id, text: c.statement });
    }
    for (const c of this.store.list('case')) {
      const text = this.opts.cardText?.(c.id) ?? c.title;
      if (text?.trim()) out.push({ kind: 'case', refId: c.id, text });
    }
    return out;
  }

  /**
   * Bring r_embedding in line with the store for this model: embed what is new or changed (textHash differs), skip
   * the rest, remove rows whose record is gone. Run after demo:reset, after an import and after a case rebuild.
   */
  async indexStore(): Promise<IndexReport> {
    const t = this.table();
    const want = this.texts();
    const report: IndexReport = { written: 0, unchanged: 0, removed: 0 };
    const live = new Set(want.map((w) => `${w.kind}|${w.refId}`));
    for (const kind of ['evidence', 'claim', 'case'] as EmbeddingKind[]) {
      for (const row of t.list(kind, this.model)) {
        if (!live.has(`${kind}|${row.refId}`)) {
          t.deleteRef(kind, row.refId);
          report.removed++;
        }
      }
    }
    const todo = want.filter((w) => {
      const prev = t.get(w.kind, w.refId, this.model);
      if (prev && prev.textHash === textHash(w.text)) {
        report.unchanged++;
        return false;
      }
      return true;
    });
    const size = this.opts.batch ?? 32;
    for (let i = 0; i < todo.length; i += size) {
      const chunk = todo.slice(i, i + size);
      const vecs = await this.cache.embed(this.embedder, this.model, chunk.map((c) => c.text), { timeoutMs: this.opts.indexTimeoutMs ?? 60_000 });
      chunk.forEach((c, j) => {
        if (t.upsert({ kind: c.kind, refId: c.refId, model: this.model, textHash: textHash(c.text), vector: vecs[j]! }) === 'written') report.written++;
        else report.unchanged++;
      });
    }
    return report;
  }

  /**
   * Ranked case keys ('case:<id>') by meaning. Only cases in `visibleCaseKeys` are returned. A case card counts only
   * when the requester may see every piece of the case's evidence (the card is built from all of it); evidence and
   * claim hits count only when the gate admits them. Throws when the query cannot be embedded (the caller falls back).
   */
  async search(queryText: string, visibleCaseKeys: Set<string>, gate: EvidenceGate, limit = 50): Promise<RankedList & { hits: Array<{ key: string; score: number; via: EmbeddingKind }> }> {
    const t = this.table();
    const [q] = await this.cache.embed(this.embedder, this.model, [queryText], { timeoutMs: this.opts.queryTimeoutMs ?? 5_000 });
    const min = this.opts.minCosine ?? 0.3;
    const best = new Map<string, { score: number; via: EmbeddingKind }>();
    const consider = (caseId: string | undefined, score: number, via: EmbeddingKind) => {
      if (!caseId) return;
      const key = `case:${caseId}`;
      if (!visibleCaseKeys.has(key)) return;
      const prev = best.get(key);
      if (!prev || score > prev.score) best.set(key, { score, via });
    };
    const scored = (kind: EmbeddingKind) => t.list(kind, this.model).map((r) => ({ refId: r.refId, score: cosineF32(q!, r.vector) })).filter((h) => h.score >= min);

    for (const h of scored('case')) {
      const c = this.store.get('case', h.refId);
      if (!c || !gate.scope(c.accessScope)) continue;
      if (c.evidenceIds.some((evidenceId) => !gate.ref({ evidenceId }))) continue;
      consider(c.id, h.score, 'case');
    }
    const claimHits = scored('claim');
    for (const h of claimHits) {
      const cl = this.store.get('claim', h.refId);
      if (!cl?.caseId || !gate.scope(cl.accessScope) || !gate.supported(cl.supporting)) continue;
      consider(cl.caseId, h.score, 'claim');
    }
    const evHits = scored('evidence');
    if (evHits.length) {
      const casesOf = new Map<string, string[]>();
      for (const c of this.store.list('case')) for (const id of c.evidenceIds) casesOf.set(id, [...(casesOf.get(id) ?? []), c.id]);
      for (const h of evHits) {
        if (!gate.ref({ evidenceId: h.refId })) continue;
        const e = this.store.get('evidence', h.refId);
        if (!e || !gate.scope(e.accessScope)) continue;
        for (const caseId of casesOf.get(h.refId) ?? []) consider(caseId, h.score, 'evidence');
      }
    }
    const hits = [...best].map(([key, v]) => ({ key, score: v.score, via: v.via })).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key)).slice(0, limit);
    return { name: embedListName(this.model), weight: 1, hits };
  }
}
