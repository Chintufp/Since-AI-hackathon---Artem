import { defaultCoordinatorSettings, type CoordinatorSettings } from '../contracts/index.ts';

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
}

export function defaultInvestigationSettings(over: Partial<InvestigationSettings> = {}): InvestigationSettings {
  return {
    k: 8,
    relativeScoreFloor: 0.3,
    distinguishingKeys: ['unit.age', 'unit.model', 'unit.revision', 'unit.installed_year', 'software.version'],
    ignoredKeys: ['site.id', 'site.region', 'site.access', 'time.since_change'],
    historyKeys: ['action.performed', 'component.replaced'],
    requesterObservableKeys: ['interface.status', 'optical.level', 'traffic.counters', 'traffic.state', 'alarms.state', 'power.state', 'temperature.state', 'bgp.session'],
    diagnosticActions: ['counters.check', 'optics.check', 'logs.check'],
    observability: { groups: {}, roles: {} },
    coordinator: { ...defaultCoordinatorSettings },
    questions: {
      conditionTemplates: {
        'unit.age': 'Was {asset} on the {value} unit revision?',
        'unit.model': 'Is {asset} the {value} model?',
        'unit.revision': 'Is {asset} on revision {value}?',
        'unit.installed_year': 'Was {asset} installed in {value}?',
        'software.version': 'Is {asset} running software version {value}?',
      },
      outcomePhrases: { 'interface.reset': 'traffic return' },
      maxCandidates: 4,
      evaluativePairs: false,
    },
    ...over,
  };
}

export const isDiagnosticAction = (action: string, s: Pick<InvestigationSettings, 'diagnosticActions'>): boolean =>
  s.diagnosticActions.includes(action) || action.endsWith('.check');
