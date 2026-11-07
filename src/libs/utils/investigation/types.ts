import type { Assessment, CandidateMatch, Hypothesis } from '../contracts/index.ts';
import type { CaseFacts } from './case-facts.ts';

/** Internal join of a hypothesis with the facts it was built from; not persisted. */
export interface HypothesisDetail {
  hypothesis: Hypothesis;
  candidate: CandidateMatch;
  assessment: Assessment;
  title: string;
  /** Short human label of the case (asset id, e.g. "TRN-042"); never a raw id. */
  label: string;
  facts?: CaseFacts;
}
