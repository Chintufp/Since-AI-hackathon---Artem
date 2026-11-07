import type { ActionName, ClaimType, Condition, ConditionKey } from '../contracts/index.ts';

export type CueType = 'hypothesis' | 'advice' | 'action' | 'outcome' | 'condition' | 'access-fact' | 'identity';

export interface ConditionParseResult {
  operator: Condition['operator'];
  value?: string | number | boolean;
  label: string;
}

export interface ConditionParser {
  key: ConditionKey;
  pattern: RegExp;
  build(match: RegExpExecArray): ConditionParseResult | undefined;
}

export interface ActionLexiconEntry {
  action: ActionName;
  pattern: RegExp;
}

/**
 * Everything organization- or domain-specific lives here, never in the extractor logic.
 * Another organization supplies its own patterns, aliases, lexicons and condition parsers.
 */
export interface ExtractionConfig {
  assetIdPatterns: RegExp[];
  /** canonical entity name -> aliases */
  aliases: Record<string, string[]>;
  cues: Record<Exclude<CueType, 'condition' | 'identity'>, RegExp[]> & { condition: RegExp[]; identity: RegExp[] };
  conditionParsers: ConditionParser[];
  actionLexicon: ActionLexiconEntry[];
  /** Imperative verbs that start advice ("check", "try", "don't ..."). */
  imperative: RegExp;
  /** Past-tense / completion cues for performed actions. */
  performed: RegExp;
  /** Sentences that describe general experience rather than this incident. */
  generic: RegExp[];
  /** Remarks about documentation/process, not about this incident. */
  documentation: RegExp;
  /** Words signalling a problem statement. */
  problem: RegExp;
  /** Cues that start a new problem within an incident that already has an outcome. */
  newProblem: RegExp;
  /** Max position jump inside one thread before a new problem statement starts a new incident. */
  maxSequenceGap: number;
  smallTalk: RegExp;
  /** Outcome polarity cues. */
  outcomeRecovered: RegExp;
  outcomeNoChange: RegExp;
  outcomeWorse: RegExp;
  outcomeRecurred: RegExp;
  /** Words that mark a statement as hedged (the case view flags hedged conditions from the statement; labels stay plain). */
  hedges: RegExp;
  /** Condition keys that describe a current state/reading; a sentence that yields one also counts as an observation. */
  stateConditionKeys: string[];
  /** Two non-recurrence problem statements on one asset more than this many days apart (after an outcome) are separate episodes. */
  episodeGapDays: number;
  /** After an outcome, a problem statement sharing less than this fraction of its content words with the incident so far is a different problem (new incident). */
  differentProblemOverlap: number;
  /** A write-up or follow-up with no problem statement joins the nearest timed episode only within this many days. */
  followUpDays: number;
  /** Emit an identity claim for every role a message envelope declares (default off: the role is kept as a person attribute). */
  declaredRoleClaims: boolean;
  /** Generic language lexicons: verbs, discourse, outcome states, temporal cues (see memory/README.md "Lexicon"). */
  language: LanguageConfig;
  /** B1: explicit validity and supersession cues (configuration, not logic). */
  validityCues: ValidityCueLexicon;
}

/**
 * B1: cues that say when a statement stops holding or under which condition it holds. Checked before outcome
 * classification, so "the 4.2 firmware fixes the bug" is a superseding note, not a recovery of the old case.
 */
