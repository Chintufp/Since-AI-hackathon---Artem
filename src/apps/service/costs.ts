/**
 * B3: "Erkki's cost" (BUILD_BRIEF 4 B3, 5.5): what the knowledge cost the person who holds it, and how often it was
 * reused, computed from store records only (question, answer, evaluation, investigation states and their trace events),
 * never from the JSONL activity log.
 *
 * - asked / answered / deferred / dismissed / open / cancelled: the person's question records by status.
 * - seconds: the answered questions' `EvaluationRecord.response.latencyMs` (delivery, else creation, to the answer) on the
 *   engine clock; under the simulated demo clock these are simulated seconds and the view says so.
 * - reuse: distinct stored investigations whose recommendation is reuse / check-first / qualified and whose basis cites
 *   that person's knowledge (a basis message they wrote, or a claim they asserted supported by a basis message), split
 *   by who asked (`investigation.started` principal type). Ids are stable, so repeating a request is not a second reuse;
 *   previews are never stored; point-in-time views (`problem.at`, B1 D-B1-12) and standing upkeep states are skipped.
 */
import type { ExpertCostView, KnowledgeStore, StoreHealthLine } from '../../libs/utils/contracts/index.ts';
import { startedBy, storeDirectory } from '../../libs/utils/investigation/index.ts';
import type { StoreHealth } from '../../libs/utils/memory/index.ts';

const REUSE_KINDS = new Set(['reuse', 'check-first', 'qualified']);

export function expertCost(store: KnowledgeStore, personEntityId: string, opts: { simulated: boolean }): ExpertCostView {
  const dir = storeDirectory(store);
  const person = dir.get(personEntityId);
  const mine = store.list('question', { where: { personEntityId } });
  const count = (s: string): number => mine.filter((q) => q.status === s).length;
  const latencies = mine.filter((q) => q.status === 'answered')
    .map((q) => store.get('evaluation', q.decisionId)?.response?.latencyMs)
    .filter((x): x is number => typeof x === 'number' && Number.isFinite(x) && x >= 0)
    .sort((a, b) => a - b);
  const total = latencies.reduce((s, x) => s + x, 0) / 1000;
  const median = latencies.length ? latencies[Math.floor((latencies.length - 1) / 2)]! / 1000 : null;

  const isMine = (id: string | undefined): boolean => !!id && (id === personEntityId || dir.resolve(id) === personEntityId);
  let people = 0;
  let agents = 0;
  for (const st of store.list('investigation')) {
    if (st.origin === 'standing' || st.problem.at || !REUSE_KINDS.has(st.recommendation.kind)) continue;
    const ids = new Set(st.recommendation.basis.map((b) => b.evidenceId));
    if (!ids.size) continue;
    const byAuthor = [...ids].some((id) => isMine(store.get('evidence', id)?.author.id));
    const byClaim = !byAuthor && store.list('claim').some((c) => isMine(c.assertedBy?.id) && c.supporting.some((r) => ids.has(r.evidenceId)));
    if (!byAuthor && !byClaim) continue;
    const who = startedBy(st);
    if (!who) continue;
    if (who.type === 'agent') agents++;
    else people++;
  }
  const asked = mine.length;
  const answered = count('answered');
  const name = person?.name ?? personEntityId;
  const secs = Math.round(total);
  const line = `${name}: asked ${asked} · answered ${answered} · ${secs} s${opts.simulated ? ' (simulated)' : ''} · reused ${people + agents} (${people} by people, ${agents} by agents)`;
  return {
    personEntityId, name, asked, answered,
    deferred: count('deferred'), dismissed: count('dismissed'), open: count('queued') + count('delivered'), cancelled: count('cancelled'),
    seconds: { total: Math.round(total * 10) / 10, median: median === null ? null : Math.round(median * 10) / 10, answers: latencies.length, clock: opts.simulated ? 'simulated' : 'real' },
    reuse: { people, agents, total: people + agents },
    line,
  };
}

/** "Store: 14 cases · completeness 0.71 → 0.83 after 5 questions · correctness 0.92 · 2 singletons left" (BUILD_BRIEF 5.5). */
export function storeHealthLine(now: StoreHealth, baseline?: { health: StoreHealth; answeredSince: number }): StoreHealthLine {
  const f = (x: number): string => x.toFixed(2);
  const completeness = baseline && baseline.answeredSince > 0 && f(baseline.health.completeness) !== f(now.completeness)
    ? `completeness ${f(baseline.health.completeness)} → ${f(now.completeness)} after ${baseline.answeredSince} question${baseline.answeredSince === 1 ? '' : 's'}`
    : `completeness ${f(now.completeness)}`;
  const parts = [
    `Store: ${now.denominators.cases} case${now.denominators.cases === 1 ? '' : 's'}`, completeness,
    `correctness ${now.correctness === null ? 'unknown' : f(now.correctness)}`, `${now.singletons} singleton${now.singletons === 1 ? '' : 's'} left`,
  ];
  return {
    cases: now.denominators.cases,
    completeness: now.completeness,
    ...(baseline ? { completenessBefore: baseline.health.completeness, answeredSince: baseline.answeredSince } : {}),
    correctness: now.correctness,
    singletons: now.singletons,
    denominators: { cases: now.denominators.cases, retrievals: now.denominators.retrievals, caseClaims: now.denominators.caseClaims, supportedClaims: now.denominators.supportedClaims },
    line: parts.join(' · '),
  };
}
