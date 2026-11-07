/**
 * B1: orphan pieces seek their partner. Capture-time ("standing") gaps recorded on the case itself, each with the
 * question it would take. Nothing is ever linked or changed here: this pass only records gaps on a per-case standing
 * investigation state, and the coordinator asks them under the same recipients, eligibility, budgets and quiet hours as
 * any investigation question (questions/standing.ts).
 *
 * (a) missing-symptom: a reported-performed corrective attempt and no observation (symptom) claim in the case;
 * (b) outcome: a reported-performed corrective attempt and no outcome, 24 h after the attempt's known time, else after
 *     its evidence was captured (ingestedAt: the capture time is known even when the message time is not);
 * (c) pairing: an orphan fix (a) and an open problem case on the same asset within a window (default 14 days), ranked by
 *     time proximity and then by trigram cosine of their texts; a pair already decided (Pattern confirmed or rejected) is
 *     never proposed again;
 * (d) confirm (film, 8 Nov; off unless confirmAfterEvidence is set): a case with a reported symptom and a stated cause
 *     (hypothesis claim) whose live claims rest on at least `confirmAfterEvidence` distinct evidence records asks the
 *     person who reported the symptom whether it is a real problem worth tracking. Asked once per case.
 */
import type { Attempt, Case, Gap, InvestigationState, KnowledgeStore, Principal } from '../contracts/index.ts';
import { freshId, stableId } from '../contracts/index.ts';
import { makeGapId, parseGapId, standingInvestigationId } from '../investigation/gaps.ts';
import { casePhrase, DEFAULT_PHRASES, shortCaseLabel } from '../investigation/phrases.ts';
import { routeInfo } from '../models/routes.ts';
import { cosine, embedTrigrams } from '../retrieval/vector.ts';
import { instantOf } from './validity.ts';

export interface StandingGapSettings {
  /** Hours after the attempt before a missing outcome becomes a standing gap. */
  outcomeAfterHours: number;
  /** Days between an open problem and an orphan fix on the same asset for a pairing candidate. */
  pairingWindowDays: number;
  /** Actions that are diagnostic checks (never a fix). */
  diagnosticActions: string[];
  /** Action verbs that set something up rather than correct a fault (never a fix): an installation has no symptom. */
  setupVerbs?: string[];
  /**
   * (d) confirm: the certainty threshold, as the number of distinct evidence records behind the case's live claims
   * (symptom, conditions, hypothesis, actions, outcomes). Undefined or 0: no confirm gap is ever recorded.
   */
  confirmAfterEvidence?: number;
  /** (d) only cases with evidence from a connection id starting with one of these (default: live Slack), never history imports. */
  confirmConnections?: string[];
}

export const defaultStandingGapSettings: StandingGapSettings = {
  outcomeAfterHours: 24,
  pairingWindowDays: 14,
  diagnosticActions: ['counters.check', 'optics.check', 'logs.check'],
  setupVerbs: ['install', 'provision', 'commission'],
};

export const STANDING_PRINCIPAL_ID = 'system:standing';
const LIVE = new Set(['provisional', 'supported']);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const isSetup = (action: string, s: StandingGapSettings): boolean =>
  (s.setupVerbs ?? []).some((v) => action === v || action.startsWith(`${v}.`) || action.endsWith(`.${v}`) || action.split(/[.\s_-]/).includes(v));
const isFix = (a: Attempt, s: StandingGapSettings): boolean =>
  a.performed === 'reported' && !!a.performedBy && !s.diagnosticActions.includes(a.action) && !a.action.endsWith('.check') && !isSetup(a.action, s);

/** When a piece was captured: the known event time, else the earliest ingestedAt of its evidence. */
function capturedAt(store: KnowledgeStore, known: number | undefined, evidenceIds: string[]): number | undefined {
  if (known !== undefined) return known;
  const times = evidenceIds.map((id) => store.get('evidence', id)?.ingestedAt).filter((x): x is string => !!x).map((x) => Date.parse(x)).filter(Number.isFinite);
  return times.length ? Math.min(...times) : undefined;
}

interface CaseInfo {
  c: Case;
  fixes: Attempt[];
  hasSymptom: boolean;
  hasOutcome: boolean;
  at?: number;
  /** True when `at` is a known event time, false when it is the capture-time fallback. */
  atKnown: boolean;
  text: string;
  symptom: string;
  /** (d) distinct evidence records behind the live claims; the first observation claim; whether a hypothesis is stated. */
  evidenceCount: number;
  observationClaimId?: string;
  hasHypothesis: boolean;
}

