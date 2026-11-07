/**
 * Builds data/scenarios/ from the authored family specs. Run: node benchmarks/authoring/build.ts
 * Deterministic: same specs -> byte-identical output. Also (re)writes TEST_LOCK.json.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  FamiliesFile,
  IncomingProblems,
  PeopleDirectory,
  ScenarioTruth,
} from '../../src/libs/utils/contracts/index.ts';
import type { FamilySpec } from './spec.ts';
import { freezeTestLock } from '../splits.ts';
import { ALL_FAMILIES } from './families/index.ts';

const here = dirname(fileURLToPath(import.meta.url));
export const SCENARIOS_DIR = join(here, '..', '..', 'data', 'scenarios');
const DOMAIN = 'kalevanet.example';

const pid = (slug: string) => `person:directory:${slug}`;
const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

function write(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
}

export function buildFamily(spec: FamilySpec, outRoot: string = SCENARIOS_DIR): void {
  const id = spec.entry.id;
  const fail = (m: string): never => {
    throw new Error(`[${id}] ${m}`);
  };
  const bySlug = new Map(spec.people.map((p) => [p.slug, p]));
  const person = (slug: string) => bySlug.get(slug) ?? fail(`unknown person slug "${slug}"`);
  const incKeys = new Set(spec.incidents.map((i) => i.key));
  const dir = join(outRoot, id);
  rmSync(dir, { recursive: true, force: true });

  // ---- sources ----
  const labelToSource = new Map<string, string>();
  const incSources = new Map<string, string[]>();
  const copies: ScenarioTruth['copies'] = [];
  const pending: Array<{ sourceId: string; copyOf: string[] }> = [];
  const register = (label: string | undefined, sourceId: string, inc?: string, copyOf?: string | string[]) => {
    if (label) {
      if (labelToSource.has(label)) fail(`duplicate label ${label}`);
      labelToSource.set(label, sourceId);
    }
    if (inc) {
      if (!incKeys.has(inc)) fail(`unknown incident ${inc}`);
      (incSources.get(inc) ?? incSources.set(inc, []).get(inc)!).push(sourceId);
    }
    if (copyOf) pending.push({ sourceId, copyOf: Array.isArray(copyOf) ? copyOf : [copyOf] });
  };

  // Teams
  const teamsAuthors = new Set(spec.teams.map((m) => m.who));
  const teamsMessages = spec.teams.map((m, i) => {
    const p = person(m.who);
    const seq = i + 1;
    register(m.id, `teams:${seq}`, m.inc, m.copyOf);
    return { seq, time: m.time, author: p.name, role: p.role, text: m.text };
  });
  const teamsParticipants = [...teamsAuthors].map((s) => ({ name: person(s).name, role: person(s).role }));
  write(
    join(dir, 'sources', 'teams.json'),
    json({
      channel: 'teams',
      note: spec.teamsNote ?? 'Synthetic example. Names and node IDs are illustrative. Times only; no date was given.',
      participants: teamsParticipants,
      messages: teamsMessages,
    }),
  );

  // Email
  spec.emails.forEach((e, i) => {
    const mid = `<${e.id}@${DOMAIN}>`;
    register(e.id, `email:${mid}`, e.inc, e.copyOf);
    const addr = (s: string) => {
      const p = person(s);
      if (!p.email) fail(`person ${s} has no email address`);
      return `${p.name} <${p.email}>`;
    };
    const lines = [`From: ${addr(e.from)}`, `To: ${e.to.map(addr).join(', ')}`];
    if (e.cc?.length) lines.push(`Cc: ${e.cc.map(addr).join(', ')}`);
    if (e.date) lines.push(`Date: ${e.date}`);
    lines.push(`Subject: ${e.subject}`, `Message-ID: ${mid}`, '', e.body.trim(), '');
    write(join(dir, 'sources', `email-${String(i + 1).padStart(2, '0')}.txt`), lines.join('\n'));
  });

  // Slack
  const users = spec.people.filter((p) => p.slack);
  write(
    join(dir, 'sources', 'slack-export', 'users.json'),
    json(users.map((p) => ({ id: p.slack, name: p.slug, real_name: p.name, profile: { title: p.role, ...(p.email ? { email: p.email } : {}) } }))),
  );
  const chanId = new Map<string, string>();
  write(
    join(dir, 'sources', 'slack-export', 'channels.json'),
    json(
      spec.slackChannels.map((c, i) => {
        const cid = `C0${String(i + 1).padStart(2, '0')}${id.slice(0, 2).toUpperCase().replace(/[^A-Z]/g, 'X')}`;
        chanId.set(c.name, cid);
        for (const m of c.members) if (!person(m).slack) fail(`channel member ${m} has no slack id`);
        return { id: cid, name: c.name, is_private: !!c.private, members: c.members.map((m) => person(m).slack) };
      }),
    ),
  );
  const stamped = spec.slack
    .map((m, idx) => {
      const epoch = Date.parse(`${m.day}T${m.time}Z`) / 1000;
      if (Number.isNaN(epoch)) fail(`bad slack time ${m.day} ${m.time}`);
      return { m, idx, epoch };
    })
    .sort((a, b) => a.epoch - b.epoch || a.idx - b.idx);
  const tsOf = new Map<string, string>();
  stamped.forEach((s, n) => {
    const ts = `${s.epoch}.${String((n + 1) * 100).padStart(6, '0')}`;
    if (s.m.id) tsOf.set(s.m.id, ts);
    register(s.m.id, `slack:${ts}`, s.m.inc, s.m.copyOf);
    (s as { ts?: string }).ts = ts;
  });
  const dayFiles = new Map<string, unknown[]>();
  for (const s of stamped) {
    if (!chanId.has(s.m.channel)) fail(`unknown slack channel ${s.m.channel}`);
    const ts = (s as { ts?: string }).ts!;
    const entry: Record<string, unknown> = { type: 'message', user: person(s.m.who).slack ?? fail(`${s.m.who} has no slack id`), text: s.m.text, ts };
    if (s.m.thread) entry.thread_ts = tsOf.get(s.m.thread) ?? fail(`thread parent ${s.m.thread} must precede reply`);
    else if (spec.slack.some((o) => o.thread === s.m.id && s.m.id)) entry.thread_ts = ts;
    const k = `${s.m.channel}/${s.m.day}`;
    (dayFiles.get(k) ?? dayFiles.set(k, []).get(k)!).push(entry);
  }
  for (const [k, msgs] of dayFiles) write(join(dir, 'sources', 'slack-export', `${k}.json`), json(msgs));

  for (const p of pending) {
    for (const label of p.copyOf) {
      const of = labelToSource.get(label) ?? fail(`copyOf label ${label} not found`);
      copies.push({ sourceId: p.sourceId, of });
    }
  }

  // ---- people ----
  const people: PeopleDirectory = {
    people: spec.people.map((p) => ({
      id: pid(p.slug),
      name: p.name,
      role: p.role,
      groups: p.groups,
      actorIds: [
        ...(teamsAuthors.has(p.slug) ? [`person:teams:${p.name}`] : []),
        ...(p.slack ? [`person:slack:${p.slack}`] : []),
        ...(p.email ? [`person:email:${p.email}`] : []),
      ],
      available: p.available !== false,
    })),
  };
  write(join(dir, 'people.json'), json(people));

  // ---- truth ----
  const truth: ScenarioTruth = {
    familyId: id,
    entities: spec.entities,
    incidents: spec.incidents.map((i) => ({
      key: i.key,
      title: i.title,
      sourceIds: incSources.get(i.key) ?? fail(`incident ${i.key} has no messages`),
      realCause: i.realCause,
      expectedClaims: i.claims.map((c) => ({ type: c.type, statement: c.statement, ...(c.by ? { by: pid(person(c.by).slug) } : {}) })),
      attempts: i.attempts.map((a) => ({ action: a.action, by: pid(person(a.by).slug), performed: a.performed })),
      outcome: { ...i.outcome, ...(i.outcome.reportedBy ? { reportedBy: pid(person(i.outcome.reportedBy).slug) } : {}) },
      knowledge: Object.fromEntries(Object.entries(i.knowledge).map(([s, k]) => [pid(person(s).slug), k])),
      accessGroups: i.accessGroups,
    })),
    copies,
  };
  write(join(dir, 'truth.json'), json(truth));

  // ---- incoming ----
  const incoming: IncomingProblems = {
    familyId: id,
    problems: spec.problems.map((p) => {
      for (const k of p.key.relatedIncidentKeys) if (!incKeys.has(k)) fail(`problem ${p.id}: unknown incident ${k}`);
      const gap = p.key.consequentialGap;
      return {
        id: p.id,
        text: p.text,
        requester: pid(person(p.requester).slug),
        ...(p.observations ? { observations: p.observations } : {}),
        key: {
          ...p.key,
          consequentialGap: gap ? { ...gap, answerers: gap.answerers.map((s) => pid(person(s).slug)) } : undefined,
          answers: Object.fromEntries(Object.entries(p.key.answers).map(([s, a]) => [pid(person(s).slug), a])),
        },
      };
    }),
  };
  // drop undefined consequentialGap for clean JSON
  write(join(dir, 'incoming.json'), json(incoming));
}

export function buildAll(outRoot: string = SCENARIOS_DIR): void {
  const ids = new Set<string>();
  for (const f of ALL_FAMILIES) {
    if (ids.has(f.entry.id)) throw new Error(`duplicate family id ${f.entry.id}`);
    ids.add(f.entry.id);
    buildFamily(f, outRoot);
  }
  const families: FamiliesFile = {
    version: '1.0.0',
    generatedBy: 'benchmarks/authoring/build.ts (Claude agent authored; see data/scenarios/REVIEW.md)',
    families: ALL_FAMILIES.map((f) => ({ ...f.entry, dir: f.entry.id })),
  };
  write(join(outRoot, 'families.json'), json(families));
  freezeTestLock(outRoot);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildAll();
  console.log(`built ${ALL_FAMILIES.length} families into ${SCENARIOS_DIR}`);
}
