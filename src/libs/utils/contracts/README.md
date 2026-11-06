# contracts

Shared records, schemas and service contracts for every module and app. Owned by the integrator; other modules import from here and request changes rather than editing.

| File | Contents |
| --- | --- |
| `common.ts` | TimeRef (unknown/partial times), ActorRef, AccessScope, EvidenceRef, Condition, Route labels, TraceEvent |
| `ids.ts` | `stableId` (deterministic ids → idempotent imports), `textFingerprint` (copy detection), `freshId` |
| `evidence.ts` | EvidenceEnvelope, ImportBatch, ConnectorCapabilities, ConnectionCard/status |
| `memory.ts` | Entity, Claim, Case, Attempt, Outcome, PersonWorkLink, Pattern, Procedure, Observation, Correction, Gap |
| `investigation.ts` | Problem, CandidateMatch, Hypothesis (support ≠ applicability), Recommendation, PersonResult, Budget, InvestigationState |
| `questions.ts` | QuestionCandidate, RecipientEligibility, PolicyDecision (propensity), QuestionRecord lifecycle, Answer, PreferenceFeedback (separate), CoordinatorSettings, ContactDraft |
| `outcomes.ts` | OutcomeReport, EvaluationRecord (benefit may be null = unknown), ParticipationEvent/Balance (points, separate), UserSettings |
| `store.ts` | KnowledgeStore boundary (SQLite tonight; replaceable) |
| `models.ts` | Extractor / Retriever / QuestionGenerator / Selector / Assessor provider interfaces with explicit routes; ModelArtifact |
| `views.ts` | Renderer-safe view models (timeline nodes: problem red, step yellow, reported green) |
| `service.ts` | HTTP routes, request/response shapes, MCP tool names (documented defaults), Principal |
| `scenarios.ts` | Synthetic family manifest, visible people directory, hidden truth and incoming answer keys |

Invariants:
- Unknown times stay unknown (`TimeRef.known === false`); never default to ingestion time.
- Copies share `lineage.sourceFingerprint` and are linked via `copiedFrom`; they are not independent confirmations.
- Factual answers, preference feedback, participation points and policy rewards are four different types.
- Hard eligibility (`RecipientEligibility.violations`) is applied before any selector; the selector only sees `eligible`.
- `EvaluationRecord.assessedBenefit === null` means unknown, never zero.
- Runtime code never reads `truth.json` / incoming answer keys.

Checks: `pnpm typecheck`. No runtime code lives here.
