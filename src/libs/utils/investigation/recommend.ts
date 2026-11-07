import type { Claim, Condition, EvidenceRef, Recommendation } from '../contracts/index.ts';
import { describeTime } from '../connectors/time.ts';
import { shortDate } from '../memory/validity.ts';
import { isAnswerMarker, isSoftCondition } from '../retrieval/conditions.ts';
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
    // A conflict that rests on an attributed answer says so, so the unchanged-looking applicability value is not the whole story.
    const answered = new Set(problem.filter(isAnswerMarker).map((c) => c.key));
    const byAnswer = applicability === 'inapplicable' && conflicts.some((c) => answered.has(c.key));
    const inapplicableCaveat = applicability === 'inapplicable'
      ? [`${label} does not apply to this unit${byAnswer ? ', going by the answer you received' : ''}: ${(conflicts.filter((c) => dKeys.has(c.key)).length ? conflicts.filter((c) => dKeys.has(c.key)) : conflicts).map((c) => conflictInWords(c.label ?? c.key, s.hedgeMarkers)).join('; ')}.`]
      : [];
    return {
      rank: 2, detail: d,
      rec: {
        kind: 'retain-uncertainty', basis, applicability: 'unsupported', actionClass: 'none',
        text: text(`Don't reuse the fix from ${label}: ${why.join('; ')}.`),
        nextStep: 'Treat the cause as unknown and gather more evidence before acting.',
        caveats: ['The cause of the current problem is unconfirmed.', ...inapplicableCaveat, ...(support === 'contradicted' ? [contradictedCaveat] : [])],
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

/** Compare dotted versions numerically ("4.10" > "4.2"); non-numeric parts compare as text. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.\-]/);
  const pb = b.split(/[.\-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? '0';
    const y = pb[i] ?? '0';
    const nx = Number(x);
    const ny = Number(y);
    const c = Number.isFinite(nx) && Number.isFinite(ny) ? nx - ny : x.localeCompare(y);
    if (c !== 0) return c < 0 ? -1 : 1;
  }
  return 0;
}

/** Does the problem's stated condition fall inside a note's bound (e.g. problem software.version 4.2 vs bound gte 4.2)? */
export function insideBound(problem: Condition[], bound: Condition): boolean {
  const stated = problem.find((c) => c.key === bound.key && c.operator === 'eq' && c.value !== undefined);
  if (!stated || bound.value === undefined) return false;
  const cmp = compareVersions(String(stated.value), String(bound.value));
  switch (bound.operator) {
    case 'gte': return cmp >= 0;
    case 'lte': return cmp <= 0;
    case 'eq': return cmp === 0;
    case 'neq': return cmp !== 0;
    default: return false;
  }
}

/** "fixed in firmware 4.2": the product word from the note's own cue, never a guess beyond it. */
function fixedWords(note: Claim): string {
  const what = /\b(firmware|software|release|version|fw)\b/i.exec(note.validity.cue ?? note.statement)?.[1]?.toLowerCase() ?? 'software';
  return `fixed in ${what === 'fw' ? 'firmware' : what} ${String(note.supersessionBound?.value ?? '')}`.trim();
}

/**
 * B1: a superseding note bounds the basis case's advice ("fixed in firmware 4.2") and the problem states a version inside
 * the bound: say so (date from the note's own time, never invented; the asserter named) and cap the recommendation at
 * 'qualified' (a check the case has) or 'none' (nothing else supports it). A problem that states no version is not
 * affected (D-B1-13).
 */
function applyBounds(plan: Plan, s: RecommendSettings, problem: Condition[]): Plan {
  const note = plan.detail.facts?.bounds.find((n) => n.supersessionBound && insideBound(problem, n.supersessionBound));
  if (!note) return plan;
  const who = note.assertedBy?.displayName ?? 'a colleague';
  const when = shortDate(note.validity.from);
  const words = fixedWords(note);
  const caveat = `Superseded ${when ? `on ${when}` : `(${describeTime(note.validity.from ?? { known: false })})`} by ${who}: ${words}`;
  const rec = plan.rec;
  const caveats = [caveat, ...rec.caveats];
  const basis = dedupeRefs([...note.supporting, ...rec.basis]);
  if (rec.kind === 'retain-uncertainty' || rec.kind === 'none') return { ...plan, rec: { ...rec, caveats, basis } };
  const label = plan.detail.label;
  const P = s.phrases;
  const diagnostic = plan.detail.facts?.diagnostic;
  if (diagnostic) {
    const dg = casePhrase(diagnostic.action, plan.detail.facts?.evidenceText, P);
    return {
      ...plan, rank: Math.min(plan.rank, 4),
      rec: {
        kind: 'qualified', basis, applicability: 'qualified', actionClass: 'diagnostic-check', caveats,
        text: clampText(`${capitalize(dg.imperative)} first; the fix from ${label} was superseded for this version.`, P.maxTextLength),
        nextStep: `${who} wrote that it was ${words}; ask ${who} what applies to this unit before reusing the fix from ${label}.`,
      },
    };
  }
  // B5 (D-B5-05): above a ruled-out case (retain-uncertainty, rank 2) and below every usable plan: a superseded fix names
  // who to ask, which says more than "don't reuse" a less similar case that does not apply (that one stays a caveat).
  return {
    ...plan, rank: 2.5,
    rec: {
      kind: 'none', basis, applicability: 'unsupported', actionClass: 'none', caveats,
      text: clampText(`No supported response yet; the fix from ${label} was superseded for this version.`, P.maxTextLength),
      nextStep: `${who} wrote that it was ${words}; ask ${who} what applies to this unit.`,
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
  const plans = details.map((d) => applyBounds(planFor(d, s, problemConditions), s, problemConditions)).sort((a, b) => b.rank - a.rank || b.detail.candidate.score - a.detail.candidate.score);
  const best = plans[0] as Plan;
  const ruledOut = plans.filter((p) => p !== best && p.rec.kind === 'retain-uncertainty');
  const rec = {
    ...best.rec,
    caveats: [...best.rec.caveats, ...ruledOut.map((p) => `${p.detail.label} does not apply: ${p.rec.text.replace(/^Don't reuse the fix from [^:]+: /, '').replace(/\.$/, '')}.`)],
  };
  return { recommendation: rec, selected: best.detail };
}
