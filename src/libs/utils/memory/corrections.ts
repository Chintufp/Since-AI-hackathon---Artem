import type { Claim, Correction, KnowledgeStore } from '../contracts/index.ts';
import { stableId } from '../contracts/index.ts';
import { rebuildCase } from './case-builder.ts';

export interface CorrectionResult {
  correction: Correction;
  claimIds: string[];
  caseIds: string[];
  linkIds: string[];
}

/**
 * Apply a correction and propagate it: claim status, dependent case fields (attempts, outcomes, conditions, gaps, status)
 * and person-link statuses. The Correction itself is recorded; re-applying the same correction id is a no-op.
 */
export function applyCorrection(store: KnowledgeStore, correction: Correction): CorrectionResult {
  return store.transaction(() => {
    const result: CorrectionResult = { correction, claimIds: [], caseIds: [], linkIds: [] };
    const claimStatus = (change: Correction['change']): Claim['status'] | undefined =>
      change === 'retract' ? 'retracted' : change === 'contradict' ? 'contradicted' : change === 'confirm' ? 'supported' : undefined;
    const setClaim = (c: Claim) => {
      const status = claimStatus(correction.change);
      if (!status) throw new Error(`correction change '${correction.change}' is not applicable to a claim`);
      if (c.status !== status) store.put('claim', { ...c, status, revision: c.revision + 1, updatedAt: correction.at });
      result.claimIds.push(c.id);
      if (c.caseId) result.caseIds.push(c.caseId);
    };
    const { target } = correction;
    if (target.type === 'claim') {
      const c = store.get('claim', target.id);
      if (!c) throw new Error(`claim not found: ${target.id}`);
      setClaim(c);
    } else if (target.type === 'outcome') {
      const o = store.get('outcome', target.id);
      if (!o) throw new Error(`outcome not found: ${target.id}`);
      const claim = store.list('claim', { where: { caseId: o.caseId } }).find((c) => stableId('outcome', o.caseId, c.id) === o.id);
      if (!claim) throw new Error(`no claim backs outcome ${o.id}`);
      setClaim(claim);
    } else if (target.type === 'case') {
      const c = store.get('case', target.id);
      if (!c) throw new Error(`case not found: ${target.id}`);
      if (correction.change !== 'retract' && correction.change !== 'contradict') throw new Error('only retract/contradict apply to a case');
      for (const cl of store.list('claim', { where: { caseId: c.id } })) setClaim(cl);
      result.caseIds.push(c.id);
    } else if (target.type === 'link') {
      const l = store.get('personLink', target.id);
      if (!l) throw new Error(`link not found: ${target.id}`);
      const status = correction.change === 'confirm' ? 'confirmed' : correction.change === 'reassign' ? undefined : 'rejected';
      if (!status) throw new Error('reassign is not supported for links in this version');
      store.put('personLink', { ...l, status });
      result.linkIds.push(l.id);
      if (l.caseId) result.caseIds.push(l.caseId);
    } else throw new Error(`unsupported correction target: ${target.type}`);

    store.put('correction', correction);
    result.caseIds = [...new Set(result.caseIds)];
    for (const id of result.caseIds) rebuildCase(store, id, { now: correction.at });
    // Links tied to retracted claims are rejected by rebuildCase; also catch links without a case.
    for (const claimId of result.claimIds) {
      for (const l of store.list('personLink', { where: { claimId } })) if (!result.linkIds.includes(l.id)) result.linkIds.push(l.id);
    }
    return result;
  });
}
