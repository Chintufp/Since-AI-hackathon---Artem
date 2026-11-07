import type { Gap, InvestigationState, PersonWorkLink } from '../contracts/index.ts';
import { parseGapId, shortCaseLabel, startedBy } from '../investigation/index.ts';
import { evidenceGate, visibleCase } from '../retrieval/access.ts';
import { resolveEntityIds } from '../retrieval/exact.ts';
import type { QuestionContext } from './context.ts';

export interface RecipientReason {
  personEntityId: string;
  firsthand: boolean;
  /** Question-specific reasons this person could know or observe the answer. */
  reasons: string[];
  /** Most recent known link time (ISO), if any. */
  recencyIso?: string;
  /** Why this person is asked, as plain words, e.g. "performed the action in TRN-042" (for the loop status line). */
  because?: string;
}

const PAST: PersonWorkLink['contribution'][] = ['performed-action', 'reported-outcome', 'advised'];
const KNOWS_CONDITION: PersonWorkLink['contribution'][] = ['observed-condition', 'performed-check', 'performed-action', 'reported-problem'];

const VERB: Record<string, string> = {
  'performed-action': 'performed the action', 'reported-outcome': 'reported the outcome', advised: 'advised the response',
  'observed-condition': 'observed conditions', 'performed-check': 'performed a check', 'reported-problem': 'reported a problem',
};

/** Problem entities: those named by the requester plus those mentioned in the text. */
export function problemEntityIds(ctx: QuestionContext, state: InvestigationState): string[] {
  return resolveEntityIds(state.problem.text, ctx.store.list('entity'), state.problem.entityIds ?? []).ids;
}

/**
 * Question-dependent recipients (never a global "expert" list):
 * - past action / outcome questions go to people with FIRSTHAND links on that case (performed, reported, advised);
 * - current/inventory condition questions go to people with firsthand links to the problem's entities, and to people
 *   whose directory role/groups are configured (ObservabilityPolicy) to observe that condition key.
 * The requester is always excluded.
 */
export function findRecipients(ctx: QuestionContext, state: InvestigationState, gap: Gap): RecipientReason[] {
  const parsed = parseGapId(gap.id);
  if (!parsed || parsed.kind === 'lasting') return [];
  const { store, directory, settings } = ctx;
  const requester = directory.resolve(state.problem.requester.id);
  // A person is a recipient only through knowledge the REQUESTER may see: the link's evidence must be visible to them and
  // so must the linked case (otherwise the loop status line would name someone known only through private evidence).
  const starter = startedBy(state);
  const gate = starter ? evidenceGate(store, starter) : undefined;
  const cases = new Map(store.list('case').map((c) => [c.id, c] as const));
  const caseSeen = (id: string | undefined): boolean => {
    if (!id || !gate) return true;
    const c = cases.get(id);
    return !!c && !!visibleCase(c, gate);
  };
  const links = store.list('personLink').filter((l) => l.status !== 'rejected' && l.firsthand && (!gate || gate.supported(l.evidence)) && (!l.caseId || caseSeen(l.caseId)));
  const acc = new Map<string, RecipientReason>();
  const add = (pid: string, reason: string, recency?: string, firsthand = false, because?: string): void => {
    if (pid === requester) return;
    const e = acc.get(pid) ?? { personEntityId: pid, firsthand: false, reasons: [] };
    if (!e.reasons.includes(reason)) e.reasons.push(reason);
    if (because && !e.because) e.because = because;
    e.firsthand = e.firsthand || firsthand;
    if (recency && (!e.recencyIso || recency > e.recencyIso)) e.recencyIso = recency;
    acc.set(pid, e);
  };
  const recencyOf = (l: PersonWorkLink): string | undefined => (l.recency.known ? l.recency.iso : undefined);

  if (parsed.kind === 'confirm') {
    // A confirm gap goes to the person who reported the problem on the case (firsthand 'reported-problem'), nobody else.
    const c = cases.get(parsed.caseId);
    for (const l of links.filter((x) => x.caseId === parsed.caseId && x.contribution === 'reported-problem')) {
      add(l.personEntityId, `Firsthand: ${VERB[l.contribution]} in "${c?.title ?? parsed.caseId}"`, recencyOf(l), true, `${VERB[l.contribution]} in ${c ? shortCaseLabel(store, c) : 'that case'}`);
    }
  } else if (state.origin === 'standing' || parsed.kind === 'missing-symptom' || parsed.kind === 'pairing') {
    // B1 standing gaps go to the person who performed the fix (firsthand 'performed-action' on the case), nobody else.
    const c = cases.get(parsed.caseId);
    const attemptId = parsed.kind === 'pairing' ? undefined : parsed.detail;
    const performers = new Set(store.list('attempt', { where: { caseId: parsed.caseId } })
      .filter((a) => (attemptId ? a.id === attemptId : a.performed === 'reported') && a.performedBy)
      .map((a) => directory.resolve((a.performedBy as NonNullable<typeof a.performedBy>).id)).filter((x): x is string => !!x));
    for (const l of links.filter((x) => x.caseId === parsed.caseId && x.contribution === 'performed-action' && performers.has(x.personEntityId))) {
      add(l.personEntityId, `Firsthand: ${VERB[l.contribution]} in "${c?.title ?? parsed.caseId}"`, recencyOf(l), true, `${VERB[l.contribution]} in ${c ? shortCaseLabel(store, c) : 'that case'}`);
    }
  } else if (parsed.kind === 'outcome') {
    const c = cases.get(parsed.caseId);
    for (const l of links.filter((x) => x.caseId === parsed.caseId && PAST.includes(x.contribution))) {
      add(l.personEntityId, `Firsthand: ${VERB[l.contribution]} in "${c?.title ?? parsed.caseId}"`, recencyOf(l), true, `${VERB[l.contribution]} in ${c ? shortCaseLabel(store, c) : 'that case'}`);
    }
  } else {
    const entityIds = new Set(problemEntityIds(ctx, state));
    const names = new Map(store.list('entity').map((e) => [e.id, e.name] as const));
    for (const l of links.filter((x) => KNOWS_CONDITION.includes(x.contribution))) {
      const viaCase = l.caseId ? cases.get(l.caseId)?.entityIds.filter((id) => entityIds.has(id)) ?? [] : [];
      const hit = l.entityId && entityIds.has(l.entityId) ? [l.entityId] : viaCase;
      if (hit.length === 0) continue;
      const where = hit.map((id) => names.get(id) ?? id).join(', ');
      add(l.personEntityId, `Firsthand: ${VERB[l.contribution]} on ${where}`, recencyOf(l), true, `${VERB[l.contribution]} on ${where}`);
    }
    const key = parsed.detail;
    for (const p of directory.all()) {
      const viaGroup = p.groups.find((g) => settings.observability.groups[g]?.includes(key));
      const viaRole = p.role && settings.observability.roles[p.role]?.includes(key) ? p.role : undefined;
      if (viaGroup) add(p.id, `Directory: group "${viaGroup}" is configured to observe ${key}`, undefined, false, `can observe this through their group (${viaGroup})`);
      if (viaRole) add(p.id, `Directory: role "${viaRole}" is configured to observe ${key}`, undefined, false, `can observe this through their role (${viaRole})`);
    }
  }
  return [...acc.values()].sort((a, b) => Number(b.firsthand) - Number(a.firsthand) || a.personEntityId.localeCompare(b.personEntityId));
}
