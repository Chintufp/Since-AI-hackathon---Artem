import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { Case, Claim, Correction, KnowledgeStore, Principal } from '../contracts/index.ts';
import { readSlackExportDir } from '../connectors/index.ts';
import { applyCorrection, buildCaseView, importFromPath, listCases, openStore } from './index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const FIX = join(ROOT, 'data/fixtures/dev-family-01');
const ELISA = join(ROOT, 'private/Elisa_SinceAI2026/ELISA_HIDDEN_KNOWLEDGE_EXAMPLE_2026');
const hasElisa = existsSync(join(ELISA, 'teams_chat.json')) && existsSync(join(ELISA, 'email.txt'));
const NOW = '2026-11-07T00:00:00Z';
const ORG = 'org1';
const everyone: Principal = { id: 'p-any', displayName: 'Any', groups: [], type: 'human' };

const imp = (s: KnowledgeStore, format: 'teams-json' | 'email-text' | 'slack-export', path: string, extra: object = {}) =>
  importFromPath(s, { format, path, orgId: ORG, now: NOW, ...extra });

function snapshot(s: KnowledgeStore): string {
  const types = ['evidence', 'entity', 'claim', 'case', 'attempt', 'outcome', 'personLink'] as const;
  return JSON.stringify(types.map((t) => s.list(t)));
}

const claims = (s: KnowledgeStore, c: Case): Claim[] => s.list('claim', { where: { caseId: c.id } });
const hasClaim = (cs: Claim[], type: string, re: RegExp) => cs.some((c) => c.type === type && re.test(c.statement));
const cond = (cs: Claim[], key: string, value: string | number) => cs.some((c) => c.type === 'condition' && c.condition?.key === key && c.condition.value === value);
const person = (s: KnowledgeStore, first: string) => s.list('entity').find((e) => e.type === 'person' && e.name.startsWith(first))!;
const links = (s: KnowledgeStore, first: string) => s.list('personLink').filter((l) => l.personEntityId === person(s, first).id);

/** Shared expectations for a Teams chat + retelling email about one asset. */
function expectCommonShape(s: KnowledgeStore, spec: { asset: string; chatPath: string; emailPath: string; adviser: string; reporter: string; interface?: boolean }) {
  const c1 = imp(s, 'teams-json', spec.chatPath);
  const c2 = imp(s, 'email-text', spec.emailPath);
  assert.equal(c1.cases, 1);
  assert.equal(c2.cases, 1);
  const cases = listCases(s);
  assert.equal(cases.length, 1, 'chat and retelling email form ONE case');
  const c = cases[0]!;
  const asset = s.list('entity').find((e) => e.type === 'asset' && e.name === spec.asset);
  assert.ok(asset, 'asset entity recognized');
  assert.ok(c.entityIds.includes(asset!.id));
  // the email is flagged as a retelling and not a second case
  const mail = s.list('evidence').find((e) => e.provider === 'email' && e.metadata?.segment !== 'quoted')!;
  assert.ok(mail.lineage.copiedFrom?.length || mail.metadata?.retellingOf, 'email recognized as retelling');
  assert.ok(c.evidenceIds.includes(mail.id));
  // times unknown stay unknown
  const teams = s.list('evidence').filter((e) => e.provider === 'teams');
  assert.ok(teams.every((e) => e.eventTime.known === false && e.eventTime.partial === 'time-only'));
  assert.equal(c.startedAt.known, false);
  assert.equal(c.startedAt.partial, 'time-only');
  // attempt + outcome
  const attempts = s.list('attempt', { where: { caseId: c.id } });
  const outcomes = s.list('outcome', { where: { caseId: c.id } });
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0]!.result, 'recovered');
  assert.equal(outcomes[0]!.basis, 'reported');
  assert.equal(outcomes[0]!.lasting, 'unknown');
  assert.equal(c.status, 'reported-recovered');
  // links
  const rep = links(s, spec.reporter).filter((l) => l.firsthand).map((l) => l.contribution);
  for (const k of ['reported-problem', 'performed-action', 'reported-outcome']) assert.ok(rep.includes(k as never), `${spec.reporter} ${k}`);
  assert.ok(links(s, spec.adviser).some((l) => l.contribution === 'advised' && l.firsthand));
  // case view
  const v = buildCaseView(s, c.id, everyone)!;
  assert.equal(v.timeline[0]!.kind, 'problem');
  assert.ok(v.timeline.filter((n) => n.kind === 'step').length >= 3);
  const green = v.timeline.filter((n) => n.kind === 'reported');
  assert.ok(green.length >= 1);
  assert.match(green[0]!.detail, /unconfirmed/i);
  assert.match(green[0]!.detail, /timing/i);
  assert.match(green[0]!.detail, /whether it lasted/);
  assert.equal(v.timeline.at(-1)!.kind, 'reported');
  assert.ok(v.sources.length >= 10 && v.sources.every((x) => x.excerpt.length > 0));
  // idempotent reimport
  const snap = snapshot(s);
  const again = imp(s, 'teams-json', spec.chatPath);
  imp(s, 'email-text', spec.emailPath);
  assert.equal(again.batch.counts.inserted, 0);
  assert.equal(again.batch.counts.unchangedDuplicates, again.batch.counts.seen);
  assert.equal(snapshot(s), snap);
  return { c, attempts };
}

