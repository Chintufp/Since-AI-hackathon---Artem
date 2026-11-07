/**
 * Ollama on this Mac (http://127.0.0.1:11434). Injected fetch (default globalThis.fetch, looked up at call time so the
 * network guard still applies). Every generate sends think:false, temperature 0, a seed and keep_alive.
 */
import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import { homedir, totalmem } from 'node:os';
import { asProviderError, ProviderError, SLOT_TIMEOUT_MS, timeoutSignal, type CallOptions, type DetectResult, type FetchFn, type ModelInfo, type ModelProvider, type PullProgress } from './types.ts';

export const OLLAMA_URL = 'http://127.0.0.1:11434';
export const DEFAULT_KEEP_ALIVE = '30m';
export const DEFAULT_SEED = 7;

export interface OllamaSystem {
  /** Path of the ollama binary, or undefined. */
  which(): Promise<string | undefined>;
  totalMem(): number;
  freeDisk(): Promise<number | undefined>;
}

export const nodeSystem: OllamaSystem = {
  which: () => new Promise((resolve) => {
    execFile('which', ['ollama'], { timeout: 2000 }, (err, out) => resolve(err ? undefined : String(out).trim() || undefined));
  }),
  totalMem: () => totalmem(),
  freeDisk: async () => {
    try {
      const s = await statfs(homedir());
      return Number(s.bavail) * Number(s.bsize);
    } catch {
      return undefined;
    }
  },
};

export interface OllamaOptions {
  baseUrl?: string;
  fetch?: FetchFn;
  system?: OllamaSystem;
  /** Called with the model name after every successful call (the service's idle timer); `embedding` for /api/embed. */
  onUse?: (model: string, o?: { embedding?: boolean }) => void;
}

export class OllamaProvider implements ModelProvider {
  readonly kind = 'local' as const;
  readonly baseUrl: string;
  private readonly fetchFn: FetchFn;
  private readonly system: OllamaSystem;
  private readonly onUse: ((model: string, o?: { embedding?: boolean }) => void) | undefined;

  constructor(opts: OllamaOptions = {}) {
    this.baseUrl = (opts.baseUrl ?? OLLAMA_URL).replace(/\/+$/, '');
    this.fetchFn = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
    this.system = opts.system ?? nodeSystem;
    this.onUse = opts.onUse;
  }

