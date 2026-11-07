import { DatabaseSync } from 'node:sqlite';
import type { EmbeddingKind, EmbeddingRow, EmbeddingTable, KnowledgeStore, ListOptions, RecordType, RecordTypes } from '../contracts/index.ts';

export interface StoreOptions {
  /** Force the lexical fallback even when FTS5 exists (used to test both paths). */
  disableFts?: boolean;
}

export interface SqliteKnowledgeStore extends KnowledgeStore {
  /** 'fts5' when FTS5 was available at open, else 'term-overlap' (fraction of query terms found). */
  readonly searchMode: 'fts5' | 'term-overlap';
  readonly embeddings: EmbeddingTable;
}

const EMBEDDING_KINDS: EmbeddingKind[] = ['evidence', 'claim', 'case'];

/** r_embedding: beside the r_* JSON tables, not one of them (vectors are float32 blobs). Its own created_seq counter. */
function embeddingTable(db: DatabaseSync): EmbeddingTable {
  db.exec(`CREATE TABLE IF NOT EXISTS r_embedding (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL CHECK (kind IN ('evidence','claim','case')),
    refId TEXT NOT NULL, model TEXT NOT NULL, dims INTEGER NOT NULL, textHash TEXT NOT NULL,
    vector BLOB NOT NULL, created_seq INTEGER NOT NULL)`);
  db.exec('CREATE INDEX IF NOT EXISTS r_embedding_kind_model ON r_embedding(kind, model)');
  db.exec('CREATE INDEX IF NOT EXISTS r_embedding_ref ON r_embedding(kind, refId)');
  let seq = (db.prepare('SELECT COALESCE(MAX(created_seq),0) AS m FROM r_embedding').get() as { m: number }).m;
  const idOf = (kind: string, model: string, refId: string) => `${kind}:${model}:${refId}`;
  type Raw = { id: string; kind: EmbeddingKind; refId: string; model: string; dims: number; textHash: string; vector: Uint8Array; created_seq: number };
  const toRow = (r: Raw): EmbeddingRow => {
    // Copy into an aligned buffer: a blob's byteOffset need not be a multiple of 4.
    const bytes = new Uint8Array(r.vector);
    return { id: r.id, kind: r.kind, refId: r.refId, model: r.model, dims: r.dims, textHash: r.textHash, vector: new Float32Array(bytes.buffer, 0, r.dims), createdSeq: r.created_seq };
  };
  const sel = db.prepare('SELECT * FROM r_embedding WHERE id = ?');
  const hashOf = db.prepare('SELECT textHash, created_seq FROM r_embedding WHERE id = ?');
  const ins = db.prepare(`INSERT INTO r_embedding(id, kind, refId, model, dims, textHash, vector, created_seq) VALUES (?,?,?,?,?,?,?,?)
    ON CONFLICT(id) DO UPDATE SET dims = excluded.dims, textHash = excluded.textHash, vector = excluded.vector`);
  const byKindModel = db.prepare('SELECT * FROM r_embedding WHERE kind = ? AND model = ? ORDER BY created_seq');
  const delRef = db.prepare('DELETE FROM r_embedding WHERE kind = ? AND refId = ?');
  return {
    upsert(row) {
      if (!EMBEDDING_KINDS.includes(row.kind)) throw new Error(`unknown embedding kind: ${row.kind}`);
      const id = idOf(row.kind, row.model, row.refId);
      const prev = hashOf.get(id) as { textHash: string; created_seq: number } | undefined;
      if (prev && prev.textHash === row.textHash) return 'unchanged';
      const v = row.vector;
      ins.run(id, row.kind, row.refId, row.model, v.length, row.textHash, new Uint8Array(v.buffer, v.byteOffset, v.byteLength), prev ? prev.created_seq : ++seq);
      return 'written';
    },
    get(kind, refId, model) {
      const r = sel.get(idOf(kind, model, refId)) as Raw | undefined;
      return r ? toRow(r) : undefined;
    },
    list(kind, model) {
      return (byKindModel.all(kind, model) as Raw[]).map(toRow);
    },
    deleteRef(kind, refId) {
      return Number(delRef.run(kind, refId).changes);
    },
    count(model) {
      const r = (model === undefined ? db.prepare('SELECT COUNT(*) AS c FROM r_embedding').get() : db.prepare('SELECT COUNT(*) AS c FROM r_embedding WHERE model = ?').get(model)) as { c: number };
      return r.c;
    },
    clear() {
      db.exec('DELETE FROM r_embedding');
      seq = 0;
    },
  };
}

