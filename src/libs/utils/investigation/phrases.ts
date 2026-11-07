import type { Case, Condition, KnowledgeStore, PersonWorkLink } from '../contracts/index.ts';

/** Several grammatical forms of one action, so sentences read naturally in any position. */
export interface ActionPhrase {
  /** "check the traffic counters" */
  imperative: string;
  /** "checking the traffic counters" */
  gerund: string;
  /** "the traffic counter check" */
  noun: string;
  /** "checked the traffic counters" */
  past: string;
}

export interface PersonVerbTemplate {
  /** Used when the action of the case is known. {action} = noun form, {case} = short case label. */
  withAction: string;
  withoutAction: string;
}

/** Wording configuration for human-readable text. Organizations replace or extend it; nothing here is logic. */
export interface PhraseSettings {
  /** Action name -> grammatical forms; unknown actions fall back to a humanized form of the dotted name. */
  actions: Record<string, ActionPhrase>;
  /** Action name -> verb phrase for a reported recovery ("restored traffic"); fallback "helped". */
  recoveries: Record<string, string>;
  /** "key=value" -> how a current condition reads inside a sentence ("the interface is up"). Unlisted conditions are skipped. */
  conditions: Record<string, string>;
  /** Contribution -> sentence template for the people list. */
  contributions: Record<PersonWorkLink['contribution'], PersonVerbTemplate>;
  /** Template for a person who both performed an action and reported its outcome. */
  performedAndRecovered: PersonVerbTemplate;
  performedAndReported: PersonVerbTemplate;
  /** Contributions in the order they are shown when a person has more than a few reasons (most informative first). */
  contributionOrder: Array<PersonWorkLink['contribution']>;
  /** Maximum characters of Recommendation.text (the heading). */
  maxTextLength: number;
  /**
   * Action name -> words that show, when one of them appears in the case's own evidence text, that the action really is
   * what that evidence describes. Unlisted actions are checked against the words of their own name ("counters.check" ->
   * "counter"). An action the evidence never mentions is worded neutrally (`unverifiedAction`) instead of by its label.
   */
  actionEvidenceTerms?: Record<string, string[]>;
  /** Neutral wording for an action whose label the case's evidence does not support. */
  unverifiedAction?: ActionPhrase;
}

export const DEFAULT_PHRASES: PhraseSettings = {
  actions: {
    'interface.reset': { imperative: 'disable and re-enable the interface', gerund: 'disabling and re-enabling the interface', noun: 'the interface reset', past: 'reset the interface' },
    'counters.check': { imperative: 'check the traffic counters', gerund: 'checking the traffic counters', noun: 'the traffic counter check', past: 'checked the traffic counters' },
    'optics.check': { imperative: 'check the optical levels', gerund: 'checking the optical levels', noun: 'the optical check', past: 'checked the optical levels' },
    'logs.check': { imperative: 'check the logs', gerund: 'checking the logs', noun: 'the log check', past: 'checked the logs' },
    'sfp.replace': { imperative: 'replace the SFP', gerund: 'replacing the SFP', noun: 'the SFP replacement', past: 'replaced the SFP' },
    'device.reboot': { imperative: 'reboot the unit', gerund: 'rebooting the unit', noun: 'the reboot', past: 'rebooted the unit' },
    'power.cycle': { imperative: 'power-cycle the unit', gerund: 'power-cycling the unit', noun: 'the power cycle', past: 'power-cycled the unit' },
    'config.rollback': { imperative: 'roll back the config', gerund: 'rolling back the config', noun: 'the config rollback', past: 'rolled back the config' },
  },
  recoveries: { 'interface.reset': 'restored traffic', 'device.reboot': 'restored traffic' },
  conditions: {
    'interface.status=up': 'the interface is up',
    'interface.status=down': 'the interface is down',
    'traffic.counters=zero': 'counters stay at zero',
  },
  contributions: {
    'reported-problem': { withAction: 'Reported the problem in {case}', withoutAction: 'Reported the problem in {case}' },
    advised: { withAction: 'Advised {action} in {case}', withoutAction: 'Advised a response in {case}' },
    'performed-check': { withAction: 'Ran {action} in {case}', withoutAction: 'Ran a check in {case}' },
    'performed-action': { withAction: 'Performed {action} in {case}', withoutAction: 'Performed an action in {case}' },
    'reported-outcome': { withAction: 'Reported the outcome of {action} in {case}', withoutAction: 'Reported the outcome in {case}' },
    'observed-condition': { withAction: 'Observed the situation in {case}', withoutAction: 'Observed the situation in {case}' },
    mentioned: { withAction: 'Mentioned in {case} (not firsthand)', withoutAction: 'Mentioned in {case} (not firsthand)' },
  },
  performedAndRecovered: { withAction: 'Performed {action} and reported recovery in {case}', withoutAction: 'Performed an action and reported recovery in {case}' },
  performedAndReported: { withAction: 'Performed {action} and reported the outcome in {case}', withoutAction: 'Performed an action and reported the outcome in {case}' },
  actionEvidenceTerms: {
    'interface.reset': ['interface', 'port', 'shut', 're-enable', 'reenable', 'reset', 'bounce', 'toggle'],
    'counters.check': ['counter'],
    'optics.check': ['optic', 'rx power', 'light level', 'dbm'],
    'logs.check': ['log'],
    'sfp.replace': ['sfp', 'transceiver', 'optic'],
    'device.reboot': ['reboot', 'restart', 'power cycle', 'power-cycle'],
    'power.cycle': ['power cycle', 'power-cycle', 'powercycle', 'cycle the power'],
  },
  unverifiedAction: { imperative: 'repeat the earlier step', gerund: 'repeating the earlier step', noun: 'the earlier step', past: 'did the earlier step' },
  contributionOrder: ['performed-action', 'reported-outcome', 'advised', 'performed-check', 'reported-problem', 'observed-condition', 'mentioned'],
  maxTextLength: 140,
};

