/**
 * Slot calls never stall the demo: any provider error or timeout falls back to the rules implementation for that call,
 * and the result says so (route label + reason).
 */
import type { ModelSlotName, RouteInfo } from '../../contracts/index.ts';
import { ProviderError, SLOT_TIMEOUT_MS } from './types.ts';

export interface SlotResult<T> {
  value: T;
  route: RouteInfo;
  /** Present when the model call failed and the rules fallback produced the value. */
  fallback?: { from: RouteInfo; reason: string; code: string };
}

export interface FallbackOptions {
  /** Route of the model call (e.g. {local, 'ollama-embed@1:bge-m3'}). */
  route: RouteInfo;
  /** Route of the rules implementation. */
  rulesRoute: RouteInfo;
  /** Overall deadline; default the slot's timeout. */
  timeoutMs?: number;
  onFailure?: (slot: ModelSlotName, reason: string, code: string) => void;
}

/** Fallback label: the rules version, marked with the slot and the failure code, e.g. "bm25@1[fallback:embed:timeout]". */
export const fallbackRoute = (rules: RouteInfo, slot: ModelSlotName, code: string): RouteInfo => ({ route: rules.route, version: `${rules.version}[fallback:${slot}:${code}]` });

export async function withFallback<T>(slot: ModelSlotName, call: () => Promise<T>, rulesFn: () => T | Promise<T>, opts: FallbackOptions): Promise<SlotResult<T>> {
  const ms = opts.timeoutMs ?? SLOT_TIMEOUT_MS[slot];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new ProviderError('timeout', `${slot}: no answer within ${ms} ms`)), ms);
      timer.unref?.();
    });
    const value = await Promise.race([call(), deadline]);
    return { value, route: opts.route };
  } catch (e) {
    const code = e instanceof ProviderError ? e.code : 'error';
    const reason = e instanceof Error ? e.message : String(e);
    opts.onFailure?.(slot, reason, code);
    return { value: await rulesFn(), route: fallbackRoute(opts.rulesRoute, slot, code), fallback: { from: opts.route, reason, code } };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
