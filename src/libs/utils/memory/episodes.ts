/**
 * Episode assignment: which case does each extracted incident belong to?
 *
 * The extractor names an incident after its asset (`asset:<id>`) inside one conversation. Across conversations the same
 * asset can have several separate episodes (a new problem after an earlier recovery), and write-ups or follow-ups that
 * state no problem of their own belong to an existing episode. This step decides, over everything extracted in one import
 * (plus the episodes already in the store), and renames incident keys: first episode `asset:<id>`, later ones
 * `asset:<id>#2`, `#3` ...
 *
 * Boundaries use only generic signals: the asset, a recurrence/new-problem cue in the incident's first problem statement
 * ("again", "came back", "new problem"), whether the earlier episode ended in an outcome, known event times and the gap
 * between them, and token overlap for unanchored write-ups. Unknown stays unknown: without times or cues, incidents on one
 * asset stay together.
 */
import type { ConversationContext, ExtractionProposal, KnowledgeStore } from '../contracts/index.ts';
import { stableId } from '../contracts/index.ts';
import type { ExtractionConfig } from './extraction-config.ts';
import { contentWords } from './extractor-rules.ts';
import { recurrenceOf } from './language.ts';

export interface EpisodeItem { ctx: ConversationContext; proposal: ExtractionProposal }

interface Meta {
  item: EpisodeItem;
  inc: ExtractionProposal['incidents'][number];
  base: string;
  anchored: boolean;
  recurrence: boolean;
  hasOutcome: boolean;
  time?: number;
  words: Set<string>;
  people: Set<string>;
  order: number;
}

interface Episode { n: number; recurrence: boolean; hasOutcome: boolean; time?: number; words: Set<string>; evidenceIds: Set<string>; people: Set<string> }

const day = 86_400_000;
const norm = (s: string): string => s.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();