/** Verbs that are written as one word when used as a noun but are two words as a verb. */
const PHRASAL: Record<string, string> = { rollback: 'roll back', setup: 'set up', rollout: 'roll out', failover: 'fail over', cutover: 'cut over', backup: 'back up', shutdown: 'shut down', rerun: 're-run' };
/** One-syllable consonant-vowel-consonant verbs double the last letter ("swap" -> "swapping"). */
const doubles = (v: string): boolean => /^[^aeiou]*[aeiou][^aeiouwxy]$/.test(v);
const lastWordEnding = (verb: string): string => (verb.endsWith('e') && !verb.endsWith('ee') ? `${verb.slice(0, -1)}ing` : doubles(verb) ? `${verb}${verb.slice(-1)}ing` : `${verb}ing`);
const pastOf = (verb: string): string => (verb.endsWith('e') ? `${verb}d` : doubles(verb) ? `${verb}${verb.slice(-1)}ed` : `${verb}ed`);
const verbWords = (verb: string): { imperative: string; gerund: string; past: string } => {
  const spaced = PHRASAL[verb];
  if (!spaced) return { imperative: verb, gerund: lastWordEnding(verb), past: pastOf(verb) };
  const [first, ...rest] = spaced.split(' ') as [string, ...string[]];
  return { imperative: spaced, gerund: [lastWordEnding(first), ...rest].join(' '), past: [pastOf(first), ...rest].join(' ') };
};

/** Humanized fallback for an action name without a configured phrase: "cable.replace" -> "replace the cable". */
function fallbackPhrase(action: string): ActionPhrase {
  const parts = action.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) {
    const verb = parts[parts.length - 1] as string;
    const obj = parts.slice(0, -1).join(' ');
    const w = verbWords(verb);
    return { imperative: `${w.imperative} the ${obj}`, gerund: `${w.gerund} the ${obj}`, noun: `the ${obj} ${verb}`, past: `${w.past} the ${obj}` };
  }
  const w = parts[0] ?? 'action';
  const v = verbWords(w);
  return { imperative: v.imperative, gerund: v.gerund, noun: `the ${w}`, past: v.past };
}

export const actionPhrase = (action: string, p: Pick<PhraseSettings, 'actions'>): ActionPhrase => p.actions[action] ?? fallbackPhrase(action);

const stem = (w: string): string => w.toLowerCase().replace(/(?:ing|ed|es|s)$/, '');

/**
 * Does the case's evidence text mention this action? `evidenceText` is the lower-cased text of the evidence the viewer may
 * see; undefined means it could not be read (nothing to check against, so the action is kept as is).
 */
