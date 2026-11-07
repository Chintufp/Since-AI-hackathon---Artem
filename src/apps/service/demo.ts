import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { DirectoryEntry, FamiliesFile, ImportResponse } from '../../libs/utils/contracts/index.ts';
import type { Engine, EngineOptions } from './engine.ts';
import { REPO_ROOT } from './paths.ts';

export const DEFAULT_ELISA_DIR = join(REPO_ROOT, 'private', 'Elisa_SinceAI2026', 'ELISA_HIDDEN_KNOWLEDGE_EXAMPLE_2026');

/**
 * Demo reset: clear the store (settings are kept), then import
 *  - the organizer's Elisa example when it is present on this machine ('elisa' or no seed),
 *  - every 'demo' split family (sources/ and people.json only; truth.json and incoming.json are never read),
 *  - the developer fixture data/fixtures/dev-family-01 when present.
 * seed 'empty' only clears.
 */
export type DemoResetResult = { ok: true; imported: ImportResponse[]; defaultPersonEntityId?: string };

/**
 * Who "You" is after a reset: the directory person named by `wanted` (id or name, case-insensitive), else the first
 * available person whose role matches /field/i, else the first entry. Undefined when the directory is empty.
 */
export function pickDefaultPerson(directory: DirectoryEntry[], wanted?: string): DirectoryEntry | undefined {
  const w = wanted?.trim().toLowerCase();
  const named = w ? directory.find((d) => d.personEntityId.toLowerCase() === w || d.name.toLowerCase() === w) : undefined;
  return named ?? directory.find((d) => d.available && /field/i.test(d.role ?? '')) ?? directory[0];
}

export async function resetDemo(engine: Engine, seed: 'elisa' | 'synthetic' | 'empty' | undefined, opts: EngineOptions, defaultPerson?: string): Promise<DemoResetResult> {
  engine.resetStore();
  const imported: ImportResponse[] = [];
  const finish = (): DemoResetResult => {
    const person = pickDefaultPerson(engine.directory(), defaultPerson);
    // A stale current person from before the reset would point at an entity that no longer exists.
    engine.putSettings({ currentPersonEntityId: person?.personEntityId ?? '' });
    return { ok: true, imported, ...(person ? { defaultPersonEntityId: person.personEntityId } : {}) };
  };
  if (seed === 'empty') return finish();
  if (seed !== 'synthetic') {
    const dir = opts.elisaDir ?? DEFAULT_ELISA_DIR;
    const teams = join(dir, 'teams_chat.json');
    const email = join(dir, 'email.txt');
    if (existsSync(teams)) imported.push(engine.importData({ format: 'teams-json', path: teams, connectionId: 'import:teams:file' }));
    if (existsSync(email)) imported.push(engine.importData({ format: 'email-text', path: email, connectionId: 'import:email:file' }));
  }
  const scenarios = opts.scenariosDir ?? join(REPO_ROOT, 'data', 'scenarios');
  const manifest = join(scenarios, 'families.json');
  if (existsSync(manifest)) {
    const families = (JSON.parse(readFileSync(manifest, 'utf8')) as FamiliesFile).families.filter((f) => f.split === 'demo');
    for (const f of families) {
      const dir = join(scenarios, f.dir);
      if (existsSync(dir)) imported.push(engine.importData({ format: 'scenario-dir', path: dir }));
    }
  }
  const fixture = join(opts.fixturesDir ?? join(REPO_ROOT, 'data', 'fixtures'), 'dev-family-01');
  if (existsSync(fixture)) imported.push(engine.importData({ format: 'scenario-dir', path: fixture }));
  return finish();
}
