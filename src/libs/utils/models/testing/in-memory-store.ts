import type { EmbeddingKind, EmbeddingRow, EmbeddingTable, KnowledgeStore, ListOptions, RecordType, RecordTypes } from '../../contracts/index.ts';

/** Map-backed mirror of the SQLite r_embedding table (same keys and 'unchanged' rule), so embed=local works on this store too. */
export class InMemoryEmbeddings implements EmbeddingTable {
  private rows = new Map<string, EmbeddingRow>();
  private seq = 0;
  private key = (kind: EmbeddingKind, refId: string, model: string): string => `${kind}:${model}:${refId}`;
  upsert(row: { kind: EmbeddingKind; refId: string; model: string; textHash: string; vector: Float32Array }): 'written' | 'unchanged' {
    const id = this.key(row.kind, row.refId, row.model);
    const prev = this.rows.get(id);
    if (prev?.textHash === row.textHash) return 'unchanged';
    this.rows.set(id, { id, kind: row.kind, refId: row.refId, model: row.model, dims: row.vector.length, textHash: row.textHash, vector: Float32Array.from(row.vector), createdSeq: prev?.createdSeq ?? ++this.seq });
    return 'written';
  }
  get(kind: EmbeddingKind, refId: string, model: string): EmbeddingRow | undefined {
    const r = this.rows.get(this.key(kind, refId, model));
    return r ? { ...r, vector: Float32Array.from(r.vector) } : undefined;
  }
  list(kind: EmbeddingKind, model: string): EmbeddingRow[] {
    return [...this.rows.values()].filter((r) => r.kind === kind && r.model === model).sort((a, b) => a.createdSeq - b.createdSeq).map((r) => ({ ...r, vector: Float32Array.from(r.vector) }));
  }
  deleteRef(kind: EmbeddingKind, refId: string): number {
    let n = 0;
    for (const [id, r] of this.rows) if (r.kind === kind && r.refId === refId) { this.rows.delete(id); n++; }
    return n;
  }
  count(model?: string): number {
    return model === undefined ? this.rows.size : [...this.rows.values()].filter((r) => r.model === model).length;
  }
  clear(): void {
    this.rows.clear();
  }
}

const WORD = /[\p{L}\p{N}]+/gu;
const terms = (s: string): string[] => (s.toLowerCase().match(WORD) ?? []).filter((t) => t.length > 1);

/**
 * Test double for KnowledgeStore. Records are deep-cloned on write and read so callers cannot
 * mutate stored state by accident (same observable behaviour as a persisted store).
 * Every record needs a string `id`; types whose contract record has no `id`
 * (evaluation, eligibility) must be stored with an added `id`.
 */
export class InMemoryStore implements KnowledgeStore {
  private tables = new Map<RecordType, Map<string, unknown>>();
  readonly embeddings: EmbeddingTable = new InMemoryEmbeddings();

  private table(type: RecordType): Map<string, unknown> {
    let t = this.tables.get(type);
    if (!t) {
      t = new Map();
      this.tables.set(type, t);
    }
    return t;
  }

  put<T extends RecordType>(type: T, record: RecordTypes[T]): RecordTypes[T] {
    const id = (record as { id?: unknown }).id;
    if (typeof id !== 'string' || !id) throw new Error(`InMemoryStore.put(${type}): record has no string id`);
    this.table(type).set(id, structuredClone(record));
    return structuredClone(record);
  }

  putMany<T extends RecordType>(type: T, records: RecordTypes[T][]): number {
    for (const r of records) this.put(type, r);
    return records.length;
  }

  get<T extends RecordType>(type: T, id: string): RecordTypes[T] | undefined {
    const v = this.table(type).get(id);
    return v === undefined ? undefined : (structuredClone(v) as RecordTypes[T]);
  }

  list<T extends RecordType>(type: T, options: ListOptions = {}): RecordTypes[T][] {
    let rows = [...this.table(type).values()] as RecordTypes[T][];
    const where = options.where;
    if (where) {
      rows = rows.filter((r) =>
        Object.entries(where).every(([k, v]) => v === undefined || (r as unknown as Record<string, unknown>)[k] === v),
      );
    }
    if (options.orderBy) {
      const { field, direction = 'asc' } = options.orderBy;
      const sign = direction === 'asc' ? 1 : -1;
      rows = [...rows].sort((a, b) => {
        const x = (a as unknown as Record<string, unknown>)[field] as string | number | undefined;
        const y = (b as unknown as Record<string, unknown>)[field] as string | number | undefined;
        if (x === y) return 0;
        if (x === undefined) return 1;
        if (y === undefined) return -1;
        return x < y ? -sign : sign;
      });
    }
    if (options.limit !== undefined) rows = rows.slice(0, options.limit);
    return rows.map((r) => structuredClone(r));
  }

  delete(type: RecordType, id: string): boolean {
    return this.table(type).delete(id);
  }

  count(type: RecordType, where?: ListOptions['where']): number {
    return this.list(type, { where }).length;
  }

  /** Term-overlap scoring: fraction of distinct query terms present in the document text. */
  searchText(
    types: Array<'evidence' | 'claim' | 'case'>,
    query: string,
    limit = 20,
  ): Array<{ type: RecordType; id: string; score: number }> {
    const q = [...new Set(terms(query))];
    if (q.length === 0) return [];
    const out: Array<{ type: RecordType; id: string; score: number }> = [];
    for (const type of types) {
      for (const [id, rec] of this.table(type)) {
        const r = rec as { text?: string; statement?: string; title?: string };
        const doc = new Set(terms(`${r.text ?? ''} ${r.statement ?? ''} ${r.title ?? ''}`));
        const hit = q.filter((t) => doc.has(t)).length;
        if (hit > 0) out.push({ type, id, score: hit / q.length });
      }
    }
    return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)).slice(0, limit);
  }

  transaction<R>(fn: () => R): R {
    const snapshot = new Map([...this.tables].map(([k, v]) => [k, new Map(v)] as const));
    try {
      return fn();
    } catch (e) {
      this.tables = snapshot;
      throw e;
    }
  }

  clear(): void {
    this.tables.clear();
    this.embeddings.clear();
  }

  close(): void {}
}
