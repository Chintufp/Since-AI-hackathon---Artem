/**
 * Film proof (8 Nov): GET /pipeline shows one Slack channel flowing through the real pipeline, read from the store:
 * RAW (every message) -> USEFUL (what the extractor kept; dropped ones struck through) -> CASE (claims grouped into the
 * case, by type) -> HYPOTHESIS (the stated cause, its supporting passages, what is still open). GET /pipeline.json is
 * the data; the page polls it. Black on white, no colour, no animation (Artem 8 Nov: the processing is the backend's,
 * the page only re-renders when the data changes), nothing hardcoded: every word comes from the store.
 * GET /pipeline/questions (+ .json) shows one question's algorithm the same way, from the stored investigation,
 * decision, eligibility, question, answer and claims. A value the service does not expose is shown as its reason text.
 */
import type { Claim, ClaimType, EmbeddingKind, KnowledgeStore, RecipientEligibility } from '../../libs/utils/contracts/index.ts';
import { parseGapId } from '../../libs/utils/investigation/index.ts';

const STAGE: Partial<Record<ClaimType, string>> = { observation: 'symptom', condition: 'condition', action: 'action', outcome: 'outcome', advice: 'action' };

export interface PipelineData {
  connection?: string;
  connections: string[];
  channel?: string;
  raw: Array<{ id: string; author: string; time: string; text: string; useful: boolean; reason: string; kept: Array<{ type: string; excerpt: string }> }>;
  cases: Array<{
    caseId: string; title: string; status: string;
    /** The confirm gap's measure: distinct messages behind the case's live claims (the same count standing-gaps uses). */
    certainty: { messages: number; threshold?: number; hasHypothesis: boolean; asked: boolean };
    items: Array<{ stage: string; text: string; author: string; evidenceId: string }>;
    hypotheses: Array<{ statement: string; author: string; evidenceId: string; supporting: Array<{ stage: string; text: string; author: string }> }>;
    open: string[];
  }>;
  stored?: Record<string, unknown>;
}

const excerptOf = (c: Claim, evidenceId: string, text: string): string => {
  const ref = c.supporting.find((r) => r.evidenceId === evidenceId);
  if (ref?.span) return text.slice(ref.span.start, ref.span.end);
  return ref?.excerpt ?? c.statement;
};

