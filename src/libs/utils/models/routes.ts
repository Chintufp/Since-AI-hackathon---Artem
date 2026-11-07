import type { Route, RouteInfo } from '../contracts/index.ts';

export interface RouteDescription extends RouteInfo {
  description: string;
  /** True only when parameters were fitted from data (artifact on disk). */
  learned: boolean;
}

/** Registry of the route labels used by this project's model-dependent stages. */
export const ROUTE_REGISTRY: Record<string, RouteDescription> = {
  'problem-parser': { route: 'rules', version: 'problem-parser@1', description: 'Configurable lexicon regexes over problem text', learned: false },
  'bm25': { route: 'rules', version: 'bm25@1', description: 'Lexical BM25 over cases/procedures', learned: false },
  'exact-id': { route: 'rules', version: 'exact-id@1', description: 'Entity name/alias match boosts cases on the same entity', learned: false },
  'trigram-hash': { route: 'local', version: 'trigram-hash@1', description: 'Hashed character-trigram vectors (512 dims, cosine). Local and NOT learned.', learned: false },
  'assessor': { route: 'rules', version: 'rules-assessor@1', description: 'Support/applicability rules', learned: false },
  'question-templates': { route: 'rules', version: 'question-templates@1', description: 'Template question generator', learned: false },
  'rules-selector': { route: 'rules', version: 'rules-selector@1', description: 'Deterministic score selector', learned: false },
  'supersession-rules': { route: 'rules', version: 'supersession-rules@1', description: 'B1: a newer value closes an older one (validity.to, status superseded); a "fixed in version X" note bounds older advice with validity.condition', learned: false },
  'access-facts': { route: 'rules', version: 'access-facts@1', description: 'B1: access-fact claims bound to the named site, valid at the moment and visible to the requester, returned as a reuse recommendation; names who handles the key when missing or lapsed', learned: false },
  'standing-gaps': { route: 'rules', version: 'standing-gaps@1', description: 'B1: capture-time gaps on cases (missing symptom, outcome after 24 h, candidate pairing of an open problem and an orphan fix on one asset) asked through the same coordinator', learned: false },
  'linucb': { route: 'local', version: 'linucb@1', description: 'LinUCB contextual bandit (pure TS, trained on logged/simulated records)', learned: true },
  'ollama-embed': { route: 'local', version: 'ollama-embed@1', description: 'Text embeddings from a local Ollama model (embed slot). Pretrained, not trained here.', learned: false },
  'ollama-extract': { route: 'local', version: 'ollama-extract@1', description: 'Schema-constrained extraction proposal from a local Ollama model (extract slot); committed by rules.', learned: false },
  'ollama-phrase': { route: 'local', version: 'ollama-phrase@1', description: 'Question wording from a local Ollama model (phrase slot); validated, template fallback.', learned: false },
  'api-extract': { route: 'api', version: 'api-extract@1', description: 'Extraction proposal from a hosted model (only when configured with a key); committed by rules.', learned: false },
  'agent-worded': { route: 'rules', version: 'agent-worded@1', description: 'B7: question wording proposed by the calling agent (kt_propose_question), accepted only through the phrase validator; the gap, recipients, consequences and gates stay the templates\'. No model of ours runs.', learned: false },
  'slack-web': { route: 'api', version: 'slack-web@1', description: 'Slack Web API connectors (read-only pull, DM poller, fetchHistory). Not a model. Refused before any request unless KT_SLACK_LIVE=1, and only to https://slack.com (connectors/slack-net.ts).', learned: false },
  'api-phrase': { route: 'api', version: 'api-phrase@1', description: 'Question wording from a hosted model (only when configured with a key); validated, template fallback.', learned: false },
};

export const routeInfo = (key: keyof typeof ROUTE_REGISTRY | string): RouteInfo => {
  const r = ROUTE_REGISTRY[key];
  if (!r) throw new Error(`Unknown route key: ${key}`);
  return { route: r.route, version: r.version };
};

export class NetworkProviderBlockedError extends Error {
  constructor(what: string) {
    super(`Blocked network/model-provider call: ${what}. This project runs only rules, local and replay routes.`);
    this.name = 'NetworkProviderBlockedError';
  }
}

/** Call from any code path that would reach a model provider; always throws. */
export function blockedProviderCall(provider: string): never {
  throw new NetworkProviderBlockedError(provider);
}

export interface NetworkGuardOptions {
  /**
   * URL origins that may still be fetched, exactly as `new URL(u).origin` prints them (e.g. 'http://127.0.0.1:11434'
   * for the experiments' explicit --record mode). Everything else, localhost included, stays blocked. Default: none.
   */
  allowOrigins?: string[];
}

/** Replace globalThis.fetch with a thrower (tests/experiments). Returns a restore function. */
export function installNetworkGuard(opts: NetworkGuardOptions = {}): () => void {
  const g = globalThis as { fetch?: unknown };
  const original = g.fetch as ((input: unknown, init?: unknown) => unknown) | undefined;
  const allow = new Set(opts.allowOrigins ?? []);
  g.fetch = (input: unknown, init?: unknown) => {
    if (allow.size && original) {
      let origin: string | undefined;
      try {
        origin = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : String((input as { url?: string })?.url ?? '')).origin;
      } catch { /* not a URL: blocked below */ }
      if (origin && allow.has(origin)) return original(input, init);
    }
    throw new NetworkProviderBlockedError('fetch');
  };
  return () => {
    g.fetch = original;
  };
}

const ROUTES: Route[] = ['rules', 'local', 'replay', 'claude-agent-arm', 'api'];

/** Validates that a RouteInfo is honestly labelled. */
export function assertRouteInfo(info: RouteInfo): RouteInfo {
  if (!ROUTES.includes(info.route)) throw new Error(`Invalid route ${String(info.route)}`);
  if (!info.version) throw new Error('RouteInfo.version is required');
  if (info.route === 'replay' && !info.version.startsWith('replay:')) {
    throw new Error(`replay route version must start with "replay:" (got ${info.version})`);
  }
  return info;
}

/** Distinct routes (by route+version), preserving first-seen order. */
export function uniqueRoutes(infos: Array<RouteInfo | undefined>): RouteInfo[] {
  const seen = new Set<string>();
  const out: RouteInfo[] = [];
  for (const i of infos) {
    if (!i) continue;
    const k = `${i.route}|${i.version}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ route: i.route, version: i.version });
    }
  }
  return out;
}
