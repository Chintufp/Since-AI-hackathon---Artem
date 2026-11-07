/**
 * Authoring spec for synthetic scenario families (HIDDEN side: lives under benchmarks/).
 * build.ts turns a FamilySpec into data/scenarios/<id>/{sources,people.json,truth.json,incoming.json}.
 * People are written as slugs here; the builder maps them to provider ids.
 */
import type { FamilyManifestEntry, IncomingProblems, ScenarioTruth } from '../../src/libs/utils/contracts/index.ts';

export interface PersonSpec {
  slug: string;
  name: string;
  role: string;
  groups: string[];
  available?: boolean;
  /** Slack user id, e.g. "U011". Omit when the person is not in Slack. */
  slack?: string;
  /** Email address. Omit when unknown. */
  email?: string;
}

interface Ref {
  /** Label other messages may reference through copyOf. */
  id?: string;
  /** Incident key this message belongs to; omit for small talk / asides. */
  inc?: string;
  /** Label(s) of the message(s) this one copies or merely retells (several parents allowed). */
  copyOf?: string | string[];
}

export interface TeamsMsg extends Ref {
  who: string;
  time: string;
  text: string;
}

export interface EmailMsg extends Ref {
  id: string;
  from: string;
  to: string[];
  cc?: string[];
  subject: string;
  body: string;
  /** Omit to keep the date unknown (the Elisa example carries no date). */
  date?: string;
}

export interface SlackMsg extends Ref {
  channel: string;
  /** YYYY-MM-DD */
  day: string;
  /** HH:MM:SS (UTC) */
  time: string;
  who: string;
  text: string;
  /** Label of the thread parent message. */
  thread?: string;
}

export interface SlackChannelSpec {
  name: string;
  private?: boolean;
  /** Person slugs that are members (required for private channels). */
  members: string[];
}

export interface IncidentSpec {
  key: string;
  title: string;
  realCause: string;
  claims: Array<{ type: string; statement: string; by?: string }>;
  attempts: Array<{ action: string; by: string; performed: boolean }>;
  outcome: { result: string; lasting: 'confirmed' | 'recurred' | 'unknown'; reportedBy?: string };
  knowledge: Record<string, { knows: string[]; canObserve: string[] }>;
  accessGroups: string[];
}

export interface ProblemSpec {
  id: string;
  text: string;
  requester: string;
  observations?: Array<{ key: string; value: string | number | boolean; label: string }>;
  key: {
    relatedIncidentKeys: string[];
    applicable: 'reuse' | 'qualified' | 'inapplicable' | 'none';
    consequentialGap?: { description: string; answerers: string[]; answer: 'yes' | 'no'; unanswerable?: boolean };
    /** person slug -> condition key (optionally "key=value") -> answer */
    answers: Record<string, Record<string, 'yes' | 'no' | 'unknown'>>;
    noQuestionNeeded: boolean;
    expectedRecommendation: 'reuse' | 'check-first' | 'qualified' | 'retain-uncertainty' | 'none';
    distinguishingConditions?: Array<{ key: string; value: string | number | boolean }>;
    laterOutcome?: 'recovered' | 'temporary' | 'no-change' | 'unknown';
  };
}

export interface FamilySpec {
  entry: Omit<FamilyManifestEntry, 'dir'>;
  teamsNote?: string;
  people: PersonSpec[];
  teams: TeamsMsg[];
  emails: EmailMsg[];
  slackChannels: SlackChannelSpec[];
  slack: SlackMsg[];
  entities: ScenarioTruth['entities'];
  incidents: IncidentSpec[];
  problems: ProblemSpec[];
}
