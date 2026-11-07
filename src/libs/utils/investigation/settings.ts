import { defaultCoordinatorSettings, type CoordinatorSettings } from '../contracts/index.ts';
import type { AgeFold, ProblemStatedLabels } from '../retrieval/conditions.ts';
import type { ModelParserConfig } from './problem-parser.ts';
import { DEFAULT_PHRASES, type PhraseSettings } from './phrases.ts';

/** Which condition keys a person can observe, by directory group or role. Organization configuration. */
export interface ObservabilityPolicy {
  groups: Record<string, string[]>;
  roles: Record<string, string[]>;
}

export interface QuestionTemplateSettings {
  /** Condition key -> template ({asset}, {value}, {label} are substituted). */
  conditionTemplates: Record<string, string>;
  /** Action name -> phrase for "Did <phrase> right after the <action>?" */
  outcomePhrases: Record<string, string>;
  /**
   * Condition key -> question about the EARLIER unit of a case that records no such condition, while the problem states one
   * ({case_label} = short case label, {a_problem_value} = the stated value with an article, {problem_value}, {label}).
   */
  problemStatedTemplates: Record<string, string>;
  /** Maximum question candidates produced per request. */
  maxCandidates: number;
  /** Also emit an evaluative (preference) candidate when >= 2 factual candidates exist. Never mandatory. */
  evaluativePairs: boolean;
}

export interface InvestigationSettings {
  /** Candidates retrieved. */
  k: number;
  /** Candidates scoring below floor * top score do not produce hypotheses or people. */
  relativeScoreFloor: number;
  /** Conditions that decide whether a historical response applies to another asset. */
  distinguishingKeys: string[];
  /** Identity-like keys that never count as match/conflict/missing. */
  ignoredKeys: string[];
  /** Multi-valued history keys (can only match). */
  historyKeys: string[];
  /** Current conditions the requester can check themselves; no human question is generated for them. */
  requesterObservableKeys: string[];
  /** Actions that are diagnostic checks (everything else is corrective). */
  diagnosticActions: string[];
  observability: ObservabilityPolicy;
  coordinator: CoordinatorSettings;
  questions: QuestionTemplateSettings;
  /** Human wording (action phrases, people verbs, condition phrases). */
  phrases: PhraseSettings;
  /**
   * Fold a stated installation year into an age class: years up to `olderThroughYear` mean "older". The raw year key is
   * in `ignoredKeys`, so only the age class decides applicability. `olderThroughYear: null` disables folding.
   */
  ageFold: AgeFold;
  /**
   * Keys the problem states but a case may not record (default: the unit model). Without a recorded value for the earlier unit
   * the stated value is an unknown that decides applicability; an attributed answer settles it either way.
   */
  problemStated: Record<string, ProblemStatedLabels>;
  /** Extractor for a stated model in the problem text; null disables it. Undefined uses the parser default. */
  modelParser?: ModelParserConfig | null;
  /** Regex sources marking a case condition label as hedged in its source; hedged/inferred conditions never create consequential gaps. */
  hedgeMarkers: string[];
  /** A candidate drives recommendation, gaps, questions and people only if it matches at least this many non-history conditions or shares an entity with the problem. */
  relatedMinMatchingConditions: number;
  maxPeople: number;
  maxReasonsPerPerson: number;
  /** Texts for the question-loop status shown in the UI (loopReason). */
  loopReasons: LoopReasons;
}

export interface LoopReasons {
  noQuestionNeeded: string;
  noRecipient: string;
  budgetUsed: string;
  everyoneAsked: string;
  peopleBusy: string;
  holding: string;
  answered: string;
  /** Used when the answer was recorded but the rebuilt recommendation is the same. */
  answeredNoChange: string;
  /** {name} = recipient display name. Used when no specific reason is known. */
  waiting: string;
  /** {name} = recipient display name, {because} = what they did (e.g. "performed the action in TRN-042"). */
  asked: string;
  preparing: string;
}

export function defaultInvestigationSettings(over: Partial<InvestigationSettings> = {}): InvestigationSettings {
  return {
    k: 8,
    relativeScoreFloor: 0.3,
    distinguishingKeys: ['unit.age', 'unit.model', 'unit.revision', 'software.version', 'unit.batch'],
    ignoredKeys: ['site.id', 'site.region', 'site.access', 'time.since_change', 'unit.installed_year'],
    historyKeys: ['action.performed', 'component.replaced'],
    requesterObservableKeys: ['interface.status', 'optical.level', 'traffic.counters', 'traffic.state', 'alarms.state', 'power.state', 'temperature.state', 'bgp.session'],
    diagnosticActions: ['counters.check', 'optics.check', 'logs.check'],
    observability: { groups: {}, roles: {} },
    coordinator: { ...defaultCoordinatorSettings },
    questions: {
      conditionTemplates: {
        'unit.age': 'Is {asset} {a_value} unit?',
        'unit.model': 'Is {asset} the {value} model?',
        'unit.revision': 'Is {asset} on revision {value}?',
        'unit.installed_year': 'Was {asset} installed in {value}?',
        'software.version': 'Is {asset} running software version {value}?',
        'unit.batch': 'Is {asset} from the {value} batch?',
      },
      problemStatedTemplates: { 'unit.model': 'Is {case_label} {a_problem_value}?' },
      outcomePhrases: { 'interface.reset': 'traffic return' },
      maxCandidates: 4,
      evaluativePairs: false,
    },
    phrases: DEFAULT_PHRASES,
    ageFold: { yearKey: 'unit.installed_year', ageKey: 'unit.age', olderValue: 'older', olderThroughYear: 2019, hedgeMarkers: ['hedged in source'], batchKey: 'unit.batch' },
    problemStated: {
      'unit.model': { missing: "Earlier unit's model is {value}", match: "Earlier unit's model is {value} (confirmed)", conflict: 'Another model (this problem: {label})' },
    },
    hedgeMarkers: ['hedged in source'],
    relatedMinMatchingConditions: 2,
    maxPeople: 6,
    maxReasonsPerPerson: 3,
    loopReasons: {
      noQuestionNeeded: 'Existing evidence and your own observations settle the next step',
      noRecipient: 'No one with firsthand knowledge is available to ask right now',
      budgetUsed: 'The question budget for this investigation is used up',
      everyoneAsked: 'Everyone who could answer has already been asked',
      peopleBusy: 'The people who could answer are busy or were asked recently; try again later',
      holding: 'Holding the question: asking now is not expected to help enough',
      answered: 'The answer was used to update the recommendation',
      answeredNoChange: 'The answer was recorded; the recommendation did not change',
      waiting: 'Waiting for {name} to answer one quick question',
      asked: 'Asked {name} because they {because}',
      preparing: 'One quick question to someone with firsthand knowledge could settle this',
    },
    ...over,
  };
}

export const isDiagnosticAction = (action: string, s: Pick<InvestigationSettings, 'diagnosticActions'>): boolean =>
  s.diagnosticActions.includes(action) || action.endsWith('.check');
