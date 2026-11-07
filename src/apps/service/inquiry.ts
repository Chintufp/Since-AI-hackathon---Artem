/**
 * B7 · agent-driven inquiry: what an agent is told about the open gaps of an investigation it started, and how
 * confident the engine is. Confidence is two labels (support, applicability) with reasons and evidence references, and
 * which open gap would move each; never a score, a cosine or a model's confidence. Everything is built from what the
 * requester may see (the recipients and case facts are already gated by the requester's evidence visibility).
 */
import type { EligibilityViolation, EvidenceRef, Gap, InvestigationState, QuestionCandidate } from '../../libs/utils/contracts/index.ts';
import { stableId } from '../../libs/utils/contracts/index.ts';
import { basisCaseId, parseGapId, questionsForInvestigation, startedBy } from '../../libs/utils/investigation/index.ts';
import { acceptedWordings, evaluateEligibility, findRecipients, type QuestionContext } from '../../libs/utils/questions/index.ts';
import { inQuiet, nextWindow } from '../../libs/utils/questions/quiet-hours.ts';
import { evidenceGate } from '../../libs/utils/retrieval/index.ts';
import { ACTIVE_QUESTION } from './views.ts';

/** Plain words for each eligibility gate, for refusals and for "can be asked now". */
export const VIOLATION_WORDS: Record<EligibilityViolation, string> = {
  'not-answerable': 'not a recipient for this gap (no firsthand link to it and no role or group configured to observe it)',
  budget: 'question budget used (3 a day per person, one open question per person, 3 per investigation)',
  cooldown: 'cooling down after a recent question',
  access: 'may not see the evidence this question is built from',
  unavailable: 'marked unavailable in the directory',
  self: 'is the requester',
  'already-asked': 'was already asked this question',
  duplicate: 'the same question is already open',
  'gap-resolved': 'the gap is no longer open',
};
export const violationWords = (v: EligibilityViolation[]): string[] => v.map((x) => VIOLATION_WORDS[x] ?? x);

export type GapDecides = 'applicability' | 'support' | 'nothing';

export interface GapRecipientView {
  personEntityId: string;
  name: string;
  role?: string;
  firsthand: boolean;
  because?: string;
  reasons: string[];
  /** Every gate passes for this gap now (quiet hours only hold the question; they do not block it). */
  askableNow: boolean;
  blockedBy: EligibilityViolation[];
  blockedWhy: string[];
}

export interface GapView {
  id: string;
  kind: string;
  description: string;
  whatAnswerChanges: string;
  consequential: boolean;
  decides: GapDecides;
  decidesApplicability: boolean;
  /** The requester can observe this condition directly: record it with kt_record_observation instead of asking. */
  requesterCanCheck: boolean;
  /** A question can be asked for this gap (kt_request_clarification with gapId). */
  askable: boolean;
  notAskedBecause?: string;
  question?: { templateText: string; agentWording?: string };
  openQuestion?: { questionId: string; status: string; personEntityId: string; name: string; deliverAfter?: string };
  whoCouldAnswer: GapRecipientView[];
}

export interface ConfidenceLabel<L extends string> {
  label: L;
  reasons: string[];
  evidenceRefs: Array<{ evidenceId: string; excerpt?: string }>;
  /** Open gaps whose answer would move this label. */
  movedByGapIds: string[];
  /** Gaps already settled for this label, and by what. */
  settledBy: Array<{ gapId: string; answerId?: string; observationId?: string; evidenceId?: string }>;
}

export interface ConfidenceView {
  hypothesisId: string;
  caseId: string;
  statement: string;
  support: ConfidenceLabel<'supported' | 'weak' | 'contradicted' | 'unknown'>;
  applicability: ConfidenceLabel<'applicable' | 'qualified' | 'inapplicable' | 'unknown'>;
}

export interface GapsView {
  investigationId: string;
  recommendation: { kind: string; text: string };
  loop: string;
  loopReason?: string;
  /** Inside quiet hours a question asked now is held, queued, until this moment. */
  quietHours?: { now: boolean; heldUntil?: string };
  gaps: GapView[];
  confidence: ConfidenceView | null;
  meaning: string;
}

/** Applicability reasons as the assessor writes them (investigation/assessor.ts applicabilityFor); every other note is about support. */
const APPLICABILITY_NOTE = /^(conflict on distinguishing|distinguishing condition not yet known|non-distinguishing conflict|no condition of the case|no conflicts;)/;

export const decidesOf = (g: Gap): GapDecides => {
  const kind = parseGapId(g.id)?.kind;
  if (!g.consequential) return 'nothing';
  return kind === 'missing' ? 'applicability' : kind === 'outcome' || kind === 'lasting' ? 'support' : 'nothing';
};

