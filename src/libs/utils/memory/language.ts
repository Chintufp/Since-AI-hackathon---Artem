/**
 * Generic English helpers for the rules extractor: verb forms from a configured base list, leading-verb detection,
 * tense normalization, action-object extraction and statement cleanup. All vocabulary comes from `LanguageConfig`
 * (extraction-config.ts); nothing here names a device, family or person.
 */
import type { ExtractionConfig, LanguageConfig, OutcomeStateLexicon } from './extraction-config.ts';
import type { OutcomeDetail } from './extractor-rules.ts';

export type Tense = 'base' | 'past' | 'ing' | 'third';

export interface VerbEntry { base: string; head: string; particle: string; past: string; ing: string; third: string }
export interface VerbIndex {
  entries: VerbEntry[];
  /** surface form -> entries (several verbs can share a head word, e.g. "roll back" and "roll"). */
  byForm: Map<string, Array<{ entry: VerbEntry; tense: Tense }>>;
}

const VOWELS = /[aeiou]/;
const isCvc = (w: string): boolean => w.length <= 4 && /[^aeiou][aeiou][^aeiouwxy]$/.test(w);

function pastOf(head: string, irregular: Record<string, string>): string {
  if (irregular[head]) return irregular[head]!;
  if (head.endsWith('e')) return head + 'd';
  if (/[^aeiou]y$/.test(head)) return head.slice(0, -1) + 'ied';
  if (isCvc(head)) return head + head.slice(-1) + 'ed';
  return head + 'ed';
}
function ingOf(head: string): string {
  if (head.endsWith('ie')) return head.slice(0, -2) + 'ying';
  if (head.endsWith('e') && !head.endsWith('ee')) return head.slice(0, -1) + 'ing';
  if (isCvc(head)) return head + head.slice(-1) + 'ing';
  return head + 'ing';
}
function thirdOf(head: string): string {
  if (/(?:s|x|z|ch|sh)$/.test(head)) return head + 'es';
  if (/[^aeiou]y$/.test(head)) return head.slice(0, -1) + 'ies';
  return head + 's';
}

const indexCache = new WeakMap<LanguageConfig, VerbIndex>();

export function verbIndex(lang: LanguageConfig): VerbIndex {
  const hit = indexCache.get(lang);
  if (hit) return hit;
  const entries: VerbEntry[] = lang.verbs.map((base) => {
    const words = base.toLowerCase().split(/\s+/);
    const head = words[0]!;
    const particle = words.slice(1).join(' ');
    const irregularFull = lang.irregularPast[base.toLowerCase()];
    return {
      base: base.toLowerCase(), head, particle,
      past: irregularFull && !particle ? irregularFull : pastOf(head, lang.irregularPast),
      ing: ingOf(head), third: thirdOf(head),
    };
  });
  const byForm = new Map<string, Array<{ entry: VerbEntry; tense: Tense }>>();
  const add = (form: string, entry: VerbEntry, tense: Tense) => {
    const list = byForm.get(form) ?? byForm.set(form, []).get(form)!;
    if (!list.some((x) => x.entry === entry && x.tense === tense)) list.push({ entry, tense });
  };
  for (const e of entries) {
    add(e.head, e, 'base');
    add(e.past, e, 'past');
    add(e.ing, e, 'ing');
    add(e.third, e, 'third');
  }
  // Longest (particle) entries first so "roll back" wins over a bare "roll".
  for (const list of byForm.values()) list.sort((a, b) => b.entry.particle.length - a.entry.particle.length);
  const idx = { entries, byForm };
  indexCache.set(lang, idx);
  return idx;
}

export interface LeadingVerb { entry: VerbEntry; tense: Tense; /** text after the verb (and its particle), no leading space */ rest: string; /** text of the verb phrase as written */ written: string }

