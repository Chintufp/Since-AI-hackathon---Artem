import type { CandidateMatch, Case } from '../contracts/index.ts';
import type { InvestigationSettings } from './settings.ts';

/**
 * Is a candidate related enough to drive a recommendation, gaps, questions and people? It must match at least
 * `relatedMinMatchingConditions` non-history conditions of the problem, or concern an entity of the problem. A lookalike
 * that only shares generic words (or one history key such as "component replaced") with a different incident is listed
 * as a match but never recommends anything and never surfaces its people.
 */
export function isRelatedCandidate(
  c: CandidateMatch, theCase: Pick<Case, 'entityIds'> | undefined, problemEntityIds: string[],
  s: Pick<InvestigationSettings, 'historyKeys' | 'relatedMinMatchingConditions'>,
): boolean {
  const history = new Set(s.historyKeys);
  if (c.matchingConditions.filter((m) => !history.has(m.key)).length >= s.relatedMinMatchingConditions) return true;
  return !!theCase && theCase.entityIds.some((e) => problemEntityIds.includes(e));
}
