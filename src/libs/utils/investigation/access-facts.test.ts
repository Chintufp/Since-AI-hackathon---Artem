import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { Engine } from '../../../apps/service/engine.ts';
import { defaultObservabilityPolicy } from '../../../apps/service/org-config.ts';
import { parseProblemText } from './index.ts';

/** B1 part B: access facts through the investigation (synthetic remote-power-access family + the generated follow-up). */
const ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const FAMILY = join(ROOT, 'data', 'scenarios', 'remote-power-access');
const NEW_CODE = readFileSync(join(ROOT, 'data', 'demo', 'followups', 'email-eino-barrier.txt'), 'utf8');
const P2 = "I'm driving out to RBS-310 tomorrow. What's the barrier code?";
const KAISA = { id: 'person:directory:kaisa-hautala', displayName: 'Kaisa Hautala', groups: ['field'], type: 'human' as const };

async function engine(withFollowUp = true): Promise<Engine> {
  const e = new Engine({ dbPath: ':memory:', clock: () => new Date('2026-11-07T12:00:00Z'), investigation: { observability: defaultObservabilityPolicy } });
  e.importData({ format: 'scenario-dir', path: FAMILY });
  if (withFollowUp) e.importData({ format: 'email-text', payload: NEW_CODE });
  return e;
}

const everything = (r: { recommendation: { text: string; caveats: string[]; nextStep?: string }; people: Array<{ name: string }>; loopReason?: string }): string =>
  [r.recommendation.text, ...r.recommendation.caveats, r.recommendation.nextStep ?? '', r.loopReason ?? '', ...r.people.map((p) => p.name)].join(' | ');

test('parser: a dispatch/access question carries intent.access; an incident report without such words does not', () => {
  assert.equal(parseProblemText(P2, 'p').conditions.find((c) => c.key === 'intent.access')?.value, 'site');
  assert.ok(parseProblemText('Site visit to RBS-310 on Thursday', 'p').conditions.some((c) => c.key === 'intent.access'));
  assert.equal(parseProblemText('Replaced the SFP on TRN-088, link up, counters zero.', 'p').conditions.find((c) => c.key === 'intent.access'), undefined);
});

test('the current barrier code is a reuse recommendation of action class none, naming the code it replaced and the October change', async () => {
  const e = await engine();
  const r = await e.investigate({ text: P2, principal: KAISA });
  assert.equal(r.recommendation.kind, 'reuse');
  assert.equal(r.recommendation.actionClass, 'none');
  assert.equal(r.recommendation.text, 'Barrier code at RBS-310: 7731 (Eino Salo, 6 Oct; replaces 5802 from 20 Aug; changes every October).');
  assert.match(r.recommendation.caveats.join(' '), /next change is expected in October 2027/);
  // 5802 appears only as the replaced code, never as the current one.
  assert.doesNotMatch(r.recommendation.text, /: 5802\b/);
  // The basis is the access-fact evidence (both e-mails), not any incident case.
  const ev = new Set(r.state.recommendation.basis.map((b) => b.evidenceId));
  const sources = [...ev].map((id) => e.store.get('evidence', id)?.text ?? '');
  assert.ok(sources.some((t) => /7731/.test(t)) && sources.some((t) => /5802/.test(t)));
  assert.ok(r.state.routes.some((x) => x.version === 'access-facts@1'));
  assert.equal(r.state.gaps.length, 0, 'no incident gap is raised for an access question');
  assert.doesNotMatch(everything(r), /Pirkko/);
});

test('point in time: before the new code the old one is current; after its October change has passed it is flagged and Eino is named, never Pirkko', async () => {
  const e = await engine();
  const sept = await e.investigate({ text: P2, principal: KAISA, at: '2026-09-01T00:00:00Z' });
  assert.equal(sept.recommendation.kind, 'reuse');
  assert.match(sept.recommendation.text, /^Barrier code at RBS-310: 5802 \(Eino Salo, 20 Aug; changes every October\)\.$/);
  assert.doesNotMatch(sept.recommendation.text, /7731/);

  const oct3 = await e.investigate({ text: P2, principal: KAISA, at: '2026-10-03T00:00:00Z' });
  assert.equal(oct3.recommendation.kind, 'check-first');
  assert.equal(oct3.recommendation.actionClass, 'none');
  assert.match(oct3.recommendation.text, /5802.*probably changed since 1 Oct/);
  assert.match(oct3.recommendation.nextStep ?? '', /^Ask Eino Salo \(Site Access Coordinator; unavailable\)/);
  assert.deepEqual(oct3.state.recommendation.askWho?.map((w) => w.displayName), ['Eino Salo']);
  assert.doesNotMatch(everything(oct3), /Pirkko/);
});

