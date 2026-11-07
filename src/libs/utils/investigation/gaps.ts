import type { Gap } from '../contracts/index.ts';
import { stableId } from '../contracts/index.ts';
import { isSoftCondition } from '../retrieval/conditions.ts';
import { casePhrase, plainLabel } from './phrases.ts';
import type { HypothesisDetail } from './types.ts';
import type { InvestigationSettings } from './settings.ts';

export type GapKind = 'missing' | 'outcome' | 'lasting';

export const makeGapId = (investigationId: string, kind: GapKind, caseId: string, detail: string): string =>
  ['gap', investigationId, kind, caseId, detail].join('|');

export function parseGapId(id: string): { investigationId: string; kind: GapKind; caseId: string; detail: string } | undefined {
  const [tag, investigationId, kind, caseId, ...rest] = id.split('|');
  if (tag !== 'gap' || !investigationId || !caseId || (kind !== 'missing' && kind !== 'outcome' && kind !== 'lasting')) return undefined;
  return { investigationId, kind, caseId, detail: rest.join('|') };
}

export interface GapInput {
  investigationId: string;
  detail: HypothesisDetail;
  settings: Pick<InvestigationSettings, 'distinguishingKeys' | 'requesterObservableKeys' | 'hedgeMarkers' | 'phrases'>;
}

/**
 * Gaps for the hypothesis the recommendation currently depends on.
 * - Each missing DISTINGUISHING condition is a consequential gap (it decides applicability). If the requester can
 *   observe it themselves it is still a gap, but the description says to check it and no human question follows.
 * - A case condition that is hedged in its source or only inferred never creates a gap (unknown stays unknown, but it
 *   is not worth interrupting anyone for); it still shows up as an unknown in the candidate and the caveats.
 * - A reported-performed corrective action with no recovery outcome is consequential (the corrective recommendation
 *   depends on it); a recovery whose lasting effect is unknown is NOT consequential when support is already 'supported'.
 */
export function buildGaps({ investigationId, detail, settings }: GapInput): Gap[] {
  const { hypothesis, candidate, facts } = detail;
  const caseId = candidate.caseId;
  if (!caseId || hypothesis.applicability === 'inapplicable' || hypothesis.support === 'contradicted') return [];
  const gaps: Gap[] = [];
  const dKeys = new Set(settings.distinguishingKeys);
  const obsKeys = new Set(settings.requesterObservableKeys);

  const label = detail.label;
  for (const m of candidate.missingConditions.filter((x) => dKeys.has(x.key))) {
    const trait = candidate.expectedTraits.find((t) => t.condition.key === m.key);
    const claim = facts?.allClaims.find((c) => c.condition?.key === m.key);
    const caseCond = facts?.case?.conditions.find((c) => c.key === m.key);
    if ((caseCond && isSoftCondition(caseCond, settings.hedgeMarkers)) || isSoftCondition({ origin: 'reported', label: m.label }, settings.hedgeMarkers)) continue;
    const word = plainLabel(m.label, settings.hedgeMarkers);
    const canSelfCheck = obsKeys.has(m.key);
    gaps.push({
      id: makeGapId(investigationId, 'missing', caseId, m.key),
      description: canSelfCheck
        ? `Unknown for this problem: ${word}. The requester can check this directly.`
        : `Unknown for this problem: ${word}. It decides whether the response from ${label} applies.`,
      consequential: true,
      whatAnswerChanges: `If ${word} holds here, the response from ${label} becomes applicable (currently qualified); if it does not, it becomes inapplicable and the recommendation reverts to retaining uncertainty.`,
      ...(claim ? { targetClaimId: claim.id } : {}),
      targetCondition: { key: m.key, label: trait?.condition.label ?? m.label },
      status: 'open',
    });
  }

  const primary = facts?.corrective;
  if (primary && facts) {
    const actionPhrase = (a: string, p: typeof settings.phrases) => casePhrase(a, facts.evidenceText, p);
    if (hypothesis.support === 'weak' && primary.performed === 'reported') {
      gaps.push({
        id: makeGapId(investigationId, 'outcome', caseId, primary.id),
        description: `No recovery outcome is recorded after ${actionPhrase(primary.action, settings.phrases).noun} in ${label}.`,
        consequential: true,
        whatAnswerChanges: `If recovery followed ${actionPhrase(primary.action, settings.phrases).noun}, the response becomes supported and can be recommended (subject to applicability); if not, the hypothesis is contradicted and uncertainty is retained.`,
        status: 'open',
      });
    } else if (hypothesis.support === 'supported' && facts.primaryOutcomes.some((o) => o.result === 'recovered' && o.lasting === 'unknown')) {
      gaps.push({
        id: makeGapId(investigationId, 'lasting', caseId, primary.id),
        description: `Whether recovery after ${actionPhrase(primary.action, settings.phrases).noun} in ${label} lasted is unknown.`,
        consequential: false,
        whatAnswerChanges: 'Would show whether the recovery lasted. The current recommendation already labels the outcome as a single reported result, so it would not change today\'s action.',
        status: 'open',
      });
    }
  }
  return gaps;
}

/** Stable id for a gap-derived question trace; exported for tests/consumers. */
export const gapTraceId = (gapId: string): string => stableId('gt', gapId);
