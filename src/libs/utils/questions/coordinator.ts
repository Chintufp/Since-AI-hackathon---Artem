import type {
  ActorRef, Answer, AnswerValue, Assessor, ClaimUpdate, Condition, EligibleAction, EvaluationRecord, EvidenceEnvelope, InvestigationState,
  KnowledgeStore, Observation, PolicyDecision, Principal, QuestionCandidate, QuestionGenerator, QuestionRecord, RecipientEligibility, Retriever,
  Selector, TraceEvent,
} from '../contracts/index.ts';
import { freshId, stableId, textFingerprint } from '../contracts/index.ts';
import {
  computeBudget, investigate, OUTCOME_KEY, parseGapId, questionsForInvestigation, startedBy, storeDirectory,
  type InvestigationSettings, type PersonDirectory,
} from '../investigation/index.ts';
import { ANSWER_DIFFERS_FROM_CASE, ANSWER_MATCHES_CASE, foldYearToAge } from '../retrieval/conditions.ts';
import { routeInfo, uniqueRoutes } from '../models/routes.ts';
import { actionKey, SUPPORT_LEVEL } from '../policies/features.ts';
import type { QuestionContext } from './context.ts';
import { evaluateEligibility, PERMANENT_VIOLATIONS } from './eligibility.ts';
import { findRecipients, type RecipientReason } from './recipients.ts';
import { inQuiet, nextWindow } from './quiet-hours.ts';

export interface CoordinatorDeps {
  store: KnowledgeStore;
  settings: InvestigationSettings;
  selector: Selector;
  generator: QuestionGenerator;
  retriever: Retriever;
  assessor: Assessor;
  directory?: PersonDirectory;
  clock?: () => Date;
}

export interface RequestResult {
  state: InvestigationState;
  decision?: PolicyDecision;
  question?: QuestionRecord;
  candidates: QuestionCandidate[];
  eligibility: RecipientEligibility[];
}

export interface AnswerResult {
  answer: Answer;
  question: QuestionRecord;
  state: InvestigationState;
  cancelled: QuestionRecord[];
  /** False when the rebuilt recommendation (kind and text) equals the one before the answer. */
  recommendationChanged: boolean;
}

const ACTIVE = new Set(['queued', 'delivered']);
const actorOf = (p: Principal): ActorRef => ({ id: p.id, displayName: p.displayName });

/** Request/answer/lifecycle coordinator for the clarification loop. Hard eligibility is applied here, before selection. */
export class QuestionCoordinator {
  private d: CoordinatorDeps;
  private ctx: QuestionContext;

  constructor(deps: CoordinatorDeps) {
    this.d = deps;
    this.ctx = { store: deps.store, settings: deps.settings, directory: deps.directory ?? storeDirectory(deps.store), clock: deps.clock ?? (() => new Date()) };
  }

  private get store(): KnowledgeStore {
    return this.d.store;
  }
  private now(): Date {
    return this.ctx.clock();
  }

  private setLoop(state: InvestigationState, loop: InvestigationState['loop'], reason: string): void {
    state.loop = loop;
    state.loopReason = reason;
  }

  /** "Asked <name> because they <contribution> in <case>" when the reason is known, else the generic waiting line. */
  private waitingReason(personEntityId: string, state?: InvestigationState, gapId?: string, recs?: RecipientReason[]): string {
    const R = this.d.settings.loopReasons;
    const name = this.ctx.directory.get(personEntityId)?.name ?? 'the recipient';
    const gap = state && gapId ? state.gaps.find((g) => g.id === gapId) : undefined;
    const found = recs ?? (state && gap ? findRecipients(this.ctx, state, gap) : []);
    const because = found.find((r) => r.personEntityId === personEntityId)?.because;
    return (because ? R.asked.replace('{because}', because) : R.waiting).replace('{name}', name);
  }

  private trace(state: InvestigationState, type: string, data: Record<string, unknown>): TraceEvent {
    const e: TraceEvent = { id: freshId('evt'), at: this.now().toISOString(), type, traceId: state.id, actor: { id: 'system', displayName: 'coordinator' }, data };
    state.events = [...state.events, e];
    this.store.put('trace', e);
    return e;
  }

  private load(state: InvestigationState | string): InvestigationState {
    const id = typeof state === 'string' ? state : state.id;
    const s = this.store.get('investigation', id) ?? (typeof state === 'string' ? undefined : state);
    if (!s) throw new Error(`Unknown investigation ${id}`);
    return s;
  }

