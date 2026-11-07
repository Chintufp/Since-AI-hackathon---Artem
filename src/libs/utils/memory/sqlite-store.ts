import { DatabaseSync } from 'node:sqlite';
import type { KnowledgeStore, ListOptions, RecordType, RecordTypes } from '../contracts/index.ts';

export interface StoreOptions {
  /** Force the lexical fallback even when FTS5 exists (used to test both paths). */
  disableFts?: boolean;
}

export interface SqliteKnowledgeStore extends KnowledgeStore {
  /** 'fts5' when FTS5 was available at open, else 'term-overlap' (fraction of query terms found). */
  readonly searchMode: 'fts5' | 'term-overlap';
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
      seq = 0;
    },
    close() {
      db.close();
    },
  };
  return store;
}
