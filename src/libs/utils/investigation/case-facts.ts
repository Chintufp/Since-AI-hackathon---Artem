import type { Attempt, Case, Claim, EvidenceRef, KnowledgeStore, Observation, Outcome } from '../contracts/index.ts';
import { evidenceGate, gateAt, visibleCase, type EvidenceGate, type PrincipalLike } from '../retrieval/access.ts';
import { countsAt } from '../retrieval/corpus.ts';
import { validAt } from '../memory/validity.ts';
import { isDiagnosticAction, type InvestigationSettings } from './settings.ts';
import { standingInvestigationId } from './gaps.ts';

/** Internal key under which an answered/observed outcome is stored as an Observation about a case. */
export const OUTCOME_KEY = 'outcome.result';

/**
 * The principal an in-flight investigation state is built for, so an assessor (whose contract only receives the state)
 * can load case facts through the same per-evidence access gate. Set by `investigate()`; weakly held.
 */
export const viewerOfState = new WeakMap<object, PrincipalLike>();

export interface CaseFacts {
  case?: Case;
  attempts: Attempt[];
  outcomes: Outcome[];
  hypothesisClaims: Claim[];
  adviceClaims: Claim[];
  allClaims: Claim[];
  /** The corrective attempt the recommendation would reuse (if any). */
  corrective?: Attempt;
  /** A diagnostic check that preceded/accompanied it (if any). */
  diagnostic?: Attempt;
  /** Outcomes relevant to the primary attempt, including answer overlays. */
  primaryOutcomes: Outcome[];
  /**
   * Lower-cased text of the case's evidence that the viewer may see, or undefined when no evidence text could be read.
   * Used to word actions only by what the evidence actually mentions.
   */
  evidenceText?: string;
  /** True when an attributed answer/observation (not the original record) supplied an outcome. */
  overlayOutcome: boolean;
  /**
   * B1: superseding notes ("fixed in firmware 4.2") that bound this case's hypothesis/advice claims, visible to the viewer
   * and valid at the moment asked about. The recommendation applies them only when the problem is inside the bound.
   */
  bounds: Claim[];
}

function outcomeRank(a: Attempt, outs: Outcome[]): number {
  const mine = outs.filter((o) => !o.attemptId || o.attemptId === a.id);
  if (a.performed === 'reported' && mine.some((o) => o.result === 'recovered')) return 3;
  if (a.performed === 'reported' && mine.length) return 2;
  if (a.performed === 'reported') return 1;
  return 0;
}

/**
 * Loads a case with attempts/outcomes, and applies outcome observations recorded for this investigation.
 * With a `viewer`, only what that principal may see is loaded: a claim, attempt or outcome whose evidence is entirely
 * invisible is dropped (it contributes nothing), the rest keeps only its visible references, and a case with no
 * visible evidence at all is not returned. Without a viewer nothing is filtered (internal/maintenance use only).
 */
