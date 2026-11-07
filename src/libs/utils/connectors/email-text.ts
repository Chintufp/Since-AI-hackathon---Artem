import type { ActorRef, EvidenceEnvelope } from '../contracts/index.ts';
import { textFingerprint } from '../contracts/index.ts';
import { parseTimeRef } from './time.ts';
import { isReplySubject, normalizeSubject, splitEmailBody } from './quoted.ts';
import { makeEnvelope, normName, resolveAccess, type AdapterOptions } from './types.ts';

export const EMAIL_CONNECTION_ID = 'import:email:file';

export interface ParsedEmail {
  headers: Record<string, string>;
  body: string;
}

export function parseEmailHeaders(raw: string): ParsedEmail {
  const text = raw.replace(/\r\n/g, '\n');
  const lines = text.split('\n');
  const headers: Record<string, string> = {};
  let i = 0;
  let last = '';
  for (; i < lines.length; i++) {
    const l = lines[i]!;
    if (l.trim() === '') { i++; break; }
    const m = /^([A-Za-z][A-Za-z0-9-]*):\s?(.*)$/.exec(l);
    if (m) {
      last = m[1]!.toLowerCase();
      headers[last] = m[2]!.trim();
    } else if (/^\s+/.test(l) && last) headers[last] += ' ' + l.trim();
    else { i = 0; break; } // not a header block at all
  }
  if (!Object.keys(headers).length) return { headers: {}, body: text };
  return { headers, body: lines.slice(i).join('\n').trim() };
}

function parseAddr(s: string): ActorRef {
  const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(s);
  if (m) {
    const name = m[1]!.trim() || m[2]!.trim();
    return { id: `person:email:${normName(name)}`, displayName: name, provider: 'email' };
  }
  const bare = s.trim();
  return { id: `person:email:${normName(bare)}`, displayName: bare, provider: 'email' };
}

const addrList = (s: string | undefined): ActorRef[] =>
  (s ?? '').split(/[;,](?![^<]*>)/).map((x) => x.trim()).filter(Boolean).map(parseAddr);

/**
 * Parse one email. Returns the email envelope plus one derived envelope per quoted/forwarded segment
 * (lineage.derivedFrom = parent), so a retelling of a chat can carry copiedFrom after ingest.
 * The email envelope keeps the full original body; quoted spans are recorded in metadata.quotedSpans.
 */
export function parseEmailText(raw: string, opts: AdapterOptions): EvidenceEnvelope[] {
  const { headers, body } = parseEmailHeaders(raw);
  const connectionId = opts.connectionId ?? EMAIL_CONNECTION_ID;
  const subject = headers['subject'] ?? '';
  const from = parseAddr(headers['from'] ?? 'unknown sender');
  if (!headers['from']) from.id = 'person:email:unknown';
  const to = addrList(headers['to']).concat(addrList(headers['cc']));
  const msgId = headers['message-id']?.replace(/^<|>$/g, '');
  const sourceId = msgId ? `msgid:${msgId}` : `fp:${textFingerprint(`${headers['from'] ?? ''}|${headers['to'] ?? ''}|${subject}|${body}`)}`;
  const participants = [...new Set([from, ...to].map((a) => a.displayName.toLowerCase()))].sort().join('|');
  const threadId = `email:${normalizeSubject(subject)}:${textFingerprint(participants).slice(0, 8)}`;
  const split = splitEmailBody(body);
  const eventTime = headers['date'] ? parseTimeRef(headers['date']) : parseTimeRef(undefined);
  const parent = makeEnvelope({
    orgId: opts.orgId,
    provider: 'email',
    connectionId,
    sourceId,
    kind: 'email',
    text: body,
    reference: opts.reference,
    author: from,
    recipients: to,
    eventTime: { ...eventTime, sequence: 0 },
    ingestedAt: opts.ingestedAt,
    batchId: opts.batchId,
    thread: { threadId, subject, position: 0, ...(headers['in-reply-to'] ? { parentId: headers['in-reply-to'] } : {}) },
    accessScope: resolveAccess(opts.accessGroups),
    metadata: {
      isReply: isReplySubject(subject),
      subjectNormalized: normalizeSubject(subject),
      messageId: msgId,
      messageIdDerived: !msgId,
      freshText: split.fresh,
      quotedSpans: split.quoted.map((q) => ({ kind: q.kind, start: q.start, end: q.end })),
    },
  });
  const out = [parent];
  split.quoted.forEach((q, n) => {
    if (!q.text) return;
    out.push(
      makeEnvelope({
        orgId: opts.orgId,
        provider: 'email',
        connectionId,
        sourceId: `${sourceId}#quoted-${n + 1}`,
        kind: 'email',
        text: q.text,
        reference: opts.reference,
        author: from,
        eventTime: { known: false, sequence: 0 },
        ingestedAt: opts.ingestedAt,
        batchId: opts.batchId,
        thread: { threadId, subject, position: 0 },
        accessScope: parent.accessScope,
        derivedFrom: [parent.id],
        metadata: { segment: 'quoted', quoteKind: q.kind, parentSourceId: sourceId },
      }),
    );
  });
  return out;
}

