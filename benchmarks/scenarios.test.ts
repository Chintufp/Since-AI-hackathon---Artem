/**
 * Schema and consistency checks over the REAL frozen families in data/scenarios.
 * Source ids are derived here exactly as the adapters will: Teams seq, email Message-ID header, Slack ts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CONDITION_KEYS } from '../src/libs/utils/contracts/index.ts';
import type { ClaimType, FamilyManifestEntry } from '../src/libs/utils/contracts/index.ts';
import { questionValueAndBurden, knowledgeAccuracy, recommendationQuality, resolutionAccuracy, accessLeakage, incomingLinking } from './evaluator.ts';
import { loadHidden, loadVisibleInputs } from './load.ts';
import { answerFor, gapConditionKeys, parseAnswerKey } from './oracle.ts';
import { canonicalAction, isKnownAction } from './actions.ts';
import { perfectQuestionRuns, perfectRecommendations, perfectSystem, silentRecommendations, silentSystem } from './reference-systems.ts';
import { DEFAULT_SCENARIOS_DIR, loadFamiliesFile } from './splits.ts';
import { normalizeSourceId } from './text.ts';

const root = DEFAULT_SCENARIOS_DIR;
const file = loadFamiliesFile();
const readJson = (p: string) => JSON.parse(readFileSync(p, 'utf8'));

const ALL_TAGS: FamilyManifestEntry['tags'] = [
  'same-incident-continuation', 'lookalike-different-cause', 'temporary-recovery', 'recurrence', 'missing-outcome', 'duplicate-report', 'copied-retelling',
  'wrong-recipient-trap', 'changed-permissions', 'no-question-needed', 'useful-no', 'no-answer', 'access-fact', 'conflicting-conditions', 'multi-step',
];
/** Documented extension keys (organizations extend the vocabulary through configuration). See data/scenarios/REVIEW.md. */
const EXTENSION_KEYS = [
  'interface.crc_errors', 'power.mains_sag', 'power.breaker_inspected_at_first_visit', 'power.scope', 'site.access_code_current',
  'cable.condition', 'cable.guard_fitted', 'config.saved_startup', 'config.rollback_supported',
];
const inVocabulary = (k: string) => k in CONDITION_KEYS || EXTENSION_KEYS.includes(k);
const CLAIM_TYPES: ClaimType[] = ['observation', 'hypothesis', 'advice', 'action', 'outcome', 'condition', 'access-fact', 'identity', 'other'];

interface Derived { sourceIds: Set<string>; teamsCount: number; emailCount: number; slackCount: number; authors: string[] }

/** Derives provider source ids from the visible files, mimicking the adapters. */
function derive(familyDir: string): Derived {
  const src = join(familyDir, 'sources');
  const ids = new Set<string>();
  const teams = readJson(join(src, 'teams.json'));
  for (const m of teams.messages) ids.add(`teams:${m.seq}`);
  let emailCount = 0;
  for (const f of readdirSync(src).filter((n) => /^email.*\.txt$/.test(n))) {
    const text = readFileSync(join(src, f), 'utf8');
    const head = text.split(/\r?\n\r?\n/)[0]!;
    const mid = head.split(/\r?\n/).find((l) => /^Message-ID:/i.test(l));
    assert.ok(mid, `${f} has no Message-ID`);
    ids.add(`email:${mid!.replace(/^Message-ID:\s*/i, '').trim()}`);
    emailCount++;
  }
  let slackCount = 0;
  const slackDir = join(src, 'slack-export');
  for (const ch of readdirSync(slackDir)) {
    if (!statSync(join(slackDir, ch)).isDirectory()) continue;
    for (const d of readdirSync(join(slackDir, ch))) for (const m of readJson(join(slackDir, ch, d))) { ids.add(`slack:${m.ts}`); slackCount++; }
  }
  return { sourceIds: ids, teamsCount: teams.messages.length, emailCount, slackCount, authors: teams.messages.map((m: { author: string }) => m.author) };
}

test('family set: at least 10 families, 2 demo / 4 train / 2 validation / 2 test', () => {
  assert.ok(file.families.length >= 10);
  const n = (s: string) => file.families.filter((f) => f.split === s).length;
  assert.deepEqual([n('demo'), n('train'), n('validation'), n('test')], [2, 4, 2, 2]);
});

