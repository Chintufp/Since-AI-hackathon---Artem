/**
 * Experiment harness: runs the REAL system (SQLite store, import pipeline, investigation, question coordinator, a
 * selector) over the visible inputs of a scenario family and collects what the benchmark evaluator expects.
 *
 *  - The system under test sees: sources/ (through the scenario-dir importer, which ignores truth.json/incoming.json),
 *    people.json (visible directory, applied exactly like src/apps/service/directory.ts applyDirectory) and, per
 *    problem, id/text/requester/observations. It never receives an answer key.
 *  - Hidden keys are read here, in the harness, ONLY for the person-answer oracle (benchmarks/oracle.ts) and for
 *    scoring/benefit labels. The oracle answers one reply at a time; 'no-answer' leaves the question unanswered.
 *  - Time is simulated: every problem is on its own day (budgets are per day), each answer round advances the clock
 *    by `answerDelayMinutes` (default 5), so a cooldown longer than that really blocks a second question to the
 *    same person inside one investigation.
 */
import { join } from 'node:path';
import type {
  Assessor, Condition, CoordinatorSettings, EvaluationRecord, InvestigationState, KnowledgeStore, PeopleDirectory, Principal, Problem,
  QuestionCandidate, QuestionGenerator, QuestionRecord, RecommendationKind, Retriever, Selector,
} from '../src/libs/utils/contracts/index.ts';
import { defaultCoordinatorSettings } from '../src/libs/utils/contracts/index.ts';
import { applyDirectory } from '../src/apps/service/directory.ts';
import {
  defaultInvestigationSettings, investigate, OUTCOME_KEY, parseGapId, RulesAssessor, storeDirectory, type InvestigationSettings,
} from '../src/libs/utils/investigation/index.ts';
import { importFromPath, openStore } from '../src/libs/utils/memory/index.ts';
import { QuestionCoordinator, TemplateQuestionGenerator } from '../src/libs/utils/questions/index.ts';
import { RulesSelector } from '../src/libs/utils/policies/index.ts';
import { Bm25Retriever, canSee, ExactIdRetriever, HybridRetriever, TrigramVectorRetriever } from '../src/libs/utils/retrieval/index.ts';
import { loadHidden, loadVisibleInputs, familyEntry } from '../benchmarks/load.ts';
import { DEFAULT_SCENARIOS_DIR } from '../benchmarks/splits.ts';
import { answerFor } from '../benchmarks/oracle.ts';
import type { OracleReply, ProblemKey } from '../benchmarks/oracle.ts';
import type { QuestionRun, RecommendationOutput, SystemKnowledge } from '../benchmarks/evaluator.ts';
import { normalizeSourceId } from '../benchmarks/text.ts';

export const ORG = 'org:experiment';

export type RetrieverName = 'hybrid' | 'lexical' | 'exact' | 'trigram';

export interface HarnessOptions {
  retriever?: RetrieverName;
  assessorMode?: 'separate' | 'combined';
  /** One selector instance for the whole run (shared across families so a learning selector accumulates). */
  selector?: Selector;
  /** Organization configuration overrides (distinguishing keys, observability, templates ...). */
  settings?: Partial<InvestigationSettings>;
  coordinator?: Partial<CoordinatorSettings>;
  /** E06 direct arm: recipients are restricted to people with a firsthand link to the question's own case. */
  directOnly?: boolean;
  /** Upper bound on questions asked per investigation by the harness loop (in addition to the coordinator cap). */
  maxRounds?: number;
  answerDelayMinutes?: number;
  /** When set, problems of a family arrive this many minutes apart on the same day (so budgets/cooldowns bind across
   *  investigations). Default: each problem on its own day (investigations are independent). */
  problemSpacingMinutes?: number;
  /** Learn online: after each answered/unanswered question call selector.update with the harness-labelled record. */
  learn?: boolean;
  /** Restrict to some problem ids. */
  onlyProblems?: string[];
}

