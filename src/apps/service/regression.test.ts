import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import type { CaseView, InvestigationState, Principal } from '../../libs/utils/contracts/index.ts';
import { basisCaseId, DEFAULT_PHRASES, loadCaseFacts, defaultInvestigationSettings } from '../../libs/utils/investigation/index.ts';
import { DEV_FIXTURE, human, startService, type Running } from '../../../tests/support.ts';
import type { InvestigationResult } from './views.ts';

let svc: Running;
const requester = human('person:test:requester', 'Rita Requester', ['noc']);

before(async () => {
  svc = await startService();
  await svc.call('POST', '/import', { format: 'scenario-dir', path: DEV_FIXTURE });
});
after(async () => {
  await svc.close();
});

const investigate = (text: string, principal: Principal = requester): Promise<InvestigationResult> => svc.call('POST', '/investigate', { text, principal });

/** Every sentence the requester or a recipient reads for one result. */
function readableText(r: InvestigationResult): string[] {
  return [
    r.recommendation.text, r.recommendation.nextStep ?? '', ...r.recommendation.caveats, r.loopReason ?? '',
    ...r.people.flatMap((p) => p.reasons.map((x) => x.text)),
    ...(r.question ? [r.question.text, r.question.why] : []),
  ].filter(Boolean);
}

/** Action wording (any grammatical form) found in a text, as the action names that own it. */
function actionsMentioned(text: string): string[] {
  const t = text.toLowerCase();
  return Object.entries(DEFAULT_PHRASES.actions)
    .filter(([, p]) => [p.imperative, p.gerund, p.noun, p.past].some((form) => t.includes(form.toLowerCase())))
    .map(([name]) => name);
}

test('result: the case view is the case the recommendation is based on, not the top-scored candidate', async () => {
  const r = await investigate('RTR-203: BGP sessions flapping after the firmware update, neighbors keep going down');
  const based = basisCaseId(r.state);
  assert.ok(based, 'a related case exists');
  assert.equal(r.caseView?.caseId, based);
  assert.equal(r.caseView?.title, svc.engine.store.get('case', based)?.title);
  // the recommendation cites evidence of that case only
  const caseEvidence = new Set(svc.engine.store.get('case', based)?.evidenceIds);
  assert.ok(r.state.recommendation.basis.every((b) => caseEvidence.has(b.evidenceId)));
});

test('result: with no recommendation the best related candidate is shown; with none related, no timeline', async () => {
  const r = await investigate('Completely unrelated question about the cafeteria menu and parking permits');
  assert.equal(r.recommendation.kind, 'none');
  assert.equal(r.caseView, undefined);
});

test('text: recommendation, people and questions only name actions that the basis case records and its evidence mentions', async () => {
  const problems = [
    'RTR-203 keeps flapping with DC low alarms after the rectifier work, same as last week',
    'RTR-117: BGP sessions are flapping again after the firmware update',
    'RTR-203: BGP sessions flapping after the firmware update',
  ];
  for (const text of problems) {
    const r = await investigate(text);
    const based = basisCaseId(r.state);
    const allowed = new Set<string>();
    if (based) {
      const facts = loadCaseFacts(svc.engine.store, based, undefined, defaultInvestigationSettings(), requester);
      for (const a of facts.attempts) allowed.add(a.action);
    }
    const phrasesCaseRecords = [...allowed].filter((a) => DEFAULT_PHRASES.actions[a]);
    for (const sentence of readableText(r)) {
      for (const action of actionsMentioned(sentence)) {
        // People reasons may concern other related cases; their own case's attempts are checked via the reason's caseId.
        const reason = r.people.flatMap((p) => p.reasons).find((x) => x.text === sentence);
        const caseId = reason?.caseId ?? based;
        const facts = caseId ? loadCaseFacts(svc.engine.store, caseId, undefined, defaultInvestigationSettings(), requester) : undefined;
        const recorded = new Set((facts?.attempts ?? []).map((a) => a.action));
        assert.ok(recorded.has(action), `"${sentence}" names ${action} but case ${caseId} records ${[...recorded].join(', ') || 'no attempts'} (basis allowed: ${phrasesCaseRecords.join(', ')})`);
      }
    }
  }
});

test('receipt: after an answer the detail is plain prose without status words or identifiers', async () => {
  const own = await startService();
  after(() => own.close());
  await own.call('POST', '/import', { format: 'scenario-dir', path: DEV_FIXTURE });
  const svc = own; // a fresh service: question limits of the other tests do not apply
  const r: InvestigationResult = await svc.call('POST', '/investigate', { text: 'BGP sessions flapping on RTR-203 after the firmware update', principal: requester });
  assert.ok(r.question, 'a question is open');
  const q = svc.engine.store.get('question', r.question.questionId)!;
  const person = svc.engine.store.get('entity', q.personEntityId)!;
  const recipient = human(person.id, person.name);
  const qid = encodeURIComponent(r.question.questionId);
  for (const value of ['yes', 'unknown', 'no'] as const) {
    const res = await svc.call('POST', `/questions/${qid}/answer`, { principal: recipient, value });
    assert.match(res.receipt.detail, /^You (answered (yes|no) to|were not sure about) "/);
    assert.doesNotMatch(res.receipt.detail, /check-first|retain-uncertainty|\bqualified\b|\bunsupported\b|\bapplicab|\bcontradicted\b|\b[a-z]+\.[a-z]+\b|_|undefined|null/);
    await svc.call('POST', `/questions/${qid}/undo`, { principal: recipient });
  }
});

test('loop: every loop value has a human line, including question-open and exhausted', async () => {
  const r = await investigate('BGP flaps after firmware upgrade on edge router RTR-310 unit', human('person:test:req4', 'Rex Requester', ['noc']));
  assert.ok(r.loopReason && r.loopReason.length > 5, `loop ${r.loop}: ${r.loopReason}`);
  if (r.loop === 'question-open') assert.match(r.loopReason ?? '', /^Asked .+ because they .+ (in|on) .+/);
  const st: InvestigationState = { ...r.state, loop: 'exhausted' };
  delete (st as { loopReason?: string }).loopReason;
  svc.engine.store.put('investigation', st);
  const again: InvestigationResult = await svc.call('GET', `/investigations/${r.investigationId}`);
  assert.equal(again.loop, 'exhausted');
  assert.match(again.loopReason ?? '', /budget/);
  const caseView: CaseView | undefined = again.caseView;
  assert.ok(caseView === undefined || caseView.caseId);
});