export function pipelineData(store: KnowledgeStore, opts: { connection?: string; embedModels?: string[]; threshold?: number } = {}): PipelineData {
  const evidence = store.list('evidence').filter((e) => e.connectionId?.startsWith('slack'));
  const connections = [...new Set(evidence.map((e) => e.connectionId))];
  // Default: the most recently imported live Slack connection, else any Slack connection.
  const live = evidence.filter((e) => e.connectionId.startsWith('slack-live:'));
  const connection = opts.connection ?? (live.at(-1) ?? evidence.at(-1))?.connectionId;
  if (!connection) return { connections, raw: [], cases: [] };
  const mine = evidence.filter((e) => e.connectionId === connection)
    .sort((a, b) => (a.eventTime?.sequence ?? 0) - (b.eventTime?.sequence ?? 0));
  const byId = new Map(mine.map((e) => [e.id, e]));
  const claims = store.list('claim').filter((c) => c.supporting.some((r) => byId.has(r.evidenceId)) && c.status !== 'retracted');
  const author = (id: string): string => byId.get(id)?.author.displayName ?? '';

  const raw = mine.map((e) => {
    const u = (e.metadata?.usefulness ?? {}) as { label?: string; reason?: string };
    const own = claims.filter((c) => c.supporting.some((r) => r.evidenceId === e.id));
    const kept = [...new Map(own.map((c) => [excerptOf(c, e.id, e.text), c.type])).entries()].map(([excerpt, type]) => ({ type, excerpt }));
    return {
      id: e.id, author: e.author.displayName ?? e.author.id, time: e.eventTime?.iso ?? '', text: e.text,
      useful: own.length > 0, reason: u.reason ?? (own.length ? 'yielded a claim' : 'no extractable knowledge'), kept,
    };
  });

  const caseIds = [...new Set(claims.map((c) => c.caseId).filter((x): x is string => !!x))];
  const cases = caseIds.map((caseId) => {
    const k = store.get('case', caseId);
    const own = claims.filter((c) => c.caseId === caseId);
    // One row per passage, in conversation order; a passage that yields two claim types reads "symptom · condition".
    const byText = new Map<string, PipelineData['cases'][number]['items'][number]>();
    const order = ['symptom', 'outcome', 'action', 'condition'];
    for (const c of own) {
      const stage = STAGE[c.type];
      if (!stage) continue;
      for (const r of c.supporting) {
        const e = byId.get(r.evidenceId);
        if (!e) continue;
        const text = excerptOf(c, e.id, e.text);
        const prev = byText.get(text);
        if (!prev) { byText.set(text, { stage, text, author: author(e.id), evidenceId: e.id }); continue; }
        const stages = new Set([...prev.stage.split(' · '), stage]);
        prev.stage = order.filter((x) => stages.has(x)).join(' · ');
      }
    }
    const seq = (id: string): number => byId.get(id)?.eventTime?.sequence ?? 0;
    const items = [...byText.values()].sort((a, b) => seq(a.evidenceId) - seq(b.evidenceId));
    const hypotheses = own.filter((c) => c.type === 'hypothesis').map((h) => {
      const ev = h.supporting.find((r) => byId.has(r.evidenceId))!.evidenceId;
      return { statement: h.statement, author: author(ev), evidenceId: ev, supporting: items.map((i) => ({ stage: i.stage, text: i.text, author: i.author })) };
    });
    const live = store.list('claim', { where: { caseId } }).filter((x) => x.status === 'provisional' || x.status === 'supported');
    const certainty = {
      messages: new Set(live.flatMap((x) => x.supporting.map((r) => r.evidenceId))).size,
      ...(opts.threshold ? { threshold: opts.threshold } : {}),
      hasHypothesis: live.some((x) => x.type === 'hypothesis'),
      asked: store.list('question').some((qq) => qq.candidate.gapId.includes('|confirm|') && qq.candidate.scope.caseId === caseId),
    };
    return {
      caseId, title: k?.title ?? caseId, status: k?.status ?? '', certainty,
      items, hypotheses, open: (k?.gaps ?? []).filter((g) => g.status === 'open').map((g) => g.description),
    };
  }).sort((a, b) => b.items.length + b.hypotheses.length - (a.items.length + a.hypotheses.length));

  // The stored record of the main case: exactly what the store holds, vectors cut to their first six numbers.
  let stored: Record<string, unknown> | undefined;
  const main = cases[0] && store.get('case', cases[0].caseId);
  if (main) {
    const caseClaims = store.list('claim').filter((c) => c.caseId === main.id);
    const embeddings: Array<Record<string, unknown>> = [];
    const refs: Array<[EmbeddingKind, string]> = [['case', main.id], ...caseClaims.map((c) => ['claim', c.id] as [EmbeddingKind, string]), ...mine.map((e) => ['evidence', e.id] as [EmbeddingKind, string])];
    for (const model of new Set(opts.embedModels ?? [])) {
      for (const [kind, refId] of refs) {
        const row = store.embeddings?.get(kind, refId, model);
        if (row) embeddings.push({ kind, refId, model, dims: row.dims, vector: [...row.vector.slice(0, 6)].map((x) => Number(x.toFixed(4))), truncated: `${row.dims - 6} more` });
      }
    }
    stored = {
      case: main,
      claims: caseClaims,
      attempts: main.attemptIds.map((id) => store.get('attempt', id)).filter(Boolean),
      outcomes: main.outcomeIds.map((id) => store.get('outcome', id)).filter(Boolean),
      links: store.list('personLink').filter((l) => l.caseId === main.id),
      evidenceIds: [...new Set([...main.evidenceIds, ...caseClaims.flatMap((c) => c.supporting.map((r) => r.evidenceId))])],
      embeddings: embeddings.length ? embeddings : `none stored (embed slot not local; models checked: ${[...new Set(opts.embedModels ?? [])].join(', ') || 'none'})`,
    };
  }
  return { connection, connections, channel: (mine[0]?.thread as { channel?: string } | undefined)?.channel, raw, cases, ...(stored ? { stored } : {}) };
}


const nameOf = (store: KnowledgeStore, id: string): string => store.get('entity', id)?.name ?? id.replace(/^person:directory:/, '');

