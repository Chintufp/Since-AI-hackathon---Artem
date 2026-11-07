/**
 * The extract slot through a model (BUILD_BRIEF 2.4): the thread goes in as indexed messages with their evidence ids,
 * the output is an ExtractionProposal constrained by a JSON schema (built from the zod schema that validates it).
 *
 * The model proposes; nothing here writes memory. Every claim, entity and link must cite evidence of this thread with an
 * excerpt that is a substring of that evidence's extraction text, or it is dropped: the model cannot invent evidence.
 * The excerpt must also carry the item (D-B2-54): at least three words (or the whole message), every id and number of
 * a claim's statement and condition, half of the statement's content words; an entity's name in its excerpt. Who said
 * it comes from the cited messages' authors, never from the model alone (D-B2-55).
 * Spans come from where the excerpt sits in the text. `confidence` is informational only.
 *
 * The union with the rules proposal (`unionProposal`) is committed AFTER the rules proposal, re-keyed to the rules
 * incidents, so claims both produced keep their 'rules' label and only model-only claims carry the model's route.
 */
import { z } from 'zod';
import type {
  ActorRef, ConversationContext, EvidenceRef, ExtractionProposal, Extractor, ProposedClaim, ProposedEntity, ProposedLink, RouteInfo,
} from '../contracts/index.ts';
import { extractionText } from '../context/index.ts';
import type { ModelProvider } from '../models/providers/index.ts';

export const LLM_EXTRACT_VERSION = 'ollama-extract@1';
export const API_EXTRACT_VERSION = 'api-extract@1';

const CLAIM_TYPES = ['observation', 'hypothesis', 'advice', 'action', 'outcome', 'condition', 'access-fact', 'identity', 'other'] as const;
const ENTITY_TYPES = ['asset', 'site', 'person', 'component', 'software', 'location', 'organization', 'other'] as const;
const CONTRIBUTIONS = ['reported-problem', 'advised', 'performed-check', 'performed-action', 'reported-outcome', 'observed-condition', 'mentioned'] as const;
const OPERATORS = ['eq', 'neq', 'gte', 'lte', 'contains', 'present', 'absent'] as const;

const refSchema = z.object({ evidenceId: z.string().min(1), excerpt: z.string().min(1) });
const claimSchema = z.object({
  type: z.enum(CLAIM_TYPES),
  statement: z.string().min(1),
  subjectEntityNames: z.array(z.string()),
  assertedByActorId: z.string().optional(),
  evidence: z.array(refSchema).min(1),
  condition: z.object({
    key: z.string().min(1), operator: z.enum(OPERATORS), value: z.union([z.string(), z.number(), z.boolean()]).optional(), label: z.string().optional(),
  }).optional(),
  confidence: z.number().min(0).max(1).optional(),
});
const entitySchema = z.object({ type: z.enum(ENTITY_TYPES), name: z.string().min(1), aliases: z.array(z.string()), evidence: z.array(refSchema).min(1) });
const linkSchema = z.object({ personActorId: z.string().min(1), contribution: z.enum(CONTRIBUTIONS), evidence: z.array(refSchema).min(1), firsthand: z.boolean() });

/** ExtractionProposal mirrored in zod (route is added by the extractor, never by the model). */
export const extractionOutputSchema = z.object({
  claims: z.array(claimSchema),
  entities: z.array(entitySchema),
  links: z.array(linkSchema),
  incidents: z.array(z.object({ key: z.string(), evidenceIds: z.array(z.string()), title: z.string() })),
  usefulness: z.array(z.object({ evidenceId: z.string(), label: z.enum(['useful', 'uncertain', 'irrelevant']), reason: z.string() })),
});
export type ExtractionOutput = z.infer<typeof extractionOutputSchema>;

/** JSON schema for Ollama's `format` and the api provider's forced tool. */
export const extractionJsonSchema = (): Record<string, unknown> => z.toJSONSchema(extractionOutputSchema) as Record<string, unknown>;

