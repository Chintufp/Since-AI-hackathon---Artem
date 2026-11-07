/** Renderer-safe view models. The service builds these; the UI renders them; no secrets inside. */
import type { EvidenceRef, Iso } from './common.ts';
import type { ClaimStatus, ClaimType } from './memory.ts';

export type TimelineKind = 'problem' | 'step' | 'reported' | 'verified' | 'unknown';

export interface TimelineNode {
  id: string;
  /** red = problem, yellow = step (hypothesis/check/attempt), green = reported outcome. */
  kind: TimelineKind;
  label: string;
  detail: string;
  /** 'hypothesis' | 'check' | 'attempt' | 'observation' | 'outcome' to label steps honestly. */
  stage: 'observation' | 'hypothesis' | 'check' | 'attempt' | 'outcome' | 'unknown';
  evidence: EvidenceRef[];
  who?: string;
  when?: string;
  /** Model provenance of the statements behind this node, e.g. "proposed by local model qwen3:4b, committed by rules". Absent when rules produced all of them. */
  provenance?: string[];
}

export interface CaseView {
  caseId: string;
  title: string;
  status: string;
  entities: Array<{ id: string; name: string; type: string }>;
  timeline: TimelineNode[];
  caveat: string;
  sources: Array<{ evidenceId: string; provider: string; author: string; when: string; excerpt: string; reference?: string }>;
  /** People with firsthand links to this case (Artem 7 Nov: shown on the case page), gated for the viewer. */
  people?: PersonView[];
  /** B3: provenance strip under the case title (the case's advice), gated for the viewer. */
  provenance?: ProvenanceView;
}

/**
 * B3: the provenance strip under a heading (BUILD_BRIEF 3.4), built through the viewer's evidence gate. `text` is the
 * one line the UI shows, e.g. "Erkki Expert · Teams 09:22 (date unknown) · reported once · still believed true".
 */
export interface ProvenanceView {
  claimId: string;
  person?: string;
  providerLabel: string;
  /** describeTime wording for undated sources ("09:22 (date unknown)"); "14 Oct" for a known date. */
  when: string;
  /** Independent visible sources of the claim. */
  sources: number;
  reportedOnce: boolean;
  stillBelievedTrue: boolean;
  /** "superseded 6 Oct by Eino Salo" (a newer value replaced it). */
  supersededBy?: string;
  /** B1 D-B1-07: a note bounds the claim; it still holds inside `condition` ("bounded 14 Oct by Erkki Expert"). */
  bound?: { condition: string; by: string };
  /** "rules", or B2's "local model qwen3:4b, committed by rules". */
  route: string;
  text: string;
}

export interface QuestionView {
  questionId: string;
  investigationId: string;
  /** The recipient (a person entity id); lets a list over everyone (GET /questions without a person) say whose each one is. */
  personEntityId?: string;
  caseLabel: string;
  text: string;
  kind: 'quick' | 'evaluative';
  why: string;
  timeline: TimelineNode[];
  caveat: string;
  status: string;
  deferred: boolean;
  /** B1: held by quiet hours until this moment (shown to the requester as "queued for 07:00"). */
  deliverAfter?: string;
  /** B1: 'free-text' asks for the person's own words (standing missing-symptom questions). */
  answerType?: 'yes-no' | 'yes-no-unknown' | 'free-text';
  /** Evaluative: the two compared candidates. */
  compare?: [{ id: string; text: string }, { id: string; text: string }];
  /** B2: "worded by local model qwen3:8b" when the phrase slot's wording is shown; absent for template wording. */
  wordedBy?: string;
  /** B2: the template's wording when a model's wording is shown. */
  templateText?: string;
  /** B3: provenance strip of the claim the question tests, gated for the viewer. */
  provenance?: ProvenanceView;
}

export interface PersonView {
  personEntityId: string;
  name: string;
  role?: string;
  reasons: Array<{ text: string; caseId?: string; firsthand: boolean; evidence: EvidenceRef[] }>;
  askable: boolean;
}

export interface ResultView {
  investigationId: string;
  recommendation: { kind: string; text: string; applicability: string; caveats: string[]; nextStep?: string; actionClass: string };
  matches: Array<{ caseId?: string; procedureId?: string; title: string; score: number; matching: string[]; conflicting: string[]; missing: string[]; /** When the case started (ISO), when known. */ startedAt?: string }>;
  people: PersonView[];
  question?: QuestionView;
  loop: string;
  loopReason?: string;
  routes: Array<{ route: string; version: string }>;
  caseView?: CaseView;
  /** B3: provenance strip under the recommendation, gated for the requester (absent when nothing is visible). */
  provenance?: ProvenanceView;
}

export interface ReceiptView {
  title: string;
  detail: string;
  canUndo: boolean;
  pointsAwarded?: number;
}

/** B1: where a record sits in time. `iso` only when the source stated a full date-time with zone; never synthesised. */
export interface TimePosition {
  kind: 'known' | 'time-only' | 'date-only' | 'unknown';
  iso?: Iso;
  raw?: string;
  sequence?: number;
}

/** B1: one assertion bound to an entity, with its validity window and where it came from (GET /context). */
export interface ContextAssertion {
  claimId: string;
  type: ClaimType;
  statement: string;
  status: ClaimStatus;
  validFrom: TimePosition;
  validTo?: TimePosition;
  validityCondition?: string;
  supersededBy?: string;
  /** True when the claim holds at the requested `at` (or now): unknown from = valid from before any dated moment, unknown to = still believed true. */
  validAt: boolean;
  /** How validTo was ordered against the newer claim: known event times, or import order (undated sources). */
  orderBasis?: 'known-time' | 'import-order';
  assertedBy?: { id: string; displayName: string };
  /** B3: `thread` is the source evidence's thread id (the Context Layer page groups undated items by it). */
  source: { evidenceId: string; provider: string; time: string; position: TimePosition; thread?: string };
  excerpt: string;
  caseId?: string;
  /** B3: the visible note that bounds this claim (with `validityCondition`), e.g. Erkki's 14 Oct firmware note. */
  conditionedBy?: string;
  /** B3: who read the claim, in words: "rules", or B2's "proposed by local model qwen3:4b, committed by rules". */
  route?: string;
}

/** B1: a person or class bound to the entity: firsthand work links, or hedged/inferred class conditions. */
export interface ContextBinding {
  entityName: string;
  kind: 'firsthand' | 'hedged-class';
  label: string;
  byPerson?: string;
  recorded: TimePosition;
  evidence: EvidenceRef[];
}

export interface ContextAssertionsView {
  entity: { id: string; name: string; type: string };
  /** The requested point in time, when one was given (otherwise the rows are evaluated at now). */
  at?: Iso;
  assertions: ContextAssertion[];
  bindings: ContextBinding[];
}
