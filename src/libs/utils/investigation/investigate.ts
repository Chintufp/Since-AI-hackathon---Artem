import type {
  Assessor, CandidateMatch, Condition, EvidenceRef, Gap, Hypothesis, InvestigationState, KnowledgeStore, Observation,
  Principal, Problem, QuestionGenerator, Retriever, RouteInfo, Selector, TraceEvent,
} from '../contracts/index.ts';
import { freshId, stableId } from '../contracts/index.ts';
import { routeInfo, uniqueRoutes } from '../models/routes.ts';
import { canSee, evidenceGate, gateAt, type EvidenceGate } from '../retrieval/access.ts';
import { isAnswerMarker } from '../retrieval/conditions.ts';
import { resolveEntityIds } from '../retrieval/exact.ts';
import { ACCESS_INTENT_KEY, lookupAccessFacts } from './access-facts.ts';
import { buildAlternatives } from './alternatives.ts';
import { loadCaseFacts, OUTCOME_KEY, viewerOfState } from './case-facts.ts';
import { casePhrase, shortCaseLabel } from './phrases.ts';
import { storeDirectory, type PersonDirectory } from './directory.ts';
import { buildGaps, parseGapId } from './gaps.ts';
import { buildPeople } from './people.ts';
import { visibleCandidates } from './visible-candidates.ts';
import { parseProblemText, type ParserOptions } from './problem-parser.ts';
import { isRelatedCandidate } from './related.ts';
import { recommend } from './recommend.ts';
import type { InvestigationSettings } from './settings.ts';
import type { HypothesisDetail } from './types.ts';

export interface InvestigateDeps {
  retriever: Retriever;
  assessor: Assessor;
  /** Used only to decide whether any question is possible (loop status); the coordinator asks. */
  generator?: QuestionGenerator;
  /** Accepted for wiring symmetry; selection happens in the coordinator, which adds its route. */
  selector?: Selector;
  settings: InvestigationSettings;
  clock?: () => Date;
  directory?: PersonDirectory;
  parser?: ParserOptions;
}

export interface InvestigateInput {
  problem: Problem;
  store: KnowledgeStore;
  principal: Principal;
  deps: InvestigateDeps;
  /** Prior state when rebuilding after an answer/observation; questions, decisions and events are carried over. */
  previous?: InvestigationState;
}

export const investigationId = (problemId: string): string => stableId('inv', problemId);

/** B1: the problem's point in time in epoch ms (undefined = now). */
export const atOf = (problem: Pick<Problem, 'at'>): number | undefined => {
  const ms = problem.at ? Date.parse(problem.at) : NaN;
  return Number.isFinite(ms) ? ms : undefined;
};

const dedupeRefs = (refs: EvidenceRef[]): EvidenceRef[] => {
  const seen = new Set<string>();
  return refs.filter((r) => (seen.has(r.evidenceId) ? false : (seen.add(r.evidenceId), true)));
};

/** Problem text parse < supplied observations < recorded observations/answers (later wins per key). */
function mergeConditions(layers: Condition[][]): Condition[] {
  // An attributed yes/no answer is kept next to what was stated on the same key; comparison lets the answer decide.
  const byKey = new Map<string, Condition>();
  for (const layer of layers) for (const c of layer) byKey.set(isAnswerMarker(c) ? `${c.key}#answer` : c.key, c);
  return [...byKey.values()];
}

