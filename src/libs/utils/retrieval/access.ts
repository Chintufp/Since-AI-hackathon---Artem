import type { AccessScope } from '../contracts/index.ts';

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
