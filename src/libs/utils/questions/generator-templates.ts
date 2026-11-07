import type { Gap, InvestigationState, QuestionCandidate, QuestionGenerator } from '../contracts/index.ts';
import { stableId } from '../contracts/index.ts';
import { casePhrase, loadCaseFacts, parseGapId, parseProblemText, plainLabel, shortCaseLabel, startedBy, withArticle } from '../investigation/index.ts';
import { evidenceGate, visibleCase } from '../retrieval/access.ts';
import { routeInfo } from '../models/routes.ts';
import { normalizeKey, type QuestionContext } from './context.ts';
import { findRecipients, problemEntityIds } from './recipients.ts';
import { instantOf } from '../memory/validity.ts';

/** B1: standing gaps are asked one kind at a time, most useful first (the missing symptom is the Later pile). */
const STANDING_PRIORITY = ['outcome', 'pairing', 'missing-symptom'];
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "this morning" / "today" / "yesterday" / "on 6 Nov" relative to now, in `timeZone`; "earlier" when the time is unknown. */
export function whenPhrase(ms: number | undefined, nowMs: number, timeZone = 'UTC'): string {
  if (ms === undefined) return 'earlier';
  const f = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' });
  const parts = (t: number) => Object.fromEntries(f.formatToParts(new Date(t)).filter((x) => x.type !== 'literal').map((x) => [x.type, Number(x.value)]));
  const a = parts(ms), n = parts(nowMs);
  const dayA = Date.UTC(a.year as number, (a.month as number) - 1, a.day as number);
  const dayN = Date.UTC(n.year as number, (n.month as number) - 1, n.day as number);
  const diff = Math.round((dayN - dayA) / 86_400_000);
  if (diff === 0) return (a.hour as number) < 12 ? 'this morning' : 'today';
  if (diff === 1) return 'yesterday';
  return `on ${a.day} ${SHORT_MONTHS[(a.month as number) - 1]}`;
}

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

