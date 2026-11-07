import type { Attempt, CaseView, Claim, EvidenceRef, KnowledgeStore, Outcome, Principal, TimelineNode } from '../contracts/index.ts';
import { describeTime } from '../connectors/time.ts';
import { canSee } from './access.ts';
import { evidenceOrder, isLive } from './case-builder.ts';
import { cmpPos, earliest, positionOf, type Position } from './case-label.ts';
import { independentSources } from './commit.ts';
import { defaultExtractionConfig } from './extraction-config.ts';
import { modelProvenance } from './provenance.ts';
import { conditionText, defaultViewConfig, humanAction, pastAction, type ViewConfig } from './view-config.ts';

type P = Pick<Principal, 'id' | 'groups'>;

const clip = (s: string, n = 220): string => (s.length > n ? s.slice(0, n - 3) + '...' : s);
const unpunct = (s: string): string => s.replace(/\s+/g, ' ').trim();
const cap = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
const words = (s: string): Set<string> => new Set((s.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []));

function similar(a: string, b: string): boolean {
  const x = words(a);
  const y = words(b);
  if (!x.size || !y.size) return false;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both) >= 0.6;
}

/**
 * Renderer-safe, compact case timeline:
 * Problem (red) -> Reported conditions -> Possible cause -> Suggested checks -> one node per performed attempt ->
 * Reported outcome (green) or Outcome unknown. A change performed before the problem is a condition, not an attempt.
 */