export interface ValidityCueLexicon {
  /** A fix shipped in a version ("fixed in firmware 4.2", "the 4.2 firmware fixes ..."). Named group `version`. */
  fixedInVersion: RegExp[];
  /** Condition key, operator and label of the bound a fixed-in-version note carries ({version} is replaced). */
  fixedBound: { key: string; operator: Condition['operator']; label: string; conditionText: string };
  /** Claim types a fixed-in-version note bounds (older claims of these types on the same subject get validity.condition). */
  boundTypes: ClaimType[];
  /** Replacement cues ("is now", "no longer", "new code since", "changed the lock"): mark a claim as replacing an older value. */
  replaces: RegExp;
  /** A recurring change ("every October", group `when`): message-level, lands on the nearest preceding access fact. */
  recurring: RegExp;
  /** "until 1 December" (group `to`) and "from 3 November to 1 December" (groups `from`, `to`): a stated end (date-only, never dated by us). */
  until: RegExp;
  range: RegExp;
  /** An access code on an access-fact sentence: groups `kind` (barrier, lockbox ...) and `code` (digits). */
  accessCode: RegExp;
  /** Condition keys whose newer value closes an older one (the newer-value rule). State readings are not listed. */
  newerValueKeys: string[];
  /**
   * B1 part B: a person's own stated absence ("I am on leave from 3 November to 1 December", groups `from`, `to`). Read on
   * demand from evidence the person authored (never stored as a claim), to say "back 1 Dec" next to an unavailable person.
   */
  leave?: RegExp;
}

const DATE_WORDS = String.raw`(?:\d{1,2}\.?\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*(?:\s+\d{4})?|(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+\d{1,2}(?:,?\s+\d{4})?|\d{4}-\d{2}-\d{2})`;

export const defaultValidityCues: ValidityCueLexicon = {
  fixedInVersion: [
    /\b(?:fixed|resolved|solved)\s+(?:in|by|with|since)\s+(?:the\s+)?(?:firmware|software|fw|release|version)\s*v?(?<version>\d+(?:\.\d+)+)/i,
    /\b(?<version>\d+(?:\.\d+)+)\s+(?:firmware|software|fw|release)\s+(?:fixes|fixed|resolves|resolved|solves|solved)\b/i,
    /\b(?:firmware|software|fw|release|version)\s*v?(?<version>\d+(?:\.\d+)+)\s+(?:fixes|fixed|resolves|resolved|solves|solved)\b/i,
  ],
  fixedBound: { key: 'software.version', operator: 'gte', label: 'Fixed in software version {version}', conditionText: 'software.version < {version}' },
  boundTypes: ['hypothesis', 'advice'],
  replaces: /\b(?:is now|are now|no longer|new code since|new code from|changed the lock|changed the code|has changed|have changed|replaced by)\b/i,
  recurring: /\bevery\s+(?<when>january|february|march|april|may|june|july|august|september|october|november|december)\b/i,
  until: new RegExp(String.raw`\buntil\s+(?<to>${DATE_WORDS})`, 'i'),
  range: new RegExp(String.raw`\bfrom\s+(?<from>${DATE_WORDS})\s+(?:to|until|till)\s+(?<to>${DATE_WORDS})`, 'i'),
  accessCode: /\b(?<kind>barrier|gate|lockbox|lock\s*box|key\s*box|door|hatch|access)\s+code\b(?:\s+(?:at|for|on)\s+[\p{L}\p{N}-]+)?\s*(?:(?:is|was)\s+(?:now\s+)?|[:=]\s*)?(?<code>\d{3,8})\b/iu,
  newerValueKeys: ['site.access_code', 'software.version'],
  leave: new RegExp(String.raw`\b(?:i\s+am|i'm|i\s+will\s+be|will\s+be)\s+(?:on\s+(?:leave|holiday|vacation)|away|out\s+of\s+office)\s+(?:from\s+(?<from>${DATE_WORDS})\s+)?(?:to|until|till)\s+(?<to>${DATE_WORDS})`, 'i'),
};

/** Cue sets for the generic outcome-state classifier. Every entry is a generic phrase pattern, never a sentence from a data set. */
export interface OutcomeStateLexicon {
  /** Nouns for something going wrong; with a recurrence cue they mean the problem is back. */
  problemNouns: RegExp;
  /** The problem came back / happened again (needs a problemNoun nearby or an explicit recurrence phrase). */
  recurrence: RegExp;
  worse: RegExp;
  /** Better but not fully: improvement words with a limit. */
  partial: RegExp;
  /** The fix did not change the situation, or the bad state continues ("still dropping"). */
  noChange: RegExp;
  /** Positive states and absence-of-problem phrases. */
  recovered: RegExp;
}

