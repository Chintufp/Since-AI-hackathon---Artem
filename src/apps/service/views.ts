import type {
  CaseView, EvidenceRef, InvestigationState, KnowledgeStore, PersonResult, PersonView, Principal, QuestionRecord, QuestionView, ResultView,
} from '../../libs/utils/contracts/index.ts';
import { basisCaseId, defaultInvestigationSettings, loopReasonFor, questionsForInvestigation, startedBy, type LoopReasons } from '../../libs/utils/investigation/index.ts';
import { visibleCandidates } from '../../libs/utils/investigation/visible-candidates.ts';
import { buildCaseView } from '../../libs/utils/memory/index.ts';
import { evidenceGate, type EvidenceGate } from '../../libs/utils/retrieval/index.ts';

/**
 * The case caveat in plain words. The sentence is produced by the memory layer ("...; 8 independent of 9 source record(s)");
 * it is reworded here for every viewer so a reader learns what is counted.
 */
export const polishCaveat = (caveat: string): string =>
  caveat.replace(/(\d+) independent of (\d+) source record\(s\)/, (_, a: string, b: string) => `${a} of ${b} source record${b === '1' ? '' : 's'} ${a === '1' ? 'is' : 'are'} independent (copies and retellings are not counted)`);

export type InvestigationResult = ResultView & { state: InvestigationState };

export const ACTIVE_QUESTION = new Set(['queued', 'delivered']);

export const personView = (p: PersonResult, gate?: EvidenceGate): PersonView => ({
  personEntityId: p.personEntityId,
  name: p.displayName,
  ...(p.role ? { role: p.role } : {}),
  reasons: p.reasons.map((r) => ({ text: r.text, ...(r.caseId ? { caseId: r.caseId } : {}), firsthand: r.firsthand, evidence: gate ? gate.refs(r.evidence) : r.evidence })),
  askable: p.askable,
});

/** A case view with every evidence reference and source re-checked per evidence for the viewer (defence in depth). */
function gatedCaseView(store: KnowledgeStore, caseId: string, viewer: Pick<Principal, 'id' | 'groups'>, gate: EvidenceGate): CaseView | undefined {
  const cv = buildCaseView(store, caseId, viewer);
  if (!cv) return undefined;
  return {
    ...cv,
    caveat: polishCaveat(cv.caveat),
    timeline: cv.timeline.map((n) => ({ ...n, evidence: gate.refs(n.evidence) })),
    sources: cv.sources.filter((x) => gate.ref({ evidenceId: x.evidenceId })),
  };
}

/**
 * The question's rationale as the viewer may read it: cited evidence ids the viewer cannot see are removed, and the
 * hypothesis sentence is dropped when no claim carrying that statement is visible to the viewer.
 */
export function visibleRationale(store: KnowledgeStore, q: QuestionRecord, gate: EvidenceGate): string {
  let why = q.candidate.rationale;
  const cite = / Evidence: ([^.]*)\.$/.exec(why);
  if (cite) {
    const kept = (cite[1] as string).split(',').map((x) => x.trim()).filter((id) => id && gate.ref({ evidenceId: id }));
    why = why.slice(0, cite.index) + (kept.length ? ` Evidence: ${kept.join(', ')}.` : '');
  }
  const hyp = /^Hypothesis "(.*)" from .*? applies only if .*?\. /s.exec(why);
  if (hyp) {
    const statement = hyp[1] as string;
    const caseId = q.candidate.scope.caseId;
    const claims = caseId ? store.list('claim', { where: { caseId } }) : [];
    const ok = claims.some((c) => c.statement === statement && gate.scope(c.accessScope) && gate.supported(c.supporting));
    if (!ok) why = why.slice(hyp[0].length);
  }
  return why.trim();
}

/** Question as a given viewer may see it: the case timeline is built with the viewer's own access. */
export function questionView(store: KnowledgeStore, q: QuestionRecord, viewer: Pick<Principal, 'id' | 'groups'>): QuestionView {
  const gate = evidenceGate(store, viewer);
  const caseId = q.candidate.scope.caseId;
  const cv: CaseView | undefined = caseId ? gatedCaseView(store, caseId, viewer, gate) : undefined;
  const entityNames = q.candidate.scope.entityIds.map((id) => store.get('entity', id)?.name).filter((n): n is string => !!n);
  return {
    questionId: q.id,
    investigationId: q.candidate.investigationId,
    personEntityId: q.personEntityId,
    caseLabel: cv?.title ?? (entityNames.join(', ') || 'Related case'),
    text: q.candidate.text,
    kind: q.candidate.kind,
    why: visibleRationale(store, q, gate),
    timeline: cv?.timeline ?? [],
    caveat: cv?.caveat ?? '',
    status: q.status,
    deferred: q.status === 'deferred',
    ...(q.deliverAfter && q.status === 'queued' ? { deliverAfter: q.deliverAfter } : {}),
    ...(q.candidate.answerType === 'free-text' ? { answerType: 'free-text' as const } : {}),
    ...wording(q.candidate),
  };
}

