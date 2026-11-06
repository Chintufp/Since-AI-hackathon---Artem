/**
 * Synthetic scenario contract shared by the data/evaluation owner (authoring),
 * the ingest module (reading visible sources) and the benchmark harness (hidden truth).
 *
 * RUNTIME CODE (src/) MAY READ ONLY: sources/, people.json.
 * HIDDEN (benchmarks/experiments only): truth.json, incoming.json answer keys.
 */

/** 'demo' families seed the local demo memory; train/validation/test are evaluation splits (by family, never by paraphrase). */
export type Split = 'demo' | 'train' | 'validation' | 'test';

export interface FamilyManifestEntry {
  id: string;
  split: Split;
  dir: string; // relative to data/scenarios
  description: string;
  /** Scenario tags used for failure slices. */
  tags: Array<
    | 'same-incident-continuation'
    | 'lookalike-different-cause'
    | 'temporary-recovery'
    | 'recurrence'
    | 'missing-outcome'
    | 'duplicate-report'
    | 'copied-retelling'
    | 'wrong-recipient-trap'
    | 'changed-permissions'
    | 'no-question-needed'
    | 'useful-no'
    | 'no-answer'
    | 'access-fact'
    | 'conflicting-conditions'
    | 'multi-step'
  >;
  /** Which other family this one paraphrases/derives from, if any (must share a split). */
  derivedFrom?: string;
}

export interface FamiliesFile {
  version: string;
  generatedBy: string;
  families: FamilyManifestEntry[];
}

/** Visible organization directory (runtime may read). */
export interface PeopleDirectory {
  people: Array<{
    id: string; // "person:directory:<slug>"
    name: string;
    role: string;
    groups: string[];
    /** Provider identities mapping to this person (visible identity mapping). */
    actorIds: string[];
    available: boolean;
  }>;
}

/** Hidden truth for one family (benchmarks only). */
export interface ScenarioTruth {
  familyId: string;
  entities: Array<{ name: string; type: string; attributes: Record<string, string | number | boolean> }>;
  incidents: Array<{
    key: string;
    title: string;
    /** Evidence source ids (provider:sourceId) that belong to this incident. */
    sourceIds: string[];
    realCause: string;
    /** Claims the extractor should recover, with type and whether they are reported or inferred. */
    expectedClaims: Array<{ type: string; statement: string; by?: string }>;
    attempts: Array<{ action: string; by: string; performed: boolean }>;
    outcome: { result: string; lasting: 'confirmed' | 'recurred' | 'unknown'; reportedBy?: string };
    /** Which people have firsthand knowledge of which facts, and what each can currently observe. */
    knowledge: Record<string, { knows: string[]; canObserve: string[] }>;
    accessGroups: string[];
  }>;
  /** Source ids that are copies of other source ids (must not count as independent confirmation). */
  copies: Array<{ sourceId: string; of: string }>;
}

/** Incoming problems to investigate (text visible; keys hidden). */
export interface IncomingProblems {
  familyId: string;
  problems: Array<{
    id: string;
    text: string;
    requester: string; // person id from people.json
    /** Visible observations the requester supplies with the problem. */
    observations?: Array<{ key: string; value: string | number | boolean; label: string }>;
    /** HIDDEN answer key. */
    key: {
      relatedIncidentKeys: string[];
      /** Which historical response applies here, if any. */
      applicable: 'reuse' | 'qualified' | 'inapplicable' | 'none';
      /** The one consequential gap, if any, and who can answer it. */
      consequentialGap?: { description: string; answerers: string[]; answer: 'yes' | 'no'; unanswerable?: boolean };
      /** Facts each person would reveal if asked (scoped by what they know). */
      answers: Record<string, Record<string, 'yes' | 'no' | 'unknown'>>;
      /** True if asking no question is the best action. */
      noQuestionNeeded: boolean;
      /** Expected recommendation class. */
      expectedRecommendation: 'reuse' | 'check-first' | 'qualified' | 'retain-uncertainty' | 'none';
      /** The conditions that would make a lookalike inapplicable. */
      distinguishingConditions?: Array<{ key: string; value: string | number | boolean }>;
      /** Observed later outcome of following the recommendation, for resolution metrics. */
      laterOutcome?: 'recovered' | 'temporary' | 'no-change' | 'unknown';
    };
  }>;
}
