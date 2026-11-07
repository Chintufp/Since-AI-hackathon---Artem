/**
 * The phrase slot (BUILD_BRIEF 2.1, 2.4): a model words the one question a gap asks. It wraps the template generator;
 * the gap, the recipients, the consequences, the dedup key and every gate stay the template's. Only `text` may change,
 * and only when the model's sentence passes `validatePhrase`; otherwise the template wording is used and the candidate
 * says why. The model sees only the gap, the case facts the requester may see and the asset.
 */
import type { InvestigationState, QuestionCandidate, QuestionGenerator, RouteInfo } from '../contracts/index.ts';
import { loadCaseFacts, startedBy } from '../investigation/index.ts';
import { evidenceGate } from '../retrieval/access.ts';
import { fallbackRoute, SLOT_TIMEOUT_MS, withFallback, type ModelProvider } from '../models/providers/index.ts';
import { withEvaluative, type PhraseFacts, type TemplateQuestionGenerator } from './generator-templates.ts';
import type { QuestionContext } from './context.ts';

export const PHRASE_VERSION = 'ollama-phrase@1';
export const API_PHRASE_VERSION = 'api-phrase@1';
export const MAX_PHRASE_CHARS = 160;
export const YES_NO_OPENERS = ['Is', 'Are', 'Was', 'Were', 'Does', 'Did', 'Has', 'Have', 'Can', 'Could', 'Should'];

/** Stems of action words: a phrased question may use one only when the input uses the same stem. */
const ACTION_STEMS = [
  'replac', 'swap', 'reboot', 'restart', 'reset', 'reseat', 'power', 'cycl', 'roll', 'revert', 'upgrad', 'downgrad', 'updat', 'install', 'clean',
  'clear', 'bounc', 'patch', 'flash', 'repair', 'rewir', 'recabl', 'tighten', 'reconfig', 'configur', 'disabl', 'enabl', 'shut', 'unplug', 'plug',
  'remov', 'chang', 'adjust', 'fix', 'renew', 'reload', 'reinstall', 'rerout', 'splic', 'measur', 'inspect', 'check',
];
const STOP = new Set(['the', 'and', 'for', 'with', 'this', 'that', 'there', 'here', 'from', 'than', 'unit', 'was', 'were', 'are', 'has', 'have', 'had', 'its', 'not', 'any', 'all', 'one', 'also', 'into', 'onto', 'after', 'before', 'right', 'earlier', 'case']);

