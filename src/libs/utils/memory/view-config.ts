import type { Condition } from '../contracts/index.ts';

/** A fragment of a short case label, chosen by the first rule whose condition matches. */
export interface SymptomPhrase {
  key: string;
  /** Matches when the condition value equals one of these (any value when omitted). */
  values?: Array<string | number | boolean>;
  phrase: string;
}

export interface ChangePhrase {
  key: string;
  /** Builds "after ..." text from the condition and the sentence it came from. */
  build(condition: Condition, statement: string): string | undefined;
}

export interface ConditionMerge {
  /** Condition key whose label is extended. */
  base: string;
  /** Condition key whose value is folded into the base label as a parenthetical. */
  extra: string;
  format(baseLabel: string, extra: Condition): string;
}

/**
 * Presentation vocabulary for case views and short case labels. Everything domain-specific lives here
 * (like extraction-config.ts); organizations pass their own through `buildCaseView(..., config)`.
 */
export interface ViewConfig {
  /** canonical action name -> human noun phrase ("interface reset"). Unlisted names are humanized. */
  actionLabels: Record<string, string>;
  /** canonical action name -> short past-tense phrase for conditions ("SFP replaced"). */
  actionPast: Record<string, string>;
  /** Symptom phrases for the short label, in priority order. */
  symptoms: SymptomPhrase[];
  /** Preceding-change phrases for the short label ("after SFP change"). */
  changes: ChangePhrase[];
  /** Words dropped when the label falls back to the problem sentence. */
  summaryStopwords: RegExp;
  /** Conditions folded together for display ("Older unit (installed around 2019)"). */
  conditionMerges: ConditionMerge[];
  /** Condition keys not repeated as conditions (they only restate the problem). */
  hiddenConditionKeys: string[];
  /** Lower-case words restored to upper case in fallback summaries ("bgp" -> "BGP"). */
  acronyms: string[];
  /** Max words in the label's summary part. */
  summaryWords: number;
}

const upperToken = (v: string): string => (v.length <= 4 ? v.toUpperCase() : v);

export const defaultViewConfig: ViewConfig = {
  actionLabels: {
    'interface.reset': 'interface reset',
    'counters.check': 'counter check',
    'sfp.replace': 'SFP replacement',
    'device.reboot': 'reboot',
    'power.cycle': 'power cycle',
    'optics.check': 'optics check',
    'logs.check': 'log check',
    'config.rollback': 'configuration rollback',
    'config.change': 'configuration change',
    'session.reset': 'session reset',
    'cable.replace': 'cable replacement',
    'site.visit': 'site visit',
  },
  actionPast: {
    'sfp.replace': 'SFP replaced',
    'cable.replace': 'Cable replaced',
    'interface.reset': 'Interface reset',
    'device.reboot': 'Unit rebooted',
    'power.cycle': 'Unit power cycled',
    'config.rollback': 'Configuration rolled back',
    'config.change': 'Configuration changed',
  },
  symptoms: [
    { key: 'bgp.session', values: ['flapping'], phrase: 'BGP flapping' },
    { key: 'bgp.session', values: ['down'], phrase: 'BGP down' },
    { key: 'traffic.state', values: ['absent'], phrase: 'no traffic' },
    { key: 'traffic.counters', values: ['zero'], phrase: 'no traffic' },
    { key: 'power.state', values: ['unstable', 'outage'], phrase: 'power problem' },
    { key: 'temperature.state', values: ['high'], phrase: 'high temperature' },
    { key: 'interface.status', values: ['down'], phrase: 'interface down' },
  ],
  changes: [
    { key: 'component.replaced', build: (c) => (c.value === undefined ? undefined : `after ${upperToken(String(c.value))} change`) },
    {
      key: 'config.changed',
      build: (_c, statement) => {
        const m = /\b(firmware|software)?\s*(update|upgrade|config(?:uration)? change|rollout)\b/i.exec(statement);
        return m ? `after ${[m[1], m[2]].filter(Boolean).join(' ').toLowerCase()}` : 'after a change';
      },
    },
  ],
  summaryStopwords: /^(?:a|an|the|is|are|was|were|has|have|had|been|be|keeps?|kept|again|same|with|of|on|in|at|to|for|from|by|and|or|but|so|that|this|it|its|we|i|our|my|since|hi|hello|fyi|as|there)$/i,
  conditionMerges: [
    { base: 'unit.age', extra: 'unit.installed_year', format: (base, extra) => `${base} (installed around ${String(extra.value)})` },
  ],
  hiddenConditionKeys: [],
  acronyms: ['bgp', 'sfp', 'dc', 'ac', 'rf', 'crc', 'vlan', 'psu', 'olt', 'lan', 'wan', 'ip', 'dns'],
  summaryWords: 6,
};

const sentenceCase = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

/** "interface.reset" -> "interface reset" (configured), unknown dotted names are humanized. */
export function humanAction(name: string, cfg: ViewConfig = defaultViewConfig): string {
  return cfg.actionLabels[name] ?? name.replace(/[._-]+/g, ' ').trim();
}

/** Short past-tense phrase used inside the conditions node ("SFP replaced"). */
export function pastAction(name: string, cfg: ViewConfig = defaultViewConfig): string {
  return cfg.actionPast[name] ?? sentenceCase(`${humanAction(name, cfg)} performed`);
}

/** Strips legacy display suffixes from stored labels; hedging is carried by origin/statement instead. */
export function plainLabel(label: string): string {
  return label.replace(/\s*\((?:hedged in source)\)\s*$/i, '').replace(/^Interface (UP|DOWN)$/, (_m, v: string) => `Interface ${v.toLowerCase()}`).trim();
}

export const conditionText = (c: Condition): string => plainLabel(c.label ?? `${c.key}=${String(c.value)}`);

