import type { Entity } from '../contracts/index.ts';
import { escapeRegExp } from './text.ts';
import type { CorpusDoc } from './corpus.ts';

/** Entities named (by name or alias) in the text, plus explicitly supplied ids. Person entities are never matched. */
export function resolveEntityIds(text: string, entities: Entity[], explicit: string[] = []): { ids: string[]; matchedNames: Record<string, string> } {
  const ids = new Set(explicit);
  const matchedNames: Record<string, string> = {};
  for (const e of entities) {
    if (e.type === 'person') continue;
    for (const n of [e.name, ...e.aliases]) {
      if (n.length < 2) continue;
      const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(n)}(?![\\p{L}\\p{N}])`, 'iu');
      if (re.test(text)) {
        ids.add(e.id);
        matchedNames[e.id] = n;
        break;
      }
    }
  }
  return { ids: [...ids], matchedNames };
}

/** Documents about the given entities, ranked by how many of them they cover. */
export function rankExact(docs: CorpusDoc[], entityIds: string[]): Array<{ key: string; score: number }> {
  if (entityIds.length === 0) return [];
  const want = new Set(entityIds);
  return docs
    .map((d) => ({ key: d.key, score: d.entityIds.filter((id) => want.has(id)).length }))
    .filter((h) => h.score > 0)
    .sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}
