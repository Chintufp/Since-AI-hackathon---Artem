import type { EvaluationRecord, PolicyDecision, Selector, SelectorContext } from '../contracts/index.ts';
import { createRng } from '../models/rng.ts';
import { actionKey, makeDecision, type SelectorClock } from './features.ts';

export interface EpsilonGreedyOptions extends SelectorClock {
  epsilon?: number;
  seed?: number;
}

/**
 * Non-contextual baseline: running mean benefit per RECIPIENT (the arm), epsilon-random exploration.
 * It sees no question/context features, which is exactly what the contextual bandit is compared against.
 * Unknown benefit (null) is skipped. epsilon = 1 is a uniform-random selector.
 */
export class EpsilonGreedy implements Selector {
  readonly id: string;
  readonly version = 'epsilon-greedy@1';
  readonly route = 'local' as const;
  readonly epsilon: number;
  private rng: () => number;
  private clock: () => Date;
  private sum = new Map<string, number>();
  private n = new Map<string, number>();

  constructor(opts: EpsilonGreedyOptions = {}) {
    this.epsilon = opts.epsilon ?? 0.1;
    this.id = this.epsilon >= 1 ? 'random' : 'epsilon-greedy';
    this.rng = createRng(opts.seed ?? 1);
    this.clock = opts.clock ?? (() => new Date());
  }

  mean(arm: string): number {
    const c = this.n.get(arm) ?? 0;
    return c === 0 ? 0 : (this.sum.get(arm) as number) / c;
  }

  observe(arm: string, reward: number): void {
    this.sum.set(arm, (this.sum.get(arm) ?? 0) + reward);
    this.n.set(arm, (this.n.get(arm) ?? 0) + 1);
  }

  update(records: EvaluationRecord[]): void {
    for (const r of records) {
      if (r.action === 'defer' || r.assessedBenefit === null) continue;
      this.observe(r.action.personEntityId, r.assessedBenefit.value);
    }
  }

  select(ctx: SelectorContext): PolicyDecision {
    const info = { id: this.id, version: this.version, route: this.route };
    const at = this.clock();
    const acts = [...ctx.eligible].sort((a, b) => actionKey(a).localeCompare(actionKey(b)));
    if (acts.length === 0) return makeDecision(ctx, info, 'defer', 1, 'defer: no eligible question-recipient pair', at);
    const means = acts.map((a) => this.mean(a.personEntityId));
    const max = Math.max(...means);
    const greedy = acts.filter((_, i) => means[i] === max);
    const explore = this.rng() < this.epsilon;
    const pool = explore ? acts : greedy;
    const chosen = pool[Math.floor(this.rng() * pool.length)] as (typeof acts)[number];
    const isGreedy = greedy.includes(chosen);
    const propensity = this.epsilon / acts.length + (isGreedy ? (1 - this.epsilon) / greedy.length : 0);
    return makeDecision(ctx, info, chosen, propensity, explore ? 'explore: uniform random among eligible' : 'exploit: best running mean for recipient', at);
  }
}

export const randomSelector = (seed = 1, clock?: () => Date): EpsilonGreedy => new EpsilonGreedy({ epsilon: 1, seed, ...(clock ? { clock } : {}) });
