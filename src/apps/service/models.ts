/**
 * Model lifecycle in the service (BUILD_BRIEF 2.3): detect the machine, read the catalog, show a status chip per slot,
 * warm local slots at app start (spawning `ollama serve` when it is installed but not running), unload a model after
 * 30 minutes without a call, unload everything this service loaded on shutdown, download only on an explicit
 * POST /models/pull, and hold api keys in memory only (never SQLite, data/ or the repo).
 * Slots on rules or api start nothing: no process, no RAM.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CatalogEntry, ModelSlotName, ModelSlots, ModelsView, ModelTestResult, PullJobView, SlotStatusView } from '../../libs/utils/contracts/index.ts';
import {
  API_DEFAULT_MODELS, ApiProvider, DEFAULT_KEEP_ALIVE, EmbeddingCache, OllamaProvider, type ApiVendor, type DetectResult, type FetchFn, type ModelProvider,
} from '../../libs/utils/models/providers/index.ts';
import { REPO_ROOT } from './paths.ts';

export const DEFAULT_CATALOG_PATH = join(REPO_ROOT, 'data', 'models', 'catalog.json');
export const IDLE_UNLOAD_MS = 30 * 60 * 1000;
/** Default local model per slot when the choice names none (the catalog's recommended ones). */
export const DEFAULT_LOCAL_MODELS: Record<ModelSlotName, string> = { embed: 'bge-m3', extract: 'qwen3:4b', phrase: 'qwen3:8b' };
const SLOTS: ModelSlotName[] = ['embed', 'extract', 'phrase'];
const SETUP = ['brew install ollama', 'ollama serve', 'ollama pull bge-m3'];

interface CatalogFile {
  slots: Record<ModelSlotName, Array<Omit<CatalogEntry, 'installed' | 'fromInstalled' | 'availability' | 'label'>>>;
}

export interface ModelManagerOptions {
  /** The local provider (default: an OllamaProvider on 127.0.0.1:11434). Tests inject a fake. */
  local?: ModelProvider;
  catalogPath?: string;
  idleMs?: number;
  /** Starts `ollama serve` (default: spawn it as a child this service owns). */
  startServer?: () => ChildProcess | undefined;
  /** fetch for the api provider (tests). */
  apiFetch?: FetchFn;
  now?: () => Date;
}

/** 'bge-m3' and 'bge-m3:latest' are the same Ollama model. */
export const sameModel = (a: string, b: string): boolean => {
  const n = (x: string) => (x.includes(':') ? x : `${x}:latest`).toLowerCase();
  return n(a) === n(b);
};

