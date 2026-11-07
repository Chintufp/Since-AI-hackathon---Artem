/**
 * Runs one planned simulated day against a live service over HTTP. The real engine does all the deciding (retrieval,
 * recommendation, who to ask, limits); this runner only plays the environment: evidence arriving, simulated engineers
 * asking, simulated colleagues replying, and an occasional attempt to involve the judge's own person. It also mirrors
 * what the judge (desktop) and an MCP agent do on the same database, read from the service's trace events.
 */
import type { DirectoryEntry, PeopleDirectory, Principal, QuestionView, ResultView } from '../contracts/index.ts';
import { createRng } from '../models/index.ts';
import type { ActivitySink, RowInput } from './activity.ts';
import type { SimClock } from './clock.ts';
import { ServiceHttpError, type ServiceClient } from './client.ts';
import { buildProfiles, decideReply, type SimProfile } from './people.ts';
import type { DayPlan, PlanEvent, ProblemInput } from './schedule.ts';

export interface JudgePrompt {
  text: string;
  /** Display name of the simulated requester (must not be the judge). */
  requester: string;
  /** Display names this prompt is known to reach ('*' = anyone the coordinator picks). */
  targets: string[];
  note?: string;
}

export interface RunnerOptions {
  client: ServiceClient;
  plan: DayPlan;
  clock: SimClock;
  seed: number;
  sink: ActivitySink;
  judgePrompts?: JudgePrompt[];
  /** Simulated minutes between polls (default 5). */
  tickMinutes?: number;
  /** Move the service's clock along with the simulated one (default true). */
  syncServiceClock?: boolean;
  /** Stop condition hook (Ctrl-C). */
  shouldStop?: () => boolean;
  /**
   * R46: simulated people take part in points (default true; `--no-points`). Each person who has not chosen yet is
   * opted in when they appear in the directory; the judge's own person is never opted in by the stream.
   */
  points?: boolean;
}

export interface RunSummary {
  investigations: number;
  evidenceImports: number;
  questionsAsked: number;
  answered: number;
  deferred: number;
  dismissed: number;
  unanswered: number;
  judgeQuestions: number;
  judgeAttempts: number;
  agentCalls: number;
  errors: number;
  /** R46: points rows written (simulated people's awards). */
  pointsRows: number;
}

interface Known {
  questionId: string;
  investigationId: string;
  personEntityId: string;
  text: string;
  deliveredAtMs: number;
  done: boolean;
}

interface Reply {
  atMs: number;
  questionId: string;
  action: 'yes' | 'no' | 'unknown' | 'later' | 'dismiss' | 'check';
  followUp?: { atMs: number; value: 'yes' | 'no' | 'unknown' };
  reason: string;
}

type Investigation = ResultView & { state: { id: string; problem: { requester: { id: string; displayName: string; agentId?: string } }; loop: string; loopReason?: string } };
type Event = { id: string; at: string; type: string; traceId: string };
type Settings = { currentPersonEntityId?: string };
type ImportResult = { batch: { counts: { seen: number; inserted: number; unchangedDuplicates: number } }; cases: number; claims: number; people: number; points?: Array<{ personEntityId: string; points: number }> };

const RECOMMENDATION_WORDS: Record<string, string> = {
  reuse: 'reuse the earlier fix', 'check-first': 'check first', qualified: 'conditional, with a check first', 'retain-uncertainty': 'keep the uncertainty', none: 'no recommendation',
};
const ANSWER_WORDS: Record<string, string> = { yes: 'Yes', no: 'No', unknown: 'Not sure' };
const MIN = 60_000;

