import type { Condition, ExpectedTrait } from '../contracts/index.ts';

export interface CompareOptions {
  /** Identity-like keys never produce matches/conflicts/missing (different assets legitimately differ). */
  ignoredKeys?: string[];
  /** Multi-valued history keys: can only match, never conflict or be missing. */
  historyKeys?: string[];
  /**
   * Fold a stated year into an age class (configuration): a condition `yearKey` <= `olderThroughYear` yields
   * `ageKey` = `olderValue` (origin 'inferred') when the same list has no `ageKey`. Hedged years (label matches a
   * `hedgeMarkers` pattern, or origin 'inferred') are never folded: an uncertain year does not decide an age class.
   * Only the older side is derived; years after the cutoff leave the age unknown. Add `yearKey` to `ignoredKeys` so the
   * raw year itself never counts as a match, conflict or gap.
   */
  ageFold?: AgeFold;
  /**
   * Keys the PROBLEM states but a case may not record at all (for example the model of the earlier unit). Per key, label
   * templates ({label} = the problem condition's label, {value} = its value): `missing` when the case carries no such condition and nobody has
   * answered, `match` / `conflict` once an attributed answer says the case's unit does / does not share the stated value.
   * Keys not listed here are never reported missing just because the case lacks them.
   */
  problemStated?: Record<string, ProblemStatedLabels>;
}

export interface ProblemStatedLabels {
  missing: string;
  match: string;
  conflict: string;
}

export interface AgeFold {
  yearKey: string;
  ageKey: string;
  olderValue: string;
  olderThroughYear: number | null;
  /** Regex sources (case-insensitive) that mark a condition label as hedged. */
  hedgeMarkers?: string[];
  /**
   * B5: a production-batch key whose value is a year (e.g. 'unit.batch'). A case whose flat batch year is after
   * `olderThroughYear` conflicts with a problem that states `ageKey` = `olderValue` (an older unit is not from a later
   * batch). Conflict only: the batch is never folded into an age, so a problem that says nothing about age still sees
   * the batch as its own missing key. The reverse holds too: a later batch in the problem (stated, or a Yes answer about
   * it) conflicts with a case that records `ageKey` = `olderValue`.
   */
  batchKey?: string;
}

/** True when a condition is hedged in its source or only inferred, so it must not drive consequential decisions. */
export function isSoftCondition(c: Pick<Condition, 'origin' | 'label'>, hedgeMarkers: string[] = []): boolean {
  if (c.origin === 'inferred') return true;
  return !!c.label && hedgeMarkers.some((m) => new RegExp(m, 'i').test(c.label as string));
}

/** Adds the folded age condition (see `AgeFold`); returns the input unchanged when nothing folds. */
export function foldYearToAge(conditions: Condition[], fold?: AgeFold): Condition[] {
  if (!fold || fold.olderThroughYear === null || conditions.some((c) => c.key === fold.ageKey)) return conditions;
  const year = conditions.find((c) => c.key === fold.yearKey && c.operator === 'eq' && !isSoftCondition(c, fold.hedgeMarkers));
  const y = year ? num(year.value) : undefined;
  if (!year || y === undefined || y > fold.olderThroughYear) return conditions;
  return [...conditions, { key: fold.ageKey, operator: 'eq', value: fold.olderValue, origin: 'inferred', label: `Older unit (installed ${y})`, evidence: year.evidence }];
}

export interface ConditionComparison {
  matching: Condition[];
  conflicting: Condition[];
  missing: Array<{ key: string; label: string }>;
  expectedTraits: ExpectedTrait[];
}

type Agreement = 'match' | 'conflict' | 'unknown';

export const isAnswerMarker = (c: Pick<Condition, 'operator' | 'value'>): boolean =>
  c.operator === 'eq' && (c.value === ANSWER_MATCHES_CASE || c.value === ANSWER_DIFFERS_FROM_CASE);

const norm = (v: unknown): string => String(v).trim().toLowerCase();
const same = (a: unknown, b: unknown): boolean => norm(a) === norm(b);
const num = (v: unknown): number | undefined => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v)) ? Number(v) : undefined);

