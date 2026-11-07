import type { Gap, InvestigationState, QuestionCandidate, QuestionGenerator } from '../contracts/index.ts';
import { stableId } from '../contracts/index.ts';
import { casePhrase, loadCaseFacts, parseGapId, parseProblemText, plainLabel, shortCaseLabel, startedBy, withArticle } from '../investigation/index.ts';
import { evidenceGate, visibleCase } from '../retrieval/access.ts';
import { routeInfo } from '../models/routes.ts';
import { normalizeKey, type QuestionContext } from './context.ts';
import { findRecipients, problemEntityIds } from './recipients.ts';

const SLOT = /\{(\w+)\}/g;
const fill = (tpl: string, vars: Record<string, string>): string => tpl.replace(SLOT, (_, k: string) => vars[k] ?? '');
/** True when every slot of the template has a non-empty value; a question is never rendered with an empty slot. */
const slotsFilled = (tpl: string, vars: Record<string, string>): boolean => [...tpl.matchAll(SLOT)].every((m) => (vars[m[1] as string] ?? '').trim() !== '');
const tidy = (s: string): string => s.replace(/\s+/g, ' ').replace(/\(\s*\)/g, '').replace(/\s+([?.,])/g, '$1').trim();
/** Used when a specific template's slot is unknown, so the question stays askable and honest about what is unknown. */
export const GENERIC_CONDITION_TEMPLATE = 'Is this true for {asset}: {label}?';

/** The value the problem states for a condition key (problem text parse, then supplied observations). */
function statedValue(state: InvestigationState, key: string): string | undefined {
  const fromObs = (state.problem.observations ?? []).find((c) => c.key === key && c.operator === 'eq' && c.value !== undefined);
  const c = fromObs ?? parseProblemText(state.problem.text, state.problem.id).conditions.find((x) => x.key === key);
  return c?.value === undefined ? undefined : String(c.value);
}

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
    const known = new Set([...names.values()].map((n) => n.toLowerCase()));
    // Asset-like tokens in the problem text that the directory does not know ("ACC-33"): that is the current asset.
    const unresolved = [...new Set((state.problem.text.match(/\b[A-Za-z]{2,6}-\d{1,6}\b/g) ?? []).filter((t) => !known.has(t.toLowerCase())))];
    const out: QuestionCandidate[] = [];
    const requester = startedBy(state);
    const gate = requester ? evidenceGate(store, requester) : undefined;

    for (const gap of state.gaps) {
      if (gap.status !== 'open' || !gap.consequential) continue;
      const p = parseGapId(gap.id);
      if (!p || p.kind === 'lasting') continue;
      const rawCase = store.get('case', p.caseId);
      // The question is built from what the requester may see of the case (never from evidence hidden from them).
      const c = rawCase && gate ? visibleCase(rawCase, gate) : rawCase;
      if (!c) continue;
      const caseLabel = shortCaseLabel(store, c);
      // Entities that only belong to the cited case are not the current asset when the problem names an unknown one.
      const own = unresolved.length ? entityIds.filter((id) => !c.entityIds.includes(id)) : entityIds;
      const assetName = [...own.map((id) => names.get(id)).filter(Boolean), ...(own.length ? [] : unresolved)].join(' and ') || 'this asset';
      const hyp = state.hypotheses.find((h) => h.id === stableId('hyp', state.id, p.caseId));
      const evIds = [...new Set((hyp?.basis ?? []).map((b) => b.evidenceId))].slice(0, 4);
      const cite = ''; // evidence ids stay in the structured basis, never in prose (evIds kept for dedup/scope)
      const common = { orgId: state.orgId, investigationId: state.id, gapId: gap.id, kind: 'quick' as const, answerType: 'yes-no-unknown' as const, generatedBy: { route: this.route.route, version: this.route.version } };

      let text: string, rationale: string, consequences: { yes: string; no: string }, scope: QuestionCandidate['scope'], dedup: string;
      if (p.kind === 'missing') {
        if (settings.requesterObservableKeys.includes(p.detail)) continue;
        const cond = c.conditions.find((x) => x.key === p.detail);
        const label = plainLabel(gap.targetCondition?.label ?? p.detail, settings.hedgeMarkers);
        // Specific templates assume equality ("installed in {value}"); other operators use the generic wording over the case label.
        const value = cond?.value === undefined ? '' : String(cond.value);
        // The case records nothing for this key but the problem states a value: ask about the earlier unit with the stated value.
        const aboutCase = !cond && !!settings.problemStated[p.detail];
        const stated = aboutCase ? statedValue(state, p.detail) : undefined;
        const vars = {
          asset: assetName, value, a_value: value ? withArticle(value) : '', label,
          case_label: caseLabel, problem_value: stated ?? '', a_problem_value: stated ? withArticle(stated) : '',
        };
        let tpl = (aboutCase
          ? settings.questions.problemStatedTemplates[p.detail]
          : !cond || cond.operator === 'eq' ? settings.questions.conditionTemplates[p.detail] : undefined) ?? 'Is this true for {asset}: {label}?';
        if (!slotsFilled(tpl, vars)) tpl = GENERIC_CONDITION_TEMPLATE;
        if (!label.trim()) continue;
        text = tidy(fill(tpl, vars));
        rationale = `${hyp ? `Hypothesis "${hyp.statement}" from ${caseLabel} applies only if ${label}. ` : ''}${gap.whatAnswerChanges}${cite}`;
        consequences = aboutCase
          ? {
            yes: `Confirmed that ${label}: the response from ${caseLabel} becomes applicable.`,
            no: `Not so (${label}): the response from ${caseLabel} becomes inapplicable and uncertainty is retained.`,
          }
          : {
            yes: `${label} holds for ${assetName}: the response from ${caseLabel} becomes applicable.`,
            no: `${label} does not hold for ${assetName}: the response from ${caseLabel} becomes inapplicable and uncertainty is retained.`,
          };
        scope = { entityIds: own, caseId: c.id };
        dedup = normalizeKey(`missing:${p.detail}|${[...entityIds].sort().join(',')}`);
      } else {
        const attempt = store.get('attempt', p.detail);
        // No attempt (or none the requester may see): nothing concrete to ask about.
        if (!attempt || (gate && !gate.supported(attempt.evidence))) continue;
        const action = attempt.action;
        const phrase = settings.questions.outcomePhrases[action] ?? 'the problem clear';
        // The action is named only as far as this case's evidence mentions it.
        const noun = casePhrase(action, loadCaseFacts(store, c.id, state.id, settings, gate ?? undefined).evidenceText, settings.phrases).noun;
        text = tidy(`Did ${phrase} right after ${noun} on ${caseLabel}?`);
        rationale = `${gap.description} ${gap.whatAnswerChanges}${cite}`;
        consequences = {
          yes: `Recovery after ${noun} is reported by this person: the response becomes supported (single reported outcome).`,
          no: `No recovery after ${noun}: the hypothesis is contradicted and the recommendation retains uncertainty.`,
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
