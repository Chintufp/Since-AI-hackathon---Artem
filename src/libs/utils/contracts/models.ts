import type { Condition, EvidenceRef, RouteInfo, TimeRef } from './common.ts';
import type { ClaimType } from './memory.ts';
import type { EvidenceEnvelope } from './evidence.ts';
import type { EligibleAction, PolicyDecision, QuestionCandidate } from './questions.ts';
import type { CandidateMatch, InvestigationState } from './investigation.ts';
import type { EvaluationRecord } from './outcomes.ts';

/**
 * Provider interfaces for every model-dependent stage.
 * Implementations declare their route: 'rules' (deterministic), 'local' (trained on this Mac),
 * 'replay' (recorded fixtures) or 'claude-agent-arm' (recorded outputs of a Claude subagent during a run).
 * No implementation may call a network model provider.
 */

export interface ConversationContext {
  /** Ordered evidence making up one thread/conversation window. */
  evidence: EvidenceEnvelope[];
  /** Entity aliases configured by the organization (never hard-coded in the core). */
  aliases?: Record<string, string[]>;
}

export interface ProposedClaim {
  type: ClaimType;
  statement: string;
  subjectEntityNames: string[];
  assertedByActorId?: string;
  evidence: EvidenceRef[];
  condition?: Condition;
  /** Model confidence is informational only; never evidence. */
  confidence?: number;
  /** B1: explicit validity cues read from the source (condition / cue / stated end); commit copies them into Claim.validity. */
  validity?: { condition?: string; cue?: string; to?: TimeRef };
  /** B1: a superseding note's bound (e.g. software.version gte 4.2); never a case condition. */
  supersessionBound?: Condition;
}

export interface ProposedEntity {
  type: 'asset' | 'site' | 'person' | 'component' | 'software' | 'location' | 'organization' | 'other';
  name: string;
  aliases: string[];
  attributes?: Record<string, { value: string | number | boolean; evidence: EvidenceRef[] }>;
  evidence: EvidenceRef[];
}

export interface ProposedLink {
  personActorId: string;
  contribution: 'reported-problem' | 'advised' | 'performed-check' | 'performed-action' | 'reported-outcome' | 'observed-condition' | 'mentioned';
  evidence: EvidenceRef[];
  firsthand: boolean;
}

export interface ExtractionProposal {
  route: RouteInfo;
  entities: ProposedEntity[];
  claims: ProposedClaim[];
  links: ProposedLink[];
  /** Candidate case boundaries: which evidence ids form one incident. */
  incidents: Array<{ key: string; evidenceIds: string[]; title: string }>;
  usefulness: Array<{ evidenceId: string; label: 'useful' | 'uncertain' | 'irrelevant'; reason: string }>;
}

export interface Extractor {
  route: RouteInfo;
  extract(context: ConversationContext): Promise<ExtractionProposal>;
}

export interface RetrievalQuery {
  text: string;
  conditions: Condition[];
  entityIds: string[];
  requesterPrincipal: { id: string; groups: string[] };
  k: number;
  /** B1: retrieve as of this moment (ISO): later evidence and claims not valid then are left out. */
  at?: string;
}

export interface Retriever {
  route: RouteInfo;
  search(query: RetrievalQuery): Promise<CandidateMatch[]>;
}

export interface QuestionGenerator {
  route: RouteInfo;
  generate(state: InvestigationState, maxCandidates: number): Promise<QuestionCandidate[]>;
}

export interface SelectorContext {
  state: InvestigationState;
  eligible: EligibleAction[];
  candidates: QuestionCandidate[];
  /** Visible features per action, computed outside the selector. */
  features: Record<string, Record<string, number>>;
}

export interface Selector {
  id: string;
  version: string;
  route: 'rules' | 'local' | 'replay';
  select(context: SelectorContext): PolicyDecision;
  /** Batch update from logged records; absent for pure rules. */
  update?(records: EvaluationRecord[]): void;
  /** Serialize learned parameters (versioned JSON artifact). */
  toArtifact?(): Record<string, unknown>;
}

export interface Assessment {
  support: 'supported' | 'weak' | 'contradicted' | 'unknown';
  applicability: 'applicable' | 'qualified' | 'inapplicable' | 'unknown';
  reasons: string[];
  route: RouteInfo;
}

export interface Assessor {
  route: RouteInfo;
  mode: 'combined' | 'separate';
  assess(candidate: CandidateMatch, state: InvestigationState): Promise<Assessment>;
}

/** A versioned learned-model artifact saved under data/models/. */
export interface ModelArtifact {
  id: string;
  kind: 'logistic-hashed' | 'linucb' | 'pairwise-linker' | 'other';
  version: string;
  trainedAt: string;
  trainingDataset: { id: string; split: string; families: string[] };
  seeds: number[];
  parameters: Record<string, unknown>;
  metrics?: Record<string, number>;
}