function infoOf(store: KnowledgeStore, c: Case, s: StandingGapSettings): CaseInfo {
  const claims = store.list('claim', { where: { caseId: c.id } }).filter((x) => LIVE.has(x.status));
  const obs = claims.filter((x) => x.type === 'observation');
  const attempts = store.list('attempt', { where: { caseId: c.id } });
  const title = c.title.split('·').slice(1).join('·').trim();
  return {
    c, fixes: attempts.filter((a) => isFix(a, s)), hasSymptom: obs.length > 0, hasOutcome: c.outcomeIds.length > 0,
    ...(() => { const t = capturedAt(store, instantOf(c.startedAt), c.evidenceIds); return t !== undefined ? { at: t } : {}; })(),
    atKnown: instantOf(c.startedAt) !== undefined,
    text: [c.title, ...claims.map((x) => x.statement)].join(' '),
    symptom: (title || obs[0]?.statement || 'reported problem').replace(/[.!?]+$/, ''),
    evidenceCount: new Set(claims.flatMap((x) => x.supporting.map((r) => r.evidenceId))).size,
    ...(obs[0] ? { observationClaimId: obs[0].id } : {}),
    hasHypothesis: claims.some((x) => x.type === 'hypothesis'),
  };
}

/**
 * May the orphan's standing state (readable with the orphan's groups) name the partner? Only when the partner is no more
 * restricted: org-visible, or group-scoped within the orphan's own groups. Private partners never.
 */
function withinScope(partner: Case, orphan: Case): boolean {
  const p = partner.accessScope, o = orphan.accessScope;
  if (p.visibility === 'org') return true;
  if (p.visibility !== 'group' || o.visibility !== 'group') return false;
  return (p.groups ?? []).length > 0 && (p.groups ?? []).every((g) => (o.groups ?? []).includes(g));
}

/** The org-visible or group-scoped principal that may see the case (private cases get no standing gaps). */
function systemPrincipal(c: Case): Principal | undefined {
  if (c.accessScope.visibility === 'private') return undefined;
  return { id: STANDING_PRINCIPAL_ID, displayName: 'Knowledge upkeep', groups: c.accessScope.groups ?? [], type: 'agent' };
}

export interface StandingResult {
  /** Standing states written (new or with changed gaps). */
  updated: string[];
  /** Open standing gaps after the pass, by kind. */
  open: Record<string, number>;
}

/**
 * Record standing gaps for every case of the organization at `now`. Idempotent: a state keeps its gaps' statuses
 * (resolved, cancelled) across passes; a gap that no longer holds while still open becomes 'cancelled'.
 */