/**
 * Four few-shot examples in the shape of data/replays/e01-claude-arm/ (claims cite evidence ids with verbatim
 * excerpts). Synthetic wording; no sentence of any data set.
 */
export const FEW_SHOT: Array<{ thread: string; output: ExtractionOutput }> = [
  {
    thread: '[1] id=ex:1 author=Aino (actor a:aino)\nSW-210 port 4 shows link up but no traffic since the patch this morning.',
    output: {
      claims: [{ type: 'observation', statement: 'SW-210 port 4 shows link up but no traffic since the patch.', subjectEntityNames: ['SW-210'], assertedByActorId: 'a:aino', evidence: [{ evidenceId: 'ex:1', excerpt: 'SW-210 port 4 shows link up but no traffic since the patch this morning.' }] }],
      entities: [{ type: 'asset', name: 'SW-210', aliases: [], evidence: [{ evidenceId: 'ex:1', excerpt: 'SW-210 port 4' }] }],
      links: [{ personActorId: 'a:aino', contribution: 'reported-problem', evidence: [{ evidenceId: 'ex:1', excerpt: 'SW-210 port 4 shows link up but no traffic' }], firsthand: true }],
      incidents: [{ key: 'asset:SW-210', evidenceIds: ['ex:1'], title: 'SW-210 port 4 up without traffic' }], usefulness: [{ evidenceId: 'ex:1', label: 'useful', reason: 'Symptom.' }],
    },
  },
  {
    thread: '[1] id=ex:2 author=Pekka (actor a:pekka)\nProbably the SFP. Swap it and reseat the patch cable.',
    output: {
      claims: [
        { type: 'hypothesis', statement: 'The SFP is probably the cause.', subjectEntityNames: ['SFP'], assertedByActorId: 'a:pekka', evidence: [{ evidenceId: 'ex:2', excerpt: 'Probably the SFP.' }] },
        { type: 'advice', statement: 'Swap the SFP and reseat the patch cable.', subjectEntityNames: ['SFP'], assertedByActorId: 'a:pekka', evidence: [{ evidenceId: 'ex:2', excerpt: 'Swap it and reseat the patch cable.' }] },
      ],
      entities: [{ type: 'component', name: 'SFP', aliases: [], evidence: [{ evidenceId: 'ex:2', excerpt: 'Probably the SFP.' }] }],
      links: [{ personActorId: 'a:pekka', contribution: 'advised', evidence: [{ evidenceId: 'ex:2', excerpt: 'Swap it and reseat the patch cable.' }], firsthand: false }],
      incidents: [], usefulness: [{ evidenceId: 'ex:2', label: 'useful', reason: 'Cause and advice.' }],
    },
  },
  {
    thread: '[1] id=ex:3 author=Aino (actor a:aino)\nSwapped the SFP at 11:20, traffic is flowing again.',
    output: {
      claims: [
        { type: 'action', statement: 'Swapped the SFP.', subjectEntityNames: ['SFP'], assertedByActorId: 'a:aino', evidence: [{ evidenceId: 'ex:3', excerpt: 'Swapped the SFP at 11:20' }] },
        { type: 'outcome', statement: 'Traffic is flowing again after the SFP swap.', subjectEntityNames: ['SW-210'], assertedByActorId: 'a:aino', evidence: [{ evidenceId: 'ex:3', excerpt: 'traffic is flowing again' }] },
      ],
      entities: [],
      links: [
        { personActorId: 'a:aino', contribution: 'performed-action', evidence: [{ evidenceId: 'ex:3', excerpt: 'Swapped the SFP at 11:20' }], firsthand: true },
        { personActorId: 'a:aino', contribution: 'reported-outcome', evidence: [{ evidenceId: 'ex:3', excerpt: 'traffic is flowing again' }], firsthand: true },
      ],
      incidents: [], usefulness: [{ evidenceId: 'ex:3', label: 'useful', reason: 'Action and result.' }],
    },
  },
  {
    thread: '[1] id=ex:4 author=Pekka (actor a:pekka)\nThat unit was installed in 2017, I think. Lunch at noon?',
    output: {
      claims: [{ type: 'condition', statement: 'The unit was installed in 2017 (hedged).', subjectEntityNames: ['SW-210'], assertedByActorId: 'a:pekka', evidence: [{ evidenceId: 'ex:4', excerpt: 'That unit was installed in 2017, I think.' }], condition: { key: 'unit.installed_year', operator: 'eq', value: 2017, label: 'Installed 2017' } }],
      entities: [], links: [], incidents: [],
      usefulness: [{ evidenceId: 'ex:4', label: 'useful', reason: 'Installation year; the lunch remark is irrelevant.' }],
    },
  },
];

