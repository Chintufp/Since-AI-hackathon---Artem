import type {
  ActionName, ClaimType, Condition, ConversationContext, EvidenceEnvelope, EvidenceRef, ExtractionProposal, Extractor,
  OutcomeResult, ProposedClaim, ProposedEntity, ProposedLink, RouteInfo,
} from '../contracts/index.ts';
import { extractionText } from '../context/index.ts';
import { defaultExtractionConfig, type ExtractionConfig } from './extraction-config.ts';

export const RULES_ROUTE: RouteInfo = { route: 'rules', version: 'rules-extractor@1' };

/** Extra, optional detail the rules extractor attaches; other extractors may omit it (commit re-derives). */
export interface ActionDetail { name: ActionName; negated: boolean; advised: boolean; resolvedFrom?: string }
export interface OutcomeDetail { result: OutcomeResult; recurred: boolean }
export interface RulesClaim extends ProposedClaim {
  action?: ActionDetail[];
  outcome?: OutcomeDetail;
  /** Evidence order index inside the context, used to relate claims in sequence. */
  order?: number;
}

interface Sentence { text: string; start: number; end: number }

export function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  let start = 0;
  const flush = (end: number) => {
    let s = start;
    let e = end;
    while (s < e && /[\s\-*\u2022.\u2026]/.test(text[s]!)) s++;
    while (e > s && /\s/.test(text[e - 1]!)) e--;
    if (e > s) out.push({ text: text.slice(s, e), start: s, end: e });
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '\n') { flush(i); start = i + 1; continue; }
    if (ch === '.' || ch === '!' || ch === '?') {
      let j = i;
      while (j + 1 < text.length && /[.!?]/.test(text[j + 1]!)) j++;
      const next = text[j + 1];
      if (next === undefined || /\s/.test(next)) { flush(j + 1); start = j + 1; }
      i = j;
    }
  }
  flush(text.length);
  return out;
}

const norm = (s: string): string => s.toLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
const excerpt = (s: string): string => (s.length > 220 ? s.slice(0, 217) + '...' : s);
const anyMatch = (res: RegExp[], s: string): boolean => res.some((r) => new RegExp(r.source, r.flags.replace('g', '')).test(s));

export function findAssets(text: string, cfg: ExtractionConfig): Array<{ name: string; index: number }> {
  const found: Array<{ name: string; index: number }> = [];
  for (const p of cfg.assetIdPatterns) {
    const re = new RegExp(p.source, p.flags.includes('g') ? p.flags : p.flags + 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) found.push({ name: canonicalName(m[0], cfg), index: m.index });
  }
  for (const [canon, aliases] of Object.entries(cfg.aliases)) {
    for (const a of aliases) {
      const i = text.toLowerCase().indexOf(a.toLowerCase());
      if (i >= 0) found.push({ name: canon, index: i });
    }
  }
  return found.sort((a, b) => a.index - b.index);
}

function canonicalName(name: string, cfg: ExtractionConfig): string {
  for (const [canon, aliases] of Object.entries(cfg.aliases)) if (norm(canon) === norm(name) || aliases.some((a) => norm(a) === norm(name))) return canon;
  return name;
}

/** Action names mentioned in `text`, in order of appearance. */
export function lexiconActions(text: string, cfg: ExtractionConfig): Array<{ name: ActionName; index: number }> {
  const hits: Array<{ name: ActionName; index: number }> = [];
  for (const e of cfg.actionLexicon) {
    const m = new RegExp(e.pattern.source, e.pattern.flags.replace('g', '')).exec(text);
    if (m) hits.push({ name: e.action, index: m.index });
  }
  // A more specific action swallows a generic one that matches inside the same words (e.g. power.cycle vs device.reboot).
  const names = new Set(hits.map((h) => h.name));
  return hits.filter((h) => !(h.name === 'device.reboot' && names.has('power.cycle'))).sort((a, b) => a.index - b.index);
}

const CUT = /\b(?:before|unless|until|instead of|rather than)\b/i;

