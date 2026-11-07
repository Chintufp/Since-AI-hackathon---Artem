import type { EvidenceEnvelope, KnowledgeStore } from '../contracts/index.ts';
import { textFingerprint } from '../contracts/index.ts';

export const MIN_COPY_WORDS = 5;

const STOP = new Set(
  'that this with have from they them their there then than were what when will would could should about after before which while where your yours been being into some also just only very more most such like even over under again still does doesn have hasn isn aren wasn weren don didn'.split(' '),
);

export const wordCount = (s: string): number => (s.match(/[\p{L}\p{N}']+/gu) ?? []).length;

export function contentTokens(text: string): Set<string> {
  const toks = text.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  return new Set(toks.filter((t) => !STOP.has(t)));
}

/** Strip common "Name:" / "[09:14] Name:" / "09:14 Name:" line prefixes so a pasted chat line matches the original message. */
function stripChatPrefix(line: string): string {
  return line.replace(/^\s*(\[?\d{1,2}:\d{2}(:\d{2})?\]?\s*[-–]?\s*)?([\p{L}][\p{L} .'-]{0,40}:\s+)?/u, '').trim();
}

/** Candidate chunks of a quoted block: each line and windows of 2-3 consecutive lines, prefixes stripped. */
export function quotedChunks(text: string): string[] {
  const lines = text.split('\n').map(stripChatPrefix).filter(Boolean);
  const out = new Set<string>();
  for (let i = 0; i < lines.length; i++) {
    for (let w = 1; w <= 3 && i + w <= lines.length; w++) {
      const chunk = lines.slice(i, i + w).join(' ');
      if (wordCount(chunk) >= MIN_COPY_WORDS) out.add(chunk);
    }
  }
  return [...out];
}

export interface CopyDetection {
  copiedFrom: string[];
  /** For quoted segments: chunks (>= MIN_COPY_WORDS words) that matched existing evidence, with denominator. */
  quoted?: { matchedChunks: number; totalChunks: number };
}

/** Exact copy detection by normalized-text fingerprint (whole text, and for quoted segments by chunk). */
export function detectCopies(store: KnowledgeStore, env: EvidenceEnvelope, sourceKey: string): CopyDetection {
  const found = new Set<string>();
  const other = (e: EvidenceEnvelope) =>
    e.metadata?.sourceKey !== sourceKey && e.id !== env.id && (e.thread.threadId ?? e.id) !== (env.thread.threadId ?? env.id);
  if (wordCount(env.text) >= MIN_COPY_WORDS && env.metadata?.segment !== 'quoted') {
    for (const e of store.list('evidence', { where: { sourceFingerprint: env.lineage.sourceFingerprint } })) if (other(e)) found.add(e.id);
  }
  if (env.metadata?.segment === 'quoted') {
    const chunks = quotedChunks(env.text);
    let matched = 0;
    for (const c of chunks) {
      const hits = store.list('evidence', { where: { sourceFingerprint: textFingerprint(c) } }).filter(
        (e) => other(e) && e.metadata?.segment !== 'quoted' && !e.metadata?.supersededBy,
      );
      if (hits.length) {
        matched++;
        for (const h of hits) found.add(h.id);
      }
    }
    return { copiedFrom: [...found], quoted: { matchedChunks: matched, totalChunks: chunks.length } };
  }
  return { copiedFrom: [...found] };
}

export interface RetellingMatch {
  evidenceIds: string[];
  containment: number;
  sharedTerms: number;
  method: 'content-token-containment@1';
}

export const RETELLING_MIN_CONTAINMENT = 0.3;
export const RETELLING_MIN_SHARED = 8;

/**
 * Heuristic (not proof): a free-text email/note whose content words are largely contained in another
 * thread is flagged as a likely retelling. It is recorded in metadata.retellingOf, never as lineage.copiedFrom,
 * and is used only to avoid counting the retelling as an independent confirmation.
 */
export function findRetelling(store: KnowledgeStore, env: EvidenceEnvelope, sourceKey: string): RetellingMatch | undefined {
  if (env.kind !== 'email' && env.kind !== 'note') return undefined;
  const text = (env.metadata?.freshText as string | undefined) ?? env.text;
  const toks = contentTokens(text);
  if (toks.size < RETELLING_MIN_SHARED) return undefined;
  const hits = store.searchText(['evidence'], [...toks].slice(0, 60).join(' '), 60);
  const byThread = new Map<string, EvidenceEnvelope[]>();
  for (const h of hits) {
    const e = store.get('evidence', h.id);
    if (!e || e.metadata?.sourceKey === sourceKey || e.metadata?.segment === 'quoted' || e.metadata?.supersededBy) continue;
    const tid = e.thread.threadId ?? e.id;
    if (tid === env.thread.threadId) continue;
    (byThread.get(tid) ?? byThread.set(tid, []).get(tid)!).push(e);
  }
  let best: RetellingMatch | undefined;
  for (const [tid, first] of byThread) {
    const all = first[0]!.thread.threadId ? store.list('evidence', { where: { threadId: tid } }) : first;
    const pool = new Set<string>();
    for (const e of all) if (!e.metadata?.supersededBy) for (const t of contentTokens(e.text)) pool.add(t);
    const shared = [...toks].filter((t) => pool.has(t)).length;
    const containment = shared / toks.size;
    if (shared >= RETELLING_MIN_SHARED && containment >= RETELLING_MIN_CONTAINMENT && (!best || containment > best.containment)) {
      best = { evidenceIds: all.filter((e) => !e.metadata?.supersededBy).map((e) => e.id), containment: Number(containment.toFixed(3)), sharedTerms: shared, method: 'content-token-containment@1' };
    }
  }
  return best;
}