export interface LanguageConfig {
  /** Base forms of operations verbs (multi-word allowed: "roll back"). Used to detect performed/advised actions in any tense. */
  verbs: string[];
  /** base form -> past form for irregular verbs. */
  irregularPast: Record<string, string>;
  /** base form -> noun used in "after the <object> <noun>" anchors; fallback is the -ing form. */
  nominals: Record<string, string>;
  /** Words skipped when finding the object of an action ("the", "a clean", "both"). */
  objectFiller: RegExp;
  /** Leading discourse markers removed from normalized statements. */
  discourseMarkers: RegExp;
  /** Aside markers: the rest of the message is off-topic. */
  asideCue: RegExp;
  /** Text immediately before an asset id that makes it a reference ("same as", "like on"), not the subject of the message. */
  referenceCue: RegExp;
  /** Intent / acknowledgement phrases that are not performed actions. */
  intent: RegExp;
  /** Problem recurred / happened again (episode boundary, "recurred" lasting). */
  recurrenceCue: RegExp;
  /** "came back" / "is back": a recurrence only when a problem noun is in the sentence ("the alarm is back", not "traffic is back"). */
  comeBackCue: RegExp;
  /** A period of a day or longer ("for three days", "next morning"): evidence of lasting, not an immediate check. */
  longDuration: RegExp;
  /** Hedge clause markers that start a hypothesis inside an advice sentence ("I suspect it ..."). */
  hedgeClause: RegExp;
  /** Closure phrases ("we can close the ticket"): not a new claim about the incident state. */
  closure: RegExp;
  /** Objects that are paperwork or communication, not equipment ("ticket raised"): not an operations action. */
  administrative: RegExp;
  /** Questions that ask for a reading or status (their answers are observations); other answers are conditions. */
  readingQuestion: RegExp;
  /** Phrases that rule a cause out; they merge into the next hypothesis in the same message. */
  exclusion: RegExp;
  /** Explicit recovery words (a sentence with one is an outcome after an attempt even when it names no problem topic). */
  strongRecovery: RegExp;
  states: OutcomeStateLexicon;
}

const v = (value: string): ConditionParseResult['value'] => value;

