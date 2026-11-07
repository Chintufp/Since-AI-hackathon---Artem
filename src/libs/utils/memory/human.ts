import type { Claim, Correction, KnowledgeStore } from '../contracts/index.ts';
import { stableId } from '../contracts/index.ts';

/** Corrections recorded by a human for a target id (any change type), oldest first. */
export function correctionsFor(store: KnowledgeStore, targetType: Correction['target']['type'], id: string): Correction[] {
  return store.list('correction').filter((c) => c.target.type === targetType && c.target.id === id);
}

/** True when a human set this link's status (confirm or reject); the system must not move it afterwards. */
export function linkSetByHuman(store: KnowledgeStore, linkId: string): boolean {
  return correctionsFor(store, 'link', linkId).length > 0;
}

/** True when the latest human correction on this claim (directly, via its outcome, or via its case) is a confirm. */
export function claimConfirmedByHuman(store: KnowledgeStore, claim: Claim): boolean {
  const all = [
    ...correctionsFor(store, 'claim', claim.id),
    ...(claim.caseId ? correctionsFor(store, 'outcome', stableId('outcome', claim.caseId, claim.id)) : []),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return all.at(-1)?.change === 'confirm';
}
