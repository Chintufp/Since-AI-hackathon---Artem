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
    },
    async (a) => agentResult(await engine.investigate({ text: a.text, principal: asAgent(a.principal, defaultPrincipal), ...(a.observations ? { observations: a.observations } : {}), allowQuestions: a.allowQuestions ?? false })));

  reg('kt_get_context',
    `Current state of an investigation you started: recommendation, matches, people, open question, gaps (with what an answer would change) and routes. Ids are stable across calls and equal the ones the HTTP API returns. ${MEANING}`,
    { investigationId: z.string().min(1), principal: principalArg },
    (a) => agentResult(engine.getInvestigation(a.investigationId, asAgent(a.principal, defaultPrincipal).id)));

  reg('kt_request_clarification',
    'Run the clarification loop for an investigation you started: the engine picks at most one question for the person best placed to answer, subject to per-person daily limits, cooldown, open-question and per-investigation caps and access checks. Returns {status: "question-open", questionId} or {status: "deferred"|"exhausted"|"not-needed", reason}. A question is asked of a human, may stay unanswered, and an answer is one person\'s attributed report, not verification. Poll kt_clarification_status.',
    { investigationId: z.string().min(1), principal: principalArg },
    async (a) => {
      const r = await engine.requestClarification(asAgent(a.principal, defaultPrincipal), a.investigationId);
      return {
        status: r.status, reason: r.reason, investigationId: r.state.id,
        ...(r.question ? { questionId: r.question.id, questionStatus: r.question.status, text: r.question.candidate.text } : {}),
        loop: r.state.loop,
      };
    });

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
