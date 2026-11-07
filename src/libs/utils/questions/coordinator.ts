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
import { uniqueRoutes } from '../models/routes.ts';
import { healthProductOrNull, STORE_METRIC_METHOD, storeHealth } from '../memory/store-health.ts';
import { actionKey, SUPPORT_LEVEL } from '../policies/features.ts';
import type { QuestionContext } from './context.ts';
import { evaluateEligibility, PERMANENT_VIOLATIONS } from './eligibility.ts';
import { findRecipients, type RecipientReason } from './recipients.ts';

export interface CoordinatorDeps {
  store: KnowledgeStore;
  settings: InvestigationSettings;
  selector: Selector;
  generator: QuestionGenerator;
  retriever: Retriever;
  assessor: Assessor;
  directory?: PersonDirectory;
  clock?: () => Date;
  /** Called after the selector learned from a measured reward (the service persists live LinUCB state here). */
  onSelectorUpdated?: (selector: Selector) => void;
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
/** Burden weights (BUILD_BRIEF 5.3): per extra question asked today, per other open question, inside quiet hours. */
export const BURDEN = { askedToday: 0.02, open: 0.02, quiet: 0.05 };
const round4 = (x: number): number => Math.round(x * 10_000) / 10_000;
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
      if (opts.deliver !== false) question = await this.deliver(question.id);
      this.setLoop(state, 'question-open', this.waitingReason((chosen as EligibleAction).personEntityId, state, cand.gapId, recipientCache.get(cand.gapId)));
    } else {
      const reasons = this.d.settings.loopReasons;
      const used = questionsForInvestigation(store, state.id).filter((q) => q.status !== 'cancelled').length;
      const asked = (e: RecipientEligibility): boolean => e.violations.includes('already-asked') || e.violations.includes('duplicate');
      if (candidates.length === 0) this.setLoop(state, 'no-question-needed', reasons.noQuestionNeeded);
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
    const q = this.mustGet(questionId);
    if (q.status !== 'queued') return q;
    const state = this.load(q.candidate.investigationId);
    const e = evaluateEligibility(this.ctx, state, q.candidate, q.personEntityId, { ignoreQuestionIds: [q.id] });
    const now = this.now().toISOString();
    if (!e.eligible) {
      const reason = e.violations.includes('gap-resolved') ? 'gap-resolved' : e.violations.includes('duplicate') ? 'duplicate' : 'obsolete';
      return this.store.put('question', { ...q, status: 'cancelled', cancelReason: reason, previousStatus: q.status, updatedAt: now });
    }
    return this.store.put('question', { ...q, status: 'delivered', deliveredAt: now, previousStatus: q.status, updatedAt: now });
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
    const parsed = parseGapId(q.candidate.gapId);
    const gap = state.gaps.find((g) => g.id === q.candidate.gapId);
    const now = this.now().toISOString();
    const answerId = stableId('ans', questionId);
    // BUILD_BRIEF 5.4: the store metric of the touched cases before the answer is stored, and the recipient's burden now.
    const touched = parsed ? [parsed.caseId] : q.candidate.scope.caseId ? [q.candidate.scope.caseId] : [];
    const before = this.measure(touched);
    const burden = this.burden(q);
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

    const recBefore = state.recommendation;
    state = await this.rebuild(state.id);
    const recommendationChanged = recBefore.kind !== state.recommendation.kind || recBefore.text !== state.recommendation.text;
    // The rebuilt investigation is stored before measuring, so the retrieval weight sees it.
    this.store.put('investigation', state);
    const after = this.measure(touched);
    // Unmeasurable before or after: no reward, the benefit stays null and the selector learns nothing (never a 0).
    const reward = before === null || after === null ? undefined
      : this.learn(q.decisionId, updated.id, { method: STORE_METRIC_METHOD, cases: touched, before, after, delta: round4(after - before), burden, value: round4(after - before - burden), at: now });
    const g = state.gaps.find((x) => x.id === q.candidate.gapId);
    if (g?.status === 'resolved' && g.resolvedBy) g.resolvedBy = { ...g.resolvedBy, answerId };
    this.setLoop(state, 'answered', recommendationChanged ? this.d.settings.loopReasons.answered : this.d.settings.loopReasons.answeredNoChange);
    this.store.put('investigation', state);
    const cancelled = await this.cancelObsolete(state.id);
    const question = reward ? (this.store.get('question', updated.id) ?? updated) : updated;
    return { answer, question, state: this.load(state.id), cancelled, recommendationChanged };
  }

  // ---- reward (BUILD_BRIEF 5.4) ----------------------------------------------------------------------

  /** completeness x correctness of `caseIds`, measured from the store at the engine clock; null when it cannot be measured (no case, no case claim). */
  measure(caseIds: string[]): number | null {
    if (!caseIds.length) return null;
    return healthProductOrNull(storeHealth(this.store, undefined, { now: this.now(), caseIds, distinguishingKeys: this.d.settings.distinguishingKeys, outcomeKey: OUTCOME_KEY }));
  }

  /**
   * The recipient's burden when answering: questions delivered to them today and their other open questions, plus
   * a quiet-hours term when the settings carry quiet hours (B1) and it is inside them.
   */
  private burden(q: QuestionRecord): number {
    const b = computeBudget(this.store, q.personEntityId, this.d.settings, this.now(), [q.id]);
    const quiet = (this.d.settings.coordinator as { quietHours?: { start: string; end: string } }).quietHours;
    const hm = this.now().toISOString().slice(11, 16);
    const inQuiet = !!quiet && (quiet.start <= quiet.end ? hm >= quiet.start && hm < quiet.end : hm >= quiet.start || hm < quiet.end);
    return round4(BURDEN.askedToday * b.askedToday + BURDEN.open * b.openQuestionIds.length + (inQuiet ? BURDEN.quiet : 0));
  }

  /** Write the measured benefit on the evaluation and the question, then let the selector learn from it. */
  private learn(decisionId: string, questionId: string, reward: NonNullable<QuestionRecord['reward']>, previousValue?: number): QuestionRecord['reward'] {
    const ev = this.store.get('evaluation', decisionId) as (EvaluationRecord & { id: string }) | undefined;
    const q = this.store.get('question', questionId);
    if (!ev || !q) return undefined;
    const next = this.store.put('evaluation', { ...ev, assessedBenefit: { value: reward.value, method: STORE_METRIC_METHOD } });
    this.store.put('question', { ...q, reward });
    // A re-measurement corrects what the selector learned; it is not a second observation of the decision.
    const sel = this.d.selector;
    const apply = previousValue === undefined ? (sel.update ? () => sel.update!([next]) : undefined) : (sel.correct ? () => sel.correct!(next, previousValue) : undefined);
    if (apply) {
      try {
        apply();
        this.d.onSelectorUpdated?.(this.d.selector);
      } catch {
        // A selector that cannot learn from this record never breaks an answer.
      }
    }
    return reward;
  }

  /**
   * After an outcome report lands, re-measure the cases of this investigation's answered outcome questions and update
   * the same evaluation record; the selector applies only the change (`Selector.correct`), never a second observation. Returns the questions updated.
   */
  rewardOutcome(investigationId: string): QuestionRecord[] {
    const out: QuestionRecord[] = [];
    for (const q of questionsForInvestigation(this.store, investigationId)) {
      if (q.status !== 'answered' || !q.reward || parseGapId(q.candidate.gapId)?.kind !== 'outcome') continue;
      const after = this.measure(q.reward.cases);
      if (after === null || after === q.reward.after) continue;
      const delta = round4(after - q.reward.before);
      this.learn(q.decisionId, q.id, { ...q.reward, after, delta, value: round4(delta - q.reward.burden), outcomeAt: this.now().toISOString() }, q.reward.value);
      out.push(this.store.get('question', q.id)!);
    }
    return out;
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
