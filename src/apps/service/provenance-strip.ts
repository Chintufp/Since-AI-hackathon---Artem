/**
 * B3: the provenance strip under a result, question or case heading (BUILD_BRIEF 3.4): who said it, where and when,
 * how many independent sources, whether it is still believed true, and which route read it, e.g.
 * "Erkki Expert · Teams 09:22 (date unknown) · reported once · still believed true".
 *
 * Built only through the viewer's evidence gate: the claim must be visible (scope and at least one visible supporting
 * reference), the person, provider and time come from a visible reference, the source count counts visible references
 * only, and a superseding or bounding claim is named only when the viewer may see it. With nothing visible there is no
 * strip.
 */
import type { Claim, EvidenceRef, KnowledgeStore, ProvenanceView } from '../../libs/utils/contracts/index.ts';
import { describeTime } from '../../libs/utils/connectors/time.ts';
import { independentSources } from '../../libs/utils/memory/commit.ts';
import { modelProvenance } from '../../libs/utils/memory/provenance.ts';
import { shortDate, validAt } from '../../libs/utils/memory/validity.ts';
import type { EvidenceGate } from '../../libs/utils/retrieval/index.ts';

const PROVIDER_LABEL: Record<string, string> = {
  teams: 'Teams', email: 'E-mail', slack: 'Slack', paste: 'Paste', desktop: 'Companion', answer: 'Answer', file: 'File', manual: 'Note',
};
export const providerLabel = (p: string): string => PROVIDER_LABEL[p] ?? (p ? p[0]!.toUpperCase() + p.slice(1) : 'Unknown source');

/** "rules" for a rules claim, "local model qwen3:4b, committed by rules" (B2) for a model's. */
export const routeLabel = (extraction: Claim['extraction']): string =>
  modelProvenance(extraction)?.replace(/^proposed by /, '') ?? (extraction.route === 'replay' ? `replayed ${extraction.version}` : 'rules');

/** Claim types that carry what a reader is told to do or believe, best first. */
const RANK: Record<string, number> = { 'access-fact': 0, advice: 1, hypothesis: 2, outcome: 3, action: 4, observation: 5, condition: 6 };

/** The claim a heading rests on: among visible claims supported by the given refs, the best-ranked, latest in the thread. */
export function basisClaim(store: KnowledgeStore, refs: EvidenceRef[], gate: EvidenceGate, opts: { caseId?: string; types?: string[] } = {}): Claim | undefined {
  const ids = new Set(gate.refs(refs).map((r) => r.evidenceId));
  if (!ids.size) return undefined;
  const order = (c: Claim): number => {
    const ev = store.get('evidence', c.supporting.find((r) => ids.has(r.evidenceId))?.evidenceId ?? '');
    return ev?.eventTime.known && ev.eventTime.iso ? Date.parse(ev.eventTime.iso) : (ev?.eventTime.sequence ?? 0);
  };
  const claims = (opts.caseId ? store.list('claim', { where: { caseId: opts.caseId } }) : store.list('claim'))
    .filter((c) => c.supporting.some((r) => ids.has(r.evidenceId)) && visible(c, gate) && (!opts.types || opts.types.includes(c.type)))
    .filter((c) => c.status !== 'retracted' && c.status !== 'corrected');
  return claims.sort((a, b) => (RANK[a.type] ?? 9) - (RANK[b.type] ?? 9) || order(b) - order(a))[0];
}

const visible = (c: Claim | undefined, gate: EvidenceGate): c is Claim => !!c && gate.scope(c.accessScope) && c.supporting.length > 0 && gate.supported(c.supporting);

