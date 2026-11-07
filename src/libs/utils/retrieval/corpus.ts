import type { Claim, Condition, KnowledgeStore } from '../contracts/index.ts';
import { validAt } from '../memory/validity.ts';
import { evidenceGate, gateAt, visibleCase, type PrincipalLike } from './access.ts';

/** B1: claims that count at a moment: valid at `atMs`; without a moment (now), everything but superseded claims. */
export const countsAt = (c: Claim, atMs?: number): boolean => (atMs === undefined ? c.status !== 'superseded' : validAt(c, atMs));
const liveOrSuperseded = (c: Claim): boolean => c.status === 'provisional' || c.status === 'supported' || c.status === 'superseded';

export interface CorpusDoc {
  key: string;
  kind: 'case' | 'procedure';
  id: string;
  title: string;
  text: string;
  entityIds: string[];
  conditions: Condition[];
  /** For a procedure: the visible supporting cases. */
  supportingCaseIds: string[];
}

export const conditionLabel = (c: Condition): string => c.label ?? `${c.key} ${c.operator} ${c.value === undefined ? '' : String(c.value)}`.trim();

/**
 * Builds the searchable corpus visible to a principal: case title + visible claim statements + condition labels +
 * entity names/aliases, and procedures (purpose, steps, condition labels). Access scope is applied here, so nothing
 * downstream can leak a case the principal may not see.
 */
export function buildCorpus(store: KnowledgeStore, principal: PrincipalLike, atMs?: number): CorpusDoc[] {
  const base = evidenceGate(store, principal);
  const gate = atMs === undefined ? base : gateAt(store, base, atMs);
  const entities = new Map(store.list('entity').filter((e) => e.type !== 'person').map((e) => [e.id, e] as const));
  const claimsByCase = new Map<string, string[]>();
  // B1: at a past moment the case's conditions come from its condition claims valid then (the stored ones are the now view).
  const conditionsAt = new Map<string, Condition[]>();
  for (const cl of store.list('claim')) {
    if (!cl.caseId || !gate.scope(cl.accessScope) || !gate.supported(cl.supporting) || !countsAt(cl, atMs)) continue;
    if (atMs !== undefined && cl.type === 'condition' && cl.condition && liveOrSuperseded(cl)) {
      const refs = gate.refs(cl.supporting);
      if (refs.length) conditionsAt.set(cl.caseId, [...(conditionsAt.get(cl.caseId) ?? []), { ...cl.condition, evidence: refs }]);
    }
    const arr = claimsByCase.get(cl.caseId) ?? [];
    arr.push(cl.statement);
    claimsByCase.set(cl.caseId, arr);
  }
  const names = (ids: string[]): string[] =>
    ids.flatMap((id) => {
      const e = entities.get(id);
      return e ? [e.name, ...e.aliases] : [];
    });

  const docs: CorpusDoc[] = [];
  const visibleCases = new Set<string>();
  for (const raw of store.list('case')) {
    // A merged case may carry evidence the principal cannot see: that evidence contributes no condition and no claim,
    // and a case with no visible evidence at all is not in the corpus.
    const seen = visibleCase(raw, gate);
    if (!seen) continue;
    const c = atMs === undefined ? seen : { ...seen, conditions: conditionsAt.get(seen.id) ?? [] };
    visibleCases.add(c.id);
    docs.push({
      key: `case:${c.id}`, kind: 'case', id: c.id, title: c.title, entityIds: c.entityIds, conditions: c.conditions, supportingCaseIds: [],
      text: [c.title, ...(claimsByCase.get(c.id) ?? []), ...c.conditions.map(conditionLabel), ...names(c.entityIds)].join('\n'),
    });
  }
  const caseEntities = new Map(store.list('case').map((c) => [c.id, c.entityIds] as const));
  for (const p of store.list('procedure')) {
    const visible = p.supportingCaseIds.filter((id) => visibleCases.has(id));
    if (p.supportingCaseIds.length > 0 && visible.length === 0) continue;
    const entityIds = [...new Set(visible.flatMap((id) => caseEntities.get(id) ?? []))];
    const visibleConditions = p.conditions.filter((x) => gate.supported(x.evidence)).map((x) => ({ ...x, evidence: gate.refs(x.evidence) }));
    docs.push({
      key: `procedure:${p.id}`, kind: 'procedure', id: p.id, title: p.purpose, entityIds, conditions: visibleConditions, supportingCaseIds: visible,
      text: [p.purpose, ...p.steps, ...p.verification, ...visibleConditions.map(conditionLabel), ...names(entityIds)].join('\n'),
    });
  }
  return docs;
}