export const defaultConditionParsers: ConditionParser[] = [
  {
    key: 'interface.status',
    pattern: /\b(?:link|interface|port)(?:\s+status)?\s*(?:=|:|is|are|stays|remains)?\s*(up|down)\b/i,
    build: (m) => ({ operator: 'eq', value: v(m[1]!.toLowerCase()), label: `Interface ${m[1]!.toLowerCase()}` }),
  },
  {
    key: 'optical.level',
    pattern: /\b(?:rx|optical|optics|light)(?:\s+(?:power|levels?))?\s*(?:=|:|looks?|is|are|seems?)?\s*(normal|ok|okay|fine|good|low|weak|high)\b/i,
    build: (m) => {
      const w = m[1]!.toLowerCase();
      const value = ['low', 'weak'].includes(w) ? 'low' : w === 'high' ? 'high' : 'normal';
      return { operator: 'eq', value, label: `Optical level ${value}` };
    },
  },
  {
    key: 'traffic.counters',
    pattern: /\bcounters?\b[^.;\n]{0,25}?\b(zero|0|increasing|rising|stuck)\b/i,
    build: (m) => {
      const w = m[1]!.toLowerCase();
      const value = w === 'increasing' || w === 'rising' ? 'increasing' : 'zero';
      return { operator: 'eq', value, label: `Traffic counters ${value}` };
    },
  },
  {
    key: 'alarms.state',
    pattern: /\balarms?\b[^.,;\n]{0,12}?\b(cleared|clear|active|raised)\b/i,
    build: (m) => {
      const value = /clear/i.test(m[1]!) ? 'cleared' : 'active';
      return { operator: 'eq', value, label: `Alarms ${value}` };
    },
  },
  {
    key: 'traffic.state',
    pattern: /\b(no traffic|traffic\s+(?:is\s+)?(?:still\s+)?not\s+(?:coming back|flowing|passing|recovering))\b/i,
    build: () => ({ operator: 'eq', value: 'absent', label: 'Traffic absent' }),
  },
  {
    key: 'unit.age',
    pattern: /\b(older|old|newer|new)\s+(?:units?|equipment|models?)\b/i,
    build: (m) => {
      const value = /^old/i.test(m[1]!) ? 'older' : 'newer';
      return { operator: 'eq', value, label: `${value === 'older' ? 'Older' : 'Newer'} unit` };
    },
  },
  {
    // B5: a stated production batch of the 2020s ("the 2021 batch"). Restricted to 202x on purpose: the synthetic TRN-117
    // thread asks "Is this one from the 2019 batch?", and answers are per condition key, so a 2019 value there would let
    // one batch answer flip both experts' branches (DECISIONS-disagree.md D-B5-03).
    key: 'unit.batch',
    // A negated or hedged batch states nothing (D-B5-16), the same lookbehind as the problem parser's unit-batch rule.
    pattern: /(?<!\b(?:not|whether|if|unsure|maybe|perhaps|might)\b[^.;?\n]{0,25})\b(202\d)\s+batch\b/i,
    build: (m) => ({ operator: 'eq', value: m[1]!, label: `${m[1]} batch` }),
  },
  {
    key: 'unit.installed_year',
    pattern: /\binstalled\b[^.;\n]{0,15}?\b((?:19|20)\d{2})\b/i,
    build: (m) => ({ operator: 'eq', value: Number(m[1]), label: `Installed around ${m[1]}` }),
  },
  {
    key: 'component.replaced',
    pattern: /\b(?:chang|replac|swapp)\w*\s+(?:the\s+|a\s+)?(sfp|fan|psu|power supply|optic\w*|optical module|transceiver|cable)\b/i,
    build: (m) => {
      const w = m[1]!.toLowerCase();
      const value = /sfp|optic|module|transceiver/.test(w) ? 'sfp' : w === 'power supply' ? 'psu' : w;
      return { operator: 'eq', value, label: `${value.toUpperCase()} replaced` };
    },
  },
  {
    key: 'bgp.session',
    pattern: /\bbgp\b[^.;\n]{0,30}?\b(flapping|down|established|up)\b/i,
    build: (m) => {
      const w = m[1]!.toLowerCase();
      const value = w === 'established' ? 'up' : w;
      return { operator: 'eq', value, label: `BGP session ${value}` };
    },
  },
  {
    key: 'software.version',
    pattern: /\b(?:firmware|software|fw|version)\s*v?(\d+(?:\.\d+)+[\w-]*)/i,
    build: (m) => ({ operator: 'eq', value: m[1]!, label: `Software version ${m[1]}` }),
  },
  {
    key: 'config.changed',
    pattern: /\b(?:after|since|following)\b[^.;\n]{0,20}?\b(?:firmware|software)?\s*(update|upgrade|config(?:uration)? change|rollout)\b/i,
    build: (m) => ({ operator: 'eq', value: true, label: `Recent change (${m[1]!.toLowerCase()})` }),
  },
];

