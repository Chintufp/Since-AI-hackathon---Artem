/**
 * Canonical condition keys shared by extraction (ingest/memory) and investigation.
 * Organizations extend this through configuration; nothing here names a specific device or person.
 * Keys are dotted, lower-case. Values are normalized strings/numbers/booleans.
 */
export const CONDITION_KEYS = {
  'interface.status': 'Interface/link status (up|down)',
  'optical.level': 'Optical/RX power level (normal|low|high|unknown)',
  'traffic.counters': 'Traffic counters (zero|increasing|unknown)',
  'traffic.state': 'Traffic (flowing|absent|degraded)',
  'alarms.state': 'Alarms (cleared|active|unknown)',
  'unit.age': 'Equipment age class (older|newer|unknown)',
  'unit.installed_year': 'Installation year (number)',
  'unit.model': 'Equipment model/family',
  'unit.revision': 'Hardware/controller revision',
  'unit.batch': 'Production batch year of the unit (e.g. 2021; parsed for 202x only)',
  'software.version': 'Software/firmware version',
  'component.replaced': 'Component recently replaced (e.g. sfp, fan, psu)',
  'action.performed': 'An action that was performed (e.g. interface.reset, reboot, sfp.replace)',
  'site.id': 'Site identifier',
  'site.access': 'Site access condition (barrier|key|code|contact)',
  'site.access_code': 'Access code digits for one access point (qualifier: barrier|gate|lockbox|door|hatch)',
  'site.region': 'Region/location',
  'intent.access': 'Problem-only intent (never a case condition): the requester is going to a site and asks how to get in (value: site)',
  'power.state': 'Power (normal|unstable|outage)',
  'temperature.state': 'Temperature (normal|high)',
  'bgp.session': 'BGP session state (up|down|flapping)',
  'config.changed': 'Recent configuration change (true|false)',
  'time.since_change': 'Time since the triggering change (minutes)',
} as const;

export type ConditionKey = keyof typeof CONDITION_KEYS | (string & {});

/** Canonical action names used in attempts/advice. */
export const ACTIONS = [
  'interface.reset',
  'device.reboot',
  'sfp.replace',
  'cable.replace',
  'config.rollback',
  'counters.check',
  'optics.check',
  'logs.check',
  'power.cycle',
  'site.visit',
  'other',
] as const;

export type ActionName = (typeof ACTIONS)[number] | (string & {});
