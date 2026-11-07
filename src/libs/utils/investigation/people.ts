import type { Case, KnowledgeStore, PersonResult, PersonWorkLink } from '../contracts/index.ts';
import { canSee, type PrincipalLike } from '../retrieval/access.ts';
import { budgetViolations, computeBudget } from './budget.ts';
import type { PersonDirectory } from './directory.ts';
import type { InvestigationSettings } from './settings.ts';

const VERB: Record<PersonWorkLink['contribution'], string> = {
  'reported-problem': 'reported the problem',
  advised: 'advised a response',
  'performed-check': 'performed a check',
  'performed-action': 'performed an action',
  'reported-outcome': 'reported the outcome',
  'observed-condition': 'observed a condition',
  mentioned: 'was mentioned',
};

export interface PeopleInput {
  store: KnowledgeStore;
  directory: PersonDirectory;
  principal: PrincipalLike;
  requesterEntityId?: string;
  /** Cases behind the relevant candidates. */
  caseIds: string[];
  /** Entities of the current problem (people with firsthand links to them are relevant too). */
  entityIds: string[];
  settings: Pick<InvestigationSettings, 'coordinator'>;
  now: Date;
}

/**
 * People with relevant experience, with per-case reasons. Firsthand reasons come first; people only mentioned by
 * others are flagged. Only cases the principal may see are linked, so nobody is surfaced through a hidden case.
 */
export function buildPeople(inp: PeopleInput): PersonResult[] {
  const { store, directory, principal } = inp;
  const cases = new Map<string, Case>(store.list('case').map((c) => [c.id, c] as const));
  const visible = (id?: string): Case | undefined => {
    const c = id ? cases.get(id) : undefined;
    return c && canSee(c.accessScope, principal) ? c : undefined;
  };
  const links = store.list('personLink').filter((l) => l.status !== 'rejected');
  const wantedCases = new Set(inp.caseIds);
  const wantedEntities = new Set(inp.entityIds);
  const relevant = links.filter((l) => (l.caseId && wantedCases.has(l.caseId)) || (l.firsthand && l.entityId && wantedEntities.has(l.entityId) && visible(l.caseId)));

  const byPerson = new Map<string, PersonWorkLink[]>();
  for (const l of relevant) {
    if (l.personEntityId === inp.requesterEntityId) continue;
    if (l.caseId && !visible(l.caseId)) continue;
    byPerson.set(l.personEntityId, [...(byPerson.get(l.personEntityId) ?? []), l]);
  }

  const results: PersonResult[] = [];
  for (const [pid, ls] of byPerson) {
    const person = directory.get(pid);
    if (!person) continue;
    const reasons = ls
      .map((l) => {
        const c = visible(l.caseId);
        return {
          text: `${l.firsthand ? 'Firsthand: ' : 'Mentioned only, not firsthand: '}${VERB[l.contribution]}${c ? ` in "${c.title}"` : ''}`,
          contribution: l.contribution,
          ...(l.caseId ? { caseId: l.caseId } : {}),
          evidence: l.evidence,
          firsthand: l.firsthand,
        };
      })
      .sort((a, b) => Number(b.firsthand) - Number(a.firsthand));
    const accessibleCaseIds = [...new Set(links.filter((l) => l.personEntityId === pid && visible(l.caseId)).map((l) => l.caseId as string))];
    const budget = computeBudget(store, pid, inp.settings, inp.now);
    const askable = person.available && budgetViolations(budget, inp.settings.coordinator.maxOpenQuestionsPerPerson, inp.now).length === 0 && accessibleCaseIds.length > 0;
    results.push({ personEntityId: pid, displayName: person.name, ...(person.role ? { role: person.role } : {}), reasons, accessibleCaseIds, askable });
  }
  const recency = (r: PersonResult): number => Math.max(0, ...ls(r).map((l) => (l.recency.known && l.recency.iso ? Date.parse(l.recency.iso) : 0)));
  const ls = (r: PersonResult): PersonWorkLink[] => byPerson.get(r.personEntityId) ?? [];
  const firsthandCount = (r: PersonResult): number => r.reasons.filter((x) => x.firsthand).length;
  return results.sort((a, b) => firsthandCount(b) - firsthandCount(a) || recency(b) - recency(a) || a.displayName.localeCompare(b.displayName));
}
