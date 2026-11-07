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
  'linucb': { route: 'local', version: 'linucb@1', description: 'LinUCB contextual bandit (pure TS, trained on logged/simulated records)', learned: true },
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

/** Replace globalThis.fetch with a thrower (tests/experiments). Returns a restore function. */
export function installNetworkGuard(): () => void {
  const g = globalThis as { fetch?: unknown };
  const original = g.fetch;
  g.fetch = () => {
    throw new NetworkProviderBlockedError('fetch');
  };
  return () => {
    g.fetch = original;
  };
}

const ROUTES: Route[] = ['rules', 'local', 'replay', 'claude-agent-arm'];

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
