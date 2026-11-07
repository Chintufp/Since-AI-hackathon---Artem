import type { CandidateMatch, KnowledgeStore, RetrievalQuery, Retriever, RouteInfo } from '../contracts/index.ts';
import { routeInfo } from '../models/routes.ts';
import { withFallback } from '../models/providers/fallback.ts';
import { Bm25Index } from './bm25.ts';
import { compareConditions, type CompareOptions } from './conditions.ts';
import { buildCorpus, conditionLabel, type CorpusDoc } from './corpus.ts';
import { evidenceGate } from './access.ts';
import type { EmbeddingIndex } from './embedding-index.ts';
import { rankExact, resolveEntityIds } from './exact.ts';
import { TrigramIndex } from './vector.ts';

export interface RankedList {
  name: string;
  weight: number;
  hits: Array<{ key: string; score: number }>;
}

/** Weighted reciprocal rank fusion. Returns fused score and which lists contributed. */
export function reciprocalRankFusion(lists: RankedList[], k = 60): Array<{ key: string; score: number; sources: string[] }> {
  const acc = new Map<string, { score: number; sources: string[] }>();
  for (const l of lists) {
    l.hits.forEach((h, i) => {
      const e = acc.get(h.key) ?? { score: 0, sources: [] };
      e.score += l.weight / (k + i + 1);
      e.sources.push(l.name);
      acc.set(h.key, e);
    });
  }
  return [...acc].map(([key, v]) => ({ key, ...v })).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

/** Keep only hits scoring at least `rel` x the list's best, so weak lexical/vector noise never enters the fusion. */
export const pruneRelative = (hits: Array<{ key: string; score: number }>, rel: number): Array<{ key: string; score: number }> => {
  const top = hits[0]?.score ?? 0;
  return hits.filter((h) => h.score >= rel * top);
};

export interface RetrieverOptions extends CompareOptions {
  /** Relative score floors per ranked list (fraction of that list's best hit). */
  minRelative?: { bm25?: number; vector?: number };
  /** Include the local hashed-trigram route (default true). It is local and not learned. */
  vector?: boolean;
  rrfK?: number;
  weights?: { bm25?: number; exact?: number; vector?: number };
  /**
   * The embed slot (BUILD_BRIEF 2.1): a list of cases similar in meaning, from a local model's vectors. When given it
   * takes the place of the hashed-trigram list (the slot's rules fallback); when the query cannot be embedded the
   * trigram list is used for that call and the route says so.
   */
  embedding?: {
    index: EmbeddingIndex; weight?: number; minRelative?: number; timeoutMs?: number; onFailure?: (reason: string, code?: string) => void;
    /** A reason to skip the query embedding now (the slot is cooling down after a timeout): the trigram list stands in, labelled 'cooldown'. */
    skip?: () => string | undefined;
  };
}

const queryText = (q: RetrievalQuery): string => [q.text, ...q.conditions.map(conditionLabel)].join('\n');

function toCandidate(doc: CorpusDoc, score: number, retrieval: RouteInfo, q: RetrievalQuery, sources: string[], opts: CompareOptions, entityNames: string[]): CandidateMatch {
  const cmp = compareConditions(q.conditions, doc.conditions, opts);
  const reasons: string[] = [];
  if (entityNames.length) reasons.push(`same ${entityNames.length > 1 ? 'assets' : 'asset'}: ${entityNames.join(', ')}`);
  if (sources.includes('bm25')) reasons.push('lexical overlap with the problem text');
  if (sources.includes('trigram-hash')) reasons.push('character-level similarity (local hashed trigrams, not learned)');
  const embed = sources.find((s) => s.startsWith('embed:'));
  if (embed) reasons.push(`similar in meaning (local model ${embed.slice('embed:'.length)})`);
  if (cmp.matching.length) reasons.push(`matching conditions: ${cmp.matching.map(conditionLabel).join('; ')}`);
  if (cmp.conflicting.length) reasons.push(`conflicting conditions: ${cmp.conflicting.map(conditionLabel).join('; ')}`);
  if (cmp.missing.length) reasons.push(`not yet known for this problem: ${cmp.missing.map((m) => m.label).join('; ')}`);
  return {
    ...(doc.kind === 'case' ? { caseId: doc.id } : { procedureId: doc.id }),
    score,
    retrieval,
    matchingConditions: cmp.matching,
    conflictingConditions: cmp.conflicting,
    missingConditions: cmp.missing,
    expectedTraits: cmp.expectedTraits,
    reasons,
  };
}

/** Merge a procedure candidate into the candidate of a case that supports it. */
function mergeProcedures(cands: CandidateMatch[], docs: Map<string, CorpusDoc>): CandidateMatch[] {
  const byCase = new Map(cands.filter((c) => c.caseId).map((c) => [c.caseId as string, c] as const));
  const out: CandidateMatch[] = [];
  for (const c of cands) {
    if (c.procedureId && !c.caseId) {
      const doc = docs.get(`procedure:${c.procedureId}`);
      const host = doc?.supportingCaseIds.map((id) => byCase.get(id)).find(Boolean);
      if (host && !host.procedureId) {
        host.procedureId = c.procedureId;
        host.reasons.push(`derived procedure ${c.procedureId} cites this case`);
        continue;
      }
    }
    out.push(c);
  }
  return out;
}

abstract class Base implements Retriever {
  abstract route: RouteInfo;
  protected store: KnowledgeStore;
  protected opts: RetrieverOptions;
  constructor(store: KnowledgeStore, opts: RetrieverOptions = {}) {
    this.store = store;
    this.opts = opts;
  }
  protected abstract lists(docs: CorpusDoc[], q: RetrievalQuery, entityIds: string[]): RankedList[];
  /** Lists that need an await (the embedding list); default: the synchronous ones. */
  protected async allLists(docs: CorpusDoc[], q: RetrievalQuery, entityIds: string[]): Promise<RankedList[]> {
    return this.lists(docs, q, entityIds);
  }

  async search(q: RetrievalQuery): Promise<CandidateMatch[]> {
    const docs = buildCorpus(this.store, q.requesterPrincipal);
    const byKey = new Map(docs.map((d) => [d.key, d] as const));
    const entities = this.store.list('entity');
    const { ids: entityIds } = resolveEntityIds(q.text, entities, q.entityIds);
    const lists = await this.allLists(docs, q, entityIds);
    const fused = reciprocalRankFusion(lists, this.opts.rrfK ?? 60);
    const maxScore = lists.reduce((s, l) => s + l.weight / ((this.opts.rrfK ?? 60) + 1), 0) || 1;
    const nameOf = new Map(entities.map((e) => [e.id, e.name] as const));
    const cands = fused.slice(0, Math.max(q.k * 2, q.k)).flatMap((f) => {
      const doc = byKey.get(f.key);
      if (!doc) return [];
      const sharedNames = doc.entityIds.filter((id) => entityIds.includes(id)).map((id) => nameOf.get(id) ?? id);
      const c = toCandidate(doc, 0, this.route, q, f.sources, this.opts, sharedNames);
      // Condition-aware adjustment: normalised fusion score, plus agreement, minus conflicts (bounded).
      const known = c.matchingConditions.length + c.conflictingConditions.length + c.missingConditions.length;
      const matchFrac = known ? c.matchingConditions.length / known : 0;
      c.score = Math.max(0, f.score / maxScore + 0.2 * matchFrac - 0.1 * Math.min(2, c.conflictingConditions.length));
      return [c];
    });
    return mergeProcedures(cands, byKey).sort((a, b) => b.score - a.score).slice(0, q.k);
  }
}

export class Bm25Retriever extends Base {
  route = routeInfo('bm25');
  protected lists(docs: CorpusDoc[], q: RetrievalQuery): RankedList[] {
    return [{ name: 'bm25', weight: 1, hits: pruneRelative(new Bm25Index(docs).search(queryText(q)), this.opts.minRelative?.bm25 ?? 0.15) }];
  }
}

export class ExactIdRetriever extends Base {
  route = routeInfo('exact-id');
  protected lists(docs: CorpusDoc[], _q: RetrievalQuery, entityIds: string[]): RankedList[] {
    return [{ name: 'exact-id', weight: 1, hits: rankExact(docs, entityIds) }];
  }
}

export class TrigramVectorRetriever extends Base {
  route = routeInfo('trigram-hash');
  protected lists(docs: CorpusDoc[], q: RetrievalQuery): RankedList[] {
    return [{ name: 'trigram-hash', weight: 1, hits: pruneRelative(new TrigramIndex(docs).search(queryText(q), 50, 0.2), this.opts.minRelative?.vector ?? 0.5) }];
  }
}

/** The embedding list for one query, or why it could not be made. Shared by HybridRetriever and EmbeddingRetriever. */
async function embeddingList(store: KnowledgeStore, emb: NonNullable<RetrieverOptions['embedding']>, docs: CorpusDoc[], q: RetrievalQuery): Promise<{ list?: RankedList; failure?: string }> {
  if (!emb.index.available) return { failure: 'no-table' };
  if (emb.skip?.()) return { failure: 'cooldown' };
  const visible = new Set(docs.filter((d) => d.kind === 'case').map((d) => d.key));
  const r = await withFallback('embed', () => emb.index.search(queryText(q), visible, evidenceGate(store, q.requesterPrincipal)), () => undefined, {
    route: { route: 'local', version: `ollama-embed@1:${emb.index.model}` }, rulesRoute: routeInfo('trigram-hash'), ...(emb.timeoutMs ? { timeoutMs: emb.timeoutMs } : {}),
    ...(emb.onFailure ? { onFailure: (_s: string, reason: string, code: string) => emb.onFailure!(reason, code) } : {}),
  });
  if (!r.value) return { failure: r.fallback?.code ?? 'error' };
  return { list: { name: r.value.name, weight: emb.weight ?? 1, hits: pruneRelative(r.value.hits, emb.minRelative ?? 0.75) } };
}

/** BM25 + exact-identifier (+ optional local trigram vectors, or the embed slot's list) fused with reciprocal rank fusion. */
export class HybridRetriever extends Base {
  route: RouteInfo;
  /** Why the embedding list was not used in the last search (the trigram list stood in), if it was configured. */
  lastEmbeddingFailure?: string;
  constructor(store: KnowledgeStore, opts: RetrieverOptions = {}) {
    super(store, opts);
    this.route =
      opts.vector === false
        ? { route: 'rules', version: 'hybrid-rrf@1(bm25+exact-id)' }
        : { route: 'local', version: 'hybrid-rrf@1(bm25+exact-id+trigram-hash[local,not-learned])' };
  }
  protected lists(docs: CorpusDoc[], q: RetrievalQuery, entityIds: string[]): RankedList[] {
    const w = this.opts.weights ?? {};
    const lists: RankedList[] = [
      { name: 'bm25', weight: w.bm25 ?? 1, hits: pruneRelative(new Bm25Index(docs).search(queryText(q)), this.opts.minRelative?.bm25 ?? 0.15) },
      { name: 'exact-id', weight: w.exact ?? 1, hits: rankExact(docs, entityIds) },
    ];
    if (this.opts.vector !== false) lists.push(this.trigramList(docs, q));
    return lists;
  }
  private trigramList(docs: CorpusDoc[], q: RetrievalQuery): RankedList {
    return { name: 'trigram-hash', weight: this.opts.weights?.vector ?? 0.7, hits: pruneRelative(new TrigramIndex(docs).search(queryText(q), 50, 0.2), this.opts.minRelative?.vector ?? 0.5) };
  }
  protected override async allLists(docs: CorpusDoc[], q: RetrievalQuery, entityIds: string[]): Promise<RankedList[]> {
    const emb = this.opts.embedding;
    if (!emb) return this.lists(docs, q, entityIds);
    const base = this.lists(docs, q, entityIds).filter((l) => l.name !== 'trigram-hash');
    const { list, failure } = await embeddingList(this.store, emb, docs, q);
    const core = 'hybrid-rrf@1(bm25+exact-id';
    if (list) {
      this.lastEmbeddingFailure = undefined;
      this.route = { route: 'local', version: `${core})+embed[local:${emb.index.model}]` };
      return [...base, list];
    }
    // The embed slot's rules fallback: hashed trigrams, labelled with the reason.
    this.lastEmbeddingFailure = failure;
    this.route = { route: 'local', version: `${core}+trigram-hash[local,not-learned])+embed[fallback:${failure}]` };
    return [...base, this.trigramList(docs, q)];
  }
}

/** The embed slot alone (E08 arm): cases similar in meaning; falls back to trigrams when the query cannot be embedded. */
export class EmbeddingRetriever extends Base {
  route: RouteInfo;
  constructor(store: KnowledgeStore, opts: RetrieverOptions & { embedding: NonNullable<RetrieverOptions['embedding']> }) {
    super(store, opts);
    this.route = { route: 'local', version: `embed@1[local:${opts.embedding.index.model}]` };
  }
  protected lists(docs: CorpusDoc[], q: RetrievalQuery): RankedList[] {
    return [{ name: 'trigram-hash', weight: 1, hits: pruneRelative(new TrigramIndex(docs).search(queryText(q), 50, 0.2), this.opts.minRelative?.vector ?? 0.5) }];
  }
  protected override async allLists(docs: CorpusDoc[], q: RetrievalQuery): Promise<RankedList[]> {
    const emb = this.opts.embedding!;
    const { list, failure } = await embeddingList(this.store, emb, docs, q);
    if (list) return [{ ...list, weight: 1 }];
    this.route = { route: 'local', version: `embed@1[fallback:${failure}]+trigram-hash@1` };
    return this.lists(docs, q);
  }
}
