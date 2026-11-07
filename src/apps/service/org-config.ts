/**
 * Organization configuration defaults for the local prototype (R22 in the run decisions).
 * This is configuration, not core logic: an organization replaces these maps with its own
 * groups, roles and the condition keys each may observe. Nothing here names a person or an incident.
 */
import type { ModelSlots } from '../../libs/utils/contracts/index.ts';
import { DEFAULT_MODEL_SLOTS as CONTRACT_DEFAULT_SLOTS } from '../../libs/utils/contracts/index.ts';
import type { ObservabilityPolicy } from '../../libs/utils/investigation/settings.ts';

/**
 * Model slots for this organization (BUILD_BRIEF 2.1): every slot on rules, so nothing new runs until someone chooses
 * a local or api model in Settings -> Models. A host may override this through EngineOptions.models.
 */
export const DEFAULT_MODEL_SLOTS: ModelSlots = CONTRACT_DEFAULT_SLOTS;

const EQUIPMENT_FACTS = ['unit.age', 'unit.model', 'unit.revision', 'software.version', 'config.changed'];
const SITE_FACTS = ['site.access', 'power.state', 'temperature.state'];

/** Who may be asked about which kind of fact when nobody has firsthand history for the asset. */
export const defaultObservabilityPolicy: ObservabilityPolicy = {
  groups: {
    noc: EQUIPMENT_FACTS,
    transport: EQUIPMENT_FACTS,
    core: EQUIPMENT_FACTS,
    field: SITE_FACTS,
    access: ['site.access'],
  },
  roles: {
    'Network Expert': EQUIPMENT_FACTS,
    'NOC Engineer': EQUIPMENT_FACTS,
    'Network Technician': EQUIPMENT_FACTS,
    'Routing Specialist': EQUIPMENT_FACTS,
    'Field Engineer': SITE_FACTS,
    'Site Access Coordinator': ['site.access'],
  },
};
