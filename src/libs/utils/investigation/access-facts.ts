/**
 * B1 part B: access facts through the investigation. A problem with a site-access intent ("I'm driving out to RBS-310
 * tomorrow. What's the barrier code?") gets the access-fact claims bound to the named site, valid at the moment and
 * visible to the requester, as a `reuse` recommendation of action class `none`. When none is on file, or the one on file
 * has passed its stated change ("changes every October"), the result names who handles that key in the directory
 * (ObservabilityPolicy, key `site.access_code`), never anyone else, and says when an unavailable person is back if their
 * own message states it.
 *
 * Access-fact claims are caseless, so they never enter the corpus; they are looked up here by subject entity.
 */
import type { Claim, Condition, EvidenceRef, KnowledgeStore, PersonResult, Principal, Recommendation } from '../contracts/index.ts';
import { defaultValidityCues, type ValidityCueLexicon } from '../memory/extraction-config.ts';
import { instantOf, shortDate, validAt } from '../memory/validity.ts';
import type { EvidenceGate } from '../retrieval/access.ts';
import type { PersonDirectory } from './directory.ts';
import type { InvestigationSettings } from './settings.ts';

export const ACCESS_INTENT_KEY = 'intent.access';
export const ACCESS_CODE_KEY = 'site.access_code';
const ACCESS_KEY = 'site.access';
/** Statuses an access fact may have and still be read (superseded ones only inside their window, by validAt). */
const READABLE = new Set<Claim['status']>(['provisional', 'supported', 'superseded']);
/** The kind of access point the problem asks about; normalised like the extractor's qualifier. */
/** The thing asked for: a dispatch intent alone ("I will drive out to swap the rectifier") is not an access question. */
const ACCESS_OBJECT = /\b(?:barrier|gate|codes?|keys?|lockbox|lock\s*box|key\s*box|access)\b/i;
const KIND = /\b(barrier|gate|lockbox|lock\s*box|key\s*box|door|hatch)\b/i;
const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface AccessLookupInput {
  store: KnowledgeStore;
  problemText: string;
  principal: Principal;
  /** Problem entities (resolved among the entities the principal may see). */
  entityIds: string[];
  /** The investigation's evidence gate (time-aware when `at` is set). */
  gate: EvidenceGate;
  /** The moment: `at` when given, else now. */
  atMs: number;
  settings: Pick<InvestigationSettings, 'observability'>;
  directory: PersonDirectory;
  requesterEntityId?: string;
  cues?: ValidityCueLexicon;
}

export interface AccessLookup {
  recommendation: Recommendation;
  people: PersonResult[];
  /** The access-fact claims the recommendation rests on (current, then the ones they replace). */
  claimIds: string[];
  state: 'found' | 'lapsed' | 'missing';
}

const normKind = (k: string): string => k.toLowerCase().replace(/\s+/g, '').replace('keybox', 'lockbox');
const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

/** The month a recurring change happens in ("changes every October" -> 9), from the claim's validity condition or cue. */
function recurringMonth(c: Claim, cues: ValidityCueLexicon): number | undefined {
  for (const text of [c.validity.condition, c.validity.cue]) {
    const m = text ? new RegExp(cues.recurring.source, cues.recurring.flags.replace('g', '')).exec(text) : null;
    const when = m?.groups?.when?.toLowerCase();
    if (when && MONTHS.includes(when)) return MONTHS.indexOf(when);
  }
  return undefined;
}

/** First day of `month` strictly after `fromMs` (UTC). */
function nextChange(fromMs: number, month: number): number {
  const d = new Date(fromMs);
  let t = Date.UTC(d.getUTCFullYear(), month, 1);
  if (t <= fromMs) t = Date.UTC(d.getUTCFullYear() + 1, month, 1);
  return t;
}

