import type { Attempt, CaseView, Claim, EvidenceRef, KnowledgeStore, Outcome, Principal, TimelineNode } from '../contracts/index.ts';
import { describeTime } from '../connectors/time.ts';
import { canSee } from './access.ts';
import { evidenceOrder, isLive } from './case-builder.ts';
import { independentSources } from './commit.ts';
import { inferActions, isNegatedAdvice } from './extractor-rules.ts';

type P = Pick<Principal, 'id' | 'groups'>;

const clip = (s: string, n = 220): string => (s.length > n ? s.slice(0, n - 3) + '...' : s);

/** Renderer-safe case timeline: red problem, yellow honest steps, green only for a reported outcome. */
export function buildCaseView(store: KnowledgeStore, caseId: string, principal: P): CaseView | undefined {
  const c = store.get('case', caseId);
  if (!c || !canSee(c.accessScope, principal)) return undefined;
  const order = evidenceOrder(store, c.evidenceIds);
  const evVisible = (id: string) => {
    const e = store.get('evidence', id);
    return !!e && canSee(e.accessScope, principal);
  };
  const visRefs = (refs: EvidenceRef[]): EvidenceRef[] => refs.filter((r) => evVisible(r.evidenceId));
  const ord = (refs: EvidenceRef[]) => Math.min(...refs.map((r) => order.get(r.evidenceId) ?? Infinity), Infinity);
  const claims = store.list('claim', { where: { caseId } });
  const live = claims.filter((x) => isLive(x) && canSee(x.accessScope, principal));
  const nameOf = (a?: { displayName: string }) => a?.displayName;
  const whenOf = (refs: EvidenceRef[]) => {
    const e = store.get('evidence', refs[0]?.evidenceId ?? '');
    return e ? describeTime(e.eventTime) : undefined;
  };

  const timeline: TimelineNode[] = [];
  // ---- problem (red)
  const obs = live.filter((x) => x.type === 'observation').sort((a, b) => ord(a.supporting) - ord(b.supporting));
  if (obs.length) {
    const first = obs[0]!;
    timeline.push({
      id: first.id, kind: 'problem', stage: 'observation', label: 'Reported problem',
      detail: obs.map((o) => clip(o.statement)).join('\n'), evidence: visRefs(first.supporting), who: nameOf(first.assertedBy), when: whenOf(first.supporting),
    });
  } else {
    timeline.push({ id: `${c.id}:problem`, kind: 'unknown', stage: 'unknown', label: 'Problem statement', detail: `No explicit problem statement was extracted. Case title: ${c.title}`, evidence: [] });
  }
  // ---- conditions (yellow)
  const conds = live.filter((x) => x.type === 'condition' && x.condition);
  if (conds.length) {
    timeline.push({
      id: `${c.id}:conditions`, kind: 'step', stage: 'observation', label: 'Reported conditions',
      detail: [...new Set(conds.map((x) => x.condition!.label ?? `${x.condition!.key}=${String(x.condition!.value)}`))].join('; '),
      evidence: visRefs(conds.flatMap((x) => x.supporting)).slice(0, 6),
    });
  }
  // ---- steps (yellow), ordered by where they appear in the evidence
  const steps: Array<{ at: number; node: TimelineNode }> = [];
  for (const h of live.filter((x) => x.type === 'hypothesis')) {
    steps.push({ at: ord(h.supporting), node: { id: h.id, kind: 'step', stage: 'hypothesis', label: 'Possible cause', detail: `Stated as a hypothesis, not confirmed: ${clip(h.statement)}`, evidence: visRefs(h.supporting), who: nameOf(h.assertedBy), when: whenOf(h.supporting) } });
  }
  const attempts = store.list('attempt', { where: { caseId } }).filter((a) => visRefs(a.evidence).length > 0);
  const attemptAdviceIds = new Set(attempts.map((a) => a.adviceClaimId).filter(Boolean));
  for (const a of attempts) steps.push({ at: ord(a.evidence), node: attemptNode(a, claims, principal, whenOf, visRefs) });
  for (const adv of live.filter((x) => x.type === 'advice')) {
    if (attemptAdviceIds.has(adv.id)) continue;
    const acts = inferActions(adv.statement);
    const negated = acts.some((x) => x.negated) || isNegatedAdvice(adv.statement);
    const isCheck = acts.some((x) => x.name.endsWith('.check') && !x.negated);
    steps.push({
      at: ord(adv.supporting),
      node: {
        id: adv.id, kind: 'step', stage: 'check',
        label: negated ? 'Advised against' : isCheck ? 'Suggested check' : 'Suggested step',
        detail: `${negated ? 'Advice to avoid' : 'Advice only, not reported as done'}: ${clip(adv.statement)}`, evidence: visRefs(adv.supporting), who: nameOf(adv.assertedBy), when: whenOf(adv.supporting),
      },
    });
  }
  steps.sort((a, b) => a.at - b.at);
  timeline.push(...steps.map((s) => s.node));

  // ---- outcome (green only when one exists)
  const outcomes = store.list('outcome', { where: { caseId } }).filter((o) => visRefs(o.evidence).length > 0);
  for (const o of outcomes.sort((a, b) => ord(a.evidence) - ord(b.evidence))) timeline.push(outcomeNode(o, attempts, visRefs, whenOf));
  if (!outcomes.length && attempts.some((a) => a.performed === 'reported')) {
    timeline.push({ id: `${c.id}:outcome-unknown`, kind: 'unknown', stage: 'unknown', label: 'Outcome unknown', detail: 'An action was reported as done, but no result was reported.', evidence: [] });
  }

  // ---- caveat
  const supportRefs = visRefs(live.flatMap((x) => x.supporting));
  const indep = independentSources(store, supportRefs);
  const total = new Set(supportRefs.map((r) => r.evidenceId)).size;
  const retracted = claims.filter((x) => x.status === 'retracted' || x.status === 'corrected' || x.status === 'contradicted').length;
  const parts: string[] = [];
  if (outcomes.some((o) => o.result === 'recovered')) parts.push('Recovery is as reported by a person; timing, cause and whether it lasted are unconfirmed unless an observation says otherwise.');
  else if (!outcomes.length) parts.push('No outcome has been reported for this case.');
  parts.push(`${total} source record(s) cited, ${indep} independent (copies and retellings are not counted as confirmation).`);
  if (retracted) parts.push(`${retracted} claim(s) were retracted, corrected or contradicted and are not shown.`);
  const open = c.gaps.filter((g) => g.status === 'open').length;
  if (open) parts.push(`${open} open gap(s) remain.`);

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
  return { caseId: c.id, title: c.title, status: c.status, entities, timeline, caveat: parts.join(' '), sources };
}

