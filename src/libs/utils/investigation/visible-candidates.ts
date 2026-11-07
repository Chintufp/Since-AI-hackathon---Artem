import type { CandidateMatch, Condition, KnowledgeStore } from '../contracts/index.ts';
import { conditionLabel } from '../retrieval/corpus.ts';
import { visibleCase, type EvidenceGate } from '../retrieval/access.ts';

const REASON_PREFIXES = {
  matching: 'matching conditions: ',
  conflicting: 'conflicting conditions: ',
  missing: 'not yet known for this problem: ',
} as const;

/**
 * Defence in depth behind the retriever: whatever retriever produced the candidates, a requester only gets candidates and
 * condition comparisons that rest on evidence they may see.
 * - a case with no visible evidence is not a candidate;
 * - a condition (matching, conflicting, expected trait) whose supporting evidence is entirely invisible is removed, and a
 *   condition of the case that is hidden is never reported as "still unknown" either (that would reveal its existence);
 * - references that remain are trimmed to the visible ones; reason strings that list conditions are rebuilt from what is left.
 */
export function visibleCandidates(store: KnowledgeStore, candidates: CandidateMatch[], gate: EvidenceGate): CandidateMatch[] {
  const out: CandidateMatch[] = [];
  for (const c of candidates) {
    const hiddenKeys = new Set<string>();
    if (c.caseId) {
      const raw = store.get('case', c.caseId);
      const seen = raw ? visibleCase(raw, gate) : undefined;
      if (!raw || !seen) continue;
      const shown = new Set(seen.conditions.map((x) => x.key));
      for (const x of raw.conditions) if (!shown.has(x.key)) hiddenKeys.add(x.key);
    } else if (c.procedureId) {
      const proc = store.get('procedure', c.procedureId);
      if (!proc) continue;
      for (const x of proc.conditions) if (!gate.supported(x.evidence)) hiddenKeys.add(x.key);
    }
    const cond = (xs: Condition[]): Condition[] =>
      xs.filter((x) => !hiddenKeys.has(x.key) && gate.supported(x.evidence)).map((x) => ({ ...x, evidence: gate.refs(x.evidence) }));
    const matching = cond(c.matchingConditions);
    const conflicting = cond(c.conflictingConditions);
    const missing = c.missingConditions.filter((m) => !hiddenKeys.has(m.key));
    const reasons: string[] = [];
    for (const r of c.reasons) {
      if (r.startsWith(REASON_PREFIXES.matching)) {
        if (matching.length) reasons.push(`${REASON_PREFIXES.matching}${matching.map(conditionLabel).join('; ')}`);
      } else if (r.startsWith(REASON_PREFIXES.conflicting)) {
        if (conflicting.length) reasons.push(`${REASON_PREFIXES.conflicting}${conflicting.map(conditionLabel).join('; ')}`);
      } else if (r.startsWith(REASON_PREFIXES.missing)) {
        if (missing.length) reasons.push(`${REASON_PREFIXES.missing}${missing.map((m) => m.label).join('; ')}`);
      } else reasons.push(r);
    }
    out.push({
      ...c, matchingConditions: matching, conflictingConditions: conflicting, missingConditions: missing, reasons,
      expectedTraits: c.expectedTraits.filter((t) => !hiddenKeys.has(t.condition.key) && gate.supported(t.basis)).map((t) => ({ ...t, basis: gate.refs(t.basis) })),
    });
  }
  return out;
}