  private async post(path: string, body: unknown, timeoutMs: number | undefined, outer?: AbortSignal): Promise<Response> {
    let res: Response;
    try {
      const signal = timeoutSignal(timeoutMs, outer);
      res = await this.fetchFn(this.baseUrl + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
    } catch (e) {
      throw asProviderError(e, `ollama ${path}`);
    }
    if (!res.ok) {
      let msg = `HTTP ${res.status}`;
      try {
        const j = (await res.json()) as { error?: string };
        if (j.error) msg = j.error;
      } catch { /* keep */ }
      throw new ProviderError(/not found/i.test(msg) ? 'model-missing' : 'http', `ollama ${path}: ${msg}`);
    }
    return res;
  }

  private async json<T>(res: Response, path: string): Promise<T> {
    try {
      return (await res.json()) as T;
    } catch (e) {
      throw (e as { name?: string }).name === 'TimeoutError' || (e as { name?: string }).name === 'AbortError'
        ? asProviderError(e, `ollama ${path}`) : new ProviderError('bad-response', `ollama ${path}: unreadable JSON`);
    }
  }

  async embed(model: string, texts: string[], opts: CallOptions = {}): Promise<Float32Array[]> {
    if (!texts.length) return [];
    const res = await this.post('/api/embed', { model, input: texts, keep_alive: opts.keepAlive ?? DEFAULT_KEEP_ALIVE }, opts.timeoutMs ?? SLOT_TIMEOUT_MS.embed);
    const j = await this.json<{ embeddings?: number[][] }>(res, '/api/embed');
    if (!Array.isArray(j.embeddings) || j.embeddings.length !== texts.length) throw new ProviderError('bad-response', `ollama /api/embed: expected ${texts.length} embeddings`);
    this.onUse?.(model, { embedding: true });
    return j.embeddings.map((v) => Float32Array.from(v));
  }

  private async generate(model: string, prompt: string, format: unknown, opts: CallOptions, defaultTimeout: number): Promise<string> {
    const body = {
      model, prompt, stream: false, think: false, keep_alive: opts.keepAlive ?? DEFAULT_KEEP_ALIVE,
      ...(opts.system ? { system: opts.system } : {}),
      ...(format !== undefined ? { format } : {}),
      options: { temperature: 0, seed: opts.seed ?? DEFAULT_SEED, ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}) },
    };
    const res = await this.post('/api/generate', body, opts.timeoutMs ?? defaultTimeout);
    const j = await this.json<{ response?: string }>(res, '/api/generate');
    if (typeof j.response !== 'string') throw new ProviderError('bad-response', 'ollama /api/generate: no response text');
    this.onUse?.(model);
    return j.response;
  }

  async generateJson(model: string, prompt: string, jsonSchema: Record<string, unknown>, opts: CallOptions = {}): Promise<unknown> {
    const text = await this.generate(model, prompt, jsonSchema, opts, SLOT_TIMEOUT_MS.extract);
    try {
      return JSON.parse(text);
    } catch {
      throw new ProviderError('bad-response', 'ollama /api/generate: output is not JSON');
    }
  }

  async generateText(model: string, prompt: string, opts: CallOptions = {}): Promise<string> {
    return (await this.generate(model, prompt, undefined, opts, SLOT_TIMEOUT_MS.phrase)).trim();
  }

  async warm(model: string, keepAlive: string | number = DEFAULT_KEEP_ALIVE, opts: { embedding?: boolean } = {}): Promise<void> {
    // An empty request loads the model and keeps it for keep_alive; nothing is generated.
    if (opts.embedding) await this.post('/api/embed', { model, input: [], keep_alive: keepAlive }, 60_000);
    else await this.post('/api/generate', { model, keep_alive: keepAlive }, 60_000);
  }

  async unload(model: string, opts: { embedding?: boolean } = {}): Promise<void> {
    await this.warm(model, 0, opts);
  }

  async detect(): Promise<DetectResult> {
    const [binaryPath, freeDiskBytes] = await Promise.all([this.system.which(), this.system.freeDisk()]);
    const totalMemBytes = this.system.totalMem();
    const base = { ...(binaryPath ? { binaryPath } : {}), ...(freeDiskBytes !== undefined ? { freeDiskBytes } : {}), totalMemBytes };
    let version: string | undefined;
    try {
      const r = await this.fetchFn(`${this.baseUrl}/api/version`, { signal: AbortSignal.timeout(2000) });
      if (r.ok) version = ((await r.json()) as { version?: string }).version;
    } catch {
      return { installed: !!binaryPath, running: false, models: [], ...base, note: 'Ollama is not answering on 127.0.0.1:11434' };
    }
    if (!version) return { installed: !!binaryPath, running: false, models: [], ...base, note: 'Ollama did not report a version' };
    let models: ModelInfo[] = [];
    try {
      const r = await this.fetchFn(`${this.baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) });
      const j = (await r.json()) as { models?: Array<{ name: string; size?: number; details?: { family?: string; parameter_size?: string }; capabilities?: string[] }> };
      models = (j.models ?? []).map((m) => ({
        name: m.name, ...(m.size !== undefined ? { sizeBytes: m.size } : {}),
        ...(m.details?.family ? { family: m.details.family } : {}), ...(m.details?.parameter_size ? { parameterSize: m.details.parameter_size } : {}),
        capabilities: m.capabilities ?? [],
      }));
    } catch {
      /* version answered; tags did not: keep the empty list */
    }
    return { installed: true, running: true, version, models, ...base };
  }

  async pull(model: string, onProgress: (p: PullProgress) => void, opts: { signal?: AbortSignal } = {}): Promise<void> {
    const res = await this.post('/api/pull', { model, stream: true }, undefined, opts.signal);
    if (!res.body) throw new ProviderError('bad-response', 'ollama /api/pull: no body');
    let success = false;
    try {
      for await (const line of ndjsonLines(res.body)) {
        let msg: { status?: string; error?: string; digest?: string; total?: number; completed?: number };
        try {
          msg = JSON.parse(line);
        } catch {
          continue;
        }
        if (msg.error) throw new ProviderError('http', `ollama pull ${model}: ${msg.error}`);
        const p: PullProgress = { status: msg.status ?? '', ...(msg.digest ? { digest: msg.digest } : {}) };
        if (typeof msg.total === 'number' && msg.total > 0) {
          p.total = msg.total;
          p.completed = msg.completed ?? 0;
          p.percent = Math.min(100, Math.floor((100 * p.completed) / msg.total));
        }
        onProgress(p);
        if (msg.status === 'success') success = true;
      }
    } catch (e) {
      throw asProviderError(e, `ollama pull ${model}`);
    }
    if (!success) throw new ProviderError('bad-response', `ollama pull ${model}: the stream ended without success`);
  }
}

/** Split a byte stream into non-empty lines (NDJSON). */
export async function* ndjsonLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const decoder = new TextDecoder();
  let buf = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line) yield line;
    }
  }
  buf += decoder.decode();
  if (buf.trim()) yield buf.trim();
}
