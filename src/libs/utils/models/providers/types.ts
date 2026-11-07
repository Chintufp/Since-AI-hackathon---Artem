/**
 * Model provider interface for the three slots (embed / extract / phrase). Imports contracts only.
 * A provider proposes; nothing it returns is ever written to memory without commitProposal.
 */
import type { ModelSlotName } from '../../contracts/index.ts';

/** The fetch the providers use; tests inject a fake. */
export type FetchFn = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal }) => Promise<Response>;

export interface ModelInfo {
  name: string;
  sizeBytes?: number;
  family?: string;
  parameterSize?: string;
  /** Ollama capabilities, e.g. 'embedding', 'completion', 'tools', 'thinking'. */
  capabilities: string[];
}

export interface DetectResult {
  /** The provider program exists on this machine (Ollama: `which ollama` found it, or the server answers). */
  installed: boolean;
  /** The server answers. */
  running: boolean;
  version?: string;
  binaryPath?: string;
  models: ModelInfo[];
  freeDiskBytes?: number;
  totalMemBytes?: number;
  /** Why detection is partial (server down, ...). */
  note?: string;
}

export interface CallOptions {
  timeoutMs?: number;
  seed?: number;
  /** Ollama keep_alive for this call (default '30m'). */
  keepAlive?: string | number;
  system?: string;
  maxTokens?: number;
}

export interface PullProgress {
  status: string;
  digest?: string;
  total?: number;
  completed?: number;
  /** 0..100 over the layer being downloaded, when total is known. */
  percent?: number;
}

export interface ModelProvider {
  readonly kind: 'local' | 'api';
  embed(model: string, texts: string[], opts?: CallOptions): Promise<Float32Array[]>;
  /** Output constrained by `jsonSchema`; returns the parsed JSON value (not yet validated by the caller's zod schema). */
  generateJson(model: string, prompt: string, jsonSchema: Record<string, unknown>, opts?: CallOptions): Promise<unknown>;
  generateText(model: string, prompt: string, opts?: CallOptions): Promise<string>;
  /** Load the model and keep it for `keepAlive` (Ollama: an empty request). `embedding` picks /api/embed. */
  warm(model: string, keepAlive?: string | number, opts?: { embedding?: boolean }): Promise<void>;
  /** Unload now (Ollama: keep_alive 0). */
  unload(model: string, opts?: { embedding?: boolean }): Promise<void>;
  detect(): Promise<DetectResult>;
  /** Download a model, reporting progress; resolves on success, rejects with the provider's error. */
  pull(model: string, onProgress: (p: PullProgress) => void, opts?: { signal?: AbortSignal }): Promise<void>;
}

/** Per-slot call timeouts (BUILD_BRIEF 2.3): embed 5 s, extract 60 s, phrase 20 s. */
export const SLOT_TIMEOUT_MS: Record<ModelSlotName, number> = { embed: 5_000, extract: 60_000, phrase: 20_000 };

export class ProviderError extends Error {
  readonly code: 'timeout' | 'unreachable' | 'http' | 'bad-response' | 'disabled' | 'unsupported' | 'model-missing';
  constructor(code: ProviderError['code'], message: string) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}

/** Abort after `ms`, also when an outer signal aborts. */
export function timeoutSignal(ms: number | undefined, outer?: AbortSignal): AbortSignal | undefined {
  const sigs = [ms ? AbortSignal.timeout(ms) : undefined, outer].filter((s): s is AbortSignal => !!s);
  if (!sigs.length) return undefined;
  return sigs.length === 1 ? sigs[0] : AbortSignal.any(sigs);
}

/** Map a thrown fetch/abort error to a ProviderError. */
export function asProviderError(e: unknown, what: string): ProviderError {
  if (e instanceof ProviderError) return e;
  const err = e as { name?: string; message?: string };
  if (err?.name === 'TimeoutError' || err?.name === 'AbortError') return new ProviderError('timeout', `${what}: timed out`);
  return new ProviderError('unreachable', `${what}: ${err?.message ?? String(e)}`);
}
