/**
 * Case card (BUILD_BRIEF 3.2): one paragraph reconstructing the situation from the structured rows only (never the
 * chat text): the asset and its attributes (hedged ones marked, with who said so), the symptom conditions, the
 * attempts in order with who advised and who performed them, each attempt's outcome and whether it lasted.
 * Deterministic for a given store state. It is the text the embed slot turns into the case's vector.
 *
 * Example: "ABC-123, older unit (installed around 2019; per Ann Advisor, hedged). SFP replaced, interface up, traffic
 * counters zero. Ann Advisor advised an interface reset; Pat Performer performed it; recovered; lasting unknown."
 */
import type { Attempt, Claim, Condition, KnowledgeStore, Outcome } from '../contracts/index.ts';
import { evidenceOrder, isLive } from './case-builder.ts';
import { cmpPos, earliest, positionOf } from './case-label.ts';
import { defaultExtractionConfig } from './extraction-config.ts';
import { conditionText, defaultViewConfig, humanAction, pastAction, type ViewConfig } from './view-config.ts';

export interface CaseCardConfig {
  /** Condition keys (prefix match) that describe the asset itself rather than the symptom. */
  attributePrefixes: string[];
  view: ViewConfig;
  hedges: RegExp;
}

export const defaultCaseCardConfig: CaseCardConfig = {
  attributePrefixes: ['unit.', 'software.', 'firmware.', 'hardware.'],
  view: defaultViewConfig,
  hedges: defaultExtractionConfig.hedges,
};

const RESULT: Record<Outcome['result'], string> = {
  recovered: 'recovered', 'no-change': 'no change', worse: 'got worse', partial: 'partly recovered', unknown: 'outcome unknown',
};
const LASTING: Record<Outcome['lasting'], string> = { unknown: 'lasting unknown', confirmed: 'lasting confirmed', recurred: 'recurred later' };

const lc = (s: string): string => (/^[A-Z]{2,}/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
const article = (noun: string): string => (/^[aeiou]/i.test(noun) && !/^(?:one|uni|use)/i.test(noun) ? `an ${noun}` : /^[A-Z]{2,}/.test(noun) ? `an ${noun}` : `a ${noun}`);
const sentence = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1).replace(/[\s.;,]+$/, '') + '.' : '');

interface Cond { condition: Condition; claim?: Claim }

