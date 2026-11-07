/** Activity rows: one JSONL line per event (data/local/, git-ignored) and one readable terminal line. */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ActivityRowView } from '../contracts/index.ts';
import { hhmm } from './clock.ts';

export type ActivityRow = Omit<ActivityRowView, 'seq'>;
export type RowInput = Omit<ActivityRow, 'real' | 'simulated' | 'at'> & { at?: string };

export interface ActivitySink {
  write(row: ActivityRow): void;
}

/** Appends JSON lines; the service's GET /demo/activity tails the same file. */
export function jsonlSink(path: string): ActivitySink {
  mkdirSync(dirname(path), { recursive: true });
  return { write: (row) => appendFileSync(path, JSON.stringify(row) + '\n') };
}

const KIND_WIDTH = 13;

/** `09:14  question      Asked Erkki Expert: "Is TRN-301 an older unit?"  · because ...  [for you]` */
export function formatRow(row: ActivityRow): string {
  const kind = row.kind.padEnd(KIND_WIDTH);
  const why = row.why ? `  · ${row.why}` : '';
  const you = row.forYou ? '  [for you]' : '';
  return `${hhmm(row.at)}  ${kind} ${row.text}${why}${you}`;
}

export function terminalSink(write: (line: string) => void = (l) => process.stdout.write(l + '\n')): ActivitySink {
  return { write: (row) => write(formatRow(row)) };
}

export function combinedSink(...sinks: ActivitySink[]): ActivitySink {
  return { write: (row) => sinks.forEach((s) => s.write(row)) };
}

export const SIMULATED_BANNER = 'SIMULATED activity stream — synthetic families and a developer fixture; simulated people answer from a seeded model; no model API, no real chat, mail or Slack. Rows are appended as JSONL under data/local/.';
