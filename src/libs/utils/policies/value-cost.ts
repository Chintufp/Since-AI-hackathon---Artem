/**
 * Brief 5.3: questions are ranked by value / cost. Pure functions over the per-action features the coordinator
 * computes (all visible store data; no hidden truth).
 *
 *   value = consequential x p(answer) x expectedGain x retrievalWeight
 *     p(answer)       = (firsthand ? 1 : 0.6) x recency            (the rules gate's answer likelihood)
 *     expectedGain    = expected gain in completeness x correctness of the touched case over both answers (store-health
 *                       expectedGain; an outcome question's Yes branch is weighted by P_CONFIRM, its No branch adds 0)
 *     retrievalWeight = investigations that retrieved the case in the last 30 days, +1 for an investigation gap (its
 *                       case is being retrieved right now)
 *   cost  = 1 + burden / BURDEN.open
 *     burden          = 0.02 x asked today + 0.02 x open questions + 0.05 x inside quiet hours  (the reward's burden term)
 *
 * Scope (D-B2-74): the ranking applies among the candidates of ONE investigation state (the coordinator plans one state
 * at a time), so every pair it compares has the same origin and the +1 never orders an investigation gap against a
 * standing one; it only keeps a case nobody retrieved before from being worth 0. Investigation gaps come before standing
 * gaps by flow, not by this formula: an investigation asks at once, and Engine.askStanding skips a person who already
 * has an open question; standing states are taken in a fixed kind order (outcome, pairing, the rest).
 *
 * LinUCB (D-B2-74): its reward is the measured version of the same quantity (delta of completeness x correctness minus
 * burden, brief 5.4), but it does not start from this order: it has a ridge prior only (A = lambda x I) and its feature
 * vector (features.ts vectorize) leaves out expectedGain, retrievalWeight and quietHours. "The rules selector keeps the
 * same formula as its fixed prior" (brief 5.4) holds only in that sense: the rules selector is the fixed baseline that
 * ranks by the quantity the bandit is rewarded with.
 */
/** Burden weights (brief 5.3): per question delivered today, per other open question, inside quiet hours. */
export const BURDEN = { askedToday: 0.02, open: 0.02, quiet: 0.05 };

type Features = Record<string, number> | undefined;

/** The recipient's burden as the reward subtracts it. */
export function burdenOf(f: Features): number {
  return BURDEN.askedToday * (f?.recipientAskedToday ?? 0) + BURDEN.open * (f?.recipientOpenQuestions ?? 0) + BURDEN.quiet * ((f?.quietHours ?? 0) > 0 ? 1 : 0);
}

/** Cost in units of one open question; 1 for a recipient with nothing asked, nothing open, outside quiet hours. */
export function questionCost(f: Features): number {
  return 1 + burdenOf(f) / BURDEN.open;
}

/** Expected value of asking: consequential x p(answer) x expected gain x retrieval weight. */
export function questionValue(f: Features): number {
  const consequential = f?.consequential ?? 0;
  const pAnswer = ((f?.firsthand ?? 0) > 0 ? 1 : 0.6) * (f?.recency ?? 1);
  return consequential * pAnswer * Math.max(0, f?.expectedGain ?? 0) * Math.max(0, f?.retrievalWeight ?? 0);
}

/** value / cost; undefined when the features carry no expected gain (a caller that does not measure the store). */
export function valuePerCost(f: Features): number | undefined {
  if (f?.expectedGain === undefined) return undefined;
  return questionValue(f) / questionCost(f);
}
