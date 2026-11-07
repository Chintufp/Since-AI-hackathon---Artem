import type { ConversationContext, EvidenceEnvelope, KnowledgeStore } from '../contracts/index.ts';
import { compareTime } from '../connectors/time.ts';

export interface AssembledContext extends ConversationContext {
  /** Grouping key: threadId, or channel+day for un-threaded Slack messages. */
  key: string;
  /** Quoted/forwarded segments excluded from extraction (kept in the store with lineage). */
  skippedSegments: string[];
}

export interface AssembleOptions {
  aliases?: Record<string, string[]>;
}

function groupKey(e: EvidenceEnvelope): string {
  if (e.thread.threadId) return e.thread.threadId;
  if (e.provider === 'slack') {
    const day = e.eventTime.known && e.eventTime.iso ? e.eventTime.iso.slice(0, 10) : 'unknown-day';
    return `slack:${e.thread.channel ?? 'channel'}:${day}`;
  }
  return `single:${e.id}`;
}

/**
 * Group evidence into conversation windows and order each by time (when known) or sequence.
 * Superseded revisions and derived quoted segments are excluded; originals stay in the store.
 */
export function assembleContexts(evidence: EvidenceEnvelope[], options: AssembleOptions = {}): AssembledContext[] {
  const groups = new Map<string, { items: EvidenceEnvelope[]; skipped: string[] }>();
  for (const e of evidence) {
    const key = groupKey(e);
    const g = groups.get(key) ?? groups.set(key, { items: [], skipped: [] }).get(key)!;
    if (e.metadata?.supersededBy) continue;
    if (e.metadata?.segment === 'quoted') {
      g.skipped.push(e.id);
      continue;
    }
    g.items.push(e);
  }
  const out: AssembledContext[] = [];
  for (const [key, g] of groups) {
    if (!g.items.length) continue;
    const items = [...g.items].sort(
      (a, b) => compareTime(a.eventTime, b.eventTime) || (a.thread.position ?? 0) - (b.thread.position ?? 0),
    );
    out.push({ key, evidence: items, aliases: options.aliases, skippedSegments: g.skipped });
  }
  return out;
}

/** Load contexts for the given evidence ids (or every non-superseded evidence record of an org). */
export function loadContexts(store: KnowledgeStore, orgId: string, evidenceIds?: string[], options: AssembleOptions = {}): AssembledContext[] {
  let evidence: EvidenceEnvelope[];
  if (evidenceIds) {
    const threads = new Set<string>();
    const seeds = evidenceIds.map((id) => store.get('evidence', id)).filter((e): e is EvidenceEnvelope => !!e);
    for (const e of seeds) if (e.thread.threadId) threads.add(e.thread.threadId);
    const ids = new Set(evidenceIds);
    evidence = [...threads].flatMap((t) => store.list('evidence', { where: { threadId: t, orgId } }));
    evidence.push(...seeds.filter((e) => !e.thread.threadId && ids.has(e.id)));
    // un-threaded Slack messages: pull the same channel+day neighbours
    for (const e of seeds) {
      if (!e.thread.threadId && e.provider === 'slack') {
        const k = groupKey(e);
        evidence.push(...store.list('evidence', { where: { orgId, provider: 'slack' } }).filter((x) => !x.thread.threadId && groupKey(x) === k && x.id !== e.id));
      }
    }
    evidence = [...new Map(evidence.map((e) => [e.id, e])).values()];
  } else evidence = store.list('evidence', { where: { orgId } });
  return assembleContexts(evidence, options);
}

/**
 * Text used for extraction: the original text with quoted/forwarded spans blanked to spaces.
 * Same length as the original, so spans computed on it are valid offsets into the stored evidence.
 */
export function extractionText(e: EvidenceEnvelope): string {
  const spans = (e.metadata?.quotedSpans as Array<{ start: number; end: number }> | undefined) ?? [];
  if (!spans.length) return e.text;
  let t = e.text;
  for (const s of spans) {
    const blank = t.slice(s.start, s.end).replace(/[^\n]/g, ' ');
    t = t.slice(0, s.start) + blank + t.slice(s.end);
  }
  return t;
}
