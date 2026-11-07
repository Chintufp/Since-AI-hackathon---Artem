import type { Gap, InvestigationState, QuestionCandidate, QuestionGenerator } from '../contracts/index.ts';
import { stableId } from '../contracts/index.ts';
import { parseGapId } from '../investigation/index.ts';
import { routeInfo } from '../models/routes.ts';
import { normalizeKey, type QuestionContext } from './context.ts';
import { findRecipients, problemEntityIds } from './recipients.ts';

const humanize = (action: string): string => action.replace(/[._]/g, ' ');
const fill = (tpl: string, vars: Record<string, string>): string => tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');

/**
 * Route 'rules' question generator: templates over gaps. Only OPEN CONSEQUENTIAL gaps become questions, and gaps
 * whose condition the requester can observe themselves (the recommendation tells them to check) never do.
 */
export class TemplateQuestionGenerator implements QuestionGenerator {
  readonly route = routeInfo('question-templates');
  private ctx: QuestionContext;
  constructor(ctx: QuestionContext) {
    this.ctx = ctx;
  }

  async generate(state: InvestigationState, maxCandidates: number): Promise<QuestionCandidate[]> {
    const { store, settings } = this.ctx;
    const entityIds = problemEntityIds(this.ctx, state);
    const names = new Map(store.list('entity').map((e) => [e.id, e.name] as const));
    const assetName = entityIds.map((id) => names.get(id)).filter(Boolean).join(' and ') || 'this asset';
    const out: QuestionCandidate[] = [];

    for (const gap of state.gaps) {
      if (gap.status !== 'open' || !gap.consequential) continue;
      const p = parseGapId(gap.id);
      if (!p || p.kind === 'lasting') continue;
      const c = store.get('case', p.caseId);
      if (!c) continue;
      const hyp = state.hypotheses.find((h) => h.id === stableId('hyp', state.id, p.caseId));
      const evIds = [...new Set((hyp?.basis ?? []).map((b) => b.evidenceId))].slice(0, 4);
      const cite = evIds.length ? ` Evidence: ${evIds.join(', ')}.` : '';
      const common = { orgId: state.orgId, investigationId: state.id, gapId: gap.id, kind: 'quick' as const, answerType: 'yes-no-unknown' as const, generatedBy: { route: this.route.route, version: this.route.version } };

      let text: string, rationale: string, consequences: { yes: string; no: string }, scope: QuestionCandidate['scope'], dedup: string;
      if (p.kind === 'missing') {
        if (settings.requesterObservableKeys.includes(p.detail)) continue;
        const cond = c.conditions.find((x) => x.key === p.detail);
        const label = gap.targetCondition?.label ?? p.detail;
        // Specific templates assume equality ("installed in {value}"); other operators use the generic wording over the case label.
        const tpl = (!cond || cond.operator === 'eq' ? settings.questions.conditionTemplates[p.detail] : undefined) ?? 'For {asset}: is it true that {label}?';
        text = fill(tpl, { asset: assetName, value: cond?.value === undefined ? '' : String(cond.value), label });
        rationale = `${hyp ? `Hypothesis "${hyp.statement}" from "${c.title}" applies only if ${label}. ` : ''}${gap.whatAnswerChanges}${cite}`;
        consequences = {
          yes: `${label} holds for ${assetName}: the response from "${c.title}" becomes applicable.`,
          no: `${label} does not hold for ${assetName}: the response from "${c.title}" becomes inapplicable and uncertainty is retained.`,
        };
        scope = { entityIds, caseId: c.id };
        dedup = normalizeKey(`missing:${p.detail}|${[...entityIds].sort().join(',')}`);
      } else {
        const attempt = store.get('attempt', p.detail);
        const action = attempt?.action ?? 'the action';
        const phrase = settings.questions.outcomePhrases[action] ?? 'the problem clear';
        text = `Did ${phrase} right after the ${humanize(action)} in "${c.title}"?`;
        rationale = `${gap.description} ${gap.whatAnswerChanges}${cite}`;
        consequences = {
          yes: `Recovery after ${action} is reported by this person: the response becomes supported (single reported outcome).`,
          no: `No recovery after ${action}: the hypothesis is contradicted and the recommendation retains uncertainty.`,
        };
        scope = { entityIds: c.entityIds, caseId: c.id };
        dedup = normalizeKey(`outcome:${p.caseId}:${p.detail}`);
      }
      const recipients = findRecipients(this.ctx, state, gap);
      out.push({
        ...common, id: stableId('qc', state.id, dedup), text, rationale, consequences, scope, dedupKey: dedup,
        ...(gap.targetClaimId ? { targetClaimId: gap.targetClaimId } : {}),
        recipientIds: recipients.map((r) => r.personEntityId),
      });
    }
    const factual = out.slice(0, maxCandidates);
    if (settings.questions.evaluativePairs && factual.length >= 2) {
      const [a, b] = factual as [QuestionCandidate, QuestionCandidate];
      factual.push(evaluativePair(a, b));
    }
    return factual;
  }
}

/** Optional preference candidate between two factual candidates; yields PreferenceFeedback, never factual evidence. */
export function evaluativePair(a: QuestionCandidate, b: QuestionCandidate): QuestionCandidate {
  const dedup = normalizeKey(`evaluative:${[a.dedupKey, b.dedupKey].sort().join('~')}`);
  return {
    id: stableId('qc', a.investigationId, dedup), orgId: a.orgId, investigationId: a.investigationId, gapId: a.gapId, kind: 'evaluative',
    text: `Which question is more useful to answer first: "${a.text}" or "${b.text}"?`, answerType: 'yes-no',
    scope: { entityIds: [...new Set([...a.scope.entityIds, ...b.scope.entityIds])], ...(a.scope.caseId ? { caseId: a.scope.caseId } : {}) },
    rationale: 'Preference between two candidate questions. This is not evidence about the incident.',
    consequences: { yes: 'Records a preference for the first question.', no: 'Records a preference for the second question.' },
    generatedBy: a.generatedBy, dedupKey: dedup, recipientIds: a.recipientIds.filter((r) => b.recipientIds.includes(r)),
  };
}

export const gapOf = (state: InvestigationState, gapId: string): Gap | undefined => state.gaps.find((g) => g.id === gapId);
