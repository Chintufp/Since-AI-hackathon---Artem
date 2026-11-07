/**
 * Organization configuration defaults for the local prototype (R22 in the run decisions).
 * This is configuration, not core logic: an organization replaces these maps with its own
 * groups, roles and the condition keys each may observe. Nothing here names a person or an incident.
 */
import type { ObservabilityPolicy } from '../../libs/utils/investigation/settings.ts';

const EQUIPMENT_FACTS = ['unit.age', 'unit.model', 'unit.revision', 'software.version', 'config.changed'];
const SITE_FACTS = ['site.access', 'power.state', 'temperature.state'];

/** Who may be asked about which kind of fact when nobody has firsthand history for the asset. */
export const defaultObservabilityPolicy: ObservabilityPolicy = {
  groups: {
    noc: EQUIPMENT_FACTS,
    transport: EQUIPMENT_FACTS,
    core: EQUIPMENT_FACTS,
    field: SITE_FACTS,
    // B1: access codes are asked only of the people who handle them (never the field group).
    access: ['site.access', 'site.access_code'],
  },
  roles: {
    'Network Expert': EQUIPMENT_FACTS,
    'NOC Engineer': EQUIPMENT_FACTS,
    'Network Technician': EQUIPMENT_FACTS,
    'Routing Specialist': EQUIPMENT_FACTS,
    'Field Engineer': SITE_FACTS,
    'Site Access Coordinator': ['site.access', 'site.access_code'],
  },
};