export const episodeBase = (key: string): string => key.replace(/#\d+$/, '');
export const episodeKey = (base: string, n: number): string => (n === 1 ? base : `${base}#${n}`);

/** True when a problem statement says the problem happened again or is a new one (a new episode, not a continuation). */
export function isRecurrenceStatement(statement: string, cfg: ExtractionConfig): boolean {
  return recurrenceOf(statement, cfg);
}

function metaOf(item: EpisodeItem, inc: ExtractionProposal['incidents'][number], cfg: ExtractionConfig, order: number): Meta {
  const ids = new Set(inc.evidenceIds);
  const claims = item.proposal.claims.filter((c) => ids.has(c.evidence[0]?.evidenceId ?? ''));
  const obs = claims.find((c) => c.type === 'observation');
  const times = item.ctx.evidence.filter((e) => ids.has(e.id) && e.eventTime.known && e.eventTime.iso).map((e) => Date.parse(e.eventTime.iso!)).filter((t) => Number.isFinite(t));
  return {
    item, inc, base: episodeBase(inc.key), anchored: !!obs, recurrence: !!obs && isRecurrenceStatement(obs.statement, cfg),
    hasOutcome: claims.some((c) => c.type === 'outcome'),
    ...(times.length ? { time: Math.min(...times) } : {}),
    words: new Set(claims.flatMap((c) => contentWords(c.statement))), order,
    people: new Set(item.ctx.evidence.filter((e) => ids.has(e.id)).flatMap((e) => [e.author, ...(e.recipients ?? [])]).map((a) => norm(a.displayName)).filter((n) => n && !/unknown/.test(n))),
  };
}

/** Episodes already stored for an asset base key (keys are recomputable: ids come from stableId(orgId, key)). */
function storedEpisodes(store: KnowledgeStore, orgId: string, base: string, cfg: ExtractionConfig): Episode[] {
  const out: Episode[] = [];
  for (let n = 1; n < 50; n++) {
    const c = store.get('case', stableId('case', orgId, episodeKey(base, n)));
    if (!c) break;
    const claims = store.list('claim', { where: { caseId: c.id } });
    const obs = claims.find((x) => x.type === 'observation');
    out.push({
      n, recurrence: !!obs && isRecurrenceStatement(obs.statement, cfg), hasOutcome: c.outcomeIds.length > 0,
      ...(c.startedAt.known && c.startedAt.iso && Number.isFinite(Date.parse(c.startedAt.iso)) ? { time: Date.parse(c.startedAt.iso) } : {}),
      words: new Set(claims.flatMap((x) => contentWords(x.statement))), evidenceIds: new Set(c.evidenceIds),
      people: new Set(c.evidenceIds.flatMap((id) => { const e = store.get('evidence', id); return e ? [e.author, ...(e.recipients ?? [])] : []; }).map((a) => norm(a.displayName)).filter((n) => n && !/unknown/.test(n))),
    });
  }
  return out;
}

const overlap = (a: Set<string>, b: Set<string>): number => {
  if (!a.size || !b.size) return 0;
  let i = 0;
  for (const w of a) if (b.has(w)) i++;
  return i / (a.size + b.size - i);
}

/** Rename incident keys in place. Idempotent for the same set of items and store. */
export function assignEpisodes(store: KnowledgeStore, orgId: string, items: EpisodeItem[], cfg: ExtractionConfig): void {
  const metas: Meta[] = [];
  let order = 0;
  for (const item of items) for (const inc of item.proposal.incidents) if (inc.key.startsWith('asset:')) metas.push(metaOf(item, inc, cfg, order++));
  const groups = new Map<string, Meta[]>();
  for (const m of metas) (groups.get(m.base) ?? groups.set(m.base, []).get(m.base)!).push(m);
  const gapMs = cfg.episodeGapDays * day;
  const followMs = cfg.followUpDays * day;

  for (const [base, group] of groups) {
    const episodes: Episode[] = storedEpisodes(store, orgId, base, cfg);
    const take = (m: Meta, e: Episode): void => {
      m.inc.key = episodeKey(base, e.n);
      e.hasOutcome ||= m.hasOutcome;
      if (m.time !== undefined && (e.time === undefined || m.time < e.time)) e.time = m.time;
      for (const w of m.words) e.words.add(w);
      for (const id of m.inc.evidenceIds) e.evidenceIds.add(id);
      for (const p of m.people) e.people.add(p);
    };
    const fresh = (m: Meta): Episode => {
      const e: Episode = { n: Math.max(0, ...episodes.map((x) => x.n)) + 1, recurrence: m.anchored && m.recurrence, hasOutcome: false, words: new Set(), evidenceIds: new Set(), people: new Set() };
      episodes.push(e);
      take(m, e);
      return e;
    };
    const rank = (m: Meta): number => (m.anchored ? (m.recurrence ? 0 : 1) : 2);
    // Re-importing evidence that already sits in a stored episode keeps that episode (idempotent import).
    const pending: Meta[] = [];
    for (const m of group) {
      const known = episodes.find((e) => m.inc.evidenceIds.some((id) => e.evidenceIds.has(id)));
      if (known) m.inc.key = episodeKey(base, known.n);
      else pending.push(m);
    }
    const sorted = [...pending].sort((a, b) => rank(a) - rank(b) || (a.time ?? Infinity) - (b.time ?? Infinity) || a.order - b.order);
    for (const m of sorted) {
      if (m.anchored) {
        if (!episodes.length) { fresh(m); continue; }
        if (m.recurrence) { fresh(m); continue; }
        // an incident close in time to a known episode is part of it; otherwise it continues the first non-recurrence episode
        // unless that one already ended in an outcome and the two are far apart
        const near = m.time === undefined ? undefined : episodes.filter((e) => e.time !== undefined).sort((a, b) => Math.abs(a.time! - m.time!) - Math.abs(b.time! - m.time!))[0];
        if (near && Math.abs(near.time! - m.time!) <= gapMs) { take(m, near); continue; }
        // independent reports of the same problem (other people, other channels) confirm one episode rather than start another
        const first = episodes.find((e) => !e.recurrence);
        const apart = first && first.hasOutcome && first.time !== undefined && m.time !== undefined && Math.abs(m.time - first.time) > gapMs;
        if (first && !apart) take(m, first);
        else fresh(m);
        continue;
      }
      // a write-up or follow-up with no problem statement of its own: nearest episode in time, else most similar words, else the first
      if (!episodes.length) { fresh(m); continue; }
      let best: Episode | undefined;
      if (m.time !== undefined) {
        const timed = episodes.filter((e) => e.time !== undefined).sort((a, b) => Math.abs(a.time! - m.time!) - Math.abs(b.time! - m.time!));
        if (timed[0] && Math.abs(timed[0].time! - m.time!) <= followMs) best = timed[0];
      }
      if (!best) {
        // a dated record far from every dated episode says nothing about the undated ones: prefer those
        const pool = m.time !== undefined && episodes.some((e) => e.time === undefined) ? episodes.filter((e) => e.time === undefined) : episodes;
        const scored = pool.map((e) => ({ e, s: overlap(m.words, e.words) })).sort((a, b) => b.s - a.s || a.e.n - b.e.n);
        best = scored[0]!.s > 0 ? scored[0]!.e : (pool.find((e) => !e.recurrence) ?? pool[0]!);
      }
      take(m, best);
    }
  }
}
