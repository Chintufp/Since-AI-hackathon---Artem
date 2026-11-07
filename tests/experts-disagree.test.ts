/**
 * B5 "experts disagree" (BUILD_BRIEF section 4; DECISIONS-disagree.md). Expert A's case (Elisa's TRN-042 when the
 * git-ignored files are present, else an inline synthetic older-units thread) and Helmi Virtanen's generated TRN-512
 * thread (data/demo/experts-disagree). A problem on a unit of unknown batch gets two qualified hypotheses with different
 * advisers and ONE question, "Is TRN-577 from the 2021 batch?"; the answer picks the branch and neither expert's case is
 * overwritten. No model, no network.
 */
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { stableId, type Principal } from '../src/libs/utils/contracts/index.ts';
import { Engine } from '../src/apps/service/engine.ts';
import { agentResult } from '../src/apps/service/mcp-tools.ts';
import { defaultObservabilityPolicy } from '../src/apps/service/org-config.ts';
import { ROOT } from './support.ts';

const ELISA = join(ROOT, 'private/Elisa_SinceAI2026/ELISA_HIDDEN_KNOWLEDGE_EXAMPLE_2026/teams_chat.json');
const useElisa = existsSync(ELISA) && !process.env.KT_TEST_NO_PRIVATE;
const DISAGREE = join(ROOT, 'data/demo/experts-disagree');
const PROBLEM = 'Replaced the SFP on TRN-577, link up, alarms cleared, no traffic, counters zero. Not sure which batch this unit is from.';
const REQUESTER: Principal = { id: 'person:test:sanna-lind', displayName: 'Sanna Lind', groups: ['field'], type: 'human' };

/** Synthetic stand-in for expert A (no organizer names): older units -> disable and re-enable the interface. */
const OLDER_UNITS_THREAD = {
  channel: 'teams-test-older-units',
  participants: [{ name: 'Ville Ranta', role: 'Field Engineer' }, { name: 'Pekka Laine', role: 'Network Expert' }],
  messages: [
    { seq: 1, time: '10:02', author: 'Ville Ranta', role: 'Field Engineer', text: 'Hi Pekka, at the site. Changed the SFP on transmission node TRN-233.\nLink is up and alarms cleared, but traffic is still not coming back.' },
    { seq: 2, time: '10:04', author: 'Pekka Laine', role: 'Network Expert', text: 'Is this one of the older units?' },
    { seq: 3, time: '10:05', author: 'Ville Ranta', role: 'Field Engineer', text: 'Yes, it is one of the older units.' },
    { seq: 4, time: '10:07', author: 'Pekka Laine', role: 'Network Expert', text: 'Sometimes after changing the SFP the forwarding state does not recover on those.\nDisable the interface, wait a little, then enable it again.' },
    { seq: 5, time: '10:15', author: 'Ville Ranta', role: 'Field Engineer', text: 'Did that. Traffic is back.' },
  ],
};
const EXPERT_A = useElisa ? { name: 'Erkki Expert', asset: 'TRN-042' } : { name: 'Pekka Laine', asset: 'TRN-233' };

function engine(): Engine {
  const e = new Engine({ dbPath: ':memory:', investigation: { observability: defaultObservabilityPolicy } });
  e.setClock({ now: '2026-11-07T10:00:00.000Z' });
  if (useElisa) e.importData({ format: 'teams-json', path: ELISA, connectionId: 'import:teams:file' });
  else e.importData({ format: 'teams-json', payload: OLDER_UNITS_THREAD, connectionId: 'import:teams:test' });
  e.importData({ format: 'scenario-dir', path: DISAGREE });
  return e;
}

const caseOf = (e: Engine, asset: string) => e.store.list('case').find((c) => c.title.startsWith(asset))!;
/** What each expert's case says (claim id, type, statement, who said it): must survive either answer unchanged. */
const record = (e: Engine, caseId: string) => e.store.list('claim', { where: { caseId } }).map((c) => `${c.id}|${c.type}|${c.statement}|${c.assertedBy?.displayName ?? ''}`).sort();
const hypothesisOf = (state: { id: string; hypotheses: Array<{ id: string; applicability: string; support: string }> }, caseId: string) => state.hypotheses.find((h) => h.id === stableId('hyp', state.id, caseId))!;

async function ask(e: Engine) {
  const r = await e.investigate({ text: PROBLEM, principal: REQUESTER, allowQuestions: true });
  const a = caseOf(e, EXPERT_A.asset);
  const h = caseOf(e, 'TRN-512');
  const before = { a: record(e, a.id), h: record(e, h.id) };
  assert.ok(before.a.length > 0 && before.h.length > 0);
  return { r, a, h, before };
}