const INSTRUCTIONS = [
  'You read one work conversation about equipment problems and fill a form. Output JSON only, matching the schema.',
  'Rules:',
  '- Every claim, entity and link cites evidence: evidenceId is one of the ids shown, excerpt is copied VERBATIM from that message (a substring, no paraphrase).',
  '- Claim types: observation (seen or measured), hypothesis (a suggested cause), advice (a recommended check or action), action (reportedly performed), outcome (the result after an action), condition (environment or equipment fact).',
  '- assertedByActorId and personActorId are actor ids shown in the thread. Never invent people, numbers, dates or actions.',
  '- Leave out greetings and small talk. Keep hedges ("I think", "probably") in the statement.',
].join('\n');

/** The thread as indexed messages with evidence ids, authors (with actor ids) and the extraction text. */
export function renderThread(context: ConversationContext): string {
  return context.evidence.map((e, i) => {
    const when = e.eventTime.known && e.eventTime.iso ? ` time=${e.eventTime.iso}` : '';
    const subject = e.thread.subject && i === 0 ? ` subject=${JSON.stringify(e.thread.subject)}` : '';
    return `[${i + 1}] id=${e.id} author=${e.author.displayName} (actor ${e.author.id})${when}${subject}\n${extractionText(e).trim()}`;
  }).join('\n\n');
}

export function buildExtractionPrompt(context: ConversationContext): string {
  const shots = FEW_SHOT.map((s, i) => `Example ${i + 1}\nThread:\n${s.thread}\nJSON:\n${JSON.stringify(s.output)}`).join('\n\n');
  return `${INSTRUCTIONS}\n\n${shots}\n\nNow the real thread.\nThread:\n${renderThread(context)}\nJSON:`;
}

export interface DroppedItem {
  kind: 'claim' | 'entity' | 'link';
  label: string;
  reason: 'unknown-evidence' | 'excerpt-not-in-evidence' | 'excerpt-does-not-support' | 'unknown-person' | 'person-not-author';
}

export interface ValidatedExtraction {
  proposal: ExtractionProposal;
  dropped: DroppedItem[];
}

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Where the excerpt sits in the text: exact first, then with any run of whitespace matching any run (line breaks in
 * mail). Returns the span and the verbatim slice, or undefined when the excerpt is not in the text.
 */
export function locateExcerpt(text: string, excerpt: string): { start: number; end: number; excerpt: string } | undefined {
  const want = excerpt.trim();
  if (!want) return undefined;
  const at = text.indexOf(want);
  if (at >= 0) return { start: at, end: at + want.length, excerpt: want };
  const parts = want.split(/\s+/).filter(Boolean).map(escapeRe);
  if (!parts.length) return undefined;
  const m = new RegExp(parts.join('\\s+')).exec(text);
  return m ? { start: m.index, end: m.index + m[0].length, excerpt: m[0] } : undefined;
}

