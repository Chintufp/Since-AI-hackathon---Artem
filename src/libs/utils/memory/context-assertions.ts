/**
 * B1: GET /context. The assertions bound to one entity, each with its validity window, where it came from (provider,
 * time, excerpt), who asserted it and its status, evaluated at a moment. Access works like every other read: a claim
 * whose supporting evidence the principal may not see is not listed, and references to claims they may not see
 * (supersededBy, the note behind a validity condition) are left out.
 */
import type {
  Claim, ContextAssertion, ContextAssertionsView, ContextBinding, Entity, KnowledgeStore,
} from '../contracts/index.ts';
import { describeTime } from '../connectors/time.ts';
import { canSee, evidenceGate, visibleCase, type PrincipalLike } from '../retrieval/access.ts';
import { defaultExtractionConfig } from './extraction-config.ts';
import { timePosition, validAt } from './validity.ts';

const norm = (s: string): string => s.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();

/** The visible entity named by id, name or alias (people excluded); undefined when none. */
export function resolveContextEntity(store: KnowledgeStore, name: string, principal: PrincipalLike): Entity | undefined {
  const want = norm(name);
  const visible = store.list('entity').filter((e) => e.type !== 'person' && canSee(e.accessScope, principal));
  return visible.find((e) => e.id === name) ?? visible.find((e) => norm(e.name) === want) ?? visible.find((e) => e.aliases.some((a) => norm(a) === want));
}

const CLASS_KEYS = new Set(['unit.age', 'unit.model', 'unit.revision', 'unit.installed_year', 'software.version']);

export function contextAssertions(store: KnowledgeStore, entity: Entity, principal: PrincipalLike, atMs: number, at?: string): ContextAssertionsView {
  const gate = evidenceGate(store, principal);
  const cases = store.list('case').filter((c) => c.entityIds.includes(entity.id)).map((c) => visibleCase(c, gate)).filter((c): c is NonNullable<typeof c> => !!c);
  const caseIds = new Set(cases.map((c) => c.id));
  const visibleClaim = (c: Claim | undefined): c is Claim => !!c && gate.scope(c.accessScope) && c.supporting.length > 0 && gate.supported(c.supporting);
  const claims = store.list('claim').filter((c) => (c.subjectEntityIds.includes(entity.id) || (!!c.caseId && caseIds.has(c.caseId))) && visibleClaim(c));
  const rows: ContextAssertion[] = [];
  for (const c of claims) {
    const ref = gate.refs(c.supporting)[0]!;
    const ev = store.get('evidence', ref.evidenceId);
    const time = ev?.eventTime ?? { known: false };
    const newer = c.supersededBy ? store.get('claim', c.supersededBy) : undefined;
    const note = c.validity.conditionedBy ? store.get('claim', c.validity.conditionedBy) : undefined;
    const showCondition = c.validity.condition && (!c.validity.conditionedBy || visibleClaim(note));
    rows.push({
      claimId: c.id, type: c.type, statement: c.statement, status: c.status,
      validFrom: timePosition(c.validity.from),
      ...(c.validity.to ? { validTo: timePosition(c.validity.to) } : {}),
      ...(showCondition ? { validityCondition: c.validity.condition } : {}),
      ...(c.supersededBy && visibleClaim(newer) ? { supersededBy: c.supersededBy } : {}),
      validAt: validAt(c, atMs),
      ...(c.validity.orderBasis ? { orderBasis: c.validity.orderBasis } : {}),
      ...(c.assertedBy ? { assertedBy: { id: c.assertedBy.id, displayName: c.assertedBy.displayName } } : {}),
      source: { evidenceId: ref.evidenceId, provider: ev?.provider ?? 'unknown', time: describeTime(time), position: timePosition(time) },
      excerpt: ref.excerpt ?? (ev ? ev.text.slice(0, 200) : c.statement),
      ...(c.caseId ? { caseId: c.caseId } : {}),
    });
  }
  // Undated rows first (valid from before any dated moment), then by known time; ties keep the store's order.
  const key = (r: ContextAssertion): string => (r.validFrom.kind === 'known' ? `1${r.validFrom.iso}` : '0');
  rows.sort((a, b) => key(a).localeCompare(key(b)));

  const bindings: ContextBinding[] = [];
  const people = new Map(store.list('entity').filter((e) => e.type === 'person').map((e) => [e.id, e] as const));
  const claimIds = new Set(claims.map((c) => c.id));
  for (const l of store.list('personLink')) {
    if (!l.firsthand || l.status === 'rejected') continue;
    if (!((l.caseId && caseIds.has(l.caseId)) || (l.claimId && claimIds.has(l.claimId)))) continue;
    const refs = gate.refs(l.evidence);
    if (!refs.length) continue;
    const person = people.get(l.personEntityId);
    if (!person) continue;
    if (bindings.some((b) => b.kind === 'firsthand' && b.entityName === person.name && b.label === l.contribution)) continue;
    bindings.push({ entityName: person.name, kind: 'firsthand', label: l.contribution, byPerson: person.name, recorded: timePosition(l.recency), evidence: refs });
  }
  for (const c of claims) {
    if (c.type !== 'condition' || !c.condition || !CLASS_KEYS.has(c.condition.key)) continue;
    const hedged = c.condition.origin === 'inferred' || defaultExtractionConfig.hedges.test(c.statement);
    if (!hedged) continue;
    const label = c.condition.label ?? `${c.condition.key} ${String(c.condition.value ?? '')}`.trim();
    if (bindings.some((b) => b.kind === 'hedged-class' && b.label === label)) continue;
    bindings.push({
      entityName: entity.name, kind: 'hedged-class', label, ...(c.assertedBy ? { byPerson: c.assertedBy.displayName } : {}),
      recorded: timePosition(c.validity.from), evidence: gate.refs(c.supporting),
    });
  }
  return { entity: { id: entity.id, name: entity.name, type: entity.type }, ...(at ? { at } : {}), assertions: rows, bindings };
}