async function buildHypothesis(
  d: { candidate: CandidateMatch; state: InvestigationState; deps: InvestigateDeps; store: KnowledgeStore; gate: EvidenceGate },
): Promise<HypothesisDetail | undefined> {
  const { candidate, state, deps, store, gate } = d;
  const assessment = await deps.assessor.assess(candidate, state);
  if (candidate.caseId) {
    const facts = loadCaseFacts(store, candidate.caseId, state.id, deps.settings, gate, atOf(state.problem));
    if (!facts.case) return undefined;
    if (facts.hypothesisClaims.length === 0 && facts.attempts.length === 0 && facts.adviceClaims.length === 0) return undefined;
    const primary = facts.corrective ?? facts.diagnostic;
    const claimIds = [...facts.hypothesisClaims, ...facts.adviceClaims].map((c) => c.id);
    const statement = facts.hypothesisClaims[0]?.statement ?? facts.adviceClaims[0]?.statement ?? `${primary ? casePhrase(primary.action, facts.evidenceText, deps.settings.phrases).noun : 'the response'} in "${facts.case.title}"`;
    const basis = dedupeRefs([
      ...[...facts.hypothesisClaims, ...facts.adviceClaims].flatMap((c) => c.supporting),
      ...facts.attempts.flatMap((a) => a.evidence),
      ...facts.primaryOutcomes.flatMap((o) => o.evidence),
    ]);
    const hypothesis: Hypothesis = {
      id: stableId('hyp', state.id, candidate.caseId), statement, basis, sourceClaimIds: claimIds,
      support: assessment.support, applicability: assessment.applicability, assessment: assessment.route, notes: assessment.reasons,
    };
    return { hypothesis, candidate, assessment, title: facts.case.title, label: shortCaseLabel(store, facts.case), facts };
  }
  const proc = candidate.procedureId ? store.get('procedure', candidate.procedureId) : undefined;
  if (!proc) return undefined;
  const hypothesis: Hypothesis = {
    id: stableId('hyp', state.id, proc.id), statement: proc.purpose, basis: [], sourceClaimIds: [],
    support: assessment.support, applicability: assessment.applicability, assessment: assessment.route, notes: assessment.reasons,
  };
  return { hypothesis, candidate, assessment, title: proc.purpose, label: proc.purpose.length > 40 ? `${proc.purpose.slice(0, 39).trimEnd()}…` : proc.purpose };
}

/**
 * Attributed answers given in OTHER investigations about the same asset(s) and condition key are reused as evidence
 * (inventory-style facts such as unit revision), so the only person who knows is not asked the same thing again.
 * Only condition answers are reused (never outcome answers), only when the answer's evidence is visible to the principal.
 */
function priorAnswerConditions(store: KnowledgeStore, investigationId: string, entityIds: string[], principal: Principal, atMs?: number): Condition[] {
  if (entityIds.length === 0) return [];
  const want = [...entityIds].sort().join(',');
  const out: Condition[] = [];
  const answered = store.list('question').filter((q) => q.status === 'answered' && q.answerId && q.candidate.investigationId !== investigationId)
    .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt));
  for (const q of answered) {
    const p = parseGapId(q.candidate.gapId);
    if (p?.kind !== 'missing' || [...q.candidate.scope.entityIds].sort().join(',') !== want) continue;
    const obs = store.get('observation', stableId('obs', q.answerId as string));
    const ans = store.get('answer', q.answerId as string);
    const ev = ans ? store.get('evidence', ans.evidenceId) : undefined;
    if (!obs || !ev || !canSee(ev.accessScope, principal)) continue;
    if (atMs !== undefined && (Date.parse(obs.at) > atMs || (ev.eventTime.known && ev.eventTime.iso && Date.parse(ev.eventTime.iso) > atMs))) continue;
    out.push({ ...obs.condition, label: `${obs.condition.label ?? obs.condition.key} [prior answer, earlier investigation]` });
  }
  return out;
}

/** Marks gaps that disappeared since `previous` as resolved (by an observation/answer) or cancelled. */
function carryGaps(previous: InvestigationState | undefined, fresh: Gap[], observations: Observation[]): Gap[] {
  if (!previous) return fresh;
  const freshIds = new Set(fresh.map((g) => g.id));
  const carried: Gap[] = [];
  for (const g of previous.gaps) {
    if (freshIds.has(g.id)) continue;
    if (g.status !== 'open') {
      carried.push(g);
      continue;
    }
    const p = parseGapId(g.id);
    const obs = observations.find((o) => (p?.kind === 'missing' ? o.condition.key === p.detail : p?.kind === 'outcome' ? o.condition.key === OUTCOME_KEY && o.caseId === p.caseId : false));
    const evidenceId = obs?.condition.evidence[0]?.evidenceId;
    carried.push(obs
      ? { ...g, status: 'resolved', resolvedBy: { observationId: obs.id, ...(evidenceId ? { evidenceId } : {}) } }
      : { ...g, status: 'cancelled' });
  }
  return [...fresh, ...carried];
}

/**
 * Investigate a new problem: retrieve candidates (access-filtered), compare conditions, assess each hypothesis
 * (support and applicability), gate the recommendation by evidence class, derive consequential gaps and the people
 * with relevant experience. Recorded observations/answers for this investigation are always applied, so calling
 * this again after new evidence rebuilds the whole state.
 */
