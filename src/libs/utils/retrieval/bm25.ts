import { tokenize } from './text.ts';

export interface Bm25Hit {
  key: string;
  score: number;
}

/** Plain BM25 (k1=1.2, b=0.75) over an in-memory document list. */
export class Bm25Index {
  private tf = new Map<string, Map<string, number>>();
  private len = new Map<string, number>();
  private df = new Map<string, number>();
  private avg = 0;

  private k1: number;
  private b: number;

  constructor(docs: Array<{ key: string; text: string }>, k1 = 1.2, b = 0.75) {
    this.k1 = k1;
    this.b = b;
    let total = 0;
    for (const d of docs) {
      const toks = tokenize(d.text);
      const counts = new Map<string, number>();
      for (const t of toks) counts.set(t, (counts.get(t) ?? 0) + 1);
      this.tf.set(d.key, counts);
      this.len.set(d.key, toks.length);
      total += toks.length;
      for (const t of counts.keys()) this.df.set(t, (this.df.get(t) ?? 0) + 1);
    }
    this.avg = docs.length ? total / docs.length : 0;
  }

  search(query: string, limit = 50): Bm25Hit[] {
    const n = this.tf.size;
    const q = [...new Set(tokenize(query))];
    const hits: Bm25Hit[] = [];
    for (const [key, counts] of this.tf) {
      let score = 0;
      const dl = this.len.get(key) ?? 0;
      for (const t of q) {
        const f = counts.get(t);
        if (!f) continue;
        const df = this.df.get(t) ?? 0;
        const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
        score += (idf * (f * (this.k1 + 1))) / (f + this.k1 * (1 - this.b + (this.b * dl) / (this.avg || 1)));
      }
      if (score > 0) hits.push({ key, score });
    }
    return hits.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key)).slice(0, limit);
  }
}
