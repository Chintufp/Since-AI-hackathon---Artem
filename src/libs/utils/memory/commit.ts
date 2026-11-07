import type {
  AccessScope, ActorRef, Case, Claim, ConversationContext, Entity, EvidenceEnvelope, EvidenceRef, ExtractionProposal,
  KnowledgeStore, PersonWorkLink, ProposedEntity, TimeRef,
} from '../contracts/index.ts';
import { stableId, unknownTime } from '../contracts/index.ts';
import { covers, leastRestrictiveScope, restrictiveScope } from './access.ts';
import { claimConfirmedByHuman } from './human.ts';
import { isLive, rebuildCase, siblingCases } from './case-builder.ts';
import { applySupersession } from './supersession.ts';

export interface CommitOptions {
  orgId: string;
  /** Baseline scope: floor for each source. A record's stored scope is the least restrictive scope among its supporting sources; restricted sources are filtered per principal at read time. */
  accessScope: AccessScope;
  now?: string;
}

export interface CommitResult {
  caseIds: string[];
  claimIds: string[];
  entityIds: string[];
  personEntityIds: string[];
  linkIds: string[];
}

const norm = (s: string): string => s.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
const CASE_TYPES = new Set(['observation', 'hypothesis', 'advice', 'action', 'outcome', 'condition']);
const refKey = (r: EvidenceRef): string => `${r.evidenceId}:${r.span?.start ?? ''}-${r.span?.end ?? ''}`;
const sameJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** Two supporting items are not independent when one is a copy of, or a likely retelling of, the other. */
export function independentSources(store: KnowledgeStore, refs: EvidenceRef[]): number {
  const ids = [...new Set(refs.map((r) => r.evidenceId))];
  const ev = ids.map((i) => store.get('evidence', i)).filter((e): e is EvidenceEnvelope => !!e);
  const dependent = (e: EvidenceEnvelope) =>
    ev.some((o) => o.id !== e.id && (e.lineage.copiedFrom?.includes(o.id) || (e.metadata?.retellingOf as { evidenceIds?: string[] } | undefined)?.evidenceIds?.includes(o.id)));
  return ev.filter((e) => !dependent(e)).length;
}

function mergeRefs(existing: EvidenceRef[], added: EvidenceRef[]): EvidenceRef[] {
  const m = new Map(existing.map((r) => [refKey(r), r]));
  for (const r of added) if (!m.has(refKey(r))) m.set(refKey(r), r);
  return [...m.values()];
}

