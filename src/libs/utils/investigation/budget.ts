import type { Budget, KnowledgeStore, QuestionRecord } from '../contracts/index.ts';
import type { InvestigationSettings } from './settings.ts';

const ACTIVE = new Set(['queued', 'delivered']);
const sameUtcDay = (a: Date, b: Date): boolean => a.toISOString().slice(0, 10) === b.toISOString().slice(0, 10);

/** Per-person budget derived from persisted question records (no separate counter to drift). */
export function computeBudget(
  store: KnowledgeStore,
  personEntityId: string,
  settings: Pick<InvestigationSettings, 'coordinator'>,
  now: Date,
  ignoreQuestionIds: string[] = [],
): Budget {
  const mine = store.list('question', { where: { personEntityId } }).filter((q) => !ignoreQuestionIds.includes(q.id));
  const delivered = mine.filter((q) => q.deliveredAt);
  const askedToday = delivered.filter((q) => sameUtcDay(new Date(q.deliveredAt as string), now)).length;
  const last = delivered.map((q) => q.deliveredAt as string).sort().at(-1);
  return {
    personEntityId,
    dailyLimit: settings.coordinator.dailyLimitPerPerson,
    askedToday,
    cooldownMinutes: settings.coordinator.cooldownMinutes,
    ...(last ? { lastAskedAt: last } : {}),
    openQuestionIds: mine.filter((q) => ACTIVE.has(q.status)).map((q) => q.id),
  };
}

export type BudgetViolation = 'budget' | 'cooldown';

export function budgetViolations(b: Budget, maxOpen: number, now: Date): BudgetViolation[] {
  const v: BudgetViolation[] = [];
  if (b.askedToday >= b.dailyLimit || b.openQuestionIds.length >= maxOpen) v.push('budget');
  if (b.lastAskedAt && now.getTime() - new Date(b.lastAskedAt).getTime() < b.cooldownMinutes * 60_000) v.push('cooldown');
  return v;
}

export const questionsForInvestigation = (store: KnowledgeStore, investigationId: string): QuestionRecord[] =>
  store.list('question').filter((q) => q.candidate.investigationId === investigationId);
