/**
 * Action vocabulary used by the hidden truth. Truth uses a few finer-grained actions than the shared
 * contracts ACTIONS list; each extension action declares the canonical ACTIONS entry it rolls up to, so a
 * system that emits only canonical actions (e.g. 'other' for a rectifier swap) is still matched and scored
 * rather than silently dropped. See data/scenarios/REVIEW.md.
 */
import { ACTIONS } from '../src/libs/utils/contracts/index.ts';

export const EXTENSION_ACTIONS: Record<string, (typeof ACTIONS)[number]> = {
  'card.reseat': 'other',
  'component.replace.battery': 'other',
  'component.replace.fan': 'other',
  'component.replace.filter': 'other',
  'component.replace.lug': 'other',
  'component.replace.psu': 'other',
  'component.replace.rectifier': 'other',
  'config.change': 'other',
  'config.patch': 'other',
  'firmware.downgrade': 'other',
  'patch.install': 'other',
  'power.cycle.shelf': 'power.cycle',
};

export function isKnownAction(a: string): boolean {
  return (ACTIONS as readonly string[]).includes(a) || a in EXTENSION_ACTIONS;
}

/** Roll an action up to the canonical contracts ACTIONS entry (unknown names become 'other'). */
export function canonicalAction(a: string): string {
  if ((ACTIONS as readonly string[]).includes(a)) return a;
  return EXTENSION_ACTIONS[a] ?? 'other';
}
