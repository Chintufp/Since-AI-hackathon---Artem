import type {
  ActorRef, Attempt, Case, CaseStatus, Claim, Condition, EvidenceEnvelope, EvidenceRef, Gap, KnowledgeStore, Outcome, TimeRef,
} from '../contracts/index.ts';
import { stableId, unknownTime } from '../contracts/index.ts';
import { compareTime } from '../connectors/time.ts';
import { linkSetByHuman } from './human.ts';
import { inferActions, inferOutcome } from './extractor-rules.ts';
import { defaultExtractionConfig } from './extraction-config.ts';
import { recurrenceOf } from './language.ts';
import { caseLabel } from './case-label.ts';

export const isLive = (c: Claim): boolean => c.status === 'provisional' || c.status === 'supported';

/** Order case evidence: threads in ingestion order, inside a thread by time/sequence. */
export function evidenceOrder(store: KnowledgeStore, ids: string[]): Map<string, number> {
  const ev = ids.map((i) => store.get('evidence', i)).filter((e): e is EvidenceEnvelope => !!e);
  const threadFirst = new Map<string, number>();
  ev.forEach((e, i) => { const k = e.thread.threadId ?? e.id; if (!threadFirst.has(k)) threadFirst.set(k, i); });
  ev.sort((a, b) => {
    const ta = threadFirst.get(a.thread.threadId ?? a.id)!;
    const tb = threadFirst.get(b.thread.threadId ?? b.id)!;
    if (ta !== tb) return ta - tb;
    return compareTime(a.eventTime, b.eventTime) || (a.thread.position ?? 0) - (b.thread.position ?? 0);
  });
  return new Map(ev.map((e, i) => [e.id, i]));
}

/**
 * Is the order of two evidence records known? Inside one thread, or when both have a known event time. Across threads without
 * times the global order is only the ingestion order, which says nothing about what happened first.
 */
function comparable(store: KnowledgeStore, a: EvidenceRef[], b: EvidenceRef[]): boolean {
  const ea = store.get('evidence', a[0]?.evidenceId ?? '');
  const eb = store.get('evidence', b[0]?.evidenceId ?? '');
  if (!ea || !eb) return false;
  if ((ea.thread.threadId ?? ea.id) === (eb.thread.threadId ?? eb.id)) return true;
  return ea.eventTime.known && eb.eventTime.known;
}

const refOrder = (order: Map<string, number>, refs: EvidenceRef[]): number => Math.min(...refs.map((r) => order.get(r.evidenceId) ?? Infinity), Infinity);

function performedAction(c: Claim): string | undefined {
  if (c.condition?.key === 'action.performed' && c.condition.value !== undefined) return String(c.condition.value);
  return inferActions(c.statement).find((a) => !a.negated)?.name;
}

const durableRe = new RegExp(defaultExtractionConfig.language.longDuration.source, 'i');
/** A report that things stayed fine for a day or longer (generic duration phrases from the language configuration). */
const durableRecovery = (statement: string): boolean => durableRe.test(statement);

/** Cases that concern the same asset (the case's first entity), including itself. */
export function siblingCases(store: KnowledgeStore, c: Case): Case[] {
  const asset = c.entityIds[0];
  if (!asset) return [c];
  return store.list('case', { where: { orgId: c.orgId } }).filter((x) => x.entityIds[0] === asset);
}

/** The first problem statement of a case says it is a recurrence ("down again", "another problem"). */
function isRecurrenceCase(store: KnowledgeStore, c: Case): boolean {
  const obs = store.list('claim', { where: { caseId: c.id } }).filter((x) => x.type === 'observation' && isLive(x));
  if (!obs.length) return false;
  const order = evidenceOrder(store, c.evidenceIds);
  const first = [...obs].sort((a, b) => refOrder(order, a.supporting) - refOrder(order, b.supporting))[0]!;
  return recurrenceOf(first.statement, defaultExtractionConfig);
}

/**
 * True when a later episode of the same asset reports the problem again and this case is the episode right before it
 * (nearest earlier known start, else the non-recurrence one when times are unknown).
 */
