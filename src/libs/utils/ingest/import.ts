import type { EvidenceEnvelope, ImportBatch, KnowledgeStore } from '../contracts/index.ts';
import { stableId } from '../contracts/index.ts';
import { detectCopies, findRetelling } from './copies.ts';

export interface BatchInput {
  orgId: string;
  connectionId: string;
  sourceDescription: string;
  /** Clock injection for tests; defaults to the current time. */
  now?: string;
}

export interface ImportResult {
  batch: ImportBatch;
  /** The stored record for every input envelope, in input order (existing record for duplicates). */
  evidence: EvidenceEnvelope[];
  inserted: string[];
  revised: string[];
  duplicates: string[];
  copies: string[];
  /** Older records that gained copy/retelling lineage because a newer record turned out to be their original. */
  relinked: string[];
}

/**
 * Reverse pass: quoted segments and free-text emails/notes already in the store are re-checked against everything
 * now stored. Same detectors as the forward pass, so the final lineage does not depend on import order.
 */
function relinkExisting(store: KnowledgeStore, result: ImportResult): void {
  const mark = (id: string) => { if (!result.relinked.includes(id)) result.relinked.push(id); };
  for (const seg of store.list('evidence', { where: { 'metadata.segment': 'quoted' } })) {
    if (seg.metadata?.supersededBy) continue;
    const det = detectCopies(store, seg, String(seg.metadata?.sourceKey ?? ''));
    const have = new Set(seg.lineage.copiedFrom ?? []);
    const added = det.copiedFrom.filter((i) => !have.has(i));
    if (!added.length) continue;
    store.put('evidence', { ...seg, lineage: { ...seg.lineage, copiedFrom: union(seg.lineage.copiedFrom, det.copiedFrom) }, metadata: { ...(seg.metadata ?? {}), quotedMatch: det.quoted } });
    mark(seg.id);
    const parent = seg.lineage.derivedFrom?.[0] ? store.get('evidence', seg.lineage.derivedFrom[0]) : undefined;
    if (parent) {
      store.put('evidence', {
        ...parent,
        lineage: { ...parent.lineage, copiedFrom: union(parent.lineage.copiedFrom, det.copiedFrom) },
        metadata: { ...(parent.metadata ?? {}), quotedMatch: det.quoted, retellingOf: undefined },
      });
      mark(parent.id);
      if (!result.copies.includes(parent.id) && result.inserted.concat(result.revised).includes(parent.id)) result.copies.push(parent.id);
    }
  }
  for (const e of store.list('evidence')) {
    if ((e.kind !== 'email' && e.kind !== 'note') || e.metadata?.segment === 'quoted' || e.metadata?.supersededBy) continue;
    if (e.lineage.copiedFrom?.length || e.metadata?.previousRevisionId || e.metadata?.retellingOf) continue;
    const r = findRetelling(store, e, String(e.metadata?.sourceKey ?? ''));
    if (r) {
      store.put('evidence', { ...e, metadata: { ...(e.metadata ?? {}), retellingOf: r } });
      mark(e.id);
    }
  }
}

const union = (a: string[] | undefined, b: string[]): string[] => [...new Set([...(a ?? []), ...b])];

/**
 * Idempotent import. Identity is stableId(orgId, provider, connectionId, sourceId, revision):
 * - same id and same text      -> counted as unchangedDuplicate, nothing written;
 * - same source, new revision  -> new record, metadata.previousRevisionId, old record marked supersededBy;
 * - fingerprint / quoted-chunk matches in another thread -> lineage.copiedFrom (copies are not confirmations).
 */
