import type { EligibleAction, PolicyDecision, SelectorContext } from '../contracts/index.ts';
import { stableId } from '../contracts/index.ts';

/** Visible per-action features used by learned selectors. Hidden scenario truth never appears here. */
export const FEATURE_NAMES = [
  'consequential',
  'firsthand',
  'recipientOpenQuestions',
  'recipientAskedToday',
  'candidateCount',
  'gapDecidesApplicability',
  'hypothesisSupportLevel',
] as const;

export type FeatureName = (typeof FEATURE_NAMES)[number];

export const SUPPORT_LEVEL = { supported: 1, weak: 0.5, unknown: 0.25, contradicted: 0 } as const;

export const actionKey = (a: EligibleAction): string => `${a.questionId}|${a.personEntityId}`;

/** Fixed-order, bounded vector (bias first) so linear models stay well-conditioned. */
export function vectorize(f: Record<string, number> | undefined): number[] {
  const g = (n: string, cap = 1): number => Math.min(1, Math.max(0, (f?.[n] ?? 0) / cap));
  return [
    1,
    g('consequential'),
    g('firsthand'),
    g('recipientOpenQuestions', 3),
    g('recipientAskedToday', 3),
    g('candidateCount', 5),
    g('gapDecidesApplicability'),
    g('hypothesisSupportLevel'),
  ];
}
export const FEATURE_DIM = 1 + FEATURE_NAMES.length;

export interface SelectorClock {
  clock?: () => Date;
}

export function makeDecision(
  ctx: SelectorContext,
  selector: PolicyDecision['selector'],
  chosen: EligibleAction | 'defer',
  propensity: number,
  reason: string,
  at: Date,
): PolicyDecision {
  const key = chosen === 'defer' ? 'defer' : actionKey(chosen);
  const features = chosen === 'defer' ? undefined : ctx.features[key];
  return {
    id: stableId('dec', ctx.state.id, selector.id, key, ctx.eligible.map(actionKey).sort().join(','), at.toISOString()),
    orgId: ctx.state.orgId,
    investigationId: ctx.state.id,
    selector,
    eligible: ctx.eligible,
    chosen,
    propensity,
    ...(features ? { features } : {}),
    reason,
    at: at.toISOString(),
  };
}
