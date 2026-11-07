import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { DirectoryEntry } from '../contracts/index.ts';
import { createRng } from '../models/index.ts';
import { formatRow } from './activity.ts';
import { createSimClock, hhmm } from './clock.ts';
import { buildProfiles, decideReply, topicOf } from './people.ts';
import { planDay, type FamilyInput } from './schedule.ts';

const directory: DirectoryEntry[] = [
  { personEntityId: 'p:erkki', name: 'Erkki Expert', role: 'Network Expert', groups: [], available: true },
  { personEntityId: 'p:veikko', name: 'Veikko Vikkelä', role: 'Field Engineer', groups: ['field'], available: true },
  { personEntityId: 'p:outi', name: 'Outi Heino', role: 'NOC Team Lead', groups: ['noc'], available: true },
];

test('profiles are deterministic in the seed and follow roles', () => {
  const a = buildProfiles(directory, 7);
  const b = buildProfiles([...directory].reverse(), 7);
  assert.deepEqual([...a.entries()], [...b.entries()], 'directory order does not matter');
  const c = buildProfiles(directory, 8);
  assert.notDeepEqual([...a.values()].map((p) => p.knows), [...c.values()].map((p) => p.knows));
  const erkki = a.get('p:erkki')!;
  assert.ok(erkki.firsthandFor.includes('unit.age') && !erkki.firsthandFor.includes('site.access'));
  assert.ok(a.get('p:veikko')!.firsthandFor.includes('site.access'));
  for (const p of a.values()) assert.ok(p.responsiveness >= 0.55 && p.responsiveness <= 0.95);
});

test('topicOf maps question wording to a simulated knowledge topic', () => {
  assert.equal(topicOf('Is TRN-301 an older unit?'), 'unit.age');
  assert.equal(topicOf('Is ACC-12 an N5?'), 'unit.model');
  assert.equal(topicOf('Is RTR-117 running software version 4.2.1?'), 'software.version');
  assert.equal(topicOf('Did traffic return right after the interface reset on TRN-042?'), 'outcome');
  assert.equal(topicOf('Is this true for ACC-12: controller revision A?'), 'unit.revision');
  assert.equal(topicOf('Something else entirely?'), 'other');
});

test('replies are reproducible for a seed and never outside the companion vocabulary', () => {
  const profiles = buildProfiles(directory, 3);
  const seq = (seed: number) => {
    const draw = createRng(seed);
    return [...profiles.values()].flatMap((p) => Array.from({ length: 6 }, () => decideReply(p, 'Is TRN-301 an older unit?', draw)));
  };
  const a = seq(1);
  assert.deepEqual(a, seq(1));
  assert.notDeepEqual(a, seq(2));
  const allowed = new Set(['yes', 'no', 'unknown', 'later', 'dismiss', 'none']);
  for (const r of a) {
    assert.ok(allowed.has(r.action));
    assert.ok(r.delayMinutes >= 0 && r.delayMinutes <= 40);
    if (r.action === 'later' && r.followUpMinutes !== undefined) assert.ok(r.followUpMinutes >= 45 && r.followUp !== undefined);
  }
  // Someone who knows the topic answers yes/no when responding; someone who does not says "not sure".
  const knower = { ...profiles.get('p:erkki')!, responsiveness: 1, knows: { 'unit.age': 'no' as const } };
  assert.equal(decideReply(knower, 'Is TRN-301 an older unit?', createRng(5)).action, 'no');
  const blank = { ...knower, knows: {} };
  assert.equal(decideReply(blank, 'Is TRN-301 an older unit?', createRng(5)).action, 'unknown');
});

const fam = (id: string, seeded: boolean, n: number): FamilyInput => ({
  id, description: id, seeded,
  ...(seeded ? {} : { directory: { people: [] } }),
  sources: seeded ? [] : [{ format: 'teams-json', payload: {}, label: 'Teams thread' }, { format: 'email-text', payload: 'x', label: 'E-mail' }],
  problems: Array.from({ length: n }, (_, i) => ({ id: `${id}-p${i + 1}`, text: `problem ${i + 1} of ${id}`, requester: { id: `p:${id}`, name: id, groups: [] } })),
});

