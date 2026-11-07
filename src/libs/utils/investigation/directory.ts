import type { Entity, KnowledgeStore } from '../contracts/index.ts';

export interface DirectoryPerson {
  id: string;
  name: string;
  role?: string;
  groups: string[];
  available: boolean;
  actorIds: string[];
}

export interface PersonDirectory {
  get(personEntityId: string): DirectoryPerson | undefined;
  /** Person entity id for either an entity id or a provider actor id. */
  resolve(id: string): string | undefined;
  all(): DirectoryPerson[];
}

const toPerson = (e: Entity): DirectoryPerson => ({
  id: e.id,
  name: e.name,
  groups: e.accessScope.groups ?? [],
  available: e.attributes.available?.value !== false,
  actorIds: e.actorIds ?? [],
  ...(typeof e.attributes.role?.value === 'string' ? { role: e.attributes.role.value } : {}),
});

/**
 * Directory view over person entities in the store. Convention: a person's groups are their entity
 * accessScope.groups; role and availability are the `role` and `available` attributes.
 */
export function storeDirectory(store: KnowledgeStore): PersonDirectory {
  const people = (): Entity[] => store.list('entity', { where: { type: 'person' } });
  return {
    get: (id) => {
      const e = store.get('entity', id);
      return e && e.type === 'person' ? toPerson(e) : undefined;
    },
    resolve: (id) => {
      const e = store.get('entity', id);
      if (e && e.type === 'person') return e.id;
      return people().find((p) => p.actorIds?.includes(id))?.id;
    },
    all: () => people().map(toPerson),
  };
}