  private features(state: InvestigationState, c: QuestionCandidate, r: RecipientReason | undefined, count: number, personId: string): Record<string, number> {
    const parsed = parseGapId(c.gapId);
    const gap = state.gaps.find((g) => g.id === c.gapId);
    const hyp = parsed ? state.hypotheses.find((h) => h.id === stableId('hyp', state.id, parsed.caseId)) : undefined;
    const b = computeBudget(this.store, personId, this.d.settings, this.now());
    let recency = 1;
    if (r?.recencyIso) {
      const days = Math.max(0, (this.now().getTime() - Date.parse(r.recencyIso)) / 86_400_000);
      recency = Math.max(0.5, 1 - days / 730);
    }
    return {
      consequential: gap?.consequential ? 1 : 0,
      firsthand: r?.firsthand ? 1 : 0,
      recipientOpenQuestions: b.openQuestionIds.length,
      recipientAskedToday: b.askedToday,
      candidateCount: count,
      gapDecidesApplicability: parsed?.kind === 'missing' ? 1 : 0,
      hypothesisSupportLevel: SUPPORT_LEVEL[hyp?.support ?? 'unknown'],
      recency,
    };
  }

  /** Generate candidates, apply hard eligibility, let the selector pick one pair or defer, and record everything. */
  async request(stateIn: InvestigationState, opts: { deliver?: boolean } = {}): Promise<RequestResult> {
    const { store, settings, selector, generator } = this.d;
    const state = this.load(stateIn);
    const now = this.now();

    const active = questionsForInvestigation(store, state.id).find((q) => ACTIVE.has(q.status));
    if (active) {
      this.setLoop(state, 'question-open', this.waitingReason(active.personEntityId, state, active.candidate.gapId));
      store.put('investigation', state);
      return { state, question: active, candidates: [], eligibility: [] };
    }

    const candidates = (await generator.generate(state, settings.questions.maxCandidates)).filter((c) => c.kind === 'quick');
    const eligibility: RecipientEligibility[] = [];
    const eligible: EligibleAction[] = [];
    const features: Record<string, Record<string, number>> = {};
    const recipientCache = new Map<string, RecipientReason[]>();
    for (const c of candidates) {
      const gap = state.gaps.find((g) => g.id === c.gapId);
      const recs = recipientCache.get(c.gapId) ?? (gap ? findRecipients(this.ctx, state, gap) : []);
      recipientCache.set(c.gapId, recs);
      const people = c.recipientIds.length ? c.recipientIds : [];
      for (const pid of people) {
        const e = evaluateEligibility(this.ctx, state, c, pid, { recipients: recs });
        eligibility.push(e);
        store.put('eligibility', { ...e, id: `${e.questionId}|${e.personEntityId}|${now.toISOString()}` } as RecipientEligibility & { id: string });
        if (e.eligible) {
          const a = { questionId: c.id, personEntityId: pid };
          eligible.push(a);
          features[actionKey(a)] = this.features(state, c, recs.find((r) => r.personEntityId === pid), candidates.length, pid);
        }
      }
    }

    let decision = selector.select({ state, eligible, candidates, features });
    let chosen = decision.chosen;
    if (chosen !== 'defer' && !eligible.some((a) => actionKey(a) === actionKey(chosen as EligibleAction))) {
      decision = { ...decision, chosen: 'defer', reason: `blocked: selector returned an ineligible pair (${actionKey(chosen as EligibleAction)}); deferred. ${decision.reason}` };
      chosen = 'defer';
    }
    decision = { ...decision, eligible, orgId: state.orgId, investigationId: state.id };
    store.put('decision', decision);
    state.decisionIds = [...state.decisionIds, decision.id];

    const evalRec: EvaluationRecord & { id: string } = {
      id: decision.id, decisionId: decision.id, investigationId: state.id, at: now.toISOString(),
      stateFeatures: chosen === 'defer' ? { candidateCount: candidates.length, eligibleCount: eligible.length } : (features[actionKey(chosen as EligibleAction)] ?? {}),
      eligible, action: chosen, propensity: decision.propensity, assessedBenefit: null,
      effort: { questionsAsked: chosen === 'defer' ? 0 : 1, interruptions: chosen === 'defer' ? 0 : 1 }, missingFeedback: chosen !== 'defer',
    };
    store.put('evaluation', evalRec);

    state.routes = uniqueRoutes([...state.routes, generator.route, { route: decision.selector.route, version: `${decision.selector.id}@${decision.selector.version}` }]);
    let question: QuestionRecord | undefined;
    if (chosen !== 'defer') {
      const cand = candidates.find((c) => c.id === (chosen as EligibleAction).questionId) as QuestionCandidate;
      question = {
        id: stableId('q', state.id, cand.id, (chosen as EligibleAction).personEntityId), orgId: state.orgId, candidate: cand,
        personEntityId: (chosen as EligibleAction).personEntityId, decisionId: decision.id, status: 'queued', createdAt: now.toISOString(), updatedAt: now.toISOString(),
      };
      store.put('question', question);
      state.questionIds = [...state.questionIds, question.id];
      this.trace(state, 'question.queued', { questionId: question.id, personEntityId: question.personEntityId, decisionId: decision.id });
      const qh = settings.coordinator.quietHours;
      if (qh && inQuiet(now, qh)) {
        // B1: nobody is interrupted inside quiet hours; the question waits, queued, for the next window.
        const at = nextWindow(now, qh).toISOString();
        question = store.put('question', { ...question, deliverAfter: at });
        this.trace(state, 'question.held', { questionId: question.id, personEntityId: question.personEntityId, deliverAfter: at, quietHours: qh });
        this.setLoop(state, 'question-open', `Queued until ${qh.end}: nobody is woken at night`);
      } else {
        if (opts.deliver !== false) question = this.deliverNow(question.id);
        this.setLoop(state, 'question-open', this.waitingReason((chosen as EligibleAction).personEntityId, state, cand.gapId, recipientCache.get(cand.gapId)));
      }
    } else {
      const reasons = this.d.settings.loopReasons;
      const used = questionsForInvestigation(store, state.id).filter((q) => q.status !== 'cancelled').length;
      const asked = (e: RecipientEligibility): boolean => e.violations.includes('already-asked') || e.violations.includes('duplicate');
      // B1: an access lookup that names who to ask (no case gap to cite) keeps its own loop line.
      if (candidates.length === 0 && state.recommendation.askWho && state.loop === 'deferred') this.setLoop(state, 'deferred', state.loopReason ?? reasons.noRecipient);
      else if (candidates.length === 0) this.setLoop(state, 'no-question-needed', reasons.noQuestionNeeded);
      // 'exhausted' means only one thing: the per-investigation question budget is used.
      else if (used >= settings.coordinator.maxQuestionsPerInvestigation) this.setLoop(state, 'exhausted', reasons.budgetUsed);
      else if (eligibility.length === 0) this.setLoop(state, 'deferred', reasons.noRecipient);
      else if (eligible.length === 0 && eligibility.every(asked)) this.setLoop(state, 'deferred', reasons.everyoneAsked);
      else if (eligible.length === 0 && eligibility.every((e) => e.violations.some((x) => PERMANENT_VIOLATIONS.includes(x)))) this.setLoop(state, 'deferred', reasons.noRecipient);
      else if (eligible.length === 0) this.setLoop(state, 'deferred', reasons.peopleBusy);
      else this.setLoop(state, 'deferred', reasons.holding);
    }
    this.trace(state, 'decision.recorded', { decisionId: decision.id, chosen: chosen === 'defer' ? 'defer' : actionKey(chosen as EligibleAction), reason: decision.reason });
    state.updatedAt = now.toISOString();
    store.put('investigation', state);
    return { state, decision, ...(question ? { question } : {}), candidates, eligibility };
  }

