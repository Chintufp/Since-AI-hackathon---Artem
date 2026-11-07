import type { InvestigationState } from '../contracts/index.ts';
import type { LoopReasons } from './settings.ts';

/**
 * The human line for the question-loop status. Every loop value has one: the stored `loopReason` when set, else the
 * configured text for that value (so states written before a reason existed still read naturally).
 */
export function loopReasonFor(state: Pick<InvestigationState, 'loop' | 'loopReason'>, reasons: LoopReasons): string {
  if (state.loopReason) return state.loopReason;
  switch (state.loop) {
    case 'no-question-needed': return reasons.noQuestionNeeded;
    case 'question-open': return reasons.waiting.replace('{name}', 'the person asked');
    case 'answered': return reasons.answered;
    case 'exhausted': return reasons.budgetUsed;
    case 'deferred': return reasons.preparing;
  }
}