const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'-]*/gu;
const wordsOf = (s: string): string[] => s.toLowerCase().match(WORD_RE) ?? [];
/** Asset-like ids ("RTR-117", "SW-210"). */
const ID_RE = /\b[A-Za-z]{2,6}-\d{1,6}\b/g;
const idsIn = (s: string): string[] => (s.match(ID_RE) ?? []).map((x) => x.toLowerCase());
const numbersIn = (s: string): string[] => s.replace(ID_RE, ' ').match(/\d+(?:[.,:]\d+)*/g) ?? [];
/** Words that carry no content of their own (they never count for or against support). */
const FUNCTION_WORDS = new Set([
  'the', 'and', 'for', 'with', 'this', 'that', 'these', 'those', 'there', 'here', 'from', 'than', 'then', 'was', 'were', 'are', 'has', 'have', 'had',
  'its', 'any', 'all', 'also', 'into', 'onto', 'after', 'before', 'but', 'not', 'our', 'their', 'his', 'her', 'they', 'them', 'you', 'your', 'she',
  'him', 'who', 'what', 'which', 'when', 'where', 'why', 'how', 'been', 'being', 'will', 'would', 'should', 'could', 'can', 'may', 'might', 'did',
  'does', 'about', 'again', 'once', 'some', 'very', 'just', 'still', 'only', 'probably', 'maybe', 'perhaps', 'think', 'hedged', 'reportedly',
]);
const contentWords = (s: string): string[] => wordsOf(s).filter((w) => w.length >= 3 && !FUNCTION_WORDS.has(w) && !/^\d/.test(w));
const MIN_EXCERPT_WORDS = 3;
const squash = (s: string): string => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** An excerpt of at least three words, or the whole message when it is shorter ("Done."). */
function excerptCarries(text: string, excerpt: string): boolean {
  const n = wordsOf(excerpt).length;
  return n >= MIN_EXCERPT_WORDS || n >= wordsOf(text).length;
}

/**
 * The cited excerpts support `statement`: every id and number in it appears in them, and at least half of its content
 * words (compared by their first four letters) do.
 */
export function excerptsSupport(statement: string, excerpts: string[]): boolean {
  const joined = excerpts.join(' \n ');
  const exIds = new Set(idsIn(joined));
  if (idsIn(statement).some((id) => !exIds.has(id))) return false;
  const exNums = new Set(numbersIn(joined));
  if (numbersIn(statement).some((n) => !exNums.has(n))) return false;
  const want = [...new Set(contentWords(statement).map((w) => w.slice(0, 4)))];
  if (!want.length) return true;
  const have = new Set(wordsOf(joined).map((w) => w.slice(0, 4)));
  return want.filter((w) => have.has(w)).length * 2 >= want.length;
}

