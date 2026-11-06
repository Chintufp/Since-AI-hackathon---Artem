import type { AccessScope, ActorRef, Iso, TimeRef } from './common.ts';

export type Provider = 'slack' | 'teams' | 'email' | 'paste' | 'file' | 'synthetic';
export type EvidenceKind = 'message' | 'email' | 'note' | 'attachment' | 'document' | 'observation';

export interface AttachmentRef {
  id: string;
  name: string;
  mimeType?: string;
  /** Local path or provider URL; never embedded bytes. */
  reference?: string;
  sizeBytes?: number;
}

/**
 * The common evidence record every connector and import produces.
 * id is deterministic from (orgId, provider, connectionId, sourceId, revision).
 */
export interface EvidenceEnvelope {
  id: string;
  orgId: string;
  provider: Provider;
  /** e.g. "import:teams:file", "import:email:file", "slack:T0123", "paste:desktop". */
  connectionId: string;
  /** Provider-stable identity: Slack ts, email Message-ID, Teams seq, file+line. */
  sourceId: string;
  revision: string;
  kind: EvidenceKind;
  text: string;
  /** Locator back to the source (file path, URL, channel permalink). */
  reference?: string;
  author: ActorRef;
  recipients?: ActorRef[];
  eventTime: TimeRef;
  ingestedAt: Iso;
  thread: {
    threadId?: string;
    parentId?: string;
    position?: number;
    channel?: string;
    subject?: string;
  };
  accessScope: AccessScope;
  lineage: {
    importBatchId: string;
    /** Evidence ids this record copies/quotes (e.g. an email retelling a Teams thread). */
    copiedFrom?: string[];
    /** Evidence ids this record was derived from (e.g. a paste that quotes a thread). */
    derivedFrom?: string[];
    /** textFingerprint(text) for copy detection. */
    sourceFingerprint: string;
  };
  attachments?: AttachmentRef[];
  metadata?: Record<string, unknown>;
}

export interface ImportBatch {
  id: string;
  orgId: string;
  connectionId: string;
  startedAt: Iso;
  finishedAt?: Iso;
  /** Counts with denominators so idempotence is visible. */
  counts: { seen: number; inserted: number; unchangedDuplicates: number; revised: number; copies: number };
  sourceDescription: string;
}

/** What an adapter can actually do. Missing capability is explicit. */
export interface ConnectorCapabilities {
  historicalImport: boolean;
  incrementalChanges: boolean;
  sourceLookup: boolean;
  threadContext: boolean;
  attachments: boolean;
  deletions: boolean;
  accessUpdates: boolean;
}

export type ConnectionStatus =
  | 'fixture-tested'
  | 'awaiting-authorization'
  | 'live-verified'
  | 'planned'
  | 'import-only';

export interface ConnectionCard {
  id: string;
  provider: Provider | 'microsoft365' | 'github' | 'jira' | 'confluence';
  label: string;
  status: ConnectionStatus;
  capabilities: ConnectorCapabilities;
  lastImportBatchId?: string;
  lastSyncAt?: Iso;
  note?: string;
}
