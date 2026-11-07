/**
 * Recorded model outputs for E08/E09 (offline reproducibility, D-B2-39). A model output is recorded ONCE from the local
 * Ollama into data/replays/<fixture>/ with `node experiments/run.ts e08|e09 --record` (the only mode that lifts the
 * network guard, for 127.0.0.1:11434 alone). Every other run replays the fixture through models/replay.ts ReplayProvider:
 * each entry carries the hash of the exact input that produced it, so a changed prompt, schema, text or model is a
 * ReplayMismatchError or a missing recording, never a silently different number; and the hash of its output, so an
 * edited output is a ReplayOutputMismatchError.
 *
 * Nothing here is an application route: the stored claims of a replayed run carry route 'replay'.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashInput, ReplayProvider, type ReplayEntry, type ReplayFixture } from '../src/libs/utils/models/replay.ts';
import { ProviderError, type CallOptions, type ModelProvider } from '../src/libs/utils/models/providers/index.ts';
import type { Embedder } from '../src/libs/utils/retrieval/index.ts';

export const REPLAYS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'replays');
export type ReplayMode = 'replay' | 'record';

/** Fixture directory name for a model: e08-bge-m3, e09-qwen3-4b ... */
export const fixtureDir = (experiment: 'e08' | 'e09', model: string): string => join(REPLAYS_DIR, `${experiment}-${model.replace(/:latest$/, '').replace(/[^A-Za-z0-9.]+/g, '-')}`);

export interface ReplayStats {
  served: number;
  recorded: number;
  /** Lookups with no recording in replay mode (each one made the caller fall back). */
  missing: number;
}

class FixtureFile<T> {
  readonly path: string;
  readonly fixture: ReplayFixture<T>;
  readonly provider: ReplayProvider<T>;
  dirty = false;
  constructor(path: string, id: string) {
    this.path = path;
    this.fixture = existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as ReplayFixture<T>) : { id, entries: {} };
    // shares fixture.entries, so recorded entries are served at once; every entry's output is hash-locked (D-B2-61)
    this.provider = new ReplayProvider<T>(this.fixture, { requireOutputHash: true });
  }
  put(key: string, input: unknown, output: T, recordedBy: string): void {
    this.fixture.entries[key] = { inputHash: hashInput(input), outputHash: hashInput(output), output, recordedBy } satisfies ReplayEntry<T>;
    this.dirty = true;
  }
  save(): void {
    if (!this.dirty) return;
    mkdirSync(dirname(this.path), { recursive: true });
    const sorted = Object.fromEntries(Object.keys(this.fixture.entries).sort().map((k) => [k, this.fixture.entries[k]!]));
    writeFileSync(this.path, JSON.stringify({ id: this.fixture.id, entries: sorted }, null, 1) + '\n');
    this.dirty = false;
  }
}