const RECORD_TYPES: RecordType[] = [
  'evidence', 'importBatch', 'connection', 'entity', 'claim', 'case', 'attempt', 'outcome', 'personLink',
  'pattern', 'procedure', 'observation', 'correction', 'investigation', 'question', 'decision', 'eligibility',
  'answer', 'preference', 'outcomeReport', 'evaluation', 'participation', 'participationOptin', 'trace', 'settings',
];

/** JSON paths worth an expression index (applied to every table; cheap when the path is absent). */
const INDEXED_PATHS = [
  'caseId', 'personEntityId', 'investigationId', 'status', 'orgId', 'questionId',
  'lineage.sourceFingerprint', 'metadata.sourceKey', 'thread.threadId',
];

const FIELD_RE = /^[A-Za-z0-9_]+(\.[A-Za-z0-9_]+)*$/;
const SEARCH_KINDS = new Set<RecordType>(['evidence', 'claim', 'case']);

/** Accept the contract's top-level names plus a few friendly aliases for nested evidence fields. */
function jsonPath(field: string): string {
  if (field === 'sourceFingerprint') field = 'lineage.sourceFingerprint';
  if (field === 'sourceKey') field = 'metadata.sourceKey';
  if (field === 'threadId') field = 'thread.threadId';
  if (!FIELD_RE.test(field)) throw new Error(`invalid field name: ${field}`);
  return `$.${field}`;
}

const tableOf = (type: RecordType): string => {
  if (!RECORD_TYPES.includes(type)) throw new Error(`unknown record type: ${type}`);
  return `r_${type}`;
};

function searchBody(type: RecordType, rec: any): string | undefined {
  if (type === 'evidence') return String(rec.text ?? '');
  if (type === 'claim') return String(rec.statement ?? '');
  if (type === 'case') return String(rec.title ?? '');
  return undefined;
}

const tokenize = (q: string): string[] =>
  [...new Set(q.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]+/gu) ?? [])];

