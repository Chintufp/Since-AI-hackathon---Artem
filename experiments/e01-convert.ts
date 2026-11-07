/**
 * E01 conversion layer: recorded Claude-agent proposals (data/replays/e01-claude-arm/<family>.json) -> evidence ids the
 * harness imports -> SystemKnowledge (direct scoring) or a committable ExtractionProposal.
 *
 * Evidence-id mapping (exact, no fuzzy matching). The fixtures use the simplified forms `teams:<seq>`,
 * `email:<Message-ID with angle brackets>` and `slack:<ts>`; the connectors store `<conversation>#<seq>`, `msgid:<Message-ID>`
 * and `<channelId>:<ts>`. A replay id is matched to the one non-quoted, non-superseded evidence record with the same
 * provider and the same seq / Message-ID / ts. Zero or several matches leave the id unmapped (counted, never guessed).
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ActorRef, Case, Claim, Condition, Entity, EvidenceEnvelope, EvidenceRef, ExtractionProposal, PeopleDirectory, PersonWorkLink, ProposedEntity,
} from '../src/libs/utils/contracts/index.ts';
import { stableId, unknownTime } from '../src/libs/utils/contracts/index.ts';
import type { SystemKnowledge } from '../benchmarks/evaluator.ts';
import { loadFamiliesFile } from '../benchmarks/splits.ts';
import { normName } from '../benchmarks/text.ts';

export const REPLAY_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'replays', 'e01-claude-arm');
export const ARM_ROUTE = 'claude-agent-arm' as const;

export interface E01Fixture extends ExtractionProposal {
  familyId: string;
  inputs: string[];
}

export function loadFixture(familyId: string, dir = REPLAY_DIR): E01Fixture {
  const p = join(dir, `${familyId}.json`);
  if (!existsSync(p)) throw new Error(`no E01 replay fixture for ${familyId}`);
  const fx = JSON.parse(readFileSync(p, 'utf8')) as E01Fixture;
  if (fx.familyId !== familyId) throw new Error(`fixture ${p} declares family ${fx.familyId}`);
  if (fx.route?.route !== ARM_ROUTE) throw new Error(`fixture ${p} has route ${fx.route?.route}, expected ${ARM_ROUTE}`);
  return fx;
}

/** Families that have a recorded fixture, restricted to the splits E01 may use (never demo or test). */
export function fixtureFamilies(splits: Array<'train' | 'validation'>, dir = REPLAY_DIR): string[] {
  const have = new Set(readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5)));
  return loadFamiliesFile().families.filter((f) => (splits as string[]).includes(f.split) && have.has(f.id)).map((f) => f.id);
}

// ------------------------------------------------------------------------------------------------ id mapping

/** `provider:key` of a stored evidence record in the replay-id convention, or undefined for providers without one. */
export function replayKeyOfEnvelope(e: Pick<EvidenceEnvelope, 'provider' | 'sourceId'>): string | undefined {
  switch (e.provider) {
    case 'teams': return `teams:${e.sourceId.includes('#') ? e.sourceId.slice(e.sourceId.lastIndexOf('#') + 1) : e.sourceId}`;
    case 'email': return `email:${e.sourceId.replace(/^msgid:/, '').replace(/^<|>$/g, '')}`;
    case 'slack': return `slack:${e.sourceId.slice(e.sourceId.lastIndexOf(':') + 1)}`;
    default: return undefined;
  }
}

/** Normal form of a fixture evidence id (same convention as `replayKeyOfEnvelope`). */
export function replayKeyOfId(id: string): string {
  const i = id.indexOf(':');
  if (i < 0) return id.trim();
  const provider = id.slice(0, i).toLowerCase();
  const rest = id.slice(i + 1).trim();
  return `${provider}:${provider === 'email' ? rest.replace(/^<|>$/g, '') : rest}`;
}

export interface EvidenceIndex {
  /** Evidence record id for a replay id, undefined when none or several records match. */
  resolve(replayId: string): string | undefined;
  /** Replay keys that matched several records (should be empty). */
  ambiguous: string[];
  size: number;
}