async function answer(e: Engine, questionId: string, personEntityId: string, value: 'yes' | 'no', investigationId: string) {
  const who = e.directory().find((d) => d.personEntityId === personEntityId)!;
  await e.answer(questionId, { principal: { id: who.personEntityId, displayName: who.name, groups: who.groups, type: 'human' }, value });
  return e.getInvestigation(investigationId, REQUESTER.id);
}

test(`experts disagree (${useElisa ? 'TRN-042 from private/' : 'inline older-units thread'} + Helmi on the 2021 batch): two qualified hypotheses, one batch question, the answer picks the branch, nothing overwritten`, async () => {
  const e = engine();
  try {
    const { r, a, h, before } = await ask(e);
    // Two related hypotheses, both qualified, with different advisers.
    assert.equal(hypothesisOf(r.state, h.id).applicability, 'qualified');
    assert.equal(hypothesisOf(r.state, a.id).applicability, 'qualified');
    assert.equal(r.caseView?.title, h.title, 'the batch branch is the one asked about');
    const alt = r.alternatives?.find((x) => x.caseId === a.id);
    assert.ok(alt, 'expert A is listed under the recommendation');
    assert.equal(alt.expert.displayName, EXPERT_A.name);
    assert.equal(alt.applicability, 'qualified');
    assert.match(alt.text, new RegExp(`^${EXPERT_A.name} advised disabling and re-enabling the interface in ${EXPERT_A.asset} \\(qualified, depends on older unit\\)$`));
    assert.deepEqual(agentResult(r).alternatives, r.alternatives, 'the MCP result carries the alternatives');
    const helmiAdvised = r.state.people.find((p) => p.displayName === 'Helmi Virtanen')?.reasons.find((x) => x.contribution === 'advised' && x.caseId === h.id);
    assert.ok(helmiAdvised?.firsthand, 'Helmi advised the TRN-512 response firsthand');
    // One open question, about the batch, to someone who is not the requester.
    assert.equal(r.question?.text, 'Is TRN-577 from the 2021 batch?');
    const recipient = r.question.personEntityId!;
    assert.ok(recipient && recipient !== REQUESTER.id);
    const open = e.store.list('question').filter((q) => q.candidate.investigationId === r.investigationId && ['queued', 'delivered', 'pending', 'deferred'].includes(q.status));
    assert.equal(open.length, 1);
    const names = r.people.map((p) => p.name);
    assert.ok(names.includes('Helmi Virtanen') && names.includes(EXPERT_A.name), names.join(', '));

    // Yes: the forwarding-table clear is recommended; expert A's case is still on record.
    const yes = await answer(e, r.question.questionId, recipient, 'yes', r.investigationId);
    assert.equal(yes.recommendation.kind, 'reuse');
    assert.match(yes.recommendation.text, /clearing the forwarding table/);
    assert.equal(hypothesisOf(yes.state, h.id).applicability, 'applicable');
    assert.ok(yes.alternatives?.some((x) => x.caseId === a.id && x.expert.displayName === EXPERT_A.name));
    assert.deepEqual({ a: record(e, a.id), h: record(e, h.id) }, before, 'a yes overwrites neither expert');
  } finally {
    e.close();
  }

  // No (fresh engine): Helmi's case does not apply, expert A's hypothesis becomes the recommendation.
  const f = engine();
  try {
    const { r, a, h, before } = await ask(f);
    assert.equal(r.question?.text, 'Is TRN-577 from the 2021 batch?');
    const no = await answer(f, r.question.questionId, r.question.personEntityId!, 'no', r.investigationId);
    assert.equal(hypothesisOf(no.state, h.id).applicability, 'inapplicable');
    assert.equal(no.caseView?.title, a.title, "expert A's case is now the basis");
    assert.equal(no.recommendation.kind, 'qualified');
    assert.match(no.recommendation.text, /disabling and re-enabling the interface/);
    const helmi = no.alternatives?.find((x) => x.caseId === h.id);
    assert.equal(helmi?.expert.displayName, 'Helmi Virtanen');
    assert.equal(helmi?.text, 'Helmi Virtanen advised clearing the forwarding table in TRN-512 (inapplicable, depends on 2021 batch)');
    assert.deepEqual({ a: record(f, a.id), h: record(f, h.id) }, before, 'a no overwrites neither expert');
  } finally {
    f.close();
  }
});