const words = (s: string): string[] => s.match(/[\p{L}\p{N}][\p{L}\p{N}'-]*/gu) ?? [];
const lower = (s: string): string => s.toLowerCase();
/** Asset-like ids ("TRN-301", "rtr-117"). */
const ID_RE = /\b[A-Za-z]{2,6}-\d{1,6}\b/g;
const numbersIn = (s: string): string[] => (s.replace(ID_RE, ' ').match(/\d+(?:[.,:]\d+)*/g) ?? []);
const significant = (s: string): string[] => words(lower(s)).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d/.test(w));
const stemOf = (w: string): string | undefined => ACTION_STEMS.find((st) => lower(w).startsWith(st));

export interface PhraseCheck {
  asset: string;
  /** missing questions: the condition label the question must name. */
  conditionLabel?: string;
  /** outcome questions: the action noun and the case label it must name instead of a condition label. */
  actionNoun?: string;
  caseLabel?: string;
  /** Everything the model was given: a phrased question may use only tokens found here. */
  inputText: string;
  /** The template's wording, when there is one: the phrasing must name the label with the words the template uses. */
  templateText?: string;
}

export type PhraseVerdict = { ok: true } | { ok: false; reason: string };

/**
 * The text names `label`: every asset-like id in it (that the template names, when there is a template); otherwise its significant words (compared by their first four
 * letters). With a template, the words the template itself uses for the label are required (a phrasing must name the
 * condition at least as well as the template); without one, at least half of them.
 */
function names(text: string, label: string, template?: string): boolean {
  const t = lower(text);
  const ids = label.match(ID_RE) ?? [];
  if (ids.length) return ids.filter((id) => !template || lower(template).includes(lower(id))).every((id) => t.includes(lower(id)));
  const sig = [...new Set(significant(label).map((w) => w.slice(0, 4)))];
  if (sig.length === 0) return t.includes(lower(label.trim()));
  const have = new Set(words(t).map((w) => w.slice(0, 4)));
  const inTemplate = template ? new Set(words(lower(template)).map((w) => w.slice(0, 4))) : undefined;
  const required = inTemplate ? sig.filter((w) => inTemplate.has(w)) : [];
  if (required.length) return required.every((w) => have.has(w));
  return sig.filter((w) => have.has(w)).length >= Math.ceil(sig.length / 2);
}

/**
 * The phrase validator (also used by B7's kt_propose_question): one sentence ending '?', under 160 characters, a
 * yes/no opening, naming the asset and the condition label (outcome questions: the action noun and the case label),
 * and no entity, number or action absent from the input (numbers inside the asset id and input values are allowed).
 */
export function validatePhrase(text: string, check: PhraseCheck): PhraseVerdict {
  const t = text.trim();
  if (!t) return { ok: false, reason: 'empty' };
  if (t.length >= MAX_PHRASE_CHARS) return { ok: false, reason: `${t.length} characters (limit ${MAX_PHRASE_CHARS - 1})` };
  if (/\n/.test(t)) return { ok: false, reason: 'more than one line' };
  if (!t.endsWith('?')) return { ok: false, reason: 'does not end with a question mark' };
  if (t.slice(0, -1).includes('?') || /[.!;]\s+\S/.test(t)) return { ok: false, reason: 'more than one sentence' };
  if (/[{}]|\bundefined\b|\bnull\b|\s{2,}|\(\s*\)|\s[?.,]/.test(t)) return { ok: false, reason: 'malformed text' };
  const first = words(t)[0] ?? '';
  if (!YES_NO_OPENERS.includes(first)) return { ok: false, reason: `"${first}" does not open a yes/no question` };
  const tpl = check.templateText;
  if (check.asset && check.asset !== 'this asset' && !names(t, check.asset, tpl)) return { ok: false, reason: `does not name ${check.asset}` };
  if (check.conditionLabel && !names(t, check.conditionLabel, tpl)) return { ok: false, reason: `does not name the condition "${check.conditionLabel}"` };
  if (check.actionNoun && !names(t, check.actionNoun, tpl)) return { ok: false, reason: `does not name the action "${check.actionNoun}"` };
  if (check.caseLabel && !check.conditionLabel && !names(t, check.caseLabel, tpl)) return { ok: false, reason: `does not name the case "${check.caseLabel}"` };

  const input = `${check.inputText} ${check.asset} ${check.conditionLabel ?? ''} ${check.actionNoun ?? ''} ${check.caseLabel ?? ''}`;
  const inputWords = new Set(words(lower(input)));
  const inputIds = new Set((input.match(ID_RE) ?? []).map(lower));
  const inputNums = new Set(numbersIn(input));
  for (const id of t.match(ID_RE) ?? []) if (!inputIds.has(lower(id))) return { ok: false, reason: `introduces ${id}` };
  for (const n of numbersIn(t)) if (!inputNums.has(n)) return { ok: false, reason: `introduces the number ${n}` };
  const ws = words(t);
  for (let i = 1; i < ws.length; i++) {
    const w = ws[i]!;
    if (/^\p{Lu}/u.test(w) && !/\d/.test(w) && !inputWords.has(lower(w))) return { ok: false, reason: `introduces "${w}"` };
  }
  const inputStems = new Set([...inputWords].map(stemOf).filter((s): s is string => !!s));
  for (const w of ws) {
    const st = stemOf(w);
    if (st && !inputStems.has(st)) return { ok: false, reason: `introduces the action "${w}"` };
  }
  return { ok: true };
}

export interface PhrasedGeneratorOptions {
  inner: TemplateQuestionGenerator;
  ctx: QuestionContext;
  provider: Pick<ModelProvider, 'kind' | 'generateJson'>;
  model: string;
  route?: RouteInfo;
  timeoutMs?: number;
  onFailure?: (reason: string) => void;
}

const PHRASE_SCHEMA = { type: 'object', properties: { question: { type: 'string' } }, required: ['question'], additionalProperties: false } as const;

export function phraseRoute(kind: 'local' | 'api', model: string): RouteInfo {
  return kind === 'api' ? { route: 'api', version: `${API_PHRASE_VERSION}:${model}` } : { route: 'local', version: `${PHRASE_VERSION}:${model}` };
}

/** The phrase prompt: gap, visible case facts, asset, and the template sentence to reword. */
export function buildPhrasePrompt(f: PhraseFacts, caseFacts: string): string {
  return [
    'Reword one question to a field engineer so it reads naturally. Output JSON {"question": "..."} only.',
    'Rules: one sentence, a yes/no question starting with Is, Are, Was, Were, Does, Did, Has, Have, Can, Could or Should, under 150 characters.',
    `It must name ${f.asset}${f.conditionLabel ? ` and "${f.conditionLabel}"` : ''}${f.actionNoun ? ` and ${f.actionNoun} on ${f.caseLabel}` : ''}.`,
    'Use only names, numbers and actions that appear below. Never add a person, a part, a date or an action.',
    '',
    `Gap: ${f.gapDescription}`,
    `What the answer changes: ${f.whatAnswerChanges}`,
    `Asset: ${f.asset}`,
    `Earlier case: ${f.caseLabel}`,
    caseFacts ? `What the asker may see of that case:\n${caseFacts}` : '',
    `Question to reword: ${f.templateText}`,
  ].filter((l) => l !== '').join('\n');
}

/**
 * Wraps the template generator. For each quick candidate, asks the phrase model for one sentence; accepts it only
 * through `validatePhrase`; on a rejection, an error or the 20 s deadline the template text stays and the candidate
 * says so. `generatedBy` becomes the phrase route only when the model's sentence was accepted.
 */
export class PhrasedQuestionGenerator implements QuestionGenerator {
  private readonly o: PhrasedGeneratorOptions;
  private readonly modelRoute: RouteInfo;
  private last: RouteInfo;

  constructor(o: PhrasedGeneratorOptions) {
    this.o = o;
    this.modelRoute = o.route ?? phraseRoute(o.provider.kind, o.model);
    this.last = o.inner.route;
  }

  /** The route of the last generate(): the phrase route when any wording was accepted, else the templates (marked when the model failed). */
  get route(): RouteInfo {
    return this.last;
  }

  async generate(state: InvestigationState, maxCandidates: number): Promise<QuestionCandidate[]> {
    const detailed = await this.o.inner.generateDetailed(state, maxCandidates);
    const requester = startedBy(state);
    const gate = requester ? evidenceGate(this.o.ctx.store, requester) : undefined;
    let accepted = 0;
    let failure: string | undefined;
    const out = await Promise.all(detailed.map(async ({ candidate, facts }) => {
      if (candidate.kind !== 'quick') return candidate;
      const caseFacts = this.visibleFacts(facts.caseId, state.id, gate);
      const prompt = buildPhrasePrompt(facts, caseFacts);
      const r = await withFallback('phrase',
        async () => {
          const raw = await this.o.provider.generateJson(this.o.model, prompt, PHRASE_SCHEMA as unknown as Record<string, unknown>, { timeoutMs: this.o.timeoutMs ?? SLOT_TIMEOUT_MS.phrase });
          const q = (raw as { question?: unknown } | null)?.question;
          if (typeof q !== 'string') throw new Error('no question in the model output');
          return q.replace(/\s+/g, ' ').trim();
        },
        () => undefined,
        { route: this.modelRoute, rulesRoute: this.o.inner.route, timeoutMs: this.o.timeoutMs ?? SLOT_TIMEOUT_MS.phrase, onFailure: (_s, reason, code) => { failure = code; this.o.onFailure?.(reason); } });
      if (r.value === undefined) return { ...candidate, phrasing: { by: 'template' as const, reason: `phrase model failed: ${r.fallback?.reason ?? 'unknown'}` } };
      const verdict = validatePhrase(r.value, {
        asset: facts.asset, ...(facts.conditionLabel ? { conditionLabel: facts.conditionLabel } : {}),
        ...(facts.actionNoun ? { actionNoun: facts.actionNoun, caseLabel: facts.caseLabel } : {}),
        inputText: [facts.gapDescription, facts.whatAnswerChanges, facts.caseLabel, caseFacts, facts.templateText, facts.problemText].join('\n'), templateText: facts.templateText,
      });
      if (!verdict.ok) return { ...candidate, phrasing: { by: 'template' as const, reason: `model wording rejected: ${verdict.reason}` } };
      // The model returned the template's own sentence: nothing was worded by it, so the card must not say so.
      if (r.value.toLowerCase() === candidate.text.replace(/\s+/g, ' ').trim().toLowerCase()) return { ...candidate, phrasing: { by: 'template' as const, reason: 'the model kept the template wording' } };
      accepted++;
      return { ...candidate, text: r.value, templateText: candidate.text, generatedBy: { route: this.modelRoute.route, version: this.modelRoute.version }, phrasing: { by: 'model' as const } };
    }));
    this.last = accepted ? this.modelRoute : failure ? fallbackRoute(this.o.inner.route, 'phrase', failure) : this.o.inner.route;
    return withEvaluative(this.o.ctx, out);
  }

  /** The case facts the requester may see, as short lines: conditions, causes, advice, attempts, outcomes. */
  private visibleFacts(caseId: string, investigationId: string, gate: ReturnType<typeof evidenceGate> | undefined): string {
    const f = loadCaseFacts(this.o.ctx.store, caseId, investigationId, this.o.ctx.settings, gate);
    const lines = [
      ...(f.case?.conditions ?? []).map((c) => `condition: ${c.label ?? c.key}${c.value !== undefined && !(c.label ?? '').includes(String(c.value)) ? ` = ${String(c.value)}` : ''}`),
      ...f.hypothesisClaims.map((c) => `possible cause: ${c.statement}`),
      ...f.adviceClaims.map((c) => `advice: ${c.statement}`),
      ...f.attempts.map((a) => `attempt: ${a.action}${a.performedBy ? ` by ${a.performedBy.displayName}` : ''}`),
      ...f.outcomes.map((o) => `outcome: ${o.result}`),
    ];
    return [...new Set(lines)].slice(0, 16).join('\n');
  }
}
