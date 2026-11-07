import type { ActorRef, EvidenceEnvelope } from '../contracts/index.ts';
import { textFingerprint } from '../contracts/index.ts';
import { unknownTime } from '../contracts/index.ts';
import { makeEnvelope, resolveAccess, type AdapterOptions } from './types.ts';

export const PASTE_CONNECTION_ID = 'paste:desktop';

export interface PastePayload {
  text: string;
  attachmentNames?: string[];
  author?: ActorRef;
}

/** Text pasted into the desktop companion. The event time is unknown: it is never defaulted to ingestion time. */
export function parsePaste(payload: PastePayload, opts: AdapterOptions): EvidenceEnvelope[] {
  const names = payload.attachmentNames ?? [];
  const fp = textFingerprint(payload.text + '|' + names.join(','));
  return [
    makeEnvelope({
      orgId: opts.orgId,
      provider: 'paste',
      connectionId: opts.connectionId ?? PASTE_CONNECTION_ID,
      sourceId: `paste:${fp}`,
      kind: 'note',
      text: payload.text,
      author: payload.author ?? { id: 'person:paste:unknown', displayName: 'Unknown author', provider: 'paste' },
      eventTime: { ...unknownTime(), sequence: 0 },
      ingestedAt: opts.ingestedAt,
      batchId: opts.batchId,
      thread: { threadId: `paste:${fp}`, position: 0 },
      accessScope: resolveAccess(opts.accessGroups),
      attachments: names.map((n, i) => ({ id: `${fp}:${i}`, name: n })),
    }),
  ];
}