  /** Recheck eligibility (state may have changed since queueing); deliver or cancel as obsolete. */
  async deliver(questionId: string): Promise<QuestionRecord> {
    return this.deliverNow(questionId);
  }

  /**
   * Synchronous delivery. A question held by quiet hours is not delivered before its `deliverAfter`. A standing question
   * of the 'later' pile goes straight to 'deferred' (listed under Later, never an interruption, so no deliveredAt).
   */
  deliverNow(questionId: string): QuestionRecord {
    const q = this.mustGet(questionId);
    if (q.status !== 'queued') return q;
    const nowD = this.now();
    if (q.deliverAfter && Date.parse(q.deliverAfter) > nowD.getTime()) return q;
    // B1 review: a window that passed unpolled must not let the question out inside the NEXT quiet period
    // (clock moved from 03:00 one night to 03:00 the next): hold it again until the next window.
    const qh = this.d.settings.coordinator.quietHours;
    if (qh && inQuiet(nowD, qh)) {
      const at = nextWindow(nowD, qh).toISOString();
      return q.deliverAfter === at ? q : this.store.put('question', { ...q, deliverAfter: at, updatedAt: nowD.toISOString() });
    }
    const state = this.load(q.candidate.investigationId);
    const e = evaluateEligibility(this.ctx, state, q.candidate, q.personEntityId, { ignoreQuestionIds: [q.id] });
    const now = nowD.toISOString();
    if (!e.eligible) {
      const reason = e.violations.includes('gap-resolved') ? 'gap-resolved' : e.violations.includes('duplicate') ? 'duplicate' : 'obsolete';
      return this.store.put('question', { ...q, status: 'cancelled', cancelReason: reason, previousStatus: q.status, updatedAt: now });
    }
    if (q.candidate.pile === 'later') return this.store.put('question', { ...q, status: 'deferred', previousStatus: q.status, updatedAt: now });
    return this.store.put('question', { ...q, status: 'delivered', deliveredAt: now, previousStatus: q.status, updatedAt: now });
  }

