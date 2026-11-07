import type {
  ActionName, ClaimType, Condition, ConversationContext, EvidenceEnvelope, EvidenceRef, ExtractionProposal, Extractor,
  OutcomeResult, ProposedClaim, ProposedEntity, ProposedLink, RouteInfo, TimeRef,
} from '../contracts/index.ts';
import { extractionText } from '../context/index.ts';
import { defaultExtractionConfig, type ExtractionConfig } from './extraction-config.ts';
import {
  anchorPhrase, classifyOutcomeState, cleanSentence, firstNameOf, genericActionName, leadingVerb, objectPhrase, readPerformed, stripReferenceClauses,
} from './language.ts';

export const RULES_ROUTE: RouteInfo = { route: 'rules', version: 'rules-extractor@1' };

/** Extra, optional detail the rules extractor attaches; other extractors may omit it (commit re-derives). */
export interface ActionDetail { name: ActionName; negated: boolean; advised: boolean; resolvedFrom?: string }
export interface OutcomeDetail { result: OutcomeResult; recurred: boolean }
export interface RulesClaim extends ProposedClaim {
  action?: ActionDetail[];
  outcome?: OutcomeDetail;
  /** Evidence order index inside the context, used to relate claims in sequence. */
  order?: number;
}

interface Sentence { text: string; start: number; end: number }

/**
 * "Swapped the SFP, the link is up again." is two statements: the action and its result. A sentence is cut at a comma when the
 * left part reports an action and the right part states an outcome. Spans stay offsets into the original text.
 */
export function splitClauses(sentences: Sentence[], cfg: ExtractionConfig, names: string[]): Sentence[] {
  const out: Sentence[] = [];
  for (const s of sentences) {
    let cut = -1;
    const re = /[,;]\s+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s.text))) {
      const left = cleanSentence(s.text.slice(0, m.index), cfg, names);
      const right = s.text.slice(m.index + m[0].length);
      if ((right.match(/[\p{L}\p{N}']+/gu) ?? []).length >= 3 && readPerformed(left, cfg, names) && classifyOutcomeState(right, cfg)) { cut = m.index; break; }
    }
    if (cut < 0) { out.push(s); continue; }
    const rightStart = cut + (/^[,;]\s+/.exec(s.text.slice(cut))?.[0].length ?? 1);
    out.push({ text: s.text.slice(0, cut), start: s.start, end: s.start + cut });
    out.push({ text: s.text.slice(rightStart), start: s.start + rightStart, end: s.end });
  }
  return out;
}

export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  const flush = (end: number) => {
    let s = start;
    let e = end;
    while (s < e && /[\s\-*\u2022.\u2026]/.test(text[s]!)) s++;
    while (e > s && /\s/.test(text[e - 1]!)) e--;
    if (e > s) out.push({ text: text.slice(s, e), start: s, end: e });
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '\n') { flush(i); start = i + 1; continue; }
    if (ch === '.' || ch === '!' || ch === '?') {
      let j = i;
      while (j + 1 < text.length && /[.!?]/.test(text[j + 1]!)) j++;
      const next = text[j + 1];
      if (next === undefined || /\s/.test(next)) { flush(j + 1); start = j + 1; }
      i = j;
    }
  }
  flush(text.length);
  return out;
}

const norm = (s: string): string => s.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
const excerpt = (s: string): string => (s.length > 220 ? s.slice(0, 217) + '...' : s);
const anyMatch = (res: RegExp[], s: string): boolean => res.some((r) => new RegExp(r.source, r.flags.replace('g', '')).test(s));

export function findAssets(text: string, cfg: ExtractionConfig): Array<{ name: string; index: number }> {
  const found: Array<{ name: string; index: number }> = [];
  for (const p of cfg.assetIdPatterns) {
    const re = new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) found.push({ name: canonicalName(m[0], cfg), index: m.index });
  }
  for (const [canon, aliases] of Object.entries(cfg.aliases)) {
    for (const a of aliases) {
      const i = text.toLowerCase().indexOf(a.toLowerCase());
      if (i >= 0) found.push({ name: canon, index: i });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

function canonicalName(name: string, cfg: ExtractionConfig): string {
  for (const [canon, aliases] of Object.entries(cfg.aliases)) if (norm(canon) === norm(name) || aliases.some((a) => norm(a) === norm(name))) return canon;
  return name;
}

/** Action names mentioned in `text`, in order of appearance. */
export function lexiconActions(text: string, cfg: ExtractionConfig): Array<{ name: ActionName; index: number }> {
  const hits: Array<{ name: ActionName; index: number }> = [];
  for (const e of cfg.actionLexicon) {
    const m = new RegExp(e.pattern.source, e.pattern.flags.replace('g', '')).exec(text);
    if (m) hits.push({ name: e.action, index: m.index });
  }
  // A more specific action swallows a generic one that matches inside the same words (e.g. power.cycle vs device.reboot).
  const names = new Set(hits.map((h) => h.name));
  return hits.filter((h) => !(h.name === 'device.reboot' && names.has('power.cycle'))).sort((a, b) => a.index - b.index);
}


const STOPWORDS = new Set(['the', 'a', 'an', 'of', 'to', 'on', 'in', 'and', 'is', 'are', 'was', 'were', 'at', 'by', 'for', 'with', 'after', 'that', 'it', 'as', 'be', 'this', 'there', 'then', 'i', 'we', 'you', 'they', 'he', 'she', 'my', 'our', 'your', 'its', 'their', 'me', 'us', 'them', 'do', 'does', 'did', 'have', 'has', 'had', 'will', 'would', 'can', 'could', 'should', 'not', 'no', 'so', 'but', 'or', 'if', 'than', 'too', 'also', 'just', 'think', 'probably', 'maybe', 'looks', 'like', 'sounds', 'seems', 'suspect', 'guess', 'been', 'being', 'from', 'about', 'what', 'which', 'when', 'who', 'how', 'why', 'one', 'some', 'any', 'all', 'now', 'still', 'again', 'very', 'much', 'more', 'most', 'yes', 'yeah', 'ok', 'okay', 'good', 'great']);
const STATE_VERB = /\b(?:is|are|was|were|has|have|had|shows?|showing|looks?|stalls?|stalling|spinning|stuck|solid|carried|carries|applies|applied|needs?|uses?|runs?|running)\b/i;

/** Lower-case content words (no stop words) of a sentence. */
export function contentWords(s: string): string[] {
  return (s.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}.\-]*/gu) ?? []).map((w) => w.replace(/[.\-]+$/, '')).filter((w) => w.length > 1 && !STOPWORDS.has(w));
}

