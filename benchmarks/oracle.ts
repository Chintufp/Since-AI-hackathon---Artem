/**
 * Person-answer oracle. Answers are revealed strictly from the hidden answer key; the oracle never
 * invents a world. 'unknown' means the person's knowledge does not cover the question;
 * 'no-answer' means the person cannot respond at all (unavailable / gap marked unanswerable).
 */
import type { IncomingProblems, PeopleDirectory } from '../src/libs/utils/contracts/index.ts';

export type ProblemKey = IncomingProblems['problems'][number]['key'];
export type OracleReply = 'yes' | 'no' | 'unknown' | 'no-answer';

export interface OracleQuestion {
  /** Canonical condition key (see contracts/vocabulary.ts), e.g. "unit.revision". */
  conditionKey: string;
  /** The value the question asks about, e.g. "A" for "Is the controller revision A?". */
  expected?: string | number | boolean;
  /** Scope entity name the question is about (selects "key@Entity" answers). */
  scopeEntity?: string;
}

export interface OracleContext {
  /** Visible directory; people with available === false give no answer. */
  people?: PeopleDirectory;
  /** Additional person ids that cannot respond. */
  unavailable?: string[];
}

/** Splits "key=value@Entity" into parts. */
export function parseAnswerKey(k: string): { key: string; value?: string; scope?: string } {
  const at = k.indexOf('@');
  const scope = at >= 0 ? k.slice(at + 1) : undefined;
  const head = at >= 0 ? k.slice(0, at) : k;
  const eq = head.indexOf('=');
  return eq >= 0 ? { key: head.slice(0, eq), value: head.slice(eq + 1), scope } : { key: head, scope };
}

export function answerFor(key: ProblemKey, personId: string, q: OracleQuestion, ctx: OracleContext = {}): OracleReply {
  const dir = ctx.people?.people.find((p) => p.id === personId);
  if ((dir && dir.available === false) || ctx.unavailable?.includes(personId)) return 'no-answer';
  const gap = key.consequentialGap;
  if (gap?.unanswerable && gap.answerers.includes(personId)) return 'no-answer';

  const mine = key.answers[personId];
  if (!mine) return 'unknown';
  const want = q.expected === undefined ? undefined : String(q.expected);
  const scope = q.scopeEntity;
  const candidates = [
    want !== undefined && scope ? `${q.conditionKey}=${want}@${scope}` : undefined,
    scope ? `${q.conditionKey}@${scope}` : undefined,
    want !== undefined ? `${q.conditionKey}=${want}` : undefined,
    q.conditionKey,
  ];
  for (const c of candidates) if (c && c in mine) return mine[c]!;

  // An unscoped answer was written about the problem's own entity; it must not be reused for another scope.
  const compatible = (k: string) => {
    const p = parseAnswerKey(k);
    return p.key === q.conditionKey && !(scope && !p.scope);
  };
  const flip = (a: OracleReply): OracleReply => (a === 'yes' ? 'no' : a === 'no' ? 'yes' : a);
  for (const [k, v] of Object.entries(mine)) {
    if (!compatible(k)) continue;
    const p = parseAnswerKey(k);
    if (p.scope && scope && p.scope !== scope) continue;
    if (want === undefined) {
      // Valueless question ("what/is there a <key>?"): a known yes for any value of the key answers yes.
      if (v === 'yes') return 'yes';
      continue;
    }
    if (p.value === undefined || p.value === want) continue;
    // Boolean complement: "=true: no" is "=false: yes" and the reverse.
    const bools = ['true', 'false'];
    if (bools.includes(want) && bools.includes(p.value)) {
      if (v === 'yes' || v === 'no') return flip(v);
      continue;
    }
    // Single-valued conditions: a known 'yes' for a different value means 'no' for this one.
    if (v === 'yes') return 'no';
  }
  return 'unknown';
}

/**
 * Condition keys that count as asking about the consequential gap: the key's decisive (distinguishing) conditions,
 * or, when none are declared, the keys its answerers speak to; minus conditions the requester already observed.
 * (The contract has no explicit gap conditionKey; this is the closest hidden signal.)
 */
export function gapConditionKeys(key: ProblemKey, observations: Array<{ key: string }> = []): string[] {
  const observed = new Set(observations.map((o) => o.key));
  const out = new Set<string>();
  const decisive = (key.distinguishingConditions ?? []).map((d) => d.key);
  if (decisive.length > 0) {
    // The decisive conditions ARE the gap; answerer knowledge of unrelated keys does not count.
    for (const k of decisive) out.add(k);
  } else {
    for (const id of key.consequentialGap?.answerers ?? []) {
      for (const k of Object.keys(key.answers[id] ?? {})) out.add(parseAnswerKey(k).key);
    }
  }
  // Already-observed conditions are not a gap (asking the requester's own observation finds nothing).
  for (const k of observed) out.delete(k);
  return [...out].sort();
}