export function recordStandingGaps(store: KnowledgeStore, opts: { orgId: string; now: string; settings?: Partial<StandingGapSettings> }): StandingResult {
  const s: StandingGapSettings = { ...defaultStandingGapSettings, ...(opts.settings ?? {}) };
  const nowMs = Date.parse(opts.now);
  const cases = store.list('case', { where: { orgId: opts.orgId } });
  const infos = new Map(cases.map((c) => [c.id, infoOf(store, c, s)] as const));
  const decided = new Set(store.list('pattern').filter((p) => p.status !== 'candidate').map((p) => [...p.caseIds].sort().join('|')));
  const answeredOutcome = new Set(store.list('question').filter((q) => q.status === 'answered').map((q) => q.candidate.dedupKey));
  const vec = new Map<string, Float64Array>();
  const embed = (i: CaseInfo): Float64Array => vec.get(i.c.id) ?? (vec.set(i.c.id, embedTrigrams(i.text)).get(i.c.id) as Float64Array);
  const result: StandingResult = { updated: [], open: {} };

  for (const info of infos.values()) {
    const { c } = info;
    const principal = systemPrincipal(c);
    if (!principal) continue;
    const invId = standingInvestigationId(c.id);
    const label = shortCaseLabel(store, c);
    const evidenceText = c.evidenceIds.map((id) => store.get('evidence', id)?.text ?? '').join('\n').toLowerCase();
    const noun = (a: Attempt): string => casePhrase(a.action, evidenceText, DEFAULT_PHRASES).noun;
    const fresh: Gap[] = [];
    const orphan = info.fixes.length > 0 && !info.hasSymptom;

    // (b) outcome after 24 h (the oldest unanswered fix first)
    if (!info.hasOutcome) {
      for (const a of info.fixes) {
        const start = capturedAt(store, instantOf(a.when), a.evidence.map((r) => r.evidenceId));
        if (start === undefined || nowMs - start < s.outcomeAfterHours * HOUR) continue;
        if (answeredOutcome.has(`outcome:${c.id}:${a.id}`)) continue;
        fresh.push({
          id: makeGapId(invId, 'outcome', c.id, a.id),
          description: `No outcome is recorded ${s.outcomeAfterHours} hours after ${noun(a)} in ${label}.`,
          consequential: true,
          whatAnswerChanges: `A yes records recovery after ${noun(a)} (one person's attributed report); a no records that it did not help. Either way the case stops being a fix with no known result.`,
          status: 'open',
        });
      }
    }
    // (c) pairing: an orphan fix and an open problem on the same asset, nearest in time, then most similar
    if (orphan && info.at !== undefined) {
      const assets = new Set(c.entityIds.filter((id) => store.get('entity', id)?.type !== 'person'));
      const partners = [...infos.values()].filter((p) => p.c.id !== c.id && p.hasSymptom && !p.hasOutcome && p.fixes.length === 0 && p.at !== undefined
        && p.c.entityIds.some((id) => assets.has(id)) && Math.abs((p.at as number) - (info.at as number)) <= s.pairingWindowDays * DAY
        && !decided.has([c.id, p.c.id].sort().join('|')) && withinScope(p.c, c));
      const ranked = partners.map((p) => ({ p, dt: Math.abs((p.at as number) - (info.at as number)), sim: cosine(embed(info), embed(p)) }))
        .sort((x, y) => x.dt - y.dt || y.sim - x.sim || x.p.c.id.localeCompare(y.p.c.id));
      const best = ranked[0];
      if (best) {
        const a = info.fixes[0] as Attempt;
        const hours = Math.round(best.dt / HOUR);
        // Only known event times give a time distance; a capture-time fallback says nothing about when things happened.
        const apart = info.atKnown && best.p.atKnown
          ? `${hours < 48 ? `${hours} hours` : `${Math.round(hours / 24)} days`} apart`
          : `(message times unknown; captured ${hours < 24 ? 'within a day of each other' : `${Math.round(hours / 24)} days apart`})`;
        fresh.push({
          id: makeGapId(invId, 'pairing', c.id, best.p.c.id),
          description: `${label} records ${noun(a)} with no symptom; ${shortCaseLabel(store, best.p.c)} reports ${best.p.symptom} on the same asset ${apart} and records no fix.`,
          consequential: true,
          whatAnswerChanges: 'Yes links the two cases, with the answer as the evidence; no records them as distinct and the pair is never proposed again. Nothing is linked without an answer.',
          status: 'open',
        });
      }
    }
    // (d) confirm: enough evidence behind a stated problem and cause; asked once (an answered one is kept as resolved).
    const confirmAt = s.confirmAfterEvidence ?? 0;
    const live = (s.confirmConnections ?? ['slack-live:']).some((pre) => store.list('claim', { where: { caseId: c.id } })
      .some((x) => x.supporting.some((r) => store.get('evidence', r.evidenceId)?.connectionId.startsWith(pre))));
    if (confirmAt > 0 && live && info.observationClaimId && info.hasHypothesis && info.evidenceCount >= confirmAt) {
      fresh.push({
        id: makeGapId(invId, 'confirm', c.id, info.observationClaimId),
        description: `${label}: ${info.evidenceCount} messages now support a reported problem and a stated cause; nobody has confirmed it is a real problem.`,
        consequential: true,
        whatAnswerChanges: 'Yes records the reporter\'s confirmation on the case (attributed evidence supporting the reported symptom); no records that it is not a problem worth tracking. Nothing else changes.',
        targetClaimId: info.observationClaimId,
        status: 'open',
      });
    }
    // (a) missing symptom (lowest priority, the Later pile)
    if (orphan) {
      const a = info.fixes[0] as Attempt;
      fresh.push({
        id: makeGapId(invId, 'missing-symptom', c.id, a.id),
        description: `No symptom is recorded for ${noun(a)} in ${label}.`,
        consequential: true,
        whatAnswerChanges: 'The case would say what problem the action was for, so the next person with the same symptom can find it.',
        status: 'open',
      });
    }

    const prev = store.get('investigation', invId);
    if (!prev && fresh.length === 0) continue;
    const prevGaps = new Map((prev?.gaps ?? []).map((g) => [g.id, g] as const));
    const freshIds = new Set(fresh.map((g) => g.id));
    const gaps: Gap[] = [
      ...fresh.map((g) => prevGaps.get(g.id) ?? g),
      ...(prev?.gaps ?? []).filter((g) => !freshIds.has(g.id)).map((g) => (g.status === 'open' ? { ...g, status: 'cancelled' as const } : g)),
    ];
    for (const g of gaps) if (g.status === 'open') { const k = parseGapId(g.id)?.kind ?? 'other'; result.open[k] = (result.open[k] ?? 0) + 1; }
    if (prev && JSON.stringify(prev.gaps) === JSON.stringify(gaps)) continue;
    const started = {
      id: freshId('evt'), at: opts.now, traceId: invId, type: 'investigation.started', actor: { id: 'system', displayName: 'standing gaps' },
      data: { principal, standing: true, caseId: c.id },
    };
    const state: InvestigationState = prev
      ? { ...prev, gaps, updatedAt: opts.now }
      : {
        id: invId, orgId: c.orgId, origin: 'standing',
        problem: {
          id: stableId('prob', 'standing', c.id), orgId: c.orgId, text: `Standing gaps on ${c.title}`,
          requester: { id: STANDING_PRINCIPAL_ID, displayName: principal.displayName }, entityIds: c.entityIds.filter((id) => store.get('entity', id)?.type !== 'person'), createdAt: opts.now,
        },
        createdAt: opts.now, updatedAt: opts.now, candidates: [], hypotheses: [], gaps,
        recommendation: { kind: 'none', text: '', basis: [], applicability: 'unsupported', caveats: [], actionClass: 'none' },
        people: [], questionIds: [], decisionIds: [], loop: 'deferred', loopReason: 'Capture-time gaps on this case, asked when the right person is free',
        events: [started], routes: [routeInfo('standing-gaps')],
      };
    store.put('investigation', state);
    result.updated.push(invId);
  }
  return result;
}
