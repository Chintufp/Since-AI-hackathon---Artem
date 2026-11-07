/**
 * LOCAL, NOT LEARNED vector route: hashed character-trigram embeddings (512 dims, signed hashing, L2-normalised).
 * It captures surface similarity only; it is not a trained encoder and is never a probability of success.
 */
export const VECTOR_DIMS = 512;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function embedTrigrams(text: string, dims = VECTOR_DIMS): Float64Array {
  const v = new Float64Array(dims);
  const norm = ` ${text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `;
  const counts = new Map<string, number>();
  for (let i = 0; i + 3 <= norm.length; i++) {
    const g = norm.slice(i, i + 3);
    counts.set(g, (counts.get(g) ?? 0) + 1);
  }
  for (const [g, c] of counts) {
    const idx = fnv1a(g) % dims;
    const sign = (fnv1a(`~${g}`) & 1) === 0 ? 1 : -1;
    v[idx] = (v[idx] as number) + sign * Math.log1p(c);
  }
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < dims; i++) v[i] = (v[i] as number) / n;
  return v;
}

export const cosine = (a: Float64Array, b: Float64Array): number => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] as number) * (b[i] as number);
  return s;
};

export class TrigramIndex {
  private vecs = new Map<string, Float64Array>();
  private dims: number;
  constructor(docs: Array<{ key: string; text: string }>, dims = VECTOR_DIMS) {
    this.dims = dims;
    for (const d of docs) this.vecs.set(d.key, embedTrigrams(d.text, dims));
  }

  search(query: string, limit = 50, minCosine = 0.12): Array<{ key: string; score: number }> {
    const q = embedTrigrams(query, this.dims);
    const hits: Array<{ key: string; score: number }> = [];
    for (const [key, v] of this.vecs) {
      const s = cosine(q, v);
      if (s >= minCosine) hits.push({ key, score: s });
    }
    return hits.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key)).slice(0, limit);
  }
}