export function buildEvidenceIndex(evidence: EvidenceEnvelope[]): EvidenceIndex {
  const found = new Map<string, string[]>();
  for (const e of evidence) {
    if (e.metadata?.segment === 'quoted' || e.metadata?.supersededBy) continue;
    const k = replayKeyOfEnvelope(e);
    if (k) found.set(k, [...(found.get(k) ?? []), e.id]);
  }
  return {
    resolve: (id) => { const m = found.get(replayKeyOfId(id)); return m?.length === 1 ? m[0] : undefined; },
    ambiguous: [...found.entries()].filter(([, v]) => v.length > 1).map(([k]) => k),
    size: found.size,
  };
}

export interface MappingStats {
  evidenceRefs: number;
  evidenceRefsMapped: number;
  unmappedIds: string[];
  claims: number;
  claimsDropped: number;
  entities: number;
  links: number;
  linksDropped: number;
  incidents: number;
  incidentsDropped: number;
  incidentEvidenceIds: number;
  incidentEvidenceIdsMapped: number;
}

/** Re-point every evidence reference of a fixture at the harness' evidence records. Unmapped references are dropped and counted. */
export function mapProposal(fx: ExtractionProposal, index: EvidenceIndex): { proposal: ExtractionProposal; stats: MappingStats } {
  const stats: MappingStats = {
    evidenceRefs: 0, evidenceRefsMapped: 0, unmappedIds: [], claims: fx.claims.length, claimsDropped: 0, entities: fx.entities.length,
    links: fx.links.length, linksDropped: 0, incidents: fx.incidents.length, incidentsDropped: 0, incidentEvidenceIds: 0, incidentEvidenceIdsMapped: 0,
  };
  const unmapped = new Set<string>();
  const refs = (list: EvidenceRef[]): EvidenceRef[] => {
    const out: EvidenceRef[] = [];
    for (const r of list) {
      stats.evidenceRefs++;
      const id = index.resolve(r.evidenceId);
      if (!id) { unmapped.add(r.evidenceId); continue; }
      stats.evidenceRefsMapped++;
      out.push({ ...r, evidenceId: id });
    }
    return out;
  };
  const cond = (c: Condition | undefined): Condition | undefined => (c ? { ...c, evidence: refs(c.evidence) } : undefined);
  const entities = fx.entities.map((e) => ({
    ...e, evidence: refs(e.evidence),
    ...(e.attributes ? { attributes: Object.fromEntries(Object.entries(e.attributes).map(([k, v]) => [k, { ...v, evidence: refs(v.evidence) }])) } : {}),
  }));
  const claims = fx.claims.flatMap((c) => {
    const evidence = refs(c.evidence);
    if (!evidence.length) { stats.claimsDropped++; return []; }
    const condition = cond(c.condition);
    return [{ ...c, evidence, ...(condition ? { condition } : {}) }];
  });
  const links = fx.links.flatMap((l) => {
    const evidence = refs(l.evidence);
    if (!evidence.length) { stats.linksDropped++; return []; }
    return [{ ...l, evidence }];
  });
  const incidents = fx.incidents.flatMap((i) => {
    stats.incidentEvidenceIds += i.evidenceIds.length;
    const ids = [...new Set(i.evidenceIds.flatMap((x) => { const m = index.resolve(x); if (!m) unmapped.add(x); return m ? [m] : []; }))];
    stats.incidentEvidenceIdsMapped += ids.length;
    if (!ids.length) { stats.incidentsDropped++; return []; }
    return [{ ...i, evidenceIds: ids }];
  });
  const usefulness = fx.usefulness.flatMap((u) => { const id = index.resolve(u.evidenceId); if (!id) { unmapped.add(u.evidenceId); return []; } return [{ ...u, evidenceId: id }]; });
  stats.unmappedIds = [...unmapped].sort();
  return { proposal: { ...fx, entities, claims, links, incidents, usefulness }, stats };
}

// ------------------------------------------------------------------------------------------------ directory helpers

export class DirectoryLookup {
  readonly directory: PeopleDirectory;
  constructor(directory: PeopleDirectory) { this.directory = directory; }
  /** Directory person for a directory id, a provider actor id or an exact normalized display name. */
  find(idOrName: string): PeopleDirectory['people'][number] | undefined {
    const n = normName(idOrName);
    return this.directory.people.find((p) => p.id === idOrName || p.actorIds.includes(idOrName) || normName(p.name) === n);
  }
}