  /**
   * B1: deliver every queued question whose quiet-hours window has come (deliverAfter <= now). deliver() re-checks
   * eligibility, and deliveredAt is now, so the daily limit and cooldown count from the window, not from creation.
   */
  deliverDue(): QuestionRecord[] {
    const now = this.now().getTime();
    const due = this.store.list('question', { where: { status: 'queued' } })
      .filter((q) => q.deliverAfter && Date.parse(q.deliverAfter) <= now)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const out: QuestionRecord[] = [];
    for (const q of due) {
      const r = this.deliverNow(q.id);
      if (r.status === 'queued') continue; // held again: inside the next quiet period
      out.push(r);
      const state = this.store.get('investigation', q.candidate.investigationId);
      if (!state) continue;
      if (r.status === 'delivered' || r.status === 'deferred') {
        this.trace(state, 'question.delivered', { questionId: q.id, personEntityId: q.personEntityId, held: true, status: r.status });
        this.setLoop(state, 'question-open', this.waitingReason(q.personEntityId, state, q.candidate.gapId));
      } else {
        this.trace(state, 'question.cancelled', { questionId: q.id, reason: r.cancelReason });
        this.setLoop(state, 'deferred', this.d.settings.loopReasons.peopleBusy);
      }
      this.store.put('investigation', state);
    }
    return out;
  }

  private mustGet(id: string): QuestionRecord {
    const q = this.store.get('question', id);
    if (!q) throw new Error(`Unknown question ${id}`);
    return q;
  }

  private evidenceFor(state: InvestigationState, p: Principal, connectionId: string, sourceId: string, text: string, scopeCaseId?: string, meta: Record<string, unknown> = {}): EvidenceEnvelope {
    const now = this.now().toISOString();
    const c = scopeCaseId ? this.store.get('case', scopeCaseId) : undefined;
    const env: EvidenceEnvelope = {
      id: stableId('ev', state.orgId, 'paste', connectionId, sourceId, '1'), orgId: state.orgId, provider: 'paste', connectionId, sourceId, revision: '1', kind: 'observation',
      text, author: actorOf(p), eventTime: { known: true, iso: now }, ingestedAt: now, thread: { threadId: state.id, subject: state.problem.text.slice(0, 80) },
      accessScope: c?.accessScope ?? { visibility: 'group', groups: p.groups },
      lineage: { importBatchId: `${connectionId}:${state.id}`, sourceFingerprint: textFingerprint(text) }, metadata: meta,
    };
    this.store.put('evidence', env);
    return env;
  }

  /** A real Claim id for ClaimUpdate: the gap's target claim, else the attempt's advice claim, else the case's hypothesis/advice claim. */
  private targetClaimFor(q: QuestionRecord, parsed: ReturnType<typeof parseGapId>): string | undefined {
    if (q.candidate.targetClaimId && this.store.get('claim', q.candidate.targetClaimId)) return q.candidate.targetClaimId;
    if (!parsed) return undefined;
    if (parsed.kind === 'outcome') {
      const adviceId = this.store.get('attempt', parsed.detail)?.adviceClaimId;
      if (adviceId && this.store.get('claim', adviceId)) return adviceId;
    }
    const claims = this.store.list('claim', { where: { caseId: parsed.caseId } });
    return (claims.find((c) => c.type === 'hypothesis') ?? claims.find((c) => c.type === 'advice'))?.id;
  }

