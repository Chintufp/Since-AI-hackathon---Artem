import type {
  AccessScope, ActorRef, Attempt, Case, Claim, Condition, Entity, EvidenceRef, Outcome, PersonWorkLink, Procedure,
  Principal, TimeRef,
} from '../../contracts/index.ts';
import { InMemoryStore } from './in-memory-store.ts';

export const ORG = 'org:test';
export const NOW_ISO = '2026-11-07T12:00:00.000Z';

export const known = (iso: string): TimeRef => ({ known: true, iso });
export const unknown = (): TimeRef => ({ known: false });
export const ev = (evidenceId: string, excerpt?: string): EvidenceRef => ({ evidenceId, ...(excerpt ? { excerpt } : {}) });

export function cond(
  key: string, value: string | number | boolean, label?: string,
  origin: 'reported' | 'inferred' = 'reported', evidence: EvidenceRef[] = [], operator: Condition['operator'] = 'eq',
): Condition {
  return { key, operator, value, origin, evidence, label: label ?? `${key}=${String(value)}` };
}

export const GROUP_SCOPE = (...groups: string[]): AccessScope => ({ visibility: 'group', groups });
export const ORG_SCOPE: AccessScope = { visibility: 'org' };

export function makeEntity(o: Partial<Entity> & { id: string; name: string }): Entity {
  return { orgId: ORG, type: 'asset', aliases: [], attributes: {}, evidence: [], accessScope: ORG_SCOPE, ...o };
}

export function makePerson(o: { id: string; name: string; role?: string; groups: string[]; actorId: string; available?: boolean }): Entity {
  return makeEntity({
    id: o.id, name: o.name, type: 'person', actorIds: [o.actorId], accessScope: GROUP_SCOPE(...o.groups),
    attributes: {
      ...(o.role ? { role: { value: o.role, origin: 'reported' as const, evidence: [] } } : {}),
      ...(o.available === false ? { available: { value: false, origin: 'reported' as const, evidence: [] } } : {}),
    },
  });
}

export function makeClaim(o: Partial<Claim> & { id: string; type: Claim['type']; statement: string }): Claim {
  return {
    orgId: ORG, subjectEntityIds: [], origin: 'reported', supporting: [], contradicting: [], validity: {},
    status: 'provisional', extraction: { route: 'fixture', version: '1' }, revision: 1,
    createdAt: NOW_ISO, updatedAt: NOW_ISO, accessScope: ORG_SCOPE, ...o,
  };
}

export function makeCase(o: Partial<Case> & { id: string; title: string }): Case {
  return {
    orgId: ORG, status: 'unknown-outcome', entityIds: [], observationClaimIds: [], hypothesisClaimIds: [], attemptIds: [],
    outcomeIds: [], gaps: [], evidenceIds: [], startedAt: unknown(), conditions: [], accessScope: ORG_SCOPE,
    createdAt: NOW_ISO, updatedAt: NOW_ISO, ...o,
  };
}

export function makeAttempt(o: Partial<Attempt> & { id: string; caseId: string; action: string }): Attempt {
  return { orgId: ORG, performed: 'reported', when: unknown(), evidence: [], ...o };
}

export function makeOutcome(o: Partial<Outcome> & { id: string; caseId: string }): Outcome {
  return { orgId: ORG, result: 'recovered', reportedAt: unknown(), lasting: 'unknown', evidence: [], basis: 'reported', ...o };
}

export function makeLink(o: Partial<PersonWorkLink> & { id: string; personEntityId: string; contribution: PersonWorkLink['contribution'] }): PersonWorkLink {
  return { orgId: ORG, firsthand: true, evidence: [], recency: unknown(), status: 'confirmed', ...o };
}

export function makeProcedure(o: Partial<Procedure> & { id: string; purpose: string }): Procedure {
  return {
    orgId: ORG, version: 1, conditions: [], steps: [], verification: [], supportingCaseIds: [], failures: [],
    limitations: [], status: 'candidate', ...o,
  };
}

export const actorOf = (id: string, displayName: string): ActorRef => ({ id, displayName });
export const principalOf = (id: string, displayName: string, groups: string[]): Principal => ({ id, displayName, groups, type: 'human' });

