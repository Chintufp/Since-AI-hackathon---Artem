/**
 * Scenario loaders. Two deliberately separate entry points:
 *  - loadVisibleInputs: what a system under test may receive (sources, people, problem text, observations).
 *  - loadHidden: answer keys, for the harness only.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { FamilyManifestEntry, IncomingProblems, PeopleDirectory, ScenarioTruth } from '../src/libs/utils/contracts/index.ts';
import { DEFAULT_SCENARIOS_DIR, loadFamiliesFile } from './splits.ts';

export interface VisibleProblem {
  id: string;
  text: string;
  requester: string;
  observations?: NonNullable<IncomingProblems['problems'][number]['observations']>;
}

export interface VisibleInputs {
  familyId: string;
  people: PeopleDirectory;
  /** Raw Teams export (parsed JSON). */
  teams: unknown;
  /** Raw email files: file name -> text. */
  emails: Record<string, string>;
  slack: {
    users: unknown;
    channels: unknown;
    /** "channel/YYYY-MM-DD" -> parsed day file. */
    days: Record<string, unknown>;
  };
  /** Problem text only: no keys. */
  problems: VisibleProblem[];
}

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf8')) as T;

export function familyEntry(familyId: string, root = DEFAULT_SCENARIOS_DIR): FamilyManifestEntry {
  const e = loadFamiliesFile(root).families.find((f) => f.id === familyId);
  if (!e) throw new Error(`unknown family ${familyId}`);
  return e;
}

export function loadVisibleInputs(familyId: string, root = DEFAULT_SCENARIOS_DIR): VisibleInputs {
  const entry = familyEntry(familyId, root);
  const dir = join(root, entry.dir);
  const src = join(dir, 'sources');
  const emails: Record<string, string> = {};
  for (const f of readdirSync(src).filter((n) => n.endsWith('.txt')).sort()) emails[f] = readFileSync(join(src, f), 'utf8');
  const slackDir = join(src, 'slack-export');
  const days: Record<string, unknown> = {};
  for (const ch of readdirSync(slackDir).sort()) {
    const p = join(slackDir, ch);
    if (!statSync(p).isDirectory()) continue;
    for (const d of readdirSync(p).sort()) days[`${ch}/${d.replace(/\.json$/, '')}`] = readJson(join(p, d));
  }
  // Only these fields of incoming.json are visible; the key is dropped here.
  const incoming = readJson<IncomingProblems>(join(dir, 'incoming.json'));
  return {
    familyId,
    people: readJson<PeopleDirectory>(join(dir, 'people.json')),
    teams: readJson(join(src, 'teams.json')),
    emails,
    slack: { users: readJson(join(slackDir, 'users.json')), channels: readJson(join(slackDir, 'channels.json')), days },
    problems: incoming.problems.map((p) => ({ id: p.id, text: p.text, requester: p.requester, ...(p.observations ? { observations: p.observations } : {}) })),
  };
}

export interface HiddenKeys {
  entry: FamilyManifestEntry;
  people: PeopleDirectory;
  truth: ScenarioTruth;
  incoming: IncomingProblems;
}

export function loadHidden(familyId: string, root = DEFAULT_SCENARIOS_DIR): HiddenKeys {
  const entry = familyEntry(familyId, root);
  const dir = join(root, entry.dir);
  return {
    entry,
    people: readJson<PeopleDirectory>(join(dir, 'people.json')),
    truth: readJson<ScenarioTruth>(join(dir, 'truth.json')),
    incoming: readJson<IncomingProblems>(join(dir, 'incoming.json')),
  };
}