export interface QuestionLog {
  questionId: string;
  gapKind: string;
  conditionKey: string;
  recipientId: string;
  reply: OracleReply;
  answered: boolean;
  text: string;
  recommendationBefore: RecommendationKind;
  recommendationAfter: RecommendationKind;
  benefit: number | null;
  decisionReason: string;
}

export interface ProblemRun {
  problemId: string;
  familyId: string;
  requesterId: string;
  firstRecommendation: RecommendationKind;
  finalRecommendation: RecommendationKind;
  finalApplicability: string;
  citedCaseIds: string[];
  /** Ranked case ids of the FIRST investigation (before any answer), for retrieval metrics. */
  rankedCaseIds: string[];
  questions: QuestionLog[];
  loopEnd: string;
  /** Sources the requester is shown: recommendation/hypothesis basis and the evidence behind each suggested person. */
  shownSourceIds: string[];
  /** Subset of shownSourceIds whose OWN stored access scope the requester fails (detectable by the system itself). */
  shownRestrictedSourceIds: string[];
  latencyMs: number;
  /** Selector choices blocked because they named an ineligible pair (coordinator converts to defer). */
  blockedSelections: number;
  /** Eligibility violations seen across rounds (for burden/eligibility reports). */
  violationCounts: Record<string, number>;
  /** Persisted question records of this investigation by status (cancelled ones as `cancelled:<reason>`). */
  questionStatus: Record<string, number>;
  /** Trace completeness: started event present and every asked question has its recorded decision. */
  traceComplete: boolean;
}

export interface FamilyRun {
  familyId: string;
  knowledge: SystemKnowledge;
  problems: ProblemRun[];
  recommendations: RecommendationOutput[];
  questionRuns: QuestionRun[];
  evalRecords: EvaluationRecord[];
  /** case id -> truth incident keys (via evidence source ids). */
  caseIncidents: Record<string, string[]>;
  /** evidence id -> provider:sourceId */
  evidenceSourceIds: Record<string, string>;
  importCounts: { cases: number; claims: number; entities: number };
}

const day = (i: number): Date => new Date(Date.UTC(2026, 0, 5 + i, 9, 0, 0));

export function buildRetriever(name: RetrieverName, store: KnowledgeStore, settings: InvestigationSettings): Retriever {
  switch (name) {
    case 'hybrid': return new HybridRetriever(store, settings);
    case 'lexical': return new Bm25Retriever(store, settings);
    case 'exact': return new ExactIdRetriever(store, settings);
    case 'trigram': return new TrigramVectorRetriever(store, settings);
  }
}

/** Wraps a generator and restricts each candidate's recipients to people with a firsthand link on the question's case. */
class DirectOnlyGenerator implements QuestionGenerator {
  readonly route;
  private inner: QuestionGenerator;
  private store: KnowledgeStore;
  constructor(inner: QuestionGenerator, store: KnowledgeStore) {
    this.inner = inner;
    this.store = store;
    this.route = inner.route;
  }
  async generate(state: InvestigationState, maxCandidates: number): Promise<QuestionCandidate[]> {
    const cands = await this.inner.generate(state, maxCandidates);
    const links = this.store.list('personLink').filter((l) => l.firsthand && l.status !== 'rejected');
    return cands.map((c) => {
      const caseId = parseGapId(c.gapId)?.caseId;
      const direct = new Set(links.filter((l) => l.caseId === caseId).map((l) => l.personEntityId));
      return { ...c, recipientIds: c.recipientIds.filter((r) => direct.has(r)) };
    });
  }
}

/** Question text -> oracle questions. A free-text question is translated into condition keys by the harness. */
const OUTCOME_ORACLE_KEYS: Array<[string, string]> = [['traffic.state', 'flowing'], ['bgp.session', 'up'], ['alarms.state', 'cleared'], ['temperature.state', 'normal'], ['interface.status', 'up']];

