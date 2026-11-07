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
}

export interface AgeFold {
  yearKey: string;
  ageKey: string;
  olderValue: string;
  olderThroughYear: number | null;
  /** Regex sources (case-insensitive) that mark a condition label as hedged. */
  hedgeMarkers?: string[];
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
  for (const c of caseConditions) {
    if (ignored.has(c.key)) continue;
    const ps = byKey.get(c.key) ?? [];
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
  return out;
}