export async function runDay(opts: RunnerOptions): Promise<RunSummary> {
  const { client, plan, clock, sink } = opts;
  const tickMs = (opts.tickMinutes ?? 5) * MIN;
  const endMs = clock.startMs + plan.hours * 60 * MIN;
  const rng = createRng(opts.seed * 48271 + 11);
  const summary: RunSummary = { investigations: 0, evidenceImports: 0, questionsAsked: 0, answered: 0, deferred: 0, dismissed: 0, unanswered: 0, judgeQuestions: 0, judgeAttempts: 0, agentCalls: 0, errors: 0, pointsRows: 0 };

  let directory: DirectoryEntry[] = [];
  let profiles = new Map<string, SimProfile>();
  const known = new Map<string, Known>();
  const replies: Reply[] = [];
  const mine = new Set<string>();
  const seenEvents = new Set<string>();
  const usedPrompts = new Set<number>();
  let judgeId: string | undefined;
  let lastJudgeAskMs: number | undefined;
  let eventsSince = '';
  const events: PlanEvent[] = [...plan.events];

  const nameOf = (id: string): string => directory.find((d) => d.personEntityId === id)?.name ?? id;
  const judgeName = (): string | undefined => (judgeId ? directory.find((d) => d.personEntityId === judgeId)?.name : undefined);
  const row = (r: RowInput): void => sink.write({ ...r, at: r.at ?? clock.now().toISOString(), real: new Date().toISOString(), simulated: true });
  const fail = (what: string, e: unknown): void => {
    summary.errors++;
    row({ kind: 'note', text: `${what} failed: ${e instanceof Error ? e.message : String(e)}` });
  };
  const refreshDirectory = async (): Promise<void> => {
    directory = await client.get<DirectoryEntry[]>('/directory');
    const next = buildProfiles(directory, opts.seed);
    for (const [id, p] of next) if (!profiles.has(id)) profiles.set(id, p);
    profiles = new Map([...profiles].filter(([id]) => next.has(id)).concat([...next].filter(([id]) => !profiles.has(id))));
    await optInNewPeople();
  };
  /** R46: simulated people take part in points; a person who already chose (either way) and the judge are left alone. */
  const optInConsidered = new Set<string>();
  async function optInNewPeople(): Promise<void> {
    if (opts.points === false) return;
    const names: string[] = [];
    for (const d of directory) {
      if (optInConsidered.has(d.personEntityId) || d.personEntityId === judgeId) continue;
      optInConsidered.add(d.personEntityId);
      try {
        const current = await client.get<{ participates: boolean; since: string }>(`/participation/${encodeURIComponent(d.personEntityId)}/optin`);
        if (current.since) continue;
        const principal: Principal = { id: d.personEntityId, displayName: d.name, groups: d.groups, type: 'human' };
        await client.put(`/participation/${encodeURIComponent(d.personEntityId)}/optin`, { principal, participates: true });
        names.push(d.name);
      } catch (e) {
        fail(`opting ${d.name} into points`, e);
      }
    }
    if (names.length && judgeParticipates) row({ kind: 'points', text: `${names.length} simulated ${names.length === 1 ? 'person takes' : 'people take'} part in points: ${names.join(', ')}`, why: `simulated opt-in (their choice is played by the stream); you are never opted in automatically${judgeId ? `, ${nameOf(judgeId)} decides in Settings → Points & rating` : ''}`, detail: { personEntityIds: directory.filter((d) => names.includes(d.name)).map((d) => d.personEntityId) } });
  }
  const pointsRow = (who: string, personEntityId: string, points: number, what: string, detail: Record<string, unknown>): void => {
    if (points <= 0) return;
    if (!judgeParticipates) { heldPointsRows++; return; } // R47: quiet until the judge takes part
    summary.pointsRows++;
    row({ kind: 'points', who, text: `+${points} to ${who} for ${what}`, why: 'simulated; points count contributions and never judge whether the answer was right', detail: { personEntityId, points, ...detail } });
  };
  /** R47 (Artem): points rows are shown only once the judge's own person takes part; the awards themselves still happen. */
  let judgeParticipates = false;
  let heldPointsRows = 0;
  const refreshJudge = async (): Promise<void> => {
    try {
      const s = await client.get<Settings>('/settings');
      const next = s.currentPersonEntityId || undefined;
      if (next !== judgeId) {
        judgeId = next;
        row({ kind: 'judge', text: judgeId ? `You are ${nameOf(judgeId)} in the companion (Settings → You); questions for this person are left for you to answer` : 'No person is chosen in the companion (Settings → You), so nothing is addressed to you', forYou: true });
      }
      const was = judgeParticipates;
      judgeParticipates = judgeId ? !!(await client.get<{ participates: boolean }>(`/participation/${encodeURIComponent(judgeId)}/optin`)).participates : false;
      if (judgeParticipates && !was) row({ kind: 'points', text: `${nameOf(judgeId!)} takes part in points; from now on the stream shows the simulated people's awards${heldPointsRows ? ` (${heldPointsRows} earlier awards were not shown)` : ''}`, why: 'awards are shown only while you take part (Settings → Points & rating)', forYou: true });
    } catch (e) {
      fail('reading settings', e);
    }
  };
  const syncClock = async (): Promise<void> => {
    if (opts.syncServiceClock === false) return;
    try {
      await client.post('/demo/clock', { now: clock.now().toISOString(), rate: clock.rate });
    } catch (e) {
      if (!(e instanceof ServiceHttpError && e.status === 409)) fail('moving the service clock', e);
      opts.syncServiceClock = false;
    }
  };

  const principalOf = (p: ProblemInput['requester']): Principal => ({ id: p.id, displayName: p.name, groups: p.groups, type: 'human' });

  async function investigate(family: string, problem: ProblemInput, why?: string): Promise<Investigation | undefined> {
    try {
      const r = await client.post<Investigation>('/investigate', {
        text: problem.text, principal: principalOf(problem.requester),
        ...(problem.observations?.length ? { observations: problem.observations.map((o) => ({ key: o.key, operator: 'eq', value: o.value, origin: 'reported', evidence: [], label: o.label })) } : {}),
      });
      mine.add(r.investigationId);
      summary.investigations++;
      const rec = r.recommendation;
      row({
        kind: 'investigation', who: problem.requester.name,
        text: `${problem.requester.name} asks: "${problem.text}"`,
        why: `${why ? `${why} · ` : ''}recommendation: ${RECOMMENDATION_WORDS[rec.kind] ?? rec.kind} — ${rec.text}${r.loop === 'question-open' ? '' : ` · ${r.loopReason ?? r.loop}`}`,
        detail: { investigationId: r.investigationId, family, recommendation: rec.kind, loop: r.loop, route: 'simulated requester, real engine' },
      });
      return r;
    } catch (e) {
      fail(`investigation by ${problem.requester.name}`, e);
      return undefined;
    }
  }

  async function runPlanEvent(e: PlanEvent): Promise<void> {
    if (e.kind === 'directory') {
      try {
        // The directory is applied on its own first (an import without evidence), so the family's people exist, and can
        // take part in points (R46), before their evidence arrives; it also travels with every later source of the family.
        await client.post<ImportResult>('/import', { format: 'teams-json', payload: { messages: [] }, directory: e.directory as PeopleDirectory });
        row({ kind: 'evidence', text: `Directory update from family ${e.family}: ${e.directory.people.length} people (roles, groups, availability)`, detail: { family: e.family } });
        await refreshDirectory();
      } catch (err) {
        fail('directory', err);
      }
    } else if (e.kind === 'evidence') {
      try {
        const family = plan.events.find((x): x is Extract<PlanEvent, { kind: 'directory' }> => x.kind === 'directory' && x.family === e.family);
        const r = await client.post<ImportResult>('/import', { format: e.source.format, payload: e.source.payload, ...(family ? { directory: family.directory as PeopleDirectory } : {}) });
        summary.evidenceImports++;
        const c = r.batch.counts;
        row({
          kind: 'evidence', text: `${e.source.label} arrived (family ${e.family})`,
          why: `${c.inserted} new records${c.unchangedDuplicates ? `, ${c.unchangedDuplicates} already known` : ''} → ${r.cases} case${r.cases === 1 ? '' : 's'}, ${r.claims} claims extracted (rules route)`,
          detail: { family: e.family, format: e.source.format, counts: c, cases: r.cases, claims: r.claims },
        });
        await refreshDirectory();
        for (const p of r.points ?? []) pointsRow(nameOf(p.personEntityId), p.personEntityId, p.points, 'evidence that became knowledge', { family: e.family, kind: 'evidence' });
      } catch (err) {
        fail(`import ${e.source.label}`, err);
      }
    } else if (e.kind === 'investigate') {
      if (judgeId && e.problem.requester.id === judgeId) {
        row({ kind: 'note', text: `Skipped a scripted problem by ${e.problem.requester.name}: that is you in the companion`, forYou: true });
        return;
      }
      await investigate(e.family, e.problem);
    } else if (e.kind === 'judge-slot') {
      await judgeSlot();
    }
  }

  async function judgeSlot(): Promise<void> {
    if (!judgeId) return;
    const name = judgeName();
    if (!name) return;
    const since = lastJudgeAskMs === undefined ? Infinity : clock.now().getTime() - lastJudgeAskMs;
    if (since < plan.judgeEveryMinutes * MIN) return;
    const open = [...known.values()].some((k) => k.personEntityId === judgeId && !k.done);
    if (open) {
      row({ kind: 'judge', text: `Not asking you again yet: a question for you is still open`, forYou: true });
      return;
    }
    const prompts = (opts.judgePrompts ?? []).map((p, i) => ({ p, i })).filter(({ p, i }) => !usedPrompts.has(i) && p.requester !== name && (p.targets.includes(name) || p.targets.includes('*')));
    const pick = prompts.find(({ p }) => p.targets.includes(name)) ?? prompts[0];
    if (!pick) {
      row({ kind: 'judge', text: `No scripted problem is known to reach ${name}; the coordinator may still pick you for a regular question`, forYou: true });
      return;
    }
    usedPrompts.add(pick.i);
    const requester = directory.find((d) => d.name === pick.p.requester);
    if (!requester) {
      row({ kind: 'note', text: `Judge prompt skipped: requester ${pick.p.requester} is not in the directory` });
      return;
    }
    summary.judgeAttempts++;
    row({ kind: 'judge', text: `Trying to involve you: ${requester.name} is about to ask something only ${name} may be placed to answer`, forYou: true, ...(pick.p.note ? { why: pick.p.note } : {}) });
    const r = await investigate('judge', { id: `judge-${pick.i}`, text: pick.p.text, requester: { id: requester.personEntityId, name: requester.name, groups: requester.groups } }, 'for you');
    if (!r) return;
    const asked = /^Asked (.+?) because/.exec(r.loopReason ?? '')?.[1];
    if (r.question && asked === name) {
      lastJudgeAskMs = clock.now().getTime(); // the question row itself is logged and counted by the poll below
    } else if (r.question) {
      row({ kind: 'judge', text: `The coordinator chose ${asked ?? 'someone else'} instead of you`, why: r.loopReason, forYou: true });
    } else {
      row({ kind: 'judge', text: `No question was needed for that one (${r.loopReason ?? r.loop})`, forYou: true });
    }
  }

  async function pollQuestions(): Promise<void> {
    let open: QuestionView[];
    try {
      open = await client.get<QuestionView[]>('/questions');
    } catch (e) {
      fail('listing questions', e);
      return;
    }
    for (const q of open) {
      if (known.has(q.questionId) || q.status !== 'delivered') continue;
      const personEntityId = q.personEntityId ?? '';
      let inv: Investigation | undefined;
      try {
        inv = await client.get<Investigation>(`/investigations/${encodeURIComponent(q.investigationId)}`);
      } catch (e) {
        fail('reading a question', e);
        continue;
      }
      const nowMs = clock.now().getTime();
      known.set(q.questionId, { questionId: q.questionId, investigationId: q.investigationId, personEntityId, text: q.text, deliveredAtMs: nowMs, done: false });
      summary.questionsAsked++;
      const who = nameOf(personEntityId);
      const because = /because (.+)$/.exec(inv?.loopReason ?? '')?.[1];
      const requester = inv?.state.problem.requester;
      const agent = requester?.agentId ? ` (asked by the agent ${requester.displayName} over MCP)` : '';
      const forYou = !!judgeId && personEntityId === judgeId;
      if (forYou) {
        lastJudgeAskMs = nowMs;
        summary.judgeQuestions++;
      }
      row({
        kind: 'question', who, forYou,
        text: `${forYou ? 'For you' : `Asked ${who}`}: "${q.text}"${agent}${forYou ? ' — open the companion to answer' : ''}`,
        why: `${because ? `because ${because}` : `about ${q.caseLabel}`}; the coordinator checked access, daily limit, cooldown, open questions and duplicates`,
        detail: { questionId: q.questionId, investigationId: q.investigationId, personEntityId, caseLabel: q.caseLabel, requester: requester?.displayName, route: 'real coordinator (rules selector)' },
      });
      if (forYou || !personEntityId) continue;
      const profile = profiles.get(personEntityId);
      if (!profile) continue;
      const reply = decideReply(profile, q.text, rng);
      if (reply.action === 'none') {
        replies.push({ atMs: nowMs + 240 * MIN, questionId: q.questionId, action: 'check', reason: reply.reason });
        continue;
      }
      replies.push({
        atMs: nowMs + reply.delayMinutes * MIN, questionId: q.questionId, action: reply.action, reason: reply.reason,
        ...(reply.action === 'later' && reply.followUpMinutes && reply.followUp ? { followUp: { atMs: nowMs + (reply.delayMinutes + reply.followUpMinutes) * MIN, value: reply.followUp } } : {}),
      });
    }
  }

  async function deliver(r: Reply): Promise<void> {
    const k = known.get(r.questionId);
    if (!k || k.done) return;
    const person = directory.find((d) => d.personEntityId === k.personEntityId);
    if (!person) return;
    const principal: Principal = { id: person.personEntityId, displayName: person.name, groups: person.groups, type: 'human' };
    const path = `/questions/${encodeURIComponent(r.questionId)}`;
    try {
      if (r.action === 'check') {
        const q = await client.get<QuestionView>(path);
        if (q.status === 'delivered' || q.status === 'queued') {
          summary.unanswered++;
          row({ kind: 'answer', who: person.name, text: `${person.name} has not reacted to "${k.text}"`, why: `${r.reason}; the question stays open and counts against their budget`, detail: { questionId: r.questionId, status: q.status } });
        }
        k.done = true;
        return;
      }
      if (r.action === 'later') {
        await client.post(`${path}/defer`, { principal });
        summary.deferred++;
        row({ kind: 'answer', who: person.name, text: `${person.name} tapped Later on "${k.text}"`, why: r.reason, detail: { questionId: r.questionId, value: 'later' } });
        if (r.followUp) replies.push({ atMs: r.followUp.atMs, questionId: r.questionId, action: r.followUp.value, reason: 'came back to the saved question' });
        else k.done = true;
        return;
      }
      if (r.action === 'dismiss') {
        await client.post(`${path}/dismiss`, { principal });
        summary.dismissed++;
        k.done = true;
        row({ kind: 'answer', who: person.name, text: `${person.name} dismissed "${k.text}"`, why: `${r.reason}; no fact recorded`, detail: { questionId: r.questionId, value: 'dismiss' } });
        return;
      }
      const res = await client.post<{ receipt: { detail: string; pointsAwarded?: number } }>(`${path}/answer`, { principal, value: r.action });
      summary.answered++;
      k.done = true;
      pointsRow(person.name, person.personEntityId, res.receipt.pointsAwarded ?? 0, 'answering', { questionId: r.questionId, kind: `answer-${r.action}` });
      const inv = await client.get<Investigation>(`/investigations/${encodeURIComponent(k.investigationId)}`).catch(() => undefined);
      const after = inv ? `${RECOMMENDATION_WORDS[inv.recommendation.kind] ?? inv.recommendation.kind} — ${inv.recommendation.text}` : '';
      row({
        kind: 'answer', who: person.name,
        text: `${person.name} answered ${ANSWER_WORDS[r.action]} to "${k.text}"`,
        why: `${r.reason} (simulated) · ${res.receipt.detail.replace(/^You /, 'They ')}${after ? ` · now: ${after}` : ''}`,
        detail: { questionId: r.questionId, value: r.action, recommendation: inv?.recommendation.kind, investigationId: k.investigationId },
      });
    } catch (e) {
      k.done = true;
      if (e instanceof ServiceHttpError && (e.status === 409 || e.status === 404)) {
        row({ kind: 'note', who: person.name, text: `${person.name} could not answer "${k.text}" any more: ${e.message}`, detail: { questionId: r.questionId } });
      } else fail(`reply by ${person.name}`, e);
    }
  }

  /** What the judge and MCP agents do on the same database, from the service's trace events. */
  async function pollEvents(): Promise<void> {
    let list: Event[];
    try {
      list = await client.get<Event[]>(`/events${eventsSince ? `?since=${encodeURIComponent(eventsSince)}` : ''}`);
    } catch (e) {
      fail('reading events', e);
      return;
    }
    for (const e of list) {
      if (seenEvents.has(e.id)) continue;
      seenEvents.add(e.id);
      if (e.at > eventsSince) eventsSince = new Date(Date.parse(e.at) - 10 * MIN).toISOString();
      if (!/^inv_/.test(e.traceId)) continue;
      if (mine.has(e.traceId) && e.type !== 'question.answered' && e.type !== 'question.deferred' && e.type !== 'question.dismissed' && e.type !== 'question.undone') continue;
      try {
        if (e.type === 'investigation.started') {
          const inv = await client.get<Investigation>(`/investigations/${encodeURIComponent(e.traceId)}`);
          const req = inv.state.problem.requester;
          mine.add(e.traceId);
          const rec = inv.recommendation;
          if (req.agentId) {
            summary.agentCalls++;
            row({ kind: 'agent', who: req.displayName, text: `Agent ${req.displayName} (${req.agentId}) investigated over MCP: "${(inv as unknown as { state: { problem: { text: string } } }).state.problem.text}"`, why: `recommendation: ${RECOMMENDATION_WORDS[rec.kind] ?? rec.kind} — ${rec.text} · route: MCP agent, same engine and limits`, detail: { investigationId: e.traceId, agentId: req.agentId, recommendation: rec.kind, route: 'agent' } });
          } else if (judgeId && req.id === judgeId) {
            row({ kind: 'judge', who: req.displayName, forYou: true, text: `You asked: "${(inv as unknown as { state: { problem: { text: string } } }).state.problem.text}"`, why: `recommendation: ${RECOMMENDATION_WORDS[rec.kind] ?? rec.kind} — ${rec.text}`, detail: { investigationId: e.traceId, recommendation: rec.kind } });
          } else {
            row({ kind: 'investigation', who: req.displayName, text: `${req.displayName} asked (outside the script): "${(inv as unknown as { state: { problem: { text: string } } }).state.problem.text}"`, why: `recommendation: ${RECOMMENDATION_WORDS[rec.kind] ?? rec.kind} — ${rec.text}`, detail: { investigationId: e.traceId, recommendation: rec.kind } });
          }
        } else if (e.type === 'question.answered' || e.type === 'question.deferred' || e.type === 'question.dismissed' || e.type === 'question.undone') {
          if (!judgeId) continue;
          const qs = await client.get<QuestionView[]>(`/questions?personEntityId=${encodeURIComponent(judgeId)}&status=all`);
          const q = qs.find((x) => x.investigationId === e.traceId);
          if (!q) continue;
          const k = known.get(q.questionId);
          if (k) k.done = e.type !== 'question.undone';
          const verb = e.type === 'question.answered' ? 'answered' : e.type === 'question.deferred' ? 'saved for later' : e.type === 'question.dismissed' ? 'dismissed' : 'undid your answer to';
          const inv = e.type === 'question.answered' ? await client.get<Investigation>(`/investigations/${encodeURIComponent(e.traceId)}`).catch(() => undefined) : undefined;
          row({ kind: 'judge', who: nameOf(judgeId), forYou: true, text: `You ${verb} "${q.text}"`, ...(inv ? { why: `now: ${RECOMMENDATION_WORDS[inv.recommendation.kind] ?? inv.recommendation.kind} — ${inv.recommendation.text}` } : {}), detail: { questionId: q.questionId, type: e.type } });
        } else if (e.type === 'outcome.reported') {
          const inv = await client.get<Investigation>(`/investigations/${encodeURIComponent(e.traceId)}`);
          const req = inv.state.problem.requester;
          const agent = !!req.agentId;
          if (agent) summary.agentCalls++;
          row({ kind: agent ? 'agent' : 'judge', who: req.displayName, forYou: !agent, text: `${agent ? `Agent ${req.displayName}` : 'You'} reported an outcome for "${(inv as unknown as { state: { problem: { text: string } } }).state.problem.text}"`, why: agent ? 'route: MCP agent (kt_record_outcome); stored as its own attributed report, the past case is not rewritten' : 'stored as your own attributed report', detail: { investigationId: e.traceId, route: agent ? 'agent' : 'desktop' } });
        } else if (e.type === 'question.cancelled') {
          const inv = await client.get<Investigation>(`/investigations/${encodeURIComponent(e.traceId)}`);
          if (inv.state.problem.requester.agentId) {
            summary.agentCalls++;
            row({ kind: 'agent', who: inv.state.problem.requester.displayName, text: `Agent ${inv.state.problem.requester.displayName} cancelled its clarification question over MCP`, detail: { investigationId: e.traceId, route: 'agent' } });
          }
        } else if (e.type === 'contact-draft.created' && judgeId) {
          const inv = await client.get<Investigation>(`/investigations/${encodeURIComponent(e.traceId)}`);
          if (inv.state.problem.requester.id === judgeId) row({ kind: 'judge', forYou: true, who: nameOf(judgeId), text: 'You prepared a message draft (nothing was sent)', detail: { investigationId: e.traceId } });
        }
      } catch (err) {
        fail(`reading event ${e.type}`, err);
      }
    }
  }

  // ---- main loop ----
  await refreshJudge(); // before the directory, so the judge's person is known when simulated people are opted in (R46)
  await refreshDirectory();
  await syncClock();
  row({ kind: 'clock', text: `Simulated day starts (${plan.hours} h; 1 simulated hour = ${clock.hourSeconds || 0} real seconds; seed ${opts.seed}); every row below is simulated`, detail: { seed: opts.seed, hours: plan.hours, hourSeconds: clock.hourSeconds, judgeEveryMinutes: plan.judgeEveryMinutes } });
  await pollEvents();
  while (!opts.shouldStop?.()) {
    const nowMs = clock.now().getTime();
    while (events.length && clock.startMs + events[0]!.at * MIN <= nowMs) await runPlanEvent(events.shift()!);
    replies.sort((a, b) => a.atMs - b.atMs);
    while (replies.length && replies[0]!.atMs <= nowMs) await deliver(replies.shift()!);
    await refreshJudge();
    await pollQuestions();
    await pollEvents();
    if (nowMs >= endMs) break;
    const candidates = [nowMs + tickMs, ...(events.length ? [clock.startMs + events[0]!.at * MIN] : []), ...(replies.length ? [replies[0]!.atMs] : [])];
    const next = Math.min(endMs, ...candidates.filter((x) => x > nowMs));
    await clock.advanceTo(next);
    await syncClock();
  }
  if (events.length) row({ kind: 'note', text: `${events.length} planned event(s) fell after the end of the day and were skipped` });
  const open = [...known.values()].filter((k) => !k.done);
  for (const k of open) if (k.personEntityId !== judgeId) summary.unanswered++;
  row({
    kind: 'summary',
    text: `Simulated day over: ${summary.investigations} investigations, ${summary.evidenceImports} evidence imports, ${summary.questionsAsked} questions asked (${summary.answered} answered, ${summary.deferred} later, ${summary.dismissed} dismissed, ${summary.unanswered} unanswered), ${summary.judgeQuestions} for you, ${summary.pointsRows} points awards (simulated people), ${summary.agentCalls} agent calls over MCP, ${summary.errors} errors`,
    detail: { ...summary, openQuestions: open.map((k) => ({ questionId: k.questionId, who: nameOf(k.personEntityId) })) },
  });
  return summary;
}