export interface QuestionStagesData {
  questionId?: string;
  inputs: { problem?: { by: string; text: string; simulated?: boolean }; more?: number; slack: Array<{ author: string; text: string }>; other: Array<{ provider: string; author: string; text: string }>; answers: Array<{ by: string; value: string; question: string }> };
  open?: { text: string; condition?: string; gates?: string; support?: string; applicability?: string };
  otherGaps: Array<{ text: string; why: string }>;
  questions: Array<{ text: string; chosen: boolean; note?: string }>;
  who: Array<{ name: string; chosen: boolean; eligible: boolean; reasons: string[]; violations: string[]; score?: string }>;
  features?: Record<string, number>;
  selector?: string;
  answer?: { by: string; value: string; at: string; evidenceId: string; simulated?: boolean };
  evidence: Array<{ statement: string; type: string; change: string; note: string; sources: number; contradicting: number; status: string }>;
  /** Film run: the Slack case's chain as it forms, and every question in order. `simulated` marks the driver's answers. */
  chain?: { title: string; stages: Array<{ stage: string; rows: Array<{ text: string; who: string; via: string; simulated?: boolean }> }> };
  log: Array<{ at: string; text: string; to: string; why: string; status: string; answer?: string; simulated: boolean; changed: string; asker: string; askerSimulated: boolean }>;
  result?: { status: string; reward?: { before: number; after: number; delta: number; method: string }; recommendation?: { kind: string; applicability: string; text: string; nextStep?: string }; loop?: string };
}