/** Validate the model's raw output against the schema and the thread. Throws on a schema mismatch (the caller falls back). */
export function validateExtraction(raw: unknown, context: ConversationContext, route: RouteInfo): ValidatedExtraction {
  const out = extractionOutputSchema.parse(raw);
  const texts = new Map<string, string>(context.evidence.map((e) => [e.id, extractionText(e)]));
  const authorOf = new Map<string, ActorRef>(context.evidence.map((e) => [e.id, e.author]));
  const thread = squash([...texts.values()].join('\n'));
  const actors = new Map<string, ActorRef>();
  for (const e of context.evidence) for (const a of [e.author, ...(e.recipients ?? [])]) actors.set(a.id, a);
  const dropped: DroppedItem[] = [];
  /** Every ref must resolve; one bad ref drops the whole item. `short` lets a bare name stand as an entity's excerpt. */
  const refs = (list: Array<{ evidenceId: string; excerpt: string }>, short = false): EvidenceRef[] | DroppedItem['reason'] => {
    const outRefs: EvidenceRef[] = [];
    for (const r of list) {
      const text = texts.get(r.evidenceId);
      if (text === undefined) return 'unknown-evidence';
      const at = locateExcerpt(text, r.excerpt);
      if (!at) return 'excerpt-not-in-evidence';
      if (!short && !excerptCarries(text, at.excerpt)) return 'excerpt-does-not-support';
      outRefs.push({ evidenceId: r.evidenceId, span: { start: at.start, end: at.end }, excerpt: at.excerpt });
    }
    return outRefs;
  };
  const citedAuthors = (ev: EvidenceRef[]): string[] => [...new Set(ev.map((r) => authorOf.get(r.evidenceId)?.id).filter((x): x is string => !!x))];
  const claims: ProposedClaim[] = [];
  for (const c of out.claims) {
    const ev = refs(c.evidence);
    if (typeof ev === 'string') { dropped.push({ kind: 'claim', label: c.statement, reason: ev }); continue; }
    const excerpts = ev.map((r) => r.excerpt ?? '');
    const value = c.condition?.value;
    const conditionOk = typeof value === 'boolean' || value === undefined || excerptsSupport(String(value), excerpts);
    if (!excerptsSupport(c.statement, excerpts) || !conditionOk) { dropped.push({ kind: 'claim', label: c.statement, reason: 'excerpt-does-not-support' }); continue; }
    // Who asserted it is the author of a cited message: the model may pick among them, never anyone else in the thread.
    const authors = citedAuthors(ev);
    const asserted = c.assertedByActorId && authors.includes(c.assertedByActorId) ? c.assertedByActorId : authors[0];
    claims.push({
      type: c.type, statement: c.statement.trim(),
      // Subject names the thread never mentions are left out (the claim stays; it does not link to an invented thing).
      subjectEntityNames: [...new Set(c.subjectEntityNames.map((s) => s.trim()).filter((s) => s && thread.includes(squash(s))))],
      ...(asserted ? { assertedByActorId: asserted } : {}), evidence: ev,
      ...(c.condition ? { condition: { key: c.condition.key, operator: c.condition.operator, ...(c.condition.value !== undefined ? { value: c.condition.value } : {}), origin: 'reported' as const, evidence: ev, ...(c.condition.label ? { label: c.condition.label } : {}) } } : {}),
      ...(c.confidence !== undefined ? { confidence: c.confidence } : {}),
    });
  }
  const entities: ProposedEntity[] = [];
  for (const e of out.entities) {
    const ev = refs(e.evidence, true);
    if (typeof ev === 'string') { dropped.push({ kind: 'entity', label: e.name, reason: ev }); continue; }
    const cited = squash(ev.map((r) => r.excerpt ?? '').join('\n'));
    if (!cited.includes(squash(e.name))) { dropped.push({ kind: 'entity', label: e.name, reason: 'excerpt-does-not-support' }); continue; }
    entities.push({ type: e.type, name: e.name.trim(), aliases: [...new Set(e.aliases.map((a) => a.trim()).filter((a) => a && thread.includes(squash(a))))], evidence: ev });
  }
  const links: ProposedLink[] = [];
  for (const l of out.links) {
    const label = `${l.personActorId} ${l.contribution}`;
    const person = actors.get(l.personActorId);
    if (!person) { dropped.push({ kind: 'link', label, reason: 'unknown-person' }); continue; }
    const ev = refs(l.evidence);
    if (typeof ev === 'string') { dropped.push({ kind: 'link', label, reason: ev }); continue; }
    // A person is linked by what they wrote; 'mentioned' may instead name them in the cited excerpt.
    const wrote = citedAuthors(ev).includes(l.personActorId);
    const first = wordsOf(person.displayName)[0];
    const named = l.contribution === 'mentioned' && !!first && first.length >= 2 && ev.some((r) => wordsOf(r.excerpt ?? '').includes(first));
    if (!wrote && !named) { dropped.push({ kind: 'link', label, reason: 'person-not-author' }); continue; }
    links.push({ personActorId: l.personActorId, contribution: l.contribution, evidence: ev, firsthand: l.firsthand && wrote });
  }
  const ids = new Set(texts.keys());
  return {
    proposal: {
      route, claims, entities, links,
      incidents: out.incidents.map((i) => ({ ...i, evidenceIds: i.evidenceIds.filter((x) => ids.has(x)) })).filter((i) => i.evidenceIds.length > 0),
      usefulness: out.usefulness.filter((u) => ids.has(u.evidenceId)),
    },
    dropped,
  };
}

