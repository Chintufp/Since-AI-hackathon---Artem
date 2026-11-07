import type { ModelArtifact } from '../contracts/index.ts';
import { createRng, shuffleInPlace } from './rng.ts';

export interface LabeledText {
  text: string;
  label: 0 | 1;
}

export interface TrainOptions {
  epochs?: number;
  learningRate?: number;
  l2?: number;
  seed?: number;
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Hashed features over lowercase tokens and token bigrams (signed hashing, sparse). */
export function hashedFeatures(text: string, dim: number): Map<number, number> {
  const toks = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  const grams = [...toks, ...toks.slice(1).map((t, i) => `${toks[i]}_${t}`)];
  const f = new Map<number, number>();
  for (const g of grams) {
    const h = fnv1a(g);
    const idx = h % dim;
    const sign = (fnv1a(`#${g}`) & 1) === 0 ? 1 : -1;
    f.set(idx, (f.get(idx) ?? 0) + sign);
  }
  // L2 normalize so document length does not dominate the step size
  let n = 0;
  for (const v of f.values()) n += v * v;
  n = Math.sqrt(n) || 1;
  for (const [k, v] of f) f.set(k, v / n);
  return f;
}

/** Logistic regression over hashed text features trained by seeded SGD. Pure TS, deterministic. */
export class LogisticHashed {
  readonly dim: number;
  weights: Float64Array;
  bias = 0;
  trainedOn = 0;

  constructor(dim = 4096) {
    this.dim = dim;
    this.weights = new Float64Array(dim);
  }

  private z(f: Map<number, number>): number {
    let s = this.bias;
    for (const [i, v] of f) s += (this.weights[i] as number) * v;
    return s;
  }

  predictProba(text: string): number {
    const z = this.z(hashedFeatures(text, this.dim));
    return 1 / (1 + Math.exp(-z));
  }

  predict(text: string): 0 | 1 {
    return this.predictProba(text) >= 0.5 ? 1 : 0;
  }

  train(data: LabeledText[], opts: TrainOptions = {}): void {
    const { epochs = 30, learningRate = 0.5, l2 = 1e-4, seed = 1 } = opts;
    const rng = createRng(seed);
    const rows = data.map((d) => ({ f: hashedFeatures(d.text, this.dim), y: d.label }));
    for (let e = 0; e < epochs; e++) {
      shuffleInPlace(rows, rng);
      for (const { f, y } of rows) {
        const p = 1 / (1 + Math.exp(-this.z(f)));
        const g = p - y;
        for (const [i, v] of f) {
          const w = this.weights[i] as number;
          this.weights[i] = w - learningRate * (g * v + l2 * w);
        }
        this.bias -= learningRate * g;
      }
    }
    this.trainedOn = rows.length;
  }

  accuracy(data: LabeledText[]): number {
    if (data.length === 0) return 0;
    return data.filter((d) => this.predict(d.text) === d.label).length / data.length;
  }

  toArtifact(meta: { id: string; version?: string; trainedAt?: string; dataset: { id: string; split: string; families: string[] }; seeds: number[]; metrics?: Record<string, number> }): ModelArtifact {
    const sparse: Record<string, number> = {};
    this.weights.forEach((w, i) => {
      if (w !== 0) sparse[String(i)] = w;
    });
    return {
      id: meta.id,
      kind: 'logistic-hashed',
      version: meta.version ?? '1',
      trainedAt: meta.trainedAt ?? new Date().toISOString(),
      trainingDataset: meta.dataset,
      seeds: meta.seeds,
      parameters: { dim: this.dim, bias: this.bias, weights: sparse, trainedOn: this.trainedOn },
      ...(meta.metrics ? { metrics: meta.metrics } : {}),
    };
  }

  static fromArtifact(a: ModelArtifact): LogisticHashed {
    if (a.kind !== 'logistic-hashed') throw new Error(`Not a logistic-hashed artifact: ${a.kind}`);
    const p = a.parameters as { dim: number; bias: number; weights: Record<string, number>; trainedOn?: number };
    const m = new LogisticHashed(p.dim);
    m.bias = p.bias;
    for (const [i, w] of Object.entries(p.weights)) m.weights[Number(i)] = w;
    m.trainedOn = p.trainedOn ?? 0;
    return m;
  }
}
