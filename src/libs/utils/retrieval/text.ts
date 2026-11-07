const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'are', 'was', 'were', 'but', 'not', 'has', 'had', 'have', 'its', 'from',
  'into', 'then', 'than', 'they', 'them', 'there', 'their', 'what', 'when', 'which', 'will', 'would', 'could', 'should',
  'been', 'being', 'does', 'did', 'doe', 'our', 'out', 'any', 'all', 'can', 'you', 'your', 'who', 'how', 'why',
]);

const stem = (w: string): string => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);

/** Lowercase tokens; identifiers like "sw-17" keep the whole token plus its parts; light plural stemming. */
export function tokenize(text: string): string[] {
  const out: string[] = [];
  for (const m of text.toLowerCase().matchAll(/[\p{L}\p{N}]+(?:[._-][\p{L}\p{N}]+)*/gu)) {
    const whole = m[0];
    const parts = whole.split(/[._-]/);
    if (parts.length > 1) out.push(whole);
    for (const p of parts) {
      const s = stem(p);
      if (s.length > 1 && !STOP.has(s)) out.push(s);
    }
  }
  return out;
}

export const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