function attemptNode(a: Attempt, claims: Claim[], _p: P, whenOf: (r: EvidenceRef[]) => string | undefined, vis: (r: EvidenceRef[]) => EvidenceRef[]): TimelineNode {
  const performed = a.performed === 'reported';
  const detail = [
    a.advisedBy ? `Advised by ${a.advisedBy.displayName}.` : 'No advice recorded for this step.',
    performed ? `Reported as performed${a.performedBy ? ` by ${a.performedBy.displayName}` : ''} (not independently observed).` : 'Not reported as performed.',
  ].join(' ');
  void claims;
  return {
    id: a.id, kind: 'step', stage: 'attempt', label: performed ? `Attempted ${a.action}` : `Suggested ${a.action}`, detail,
    evidence: vis(a.evidence), who: (a.performedBy ?? a.advisedBy)?.displayName, when: whenOf(a.evidence),
  };
}

function outcomeNode(o: Outcome, attempts: Attempt[], vis: (r: EvidenceRef[]) => EvidenceRef[], whenOf: (r: EvidenceRef[]) => string | undefined): TimelineNode {
  const verified = o.basis === 'observed' && o.lasting === 'confirmed';
  const positive = o.result === 'recovered' || o.result === 'partial';
  const att = attempts.find((x) => x.id === o.attemptId);
  const unconfirmed: string[] = [];
  if (!o.reportedAt.known) unconfirmed.push('timing');
  if (o.basis !== 'observed') unconfirmed.push('cause');
  if (o.lasting !== 'confirmed') unconfirmed.push(o.lasting === 'recurred' ? 'lasting (it recurred)' : 'whether it lasted');
  const who = o.reportedBy?.displayName;
  const detail = verified
    ? `Observed and confirmed lasting${att ? ` after ${att.action}` : ''}.`
    : `${who ?? 'Someone'} reported: ${o.result}${att ? ` after ${att.action}` : ''}. Basis: ${o.basis}. Unconfirmed: ${unconfirmed.join(', ') || 'nothing further'}.`;
  return {
    id: o.id, kind: verified ? 'verified' : positive && o.lasting !== 'recurred' ? 'reported' : 'unknown', stage: 'outcome',
    label: verified ? 'Verified outcome' : `Reported outcome: ${o.result}`, detail, evidence: vis(o.evidence), who, when: whenOf(o.evidence),
  };
}