/** The verb at the very start of `phrase` (after optional adverbs), if it is in the configured list. */
export function leadingVerb(phrase: string, lang: LanguageConfig, allowed: Tense[] = ['base', 'past', 'ing']): LeadingVerb | undefined {
  const idx = verbIndex(lang);
  const m = /^((?:(?:just|already|also|then|first|now|quickly|finally|again)\s+)*)([\p{L}][\p{L}'-]*)\b\s*(.*)$/su.exec(phrase.trim());
  if (!m) return undefined;
  const word = m[2]!.toLowerCase();
  const cands = idx.byForm.get(word);
  if (!cands) return undefined;
  const rest = m[3]!;
  for (const c of cands) {
    if (!allowed.includes(c.tense)) continue;
    if (c.entry.particle) {
      const re = new RegExp(`^${c.entry.particle.replace(/\s+/g, '\\s+')}\\b\\s*(.*)$`, 'is');
      const pm = re.exec(rest);
      if (!pm) continue;
      return { entry: c.entry, tense: c.tense, rest: pm[1]!, written: `${m[2]} ${c.entry.particle}` };
    }
    return { entry: c.entry, tense: c.tense, rest, written: m[2]! };
  }
  return undefined;
}

export interface PerformedReading {
  performerName?: string; // explicit first name when the sentence names someone other than the author
  verb: VerbEntry;
  tense: Tense;
  /** past-tense phrase "replaced the tray" */
  past: string;
  /** object words after the verb ("the tray") */
  object: string;
}

const NEG = /\b(?:not|n't|never|no|nothing|without)\b/i;
const MODAL_FUTURE = /^(?:(?:i|we)(?:'ll| will| would| can| could| shall| should| may| might| must| need to| have to| am going to| 'm going to))\b/i;

/** Past-tense phrase from a leading verb: "Rolling back the hold timers on X now" -> "rolled back the hold timers on X". */
export function pastPhrase(lv: LeadingVerb): string {
  const rest = lv.rest.replace(/[.!\s]+$/, '').replace(/\s+(?:now|right now|there|just now)$/i, '');
  const particle = lv.entry.particle ? ` ${lv.entry.particle}` : '';
  return `${lv.entry.past}${particle}${rest ? ' ' + rest : ''}`.trim();
}

/**
 * Does this sentence report that someone performed (or is performing) an action? Handles first-person past ("I replaced X"),
 * elided past ("Replaced X"), bare progressive ("Rolling back X now"), "<Name> replaced X" and "<thing> replaced" shorthand.
 * Intent, negation, modals and passive reports of someone else's work are not performed readings.
 */
export function readPerformed(sentence: string, cfg: ExtractionConfig, participantFirstNames: string[]): PerformedReading | undefined {
  const lang = cfg.language;
  let s = sentence.trim().replace(/^(?:and|then|so|ok|okay|well|also|but)[,\s]+/i, '');
  // a short label before a colon ("For the handover: Aarne replaced X") is not part of the statement
  s = s.replace(/^[\p{L}][\p{L} ]{2,30}:\s+(?=\S)/u, '');
  if (!s || /\?\s*$/.test(s)) return undefined;
  if (MODAL_FUTURE.test(s) || NEG.test(s.split(/[,;]/)[0]!)) return undefined;
  // <Name> <verb>
  let performerName: string | undefined;
  const nm = /^([A-ZÄÖÅ][\p{L}'-]+)\s+(.*)$/su.exec(s);
  if (nm && participantFirstNames.some((n) => n.toLowerCase() === nm[1]!.toLowerCase())) {
    const lv = leadingVerb(nm[2]!, lang, ['past']);
    if (lv) { performerName = nm[1]!; s = nm[2]!; }
  }
  const first = /^(?:i|we)(?:'ve| have| had| just| already| also| then| now| finally)*\s+(.*)$/is.exec(s);
  if (first) s = first[1]!;
  const prog = /^(?:i'?m|i am|we'?re|we are)\s+(.*)$/is.exec(s);
  const asProgressive = !!prog;
  if (prog) s = prog[1]!;
  const lv = leadingVerb(s, lang, ['past', 'ing']);
  // "<Verb> done on both ends": a completion marker after a bare past verb reports the work as finished by the speaker (the
  // object stays implicit and is resolved from the advice it follows).
  if (lv && lv.tense === 'past' && !first && !performerName) {
    const done = /^(?:done|completed?|finished)\b[\s,]*(.*)$/is.exec(lv.rest);
    if (done) return { verb: lv.entry, tense: 'past', past: pastPhrase({ ...lv, rest: done[1]! }), object: '' };
  }
  if (lv && lv.tense === 'past' && !lv.rest && !lv.entry.particle && !first && !performerName) {
    // a bare past-tense word alone ("Cleaned.") has no object: not enough to report an action
    return undefined;
  }
  // "installed around 2019", "installed in March": a state with a time, not something done now
  if (lv && lv.tense === 'past' && /^(?:around|about|in|since|from|during|back in|roughly|approximately|(?:19|20)\d\d\b)/i.test(lv.rest)) return undefined;
  if (lv && (lv.tense === 'past' || lv.tense === 'ing')) {
    if (lv.tense === 'ing' && !asProgressive && /\b(?:to|will|would|should|could)\b/i.test(lang.intent.exec(sentence)?.[0] ?? '')) return undefined;
    return { ...(performerName ? { performerName } : {}), verb: lv.entry, tense: lv.tense, past: pastPhrase(lv), object: objectPhrase(lv.rest, lang) };
  }
  // "<thing> <past participle>" shorthand without an auxiliary ("Filter changed on X", "Card reseated."): the author reports their own work
  const short = /^((?:the |a |an )?[\p{L}0-9][\p{L}0-9.\- ]{0,30}?)\s+([\p{L}]+)\b(?=\s*(?:[,;.]|$|\bon\b|\bat\b|\bwith\b|\bfor\b|\band\b))/iu.exec(s);
  if (short && !/\b(?:was|were|been|is|are|has|have|had|am|be)\b/i.test(short[1]!) && short[1]!.trim().split(/\s+/).length <= 4) {
    const lv2 = leadingVerb(short[2]!, lang, ['past']);
    const subj = short[1]!.replace(/^(?:the|a|an)\s+/i, '').trim();
    if (lv2 && !leadingVerb(short[1]!, lang, ['past', 'ing']) && !lang.states.problemNouns.test(subj) && !lang.administrative.test(subj)) {
      return { verb: lv2.entry, tense: 'past', past: `${lv2.entry.past} ${subj}`, object: subj };
    }
  }
  return undefined;
}

/** Object words after a verb, up to the first preposition/conjunction/punctuation, with filler removed. */
export function objectPhrase(rest: string, lang: LanguageConfig): string {
  const cut = rest.split(/\s+(?:on|at|in|to|from|with|by|of|and|but|so|because|which|that|when|while|before|after|since|until|as|if)\b|[,;!:]|\.(?=\s|$)/i)[0] ?? '';
  const toks = cut.trim().split(/\s+/).filter(Boolean);
  const out: string[] = [];
  for (const t of toks) {
    if (lang.objectFiller.test(t)) { if (out.length) break; continue; }
    out.push(t);
    if (out.length >= 3) break;
  }
  return out.join(' ');
}

const singular = (w: string): string => (/(?:ss|us|is)$/i.test(w) ? w : /ies$/i.test(w) ? w.slice(0, -3) + 'y' : /(?:ches|shes|xes|ses)$/i.test(w) ? w.slice(0, -2) : /s$/i.test(w) ? w.slice(0, -1) : w);

/** "the hold timer rollback", "the optic replacement": the anchor outcomes refer back to ("after ..."). */
export function anchorPhrase(p: PerformedReading, lang: LanguageConfig): string {
  const nominal = lang.nominals[p.verb.base] ?? p.verb.ing;
  const words = p.object.split(/\s+/).filter(Boolean);
  if (words.length) words[words.length - 1] = singular(words[words.length - 1]!);
  return `the ${[...words, nominal].join(' ')}`.replace(/\s+/g, ' ');
}

/** Generic action name for a performed action no lexicon entry covers: "<object head>.<verb>". */
export function genericActionName(p: PerformedReading): string | undefined {
  const words = p.object.split(/\s+/).filter((w) => /[a-z]/i.test(w) && !/^v?\d+(?:\.\d+)+$/i.test(w));
  const head = words.at(-1);
  // no noun to name the action after ("changed it"): only a version-like object ("installed 11.2.1") is specific enough
  if (!head) return /\d+(?:\.\d+)+/.test(p.object) ? p.verb.base.replace(/\s+/g, '-') : undefined;
  return head ? `${singular(head.toLowerCase()).replace(/[^a-z0-9.]/g, '')}.${p.verb.base.replace(/\s+/g, '-')}` : undefined;
}

/** Remove comparison clauses that point at another asset ("same as ACC-12 last week", "like on X"): they are references, not the claim. */
export function stripReferenceClauses(s: string, cfg: ExtractionConfig): string {
  const cue = cfg.language.referenceCue.source.replace(/\$$/, '');
  const asset = cfg.assetIdPatterns.map((p) => `(?:${p.source})`).join('|');
  if (!asset) return s;
  const re = new RegExp(`[,;]?\\s*${cue}(?:${asset})(?:\\s+(?:last|this|next|every|each)\\s+\\p{L}+)?`, 'giu');
  return s.replace(re, '').replace(/\s{2,}/g, ' ').replace(/\s+([,.;])/g, '$1').trim();
}

/** Strip a leading vocative ("Lauri, ...") and discourse markers ("Yes, ...", "OK so ...") from a sentence. */
export function cleanSentence(t: string, cfg: ExtractionConfig, names: string[]): string {
  let s = t.trim();
  for (let i = 0; i < 3; i++) {
    const before = s;
    const voc = /^([A-ZÄÖÅ][\p{L}'-]+),\s+(?=\S)/su.exec(s);
    if (voc && names.some((n) => n.toLowerCase() === voc[1]!.toLowerCase())) s = s.slice(voc[0].length);
    s = s.replace(/^(?:hi|hello|hey)\s+[\p{L}'-]+[,!]?\s+/iu, '');
    const dm = cfg.language.discourseMarkers.exec(s);
    if (dm && dm[0].length < s.length) s = s.slice(dm[0].length);
    if (s === before) break;
  }
  return s.trim();
}

export const firstNameOf = (display: string): string => display.trim().split(/\s+/)[0] ?? display;

// ------------------------------------------------------------------------------------------------ outcome states

const re = (r: RegExp): RegExp => new RegExp(r.source, r.flags.replace('g', ''));

/** Generic outcome-state classifier: recovered / no-change / worse / partial / unknown, plus whether the problem is described as recurring. */
export function classifyOutcomeState(sentence: string, cfg: ExtractionConfig): OutcomeDetail | undefined {
  const t = sentence;
  const st: OutcomeStateLexicon = cfg.language.states;
  const stillPositive = /\bstill\s+(?:up|good|stable|steady|clean|fine|ok|okay|healthy|normal|working)\b/i.test(t);
  const recurrence = (re(cfg.outcomeRecurred).test(t) || (re(st.recurrence).test(t) && re(st.problemNouns).test(t))) && !/\b(?:registering|working|works|up|flowing|passing|stable)\s+again\b/i.test(t);
  if (recurrence && !stillPositive) return { result: 'no-change', recurred: true };
  if (re(cfg.outcomeWorse).test(t) || re(st.worse).test(t)) return { result: 'worse', recurred: false };
  if (re(st.partial).test(t)) return { result: 'partial', recurred: false };
  if (!stillPositive && (re(cfg.outcomeNoChange).test(t) || re(st.noChange).test(t))) return { result: 'no-change', recurred: false };
  const negated = /\b(?:not|n't|never|no longer)\b[^.]{0,15}\b(?:back|working|resolved|fixed|recovered|stable|steady|up)\b/i.test(t);
  if (!negated && (re(cfg.outcomeRecovered).test(t) || re(st.recovered).test(t))) return { result: 'recovered', recurred: false };
  return undefined;
}

/**
 * Does a problem statement say the problem is back / new ("down again", "the alarm came back", "another problem")?
 * Conditionals ("if it comes back ...") and positive states ("working again", "traffic is back") do not.
 */
export function recurrenceOf(statement: string, cfg: ExtractionConfig): boolean {
  const t = statement;
  if (/\b(?:if|whenever|unless|in case|should it)\b/i.test(t)) return false;
  if (new RegExp(cfg.newProblem.source, 'i').test(t)) return true;
  const positive = /\b(?:registering|registered|working|works|up|flowing|passing|stable|steady|clean|fine|normal|online|reachable)\s+again\b/i;
  if (new RegExp(cfg.language.recurrenceCue.source, 'i').test(t) && !positive.test(t) && !/\bnot\b[^.]{0,20}\bagain\b/i.test(t)) return true;
  return new RegExp(cfg.language.comeBackCue.source, 'i').test(t) && new RegExp(cfg.language.states.problemNouns.source, 'i').test(t);
}
