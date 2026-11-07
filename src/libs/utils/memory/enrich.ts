/**
 * The model half of an import (extract slot on local or api): after the rules proposal of each thread is committed,
 * the model's proposal for the same thread is validated and committed as a union, re-keyed to the rules incidents.
 * Committing second is what gives per-claim provenance: commitProposal never relabels an existing claim, so claims the
 * rules produced keep 'rules' and only claims the model alone proposed carry the model's route.
 *
 * All model calls of one import share one deadline (the extract slot's 60 s). If any call fails or the deadline passes,
 * nothing from the model is committed and the report carries the fallback route; the rules import is already complete.
 */
import type { AccessScope, ConversationContext, ExtractionProposal, KnowledgeStore, RouteInfo } from '../contracts/index.ts';
import { SLOT_TIMEOUT_MS, withFallback } from '../models/providers/index.ts';
import { commitProposal } from './commit.ts';
import { RULES_ROUTE } from './extractor-rules.ts';
import { unionProposal, type DroppedItem, type LlmExtractor } from './extractor-llm.ts';

export interface EnrichItem {
  ctx: ConversationContext;
  /** The rules proposal as committed (after assignEpisodes re-keyed its incidents). */
  proposal: ExtractionProposal;
}

export interface EnrichOptions {
  orgId: string;
  accessScope: AccessScope;
  now?: string;
  /** Deadline for all model calls of this import (default the extract slot's 60 s). */
  timeoutMs?: number;
  onFailure?: (reason: string, code: string) => void;
}

export interface EnrichReport {
  /** The model's route, or the rules route marked as a fallback ("rules-extractor@1[fallback:extract:timeout]"). */
  route: RouteInfo;
  threads: number;
  /** Claims committed with the model's route (proposed by the model alone). */
  modelClaimIds: string[];
  /** Items the evidence validator removed. */
  dropped: DroppedItem[];
  fallback?: { reason: string; code: string };
}

export async function enrichWithModel(store: KnowledgeStore, items: EnrichItem[], extractor: LlmExtractor, opts: EnrichOptions): Promise<EnrichReport> {
  const work = items.filter((i) => i.ctx.evidence.length > 0);
  const r = await withFallback(
    'extract',
    async () => {
      const out = [];
      for (const it of work) out.push({ it, v: await extractor.extractValidated(it.ctx) });
      return out;
    },
    () => null,
    {
      route: extractor.route, rulesRoute: RULES_ROUTE, timeoutMs: opts.timeoutMs ?? SLOT_TIMEOUT_MS.extract,
      ...(opts.onFailure ? { onFailure: (_s, reason, code) => opts.onFailure!(reason, code) } : {}),
    },
  );
  if (!r.value) return { route: r.route, threads: work.length, modelClaimIds: [], dropped: [], ...(r.fallback ? { fallback: { reason: r.fallback.reason, code: r.fallback.code } } : {}) };
  const modelClaimIds = new Set<string>();
  const dropped: DroppedItem[] = [];
  for (const { it, v } of r.value) {
    dropped.push(...v.dropped);
    const res = commitProposal(store, unionProposal(it.proposal, v.proposal), it.ctx, { orgId: opts.orgId, accessScope: opts.accessScope, ...(opts.now ? { now: opts.now } : {}) });
    for (const id of res.claimIds) {
      const c = store.get('claim', id);
      if (c && c.extraction.version === extractor.route.version) modelClaimIds.add(id);
    }
  }
  return { route: r.route, threads: work.length, modelClaimIds: [...modelClaimIds], dropped };
}

export { modelProvenance } from './provenance.ts';