/** Why no question is asked for a gap that has no template candidate. */
export function notAskedReason(ctx: QuestionContext, g: Gap): string {
  const p = parseGapId(g.id);
  if (g.status !== 'open') return `The gap is ${g.status}.`;
  if (p?.kind === 'missing' && ctx.settings.requesterObservableKeys.includes(g.targetCondition?.key ?? p.detail)) return 'The requester can check this directly: record what you see with kt_record_observation.';
  if (!g.consequential) return 'Not consequential: the answer would not change the recommendation, so nobody is interrupted for it.';
  return 'No question can be built for this gap from what the requester may see.';
}

export function gapsView(ctx: QuestionContext, state: InvestigationState, templates: Array<{ candidate: QuestionCandidate }>, meaning: string): GapsView {
  const { store, settings, directory } = ctx;
  const now = ctx.clock();
  const wordings = acceptedWordings(store, state.id);
  const active = questionsForInvestigation(store, state.id).filter((q) => ACTIVE_QUESTION.has(q.status));
  const gaps: GapView[] = state.gaps.filter((g) => g.status === 'open').map((g) => {
    const parsed = parseGapId(g.id);
    const kind = parsed?.kind ?? 'unknown';
    const requesterCanCheck = kind === 'missing' && settings.requesterObservableKeys.includes(g.targetCondition?.key ?? parsed?.detail ?? '');
    const cand = templates.find((t) => t.candidate.gapId === g.id && t.candidate.kind === 'quick')?.candidate;
    const open = active.find((q) => q.candidate.gapId === g.id);
    const recipients = cand ? findRecipients(ctx, state, g) : [];
    const who: GapRecipientView[] = recipients.map((r) => {
      const person = directory.get(r.personEntityId);
      const e = evaluateEligibility(ctx, state, cand as QuestionCandidate, r.personEntityId, { recipients });
      return {
        personEntityId: r.personEntityId, name: person?.name ?? r.personEntityId, ...(person?.role ? { role: person.role } : {}),
        firsthand: r.firsthand, ...(r.because ? { because: r.because } : {}), reasons: r.reasons,
        askableNow: e.eligible, blockedBy: e.violations, blockedWhy: violationWords(e.violations),
      };
    });
    const decides = decidesOf(g);
    const w = wordings.get(g.id);
    return {
      id: g.id, kind, description: g.description, whatAnswerChanges: g.whatAnswerChanges, consequential: g.consequential,
      decides, decidesApplicability: decides === 'applicability', requesterCanCheck, askable: !!cand,
      ...(cand ? {} : { notAskedBecause: notAskedReason(ctx, g) }),
      ...(cand ? { question: { templateText: cand.text, ...(w ? { agentWording: w.text } : {}) } } : {}),
      ...(open ? { openQuestion: { questionId: open.id, status: open.status, personEntityId: open.personEntityId, name: directory.get(open.personEntityId)?.name ?? open.personEntityId, ...(open.status === 'queued' && open.deliverAfter ? { deliverAfter: open.deliverAfter } : {}) } } : {}),
      whoCouldAnswer: who,
    };
  });
  const qh = settings.coordinator.quietHours;
  const quiet = qh ? (inQuiet(now, qh) ? { now: true, heldUntil: nextWindow(now, qh).toISOString() } : { now: false }) : undefined;
  return {
    investigationId: state.id, recommendation: { kind: state.recommendation.kind, text: state.recommendation.text },
    loop: state.loop, ...(state.loopReason ? { loopReason: state.loopReason } : {}), ...(quiet ? { quietHours: quiet } : {}),
    gaps, confidence: confidenceView(ctx, state), meaning,
  };
}

/** The selected hypothesis (the case the recommendation depends on) as two labels with reasons and visible evidence. */
export function confidenceView(ctx: QuestionContext, state: InvestigationState): ConfidenceView | null {
  const caseId = basisCaseId(state);
  const h = caseId ? state.hypotheses.find((x) => x.id === stableId('hyp', state.id, caseId)) : undefined;
  if (!caseId || !h) return null;
  const viewer = startedBy(state);
  const gate = viewer ? evidenceGate(ctx.store, viewer) : undefined;
  const refs = (gate ? gate.refs(h.basis) : h.basis).map((r: EvidenceRef) => ({ evidenceId: r.evidenceId, ...(r.excerpt ? { excerpt: r.excerpt } : {}) }));
  const onCase = state.gaps.filter((g) => parseGapId(g.id)?.caseId === caseId);
  const by = (d: GapDecides) => ({
    movedByGapIds: onCase.filter((g) => g.status === 'open' && decidesOf(g) === d).map((g) => g.id),
    settledBy: onCase.filter((g) => g.status === 'resolved' && (parseGapId(g.id)?.kind === 'missing' ? 'applicability' : 'support') === d)
      .map((g) => ({ gapId: g.id, ...(g.resolvedBy ?? {}) })),
  });
  return {
    hypothesisId: h.id, caseId, statement: h.statement,
    support: { label: h.support, reasons: h.notes.filter((n) => !APPLICABILITY_NOTE.test(n)), evidenceRefs: refs, ...by('support') },
    applicability: { label: h.applicability, reasons: h.notes.filter((n) => APPLICABILITY_NOTE.test(n)), evidenceRefs: refs, ...by('applicability') },
  };
}