/** Reserved values: an attributed yes/no answer to "does the case's condition hold here?", independent of the case operator. */
export const ANSWER_MATCHES_CASE = '__answer:matches-case';
export const ANSWER_DIFFERS_FROM_CASE = '__answer:differs-from-case';

/** How a problem condition relates to a case condition on the same key. */
export function agreement(problem: Condition, caseCond: Condition): Agreement {
  const p = problem;
  const c = caseCond;
  if (p.operator === 'eq' && p.value === ANSWER_MATCHES_CASE) return 'match';
  if (p.operator === 'eq' && p.value === ANSWER_DIFFERS_FROM_CASE) return 'conflict';
  switch (c.operator) {
    case 'eq':
      if (p.operator === 'eq') return same(p.value, c.value) ? 'match' : 'conflict';
      if (p.operator === 'neq') return same(p.value, c.value) ? 'conflict' : 'unknown';
      if (p.operator === 'present') return 'unknown';
      if (p.operator === 'absent') return 'conflict';
      return 'unknown';
    case 'neq':
      if (p.operator === 'eq') return same(p.value, c.value) ? 'conflict' : 'match';
      if (p.operator === 'neq') return same(p.value, c.value) ? 'match' : 'unknown';
      return 'unknown';
    case 'present':
      if (p.operator === 'absent') return 'conflict';
      return p.operator === 'eq' || p.operator === 'present' || p.operator === 'gte' || p.operator === 'lte' || p.operator === 'contains' ? 'match' : 'unknown';
    case 'absent':
      if (p.operator === 'absent') return 'match';
      return p.operator === 'eq' || p.operator === 'present' ? 'conflict' : 'unknown';
    case 'gte':
    case 'lte': {
      const cv = num(c.value);
      const pv = num(p.value);
      if (cv === undefined || pv === undefined || p.operator !== 'eq') return 'unknown';
      return (c.operator === 'gte' ? pv >= cv : pv <= cv) ? 'match' : 'conflict';
    }
    case 'contains':
      if (p.operator === 'eq') return norm(p.value).includes(norm(c.value)) ? 'match' : 'unknown';
      return 'unknown';
    default:
      return 'unknown';
  }
}

const describe = (c: Condition): string => (c.operator === 'eq' ? String(c.value) : `${c.operator} ${c.value === undefined ? '' : String(c.value)}`.trim());
const labelOf = (c: Condition): string => c.label ?? `${c.key}=${describe(c)}`;

/**
 * Compare the problem's conditions with a case's conditions (spec rules):
 * same key equal -> matching; same key different -> conflicting; case key absent from the problem (or only weakly
 * known) -> missing. Case conditions not yet observed in the problem become 'unchecked' expected traits.
 * The returned conditions are the CASE's, so display shows what the candidate carries; conflicting entries note
 * the problem's value in the label.
 */