function adviceBody(sentence: string, cfg: ExtractionConfig): { body: string; negated: boolean } | undefined {
  const firstClause = (s: string) => s.replace(CUT.exec(s) ? new RegExp(`${CUT.source}.*$`, 'i') : /$^/, '').trim();
  const start = cfg.imperative.exec(sentence.trim());
  if (start) {
    const negated = /^(?:(?:please|first|then|also|just)\s+)*(?:don'?t|do not|never|avoid)\b/i.test(sentence.trim());
    return { body: firstClause(sentence.trim()), negated };
  }
  const re = new RegExp(`[,:;]\\s*((?:${cfg.imperative.source.replace(/^\^/, '')}).*)$`, 'i');
  const m = re.exec(sentence);
  if (m) return { body: firstClause(m[1]!), negated: /^(?:don'?t|do not|never|avoid)\b/i.test(m[1]!) };
  return undefined;
}

function outcomeOf(sentence: string, cfg: ExtractionConfig): OutcomeDetail | undefined {
  const t = sentence;
  if (cfg.outcomeRecurred.test(t)) return { result: 'no-change', recurred: true };
  if (cfg.outcomeNoChange.test(t)) return { result: 'no-change', recurred: false };
  if (cfg.outcomeWorse.test(t)) return { result: 'worse', recurred: false };
  if (cfg.outcomeRecovered.test(t) && !/\b(?:not|n't|never|no longer)\b[^.]{0,15}\b(?:back|working|resolved|fixed|recovered)/i.test(t)) return { result: 'recovered', recurred: false };
  return undefined;
}

/** Derive an outcome reading from a statement when a claim carries no structured detail (other extractors). */
export const inferOutcome = (statement: string, cfg: ExtractionConfig = defaultExtractionConfig): OutcomeDetail | undefined => outcomeOf(statement, cfg);
export function inferActions(statement: string, cfg: ExtractionConfig = defaultExtractionConfig): ActionDetail[] {
  const adv = adviceBody(statement, cfg);
  const text = adv?.body ?? statement;
  return lexiconActions(text, cfg).map((a) => ({ name: a.name, negated: !!adv?.negated, advised: !!adv }));
}

interface Msg {
  e: EvidenceEnvelope;
  text: string;
  sentences: Sentence[];
  asset?: string;
}

/** True for advice that tells someone not to do something ("Don't reboot"). */
export const isNegatedAdvice = (statement: string): boolean => /^(?:(?:please|first|then|also|just)\s+)*(?:don'?t|do not|never|avoid)\b/i.test(statement.trim());

export function extractFromContext(context: ConversationContext, cfg: ExtractionConfig = defaultExtractionConfig): ExtractionProposal {
  const aliases = { ...cfg.aliases, ...(context.aliases ?? {}) };
  const config: ExtractionConfig = { ...cfg, aliases };
  const msgs: Msg[] = context.evidence.map((e) => {
    const text = extractionText(e);
    const subject = e.thread.subject ?? '';
    const asset = findAssets(`${subject}\n${text}`, config)[0]?.name;
    return { e, text, sentences: splitSentences(text), asset };
  });

  // ---- pass 1: incident boundaries --------------------------------------------------------
  interface Inc { key: string; asset?: string; evidenceIds: string[]; msgIdx: number[]; hasOutcome: boolean; lastPos: number; title?: string }
  const incidents: Inc[] = [];
  const firstAsset = msgs.find((m) => m.asset)?.asset;
  const ordinal = new Map<string, number>();
  const newInc = (asset: string | undefined, ctxKey: string): Inc => {
    const base = asset ? `asset:${norm(asset)}` : `thread:${ctxKey}`;
    const n = (ordinal.get(base) ?? 0) + 1;
    ordinal.set(base, n);
    return { key: n === 1 ? base : `${base}#${n}`, asset, evidenceIds: [], msgIdx: [], hasOutcome: false, lastPos: 0 };
  };
  const ctxKey = context.evidence[0]?.thread.threadId ?? context.evidence[0]?.id ?? 'ctx';
  let cur: Inc | undefined;
  msgs.forEach((m, idx) => {
    const hasProblem = config.problem.test(m.text) || config.newProblem.test(m.text);
    const pos = m.e.thread.position ?? idx;
    if (!cur) cur = newInc(m.asset ?? firstAsset, ctxKey);
    else if (m.asset && cur.asset && m.asset !== cur.asset && hasProblem) cur = newInc(m.asset, ctxKey);
    else if (cur.hasOutcome && (config.newProblem.test(m.text) || (hasProblem && pos - cur.lastPos > config.maxSequenceGap))) cur = newInc(m.asset ?? cur.asset, ctxKey);
    if (!cur.asset && m.asset) { cur.asset = m.asset; }
    cur.evidenceIds.push(m.e.id);
    cur.msgIdx.push(idx);
    cur.lastPos = pos;
    if (m.sentences.some((s) => !/\?\s*$/.test(s.text) && outcomeOf(s.text, config)?.result === 'recovered')) cur.hasOutcome = true;
    if (!incidents.includes(cur)) incidents.push(cur);
  });
  // An incident that began before its asset was named takes the asset's key.
  for (const inc of incidents) if (inc.asset && inc.key.startsWith('thread:')) inc.key = `asset:${norm(inc.asset)}`;

  // ---- pass 2: classification ------------------------------------------------------------
  const claims: RulesClaim[] = [];
  const links: ProposedLink[] = [];
  const usefulClaimsByEvidence = new Map<string, Set<ClaimType>>();
  const mark = (id: string, t: ClaimType) => (usefulClaimsByEvidence.get(id) ?? usefulClaimsByEvidence.set(id, new Set()).get(id)!).add(t);
  const ref = (m: Msg, s: Sentence): EvidenceRef => ({ evidenceId: m.e.id, span: { start: s.start, end: s.end }, excerpt: excerpt(s.text) });
  const addLink = (m: Msg, contribution: ProposedLink['contribution'], r: EvidenceRef[], firsthand = true) => {
    const dup = links.find((l) => l.personActorId === m.e.author.id && l.contribution === contribution && l.evidence[0]?.evidenceId === r[0]?.evidenceId);
    if (!dup) links.push({ personActorId: m.e.author.id, contribution, evidence: r, firsthand });
  };

  for (const inc of incidents) {
    let lastAdvice: { claim: RulesClaim; authorId: string; actions: ActionDetail[]; text: string } | undefined;
    let pendingQuestion: { authorId: string; ref: EvidenceRef; parses: Array<{ key: string; res: ReturnType<typeof parseCond> }> } | undefined;
    let lastCheckAdvice: { authorId: string; msgIdx: number } | undefined;
    inc.msgIdx.forEach((mi, localIdx) => {
      const m = msgs[mi]!;
      const author = m.e.author;
      const isFirst = localIdx === 0;
      const subjects = (s: string) => {
        const names = [...new Set([...(inc.asset ? [inc.asset] : []), ...findAssets(s, config).map((a) => a.name)])];
        return names;
      };
      let answeredFirst = false;
      let genericMode = false; // bullets after "... can look normal:" describe a general pattern, not this incident
      m.sentences.forEach((s, si) => {
        const t = s.text;
        const lineStart = m.text.lastIndexOf('\n', s.start - 1) + 1;
        const isBullet = /^\s*(?:[-*•]|\.{3}|\u2026)/.test(m.text.slice(lineStart, s.start + 1));
        const generic = genericMode && isBullet;
        if (!generic) genericMode = false;
        const r = ref(m, s);
        const isQuestion = /\?\s*$/.test(t);
        const push = (claim: Omit<RulesClaim, 'evidence' | 'subjectEntityNames' | 'assertedByActorId'> & { evidence?: EvidenceRef[] }) => {
          claims.push({ subjectEntityNames: subjects(t), assertedByActorId: author.id, evidence: [r], order: mi, ...claim });
          mark(m.e.id, claim.type);
        };
        // Yes/no answer to a pending condition question.
        if (si === 0 && pendingQuestion && pendingQuestion.authorId !== author.id && /^(?:yes|yeah|yep|correct|right|indeed|that'?s right)\b/i.test(t)) {
          answeredFirst = true;
          for (const p of pendingQuestion.parses) {
            if (!p.res) continue;
            const cond: Condition = { key: p.key, operator: p.res.operator, value: p.res.value, origin: 'reported', evidence: [r], label: p.res.label };
            push({
              type: 'condition', statement: `${p.res.label}: answered "${t.replace(/[.!]+$/, '')}" to "${pendingQuestion.ref.excerpt}"`,
              evidence: [r], condition: cond,
            });
            addLink(m, 'observed-condition', [r]);
          }
          pendingQuestion = undefined;
          if (/^(?:yes|yeah|yep)[.!,]?$/i.test(t.trim())) return;
        }
        if (isQuestion && !generic) {
          const parses = condParses(t, config);
          if (parses.length) pendingQuestion = { authorId: author.id, ref: r, parses };
          return;
        }
        const wc = (t.match(/[\p{L}\p{N}']+/gu) ?? []).length;
        if (!t.trim() || /^[\p{Extended_Pictographic}\s]+$/u.test(t)) return;

        // 1. access facts (non-incident operational knowledge)
        if (anyMatch(config.cues['access-fact'], t)) {
          const acc = /\b(barrier|gate|lockbox|key|code|contact|locked)\b/i.exec(t)?.[1]?.toLowerCase();
          const value = acc === 'lockbox' || acc === 'locked' ? 'barrier' : acc === 'gate' ? 'barrier' : acc ?? 'contact';
          const cond: Condition = { key: 'site.access', operator: 'eq', value, origin: 'reported', evidence: [r], label: `Site access: ${value}` };
          push({ type: 'access-fact', statement: t, condition: cond });
          addLink(m, 'observed-condition', [r]);
          return;
        }
        const adv = adviceBody(t, config);
        // "I think" on a first-person factual report ("installed around 2019 I think") is a hedge, not a hypothesis.
        const hypText = t.replace(/\bi think\b/i, '');
        const hasConds = condParses(t, config).length > 0;
        const hyp = anyMatch(config.cues.hypothesis, hypText) || (/\bi think\b/i.test(t) && !hasConds) || generic;
        const startsImperative = config.imperative.test(t.trim());
        // 2. advice (imperative first)
        if (adv && (startsImperative || !hyp)) {
          const actions = lexiconActions(adv.body, config).map((a) => ({ name: a.name, negated: adv.negated, advised: true }));
          const claim: RulesClaim = { subjectEntityNames: subjects(t), assertedByActorId: author.id, evidence: [r], type: 'advice', statement: t, action: actions, order: mi };
          claims.push(claim);
          mark(m.e.id, 'advice');
          addLink(m, 'advised', [r]);
          if (actions.some((a) => !a.negated)) lastAdvice = { claim, authorId: author.id, actions: actions.filter((a) => !a.negated), text: t };
          if (actions.some((a) => a.name.endsWith('.check') && !a.negated)) lastCheckAdvice = { authorId: author.id, msgIdx: localIdx };
          return;
        }
        // 3. hypothesis (uncertainty kept verbatim in the statement)
        if (config.documentation.test(t) && !adv) {
          push({ type: 'other', statement: t });
          return;
        }
        if (hyp && generic) {
          push({ type: 'other', statement: t });
          if (/:\s*$/.test(t)) genericMode = true;
          return;
        }
        if (hyp && wc < 3) return;
        if (hyp) {
          push({ type: 'hypothesis', statement: t });
          if (/:\s*$/.test(t)) genericMode = true;
          return;
        }
        const advWords = anyMatch(config.cues.advice, t);
        if (advWords) {
          push({ type: 'advice', statement: t, action: lexiconActions(t, config).map((a) => ({ name: a.name, negated: false, advised: true })) });
          addLink(m, 'advised', [r]);
          return;
        }
        // 4. general experience, not this incident
        if (anyMatch(config.generic, t)) {
          push({ type: 'other', statement: t });
          return;
        }
        let consumed = false;
        let byAction = false;
        // 5. performed action
        if (config.performed.test(t)) {
          let actions: ActionDetail[] = lexiconActions(t, config).map((a) => ({ name: a.name, negated: false, advised: false }));
          let statement = t;
          if (!actions.length && /\b(?:did (?:that|it)|done)\b/i.test(t) && lastAdvice && lastAdvice.authorId !== author.id) {
            actions = lastAdvice.actions.map((a) => ({ name: a.name, negated: false, advised: false, resolvedFrom: lastAdvice!.claim.evidence[0]!.evidenceId }));
            statement = `${t} [refers to advice: "${excerpt(lastAdvice.text)}"]`;
          }
          if (actions.length) {
            for (const act of actions) {
              claims.push({
                subjectEntityNames: subjects(t), assertedByActorId: author.id, evidence: [r], // the advice it refers to is context (in the statement), not a second source
                type: 'action', statement, action: [act], order: mi,
                condition: { key: 'action.performed', operator: 'eq', value: act.name, origin: 'reported', evidence: [r], label: `Performed: ${act.name.replace(/\./g, ' ')}` },
              });
            }
            mark(m.e.id, 'action');
            addLink(m, 'performed-action', [r]);
            consumed = true;
            byAction = true;
          }
        }
        // 6. outcome (a first message states the problem, so outcome words there describe the problem)
        const oc = outcomeOf(t, config);
        let problemStatement = false;
        if (oc && !consumed) {
          if (isFirst) problemStatement = true;
          else {
            push({ type: 'outcome', statement: t, outcome: oc });
            addLink(m, 'reported-outcome', [r]);
            consumed = true;
            byAction = true;
          }
        }
        // 7. conditions (never from hypothetical/advice sentences, which returned above)
        const parses = condParses(t, config);
        for (const p of parses) {
          if (!p.res) continue;
          // Hedging is not in the label; it stays in the verbatim statement (the case view flags it). Origin stays 'reported'
          // because downstream matching treats an 'inferred' origin as not settling a distinguishing condition.
          const cond: Condition = { key: p.key, operator: p.res.operator, value: p.res.value, origin: 'reported', evidence: [r], label: p.res.label };
          push({ type: 'condition', statement: t, condition: cond });
          addLink(m, 'observed-condition', [r]);
          if (lastCheckAdvice && lastCheckAdvice.authorId !== author.id && localIdx - lastCheckAdvice.msgIdx <= 2) addLink(m, 'performed-check', [r]);
          consumed = true;
        }
        // 8. problem statement
        if (!byAction || problemStatement) {
          if (problemStatement || (config.problem.test(t) && wc >= 3)) {
            push({ type: 'observation', statement: t });
            addLink(m, 'reported-problem', [r]);
            if (!inc.title) inc.title = t;
          }
        } else if (isFirst && config.problem.test(t) && !inc.title) {
          inc.title = t;
        }
        void answeredFirst;
      });
    });
  }

  // ---- entities, identity, mentions -------------------------------------------------------
  const entities = new Map<string, ProposedEntity>();
  const addEntity = (type: ProposedEntity['type'], name: string, r: EvidenceRef, extra?: Partial<ProposedEntity>) => {
    const k = `${type === 'person' ? 'person' : 'thing'}:${norm(name)}`;
    const ex = entities.get(k);
    if (ex) { if (ex.evidence.length < 5) ex.evidence.push(r); return ex; }
    const e: ProposedEntity = { type, name, aliases: [...(config.aliases[name] ?? [])], evidence: [r], ...extra };
    entities.set(k, e);
    return e;
  };
  const accessSubjects = new Set(claims.filter((c) => c.type === 'access-fact').flatMap((c) => c.subjectEntityNames));
  for (const m of msgs) {
    const subject = m.e.thread.subject ?? '';
    for (const a of findAssets(`${subject}\n${m.text}`, config)) {
      const inBody = a.index >= subject.length + 1;
      const idx = inBody ? a.index - subject.length - 1 : -1;
      const r: EvidenceRef = inBody
        ? { evidenceId: m.e.id, span: { start: idx, end: idx + a.name.length }, excerpt: excerpt(m.text.slice(Math.max(0, idx - 20), idx + a.name.length + 20).trim()) }
        : { evidenceId: m.e.id, excerpt: excerpt(subject) };
      const inIncident = claims.some((c) => c.type !== 'access-fact' && c.type !== 'identity' && c.subjectEntityNames.includes(a.name));
      addEntity(accessSubjects.has(a.name) && !inIncident ? 'site' : 'asset', a.name, r);
    }
    const actor = m.e.author;
    if (actor.id !== 'person:email:unknown' && actor.id !== 'person:paste:unknown') {
      const p = addEntity('person', actor.displayName, { evidenceId: m.e.id, excerpt: excerpt(m.text.split('\n')[0] ?? '') });
      if (actor.role) p.attributes = { ...(p.attributes ?? {}), role: { value: actor.role, evidence: [{ evidenceId: m.e.id }] } };
    }
    for (const rcp of m.e.recipients ?? []) addEntity('person', rcp.displayName, { evidenceId: m.e.id, excerpt: `recipient: ${rcp.displayName}` });
  }
  // identity claims from declared roles (one per person, evidence = their first message)
  const seenRole = new Set<string>();
  for (const m of msgs) {
    const a = m.e.author;
    if (!a.role || a.role === 'bot' || seenRole.has(a.id)) continue;
    seenRole.add(a.id);
    const r: EvidenceRef = { evidenceId: m.e.id, excerpt: `${a.displayName}: ${excerpt(m.text.split('\n')[0] ?? '')}` };
    claims.push({ type: 'identity', statement: `${a.displayName} is a ${a.role}`, subjectEntityNames: [a.displayName], assertedByActorId: a.id, evidence: [r], order: 0 });
    mark(m.e.id, 'identity');
  }
  // people named in access/advice text but not authors: 'mentioned'
  const authorNames = new Map(msgs.map((m) => [norm(m.e.author.displayName), m.e.author]));
  const contributors = new Set(links.map((l) => l.personActorId));
  for (const m of msgs) {
    for (const [nm, actor] of authorNames) {
      if (actor.id === m.e.author.id || contributors.has(actor.id)) continue;
      const first = nm.split(' ')[0]!;
      const i = norm(m.text).indexOf(first);
      if (first.length >= 3 && i >= 0) links.push({ personActorId: actor.id, contribution: 'mentioned', evidence: [{ evidenceId: m.e.id, excerpt: excerpt(m.text.slice(0, 120)) }], firsthand: false });
    }
    for (const s of m.sentences) {
      const mm = /\b(?i:contact|call|ask)\s+([A-ZÄÖÅ][\p{L}'-]+(?:\s+[A-ZÄÖÅ][\p{L}'-]+)?)/u.exec(s.text);
      if (mm && anyMatch(config.cues['access-fact'], s.text) && !authorNames.has(norm(mm[1]!))) {
        const r: EvidenceRef = { evidenceId: m.e.id, span: { start: s.start, end: s.end }, excerpt: excerpt(s.text) };
        addEntity('person', mm[1]!, r);
        links.push({ personActorId: `person:mention:${norm(mm[1]!)}`, contribution: 'mentioned', evidence: [r], firsthand: false });
      }
    }
  }

  // ---- usefulness labels ------------------------------------------------------------------
  const usefulness: ExtractionProposal['usefulness'] = context.evidence.map((e) => {
    const types = usefulClaimsByEvidence.get(e.id);
    const referenced = claims.some((c) => c.evidence.some((x) => x.evidenceId === e.id) && c.type !== 'identity');
    const substantive = types && [...types].some((t) => t !== 'identity' && t !== 'other');
    if (substantive || referenced) return { evidenceId: e.id, label: 'useful' as const, reason: `yielded ${[...(types ?? [])].filter((t) => t !== 'identity').join(', ') || 'referenced claim'}` };
    if (types?.has('other')) return { evidenceId: e.id, label: 'uncertain' as const, reason: 'general experience or documentation remark, not tied to this incident' };
    const text = extractionText(e).trim();
    if (!text || /^[\p{Extended_Pictographic}\s.!]+$/u.test(text)) return { evidenceId: e.id, label: 'irrelevant' as const, reason: 'empty or emoji-only' };
    if (config.smallTalk.test(text) || (text.match(/[\p{L}\p{N}']+/gu) ?? []).length <= 8) return { evidenceId: e.id, label: 'irrelevant' as const, reason: 'small talk, greeting or acknowledgement; no extractable knowledge' };
    return { evidenceId: e.id, label: 'uncertain' as const, reason: 'no rule matched; may still hold context' };
  });

  return {
    route: RULES_ROUTE,
    entities: [...entities.values()],
    claims,
    links,
    incidents: incidents.map((inc) => ({
      key: inc.key,
      evidenceIds: inc.evidenceIds,
      title: inc.title ? `${inc.asset ? inc.asset + ': ' : ''}${inc.title.replace(/^(?:hi|hello|hey)\b[^,]{0,30},\s*/i, '').replace(/^(?:but|and|so)\s+/i, '')}`.slice(0, 140) : inc.asset ? `Incident on ${inc.asset}` : `Incident in ${msgs[inc.msgIdx[0]!]?.e.thread.subject ?? 'conversation'}`,
    })),
    usefulness,
  };
}

function condParses(t: string, cfg: ExtractionConfig) {
  return cfg.conditionParsers
    .map((p) => {
      const m = new RegExp(p.pattern.source, p.pattern.flags.replace('g', '')).exec(t);
      return m ? { key: p.key as string, res: parseCond(p, m) } : undefined;
    })
    .filter((x): x is { key: string; res: ReturnType<typeof parseCond> } => !!x && !!x.res);
}
function parseCond(p: ExtractionConfig['conditionParsers'][number], m: RegExpExecArray) {
  return p.build(m);
}

export function createRulesExtractor(config: ExtractionConfig = defaultExtractionConfig): Extractor & { extractSync(c: ConversationContext): ExtractionProposal } {
  return {
    route: RULES_ROUTE,
    extractSync: (c) => extractFromContext(c, config),
    extract: async (c) => extractFromContext(c, config),
  };
}