export function buildCaseView(store: KnowledgeStore, caseId: string, principal: P, config: ViewConfig = defaultViewConfig): CaseView | undefined {
  const c = store.get('case', caseId);
  if (!c || !canSee(c.accessScope, principal)) return undefined;
  const order = evidenceOrder(store, c.evidenceIds);
  const evVisible = (id: string) => {
    const e = store.get('evidence', id);
    return !!e && canSee(e.accessScope, principal);
  };
  const visRefs = (refs: EvidenceRef[]): EvidenceRef[] => refs.filter((r) => evVisible(r.evidenceId));
  const claims = store.list('claim', { where: { caseId } });
  const live = claims.filter((x) => isLive(x) && canSee(x.accessScope, principal) && visRefs(x.supporting).length > 0);
  const byPos = (a: Claim, b: Claim) => cmpPos(earliest(order, a.supporting), earliest(order, b.supporting));
  const nameOf = (a?: { displayName: string }) => a?.displayName;
  const whenOf = (refs: EvidenceRef[]) => {
    const e = store.get('evidence', refs[0]?.evidenceId ?? '');
    return e ? describeTime(e.eventTime) : undefined;
  };
  const retoldBy = (evidenceId: string): Set<string> => {
    const e = store.get('evidence', evidenceId);
    const r = (e?.metadata?.retellingOf as { evidenceIds?: string[] } | undefined)?.evidenceIds ?? [];
    return new Set([...r, ...(e?.lineage.copiedFrom ?? [])]);
  };
  /** Drops claims that repeat an earlier one: same words, or restated by a retelling of evidence that already yielded this type. */
  const dedupe = (list: Claim[]): Claim[] => {
    const kept: Claim[] = [];
    for (const h of [...list].sort(byPos)) {
      const hIds = [...new Set(h.supporting.map((r) => r.evidenceId))];
      const retold = new Set(hIds.flatMap((i) => [...retoldBy(i)]));
      const allRetellings = hIds.length > 0 && hIds.every((i) => retoldBy(i).size > 0);
      const dup = kept.some(
        (k) => similar(k.statement, h.statement) || (allRetellings && k.supporting.some((r) => retold.has(r.evidenceId))),
      );
      if (!dup) kept.push(h);
    }
    return kept;
  };
  /** " (proposed by local model qwen3:4b, committed by rules)" after a statement a model proposed. */
  const tag = (x: Claim): string => {
    const p = modelProvenance(x.extraction);
    return p ? ` (${p})` : '';
  };
  const provenanceOf = (list: Claim[]): { provenance?: string[] } => {
    const p = [...new Set(list.map((x) => modelProvenance(x.extraction)).filter((v): v is string => !!v))];
    return p.length ? { provenance: p } : {};
  };
  const withAuthor = (x: Claim): string => `${nameOf(x.assertedBy) ?? 'Someone'}: ${clip(unpunct(x.statement), 200)}${tag(x)}`;

  const timeline: TimelineNode[] = [];
  const obs = live.filter((x) => x.type === 'observation').sort(byPos);
  const problemAt: Position = obs[0] ? earliest(order, obs[0].supporting) : [Infinity, Infinity];

  // ---- problem (red)
  if (obs.length) {
    const first = obs[0]!;
    const who = nameOf(first.assertedBy);
    const when = whenOf(first.supporting);
    timeline.push({
      id: first.id, kind: 'problem', stage: 'observation', label: 'Reported problem',
      detail: (() => {
        const lines = [...new Set(obs.map((o) => clip(unpunct(o.statement)) + tag(o)))];
        return [...lines.slice(0, 4), ...(lines.length > 4 ? [`(${lines.length - 4} more reported observation${lines.length - 4 > 1 ? 's' : ''})`] : [])].join('\n');
      })() + (who || when ? `\nReported${who ? ` by ${who}` : ''}${when ? `, ${when}` : ''}.` : ''),
      evidence: visRefs(first.supporting), who, when, ...provenanceOf(obs),
    });
  } else {
    timeline.push({ id: `${c.id}:problem`, kind: 'unknown', stage: 'unknown', label: 'Problem statement', detail: `No explicit problem statement was extracted. Case: ${c.title}`, evidence: [] });
  }

  // ---- attempts, split into the preceding change (a condition) and performed attempts (nodes)
  const attempts = store.list('attempt', { where: { caseId } }).filter((a) => visRefs(a.evidence).length > 0);
  const performedAt = (a: Attempt): Position => positionOf(order, a.evidence.at(-1));
  const performed = attempts.filter((a) => a.performed === 'reported').sort((a, b) => cmpPos(performedAt(a), performedAt(b)));
  const preceding = obs.length ? performed.filter((a) => !a.advisedBy && cmpPos(performedAt(a), problemAt) < 0) : [];
  const nodeAttempts = performed.filter((a) => !preceding.includes(a));

  // ---- conditions (yellow, one node)
  const condClaims = live.filter((x) => x.type === 'condition' && x.condition && !config.hiddenConditionKeys.includes(x.condition.key)).sort(byPos);
  const hedgedClaim = (x: Claim) => x.condition!.origin === 'inferred' || defaultExtractionConfig.hedges.test(x.statement);
  const labels = new Map<string, boolean>(); // label -> hedged
  const used = new Set<Claim>();
  for (const m of config.conditionMerges) {
    const base = condClaims.find((x) => x.condition!.key === m.base);
    const extra = condClaims.find((x) => x.condition!.key === m.extra);
    if (base && extra) {
      labels.set(m.format(conditionText(base.condition!), extra.condition!), hedgedClaim(base) || hedgedClaim(extra));
      used.add(base); used.add(extra);
    }
  }
  for (const x of condClaims) {
    if (used.has(x)) continue;
    const before = x.condition!.key === 'component.replaced' && cmpPos(earliest(order, x.supporting), problemAt) < 0;
    const label = before ? `${conditionText(x.condition!)} before the problem` : conditionText(x.condition!);
    labels.set(label, (labels.get(label) ?? false) || hedgedClaim(x));
  }
  for (const a of preceding) {
    const label = `${pastAction(a.action, config)} before the problem`;
    if (!labels.has(label)) labels.set(label, false);
  }
  if (labels.size) {
    const hedged = [...labels].filter(([, h]) => h).map(([l]) => l);
    const inferred = condClaims.filter((x) => x.condition!.origin === 'inferred' && !defaultExtractionConfig.hedges.test(x.statement)).map((x) => conditionText(x.condition!));
    timeline.push({
      id: `${c.id}:conditions`, kind: 'step', stage: 'observation', label: 'Reported conditions',
      detail: [
        [...labels.keys()].join('; '),
        hedged.length ? `Reported as likely rather than certain: ${hedged.join('; ')}.` : '',
        inferred.length ? `Inferred: ${[...new Set(inferred)].join('; ')}.` : '',
        ...(provenanceOf(condClaims).provenance ?? []).map((p) => `Some of these were ${p}.`),
      ].filter(Boolean).join('\n'),
      evidence: visRefs([...condClaims.flatMap((x) => x.supporting), ...preceding.flatMap((a) => a.evidence)]).slice(0, 8),
      ...provenanceOf(condClaims),
    });
  }

  // ---- possible cause (yellow, one node merging every hypothesis)
  const causes = dedupe(live.filter((x) => x.type === 'hypothesis' && !/:\s*$/.test(x.statement.trim())));
  if (causes.length) {
    const authors = [...new Set(causes.map((x) => nameOf(x.assertedBy)))];
    timeline.push({
      id: `${c.id}:causes`, kind: 'step', stage: 'hypothesis', label: 'Possible cause',
      detail: ['Stated as hypotheses, not confirmed:', ...causes.map(withAuthor)].join('\n'),
      evidence: visRefs(causes.flatMap((x) => x.supporting)).slice(0, 8),
      ...(authors.length === 1 && authors[0] ? { who: authors[0] } : {}), when: whenOf(causes[0]!.supporting), ...provenanceOf(causes),
    });
  }

  // ---- suggested checks (yellow, one node merging advice and advice against)
  const advice = dedupe(live.filter((x) => x.type === 'advice' && !/:\s*$/.test(x.statement.trim())));
  if (advice.length) {
    const authors = [...new Set(advice.map((x) => nameOf(x.assertedBy)))];
    timeline.push({
      id: `${c.id}:checks`, kind: 'step', stage: 'check', label: 'Suggested checks',
      detail: ['Advice, not confirmed to work:', ...advice.map(withAuthor)].join('\n'),
      evidence: visRefs(advice.flatMap((x) => x.supporting)).slice(0, 8),
      ...(authors.length === 1 && authors[0] ? { who: authors[0] } : {}), when: whenOf(advice[0]!.supporting), ...provenanceOf(advice),
    });
  }

  // ---- performed attempts, in order
  for (const a of nodeAttempts) timeline.push(attemptNode(a, config, whenOf, visRefs));

  // ---- outcome (green only when one exists)
  const outcomes = dedupeOutcomes(store.list('outcome', { where: { caseId } }).filter((o) => visRefs(o.evidence).length > 0).sort((a, b) => cmpPos(earliest(order, a.evidence), earliest(order, b.evidence))), retoldBy);
  for (const o of outcomes) timeline.push(outcomeNode(o, attempts, config, visRefs, whenOf));
  if (!outcomes.length) {
    timeline.push({
      id: `${c.id}:outcome-unknown`, kind: 'unknown', stage: 'unknown', label: 'Outcome unknown',
      detail: nodeAttempts.length ? 'An action was reported as done, but no result was reported.' : 'No result has been reported yet.', evidence: [],
    });
  }

  // ---- caveat (one sentence)
  const supportRefs = visRefs(live.flatMap((x) => x.supporting));
  const indep = independentSources(store, supportRefs);
  const total = new Set(supportRefs.map((r) => r.evidenceId)).size;
  const retracted = claims.filter((x) => x.status === 'retracted' || x.status === 'corrected' || x.status === 'contradicted').length;
  const lead = outcomes.some((o) => o.result === 'recovered' && o.lasting === 'confirmed')
    ? 'Recovery is reported, and a later report says it lasted (neither independently observed)'
    : outcomes.some((o) => o.result === 'recovered')
    ? 'Recovery is reported, not verified (timing, cause and lasting unconfirmed)'
    : outcomes.length ? 'The reported result is unverified' : 'No outcome has been reported';
  const caveat = `${lead}; ${indep} independent of ${total} source record(s)${retracted ? `; ${retracted} claim(s) retracted or corrected and not shown` : ''}.`;

  // ---- sources
  const sources: CaseView['sources'] = [];
  for (const id of [...order.keys()]) {
    const e = store.get('evidence', id);
    if (!e || e.metadata?.supersededBy || !canSee(e.accessScope, principal)) continue;
    sources.push({
      evidenceId: e.id, provider: e.provider, author: e.author.displayName, when: describeTime(e.eventTime),
      excerpt: clip(((e.metadata?.freshText as string | undefined) ?? e.text).replace(/\s+/g, ' ').trim(), 240), ...(e.reference ? { reference: e.reference } : {}),
    });
  }

  const entities = c.entityIds
    .map((id) => store.get('entity', id))
    .filter((e): e is NonNullable<typeof e> => !!e && canSee(e.accessScope, principal))
    .map((e) => ({ id: e.id, name: e.name, type: e.type }));
  return { caseId: c.id, title: c.title, status: c.status, entities, timeline, caveat, sources };
}

