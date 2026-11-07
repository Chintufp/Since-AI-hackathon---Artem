import type { Selector } from '../contracts/index.ts';
import { EpsilonGreedy, randomSelector } from './epsilon-greedy.ts';
import { LinUcb, type LinUcbOptions } from './linucb.ts';
import { RankerReplaySelector, type RankerReplayOptions } from './ranker-replay.ts';
import { RulesSelector, type RulesSelectorOptions } from './rules-selector.ts';

export const SELECTOR_IDS = ['rules', 'linucb', 'epsilon-greedy', 'random', 'ranker-replay'] as const;
export type SelectorId = (typeof SELECTOR_IDS)[number];

/** CoordinatorSettings.selectorId values ('rules' | 'bandit' | 'ranker') map onto these. */
const ALIAS: Record<string, SelectorId> = { rules: 'rules', bandit: 'linucb', ranker: 'ranker-replay' };

export interface SelectorOptions {
  rules?: RulesSelectorOptions;
  linucb?: LinUcbOptions;
  epsilon?: { epsilon?: number; seed?: number; clock?: () => Date };
  ranker?: RankerReplayOptions;
  seed?: number;
}

export function createSelector(id: string, opts: SelectorOptions = {}): Selector {
  const key = (ALIAS[id] ?? id) as SelectorId;
  switch (key) {
    case 'rules':
      return new RulesSelector(opts.rules);
    case 'linucb':
      return new LinUcb(opts.linucb);
    case 'epsilon-greedy':
      return new EpsilonGreedy(opts.epsilon);
    case 'random':
      return randomSelector(opts.seed ?? 1);
    case 'ranker-replay':
      return new RankerReplaySelector(opts.ranker);
    default:
      throw new Error(`Unknown selector "${id}". Known: ${SELECTOR_IDS.join(', ')}`);
  }
}