/** The strip for one claim as the gate's viewer sees it at `atMs` (default: now, where only a superseded claim is closed). */
export function provenanceOf(store: KnowledgeStore, claim: Claim | undefined, gate: EvidenceGate, atMs?: number): ProvenanceView | undefined {
  if (!visible(claim, gate)) return undefined;
  const refs = gate.refs(claim.supporting);
  const ev = store.get('evidence', refs[0]!.evidenceId);
  if (!ev) return undefined;
  const nameOf = (c: Claim): string | undefined => c.assertedBy?.displayName ?? store.get('evidence', gate.refs(c.supporting)[0]?.evidenceId ?? '')?.author.displayName;
  const person = nameOf(claim);
  const when = ev.eventTime.known && ev.eventTime.iso ? (shortDate(ev.eventTime) ?? describeTime(ev.eventTime)) : describeTime(ev.eventTime);
  const sources = independentSources(store, refs);
  const newer = claim.supersededBy ? store.get('claim', claim.supersededBy) : undefined;
  const note = claim.validity.conditionedBy ? store.get('claim', claim.validity.conditionedBy) : undefined;
  const now = atMs ?? Number.MAX_SAFE_INTEGER;
  let status: string;
  let stillBelievedTrue = false;
  let supersededBy: string | undefined;
  let bound: string | undefined;
  const dated = (c: Claim): string => shortDate(c.validity.from) ?? describeTime(c.validity.from ?? { known: false });
  if (claim.status === 'superseded' && visible(newer, gate) && validAt(newer, now)) {
    supersededBy = `superseded ${dated(newer)} by ${nameOf(newer) ?? 'a newer source'}`;
    status = supersededBy;
  } else if (claim.status === 'contradicted') {
    status = 'contradicted';
  } else if (claim.validity.condition && visible(note, gate) && validAt(note, now)) {
    // B1 D-B1-07: a "fixed in firmware X" note bounds the advice; it still holds inside the bound.
    bound = `bounded ${dated(note)} by ${nameOf(note) ?? 'a newer source'}`;
    stillBelievedTrue = true;
    // One phrase on the strip and the page (review): bounded, and where it still holds.
    status = `${bound} · holds for ${claim.validity.condition}`;
  } else if (validAt(claim, now) || claim.status === 'superseded') {
    // A superseded claim whose newer claim the viewer may not see reads as it did before (B1, D-B1-39).
    stillBelievedTrue = true;
    status = 'still believed true';
  } else {
    status = 'no longer valid';
  }
  const route = routeLabel(claim.extraction);
  const parts = [person, `${providerLabel(ev.provider)} ${when}`, sources === 1 ? 'reported once' : `${sources} independent sources`, status, ...(route !== 'rules' ? [route] : [])]
    .filter((x): x is string => !!x);
  return {
    claimId: claim.id,
    ...(person ? { person } : {}),
    providerLabel: providerLabel(ev.provider),
    when,
    sources,
    reportedOnce: sources === 1,
    stillBelievedTrue,
    ...(supersededBy ? { supersededBy } : {}),
    ...(bound && claim.validity.condition ? { bound: { condition: claim.validity.condition, by: bound } } : {}),
    route,
    text: parts.join(' · '),
  };
}

/** The case's advice behind its corrective attempt (a recovered one first), else its latest advice, as a strip. */
export function caseProvenance(store: KnowledgeStore, caseId: string, gate: EvidenceGate, atMs?: number): ProvenanceView | undefined {
  const outcomes = store.list('outcome', { where: { caseId } });
  const attempts = store.list('attempt', { where: { caseId } }).filter((a) => a.adviceClaimId)
    .sort((a, b) => Number(outcomes.some((o) => o.attemptId === b.id && o.result === 'recovered')) - Number(outcomes.some((o) => o.attemptId === a.id && o.result === 'recovered')));
  for (const a of attempts) {
    const p = provenanceOf(store, store.get('claim', a.adviceClaimId!), gate, atMs);
    if (p) return p;
  }
  const c = store.get('case', caseId);
  if (!c) return undefined;
  return provenanceOf(store, basisClaim(store, c.evidenceIds.map((evidenceId) => ({ evidenceId })), gate, { caseId, types: ['advice', 'access-fact', 'hypothesis'] }), gate, atMs);
}