/** True when a sentence names a problem that is not negated ("errors keep climbing" yes; "no flaps", "without errors" no). */
export function problemNoun(s: string, cfg: ExtractionConfig): boolean {
  for (const base of [cfg.problem, cfg.language.states.problemNouns]) {
    const re = new RegExp(base.source, base.flags.replace('g', '') + 'gi'.replace(/i/g, base.flags.includes('i') ? '' : 'i'));
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      if (!/\b(?:no|zero|without|nor|not|never|any|n't)\s+(?:\w+\s+){0,2}$/i.test(s.slice(Math.max(0, m.index - 24), m.index))) return true;
      if (m[0].length === 0) re.lastIndex++;
    }
  }
  return false;
}

/** Assets a message is about: mentions after a comparison phrase ("same as X", "like on X") are references, not subjects. */
export function subjectAssets(text: string, cfg: ExtractionConfig): string[] {
  const all = findAssets(text, cfg);
  const subjects = all.filter((a) => !cfg.language.referenceCue.test(text.slice(Math.max(0, a.index - 40), a.index)));
  return [...new Set(subjects.map((a) => a.name))];
}

/** "since the hold timer rollback" / "after the SFP swap": the attempt a later statement refers back to, built from the configured nominals. */
function statedAnchor(text: string, lang: ExtractionConfig['language']): string | undefined {
  const nominals = [...new Set([...Object.values(lang.nominals), ...Object.keys(lang.nominals)])].map((n) => n.replace(/\s+/g, '\\s+')).join('|');
  const m = new RegExp(`\\b(?:since|after|following)\\s+(?:the\\s+)?((?:[\\p{L}0-9.\\-]+\\s+){0,3}?(?:${nominals}))\\b`, 'iu').exec(text);
  return m ? `the ${m[1]}` : undefined;
}

/** Anchor phrase from advice text ("Roll back the timer part" -> "the timer rollback") when the performed report had no object of its own. */
function anchorFromAdvice(advice: string, lang: ExtractionConfig['language']): string {
  const lv = leadingVerb(advice, lang, ['base']);
  if (!lv) return 'the advised action';
  return anchorPhrase({ verb: lv.entry, tense: 'base', past: '', object: objectPhrase(lv.rest, lang) }, lang);
}

const CUT = /\b(?:before|unless|until|instead of|rather than)\b/i;

function adviceBody(sentence: string, cfg: ExtractionConfig): { body: string; negated: boolean } | undefined {
  const firstClause = (s: string) => s.replace(CUT.exec(s) ? new RegExp(`${CUT.source}.*$`, 'i') : /$^/, '').trim();
  const start = cfg.imperative.exec(sentence.trim());
  if (start) {
    const negated = /^(?:(?:please|first|then|also|just)\s+)*(?:don'?t|do not|never|avoid)\b/i.test(sentence.trim());
    return { body: firstClause(sentence.trim()), negated };
  }
  const re = new RegExp(`[,:;]\\s*((?:${cfg.imperative.source.replace(/^\^/, '')}).*)$`, 'i');
  const m = re.exec(sentence);
  if (m) return { body: firstClause(m[1]!), negated: /^(?:don'?t|do not|never|avoid)\b/i.test(m[1]!) };
  return undefined;
}

function outcomeOf(sentence: string, cfg: ExtractionConfig): OutcomeDetail | undefined {
  return classifyOutcomeState(sentence, cfg);
}

/** True when the sentence matches the original (narrow) outcome cues, which count as an outcome even before any attempt. */
function outcomeOldCue(sentence: string, cfg: ExtractionConfig): boolean {
  const r = (x: RegExp) => new RegExp(x.source, x.flags.replace('g', ''));
  return r(cfg.outcomeRecovered).test(sentence) || r(cfg.outcomeNoChange).test(sentence) || r(cfg.outcomeWorse).test(sentence) || r(cfg.outcomeRecurred).test(sentence);
}

/** Derive an outcome reading from a statement when a claim carries no structured detail (other extractors). */
export const inferOutcome = (statement: string, cfg: ExtractionConfig = defaultExtractionConfig): OutcomeDetail | undefined => outcomeOf(statement, cfg);
export function inferActions(statement: string, cfg: ExtractionConfig = defaultExtractionConfig): ActionDetail[] {
  const adv = adviceBody(statement, cfg);
  const text = adv?.body ?? statement;
  return lexiconActions(text, cfg).map((a) => ({ name: a.name, negated: !!adv?.negated, advised: !!adv }));
}

/** B1: "fixed in firmware 4.2" / "the 4.2 firmware fixes": the version and the cue text, or undefined. */
export function fixedVersion(text: string, cfg: ExtractionConfig): { version: string; cue: string } | undefined {
  for (const re of cfg.validityCues.fixedInVersion) {
    const m = new RegExp(re.source, re.flags.replace('g', '')).exec(text);
    if (m?.groups?.version) return { version: m.groups.version, cue: m[0].toLowerCase() };
  }
  return undefined;
}

const dateOnly = (raw: string): TimeRef => ({ known: false, partial: 'date-only', raw: raw.trim() });

/**
 * B1 message-level validity cues, after classification:
 * - "every October" in a message lands on the nearest preceding access fact of that message (the code it talks about,
 *   preferring the site.access_code claim) as validity.condition "changes every October";
 * - "until 1 December" / "from 3 November to 1 December" in a claim's own sentence set validity.to as a date-only time
 *   (no year or zone is ever invented, so the end stays unknown to the validity rule);
 * - a replacement cue anywhere in a message marks that message's access facts (a newer code "is now" 7731).
 */
function applyValidityCues(claims: RulesClaim[], msgs: Msg[], cfg: ExtractionConfig): void {
  const vc = cfg.validityCues;
  const re = (r: RegExp) => new RegExp(r.source, r.flags.replace('g', ''));
  for (const m of msgs) {
    const mine = claims.filter((c) => c.evidence[0]?.evidenceId === m.e.id);
    const facts = mine.filter((c) => c.type === 'access-fact');
    if (!facts.length) continue;
    const replaces = re(vc.replaces).exec(m.text)?.[0];
    if (replaces) for (const f of facts) f.validity = { ...f.validity, cue: f.validity?.cue ?? replaces.toLowerCase() };
    for (const s of m.sentences) {
      const rec = re(vc.recurring).exec(s.text);
      if (!rec?.groups?.when) continue;
      const before = facts.filter((f) => (f.evidence[0]?.span?.start ?? 0) <= s.start);
      const pool = before.length ? before : facts;
      const lastStart = Math.max(...pool.map((f) => f.evidence[0]?.span?.start ?? 0));
      const nearest = pool.filter((f) => (f.evidence[0]?.span?.start ?? 0) === lastStart);
      const target = nearest.find((f) => f.condition?.key === 'site.access_code') ?? nearest[0];
      if (!target) continue;
      const when = rec.groups.when.charAt(0).toUpperCase() + rec.groups.when.slice(1).toLowerCase();
      target.validity = { ...target.validity, condition: `changes every ${when}`, cue: rec[0].toLowerCase() };
      if (target.evidence.every((r) => r.span?.start !== s.start)) target.evidence = [...target.evidence, { evidenceId: m.e.id, span: { start: s.start, end: s.end }, excerpt: excerpt(s.text) }];
    }
  }
  for (const c of claims) {
    const text = c.evidence[0]?.excerpt ?? '';
    const range = re(vc.range).exec(text);
    const until = range ? undefined : re(vc.until).exec(text);
    const to = range?.groups?.to ?? until?.groups?.to;
    if (to) c.validity = { ...c.validity, to: dateOnly(to), cue: (range ?? until)![0].toLowerCase() };
  }
}

interface Msg {
  e: EvidenceEnvelope;
  text: string;
  sentences: Sentence[];
  asset?: string;
}

/** True for advice that tells someone not to do something ("Don't reboot"). */
export const isNegatedAdvice = (statement: string): boolean => /^(?:(?:please|first|then|also|just)\s+)*(?:don'?t|do not|never|avoid)\b/i.test(statement.trim());

export function extractFromContext(context: ConversationContext, cfg: ExtractionConfig = defaultExtractionConfig): ExtractionProposal {
  const aliases = { ...cfg.aliases, ...(context.aliases ?? {}) };
  const config: ExtractionConfig = { ...cfg, aliases };
  const people = [...new Set(context.evidence.flatMap((e) => [e.author, ...(e.recipients ?? [])]).map((a) => firstNameOf(a.displayName)).filter((n) => n.length >= 2))];
  const msgs: Msg[] = context.evidence.map((e) => {
    const text = extractionText(e);
    const subject = e.thread.subject ?? '';
    const asset = subjectAssets(`${subject}\n${text}`, config)[0];
    return { e, text, sentences: splitClauses(splitSentences(text), config, people), asset };
  });

  // ---- pass 1: incident boundaries --------------------------------------------------------
  interface Inc { key: string; asset?: string; evidenceIds: string[]; msgIdx: number[]; hasOutcome: boolean; lastPos: number; title?: string }
  const incidents: Inc[] = [];
  const firstAsset = msgs.find((m) => m.asset)?.asset ?? msgs.map((m) => findAssets(`${m.e.thread.subject ?? ''}\n${m.text}`, config)[0]?.name).find(Boolean);
  const ordinal = new Map<string, number>();
  const newInc = (asset: string | undefined, ctxKey: string): Inc => {
    const base = asset ? `asset:${norm(asset)}` : `thread:${ctxKey}`;
    const n = (ordinal.get(base) ?? 0) + 1;
    ordinal.set(base, n);
    return { key: n === 1 ? base : `${base}#${n}`, asset, evidenceIds: [], msgIdx: [], hasOutcome: false, lastPos: 0 };
  };
  // After an outcome, a problem statement that is not itself an outcome report ("still dropping") and that shares almost no
  // words with what was said so far names a different symptom or component: a new incident, even inside the same thread or chat.
  const differentProblem = (text: string, seen: Set<string>, asset: string | undefined): boolean => {
    if (!problemNoun(text, config) || classifyOutcomeState(text, config) || config.language.recurrenceCue.test(text)) return false;
    if (/\?\s*$/.test(text.trim())) return false;
    const assetWords = new Set(asset ? contentWords(asset) : []);
    const words = contentWords(text).filter((w) => !assetWords.has(w) && !findAssets(w, config).length);
    if (words.length < 3) return false;
    return words.filter((w) => seen.has(w)).length / words.length < config.differentProblemOverlap;
  };
  const ctxKey = context.evidence[0]?.thread.threadId ?? context.evidence[0]?.id ?? 'ctx';
  let cur: Inc | undefined;
  let curWords = new Set<string>();
  msgs.forEach((m, idx) => {
    const hasProblem = problemNoun(m.text, config) || config.newProblem.test(m.text);
    const pos = m.e.thread.position ?? idx;
    // A mention of another asset only moves the incident when the message states a problem, is about that asset (not a
    // comparison to it) and says nothing about the current asset.
    const mentionsCurrent = !!cur?.asset && subjectAssets(`${m.e.thread.subject ?? ''}\n${m.text}`, config).includes(cur.asset);
    // A standalone message (no thread) that names no asset and shares no words with the incident so far is a separate remark
    // that merely landed in the same channel and day.
    const unrelatedStandalone = !!cur && !m.e.thread.threadId && !m.asset && !mentionsCurrent && hasProblem && !contentWords(m.text).some((w) => curWords.has(w));
    if (unrelatedStandalone) cur = newInc(undefined, `${ctxKey}:${m.e.id}`);
    if (!cur) cur = newInc(m.asset ?? firstAsset, ctxKey);
    else if (m.asset && cur.asset && m.asset !== cur.asset && hasProblem && !mentionsCurrent) cur = newInc(m.asset, ctxKey);
    else if (cur.hasOutcome && (config.newProblem.test(m.text) || (hasProblem && pos - cur.lastPos > config.maxSequenceGap) || differentProblem(m.text, curWords, cur.asset))) cur = newInc(m.asset ?? cur.asset, ctxKey);
    if (!cur.asset && m.asset) { cur.asset = m.asset; }
    if (cur.evidenceIds.length === 0) curWords = new Set();
    for (const w of contentWords(m.text)) curWords.add(w);
    cur.evidenceIds.push(m.e.id);
    cur.msgIdx.push(idx);
    cur.lastPos = pos;
    if (m.sentences.some((s) => !/\?\s*$/.test(s.text) && outcomeOf(s.text, config)?.result === 'recovered')) cur.hasOutcome = true;
    if (!incidents.includes(cur)) incidents.push(cur);
  });
  // An incident that began before its asset was named takes the asset's key.
  for (const inc of incidents) if (inc.asset && inc.key.startsWith('thread:')) inc.key = `asset:${norm(inc.asset)}`;

  // ---- pass 2: classification ------------------------------------------------------------
  const claims: RulesClaim[] = [];
  const links: ProposedLink[] = [];
  const usefulClaimsByEvidence = new Map<string, Set<ClaimType>>();
  const mark = (id: string, t: ClaimType) => (usefulClaimsByEvidence.get(id) ?? usefulClaimsByEvidence.set(id, new Set()).get(id)!).add(t);
  const ref = (m: Msg, s: Sentence): EvidenceRef => ({ evidenceId: m.e.id, span: { start: s.start, end: s.end }, excerpt: excerpt(s.text) });
  const addLink = (m: Msg, contribution: ProposedLink['contribution'], r: EvidenceRef[], firsthand = true) => {
    const dup = links.find((l) => l.personActorId === m.e.author.id && l.contribution === contribution && l.evidence[0]?.evidenceId === r[0]?.evidenceId);
    if (!dup) links.push({ personActorId: m.e.author.id, contribution, evidence: r, firsthand });
  };
  const participantNames = [...new Set(context.evidence.flatMap((e) => [e.author, ...(e.recipients ?? [])]).map((a) => firstNameOf(a.displayName)).filter((n) => n.length >= 2))];
  const lang = config.language;

  for (const inc of incidents) {
    let lastAdvice: { claim: RulesClaim; authorId: string; actions: ActionDetail[]; text: string } | undefined;
    let pendingQuestion: { authorId: string; ref: EvidenceRef; parses: Array<{ key: string; res: ReturnType<typeof parseCond> }> } | undefined;
    let lastCheckAdvice: { authorId: string; msgIdx: number } | undefined;
    // generic reading state of the incident
    let lastPerformed: { anchor: string; authorId: string; name: string; localIdx: number } | undefined;
    const performedBy = new Map<string, number>(); // `${authorId}|${action}` -> localIdx of the last report
    let openQuestion: { authorId: string; localIdx: number; text: string } | undefined;
    const topic = new Set<string>();
    const addTopic = (s: string) => { for (const w of contentWords(s)) topic.add(w); };
    inc.msgIdx.forEach((mi, localIdx) => {
      const m = msgs[mi]!;
      const author = m.e.author;
      const authorName = firstNameOf(author.displayName);
      const isFirst = localIdx === 0;
      const subjects = (s: string) => {
        const names = [...new Set([...(inc.asset ? [inc.asset] : []), ...findAssets(s, config).map((a) => a.name)])];
        return names;
      };
      const withAsset = (s: string): string => (inc.asset && !new RegExp(`\\b${inc.asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(s) ? `${inc.asset}: ${s}` : s);
      if (isFirst) m.sentences.forEach((s) => addTopic(s.text));
      let genericMode = false; // bullets after "... can look normal:" describe a general pattern, not this incident
      let aside = false;
      let pendingExclusion: { text: string; ref: EvidenceRef } | undefined;
      const answerableQuestion = openQuestion && openQuestion.authorId !== author.id && localIdx - openQuestion.localIdx <= 1 ? openQuestion : undefined;
      let answerUsed = false;
      // A later report of how long things stayed fine ("three days since the rollback ... no flaps ... can close the ticket")
      // is one lasting-outcome claim, not three loose sentences.
      const sentenceCues = m.sentences.map((s) => {
        const sc = stripReferenceClauses(cleanSentence(s.text, config, participantNames), config);
        const q = /\?\s*$/.test(s.text);
        return { sc, dur: !q && lang.longDuration.test(sc) && !!statedAnchor(sc, lang), rec: !q && outcomeOf(sc, config)?.result === 'recovered', clos: !q && lang.closure.test(sc) };
      });
      // In a first message, a change made before the problem is described is background, not an attempt.
      const firstProblemSi = isFirst ? m.sentences.findIndex((x, i) => {
        if (/\?\s*$/.test(x.text)) return false;
        const o = classifyOutcomeState(sentenceCues[i]!.sc, config);
        return problemNoun(sentenceCues[i]!.sc, config) || (!!o && o.result !== 'recovered');
      }) : -1;
      const durIdx = sentenceCues.findIndex((x) => x.dur);
      const recIdx = sentenceCues.findIndex((x, i) => i !== durIdx && x.rec);
      const closIdx = sentenceCues.findIndex((x) => x.clos);
      const composite = durIdx >= 0 && recIdx >= 0 ? { durIdx, recIdx, closIdx } : undefined;
      const noteMessage = m.sentences.some((x) => !!fixedVersion(x.text, config));
      m.sentences.forEach((s, si) => {
        const t = s.text;
        const lineStart = m.text.lastIndexOf('\n', s.start - 1) + 1;
        const isBullet = /^\s*(?:[-*•]|\.{3}|…)/.test(m.text.slice(lineStart, s.start + 1));
        const generic = genericMode && isBullet;
        if (!generic) genericMode = false;
        const r = ref(m, s);
        const isQuestion = /\?\s*$/.test(t);
        const cv = cleanSentence(t, config, participantNames); // verbatim minus vocative and discourse markers
        const c = stripReferenceClauses(cv, config); // also without comparison clauses ("same as X last week")
        const push = (claim: Omit<RulesClaim, 'evidence' | 'subjectEntityNames' | 'assertedByActorId'> & { evidence?: EvidenceRef[] }) => {
          claims.push({ subjectEntityNames: subjects(t), assertedByActorId: author.id, evidence: [r], order: mi, ...claim });
          mark(m.e.id, claim.type);
        };
        // Off-topic aside: the rest of the message is not about this incident.
        if (lang.asideCue.test(t)) aside = true;
        if (aside) { if (!isQuestion) push({ type: 'other', statement: t }); return; }
        if (composite && !aside && (si === composite.durIdx || si === composite.closIdx)) return;
        if (composite && !aside && si === composite.recIdx) {
          const dur = sentenceCues[composite.durIdx]!.sc;
          const core = new RegExp(lang.states.recovered.source, 'i').exec(sentenceCues[si]!.sc)?.[0] ?? sentenceCues[si]!.sc.replace(/[.!\s]+$/, '');
          const span = new RegExp(lang.longDuration.source, 'i').exec(dur)?.[0].replace(/^(?:for|over|after|in|about|nearly|almost)\s+/i, '') ?? '';
          const closing = composite.closIdx >= 0 ? new RegExp(lang.closure.source, 'i').exec(sentenceCues[composite.closIdx]!.sc)?.[0] : undefined;
          const statement = `${core} for ${span.toLowerCase()} after ${statedAnchor(dur, lang)}${closing ? `, ${closing}` : ''}`;
          const refs = [r, ref(m, m.sentences[composite.durIdx]!)];
          push({ type: 'outcome', statement, outcome: { result: 'recovered', recurred: false }, evidence: refs });
          addLink(m, 'reported-outcome', [r]);
          return;
        }
        // Yes/no answer to a pending condition question.
        if (si === 0 && pendingQuestion && pendingQuestion.authorId !== author.id && /^(?:yes|yeah|yep|correct|right|indeed|that'?s right)\b/i.test(t)) {
          for (const p of pendingQuestion.parses) {
            if (!p.res) continue;
            const cond: Condition = { key: p.key, operator: p.res.operator, value: p.res.value, origin: 'reported', evidence: [r], label: p.res.label };
            push({
              type: 'condition', statement: `${p.res.label}: answered "${t.replace(/[.!]+$/, '')}" to "${pendingQuestion.ref.excerpt}"`,
              evidence: [r], condition: cond,
            });
            addLink(m, 'observed-condition', [r]);
          }
          pendingQuestion = undefined;
          if (/^(?:yes|yeah|yep)[.!,]?$/i.test(t.trim())) return;
        }
        if (isQuestion && !generic) {
          const parses = condParses(t, config);
          if (parses.length) pendingQuestion = { authorId: author.id, ref: r, parses };
          openQuestion = { authorId: author.id, localIdx, text: t };
          return;
        }
        const wc = (c.match(/[\p{L}\p{N}']+/gu) ?? []).length;
        if (!t.trim() || /^[\p{Extended_Pictographic}\s]+$/u.test(t) || wc === 0) return;

        // 0. B1 validity cues come before access facts and outcomes: "the 4.2 firmware fixes the bug" is a superseding
        // note (a bound on older advice), never a recovery of the old case. The rest of such a message belongs to the note.
        const fixed = fixedVersion(t, config);
        if (fixed) {
          const vc = config.validityCues;
          push({
            type: 'other', statement: withAsset(cv), validity: { cue: fixed.cue },
            supersessionBound: { key: vc.fixedBound.key, operator: vc.fixedBound.operator, value: fixed.version, origin: 'reported', evidence: [r], label: vc.fixedBound.label.replaceAll('{version}', fixed.version) },
          });
          return;
        }
        if (noteMessage) { push({ type: 'other', statement: t }); return; }

        // 1. access facts (non-incident operational knowledge)
        if (anyMatch(config.cues['access-fact'], t)) {
          const acc = /\b(barrier|gate|lockbox|key|code|contact|locked)\b/i.exec(t)?.[1]?.toLowerCase();
          const value = acc === 'lockbox' || acc === 'locked' ? 'barrier' : acc === 'gate' ? 'barrier' : acc ?? 'contact';
          const replaces = config.validityCues.replaces.exec(t)?.[0];
          // B1: a sentence that gives a code carries it as site.access_code (qualified by what it opens), so a newer code
          // closes the older one through the newer-value rule; without a code the access kind stays site.access.
          const code = new RegExp(config.validityCues.accessCode.source, config.validityCues.accessCode.flags.replace('g', '')).exec(t);
          const kind = code?.groups?.code ? code.groups.kind!.toLowerCase().replace(/\s+/g, '').replace('keybox', 'lockbox') : undefined;
          const cond: Condition = kind && code?.groups?.code
            ? { key: 'site.access_code', operator: 'eq', value: code.groups.code, qualifier: kind, origin: 'reported', evidence: [r], label: `${kind.charAt(0).toUpperCase()}${kind.slice(1)} code ${code.groups.code}` }
            : { key: 'site.access', operator: 'eq', value, origin: 'reported', evidence: [r], label: `Site access: ${value}` };
          push({ type: 'access-fact', statement: t, condition: cond, ...(replaces ? { validity: { cue: replaces.toLowerCase() } } : {}) });
          addLink(m, 'observed-condition', [r]);
          return;
        }
        const adv = adviceBody(cv, config);
        // "I think" on a first-person factual report ("installed around 2019 I think") is a hedge, not a hypothesis.
        const hypText = cv.replace(/\bi think\b/i, '');
        const hasConds = condParses(c, config).length > 0;
        const hyp = anyMatch(config.cues.hypothesis, hypText) || (/\bi think\b/i.test(cv) && !hasConds) || generic;
        const startsImperative = config.imperative.test(cv.trim());
        // 2. advice (imperative first)
        // "<Verb> done on both ends" reports finished work; it is not an instruction even though it starts with a verb
        const completedReport = startsImperative && /^[\p{L}]+(?:\s[\p{L}]+)?\s+(?:done|completed?|finished)\b/iu.test(cv.trim());
        if (adv && !completedReport && (startsImperative || !hyp)) {
          const hc = lang.hedgeClause.exec(cv);
          const adviceText = hc ? cv.slice(0, hc.index).trim() : cv;
          const actions = lexiconActions(adv.body, config).map((a) => ({ name: a.name, negated: adv.negated, advised: true }));
          const claim: RulesClaim = { subjectEntityNames: subjects(t), assertedByActorId: author.id, evidence: [r], type: 'advice', statement: adviceText || cv, action: actions, order: mi };
          claims.push(claim);
          mark(m.e.id, 'advice');
          addLink(m, 'advised', [r]);
          if (actions.some((a) => !a.negated)) lastAdvice = { claim, authorId: author.id, actions: actions.filter((a) => !a.negated), text: cv };
          if (actions.some((a) => a.name.endsWith('.check') && !a.negated)) lastCheckAdvice = { authorId: author.id, msgIdx: localIdx };
          // "check X, I suspect it stalls when warm": the hedged clause is a hypothesis about X
          if (hc) {
            const obj = leadingVerb(adviceText, lang, ['base'])?.rest ?? '';
            const subj = objectPhrase(obj, lang);
            const clause = hc[1]!.replace(/^(?:i (?:suspect|think|guess|believe|assume)\s+|probably\s+|maybe\s+|perhaps\s+|possibly\s+)/i, '').replace(/^it\b/i, subj || 'it');
            if (contentWords(clause).length >= 2) {
              push({ type: 'hypothesis', statement: clause.replace(/[.!\s]+$/, '') });
            }
          }
          return;
        }
        // 3. hypothesis (uncertainty kept verbatim in the statement)
        if (config.documentation.test(t) && !adv) {
          push({ type: 'other', statement: t });
          return;
        }
        if (hyp && generic) {
          push({ type: 'other', statement: t });
          if (/:\s*$/.test(t)) genericMode = true;
          return;
        }
        if (hyp && wc < 3) return;
        if (hyp) {
          const content = contentWords(cv);
          // a hedge that only points back ("That is probably it") or is unrelated to the incident carries no claim of its own
          if (content.length >= 1 && !lang.closure.test(cv) && lang.exclusion.test(cv) && !pendingExclusion) {
            // a ruled-out cause waits for the cause that replaces it ("the filter was swapped so that is not it. Check X, I suspect ...")
            pendingExclusion = { text: cv.replace(/[.!\s]+$/, ''), ref: r };
            return;
          }
          const stmt = pendingExclusion && !lang.exclusion.test(cv) ? `${cv.replace(/[.!\s]+$/, '')} and ${pendingExclusion.text.charAt(0).toLowerCase()}${pendingExclusion.text.slice(1)}` : cv;
          const exRef = pendingExclusion && !lang.exclusion.test(cv) ? [pendingExclusion.ref, r] : undefined;
          pendingExclusion = undefined;
          push({ type: content.length >= 1 && !lang.closure.test(cv) ? 'hypothesis' : 'other', statement: stmt, ...(exRef ? { evidence: [r, ...exRef.slice(0, 1)] } : {}) });
          if (/:\s*$/.test(t)) genericMode = true;
          return;
        }
        const advWords = anyMatch(config.cues.advice, cv);
        if (advWords) {
          push({ type: 'advice', statement: cv, action: lexiconActions(cv, config).map((a) => ({ name: a.name, negated: false, advised: true })) });
          addLink(m, 'advised', [r]);
          return;
        }
        // 4. general experience, not this incident
        if (anyMatch(config.generic, t)) {
          push({ type: 'other', statement: t });
          return;
        }
        // closure remarks ("we can close the ticket") restate nothing new
        if (lang.closure.test(c) && !config.performed.test(c)) {
          push({ type: 'other', statement: c });
          return;
        }
        let consumed = false;
        let byAction = false;
        // 5. performed action
        const pr = readPerformed(c, config, participantNames);
        if (pr || config.performed.test(c)) {
          let statement = c;
          let actions: ActionDetail[] = lexiconActions(c, config).map((a) => ({ name: a.name, negated: false, advised: false }));
          let anchor: string | undefined;
          let who = authorName;
          if (pr) {
            who = pr.performerName ?? authorName;
            statement = `${who} ${pr.past}`;
            if (inc.asset && !new RegExp(`\\b${inc.asset.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(statement)) statement = `${statement} on ${inc.asset}`;
            // an implicit object ("Reset done on both ends") is the action just advised with that verb
            if (!actions.length && !pr.object && lastAdvice) {
              const verbRe = new RegExp(`\\b${pr.verb.base.replace(/\s+/g, '\\s+')}`, 'i');
              if (verbRe.test(lastAdvice.text)) actions = lastAdvice.actions.map((a) => ({ name: a.name, negated: false, advised: false, resolvedFrom: lastAdvice!.claim.evidence[0]!.evidenceId }));
            }
            if (!actions.length) {
              const g = genericActionName(pr);
              if (g) actions = [{ name: g, negated: false, advised: false }];
            }
            anchor = anchorPhrase(pr, lang);
          }
          if (!actions.length && /\b(?:did (?:that|it)|done)\b/i.test(c) && lastAdvice && lastAdvice.authorId !== author.id) {
            actions = lastAdvice.actions.map((a) => ({ name: a.name, negated: false, advised: false, resolvedFrom: lastAdvice!.claim.evidence[0]!.evidenceId }));
            statement = `${c} [refers to advice: "${excerpt(lastAdvice.text)}"]`;
          }
          // "Done." after the same person said they were doing it confirms that report instead of adding a second action
          const repeated = actions.length > 0 && actions.every((a) => {
            const k = performedBy.get(`${author.id}|${a.name}`);
            return k !== undefined && localIdx - k <= 3 && localIdx !== k && !pr;
          });
          if (actions.length && !repeated) {
            for (const act of actions) {
              claims.push({
                subjectEntityNames: subjects(t), assertedByActorId: author.id, evidence: [r], // the advice it refers to is context (in the statement), not a second source
                type: 'action', statement, action: [act], order: mi,
                condition: { key: 'action.performed', operator: 'eq', value: act.name, origin: 'reported', evidence: [r], label: `Performed: ${act.name.replace(/\./g, ' ')}` },
              });
              performedBy.set(`${author.id}|${act.name}`, localIdx);
            }
            mark(m.e.id, 'action');
            addLink(m, 'performed-action', [r]);
            // Only changes made after the problem was stated, and not mere checks, can have outcomes.
            const diagnostic = actions.every((a) => /\.check$|^(?:check|verify|inspect|test|monitor|watch)\./.test(a.name));
            if ((!isFirst || firstProblemSi === -1 || si > firstProblemSi) && !diagnostic) {
              if (anchor) lastPerformed = { anchor, authorId: author.id, name: who, localIdx };
              else if (lastAdvice) lastPerformed = { anchor: anchorFromAdvice(lastAdvice.text, lang), authorId: author.id, name: who, localIdx };
            }
            consumed = true;
            byAction = true;
          } else if (repeated) { consumed = true; byAction = true; }
        }
        // 6. outcome (a first message states the problem, so outcome words there describe the problem)
        const oc = outcomeOf(c, config);
        let problemStatement = false;
        if (oc && !consumed) {
          const oldCue = outcomeOldCue(c, config);
          const stated = statedAnchor(c, lang);
          const anchorText = lastPerformed?.anchor ?? stated;
          // weak positives ("looks fine") only count as outcomes when they are about the problem being worked on
          const weak = oc.result === 'recovered' && !oldCue && !lang.strongRecovery.test(c) && !contentWords(c).some((w) => topic.has(w));
          const gated = oc.recurred || ((!!anchorText || oldCue) && !weak);
          // In a first message outcome-like words describe the problem, unless it is a recovery reported after an action (a write-up)
          if (isFirst && oc.result !== 'recovered') problemStatement = true;
          else if (gated) {
            const anchored = anchorText && !stated && !/\b(?:after|since|following)\b/i.test(c) ? `${c.replace(/[.!\s]+$/, '')} after ${anchorText}` : withAsset(c);
            push({ type: 'outcome', statement: anchored, outcome: oc });
            addLink(m, 'reported-outcome', [r]);
            consumed = true;
            byAction = true;
          }
        }
        // 7. conditions (never from hypothetical/advice sentences, which returned above)
        const parses = condParses(c, config);
        let stateKey = false;
        for (const p of parses) {
          if (!p.res) continue;
          // Hedging is not in the label; it stays in the verbatim statement (the case view flags it). Origin stays 'reported'
          // because downstream matching treats an 'inferred' origin as not settling a distinguishing condition.
          const cond: Condition = { key: p.key, operator: p.res.operator, value: p.res.value, origin: 'reported', evidence: [r], label: p.res.label };
          push({ type: 'condition', statement: withAsset(c), condition: cond });
          addLink(m, 'observed-condition', [r]);
          if (lastCheckAdvice && lastCheckAdvice.authorId !== author.id && localIdx - lastCheckAdvice.msgIdx <= 2) addLink(m, 'performed-check', [r]);
          consumed = true;
          if (config.stateConditionKeys.includes(p.key)) stateKey = true;
        }
        // 8. problem statement / state report
        let emittedObs = false;
        if (!byAction || problemStatement) {
          if (problemStatement || (problemNoun(c, config) && wc >= 3) || (stateKey && !lastPerformed)) {
            push({ type: 'observation', statement: withAsset(c) });
            addLink(m, 'reported-problem', [r]);
            addTopic(c);
            emittedObs = true;
            if (!inc.title) inc.title = c;
          }
        } else if (isFirst && problemNoun(c, config) && !inc.title) {
          inc.title = c;
        }
        // 9. other declarative statements: an answer to a question just asked, or a topical state report
        if (!consumed && !emittedObs && wc >= 4 && !isQuestion && !lang.intent.test(c)) {
          const content = contentWords(c);
          const overlap = content.filter((w) => topic.has(w)).length;
          if (answerableQuestion && !answerUsed && si <= 1) {
            answerUsed = true;
            push({ type: lang.readingQuestion.test(answerableQuestion.text) ? 'observation' : 'condition', statement: withAsset(c) });
            addLink(m, 'observed-condition', [r]);
          } else if (!isFirst && overlap >= 1 && STATE_VERB.test(c) && !lastPerformed) {
            push({ type: 'observation', statement: withAsset(c) });
            addLink(m, 'reported-problem', [r]);
          }
        }
      });
    });
  }

  applyValidityCues(claims, msgs, config);

  // ---- entities, identity, mentions -------------------------------------------------------
  const entities = new Map<string, ProposedEntity>();
  const addEntity = (type: ProposedEntity['type'], name: string, r: EvidenceRef, extra?: Partial<ProposedEntity>) => {
    const k = `${type === 'person' ? 'person' : 'thing'}:${norm(name)}`;
    const ex = entities.get(k);
    if (ex) { if (ex.evidence.length < 5) ex.evidence.push(r); return ex; }
    const e: ProposedEntity = { type, name, aliases: [...(config.aliases[name] ?? [])], evidence: [r], ...extra };
    entities.set(k, e);
    return e;
  };
  const accessSubjects = new Set(claims.filter((c) => c.type === 'access-fact').flatMap((c) => c.subjectEntityNames));
  for (const m of msgs) {
    const subject = m.e.thread.subject ?? '';
    for (const a of findAssets(`${subject}\n${m.text}`, config)) {
      const inBody = a.index >= subject.length + 1;
      const idx = inBody ? a.index - subject.length - 1 : -1;
      const r: EvidenceRef = inBody
        ? { evidenceId: m.e.id, span: { start: idx, end: idx + a.name.length }, excerpt: excerpt(m.text.slice(Math.max(0, idx - 20), idx + a.name.length + 20).trim()) }
        : { evidenceId: m.e.id, excerpt: excerpt(subject) };
      const inIncident = claims.some((c) => c.type !== 'access-fact' && c.type !== 'identity' && c.subjectEntityNames.includes(a.name));
      addEntity(accessSubjects.has(a.name) && !inIncident ? 'site' : 'asset', a.name, r);
    }
    const actor = m.e.author;
    if (actor.id !== 'person:email:unknown' && actor.id !== 'person:paste:unknown') {
      const p = addEntity('person', actor.displayName, { evidenceId: m.e.id, excerpt: excerpt(m.text.split('\n')[0] ?? '') });
      if (actor.role) p.attributes = { ...(p.attributes ?? {}), role: { value: actor.role, evidence: [{ evidenceId: m.e.id }] } };
    }
    for (const rcp of m.e.recipients ?? []) addEntity('person', rcp.displayName, { evidenceId: m.e.id, excerpt: `recipient: ${rcp.displayName}` });
  }
  // identity claims from declared roles (one per person, evidence = their first message)
  const seenRole = new Set<string>();
  for (const m of msgs) {
    const a = m.e.author;
    if (!config.declaredRoleClaims || !a.role || a.role === 'bot' || seenRole.has(a.id)) continue;
    seenRole.add(a.id);
    const r: EvidenceRef = { evidenceId: m.e.id, excerpt: `${a.displayName}: ${excerpt(m.text.split('\n')[0] ?? '')}` };
    claims.push({ type: 'identity', statement: `${a.displayName} is a ${a.role}`, subjectEntityNames: [a.displayName], assertedByActorId: a.id, evidence: [r], order: 0 });
    mark(m.e.id, 'identity');
  }
  // people named in access/advice text but not authors: 'mentioned'
  const authorNames = new Map(msgs.map((m) => [norm(m.e.author.displayName), m.e.author]));
  const contributors = new Set(links.map((l) => l.personActorId));
  for (const m of msgs) {
    for (const [nm, actor] of authorNames) {
      if (actor.id === m.e.author.id || contributors.has(actor.id)) continue;
      const first = nm.split(' ')[0]!;
      const i = norm(m.text).indexOf(first);
      if (first.length >= 3 && i >= 0) links.push({ personActorId: actor.id, contribution: 'mentioned', evidence: [{ evidenceId: m.e.id, excerpt: excerpt(m.text.slice(0, 120)) }], firsthand: false });
    }
    for (const s of m.sentences) {
      const mm = /\b(?i:contact|call|ask)\s+([A-ZÄÖÅ][\p{L}'-]+(?:\s+[A-ZÄÖÅ][\p{L}'-]+)?)/u.exec(s.text);
      if (mm && anyMatch(config.cues['access-fact'], s.text) && !authorNames.has(norm(mm[1]!))) {
        const r: EvidenceRef = { evidenceId: m.e.id, span: { start: s.start, end: s.end }, excerpt: excerpt(s.text) };
        addEntity('person', mm[1]!, r);
        links.push({ personActorId: `person:mention:${norm(mm[1]!)}`, contribution: 'mentioned', evidence: [r], firsthand: false });
      }
    }
  }

  // ---- usefulness labels ------------------------------------------------------------------
  const usefulness: ExtractionProposal['usefulness'] = context.evidence.map((e) => {
    const types = usefulClaimsByEvidence.get(e.id);
    const referenced = claims.some((c) => c.evidence.some((x) => x.evidenceId === e.id) && c.type !== 'identity');
    const substantive = types && [...types].some((t) => t !== 'identity' && t !== 'other');
    if (substantive || referenced) return { evidenceId: e.id, label: 'useful' as const, reason: `yielded ${[...(types ?? [])].filter((t) => t !== 'identity').join(', ') || 'referenced claim'}` };
    if (types?.has('other')) return { evidenceId: e.id, label: 'uncertain' as const, reason: 'general experience or documentation remark, not tied to this incident' };
    const text = extractionText(e).trim();
    if (!text || /^[\p{Extended_Pictographic}\s.!]+$/u.test(text)) return { evidenceId: e.id, label: 'irrelevant' as const, reason: 'empty or emoji-only' };
    if (config.smallTalk.test(text) || (text.match(/[\p{L}\p{N}']+/gu) ?? []).length <= 8) return { evidenceId: e.id, label: 'irrelevant' as const, reason: 'small talk, greeting or acknowledgement; no extractable knowledge' };
    return { evidenceId: e.id, label: 'uncertain' as const, reason: 'no rule matched; may still hold context' };
  });

  return {
    route: RULES_ROUTE,
    entities: [...entities.values()],
    claims,
    links,
    incidents: incidents.map((inc) => ({
      key: inc.key,
      evidenceIds: inc.evidenceIds,
      title: inc.title ? `${inc.asset ? inc.asset + ': ' : ''}${inc.title.replace(/^(?:hi|hello|hey)\b[^,]{0,30},\s*/i, '').replace(/^(?:but|and|so)\s+/i, '')}`.slice(0, 140) : inc.asset ? `Incident on ${inc.asset}` : `Incident in ${msgs[inc.msgIdx[0]!]?.e.thread.subject ?? 'conversation'}`,
    })),
    usefulness,
  };
}

function condParses(t: string, cfg: ExtractionConfig) {
  return cfg.conditionParsers
    .map((p) => {
      const m = new RegExp(p.pattern.source, p.pattern.flags.replace('g', '')).exec(t);
      return m ? { key: p.key as string, res: parseCond(p, m) } : undefined;
    })
    .filter((x): x is { key: string; res: ReturnType<typeof parseCond> } => !!x && !!x.res);
}
function parseCond(p: ExtractionConfig['conditionParsers'][number], m: RegExpExecArray) {
  return p.build(m);
}

export function createRulesExtractor(config: ExtractionConfig = defaultExtractionConfig): Extractor & { extractSync(c: ConversationContext): ExtractionProposal } {
  return {
    route: RULES_ROUTE,
    extractSync: (c) => extractFromContext(c, config),
    extract: async (c) => extractFromContext(c, config),
  };
}
