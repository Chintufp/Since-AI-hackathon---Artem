import type { Case, Claim, EvidenceRef, KnowledgeStore } from '../contracts/index.ts';
import { defaultViewConfig, type ViewConfig } from './view-config.ts';

/** Reading position of a reference: evidence order, then offset inside the message. */
export type Position = [number, number];

export const positionOf = (order: Map<string, number>, ref: EvidenceRef | undefined): Position =>
  ref ? [order.get(ref.evidenceId) ?? Infinity, ref.span?.start ?? 0] : [Infinity, Infinity];

export const earliest = (order: Map<string, number>, refs: EvidenceRef[]): Position =>
  refs.map((r) => positionOf(order, r)).sort(cmpPos)[0] ?? [Infinity, Infinity];

export const cmpPos = (a: Position, b: Position): number => (a[0] === b[0] ? a[1] - b[1] : a[0] < b[0] ? -1 : 1);

/**
 * Short case label: asset id + a few words, e.g. "ABC-123 · no traffic after SFP change".
 * The symptom comes from structured conditions through configuration; when none matches, the first words of the
 * problem sentence are used. The long sentence stays in the problem node.
 */
export function caseLabel(
  store: KnowledgeStore,
  c: Pick<Case, 'entityIds'>,
  live: Claim[],
  order: Map<string, number>,
  cfg: ViewConfig = defaultViewConfig,
): string {
  const asset = c.entityIds.map((id) => store.get('entity', id)).find((e) => e && (e.type === 'asset' || e.type === 'site'))?.name;
  const obs = live.filter((x) => x.type === 'observation').sort((a, b) => cmpPos(earliest(order, a.supporting), earliest(order, b.supporting)))[0];
  const problemAt = obs ? earliest(order, obs.supporting) : ([Infinity, Infinity] as Position);
  const conds = live.filter((x) => x.type === 'condition' && x.condition);

  let symptom: string | undefined;
  for (const rule of cfg.symptoms) {
    if (conds.some((x) => x.condition!.key === rule.key && (!rule.values || rule.values.includes(x.condition!.value as never)))) { symptom = rule.phrase; break; }
  }
  let label: string | undefined;
  if (symptom) {
    let after: string | undefined;
    for (const ch of cfg.changes) {
      const hit = conds.find((x) => x.condition!.key === ch.key && cmpPos(earliest(order, x.supporting), problemAt) <= 0);
      if (hit) { after = ch.build(hit.condition!, hit.statement); if (after) break; }
    }
    label = [symptom, after].filter(Boolean).join(' ');
  } else {
    const src = obs?.statement ?? '';
    const clean = (clause: string): string[] =>
      clause
        .replace(/\b[A-Z]{2,5}-\d{2,5}\b/g, ' ')
        .split(/\s+/)
        .map((w) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
        .filter((w) => w && !/^\d+$/.test(w) && !cfg.summaryStopwords.test(w));
    // First clause with real content (skips greetings such as "Hi Ann,").
    const clauses = src.split(/[,;:.!?\n]|\s(?:as|because|while|when)\s/).map(clean);
    const words = clauses.find((w) => w.length >= 3) ?? clauses.find((w) => w.length > 0) ?? [];
    label = words.slice(0, cfg.summaryWords).join(' ').toLowerCase().replace(/[\p{L}\p{N}]+/gu, (w) => (cfg.acronyms.includes(w) ? w.toUpperCase() : w)) || undefined;
  }
  if (asset && label) return `${asset} · ${label}`;
  return asset ?? label ?? 'Case';
}
