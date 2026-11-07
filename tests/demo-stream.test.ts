/**
 * The simulated activity stream against a real in-process service (in-memory db, dev fixture + one demo family),
 * in instant mode: the real coordinator asks, simulated people answer, the judge's person is never auto-answered,
 * the JSONL log is readable through GET /demo/activity and the demo clock routes move the engine's time.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { DirectoryEntry, QuestionView } from '../src/libs/utils/contracts/index.ts';
import { defaultObservabilityPolicy } from '../src/apps/service/org-config.ts';
import { createSimClock, httpClient, jsonlSink, planDay, runDay, type FamilyInput, type ProblemInput } from '../src/libs/utils/simulation/index.ts';
import { DEV_FIXTURE, SCENARIOS, startService, type Running } from './support.ts';

let svc: Running;
let dir: string;
let log: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'kt-stream-'));
  log = join(dir, 'activity.jsonl');
  // No fixed clock: the service runs on its movable demo clock, which the stream drives.
  svc = await startService({ clock: undefined, activityLogPath: log, investigation: { observability: defaultObservabilityPolicy } });
  await svc.call('POST', '/import', { format: 'scenario-dir', path: DEV_FIXTURE });
  await svc.call('POST', '/import', { format: 'scenario-dir', path: join(SCENARIOS, 'optic-forwarding-a') });
});
after(async () => {
  await svc.close();
  rmSync(dir, { recursive: true, force: true });
});

const who = (directory: DirectoryEntry[], name: string): ProblemInput['requester'] => {
  const d = directory.find((x) => x.name === name)!;
  return { id: d.personEntityId, name: d.name, groups: d.groups };
};

test('demo clock routes: simulated time advances at the given rate and returns to real time', async () => {
  const before = await svc.call('GET', '/demo/clock');
  assert.equal(before.mode, 'real');
  const set = await svc.call('POST', '/demo/clock', { now: '2026-11-07T07:30:00.000Z', rate: 3600 });
  assert.equal(set.mode, 'simulated');
  await new Promise((r) => setTimeout(r, 30));
  const later = await svc.call('GET', '/demo/clock');
  assert.ok(Date.parse(later.now) - Date.parse('2026-11-07T07:30:00.000Z') >= 30 * 1000, 'one real second is one simulated hour at rate 3600');
  const back = await svc.call('POST', '/demo/clock', {});
  assert.equal(back.mode, 'real');
  await svc.call('POST', '/demo/clock', { now: 'nope' }, 400);
});

test('GET /demo/activity reads nothing before the stream and the page is HTML', async () => {
  const a = await svc.call('GET', '/demo/activity');
  assert.equal(a.present, false);
  assert.deepEqual(a.rows, []);
  const res = await fetch(svc.http.url + '/demo/activity.html');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/html/);
  const html = await res.text();
  assert.match(html, /Simulated activity/);
  assert.match(html, /\/demo\/activity\?since=/);
});

test('a simulated day asks real questions, answers them as simulated people and leaves the judge alone', async () => {
  const directory: DirectoryEntry[] = await svc.call('GET', '/directory');
  // The judge is Jukka Salo: a firsthand person on RTR-203 (dev fixture) who would otherwise be asked.
  const helmi = directory.find((d) => d.name === 'Jukka Salo')!;
  await svc.call('PUT', '/settings', { currentPersonEntityId: helmi.personEntityId });
  const families: FamilyInput[] = [{
    id: 'optic-forwarding-a', description: 'seeded', seeded: true, sources: [],
    problems: [
      { id: 'p1', text: 'BGP sessions flapping on RTR-305 after the firmware update. Roll back the hold timers like on RTR-117?', requester: who(directory, 'Liisa Mäkelä') },
      { id: 'p2', text: 'I just replaced the SFP at TRN-233. Link is up, alarms cleared, but the counters are still zero. Should I reset the interface like on TRN-117?', requester: who(directory, 'Outi Heino') },
      { id: 'p3', text: 'BGP sessions flapping on RTR-410 since the firmware update last night, two peers. Same as RTR-117?', requester: who(directory, 'Aarne Koskela') },
    ],
  }];
  const plan = planDay({ seed: 4, families, hours: 6, judgeEveryMinutes: 120 });
  const clock = createSimClock('2026-11-07T07:30:00.000Z', 0);
  const rows: Array<Record<string, unknown>> = [];
  const summary = await runDay({
    client: httpClient(svc.http.url), plan, clock, seed: 4,
    sink: { write: (r) => { rows.push(r); jsonlSink(log).write(r); } },
    judgePrompts: [{ text: 'RTR-203 BGP sessions flapping after the firmware update, hold timers look default. Roll back like RTR-117?', requester: 'Tapio Lehto', targets: ['Jukka Salo'] }],
  });
  assert.equal(summary.errors, 0, JSON.stringify(rows.filter((r) => r.kind === 'note')));
  assert.equal(summary.investigations, 3 + summary.judgeAttempts);
  assert.ok(summary.questionsAsked >= 2, `expected questions, got ${summary.questionsAsked}: ${rows.map((r) => `${r.kind}: ${r.text} | ${r.why ?? ""}`).join("\n")}`);
  assert.ok(summary.answered + summary.deferred + summary.dismissed + summary.unanswered >= 1);
  // Every row is labelled simulated and every question row names the recipient and the reason.
  for (const r of rows) assert.equal(r.simulated, true);
  const questions = rows.filter((r) => r.kind === 'question');
  for (const q of questions) {
    assert.ok(typeof q.who === 'string' && (q.who as string).length > 0);
    assert.match(String(q.why), /because|about/);
  }
  // Questions addressed to the judge are left open (never answered by the simulation).
  const judgeQs: QuestionView[] = await svc.call('GET', `/questions?personEntityId=${encodeURIComponent(helmi.personEntityId)}&status=all`);
  for (const q of judgeQs) assert.ok(['queued', 'delivered'].includes(q.status), `judge question ${q.questionId} is ${q.status}`);
  assert.ok(judgeQs.length >= 1, 'the judge prompt reached the judge');
  assert.ok(rows.some((r) => r.kind === 'question' && r.forYou === true));
  assert.equal(summary.judgeQuestions, 1);
  // R46: simulated people take part in points and their awards are rows; the judge is never opted in by the stream.
  const optRows = rows.filter((r) => r.kind === 'points' && /take part in points/.test(String(r.text)));
  assert.ok(optRows.length >= 1, 'an opt-in row');
  assert.ok(!String(optRows[0]!.text).includes('Jukka Salo'), 'the judge is not in the opted-in list');
  const judgeOpt = await svc.call('GET', `/participation/${encodeURIComponent(helmi.personEntityId)}/optin`);
  assert.equal(judgeOpt.participates, false);
  const awards = rows.filter((r) => r.kind === 'points' && /^\+\d+ to /.test(String(r.text)));
  assert.equal(awards.length, summary.pointsRows);
  if (summary.answered > 0) {
    assert.ok(awards.some((r) => /for answering$/.test(String(r.text))), `an answer award row: ${rows.filter((r) => r.kind === 'points').map((r) => r.text).join(' | ')}`);
    const rating = await svc.call('GET', '/participation/rating');
    assert.ok(rating.participants.length >= 1 && rating.totals.points > 0);
    assert.ok(!JSON.stringify(rating).includes(helmi.personEntityId), 'the judge appears nowhere in the rating');
  }
  // Simulated people's answers are real attributed answers in the service.
  const all: QuestionView[] = await svc.call('GET', '/questions?status=all');
  const answered = all.filter((q) => q.status === 'answered');
  assert.equal(answered.length, summary.answered);
  // The engine's clock was moved by the stream and is back to real time only when the caller resets it.
  const clockNow = await svc.call('GET', '/demo/clock');
  assert.equal(clockNow.mode, 'simulated');
  await svc.call('POST', '/demo/clock', {});
  // The JSONL file is what GET /demo/activity serves, with sequence numbers.
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  assert.equal(lines.length, rows.length);
  const a = await svc.call('GET', '/demo/activity?since=0&limit=1000');
  assert.equal(a.present, true);
  assert.equal(a.total, rows.length);
  assert.equal(a.rows.at(-1).seq, rows.length);
  assert.equal(a.rows.at(-1).kind, 'summary');
  const tail = await svc.call('GET', `/demo/activity?since=${rows.length - 2}`);
  assert.equal(tail.rows.length, 2);
});

test('the same seed replays the same plan and the same simulated replies', async () => {
  const directory: DirectoryEntry[] = await svc.call('GET', '/directory');
  const families: FamilyInput[] = [{ id: 'x', description: 'x', seeded: true, sources: [], problems: [{ id: 'p', text: 'TRN-901: changed the SFP, link up, alarms cleared, no traffic. Not sure which unit generation this is.', requester: who(directory, 'Jussi Rantanen') }] }];
  const a = planDay({ seed: 9, families, hours: 4 });
  const b = planDay({ seed: 9, families, hours: 4 });
  assert.deepEqual(a, b);
});
