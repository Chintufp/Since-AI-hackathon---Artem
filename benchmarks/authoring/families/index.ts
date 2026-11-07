import type { FamilySpec } from '../spec.ts';
import f01 from './f01-optic-forwarding-a.ts';
import f02 from './f02-remote-power-access.ts';
import f03 from './f03-bgp-firmware-flaps.ts';
import f04 from './f04-fan-temperature.ts';
import f05 from './f05-config-rollback-private.ts';
import f06 from './f06-cabling-pinch.ts';
import f07 from './f07-weak-mains-psu.ts';
import f08 from './f08-bgp-linecard-private.ts';
import f09 from './f09-transponder-laser.ts';
import f10 from './f10-rooftop-threshold.ts';

export const ALL_FAMILIES: FamilySpec[] = [f01, f02, f03, f04, f05, f06, f07, f08, f09, f10];