export function loadCaseFacts(
  store: KnowledgeStore, caseId: string, investigationId: string | undefined, settings: Pick<InvestigationSettings, 'diagnosticActions'>,
  viewer?: PrincipalLike | EvidenceGate, atMs?: number,
): CaseFacts {
  const gate0 = viewer ? ('ref' in viewer ? viewer : evidenceGate(store, viewer)) : undefined;
  // B1: at a moment, evidence dated later is invisible and only claims valid then count.
  const gate = gate0 && atMs !== undefined ? gateAt(store, gate0, atMs) : gate0;
  const rawCase = store.get('case', caseId);
  const c = !rawCase ? undefined : !gate ? rawCase : visibleCase(rawCase, gate);
  const keep = <T extends { evidence: EvidenceRef[] }>(xs: T[]): T[] =>
    !gate ? xs : xs.filter((x) => gate.supported(x.evidence)).map((x) => ({ ...x, evidence: gate.refs(x.evidence) }));
  const attempts = c || !gate ? keep(store.list('attempt', { where: { caseId } })) : [];
  const outcomes = c || !gate ? keep(store.list('outcome', { where: { caseId } })) : [];
  const caseClaims = store.list('claim', { where: { caseId } }).filter((x) => countsAt(x, atMs));
  const allClaims = !gate ? caseClaims : !c ? [] : caseClaims.filter((x) => gate.scope(x.accessScope) && gate.supported(x.supporting)).map((x) => ({
    ...x, supporting: gate.refs(x.supporting), contradicting: gate.refs(x.contradicting),
    ...(x.condition ? { condition: { ...x.condition, evidence: gate.refs(x.condition.evidence) } } : {}),
  }));
  // B1: an outcome answered to a standing gap is attributed evidence about the case itself, so every investigation sees it.
  const overlayFrom = (inv: string): Observation[] => store.list('observation', { where: { investigationId: inv } })
    .filter((o) => o.caseId === caseId && o.condition.key === OUTCOME_KEY && (atMs === undefined || Date.parse(o.at) <= atMs));
  const overlay: Observation[] = [...(investigationId ? overlayFrom(investigationId) : []), ...overlayFrom(standingInvestigationId(caseId))];

  const nonDiag = attempts.filter((a) => !isDiagnosticAction(a.action, settings));
  const corrective = [...nonDiag].sort((a, b) => outcomeRank(b, outcomes) - outcomeRank(a, outcomes))[0];
  const diagnostic = attempts.find((a) => isDiagnosticAction(a.action, settings));
  const primary = corrective ?? diagnostic;

  const virtual: Outcome[] = primary
    ? overlay.map((o) => ({
        id: `overlay:${o.id}`, orgId: o.orgId, caseId, attemptId: primary.id,
        reportedBy: o.reportedBy,
        result: String(o.condition.value) as Outcome['result'], reportedAt: { known: true, iso: o.at }, lasting: 'unknown' as const,
        evidence: o.condition.evidence, basis: 'reported' as const,
      }))
    : [];
  const primaryOutcomes = primary ? [...outcomes, ...virtual].filter((o) => !o.attemptId || o.attemptId === primary.id) : [];
  const evIds = new Set<string>([
    ...(c?.evidenceIds ?? []), ...attempts.flatMap((a) => a.evidence), ...outcomes.flatMap((o) => o.evidence), ...allClaims.flatMap((x) => x.supporting),
  ].map((x) => (typeof x === 'string' ? x : x.evidenceId)));
  const texts = [...evIds].map((id) => store.get('evidence', id)).filter((e): e is NonNullable<typeof e> => !!e && (!gate || gate.scope(e.accessScope))).map((e) => e.text.toLowerCase());
  return {
    ...(c ? { case: c } : {}),
    ...(texts.length ? { evidenceText: texts.join('\n') } : {}),
    attempts, outcomes,
    hypothesisClaims: allClaims.filter((x) => x.type === 'hypothesis'),
    adviceClaims: allClaims.filter((x) => x.type === 'advice'),
    allClaims,
    ...(corrective ? { corrective } : {}),
    ...(diagnostic ? { diagnostic } : {}),
    primaryOutcomes,
    overlayOutcome: virtual.length > 0,
    bounds: boundsOf(store, allClaims, gate, atMs),
  };
}

/** Superseding notes named by the claims' validity.conditionedBy, visible to the gate and valid at the moment (now: any not superseded). */
function boundsOf(store: KnowledgeStore, claims: Claim[], gate: EvidenceGate | undefined, atMs?: number): Claim[] {
  const ids = [...new Set(claims.filter((x) => x.type === 'hypothesis' || x.type === 'advice').map((x) => x.validity.conditionedBy).filter((x): x is string => !!x))];
  return ids.map((id) => store.get('claim', id)).filter((n): n is Claim =>
    !!n && !!n.supersessionBound && validAt(n, atMs ?? Number.MAX_SAFE_INTEGER) && (!gate || (gate.scope(n.accessScope) && n.supporting.length > 0 && gate.supported(n.supporting))))
    .map((n) => (gate ? { ...n, supporting: gate.refs(n.supporting) } : n));
}

export type Support = 'supported' | 'weak' | 'contradicted' | 'unknown';

/**
 * Support from the historical case only (independent of whether it applies here):
 * contradicted when a no-change/worse/recurred outcome exists; supported when the attempt was reported performed
 * and an outcome reports recovery; weak when only advice/proposal, an unreported or partial outcome exists.
 */
export function supportFor(f: CaseFacts): { level: Support; reasons: string[] } {
  const primary = f.corrective ?? f.diagnostic;
  const hasAdvice = f.adviceClaims.length + f.hypothesisClaims.length > 0 || !!primary;
  if (!primary) return { level: hasAdvice ? 'weak' : 'unknown', reasons: [hasAdvice ? 'hypothesis only; no action recorded' : 'no hypothesis or action recorded'] };
  const outs = f.primaryOutcomes;
  const bad = outs.find((o) => o.result === 'no-change' || o.result === 'worse' || o.lasting === 'recurred');
  if (bad) return { level: 'contradicted', reasons: [`reported outcome after ${primary.action}: ${bad.lasting === 'recurred' ? 'recurred' : bad.result}`] };
  const performed = primary.performed === 'reported' || (f.overlayOutcome && outs.some((o) => o.result === 'recovered'));
  const good = outs.find((o) => o.result === 'recovered');
  if (performed && good) {
    return { level: 'supported', reasons: [`${primary.action} reportedly performed and recovery reported (${good.basis}${good.lasting === 'unknown' ? ', lasting effect unknown' : ''})`] };
  }
  if (primary.performed === 'reported') return { level: 'weak', reasons: [`${primary.action} reportedly performed but no recovery outcome reported`] };
  return { level: 'weak', reasons: [`${primary.action} was only advised/proposed; not reported as performed`] };
}