function attemptNode(a: Attempt, cfg: ViewConfig, whenOf: (r: EvidenceRef[]) => string | undefined, vis: (r: EvidenceRef[]) => EvidenceRef[]): TimelineNode {
  const when = whenOf(a.evidence.slice(-1));
  const detail = [
    a.advisedBy ? `Advised by ${a.advisedBy.displayName}.` : 'No advice recorded for this step.',
    `Performed${a.performedBy ? ` by ${a.performedBy.displayName}` : ''} as reported, not independently observed${when ? `, ${when}` : ''}.`,
  ].join(' ');
  return {
    id: a.id, kind: 'step', stage: 'attempt', label: `Attempted ${humanAction(a.action, cfg)}`, detail,
    evidence: vis(a.evidence), who: (a.performedBy ?? a.advisedBy)?.displayName, when,
  };
}

const alsoReportedBy = new WeakMap<Outcome, string[]>();

/** A later restatement of an outcome (retelling or copy of the reporting message) is not a second outcome. */
function dedupeOutcomes(list: Outcome[], retoldBy: (id: string) => Set<string>): Outcome[] {
  const kept: Outcome[] = [];
  for (const o0 of list) {
    const o = { ...o0 }; // evidence of restatements is merged into a copy, never into the stored record
    const ids = [...new Set(o.evidence.map((r) => r.evidenceId))];
    const retold = new Set(ids.flatMap((i) => [...retoldBy(i)]));
    const restated = ids.length > 0 && ids.every((i) => retoldBy(i).size > 0) && kept.some((k) => k.result === o.result && k.evidence.some((r) => retold.has(r.evidenceId)));
    // the same person restating the same result, or several people reporting the same result of the same attempt, is one node
    const same = kept.find((k) => k.result === o.result && k.attemptId === o.attemptId && (k.reportedBy?.id === o.reportedBy?.id || (!!o.attemptId && k.lasting === o.lasting)));
    if (same && !restated) {
      same.evidence = [...same.evidence, ...o.evidence];
      if (o.reportedBy && o.reportedBy.id !== same.reportedBy?.id) alsoReportedBy.set(same, [...(alsoReportedBy.get(same) ?? []), o.reportedBy.displayName]);
      continue;
    }
    if (!restated) kept.push(o);
  }
  return kept;
}