function recurrenceReportedLater(store: KnowledgeStore, c: Case): boolean {
  const sibs = siblingCases(store, c);
  if (sibs.length < 2) return false;
  const start = (x: Case): number | undefined => (x.startedAt.known && x.startedAt.iso && Number.isFinite(Date.parse(x.startedAt.iso)) ? Date.parse(x.startedAt.iso) : undefined);
  for (const later of sibs) {
    if (later.id === c.id || !isRecurrenceCase(store, later)) continue;
    const others = sibs.filter((x) => x.id !== later.id);
    const lt = start(later);
    const before = lt === undefined ? [] : others.filter((x) => (start(x) ?? Infinity) < lt).sort((a, b) => start(b)! - start(a)!);
    const prev = before[0] ?? others.filter((x) => start(x) === undefined && !isRecurrenceCase(store, x)).sort((a, b) => a.id.localeCompare(b.id))[0] ?? (others.length === 1 ? others[0] : undefined);
    if (prev?.id === c.id) return true;
  }
  return false;
}

export interface RebuildOptions { now?: string }

/**
 * Re-derive everything that depends on a case's live claims: attempts, outcomes, conditions, gaps, status and
 * link statuses. Pure function of persisted claims, so commit and corrections share it and re-running is a no-op.
 */
export function rebuildCase(store: KnowledgeStore, caseId: string, options: RebuildOptions = {}): Case | undefined {
  const c = store.get('case', caseId);
  if (!c) return undefined;
  const all = store.list('claim', { where: { caseId } });
  const live = all.filter(isLive);
  const order = evidenceOrder(store, c.evidenceIds);
  const evTime = (refs: EvidenceRef[]): TimeRef => store.get('evidence', refs[0]?.evidenceId ?? '')?.eventTime ?? unknownTime();
  const actor = (cl: Claim): ActorRef | undefined => cl.assertedBy;

  // ---- attempts
  const byAction = new Map<string, { advice?: Claim; performed?: Claim }>();
  for (const cl of live.filter((x) => x.type === 'action').sort((a, b) => refOrder(order, a.supporting) - refOrder(order, b.supporting))) {
    const name = performedAction(cl);
    if (name) { const e = byAction.get(name) ?? byAction.set(name, {}).get(name)!; e.performed ??= cl; }
  }
  for (const cl of live.filter((x) => x.type === 'advice').sort((a, b) => refOrder(order, a.supporting) - refOrder(order, b.supporting))) {
    for (const a of inferActions(cl.statement)) {
      if (a.negated) continue;
      const e = byAction.get(a.name) ?? byAction.set(a.name, {}).get(a.name)!;
      e.advice ??= cl;
    }
  }
  // An advised check counts as performed when a different person later reported readings for it (performed-check link).
  const checkLinks = store.list('personLink', { where: { caseId, contribution: 'performed-check' } }).filter((l) => l.status !== 'rejected');
  const performedOrder = new Map<string, number>();
  const attempts: Attempt[] = [...byAction.entries()].map(([action, v]) => {
    let checked: { by: ActorRef; when: TimeRef; evidence: EvidenceRef[] } | undefined;
    if (!v.performed && v.advice && action.endsWith('.check')) {
      const adviceAt = refOrder(order, v.advice.supporting);
      const l = checkLinks.filter((x) => refOrder(order, x.evidence) > adviceAt).sort((a, b) => refOrder(order, a.evidence) - refOrder(order, b.evidence))[0];
      const by = l ? store.get('evidence', l.evidence[0]?.evidenceId ?? '')?.author : undefined;
      if (l && by && by.id !== v.advice.assertedBy?.id) checked = { by, when: l.recency, evidence: l.evidence.slice(0, 1) };
    }
    if (v.performed) performedOrder.set(stableId('attempt', caseId, action), refOrder(order, v.performed.supporting.slice(0, 1)));
    else if (checked) performedOrder.set(stableId('attempt', caseId, action), refOrder(order, checked.evidence));
    return ({
    id: stableId('attempt', caseId, action),
    orgId: c.orgId,
    caseId,
    action,
    ...(v.advice && actor(v.advice) ? { advisedBy: actor(v.advice)! } : {}),
    ...(v.advice ? { adviceClaimId: v.advice.id } : {}),
    ...(v.performed && actor(v.performed) ? { performedBy: actor(v.performed)! } : checked ? { performedBy: checked.by } : {}),
    performed: v.performed || checked ? ('reported' as const) : ('proposed-only' as const),
    when: v.performed ? evTime(v.performed.supporting) : checked ? checked.when : unknownTime(),
    evidence: [...(v.advice?.supporting ?? []).slice(0, 1), ...(v.performed?.supporting ?? []).slice(0, 1), ...(checked?.evidence ?? [])],
  }); });
  const keepAttempts = new Set(attempts.map((a) => a.id));
  for (const old of store.list('attempt', { where: { caseId } })) if (!keepAttempts.has(old.id)) store.delete('attempt', old.id);
  for (const a of attempts) store.put('attempt', a);

  // ---- outcomes
  const outcomeClaims = live.filter((x) => x.type === 'outcome').sort((a, b) => refOrder(order, a.supporting) - refOrder(order, b.supporting));
  const performedAttempts = attempts.filter((a) => a.performed === 'reported');
  const outcomes: Outcome[] = outcomeClaims.map((cl) => {
    const d = inferOutcome(cl.statement);
    const o = refOrder(order, cl.supporting);
    const prior = performedAttempts
      .filter((a) => (performedOrder.get(a.id) ?? Infinity) <= o)
      .sort((a, b) => (performedOrder.get(a.id) ?? Infinity) - (performedOrder.get(b.id) ?? Infinity))
      .at(-1); // no fallback: an attempt performed after the outcome is never its cause
    return {
      id: stableId('outcome', caseId, cl.id),
      orgId: c.orgId,
      caseId,
      ...(prior ? { attemptId: prior.id } : {}),
      ...(actor(cl) ? { reportedBy: actor(cl)! } : {}),
      result: d?.result ?? 'unknown',
      reportedAt: evTime(cl.supporting),
      lasting: d?.recurred ? ('recurred' as const) : ('unknown' as const),
      evidence: cl.supporting,
      basis: 'reported' as const,
    };
  });
  // Lasting from later separate evidence: a recovery reported as holding for a day or longer ("no flaps for three days after the
  // rollback") confirms the recovery reports before it, but only when that report is a different evidence item from the one that
  // reports the attempt (one person's single message is one self-report) and was not posted before the recovery it confirms.
  // Same-session checks ("still up after ten minutes") do not count.
  const evIds = (refs: EvidenceRef[]): Set<string> => new Set(refs.map((r) => r.evidenceId));
  outcomeClaims.forEach((cl, i) => {
    if (outcomes[i]!.result !== 'recovered' || !durableRecovery(cl.statement)) return;
    const mine = evIds(cl.supporting);
    const attempt = attempts.find((a) => a.id === outcomes[i]!.attemptId);
    if (attempt && [...evIds(attempt.evidence)].some((id) => mine.has(id))) return; // same message as the attempt report: no separate evidence
    outcomes[i]!.lasting = 'confirmed';
    // reports of the same attempt's recovery, wherever they sit in the (partly unordered) evidence
    for (let j = 0; j < outcomes.length; j++) {
      const o = outcomes[j]!;
      if (j === i || o.result !== 'recovered' || o.lasting !== 'unknown') continue;
      if (outcomes[i]!.attemptId && o.attemptId !== outcomes[i]!.attemptId) continue;
      if ([...evIds(o.evidence)].every((id) => mine.has(id))) continue; // the same message
      if (comparable(store, o.evidence, outcomes[i]!.evidence) && refOrder(order, o.evidence) > refOrder(order, outcomes[i]!.evidence)) continue; // posted later than the confirmation
      o.lasting = 'confirmed';
    }
  });
  // A later report that the problem is back, on this case or on a later episode of the same asset, makes recoveries 'recurred'.
  const recurredBySibling = recurrenceReportedLater(store, c);
  if (recurredBySibling) for (const o of outcomes) if (o.result === 'recovered') o.lasting = 'recurred';
  // A later recurrence report makes earlier recoveries 'recurred'.
  // A later 'no change' / 'worse' report after a recovery counts the same way (the fault is back or the recovery failed).
  // Only reports whose order is known count: across undated threads the ingestion order proves nothing.
  outcomes.forEach((o, i) => {
    if (o.result !== 'recovered') return;
    const flagged = outcomes.some((x, j) => j > i && (x.lasting === 'recurred' || x.result === 'no-change' || x.result === 'worse') && (x.lasting === 'recurred' && !comparable(store, o.evidence, x.evidence) ? true : comparable(store, o.evidence, x.evidence)));
    if (flagged) o.lasting = 'recurred';
  });
  const keepOutcomes = new Set(outcomes.map((o) => o.id));
  for (const old of store.list('outcome', { where: { caseId } })) if (!keepOutcomes.has(old.id)) store.delete('outcome', old.id);
  for (const o of outcomes) store.put('outcome', o);

  // ---- status
  let status: CaseStatus;
  const lastRecovered = outcomes.filter((o) => o.result === 'recovered' || o.result === 'partial');
  if (lastRecovered.length) {
    const lr = lastRecovered.at(-1)!;
    status = lr.lasting === 'recurred' ? 'recurred' : lr.lasting === 'confirmed' ? 'verified-resolved' : 'reported-recovered';
  } else if (outcomes.length) status = 'open';
  else status = performedAttempts.length ? 'unknown-outcome' : 'open';

  // ---- conditions
  const conditions: Condition[] = [];
  for (const cl of live.filter((x) => x.type === 'condition' && x.condition)) conditions.push({ ...cl.condition!, evidence: cl.supporting });

  // ---- gaps
  const gaps: Gap[] = [];
  for (const cl of outcomeClaims) {
    const o = outcomes.find((x) => x.id === stableId('outcome', caseId, cl.id))!;
    if (o.result === 'recovered' && o.lasting === 'unknown' && o.basis === 'reported') {
      gaps.push({
        id: stableId('gap', caseId, 'lasting', cl.id), consequential: true, status: 'open', targetClaimId: cl.id,
        description: 'Whether the recovery lasted is unknown: it was reported once with no follow-up observation.',
        whatAnswerChanges: 'A recurrence would show the action only masked the fault and should not be offered as a fix; a stable period would support reuse for similar conditions.',
      });
    }
    if (!o.reportedAt.known) {
      gaps.push({
        id: stableId('gap', caseId, 'timing', cl.id), consequential: false, status: 'open', targetClaimId: cl.id,
        description: 'The date of the outcome is unknown (the source gave only a clock time or nothing).',
        whatAnswerChanges: 'Knowing when it happened shows how long the result has been observed and how recent the experience is.',
      });
    }
  }
  if (live.some((x) => x.type === 'hypothesis') && !outcomes.some((o) => o.basis === 'observed')) {
    gaps.push({
      id: stableId('gap', caseId, 'cause'), consequential: true, status: 'open',
      description: 'The cause is not verified: it is stated as a hypothesis or from experience.',
      whatAnswerChanges: 'A confirmed cause would show whether the fix applies to other conditions or only hides symptoms.',
    });
  }
  for (const a of performedAttempts) {
    if (!outcomes.some((o) => o.attemptId === a.id)) {
      gaps.push({
        id: stableId('gap', caseId, 'outcome', a.id), consequential: true, status: 'open',
        targetClaimId: live.find((x) => x.type === 'action' && performedAction(x) === a.action)?.id,
        description: `The result of "${a.action}" was not reported.`,
        whatAnswerChanges: 'Without a reported result the attempt cannot count as a fix or as a failure.',
      });
    }
  }
  const prevGaps = new Map(c.gaps.map((g) => [g.id, g]));
  const merged: Gap[] = gaps.map((g) => {
    const p = prevGaps.get(g.id);
    return p && p.status !== 'open' ? { ...g, status: p.status, resolvedBy: p.resolvedBy } : g;
  });
  for (const p of c.gaps) if (!merged.some((g) => g.id === p.id)) merged.push({ ...p, status: p.status === 'open' ? 'cancelled' : p.status });

  // ---- links follow their claims
  for (const l of store.list('personLink', { where: { caseId } })) {
    if (!l.claimId) continue;
    const cl = all.find((x) => x.id === l.claimId);
    if (!cl || linkSetByHuman(store, l.id)) continue; // a human-set link status is never moved by the system
    // B1: a superseded claim was still said by that person; their link stays (only retracted/corrected/contradicted reject it).
    const want = isLive(cl) || cl.status === 'superseded' ? (l.status === 'rejected' ? 'provisional' : l.status) : 'rejected';
    if (want !== l.status) store.put('personLink', { ...l, status: want });
  }

  const next: Case = {
    ...c,
    // Short label (asset + few words); the long problem sentence stays in the observation claim.
    title: caseLabel(store, c, live, order),
    status,
    observationClaimIds: live.filter((x) => x.type === 'observation').map((x) => x.id),
    hypothesisClaimIds: live.filter((x) => x.type === 'hypothesis').map((x) => x.id),
    attemptIds: attempts.map((a) => a.id),
    outcomeIds: outcomes.map((o) => o.id),
    conditions,
    gaps: merged,
  };
  if (JSON.stringify(next) !== JSON.stringify(c)) {
    store.put('case', { ...next, updatedAt: options.now ?? new Date().toISOString() });
  }
  return store.get('case', caseId);
}