export function questionStagesData(store: KnowledgeStore, opts: { questionId?: string } = {}): QuestionStagesData {
  const SIM = (s?: string): boolean => s === 'simulated' || !!s?.endsWith('(simulated)');
  const log = [...store.list('question')].sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((x) => {
    const a = x.answerId ? store.get('answer', x.answerId) : undefined;
    const st = store.get('investigation', x.candidate.investigationId);
    const dec = store.get('decision', x.decisionId);
    const el = store.list('eligibility').find((r) => r.questionId === x.candidate.id && r.personEntityId === x.personEntityId);
    const score = /score ([0-9.]+)/.exec(dec?.reason ?? '')?.[1];
    return {
      at: x.createdAt, text: x.candidate.text, to: nameOf(store, x.personEntityId), why: [score ? `score ${score}` : '', el?.reasons[0] ?? ''].filter(Boolean).join(' · '),
      status: x.status, ...(a ? { answer: a.value } : {}), simulated: SIM(a?.text), changed: (a?.claimUpdates ?? []).map((u) => u.change).join(', '),
      asker: st?.origin === 'standing' ? 'Lumi (case upkeep)' : (st?.problem.requester.displayName ?? ''), askerSimulated: SIM(st?.problem.requester.displayName),
    };
  });
  // The chain of the Slack case (the page /pipeline shows): its passages by stage, the stated cause, and the answers on it.
  const p = pipelineData(store);
  const main = p.cases[0];
  let chain: QuestionStagesData['chain'];
  if (main) {
    const rows = (s: string) => main.items.filter((i) => i.stage.split(' · ').includes(s)).map((i) => ({ text: i.text, who: i.author, via: 'slack' }));
    const onCase = store.list('answer').filter((a) => { const qq = store.get('question', a.questionId); return qq?.candidate.scope.caseId === main.caseId; })
      .map((a) => ({ a, q: store.get('question', a.questionId)! }));
    const confirm = onCase.filter((x) => parseGapId(x.q.candidate.gapId)?.kind === 'confirm').map((x) => ({ text: `${x.a.value === 'yes' ? 'confirmed' : x.a.value}: ${x.q.candidate.text.replace(/ Is (this|that the) problem\?$/, '')}`, who: nameOf(store, x.a.personEntityId), via: 'lumi answer', ...(SIM(x.a.text) ? { simulated: true } : {}) }));
    // Answers from other units' investigations that matched this case (the retrieval put it among their candidates).
    const related = store.list('answer').map((a) => ({ a, q: store.get('question', a.questionId)! })).filter(({ q }) => q && q.candidate.scope.caseId !== main.caseId
      && !!store.get('investigation', q.candidate.investigationId)?.candidates.some((m) => m.caseId === main.caseId));
    const others = [...onCase, ...related].filter((x) => parseGapId(x.q.candidate.gapId)?.kind !== 'confirm').map((x) => ({ text: `${x.a.value}: ${x.q.candidate.text}`, who: nameOf(store, x.a.personEntityId), via: 'lumi answer', ...(SIM(x.a.text) ? { simulated: true } : {}) }));
    chain = {
      title: main.title.split(' · ')[0] ?? main.title,
      stages: [
        { stage: 'PROBLEM', rows: [...rows('symptom'), ...confirm] },
        { stage: 'CONDITION', rows: [...rows('condition').filter((r) => !rows('symptom').some((x) => x.text === r.text) && !rows('outcome').some((x) => x.text === r.text)), ...others] },
        { stage: 'CAUSE', rows: main.hypotheses.map((h) => ({ text: h.statement, who: h.author, via: 'slack' })) },
        { stage: 'ACTION', rows: rows('action') },
        { stage: 'OUTCOME', rows: rows('outcome') },
      ],
    };
  }
  const empty: QuestionStagesData = { inputs: { slack: [], other: [], answers: [] }, otherGaps: [], questions: [], who: [], evidence: [], log, ...(chain ? { chain } : {}) };
  const all = store.list('question');
  // Default: the most recently answered question, else the most recent one.
  const q = opts.questionId ? store.get('question', opts.questionId)
    : [...all].filter((x) => x.status === 'answered').sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).at(-1) ?? [...all].sort((a, b) => a.updatedAt.localeCompare(b.updatedAt)).at(-1);
  if (!q) return empty;
  const inv = store.get('investigation', q.candidate.investigationId);
  const decision = store.get('decision', q.decisionId);
  const gap = inv?.gaps.find((g) => g.id === q.candidate.gapId);
  // The hypothesis the open condition gates: the one drawn from the same case as the gap's target claim.
  const gapCase = gap?.targetClaimId ? store.get('claim', gap.targetClaimId)?.caseId : undefined;
  const hyp = gap?.targetClaimId ? inv?.hypotheses.find((h) => h.sourceClaimIds.includes(gap.targetClaimId!) || (!!gapCase && h.sourceClaimIds.some((id) => store.get('claim', id)?.caseId === gapCase))) : undefined;

  // INPUTS: the problem as asked in Lumi, the passages behind the hypotheses (Slack first), earlier Lumi answers.
  // Slack passages from every hypothesis (live Slack first, newest first); other sources only from the gated hypothesis.
  const evIds = [...new Set([...(inv?.hypotheses ?? []).flatMap((h) => h.basis.map((b) => b.evidenceId)).filter((id) => store.get('evidence', id)?.provider === 'slack')
    .sort((a, b) => Number(store.get('evidence', b)!.connectionId.startsWith('slack-live:')) - Number(store.get('evidence', a)!.connectionId.startsWith('slack-live:'))),
    ...(hyp?.basis ?? []).map((b) => b.evidenceId)])];
  const refs = new Map((inv?.hypotheses ?? []).flatMap((h) => h.basis).map((b) => [b.evidenceId, b.excerpt ?? '']));
  const slack: QuestionStagesData['inputs']['slack'] = [];
  const other: QuestionStagesData['inputs']['other'] = [];
  for (const id of evIds) {
    const e = store.get('evidence', id);
    if (!e) continue;
    const row = { author: e.author.displayName ?? e.author.id, text: refs.get(id) || e.text };
    if (e.provider === 'slack') slack.push(row); else other.push({ provider: e.provider, ...row });
  }
  const total = slack.length + other.length;
  slack.splice(3); other.splice(3);
  const more = total - slack.length - other.length;
  const answers = store.list('answer').filter((a) => a.questionId !== q.id && (inv?.questionIds ?? []).includes(a.questionId))
    .map((a) => ({ by: nameOf(store, a.personEntityId), value: a.value, question: store.get('question', a.questionId)?.candidate.text ?? '' }));

  // QUESTIONS: the candidates the decision weighed (only the asked one keeps its text in the store).
  const candIds = [...new Set((decision?.eligible ?? []).map((e) => e.questionId))];
  const chosen = decision && decision.chosen !== 'defer' ? decision.chosen : undefined;
  const questions = candIds.length ? candIds.map((id) => ({ text: id === q.candidate.id ? q.candidate.text : id, chosen: id === chosen?.questionId, ...(id === q.candidate.id ? {} : { note: 'not asked; wording not stored' }) }))
    : [{ text: q.candidate.text, chosen: true }];

  // WHO CAN KNOW: eligibility per person for this candidate (latest evaluation), the chosen one with the selector's own reason.
  const elig = new Map<string, RecipientEligibility>();
  for (const r of store.list('eligibility').filter((r) => r.questionId === q.candidate.id)) {
    const prev = elig.get(r.personEntityId);
    if (!prev || prev.evaluatedAt < r.evaluatedAt) elig.set(r.personEntityId, r);
  }
  const score = /score ([0-9.]+)/.exec(decision?.reason ?? '')?.[1];
  const who = [...elig.values()].map((r) => ({
    name: nameOf(store, r.personEntityId), chosen: r.personEntityId === chosen?.personEntityId, eligible: r.eligible,
    reasons: r.reasons, violations: [...r.violations], ...(r.personEntityId === chosen?.personEntityId && score ? { score } : {}),
  })).sort((a, b) => Number(b.chosen) - Number(a.chosen) || Number(b.eligible) - Number(a.eligible));

  const ans = q.answerId ? store.get('answer', q.answerId) : undefined;
  const evidence = (ans?.claimUpdates ?? []).map((u) => {
    const c = store.get('claim', u.claimId);
    return { statement: c?.statement ?? u.claimId, type: c?.type ?? '', change: u.change, note: u.note, sources: c?.supporting.length ?? 0, contradicting: c?.contradicting.length ?? 0, status: c?.status ?? '' };
  });
  return {
    questionId: q.id,
    inputs: { ...(more > 0 ? { more } : {}), ...(inv ? { problem: { by: inv.problem.requester.displayName, text: inv.problem.text, ...(SIM(inv.problem.requester.displayName) ? { simulated: true } : {}) } } : {}), slack, other, answers },
    ...(gap ? { open: { text: gap.description, ...(gap.targetCondition ? { condition: gap.targetCondition.label } : {}), ...(hyp ? { gates: hyp.statement, support: hyp.support, applicability: hyp.applicability } : {}) } } : {}),
    otherGaps: (inv?.gaps ?? []).filter((g) => g.id !== gap?.id && g.status === 'open').map((g) => ({ text: g.description, why: g.consequential ? 'consequential' : 'not consequential: not asked' })),
    questions, who,
    ...(decision?.features ? { features: decision.features } : {}),
    ...(decision ? { selector: `${decision.selector.version} · ${decision.reason}` } : {}),
    ...(ans ? { answer: { by: nameOf(store, ans.personEntityId), value: ans.value, at: ans.at, evidenceId: ans.evidenceId, ...(SIM(ans.text) ? { simulated: true } : {}) } } : {}),
    log, ...(chain ? { chain } : {}),
    evidence,
    result: {
      status: q.status,
      ...(q.reward ? { reward: { before: q.reward.before, after: q.reward.after, delta: q.reward.delta, method: q.reward.method } } : {}),
      ...(inv ? { recommendation: { kind: inv.recommendation.kind, applicability: inv.recommendation.applicability, text: inv.recommendation.text, ...(inv.recommendation.nextStep ? { nextStep: inv.recommendation.nextStep } : {}) }, loop: inv.loop } : {}),
    },
  };
}