/** Parse "1 December", "Dec 1", "2026-12-01" with an optional year; the year falls back to `year` (never invented when absent). */
function dayMonth(text: string, year?: number): { day: number; month: number; ms?: number } | undefined {
  const t = text.trim().toLowerCase();
  let day: number | undefined, month: number | undefined, y: number | undefined;
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
  if (m) [y, month, day] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
  m = m ?? /^(\d{1,2})\.?\s+([a-z]+)(?:\s+(\d{4}))?$/.exec(t);
  if (m && day === undefined) [day, month, y] = [Number(m[1]), MONTHS.findIndex((x) => x.startsWith((m as RegExpExecArray)[2]!.slice(0, 3))), m[3] ? Number(m[3]) : undefined];
  if (day === undefined) {
    const n = /^([a-z]+)\s+(\d{1,2})(?:,?\s+(\d{4}))?$/.exec(t);
    if (n) [month, day, y] = [MONTHS.findIndex((x) => x.startsWith(n[1]!.slice(0, 3))), Number(n[2]), n[3] ? Number(n[3]) : undefined];
  }
  if (day === undefined || month === undefined || month < 0) return undefined;
  const yy = y ?? year;
  return { day, month, ...(yy !== undefined ? { ms: Date.UTC(yy, month, day) } : {}) };
}

/**
 * "back 1 Dec" for an unavailable person, from evidence the person authored and the requester may see ("I am on leave
 * from 3 November to 1 December"). Read on demand, never stored. Nothing when the stated end has passed.
 */
export function returnDate(store: KnowledgeStore, gate: EvidenceGate, directory: PersonDirectory, personEntityId: string, atMs: number, cues: ValidityCueLexicon = defaultValidityCues): string | undefined {
  if (!cues.leave) return undefined;
  const re = new RegExp(cues.leave.source, cues.leave.flags.replace('g', ''));
  const mine = store.list('evidence')
    .filter((e) => directory.resolve(e.author.id) === personEntityId && gate.ref({ evidenceId: e.id }))
    .sort((a, b) => (instantOf(b.eventTime) ?? 0) - (instantOf(a.eventTime) ?? 0));
  for (const e of mine) {
    const m = re.exec(e.text);
    const to = m?.groups?.to;
    if (!to) continue;
    const at = instantOf(e.eventTime);
    const year = at !== undefined ? new Date(at).getUTCFullYear() : undefined;
    const end = dayMonth(to, year);
    if (!end) continue;
    // Only while the stated absence covers the moment: a passed end, or a start still ahead, says nothing.
    if (end.ms !== undefined && end.ms + 86_400_000 <= atMs) continue;
    const start = m?.groups?.from ? dayMonth(m.groups.from, year) : undefined;
    if (start?.ms !== undefined && start.ms > atMs) continue;
    return `${end.day} ${SHORT[end.month]}`;
  }
  return undefined;
}

/** Directory people whose group or role is configured to observe `key` (never anyone else), available first. */
export function whoHandles(
  d: Pick<AccessLookupInput, 'store' | 'gate' | 'directory' | 'settings' | 'requesterEntityId' | 'atMs' | 'cues'>, key: string,
): NonNullable<Recommendation['askWho']> {
  const { directory, settings } = d;
  const out: NonNullable<Recommendation['askWho']> = [];
  for (const p of directory.all()) {
    if (p.id === d.requesterEntityId) continue;
    const group = p.groups.find((g) => settings.observability.groups[g]?.includes(key));
    const role = p.role && settings.observability.roles[p.role]?.includes(key) ? p.role : undefined;
    if (!group && !role) continue;
    const back = p.available ? undefined : returnDate(d.store, d.gate, directory, p.id, d.atMs, d.cues);
    out.push({
      personEntityId: p.id, displayName: p.name, ...(p.role ? { role: p.role } : {}),
      reason: role ? `handles ${key === ACCESS_CODE_KEY ? 'access codes' : key} (role ${role})` : `handles ${key === ACCESS_CODE_KEY ? 'access codes' : key} (group ${group})`,
      available: p.available, ...(back ? { back } : {}),
    });
  }
  return out.sort((a, b) => Number(b.available) - Number(a.available) || a.displayName.localeCompare(b.displayName));
}

