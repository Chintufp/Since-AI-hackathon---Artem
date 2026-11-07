import type { Condition, EvidenceRef, RouteInfo } from './common.ts';
import type { ClaimType } from './memory.ts';
import type { EvidenceEnvelope } from './evidence.ts';
import type { EligibleAction, PolicyDecision, QuestionCandidate } from './questions.ts';
import type { CandidateMatch, InvestigationState } from './investigation.ts';
import type { EvaluationRecord } from './outcomes.ts';

/**
 * Provider interfaces for every model-dependent stage.
 * Implementations declare their route: 'rules' (deterministic), 'local' (trained on this Mac, or a pretrained model
 * served by Ollama on this Mac), 'replay' (recorded fixtures), 'claude-agent-arm' (recorded outputs of a Claude
 * subagent during a run) or 'api' (a hosted model over HTTPS).
 * No implementation may call a network model provider unless the user configured it: the 'api' provider runs only
 * when its slot is set to api and a key was given explicitly; never in tests or demo:judge. Everything else stays
 * on this machine (loopback Ollama at most).
 */

/** Which provider serves one model slot. 'rules' is the default for every slot. */
export interface SlotChoice {
  provider: 'rules' | 'local' | 'api';
  /** Model name for local (an Ollama tag) or api; ignored for rules. */
  model?: string;
}

/** The three model slots (BUILD_BRIEF section 2.1): embed text, extract a proposal, phrase a question. */
export interface ModelSlots {
  embed: SlotChoice;
  extract: SlotChoice;
  phrase: SlotChoice;
}

export type ModelSlotName = keyof ModelSlots;

/** Every slot on rules: nothing new runs, no process, no RAM, no network. */
export const DEFAULT_MODEL_SLOTS: ModelSlots = {
  embed: { provider: 'rules' },
  extract: { provider: 'rules' },
  phrase: { provider: 'rules' },
};

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
  /**
   * The benefit of a record already learned from was re-measured (an outcome landed): apply only the change from
   * `previousValue`, without counting the decision a second time. Absent: the selector does not learn the correction.
   */
  correct?(record: EvaluationRecord, previousValue: number): void;
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