function entityNames(store: KnowledgeStore, ids: string[]): string[] {
  return ids.map((id) => store.get('entity', id)?.name).filter((n): n is string => !!n);
}

function askOracle(store: KnowledgeStore, key: ProblemKey, personDirId: string, q: QuestionRecord, people: PeopleDirectory): { reply: OracleReply; conditionKey: string; gapKind: string } {
  const parsed = parseGapId(q.candidate.gapId);
  const scopes: Array<string | undefined> = [...entityNames(store, q.candidate.scope.entityIds), undefined];
  if (parsed?.kind === 'missing') {
    const cond = store.get('case', parsed.caseId)?.conditions.find((c) => c.key === parsed.detail);
    const expected = cond?.value;
    let last: OracleReply = 'unknown';
    for (const s of scopes) {
      const r = answerFor(key, personDirId, { conditionKey: parsed.detail, ...(expected !== undefined ? { expected } : {}), ...(s ? { scopeEntity: s } : {}) }, { people });
      if (r === 'no-answer') return { reply: r, conditionKey: parsed.detail, gapKind: 'missing' };
      if (r === 'yes' || r === 'no') return { reply: r, conditionKey: parsed.detail, gapKind: 'missing' };
      last = r;
    }
    return { reply: last, conditionKey: parsed.detail, gapKind: 'missing' };
  }
  // outcome question: the person is asked whether recovery followed; translate to recovery-state condition keys.
  for (const [k, v] of OUTCOME_ORACLE_KEYS) {
    for (const s of scopes) {
      const r = answerFor(key, personDirId, { conditionKey: k, expected: v, ...(s ? { scopeEntity: s } : {}) }, { people });
      if (r === 'no-answer') return { reply: r, conditionKey: OUTCOME_KEY, gapKind: parsed?.kind ?? 'unknown' };
      if (r === 'yes' || r === 'no') return { reply: r, conditionKey: k, gapKind: parsed?.kind ?? 'unknown' };
    }
  }
  return { reply: 'unknown', conditionKey: OUTCOME_KEY, gapKind: parsed?.kind ?? 'unknown' };
}

const toObservation = (o: { key: string; value: string | number | boolean; label: string }): Condition => ({ key: o.key, operator: 'eq', value: o.value, origin: 'reported', evidence: [], label: o.label });

export interface PreparedFamily {
  store: KnowledgeStore;
  people: PeopleDirectory;
  importCounts: { cases: number; claims: number; entities: number };
}

/** Fresh :memory: store with the family's visible sources imported and its directory applied. */
export function prepareFamily(familyId: string, root = DEFAULT_SCENARIOS_DIR): PreparedFamily {
  const entry = familyEntry(familyId, root);
  const visible = loadVisibleInputs(familyId, root);
  const store = openStore(':memory:');
  const res = importFromPath(store, { format: 'scenario-dir', path: join(root, entry.dir), orgId: ORG, now: '2026-01-01T00:00:00.000Z' });
  applyDirectory(store, ORG, visible.people);
  return { store, people: visible.people, importCounts: { cases: res.cases, claims: res.claims, entities: res.entities } };
}

/**
 * Adapter source ids -> the benchmark's "<provider>:<sourceId>" form: Teams `<conversation>#<seq>` -> seq,
 * email `msgid:<Message-ID>` -> Message-ID, Slack `<channel>:<ts>` -> ts. Anything else is kept as is.
 */
export function benchmarkSourceId(provider: string, sourceId: string): string {
  if (provider === 'teams') return `teams:${sourceId.includes('#') ? sourceId.slice(sourceId.lastIndexOf('#') + 1) : sourceId}`;
  if (provider === 'email') return `email:${sourceId.replace(/^msgid:/, '')}`;
  if (provider === 'slack') return `slack:${sourceId.includes(':') ? sourceId.slice(sourceId.lastIndexOf(':') + 1) : sourceId}`;
  return `${provider}:${sourceId}`;
}