/** What a candidate was built from: the input of the phrase slot and of its validator. Never stored. */
export interface PhraseFacts {
  /** B1's standing kinds ('missing-symptom', 'pairing') are carried but never phrased: they keep the template wording. */
  kind: 'missing' | 'outcome' | 'missing-symptom' | 'pairing';
  /** The asset the question names ("TRN-301", "RTR-117 and RTR-118", "this asset"). */
  asset: string;
  /** missing: the plain condition label the question asks about. */
  conditionLabel?: string;
  /** The cited case's short label. */
  caseLabel: string;
  /** outcome: the action noun as the case's evidence mentions it ("the SFP swap"). */
  actionNoun?: string;
  caseId: string;
  gapDescription: string;
  whatAnswerChanges: string;
  problemText: string;
  /** The template's own wording. */
  templateText: string;
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
    return withEvaluative(this.ctx, (await this.generateDetailed(state, maxCandidates)).map((x) => x.candidate));
  }

  /** The factual candidates with the facts each was built from (the phrase slot's input). */
  async generateDetailed(state: InvestigationState, maxCandidates: number): Promise<Array<{ candidate: QuestionCandidate; facts: PhraseFacts }>> {
    const { store, settings } = this.ctx;
    const entityIds = problemEntityIds(this.ctx, state);
    const names = new Map(store.list('entity').map((e) => [e.id, e.name] as const));
    const known = new Set([...names.values()].map((n) => n.toLowerCase()));
    // Asset-like tokens in the problem text that the directory does not know ("ACC-33"): that is the current asset.
    const unresolved = [...new Set((state.problem.text.match(/\b[A-Za-z]{2,6}-\d{1,6}\b/g) ?? []).filter((t) => !known.has(t.toLowerCase())))];
    const out: Array<{ candidate: QuestionCandidate; facts: PhraseFacts }> = [];
    const requester = startedBy(state);
    const gate = requester ? evidenceGate(store, requester) : undefined;

    // B1: a standing state offers only its most useful kind that has not been asked yet.
    let standingKind: string | undefined;
    if (state.origin === 'standing') {
      const asked = new Set(store.list('question').filter((q) => q.candidate.investigationId === state.id && q.status !== 'cancelled').map((q) => q.candidate.gapId));
      const open = state.gaps.filter((g) => g.status === 'open' && !asked.has(g.id)).map((g) => parseGapId(g.id)?.kind);
      standingKind = STANDING_PRIORITY.find((k) => open.includes(k as never));
      if (!standingKind) return [];
    }
    const tz = settings.coordinator.quietHours?.timeZone ?? 'UTC';
    for (const gap of state.gaps) {
      if (gap.status !== 'open' || !gap.consequential) continue;
      const p = parseGapId(gap.id);
      if (!p || p.kind === 'lasting') continue;
      if (standingKind && p.kind !== standingKind) continue;
      if (!standingKind && (p.kind === 'missing-symptom' || p.kind === 'pairing')) continue;
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
      let extra: Partial<QuestionCandidate> = state.origin === 'standing' ? { origin: 'standing' } : {};
      let conditionLabel: string | undefined, actionNoun: string | undefined;
      if (p.kind === 'missing-symptom' || p.kind === 'pairing') {
        const evidenceText = loadCaseFacts(store, c.id, state.id, settings, gate ?? undefined).evidenceText;
        const attempt = p.kind === 'missing-symptom'
          ? store.get('attempt', p.detail)
          : store.list('attempt', { where: { caseId: c.id } }).find((a) => a.performed === 'reported' && !settings.diagnosticActions.includes(a.action));
        if (!attempt || (gate && !gate.supported(attempt.evidence))) continue;
        const phrase = casePhrase(attempt.action, evidenceText, settings.phrases);
        const nowMs = this.ctx.clock().getTime();
        if (p.kind === 'missing-symptom') {
          const vars = { past: phrase.past, asset: caseLabel, when: whenPhrase(instantOf(attempt.when), nowMs, tz) };
          const tpl = 'You {past} on {asset} {when}. What was the problem: what did you see before that?';
          if (!slotsFilled(tpl, vars)) continue;
          text = tidy(fill(tpl, vars));
          rationale = `${gap.description} ${gap.whatAnswerChanges}`;
          consequences = { yes: 'Your words are kept as your attributed report of the symptom on this case.', no: 'Nothing is recorded; the case keeps an action without a symptom.' };
          dedup = normalizeKey(`missing-symptom:${c.id}:${attempt.id}`);
          extra = { ...extra, answerType: 'free-text', pile: 'later' };
        } else {
          const rawOther = store.get('case', p.detail);
          const other = rawOther && gate ? visibleCase(rawOther, gate) : rawOther;
          if (!other) continue;
          const obs = store.list('claim', { where: { caseId: other.id } }).find((x) => x.type === 'observation' && (x.status === 'provisional' || x.status === 'supported'));
          const symptom = (other.title.split('·').slice(1).join('·').trim() || obs?.statement || '').replace(/[.!?]+$/, '');
          const vars = { noun: phrase.noun, asset: caseLabel, symptom, when: whenPhrase(instantOf(other.startedAt), nowMs, tz) };
          const tpl = 'Was {noun} on {asset} for the {symptom} problem reported {when}?';
          if (!slotsFilled(tpl, vars)) continue;
          text = tidy(fill(tpl, vars));
          rationale = `${gap.description} ${gap.whatAnswerChanges}`;
          consequences = {
            yes: `The two cases are linked (${caseLabel} and ${shortCaseLabel(store, other)}), with your answer as the evidence.`,
            no: 'The two cases are recorded as distinct and will not be proposed together again.',
          };
          dedup = normalizeKey(`pairing:${[c.id, other.id].sort().join('|')}`);
        }
        scope = { entityIds: c.entityIds, caseId: c.id };
      } else if (p.kind === 'missing') {
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
        conditionLabel = label;
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
        actionNoun = noun;
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
        candidate: {
          ...common, ...extra, id: stableId('qc', state.id, dedup), text, rationale, consequences, scope, dedupKey: dedup,
          ...(gap.targetClaimId ? { targetClaimId: gap.targetClaimId } : {}),
          recipientIds: recipients.map((r) => r.personEntityId),
        },
        facts: {
          kind: p.kind, asset: assetName, ...(conditionLabel ? { conditionLabel } : {}), caseLabel, ...(actionNoun ? { actionNoun } : {}), caseId: c.id,
          gapDescription: gap.description, whatAnswerChanges: gap.whatAnswerChanges, problemText: state.problem.text, templateText: text,
        },
      });
    }
    return out.slice(0, maxCandidates);
  }
}

/** The factual candidates plus, when configured and there are two, the evaluative pair between the first two. */
export function withEvaluative(ctx: Pick<QuestionContext, 'settings'>, factual: QuestionCandidate[]): QuestionCandidate[] {
  const out = [...factual];
  if (ctx.settings.questions.evaluativePairs && out.length >= 2) {
    const [a, b] = out as [QuestionCandidate, QuestionCandidate];
    out.push(evaluativePair(a, b));
  }
  return out;
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
