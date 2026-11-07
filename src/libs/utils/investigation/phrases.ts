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
  contributionOrder: ['performed-action', 'reported-outcome', 'advised', 'performed-check', 'reported-problem', 'observed-condition', 'mentioned'],
  maxTextLength: 140,
};

const lastWordEnding = (verb: string): string => (verb.endsWith('e') && !verb.endsWith('ee') ? `${verb.slice(0, -1)}ing` : `${verb}ing`);
const pastOf = (verb: string): string => (verb.endsWith('e') ? `${verb}d` : `${verb}ed`);

/** Humanized fallback for an action name without a configured phrase: "cable.replace" -> "replace the cable". */
function fallbackPhrase(action: string): ActionPhrase {
  const parts = action.split(/[._-]/).filter(Boolean);
  if (parts.length >= 2) {
    const verb = parts[parts.length - 1] as string;
    const obj = parts.slice(0, -1).join(' ');
    return { imperative: `${verb} the ${obj}`, gerund: `${lastWordEnding(verb)} the ${obj}`, noun: `the ${obj} ${verb}`, past: `${pastOf(verb)} the ${obj}` };
  }
  const w = parts[0] ?? 'action';
  return { imperative: w, gerund: lastWordEnding(w), noun: `the ${w}`, past: pastOf(w) };
}

export const actionPhrase = (action: string, p: Pick<PhraseSettings, 'actions'>): ActionPhrase => p.actions[action] ?? fallbackPhrase(action);

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
  return /^[A-Z][a-z]/.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}

/** "older unit revision (this problem: newer unit)" -> "older unit revision there, newer unit here". */
export function conflictInWords(label: string, hedgeMarkers: string[] = []): string {
  const m = /^(.*) \(this problem: (.*)\)$/.exec(label);
  if (!m) return plainLabel(label, hedgeMarkers);
  return `${plainLabel(m[1] as string, hedgeMarkers)} there, ${plainLabel(m[2] as string, hedgeMarkers)} here`;
}

export const withArticle = (word: string): string => (/^[aeiou]/i.test(word) ? `an ${word}` : `a ${word}`);

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
