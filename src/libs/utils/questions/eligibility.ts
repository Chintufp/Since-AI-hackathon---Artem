import type { EligibilityViolation, InvestigationState, QuestionCandidate, RecipientEligibility } from '../contracts/index.ts';
import { budgetViolations, computeBudget, parseGapId, questionsForInvestigation } from '../investigation/index.ts';
import { canSee } from '../retrieval/access.ts';
import type { QuestionContext } from './context.ts';
import { findRecipients, type RecipientReason } from './recipients.ts';

/** Minimum minutes before the same person is asked the same question again in another investigation. */
const REASK_MINUTES = 24 * 60;
const ACTIVE_OR_DONE = new Set(['queued', 'delivered', 'answered']);

export interface EligibilityOptions {
  /** Recipient reasons if already computed for this candidate. */
  recipients?: RecipientReason[];
  /** Question ids to ignore in budget/duplicate checks (e.g. when rechecking the question itself before delivery). */
  ignoreQuestionIds?: string[];
}

/**
 * Hard eligibility. No selector may override a violation; selectors only see eligible pairs (and 'defer').
 * Checks: gap-resolved, self, not-answerable (no question-specific reason), access (recipient must be allowed to see
 * the case the question cites), unavailable, budget (daily limit, max open, per-investigation cap), cooldown,
 * already-asked / duplicate (dedupKey).
 */
export function evaluateEligibility(
  ctx: QuestionContext, state: InvestigationState, candidate: QuestionCandidate, personEntityId: string, opts: EligibilityOptions = {},
): RecipientEligibility {
  const { store, settings, directory, clock } = ctx;
  const now = clock();
  const ignore = opts.ignoreQuestionIds ?? [];
  const v = new Set<EligibilityViolation>();
  const gap = state.gaps.find((g) => g.id === candidate.gapId);
  if (!gap || gap.status !== 'open') v.add('gap-resolved');

  const requester = directory.resolve(state.problem.requester.id) ?? state.problem.requester.id;
  if (personEntityId === requester) v.add('self');

  const recipients = opts.recipients ?? (gap ? findRecipients(ctx, state, gap) : []);
  const mine = recipients.find((r) => r.personEntityId === personEntityId);
  if (!mine) v.add('not-answerable');

  const person = directory.get(personEntityId);
  if (!person || !person.available) v.add('unavailable');

  const caseId = parseGapId(candidate.gapId)?.caseId ?? candidate.scope.caseId;
  const c = caseId ? store.get('case', caseId) : undefined;
  if (!c || !person || !canSee(c.accessScope, { id: personEntityId, groups: person.groups })) v.add('access');

  const budget = computeBudget(store, personEntityId, settings, now, ignore);
  for (const x of budgetViolations(budget, settings.coordinator.maxOpenQuestionsPerPerson, now)) v.add(x);
  const forInv = questionsForInvestigation(store, state.id).filter((q) => !ignore.includes(q.id) && q.status !== 'cancelled');
  if (candidate.kind === 'quick' && forInv.length >= settings.coordinator.maxQuestionsPerInvestigation) v.add('budget');

  const same = store.list('question').filter((q) => !ignore.includes(q.id) && q.candidate.dedupKey === candidate.dedupKey);
  if (same.some((q) => q.personEntityId === personEntityId && q.candidate.investigationId === candidate.investigationId && q.status !== 'cancelled')) v.add('already-asked');
  else if (same.some((q) => isActiveOrDone(q) && q.candidate.investigationId === candidate.investigationId)) v.add('duplicate');
  else {
    // Same person, other investigation: an in-flight question is a duplicate; an answered one only cools down for a
    // bounded time (the answer itself is reused as evidence by investigate(), and an 'unknown' answer may be re-asked later).
    const mineElsewhere = same.filter((q) => q.personEntityId === personEntityId && q.candidate.investigationId !== candidate.investigationId);
    if (mineElsewhere.some((q) => q.status === 'queued' || q.status === 'delivered')) v.add('duplicate');
    const windowMs = Math.max(settings.coordinator.cooldownMinutes, REASK_MINUTES) * 60_000;
    if (mineElsewhere.some((q) => q.status === 'answered' && now.getTime() - Date.parse(q.updatedAt) < windowMs)) v.add('cooldown');
  }

  const violations = [...v];
  return {
    questionId: candidate.id, personEntityId, eligible: violations.length === 0, reasons: mine?.reasons ?? [], violations, evaluatedAt: now.toISOString(),
  };
}

function isActiveOrDone(q: { status: string }): boolean {
  return ACTIVE_OR_DONE.has(q.status);
}

/** Violations that will not clear with time (a selector deferral here is final, not "try later"). */
export const PERMANENT_VIOLATIONS: EligibilityViolation[] = ['access', 'duplicate', 'not-answerable', 'already-asked', 'gap-resolved', 'self'];
