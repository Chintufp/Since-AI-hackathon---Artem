import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ModelArtifact } from '../contracts/index.ts';

/** <repo>/data/models, resolved from this file's location. */
export const defaultModelsDir = (): string => resolve(dirname(fileURLToPath(import.meta.url)), '../../../../data/models');

const safe = (id: string): string => {
  if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new Error(`Unsafe artifact id: ${id}`);
  return id;
};

export function saveArtifact(artifact: ModelArtifact, dir: string = defaultModelsDir()): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${safe(artifact.id)}.json`);
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`);
  return path;
}

export function loadArtifact(id: string, dir: string = defaultModelsDir()): ModelArtifact {
  return JSON.parse(readFileSync(join(dir, `${safe(id)}.json`), 'utf8')) as ModelArtifact;
}

export function listArtifacts(dir: string = defaultModelsDir()): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -5))
    .sort();
}
