import type { AccessScope, AttachmentRef, EvidenceEnvelope, EvidenceKind, ActorRef, Provider, TimeRef } from '../contracts/index.ts';
import { stableId, textFingerprint } from '../contracts/index.ts';

/** Options shared by every adapter. Adapters are pure: they read their input and return envelopes. */
export interface AdapterOptions {
  orgId: string;
  connectionId?: string;
  /** Import batch id stamped into lineage (ingest may restamp). */
  batchId?: string;
  ingestedAt?: string;
  /** When non-empty the imported evidence is group-scoped to these groups; otherwise org-wide. */
  accessGroups?: string[];
  /** Locator for the source (file path), kept as `reference`. */
  reference?: string;
}

export const resolveAccess = (groups?: string[], fallback: AccessScope = { visibility: 'org' }): AccessScope =>
  groups && groups.length ? { visibility: 'group', groups: [...groups] } : fallback;

export interface EnvelopeInput {
  orgId: string;
  provider: Provider;
  connectionId: string;
  sourceId: string;
  revision?: string;
  kind: EvidenceKind;
  text: string;
  reference?: string;
  author: ActorRef;
  recipients?: ActorRef[];
  eventTime: TimeRef;
  ingestedAt?: string;
  thread?: EvidenceEnvelope['thread'];
  accessScope: AccessScope;
  batchId?: string;
  copiedFrom?: string[];
  derivedFrom?: string[];
  attachments?: AttachmentRef[];
  metadata?: Record<string, unknown>;
}

export function makeEnvelope(i: EnvelopeInput): EvidenceEnvelope {
  const revision = i.revision ?? '1';
  const env: EvidenceEnvelope = {
    id: stableId('ev', i.orgId, i.provider, i.connectionId, i.sourceId, revision),
    orgId: i.orgId,
    provider: i.provider,
    connectionId: i.connectionId,
    sourceId: i.sourceId,
    revision,
    kind: i.kind,
    text: i.text,
    author: i.author,
    eventTime: i.eventTime,
    ingestedAt: i.ingestedAt ?? new Date().toISOString(),
    thread: i.thread ?? {},
    accessScope: i.accessScope,
    lineage: {
      importBatchId: i.batchId ?? 'unassigned',
      sourceFingerprint: textFingerprint(i.text),
      ...(i.copiedFrom?.length ? { copiedFrom: i.copiedFrom } : {}),
      ...(i.derivedFrom?.length ? { derivedFrom: i.derivedFrom } : {}),
    },
  };
  if (i.reference) env.reference = i.reference;
  if (i.recipients?.length) env.recipients = i.recipients;
  if (i.attachments?.length) env.attachments = i.attachments;
  if (i.metadata) env.metadata = i.metadata;
  return env;
}

export const normName = (s: string): string => s.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
