/** MCP tool definitions over the engine. Names come from contracts/service.ts MCP_TOOLS; every tool calls the same engine function as its HTTP route. */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { Principal } from '../../libs/utils/contracts/index.ts';
import { MCP_TOOLS } from '../../libs/utils/contracts/index.ts';
import type { Engine } from './engine.ts';
import { toServiceError } from './errors.ts';
import { conditionSchema } from './schemas.ts';
import type { InvestigationResult } from './views.ts';

export const DEFAULT_AGENT: Principal = { id: 'agent:mcp-default', displayName: 'MCP agent', groups: [], type: 'agent' };

const principalArg = z.object({
  id: z.string().min(1).describe('Stable id of the calling agent'),
  displayName: z.string().min(1),
  groups: z.array(z.string()).default([]).describe('Access groups the agent acts for; restricted knowledge outside them is never returned'),
}).optional().describe('Calling agent. Defaults to a group-less agent, which sees only organization-wide knowledge. Investigations belong to the principal that started them.');

const asAgent = (p: { id: string; displayName: string; groups: string[] } | undefined, fallback: Principal): Principal =>
  p ? { id: p.id, displayName: p.displayName, groups: p.groups ?? [], type: 'agent' } : fallback;

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const failure = (e: unknown) => ({ isError: true as const, content: [{ type: 'text' as const, text: JSON.stringify({ error: toServiceError(e).message }) }] });

/** Compact, agent-facing result: the requester's view plus the stable ids, without the full internal state. */
export function agentResult(r: InvestigationResult) {
  const { state, ...view } = r;
  return {
    ...view,
    ids: { investigationId: state.id, decisionIds: state.decisionIds, questionIds: state.questionIds },
    gaps: state.gaps.map((g) => ({ id: g.id, description: g.description, consequential: g.consequential, status: g.status, whatAnswerChanges: g.whatAnswerChanges })),
    hypotheses: state.hypotheses.map((h) => ({ id: h.id, statement: h.statement, support: h.support, applicability: h.applicability })),
  };
}

const MEANING = [
  'How to read results: a recommendation is qualified evidence from past cases, not a verified fix; "exposure" of a past response in the knowledge base is not adoption or success.',
  'support (what history shows) and applicability (whether it fits this case) are separate; a hypothesis is never a verified cause.',
  'Several copies of one message count as one source. Unknown stays unknown.',
].join(' ');

