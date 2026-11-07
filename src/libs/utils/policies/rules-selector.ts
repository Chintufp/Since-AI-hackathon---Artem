import type { EvaluationRecord, PolicyDecision, Selector, SelectorContext } from '../contracts/index.ts';
import { actionKey, makeDecision, type SelectorClock } from './features.ts';
import { valuePerCost } from './value-cost.ts';

export interface RulesSelectorOptions extends SelectorClock {
  /** Defer when the best score is below this. */
  threshold?: number;
}

/**
 * Deterministic baseline and the bandit's fixed prior.
 * Gate (unchanged): score = consequential x (firsthand ? 1 : 0.6) x 1/(1+openQuestionsForPerson) x recency
 * (recency defaults to 1 when unknown: unknown recency neither rewards nor penalises). Defers when nothing is eligible
 * or no pair reaches the threshold.
 * Order (brief 5.3, D-B2-67): among the pairs that pass the gate, the highest value / cost (value-cost.ts) is asked;
 * ties (including every pair at value 0) fall back to the score, then to the action key. Pairs without an expected gain
 * in their features rank by the score alone, as before.
 */
export class RulesSelector implements Selector {
  readonly id = 'rules';
  readonly version = 'rules-selector@1';
  readonly route = 'rules' as const;
  private threshold: number;
  private clock: () => Date;

  constructor(opts: RulesSelectorOptions = {}) {
    this.threshold = opts.threshold ?? 0.2;
    this.clock = opts.clock ?? (() => new Date());
  }

  score(f: Record<string, number> | undefined): number {
    const consequential = f?.consequential ?? 0;
    const firsthand = (f?.firsthand ?? 0) > 0 ? 1 : 0.6;
    const open = f?.recipientOpenQuestions ?? 0;
    const recency = f?.recency ?? 1;
    return consequential * firsthand * (1 / (1 + open)) * recency;
  }

  select(ctx: SelectorContext): PolicyDecision {
    const info = { id: this.id, version: this.version, route: this.route };
    const at = this.clock();
    if (ctx.eligible.length === 0) return makeDecision(ctx, info, 'defer', 1, 'defer: no eligible question-recipient pair', at);
    const scored = ctx.eligible.map((a) => {
      const f = ctx.features[actionKey(a)];
      return { a, key: actionKey(a), s: this.score(f), r: valuePerCost(f) };
    });
    const passing = scored.filter((x) => x.s >= this.threshold);
    if (passing.length === 0) {
      const top = Math.max(...scored.map((x) => x.s));
      return makeDecision(ctx, info, 'defer', 1, `defer: best score ${top.toFixed(3)} is below threshold ${this.threshold}`, at);
    }
    const best = passing.sort((x, y) => (y.r ?? 0) - (x.r ?? 0) || y.s - x.s || x.key.localeCompare(y.key))[0] as (typeof passing)[number];
    const vc = best.r === undefined ? '' : `; value/cost ${best.r.toFixed(4)}`;
    return makeDecision(ctx, info, best.a, 1, `rules: score ${best.s.toFixed(3)} (consequential x firsthand weight x load x recency)${vc}`, at);
  }

  update(_records: EvaluationRecord[]): void {}
}