  /** Record an attributed answer; yes/no become an Observation that the investigation applies on rebuild. */
  async answer(questionId: string, value: AnswerValue, principal: Principal, text?: string): Promise<AnswerResult> {
    const q = this.mustGet(questionId);
    if (!ACTIVE.has(q.status)) throw new Error(`Question ${questionId} is ${q.status}; only queued/delivered questions can be answered`);
    const who = this.ctx.directory.resolve(principal.id);
    if (who !== q.personEntityId) throw new Error(`Principal ${principal.id} is not the recipient of question ${questionId}`);
    let state = this.load(q.candidate.investigationId);
    if (state.origin === 'standing') return this.answerStanding(q, state, value, principal, text);
    const parsed = parseGapId(q.candidate.gapId);
    const gap = state.gaps.find((g) => g.id === q.candidate.gapId);
    const now = this.now().toISOString();
    const answerId = stableId('ans', questionId);
    const evText = `Answer "${value}" to: ${q.candidate.text}${text ? ` Note: ${text}` : ''} (answered by ${principal.displayName})`;
    const env = this.evidenceFor(state, principal, 'answer:desktop', answerId, evText, parsed?.caseId, { questionId, value });
    const evRef = { evidenceId: env.id, excerpt: evText.slice(0, 120) };

    const claimId = this.targetClaimFor(q, parsed);
    const upd = (change: ClaimUpdate['change'], note: string): ClaimUpdate[] => (claimId ? [{ claimId, change, note }] : []);
    let claimUpdates: ClaimUpdate[] = [];
    let condition: Condition | undefined;
    if (parsed?.kind === 'missing') {
      // The gap's key may be a folded one (e.g. an age class derived from a stated year): look it up the way retrieval does.
      const key = gap?.targetCondition?.key ?? parsed.detail;
      const caseConds = foldYearToAge(this.store.get('case', parsed.caseId)?.conditions ?? [], this.d.settings.ageFold);
      const caseCond = caseConds.find((c) => c.key === key);
      // A key the problem states but the case never recorded (settings.problemStated) is answered the same way: does the earlier unit share it.
      if (value !== 'unknown' && (caseCond || this.d.settings.problemStated[key])) {
        // The question asks whether the CASE's condition holds here, whatever its operator: record agreement/disagreement
        // with it (understood by agreement()), not an eq/neq of its value.
        condition = { key, operator: 'eq', value: value === 'yes' ? ANSWER_MATCHES_CASE : ANSWER_DIFFERS_FROM_CASE, origin: 'reported', evidence: [evRef], label: `${gap?.targetCondition?.label ?? parsed.detail}: ${value} (answered)` };
      }
      claimUpdates = value === 'unknown'
        ? upd('no-change', 'Unknown: no factual update; the gap stays open.')
        : upd(value === 'yes' ? 'support' : 'contradict', `${principal.displayName} answered ${value} about ${gap?.targetCondition?.label ?? parsed.detail} for the current problem's asset; applicability of the historical response ${value === 'yes' ? 'is supported' : 'is lowered'}. The historical claim itself is unchanged.`);
    } else if (parsed?.kind === 'outcome') {
      if (value !== 'unknown') condition = { key: OUTCOME_KEY, operator: 'eq', value: value === 'yes' ? 'recovered' : 'no-change', origin: 'reported', evidence: [evRef], label: `Outcome after ${parsed.detail}: ${value === 'yes' ? 'recovered' : 'no change'} (answered)` };
      claimUpdates = value === 'unknown'
        ? upd('no-change', 'Unknown: no factual update; the gap stays open.')
        : upd(value === 'yes' ? 'support' : 'contradict', `${principal.displayName} reported ${value === 'yes' ? 'recovery' : 'no recovery'} after the action; attributed to the answerer, not independent of earlier reports.`);
    }
    const answer: Answer = { id: answerId, orgId: state.orgId, questionId, personEntityId: q.personEntityId, value, ...(text ? { text } : {}), at: now, claimUpdates, evidenceId: env.id };
    this.store.put('answer', answer);
    if (condition) {
      const obs: Observation = { id: stableId('obs', answerId), orgId: state.orgId, investigationId: state.id, ...(parsed ? { caseId: parsed.caseId } : {}), condition, reportedBy: actorOf(principal), at: now };
      this.store.put('observation', obs);
    }
    const updated = this.store.put('question', { ...q, status: 'answered', answerId, previousStatus: q.status, updatedAt: now });
    this.trace(state, 'question.answered', { questionId, answerId, value });

    const ev = this.store.get('evaluation', q.decisionId) as (EvaluationRecord & { id: string }) | undefined;
    if (ev) this.store.put('evaluation', { ...ev, response: { value, latencyMs: Math.max(0, Date.parse(now) - Date.parse(q.deliveredAt ?? q.createdAt)) }, missingFeedback: false });

    const before = state.recommendation;
    state = await this.rebuild(state.id);
    const recommendationChanged = before.kind !== state.recommendation.kind || before.text !== state.recommendation.text;
    const g = state.gaps.find((x) => x.id === q.candidate.gapId);
    if (g?.status === 'resolved' && g.resolvedBy) g.resolvedBy = { ...g.resolvedBy, answerId };
    this.setLoop(state, 'answered', recommendationChanged ? this.d.settings.loopReasons.answered : this.d.settings.loopReasons.answeredNoChange);
    this.store.put('investigation', state);
    const cancelled = await this.cancelObsolete(state.id);
    return { answer, question: updated, state: this.load(state.id), cancelled, recommendationChanged };
  }