/** Stable ids/people used by the synthetic store (neutral names; nothing from any real incident). */
export const P = {
  exp: { entity: 'ent_person_exp', actor: 'person:directory:exp', name: 'Expert-One' },
  op: { entity: 'ent_person_op', actor: 'person:directory:op', name: 'Operator-Two' },
  men: { entity: 'ent_person_men', actor: 'person:directory:men', name: 'Mention-Three' },
  req: { entity: 'ent_person_req', actor: 'person:directory:req', name: 'Requester-Four' },
  site: { entity: 'ent_person_site', actor: 'person:directory:site', name: 'Site-Five' },
  sec: { entity: 'ent_person_sec', actor: 'person:directory:sec', name: 'Secops-Six' },
} as const;

export const E = { a1: 'ent_asset_a1', b2: 'ent_asset_b2', c3: 'ent_asset_c3', d4: 'ent_asset_d4', e5: 'ent_asset_e5', s1: 'ent_site_s1' } as const;

export const requesterPrincipal = (): Principal => principalOf(P.req.actor, P.req.name, ['noc']);
export const outsiderPrincipal = (): Principal => principalOf('person:directory:outsider', 'Outsider', ['other']);
export const secopsPrincipal = (): Principal => principalOf(P.sec.actor, P.sec.name, ['secops']);
export const requesterActor = (): ActorRef => actorOf(P.req.actor, P.req.name);
export const personPrincipal = (p: { actor: string; name: string }, groups: string[]): Principal => principalOf(p.actor, p.name, groups);

export interface SyntheticOptions {
  /** What happened after the corrective action in the reference case. */
  resetOutcome?: 'recovered' | 'missing' | 'no-change';
  /** Include distractor incidents on other assets. */
  distractors?: boolean;
  /** Include the group-restricted lookalike case. */
  restricted?: boolean;
}

/**
 * Synthetic organization: one reference case (corrective action + preceding diagnostic check, older unit),
 * optional distractors, an earlier minor case on Asset-B2 whose firsthand observer can know B2's unit age,
 * and an optional group-restricted lookalike.
 */
