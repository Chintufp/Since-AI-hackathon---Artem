/** Embedding cache keyed by (model, sha256(text)): one model and one text always give the same vector. */
import { createHash } from 'node:crypto';
import type { ModelProvider, CallOptions } from './types.ts';

export const textHash = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');

export class EmbeddingCache {
  private readonly map = new Map<string, Float32Array>();
  private readonly max: number;
  constructor(max = 5000) {
    this.max = max;
  }
  private key = (model: string, text: string): string => `${model}\u0000${textHash(text)}`;
  get(model: string, text: string): Float32Array | undefined {
    return this.map.get(this.key(model, text));
  }
  set(model: string, text: string, v: Float32Array): void {
    const k = this.key(model, text);
    this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.max) this.map.delete(this.map.keys().next().value as string);
  }
  get size(): number {
    return this.map.size;
  }
  /** Embed through the cache: only texts not cached reach the provider, in one batch. */
  async embed(provider: Pick<ModelProvider, 'embed'>, model: string, texts: string[], opts?: CallOptions): Promise<Float32Array[]> {
    const out: Array<Float32Array | undefined> = texts.map((t) => this.get(model, t));
    const missing = [...new Set(texts.filter((_, i) => !out[i]))];
    if (missing.length) {
      const vecs = await provider.embed(model, missing, opts);
      missing.forEach((t, i) => this.set(model, t, vecs[i]!));
    }
    return texts.map((t, i) => out[i] ?? this.get(model, t)!);
  }
}
