/**
 * Plan of one simulated day: when evidence arrives (Teams threads, e-mails, Slack days from the synthetic families),
 * when simulated engineers start investigations, and when the stream may try to involve the judge's own person.
 * Pure and deterministic in (seed, inputs). Times are simulated minutes from the start of the day.
 */
import type { PeopleDirectory } from '../contracts/index.ts';
import { createRng, shuffleInPlace } from '../models/index.ts';

export interface SourceInput {
  format: 'teams-json' | 'email-text' | 'slack-export';
  /** Inline payload for POST /import (parsed Teams JSON, raw e-mail text, SlackExportData). */
  payload: unknown;
  /** Short label for the log, e.g. "Teams thread, 10 messages (Aarne Koskela, Helmi Virtanen)". */
  label: string;
}

export interface ProblemInput {
  id: string;
  text: string;
  /** The simulated requester: directory id (people.json id or entity id), display name and directory groups. */
  requester: { id: string; name: string; groups: string[] };
  observations?: Array<{ key: string; value: string | number | boolean; label: string }>;
}

export interface FamilyInput {
  id: string;
  description: string;
  /** Already in memory before the day starts (demo reset); its problems can be asked from the first minute. */
  seeded: boolean;
  directory?: PeopleDirectory;
  sources: SourceInput[];
  problems: ProblemInput[];
}

export type PlanEvent =
  | { at: number; kind: 'directory'; family: string; directory: PeopleDirectory }
  | { at: number; kind: 'evidence'; family: string; source: SourceInput }
  | { at: number; kind: 'investigate'; family: string; problem: ProblemInput }
  | { at: number; kind: 'judge-slot'; index: number };

export interface DayPlan {
  seed: number;
  hours: number;
  judgeEveryMinutes: number;
  events: PlanEvent[];
}

export interface PlanOptions {
  seed: number;
  families: FamilyInput[];
  /** Length of the simulated day. */
  hours?: number;
  /** Minimum spacing between attempts to involve the judge (default 120). */
  judgeEveryMinutes?: number;
  /** Extra free-text problems (e.g. Elisa-style texts) asked by simulated people, spread over the day. */
  extraProblems?: Array<ProblemInput & { family?: string }>;
}

const clamp = (x: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, x));

export function planDay(opts: PlanOptions): DayPlan {
  const hours = opts.hours ?? 10;
  const total = hours * 60;
  const judgeEvery = opts.judgeEveryMinutes ?? 120;
  const rng = createRng(opts.seed * 100003 + 7);
  const events: PlanEvent[] = [];
  const families = shuffleInPlace([...opts.families], rng);
  const seeded = families.filter((f) => f.seeded);
  const arriving = families.filter((f) => !f.seeded);

  // Seeded families: problems anywhere in the day (jittered uniform), never two of the same family within 20 minutes.
  const seededProblems = shuffleInPlace(seeded.flatMap((f) => f.problems.map((p) => ({ family: f.id, problem: p }))), rng);
  seededProblems.forEach((p, i) => {
    const slot = (total / (seededProblems.length + 1)) * (i + 1);
    events.push({ at: Math.round(clamp(slot + (rng() - 0.5) * 40, 5, total - 10)), kind: 'investigate', family: p.family, problem: p.problem });
  });

  // Arriving families: directory first, sources staggered, problems after the last source.
  arriving.forEach((f, i) => {
    const windowStart = (total * 0.6 * i) / Math.max(1, arriving.length) + 10 + rng() * 30;
    // Short days squeeze the spacing so every arrival still lands inside the day (sources before problems).
    const squeeze = Math.min(1, (total * 0.35) / Math.max(1, f.sources.length * 38 + f.problems.length * 90));
    let t = Math.round(Math.min(windowStart, total * 0.6));
    if (f.directory) events.push({ at: t, kind: 'directory', family: f.id, directory: f.directory });
    for (const s of f.sources) {
      t += Math.max(1, Math.round((8 + rng() * 30) * squeeze));
      events.push({ at: Math.min(t, total - 6), kind: 'evidence', family: f.id, source: s });
    }
    let p = Math.min(t, total - 6);
    for (const problem of f.problems) {
      p += Math.max(1, Math.round((20 + rng() * 70) * squeeze));
      events.push({ at: Math.min(p, total - 5), kind: 'investigate', family: f.id, problem });
    }
  });

  (opts.extraProblems ?? []).forEach((p, i, all) => {
    const slot = (total / (all.length + 1)) * (i + 1);
    events.push({ at: Math.round(clamp(slot + (rng() - 0.5) * 60, 8, total - 8)), kind: 'investigate', family: p.family ?? 'extra', problem: p });
  });

  for (let k = 0, at = 40; at < total - 15; k++, at += judgeEvery) events.push({ at, kind: 'judge-slot', index: k });

  events.sort((a, b) => a.at - b.at || order(a) - order(b));
  return { seed: opts.seed, hours, judgeEveryMinutes: judgeEvery, events };
}

const order = (e: PlanEvent): number => ({ directory: 0, evidence: 1, 'judge-slot': 2, investigate: 3 })[e.kind];