/** Words that show an action is meant: the configured evidence terms, else the words of its own name. */
export function actionTerms(action: string, p: Pick<PhraseSettings, 'actionEvidenceTerms'>): string[] {
  const own = action.split(/[._-]/).filter((w) => w.length > 2);
  return p.actionEvidenceTerms?.[action] ?? own.slice(0, Math.max(1, own.length - 1)).map(stem);
}

export function actionIsGrounded(action: string, evidenceText: string | undefined, p: Pick<PhraseSettings, 'actionEvidenceTerms'>): boolean {
  if (evidenceText === undefined) return true;
  const terms = actionTerms(action, p);
  return terms.some((t) => t && evidenceText.includes(t.toLowerCase()));
}

/** The phrase for an action in the context of one case: its configured wording only when the case's evidence mentions it. */
export function casePhrase(action: string, evidenceText: string | undefined, p: Pick<PhraseSettings, 'actions' | 'actionEvidenceTerms' | 'unverifiedAction'>): ActionPhrase {
  return actionIsGrounded(action, evidenceText, p) ? actionPhrase(action, p) : (p.unverifiedAction ?? DEFAULT_PHRASES.unverifiedAction as ActionPhrase);
}

export const capitalize = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Keeps a sentence within `max` characters, cutting at a word boundary. */
export function clampText(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), 20)).replace(/[,;:\s]+$/, '')}…`;
}

/**
 * A condition label in plain words: hedge/provenance suffixes removed, lower-cased unless it starts with an acronym
 * or a proper-looking token. "Installed around 2019 (hedged in source)" -> "installed around 2019".
 */
export function plainLabel(label: string, hedgeMarkers: string[] = []): string {
  let s = label.replace(/\s*\[[^\]]*\]\s*/g, ' ').trim();
  for (const m of hedgeMarkers) s = s.replace(new RegExp(`\\s*\\((?:[^()]*?${m}[^()]*?)\\)\\s*$`, 'i'), '').trim();
  // Remaining parentheses become a comma clause so the label can sit inside parentheses of its own sentence.
  s = s.replace(/\s*\(([^()]+)\)/g, ', $1').replace(/\s+/g, ' ').trim();
  return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/** "older unit revision (this problem: newer unit)" -> "older unit revision there, newer unit here". */
export function conflictInWords(label: string, hedgeMarkers: string[] = []): string {
  const m = /^(.*) \(this problem: (.*)\)$/.exec(label);
  if (!m) return plainLabel(label, hedgeMarkers);
  return `${plainLabel(m[1] as string, hedgeMarkers)} there, ${plainLabel(m[2] as string, hedgeMarkers)} here`;
}

/** "an older unit", "an N5", "an SFP", "a U2": letter-named acronyms are read by the sound of their first letter. */
export const withArticle = (word: string): string => {
  const acronym = /^[A-Z][A-Z0-9-]*\d?$/.test(word) && /[A-Z]{2}|\d/.test(word);
  const vowelSound = acronym ? /^[AEFHILMNORSX]/.test(word) : /^[aeiou]/i.test(word);
  return vowelSound ? `an ${word}` : `a ${word}`;
};

/**
 * Short, human case label: the asset id the case is about ("TRN-042"); falls back to the part of the title before a colon
 * when it is short, then to a truncated title. Never a raw case id.
 */
export function shortCaseLabel(store: Pick<KnowledgeStore, 'get'>, c: Pick<Case, 'title' | 'entityIds'>): string {
  for (const id of c.entityIds) {
    const e = store.get('entity', id);
    if (e && e.type === 'asset' && e.name.length <= 32) return e.name;
  }
  const head = c.title.split(':')[0]?.trim() ?? '';
  if (head && head.length <= 24 && head !== c.title.trim()) return head;
  return c.title.length > 40 ? `${c.title.slice(0, 39).trimEnd()}…` : c.title;
}

/** Sentence fragment for the problem's current conditions that the configuration knows how to phrase ("the interface is up and counters stay at zero"). */
export function symptomsPhrase(conditions: Condition[], p: Pick<PhraseSettings, 'conditions'>): string {
  const parts = conditions.map((c) => p.conditions[`${c.key}=${String(c.value)}`]).filter((x): x is string => !!x);
  if (parts.length === 0) return '';
  if (parts.length === 1) return parts[0] as string;
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] as string}`;
}

export const fillTemplate = (tpl: string, vars: Record<string, string>): string => tpl.replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? '');
