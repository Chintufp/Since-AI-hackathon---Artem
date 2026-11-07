import type { Gap, InvestigationState, PersonWorkLink } from '../contracts/index.ts';
import { parseGapId } from '../investigation/index.ts';
import { resolveEntityIds } from '../retrieval/exact.ts';
import type { QuestionContext } from './context.ts';

export interface RecipientReason {
  personEntityId: string;
  firsthand: boolean;
  /** Question-specific reasons this person could know or observe the answer. */
  reasons: string[];
  /** Most recent known link time (ISO), if any. */
  recencyIso?: string;
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
  const links = store.list('personLink').filter((l) => l.status !== 'rejected' && l.firsthand);
  const cases = new Map(store.list('case').map((c) => [c.id, c] as const));
  const acc = new Map<string, RecipientReason>();
  const add = (pid: string, reason: string, recency?: string, firsthand = false): void => {
    if (pid === requester) return;
    const e = acc.get(pid) ?? { personEntityId: pid, firsthand: false, reasons: [] };
    if (!e.reasons.includes(reason)) e.reasons.push(reason);
    e.firsthand = e.firsthand || firsthand;
    if (recency && (!e.recencyIso || recency > e.recencyIso)) e.recencyIso = recency;
    acc.set(pid, e);
  };
  const recencyOf = (l: PersonWorkLink): string | undefined => (l.recency.known ? l.recency.iso : undefined);

  if (parsed.kind === 'outcome') {
    const c = cases.get(parsed.caseId);
    for (const l of links.filter((x) => x.caseId === parsed.caseId && PAST.includes(x.contribution))) {
      add(l.personEntityId, `Firsthand: ${VERB[l.contribution]} in "${c?.title ?? parsed.caseId}"`, recencyOf(l), true);
    }
  } else {
    const entityIds = new Set(problemEntityIds(ctx, state));
    const names = new Map(store.list('entity').map((e) => [e.id, e.name] as const));
    for (const l of links.filter((x) => KNOWS_CONDITION.includes(x.contribution))) {
      const viaCase = l.caseId ? cases.get(l.caseId)?.entityIds.filter((id) => entityIds.has(id)) ?? [] : [];
      const hit = l.entityId && entityIds.has(l.entityId) ? [l.entityId] : viaCase;
      if (hit.length === 0) continue;
      add(l.personEntityId, `Firsthand: ${VERB[l.contribution]} on ${hit.map((id) => names.get(id) ?? id).join(', ')}`, recencyOf(l), true);
    }
    const key = parsed.detail;
    for (const p of directory.all()) {
      const viaGroup = p.groups.find((g) => settings.observability.groups[g]?.includes(key));
      const viaRole = p.role && settings.observability.roles[p.role]?.includes(key) ? p.role : undefined;
      if (viaGroup) add(p.id, `Directory: group "${viaGroup}" is configured to observe ${key}`);
      if (viaRole) add(p.id, `Directory: role "${viaRole}" is configured to observe ${key}`);
    }
  }
  return [...acc.values()].sort((a, b) => Number(b.firsthand) - Number(a.firsthand) || a.personEntityId.localeCompare(b.personEntityId));
}