const whoText = (who: NonNullable<Recommendation['askWho']>): string | undefined => {
  if (!who.length) return undefined;
  const one = (w: (typeof who)[number]): string => {
    const notes = [w.role, w.available ? undefined : w.back ? `on leave, back ${w.back}` : 'unavailable'].filter(Boolean);
    return `${w.displayName}${notes.length ? ` (${notes.join('; ')})` : ''}`;
  };
  return who.map(one).join(' or ');
};

/**
 * Access facts for the problem's site(s), or undefined when the problem has no access intent or names no entity.
 * A claim counts only when it is bound to one of the problem's entities (a fact with no subject, such as "leave keys at
 * the front desk", never does), is readable (not retracted/contradicted/corrected), valid at the moment and visible.
 */
export function lookupAccessFacts(input: AccessLookupInput, intent: Condition | undefined): AccessLookup | undefined {
  if (!intent || input.entityIds.length === 0 || !ACCESS_OBJECT.test(input.problemText)) return undefined;
  const { store, gate, atMs } = input;
  const cues = input.cues ?? defaultValidityCues;
  const ids = new Set(input.entityIds);
  const kindAsked = KIND.exec(input.problemText)?.[1];
  const kind = kindAsked ? normKind(kindAsked) : undefined;
  const visible = (c: Claim): boolean => c.supporting.some((r) => gate.ref(r));
  const all = store.list('claim').filter((c) => c.type === 'access-fact' && READABLE.has(c.status) && c.subjectEntityIds.some((id) => ids.has(id)) && visible(c));
  const now = all.filter((c) => validAt(c, atMs));
  const codesAll = now.filter((c) => c.condition?.key === ACCESS_CODE_KEY);
  const codes = kind && codesAll.some((c) => c.condition?.qualifier === kind) ? codesAll.filter((c) => c.condition?.qualifier === kind) : kind ? [] : codesAll;
  const siteId = (codes[0] ?? all[0])?.subjectEntityIds.find((id) => ids.has(id)) ?? input.entityIds[0] as string;
  const site = store.get('entity', siteId)?.name ?? 'the site';
  const what = kind ? `${cap(kind)} code` : 'Access code';
  const who = whoHandles({ ...input, cues }, ACCESS_CODE_KEY);
  const ask = whoText(who);
  const name = (c: Claim): string | undefined => {
    const pid = c.assertedBy ? input.directory.resolve(c.assertedBy.id) : undefined;
    return (pid ? input.directory.get(pid)?.name : undefined) ?? c.assertedBy?.displayName;
  };
  const refs = (cs: Claim[]): EvidenceRef[] => {
    const seen = new Set<string>();
    return cs.flatMap((c) => c.supporting.filter((r) => gate.ref(r))).filter((r) => (seen.has(`${r.evidenceId}|${r.span?.start ?? ''}`) ? false : (seen.add(`${r.evidenceId}|${r.span?.start ?? ''}`), true)));
  };
  // Older codes this one replaced, as far as the requester may see them.
  const replaced = (c: Claim): Claim[] => store.list('claim').filter((o) => o.supersededBy === c.id && visible(o));
  // A recurring change stated on the fact itself, else on a fact it replaced (the landlord's habit outlives one code).
  const recurring = (c: Claim, depth = 0): { month: number; text: string } | undefined => {
    const month = recurringMonth(c, cues);
    if (month !== undefined) return { month, text: c.validity.condition ?? `changes every ${cap(MONTHS[month] as string)}` };
    if (depth > 4) return undefined;
    for (const o of replaced(c)) {
      const r = recurring(o, depth + 1);
      if (r) return r;
    }
    return undefined;
  };
  // Notes about the same access point that carry no code (e.g. "If the barrier is jammed, call the landlord's caretaker.").
  const notes = (): string[] => now
    .filter((c) => c.condition?.key === ACCESS_KEY && (!kind || new RegExp(`\\b${kind.replace('lockbox', 'lock\\s*box')}\\b`, 'i').test(c.statement)))
    .slice(0, 3).map((c) => c.statement);

  if (codes.length === 0) {
    const text = `No ${what.toLowerCase()} for ${site} is on file.`;
    const recommendation: Recommendation = {
      kind: 'none', text, basis: [], applicability: 'unsupported', caveats: notes(), actionClass: 'none',
      nextStep: ask ? `Ask ${ask} for the current code.` : 'Nobody in the directory is set up to answer access-code questions.',
      askWho: who,
    };
    return { recommendation, people: peopleOf(who), claimIds: [], state: 'missing' };
  }

  const lines: string[] = [];
  const caveats: string[] = [];
  let lapsed = false;
  let lapsedSince: number | undefined;
  for (const c of codes) {
    const value = String(c.condition?.value ?? '');
    const k = c.condition?.qualifier ? `${cap(c.condition.qualifier)} code` : what;
    const parts: string[] = [];
    const by = name(c);
    const when = shortDate(c.validity.from);
    if (by || when) parts.push([by, when].filter(Boolean).join(', '));
    for (const o of replaced(c)) {
      const ow = shortDate(o.validity.from);
      parts.push(`replaces ${String(o.condition?.value ?? o.statement)}${ow ? ` from ${ow}` : ''}`);
    }
    const rec = recurring(c);
    if (rec) parts.push(rec.text);
    lines.push(`${k} at ${site}: ${value}${parts.length ? ` (${parts.join('; ')})` : ''}.`);
    const from = instantOf(c.validity.from);
    if (rec && from !== undefined) {
      const next = nextChange(from, rec.month);
      if (next <= atMs) {
        lapsed = true;
        lapsedSince = Math.max(lapsedSince ?? 0, next);
      } else {
        const d = new Date(next);
        caveats.push(`It ${rec.text}: the next change is expected in ${cap(MONTHS[d.getUTCMonth()] as string)} ${d.getUTCFullYear()}.`);
      }
    } else if (rec) caveats.push(`It ${rec.text}; the date of this code is unknown, so check it before relying on it.`);
  }
  caveats.push(...notes());

  const basisClaims = [...codes, ...codes.flatMap(replaced)];
  if (lapsed) {
    const since = lapsedSince !== undefined ? new Date(lapsedSince) : undefined;
    const recommendation: Recommendation = {
      kind: 'check-first',
      text: `${lines.join(' ').replace(/\.$/, '')}. It has probably changed${since ? ` since ${since.getUTCDate()} ${SHORT[since.getUTCMonth()]}` : ''}.`,
      basis: refs(basisClaims), applicability: 'qualified', caveats: ['The code on file may be out of date: it changes on a schedule that has passed since it was given.', ...caveats],
      nextStep: ask ? `Ask ${ask} for the current code before you go.` : 'Confirm the current code before you go; nobody in the directory is set up to answer access-code questions.',
      actionClass: 'none', askWho: who,
    };
    return { recommendation, people: peopleOf(who), claimIds: basisClaims.map((c) => c.id), state: 'lapsed' };
  }
  const recommendation: Recommendation = {
    kind: 'reuse', text: lines.join(' '), basis: refs(basisClaims), applicability: 'supported', caveats, actionClass: 'none',
    ...(ask ? { nextStep: `If the code does not work, ask ${ask}.` } : {}), askWho: who,
  };
  return { recommendation, people: peopleOf(who), claimIds: basisClaims.map((c) => c.id), state: 'found' };
}

function peopleOf(who: NonNullable<Recommendation['askWho']>): PersonResult[] {
  return who.map((w) => ({
    personEntityId: w.personEntityId, displayName: w.displayName, ...(w.role ? { role: w.role } : {}),
    reasons: [{ text: `${cap(w.reason)}${w.available ? '' : w.back ? `; on leave, back ${w.back}` : '; unavailable'}`, contribution: 'directory', evidence: [], firsthand: false }],
    accessibleCaseIds: [], askable: w.available,
  }));
}
