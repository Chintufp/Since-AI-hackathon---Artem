/**
 * Shared primitive contracts. Everything in src/ builds on these.
 * Rules: unknowns stay unknown (never default a missing time to "now"),
 * identifiers are namespaced by organization and provider, and copies keep lineage.
 */

/** ISO-8601 timestamp string. */
export type Iso = string;

/** A time that may be unknown or partial (the Elisa example has times but no date). */
export interface TimeRef {
  known: boolean;
  /** Present when known === true and fully resolved. */
  iso?: Iso;
  /** 'time-only' when only a clock time was given, 'date-only' when only a date. */
  partial?: 'time-only' | 'date-only';
  /** Original source text, preserved verbatim. */
  raw?: string;
  /** Ordinal within a thread when absolute time is unknown. */
  sequence?: number;
}

export const unknownTime = (raw?: string): TimeRef => ({ known: false, raw });

/** A person or system actor, namespaced by provider. Equal display names do not imply identity. */
export interface ActorRef {
  /** Stable id, e.g. "person:slack:U123" or "person:directory:erkki.expert". */
  id: string;
  displayName: string;
  role?: string;
  provider?: string;
}

export type Visibility = 'org' | 'group' | 'private';

/** Who may see a record. Filtering is applied at retrieval and at question delivery. */
export interface AccessScope {
  visibility: Visibility;
  groups?: string[];
  principals?: string[];
}

/** Pointer from a record to the evidence that supports (or contradicts) it, with an optional span. */
export interface EvidenceRef {
  evidenceId: string;
  /** Character span inside the evidence text, if the claim came from a specific passage. */
  span?: { start: number; end: number };
  /** Short quoted excerpt for display; always derived from the evidence text. */
  excerpt?: string;
}

export type SourceOrigin = 'reported' | 'inferred';

/** A named condition on an entity/environment (e.g. unit age, revision, link status). */
export interface Condition {
  key: string;
  operator: 'eq' | 'neq' | 'gte' | 'lte' | 'contains' | 'present' | 'absent';
  value?: string | number | boolean;
  origin: SourceOrigin;
  evidence: EvidenceRef[];
  /** Human-readable rendering, e.g. "Interface UP, counters zero". */
  label?: string;
}

/** Explicit inference routes. Every model-dependent output carries one. */
export type Route = 'rules' | 'local' | 'replay' | 'claude-agent-arm';

export interface RouteInfo {
  route: Route;
  /** Implementation/version label, e.g. "rules-extractor@1", "linucb@0.2", "replay:e01-claude-arm-2026-11-07". */
  version: string;
}

export interface TraceEvent {
  id: string;
  at: Iso;
  type: string;
  /** The decision/trace this event belongs to (investigation id, question id, ...). */
  traceId: string;
  actor?: ActorRef | { id: 'system' | 'agent'; displayName: string };
  data?: Record<string, unknown>;
}
