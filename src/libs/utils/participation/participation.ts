import type { KnowledgeStore, ParticipationBalance, ParticipationEvent } from '../contracts/index.ts';
import { stableId } from '../contracts/index.ts';

export type ParticipationKind = ParticipationEvent['kind'];

/**
 * Points per contribution kind. A useful "No" earns exactly what a "Yes" earns (the value of an answer is the
 * information, not its polarity). Unknown, "later" and dismiss are neutral: recorded, zero points, never penalised.
 */
export const POINT_TABLE: Readonly<Record<ParticipationKind, number>> = {
  'answer-yes': 2,
  'answer-no': 2,
  'answer-unknown': 0,
  correction: 3,
  evidence: 2,
  'outcome-report': 3,
  defer: 0,
  dismiss: 0,
};

export const pointsFor = (kind: ParticipationKind): number => POINT_TABLE[kind];

export interface AwardInput {
  orgId: string;
  personEntityId: string;
  /** answerId / outcome report id / correction id. The same id never awards twice. */
  contributionEventId: string;
  kind: ParticipationKind;
  summary: string;
  at: string;
  /** settings.points. When false nothing is recorded or awarded. */
  enabled: boolean;
}

export interface AwardResult {
  /** Points newly awarded by this call (0 for duplicates, neutral kinds or when disabled). */
  awarded: number;
  /** Present when an event exists for this contribution (new or earlier). */
  event?: ParticipationEvent;
  duplicate: boolean;
}

export const participationEventId = (contributionEventId: string): string => stableId('part', contributionEventId);

/** Award points once per contribution event. Only active when `enabled`; nothing outside this module reads the result. */
export function awardPoints(store: KnowledgeStore, input: AwardInput): AwardResult {
  if (!input.enabled) return { awarded: 0, duplicate: false };
  const id = participationEventId(input.contributionEventId);
  const existing = store.get('participation', id);
  if (existing) return { awarded: 0, event: existing, duplicate: true };
  const event: ParticipationEvent = {
    id, orgId: input.orgId, personEntityId: input.personEntityId, contributionEventId: input.contributionEventId,
    kind: input.kind, points: pointsFor(input.kind), summary: input.summary, at: input.at,
  };
  store.put('participation', event);
  return { awarded: event.points, event, duplicate: false };
}

/** Withdraw the points for a contribution (undo of an answer). Returns whether an event was removed. */
export function revokeContribution(store: KnowledgeStore, contributionEventId: string): boolean {
  return store.delete('participation', participationEventId(contributionEventId));
}

export function balanceOf(store: KnowledgeStore, personEntityId: string, enabled: boolean): ParticipationBalance {
  const events = store.list('participation', { where: { personEntityId } }).sort((a, b) => a.at.localeCompare(b.at));
  return { personEntityId, points: events.reduce((n, e) => n + e.points, 0), events, enabled };
}
