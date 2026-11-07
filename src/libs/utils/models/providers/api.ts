/**
 * Hosted models over HTTPS: Anthropic Messages (claude-haiku-5-5 / claude-sonnet-5-5; a JSON schema becomes a forced
 * tool) and Gemini (generateContent with a response JSON schema). Same interface as the local provider.
 *
 * It refuses every call unless it was constructed with `{enabled: true}` AND a key for the vendor the model belongs
 * to. Nothing constructs it in tests or demo:judge; the service builds one only when a slot is set to api and a key
 * was posted (held in memory only).
 */
import { asProviderError, ProviderError, SLOT_TIMEOUT_MS, timeoutSignal, type CallOptions, type DetectResult, type FetchFn, type ModelProvider } from './types.ts';

export type ApiVendor = 'anthropic' | 'gemini';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
export const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
export const API_DEFAULT_MODELS: Record<ApiVendor, string> = { anthropic: 'claude-haiku-5-5', gemini: 'gemini-2.5-flash-lite' };

export const vendorOf = (model: string): ApiVendor => (/^gemini/i.test(model) ? 'gemini' : 'anthropic');

export interface ApiProviderOptions {
  /** Must be exactly true. */
  enabled: boolean;
  keys: Partial<Record<ApiVendor, string>>;
  fetch?: FetchFn;
}

export class ApiProviderDisabledError extends ProviderError {
  constructor(why: string) {
    super('disabled', `api provider refused: ${why}`);
    this.name = 'ApiProviderDisabledError';
  }
}

export class ApiProvider implements ModelProvider {
  readonly kind = 'api' as const;
  private readonly opts: ApiProviderOptions;
  private readonly fetchFn: FetchFn;

  constructor(opts: ApiProviderOptions) {
    this.opts = { enabled: opts.enabled === true, keys: { ...opts.keys } };
    this.fetchFn = opts.fetch ?? ((input, init) => globalThis.fetch(input, init));
  }

  private keyFor(model: string): { vendor: ApiVendor; key: string } {
    if (this.opts.enabled !== true) throw new ApiProviderDisabledError('not enabled');
    const vendor = vendorOf(model);
    const key = this.opts.keys[vendor];
    if (!key) throw new ApiProviderDisabledError(`no ${vendor} key given`);
    return { vendor, key };
  }

  private async send(url: string, headers: Record<string, string>, body: unknown, timeoutMs: number): Promise<any> {
    let res: Response;
    try {
      const signal = timeoutSignal(timeoutMs);
      res = await this.fetchFn(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), ...(signal ? { signal } : {}) });
    } catch (e) {
      throw asProviderError(e, 'api');
    }
    let j: any;
    try {
      j = await res.json();
    } catch (e) {
      throw (e as { name?: string }).name === 'TimeoutError' ? asProviderError(e, 'api') : new ProviderError('bad-response', `api: unreadable answer (HTTP ${res.status})`);
    }
    if (!res.ok) throw new ProviderError('http', `api: HTTP ${res.status}: ${String(j?.error?.message ?? j?.error ?? '').slice(0, 200)}`);
    return j;
  }

  private anthropic(key: string, model: string, prompt: string, opts: CallOptions, extra: Record<string, unknown>, timeout: number) {
    return this.send(ANTHROPIC_URL, { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, {
      model, max_tokens: opts.maxTokens ?? 2048, temperature: 0,
      ...(opts.system ? { system: opts.system } : {}),
      messages: [{ role: 'user', content: prompt }], ...extra,
    }, opts.timeoutMs ?? timeout);
  }

  private gemini(key: string, model: string, prompt: string, opts: CallOptions, generationConfig: Record<string, unknown>, timeout: number) {
    return this.send(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key }, {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      ...(opts.system ? { systemInstruction: { parts: [{ text: opts.system }] } } : {}),
      generationConfig: { temperature: 0, ...(opts.seed !== undefined ? { seed: opts.seed } : {}), ...generationConfig },
    }, opts.timeoutMs ?? timeout);
  }

  async generateJson(model: string, prompt: string, jsonSchema: Record<string, unknown>, opts: CallOptions = {}): Promise<unknown> {
    const { vendor, key } = this.keyFor(model);
    if (vendor === 'anthropic') {
      const j = await this.anthropic(key, model, prompt, opts, {
        tools: [{ name: 'emit', description: 'Return the result in exactly this schema.', input_schema: jsonSchema }],
        tool_choice: { type: 'tool', name: 'emit' },
      }, SLOT_TIMEOUT_MS.extract);
      const block = (j.content ?? []).find((b: { type?: string }) => b.type === 'tool_use');
      if (!block) throw new ProviderError('bad-response', 'api: no tool_use block');
      return block.input;
    }
    const j = await this.gemini(key, model, prompt, opts, { responseMimeType: 'application/json', responseJsonSchema: jsonSchema }, SLOT_TIMEOUT_MS.extract);
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text;
    try {
      return JSON.parse(String(text));
    } catch {
      throw new ProviderError('bad-response', 'api: output is not JSON');
    }
  }

  async generateText(model: string, prompt: string, opts: CallOptions = {}): Promise<string> {
    const { vendor, key } = this.keyFor(model);
    if (vendor === 'anthropic') {
      const j = await this.anthropic(key, model, prompt, opts, {}, SLOT_TIMEOUT_MS.phrase);
      const text = (j.content ?? []).filter((b: { type?: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('');
      if (!text) throw new ProviderError('bad-response', 'api: no text');
      return String(text).trim();
    }
    const j = await this.gemini(key, model, prompt, opts, {}, SLOT_TIMEOUT_MS.phrase);
    const text = j.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof text !== 'string' || !text) throw new ProviderError('bad-response', 'api: no text');
    return text.trim();
  }

  /** The answering model's own name, from one tiny call (POST /models/test). */
  async test(model: string): Promise<{ model: string; vendor: ApiVendor }> {
    const { vendor, key } = this.keyFor(model);
    const opts: CallOptions = { maxTokens: 8, timeoutMs: 15_000 };
    if (vendor === 'anthropic') {
      const j = await this.anthropic(key, model, 'Reply with: ok', opts, {}, 15_000);
      return { model: String(j.model ?? model), vendor };
    }
    const j = await this.gemini(key, model, 'Reply with: ok', opts, { maxOutputTokens: 8 }, 15_000);
    return { model: String(j.modelVersion ?? model), vendor };
  }

  async embed(): Promise<Float32Array[]> {
    this.keyFor('claude');
    throw new ProviderError('unsupported', 'api provider: the embed slot has no api model in this build (keep embed local or rules)');
  }

  async warm(): Promise<void> { /* nothing to load */ }
  async unload(): Promise<void> { /* nothing loaded */ }
  async pull(): Promise<void> {
    throw new ProviderError('unsupported', 'api provider: nothing to download');
  }
  async detect(): Promise<DetectResult> {
    const keyed = Object.values(this.opts.keys).some(Boolean);
    return { installed: true, running: this.opts.enabled === true && keyed, models: [] };
  }
}
