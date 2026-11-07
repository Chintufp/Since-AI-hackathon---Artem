/**
 * Organization configuration used by the experiments. Nothing here is hard-coded in core logic: it is passed to the
 * investigation/question libraries as InvestigationSettings. Frozen BEFORE any scored run (see EXPERIMENT_PLAN.md).
 */
import type { CoordinatorSettings } from '../src/libs/utils/contracts/index.ts';
import { defaultCoordinatorSettings } from '../src/libs/utils/contracts/index.ts';
import type { InvestigationSettings, ObservabilityPolicy } from '../src/libs/utils/investigation/index.ts';

/** The neutral library defaults (E00 baseline uses these unchanged). */
export const BASELINE_COORDINATOR: CoordinatorSettings = { ...defaultCoordinatorSettings };

/**
 * Question-dependent observability (E06): which directory groups are configured to observe which condition keys.
 * Written from the group NAMES visible in people.json (planning/inventory, change-board, field, access); it is an
 * organization policy guess, fixed before E06 was run and never tuned afterwards.
 */
export const QUESTION_DEPENDENT_OBSERVABILITY: ObservabilityPolicy = {
  groups: {
    planning: ['unit.model', 'unit.revision', 'unit.installed_year', 'unit.age', 'software.version'],
    'change-board': ['config.changed', 'config.saved_startup', 'config.rollback_supported', 'software.version'],
    field: ['unit.revision', 'unit.installed_year', 'unit.model', 'unit.age', 'component.replaced', 'cable.condition', 'cable.guard_fitted', 'site.access', 'site.access_code_current'],
    access: ['site.access', 'site.access_code_current'],
    power: ['power.mains_sag', 'power.scope', 'power.breaker_inspected_at_first_visit'],
  },
  roles: {},
};

export const DIRECT_ONLY_OBSERVABILITY: ObservabilityPolicy = { groups: {}, roles: {} };

export const baselineSettings = (): Partial<InvestigationSettings> => ({});
