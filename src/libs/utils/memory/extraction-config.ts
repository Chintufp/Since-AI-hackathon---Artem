import type { ActionName, Condition, ConditionKey } from '../contracts/index.ts';

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
  /** Words that mark a statement as hedged (kept in the claim label). */
  hedges: RegExp;
}

const v = (value: string): ConditionParseResult['value'] => value;

export const defaultConditionParsers: ConditionParser[] = [
  {
    key: 'interface.status',
    pattern: /\b(?:link|interface|port)(?:\s+status)?\s*(?:=|:|is|are|stays|remains)?\s*(up|down)\b/i,
    build: (m) => ({ operator: 'eq', value: v(m[1]!.toLowerCase()), label: `Interface ${m[1]!.toUpperCase()}` }),
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
    key: 'unit.installed_year',
    pattern: /\binstalled\b[^.;\n]{0,15}?\b((?:19|20)\d{2})\b/i,
    build: (m) => ({ operator: 'eq', value: Number(m[1]), label: `Installed around ${m[1]}` }),
  },
  {
    key: 'component.replaced',
    pattern: /\b(?:chang|replac|swapp)\w*\s+(?:the\s+|a\s+)?(sfp|fan|psu|power supply|optic\w*|optical module|module|cable)\b/i,
    build: (m) => {
      const w = m[1]!.toLowerCase();
      const value = /sfp|optic|module/.test(w) ? 'sfp' : w === 'power supply' ? 'psu' : w;
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
  { action: 'sfp.replace', pattern: /\b(?:replac\w*|chang\w*|swap\w*)\b.{0,25}?\b(?:sfp|optic\w*|module)\b/i },
  { action: 'cable.replace', pattern: /\b(?:replac\w*|chang\w*|swap\w*)\b.{0,15}?\bcable/i },
  { action: 'config.rollback', pattern: /\b(?:roll(?:ed|ing)?\s?back|revert\w*)\b/i },
  { action: 'counters.check', pattern: /\b(?:check\w*|verify\w*|look\w* at|inspect\w*)\b.{0,40}?\bcounters?\b/i },
  { action: 'optics.check', pattern: /\b(?:check\w*|verify\w*|inspect\w*)\b.{0,30}?\b(?:optic\w*|rx power|light levels?)\b/i },
  { action: 'logs.check', pattern: /\b(?:check\w*|read\w*|review\w*|look\w* (?:at|in)|inspect\w*)\b.{0,30}?\blogs?\b/i },
  { action: 'config.change', pattern: /\b(?:set|increase|raise|lower|configure|change)\b.{0,30}?\b(?:timers?|config\w*|settings?|parameters?|router[- ]?id)\b/i },
  { action: 'session.reset', pattern: /\bclear\w*\b.{0,20}?\b(?:sessions?|neighbou?rs?)\b|\breset\w*\b.{0,15}\bbgp\b/i },
  { action: 'site.visit', pattern: /\b(?:visit\w*|drive out|go(?:ing)? to (?:the )?site)\b/i },
];

const IMPERATIVE_VERBS =
  "set|clear|configure|increase|raise|lower|check|try|disable|enable|replace|reboot|restart|reset|verify|look|inspect|make sure|ensure|clean|roll ?back|revert|swap|power[- ]?cycle|wait|don'?t|do not|never|avoid|read|review|bounce|toggle|contact|call|ask";

export const defaultExtractionConfig: ExtractionConfig = {
  assetIdPatterns: [/\b[A-Z]{2,5}-\d{2,5}\b/g],
  aliases: {},
  cues: {
    hypothesis: [
      /\bprobably\b/i, /\bmight\b/i, /\bsometimes\b/i, /\bi think\b/i, /\bi don'?t think\b/i, /\bcould be\b/i, /\bmaybe\b/i,
      /\bperhaps\b/i, /\busually\b/i, /\bsounds like\b/i, /\blooks like\b/i, /\bseems?\b/i, /\bcan (?:look|be|happen|come)\b/i,
      /\bpossibly\b/i, /\blikely\b/i,
    ],
    advice: [/\byou should\b/i, /\bshould\b/i, /\bneed to\b/i, /\brecommend\w*\b/i, /\bbest to\b/i],
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
};