export function importSources(store: KnowledgeStore, envelopes: EvidenceEnvelope[], input: BatchInput): ImportResult {
  const startedAt = input.now ?? new Date().toISOString();
  return store.transaction(() => {
    const batchId = stableId('batch', input.orgId, input.connectionId, startedAt, store.count('importBatch'));
    const result: ImportResult = { batch: undefined as unknown as ImportBatch, evidence: [], inserted: [], revised: [], duplicates: [], copies: [], relinked: [] };
    for (const original of envelopes) {
      let env: EvidenceEnvelope = structuredClone(original);
      const sourceKey = stableId('src', env.orgId, env.provider, env.connectionId, env.sourceId);
      const existing = store.get('evidence', env.id);
      if (existing) {
        if (existing.lineage.sourceFingerprint === env.lineage.sourceFingerprint) {
          result.duplicates.push(existing.id);
          result.evidence.push(existing);
          continue;
        }
        // Same revision label but different text: treat as a new revision rather than overwrite history.
        const revision = `${env.revision}+${env.lineage.sourceFingerprint.slice(0, 8)}`;
        env = { ...env, revision, id: stableId('ev', env.orgId, env.provider, env.connectionId, env.sourceId, revision) };
        const again = store.get('evidence', env.id);
        if (again) {
          result.duplicates.push(again.id);
          result.evidence.push(again);
          continue;
        }
      }
      const previous = store
        .list('evidence', { where: { 'metadata.sourceKey': sourceKey } })
        .filter((e) => e.id !== env.id && !e.metadata?.supersededBy)
        .at(-1);
      env.lineage = { ...env.lineage, importBatchId: batchId };
      env.metadata = { ...(env.metadata ?? {}), sourceKey, ...(previous ? { previousRevisionId: previous.id } : {}) };

      const det = detectCopies(store, env, sourceKey);
      if (det.copiedFrom.length) env.lineage.copiedFrom = union(env.lineage.copiedFrom, det.copiedFrom);
      if (det.quoted) env.metadata = { ...env.metadata, quotedMatch: det.quoted };
      if (!env.lineage.copiedFrom?.length && !previous) {
        const r = findRetelling(store, env, sourceKey);
        if (r) env.metadata = { ...env.metadata, retellingOf: r };
      }
      store.put('evidence', env);
      if (previous) {
        store.put('evidence', { ...previous, metadata: { ...(previous.metadata ?? {}), supersededBy: env.id } });
        result.revised.push(env.id);
      } else result.inserted.push(env.id);
      if (env.lineage.copiedFrom?.length) result.copies.push(env.id);

      // A quoted segment that matches existing evidence marks its parent email as a copy-bearing retelling.
      if (env.metadata?.segment === 'quoted' && det.copiedFrom.length) {
        const parentId = env.lineage.derivedFrom?.[0];
        const parent = parentId ? store.get('evidence', parentId) : undefined;
        if (parent) {
          const had = !!parent.lineage.copiedFrom?.length;
          const updated: EvidenceEnvelope = {
            ...parent,
            lineage: { ...parent.lineage, copiedFrom: union(parent.lineage.copiedFrom, det.copiedFrom) },
            metadata: { ...(parent.metadata ?? {}), quotedMatch: det.quoted, retellingOf: undefined },
          };
          store.put('evidence', updated);
          if (!had && result.inserted.concat(result.revised).includes(parent.id)) result.copies.push(parent.id);
        }
      }
      result.evidence.push(store.get('evidence', env.id)!);
    }
    // Order independence: the original may arrive after its copy, so also look from existing records to the new ones.
    if (result.inserted.length || result.revised.length) relinkExisting(store, result);
    // Re-read so records updated later in the loop (e.g. a parent email that gained copiedFrom) are current.
    result.evidence = result.evidence.map((e) => store.get('evidence', e.id) ?? e);
    const batch: ImportBatch = {
      id: batchId,
      orgId: input.orgId,
      connectionId: input.connectionId,
      startedAt,
      finishedAt: new Date().toISOString(),
      counts: {
        seen: envelopes.length,
        inserted: result.inserted.length,
        unchangedDuplicates: result.duplicates.length,
        revised: result.revised.length,
        copies: result.copies.length,
      },
      sourceDescription: input.sourceDescription,
    };
    store.put('importBatch', batch);
    result.batch = batch;
    return result;
  });
}