export function buildSyntheticStore(opts: SyntheticOptions = {}): InMemoryStore {
  const { resetOutcome = 'recovered', distractors = true, restricted = true } = opts;
  const s = new InMemoryStore();
  const noc = GROUP_SCOPE('noc', 'field');

  s.put('entity', makePerson({ id: P.exp.entity, name: P.exp.name, role: 'senior engineer', groups: ['noc', 'field'], actorId: P.exp.actor }));
  s.put('entity', makePerson({ id: P.op.entity, name: P.op.name, role: 'field technician', groups: ['noc', 'field'], actorId: P.op.actor }));
  s.put('entity', makePerson({ id: P.men.entity, name: P.men.name, role: 'manager', groups: ['noc'], actorId: P.men.actor }));
  s.put('entity', makePerson({ id: P.req.entity, name: P.req.name, role: 'network engineer', groups: ['noc'], actorId: P.req.actor }));
  s.put('entity', makePerson({ id: P.site.entity, name: P.site.name, role: 'field technician', groups: ['noc', 'field'], actorId: P.site.actor }));
  s.put('entity', makePerson({ id: P.sec.entity, name: P.sec.name, role: 'security analyst', groups: ['secops'], actorId: P.sec.actor }));
  for (const [id, name] of [[E.a1, 'Asset-A1'], [E.b2, 'Asset-B2'], [E.c3, 'Asset-C3'], [E.d4, 'Asset-D4'], [E.e5, 'Asset-E5']] as const) {
    s.put('entity', makeEntity({ id, name, aliases: [name.replace('Asset-', '')].filter((a) => a.length > 2) }));
  }
  s.put('entity', makeEntity({ id: E.s1, name: 'Site-S1', type: 'site' }));

  // --- reference case on Asset-A1 -------------------------------------------------------------
  const c1 = 'case_ref_reset';
  const refCond = [
    cond('interface.status', 'up', 'Interface up', 'reported', [ev('ev:c1:1')]),
    cond('traffic.counters', 'zero', 'Traffic counters zero', 'reported', [ev('ev:c1:1')]),
    cond('optical.level', 'normal', 'RX power normal', 'reported', [ev('ev:c1:1')]),
    cond('alarms.state', 'cleared', 'Alarms cleared', 'reported', [ev('ev:c1:1')]),
    cond('unit.age', 'older', 'Older unit revision (2019)', 'reported', [ev('ev:c1:2')]),
  ];
  s.put('case', makeCase({
    id: c1, title: 'Link up but traffic absent after interface stall', entityIds: [E.a1], accessScope: noc,
    status: resetOutcome === 'recovered' ? 'reported-recovered' : 'unknown-outcome', conditions: refCond,
    hypothesisClaimIds: ['cl_c1_hyp'], observationClaimIds: ['cl_c1_obs'], attemptIds: ['at_c1_check', 'at_c1_reset'],
    outcomeIds: resetOutcome === 'missing' ? [] : ['out_c1'], evidenceIds: ['ev:c1:1', 'ev:c1:2'],
    startedAt: known('2026-03-01T08:00:00.000Z'),
  }));
  s.put('claim', makeClaim({ id: 'cl_c1_obs', type: 'observation', caseId: c1, subjectEntityIds: [E.a1], accessScope: noc,
    statement: 'Interface is up, RX power normal, alarms cleared, but traffic counters stay at zero and no traffic passes', supporting: [ev('ev:c1:1')] }));
  s.put('claim', makeClaim({ id: 'cl_c1_hyp', type: 'hypothesis', caseId: c1, subjectEntityIds: [E.a1], accessScope: noc,
    statement: 'Interface stuck in a degraded forwarding state (suspected, not confirmed)', supporting: [ev('ev:c1:3')] }));
  s.put('claim', makeClaim({ id: 'cl_c1_adv', type: 'advice', caseId: c1, subjectEntityIds: [E.a1], accessScope: noc,
    statement: 'Confirm counters are zero, then reset the interface', supporting: [ev('ev:c1:3')] }));
  s.put('claim', makeClaim({ id: 'cl_c1_age', type: 'condition', caseId: c1, subjectEntityIds: [E.a1], accessScope: noc,
    statement: 'The unit is an older revision from 2019', supporting: [ev('ev:c1:2')], condition: refCond[4] as Condition }));
  s.put('attempt', makeAttempt({ id: 'at_c1_check', caseId: c1, action: 'counters.check', performed: 'reported',
    performedBy: actorOf(P.op.actor, P.op.name), advisedBy: actorOf(P.exp.actor, P.exp.name), evidence: [ev('ev:c1:3')] }));
  s.put('attempt', makeAttempt({ id: 'at_c1_reset', caseId: c1, action: 'interface.reset', performed: 'reported', adviceClaimId: 'cl_c1_adv',
    performedBy: actorOf(P.op.actor, P.op.name), advisedBy: actorOf(P.exp.actor, P.exp.name), evidence: [ev('ev:c1:4')] }));
  if (resetOutcome !== 'missing') {
    s.put('outcome', makeOutcome({ id: 'out_c1', caseId: c1, attemptId: 'at_c1_reset', result: resetOutcome === 'recovered' ? 'recovered' : 'no-change',
      reportedBy: actorOf(P.op.actor, P.op.name), lasting: 'unknown', basis: 'reported', evidence: [ev('ev:c1:5', 'traffic is back')] }));
  }
  s.put('personLink', makeLink({ id: 'lk1', personEntityId: P.exp.entity, caseId: c1, entityId: E.a1, contribution: 'advised', evidence: [ev('ev:c1:3')], recency: known('2026-03-01T09:00:00.000Z') }));
  s.put('personLink', makeLink({ id: 'lk2', personEntityId: P.op.entity, caseId: c1, entityId: E.a1, contribution: 'performed-action', evidence: [ev('ev:c1:4')], recency: known('2026-03-01T10:00:00.000Z') }));
  s.put('personLink', makeLink({ id: 'lk3', personEntityId: P.op.entity, caseId: c1, entityId: E.a1, contribution: 'reported-outcome', evidence: [ev('ev:c1:5')], recency: known('2026-03-01T10:30:00.000Z') }));
  s.put('personLink', makeLink({ id: 'lk4', personEntityId: P.men.entity, caseId: c1, contribution: 'mentioned', firsthand: false, evidence: [ev('ev:c1:6')] }));

  // --- earlier minor case on Asset-B2 (who can know B2's unit revision) ------------------------
  const c6 = 'case_b2_fan';
  s.put('case', makeCase({ id: c6, title: 'Fan speed warning cleared on Asset-B2', entityIds: [E.b2], accessScope: noc, observationClaimIds: ['cl_c6_obs'], startedAt: known('2026-05-01T08:00:00.000Z') }));
  s.put('claim', makeClaim({ id: 'cl_c6_obs', type: 'observation', caseId: c6, subjectEntityIds: [E.b2], accessScope: noc, statement: 'Fan speed warning on Asset-B2 cleared after dust removal' }));
  s.put('personLink', makeLink({ id: 'lk6', personEntityId: P.site.entity, caseId: c6, entityId: E.b2, contribution: 'observed-condition', evidence: [ev('ev:c6:1')], recency: known('2026-05-01T09:00:00.000Z') }));
  s.put('personLink', makeLink({ id: 'lk7', personEntityId: P.req.entity, caseId: c6, entityId: E.b2, contribution: 'reported-problem', evidence: [ev('ev:c6:1')], recency: known('2026-05-01T08:30:00.000Z') }));

  if (distractors) {
    const c2 = 'case_power';
    s.put('case', makeCase({ id: c2, title: 'Intermittent reboots from unstable power feed', entityIds: [E.d4], accessScope: noc,
      conditions: [cond('power.state', 'unstable', 'Power unstable'), cond('temperature.state', 'high', 'Temperature high')],
      hypothesisClaimIds: ['cl_c2_hyp'], attemptIds: ['at_c2'], outcomeIds: ['out_c2'] }));
    s.put('claim', makeClaim({ id: 'cl_c2_hyp', type: 'hypothesis', caseId: c2, subjectEntityIds: [E.d4], accessScope: noc, statement: 'Power supply degraded under high temperature' }));
    s.put('attempt', makeAttempt({ id: 'at_c2', caseId: c2, action: 'power.cycle', performedBy: actorOf(P.op.actor, P.op.name) }));
    s.put('outcome', makeOutcome({ id: 'out_c2', caseId: c2, attemptId: 'at_c2', result: 'recovered' }));
    s.put('personLink', makeLink({ id: 'lk8', personEntityId: P.op.entity, caseId: c2, contribution: 'performed-action' }));
    const c3 = 'case_bgp';
    s.put('case', makeCase({ id: c3, title: 'Routing session flapping after configuration change', entityIds: [E.c3], accessScope: noc,
      conditions: [cond('bgp.session', 'flapping', 'BGP session flapping'), cond('config.changed', true, 'Recent configuration change')],
      hypothesisClaimIds: ['cl_c3_hyp'], attemptIds: ['at_c3'], outcomeIds: ['out_c3'] }));
    s.put('claim', makeClaim({ id: 'cl_c3_hyp', type: 'hypothesis', caseId: c3, subjectEntityIds: [E.c3], accessScope: noc, statement: 'Recent policy change caused the session to flap' }));
    s.put('attempt', makeAttempt({ id: 'at_c3', caseId: c3, action: 'config.rollback', performedBy: actorOf(P.exp.actor, P.exp.name) }));
    s.put('outcome', makeOutcome({ id: 'out_c3', caseId: c3, attemptId: 'at_c3', result: 'recovered' }));
    s.put('personLink', makeLink({ id: 'lk9', personEntityId: P.exp.entity, caseId: c3, contribution: 'performed-action' }));
    const c4 = 'case_access';
    s.put('case', makeCase({ id: c4, title: 'Site-S1 barrier key location', entityIds: [E.s1], accessScope: ORG_SCOPE, observationClaimIds: ['cl_c4'] }));
    s.put('claim', makeClaim({ id: 'cl_c4', type: 'access-fact', caseId: c4, subjectEntityIds: [E.s1], statement: 'Barrier key for Site-S1 is held at the front desk' }));
  }

  if (restricted) {
    const c5 = 'case_restricted';
    s.put('case', makeCase({ id: c5, title: 'Restricted lookalike: link up, counters zero on Asset-A1', entityIds: [E.a1], accessScope: GROUP_SCOPE('secops'),
      conditions: refCond.map((c) => ({ ...c })), hypothesisClaimIds: ['cl_c5_hyp'], attemptIds: ['at_c5'], outcomeIds: ['out_c5'] }));
    s.put('claim', makeClaim({ id: 'cl_c5_hyp', type: 'hypothesis', caseId: c5, subjectEntityIds: [E.a1], accessScope: GROUP_SCOPE('secops'), statement: 'Filtering rule dropped the traffic on the interface' }));
    s.put('attempt', makeAttempt({ id: 'at_c5', caseId: c5, action: 'config.rollback', performedBy: actorOf(P.sec.actor, P.sec.name) }));
    s.put('outcome', makeOutcome({ id: 'out_c5', caseId: c5, attemptId: 'at_c5', result: 'recovered' }));
    s.put('personLink', makeLink({ id: 'lk10', personEntityId: P.sec.entity, caseId: c5, contribution: 'performed-action' }));
  }
  return s;
}

export const CASE_REF = 'case_ref_reset';
export const SYMPTOM_TEXT = 'link is up but counters zero and no traffic, RX normal, alarms cleared';