/** "worded by local model qwen3:8b" when the phrase slot's accepted wording is shown (BUILD_BRIEF 2.3, honesty on screen). */
function wording(c: QuestionRecord['candidate']): Pick<QuestionView, 'wordedBy' | 'templateText'> {
  if (c.phrasing?.by !== 'model') return {};
  const v = c.generatedBy.version;
  const model = v.includes(':') ? v.slice(v.indexOf(':') + 1) : v;
  return { wordedBy: `worded by ${c.generatedBy.route === 'api' ? 'hosted' : 'local'} model ${model}`, ...(c.templateText ? { templateText: c.templateText } : {}) };
}

/** The requester's result: access-filtered by the principal the investigation was started with. */
export function resultView(
  store: KnowledgeStore, stateIn: InvestigationState, fallbackViewer: Pick<Principal, 'id' | 'groups'>,
  loopReasons: LoopReasons = defaultInvestigationSettings().loopReasons,
): InvestigationResult {
  const viewer = startedBy(stateIn) ?? fallbackViewer;
  const gate = evidenceGate(store, viewer);
  const state = sanitizeState(store, stateIn, gate);
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
    ...(c.caseId && store.get('case', c.caseId)?.startedAt.known && store.get('case', c.caseId)?.startedAt.iso ? { startedAt: store.get('case', c.caseId)!.startedAt.iso } : {}),
  }));
  // The timeline is the case the recommendation is based on (the best related candidate when there is no recommendation).
  const shownCaseId = basisCaseId(state) ?? caseOfBasis(state);
  const caseView = shownCaseId ? gatedCaseView(store, shownCaseId, viewer, gate) : undefined;
  const active = questionsForInvestigation(store, state.id).find((q) => ACTIVE_QUESTION.has(q.status));
  return {
    investigationId: state.id,
    recommendation: { kind: r.kind, text: r.text, applicability: r.applicability, caveats: r.caveats, ...(r.nextStep ? { nextStep: r.nextStep } : {}), actionClass: r.actionClass },
    matches,
    people: state.people.map((p) => personView(p, gate)),
    ...(active ? { question: questionView(store, active, viewer) } : {}),
    loop: state.loop,
    loopReason: loopReasonFor(state, loopReasons),
    routes: state.routes.map((x) => ({ route: x.route, version: x.version })),
    ...(caseView ? { caseView } : {}),
    state,
  };
}

/** Older states carry no recorded basis case: the candidate whose hypothesis cites the recommendation's evidence. */
function caseOfBasis(state: InvestigationState): string | undefined {
  const want = new Set(state.recommendation.basis.map((b) => b.evidenceId));
  if (want.size === 0) return undefined;
  for (const h of state.hypotheses) {
    if (!h.basis.some((b) => want.has(b.evidenceId))) continue;
    const hit = state.candidates.find((c) => c.caseId && h.id.endsWith(c.caseId));
    if (hit?.caseId) return hit.caseId;
  }
  return undefined;
}

const keepRefs = (refs: EvidenceRef[], gate: EvidenceGate): EvidenceRef[] => gate.refs(refs);

/** The state as the viewer may see it: no candidate condition, basis or person-reason evidence beyond their access. */
export function sanitizeState(store: KnowledgeStore, state: InvestigationState, gate: EvidenceGate): InvestigationState {
  return {
    ...state,
    candidates: visibleCandidates(store, state.candidates, gate),
    hypotheses: state.hypotheses.map((h) => ({ ...h, basis: keepRefs(h.basis, gate) })),
    recommendation: { ...state.recommendation, basis: keepRefs(state.recommendation.basis, gate) },
    people: state.people.map((p) => ({ ...p, reasons: p.reasons.map((x) => ({ ...x, evidence: keepRefs(x.evidence, gate) })) })),
  };
}
