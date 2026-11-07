import type {
  Assessor, CandidateMatch, Condition, EvidenceRef, Gap, Hypothesis, InvestigationState, KnowledgeStore, Observation,
  Principal, Problem, QuestionGenerator, Retriever, RouteInfo, Selector, TraceEvent,
} from '../contracts/index.ts';
import { freshId, stableId } from '../contracts/index.ts';
import { uniqueRoutes } from '../models/routes.ts';
import { canSee } from '../retrieval/access.ts';
import { resolveEntityIds } from '../retrieval/exact.ts';
import { loadCaseFacts, OUTCOME_KEY } from './case-facts.ts';
import { storeDirectory, type PersonDirectory } from './directory.ts';
import { buildGaps, parseGapId } from './gaps.ts';
import { buildPeople } from './people.ts';
import { parseProblemText, type ParserOptions } from './problem-parser.ts';
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

const dedupeRefs = (refs: EvidenceRef[]): EvidenceRef[] => {
  const seen = new Set<string>();
  return refs.filter((r) => (seen.has(r.evidenceId) ? false : (seen.add(r.evidenceId), true)));
};

/** Problem text parse < supplied observations < recorded observations/answers (later wins per key). */
function mergeConditions(layers: Condition[][]): Condition[] {
  const byKey = new Map<string, Condition>();
  for (const layer of layers) for (const c of layer) byKey.set(c.key, c);
  return [...byKey.values()];
}

async function buildHypothesis(
  d: { candidate: CandidateMatch; state: InvestigationState; deps: InvestigateDeps; store: KnowledgeStore },
): Promise<HypothesisDetail | undefined> {
  const { candidate, state, deps, store } = d;
  const assessment = await deps.assessor.assess(candidate, state);
  if (candidate.caseId) {
    const facts = loadCaseFacts(store, candidate.caseId, state.id, deps.settings);
    if (!facts.case) return undefined;
    if (facts.hypothesisClaims.length === 0 && facts.attempts.length === 0 && facts.adviceClaims.length === 0) return undefined;
    const primary = facts.corrective ?? facts.diagnostic;
    const claimIds = [...facts.hypothesisClaims, ...facts.adviceClaims].map((c) => c.id);
    const statement = facts.hypothesisClaims[0]?.statement ?? facts.adviceClaims[0]?.statement ?? `${primary?.action ?? 'response'} in "${facts.case.title}"`;
    const basis = dedupeRefs([
      ...[...facts.hypothesisClaims, ...facts.adviceClaims].flatMap((c) => c.supporting),
      ...facts.attempts.flatMap((a) => a.evidence),
      ...facts.primaryOutcomes.flatMap((o) => o.evidence),
    ]);
    const hypothesis: Hypothesis = {
      id: stableId('hyp', state.id, candidate.caseId), statement, basis, sourceClaimIds: claimIds,
      support: assessment.support, applicability: assessment.applicability, assessment: assessment.route, notes: assessment.reasons,
    };
    return { hypothesis, candidate, assessment, title: facts.case.title, facts };
  }
  const proc = candidate.procedureId ? store.get('procedure', candidate.procedureId) : undefined;
  if (!proc) return undefined;
  const hypothesis: Hypothesis = {
    id: stableId('hyp', state.id, proc.id), statement: proc.purpose, basis: [], sourceClaimIds: [],
    support: assessment.support, applicability: assessment.applicability, assessment: assessment.route, notes: assessment.reasons,
  };
  return { hypothesis, candidate, assessment, title: proc.purpose };
}

/**
 * Attributed answers given in OTHER investigations about the same asset(s) and condition key are reused as evidence
 * (inventory-style facts such as unit revision), so the only person who knows is not asked the same thing again.
 * Only condition answers are reused (never outcome answers), only when the answer's evidence is visible to the principal.
 */