export const defaultActionLexicon: ActionLexiconEntry[] = [
  { action: 'interface.reset', pattern: /(?:\bdisabl\w*|\bshut\w*)\b.{0,60}?\b(?:enabl\w*|no shut\w*)|\b(?:bounc\w*|toggl\w*|reset\w*)\b.{0,30}\binterface|\binterface\b.{0,30}\b(?:bounc\w*|toggl\w*|reset\w*)/i },
  { action: 'power.cycle', pattern: /\bpower[- ]?cycl\w*/i },
  { action: 'device.reboot', pattern: /\b(?:reboot\w*|restart\w*)\b/i },
  { action: 'sfp.replace', pattern: /\b(?:replac\w*|chang\w*|swap\w*)\b.{0,25}?\b(?:sfp|optic\w*|optical module|transceiver)\b/i },
  { action: 'cable.replace', pattern: /\b(?:replac\w*|chang\w*|swap\w*)\b.{0,15}?\bcable/i },
  { action: 'config.rollback', pattern: /\b(?:roll(?:ed|ing)?\s?back|revert\w*)\b/i },
  { action: 'counters.check', pattern: /\b(?:check\w*|verify\w*|look\w* at|inspect\w*)\b.{0,40}?\bcounters?\b/i },
  { action: 'optics.check', pattern: /\b(?:check\w*|verify\w*|inspect\w*)\b.{0,30}?\b(?:optic\w*|rx power|light levels?)\b/i },
  { action: 'logs.check', pattern: /\b(?:check\w*|read\w*|review\w*|look\w* (?:at|in)|inspect\w*)\b.{0,30}?\blogs?\b/i },
  { action: 'config.change', pattern: /\b(?:set|increase|raise|lower|configure|change)\b.{0,30}?\b(?:timers?|config\w*|settings?|parameters?|router[- ]?id)\b/i },
  { action: 'session.reset', pattern: /\bclear\w*\b.{0,20}?\b(?:sessions?|neighbou?rs?)\b|\breset\w*\b.{0,15}\bbgp\b/i },
  // B5: "Clear the forwarding table" / "Cleared the forwarding table" (advice and attempt get the same action, so the
  // adviser is credited with it).
  { action: 'table.clear', pattern: /\b(?:clear\w*|flush\w*)\b.{0,25}?\bforwarding[- ]table\b/i },
  { action: 'site.visit', pattern: /\b(?:visit\w*|drive out|go(?:ing)? to (?:the )?site)\b/i },
];

const IMPERATIVE_VERBS =
  "set|clear|configure|increase|raise|lower|check|try|disable|enable|replace|reboot|restart|reset|verify|look|inspect|make sure|ensure|clean|roll ?back|revert|swap|power[- ]?cycle|wait|don'?t|do not|never|avoid|read|review|bounce|toggle|contact|call|ask";

/** Generic operations verbs (base forms). Organizations add their own; nothing here is specific to one incident family. */
const DEFAULT_VERBS = [
  'replace', 'swap', 'change', 'roll back', 'rollback', 'revert', 'reset', 'reboot', 'restart', 'clean', 'check', 'install', 'apply', 'set', 'raise',
  'increase', 'lower', 'decrease', 'disable', 'enable', 'clear', 'fit', 'reroute', 'patch', 'upgrade', 'downgrade', 'tighten', 'reseat', 'remove', 'add',
  'fix', 'update', 'configure', 'reconfigure', 'test', 'verify', 'inspect', 'reload', 'restore', 'reconnect', 'adjust', 'move', 'bypass', 'power cycle',
  'switch', 'plug', 'unplug', 'bounce', 'toggle', 'shut', 'rebuild', 'flush', 'drain', 'redress', 're-dress', 'rewire', 'repair', 'secure', 'escalate',
  'wipe', 'refit', 'recalibrate', 'realign', 'extend', 'shorten', 'insert', 'detach', 'attach', 'tune', 'throttle', 'cap', 'monitor', 'watch',
];

