import type { ImportBatch, ImportCaptured, KnowledgeStore } from '../../libs/utils/contracts/index.ts';
import { buildCaseView, type ImportFromPathResult } from '../../libs/utils/memory/index.ts';

/**
 * B4 "Remember this": the receipt facts of one paste import. Case titles come from the case view as seen with the
 * import's own access groups (a private paste is described to its owner, not widened), names from the entities the
 * commit touched, the time range from the stated stamps of the evidence read (verbatim, never 'now').
 */
export function capturedSummary(store: KnowledgeStore, ids: NonNullable<ImportFromPathResult['ids']>, batch: ImportBatch, accessGroups?: string[]): ImportCaptured {
  const viewer = { id: 'system:capture', groups: accessGroups ?? [] };
  const cases = ids.cases.flatMap((id) => {
    const v = buildCaseView(store, id, viewer);
    return v ? [{ id, title: v.title }] : [];
  });
  const names = (list: string[], person: boolean) =>
    [...new Set(list.map((id) => store.get('entity', id)).filter((e) => e && (e.type === 'person') === person).map((e) => e!.name))];
  const evidence = ids.evidence.map((id) => store.get('evidence', id)).filter((e) => e && e.metadata?.segment !== 'quoted');
  const stamps = evidence.map((e) => e!.eventTime).filter((t) => t.raw || t.iso);
  const show = (t: (typeof stamps)[number] | undefined) => (t ? (t.raw ?? t.iso) : undefined);
  const from = show(stamps[0]);
  const to = show(stamps[stamps.length - 1]);
  const c = batch.counts;
  return {
    cases,
    entities: names(ids.entities, false),
    people: names([...ids.people, ...ids.entities], true),
    ...(from ? { from } : {}),
    ...(to && to !== from ? { to } : {}),
    dateKnown: evidence.some((e) => e!.eventTime.known),
    alreadyKnown: c.inserted === 0 && c.revised === 0,
  };
}