const toB64 = (v: Float32Array): string => Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString('base64');
const fromB64 = (s: string): Float32Array => {
  const b = Buffer.from(s, 'base64');
  return new Float32Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

/**
 * Embeddings, one entry per (model, text), vectors stored as base64 float32. In record mode a text with no recording is
 * embedded by `live` and stored; in replay mode it throws ProviderError('model-missing') so the retriever's labelled
 * trigram fallback stands in and the runner counts it.
 */
export class RecordedEmbedder implements Embedder {
  readonly stats: ReplayStats = { served: 0, recorded: 0, missing: 0 };
  private readonly file: FixtureFile<string>;
  private readonly mode: ReplayMode;
  private readonly live: Embedder | undefined;
  private readonly recordedBy: string;
  constructor(path: string, opts: { mode: ReplayMode; live?: Embedder; recordedBy?: string }) {
    this.file = new FixtureFile<string>(path, 'embeddings');
    this.mode = opts.mode;
    this.live = opts.live;
    this.recordedBy = opts.recordedBy ?? 'unknown';
    if (this.mode === 'record' && !this.live) throw new Error('record mode needs a live embedder');
  }
  static key(model: string, text: string): string {
    return `${model}|${hashInput(text)}`;
  }
  async embed(model: string, texts: string[], opts?: CallOptions): Promise<Float32Array[]> {
    const out: Array<Float32Array | undefined> = texts.map((text) => {
      const e = this.file.provider.get(RecordedEmbedder.key(model, text), { model, text });
      return e ? fromB64(e.output) : undefined;
    });
    const todo = texts.map((t, i) => ({ t, i })).filter((x) => !out[x.i]);
    if (todo.length && this.mode === 'replay') {
      this.stats.missing += todo.length;
      throw new ProviderError('model-missing', `no recorded embedding for ${todo.length} text(s) under ${model} in ${this.file.path}; record with --record`);
    }
    if (todo.length) {
      const vecs = await this.live!.embed(model, todo.map((x) => x.t), opts);
      todo.forEach((x, j) => {
        this.file.put(RecordedEmbedder.key(model, x.t), { model, text: x.t }, toB64(vecs[j]!), this.recordedBy);
        out[x.i] = vecs[j]!;
      });
      this.stats.recorded += todo.length;
    }
    this.stats.served += texts.length - todo.length;
    return out as Float32Array[];
  }
  save(): void {
    this.file.save();
  }
}

export interface RecordedJson {
  value: unknown;
  /** The call failed when recorded (bad JSON, timeout ...): replay throws the same ProviderError. */
  error?: { code: ProviderError['code']; message: string };
  /** Wall-clock milliseconds of the recorded call (the live latency, kept for the budget discussion). */
  ms: number;
}

/**
 * Schema-constrained generations (the extract slot), one entry per (model, prompt); the input hash also covers the
 * JSON schema and the seed. Same record/replay rules as RecordedEmbedder.
 */
export class RecordedGenerator implements Pick<ModelProvider, 'kind' | 'generateJson'> {
  readonly kind = 'local' as const;
  readonly stats: ReplayStats & { recordedMs: number[] } = { served: 0, recorded: 0, missing: 0, recordedMs: [] };
  private readonly file: FixtureFile<RecordedJson>;
  private readonly mode: ReplayMode;
  private readonly live: Pick<ModelProvider, 'generateJson'> | undefined;
  private readonly recordedBy: string;
  constructor(path: string, opts: { mode: ReplayMode; live?: Pick<ModelProvider, 'generateJson'>; recordedBy?: string }) {
    this.file = new FixtureFile<RecordedJson>(path, 'generations');
    this.mode = opts.mode;
    this.live = opts.live;
    this.recordedBy = opts.recordedBy ?? 'unknown';
    if (this.mode === 'record' && !this.live) throw new Error('record mode needs a live provider');
  }
  /** Latency of every recorded call this fixture holds (ms). */
  recordedLatencies(): number[] {
    return Object.values(this.file.fixture.entries).map((e) => e.output.ms);
  }
  async generateJson(model: string, prompt: string, jsonSchema: Record<string, unknown>, opts?: CallOptions): Promise<unknown> {
    const key = `${model}|${hashInput(prompt)}`;
    const input = { model, prompt, jsonSchema, seed: opts?.seed ?? null };
    const hit = this.file.provider.get(key, input);
    if (hit) {
      this.stats.served++;
      if (hit.output.error) throw new ProviderError(hit.output.error.code, hit.output.error.message);
      return hit.output.value;
    }
    if (this.mode === 'replay') {
      this.stats.missing++;
      throw new ProviderError('model-missing', `no recorded generation for this prompt under ${model} in ${this.file.path}; record with --record`);
    }
    const t0 = performance.now();
    let value: unknown;
    try {
      value = await this.live!.generateJson(model, prompt, jsonSchema, opts);
    } catch (e) {
      // A provider failure is an outcome of the model too: record it so the replay fails the same way.
      if (!(e instanceof ProviderError) || e.code === 'unreachable' || e.code === 'model-missing') throw e;
      const ms = Math.round(performance.now() - t0);
      this.file.put(key, input, { value: null, ms, error: { code: e.code, message: e.message } }, this.recordedBy);
      this.file.save();
      this.stats.recorded++;
      this.stats.recordedMs.push(ms);
      throw e;
    }
    const ms = Math.round(performance.now() - t0);
    this.file.put(key, input, { value, ms }, this.recordedBy);
    this.file.save(); // a long recording survives an interruption
    this.stats.recorded++;
    this.stats.recordedMs.push(ms);
    return value;
  }
  save(): void {
    this.file.save();
  }
}
