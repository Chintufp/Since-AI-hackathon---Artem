import type { AccessScope, Entity, KnowledgeStore } from '../../libs/utils/contracts/index.ts';
import { stableId } from '../../libs/utils/contracts/index.ts';
import type { PeopleDirectory } from '../../libs/utils/contracts/index.ts';

const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Merge the organization's visible directory (people.json) into person entities: groups become the entity's access
 * scope, role and availability become attributes, provider identities (and the directory id) become actor ids.
 * People already created by an import are matched by actor id or name and keep their entity id.
 */
export function applyDirectory(store: KnowledgeStore, orgId: string, directory: PeopleDirectory): number {
  let touched = 0;
  for (const p of directory.people) {
    const persons = store.list('entity', { where: { type: 'person' } });
    const keys = new Set([p.id, ...p.actorIds]);
    const existing = persons.find((e) => e.id === p.id || (e.actorIds ?? []).some((a) => keys.has(a)) || norm(e.name) === norm(p.name));
    const scope: AccessScope = p.groups.length > 0 ? { visibility: 'group', groups: [...p.groups] } : { visibility: 'org' };
    const base: Entity = existing ?? { id: p.id, orgId, type: 'person', name: p.name, aliases: [], attributes: {}, evidence: [], accessScope: scope };
    const entity: Entity = {
      ...base,
      actorIds: [...new Set([...(base.actorIds ?? []), p.id, ...p.actorIds])],
      accessScope: scope,
      attributes: {
        ...base.attributes,
        role: { value: p.role, origin: 'reported', evidence: [] },
        available: { value: p.available, origin: 'reported', evidence: [] },
      },
    };
    store.put('entity', entity);
    touched++;
  }
  return touched;
}

export const directoryEntityId = (orgId: string, name: string): string => stableId('ent', orgId, 'person', norm(name));
