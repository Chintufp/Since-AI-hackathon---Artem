import type { InvestigationState, Principal, Problem, Selector, Condition } from '../../contracts/index.ts';
import { defaultInvestigationSettings, investigate, RulesAssessor, storeDirectory, type InvestigationSettings } from '../../investigation/index.ts';
import { InMemoryStore } from '../../models/testing/in-memory-store.ts';
import { NOW_ISO, ORG, requesterActor, requesterPrincipal } from '../../models/testing/fixtures.ts';
import { RulesSelector } from '../../policies/rules-selector.ts';
import { HybridRetriever } from '../../retrieval/index.ts';
import { QuestionCoordinator } from '../coordinator.ts';
import { TemplateQuestionGenerator } from '../generator-templates.ts';

export interface Harness {
  store: InMemoryStore;
  settings: InvestigationSettings;
  /** Mutable test clock. */
  time: { iso: string };
  clock: () => Date;
  coordinator: QuestionCoordinator;
  generator: TemplateQuestionGenerator;
  start(id: string, text: string, observations?: Condition[], principal?: Principal): Promise<InvestigationState>;
}

export function makeHarness(store: InMemoryStore, o: { settings?: Partial<InvestigationSettings>; selector?: Selector } = {}): Harness {
  const settings = defaultInvestigationSettings(o.settings);
  const time = { iso: NOW_ISO };
  const clock = (): Date => new Date(time.iso);
  const directory = storeDirectory(store);
  const retriever = new HybridRetriever(store, settings);
  const assessor = new RulesAssessor({ store, settings });
  const generator = new TemplateQuestionGenerator({ store, settings, directory, clock });
  const selector = o.selector ?? new RulesSelector({ clock });
  const coordinator = new QuestionCoordinator({ store, settings, selector, generator, retriever, assessor, directory, clock });
  return {
    store, settings, time, clock, coordinator, generator,
    start: (id, text, observations = [], principal = requesterPrincipal()) => {
      const problem: Problem = { id, orgId: ORG, text, requester: requesterActor(), observations, createdAt: NOW_ISO };
      return investigate({ problem, store, principal, deps: { retriever, assessor, generator, settings, clock, directory } });
    },
  };
}