  /**
   * B1: an answer to a standing gap. Nothing is re-investigated (a standing state has no problem to rebuild):
   * - outcome: an attributed outcome Observation on the case (every investigation citing the case sees it);
   * - pairing: Yes records a confirmed Pattern linking the two cases with the answer as evidence (and the orphan's missing
   *   symptom is resolved by it); No records a rejected Pattern, so the pair is never proposed again;
   * - missing-symptom: the free text is stored as attributed evidence on the case (evidence + an Observation).
   * Unknown records the answer and changes nothing.
   */
  private async answerStanding(q: QuestionRecord, state: InvestigationState, value: AnswerValue, principal: Principal, text?: string): Promise<AnswerResult> {
    const parsed = parseGapId(q.candidate.gapId);
    const now = this.now().toISOString();
    const answerId = stableId('ans', q.id);
    const words = text?.trim();
    const evText = parsed?.kind === 'missing-symptom' && words
      ? `Symptom before ${q.candidate.text.replace(/^You\s+/, '').replace(/\.\s.*$/, '')}: ${words} (reported by ${principal.displayName}, answering: ${q.candidate.text})`
      : `Answer "${value}" to: ${q.candidate.text}${words ? ` Note: ${words}` : ''} (answered by ${principal.displayName})`;
    const env = this.evidenceFor(state, principal, 'answer:desktop', answerId, evText, parsed?.caseId, { questionId: q.id, value, standing: parsed?.kind ?? 'unknown', ...(parsed?.caseId ? { caseId: parsed.caseId } : {}) });
    const evRef = { evidenceId: env.id, excerpt: evText.slice(0, 120) };
    const resolve = new Set<string>();
    let condition: Condition | undefined;
    if (parsed?.kind === 'outcome' && value !== 'unknown') {
      condition = { key: OUTCOME_KEY, operator: 'eq', value: value === 'yes' ? 'recovered' : 'no-change', origin: 'reported', evidence: [evRef], label: `Outcome after ${parsed.detail}: ${value === 'yes' ? 'recovered' : 'no change'} (answered)` };
      resolve.add(q.candidate.gapId);
    } else if (parsed?.kind === 'pairing' && value !== 'unknown') {
      const ids = [parsed.caseId, parsed.detail].sort();
      const a = this.store.get('case', parsed.caseId), b = this.store.get('case', parsed.detail);
      this.store.put('pattern', {
        id: stableId('pattern', 'pairing', ...ids), orgId: state.orgId, title: `${a?.title ?? parsed.caseId} + ${b?.title ?? parsed.detail}`, caseIds: ids,
        sharedConditions: [], distinguishingConditions: [], createdBy: routeInfo('standing-gaps'), status: value === 'yes' ? 'confirmed' : 'rejected',
        evidence: [evRef], answerId, decidedAt: now,
      });
      resolve.add(q.candidate.gapId);
      // A confirmed pairing gives the orphan fix its symptom (the other case's), so that gap is settled too.
      if (value === 'yes') for (const g of state.gaps) if (parseGapId(g.id)?.kind === 'missing-symptom' && g.status === 'open') resolve.add(g.id);
    } else if (parsed?.kind === 'missing-symptom' && words && value !== 'unknown') {
      condition = { key: 'case.symptom', operator: 'eq', value: words, origin: 'reported', evidence: [evRef], label: `Symptom: ${words} (answered)` };
      const c = this.store.get('case', parsed.caseId);
      if (c && !c.evidenceIds.includes(env.id)) this.store.put('case', { ...c, evidenceIds: [...c.evidenceIds, env.id], updatedAt: now });
      resolve.add(q.candidate.gapId);
    }
    const answer: Answer = { id: answerId, orgId: state.orgId, questionId: q.id, personEntityId: q.personEntityId, value, ...(words ? { text: words } : {}), at: now, claimUpdates: [], evidenceId: env.id };
    this.store.put('answer', answer);
    if (condition) this.store.put('observation', { id: stableId('obs', answerId), orgId: state.orgId, investigationId: state.id, ...(parsed ? { caseId: parsed.caseId } : {}), condition, reportedBy: actorOf(principal), at: now });
    const updated = this.store.put('question', { ...q, status: 'answered', answerId, previousStatus: q.status, updatedAt: now });
    state.gaps = state.gaps.map((g) => (resolve.has(g.id) ? { ...g, status: 'resolved' as const, resolvedBy: { answerId, evidenceId: env.id } } : g));
    this.trace(state, 'question.answered', { questionId: q.id, answerId, value, standing: parsed?.kind });
    const ev = this.store.get('evaluation', q.decisionId) as (EvaluationRecord & { id: string }) | undefined;
    if (ev) this.store.put('evaluation', { ...ev, response: { value, latencyMs: Math.max(0, Date.parse(now) - Date.parse(q.deliveredAt ?? q.createdAt)) }, missingFeedback: false });
    this.setLoop(state, 'answered', this.d.settings.loopReasons.answeredNoChange);
    state.updatedAt = now;
    this.store.put('investigation', state);
    const cancelled = await this.cancelObsolete(state.id);
    return { answer, question: updated, state: this.load(state.id), cancelled, recommendationChanged: false };
  }

