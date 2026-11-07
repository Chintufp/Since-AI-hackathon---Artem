import type { Condition, EvidenceRef, Recommendation } from '../contracts/index.ts';
import { isSoftCondition } from '../retrieval/conditions.ts';
import { casePhrase, capitalize, clampText, conflictInWords, plainLabel, symptomsPhrase } from './phrases.ts';
import type { HypothesisDetail } from './types.ts';
import type { InvestigationSettings } from './settings.ts';

interface Plan {
  rank: number;
  rec: Recommendation;
  detail: HypothesisDetail;
}

type RecommendSettings = Pick<InvestigationSettings, 'distinguishingKeys' | 'requesterObservableKeys' | 'phrases' | 'hedgeMarkers'>;

const dedupeRefs = (refs: EvidenceRef[]): EvidenceRef[] => {
  const seen = new Set<string>();
  return refs.filter((r) => (seen.has(r.evidenceId) ? false : (seen.add(r.evidenceId), true)));
};

const joinWords = (parts: string[]): string => (parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1] as string}`);

/**
 * Wording is short and human: `text` is a heading (<= phrases.maxTextLength characters); details go to `nextStep` and
 * `caveats`. Gating (reuse / check-first / qualified / retain-uncertainty / none) is decided by support and applicability
 * only; wording never changes it.
 */
function planFor(d: HypothesisDetail, s: RecommendSettings, problem: Condition[]): Plan {
  const { support, applicability } = d.hypothesis;
  const P = s.phrases;
  const basis = dedupeRefs(d.hypothesis.basis);
  // An action the requester's own text reports as already done is never recommended again.
  const alreadyDone = (a: string): boolean => problem.some((c) => (c.key === 'action.performed' && c.value === a) || (c.key === 'component.replaced' && typeof c.value === 'string' && a === `${c.value}.replace`));
  const repeated = d.facts?.corrective && alreadyDone(d.facts.corrective.action) ? d.facts.corrective : undefined;
  const corrective = repeated ? undefined : d.facts?.corrective;
  const diagnostic = d.facts?.diagnostic;
  const dKeys = new Set(s.distinguishingKeys);
  const missing = d.candidate.missingConditions.filter((m) => dKeys.has(m.key));
  const conflicts = d.candidate.conflictingConditions;
  const recovered = d.facts?.primaryOutcomes.filter((o) => o.result === 'recovered') ?? [];
  const lasting = recovered[0]?.lasting ?? 'unknown';
  const label = d.label;
  const text = (t: string): string => clampText(t, P.maxTextLength);
  // Actions are worded by what this case's evidence mentions (an action label the evidence never mentions is worded neutrally).
  const act = (a: string) => casePhrase(a, d.facts?.evidenceText, P);
  const missingWords = missing.map((m) => plainLabel(m.label, s.hedgeMarkers));
  const selfCheck = missing.filter((m) => s.requesterObservableKeys.includes(m.key));
  const sameBasis = d.candidate.matchingConditions.filter((c) => dKeys.has(c.key) && !isSoftCondition(c, s.hedgeMarkers));
  const caseQualifier = sameBasis.length ? ` (${sameBasis.map((c) => plainLabel(c.label ?? c.key, s.hedgeMarkers)).join(', ')})` : '';
  const reportedOnce = `Reported ${recovered.length > 1 ? `${recovered.length} times` : 'once'}; cause${lasting === 'unknown' ? ' and lasting effect' : ''} not verified.`;
  const unknownCaveat = missingWords.length ? [`Unknown for this unit: ${joinWords(missingWords)}.`] : [];
  const symptoms = symptomsPhrase(problem.filter((c) => s.requesterObservableKeys.includes(c.key)), P);
  const replaced = problem.find((c) => c.key === 'component.replaced' && typeof c.value === 'string');
  const replacedGerund = replaced ? P.actions[`${String(replaced.value)}.replace`]?.gerund : undefined;

  const primaryAttempt = d.facts?.corrective ?? d.facts?.diagnostic;
  const badOutcome = d.facts?.primaryOutcomes.find((o) => o.result === 'no-change' || o.result === 'worse' || o.lasting === 'recurred');
  const contradictedCaveat = badOutcome && primaryAttempt
    ? (badOutcome.lasting === 'recurred' ? `The problem came back after ${act(primaryAttempt.action).noun}.` : `${capitalize(act(primaryAttempt.action).noun)} did not help.`)
    : 'A reported outcome contradicts the response.';

  if (applicability === 'inapplicable' || support === 'contradicted') {
    const why: string[] = [];
    if (applicability === 'inapplicable') {
      const used = conflicts.filter((c) => dKeys.has(c.key));
      why.push((used.length ? used : conflicts).map((c) => conflictInWords(c.label ?? c.key, s.hedgeMarkers)).join('; '));
    }
    if (support === 'contradicted') why.push('a reported outcome contradicts it');
    return {
      rank: 2, detail: d,
      rec: {
        kind: 'retain-uncertainty', basis, applicability: 'unsupported', actionClass: 'none',
        text: text(`Don't reuse the fix from ${label}: ${why.join('; ')}.`),
        nextStep: 'Treat the cause as unknown and gather more evidence before acting.',
        caveats: ['The cause of the current problem is unconfirmed.', ...(support === 'contradicted' ? [contradictedCaveat] : [])],
      },
    };
  }

  if (corrective && support === 'supported' && applicability === 'applicable') {
    const c = act(corrective.action);
    const recovery = P.recoveries[corrective.action] ?? 'helped';
    if (diagnostic) {
      const dg = act(diagnostic.action);
      return {
        rank: 5, detail: d,
        rec: {
          kind: 'check-first', basis, applicability: 'supported', actionClass: 'diagnostic-check',
          text: text(`${capitalize(dg.imperative)} ${replacedGerund ? `before ${replacedGerund} again` : 'first'}.`),
          nextStep: `${symptoms ? `If ${symptoms}, ` : 'If the problem persists, '}${c.gerund} reportedly ${recovery} in ${label}${caseQualifier}.`,
          caveats: [reportedOnce, ...unknownCaveat],
        },
      };
    }
    return {
      rank: 5, detail: d,
      rec: {
        kind: 'reuse', basis, applicability: 'supported', actionClass: 'corrective-action',
        text: text(`Consider ${c.gerund}; it reportedly ${recovery} in ${label}.`),
        nextStep: `Confirm the symptoms match ${label}${caseQualifier} before you do it.`,
        caveats: [reportedOnce, ...unknownCaveat],
      },
    };
  }

  if (corrective && support === 'supported' && applicability === 'qualified') {
    const c = act(corrective.action);
    const recovery = P.recoveries[corrective.action] ?? 'helped';
    const labels = missingWords.join('; ') || 'the conditions of that case';
    return {
      rank: 4, detail: d,
      rec: {
        kind: 'qualified', basis, applicability: 'qualified', actionClass: 'diagnostic-check',
        text: text(`Confirm the unit details (${labels}) before ${c.gerund}.`),
        nextStep: `${capitalize(c.gerund)} reportedly ${recovery} in ${label}${caseQualifier}, but it is not known whether that applies here. Check the unit details (${labels})${selfCheck.length ? ' (you can observe this yourself)' : ''}${diagnostic ? ` and ${act(diagnostic.action).imperative}` : ''}.`,
        caveats: [reportedOnce, `Unknown for this unit: ${labels}.`],
      },
    };
  }

  if (diagnostic && support !== 'unknown') {
    const dg = act(diagnostic.action);
    const note = corrective ? ` ${capitalize(act(corrective.action).noun)} has no reported recovery in ${label}.` : '';
    return {
      rank: 3, detail: d,
      rec: {
        kind: 'check-first', basis, applicability: 'qualified', actionClass: 'diagnostic-check',
        text: text(`${capitalize(dg.imperative)} first.${note}`),
        nextStep: `${capitalize(dg.imperative)} on this unit and compare with ${label}.`,
        caveats: [`Whether ${label} matches this problem is unconfirmed.`, ...unknownCaveat],
      },
    };
  }

  if (repeated) {
    const done = act(repeated.action);
    const other = d.facts?.attempts.find((a) => a.id !== repeated.id && a !== diagnostic && a.performed !== 'reported');
    return {
      rank: 1, detail: d,
      rec: {
        kind: 'none', basis, applicability: 'unsupported', actionClass: 'none',
        text: text(`You already did ${done.noun}; ${label} has no other reported fix.`),
        ...(other ? { nextStep: `${capitalize(act(other.action).noun)} was only proposed in ${label}; no recovery from it is reported.` } : {}),
        caveats: [`${capitalize(done.noun)} is what ${label} reports as helping, and your problem says it was already done.`],
      },
    };
  }

  const why = {
    weak: `what was done in ${label} is not confirmed to have worked`,
    unknown: `${label} has no recorded response`,
    supported: `it is not clear that ${label} applies here`,
    contradicted: `a reported outcome in ${label} contradicts it`,
  }[support];
  return {
    rank: 1, detail: d,
    rec: {
      kind: 'none', basis, applicability: 'unsupported', actionClass: 'none',
      text: text(`No supported response yet; ${why}.`),
      caveats: [`${capitalize(why)}${corrective ? `; ${act(corrective.action).noun} has no reported recovery` : ''}${applicability === 'qualified' ? '; whether it applies to this unit is not confirmed' : ''}.`],
    },
  };
}

export function recommend(details: HypothesisDetail[], s: RecommendSettings, problemConditions: Condition[] = []): { recommendation: Recommendation; selected?: HypothesisDetail } {
  if (details.length === 0) {
    return {
      recommendation: {
        kind: 'none', basis: [], applicability: 'unsupported', actionClass: 'none', caveats: [],
        text: 'No sufficiently similar past case visible to you was found.',
      },
    };
  }
  const plans = details.map((d) => planFor(d, s, problemConditions)).sort((a, b) => b.rank - a.rank || b.detail.candidate.score - a.detail.candidate.score);
  const best = plans[0] as Plan;
  const ruledOut = plans.filter((p) => p !== best && p.rec.kind === 'retain-uncertainty');
  const rec = {
    ...best.rec,
    caveats: [...best.rec.caveats, ...ruledOut.map((p) => `${p.detail.label} does not apply: ${p.rec.text.replace(/^Don't reuse the fix from [^:]+: /, '').replace(/\.$/, '')}.`)],
  };
  return { recommendation: rec, selected: best.detail };
}
