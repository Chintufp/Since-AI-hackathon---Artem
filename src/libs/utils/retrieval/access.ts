import type { AccessScope, Case, EvidenceRef, KnowledgeStore } from '../contracts/index.ts';

export interface PrincipalLike {
  id: string;
  groups: string[];
}

/** Visibility check applied at retrieval and again at question delivery. Undefined scope is treated as not visible. */
export function canSee(scope: AccessScope | undefined, p: PrincipalLike): boolean {
  if (!scope) return false;
  if (scope.principals?.includes(p.id)) return true;
  switch (scope.visibility) {
    case 'org':
      return true;
    case 'group':
      return (scope.groups ?? []).some((g) => p.groups.includes(g));
    case 'private':
      return false;
    default:
      return false;
  }
}

/**
 * Per-evidence visibility for one principal. A record (case, claim, attempt, outcome, link, condition) may be visible
 * as a whole while some of the evidence behind it is not (one case can merge an org-visible and a private source).
 * Rules:
 * - a reference is visible when its evidence record's scope admits the principal;
 * - a reference whose evidence record is not stored cannot be checked; it follows the record that carries it (that
 *   record is filtered by its own scope), so synthetic fixtures without evidence records keep working. Imported
 *   data always has evidence records;
 * - a record "has visible support" when it cites no evidence at all, or at least one cited evidence is visible. A
 *   claim whose supporting evidence is entirely invisible must not contribute anything.
 */
export interface EvidenceGate {
  principal: PrincipalLike;
  /** Is this one reference visible? */
  ref(r: EvidenceRef): boolean;
  /** The visible references only. */
  refs(rs: EvidenceRef[]): EvidenceRef[];
  /** True when `rs` is empty or at least one reference is visible. */
  supported(rs: EvidenceRef[]): boolean;
  /** Record-level scope check. */
  scope(s: AccessScope | undefined): boolean;
}

export function evidenceGate(store: Pick<KnowledgeStore, 'get'>, principal: PrincipalLike): EvidenceGate {
  const cache = new Map<string, boolean>();
  const ref = (r: EvidenceRef): boolean => {
    const hit = cache.get(r.evidenceId);
    if (hit !== undefined) return hit;
    const e = store.get('evidence', r.evidenceId);
    const ok = e ? canSee(e.accessScope, principal) : true;
    cache.set(r.evidenceId, ok);
    return ok;
  };
  return {
    principal, ref,
    refs: (rs) => rs.filter(ref),
    supported: (rs) => rs.length === 0 || rs.some(ref),
    scope: (s) => canSee(s, principal),
  };
}

/**
 * The case as one principal may see it: undefined when the case scope excludes them or none of its evidence is visible;
 * conditions whose evidence is entirely invisible are removed, the others keep their visible references.
 */
export function visibleCase(c: Case, gate: EvidenceGate): Case | undefined {
  if (!gate.scope(c.accessScope)) return undefined;
  if (c.evidenceIds.length > 0 && !gate.supported(c.evidenceIds.map((evidenceId) => ({ evidenceId })))) return undefined;
  return { ...c, evidenceIds: c.evidenceIds.filter((evidenceId) => gate.ref({ evidenceId })), conditions: c.conditions.filter((x) => gate.supported(x.evidence)).map((x) => ({ ...x, evidence: gate.refs(x.evidence) })) };
}

/**
 * B1: the same gate as seen at a moment: evidence whose event time is known and later than `atMs` is invisible;
 * evidence with an unknown or partial time stays visible (an undated source is "valid from before any dated moment").
 */
export function gateAt(store: Pick<KnowledgeStore, 'get'>, base: EvidenceGate, atMs: number): EvidenceGate {
  const cache = new Map<string, boolean>();
  const ref = (r: EvidenceRef): boolean => {
    const hit = cache.get(r.evidenceId);
    if (hit !== undefined) return hit;
    let ok = base.ref(r);
    if (ok) {
      const t = store.get('evidence', r.evidenceId)?.eventTime;
      const ms = t?.known && t.iso ? Date.parse(t.iso) : NaN;
      if (Number.isFinite(ms) && ms > atMs) ok = false;
    }
    cache.set(r.evidenceId, ok);
    return ok;
  };
  return {
    principal: base.principal, ref,
    refs: (rs) => rs.filter(ref),
    supported: (rs) => rs.length === 0 || rs.some(ref),
    scope: base.scope,
  };
}
