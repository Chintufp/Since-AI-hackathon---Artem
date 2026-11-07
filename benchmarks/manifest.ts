/**
 * Run manifests and results schema (E00 convention). Every experiment run gets
 * experiments/results/<id>/manifest.json before scoring, and results.json after.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Route, Split } from '../src/libs/utils/contracts/index.ts';
import type { FailureExample, MaybeMetric } from './evaluator.ts';

export const DEFAULT_RESULTS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'experiments', 'results');

export interface RunManifest {
  /** Directory-safe id, e.g. "e00-baseline-2026-11-07". */
  id: string;
  /** The question this run answers, stated before scoring. */
  hypothesis: string;
  /** Scenario dataset version (families.json version). */
  datasetVersion: string;
  /** Splits used. Test is opened only after validation criteria are frozen. */
  splits: Split[];
  /** What the system under test was allowed to see (never answer keys). */
  visibleInputs: string[];
  /** Compared variants, each with its inference route. */
  variants: Array<{ id: string; description: string; route: Route }>;
  /** Frozen configuration (thresholds, k, budgets). */
  config: Record<string, unknown>;
  seeds: number[];
  /** Route summary for the whole run. */
  route: Route | 'mixed';
  /** Resource cap, e.g. {"maxWallSeconds": 600, "networkCalls": 0}. */
  resourceCap: Record<string, number | string>;
  /** Metric ids reported together (never a single scalar). */
  metrics: string[];
  /** Acceptance criteria fixed BEFORE scoring; empty means "report without declaring a winner". */
  acceptanceCriteria: string[];
  stopRule: string;
  startedAt: string;
}

export interface VariantResult {
  variantId: string;
  /** Provenance of the numbers: measured on this Mac, replayed from a fixture, or a hand-built reference. */
  provenance: 'measured' | 'replay-fixture' | 'reference-oracle' | 'simulated';
  split: Split;
  metrics: Record<string, MaybeMetric>;
  counts: Record<string, number | null>;
  failures: FailureExample[];
  /** Failure counts and ids per scenario tag. */
  failureSlicesByTag: Record<string, { count: number; ids: string[] }>;
  /** Variation across seeds when repeated; omitted when single run. */
  repeatVariation?: Record<string, { min: number; max: number; runs: number }>;
}

export interface RunResults {
  manifestId: string;
  finishedAt: string;
  variants: VariantResult[];
  /** Honest limitations and unresolved items for this run. */
  notes: string[];
}

const REQUIRED: Array<keyof RunManifest> = ['id', 'hypothesis', 'datasetVersion', 'splits', 'visibleInputs', 'variants', 'config', 'seeds', 'route', 'resourceCap', 'metrics', 'acceptanceCriteria', 'stopRule', 'startedAt'];

export function validateManifest(m: unknown): string[] {
  const errs: string[] = [];
  if (!m || typeof m !== 'object') return ['manifest is not an object'];
  const o = m as Record<string, unknown>;
  for (const k of REQUIRED) if (!(k in o) || o[k] === undefined) errs.push(`missing field ${k}`);
  if (typeof o.id === 'string' && !/^[a-z0-9][a-z0-9._-]*$/i.test(o.id)) errs.push('id must be directory-safe');
  if (Array.isArray(o.variants) && o.variants.length === 0) errs.push('at least one variant is required');
  if (Array.isArray(o.visibleInputs) && o.visibleInputs.some((v) => /truth|incoming.*key|answer/i.test(String(v)))) errs.push('visibleInputs must not list hidden keys');
  return errs;
}

export function manifestPath(id: string, root = DEFAULT_RESULTS_DIR): string {
  return join(root, id, 'manifest.json');
}

export function writeManifest(m: RunManifest, root = DEFAULT_RESULTS_DIR): string {
  const errs = validateManifest(m);
  if (errs.length) throw new Error(`invalid manifest: ${errs.join('; ')}`);
  const p = manifestPath(m.id, root);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(m, null, 2) + '\n');
  return p;
}

export function readManifest(id: string, root = DEFAULT_RESULTS_DIR): RunManifest {
  const p = manifestPath(id, root);
  if (!existsSync(p)) throw new Error(`no manifest at ${p}`);
  const m = JSON.parse(readFileSync(p, 'utf8')) as RunManifest;
  const errs = validateManifest(m);
  if (errs.length) throw new Error(`invalid manifest ${p}: ${errs.join('; ')}`);
  return m;
}

export function writeResults(r: RunResults, root = DEFAULT_RESULTS_DIR): string {
  readManifest(r.manifestId, root); // a run must have a manifest first
  const p = join(root, r.manifestId, 'results.json');
  writeFileSync(p, JSON.stringify(r, null, 2) + '\n');
  return p;
}

export function readResults(id: string, root = DEFAULT_RESULTS_DIR): RunResults {
  return JSON.parse(readFileSync(join(root, id, 'results.json'), 'utf8')) as RunResults;
}
