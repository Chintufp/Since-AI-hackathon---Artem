export { createPanel } from './panel.ts';
export type { Panel, PanelOptions, PanelStatus, PanelCompanion, ViewName } from './panel.ts';
export { createPanelMotion } from './panel-motion.ts';
export type { PanelMotion, PanelMotionOptions, PanelMotionStatus } from './panel-motion.ts';
export { createApiClient, ApiError, buildUrl, parseRoute } from './api-client.ts';
export type { ApiClient, ApiClientOptions, FetchLike, RouteKey } from './api-client.ts';
export { createMockApi, createMockFetch, MOCK_BASE_URL, MOCK_ERKKI, MOCK_VEIKKO, mockPrincipal, type MockModelsScenario } from './mock-api.ts';
export { demoChips, DEMO_PERSONAS } from './demo-chips.ts';
export type { DemoChip, DemoPersona } from './demo-chips.ts';
// desktop (R31..R36): the companion state machine, attention rules and the collapsed question watch.
export {
  createCompanion, attachCompanion, COMPANION, GEOMETRY, carrierTransform, classifyGesture, nextGaze, pushedSide,
  inEdgeZone, nearBody, homeXFor, sliverX, perchX, edgeX, roomX, fitsCard, nearerSide, loadPlacement, leaveDelays, idleLeftMs,
} from './companion.ts';
export type {
  Companion, CompanionDeps, CompanionFlags, CompanionState, CompanionStatus, CompanionCommand, CompanionPower,
  CompanionPanelHooks, CompanionRender, CompanionClock, CompanionRaf, Placement, Side, TravelMotion,
} from './companion.ts';
export { createAttention, ATTENTION, ENGAGEMENT_KEY } from './attention.ts';
export type { Attention, AttentionOptions, EngagementCounters, Outcome, QuestionMark } from './attention.ts';
export { createQuestionWatch, COLLAPSED_POLL_MS } from './question-watch.ts';
export type { QuestionWatch, QuestionWatchOptions, WakeReason, WatchClock } from './question-watch.ts';
export { modelNotes } from './model-notes.ts';
