import type { AccessScope, Principal } from '../contracts/index.ts';

const rank = { org: 0, group: 1, private: 2 } as const;

/** May this principal see a record with this scope? Filtering is applied at retrieval time. */
export function canSee(scope: AccessScope, principal: Pick<Principal, 'id' | 'groups'>): boolean {
  if (scope.principals?.includes(principal.id)) return true;
  if (scope.visibility === 'org') return true;
  if (scope.visibility === 'group') return (scope.groups ?? []).some((g) => principal.groups.includes(g));
  return false;
}

/**
 * Most restrictive combination: private beats group beats org; group scopes intersect
 * (when the groups are disjoint nobody but named principals qualifies, which fails closed).
 */
export function restrictiveScope(scopes: AccessScope[]): AccessScope {
  if (!scopes.length) return { visibility: 'org' };
  let vis: AccessScope['visibility'] = 'org';
  for (const s of scopes) if (rank[s.visibility] > rank[vis]) vis = s.visibility;
  const principals = [...new Set(scopes.flatMap((s) => s.principals ?? []))];
  if (vis === 'org') return { visibility: 'org' };
  if (vis === 'private') return { visibility: 'private', principals };
  const groupScopes = scopes.filter((s) => s.visibility !== 'org');
  let groups = [...(groupScopes[0]?.groups ?? [])];
  for (const s of groupScopes.slice(1)) groups = groups.filter((g) => (s.groups ?? []).includes(g));
  return { visibility: 'group', groups, ...(principals.length ? { principals } : {}) };
}

/**
 * Least restrictive combination: used for records that several sources independently support (an entity, a claim,
 * a case). One org-wide source keeps the record org-visible; a restricted source adds nothing to its audience and
 * never hides it. Restricted sources stay restricted themselves and are filtered out per principal at read time.
 */
export function leastRestrictiveScope(scopes: AccessScope[]): AccessScope {
  if (!scopes.length) return { visibility: 'org' };
  if (scopes.some((s) => s.visibility === 'org')) return { visibility: 'org' };
  const principals = [...new Set(scopes.flatMap((s) => s.principals ?? []))];
  const groupScopes = scopes.filter((s) => s.visibility === 'group');
  if (!groupScopes.length) return { visibility: 'private', principals };
  const groups = [...new Set(groupScopes.flatMap((s) => s.groups ?? []))];
  return { visibility: 'group', groups, ...(principals.length ? { principals } : {}) };
}

/** True when everyone who can see `inner` can also see `outer` (so inner data may be shown under outer's scope). */
export function covers(outer: AccessScope, inner: AccessScope): boolean {
  if (outer.visibility === 'org') return true;
  if (outer.visibility === 'group' && inner.visibility === 'group') return (inner.groups ?? []).every((g) => (outer.groups ?? []).includes(g));
  if (inner.visibility === 'private') return (inner.principals ?? []).every((p) => (outer.principals ?? []).includes(p));
  return false;
}
