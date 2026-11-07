import type { AlternativeHypothesis, Condition, Hypothesis } from '../contracts/index.ts';
import type { PersonDirectory } from './directory.ts';
import { casePhrase, plainLabel } from './phrases.ts';
import type { InvestigationSettings } from './settings.ts';
import type { HypothesisDetail } from './types.ts';

// A qualified branch first: it is the disagreement a fact (and so one answer) can still decide; then the rest.
const ORDER: Record<Hypothesis['applicability'], number> = { qualified: 0, applicable: 1, unknown: 2, inapplicable: 3 };

/**
 * B5 "experts disagree": the related hypotheses the recommendation did not pick, each with the person who advised it
 * firsthand (the adviser of the case's corrective attempt, else of another advised attempt, else the author of its advice
 * claim). An attempt the problem says was already done (the SFP the requester just replaced) is not offered again. A
 * hypothesis without an adviser, or whose support is contradicted, is not listed. Nothing is written: this only
 * describes what is on record.
 */
export function buildAlternatives(
  related: HypothesisDetail[], selected: HypothesisDetail | undefined, directory: PersonDirectory,
  settings: Pick<InvestigationSettings, 'distinguishingKeys' | 'hedgeMarkers' | 'phrases'>, problem: Condition[] = [], max = 3,
): AlternativeHypothesis[] {
  const alreadyDone = (a: string): boolean => problem.some((c) => (c.key === 'action.performed' && c.value === a) || (c.key === 'component.replaced' && typeof c.value === 'string' && a === `${c.value}.replace`));
  const dKeys = new Set(settings.distinguishingKeys);
  const out: AlternativeHypothesis[] = [];
  for (const d of related) {
    if (d === selected || !d.candidate.caseId || d.hypothesis.support === 'contradicted') continue;
    if (selected?.candidate.caseId === d.candidate.caseId) continue;
    const facts = d.facts;
    const open = (facts?.attempts ?? []).filter((a) => !alreadyDone(a.action));
    const corrective = facts?.corrective && !alreadyDone(facts.corrective.action) ? facts.corrective : undefined;
    const attempt = corrective?.advisedBy ? corrective : open.find((a) => a.advisedBy) ?? corrective;
    const adviser = attempt?.advisedBy ?? facts?.adviceClaims.find((c) => c.assertedBy)?.assertedBy;
    if (!adviser) continue;
    const pid = directory.resolve(adviser.id);
    const person = pid ? directory.get(pid) : undefined;
    const action = attempt?.action;
    const label = action ? casePhrase(action, facts?.evidenceText, settings.phrases).gerund : 'a different response';
    const missing = d.candidate.missingConditions.find((m) => dKeys.has(m.key));
    const conflict = d.candidate.conflictingConditions.find((c) => dKeys.has(c.key));
    // A conflict label reads "2021 batch (this problem: ...)": the case's own condition is what decides.
    const deciding = missing ? plainLabel(missing.label, settings.hedgeMarkers) : conflict ? plainLabel((conflict.label ?? conflict.key).replace(/\s*\(this problem:.*\)$/, ''), settings.hedgeMarkers) : undefined;
    const name = person?.name ?? adviser.displayName;
    const { support, applicability } = d.hypothesis;
    const status = `${applicability}${deciding ? `, depends on ${deciding}` : ''}`;
    out.push({
      caseId: d.candidate.caseId, caseLabel: d.label, hypothesisId: d.hypothesis.id, label, ...(action ? { action } : {}),
      expert: { ...(pid ? { personEntityId: pid } : {}), displayName: name, ...(person?.role ? { role: person.role } : {}) },
      support, applicability, ...(deciding ? { deciding } : {}),
      text: `${name} advised ${label} in ${d.label} (${status})`,
    });
  }
  return out.sort((a, b) => ORDER[a.applicability] - ORDER[b.applicability]).slice(0, max);
}
