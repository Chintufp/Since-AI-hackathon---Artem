/**
 * B6 (demo flag only): the "Be Veikko / Be Erkki" chips in the panel footer, as pure functions so they are tested
 * without a DOM. A chip switches the panel's acting person exactly as Settings -> You does (PUT /settings
 * currentPersonEntityId), so the principal sent on /investigate and the person whose /questions are listed both follow
 * it, and the simulated stream (which reads Settings -> You, R40) never answers for that person. Settings -> You stays
 * the real mechanism; the chips are a shortcut for asking as the field engineer and answering as the expert on one screen.
 */
import type { DirectoryEntry } from '../contracts/service.ts';

export interface DemoPersona {
  /** Stable key (data-persona on the button). */
  key: 'veikko' | 'erkki';
  /** The chip's text. */
  label: string;
  /** The directory name the chip resolves to (the Elisa example's people). */
  name: string;
  /** What they do in the walkthrough. */
  part: 'field' | 'expert';
}

/** Ask as Veikko (field), answer as Erkki (expert): DEMO.md 0:10 and 2:05. */
export const DEMO_PERSONAS: readonly DemoPersona[] = Object.freeze([
  { key: 'veikko', label: 'Be Veikko', name: 'Veikko Vikkelä', part: 'field' },
  { key: 'erkki', label: 'Be Erkki', name: 'Erkki Expert', part: 'expert' },
]);

export interface DemoChip extends DemoPersona {
  personEntityId: string;
  /** The panel acts as this person now. */
  active: boolean;
}

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

/**
 * The chips to show for a directory: each persona resolved by its exact name (accents ignored), else by a unique first
 * name. A persona not in the directory (a clean clone without Elisa's files) gets no chip; none found = no chips.
 */
export function demoChips(directory: readonly DirectoryEntry[], currentPersonEntityId?: string | null): DemoChip[] {
  const chips: DemoChip[] = [];
  for (const p of DEMO_PERSONAS) {
    const exact = directory.find((d) => fold(d.name) === fold(p.name));
    const first = fold(p.name.split(' ')[0]!);
    const byFirst = directory.filter((d) => fold(d.name).split(/\s+/)[0] === first);
    const hit = exact ?? (byFirst.length === 1 ? byFirst[0] : undefined);
    if (hit) chips.push({ ...p, personEntityId: hit.personEntityId, active: !!currentPersonEntityId && hit.personEntityId === currentPersonEntityId });
  }
  return chips;
}
