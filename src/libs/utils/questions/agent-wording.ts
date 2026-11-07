/**
 * B7: an agent may propose the wording of the question a gap asks (kt_propose_question). The wording is checked with
 * the phrase slot's validator (BUILD_BRIEF 2.4) against the gap, the case facts the requester may see and the asset,
 * remembered as a trace event on the investigation ('question.proposed'; RecordTypes stays closed), and used for that
 * gap's next question, checked again at that moment against the then-current facts. Only `text` changes; the gap, the
 * recipients, the consequences, the dedup key and every gate stay the template's.
 */
import type { InvestigationState, KnowledgeStore, QuestionCandidate, QuestionGenerator, RouteInfo, TraceEvent } from '../contracts/index.ts';
import { startedBy } from '../investigation/index.ts';
import { routeInfo } from '../models/routes.ts';
import { evidenceGate } from '../retrieval/access.ts';
import type { QuestionContext } from './context.ts';
import { phraseCheckFor, validatePhrase, visibleCaseFacts, type PhraseVerdict } from './generator-phrased.ts';
import type { PhraseFacts, TemplateQuestionGenerator } from './generator-templates.ts';

export const AGENT_WORDING_EVENT = 'question.proposed';
export const AGENT_WORDED_ROUTE: RouteInfo = routeInfo('agent-worded');

export interface ProposedWording {
  gapId: string;
  text: string;
  accepted: boolean;
  reason?: string;
  by: string;
  at: string;
}

/** The latest accepted wording per gap of an investigation (a later rejected proposal does not erase an accepted one). */
export function acceptedWordings(store: KnowledgeStore, investigationId: string): Map<string, ProposedWording> {
  const out = new Map<string, ProposedWording>();
  const events = store.list('trace', { where: { traceId: investigationId } })
    .filter((e: TraceEvent) => e.type === AGENT_WORDING_EVENT)
    .sort((a, b) => a.at.localeCompare(b.at));
  for (const e of events) {
    const d = e.data as unknown as ProposedWording;
    if (d?.accepted && typeof d.gapId === 'string' && typeof d.text === 'string') out.set(d.gapId, d);
  }
  return out;
}

/** The template candidate and its facts for one gap (undefined when no question is asked for that gap). */
export async function templateFor(templates: TemplateQuestionGenerator, state: InvestigationState, gapId: string): Promise<{ candidate: QuestionCandidate; facts: PhraseFacts } | undefined> {
  const all = await templates.generateDetailed(state, state.gaps.length + 1);
  return all.find((x) => x.candidate.gapId === gapId && x.candidate.kind === 'quick');
}

/** The phrase validator over an agent's text, with the same input the phrase model gets (no model involved). */
export function checkAgentWording(ctx: QuestionContext, state: InvestigationState, facts: PhraseFacts, text: string): PhraseVerdict {
  const requester = startedBy(state);
  const gate = requester ? evidenceGate(ctx.store, requester) : undefined;
  const t = text.replace(/\s+/g, ' ').trim();
  if (facts.kind !== 'missing' && facts.kind !== 'outcome') return { ok: false, reason: 'only yes/no questions about a missing condition or an outcome can be reworded' };
  return validatePhrase(t, phraseCheckFor(facts, visibleCaseFacts(ctx, facts.caseId, state.id, gate)));
}

/**
 * Wraps the investigation's generator (templates, or the phrase slot). A gap with an accepted agent wording gets that
 * text when it still passes the validator now; `generatedBy` becomes the agent-worded route and `phrasing.by` 'agent',
 * so the question card says "worded by the agent". Otherwise the inner candidate is returned unchanged.
 */
export class AgentWordedGenerator implements QuestionGenerator {
  private last: RouteInfo;
  private readonly o: { inner: QuestionGenerator; templates: TemplateQuestionGenerator; ctx: QuestionContext };
  constructor(o: { inner: QuestionGenerator; templates: TemplateQuestionGenerator; ctx: QuestionContext }) {
    this.o = o;
    this.last = o.inner.route;
  }

  get route(): RouteInfo {
    return this.last;
  }

  async generate(state: InvestigationState, maxCandidates: number): Promise<QuestionCandidate[]> {
    const out = await this.o.inner.generate(state, maxCandidates);
    this.last = this.o.inner.route;
    const wordings = acceptedWordings(this.o.ctx.store, state.id);
    if (wordings.size === 0) return out;
    const detailed = await this.o.templates.generateDetailed(state, state.gaps.length + 1);
    let used = 0;
    const result = out.map((c) => {
      const w = wordings.get(c.gapId);
      const d = w && c.kind === 'quick' ? detailed.find((x) => x.candidate.id === c.id) : undefined;
      if (!w || !d) return c;
      const text = w.text.replace(/\s+/g, ' ').trim();
      // The template's own sentence was proposed: nothing was worded by the agent, so the card must not say so.
      if (text.toLowerCase() === d.candidate.text.replace(/\s+/g, ' ').trim().toLowerCase()) return c;
      if (!checkAgentWording(this.o.ctx, state, d.facts, text).ok) return c;
      used++;
      return { ...c, text, templateText: d.candidate.text, generatedBy: { route: AGENT_WORDED_ROUTE.route, version: AGENT_WORDED_ROUTE.version }, phrasing: { by: 'agent' as const } };
    });
    if (used) this.last = AGENT_WORDED_ROUTE;
    return result;
  }
}