const joinAnd = (l: string[]): string => (l.length > 1 ? `${l.slice(0, -1).join(', ')} and ${l.at(-1)}` : (l[0] ?? ''));
const RESULT_PHRASE: Record<string, string> = { recovered: 'recovery', partial: 'partial recovery', 'no-change': 'no change', worse: 'that it got worse', unknown: 'an unclear result' };

function outcomeNode(o: Outcome, attempts: Attempt[], cfg: ViewConfig, vis: (r: EvidenceRef[]) => EvidenceRef[], whenOf: (r: EvidenceRef[]) => string | undefined): TimelineNode {
  const verified = o.basis === 'observed' && o.lasting === 'confirmed';
  const positive = o.result === 'recovered' || o.result === 'partial';
  const att = attempts.find((x) => x.id === o.attemptId);
  const after = att ? ` after the ${humanAction(att.action, cfg)}` : '';
  const unconfirmed: string[] = [];
  if (!o.reportedAt.known) unconfirmed.push('timing');
  if (o.basis !== 'observed') unconfirmed.push('cause');
  if (o.lasting !== 'confirmed') unconfirmed.push(o.lasting === 'recurred' ? 'lasting (it recurred)' : 'whether it lasted');
  const who = [o.reportedBy?.displayName, ...(alsoReportedBy.get(o) ?? [])].filter((x): x is string => !!x).filter((x, i, a) => a.indexOf(x) === i);
  const detail = verified
    ? `Observed and confirmed lasting${after}.`
    : `${who.length ? joinAnd(who) : 'Someone'} reported ${RESULT_PHRASE[o.result] ?? o.result}${after}. ${unconfirmed.length ? `${cap(joinAnd(unconfirmed))} ${unconfirmed.length > 1 ? 'are' : 'is'} unconfirmed` : 'Nothing further is unconfirmed'}.`;
  return {
    id: o.id, kind: verified ? 'verified' : positive && o.lasting !== 'recurred' ? 'reported' : 'unknown', stage: 'outcome',
    label: verified ? 'Verified outcome' : 'Reported outcome', detail, evidence: vis(o.evidence), ...(who[0] ? { who: who[0] } : {}), when: whenOf(o.evidence),
  };
}
