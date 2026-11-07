import type { Condition, KnowledgeStore } from '../contracts/index.ts';
import { canSee, type PrincipalLike } from './access.ts';

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
export function buildCorpus(store: KnowledgeStore, principal: PrincipalLike): CorpusDoc[] {
  const entities = new Map(store.list('entity').filter((e) => e.type !== 'person').map((e) => [e.id, e] as const));
  const claimsByCase = new Map<string, string[]>();
  for (const cl of store.list('claim')) {
    if (!cl.caseId || !canSee(cl.accessScope, principal)) continue;
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
  for (const c of store.list('case')) {
    if (!canSee(c.accessScope, principal)) continue;
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
    docs.push({
      key: `procedure:${p.id}`, kind: 'procedure', id: p.id, title: p.purpose, entityIds, conditions: p.conditions, supportingCaseIds: visible,
      text: [p.purpose, ...p.steps, ...p.verification, ...p.conditions.map(conditionLabel), ...names(entityIds)].join('\n'),
    });
  }
  return docs;
}