function priorAnswerConditions(store: KnowledgeStore, investigationId: string, entityIds: string[], principal: Principal): Condition[] {
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

  const parsed = parseProblemText(problem.text, problem.id, deps.parser);
  const recorded = store.list('observation', { where: { investigationId: id } }).sort((a, b) => a.at.localeCompare(b.at));
  const visibleEntities = store.list('entity').filter((e) => canSee(e.accessScope, principal));
  const { ids: entityIds } = resolveEntityIds(problem.text, visibleEntities, problem.entityIds ?? []);
  const prior = priorAnswerConditions(store, id, entityIds, principal);
  // A parser inference (origin 'inferred') never settles a distinguishing key: the key stays missing and is asked or checked.
  const dKeys = new Set(settings.distinguishingKeys);
  const parsedUsable = parsed.conditions.filter((c) => !(c.origin === 'inferred' && dKeys.has(c.key)));
  const conditions = mergeConditions([
    parsedUsable, prior, problem.observations ?? [], recorded.map((o) => o.condition).filter((c) => c.key !== OUTCOME_KEY),
  ]);

  const candidates = await deps.retriever.search({
    text: problem.text, conditions, entityIds, requesterPrincipal: { id: principal.id, groups: principal.groups }, k: settings.k,
  });
  const top = candidates[0]?.score ?? 0;
  const relevant = candidates.filter((c) => c.score >= settings.relativeScoreFloor * top && c.score > 0);

  const draft: InvestigationState = {
    id, orgId: problem.orgId, problem, createdAt: previous?.createdAt ?? nowIso, updatedAt: nowIso, candidates, hypotheses: [], gaps: [],
    recommendation: { kind: 'none', text: '', basis: [], applicability: 'unsupported', caveats: [], actionClass: 'none' },
    people: [], questionIds: previous?.questionIds ?? [], decisionIds: previous?.decisionIds ?? [], loop: 'no-question-needed', events: previous?.events ?? [], routes: [],
  };

  const details: HypothesisDetail[] = [];
  for (const candidate of relevant) {
    const d = await buildHypothesis({ candidate, state: draft, deps, store });
    if (d) details.push(d);
  }

  const { recommendation, selected } = recommend(details, settings);
  const gaps = carryGaps(previous, selected ? buildGaps({ investigationId: id, detail: selected, settings }) : [], recorded);

  const requesterEntityId = directory.resolve(problem.requester.id);
  const people = buildPeople({
    store, directory, principal, ...(requesterEntityId ? { requesterEntityId } : {}),
    caseIds: relevant.flatMap((c) => (c.caseId ? [c.caseId] : [])), entityIds, settings, now,
  });

  const state: InvestigationState = {
    ...draft, hypotheses: details.map((d) => d.hypothesis), gaps, recommendation, people,
    loop: 'no-question-needed',
  };

  const routes: Array<RouteInfo | undefined> = [parsed.route, deps.retriever.route, ...candidates.map((c) => c.retrieval), ...details.map((d) => d.assessment.route)];
  const wantsQuestion = gaps.some((g) => g.consequential && g.status === 'open');
  if (deps.generator && wantsQuestion) {
    routes.push(deps.generator.route);
    const asked = await deps.generator.generate(state, settings.questions.maxCandidates);
    state.loop = asked.length > 0 ? 'deferred' : 'no-question-needed';
  } else if (deps.generator) {
    state.loop = 'no-question-needed';
  } else {
    state.loop = wantsQuestion ? 'deferred' : 'no-question-needed';
  }
  state.routes = uniqueRoutes(routes);

  const event: TraceEvent = {
    id: freshId('evt'), at: nowIso, traceId: id, type: previous ? 'investigation.rebuilt' : 'investigation.started',
    actor: { id: 'system', displayName: 'investigation' },
    data: previous
      ? { observations: recorded.length, recommendation: recommendation.kind }
      : { principal: { id: principal.id, displayName: principal.displayName, groups: principal.groups, type: principal.type }, recommendation: recommendation.kind },
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