test('every tag is covered by at least two families and only known tags are used', () => {
  const counts = new Map<string, number>();
  for (const f of file.families) for (const t of f.tags) {
    assert.ok(ALL_TAGS.includes(t), `unknown tag ${t}`);
    counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  for (const t of ALL_TAGS) assert.ok((counts.get(t) ?? 0) >= 2, `tag ${t} covered ${counts.get(t) ?? 0} time(s)`);
});

for (const fam of file.families) {
  test(`family ${fam.id}: files, formats and source ids`, () => {
    const dir = join(root, fam.dir);
    for (const f of ['people.json', 'truth.json', 'incoming.json', 'sources/teams.json', 'sources/slack-export/users.json', 'sources/slack-export/channels.json']) {
      assert.ok(existsSync(join(dir, f)), `${fam.id} missing ${f}`);
    }
    const d = derive(dir);
    assert.ok(d.emailCount >= 1);
    assert.ok(d.teamsCount >= 8 && d.teamsCount <= 16, `teams conversation size ${d.teamsCount}`);
    assert.ok(d.slackCount >= 3 && d.slackCount <= 16, `slack size ${d.slackCount}`);

    const { people, truth } = loadHidden(fam.id);
    const personIds = new Set(people.people.map((p) => p.id));
    for (const p of people.people) {
      assert.match(p.id, /^person:directory:[a-z0-9.-]+$/);
      for (const a of p.actorIds) assert.match(a, /^person:(teams:.+|slack:U\d+|email:[^@\s]+@[^@\s]+)$/);
      assert.ok(p.groups.length > 0);
    }

    // Teams: contiguous seq, time-only, authors resolve to people
    const teams = readJson(join(dir, 'sources/teams.json'));
    teams.messages.forEach((m: { seq: number; time: string; author: string; role: string; text: string }, i: number) => {
      assert.equal(m.seq, i + 1);
      assert.match(m.time, /^\d\d:\d\d$/);
      assert.ok(m.text.length > 0 && m.role);
      const p = people.people.find((x) => x.name === m.author);
      assert.ok(p, `teams author ${m.author} not in people.json`);
      assert.ok(p!.actorIds.includes(`person:teams:${m.author}`), `${m.author} lacks a teams actor id`);
    });

    // Email headers
    for (const f of readdirSync(join(dir, 'sources')).filter((n) => /^email.*\.txt$/.test(n))) {
      const head = readFileSync(join(dir, 'sources', f), 'utf8').split(/\r?\n\r?\n/)[0]!;
      for (const h of ['From:', 'To:', 'Subject:', 'Message-ID:']) assert.ok(head.includes(h), `${f} missing ${h}`);
      const m = /^From: .*<([^>]+)>/m.exec(head);
      assert.ok(m && people.people.some((p) => p.actorIds.includes(`person:email:${m[1]}`)), `${f} sender not mapped`);
    }

    // Slack
    const users = readJson(join(dir, 'sources/slack-export/users.json')) as Array<{ id: string }>;
    const channels = readJson(join(dir, 'sources/slack-export/channels.json')) as Array<{ name: string; is_private: boolean; members: string[] }>;
    for (const u of users) assert.ok(people.people.some((p) => p.actorIds.includes(`person:slack:${u.id}`)), `slack user ${u.id} unmapped`);
    const tsSeen = new Set<string>();
    for (const ch of channels) {
      for (const m of ch.members) assert.ok(users.some((u) => u.id === m));
      const cdir = join(dir, 'sources/slack-export', ch.name);
      if (!existsSync(cdir)) continue;
      for (const day of readdirSync(cdir)) {
        assert.match(day, /^\d{4}-\d\d-\d\d\.json$/);
        for (const m of readJson(join(cdir, day)) as Array<{ type: string; user: string; text: string; ts: string; thread_ts?: string }>) {
          assert.equal(m.type, 'message');
          assert.match(m.ts, /^\d{10}\.\d{6}$/);
          assert.ok(!tsSeen.has(m.ts), `duplicate slack ts ${m.ts}`);
          tsSeen.add(m.ts);
          assert.ok(users.some((u) => u.id === m.user));
          assert.ok(ch.is_private ? ch.members.includes(m.user) : true, 'private channel author must be a member');
          if (m.thread_ts) assert.match(m.thread_ts, /^\d{10}\.\d{6}$/);
        }
      }
    }

    // truth source ids derive from the sources
    assert.ok(truth.incidents.length >= 1);
    const claimed = new Set<string>();
    for (const inc of truth.incidents) {
      assert.ok(inc.sourceIds.length > 0 && inc.accessGroups.length > 0);
      for (const s of inc.sourceIds) {
        assert.match(s, /^(teams:\d+|email:<[^<>\s]+@[^<>\s]+>|slack:\d{10}\.\d{6})$/);
        assert.ok(d.sourceIds.has(s), `${fam.id}: truth sourceId ${s} not derivable from sources`);
        assert.ok(!claimed.has(s), `${s} in two incidents`);
        claimed.add(s);
      }
      for (const c of inc.expectedClaims) {
        assert.ok(CLAIM_TYPES.includes(c.type as ClaimType), `bad claim type ${c.type}`);
        if (c.by) assert.ok(personIds.has(c.by));
      }
      for (const a of inc.attempts) assert.ok(personIds.has(a.by));
      if (inc.outcome.reportedBy) assert.ok(personIds.has(inc.outcome.reportedBy));
      for (const p of Object.keys(inc.knowledge)) assert.ok(personIds.has(p));
    }
    for (const c of truth.copies) {
      assert.ok(d.sourceIds.has(c.sourceId) && d.sourceIds.has(c.of), `copy ${c.sourceId} -> ${c.of} not derivable`);
      assert.notEqual(c.sourceId, c.of);
    }
    assert.equal(truth.familyId, fam.id);
  });

  test(`family ${fam.id}: answer keys are consistent with knowledge, people and oracle`, () => {
    const { people, truth, incoming } = loadHidden(fam.id);
    const byId = new Map(people.people.map((p) => [p.id, p]));
    const incKeys = new Set(truth.incidents.map((i) => i.key));
    const capability = (pid: string) => {
      const s = new Set<string>();
      for (const inc of truth.incidents) for (const k of [...(inc.knowledge[pid]?.knows ?? []), ...(inc.knowledge[pid]?.canObserve ?? [])]) s.add(k);
      return s;
    };
    assert.ok(incoming.problems.length >= 2 && incoming.problems.length <= 4);
    assert.equal(incoming.familyId, fam.id);
    for (const p of incoming.problems) {
      assert.ok(byId.has(p.requester), `${p.id} requester`);
      for (const o of p.observations ?? []) assert.ok(inVocabulary(o.key), `${p.id}: observation key ${o.key} outside vocabulary`);
      for (const k of p.key.relatedIncidentKeys) assert.ok(incKeys.has(k));
      for (const dc of p.key.distinguishingConditions ?? []) assert.ok(inVocabulary(dc.key), `${p.id}: distinguishing key ${dc.key}`);
      const gap = p.key.consequentialGap;
      assert.equal(!!gap, !p.key.noQuestionNeeded, `${p.id}: gap iff a question is needed`);
      if (gap) {
        assert.ok(gap.answerers.length > 0);
        for (const a of gap.answerers) assert.ok(byId.has(a));
        const requesterIsAnswerer = gap.answerers.includes(p.requester);
        assert.ok(!requesterIsAnswerer, `${p.id}: requester must not be the only answerer of their own gap`);
        if (gap.unanswerable) {
          assert.equal(p.key.expectedRecommendation, 'check-first');
          assert.ok(gap.answerers.every((a) => byId.get(a)!.available === false), `${p.id}: unanswerable gap needs unavailable answerers`);
        } else {
          assert.ok(gap.answerers.some((a) => byId.get(a)!.available), `${p.id}: at least one available answerer`);
          assert.ok(gap.answerers.some((a) => Object.values(p.key.answers[a] ?? {}).some((v) => v !== 'unknown')), `${p.id}: answerers must be able to answer`);
        }
      }
      for (const [pid, ans] of Object.entries(p.key.answers)) {
        assert.ok(byId.has(pid), `${p.id}: unknown person ${pid}`);
        for (const [k, v] of Object.entries(ans)) {
          const base = parseAnswerKey(k).key;
          assert.ok(inVocabulary(base), `${p.id}: answer key ${base} outside vocabulary`);
          if (v !== 'unknown') assert.ok(capability(pid).has(base), `${p.id}: ${pid} answers ${base} but has no recorded knowledge/observability of it`);
        }
      }
      // oracle agrees with the key
      for (const [pid, ans] of Object.entries(p.key.answers)) {
        for (const [k, v] of Object.entries(ans)) {
          const q = parseAnswerKey(k);
          const got = answerFor(p.key, pid, { conditionKey: q.key, expected: q.value, scopeEntity: q.scope }, { people });
          const unavailable = byId.get(pid)!.available === false || (gap?.unanswerable && gap.answerers.includes(pid));
          assert.equal(got, unavailable ? 'no-answer' : v, `${p.id} ${pid} ${k}`);
        }
      }
      if (p.key.expectedRecommendation === 'reuse') assert.ok(['reuse', 'qualified'].includes(p.key.applicable));
      if (p.key.applicable === 'inapplicable') assert.ok(['none', 'check-first', 'retain-uncertainty'].includes(p.key.expectedRecommendation));
    }
  });
}

test('perfect reference system scores 1.0 / 0 errors across every real family; silent system is exposed', () => {
  for (const fam of file.families) {
    const { people, truth, incoming } = loadHidden(fam.id);
    const sys = perfectSystem(truth, people);
    const k = knowledgeAccuracy(sys, truth, { people });
    for (const [name, m] of Object.entries(k.metrics)) {
      if (!m) continue;
      const lowerIsBetter = /(Rate|ErrorRate)$/.test(name) && !name.endsWith('Coverage');
      assert.equal(m.value, lowerIsBetter ? 0 : 1, `${fam.id} ${name}`);
    }
    assert.equal(k.failures.length, 0, `${fam.id}: ${JSON.stringify(k.failures.slice(0, 2))}`);
    const r = resolutionAccuracy(sys, truth);
    assert.equal(r.metrics['resolution.statusAccuracy']?.value, 1);
    assert.equal(r.metrics['resolution.falseSolvedRate']?.value ?? 0, 0);
    const rec = recommendationQuality(perfectRecommendations(incoming.problems), incoming.problems);
    assert.equal(rec.metrics['recommendation.kindAccuracy']?.value, 1);
    assert.equal(rec.metrics['recommendation.falseAdviceRate']?.value ?? 0, 0);
    assert.equal(rec.metrics['recommendation.missedOpportunityRate']?.value ?? 0, 0);
    const unavailable = people.people.filter((x) => !x.available).map((x) => x.id);
    const q = questionValueAndBurden(perfectQuestionRuns(incoming.problems, people), incoming.problems, 0, () => fam.id, { unavailable });
    assert.equal(q.counts['question.hardRuleViolations'], 0, `${fam.id}: reference oracle must obey the eligibility rule`);
    assert.equal(q.metrics['question.gapFoundRate']?.value ?? 1, 1);
    assert.equal(q.metrics['question.unnecessaryQuestionRate']?.value ?? 0, 0);
    assert.equal(q.metrics['question.wrongRecipientRate']?.value ?? 0, 0);
    const links = incomingLinking(incoming.problems.map((p) => ({ problemId: p.id, linkedCaseIds: p.key.relatedIncidentKeys.map((x) => `case:${x}`) })), sys, truth, incoming.problems);
    assert.equal(links.metrics['linking.recall']?.value ?? 1, 1);
    assert.equal(links.metrics['linking.precision']?.value ?? 1, 1);

    // silence must score badly wherever the family has something to find
    const silent = knowledgeAccuracy(silentSystem(), truth, { people });
    assert.equal(silent.metrics['claims.all.recall']?.value, 0);
    const silentRec = recommendationQuality(silentRecommendations(incoming.problems), incoming.problems);
    assert.ok(silentRec.metrics['recommendation.kindAccuracy']!.value < 1 || incoming.problems.every((p) => p.key.expectedRecommendation === 'none'));
  }
});

test('access control: a requester outside an incident access groups would be a leak (real families)', () => {
  let leakableProblems = 0;
  for (const fam of file.families) {
    const { people, truth, incoming } = loadHidden(fam.id);
    for (const p of incoming.problems) {
      const shown = truth.incidents.filter((i) => p.key.relatedIncidentKeys.includes(i.key)).flatMap((i) => i.sourceIds);
      const rep = accessLeakage([{ problemId: p.id, requesterId: p.requester, sourceIds: shown }], truth, people);
      if ((rep.metrics['access.leakageRate']?.numerator ?? 0) > 0) {
        leakableProblems++;
        // Where citing a related incident WOULD leak, the key must not ask for a recommendation built on it.
        assert.ok(['none', 'check-first', 'retain-uncertainty'].includes(p.key.expectedRecommendation) || p.key.applicable === 'inapplicable', `${p.id}: leaks yet expects a reuse-style answer`);
      }
    }
  }
  assert.ok(leakableProblems >= 2, 'changed-permissions must be exercised by at least two problems');
});

test('visible inputs expose no answer keys and nothing from the private organizer example', () => {
  for (const fam of file.families) {
    const v = JSON.stringify(loadVisibleInputs(fam.id));
    const { truth } = loadHidden(fam.id);
    for (const bad of ['expectedRecommendation', 'consequentialGap', 'realCause', 'noQuestionNeeded', 'expectedClaims', 'laterOutcome', 'distinguishingConditions']) {
      assert.ok(!v.includes(bad), `${fam.id}: visible inputs contain "${bad}"`);
    }
    for (const inc of truth.incidents) assert.ok(!v.includes(inc.realCause), `${fam.id}: real cause leaked into visible inputs`);
  }
  const everything = readdirSync(root, { recursive: true, encoding: 'utf8' }).filter((p) => /\.(json|txt|md)$/.test(p));
  for (const f of everything) {
    const t = readFileSync(join(root, f), 'utf8');
    for (const banned of ['TRN-042', 'Veikko', 'Erkki', 'Vikkelä']) assert.ok(!t.includes(banned), `${f} contains organizer material "${banned}"`);
  }
});

test('hidden truth never appears under src/ (implementers read src/ and READMEs)', () => {
  const srcRoot = join(root, '..', '..', 'src');
  const files = readdirSync(srcRoot, { recursive: true, encoding: 'utf8' }).filter((p) => /\.(ts|md|json)$/.test(p) && !p.includes('node_modules'));
  const needles: string[] = [];
  for (const fam of file.families) for (const inc of loadHidden(fam.id).truth.incidents) needles.push(inc.realCause);
  for (const f of files) {
    const t = readFileSync(join(srcRoot, f), 'utf8');
    for (const n of needles) assert.ok(!t.includes(n), `${f} contains hidden realCause text`);
    assert.ok(!/data\/scenarios\/[^'"`\s]*(truth|incoming)\.json/.test(t) || f.includes('contracts/scenarios.ts') || f.includes('README'), `${f} references hidden truth/incoming files`);
  }
});

test('source id normalization treats bracketed and bare Message-IDs alike', () => {
  assert.equal(normalizeSourceId('email:<a@b.c>'), normalizeSourceId('email:a@b.c'));
});

test('truth actions are in the contracts ACTIONS or the declared extension vocabulary; copies may have several parents', () => {
  let multiParent = 0;
  for (const fam of file.families) {
    const { truth } = loadHidden(fam.id);
    for (const inc of truth.incidents) for (const a of inc.attempts) assert.ok(isKnownAction(a.action), `${fam.id}/${inc.key}: action "${a.action}" is not declared`);
    const per = new Map<string, number>();
    for (const c of truth.copies) per.set(c.sourceId, (per.get(c.sourceId) ?? 0) + 1);
    multiParent += [...per.values()].filter((n) => n > 1).length;
  }
  assert.ok(multiParent >= 1, 'at least one retelling copies two originals');
  assert.equal(canonicalAction('component.replace.rectifier'), 'other');
  assert.equal(canonicalAction('power.cycle.shelf'), 'power.cycle');
  assert.equal(canonicalAction('sfp.replace'), 'sfp.replace');
});

test('every person who can observe a gap condition is an answerer or answers it explicitly', () => {
  // Test families stay frozen: this audit covers demo/train/validation only (a test-split finding is logged in REVIEW.md).
  for (const fam of file.families.filter((f) => f.split !== 'test')) {
    const { truth, incoming } = loadHidden(fam.id);
    for (const p of incoming.problems) {
      const gap = p.key.consequentialGap;
      if (!gap) continue;
      const keys = new Set(gapConditionKeys(p.key));
      for (const ik of p.key.relatedIncidentKeys) {
        const inc = truth.incidents.find((i) => i.key === ik)!;
        for (const [pid, k] of Object.entries(inc.knowledge)) {
          if (pid === p.requester || !k.canObserve.some((c) => keys.has(c))) continue;
          const hasAnswer = Object.keys(p.key.answers[pid] ?? {}).some((a) => keys.has(parseAnswerKey(a).key));
          assert.ok(gap.answerers.includes(pid) || hasAnswer, `${fam.id}/${p.id}: ${pid} can observe a gap key but is neither an answerer nor has a stated answer`);
        }
      }
    }
  }
});
