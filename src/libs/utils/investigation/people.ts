import type { CandidateMatch, Case, EvidenceRef, KnowledgeStore, PersonResult, PersonWorkLink } from '../contracts/index.ts';
import { canSee, type PrincipalLike } from '../retrieval/access.ts';
import { budgetViolations, computeBudget } from './budget.ts';
import { loadCaseFacts } from './case-facts.ts';
import { isRelatedCandidate } from './related.ts';
import type { PersonDirectory } from './directory.ts';
import { actionPhrase, fillTemplate, shortCaseLabel } from './phrases.ts';
import { isDiagnosticAction, type InvestigationSettings } from './settings.ts';

export interface PeopleInput {
  store: KnowledgeStore;
  directory: PersonDirectory;
  principal: PrincipalLike;
  requesterEntityId?: string;
  investigationId?: string;
  /** Candidates that passed the relative score floor (cases and procedures); only cases that also pass the people gate count. */
  candidates: CandidateMatch[];
  /** The case the recommendation depends on; its people come first. */
  selectedCaseId?: string;
  /** Entities of the current problem (people with firsthand links to them are relevant too). */
  entityIds: string[];
  settings: Pick<InvestigationSettings, 'coordinator' | 'phrases' | 'historyKeys' | 'relatedMinMatchingConditions' | 'maxPeople' | 'maxReasonsPerPerson' | 'diagnosticActions'>;
  now: Date;
}

type Reason = PersonResult['reasons'][number];

/**
 * People with relevant experience, with short per-case reasons.
 * - Cases that count: candidates that passed the score floor AND are related (see `isRelatedCandidate`: at least
 *   `relatedMinMatchingConditions` non-history conditions, or an entity of the problem, or the selected case), so an unrelated lookalike of a different
 *   incident never surfaces its people.
 * - Order: people from the case the recommendation depends on, then by the best candidate's score; firsthand people before
 *   mentioned-only people (always last, flagged "not firsthand"); then the most informative contribution, recency, name.
 * - Reasons are deduplicated per (case, contribution), phrased from the configurable verb map with the short case label
 *   and the action when known, at most `maxReasonsPerPerson` each; at most `maxPeople` people.
 * Only cases the principal may see are linked, so nobody is surfaced through a hidden case.
 */
