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
  key: 'veikko' | 'erkki' | 'ville' | 'pekka';
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

/**
 * Clean clone (no Elisa files, D-B6-27): the generated older-units stand-in (data/demo/older-units-synthetic) brings
 * Ville Ranta (field) and Pekka Laine (expert). A part whose Elisa persona is not in the directory falls back to these;
 * Erkki Expert is in every directory (his firmware note in data/demo/followups), so on a clone the chips read
 * "Be Ville / Be Erkki", and the agent's question goes to Erkki as in DEMO.md.
 */
export const CLEAN_CLONE_PERSONAS: readonly DemoPersona[] = Object.freeze([
  { key: 'ville', label: 'Be Ville', name: 'Ville Ranta', part: 'field' },
  { key: 'pekka', label: 'Be Pekka', name: 'Pekka Laine', part: 'expert' },
]);

export interface DemoChip extends DemoPersona {
  personEntityId: string;
  /** The panel acts as this person now. */
  active: boolean;
}

const fold = (s: string): string => s.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().toLowerCase();

function resolve(directory: readonly DirectoryEntry[], p: DemoPersona): DirectoryEntry | undefined {
  const exact = directory.find((d) => fold(d.name) === fold(p.name));
  const first = fold(p.name.split(' ')[0]!);
  const byFirst = directory.filter((d) => fold(d.name).split(/\s+/)[0] === first);
  return exact ?? (byFirst.length === 1 ? byFirst[0] : undefined);
}

/**
 * The chips to show for a directory: each part (field, expert) resolved from its Elisa persona by exact name (accents
 * ignored), else by a unique first name, else from the clean-clone persona of the same part (D-B6-27). A part with
 * neither in the directory gets no chip; none found = no chips.
 */
export function demoChips(directory: readonly DirectoryEntry[], currentPersonEntityId?: string | null): DemoChip[] {
  const chips: DemoChip[] = [];
  for (const p of DEMO_PERSONAS) {
    const fallback = CLEAN_CLONE_PERSONAS.find((c) => c.part === p.part)!;
    const own = resolve(directory, p);
    const persona = own ? p : fallback;
    const hit = own ?? resolve(directory, fallback);
    if (hit) chips.push({ ...persona, personEntityId: hit.personEntityId, active: !!currentPersonEntityId && hit.personEntityId === currentPersonEntityId });
  }
  return chips;
}
