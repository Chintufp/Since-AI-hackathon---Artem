/**
 * B1: supersession rules, run by commitProposal inside its transaction, before the touched cases are rebuilt.
 *
 * (a) Newer value. A live claim of the same type, with an overlapping subject, the same condition key and qualifier and a
 *     different value, closes the older one: older.validity.to = newer.validity.from, status 'superseded',
 *     supersededBy = newer id, revision + 1. The older claim keeps all its evidence and stays readable. Only keys the
 *     configuration lists (validityCues.newerValueKeys) take part: state readings change all the time and are not facts
 *     that get replaced. When the order rests on import order only (an undated source), the newer claim must carry an
 *     explicit replacement cue ("is now", "changed the lock"); dated claims need none (DECISIONS-engine.md D-B1-08).
 * (b) Superseding note. A claim with a supersessionBound ("fixed in firmware 4.2") does not close anything for everyone:
 *     older live claims of the bound types (hypothesis, advice) about the same subject get
 *     validity.condition = "software.version < 4.2" and validity.conditionedBy = the note (D-B1-07). The recommendation
 *     reads this only when the problem states a version inside the bound.
 * Never touched: claims a human confirmed or corrected, claims that are not live. Nothing is deleted.
 */
import type { Claim, KnowledgeStore } from '../contracts/index.ts';
import { routeInfo } from '../models/routes.ts';
import { isLive } from './case-builder.ts';
import { defaultExtractionConfig, type ValidityCueLexicon } from './extraction-config.ts';
import { claimConfirmedByHuman, correctionsFor } from './human.ts';
import { isNewer } from './validity.ts';

export interface SupersessionOptions {
  orgId: string;
  now: string;
  cues?: ValidityCueLexicon;
}

const humanTouched = (store: KnowledgeStore, c: Claim): boolean => correctionsFor(store, 'claim', c.id).length > 0 || claimConfirmedByHuman(store, c);
const overlap = (a: string[], b: string[]): boolean => a.some((x) => b.includes(x));
const slot = (c: Claim): string => `${c.type}|${c.condition?.key}|${c.condition?.qualifier ?? ''}`;

/** Apply both rules for the claims just committed; returns the case ids whose claims changed (to rebuild). */
export function applySupersession(store: KnowledgeStore, claimIds: string[], opts: SupersessionOptions): string[] {
  const cues = opts.cues ?? defaultExtractionConfig.validityCues;
  const route = routeInfo('supersession-rules');
  const all = store.list('claim', { where: { orgId: opts.orgId } });
  const order = new Map(all.map((c, i) => [c.id, i] as const));
  const importOrder = (id: string): number => order.get(id) ?? -1;
  const byId = new Map(all.map((c) => [c.id, c] as const));
  const touchedCases = new Set<string>();
  const save = (c: Claim): void => {
    store.put('claim', c);
    byId.set(c.id, c);
    if (c.caseId) touchedCases.add(c.caseId);
  };
  const eligible = (c: Claim | undefined): c is Claim => !!c && isLive(c) && !humanTouched(store, c);

  for (const id of claimIds) {
    const fresh = byId.get(id);
    if (!eligible(fresh)) continue;

    // (a) newer value
    if (fresh.condition && fresh.condition.value !== undefined && cues.newerValueKeys.includes(fresh.condition.key)) {
      for (const other of [...byId.values()]) {
        const n = byId.get(fresh.id)!;
        if (!eligible(n)) break;
        if (other.id === n.id || !eligible(other) || slot(other) !== slot(n) || !overlap(other.subjectEntityIds, n.subjectEntityIds)) continue;
        if (other.condition?.value === undefined || String(other.condition.value) === String(n.condition!.value)) continue;
        const forward = isNewer(n, other, importOrder);
        const backward = isNewer(other, n, importOrder);
        const [newer, older, ord] = forward.newer ? [n, other, forward] : backward.newer ? [other, n, backward] : [undefined, undefined, forward];
        if (!newer || !older) continue;
        if (ord.basis === 'import-order' && !newer.validity.cue) continue;
        save({
          ...older, status: 'superseded', supersededBy: newer.id,
          validity: { ...older.validity, to: newer.validity.from ?? { known: false }, orderBasis: ord.basis, route },
          revision: older.revision + 1, updatedAt: opts.now,
        });
      }
    }

    // (b) superseding note
    const bound = fresh.supersessionBound;
    if (bound && bound.value !== undefined) {
      const text = cues.fixedBound.conditionText.replaceAll('{version}', String(bound.value));
      for (const target of [...byId.values()]) {
        if (target.id === fresh.id || !eligible(target) || !cues.boundTypes.includes(target.type)) continue;
        if (!overlap(target.subjectEntityIds, fresh.subjectEntityIds)) continue;
        if (target.validity.conditionedBy && target.validity.conditionedBy !== fresh.id) continue;
        const ord = isNewer(fresh, target, importOrder);
        if (!ord.newer) continue;
        if (target.validity.conditionedBy === fresh.id && target.validity.condition === text) continue;
        save({
          ...target, validity: { ...target.validity, condition: text, conditionedBy: fresh.id, orderBasis: ord.basis, route },
          revision: target.revision + 1, updatedAt: opts.now,
        });
      }
    }
  }
  return [...touchedCases];
}
