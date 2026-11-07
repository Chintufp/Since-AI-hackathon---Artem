/**
 * Reference "systems" used only to sanity-check the evaluator and the data:
 *  - perfectSystem: reconstructed FROM hidden truth, so it must score 1.0 wherever a score is defined.
 *    It is a reference oracle, never a measured model result.
 *  - silentSystem: outputs nothing and never asks; exposes constant-silence behaviour.
 */
import type {
  Attempt,
  Case,
  Claim,
  ClaimType,
  Entity,
  IncomingProblems,
  Outcome,
  PeopleDirectory,
  PersonWorkLink,
  ScenarioTruth,
} from '../src/libs/utils/contracts/index.ts';
import { expectedStatus, truthIndependentCount } from './evaluator.ts';
import type { QuestionRun, RecommendationOutput, SystemKnowledge } from './evaluator.ts';
import { gapConditionKeys } from './oracle.ts';

const NOW = '2026-01-01T00:00:00.000Z';
const scope = { visibility: 'org' as const };
const ORG = 'org:reference';

export function perfectSystem(truth: ScenarioTruth, people: PeopleDirectory): SystemKnowledge {
  const evidenceSourceIds: Record<string, string> = {};
  const evId = (sourceId: string) => {
    const id = `ev:${sourceId}`;
    evidenceSourceIds[id] = sourceId;
    return id;
  };
  const copySet = new Set(truth.copies.map((c) => c.sourceId));
  const independentSupport: Record<string, number> = {};
  const claims: Claim[] = [];
  const cases: Case[] = [];
  const attempts: Attempt[] = [];
  const outcomes: Outcome[] = [];
  const links: PersonWorkLink[] = [];
  const actorOf = (personId: string | undefined) => {
    const p = people.people.find((x) => x.id === personId);
    return p ? { id: p.actorIds[0] ?? p.id, displayName: p.name } : undefined;
  };

  const entities: Entity[] = truth.entities.map((e, i) => ({
    id: `ent:${i}`,
    orgId: ORG,
    type: e.type as Entity['type'],
    name: e.name,
    aliases: [],
    attributes: {},
    evidence: [],
    accessScope: scope,
  }));
  for (const p of people.people) {
    entities.push({ id: `ent:${p.id}`, orgId: ORG, type: 'person', name: p.name, aliases: [], attributes: {}, evidence: [], actorIds: p.actorIds, accessScope: scope });
  }

  for (const inc of truth.incidents) {
    const independent = inc.sourceIds.filter((s) => !copySet.has(s));
    const primary = independent[0] ?? inc.sourceIds[0]!;
    const caseId = `case:${inc.key}`;
    const st = expectedStatus(inc.outcome);
    cases.push({
      id: caseId, orgId: ORG, title: inc.title, status: st,
      entityIds: [], observationClaimIds: [], hypothesisClaimIds: [], attemptIds: [], outcomeIds: [], gaps: [],
      evidenceIds: inc.sourceIds.map(evId), startedAt: { known: false }, conditions: [], accessScope: scope, createdAt: NOW, updatedAt: NOW,
    });
    // A careful system cites the original and its retellings but counts them as ONE independent source.
    const supportSources = inc.sourceIds;
    const roots = truthIndependentCount(supportSources, truth);
    inc.expectedClaims.forEach((c, i) => {
      independentSupport[`claim:${inc.key}:${i}`] = roots;
      claims.push({
        id: `claim:${inc.key}:${i}`, orgId: ORG, type: c.type as ClaimType, statement: c.statement, subjectEntityIds: [], caseId,
        assertedBy: actorOf(c.by), origin: 'reported', supporting: supportSources.map((s) => ({ evidenceId: evId(s) })), contradicting: [], validity: {},
        status: 'supported', extraction: { route: 'rules', version: 'reference-oracle' }, revision: 1, createdAt: NOW, updatedAt: NOW, accessScope: scope,
      });
    });
    inc.attempts.forEach((a, i) => {
      attempts.push({
        id: `attempt:${inc.key}:${i}`, orgId: ORG, caseId, action: a.action, performedBy: actorOf(a.by),
        performed: a.performed ? 'reported' : 'proposed-only', when: { known: false }, evidence: [{ evidenceId: evId(primary) }],
      });
    });
    outcomes.push({
      id: `outcome:${inc.key}`, orgId: ORG, caseId, reportedBy: actorOf(inc.outcome.reportedBy),
      result: inc.outcome.result as Outcome['result'], reportedAt: { known: false }, lasting: inc.outcome.lasting,
      evidence: [{ evidenceId: evId(primary) }], basis: inc.outcome.lasting === 'confirmed' ? 'observed' : 'reported',
    });
    for (const [personId, k] of Object.entries(inc.knowledge)) {
      links.push({
        id: `link:${inc.key}:${personId}`, orgId: ORG, personEntityId: `ent:${personId}`, caseId,
        contribution: 'observed-condition', firsthand: k.knows.length > 0, evidence: [{ evidenceId: evId(primary) }],
        recency: { known: false }, status: 'provisional',
      });
    }
  }
  return { claims, entities, links, cases, attempts, outcomes, evidenceSourceIds, independentSupport };
}

export function silentSystem(): SystemKnowledge {
  return { claims: [], entities: [], links: [], cases: [], attempts: [], outcomes: [], evidenceSourceIds: {} };
}

type Problem = IncomingProblems['problems'][number];

export function perfectRecommendations(problems: Problem[]): RecommendationOutput[] {
  return problems.map((p) => ({ problemId: p.id, kind: p.key.expectedRecommendation }));
}

/**
 * Asks the first AVAILABLE answerer about the first gap key when a reachable consequential gap exists; asks no one
 * when the gap is unanswerable or every answerer is unavailable (hard eligibility rule), and when no gap exists.
 */
export function perfectQuestionRuns(problems: Problem[], people?: PeopleDirectory): QuestionRun[] {
  const available = (id: string) => people?.people.find((p) => p.id === id)?.available !== false;
  return problems.map((p) => {
    const gap = p.key.consequentialGap;
    const who = gap && !gap.unanswerable ? gap.answerers.find(available) : undefined;
    const ck = gapConditionKeys(p.key, p.observations)[0];
    if (!gap || !who || !ck) return { problemId: p.id, questions: [] };
    return { problemId: p.id, questions: [{ conditionKey: ck, recipientId: who, answered: true }] };
  });
}

export function silentRecommendations(problems: Problem[]): RecommendationOutput[] {
  return problems.map((p) => ({ problemId: p.id, kind: 'none' as const }));
}
