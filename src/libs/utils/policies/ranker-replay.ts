import type { PolicyDecision, Selector, SelectorContext } from '../contracts/index.ts';
import { hashInput, ReplayMismatchError, type ReplayProvider } from '../models/replay.ts';
import { actionKey, makeDecision, type SelectorClock } from './features.ts';
import { RulesSelector } from './rules-selector.ts';

export interface RecordedRanking {
  /** actionKey()s best-first. */
  ranking: string[];
  reason?: string;
}

export interface RankerReplayOptions extends SelectorClock {
  /** Recorded rankings keyed by investigation id; the input hash covers the sorted eligible action keys. */
  provider?: ReplayProvider<RecordedRanking>;
  fallback?: Selector;
}

/** Input the recorded ranking must correspond to. */
export const rankerInput = (ctx: SelectorContext): { eligible: string[] } => ({ eligible: ctx.eligible.map(actionKey).sort() });
export const rankerInputHash = (ctx: SelectorContext): string => hashInput(rankerInput(ctx));

/**
 * Route 'replay': plays back a RECORDED ranking (for example from a labelled Claude-agent experiment arm).
 * Never simulates a ranker: when no matching recording exists the decision is explicitly 'blocked: ...', is made
 * by the rules selector and is labelled route 'rules'.
 */
export class RankerReplaySelector implements Selector {
  readonly id = 'ranker-replay';
  readonly version = 'ranker-replay@1';
  readonly route = 'replay' as const;
  private provider: ReplayProvider<RecordedRanking> | undefined;
  private fallback: Selector;
  private clock: () => Date;
  blockedCount = 0;

  constructor(opts: RankerReplayOptions = {}) {
    this.provider = opts.provider;
    this.clock = opts.clock ?? (() => new Date());
    this.fallback = opts.fallback ?? new RulesSelector({ clock: this.clock });
  }

  private blocked(ctx: SelectorContext, why: string): PolicyDecision {
    this.blockedCount++;
    const d = this.fallback.select(ctx);
    return { ...d, selector: { id: `${this.id}->${d.selector.id}`, version: this.version, route: 'rules' }, reason: `blocked: ${why}; fell back to ${d.selector.id}. ${d.reason}` };
  }

  select(ctx: SelectorContext): PolicyDecision {
    if (!this.provider) return this.blocked(ctx, 'no replay fixture configured');
    let entry;
    try {
      entry = this.provider.get(ctx.state.id, rankerInput(ctx));
    } catch (e) {
      if (e instanceof ReplayMismatchError) return this.blocked(ctx, 'recorded input does not match the current eligible set');
      throw e;
    }
    if (!entry) return this.blocked(ctx, `no recorded ranking for ${ctx.state.id}`);
    const info = { id: this.id, version: `replay:${this.provider.fixtureId}`, route: 'replay' as const };
    const at = this.clock();
    const eligibleByKey = new Map(ctx.eligible.map((a) => [actionKey(a), a] as const));
    const first = entry.output.ranking.find((k) => eligibleByKey.has(k));
    if (!first) return makeDecision(ctx, info, 'defer', 1, 'defer: recorded ranking contains no eligible action', at);
    return makeDecision(ctx, info, eligibleByKey.get(first) as NonNullable<ReturnType<typeof eligibleByKey.get>>, 1, `replay of recorded ranking${entry.recordedBy ? ` (${entry.recordedBy})` : ''}`, at);
  }
}