export function caseCard(store: KnowledgeStore, caseId: string, cfg: CaseCardConfig = defaultCaseCardConfig): string | undefined {
  const c = store.get('case', caseId);
  if (!c) return undefined;
  const order = evidenceOrder(store, c.evidenceIds);
  const claims = store.list('claim', { where: { caseId } }).filter(isLive);
  const byPos = <T extends { supporting?: Claim['supporting']; evidence?: Attempt['evidence'] }>(a: T, b: T) =>
    cmpPos(earliest(order, a.supporting ?? a.evidence ?? []), earliest(order, b.supporting ?? b.evidence ?? []));

  // ---- conditions: from live condition claims (they know who said it and how), then case conditions not covered
  const conds: Cond[] = claims.filter((x) => x.type === 'condition' && x.condition).sort((a, b) => byPos(a, b) || a.id.localeCompare(b.id)).map((x) => ({ condition: x.condition!, claim: x }));
  for (const k of c.conditions) if (!conds.some((x) => x.condition.key === k.key && String(x.condition.value) === String(k.value))) conds.push({ condition: k });
  const seenKey = new Set<string>();
  const uniq = conds.filter((x) => {
    const k = `${x.condition.key}=${String(x.condition.value)}`;
    if (seenKey.has(k)) return false;
    seenKey.add(k);
    return true;
  });
  const isAttr = (x: Cond) => cfg.attributePrefixes.some((p) => x.condition.key.startsWith(p));
  const hedged = (x: Cond) => x.condition.origin === 'inferred' || (!!x.claim && cfg.hedges.test(x.claim.statement));

  // ---- sentence 1: asset and attributes
  const asset = c.entityIds.map((id) => store.get('entity', id)).find((e) => e && (e.type === 'asset' || e.type === 'site'));
  const attrs = uniq.filter(isAttr);
  const used = new Set<Cond>();
  const attrText: string[] = [];
  for (const m of cfg.view.conditionMerges) {
    const base = attrs.find((x) => x.condition.key === m.base);
    const extra = attrs.find((x) => x.condition.key === m.extra);
    if (base && extra) {
      used.add(base); used.add(extra);
      attrText.push(withHedge(m.format(conditionText(base.condition), extra.condition), [base, extra].filter(hedged)));
    }
  }
  for (const a of attrs) if (!used.has(a)) attrText.push(withHedge(conditionText(a.condition), hedged(a) ? [a] : []));
  const head = [asset?.name ?? c.title, ...attrText.map(lc)].join(', ');

  // ---- sentence 2: symptom conditions
  const symptoms = uniq.filter((x) => !isAttr(x)).map((x) => withHedge(lc(conditionText(x.condition)), hedged(x) ? [x] : []));

  // ---- sentence 3: attempts in order, each with its outcome
  const outcomes = store.list('outcome', { where: { caseId } });
  const attempts = store.list('attempt', { where: { caseId } })
    .sort((a, b) => cmpPos(positionOf(order, a.evidence.at(-1)), positionOf(order, b.evidence.at(-1))) || a.id.localeCompare(b.id));
  const symptomLabels = new Set(symptoms.map((s) => s.toLowerCase()));
  const steps: string[] = [];
  for (const a of attempts) {
    const noun = humanAction(a.action, cfg.view);
    // A change already listed as a condition ("SFP replaced") is not repeated as an attempt.
    if (!a.advisedBy && symptomLabels.has(pastAction(a.action, cfg.view).toLowerCase())) continue;
    const parts: string[] = [];
    if (a.advisedBy && a.performed === 'reported') parts.push(`${a.advisedBy.displayName} advised ${article(noun)}`, a.performedBy ? `${a.performedBy.displayName} performed it` : 'it was performed');
    else if (a.advisedBy) parts.push(`${a.advisedBy.displayName} advised ${article(noun)}`, a.performed === 'proposed-only' ? 'not reported as done' : 'not known whether it was done');
    else if (a.performed === 'reported') parts.push(a.performedBy ? `${a.performedBy.displayName} performed ${article(noun)}` : `${article(noun)} was performed`);
    else parts.push(`${article(noun)} was proposed`);
    const out = outcomes.filter((o) => o.attemptId === a.id).sort((x, y) => x.id.localeCompare(y.id))[0];
    if (out) parts.push(RESULT[out.result], ...(out.result === 'recovered' || out.result === 'partial' ? [LASTING[out.lasting]] : []));
    else if (a.performed === 'reported') parts.push('outcome unknown');
    steps.push(parts.join('; '));
  }
  // An outcome not tied to any attempt still belongs to the situation.
  for (const o of outcomes.filter((x) => !x.attemptId || !attempts.some((a) => a.id === x.attemptId)).sort((x, y) => x.id.localeCompare(y.id))) {
    steps.push([`${o.reportedBy ? `${o.reportedBy.displayName} reported ` : ''}${RESULT[o.result]}`, ...(o.result === 'recovered' || o.result === 'partial' ? [LASTING[o.lasting]] : [])].join('; '));
  }

  return [sentence(head), sentence(symptoms.join(', ')), ...steps.map(sentence)].filter(Boolean).join(' ');

  function withHedge(label: string, soft: Cond[]): string {
    if (!soft.length) return label;
    const who = [...new Set(soft.map((x) => x.claim?.assertedBy?.displayName).filter(Boolean))];
    const note = `${who.length ? `per ${who.join(' and ')}, ` : ''}hedged`;
    return label.endsWith(')') ? `${label.slice(0, -1)}; ${note})` : `${label} (${note})`;
  }
}
