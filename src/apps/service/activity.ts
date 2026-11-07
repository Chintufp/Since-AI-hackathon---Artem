/**
 * Read-only view of the simulated activity stream written by `pnpm demo:play` (scripts/demo-play.ts) as JSONL under
 * data/local/. The service never writes this file; it only tails it for `GET /demo/activity` and the small standalone
 * page at `/demo/activity.html`. Every row is simulated: no real person, chat or mailbox is behind it.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_ROOT } from './paths.ts';

export const DEFAULT_ACTIVITY_LOG = join(REPO_ROOT, 'data', 'local', 'demo-activity.jsonl');

export interface ActivityRow {
  /** 1-based position in the file (stable while the file is only appended to). */
  seq: number;
  /** Simulated time (ISO). */
  at: string;
  /** Real time the row was written (ISO). */
  real: string;
  /** evidence | investigation | question | answer | judge | clock | note | summary */
  kind: string;
  /** One line for people. */
  text: string;
  /** Person the row is about (display name), when any. */
  who?: string;
  /** Why this person / why this happened, in plain words. */
  why?: string;
  /** Free structured detail (ids, recommendation kind, family). */
  detail?: Record<string, unknown>;
  simulated: true;
  /** The judge's own person was involved (a question for them, or their own action). */
  forYou?: boolean;
}

export interface ActivityResponse {
  simulated: true;
  source: string;
  present: boolean;
  /** Total rows in the file. */
  total: number;
  rows: ActivityRow[];
}

/** Rows after `since` (a seq), newest last, at most `limit` (default 200). Missing file: empty, `present: false`. */
export function readActivity(path = DEFAULT_ACTIVITY_LOG, query: { since?: number; limit?: number } = {}): ActivityResponse {
  if (!existsSync(path)) return { simulated: true, source: path, present: false, total: 0, rows: [] };
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim());
  const since = Math.max(0, Math.floor(query.since ?? 0));
  const limit = Math.min(1000, Math.max(1, Math.floor(query.limit ?? 200)));
  const rows: ActivityRow[] = [];
  for (let i = since; i < lines.length; i++) {
    try {
      const parsed = JSON.parse(lines[i] as string) as Partial<ActivityRow>;
      rows.push({ ...(parsed as ActivityRow), seq: i + 1, simulated: true });
    } catch {
      // A half-written last line is skipped until it is complete.
    }
  }
  return { simulated: true, source: path, present: true, total: lines.length, rows: rows.slice(-limit) };
}
