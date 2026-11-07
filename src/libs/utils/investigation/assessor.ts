import type { Assessment, Assessor, CandidateMatch, InvestigationState, KnowledgeStore, RouteInfo } from '../contracts/index.ts';
import { loadCaseFacts, supportFor, type Support } from './case-facts.ts';
import type { InvestigationSettings } from './settings.ts';

export type Applicability = 'applicable' | 'qualified' | 'inapplicable' | 'unknown';

/**
 * Applicability from the condition comparison only:
 * inapplicable on any conflict on a distinguishing key; qualified when a distinguishing condition is still unknown
 * (or a non-distinguishing conflict / nothing matched); applicable when no conflicts and every distinguishing
 * condition matches.
 */
export function applicabilityFor(c: CandidateMatch, distinguishingKeys: string[]): { level: Applicability; reasons: string[] } {
  const d = new Set(distinguishingKeys);
  const conflictD = c.conflictingConditions.filter((x) => d.has(x.key));
  const missingD = c.missingConditions.filter((x) => d.has(x.key));
  if (conflictD.length) return { level: 'inapplicable', reasons: [`conflict on distinguishing condition: ${conflictD.map((x) => x.label ?? x.key).join('; ')}`] };
  if (missingD.length) return { level: 'qualified', reasons: [`distinguishing condition not yet known: ${missingD.map((x) => x.label).join('; ')}`] };
  if (c.conflictingConditions.length) return { level: 'qualified', reasons: [`non-distinguishing conflict: ${c.conflictingConditions.map((x) => x.label ?? x.key).join('; ')}`] };
  if (c.matchingConditions.length === 0) return { level: 'qualified', reasons: ['no condition of the case could be matched to this problem'] };
  return { level: 'applicable', reasons: [`no conflicts; matches: ${c.matchingConditions.map((x) => x.label ?? x.key).join('; ')}`] };
}

export interface RulesAssessorOptions {
  store: KnowledgeStore;
  settings: Pick<InvestigationSettings, 'distinguishingKeys' | 'diagnosticActions'>;
  /** 'separate' reports support and applicability independently; 'combined' collapses them into one verdict (E04 contrast). */
  mode?: 'combined' | 'separate';
}

export class RulesAssessor implements Assessor {
  readonly route: RouteInfo;
  readonly mode: 'combined' | 'separate';
  private opts: RulesAssessorOptions;
  constructor(opts: RulesAssessorOptions) {
    this.opts = opts;
    this.mode = opts.mode ?? 'separate';
    this.route = { route: 'rules', version: `rules-assessor@1(${this.mode})` };
  }

  async assess(candidate: CandidateMatch, state: InvestigationState): Promise<Assessment> {
    const app = applicabilityFor(candidate, this.opts.settings.distinguishingKeys);
    let sup: { level: Support; reasons: string[] };
    if (candidate.caseId) {
      sup = supportFor(loadCaseFacts(this.opts.store, candidate.caseId, state.id, this.opts.settings));
    } else {
      sup = { level: 'weak', reasons: ['candidate procedure; no reported outcome of its own'] };
    }
    if (this.mode === 'separate') return { support: sup.level, applicability: app.level, reasons: [...sup.reasons, ...app.reasons], route: this.route };
    // combined: one verdict, so a weakness in either dimension is attributed to both
    const bad = sup.level === 'contradicted' || app.level === 'inapplicable';
    const strong = sup.level === 'supported' && app.level === 'applicable';
    const support: Support = bad ? 'contradicted' : strong ? 'supported' : 'weak';
    const applicability: Applicability = bad ? 'inapplicable' : strong ? 'applicable' : 'qualified';
    return { support, applicability, reasons: ['combined verdict (support and applicability not separable)', ...sup.reasons, ...app.reasons], route: this.route };
  }
}
