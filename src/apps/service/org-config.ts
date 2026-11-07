/**
 * Organization configuration defaults for the local prototype (R22 in the run decisions).
 * This is configuration, not core logic: an organization replaces these maps with its own
 * groups, roles and the condition keys each may observe. Nothing here names a person or an incident.
 */
import type { QuietHours } from '../../libs/utils/contracts/index.ts';
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

/**
 * B1: nobody is interrupted between 22:00 and 07:00 Helsinki time; a question created then waits, queued, for 07:00.
 * Wired by the service, the MCP server and the demo scripts as `coordinator.quietHours`; deliberately NOT part of
 * defaultCoordinatorSettings (experiments spread those for hash-locked runs, and tests without a fixed clock run at night).
 */
export const defaultQuietHours: QuietHours = { start: '22:00', end: '07:00', timeZone: 'Europe/Helsinki' };

/**
 * B1: capture-time standing gaps are asked (outcome 24 h after a fix, pairing of an orphan fix with an open problem on
 * the same asset within 14 days, a missing symptom in the Later pile). Wired by the hosts like the quiet hours; the
 * library default records the gaps but asks nothing.
 */
export const defaultStandingGaps = { ask: true, outcomeAfterHours: 24, pairingWindowDays: 14 };