export function createMcpServer(engine: Engine, defaultPrincipal: Principal = DEFAULT_AGENT): McpServer {
  const server = new McpServer({ name: 'knowledge-twin', version: '0.1.0' });
  const reg = <S extends z.ZodRawShape>(name: keyof typeof MCP_TOOLS, description: string, schema: S, run: (args: z.infer<z.ZodObject<S>>) => unknown | Promise<unknown>) => {
    server.registerTool(name, { description: `${description}\nMaps to: ${MCP_TOOLS[name]}.`, inputSchema: schema }, (async (args: z.infer<z.ZodObject<S>>) => {
      try {
        return text(await run(args));
      } catch (e) {
        return failure(e);
      }
    }) as never);
  };

  reg('kt_investigate',
    `Investigate a new problem against the organization's remembered knowledge. Returns a qualified recommendation (reuse | check-first | qualified | retain-uncertainty | none), matching past cases with what matches, conflicts or is missing, people with relevant experience, and stable ids (investigationId, decisionIds, questionIds). ${MEANING} By default no human is asked anything (allowQuestions=false); call kt_request_clarification to ask, or pass allowQuestions=true. Question limits and access rules apply to agents exactly as to people.`,
    {
      text: z.string().min(1).describe('Problem description in the requester\'s words'),
      principal: principalArg,
      observations: z.array(conditionSchema).optional().describe('Conditions you observed yourself (e.g. key interface.status eq down); they resolve gaps without asking a person'),
      allowQuestions: z.boolean().optional().describe('Also run the clarification loop now (default false for agents)'),
      at: z.string().min(1).optional().describe('Answer as of this moment (ISO 8601 with a zone): later evidence, answers and claims not valid then are left out; nobody is asked'),
    },
    async (a) => agentResult(await engine.investigate({ text: a.text, principal: asAgent(a.principal, defaultPrincipal), ...(a.observations ? { observations: a.observations } : {}), allowQuestions: a.allowQuestions ?? false, ...(a.at ? { at: a.at } : {}) })));

  reg('kt_get_context',
    `Current state of an investigation you started: recommendation, matches, people, open question, gaps (with what an answer would change) and routes. Ids are stable across calls and equal the ones the HTTP API returns. With at: what was known at that moment (the stored problem re-run as of then). ${MEANING}`,
    {
      investigationId: z.string().min(1), principal: principalArg,
      at: z.string().min(1).optional().describe('Re-run the stored problem as of this moment (ISO 8601 with a zone); returns that point-in-time view under its own investigation id'),
    },
    async (a) => {
      const who = asAgent(a.principal, defaultPrincipal).id;
      return agentResult(a.at ? await engine.contextAt(a.investigationId, a.at, who) : engine.getInvestigation(a.investigationId, who));
    });

  reg('kt_request_clarification',
    'Run the clarification loop for an investigation you started: the engine picks at most one question for the person best placed to answer, subject to per-person daily limits (3), one open question per person, cooldown, at most 3 questions per investigation, access checks and quiet hours (a question raised at night waits, queued, until 07:00). Optional: gapId (from kt_list_gaps) asks about that gap only; preferPersonEntityId (from kt_find_people or kt_list_gaps) asks that person only if they are an eligible recipient for it, otherwise {status: "refused", reason, wouldAsk} names who the engine would ask instead; gapIds (max 3) asks up to three gaps at once, each to its own person, every budget still applying; it cannot be combined with gapId or preferPersonEntityId. An unknown preferPersonEntityId is an error. You never contact a person directly: the question reaches them through their companion. Returns {status: "question-open", questionId} or {status: "deferred"|"exhausted"|"not-needed"|"refused", reason}; batch mode returns questions[] (poll each with kt_clarification_status). An answer is one person\'s attributed report, not verification.',
    {
      investigationId: z.string().min(1), principal: principalArg,
      gapId: z.string().min(1).optional().describe('Ask about this gap only (an id from kt_list_gaps)'),
      preferPersonEntityId: z.string().min(1).optional().describe('Ask this person (an entity id from kt_find_people or kt_list_gaps) only if every gate allows it'),
      gapIds: z.array(z.string().min(1)).min(1).max(3).optional().describe('Batch mode: up to 3 gap ids of this investigation, each asked of its own best person (not with gapId or preferPersonEntityId)'),
    },
    async (a) => {
      const r = await engine.requestClarification(asAgent(a.principal, defaultPrincipal), a.investigationId, {
        ...(a.gapId ? { gapId: a.gapId } : {}), ...(a.preferPersonEntityId ? { preferPersonEntityId: a.preferPersonEntityId } : {}), ...(a.gapIds ? { gapIds: a.gapIds } : {}),
      });
      return {
        status: r.status, reason: r.reason, investigationId: r.state.id,
        ...(r.question ? {
          questionId: r.question.id, questionStatus: r.question.status, text: r.question.candidate.text, gapId: r.question.candidate.gapId, personEntityId: r.question.personEntityId,
          ...(r.question.status === 'queued' && r.question.deliverAfter ? { deliverAfter: r.question.deliverAfter } : {}),
          ...(r.question.candidate.phrasing?.by === 'agent' ? { wordedBy: 'the agent' } : {}),
        } : {}),
        ...(r.refused ? { refused: r.refused } : {}), ...(r.wouldAsk ? { wouldAsk: r.wouldAsk } : {}), ...(r.questions ? { questions: r.questions } : {}),
        loop: r.state.loop, ...(r.state.loopReason ? { loopReason: r.state.loopReason } : {}),
      };
    });

  reg('kt_list_gaps',
    `Every open gap of an investigation you started: what an answer would change, whether it decides applicability (a missing distinguishing condition) or support (an outcome), whether you can check it yourself (then record it with kt_record_observation instead of asking), and who could answer (person entity id, name, role, firsthand or not, because, and whether every gate lets them be asked now, with the gates that stop them). Plus a confidence block for the past case the recommendation rests on: support and applicability as labels with reasons and evidence references, and which open gap would move each. Confidence is never a number: retrieval similarity is not confidence. ${MEANING}`,
    { investigationId: z.string().min(1), principal: principalArg },
    (a) => engine.listGaps(asAgent(a.principal, defaultPrincipal), a.investigationId));

  reg('kt_propose_question',
    'Propose your own wording for the question one gap asks (gapId from kt_list_gaps). Accepted only if it is one yes/no sentence under 160 characters that names the asset and the condition (or the action and the earlier case) and introduces no name, number, part, date or action absent from the gap and the case facts you may see. On acceptance it is used for that gap\'s next question (the person sees "worded by the agent"); otherwise {accepted: false, reasons, usedText} and the template wording is used. Recipients, consequences and every gate stay the engine\'s.',
    { investigationId: z.string().min(1), gapId: z.string().min(1), text: z.string().min(1).max(400), principal: principalArg },
    (a) => engine.proposeQuestion(asAgent(a.principal, defaultPrincipal), a.investigationId, a.gapId, a.text));

  reg('kt_store_health',
    'How full and how correct the remembered knowledge is, over the cases you may see: completeness (six slots per case: symptom, distinguishing conditions, attempt, outcome, lasting, validity; weighted by how often each case was retrieved in the last 30 days) and correctness (claims with independent support minus contradicted claims still cited minus links made without an answer, over case claims), each with its denominators; singletons (cases with at most 2 slots filled); thin pairs; and the open standing gaps (orphan pieces seeking their partner) on those cases, which the engine asks of the person who did the work, within the same budgets and quiet hours. Restricted cases outside your groups are not counted.',
    { principal: principalArg },
    (a) => engine.storeHealthView(asAgent(a.principal, defaultPrincipal)));

  reg('kt_clarification_status',
    'Status of one clarification question you caused: queued | delivered | answered | deferred | dismissed | cancelled | expired. When answered, includes the value (yes | no | unknown) and who answered. Unknown means no factual update was made; deferred or dismissed means the person did not answer, not that the answer is no.',
    { questionId: z.string().min(1), principal: principalArg },
    (a) => engine.clarificationStatus(asAgent(a.principal, defaultPrincipal), a.questionId));

  reg('kt_cancel_clarification',
    'Cancel a pending clarification question you started (for example because you found the answer yourself). Cancelled questions are not delivered or asked again.',
    { questionId: z.string().min(1), reason: z.string().optional(), principal: principalArg },
    (a) => engine.cancel(a.questionId, { principal: asAgent(a.principal, defaultPrincipal), ...(a.reason ? { reason: a.reason } : {}) }).question);

  reg('kt_record_observation',
    'Record something you observed for an investigation you started (a Condition such as software.version eq 4.2.1). It is stored as an attributed observation, rebuilds the recommendation and resolves matching gaps, which cancels pending questions that are no longer needed. Returns the updated investigation.',
    { investigationId: z.string().min(1), condition: conditionSchema, caseId: z.string().optional(), principal: principalArg },
    async (a) => agentResult((await engine.recordObservation({ principal: asAgent(a.principal, defaultPrincipal), investigationId: a.investigationId, condition: a.condition, ...(a.caseId ? { caseId: a.caseId } : {}) })).investigation));

  reg('kt_record_outcome',
    'Report what happened after an action on an investigation you started (result: recovered | no-change | worse | partial | unknown; lasting: unknown | confirmed | recurred). Stored as a separate attributed outcome report; it does not rewrite the past case it was based on and does not by itself verify any cause. Repeating the identical report is idempotent.',
    {
      investigationId: z.string().min(1), result: z.enum(['recovered', 'no-change', 'worse', 'partial', 'unknown']),
      attemptedAction: z.string().optional(), lasting: z.enum(['unknown', 'confirmed', 'recurred']).optional(), text: z.string().optional(),
      decisionId: z.string().optional(), caseId: z.string().optional(), observations: z.array(conditionSchema).optional(), principal: principalArg,
    },
    (a) => engine.recordOutcome({
      principal: asAgent(a.principal, defaultPrincipal), investigationId: a.investigationId, result: a.result,
      ...(a.attemptedAction ? { attemptedAction: a.attemptedAction } : {}), ...(a.lasting ? { lasting: a.lasting } : {}), ...(a.text ? { text: a.text } : {}),
      ...(a.decisionId ? { decisionId: a.decisionId } : {}), ...(a.caseId ? { caseId: a.caseId } : {}), ...(a.observations ? { observations: a.observations } : {}),
    }));

  reg('kt_find_people',
    'People with relevant experience for an investigation you started, each with reasons (what they did, firsthand or only mentioned), evidence references and whether they can currently be asked. Only cases the calling principal may see are used. Experience is not proof of the answer; use kt_request_clarification to ask rather than contacting people directly.',
    { investigationId: z.string().min(1), principal: principalArg },
    (a) => engine.people(a.investigationId, asAgent(a.principal, defaultPrincipal).id));

  reg('kt_participation',
    'Read-only points rating (optional, per person): the people who chose to take part, each with all-time balance, last-7-day points, answers and outcome reports, and a rank; plus totals. Points count contributions and never judge whether an answer was correct. People who do not take part appear nowhere; pass personEntityId to learn whether one person takes part and their balance. Nobody\'s event history is returned.',
    { personEntityId: z.string().min(1).optional().describe('A person entity id from kt_find_people, for their balance and rank') },
    (a) => engine.participationForAgents(a.personEntityId));

  return server;
}