test('missing fact: no code on file names who handles codes (Eino, on leave, back 1 Dec), never Pirkko; the question loop says so', async () => {
  const e = await engine(false);
  const r = await e.investigate({ text: 'Driving out to RBS-310 tomorrow, what is the door code?', principal: KAISA });
  assert.equal(r.recommendation.kind, 'none');
  assert.equal(r.recommendation.text, 'No door code for RBS-310 is on file.');
  assert.equal(r.recommendation.nextStep, 'Ask Eino Salo (Site Access Coordinator; on leave, back 1 Dec) for the current code.');
  const who = r.state.recommendation.askWho ?? [];
  assert.deepEqual(who.map((w) => [w.displayName, w.available, w.back]), [['Eino Salo', false, '1 Dec']]);
  assert.equal(r.loop, 'deferred');
  assert.equal(r.loopReason, 'Eino Salo handles access codes but is on leave (back 1 Dec)');
  assert.deepEqual(r.people.map((p) => p.name), ['Eino Salo']);
  assert.doesNotMatch(everything(r), /Pirkko/);
});

test('without the follow-up the August code is past its October change now: check-first, never presented as current', async () => {
  const e = await engine(false);
  const r = await e.investigate({ text: P2, principal: KAISA });
  assert.equal(r.recommendation.kind, 'check-first');
  assert.match(r.recommendation.text, /5802.*probably changed since 1 Oct/);
});

test('the Slack "leave keys at the front desk" fact has no subject and is never returned for a site', async () => {
  const e = await engine();
  const slack = e.store.list('claim').find((c) => c.type === 'access-fact' && /front desk/.test(c.statement));
  assert.ok(slack, 'the false access fact exists in the store');
  assert.deepEqual(slack.subjectEntityIds, []);
  for (const text of [P2, 'Driving to RBS-310, where are the keys?', 'Site visit RBS-310: how do I get access?']) {
    const r = await e.investigate({ text, principal: KAISA });
    assert.doesNotMatch(everything(r), /front desk/, text);
    assert.ok(!r.state.recommendation.basis.some((b) => slack.supporting.some((s) => s.evidenceId === b.evidenceId)), text);
  }
});

test('access: a requester who may not see the access e-mails gets no code (the same evidence gate as every read)', async () => {
  const e = new Engine({ dbPath: ':memory:', clock: () => new Date('2026-11-07T12:00:00Z'), investigation: { observability: defaultObservabilityPolicy } });
  const old = readFileSync(join(FAMILY, 'sources', 'email-01.txt'), 'utf8');
  e.importData({ format: 'email-text', payload: old, accessGroups: ['access'] });
  e.importData({ format: 'email-text', payload: NEW_CODE, accessGroups: ['access'] });
  const outsider = await e.investigate({ text: P2, principal: { id: 'agent:x', displayName: 'X', groups: [], type: 'agent' } });
  assert.doesNotMatch(everything(outsider), /7731|5802/);
  const insider = await e.investigate({ text: P2, principal: { id: 'agent:y', displayName: 'Y', groups: ['access'], type: 'agent' } });
  assert.match(insider.recommendation.text, /7731/);
});

test('B3 review: a newer code the requester may not see leaves the old one as it was (no "no code on file" side channel)', async () => {
  const e = new Engine({ dbPath: ':memory:', clock: () => new Date('2026-11-07T12:00:00Z'), investigation: { observability: defaultObservabilityPolicy } });
  e.importData({ format: 'scenario-dir', path: FAMILY });
  e.importData({ format: 'email-text', payload: NEW_CODE, accessGroups: ['access'] });
  const old = e.store.list('claim').find((c) => c.type === 'access-fact' && /5802/.test(c.statement) && c.condition?.key === 'site.access_code');
  assert.ok(old?.supersededBy, 'the hidden 7731 claim supersedes 5802 in the store');
  const outsider = await e.investigate({ text: P2, principal: KAISA });
  assert.doesNotMatch(everything(outsider), /7731|6 Oct|No barrier code/);
  // As without the follow-up: the August code, flagged as past its October change.
  assert.equal(outsider.recommendation.kind, 'check-first');
  assert.match(outsider.recommendation.text, /5802/);
  const insider = await e.investigate({ text: P2, principal: { ...KAISA, id: 'person:directory:eino', groups: ['access'] } });
  assert.match(insider.recommendation.text, /7731/);
});

test('an incident report that names a site keeps the incident path (access facts answer only access questions)', async () => {
  const e = await engine();
  const r = await e.investigate({ text: 'RBS-310 is dropping off the network again with DC low alarms; I will drive out to swap the rectifier.', principal: KAISA });
  assert.doesNotMatch(r.recommendation.text, /code/i);
  assert.ok(!r.state.routes.some((x) => x.version === 'access-facts@1'));
});
