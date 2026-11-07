/**
 * Simulated colleagues. The same model as models/testing/simulator.ts (hidden per-person knowledge, a responsiveness
 * probability, correct-answer rates for firsthand vs hearsay) applied to the visible directory of the running service:
 * every reply is drawn from a seeded generator, never from a model and never from the scenarios' hidden answer keys.
 * These are simulated people; the log says so on every row.
 */
import type { DirectoryEntry } from '../contracts/index.ts';
import { createRng } from '../models/index.ts';

export type ReplyAction = 'yes' | 'no' | 'unknown' | 'later' | 'dismiss' | 'none';

export interface SimProfile {
  personEntityId: string;
  name: string;
  role?: string;
  /** Probability of reacting to a question at all (simulator: 0.55–0.95). */
  responsiveness: number;
  /** Topics this person answers from firsthand-like knowledge (higher correctness), derived from role/groups. */
  firsthandFor: string[];
  /** HIDDEN (simulation only): what the person would say per topic; a missing topic means "not sure". */
  knows: Record<string, 'yes' | 'no'>;
}

export interface SimReply {
  action: ReplyAction;
  /** Simulated minutes after delivery. */
  delayMinutes: number;
  /** For 'later': minutes after the deferral when the person comes back with an answer (undefined = never). */
  followUpMinutes?: number;
  followUp?: 'yes' | 'no' | 'unknown';
  reason: string;
}

/** Question topics (condition keys) a simulated person can hold an opinion on; `outcome` covers "Did ... right after ...?". */
export const SIM_TOPICS = ['unit.age', 'unit.model', 'unit.revision', 'software.version', 'config.changed', 'site.access', 'power.state', 'temperature.state', 'outcome', 'other'] as const;

const EQUIPMENT = ['unit.age', 'unit.model', 'unit.revision', 'software.version', 'config.changed'];
const SITE = ['site.access', 'power.state', 'temperature.state'];

/** Which topics a role or group speaks to firsthand (mirrors the service's observability policy in spirit, not by import). */
function firsthandTopics(p: DirectoryEntry): string[] {
  const out = new Set<string>();
  const role = (p.role ?? '').toLowerCase();
  if (/network|noc|routing|technician|core|transport/.test(role) || p.groups.some((g) => ['noc', 'transport', 'core'].includes(g))) EQUIPMENT.forEach((k) => out.add(k));
  if (/field|site|power|hardware|access/.test(role) || p.groups.some((g) => ['field', 'access', 'power'].includes(g))) SITE.forEach((k) => out.add(k));
  if (/field|engineer|technician|specialist/.test(role)) out.add('outcome');
  return [...out];
}

/** Derive the topic a question is about from its text (the service does not expose the gap key to clients). */
export function topicOf(text: string): string {
  const t = text.toLowerCase();
  if (/^did\b|right after|straight after/.test(t)) return 'outcome';
  if (/older unit|newer unit|unit generation|20\d\d|batch|installed/.test(t)) return 'unit.age';
  if (/revision/.test(t)) return 'unit.revision';
  if (/software|firmware|version/.test(t)) return 'software.version';
  if (/config|template|bundle/.test(t)) return 'config.changed';
  if (/\bmodel\b|\ban? [a-z]{1,3}-?\d{1,3}[a-z]?\b/.test(t)) return 'unit.model';
  if (/access|barrier|lockbox|key\b|code\b/.test(t)) return 'site.access';
  if (/power|rectifier|battery|mains|dc\b/.test(t)) return 'power.state';
  if (/temperature|fan|inlet|cooling/.test(t)) return 'temperature.state';
  return 'other';
}

/** Deterministic profiles for the directory (same seed, same directory order → same profiles). */
export function buildProfiles(directory: DirectoryEntry[], seed: number): Map<string, SimProfile> {
  const rng = createRng(seed * 7919 + 13);
  const truth: Record<string, 'yes' | 'no'> = {};
  for (const k of SIM_TOPICS) truth[k] = rng() < 0.5 ? 'yes' : 'no';
  const out = new Map<string, SimProfile>();
  for (const p of [...directory].sort((a, b) => a.personEntityId.localeCompare(b.personEntityId))) {
    const firsthandFor = firsthandTopics(p);
    const knows: Record<string, 'yes' | 'no'> = {};
    for (const k of SIM_TOPICS) {
      const fh = firsthandFor.includes(k);
      if (fh || rng() < 0.25) {
        const correct = rng() < (fh ? 0.92 : 0.7);
        knows[k] = correct ? truth[k]! : truth[k] === 'yes' ? 'no' : 'yes';
      }
    }
    out.set(p.personEntityId, { personEntityId: p.personEntityId, name: p.name, ...(p.role ? { role: p.role } : {}), responsiveness: 0.55 + rng() * 0.4, firsthandFor, knows });
  }
  return out;
}

const minutes = (rng: () => number, lo: number, hi: number): number => Math.round(lo + rng() * (hi - lo));

/**
 * How a simulated person reacts to one delivered question. `draw` is a seeded generator owned by the caller so the
 * sequence of replies is reproducible for a seed. Mirrors the simulator: not responding → nothing (or Later/Dismiss
 * in the companion's vocabulary); responding → their hidden knowledge, or "not sure" when the topic is outside it.
 */
export function decideReply(profile: SimProfile, questionText: string, draw: () => number): SimReply {
  const topic = topicOf(questionText);
  const u = draw();
  if (u > profile.responsiveness) {
    const v = draw();
    if (v < 0.5) {
      const comes = draw() < 0.7;
      const said = profile.knows[topic];
      return {
        action: 'later', delayMinutes: minutes(draw, 2, 25), reason: `busy (responsiveness ${profile.responsiveness.toFixed(2)})`,
        ...(comes ? { followUpMinutes: minutes(draw, 45, 160), followUp: said ?? 'unknown' } : {}),
      };
    }
    if (v < 0.75) return { action: 'dismiss', delayMinutes: minutes(draw, 3, 30), reason: 'not their question today' };
    return { action: 'none', delayMinutes: 0, reason: 'no reaction during the simulated day' };
  }
  const said = profile.knows[topic];
  const delay = minutes(draw, 3, 40);
  if (!said) return { action: 'unknown', delayMinutes: delay, reason: `${topic} is outside what they know` };
  return { action: said, delayMinutes: delay, reason: profile.firsthandFor.includes(topic) ? `${topic}: firsthand-like knowledge` : `${topic}: hearsay-level knowledge` };
}
