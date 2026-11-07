import type { KnowledgeStore, ParticipationBalance, ParticipationEvent, ParticipationOptIn, ParticipationRating, ParticipationRow } from '../contracts/index.ts';
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

/** Days counted as "recent" in the rating. */
export const RECENT_DAYS = 7;

// ---- opt-in (R46): one record per person, default no ----------------------------------------------

export const optInId = (personEntityId: string): string => stableId('optin', personEntityId);

/** The person's choice; absent means they do not take part. */
export function getOptIn(store: KnowledgeStore, personEntityId: string): ParticipationOptIn | undefined {
  return store.get('participationOptin', optInId(personEntityId));
}

export const participates = (store: KnowledgeStore, personEntityId: string): boolean => getOptIn(store, personEntityId)?.participates === true;

export function setOptIn(store: KnowledgeStore, input: { orgId: string; personEntityId: string; participates: boolean; at: string }): ParticipationOptIn {
  const prev = getOptIn(store, input.personEntityId);
  const rec: ParticipationOptIn = {
    id: optInId(input.personEntityId), orgId: input.orgId, personEntityId: input.personEntityId, participates: input.participates,
    since: prev && prev.participates === input.participates ? prev.since : input.at,
  };
  return store.put('participationOptin', rec);
}

// ---- awards ----------------------------------------------------------------------------------------

export interface AwardInput {
  orgId: string;
  personEntityId: string;
  /** answerId / outcome report id / observation id / evidence id. The same id never awards twice. */
  contributionEventId: string;
  kind: ParticipationKind;
  /** Neutral wording only; never question, evidence or report text. */
  summary: string;
  /** The question, investigation or evidence id the contribution belongs to. */
  refId?: string;
  at: string;
  /** Whether the recipient takes part at the time of the contribution. When false nothing is recorded or awarded. */
  participates: boolean;
}

export interface AwardResult {
  /** Points newly awarded by this call (0 for duplicates, neutral kinds or when the person does not take part). */
  awarded: number;
  /** Present when an event exists for this contribution (new or earlier). */
  event?: ParticipationEvent;
  duplicate: boolean;
}

export const participationEventId = (contributionEventId: string): string => stableId('part', contributionEventId);

/** Award points once per contribution event, only for a person who takes part; nothing outside this module reads the result. */
export function awardPoints(store: KnowledgeStore, input: AwardInput): AwardResult {
  if (!input.participates) return { awarded: 0, duplicate: false };
  const id = participationEventId(input.contributionEventId);
  const existing = store.get('participation', id);
  if (existing) return { awarded: 0, event: existing, duplicate: true };
  const event: ParticipationEvent = {
    id, orgId: input.orgId, personEntityId: input.personEntityId, contributionEventId: input.contributionEventId,
    kind: input.kind, points: pointsFor(input.kind), summary: input.summary, ...(input.refId ? { refId: input.refId } : {}), at: input.at,
  };
  store.put('participation', event);
  return { awarded: event.points, event, duplicate: false };
}

/** Withdraw the points for a contribution (undo of an answer). Returns whether an event was removed. */
export function revokeContribution(store: KnowledgeStore, contributionEventId: string): boolean {
  return store.delete('participation', participationEventId(contributionEventId));
}

const eventsOf = (store: KnowledgeStore, personEntityId: string): ParticipationEvent[] =>
  store.list('participation', { where: { personEntityId } }).sort((a, b) => a.at.localeCompare(b.at));

/** Own balance. For a person who does not take part the rows stay stored but are not served: 0 points, no events. */
export function balanceOf(store: KnowledgeStore, personEntityId: string): ParticipationBalance {
  if (!participates(store, personEntityId)) return { personEntityId, participates: false, points: 0, events: [] };
  const events = eventsOf(store, personEntityId);
  return { personEntityId, participates: true, points: events.reduce((n, e) => n + e.points, 0), events };
}

// ---- rating ----------------------------------------------------------------------------------------

export interface RatingInput {
  /** Display names for the ids that take part (people unknown to the directory keep their id as the name). */
  displayName: (personEntityId: string) => string | undefined;
  /** Fills `me` (with the last 10 events). Must already be checked to be the caller. */
  personEntityId?: string;
  now: Date;
}

const sum = (xs: ParticipationEvent[]): number => xs.reduce((n, e) => n + e.points, 0);

/** Rating among the people who take part, by all-time balance; nobody who does not take part appears anywhere. */
export function rating(store: KnowledgeStore, input: RatingInput): ParticipationRating {
  const recentFrom = new Date(input.now.getTime() - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const optIns = store.list('participationOptin').filter((o) => o.participates);
  const rows: ParticipationRow[] = optIns.map((o) => {
    const events = eventsOf(store, o.personEntityId);
    return {
      personEntityId: o.personEntityId, displayName: input.displayName(o.personEntityId) ?? o.personEntityId,
      balance: sum(events), recent: sum(events.filter((e) => e.at >= recentFrom)),
      answered: events.filter((e) => e.kind === 'answer-yes' || e.kind === 'answer-no' || e.kind === 'answer-unknown').length,
      outcomes: events.filter((e) => e.kind === 'outcome-report').length,
      rank: 0,
    };
  }).sort((a, b) => b.balance - a.balance || b.recent - a.recent || a.displayName.localeCompare(b.displayName));
  rows.forEach((r, i) => { r.rank = i > 0 && rows[i - 1]!.balance === r.balance ? rows[i - 1]!.rank : i + 1; });
  const mine = input.personEntityId ? rows.find((r) => r.personEntityId === input.personEntityId) : undefined;
  const me = mine ? { personEntityId: mine.personEntityId, balance: mine.balance, recent: mine.recent, rank: mine.rank, events: eventsOf(store, mine.personEntityId).slice(-10).reverse() } : null;
  return {
    period: { recentDays: RECENT_DAYS, recentFrom },
    me,
    participants: rows,
    totals: { participants: rows.length, points: rows.reduce((n, r) => n + r.balance, 0), recent: rows.reduce((n, r) => n + r.recent, 0) },
  };
}