// ------------------------------------------------------------------------------------------------ direct scoring (variant b)

export interface DirectOptions {
  orgId: string;
  familyId: string;
  directory: PeopleDirectory;
  evidenceSourceIds: Record<string, string>;
  /** claim evidence ids -> independent support (the system's own lineage-based count, not the fixture's). */
  independentSupport: (evidenceIds: string[]) => number;
  now?: string;
}

const CASE_TYPES = new Set(['observation', 'hypothesis', 'advice', 'action', 'outcome', 'condition']);
const org = { visibility: 'org' as const };

/**
 * Score-the-proposal-directly conversion. No memory/commit step: claims, entities, links and cases are exactly what the
 * agent proposed (statements verbatim, evidence re-pointed at stored evidence, one case per proposed incident). Attempts
 * and outcomes are not derived (they come from rebuildCase, which is part of commit), so attempt/outcome attribution is
 * undefined for this variant.
 */
export function proposalToKnowledge(p: ExtractionProposal, o: DirectOptions): SystemKnowledge {
  const now = o.now ?? '2026-01-01T00:00:00.000Z';
  const dir = new DirectoryLookup(o.directory);
  const norm = (s: string): string => s.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();

  const entities = new Map<string, Entity>();
  const byName = new Map<string, Entity>();
  const personByDirId = new Map<string, Entity>();
  const put = (pe: ProposedEntity): Entity => {
    const isPerson = pe.type === 'person';
    const dirPerson = isPerson ? dir.find(pe.name) ?? pe.aliases.map((a) => dir.find(a)).find(Boolean) : undefined;
    const id = stableId('ent', o.orgId, o.familyId, isPerson ? 'person' : 'thing', norm(dirPerson?.name ?? pe.name));
    const prev = entities.get(id);
    const attributes = Object.fromEntries(Object.entries(pe.attributes ?? {}).map(([k, v]) => [k, { value: v.value, origin: 'reported' as const, evidence: v.evidence }]));
    const actorIds = isPerson ? [...new Set([...(dirPerson ? [dirPerson.id] : []), ...pe.aliases.filter((a) => a.startsWith('person:'))])] : undefined;
    const ent: Entity = prev
      ? { ...prev, aliases: [...new Set([...prev.aliases, pe.name, ...pe.aliases])].filter((a) => norm(a) !== norm(prev.name)), attributes: { ...attributes, ...prev.attributes }, evidence: [...prev.evidence, ...pe.evidence].slice(0, 8), ...(actorIds ? { actorIds: [...new Set([...(prev.actorIds ?? []), ...actorIds])] } : {}) }
      : { id, orgId: o.orgId, type: pe.type, name: pe.name, aliases: [...new Set(pe.aliases)].filter((a) => norm(a) !== norm(pe.name)), attributes, evidence: pe.evidence.slice(0, 8), ...(actorIds ? { actorIds } : {}), accessScope: org };
    entities.set(id, ent);
    for (const k of [ent.name, ...ent.aliases]) byName.set(norm(k), ent);
    if (dirPerson) personByDirId.set(dirPerson.id, ent);
    return ent;
  };
  for (const pe of p.entities) put(pe);
  const personEntityFor = (directoryId: string): Entity | undefined => {
    const hit = personByDirId.get(directoryId);
    if (hit) return hit;
    const d = dir.find(directoryId);
    if (!d) return undefined;
    // The proposal linked a person it never listed as an entity: stand one up from the visible directory (not invented).
    return put({ type: 'person', name: d.name, aliases: d.actorIds, evidence: [] });
  };

  const actorRef = (id: string | undefined): ActorRef | undefined => {
    if (!id) return undefined;
    const d = dir.find(id);
    return { id, displayName: d?.name ?? id, ...(d ? { role: d.role } : {}) };
  };

  // incidents -> cases
  const incidentOf = new Map<string, ExtractionProposal['incidents'][number]>();
  for (const inc of p.incidents) for (const id of inc.evidenceIds) incidentOf.set(id, inc);
  const cases: Case[] = p.incidents.map((inc) => ({
    id: stableId('case', o.orgId, o.familyId, inc.key), orgId: o.orgId, title: inc.title, status: 'open', entityIds: [], observationClaimIds: [], hypothesisClaimIds: [],
    attemptIds: [], outcomeIds: [], gaps: [], evidenceIds: inc.evidenceIds, startedAt: unknownTime(), conditions: [], accessScope: org, createdAt: now, updatedAt: now,
  }));
  const caseOf = (evId: string | undefined): Case | undefined => { const inc = evId ? incidentOf.get(evId) : undefined; return inc ? cases.find((c) => c.id === stableId('case', o.orgId, o.familyId, inc.key)) : undefined; };

  const independentSupport: Record<string, number> = {};
  const claims: Claim[] = p.claims.map((pc, i) => {
    const id = stableId('claim', o.orgId, o.familyId, i, pc.type);
    const c = CASE_TYPES.has(pc.type) ? caseOf(pc.evidence[0]?.evidenceId) : undefined;
    const subjectEntityIds = [...new Set(pc.subjectEntityNames.map((n) => byName.get(norm(n))?.id).filter((x): x is string => !!x))];
    const assertedBy = actorRef(pc.assertedByActorId);
    independentSupport[id] = o.independentSupport(pc.evidence.map((r) => r.evidenceId));
    if (c) {
      if (pc.type === 'observation') c.observationClaimIds.push(id);
      if (pc.type === 'hypothesis') c.hypothesisClaimIds.push(id);
      c.entityIds = [...new Set([...c.entityIds, ...subjectEntityIds.filter((e) => entities.get(e)?.type !== 'person')])];
    }
    return {
      id, orgId: o.orgId, type: pc.type, statement: pc.statement, subjectEntityIds, ...(c ? { caseId: c.id } : {}), ...(assertedBy ? { assertedBy } : {}), origin: 'reported',
      supporting: pc.evidence, contradicting: [], validity: {}, status: 'provisional', extraction: { route: p.route.route, version: p.route.version }, revision: 1,
      createdAt: now, updatedAt: now, ...(pc.condition ? { condition: pc.condition } : {}), accessScope: org,
    };
  });

  const links: PersonWorkLink[] = p.links.flatMap((l, i) => {
    const person = personEntityFor(l.personActorId);
    if (!person) return [];
    const c = caseOf(l.evidence[0]?.evidenceId);
    return [{ id: stableId('plink', o.orgId, o.familyId, i, l.contribution), orgId: o.orgId, personEntityId: person.id, ...(c ? { caseId: c.id } : {}), contribution: l.contribution, firsthand: l.firsthand, evidence: l.evidence, recency: unknownTime(), status: 'provisional' as const }];
  });

  return { claims, entities: [...entities.values()], links, cases, evidenceSourceIds: o.evidenceSourceIds, independentSupport };
}

