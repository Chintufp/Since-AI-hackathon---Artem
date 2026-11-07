import type { EvaluationRecord, PolicyDecision, Selector, SelectorContext } from '../contracts/index.ts';
import { actionKey, makeDecision, type SelectorClock } from './features.ts';

export interface RulesSelectorOptions extends SelectorClock {
  /** Defer when the best score is below this. */
  threshold?: number;
}

/**
 * Deterministic baseline.
 * score = consequential x (firsthand ? 1 : 0.6) x 1/(1+openQuestionsForPerson) x recency
 * (recency defaults to 1 when unknown: unknown recency neither rewards nor penalises).
 * Defers when nothing is eligible or the best score is below the threshold.
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
    const scored = ctx.eligible
      .map((a) => ({ a, key: actionKey(a), s: this.score(ctx.features[actionKey(a)]) }))
      .sort((x, y) => y.s - x.s || x.key.localeCompare(y.key));
    const best = scored[0] as (typeof scored)[number];
    if (best.s < this.threshold) return makeDecision(ctx, info, 'defer', 1, `defer: best score ${best.s.toFixed(3)} is below threshold ${this.threshold}`, at);
    return makeDecision(ctx, info, best.a, 1, `rules: score ${best.s.toFixed(3)} (consequential x firsthand weight x load x recency)`, at);
  }

  update(_records: EvaluationRecord[]): void {}
}
