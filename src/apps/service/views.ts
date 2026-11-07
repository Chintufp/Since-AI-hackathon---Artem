import type {
  CaseView, InvestigationState, KnowledgeStore, PersonResult, PersonView, Principal, QuestionRecord, QuestionView, ResultView,
} from '../../libs/utils/contracts/index.ts';
import { questionsForInvestigation, startedBy } from '../../libs/utils/investigation/index.ts';
import { buildCaseView } from '../../libs/utils/memory/index.ts';

export type InvestigationResult = ResultView & { state: InvestigationState };

export const ACTIVE_QUESTION = new Set(['queued', 'delivered']);

export const personView = (p: PersonResult): PersonView => ({
  personEntityId: p.personEntityId,
  name: p.displayName,
  ...(p.role ? { role: p.role } : {}),
  reasons: p.reasons.map((r) => ({ text: r.text, ...(r.caseId ? { caseId: r.caseId } : {}), firsthand: r.firsthand, evidence: r.evidence })),
  askable: p.askable,
});

/** Question as a given viewer may see it: the case timeline is built with the viewer's own access. */
export function questionView(store: KnowledgeStore, q: QuestionRecord, viewer: Pick<Principal, 'id' | 'groups'>): QuestionView {
  const caseId = q.candidate.scope.caseId;
  const cv: CaseView | undefined = caseId ? buildCaseView(store, caseId, viewer) : undefined;
  const entityNames = q.candidate.scope.entityIds.map((id) => store.get('entity', id)?.name).filter((n): n is string => !!n);
  return {
    questionId: q.id,
    investigationId: q.candidate.investigationId,
    caseLabel: cv?.title ?? (entityNames.join(', ') || 'Related case'),
    text: q.candidate.text,
    kind: q.candidate.kind,
    why: q.candidate.rationale,
    timeline: cv?.timeline ?? [],
    caveat: cv?.caveat ?? '',
    status: q.status,
    deferred: q.status === 'deferred',
  };
}

/** The requester's result: access-filtered by the principal the investigation was started with. */
export function resultView(store: KnowledgeStore, state: InvestigationState, fallbackViewer: Pick<Principal, 'id' | 'groups'>): InvestigationResult {
  const viewer = startedBy(state) ?? fallbackViewer;
  const r = state.recommendation;
  const titleOf = (caseId?: string, procedureId?: string): string => {
    if (caseId) return store.get('case', caseId)?.title ?? caseId;
    if (procedureId) return store.get('procedure', procedureId)?.purpose ?? procedureId;
    return 'Candidate';
  };
  const label = (c: { key: string; label?: string }): string => c.label ?? c.key;
  const matches = state.candidates.filter((c) => c.score > 0).slice(0, 5).map((c) => ({
    ...(c.caseId ? { caseId: c.caseId } : {}),
    ...(c.procedureId ? { procedureId: c.procedureId } : {}),
    title: titleOf(c.caseId, c.procedureId),
    score: c.score,
    matching: c.matchingConditions.map(label),
    conflicting: c.conflictingConditions.map(label),
    missing: c.missingConditions.map((m) => m.label),
  }));
  const topCaseId = state.candidates.find((c) => c.caseId && c.score > 0)?.caseId;
  const caseView = topCaseId ? buildCaseView(store, topCaseId, viewer) : undefined;
  const active = questionsForInvestigation(store, state.id).find((q) => ACTIVE_QUESTION.has(q.status));
  return {
    investigationId: state.id,
    recommendation: { kind: r.kind, text: r.text, applicability: r.applicability, caveats: r.caveats, ...(r.nextStep ? { nextStep: r.nextStep } : {}), actionClass: r.actionClass },
    matches,
    people: state.people.map(personView),
    ...(active ? { question: questionView(store, active, viewer) } : {}),
    loop: state.loop,
    routes: state.routes.map((x) => ({ route: x.route, version: x.version })),
    ...(caseView ? { caseView } : {}),
    state,
  };
}