export function commitProposal(store: KnowledgeStore, proposal: ExtractionProposal, context: ConversationContext, options: CommitOptions): CommitResult {
  return store.transaction(() => {
    const { orgId } = options;
    const now = options.now ?? new Date().toISOString();
    const evMap = new Map<string, EvidenceEnvelope>(context.evidence.map((e) => [e.id, store.get('evidence', e.id) ?? e]));
    // Each source is at least as restricted as the import baseline; a record supported by several sources is as open as the most open one.
    const scopeOf = (refs: EvidenceRef[]): AccessScope => {
      const per = refs.map((r) => evMap.get(r.evidenceId)?.accessScope).filter((s): s is AccessScope => !!s).map((s) => restrictiveScope([options.accessScope, s]));
      return per.length ? leastRestrictiveScope(per) : options.accessScope;
    };
    const timeOf = (refs: EvidenceRef[]): TimeRef => evMap.get(refs[0]?.evidenceId ?? '')?.eventTime ?? unknownTime();
    const actorOf = (id?: string): ActorRef | undefined => {
      if (!id) return undefined;
      for (const e of evMap.values()) {
        if (e.author.id === id) return e.author;
        const r = e.recipients?.find((x) => x.id === id);
        if (r) return r;
      }
      return undefined;
    };
    const result: CommitResult = { caseIds: [], claimIds: [], entityIds: [], personEntityIds: [], linkIds: [] };

    // ---- entities ---------------------------------------------------------------------------
    const existing = store.list('entity', { where: { orgId } });
    const nameToEntity = new Map<string, Entity>();
    const actorToPerson = new Map<string, string>();
    const upsertEntity = (pe: ProposedEntity, actorIds: string[] = []): Entity => {
      const isPerson = pe.type === 'person';
      const keys = [pe.name, ...pe.aliases].map(norm);
      let ent = existing.find(
        (x) => (x.type === 'person') === isPerson && ([x.name, ...x.aliases].map(norm).some((k) => keys.includes(k)) || actorIds.some((a) => x.actorIds?.includes(a))),
      );
      const attrs = Object.fromEntries(
        Object.entries(pe.attributes ?? {}).map(([k, v]) => [k, { value: v.value, origin: 'reported' as const, evidence: v.evidence }]),
      );
      const scope = scopeOf(pe.evidence);
      if (!ent) {
        ent = {
          id: stableId('ent', orgId, isPerson ? 'person' : 'thing', norm(pe.name)), orgId, type: pe.type, name: pe.name, aliases: [...new Set(pe.aliases)],
          attributes: attrs, evidence: pe.evidence.slice(0, 8), ...(isPerson ? { actorIds: [...new Set(actorIds)] } : {}), accessScope: scope,
        };
        existing.push(ent);
        store.put('entity', ent);
      } else {
        // Details from a source narrower than the entity's own audience are not merged into it (they would leak).
        const open = covers(ent.accessScope, scope);
        const merged: Entity = {
          ...ent,
          type: ent.type === 'site' && pe.type === 'asset' ? 'asset' : ent.type,
          aliases: open ? [...new Set([...ent.aliases, ...pe.aliases.filter((a) => norm(a) !== norm(ent!.name))])] : ent.aliases,
          attributes: open ? { ...ent.attributes, ...Object.fromEntries(Object.entries(attrs).filter(([k]) => !ent!.attributes[k])) } : ent.attributes,
          evidence: mergeRefs(ent.evidence, pe.evidence).slice(0, 8),
          ...(isPerson ? { actorIds: [...new Set([...(ent.actorIds ?? []), ...actorIds])] } : {}),
          // Visible to anyone who may see any of the evidence that mentions it; restricted refs are filtered at read time.
          accessScope: leastRestrictiveScope([ent.accessScope, scope]),
        };
        if (!sameJson(merged, ent)) { Object.assign(ent, merged); store.put('entity', ent); }
      }
      for (const k of [ent.name, ...ent.aliases]) nameToEntity.set(norm(k), ent);
      result.entityIds.push(ent.id);
      if (isPerson) result.personEntityIds.push(ent.id);
      return ent;
    };
    // actor ids of every person-like actor in the context
    const actorsByName = new Map<string, string[]>();
    for (const e of evMap.values()) for (const a of [e.author, ...(e.recipients ?? [])]) {
      const k = norm(a.displayName);
      actorsByName.set(k, [...new Set([...(actorsByName.get(k) ?? []), a.id])]);
    }
    for (const pe of proposal.entities) {
      const ent = upsertEntity(pe, pe.type === 'person' ? (actorsByName.get(norm(pe.name)) ?? [`person:mention:${norm(pe.name)}`]) : []);
      for (const a of ent.actorIds ?? []) actorToPerson.set(a, ent.id);
    }
    const entityIdsFor = (names: string[]): string[] => [...new Set(names.map((n) => nameToEntity.get(norm(n))?.id).filter((x): x is string => !!x))];

    // ---- cases & claims -----------------------------------------------------------------------
    // A case needs a reported symptom (an observation claim) or an asset entity; an aside without either stays case-less
    // (its claims and evidence are still kept, just not attached to a case).
    const hasProblem = (inc: (typeof proposal.incidents)[number]): boolean =>
      inc.key.startsWith('asset:') || proposal.claims.some((c) => c.type === 'observation' && inc.evidenceIds.includes(c.evidence[0]?.evidenceId ?? ''));
    const incidentOf = new Map<string, (typeof proposal.incidents)[number]>();
    for (const inc of proposal.incidents) if (hasProblem(inc)) for (const id of inc.evidenceIds) incidentOf.set(id, inc);
    const touchedCases = new Map<string, { key: string; title: string; evidenceIds: Set<string>; asset?: string }>();
    const claimByLinkKey = new Map<string, string>();
    // A claim read from a verbatim copy of another record is dependent support for the original's claim (same type, same passage),
    // never a new claim with a new asserter/performer. Copies are processed after everything else so originals in this import exist.
    const copySources = (pc: (typeof proposal.claims)[number]): string[] => evMap.get(pc.evidence[0]?.evidenceId ?? '')?.lineage.copiedFrom ?? [];
    const claimsInOrder = [...proposal.claims.filter((c) => !copySources(c).length), ...proposal.claims.filter((c) => copySources(c).length)];
    const passage = (r: EvidenceRef | undefined): string => norm((r?.excerpt ?? '').replace(/\.\.\.$/, ''));
    for (const pc of claimsInOrder) {
      const inc = incidentOf.get(pc.evidence[0]?.evidenceId ?? '');
      const caseBound = CASE_TYPES.has(pc.type) && !!inc;
      const key = caseBound ? inc!.key : '-';
      const caseId = caseBound ? stableId('case', orgId, key) : undefined;
      if (caseBound && !touchedCases.has(key)) {
        touchedCases.set(key, { key, title: inc!.title, evidenceIds: new Set(inc!.evidenceIds), asset: inc!.key.startsWith('asset:') ? pc.subjectEntityNames[0] : undefined });
      }
      const idBasis = (pc.type === 'condition' || pc.type === 'action') && pc.condition ? `${pc.condition.key}|${pc.condition.operator}|${String(pc.condition.value)}${pc.type === 'action' ? '|' + norm(pc.statement) : ''}` : norm(pc.statement);
      let id = stableId('claim', orgId, key, pc.type, idBasis);
      let prev = store.get('claim', id);
      const from = copySources(pc);
      if (from.length) {
        const want = passage(pc.evidence[0]);
        const orig = want.length >= 8 ? store.list('claim', { where: { orgId } }).find((x) => x.type === pc.type && x.supporting.some((r) => from.includes(r.evidenceId) && passage(r) === want)) : undefined;
        if (orig) { id = orig.id; prev = orig; }
      }
      const supporting = prev ? mergeRefs(prev.supporting, pc.evidence) : pc.evidence;
      // Refs to superseded revisions are dropped once a current ref exists.
      const current = supporting.filter((r) => !store.get('evidence', r.evidenceId)?.metadata?.supersededBy);
      const refs = current.length ? current : supporting;
      const author = actorOf(pc.assertedByActorId) ?? evMap.get(pc.evidence[0]?.evidenceId ?? '')?.author;
      const independent = independentSources(store, refs);
      const base: Claim = prev ?? {
        id, orgId, type: pc.type, statement: pc.statement, subjectEntityIds: [], ...(caseId ? { caseId } : {}),
        ...(author ? { assertedBy: author } : {}), origin: 'reported', supporting: [], contradicting: [],
        validity: { from: timeOf(pc.evidence) }, status: 'provisional', extraction: { route: proposal.route.route, version: proposal.route.version },
        revision: 1, createdAt: now, updatedAt: now, ...(pc.condition ? { condition: pc.condition } : {}), accessScope: options.accessScope,
      };
      // B1: explicit validity cues read from the source fill what the claim does not have yet (never overwrite).
      const cueValidity = Object.fromEntries(Object.entries(pc.validity ?? {}).filter(([k, v]) => v !== undefined && (base.validity as Record<string, unknown>)[k] === undefined));
      // A human confirm (recorded Correction) is never recomputed away; only system-derived statuses follow the evidence.
      const status: Claim['status'] =
        (base.status === 'provisional' || base.status === 'supported') && !claimConfirmedByHuman(store, base) ? (independent >= 2 ? 'supported' : 'provisional') : base.status;
      const next: Claim = {
        ...base,
        ...(Object.keys(cueValidity).length ? { validity: { ...base.validity, ...cueValidity } } : {}),
        ...(pc.supersessionBound && !base.supersessionBound ? { supersessionBound: pc.supersessionBound } : {}),
        subjectEntityIds: [...new Set([...base.subjectEntityIds, ...entityIdsFor(pc.subjectEntityNames)])],
        supporting: refs,
        ...(base.condition ? { condition: { ...base.condition, evidence: refs } } : {}),
        status,
        accessScope: scopeOf(refs),
      };
      if (!prev) store.put('claim', next);
      else if (!sameJson({ ...next, revision: prev.revision, updatedAt: prev.updatedAt }, prev)) store.put('claim', { ...next, revision: prev.revision + 1, updatedAt: now });
      result.claimIds.push(id);
      claimByLinkKey.set(`${pc.evidence[0]?.evidenceId}:${pc.evidence[0]?.span?.start}`, id);
      if (pc.condition && caseBound && (pc.condition.key === 'unit.installed_year' || pc.condition.key === 'unit.age' || pc.condition.key === 'software.version' || pc.condition.key === 'unit.model')) {
        const assetId = entityIdsFor([inc!.key.startsWith('asset:') ? pc.subjectEntityNames[0]! : ''])[0];
        const asset = assetId ? store.get('entity', assetId) : undefined;
        if (asset && pc.condition.value !== undefined && !asset.attributes[pc.condition.key]) {
          store.put('entity', { ...asset, attributes: { ...asset.attributes, [pc.condition.key]: { value: pc.condition.value, origin: 'reported', evidence: pc.evidence } } });
        }
      }
    }

    // Claims that depended on a revised message and were not re-proposed from the new revision become 'corrected'.
    const proposedIds = new Set(result.claimIds);
    for (const [key] of touchedCases) {
      const caseId = stableId('case', orgId, key);
      for (const cl of store.list('claim', { where: { caseId } })) {
        if (!isLive(cl) || proposedIds.has(cl.id)) continue;
        const allSuperseded = cl.supporting.some((r) => !!store.get('evidence', r.evidenceId)?.metadata?.supersededBy);
        if (allSuperseded) store.put('claim', { ...cl, status: 'corrected', revision: cl.revision + 1, updatedAt: now });
      }
    }

    // ---- case records -------------------------------------------------------------------------
    for (const t of touchedCases.values()) {
      const caseId = stableId('case', orgId, t.key);
      const prev = store.get('case', caseId);
      const evIds = [...new Set([...(prev?.evidenceIds ?? []).filter((i) => !store.get('evidence', i)?.metadata?.supersededBy), ...t.evidenceIds])];
      const evs = evIds.map((i) => evMap.get(i) ?? store.get('evidence', i)).filter((e): e is EvidenceEnvelope => !!e);
      const caseClaims = store.list('claim', { where: { caseId } });
      const entityIds = [...new Set([...(prev?.entityIds ?? []), ...caseClaims.flatMap((c) => c.subjectEntityIds).filter((id) => store.get('entity', id)?.type !== 'person'), ...(t.asset ? entityIdsFor([t.asset]) : [])])];
      const generic = !prev || /^Incident (on|in) /.test(prev.title);
      const scope = evs.length ? leastRestrictiveScope(evs.map((e) => restrictiveScope([options.accessScope, e.accessScope]))) : options.accessScope;
      const startEv = evs[0];
      const base: Case = prev ?? {
        id: caseId, orgId, title: t.title, status: 'open', entityIds, observationClaimIds: [], hypothesisClaimIds: [], attemptIds: [], outcomeIds: [],
        gaps: [], evidenceIds: evIds, startedAt: startEv?.eventTime ?? unknownTime(), conditions: [], accessScope: scope, createdAt: now, updatedAt: now,
      };
      const next: Case = {
        ...base,
        title: generic && !/^Incident (on|in) /.test(t.title) ? t.title : base.title,
        entityIds, evidenceIds: evIds, accessScope: scope,
      };
      if (!prev || !sameJson(next, prev)) store.put('case', { ...next, updatedAt: prev ? now : base.updatedAt });
      result.caseIds.push(caseId);
    }

    // ---- person-work links --------------------------------------------------------------------
    for (const pl of proposal.links) {
      const personId = actorToPerson.get(pl.personActorId);
      if (!personId) continue;
      const evId = pl.evidence[0]?.evidenceId ?? '';
      const inc = incidentOf.get(evId);
      const caseId = inc ? stableId('case', orgId, inc.key) : undefined;
      const claimId = claimByLinkKey.get(`${evId}:${pl.evidence[0]?.span?.start}`);
      const id = stableId('plink', orgId, personId, caseId ?? '-', pl.contribution, claimId ?? evId);
      const prev = store.get('personLink', id);
      const link: PersonWorkLink = prev ?? {
        id, orgId, personEntityId: personId, ...(caseId && store.get('case', caseId) ? { caseId } : {}), ...(claimId ? { claimId } : {}),
        contribution: pl.contribution, firsthand: pl.firsthand, evidence: pl.evidence, recency: timeOf(pl.evidence), status: 'provisional',
      };
      if (!prev) store.put('personLink', link);
      result.linkIds.push(id);
    }

    // ---- usefulness labels on evidence --------------------------------------------------------
    for (const u of proposal.usefulness) {
      const e = store.get('evidence', u.evidenceId);
      if (!e) continue;
      const usefulness = { label: u.label, reason: u.reason, route: proposal.route };
      if (!sameJson((e.metadata as { usefulness?: unknown } | undefined)?.usefulness, usefulness)) store.put('evidence', { ...e, metadata: { ...(e.metadata ?? {}), usefulness } });
    }

    // B1: newer values close older ones; superseding notes bound older advice (memory/supersession.ts).
    const closed = applySupersession(store, [...new Set(result.claimIds)], { orgId, now });
    for (const caseId of closed) if (!result.caseIds.includes(caseId)) { if (store.get('case', caseId)) rebuildCase(store, caseId, { now }); }
    for (const caseId of result.caseIds) rebuildCase(store, caseId, { now });
    // Episodes of the same asset read each other (a later "down again" report marks the earlier recovery as recurred).
    const touched = new Set(result.caseIds);
    for (const caseId of result.caseIds) {
      const c = store.get('case', caseId);
      if (c) for (const sib of siblingCases(store, c)) if (!touched.has(sib.id)) { touched.add(sib.id); rebuildCase(store, sib.id, { now }); }
    }
    result.claimIds = [...new Set(result.claimIds)];
    result.entityIds = [...new Set(result.entityIds)];
    result.personEntityIds = [...new Set(result.personEntityIds)];
    result.linkIds = [...new Set(result.linkIds)];
    return result;
  });
}

/**
 * Re-derive claim support after older evidence gained copy/retelling lineage (import-order independence):
 * claims citing any of these records get their system-derived status recomputed, then their cases rebuilt.
 */
export function refreshClaimSupport(store: KnowledgeStore, evidenceIds: string[], now?: string): string[] {
  if (!evidenceIds.length) return [];
  const ids = new Set(evidenceIds);
  const cases = new Set<string>();
  store.transaction(() => {
    for (const cl of store.list('claim')) {
      if ((cl.status !== 'provisional' && cl.status !== 'supported') || claimConfirmedByHuman(store, cl)) continue;
      if (!cl.supporting.some((r) => ids.has(r.evidenceId))) continue;
      const status: Claim['status'] = independentSources(store, cl.supporting) >= 2 ? 'supported' : 'provisional';
      if (status !== cl.status) store.put('claim', { ...cl, status, revision: cl.revision + 1, updatedAt: now ?? new Date().toISOString() });
      if (cl.caseId) cases.add(cl.caseId);
    }
    for (const id of cases) rebuildCase(store, id, { now });
  });
  return [...cases];
}
