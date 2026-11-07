import type { EvidenceRef, Recommendation } from '../contracts/index.ts';
import type { HypothesisDetail } from './types.ts';
import type { InvestigationSettings } from './settings.ts';

interface Plan {
  rank: number;
  rec: Recommendation;
  detail: HypothesisDetail;
}

const dedupeRefs = (refs: EvidenceRef[]): EvidenceRef[] => {
  const seen = new Set<string>();
  return refs.filter((r) => (seen.has(r.evidenceId) ? false : (seen.add(r.evidenceId), true)));
};

const basisLabel = (d: HypothesisDetail): string => `"${d.title}" (${d.candidate.caseId ?? d.candidate.procedureId})`;

function planFor(d: HypothesisDetail, s: Pick<InvestigationSettings, 'distinguishingKeys' | 'requesterObservableKeys'>): Plan {
  const { support, applicability } = d.hypothesis;
  const basis = dedupeRefs(d.hypothesis.basis);
  const corrective = d.facts?.corrective;
  const diagnostic = d.facts?.diagnostic;
  const dKeys = new Set(s.distinguishingKeys);
  const missing = d.candidate.missingConditions.filter((m) => dKeys.has(m.key));
  const conflicts = d.candidate.conflictingConditions;
  const lasting = d.facts?.primaryOutcomes.find((o) => o.result === 'recovered')?.lasting ?? 'unknown';
  const reporter = d.facts?.primaryOutcomes.find((o) => o.result === 'recovered')?.reportedBy?.displayName;
  const caveats: string[] = ['Not verified that the cause is the same in the current problem; the historical case is a candidate, not a diagnosis.'];

  if (applicability === 'inapplicable' || support === 'contradicted') {
    const why: string[] = [];
    if (applicability === 'inapplicable') why.push(`conflicting condition${conflicts.length > 1 ? 's' : ''}: ${conflicts.filter((c) => dKeys.has(c.key)).map((c) => c.label ?? c.key).join('; ') || conflicts.map((c) => c.label ?? c.key).join('; ')}`);
    if (support === 'contradicted') why.push(d.assessment.reasons.find((r) => /outcome/.test(r)) ?? 'a reported outcome contradicts the response');
    return {
      rank: 2, detail: d,
      rec: {
        kind: 'retain-uncertainty', basis, applicability: 'unsupported', actionClass: 'none', caveats,
        text: `Do not reuse the response from ${basisLabel(d)}: ${why.join('; ')}. The cause of the current problem remains unconfirmed.`,
      },
    };
  }

  if (corrective && support === 'supported' && applicability === 'applicable') {
    const outcomeNote = `recovery was reported${reporter ? ` by ${reporter}` : ''} as a single reported outcome (lasting effect ${lasting})`;
    if (diagnostic) {
      return {
        rank: 5, detail: d,
        rec: {
          kind: 'check-first', basis, applicability: 'supported', actionClass: 'diagnostic-check', caveats,
          nextStep: `Run ${diagnostic.action} on the current asset and confirm the symptoms still match before considering ${corrective.action}.`,
          text: `Check first: run ${diagnostic.action} on the current asset, then consider ${corrective.action}. Basis: ${basisLabel(d)}, where that check preceded ${corrective.action} and ${outcomeNote}. Unconfirmed: that the cause is the same here, and that the effect would last.`,
        },
      };
    }
    return {
      rank: 5, detail: d,
      rec: {
        kind: 'reuse', basis, applicability: 'supported', actionClass: 'corrective-action', caveats,
        text: `Consider ${corrective.action}. Basis: ${basisLabel(d)}, where ${outcomeNote}. Unconfirmed: that the cause is the same here, and that the effect would last.`,
      },
    };
  }

  if (corrective && support === 'supported' && applicability === 'qualified') {
    const labels = missing.map((m) => m.label).join('; ') || 'the conditions of that case';
    const selfCheck = missing.filter((m) => s.requesterObservableKeys.includes(m.key));
    return {
      rank: 4, detail: d,
      rec: {
        kind: 'qualified', basis, applicability: 'qualified', actionClass: 'diagnostic-check', caveats: [...caveats, `Unknown for this problem: ${labels}`],
        nextStep: `Before ${corrective.action}, check ${labels} on the current asset${selfCheck.length ? ' (you can observe this yourself)' : ''}${diagnostic ? ` and run ${diagnostic.action}` : ''}.`,
        text: `Qualified: ${corrective.action} reportedly helped in ${basisLabel(d)}, but it is unconfirmed whether that case applies here because ${labels} is not yet known. Check that first; do not treat ${corrective.action} as established for this problem.`,
      },
    };
  }

  if (diagnostic && support !== 'unknown') {
    const note = corrective ? `${corrective.action} has no reported recovery in that case, so it is not recommended yet. ` : '';
    return {
      rank: 3, detail: d,
      rec: {
        kind: 'check-first', basis, applicability: 'qualified', actionClass: 'diagnostic-check', caveats,
        nextStep: `Run ${diagnostic.action} on the current asset.`,
        text: `Run ${diagnostic.action} first. Basis: ${basisLabel(d)} included that check. ${note}Unconfirmed: whether that case matches the current problem.`,
      },
    };
  }

  return {
    rank: 1, detail: d,
    rec: {
      kind: 'none', basis, applicability: 'unsupported', actionClass: 'none', caveats,
      text: `No supported response: ${basisLabel(d)} has ${support} support and ${applicability} applicability${corrective ? `; ${corrective.action} lacks a reported recovery` : ''}. Nothing is recommended yet.`,
    },
  };
}

export function recommend(details: HypothesisDetail[], s: Pick<InvestigationSettings, 'distinguishingKeys' | 'requesterObservableKeys'>): { recommendation: Recommendation; selected?: HypothesisDetail } {
  if (details.length === 0) {
    return {
      recommendation: {
        kind: 'none', basis: [], applicability: 'unsupported', actionClass: 'none', caveats: [],
        text: 'No similar historical case or procedure visible to you was found; nothing is recommended.',
      },
    };
  }
  const plans = details.map((d) => planFor(d, s)).sort((a, b) => b.rank - a.rank || b.detail.candidate.score - a.detail.candidate.score);
  const best = plans[0] as Plan;
  const ruledOut = plans.filter((p) => p !== best && p.rec.kind === 'retain-uncertainty');
  const rec = { ...best.rec, caveats: [...best.rec.caveats, ...ruledOut.map((p) => `Lookalike ${basisLabel(p.detail)} is not applicable: ${p.rec.text.replace(/^Do not reuse the response from [^:]+: /, '')}`)] };
  return { recommendation: rec, selected: best.detail };
}
