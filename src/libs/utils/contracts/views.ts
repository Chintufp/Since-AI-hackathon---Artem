/** Renderer-safe view models. The service builds these; the UI renders them; no secrets inside. */
import type { EvidenceRef } from './common.ts';

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
  /** Evaluative: the two compared candidates. */
  compare?: [{ id: string; text: string }, { id: string; text: string }];
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
}

export interface ReceiptView {
  title: string;
  detail: string;
  canUndo: boolean;
  pointsAwarded?: number;
}