export function buildPeople(inp: PeopleInput): PersonResult[] {
  const { store, directory, principal, settings } = inp;
  const P = settings.phrases;
  const cases = new Map<string, Case>(store.list('case').map((c) => [c.id, c] as const));
  const visible = (id?: string): Case | undefined => {
    const c = id ? cases.get(id) : undefined;
    return c && canSee(c.accessScope, principal) ? c : undefined;
  };
  const links = store.list('personLink').filter((l) => l.status !== 'rejected');
  const wantedEntities = new Set(inp.entityIds);

  // Which cases count, and how they rank (0 = best).
  const score = new Map<string, number>();
  for (const cand of inp.candidates) {
    if (!cand.caseId) continue;
    const c = visible(cand.caseId);
    if (!c) continue;
    if (isRelatedCandidate(cand, c, inp.entityIds, settings) || cand.caseId === inp.selectedCaseId) score.set(cand.caseId, cand.score);
  }
  const caseRank = (id?: string): number => (id && id === inp.selectedCaseId ? Number.MAX_SAFE_INTEGER : id ? (score.get(id) ?? -1) : -1);
  const relevant = links.filter((l) => (l.caseId && score.has(l.caseId)) || (l.firsthand && l.entityId && wantedEntities.has(l.entityId) && visible(l.caseId)));

  const byPerson = new Map<string, PersonWorkLink[]>();
  for (const l of relevant) {
    if (l.personEntityId === inp.requesterEntityId) continue;
    if (l.caseId && !visible(l.caseId)) continue;
    byPerson.set(l.personEntityId, [...(byPerson.get(l.personEntityId) ?? []), l]);
  }

  const labelOf = new Map<string, string>();
  const caseLabel = (id: string): string => {
    const hit = labelOf.get(id);
    if (hit) return hit;
    const c = cases.get(id);
    const l = c ? shortCaseLabel(store, c) : id;
    labelOf.set(id, l);
    return l;
  };
  const factsCache = new Map<string, ReturnType<typeof loadCaseFacts>>();
  const factsOf = (id: string) => {
    const hit = factsCache.get(id) ?? loadCaseFacts(store, id, inp.investigationId, settings);
    factsCache.set(id, hit);
    return hit;
  };
  const orderIndex = (c: string): number => {
    const i = P.contributionOrder.indexOf(c as PersonWorkLink['contribution']);
    return i < 0 ? P.contributionOrder.length : i;
  };

  const results: Array<{ result: PersonResult; rank: number; best: number; firsthand: boolean; recency: number }> = [];
  for (const [pid, ls] of byPerson) {
    const person = directory.get(pid);
    if (!person) continue;
    const reasons: Array<Reason & { rank: number; order: number }> = [];
    const caseIds = [...new Set(ls.map((l) => l.caseId).filter((x): x is string => !!x))];
    for (const caseId of caseIds) {
      const mine = ls.filter((l) => l.caseId === caseId);
      const facts = factsOf(caseId);
      const label = caseLabel(caseId);
      const firstOf = (contribs: string[]) => mine.filter((l) => contribs.includes(l.contribution));
      const evidenceOf = (xs: PersonWorkLink[]): EvidenceRef[] => xs.flatMap((l) => l.evidence).filter((e, i, a) => a.findIndex((y) => y.evidenceId === e.evidenceId && y.span?.start === e.span?.start) === i);
      // The action a person's contribution concerned: the attempt they performed/advised (or whose outcome they reported);
      // a case-level fallback is used only when the case has a single distinct action.
      const mineAttempts = (contribution: string) => facts.attempts.filter((a) => {
        const by = contribution === 'advised' ? a.advisedBy : contribution === 'reported-outcome' ? undefined : a.performedBy;
        if (contribution === 'reported-outcome') return facts.outcomes.some((o) => o.attemptId === a.id && o.reportedBy && directory.resolve(o.reportedBy.id) === pid);
        return !!by && directory.resolve(by.id) === pid;
      });
      const actionFor = (contribution: string): string | undefined => {
        const own = mineAttempts(contribution).filter((a) => (contribution === 'performed-check') === isDiagnosticAction(a.action, settings));
        // Prefer the attempt whose recovery this person reported, then the case's main corrective attempt, then the first.
        const picked = own.find((a) => facts.outcomes.some((o) => o.attemptId === a.id && o.result === 'recovered' && o.reportedBy && directory.resolve(o.reportedBy.id) === pid))
          ?? own.find((a) => a.id === facts.corrective?.id) ?? own[0];
        if (picked) return picked.action;
        const distinct = [...new Set(facts.attempts.filter((a) => (contribution === 'performed-check') === isDiagnosticAction(a.action, settings)).map((a) => a.action))];
        return distinct.length === 1 && contribution !== 'observed-condition' && contribution !== 'reported-problem' ? distinct[0] : undefined;
      };
      const emit = (tpl: { withAction: string; withoutAction: string }, contribution: string, xs: PersonWorkLink[]) => {
        const action = actionFor(contribution);
        const base = fillTemplate(action ? tpl.withAction : tpl.withoutAction, { action: action ? actionPhrase(action, P).noun : '', case: label });
        const firsthand = xs.some((l) => l.firsthand);
        reasons.push({
          text: firsthand || /not firsthand/.test(base) ? base : `${base} (not firsthand)`, contribution, caseId, evidence: evidenceOf(xs), firsthand,
          rank: caseRank(caseId), order: orderIndex(contribution),
        });
      };
      const done = new Set<string>();
      const performed = firstOf(['performed-action']);
      const outcome = firstOf(['reported-outcome']);
      if (performed.length && outcome.length) {
        const recovered = facts.primaryOutcomes.some((o) => o.result === 'recovered');
        emit(recovered ? P.performedAndRecovered : P.performedAndReported, 'performed-action', [...performed, ...outcome]);
        done.add('performed-action');
        done.add('reported-outcome');
      }
      for (const contribution of new Set(mine.map((l) => l.contribution))) {
        if (done.has(contribution)) continue;
        emit(P.contributions[contribution], contribution, firstOf([contribution]));
      }
    }
    // Links without a case (to the problem's own entities) still give one plain reason per contribution.
    for (const contribution of new Set(ls.filter((l) => !l.caseId).map((l) => l.contribution))) {
      const xs = ls.filter((l) => !l.caseId && l.contribution === contribution);
      const base = fillTemplate(P.contributions[contribution].withoutAction, { case: 'earlier work on this asset' });
      const firsthand = xs.some((l) => l.firsthand);
      reasons.push({ text: firsthand || /not firsthand/.test(base) ? base : `${base} (not firsthand)`, contribution, evidence: xs.flatMap((l) => l.evidence), firsthand, rank: -1, order: orderIndex(contribution) });
    }
    const sorted = reasons
      .sort((a, b) => b.rank - a.rank || Number(b.firsthand) - Number(a.firsthand) || a.order - b.order)
      .slice(0, settings.maxReasonsPerPerson)
      .map(({ rank: _r, order: _o, ...r }) => r);
    const accessibleCaseIds = [...new Set(links.filter((l) => l.personEntityId === pid && visible(l.caseId)).map((l) => l.caseId as string))];
    const budget = computeBudget(store, pid, settings, inp.now);
    const askable = person.available && budgetViolations(budget, settings.coordinator.maxOpenQuestionsPerPerson, inp.now).length === 0 && accessibleCaseIds.length > 0;
    const recency = Math.max(0, ...ls.map((l) => (l.recency.known && l.recency.iso ? Date.parse(l.recency.iso) : 0)));
    results.push({
      result: { personEntityId: pid, displayName: person.name, ...(person.role ? { role: person.role } : {}), reasons: sorted, accessibleCaseIds, askable },
      rank: Math.max(...ls.map((l) => caseRank(l.caseId))), best: Math.min(...reasons.map((r) => r.order), 99), firsthand: ls.some((l) => l.firsthand), recency,
    });
  }
  return results
    .sort((a, b) => Number(b.firsthand) - Number(a.firsthand) || b.rank - a.rank || a.best - b.best || b.recency - a.recency || a.result.displayName.localeCompare(b.result.displayName))
    .slice(0, settings.maxPeople)
    .map((r) => r.result);
}