export function evidenceSourceIdsOf(store: KnowledgeStore): Record<string, string> {
  const out: Record<string, string> = {};
  for (const e of store.list('evidence')) out[e.id] = benchmarkSourceId(e.provider, e.sourceId);
  return out;
}

export function collectKnowledge(store: KnowledgeStore, evidenceSourceIds: Record<string, string>): SystemKnowledge {
  const claims = store.list('claim');
  const independentSupport: Record<string, number> = {};
  for (const c of claims) independentSupport[c.id] = independentSupportOf(store, c.supporting.map((s) => s.evidenceId));
  return {
    claims, entities: store.list('entity'), links: store.list('personLink'), cases: store.list('case'),
    attempts: store.list('attempt'), outcomes: store.list('outcome'), evidenceSourceIds, independentSupport,
  };
}

/** Independent supporting sources the system itself counts: supporters that are not copies/retellings of another supporter. */
function independentSupportOf(store: KnowledgeStore, evidenceIds: string[]): number {
  const ids = [...new Set(evidenceIds)];
  const ev = ids.map((i) => store.get('evidence', i)).filter((e): e is NonNullable<typeof e> => !!e);
  const dependent = (e: (typeof ev)[number]) => ev.some((o) => o.id !== e.id && (e.lineage.copiedFrom?.includes(o.id) || (e.metadata?.retellingOf as { evidenceIds?: string[] } | undefined)?.evidenceIds?.includes(o.id)));
  return ev.filter((e) => !dependent(e)).length;
}

export function incidentOfSources(truthIncidents: Array<{ key: string; sourceIds: string[] }>): Map<string, string> {
  const m = new Map<string, string>();
  for (const inc of truthIncidents) for (const s of inc.sourceIds) m.set(normalizeSourceId(s), inc.key);
  return m;
}