export function openStore(path: string | ':memory:', options: StoreOptions = {}): SqliteKnowledgeStore {
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL;');
  for (const t of RECORD_TYPES) {
    const tbl = tableOf(t);
    db.exec(`CREATE TABLE IF NOT EXISTS ${tbl} (id TEXT PRIMARY KEY, json TEXT NOT NULL, created_seq INTEGER NOT NULL)`);
    db.exec(`CREATE INDEX IF NOT EXISTS ${tbl}_seq ON ${tbl}(created_seq)`);
    for (const p of INDEXED_PATHS) {
      db.exec(`CREATE INDEX IF NOT EXISTS ${tbl}_ix_${p.replace(/\W/g, '_')} ON ${tbl}(json_extract(json, '$.${p}'))`);
    }
  }
  db.exec('CREATE TABLE IF NOT EXISTS search_docs (rid INTEGER PRIMARY KEY, type TEXT NOT NULL, id TEXT NOT NULL, body TEXT NOT NULL)');
  let fts = false;
  if (!options.disableFts) {
    try {
      db.exec('CREATE VIRTUAL TABLE IF NOT EXISTS search_fts USING fts5(body, type UNINDEXED, id UNINDEXED)');
      fts = true;
    } catch {
      fts = false;
    }
  }

  // Global monotonic insertion counter shared by all tables (also the search rowid).
  let seq = 0;
  for (const t of RECORD_TYPES) {
    const row = db.prepare(`SELECT COALESCE(MAX(created_seq),0) AS m FROM ${tableOf(t)}`).get() as { m: number };
    seq = Math.max(seq, row.m);
  }

  const embeddings = embeddingTable(db);

  const stmts = new Map<string, ReturnType<DatabaseSync['prepare']>>();
  const prep = (sql: string) => {
    let s = stmts.get(sql);
    if (!s) stmts.set(sql, (s = db.prepare(sql)));
    return s;
  };

  let depth = 0;

  function removeSearch(rid: number) {
    prep('DELETE FROM search_docs WHERE rid = ?').run(rid);
    if (fts) prep('DELETE FROM search_fts WHERE rowid = ?').run(rid);
  }

  function put<T extends RecordType>(type: T, record: RecordTypes[T]): RecordTypes[T] {
    const rec = record as { id?: string };
    if (!rec.id || typeof rec.id !== 'string') throw new Error(`record of type ${type} needs a string id`);
    const tbl = tableOf(type);
    const existing = prep(`SELECT created_seq FROM ${tbl} WHERE id = ?`).get(rec.id) as { created_seq: number } | undefined;
    const rid = existing ? existing.created_seq : ++seq;
    prep(`INSERT INTO ${tbl}(id, json, created_seq) VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET json = excluded.json`).run(
      rec.id, JSON.stringify(record), rid,
    );
    if (SEARCH_KINDS.has(type)) {
      const body = searchBody(type, record);
      if (existing) removeSearch(rid);
      if (body !== undefined) {
        prep('INSERT INTO search_docs(rid, type, id, body) VALUES (?,?,?,?)').run(rid, type, rec.id, body);
        if (fts) prep('INSERT INTO search_fts(rowid, body, type, id) VALUES (?,?,?,?)').run(rid, body, type, rec.id);
      }
    }
    return record;
  }

  function whereSql(where: ListOptions['where']): { sql: string; params: Array<string | number> } {
    const parts: string[] = [];
    const params: Array<string | number> = [];
    for (const [k, v] of Object.entries(where ?? {})) {
      if (v === undefined) continue;
      parts.push(`json_extract(json, '${jsonPath(k)}') = ?`);
      params.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
    }
    return { sql: parts.length ? ` WHERE ${parts.join(' AND ')}` : '', params };
  }

  const store: SqliteKnowledgeStore = {
    searchMode: fts ? 'fts5' : 'term-overlap',
    embeddings,
    put,
    putMany(type, records) {
      return store.transaction(() => {
        for (const r of records) put(type, r);
        return records.length;
      });
    },
    get(type, id) {
      const row = prep(`SELECT json FROM ${tableOf(type)} WHERE id = ?`).get(id) as { json: string } | undefined;
      return row ? JSON.parse(row.json) : undefined;
    },
    list(type, options = {}) {
      const { sql, params } = whereSql(options.where);
      let order = 'created_seq ASC';
      if (options.orderBy) {
        const dir = options.orderBy.direction === 'desc' ? 'DESC' : 'ASC';
        order = `json_extract(json, '${jsonPath(options.orderBy.field)}') ${dir}, created_seq ASC`;
      }
      const lim = options.limit !== undefined ? ` LIMIT ${Math.max(0, Math.floor(options.limit))}` : '';
      const rows = db.prepare(`SELECT json FROM ${tableOf(type)}${sql} ORDER BY ${order}${lim}`).all(...params) as Array<{ json: string }>;
      return rows.map((r) => JSON.parse(r.json));
    },
    delete(type, id) {
      const tbl = tableOf(type);
      const row = prep(`SELECT created_seq FROM ${tbl} WHERE id = ?`).get(id) as { created_seq: number } | undefined;
      if (!row) return false;
      prep(`DELETE FROM ${tbl} WHERE id = ?`).run(id);
      if (SEARCH_KINDS.has(type)) removeSearch(row.created_seq);
      return true;
    },
    count(type, where) {
      const { sql, params } = whereSql(where);
      const row = db.prepare(`SELECT COUNT(*) AS c FROM ${tableOf(type)}${sql}`).get(...params) as { c: number };
      return row.c;
    },
    searchText(types, query, limit = 20) {
      const terms = tokenize(query);
      if (!terms.length) return [];
      const typeList = types.map((t) => `'${t}'`).join(',');
      if (fts) {
        const match = terms.map((t) => `"${t}"`).join(' OR ');
        const rows = db
          .prepare(`SELECT type, id, bm25(search_fts) AS s FROM search_fts WHERE search_fts MATCH ? AND type IN (${typeList}) ORDER BY s LIMIT ?`)
          .all(match, limit) as Array<{ type: RecordType; id: string; s: number }>;
        // bm25() is lower-is-better and negative; expose a positive higher-is-better score.
        return rows.map((r) => ({ type: r.type, id: r.id, score: -r.s }));
      }
      // Fallback score: fraction of distinct query terms present in the body (0..1).
      const like = terms.map(() => '(instr(lower(body), ?) > 0)').join(' + ');
      const rows = db
        .prepare(`SELECT type, id, (${like}) AS hits FROM search_docs WHERE type IN (${typeList}) AND (${like}) > 0 ORDER BY hits DESC, rid ASC LIMIT ?`)
        .all(...terms, ...terms, limit) as Array<{ type: RecordType; id: string; hits: number }>;
      return rows.map((r) => ({ type: r.type, id: r.id, score: r.hits / terms.length }));
    },
    transaction(fn) {
      if (depth > 0) {
        depth++;
        try {
          return fn();
        } finally {
          depth--;
        }
      }
      db.exec('BEGIN');
      depth = 1;
      try {
        const r = fn();
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        depth = 0;
      }
    },
    clear() {
      for (const t of RECORD_TYPES) db.exec(`DELETE FROM ${tableOf(t)}`);
      db.exec('DELETE FROM search_docs');
      if (fts) db.exec('DELETE FROM search_fts');
      embeddings.clear();
      seq = 0;
    },
    close() {
      db.close();
    },
  };
  return store;
}