export interface LlmExtractorOptions {
  provider: Pick<ModelProvider, 'kind' | 'generateJson'>;
  model: string;
  /** Default {local, 'ollama-extract@1:<model>'} (or api-extract@1 for an api provider). */
  route?: RouteInfo;
  timeoutMs?: number;
  seed?: number;
}

export interface LlmExtractor extends Extractor {
  model: string;
  /** The proposal plus what the validator dropped. */
  extractValidated(context: ConversationContext): Promise<ValidatedExtraction>;
}

export function llmExtractRoute(kind: 'local' | 'api', model: string): RouteInfo {
  return kind === 'api' ? { route: 'api', version: `${API_EXTRACT_VERSION}:${model}` } : { route: 'local', version: `${LLM_EXTRACT_VERSION}:${model}` };
}

export function createLlmExtractor(opts: LlmExtractorOptions): LlmExtractor {
  const route = opts.route ?? llmExtractRoute(opts.provider.kind, opts.model);
  const schema = extractionJsonSchema();
  const extractValidated = async (context: ConversationContext): Promise<ValidatedExtraction> => {
    const raw = await opts.provider.generateJson(opts.model, buildExtractionPrompt(context), schema, {
      ...(opts.timeoutMs ? { timeoutMs: opts.timeoutMs } : {}), ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
    });
    return validateExtraction(raw, context, route);
  };
  return { route, model: opts.model, extractValidated, extract: async (c) => (await extractValidated(c)).proposal };
}

// ---- union with the rules proposal -------------------------------------------------------------

const norm = (s: string): string => s.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
const overlaps = (a?: { start: number; end: number }, b?: { start: number; end: number }): boolean => !!a && !!b && a.start < b.end && b.start < a.end;

/** A model claim restates a rules claim: same type, same first message, and the same words or overlapping passages. */
export function restatesRulesClaim(c: ProposedClaim, rules: ProposedClaim[]): boolean {
  const r0 = c.evidence[0];
  return rules.some((r) => r.type === c.type && (norm(r.statement) === norm(c.statement)
    || (r.evidence[0]?.evidenceId === r0?.evidenceId && overlaps(r.evidence[0]?.span, r0?.span))));
}

/**
 * The model proposal re-keyed to the rules incidents, ready to commit after the rules proposal:
 * incidents are the rules ones (so episode keys and case ids match and no second case appears); claims that restate a
 * rules claim are left out (the rules claim keeps its label); the rules observations of non-asset incidents ride along
 * unchanged so those incidents still count as problems (they exist already and keep their 'rules' label); usefulness
 * labels stay the rules ones; links already proposed by the rules are not repeated.
 */
export function unionProposal(rules: ExtractionProposal, model: ExtractionProposal): ExtractionProposal {
  const modelOnly = model.claims.filter((c) => !restatesRulesClaim(c, rules.claims));
  const nonAsset = rules.incidents.filter((i) => !i.key.startsWith('asset:'));
  const anchors = rules.claims.filter((c) => c.type === 'observation' && nonAsset.some((i) => i.evidenceIds.includes(c.evidence[0]?.evidenceId ?? '')));
  const linkKey = (l: ProposedLink) => `${l.personActorId}|${l.contribution}|${l.evidence[0]?.evidenceId}`;
  const ruleLinks = new Set(rules.links.map(linkKey));
  return {
    route: model.route,
    entities: model.entities,
    claims: [...anchors, ...modelOnly],
    links: model.links.filter((l) => !ruleLinks.has(linkKey(l))),
    incidents: rules.incidents,
    usefulness: [],
  };
}