// ------------------------------------------------------------------------------------------------ commit adaptation (variant c)

/**
 * The commit step resolves people by the actor ids that appear on stored evidence (provider ids), while the fixture names
 * people by directory id. Translate each directory id to the id of the evidence author with the same directory person
 * (actorIds first, then exact normalized display name). Ids with no matching author stay as they are (commit then
 * drops such a link: counted by the runner).
 */
export function adaptActorsForCommit(p: ExtractionProposal, evidence: EvidenceEnvelope[], directory: PeopleDirectory): { proposal: ExtractionProposal; translated: number } {
  const dir = new DirectoryLookup(directory);
  const authors = new Map<string, string>(); // directory id -> evidence actor id
  for (const e of evidence) for (const a of [e.author, ...(e.recipients ?? [])]) {
    const d = dir.find(a.id) ?? dir.find(a.displayName);
    if (d && !authors.has(d.id)) authors.set(d.id, a.id);
  }
  let translated = 0;
  const tr = (id: string | undefined): string | undefined => { if (!id) return id; const t = authors.get(id); if (t && t !== id) { translated++; return t; } return id; };
  return {
    proposal: {
      ...p,
      claims: p.claims.map((c) => { const a = tr(c.assertedByActorId); return { ...c, ...(a ? { assertedByActorId: a } : {}) }; }),
      links: p.links.map((l) => ({ ...l, personActorId: tr(l.personActorId) ?? l.personActorId })),
    },
    translated,
  };
}