test('Elisa example: one case for TRN-042, claims, attempt, outcome, links, view', { skip: !hasElisa && 'private Elisa files absent' }, () => {
  const s = openStore(':memory:');
  const { c, attempts } = expectCommonShape(s, {
    asset: 'TRN-042', chatPath: join(ELISA, 'teams_chat.json'), emailPath: join(ELISA, 'email.txt'), adviser: 'Erkki', reporter: 'Veikko',
  });
  const cs = claims(s, c);
  for (const [k, v] of [['interface.status', 'up'], ['optical.level', 'normal'], ['traffic.counters', 'zero'], ['unit.age', 'older'], ['unit.installed_year', 2019], ['component.replaced', 'sfp']] as const) {
    assert.ok(cond(cs, k, v), `condition ${k}=${v}`);
  }
  assert.ok(hasClaim(cs, 'hypothesis', /forwarding state/));
  assert.ok(hasClaim(cs, 'advice', /counters are actually increasing/));
  assert.ok(hasClaim(cs, 'advice', /Disable the interface/));
  assert.ok(hasClaim(cs, 'advice', /Don't reboot/));
  assert.ok(cs.some((x) => x.type === 'action' && x.condition?.value === 'interface.reset'));
  assert.ok(hasClaim(cs, 'outcome', /Traffic is back/));
  // negation and hedges preserved
  assert.ok(hasClaim(cs, 'condition', /installed around 2019 I think/));
  const reset = attempts.find((a) => a.action === 'interface.reset')!;
  assert.equal(reset.performed, 'reported');
  assert.match(reset.advisedBy!.displayName, /Erkki/);
  assert.match(reset.performedBy!.displayName, /Veikko/);
  // the email's lines are not an independent confirmation of the chat's claims
  assert.ok(!cs.some((x) => x.status === 'supported' && x.supporting.length > 1 && x.supporting.some((r) => s.get('evidence', r.evidenceId)?.provider === 'email') && x.type === 'outcome'));
  assert.equal(s.count('claim', { type: 'access-fact' }), 0);
});

test('dev-family-01: chat + email retelling (quoted lines get copiedFrom)', () => {
  const s = openStore(':memory:');
  const { c, attempts } = expectCommonShape(s, {
    asset: 'RTR-117', chatPath: join(FIX, 'teams.json'), emailPath: join(FIX, 'email.txt'), adviser: 'Olli', reporter: 'Hanna',
  });
  const cs = claims(s, c);
  assert.ok(cond(cs, 'bgp.session', 'flapping'));
  assert.ok(cond(cs, 'software.version', '4.2.1'));
  assert.ok(hasClaim(cs, 'hypothesis', /hold timers/));
  assert.ok(hasClaim(cs, 'advice', /Check the logs first/));
  assert.ok(hasClaim(cs, 'advice', /Don't roll back/));
  const logs = attempts.find((a) => a.action === 'logs.check')!;
  assert.equal(logs.performed, 'reported');
  assert.ok(attempts.some((a) => a.action === 'session.reset' && a.performed === 'reported'));
  const mail = s.list('evidence').find((e) => e.provider === 'email' && e.metadata?.segment !== 'quoted')!;
  assert.ok(mail.lineage.copiedFrom!.length >= 3, 'quoted chat lines link to the original messages');
  const seg = s.list('evidence').find((e) => e.metadata?.segment === 'quoted')!;
  assert.deepEqual(seg.lineage.derivedFrom, [mail.id]);
  // the copy adds no independent support
  assert.ok(s.list('evidence', { where: { sourceFingerprint: seg.lineage.sourceFingerprint } }).length >= 1);
});

test('dev-family-01: slack continuation joins the same case; lookalike stays separate; access fact has no case', () => {
  const s = openStore(':memory:');
  imp(s, 'teams-json', join(FIX, 'teams.json'));
  imp(s, 'email-text', join(FIX, 'email.txt'));
  const before = listCases(s)[0]!;
  const r = imp(s, 'slack-export', join(FIX, 'slack-export'));
  assert.equal(r.cases, 2);
  const cases = listCases(s);
  assert.equal(cases.length, 2);
  const main = cases.find((c) => c.title.includes('RTR-117'))!;
  const lookalike = cases.find((c) => c.title.includes('RTR-203'))!;
  assert.equal(main.id, before.id, 'continuation updates the existing case');
  assert.notEqual(main.id, lookalike.id);
  const slackIds = s.list('evidence').filter((e) => e.provider === 'slack').map((e) => e.id);
  const inMain = slackIds.filter((i) => main.evidenceIds.includes(i));
  const inLook = slackIds.filter((i) => lookalike.evidenceIds.includes(i));
  assert.equal(inMain.length, 3);
  assert.equal(inLook.length, 3);
  assert.equal(inMain.filter((i) => inLook.includes(i)).length, 0);
  // the day-2 message (no asset id in its text) is attached through the thread
  assert.ok(s.list('evidence').some((e) => e.eventTime.iso?.startsWith('2026-03-11') && main.evidenceIds.includes(e.id)));
  // the lookalike keeps its own cause hypothesis and does not inherit the chat's conditions
  const lookClaims = claims(s, lookalike);
  assert.ok(hasClaim(lookClaims, 'hypothesis', /duplicate router id/));
  assert.ok(!hasClaim(lookClaims, 'advice', /hold timer/));
  assert.ok(!cond(lookClaims, 'software.version', '4.2.1'));
  assert.equal(s.list('outcome', { where: { caseId: main.id } }).length, 2);
  // access fact
  imp(s, 'email-text', join(FIX, 'access-email.txt'));
  const facts = s.list('claim', { where: { type: 'access-fact' } });
  assert.ok(facts.length >= 2);
  assert.ok(facts.every((f) => f.caseId === undefined && f.condition?.key === 'site.access'));
  assert.equal(listCases(s).length, 2, 'access email creates no case');
  const site = s.list('entity').find((e) => e.name === 'ESP-14')!;
  assert.equal(site.type, 'site');
  assert.ok(facts.every((f) => f.subjectEntityIds.includes(site.id)));
  const jari = s.list('entity').find((e) => e.name === 'Jari Niemi')!;
  assert.ok(s.list('personLink').some((l) => l.personEntityId === jari.id && l.contribution === 'mentioned' && l.firsthand === false));
  // a person who authored in several providers is one entity
  assert.equal(s.list('entity').filter((e) => e.name === 'Hanna Mäkelä').length, 1);
});

test('access scope: private-channel case is hidden from outsiders, visible to group members', () => {
  const s = openStore(':memory:');
  const data = readSlackExportDir(join(FIX, 'slack-export'));
  data.channels[0]!.is_private = true;
  importFromPath(s, { format: 'slack-export', payload: data, orgId: ORG, now: NOW });
  const cases = s.list('case');
  assert.equal(cases.length, 2);
  assert.ok(cases.every((c) => c.accessScope.visibility === 'group'));
  const outsider = { id: 'o', groups: ['other'] };
  const member = { id: 'm', groups: ['slack-channel:C100'] };
  assert.equal(listCases(s, outsider).length, 0);
  assert.equal(listCases(s, member).length, 2);
  assert.equal(buildCaseView(s, cases[0]!.id, outsider), undefined);
  assert.ok(buildCaseView(s, cases[0]!.id, member));
  assert.ok(s.list('claim').filter((c) => c.caseId).every((c) => c.accessScope.visibility === 'group'));
  // explicit access groups on an import are respected as well
  const t = openStore(':memory:');
  imp(t, 'teams-json', join(FIX, 'teams.json'), { accessGroups: ['net-team'] });
  const only = listCases(t)[0]!;
  assert.equal(buildCaseView(t, only.id, { id: 'x', groups: [] }), undefined);
  assert.ok(buildCaseView(t, only.id, { id: 'y', groups: ['net-team'] }));
  // a restricted source never hides an org-wide case; its own evidence and claims stay filtered for outsiders
  const u = openStore(':memory:');
  imp(u, 'teams-json', join(FIX, 'teams.json'));
  assert.equal(listCases(u, { id: 'z', groups: [] }).length, 1);
  importFromPath(u, { format: 'slack-export', payload: data, orgId: ORG, now: NOW });
  const outsiderCases = listCases(u, { id: 'z', groups: [] });
  assert.equal(outsiderCases.length, 1);
  const outView = buildCaseView(u, outsiderCases[0]!.id, { id: 'z', groups: [] })!;
  assert.ok(outView.sources.every((x) => x.provider !== 'slack'), 'no private-channel source shown to the outsider');
  assert.ok(outView.entities.length > 0);
});

test('revision: an edited slack message updates without duplicating', () => {
  const s = openStore(':memory:');
  const data = readSlackExportDir(join(FIX, 'slack-export'));
  importFromPath(s, { format: 'slack-export', payload: data, orgId: ORG, now: NOW });
  const caseCount = s.count('case');
  const evCount = s.count('evidence');
  const edited = structuredClone(data);
  const msg = edited.days[0]!.messages[2]!; // Olli's reply about checking the logs
  msg.text = 'Good. Check the router configuration again tomorrow morning for hold timer changes.';
  msg.edited = { user: 'U02', ts: '1773140000.000000' };
  const r = importFromPath(s, { format: 'slack-export', payload: edited, orgId: ORG, now: '2026-11-08T00:00:00Z' });
  assert.equal(r.batch.counts.revised, 1);
  assert.equal(r.batch.counts.inserted, 0);
  assert.equal(r.batch.counts.unchangedDuplicates, 6);
  assert.equal(s.count('case'), caseCount);
  assert.equal(s.count('evidence'), evCount + 1);
  const main = listCases(s).find((c) => c.title.includes('RTR-117'))!;
  const live = claims(s, main).filter((c) => c.status === 'provisional' || c.status === 'supported');
  assert.ok(!live.some((c) => c.type === 'advice' && /Check the logs again/.test(c.statement)), 'old statement no longer live');
  assert.ok(live.some((c) => /Check the router configuration again/.test(c.statement)));
  assert.ok(claims(s, main).some((c) => /Check the logs again/.test(c.statement) && c.status === 'corrected'));
  assert.equal(main.evidenceIds.filter((i) => s.get('evidence', i)!.metadata?.supersededBy).length, 0);
  // same edit imported once more changes nothing
  const snap = snapshot(s);
  importFromPath(s, { format: 'slack-export', payload: edited, orgId: ORG, now: '2026-11-09T00:00:00Z' });
  assert.equal(snapshot(s), snap);
});

test('corrections retract a claim and the case view reflects it', () => {
  const s = openStore(':memory:');
  imp(s, 'teams-json', join(FIX, 'teams.json'));
  const c = listCases(s)[0]!;
  assert.equal(c.status, 'reported-recovered');
  const outcomeClaim = claims(s, c).find((x) => x.type === 'outcome')!;
  const reportedOutcomeLink = s.list('personLink').find((l) => l.claimId === outcomeClaim.id)!;
  assert.equal(reportedOutcomeLink.status, 'provisional');
  const corr: Correction = {
    id: 'corr1', orgId: ORG, target: { type: 'claim', id: outcomeClaim.id }, change: 'retract',
    reason: 'Sessions flapped again after the report', by: { id: 'person:x', displayName: 'Reviewer' }, at: '2026-11-08T10:00:00Z',
  };
  const res = applyCorrection(s, corr);
  assert.deepEqual(res.caseIds, [c.id]);
  assert.equal(s.get('claim', outcomeClaim.id)!.status, 'retracted');
  assert.equal(s.get('correction', 'corr1')!.reason, corr.reason);
  const after = s.get('case', c.id)!;
  assert.equal(after.status, 'unknown-outcome');
  assert.equal(after.outcomeIds.length, 0);
  assert.equal(s.count('outcome', { caseId: c.id }), 0);
  assert.equal(s.get('personLink', reportedOutcomeLink.id)!.status, 'rejected');
  const v = buildCaseView(s, c.id, everyone)!;
  assert.ok(!v.timeline.some((n) => n.kind === 'reported'), 'no green node after retraction');
  assert.equal(v.timeline.at(-1)!.kind, 'unknown');
  assert.match(v.caveat, /retracted/);
  // idempotent
  const snap = snapshot(s);
  applyCorrection(s, corr);
  assert.equal(snapshot(s), snap);
  // contradicting a condition removes it from the case conditions
  const cond0 = claims(s, c).find((x) => x.type === 'condition' && x.condition?.key === 'bgp.session')!;
  applyCorrection(s, { ...corr, id: 'corr2', target: { type: 'claim', id: cond0.id }, change: 'contradict' });
  assert.ok(!s.get('case', c.id)!.conditions.some((x) => x.key === 'bgp.session'));
  assert.equal(s.get('claim', cond0.id)!.status, 'contradicted');
  assert.throws(() => applyCorrection(s, { ...corr, id: 'corr3', target: { type: 'claim', id: 'nope' } }));
});

test('inline payloads and the scenario-dir format', () => {
  const s = openStore(':memory:');
  const r = importFromPath(s, { format: 'scenario-dir', path: FIX, orgId: ORG, now: NOW });
  assert.equal(r.cases, 2);
  assert.ok(r.batch.counts.seen >= 22);
  const t = openStore(':memory:');
  const r2 = importFromPath(t, { format: 'email-text', payload: 'From: A\nTo: B\nSubject: x\n\nThe barrier at site XYZ-77 is locked, key from the gate.', orgId: ORG, now: NOW });
  assert.equal(r2.cases, 0);
  assert.ok(t.count('claim', { type: 'access-fact' }) >= 1);
  const p = importFromPath(t, { format: 'paste', payload: { text: 'Router RTR-5 keeps flapping since the update', attachmentNames: ['log.txt'] }, orgId: ORG, now: NOW });
  assert.equal(p.cases, 1);
  assert.equal(t.list('evidence').find((e) => e.provider === 'paste')!.eventTime.known, false);
});

test('works with the term-overlap search fallback too', () => {
  const s = openStore(':memory:', { disableFts: true });
  imp(s, 'teams-json', join(FIX, 'teams.json'));
  assert.equal(listCases(s).length, 1);
  assert.ok(s.searchText(['evidence'], 'hold timer expired')[0]!.score > 0);
});