  /** B1: withdraw an answer to a standing gap: the gap reopens, its Pattern, observation and evidence are removed. */
  private undoStanding(q: QuestionRecord): QuestionRecord {
    const state = this.load(q.candidate.investigationId);
    const answerId = q.answerId as string;
    const a = this.store.get('answer', answerId);
    for (const p of this.store.list('pattern').filter((x) => x.answerId === answerId)) this.store.delete('pattern', p.id);
    this.store.delete('answer', answerId);
    this.store.delete('observation', stableId('obs', answerId));
    if (a) {
      this.store.delete('evidence', a.evidenceId);
      for (const c of this.store.list('case').filter((x) => x.evidenceIds.includes(a.evidenceId))) this.store.put('case', { ...c, evidenceIds: c.evidenceIds.filter((id) => id !== a.evidenceId) });
    }
    state.gaps = state.gaps.map((g) => (g.resolvedBy?.answerId === answerId ? (({ resolvedBy: _r, ...rest }) => ({ ...rest, status: 'open' as const }))(g) : g));
    this.setLoop(state, 'question-open', this.waitingReason(q.personEntityId, state, q.candidate.gapId));
    this.store.put('investigation', state);
    const { answerId: _drop, ...rest } = { ...q, status: q.previousStatus as QuestionRecord['status'], updatedAt: this.now().toISOString() };
    this.store.put('question', rest);
    return rest;
  }

  /** Re-run the assessment with every recorded observation/answer; carries questions, decisions and events over. */
  async rebuild(investigationId: string): Promise<InvestigationState> {
    const prev = this.load(investigationId);
    const principal = startedBy(prev);
    if (!principal) throw new Error(`Investigation ${investigationId} has no recorded starting principal`);
    const next = await investigate({
      problem: prev.problem, store: this.store, principal, previous: prev,
      deps: { retriever: this.d.retriever, assessor: this.d.assessor, generator: this.d.generator, settings: this.d.settings, clock: this.ctx.clock, directory: this.ctx.directory },
    });
    if (prev.loop === 'question-open') this.setLoop(next, 'question-open', prev.loopReason ?? this.d.settings.loopReasons.preparing);
    return next;
  }

  /** A requester/agent observation resolves a gap without asking anyone; obsolete questions are cancelled. */
  async recordObservation(investigationId: string, condition: Condition, by: ActorRef, caseId?: string): Promise<{ state: InvestigationState; cancelled: QuestionRecord[] }> {
    const state0 = this.load(investigationId);
    const p = startedBy(state0);
    const principal: Principal = p ?? { id: by.id, displayName: by.displayName, groups: [], type: 'human' };
    const now = this.now().toISOString();
    const obsId = stableId('obs', investigationId, condition.key, String(condition.value), now);
    const env = this.evidenceFor(state0, principal, 'observation:desktop', obsId, `Observation: ${condition.label ?? condition.key} (${condition.operator} ${String(condition.value)}) reported by ${by.displayName}`);
    const cond: Condition = { ...condition, evidence: [...condition.evidence, { evidenceId: env.id }] };
    this.store.put('observation', { id: obsId, orgId: state0.orgId, investigationId, ...(caseId ? { caseId } : {}), condition: cond, reportedBy: by, at: now });
    const state = await this.rebuild(investigationId);
    this.trace(state, 'observation.recorded', { observationId: obsId, key: condition.key });
    this.store.put('investigation', state);
    const cancelled = await this.cancelObsolete(investigationId);
    return { state: this.load(investigationId), cancelled };
  }