export const defaultLanguage: LanguageConfig = {
  verbs: DEFAULT_VERBS,
  irregularPast: { set: 'set', reset: 'reset', 'shut': 'shut', 'cut': 'cut', 'put': 'put', 'run': 'ran', 'fit': 'fitted', 'plug': 'plugged', 'unplug': 'unplugged', 'cap': 'capped', 'wipe': 'wiped', 'rebuild': 'rebuilt', 'build': 'built' },
  nominals: {
    replace: 'replacement', swap: 'swap', 'roll back': 'rollback', rollback: 'rollback', revert: 'revert', reset: 'reset', reboot: 'reboot', restart: 'restart',
    clean: 'cleaning', check: 'check', install: 'installation', apply: 'application', upgrade: 'upgrade', downgrade: 'downgrade', patch: 'patch', 'power cycle': 'power cycle',
    reseat: 'reseating', reroute: 'rerouting', change: 'change', fix: 'fix', update: 'update', adjust: 'adjustment', fit: 'fitting',
  },
  objectFiller: /^(?:the|a|an|both|all|any|some|it|them|that|this|those|these|new|clean|old|spare|fresh|faulty|bad|whole|entire|same|our|their|its|my|your|one|ones|for|with|up|down|back|out|off|over|again|first|then|also|just|already|now|to)$/i,
  discourseMarkers: /^(?:(?:yes|yeah|yep|yup|no(?=[,.:;!])|nope|ok|okay|good|great|nice|sure|well|so|also|and|but|then|right|confirmed|thanks|thank you|indeed|exactly|correct|hm+|ah+|oh|great news|good news|update|and then|ok so|so then)\b[\s,.:;!-]*)+/i,
  asideCue: /\b(?:by the way|btw|off[- ]topic|unrelated|on another note|side note|someone remind me|remind me to|has anyone (?:seen|found|got)|does anyone know|anyone know)\b/i,
  referenceCue: /(?:\b(?:like|same as|similar to|as (?:on|with|for|in|at)|unlike|compared (?:to|with)|just like|same thing as|as we did (?:on|for|with)|as with|same (?:issue|problem|fault) as|similar (?:issue|problem) (?:on|to|at))\s+(?:the\s+|on\s+|at\s+|for\s+|with\s+)*)$/i,
  intent: /\b(?:i'?ll|i will|i'?m going to|going to|about to|let me|will do|on it|on my way|give me|shall i|should i|do i|can i|i can|i could|we could|we can|we will|i would|we'?ll)\b/i,
  recurrenceCue: /\b(?:again|once more|recurr\w*|reappear\w*|re-?occur\w*|second time)\b/i,
  comeBackCue: /\b(?:came back|comes back|has come back|returned|is back|are back)\b/i,
  longDuration: /\b(?:(?:for|over|after|in|about|nearly|almost)\s+)?(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|several|a few|a couple of|many)\s+(?:days?|weeks?|months?)\b|\b(?:next|following)\s+(?:day|morning|week)\b|\bovernight\b|\byesterday\b|\bthe day after\b|\ba (?:day|week|month) (?:later|since|ago)\b/i,
  hedgeClause: /[,;:]\s*((?:i (?:suspect|think|guess|believe|assume)|probably|maybe|perhaps|possibly|it (?:may|might|could) be)\b.*)$/i,
  closure: /\b(?:close (?:the )?(?:ticket|case|incident|issue|task)|can be closed|closing (?:the )?(?:ticket|case|incident|issue|task)|mark(?:ed)? (?:it )?(?:as )?(?:resolved|done)|nothing (?:more|else) to do)\b/i,
  administrative: /\b(?:tickets?|cases?|notes?|requests?|meetings?|calls?|emails?|messages?|reports?|records?|logs?|entry|entries|rota|vendor|customer)\b/i,
  readingQuestion: /\b(?:what does|what do|what is|what's|what are|how is|how are|how much|how many|does it show|show me|reading|level|status|state|say)\b/i,
  exclusion: /\b(?:so )?that(?: is|'s) not it\b|\bnot (?:the|a) (?:cause|reason)\b|\bis not (?:it|the cause)\b|\bwas not (?:it|the cause)\b/i,
  strongRecovery: /\b(?:links?|sessions?|traffic|service|phones?|vlans?|peers?|ports?)\b[^.]{0,20}\b(?:fine|ok|okay|good|healthy|normal|clean|stable|steady)\b|\bstill\s+(?:up|good|stable|steady|clean|fine|ok|okay|healthy|normal|working)\b|\bclean\b|\b(?:back|up|restored|resolved|fixed|recovered|cleared|stopped|gone|flowing|registering|registered|working|steady|stable|normal)\b/i,
  states: {
    problemNouns: /\b(?:alarms?|errors?|flaps?|flapping|faults?|drops?|dropp\w+|crc|outages?|loss|failures?|failing|issues?|problems?|symptoms?|stalls?|stalling|rebooting|reboots|restarting|timeouts?|congestion|latency|noise|dips?|spikes?)\b/i,
    recurrence: /\b(?:again|once more|came back|comes back|has come back|returned|is back|are back|recurr\w*|reappear\w*|re-?occur\w*|back again)\b/i,
    worse: /\b(?:worse|got worse|gotten worse|now\b[^.;]{0,30}\b(?:down|offline|failing|broken|unreachable|lost)\b|more (?:errors|alarms|drops|flaps)|now (?:also )?down|even more|much higher than before|deteriorat\w*|degraded further)\b/i,
    partial: /\b(?:not (?:all the way |fully |completely |entirely )?(?:to zero|gone|fixed|cleared|resolved)|but not (?:to zero|fully|completely|entirely|gone|zero)|(?:dropped|fell|reduced|improved|better|lower|less)\b[^.;]{0,30}\bbut\b|a (?:lot|bit) better|(?:partly|partially|mostly|largely) (?:fixed|better|resolved|gone)|improved (?:a lot|somewhat|slightly)|(?:at )?(?:a |the )?(?:low|lower|reduced) (?:level|rate))\b/i,
    noChange: /\b(?:still\s+(?:not|no|down|zero|nothing|flapping|dropping|climbing|rising|failing|high|low|raised|active|happening|broken|stuck|slow|bad|the same|there|present|failing|seeing)|no (?:change|improvement|difference|effect)|unchanged|same (?:as before|(?:\w+ )?(?:pattern|problem|issue|symptom))|(?:didn'?t|did not|doesn'?t|does not|hasn'?t|has not) (?:help|fix|change|work|improve|clear)|not (?:back|working|recovered|resolved|fixed|improv\w+|clear\w*|solved)|(?:keeps?|kept|keep) (?:climbing|dropping|flapping|rising|growing|failing|going|happening)|(?:was|is|are) not (?:the|it|that)\b|did nothing)\b/i,
    recovered: /\b(?:(?:is|are|was|were|came|back)\s+(?:up|online|fine|normal|ok|okay|good|clean|stable|steady|healthy|restored|working|flowing|registered|reachable)\b|(?:both |all |the )?(?:sessions?|peers?|links?|ports?|phones?|services?|traffic|vlans?)\s+(?:is |are |was |were )?(?:up|back|flowing|registering|registered|steady|stable|working|passing)\b|(?:no|zero) (?:more |further )?(?:\w+ ){0,2}(?:flaps?|errors?|alarms?|drops?|loss|faults?|resets?|issues?|problems?|failures?|complaints?)\b|(?:stopped|gone|cleared|fixed|resolved|restored|recovered|solved|working again|works again|works now|working now|back to normal|back online|back up)\b|(?:fell|dropped|went|came|is|are|down|now|back) (?:down )?to \d+|(?:is|are|looks?|seems?) (?:stable|steady|clean|fine|healthy|normal|good)(?: now| again)?|(?:still|since)\s+(?:up|good|stable|steady|clean|fine|ok|okay|healthy|normal|working)|up again|stable again|came back on its own|on its own|by itself)\b/i,
  },
};

export const defaultExtractionConfig: ExtractionConfig = {
  assetIdPatterns: [/\b[A-Z]{2,5}-\d{2,5}\b/g],
  aliases: {},
  cues: {
    hypothesis: [
      /\bprobably\b/i, /\bmight\b/i, /\bsometimes\b/i, /\bi think\b/i, /\bi don'?t think\b/i, /\bcould be\b/i, /\bmaybe\b/i,
      /\bperhaps\b/i, /\busually\b/i, /\bsounds like\b/i, /\blooks like\b/i, /\bseems?\b/i, /\bcan (?:look|be|happen|come)\b/i,
      /\bpossibly\b/i, /\blikely\b/i, /\bi (?:suspect|guess|assume|believe|reckon)\b/i, /\bmy (?:guess|hunch)\b/i, /\bwould (?:explain|fit)\b/i,
      /\b(?:is|are|was|were)\s+(?:probably|likely|possibly)\b/i, /\bnot (?:the|a) (?:cause|reason)\b/i, /\b(?:that|this|it)(?:'s| is| was) not (?:it|the cause)\b/i, /\bsuspect\w*\b/i,
    ],
    advice: [/\byou should\b/i, /\bshould\b/i, /\bneed to\b/i, /\brecommend\w*\b/i, /\bbest to\b/i, /\bmust\b/i, /\bhas to\b/i, /\bmake sure\b/i],
    action: [/\bdid (?:that|it)\b/i, /\bdone\b/i],
    outcome: [/\bis back\b/i, /\bresolved\b/i, /\bstill not\b/i, /\bno change\b/i, /\bcame back\b/i],
    condition: [/\bolder unit\b/i, /\binstalled around\b/i, /\blink up\b/i, /\bcounters? zero\b/i, /\brx power normal\b/i],
    'access-fact': [
      /\bbarrier\b/i, /\bgate\b/i, /\block(?:ed|box)\b/i, /\b(?:door|gate|access)\s+code\b/i, /\bfor access\b/i,
      /\bkeys?\s+(?:is|are|from|at|box|safe|to)\b/i, /\bkey\s*(?:holder|box)\b/i,
    ],
    identity: [/\bis (?:a|an|the)\s+[\p{L} ]*(?:engineer|manager|expert|technician|lead)\b/iu],
  },
  conditionParsers: defaultConditionParsers,
  actionLexicon: defaultActionLexicon,
  imperative: new RegExp(`^(?:(?:please|first|then|also|just)\\s+)*(?:${IMPERATIVE_VERBS})\\b`, 'i'),
  performed:
    /\b(?:did (?:that|it)|done(?: that)?|i (?:just |have |already )?(?:changed|replaced|swapped|reset|rebooted|restarted|disabled|enabled|rolled back|reverted|cleaned|checked)|(?:changed|replaced|swapped|rebooted|restarted|rolled back|reverted|disabled and enabled|disabled|power[- ]cycled|cleared the sessions)\b)/i,
  generic: [/\bin (?:several|many|some) cases\b/i, /\bover the years\b/i, /\b(?:i'?ve|we'?ve|we have|i have) (?:seen|learned|just learned)\b/i, /\blearned (?:it )?from experience\b/i, /\bnot (?:documented|written)\b/i, /\bwritten in\b/i, /\bnot that i know\b/i],
  documentation: /\b(?:written|documented|documentation|instructions|field instructions)\b/i,
  problem:
    /\b(?:not (?:working|coming|recover\w*|responding)|isn'?t (?:working|coming|recover\w*)|doesn'?t (?:work|recover|come)|still (?:not|down|zero)|\bdown\b|fail\w*|flapping|outage|no traffic|alarms? (?:raised|active)|errors?|problem|issues?|broken|stuck|unreachable|can'?t|cannot|dropp\w+)\b/i,
  newProblem: /\b(?:new|another|different|separate)\s+(?:problem|issue|fault|incident)\b/i,
  maxSequenceGap: 200,
  smallTalk: /^(?:hi|hello|hey|thanks|thank you|ok|okay|good|great|nice|yes|no|sure|cheers|regards|best|kind regards|br)\b[^\n]*$/i,
  outcomeRecovered: /\b(?:is back|are back|traffic back|came back|works? (?:again|now|fine)|working again|resolved|fixed|recovered|solved|restored|flowing again|stable again|is up again|(?:are|is) stable(?: now| again)?|still stable|are up again)\b/i,
  outcomeNoChange: /\b(?:still not|not (?:back|working|recovered|resolved|fixed)|no change|(?:didn'?t|did not) help|same (?:problem|issue)|still (?:down|zero|nothing|flapping))\b/i,
  outcomeWorse: /\b(?:worse|got worse|now (?:also )?down)\b/i,
  outcomeRecurred: /\b(?:(?:problem|issue|fault|alarm|error|flapping|it)\s+(?:came back|returned|is back)\s*(?:again)?|(?:happened|came back) again|recurr\w*)\b/i,
  hedges: /\b(?:i think|basically|around|probably|maybe|looks?|seems?|roughly|about)\b/i,
  stateConditionKeys: ['optical.level', 'traffic.counters', 'interface.status', 'alarms.state', 'traffic.state', 'bgp.session', 'power.state', 'temperature.state'],
  episodeGapDays: 2,
  followUpDays: 14,
  differentProblemOverlap: 0.25,
  declaredRoleClaims: false,
  language: defaultLanguage,
  validityCues: defaultValidityCues,
};
