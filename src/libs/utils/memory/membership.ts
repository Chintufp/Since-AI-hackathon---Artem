import type { Entity, EvidenceEnvelope, KnowledgeStore } from '../contracts/index.ts';
import { stableId } from '../contracts/index.ts';
import type { MembershipGrant } from '../connectors/index.ts';

/** Person attribute prefix recording a source-derived group membership: `member-of:<group>` = true. */
export const MEMBER_ATTR_PREFIX = 'member-of:';

const norm = (s: string): string => s.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();

/** Groups a person holds because a source says they are a member (e.g. a private channel). */
export const derivedGroupsOf = (e: Pick<Entity, 'attributes'>): string[] =>
  Object.entries(e.attributes).filter(([k, v]) => k.startsWith(MEMBER_ATTR_PREFIX) && v.value === true).map(([k]) => k.slice(MEMBER_ATTR_PREFIX.length));

/** Add groups to a person's scope (merge, never replace); the visibility of the entity itself is kept. */
function withGroups(e: Entity, groups: string[]): Entity {
  const have = e.accessScope.groups ?? [];
  const merged = [...new Set([...have, ...groups])];
  if (merged.length === have.length) return e;
  return { ...e, accessScope: { ...e.accessScope, groups: merged } };
}

/**
 * Apply the membership grants carried by imported records. Every grant resolves to a person entity (by actor id, then
 * by name, else a new person entity is created when the source names them), records `member-of:<group>` on it, and
 * adds the group to the person's access scope. Grants only ever add: nothing is removed or replaced. Idempotent.
 * Finally every person who has recorded memberships gets them re-merged into their scope (later commits that merge
 * scopes of other records may otherwise have dropped them).
 */
export function applyMembershipGrants(store: KnowledgeStore, orgId: string, evidence: EvidenceEnvelope[]): number {
  const grants = new Map<string, MembershipGrant>();
  for (const ev of evidence) {
    const list = ev.metadata?.membershipGrants;
    if (!Array.isArray(list)) continue;
    for (const g of list as MembershipGrant[]) if (g?.actorId && g.group) grants.set(`${g.actorId}|${g.group}`, g);
  }
  let touched = 0;
  const persons = (): Entity[] => store.list('entity', { where: { type: 'person' } });
  for (const g of grants.values()) {
    let ent = persons().find((p) => p.orgId === orgId && (p.actorIds ?? []).includes(g.actorId))
      ?? (g.displayName ? persons().find((p) => p.orgId === orgId && norm(p.name) === norm(g.displayName!)) : undefined);
    if (!ent) {
      if (!g.displayName) continue; // unresolved Slack id: unknown stays unknown
      ent = {
        id: stableId('ent', orgId, 'person', norm(g.displayName)), orgId, type: 'person', name: g.displayName, aliases: [], attributes: {},
        evidence: [], actorIds: [g.actorId], accessScope: { visibility: 'group', groups: [g.group] },
      };
    }
    const attr = `${MEMBER_ATTR_PREFIX}${g.group}`;
    const next = withGroups(
      {
        ...ent,
        actorIds: [...new Set([...(ent.actorIds ?? []), g.actorId])],
        attributes: { ...ent.attributes, [attr]: { value: true, origin: 'reported', evidence: [] } },
      },
      [g.group],
    );
    if (JSON.stringify(next) !== JSON.stringify(ent) || !store.get('entity', next.id)) { store.put('entity', next); touched++; }
  }
  for (const p of persons()) {
    const d = derivedGroupsOf(p);
    if (!d.length) continue;
    const next = withGroups(p, d);
    if (next !== p) { store.put('entity', next); touched++; }
  }
  return touched;
}
