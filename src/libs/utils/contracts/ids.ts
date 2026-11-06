import { createHash, randomUUID } from 'node:crypto';

/** Deterministic id from namespace parts: same inputs → same id, so re-imports are idempotent. */
export function stableId(prefix: string, ...parts: Array<string | number | undefined>): string {
  const h = createHash('sha256').update(parts.map((p) => String(p ?? '')).join('\u0000')).digest('hex');
  return `${prefix}_${h.slice(0, 20)}`;
}

/** Fingerprint of normalized text; copies of one message share it. */
export function textFingerprint(text: string): string {
  const norm = text.toLowerCase().replace(/\s+/g, ' ').replace(/[^\p{L}\p{N} ]/gu, '').trim();
  return createHash('sha256').update(norm).digest('hex').slice(0, 24);
}

export function freshId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, '').slice(0, 20)}`;
}