const gb = (bytes?: number): string => (bytes === undefined ? '' : bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`);

interface PullJob extends PullJobView { controller: AbortController }

export class ModelManager {
  readonly local: ModelProvider;
  readonly cache = new EmbeddingCache();
  private readonly opts: ModelManagerOptions;
  private readonly loaded = new Map<string, { embedding: boolean; timer?: ReturnType<typeof setTimeout> }>();
  private readonly failures = new Map<ModelSlotName, string>();
  private readonly jobs = new Map<string, PullJob>();
  private readonly keys: Partial<Record<ApiVendor, string>> = {};
  private server: ChildProcess | undefined;
  private jobSeq = 0;
  private lastDetect: DetectResult | undefined;

  constructor(opts: ModelManagerOptions = {}) {
    this.opts = opts;
    this.local = opts.local ?? new OllamaProvider({ onUse: (m) => this.touch(m) });
  }

  private now(): string {
    return (this.opts.now?.() ?? new Date()).toISOString();
  }

  // ---- use, idle unload, failures -------------------------------------------------------------

  /** A call reached `model`: (re)start its idle timer. Unloads after 30 minutes without a call. */
  touch(model: string, embedding?: boolean): void {
    const prev = this.loaded.get(model);
    if (prev?.timer) clearTimeout(prev.timer);
    const timer = setTimeout(() => void this.unload(model), this.opts.idleMs ?? IDLE_UNLOAD_MS);
    timer.unref?.();
    this.loaded.set(model, { embedding: embedding ?? prev?.embedding ?? false, timer });
  }

  /** Models this service loaded and has not unloaded yet. */
  loadedModels(): string[] {
    return [...this.loaded.keys()].sort();
  }

  recordFailure(slot: ModelSlotName, reason: string): void {
    this.failures.set(slot, reason);
  }

  clearFailure(slot: ModelSlotName): void {
    this.failures.delete(slot);
  }

  async unload(model: string): Promise<void> {
    const e = this.loaded.get(model);
    if (e?.timer) clearTimeout(e.timer);
    this.loaded.delete(model);
    try {
      await this.local.unload(model, { embedding: e?.embedding ?? false });
    } catch {
      /* the server may be gone already */
    }
  }

  /** On shutdown: unload everything this service loaded, cancel downloads, stop a server this service started. */
  async shutdown(): Promise<void> {
    for (const j of this.jobs.values()) if (j.state === 'running') j.controller.abort();
    await Promise.all(this.loadedModels().map((m) => this.unload(m)));
    if (this.server && this.server.exitCode === null) this.server.kill('SIGTERM');
    this.server = undefined;
  }

  /** Stop timers without calling anything (Engine.close in tests). */
  dispose(): void {
    for (const e of this.loaded.values()) if (e.timer) clearTimeout(e.timer);
    this.loaded.clear();
    for (const j of this.jobs.values()) if (j.state === 'running') j.controller.abort();
  }

  // ---- start ----------------------------------------------------------------------------------

  /**
   * App start: for each slot on local, make sure Ollama is up (start `ollama serve` when installed but not running),
   * then load the model with one empty request (keep_alive 30m). Slots on rules or api start nothing.
   * Returns what was warmed; failures go to the slot's status chip and never throw.
   */
  async warmSlots(slots: ModelSlots): Promise<Array<{ slot: ModelSlotName; model: string; ok: boolean; reason?: string }>> {
    const local = SLOTS.filter((s) => slots[s].provider === 'local');
    if (!local.length) return [];
    let d = await this.detect();
    if (!d.running && d.installed) {
      this.server = (this.opts.startServer ?? defaultStartServer)();
      for (let i = 0; i < 20 && !d.running; i++) {
        await new Promise((r) => setTimeout(r, 500));
        d = await this.detect();
      }
    }
    const out: Array<{ slot: ModelSlotName; model: string; ok: boolean; reason?: string }> = [];
    for (const slot of local) {
      const model = slots[slot].model ?? DEFAULT_LOCAL_MODELS[slot];
      if (!d.running) {
        const reason = d.installed ? 'Ollama did not start' : 'Ollama not installed';
        this.recordFailure(slot, reason);
        out.push({ slot, model, ok: false, reason });
        continue;
      }
      try {
        await this.local.warm(model, DEFAULT_KEEP_ALIVE, { embedding: slot === 'embed' });
        this.touch(model, slot === 'embed');
        this.clearFailure(slot);
        out.push({ slot, model, ok: true });
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        this.recordFailure(slot, reason);
        out.push({ slot, model, ok: false, reason });
      }
    }
    return out;
  }

  // ---- detection, catalog, status ---------------------------------------------------------------

  async detect(): Promise<DetectResult> {
    this.lastDetect = await this.local.detect();
    return this.lastDetect;
  }

  catalogFile(): CatalogFile {
    const path = this.opts.catalogPath ?? DEFAULT_CATALOG_PATH;
    if (!existsSync(path)) return { slots: { embed: [], extract: [], phrase: [] } };
    return JSON.parse(readFileSync(path, 'utf8')) as CatalogFile;
  }

  catalog(d: DetectResult): Record<ModelSlotName, CatalogEntry[]> {
    const file = this.catalogFile();
    const ram = d.totalMemBytes;
    const entry = (base: Omit<CatalogEntry, 'installed' | 'availability' | 'label'>, fromInstalled = false): CatalogEntry => {
      const installed = d.models.some((m) => sameModel(m.name, base.model));
      const availability: CatalogEntry['availability'] = installed ? 'ready'
        : !d.installed && !d.running ? 'ollama-missing'
          : base.minRamGb !== undefined && ram !== undefined && base.minRamGb * 1e9 > ram ? 'too-large' : 'not-downloaded';
      const label = availability === 'ready' ? 'installed · ready'
        : availability === 'ollama-missing' ? 'Ollama not installed · Install'
          : availability === 'too-large' ? 'too large for this Mac' : `not downloaded${base.sizeBytes ? ` · ${gb(base.sizeBytes)}` : ''} · Download`;
      return { ...base, installed, ...(fromInstalled ? { fromInstalled: true } : {}), availability, label };
    };
    const out = {} as Record<ModelSlotName, CatalogEntry[]>;
    for (const slot of SLOTS) {
      const listed = (file.slots[slot] ?? []).map((e) => entry(e));
      // Installed models not in the catalog are selectable too (embedding models for embed, completion models otherwise).
      const extra = d.models
        .filter((m) => !listed.some((e) => sameModel(e.model, m.name)))
        .filter((m) => (slot === 'embed' ? m.capabilities.includes('embedding') : m.capabilities.includes('completion') && !m.capabilities.includes('embedding')))
        .map((m) => entry({ model: m.name.replace(/:latest$/, ''), ...(m.sizeBytes !== undefined ? { sizeBytes: m.sizeBytes } : {}), why: 'Already installed on this Mac.' }, true));
      out[slot] = [...listed, ...extra];
    }
    return out;
  }

  slotStatus(slot: ModelSlotName, choice: ModelSlots[ModelSlotName], d: DetectResult): SlotStatusView {
    if (choice.provider === 'rules') return { choice, state: 'off', chip: 'off' };
    const failure = this.failures.get(slot);
    if (choice.provider === 'api') {
      const model = choice.model ?? API_DEFAULT_MODELS.anthropic;
      const vendor: ApiVendor = /^gemini/i.test(model) ? 'gemini' : 'anthropic';
      if (!this.keys[vendor]) return { choice, state: 'failed', chip: `failed: no ${vendor} key`, reason: `no ${vendor} key` };
      if (failure) return { choice, state: 'failed', chip: `failed: ${failure}`, reason: failure };
      return { choice, state: 'ready', chip: 'ready' };
    }
    const model = choice.model ?? DEFAULT_LOCAL_MODELS[slot];
    const job = [...this.jobs.values()].reverse().find((j) => sameModel(j.model, model) && j.state === 'running');
    if (job) return { choice, state: 'downloading', chip: `downloading ${job.percent ?? 0}%`, percent: job.percent ?? 0 };
    if (failure) return { choice, state: 'failed', chip: `failed: ${failure}`, reason: failure };
    if (!d.running) {
      const reason = d.installed ? 'Ollama not running' : 'Ollama not installed';
      return { choice, state: 'failed', chip: `failed: ${reason}`, reason };
    }
    if (!d.models.some((m) => sameModel(m.name, model))) return { choice, state: 'not-downloaded', chip: 'not downloaded' };
    return { choice, state: 'ready', chip: 'ready' };
  }

  async view(slots: ModelSlots): Promise<ModelsView> {
    const d = await this.detect();
    return {
      detection: {
        installed: d.installed, running: d.running,
        ...(d.version ? { version: d.version } : {}), ...(d.binaryPath ? { binaryPath: d.binaryPath } : {}),
        ...(d.freeDiskBytes !== undefined ? { freeDiskBytes: d.freeDiskBytes } : {}), ...(d.totalMemBytes !== undefined ? { totalMemBytes: d.totalMemBytes } : {}),
        ...(d.note ? { note: d.note } : {}),
        installedModels: d.models.map((m) => ({ name: m.name, ...(m.sizeBytes !== undefined ? { sizeBytes: m.sizeBytes } : {}), capabilities: m.capabilities })),
        setup: SETUP,
      },
      catalog: this.catalog(d),
      slots: { embed: this.slotStatus('embed', slots.embed, d), extract: this.slotStatus('extract', slots.extract, d), phrase: this.slotStatus('phrase', slots.phrase, d) },
      apiKeys: { anthropic: !!this.keys.anthropic, gemini: !!this.keys.gemini },
    };
  }

  // ---- downloads --------------------------------------------------------------------------------

  /** Start `ollama pull <model>`; one running job per model (a second click returns the same job). */
  startPull(model: string): PullJobView {
    const running = [...this.jobs.values()].find((j) => sameModel(j.model, model) && j.state === 'running');
    if (running) return publicJob(running);
    const job: PullJob = { jobId: `pull-${++this.jobSeq}`, model, state: 'running', status: 'starting', startedAt: this.now(), controller: new AbortController() };
    this.jobs.set(job.jobId, job);
    this.local.pull(model, (p) => {
      job.status = p.status;
      if (p.percent !== undefined) job.percent = p.percent;
      if (p.completed !== undefined) job.completedBytes = p.completed;
      if (p.total !== undefined) job.totalBytes = p.total;
    }, { signal: job.controller.signal }).then(() => {
      job.state = 'done';
      job.percent = 100;
      job.status = 'success';
      job.finishedAt = this.now();
      for (const s of SLOTS) if (this.failures.get(s)?.includes(model)) this.clearFailure(s);
    }, (e: unknown) => {
      job.state = 'failed';
      job.error = e instanceof Error ? e.message : String(e);
      job.finishedAt = this.now();
    });
    return publicJob(job);
  }

  pullJob(id: string): PullJobView | undefined {
    const j = this.jobs.get(id);
    return j ? publicJob(j) : undefined;
  }

  // ---- api keys (memory only) ---------------------------------------------------------------------

  setKey(vendor: ApiVendor, key: string): { provider: ApiVendor; present: boolean } {
    const k = key.trim();
    if (k) this.keys[vendor] = k;
    else delete this.keys[vendor];
    return { provider: vendor, present: !!this.keys[vendor] };
  }

  hasKey(vendor: ApiVendor): boolean {
    return !!this.keys[vendor];
  }

  /** The api provider, enabled only when at least one key is held. Undefined otherwise. */
  api(): ApiProvider | undefined {
    if (!this.keys.anthropic && !this.keys.gemini) return undefined;
    return new ApiProvider({ enabled: true, keys: { ...this.keys }, ...(this.opts.apiFetch ? { fetch: this.opts.apiFetch } : {}) });
  }

  async testKey(vendor: ApiVendor, model?: string): Promise<ModelTestResult> {
    const p = this.api();
    if (!p || !this.keys[vendor]) return { ok: false, provider: vendor, error: `no ${vendor} key` };
    try {
      const r = await p.test(model ?? API_DEFAULT_MODELS[vendor]);
      return { ok: true, provider: vendor, model: r.model };
    } catch (e) {
      return { ok: false, provider: vendor, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

function publicJob(j: PullJob): PullJobView {
  const { controller: _c, ...view } = j;
  return { ...view };
}

function defaultStartServer(): ChildProcess | undefined {
  try {
    const child = spawn('ollama', ['serve'], { stdio: 'ignore' });
    child.on('error', () => {});
    return child;
  } catch {
    return undefined;
  }
}