  /** Cancel queued/delivered questions whose gap is resolved/gone, and duplicates within the investigation. */
  async cancelObsolete(investigationId: string): Promise<QuestionRecord[]> {
    const state = this.load(investigationId);
    const now = this.now().toISOString();
    const out: QuestionRecord[] = [];
    const seen = new Set<string>();
    const active = questionsForInvestigation(this.store, investigationId).filter((q) => ACTIVE.has(q.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const q of active) {
      const gap = state.gaps.find((g) => g.id === q.candidate.gapId);
      let reason: QuestionRecord['cancelReason'] | undefined;
      if (gap?.status === 'resolved') reason = 'gap-resolved';
      else if (!gap || gap.status === 'cancelled') reason = 'obsolete';
      else if (seen.has(q.candidate.dedupKey)) reason = 'duplicate';
      seen.add(q.candidate.dedupKey);
      if (reason) {
        out.push(this.store.put('question', { ...q, status: 'cancelled', cancelReason: reason, previousStatus: q.status, updatedAt: now }));
        this.trace(state, 'question.cancelled', { questionId: q.id, reason });
      }
    }
    if (out.length) this.store.put('investigation', state);
    return out;
  }

  private transition(questionId: string, to: 'deferred' | 'dismissed', who: Principal): QuestionRecord {
    const q = this.mustGet(questionId);
    if (this.ctx.directory.resolve(who.id) !== q.personEntityId) throw new Error('Only the recipient can defer or dismiss a question');
    if (!ACTIVE.has(q.status)) throw new Error(`Question is ${q.status}`);
    const r = this.store.put('question', { ...q, status: to, previousStatus: q.status, updatedAt: this.now().toISOString() });
    this.trace(this.load(q.candidate.investigationId), `question.${to}`, { questionId });
    return r;
  }
  defer(questionId: string, who: Principal): QuestionRecord {
    return this.transition(questionId, 'deferred', who);
  }
  dismiss(questionId: string, who: Principal): QuestionRecord {
    return this.transition(questionId, 'dismissed', who);
  }

  /** Cancel by the requester or an agent (not the system's gap-resolved path). */
  cancel(questionId: string, reason: 'requester' | 'agent' = 'requester'): QuestionRecord {
    const q = this.mustGet(questionId);
    if (!ACTIVE.has(q.status)) throw new Error(`Question is ${q.status}`);
    return this.store.put('question', { ...q, status: 'cancelled', cancelReason: reason, previousStatus: q.status, updatedAt: this.now().toISOString() });
  }

  /** Undo a defer/dismiss/answer/cancel by the requester: restores previousStatus (an answer is withdrawn with its evidence). */
  async undo(questionId: string, who: Principal): Promise<QuestionRecord> {
    const q = this.mustGet(questionId);
    if (!q.previousStatus) throw new Error('Nothing to undo');
    if (q.status === 'cancelled' && (q.cancelReason === 'gap-resolved' || q.cancelReason === 'duplicate' || q.cancelReason === 'obsolete')) throw new Error('System cancellations cannot be undone');
    if (q.status === 'cancelled') {
      const requester = startedBy(this.load(q.candidate.investigationId));
      if (who.type !== 'agent' && who.id !== requester?.id) throw new Error('Only the requester or an agent can undo a cancellation');
    } else if (this.ctx.directory.resolve(who.id) !== q.personEntityId) throw new Error('Only the recipient can undo');
    if (q.status === 'answered' && q.answerId && this.store.get('investigation', q.candidate.investigationId)?.origin === 'standing') return this.undoStanding(q);
    if (q.status === 'answered' && q.answerId) {
      const a = this.store.get('answer', q.answerId);
      this.store.delete('answer', q.answerId);
      this.store.delete('observation', stableId('obs', q.answerId));
      if (a) this.store.delete('evidence', a.evidenceId);
      const restored = this.store.put('question', { ...q, status: q.previousStatus, updatedAt: this.now().toISOString() });
      const { answerId: _drop, ...rest } = restored;
      this.store.put('question', rest);
      const state = await this.rebuild(q.candidate.investigationId);
      this.setLoop(state, 'question-open', this.waitingReason(q.personEntityId, state, q.candidate.gapId));
      this.store.put('investigation', state);
      return rest;
    }
    const { cancelReason: _c, ...base } = q;
    return this.store.put('question', { ...base, status: q.previousStatus, updatedAt: this.now().toISOString() });
  }
}
