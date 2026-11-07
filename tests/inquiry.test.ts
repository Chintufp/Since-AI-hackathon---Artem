/**
 * B7 · agent-driven inquiry over MCP: an agent lists gaps, asks through the engine for the person best placed, proposes
 * its own wording, and gains or loses confidence, under the same gates as a person. Each test runs its own service (file
 * database) and its own MCP server process on it, so budgets and cooldowns of one test never leak into another.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { EngineOptions } from '../src/apps/service/engine.ts';
import { defaultObservabilityPolicy, defaultQuietHours } from '../src/apps/service/org-config.ts';
import { makeGapId, parseGapId } from '../src/libs/utils/investigation/index.ts';
import { DEV_FIXTURE, ROOT, SCENARIOS, human, startService, type Running } from './support.ts';

const AGENT = { id: 'agent:test:inquiry', displayName: 'Inquiry agent', groups: ['noc'] };
const TEXT = 'BGP sessions flapping on RTR-203 after the firmware update';
const NOON = '2026-11-07T12:00:00.000Z';

interface Rig { svc: Running; client: Client; tool<T = any>(name: string, args: Record<string, unknown>): Promise<T>; close(): Promise<void> }

async function rig(o: { svc?: EngineOptions; mcpArgs?: string[]; importDev?: boolean } = {}): Promise<Rig> {
  const dir = mkdtempSync(join(tmpdir(), 'kt-inquiry-'));
  const db = join(dir, 'kt.sqlite');
  const svc = await startService({ dbPath: db, investigation: { observability: defaultObservabilityPolicy }, ...(o.svc ?? {}) });
  if (o.importDev !== false) await svc.call('POST', '/import', { format: 'scenario-dir', path: DEV_FIXTURE });
  const client = new Client({ name: 'kt-inquiry', version: '0.0.0' });
  const args = o.mcpArgs ?? ['--quiet-hours', 'off', '--clock', NOON];
  await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(ROOT, 'src/apps/service/mcp.ts'), '--db', db, '--standing-gaps', 'off', ...args], stderr: 'ignore' }));
  const tool = async <T = any>(name: string, a: Record<string, unknown>): Promise<T> => {
    const r = await client.callTool({ name, arguments: a });
    const parsed = JSON.parse((r.content as Array<{ text: string }>)[0]!.text);
    if (r.isError) throw new Error(`${name}: ${parsed.error}`);
    return parsed as T;
  };
  return { svc, client, tool, close: async () => { await client.close(); await svc.close(); rmSync(dir, { recursive: true, force: true }); } };
}

const applicabilityGap = (gaps: Array<{ id: string; decidesApplicability: boolean }>) => gaps.find((g) => g.decidesApplicability)!;
const personByName = async (r: Rig, name: string): Promise<string> =>
  ((await r.svc.call('GET', '/directory')) as Array<{ personEntityId: string; name: string }>).find((p) => p.name === name)!.personEntityId;
const recipientPrincipal = (r: Rig, id: string) => {
  const p = r.svc.engine.store.get('entity', id)!;
  return human(p.id, p.name, []);
};

/** Every key anywhere in a JSON value. */
function keysOf(v: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(v)) v.forEach((x) => keysOf(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { out.add(k); keysOf(x, out); }
  return out;
}
function numbersIn(v: unknown, path = '', out: string[] = []): string[] {
  if (typeof v === 'number') out.push(path);
  else if (Array.isArray(v)) v.forEach((x, i) => numbersIn(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) numbersIn(x, `${path}.${k}`, out);
  return out;
}

test('kt_list_gaps: open gaps with what they decide, who could answer, and a confidence block of labels without any number', async () => {
  const r = await rig();
  try {
    const { investigationId } = await r.tool('kt_investigate', { text: TEXT, principal: AGENT });
    const g = await r.tool('kt_list_gaps', { investigationId, principal: AGENT });
    assert.equal(g.investigationId, investigationId);
    const app = applicabilityGap(g.gaps) as any;
    assert.equal(app.decides, 'applicability');
    assert.equal(app.requesterCanCheck, false);
    assert.equal(app.question.templateText, 'Is RTR-203 running software version 4.2.1?');
    assert.ok(app.whoCouldAnswer.length >= 2);
    for (const p of app.whoCouldAnswer) {
      assert.match(p.personEntityId, /^ent_/);
      assert.equal(typeof p.firsthand, 'boolean');
      assert.equal(typeof p.askableNow, 'boolean');
      assert.ok(Array.isArray(p.blockedBy));
    }
    const sup = g.gaps.find((x: { decides: string }) => x.decides === 'support');
    assert.ok(sup, 'the outcome gap decides support');
    // Confidence: labels with reasons and evidence refs, and which gap moves each; never a number.
    assert.equal(g.confidence.applicability.label, 'qualified');
    assert.equal(g.confidence.support.label, 'weak');
    assert.deepEqual(g.confidence.applicability.movedByGapIds, [app.id]);
    assert.deepEqual(g.confidence.support.movedByGapIds, [sup.id]);
    assert.ok(g.confidence.applicability.reasons.some((x: string) => /not yet known/.test(x)));
    assert.ok(g.confidence.support.evidenceRefs.length > 0);
    assert.deepEqual(numbersIn(g.confidence), [], 'no numeric field anywhere in the confidence block');
    const keys = keysOf(g);
    assert.ok(!keys.has('score') && !keys.has('cosine'), 'no score or cosine key in the tool output');
    // Only the starter may list them.
    await assert.rejects(r.tool('kt_list_gaps', { investigationId, principal: { id: 'agent:other', displayName: 'Other', groups: ['noc'] } }), /did not start/);
  } finally {
    await r.close();
  }
});

test('an agent asking for a person who is not a recipient is refused, told who would be asked instead, and nothing is asked', async () => {
  const r = await rig();
  try {
    const { investigationId } = await r.tool('kt_investigate', { text: TEXT, principal: AGENT });
    const g = await r.tool('kt_list_gaps', { investigationId, principal: AGENT });
    const gap = applicabilityGap(g.gaps) as any;
    const maria = await personByName(r, 'Maria Koskinen');
    assert.ok(!gap.whoCouldAnswer.some((p: { personEntityId: string }) => p.personEntityId === maria), 'Maria has no link to RTR-203 and no observing role');
    const c = await r.tool('kt_request_clarification', { investigationId, gapId: gap.id, preferPersonEntityId: maria, principal: AGENT });
    assert.equal(c.status, 'refused');
    assert.ok(c.refused.violations.includes('not-answerable'));
    assert.match(c.reason, /Maria Koskinen cannot be asked about this gap: not a recipient/);
    assert.ok(gap.whoCouldAnswer.some((p: { personEntityId: string }) => p.personEntityId === c.wouldAsk.personEntityId), 'would ask one of the listed recipients');
    assert.equal(c.wouldAsk.gapId, gap.id);
    assert.match(c.reason, new RegExp(`would ask ${c.wouldAsk.name}`));
    assert.equal(c.questionId, undefined);
    const ctx = await r.tool('kt_get_context', { investigationId, principal: AGENT });
    assert.equal(ctx.question, undefined, 'nothing was asked');
    assert.deepEqual(ctx.ids.questionIds, []);
    // The same request with the suggested person goes through, and goes to that person.
    const ok = await r.tool('kt_request_clarification', { investigationId, gapId: gap.id, preferPersonEntityId: c.wouldAsk.personEntityId, principal: AGENT });
    assert.equal(ok.status, 'question-open');
    assert.equal(ok.personEntityId, c.wouldAsk.personEntityId);
    assert.equal(ok.gapId, gap.id);
  } finally {
    await r.close();
  }
});

test('a hallucinated wording is rejected and the template is asked', async () => {
  const r = await rig();
  try {
    const { investigationId } = await r.tool('kt_investigate', { text: TEXT, principal: AGENT });
    const gap = applicabilityGap((await r.tool('kt_list_gaps', { investigationId, principal: AGENT })).gaps) as any;
    const p = await r.tool('kt_propose_question', { investigationId, gapId: gap.id, text: 'Did Matti replace card X-9 on 14 October?', principal: AGENT });
    assert.equal(p.accepted, false);
    assert.ok(p.reasons.length > 0);
    assert.equal(p.usedText, 'Is RTR-203 running software version 4.2.1?');
    const c = await r.tool('kt_request_clarification', { investigationId, gapId: gap.id, principal: AGENT });
    assert.equal(c.status, 'question-open');
    assert.equal(c.text, 'Is RTR-203 running software version 4.2.1?');
    assert.equal(c.wordedBy, undefined);
    const view = await r.svc.call('GET', `/questions/${encodeURIComponent(c.questionId)}`);
    assert.equal(view.wordedBy, undefined);
  } finally {
    await r.close();
  }
});

test('a wording that asks a different question is rejected even when every word is allowed (yes would land on the wrong branch)', async () => {
  const r = await rig();
  try {
    const { investigationId } = await r.tool('kt_investigate', { text: TEXT, principal: AGENT });
    const gap = applicabilityGap((await r.tool('kt_list_gaps', { investigationId, principal: AGENT })).gaps) as any;
    for (const text of [
      'Is RTR-203 running software other than version 4.2.1?',
      'Is RTR-203 running software version 4.2.1 or newer?',
      'Was RTR-203 running software version 4.2.1 before the firmware update?',
      'Should RTR-203 be running software version 4.2.1?',
      'Is RTR-203 still running software version 4.2.1 after the update?',
    ]) {
      const p = await r.tool('kt_propose_question', { investigationId, gapId: gap.id, text, principal: AGENT });
      assert.equal(p.accepted, false, text);
      assert.equal(p.usedText, 'Is RTR-203 running software version 4.2.1?');
    }
    const c = await r.tool('kt_request_clarification', { investigationId, gapId: gap.id, principal: AGENT });
    assert.equal(c.text, 'Is RTR-203 running software version 4.2.1?');
    assert.equal(c.wordedBy, undefined);
  } finally {
    await r.close();
  }
});

test('words the agent put in its own problem text do not widen what its wording may say', async () => {
  const r = await rig();
  try {
    const text = `${TEXT}; reboot core switch SW-999 and call Pekka at 0401234567`;
    const { investigationId } = await r.tool('kt_investigate', { text, principal: AGENT });
    const gap = applicabilityGap((await r.tool('kt_list_gaps', { investigationId, principal: AGENT })).gaps) as any;
    for (const w of [
      'Is RTR-203 running software version 4.2.1 and should Pekka reboot SW-999?',
      'Does RTR-203 reboot core switch SW-999 running software version 4.2.1?',
      'Is RTR-203 running software version 4.2.1 on SW-999?',
      'Is RTR-203 running software version 4.2.1 per 0401234567?',
      'Is the core switch RTR-203 running software version 4.2.1?',
    ]) assert.equal((await r.tool('kt_propose_question', { investigationId, gapId: gap.id, text: w, principal: AGENT })).accepted, false, w);
    assert.equal((await r.tool('kt_propose_question', { investigationId, gapId: gap.id, text: 'Is RTR-203 also running software version 4.2.1?', principal: AGENT })).accepted, true);
  } finally {
    await r.close();
  }
});

test('a valid rewrite is accepted and asked, and the card says it was worded by the agent', async () => {
  const r = await rig();
  try {
    const { investigationId } = await r.tool('kt_investigate', { text: TEXT, principal: AGENT });
    const gap = applicabilityGap((await r.tool('kt_list_gaps', { investigationId, principal: AGENT })).gaps) as any;
    const p = await r.tool('kt_propose_question', { investigationId, gapId: gap.id, text: 'Is RTR-203 also running software version 4.2.1?', principal: AGENT });
    assert.equal(p.accepted, true);
    assert.equal(p.usedText, 'Is RTR-203 also running software version 4.2.1?');
    // A later bad proposal does not erase the accepted one.
    assert.equal((await r.tool('kt_propose_question', { investigationId, gapId: gap.id, text: 'Did Matti replace card X-9 on 14 October?', principal: AGENT })).accepted, false);
    const listed = applicabilityGap((await r.tool('kt_list_gaps', { investigationId, principal: AGENT })).gaps) as any;
    assert.equal(listed.question.agentWording, 'Is RTR-203 also running software version 4.2.1?');
    const c = await r.tool('kt_request_clarification', { investigationId, gapId: gap.id, principal: AGENT });
    assert.equal(c.text, 'Is RTR-203 also running software version 4.2.1?');
    assert.equal(c.wordedBy, 'the agent');
    const view = await r.svc.call('GET', `/questions/${encodeURIComponent(c.questionId)}`);
    assert.equal(view.text, 'Is RTR-203 also running software version 4.2.1?');
    assert.equal(view.wordedBy, 'worded by the agent');
    assert.equal(view.templateText, 'Is RTR-203 running software version 4.2.1?');
    const q = r.svc.engine.store.get('question', c.questionId)!;
    assert.equal(q.candidate.generatedBy.version, 'agent-worded@1');
    assert.equal(q.candidate.phrasing?.by, 'agent');
    // Only the words changed: the consequences are the template's (yes -> applicable, no -> inapplicable).
    assert.match(q.candidate.consequences.yes, /applicable/);
    assert.match(q.candidate.consequences.no, /inapplicable/);
  } finally {
    await r.close();
  }
});

test('batch: three gaps go to three people in one call, nobody over a budget, and the investigation stops at three', async () => {
  const r = await rig({ importDev: false });
  try {
    // Seed: the dev family plus three NOC engineers who may observe equipment facts; a third open gap on the basis case.
    const noc = ['Noora Noc', 'Niko Noc', 'Nea Noc'].map((name, i) => ({ id: `person:directory:noc-${i}`, name, role: 'NOC Engineer', groups: ['noc'], actorIds: [], available: true }));
    r.svc.engine.importData({ format: 'scenario-dir', path: DEV_FIXTURE, directory: { people: noc } });
    const { investigationId } = await r.tool('kt_investigate', { text: TEXT, principal: AGENT });
    const st = r.svc.engine.store.get('investigation', investigationId)!;
    const caseId = parseGapId(st.gaps[0]!.id)!.caseId;
    r.svc.engine.store.put('investigation', {
      ...st,
      gaps: [...st.gaps, {
        id: makeGapId(investigationId, 'missing', caseId, 'unit.age'), description: 'Unknown for this problem: older unit. It decides whether the response from RTR-117 applies.',
        consequential: true, whatAnswerChanges: 'If it is an older unit, the response from RTR-117 becomes applicable; if not, it becomes inapplicable.', targetCondition: { key: 'unit.age', label: 'older unit' }, status: 'open',
      }],
    });
    const g = await r.tool('kt_list_gaps', { investigationId, principal: AGENT });
    const askable = g.gaps.filter((x: { askable: boolean }) => x.askable).map((x: { id: string }) => x.id);
    assert.equal(askable.length, 3, 'three open askable gaps');
    const c = await r.tool('kt_request_clarification', { investigationId, gapIds: askable, principal: AGENT });
    assert.equal(c.status, 'question-open');
    assert.equal(c.questions.length, 3);
    assert.ok(c.questions.every((q: { status: string }) => q.status === 'question-open'), JSON.stringify(c.questions));
    const people = c.questions.map((q: { personEntityId: string }) => q.personEntityId);
    assert.equal(new Set(people).size, 3, 'each gap to its own person');
    assert.deepEqual(c.questions.map((q: { gapId: string }) => q.gapId), askable);
    for (const pid of people) {
      const theirs = r.svc.engine.store.list('question', { where: { personEntityId: pid } });
      assert.equal(theirs.filter((q) => q.status === 'queued' || q.status === 'delivered').length, 1, 'one open question per person');
      assert.ok(theirs.filter((q) => q.deliveredAt?.startsWith('2026-11-07')).length <= 3, 'daily limit');
    }
    // Status is polled per question.
    for (const q of c.questions) assert.equal((await r.tool('kt_clarification_status', { questionId: q.questionId, principal: AGENT })).status, 'delivered');
    // The investigation has its three questions: another batch asks nobody, and a single request returns an open one.
    const again = await r.tool('kt_request_clarification', { investigationId, gapIds: askable.slice(0, 1), principal: AGENT });
    assert.equal(again.status, 'exhausted');
    assert.equal(r.svc.engine.store.list('question').filter((q) => q.candidate.investigationId === investigationId).length, 3);
    const single = await r.tool('kt_request_clarification', { investigationId, principal: AGENT });
    assert.equal(single.status, 'question-open');
    assert.ok(people.includes(single.personEntityId));
    // At most three gaps per call (the tool's schema refuses a fourth).
    await assert.rejects(r.tool('kt_request_clarification', { investigationId, gapIds: [...askable, 'gap|x|missing|y|z'], principal: AGENT }));
  } finally {
    await r.close();
  }
});

test('a No lowers applicability to inapplicable: the next kt_investigate and kt_get_context say so, and no gap stays open', async () => {
  const r = await rig();
  try {
    const { investigationId } = await r.tool('kt_investigate', { text: TEXT, principal: AGENT });
    const gap = applicabilityGap((await r.tool('kt_list_gaps', { investigationId, principal: AGENT })).gaps) as any;
    const c = await r.tool('kt_request_clarification', { investigationId, gapId: gap.id, principal: AGENT });
    assert.equal(c.status, 'question-open');
    await r.svc.call('POST', `/questions/${encodeURIComponent(c.questionId)}/answer`, { principal: recipientPrincipal(r, c.personEntityId), value: 'no' });
    const st = await r.tool('kt_clarification_status', { questionId: c.questionId, principal: AGENT });
    assert.equal(st.status, 'answered');
    assert.equal(st.answer.value, 'no');
    const ctx = await r.tool('kt_get_context', { investigationId, principal: AGENT });
    assert.equal(ctx.recommendation.kind, 'retain-uncertainty');
    const caseId = parseGapId(gap.id)!.caseId;
    assert.ok(ctx.hypotheses.some((h: { applicability: string }) => h.applicability === 'inapplicable'));
    const again = await r.tool('kt_investigate', { text: TEXT, principal: AGENT });
    assert.equal(again.investigationId, investigationId);
    assert.equal(again.recommendation.kind, 'retain-uncertainty');
    const g = await r.tool('kt_list_gaps', { investigationId, principal: AGENT });
    assert.deepEqual(g.gaps, [], 'no open gap after a No');
    assert.equal(g.confidence.caseId, caseId);
    assert.equal(g.confidence.applicability.label, 'inapplicable');
    assert.ok(g.confidence.applicability.reasons.some((x: string) => /conflict on distinguishing/.test(x)));
    assert.ok(g.confidence.applicability.settledBy.some((s: { gapId: string; answerId?: string }) => s.gapId === gap.id));
    assert.deepEqual(numbersIn(g.confidence), []);
  } finally {
    await r.close();
  }
});

test('kt_store_health equals a hand computation on a tiny store, and an outsider counts fewer cases', async () => {
  const r = await rig({ importDev: false });
  try {
    // One restricted thread (the RTR-117 case, group core) and one organization-wide family thread.
    await r.svc.call('POST', '/import', { format: 'teams-json', path: join(DEV_FIXTURE, 'teams.json'), accessGroups: ['core'] });
    await r.svc.call('POST', '/import', { format: 'teams-json', path: join(SCENARIOS, 'fan-temperature', 'sources', 'teams.json') });
    const inside = await r.tool('kt_store_health', { principal: { id: 'agent:in', displayName: 'Inside agent', groups: ['core'] } });
    const outside = await r.tool('kt_store_health', { principal: { id: 'agent:out', displayName: 'Outside agent', groups: [] } });
    assert.ok(outside.denominators.cases < inside.denominators.cases, 'an outsider sees fewer cases');
    assert.equal(inside.denominators.cases, outside.denominators.cases + 1);
    assert.ok(!outside.cases.some((c: { title: string }) => c.title.startsWith('RTR-117')));
    // The restricted case, by hand: symptom 1, distinguishing 1 of 4 keys known, attempt 1, outcome 1, lasting 0, validity 0.
    const rtr = inside.cases.find((c: { title: string }) => c.title.startsWith('RTR-117'));
    assert.deepEqual(rtr.slots, { symptom: 1, distinguishing: 0.25, attempt: 1, outcome: 1, lasting: 0, validity: 0 });
    assert.equal(rtr.completeness, Math.round((3.25 / 6) * 10_000) / 10_000);
    for (const h of [inside, outside]) {
      // Nothing retrieved: store completeness is the plain mean of the cases' slot sums / 6.
      assert.equal(h.denominators.retrievals, 0);
      const byHand = h.cases.reduce((n: number, c: { slots: Record<string, number> }) => n + Object.values(c.slots).reduce((a, b) => a + b, 0) / 6, 0) / h.cases.length;
      assert.ok(Math.abs(h.completeness - byHand) <= 0.0001, `${h.completeness} vs ${byHand} (per-case values are rounded to 4 places)`);
      assert.equal(h.singletons, h.cases.filter((c: { slots: Record<string, number> }) => Object.values(c.slots).filter((x) => x >= 1).length <= 2).length);
      const d = h.denominators;
      assert.equal(h.correctness, d.caseClaims ? Math.round(((d.supportedClaims - d.contradictedCited - d.linksWithoutAnswer) / d.caseClaims) * 10_000) / 10_000 : null);
      assert.equal(typeof h.standingGaps.open, 'number');
    }
    assert.ok(outside.denominators.caseClaims < inside.denominators.caseClaims);
  } finally {
    await r.close();
  }
});

test('03:00 -> 07:30 on the demo clock: the preferred person\'s question is queued by quiet hours, delivered at 07:30, then answered', async () => {
  const r = await rig({
    svc: { clock: undefined, coordinator: { quietHours: defaultQuietHours } },
    mcpArgs: ['--quiet-hours', 'on', '--clock', '2026-11-08T01:00:00Z'],
  });
  try {
    const { investigationId } = await r.tool('kt_investigate', { text: TEXT, principal: AGENT });
    const g = await r.tool('kt_list_gaps', { investigationId, principal: AGENT });
    assert.equal(g.quietHours.now, true);
    assert.equal(g.quietHours.heldUntil, '2026-11-08T05:00:00.000Z');
    const gap = applicabilityGap(g.gaps) as any;
    const olli = gap.whoCouldAnswer.find((p: { name: string }) => p.name === 'Olli Rautio');
    assert.ok(olli && olli.askableNow, 'quiet hours hold a question, they do not block the person');
    const c = await r.tool('kt_request_clarification', { investigationId, gapId: gap.id, preferPersonEntityId: olli.personEntityId, principal: AGENT });
    assert.equal(c.status, 'question-open');
    assert.equal(c.personEntityId, olli.personEntityId);
    assert.equal(c.questionStatus, 'queued');
    assert.equal(c.deliverAfter, '2026-11-08T05:00:00.000Z');
    assert.equal(c.loopReason, 'Queued until 07:00: nobody is woken at night');
    const inbox = (await r.svc.call('GET', `/questions?personEntityId=${encodeURIComponent(olli.personEntityId)}`)) as Array<{ questionId: string }>;
    assert.ok(!inbox.some((q) => q.questionId === c.questionId), 'nobody is woken at 03:00');

    await r.svc.call('POST', '/demo/clock', { now: '2026-11-08T05:30:00Z' });
    const later = (await r.svc.call('GET', `/questions?personEntityId=${encodeURIComponent(olli.personEntityId)}`)) as Array<{ questionId: string; status: string }>;
    assert.equal(later.find((q) => q.questionId === c.questionId)?.status, 'delivered');
    assert.equal((await r.tool('kt_clarification_status', { questionId: c.questionId, principal: AGENT })).status, 'delivered');
    await r.svc.call('POST', `/questions/${encodeURIComponent(c.questionId)}/answer`, { principal: recipientPrincipal(r, olli.personEntityId), value: 'yes' });
    const st = await r.tool('kt_clarification_status', { questionId: c.questionId, principal: AGENT });
    assert.equal(st.status, 'answered');
    assert.equal(st.answer.value, 'yes');
    const after = await r.tool('kt_list_gaps', { investigationId, principal: AGENT });
    assert.equal(after.confidence.applicability.label, 'applicable');
    assert.ok(!after.gaps.some((x: { id: string }) => x.id === gap.id));
  } finally {
    await r.svc.call('POST', '/demo/clock', {}).catch(() => undefined);
    await r.close();
  }
});
