/** Small text helpers shared by the evaluator (pure, deterministic). */

const STOP = new Set(['a', 'an', 'the', 'of', 'to', 'on', 'in', 'and', 'is', 'are', 'was', 'were', 'at', 'by', 'for', 'with', 'after', 'that', 'it', 'as', 'be', 'this', 'there', 'then']);

export function tokens(s: string): Set<string> {
  const out = new Set<string>();
  for (const t of s.toLowerCase().replace(/[^\p{L}\p{N}.\-]+/gu, ' ').split(/\s+/)) {
    const clean = t.replace(/^[.\-]+|[.\-]+$/g, '');
    if (clean && !STOP.has(clean)) out.add(clean);
  }
  return out;
}

/** Token Jaccard similarity of two statements, in [0, 1]. Two empty statements score 0. */
export function jaccard(a: string, b: string): number {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  return inter / (ta.size + tb.size - inter);
}

/** "email:<id@host>" and "email:id@host" compare equal; provider is lower-cased. */
export function normalizeSourceId(id: string): string {
  const i = id.indexOf(':');
  if (i < 0) return id.trim();
  const provider = id.slice(0, i).toLowerCase();
  let rest = id.slice(i + 1).trim();
  if (provider === 'email') rest = rest.replace(/^<|>$/g, '');
  return `${provider}:${rest}`;
}

export function normName(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim();
}
