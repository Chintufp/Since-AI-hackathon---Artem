import type { KnowledgeStore } from '../contracts/index.ts';
import type { InvestigationSettings, PersonDirectory } from '../investigation/index.ts';

/** Everything the question modules need; injected so nothing is global or organization-specific. */
export interface QuestionContext {
  store: KnowledgeStore;
  settings: InvestigationSettings;
  directory: PersonDirectory;
  clock: () => Date;
}

export const normalizeKey = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();
