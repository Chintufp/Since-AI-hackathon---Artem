/**
 * The running service's network guard (D-INT-20). globalThis.fetch is replaced at startup by a thrower whose allowlist is
 * derived from the live settings on every call: nothing with every slot on rules; the Ollama origin when a slot is local;
 * the hosted-model origins only when a slot is api and KT_NO_API is not 1; slack.com only under KT_SLACK_LIVE=1; the
 * service's own origin (the local pages and mcp-demo talk to it over 127.0.0.1) when given. A refusal logs the route label.
 */
import type { ModelSlots } from '../../libs/utils/contracts/index.ts';
import { installNetworkGuard } from '../../libs/utils/models/routes.ts';

type Env = Record<string, string | undefined>;

export const OLLAMA_ORIGIN = 'http://127.0.0.1:11434';
export const API_ORIGINS = ['https://api.anthropic.com', 'https://generativelanguage.googleapis.com'];
export const SLACK_ORIGIN = 'https://slack.com';

export function deriveAllowlist(slots: ModelSlots, env: Env = process.env, ownOrigin?: string): string[] {
  const chosen = Object.values(slots).map((s) => s.provider);
  const out: string[] = [];
  if (ownOrigin) out.push(ownOrigin);
  if (chosen.includes('local')) out.push(OLLAMA_ORIGIN);
  if (chosen.includes('api') && env.KT_NO_API !== '1') out.push(...API_ORIGINS);
  if (env.KT_SLACK_LIVE === '1') out.push(SLACK_ORIGIN);
  return out;
}

export interface ServiceGuardOptions {
  slots: () => ModelSlots;
  env?: Env;
  /** The service's own origin; may be set after listen (a function) because the port can be 0 in tests. */
  ownOrigin?: () => string | undefined;
  log?: (line: string) => void;
}

/** Install the guard; the allowlist is re-derived from `slots()` on every fetch, so PUT /settings takes effect at once. */
export function installServiceGuard(opts: ServiceGuardOptions): () => void {
  const log = opts.log ?? ((l: string) => void process.stderr.write(`${l}\n`));
  return installNetworkGuard({
    allowOrigins: () => deriveAllowlist(opts.slots(), opts.env ?? process.env, opts.ownOrigin?.()),
    onBlock: ({ origin, missingRoute }) => log(`network guard refused fetch to ${origin ?? '(not a URL)'}; missing route: ${missingRoute}`),
  });
}
