import type { Attempt, Case, Claim, KnowledgeStore, Observation, Outcome } from '../contracts/index.ts';
import { isDiagnosticAction, type InvestigationSettings } from './settings.ts';

/** Internal key under which an answered/observed outcome is stored as an Observation about a case. */
export const OUTCOME_KEY = 'outcome.result';

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
  /** True when an attributed answer/observation (not the original record) supplied an outcome. */
  overlayOutcome: boolean;
}

function outcomeRank(a: Attempt, outs: Outcome[]): number {
  const mine = outs.filter((o) => !o.attemptId || o.attemptId === a.id);
  if (a.performed === 'reported' && mine.some((o) => o.result === 'recovered')) return 3;
  if (a.performed === 'reported' && mine.length) return 2;
  if (a.performed === 'reported') return 1;
  return 0;
}

/** Loads a case with attempts/outcomes, and applies outcome observations recorded for this investigation. */
export function loadCaseFacts(store: KnowledgeStore, caseId: string, investigationId: string | undefined, settings: Pick<InvestigationSettings, 'diagnosticActions'>): CaseFacts {
  const c = store.get('case', caseId);
  const attempts = store.list('attempt', { where: { caseId } });
  const outcomes = store.list('outcome', { where: { caseId } });
  const allClaims = store.list('claim', { where: { caseId } });
  const overlay: Observation[] = investigationId
    ? store.list('observation', { where: { investigationId } }).filter((o) => o.caseId === caseId && o.condition.key === OUTCOME_KEY)
    : [];

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
  return {
    ...(c ? { case: c } : {}),
    attempts, outcomes,
    hypothesisClaims: allClaims.filter((x) => x.type === 'hypothesis'),
    adviceClaims: allClaims.filter((x) => x.type === 'advice'),
    allClaims,
    ...(corrective ? { corrective } : {}),
    ...(diagnostic ? { diagnostic } : {}),
    primaryOutcomes,
    overlayOutcome: virtual.length > 0,
  };
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