// Plain debug pages (Artem 8 Nov): browser defaults, plain HTML structure, the raw values; only Lumi gets a designed UI.
// The one style rule: dropped chatter is grey.
/**
 * Quiet technical document (the default; ?raw=1 shows browser defaults): one system font, mono for ids, hairline rules, grey only for metadata
 * and dropped chatter, no colour, no boxes, no animation. Same markup as the plain page.
 */
const CLEAN = `
html.clean body { margin: 0; padding: 36px 44px 60px; background: #fff; color: #111; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; -webkit-font-smoothing: antialiased; }
html.clean h1 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: #6b6b6b; margin: 0 0 4px; }
html.clean h1 + p { color: #111; font-size: 21px; line-height: 1.4; font-weight: 500; letter-spacing: -0.01em; margin: 6px 0 26px; padding-bottom: 18px; border-bottom: 1px solid #111; max-width: 1100px; }
html.clean h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; margin: 30px 0 8px; }
html.clean table { border-collapse: collapse; border: 0; }
html.clean th { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; text-align: left; padding: 8px 12px 8px 0; border: 0; border-bottom: 1px solid #111; }
html.clean td { padding: 10px 12px 10px 0; border: 0; border-bottom: 1px solid #e6e6e6; vertical-align: top; }
html.clean td > div, html.clean td > ul { margin-bottom: 6px; }
html.clean tt, html.clean pre, html.clean code { font: 11.5px/1.45 ui-monospace, "SF Mono", Menlo, monospace; color: #6b6b6b; }
html.clean i { font-style: normal; color: #6b6b6b; font-size: 13px; }
html.clean .drop { color: #b0b0b0; }
html.clean .cert { font-size: 26px; font-weight: 600; letter-spacing: -0.02em; display: block; margin-top: 10px; }
html.clean details summary { cursor: pointer; color: #6b6b6b; font-size: 13px; }
html.clean ul { padding-left: 18px; margin: 8px 0; }
`;
const HEAD = (title: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${title}</title><style>.drop{color:gray}${CLEAN}</style><script>if (new URLSearchParams(location.search).get('raw') !== '1') document.documentElement.className = 'clean';</script></head><body>`;
/** Fetch the JSON, render, and replace the DOM only when the output changed (no animation). */
const LOOP = (url: string, render: string) => `
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const hhmm = (iso) => iso ? new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
const qs = new URLSearchParams(location.search);
const set = (id, html) => { const el = document.getElementById(id); if (el && el.innerHTML !== html) el.innerHTML = html; };
async function tick() {
  let d; try { d = await (await fetch(${url}, { cache: 'no-store' })).json(); } catch { return; }
  ${render}
}
tick(); setInterval(tick, 1500);`;

export function pipelinePage(): string {
  return `${HEAD('pipeline')}
<h1>pipeline</h1>
<p>Backend view: what Lumi sees. It runs on its own, so it gets no design. People only ever see Lumi.</p>
<p id="src"></p>
<table border="1" width="100%">
<tr><th width="27%">1. raw</th><th width="1%">→</th><th width="27%">2. filtered</th><th width="1%">→</th><th width="17%">3. linked</th><th width="1%">→</th><th width="26%">4. hypothesis</th></tr>
<tr valign="top"><td id="raw"></td><td></td><td id="useful"></td><td></td><td id="case"></td><td></td><td id="hyp"></td></tr>
</table>
<h2>stored record</h2>
<details><summary>case json</summary><pre id="json"></pre></details>
<script>${LOOP(`'/pipeline.json' + (qs.get('connection') ? '?connection=' + encodeURIComponent(qs.get('connection')) : '')`, `
  set('src', esc(d.connection || 'no slack connection') + ' · #' + esc(d.channel || '') + ' · ' + d.raw.length + ' messages');
  set('raw', d.raw.map((m) => '<div' + (m.useful ? '' : ' class="drop"') + '>' + esc(hhmm(m.time)) + ' ' + esc(m.author) + ': ' + esc(m.text) + '</div>').join(''));
  set('useful', d.raw.filter((m) => m.useful).map((m) => m.kept.map((k) => '<div>[' + esc(k.type) + '] ' + esc(k.excerpt) + ' <tt>' + esc(m.id) + '</tt></div>').join('')).join(''));
  const c = d.cases[0];
  const stages = ['symptom', 'condition', 'action', 'outcome'];
  set('case', c ? '<div>' + esc(c.title) + '</div><div><tt>' + esc(c.caseId) + '</tt> ' + esc(c.status) + '</div><ul>'
    + stages.map((s) => '<li>' + s + ' x' + c.items.filter((i) => i.stage.split(' · ').includes(s)).length + '</li>').join('') + '</ul>'
    + '<div class="cert">evidence: ' + c.certainty.messages + (c.certainty.threshold ? ' of ' + c.certainty.threshold : '') + ' messages</div><div>' + (c.certainty.threshold ? (c.certainty.asked ? 'enough: Lumi asked' : 'not enough to ask anyone yet') : '') + '</div>' : '');
  set('hyp', c ? c.hypotheses.map((h) => '<div>' + esc(h.statement) + '</div><div>' + esc(h.author) + ' <tt>' + esc(h.evidenceId) + '</tt></div><hr>'
    + h.supporting.map((s) => '<div>+ ' + esc(s.text) + '</div>').join('')).join('') + c.open.map((o) => '<div>? ' + esc(o) + '</div>').join('') : '');
  const j = d.stored ? JSON.stringify(d.stored, null, 2) : 'null';
  const pre = document.getElementById('json'); if (pre.textContent !== j) pre.textContent = j;`)}</script></body></html>`;
}

export function questionsPage(): string {
  return `${HEAD('questions')}
<h1>questions</h1>
<p>Backend view: what Lumi sees. It runs on its own, so it gets no design. People only ever see Lumi.</p>
<h2 id="ctitle">what we know</h2>
<table border="1" width="100%"><tr><th width="20%">problem</th><th width="1%">→</th><th width="20%">condition</th><th width="1%">→</th><th width="19%">cause</th><th width="1%">→</th><th width="19%">fix</th><th width="1%">→</th><th width="19%">outcome</th></tr><tr valign="top" id="chain"></tr></table>
<h2>latest question</h2>
<table border="1" width="100%"><tr><th width="30%">question</th><th width="1%">→</th><th width="27%">asked</th><th width="1%">→</th><th width="12%">answer</th><th width="1%">→</th><th width="28%">what changed</th></tr><tr valign="top"><td id="q"></td><td></td><td id="who"></td><td></td><td id="answer"></td><td></td><td id="changed"></td></tr></table>
<h2>all questions</h2>
<table border="1" width="100%"><thead><tr><th>time</th><th>asked by</th><th>question</th><th>to</th><th>answer</th></tr></thead><tbody id="log"></tbody></table>
<script>${LOOP(`'/pipeline/questions.json' + (qs.get('question') ? '?question=' + encodeURIComponent(qs.get('question')) : '')`, `
  const sim = (b) => b ? ' (simulated)' : '';
  set('ctitle', 'what we know' + (d.chain ? ' about ' + esc(d.chain.title) : ''));
  set('chain', d.chain ? d.chain.stages.map((s, i) => (i ? '<td></td>' : '') + '<td>' + (s.rows.map((r) => '<div>' + esc(r.text) + ' <i>' + esc(r.who) + sim(r.simulated) + '</i></div>').join('') || '-') + '</td>').join('') : '<td colspan="9">-</td>');
  const chosen = d.who.find((w) => w.chosen);
  const others = d.who.filter((w) => !w.chosen && w.eligible).slice(0, 3).map((w) => esc(w.name)).join(', ');
  set('q', d.questions.find((q) => q.chosen) ? esc(d.questions.find((q) => q.chosen).text) : '-');
  set('who', chosen ? '<div>' + esc(chosen.name) + (chosen.score ? ' (score ' + esc(chosen.score) + ')' : '') + '</div><div>' + esc(chosen.reasons[0] || '') + '</div>' + (others ? '<div class="drop">also could: ' + others + '</div>' : '') : '-');
  set('answer', d.answer ? esc(d.answer.value) + sim(d.answer.simulated) : '-');
  const r = d.result || {};
  set('changed', (d.evidence.map((e) => '<div>' + esc(e.change) + ': ' + esc(e.statement.length > 70 ? e.statement.slice(0, 69) + '…' : e.statement) + '</div>').join('')
    + (r.recommendation && d.answer ? '<div>now: ' + esc(r.recommendation.kind) + ', ' + esc(r.recommendation.applicability) + '</div>' : '')) || '-');
  set('log', d.log.map((l) => '<tr><td>' + esc(hhmm(l.at)) + '</td><td>' + esc(l.asker.replace(' (simulated)', '')) + sim(l.askerSimulated) + '</td><td>' + esc(l.text.length > 110 ? l.text.slice(0, 109) + '…' : l.text) + '</td><td>' + esc(l.to) + '</td><td>' + esc(l.answer || '') + (l.answer ? sim(l.simulated) : '') + '</td></tr>').join(''));`)}</script></body></html>`;
}