test('planDay is deterministic, keeps arrivals before their problems and spaces judge slots', () => {
  const families = [fam('seeded-a', true, 3), fam('arriving-b', false, 2), fam('arriving-c', false, 2)];
  const plan = planDay({ seed: 1, families, hours: 8, judgeEveryMinutes: 120 });
  assert.deepEqual(plan, planDay({ seed: 1, families, hours: 8, judgeEveryMinutes: 120 }));
  assert.notDeepEqual(plan.events.map((e) => e.at), planDay({ seed: 2, families, hours: 8, judgeEveryMinutes: 120 }).events.map((e) => e.at));
  const times = plan.events.map((e) => e.at);
  assert.deepEqual(times, [...times].sort((a, b) => a - b));
  assert.ok(times.every((t) => t >= 0 && t <= 8 * 60));
  for (const f of ['arriving-b', 'arriving-c']) {
    const lastSource = Math.max(...plan.events.filter((e) => e.kind === 'evidence' && e.family === f).map((e) => e.at));
    const firstProblem = Math.min(...plan.events.filter((e) => e.kind === 'investigate' && e.family === f).map((e) => e.at));
    const dir = plan.events.find((e) => e.kind === 'directory' && e.family === f)!;
    assert.ok(dir.at <= lastSource && lastSource < firstProblem, `${f}: directory, then sources, then problems`);
  }
  const slots = plan.events.filter((e) => e.kind === 'judge-slot').map((e) => e.at);
  assert.ok(slots.length >= 3);
  for (let i = 1; i < slots.length; i++) assert.equal(slots[i]! - slots[i - 1]!, 120);
  assert.equal(plan.events.filter((e) => e.kind === 'investigate').length, 7);
  // A short day still fits every arrival and problem inside it, in order.
  const short = planDay({ seed: 3, families: [fam('a', false, 3), fam('b', false, 3), fam('c', false, 3), fam('d', false, 3)], hours: 1.5 });
  assert.ok(short.events.every((e) => e.at <= 90 && e.at >= 0));
  for (const f of ['a', 'b', 'c', 'd']) {
    const src = short.events.filter((e) => e.kind === 'evidence' && e.family === f).map((e) => e.at);
    const prob = short.events.filter((e) => e.kind === 'investigate' && e.family === f).map((e) => e.at);
    assert.ok(Math.max(...src) <= Math.min(...prob), `${f}: sources before problems on a short day`);
  }
});

test('the simulated clock advances in steps and waits the scaled real time', async () => {
  const waits: number[] = [];
  const clock = createSimClock('2026-11-07T07:30:00.000Z', 10, async (ms) => { waits.push(ms); });
  assert.equal(clock.rate, 360);
  await clock.advanceTo(Date.parse('2026-11-07T08:00:00.000Z'));
  assert.deepEqual(waits, [5000], 'half a simulated hour is 5 real seconds at 10 s per hour');
  assert.equal(clock.minutes(), 30);
  await clock.advanceTo(Date.parse('2026-11-07T07:45:00.000Z'));
  assert.equal(clock.minutes(), 30, 'never moves backwards');
  const instant = createSimClock('2026-11-07T07:30:00.000Z', 0, async (ms) => { waits.push(ms); });
  await instant.advanceTo(Date.parse('2026-11-07T17:30:00.000Z'));
  assert.equal(waits.length, 1, 'instant mode never sleeps');
  assert.equal(instant.rate, 1);
  assert.throws(() => createSimClock('nope', 10));
});

test('terminal rows carry time, kind, text, reason and the for-you marker', () => {
  const at = new Date(2026, 10, 7, 9, 14).toISOString();
  const line = formatRow({ at, real: at, kind: 'question', text: 'Asked Erkki Expert: "Is TRN-301 an older unit?"', why: 'because they can observe this through their role', simulated: true, forYou: true });
  assert.equal(line, `${hhmm(at)}  question      Asked Erkki Expert: "Is TRN-301 an older unit?"  · because they can observe this through their role  [for you]`);
  assert.equal(hhmm(at), '09:14');
});
