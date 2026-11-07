import type { Budget, KnowledgeStore, QuestionRecord } from '../contracts/index.ts';
import type { InvestigationSettings } from './settings.ts';
import { localDay } from '../questions/quiet-hours.ts';

const ACTIVE = new Set(['queued', 'delivered']);

/**
 * Per-person budget derived from persisted question records (no separate counter to drift). "Today" is the local
 * calendar day in the quiet hours' time zone when the settings carry quiet hours (the same clock the quiet-hours term
 * uses), UTC otherwise; so a question delivered at 01:30 Helsinki time counts toward that Helsinki day, not the UTC one.
 */
export function computeBudget(
  store: KnowledgeStore,
  personEntityId: string,
  settings: Pick<InvestigationSettings, 'coordinator'>,
  now: Date,
  ignoreQuestionIds: string[] = [],
): Budget {
  const mine = store.list('question', { where: { personEntityId } }).filter((q) => !ignoreQuestionIds.includes(q.id));
  const delivered = mine.filter((q) => q.deliveredAt);
  const tz = settings.coordinator.quietHours?.timeZone;
  const today = localDay(now, tz);
  const askedToday = delivered.filter((q) => localDay(new Date(q.deliveredAt as string), tz) === today).length;
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