export function compareConditions(problemIn: Condition[], caseIn: Condition[], opts: CompareOptions = {}): ConditionComparison {
  const problem = foldYearToAge(problemIn, opts.ageFold);
  const caseConditions = foldYearToAge(caseIn, opts.ageFold);
  const ignored = new Set(opts.ignoredKeys ?? []);
  const history = new Set(opts.historyKeys ?? []);
  const byKey = new Map<string, Condition[]>();
  for (const p of problem) byKey.set(p.key, [...(byKey.get(p.key) ?? []), p]);

  const out: ConditionComparison = { matching: [], conflicting: [], missing: [], expectedTraits: [] };
  const seenMissing = new Set<string>();
  // An attributed answer on a key outranks what the problem text said about it.
  const problemFor = (key: string): Condition[] => {
    const all = byKey.get(key) ?? [];
    const answers = all.filter(isAnswerMarker);
    return answers.length ? answers : all;
  };
  // B5: the label of the problem's flat "older unit" when the case records a later batch year (see AgeFold.batchKey).
  const olderVsLaterBatch = (c: Condition): string | undefined => {
    const f = opts.ageFold;
    if (!f?.batchKey || f.olderThroughYear === null || c.key !== f.batchKey || c.operator !== 'eq' || isSoftCondition(c, f.hedgeMarkers)) return undefined;
    if (caseConditions.some((x) => x.key === f.ageKey)) return undefined;
    const y = num(c.value);
    if (y === undefined || y <= f.olderThroughYear) return undefined;
    const older = (byKey.get(f.ageKey) ?? []).find((p) => p.operator === 'eq' && !isAnswerMarker(p) && same(p.value, f.olderValue));
    return older ? (older.label ?? 'Older unit') : undefined;
  };
  // B5 (D-B5-13), the same rule the other way round: the label of the problem's later batch year when the case records an
  // older unit. The batch is stated flatly in the problem, or a Yes to "Is {asset} from the {value} batch?" whose label
  // names the case's batch year (the answer marker itself carries no value).
  const laterBatchVsOlder = (c: Condition): string | undefined => {
    const f = opts.ageFold;
    if (!f?.batchKey || f.olderThroughYear === null || c.key !== f.ageKey || c.operator !== 'eq' || !same(c.value, f.olderValue)) return undefined;
    if (isSoftCondition({ ...c, origin: 'reported' }, f.hedgeMarkers)) return undefined; // a case age folded from a flat year counts
    for (const p of byKey.get(f.batchKey) ?? []) {
      if (p.operator !== 'eq' || p.value === ANSWER_DIFFERS_FROM_CASE || isSoftCondition(p, f.hedgeMarkers)) continue;
      const answered = p.value === ANSWER_MATCHES_CASE;
      const y = answered ? num(/\b(\d{4})\b/.exec(p.label ?? '')?.[1]) : num(p.value);
      if (y !== undefined && y > f.olderThroughYear) return answered ? `${y} batch (answered)` : (p.label ?? `${y} batch`);
    }
    return undefined;
  };
  for (const c of caseConditions) {
    if (ignored.has(c.key)) continue;
    const ps = problemFor(c.key);
    if (history.has(c.key)) {
      if (ps.some((p) => agreement(p, c) === 'match')) out.matching.push(c);
      continue;
    }
    const results = ps.map((p) => ({ p, a: agreement(p, c) }));
    const conflict = results.find((r) => r.a === 'conflict');
    if (results.some((r) => r.a === 'match')) {
      out.matching.push(c);
    } else if (conflict) {
      out.conflicting.push({ ...c, label: `${labelOf(c)} (this problem: ${conflict.p.label ?? `${conflict.p.key}=${describe(conflict.p)}`})` });
    } else if (!ps.length && (olderVsLaterBatch(c) ?? laterBatchVsOlder(c))) {
      out.conflicting.push({ ...c, label: `${labelOf(c)} (this problem: ${olderVsLaterBatch(c) ?? laterBatchVsOlder(c)})` });
    } else if (!seenMissing.has(c.key)) {
      seenMissing.add(c.key);
      out.missing.push({ key: c.key, label: labelOf(c) });
      if (c.value !== undefined) {
        out.expectedTraits.push({
          condition: { key: c.key, label: labelOf(c), expected: c.value },
          status: 'unchecked',
          basis: c.evidence,
        });
      }
    }
  }
  for (const [key, labels] of Object.entries(opts.problemStated ?? {})) {
    if (ignored.has(key) || history.has(key) || caseConditions.some((c) => c.key === key)) continue;
    const all = byKey.get(key) ?? [];
    const stated = all.find((p) => p.operator === 'eq' && p.value !== undefined && !isAnswerMarker(p) && p.origin !== 'inferred');
    const answer = all.filter(isAnswerMarker).pop();
    if (!stated && !answer) continue;
    const base = stated ?? (answer as Condition);
    const label = (stated?.label ?? `${key}=${describe(stated ?? (answer as Condition))}`).trim();
    const fill = (t: string): string => t.replaceAll('{label}', label).replaceAll('{value}', String((stated ?? base).value));
    if (answer && answer.value === ANSWER_MATCHES_CASE) {
      out.matching.push({ ...base, label: fill(labels.match), evidence: answer.evidence });
    } else if (answer) {
      out.conflicting.push({ ...base, label: fill(labels.conflict), evidence: answer.evidence });
    } else {
      out.missing.push({ key, label: fill(labels.missing) });
      out.expectedTraits.push({ condition: { key, label: fill(labels.missing), expected: (stated as Condition).value as string | number | boolean }, status: 'unchecked', basis: (stated as Condition).evidence });
    }
  }
  return out;
}
