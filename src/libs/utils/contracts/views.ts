/** Renderer-safe view models. The service builds these; the UI renders them; no secrets inside. */
import type { EvidenceRef, Iso } from './common.ts';
import type { AlternativeHypothesis } from './investigation.ts';
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
  /**
   * B5: other related hypotheses, each with its expert ("Also on record: Helmi Virtanen advised clearing the forwarding
   * table in TRN-512 (qualified, depends on 2021 batch)"). Only cases the viewer may see.
   */
  alternatives?: AlternativeHypothesis[];
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
  source: { evidenceId: string; provider: string; time: string; position: TimePosition };
  excerpt: string;
  caseId?: string;
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