export async function investigate(input: InvestigateInput): Promise<InvestigationState> {
  const { problem, store, principal, deps } = input;
  const { settings } = deps;
  const clock = deps.clock ?? (() => new Date());
  const now = clock();
  const nowIso = now.toISOString();
  const id = investigationId(problem.id);
  const directory = deps.directory ?? storeDirectory(store);
  // Re-running the same problem is idempotent: carry over questions, decisions, events and gap resolutions.
  const previous = input.previous ?? store.get('investigation', id);

  const parsedRaw = parseProblemText(problem.text, problem.id, { olderThroughYear: settings.ageFold.olderThroughYear, ...(settings.modelParser !== undefined ? { modelParser: settings.modelParser } : {}), ...deps.parser });
  // B1 part B: intent.* keys describe what the requester wants, never the incident; they stay out of matching.
  const accessIntent = parsedRaw.conditions.find((c) => c.key === ACCESS_INTENT_KEY);
  const parsed = { ...parsedRaw, conditions: parsedRaw.conditions.filter((c) => !c.key.startsWith('intent.')) };
  const atMs = atOf(problem);
  // B1: a past view leaves out what was recorded after it (answers, observations, outcome overlays).
  const recorded = store.list('observation', { where: { investigationId: id } }).filter((o) => atMs === undefined || Date.parse(o.at) <= atMs).sort((a, b) => a.at.localeCompare(b.at));
  const visibleEntities = store.list('entity').filter((e) => canSee(e.accessScope, principal));
  const { ids: entityIds } = resolveEntityIds(problem.text, visibleEntities, problem.entityIds ?? []);
  const prior = priorAnswerConditions(store, id, entityIds, principal, atMs);
  const conditions = mergeConditions([
    parsed.conditions, prior, problem.observations ?? [], recorded.map((o) => o.condition).filter((c) => c.key !== OUTCOME_KEY),
  ]);

  const gate = atMs === undefined ? evidenceGate(store, principal) : gateAt(store, evidenceGate(store, principal), atMs);
  const candidates = visibleCandidates(store, await deps.retriever.search({
    text: problem.text, conditions, entityIds, requesterPrincipal: { id: principal.id, groups: principal.groups }, k: settings.k, ...(problem.at ? { at: problem.at } : {}),
  }), gate);
  const top = candidates[0]?.score ?? 0;
  const relevant = candidates.filter((c) => c.score >= settings.relativeScoreFloor * top && c.score > 0);

  const draft: InvestigationState = {
    id, orgId: problem.orgId, problem, createdAt: previous?.createdAt ?? nowIso, updatedAt: nowIso, candidates, hypotheses: [], gaps: [],
    recommendation: { kind: 'none', text: '', basis: [], applicability: 'unsupported', caveats: [], actionClass: 'none' },
    people: [], questionIds: previous?.questionIds ?? [], decisionIds: previous?.decisionIds ?? [], loop: 'no-question-needed', events: previous?.events ?? [], routes: [],
  };

  viewerOfState.set(draft, { id: principal.id, groups: principal.groups });
  const details: HypothesisDetail[] = [];
  for (const candidate of relevant) {
    const d = await buildHypothesis({ candidate, state: draft, deps, store, gate });
    if (d) details.push(d);
  }

  // Only related candidates may drive the recommendation (hypotheses of unrelated lookalikes stay listed but inert).
  const related = details.filter((d) => isRelatedCandidate(d.candidate, d.facts?.case, entityIds, settings));
  const requesterEntityId = directory.resolve(problem.requester.id);
  // B1 part B: a site-access question that states nothing about an incident (every stated condition is an identity-like
  // key) is answered from the access facts bound to the named site; the incident cases stay listed but inert.
  const ignored = new Set(settings.ignoredKeys);
  const access = conditions.every((c) => ignored.has(c.key))
    ? lookupAccessFacts({ store, problemText: problem.text, principal, entityIds, gate, atMs: atMs ?? now.getTime(), settings, directory, ...(requesterEntityId ? { requesterEntityId } : {}) }, accessIntent)
    : undefined;
  const recommended = recommend(related, settings, conditions);
  const recommendation = access?.recommendation ?? recommended.recommendation;
  const selected = access ? undefined : recommended.selected;
  const gaps = carryGaps(previous, selected ? buildGaps({ investigationId: id, detail: selected, settings }) : [], recorded);

  const people = access?.people ?? buildPeople({
    store, directory, principal, ...(requesterEntityId ? { requesterEntityId } : {}),
    investigationId: id, candidates: relevant, gate, ...(selected?.candidate.caseId ? { selectedCaseId: selected.candidate.caseId } : {}), entityIds, settings, now,
  });

  // B5: the other related hypotheses, each with its expert (described, never merged or overwritten).
  const alternatives = access ? [] : buildAlternatives(related, selected, directory, settings, conditions);
  const state: InvestigationState = {
    ...draft, hypotheses: details.map((d) => d.hypothesis), gaps, recommendation, people, ...(alternatives.length ? { alternatives } : {}),
    loop: 'no-question-needed', loopReason: settings.loopReasons.noQuestionNeeded,
  };

  const routes: Array<RouteInfo | undefined> = [parsed.route, deps.retriever.route, ...candidates.map((c) => c.retrieval), ...details.map((d) => d.assessment.route), ...(access ? [routeInfo('access-facts')] : [])];
  // A gap the requester can observe themselves is answered by checking, not by asking another person.
  const askable = (g: Gap): boolean => {
    const p = parseGapId(g.id);
    return g.consequential && g.status === 'open' && !(p?.kind === 'missing' && settings.requesterObservableKeys.includes(p.detail));
  };
  const wantsQuestion = gaps.some(askable);
  const reasons = settings.loopReasons;
  const settle = (loop: InvestigationState['loop'], loopReason: string): void => {
    state.loop = loop;
    state.loopReason = loopReason;
  };
  if (access && access.state !== 'found') {
    const who = access.recommendation.askWho ?? [];
    const free = who.find((w) => w.available);
    const away = who[0];
    settle('deferred', free ? `${free.displayName} handles access codes; ask them for the current code`
      : away ? `${away.displayName} handles access codes but is ${away.back ? `on leave (back ${away.back})` : 'unavailable'}` : reasons.noRecipient);
  } else if (!wantsQuestion) {
    settle('no-question-needed', reasons.noQuestionNeeded);
  } else if (deps.generator) {
    routes.push(deps.generator.route);
    const asked = await deps.generator.generate(state, settings.questions.maxCandidates);
    if (asked.some((c) => c.recipientIds.length > 0)) settle('deferred', reasons.preparing);
    else settle('deferred', reasons.noRecipient);
  } else {
    settle('deferred', reasons.preparing);
  }
  state.routes = uniqueRoutes(routes);

  // The case the recommendation is based on (the best related candidate), so views show the timeline of that case.
  const basisData = selected?.candidate.caseId ? { basisCaseId: selected.candidate.caseId } : {};
  const event: TraceEvent = {
    id: freshId('evt'), at: nowIso, traceId: id, type: previous ? 'investigation.rebuilt' : 'investigation.started',
    actor: { id: 'system', displayName: 'investigation' },
    data: previous
      ? { observations: recorded.length, recommendation: recommendation.kind, ...basisData }
      : { principal: { id: principal.id, displayName: principal.displayName, groups: principal.groups, type: principal.type }, recommendation: recommendation.kind, ...basisData },
  };
  state.events = [...state.events, event];
  store.put('investigation', state);
  return state;
}

/** The principal an investigation was started with (persisted in its first trace event). */
export function startedBy(state: InvestigationState): Principal | undefined {
  const p = state.events.find((e) => e.type === 'investigation.started')?.data?.principal as Principal | undefined;
  return p;
}


/**
 * The case the recommendation is based on (also the best related candidate when the recommendation is `none` or
 * `retain-uncertainty`); undefined when no related case exists. Read from the latest trace event that recorded it.
 */
export function basisCaseId(state: InvestigationState): string | undefined {
  for (let i = state.events.length - 1; i >= 0; i--) {
    const e = state.events[i] as TraceEvent;
    if (e.type !== 'investigation.started' && e.type !== 'investigation.rebuilt') continue;
    const id = e.data?.basisCaseId;
    return typeof id === 'string' ? id : undefined;
  }
  return undefined;
}