/** Run every incoming problem of one family through the real system. */
export async function runFamily(familyId: string, opts: HarnessOptions = {}): Promise<FamilyRun> {
  const prepared = prepareFamily(familyId);
  const { store, people } = prepared;
  const visible = loadVisibleInputs(familyId);
  const hidden = loadHidden(familyId); // answer keys: used ONLY by the oracle and scoring below
  const evidenceSourceIds = evidenceSourceIdsOf(store);
  const incidentOf = incidentOfSources(hidden.truth.incidents);
  const dirEntity = storeDirectory(store);

  const clockState = { now: day(0) };
  const clock = (): Date => new Date(clockState.now);
  const coordinatorCfg: CoordinatorSettings = { ...defaultCoordinatorSettings, ...(opts.coordinator ?? {}) };
  const settings = defaultInvestigationSettings({ ...(opts.settings ?? {}), coordinator: { ...coordinatorCfg, ...(opts.settings?.coordinator ?? {}) } });
  const selector = opts.selector ?? new RulesSelector({ clock });
  const retriever = buildRetriever(opts.retriever ?? 'hybrid', store, settings);
  const assessor: Assessor = new RulesAssessor({ store, settings, mode: opts.assessorMode ?? 'separate' });
  const directory = dirEntity;
  let generator: QuestionGenerator = new TemplateQuestionGenerator({ store, settings, directory, clock });
  if (opts.directOnly) generator = new DirectOnlyGenerator(generator, store);
  const coordinator = new QuestionCoordinator({ store, settings, selector, generator, retriever, assessor, directory, clock });

  const directoryIdOf = (entityId: string): string => {
    const e = store.get('entity', entityId);
    return e?.actorIds?.find((a) => a.startsWith('person:directory:')) ?? entityId;
  };
  const principalOfEntity = (entityId: string): Principal => {
    const p = directory.get(entityId);
    return { id: entityId, displayName: p?.name ?? entityId, groups: p?.groups ?? [], type: 'human' };
  };

  const problemRuns: ProblemRun[] = [];
  const recommendations: RecommendationOutput[] = [];
  const questionRuns: QuestionRun[] = [];
  const evalRecords: EvaluationRecord[] = [];
  const problems = visible.problems.filter((p) => !opts.onlyProblems || opts.onlyProblems.includes(p.id));

  for (let pi = 0; pi < visible.problems.length; pi++) {
    const vp = visible.problems[pi] as (typeof visible.problems)[number];
    if (!problems.includes(vp)) continue;
    const key = hidden.incoming.problems.find((p) => p.id === vp.id)?.key as ProblemKey;
    clockState.now = opts.problemSpacingMinutes === undefined ? day(pi) : new Date(day(0).getTime() + pi * opts.problemSpacingMinutes * 60_000);
    const requesterDir = people.people.find((x) => x.id === vp.requester);
    const requesterEntityId = directory.resolve(vp.requester) ?? vp.requester;
    const principal: Principal = { id: requesterEntityId, displayName: requesterDir?.name ?? vp.requester, groups: requesterDir?.groups ?? [], type: 'human' };
    const problem: Problem = {
      id: vp.id, orgId: ORG, text: vp.text, requester: { id: principal.id, displayName: principal.displayName },
      ...(vp.observations ? { observations: vp.observations.map(toObservation) } : {}), createdAt: clock().toISOString(),
    };

    const t0 = performance.now();
    let latency = 0;
    let state = await investigate({ problem, store, principal, deps: { retriever, assessor, generator, selector, settings, clock, directory } });
    latency += performance.now() - t0;
    const first = state;
    const rankedCaseIds = first.candidates.flatMap((c) => (c.caseId ? [c.caseId] : []));
    const firstRecommendation = first.recommendation.kind;
    const logs: QuestionLog[] = [];
    const violationCounts: Record<string, number> = {};
    let blocked = 0;
    let loopEnd = 'no-question';
    const maxRounds = opts.maxRounds ?? coordinatorCfg.maxQuestionsPerInvestigation;
    for (let round = 0; round < maxRounds; round++) {
      const t1 = performance.now();
      const r = await coordinator.request(state);
      latency += performance.now() - t1;
      state = r.state;
      for (const e of r.eligibility) for (const v of e.violations) violationCounts[v] = (violationCounts[v] ?? 0) + 1;
      if (r.decision?.reason.startsWith('blocked: selector returned')) blocked++;
      if (!r.question) { loopEnd = state.loop; break; }
      const q = r.question;
      if (q.status !== 'delivered') { loopEnd = `question-${q.status}`; break; }
      const evRec = store.get('evaluation', q.decisionId) as (EvaluationRecord & { id: string }) | undefined;
      const recipientDirId = directoryIdOf(q.personEntityId);
      const asked = askOracle(store, key, recipientDirId, q, people);
      const before = state.recommendation.kind;
      let after: RecommendationKind = before;
      let answered = false;
      if (asked.reply === 'no-answer') {
        // The person cannot respond: leave the question unanswered (the coordinator shelves it so another person may be tried).
        coordinator.defer(q.id, principalOfEntity(q.personEntityId));
      } else {
        const t2 = performance.now();
        const a = await coordinator.answer(q.id, asked.reply, principalOfEntity(q.personEntityId));
        latency += performance.now() - t2;
        state = a.state;
        after = state.recommendation.kind;
        answered = true;
      }
      // Benefit labelled by the HARNESS from the key: 1 if the answer moved the recommendation to the key's expected class,
      // 0 if the answer changed nothing toward it, null if unanswered (unknown, never zero).
      const benefit = !answered ? null : after !== before && after === key.expectedRecommendation ? 1 : 0;
      logs.push({
        questionId: q.id, gapKind: asked.gapKind, conditionKey: asked.conditionKey, recipientId: recipientDirId, reply: asked.reply, answered, text: q.candidate.text,
        recommendationBefore: before, recommendationAfter: after, benefit, decisionReason: r.decision?.reason ?? '',
      });
      if (evRec) {
        const rec: EvaluationRecord = {
          decisionId: evRec.decisionId, investigationId: evRec.investigationId, at: evRec.at, stateFeatures: evRec.stateFeatures, eligible: evRec.eligible, action: evRec.action,
          propensity: evRec.propensity, ...(answered ? { response: { value: asked.reply as 'yes' | 'no' | 'unknown' } } : {}),
          assessedBenefit: benefit === null ? null : { value: benefit, method: 'harness-key-applicability-change' },
          effort: evRec.effort, missingFeedback: !answered,
        };
        evalRecords.push(rec);
        if (opts.learn) selector.update?.([rec]);
      }
      clockState.now = new Date(clockState.now.getTime() + (opts.answerDelayMinutes ?? 5) * 60_000);
      if (round === maxRounds - 1) loopEnd = 'round-cap';
    }

    // final recommendation and the cases it cites
    const basisEvidence = new Set<string>([...state.recommendation.basis.map((b) => b.evidenceId), ...state.hypotheses.flatMap((h) => h.basis.map((b) => b.evidenceId))]);
    const cases = store.list('case');
    const cited = state.recommendation.kind === 'none' ? [] : cases.filter((c) => c.evidenceIds.some((e) => basisEvidence.has(e))).map((c) => c.id);
    // What the requester is actually shown. Raw case.evidenceIds of candidate cases are NOT counted: the case view filters
    // them per item for the principal (memory/case-view.ts).
    const shown = new Set<string>();
    const restricted = new Set<string>();
    const addEv = (ids: Iterable<string>) => {
      for (const e of ids) {
        const s = evidenceSourceIds[e];
        if (!s) continue;
        shown.add(s);
        const env = store.get('evidence', e);
        if (env && !canSee(env.accessScope, { id: principal.id, groups: principal.groups })) restricted.add(s);
      }
    };
    addEv(basisEvidence);
    addEv(state.people.flatMap((p) => p.reasons.flatMap((x) => x.evidence.map((e) => e.evidenceId))));

    const questionStatus: Record<string, number> = {};
    for (const q of store.list('question')) {
      if (q.candidate.investigationId !== state.id) continue;
      const k = q.status === 'cancelled' ? `cancelled:${q.cancelReason ?? 'unknown'}` : q.status;
      questionStatus[k] = (questionStatus[k] ?? 0) + 1;
    }
    const traceComplete = state.events.some((e) => e.type === 'investigation.started') && logs.every((l) => {
      const qr = store.get('question', l.questionId);
      return !!qr && !!store.get('decision', qr.decisionId) && state.decisionIds.includes(qr.decisionId);
    });
    problemRuns.push({
      problemId: vp.id, familyId, requesterId: vp.requester, firstRecommendation, finalRecommendation: state.recommendation.kind,
      finalApplicability: state.recommendation.applicability, citedCaseIds: cited, rankedCaseIds, questions: logs, loopEnd, shownSourceIds: [...shown], shownRestrictedSourceIds: [...restricted],
      latencyMs: latency, blockedSelections: blocked, violationCounts, questionStatus, traceComplete,
    });
    recommendations.push({ problemId: vp.id, kind: state.recommendation.kind });
    questionRuns.push({ problemId: vp.id, questions: logs.map((l) => ({ conditionKey: l.conditionKey, recipientId: l.recipientId, answered: l.answered })) });
  }

  const knowledge = collectKnowledge(store, evidenceSourceIds);
  const caseIncidents: Record<string, string[]> = {};
  for (const c of knowledge.cases) {
    const incs = new Set<string>();
    for (const e of c.evidenceIds) {
      const inc = incidentOf.get(normalizeSourceId(evidenceSourceIds[e] ?? ''));
      if (inc) incs.add(inc);
    }
    caseIncidents[c.id] = [...incs];
  }
  store.close();
  return { familyId, knowledge, problems: problemRuns, recommendations, questionRuns, evalRecords, caseIncidents, evidenceSourceIds, importCounts: prepared.importCounts };
}
