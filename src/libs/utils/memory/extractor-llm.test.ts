import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { EvidenceEnvelope, KnowledgeStore } from '../contracts/index.ts';
import type { ModelProvider } from '../models/providers/index.ts';
import { ProviderError } from '../models/providers/index.ts';
import {
  buildCaseView, createLlmExtractor, enrichWithModel, extractionJsonSchema, importFromPath, locateExcerpt, openStore, validateExtraction,
  type EnrichItem,
} from './index.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../..');
const TEAMS = join(ROOT, 'data/fixtures/dev-family-01/teams.json');
const ORG = 'org1';
const NOW = '2026-11-07T00:00:00Z';
const everyone = { id: 'p-any', groups: [] as string[] };

/** A provider that answers generateJson with a canned object built from the thread; records the schema and prompt. */
function fakeProvider(answer: (ev: EvidenceEnvelope[]) => unknown, evidence: () => EvidenceEnvelope[]) {
  const seen: { prompt?: string; schema?: Record<string, unknown> } = {};
  const p: Pick<ModelProvider, 'kind' | 'generateJson'> & { seen: typeof seen } = {
    kind: 'local', seen,
    async generateJson(_model, prompt, schema) { seen.prompt = prompt; seen.schema = schema; return answer(evidence()); },
  };
  return p;
}

function importRules(s: KnowledgeStore): EnrichItem[] {
  let items: EnrichItem[] = [];
  importFromPath(s, { format: 'teams-json', path: TEAMS, orgId: ORG, now: NOW, onCommitted: (it) => { items = it; } });
  return items;
}

const byText = (ev: EvidenceEnvelope[], re: RegExp): EvidenceEnvelope => ev.find((e) => re.test(e.text))!;

/** One good model-only claim, one restatement of a rules claim, one fabricated excerpt, one unknown message, one unknown person. */
function modelAnswer(ev: EvidenceEnvelope[]) {
  const first = byText(ev, /keep flapping/);
  const done = byText(ev, /^Done\./);
  const set = byText(ev, /Set the hold timer back/);
  return {
    claims: [
      { type: 'hypothesis', statement: 'The firmware update this morning triggered the flapping.', subjectEntityNames: ['RTR-117'], assertedByActorId: first.author.id, evidence: [{ evidenceId: first.id, excerpt: 'keep flapping since the firmware update this morning' }], confidence: 0.6 },
      { type: 'advice', statement: 'Set the hold timer back to 90 seconds.', subjectEntityNames: ['RTR-117'], assertedByActorId: set.author.id, evidence: [{ evidenceId: set.id, excerpt: 'Set the hold timer back to 90 seconds on the neighbors' }] },
      { type: 'action', statement: 'Mikko replaced the power supply on RTR-117.', subjectEntityNames: ['RTR-117'], evidence: [{ evidenceId: done.id, excerpt: 'power supply replaced on RTR-117' }] },
      { type: 'observation', statement: 'Fans are loud.', subjectEntityNames: [], evidence: [{ evidenceId: 'ev_not_in_thread', excerpt: 'Fans are loud' }] },
    ],
    entities: [
      { type: 'asset', name: 'RTR-117', aliases: ['edge router RTR-117'], evidence: [{ evidenceId: first.id, excerpt: 'edge router RTR-117' }] },
      { type: 'component', name: 'PSU', aliases: [], evidence: [{ evidenceId: done.id, excerpt: 'the PSU' }] },
    ],
    links: [
      { personActorId: 'person:teams:mikko', contribution: 'performed-action', evidence: [{ evidenceId: done.id, excerpt: 'Done.' }], firsthand: true },
      { personActorId: first.author.id, contribution: 'reported-problem', evidence: [{ evidenceId: first.id, excerpt: 'BGP sessions on edge router RTR-117 keep flapping' }], firsthand: true },
    ],
    incidents: [{ key: 'model-made-up-key', evidenceIds: [first.id], title: 'A different case title' }],
    usefulness: [],
  };
}

test('extractor-llm: the JSON schema mirrors ExtractionProposal and the prompt carries indexed messages with evidence ids', async () => {
  const schema = extractionJsonSchema();
  const props = (schema as { properties: Record<string, unknown> }).properties;
  assert.deepEqual(Object.keys(props).sort(), ['claims', 'entities', 'incidents', 'links', 'usefulness']);
  const s = openStore(':memory:');
  const items = importRules(s);
  const ev = items[0]!.ctx.evidence;
  const p = fakeProvider(modelAnswer, () => ev);
  await createLlmExtractor({ provider: p, model: 'qwen3:4b' }).extract(items[0]!.ctx);
  assert.match(p.seen.prompt!, /\[1\] id=ev_\w+ author=Hanna/);
  assert.match(p.seen.prompt!, /Example 4/);
  assert.ok(p.seen.schema && 'properties' in p.seen.schema);
  assert.ok(p.seen.prompt!.includes(ev[3]!.text));
});

test('extractor-llm: the validator drops a fabricated excerpt, an unknown message and an unknown person; spans come from the excerpt', () => {
  const s = openStore(':memory:');
  const items = importRules(s);
  const ctx = items[0]!.ctx;
  const v = validateExtraction(modelAnswer(ctx.evidence), ctx, { route: 'local', version: 'ollama-extract@1:qwen3:4b' });
  assert.deepEqual(v.dropped.map((d) => `${d.kind}:${d.reason}`).sort(), [
    'claim:excerpt-not-in-evidence', 'claim:unknown-evidence', 'entity:excerpt-not-in-evidence', 'link:unknown-person',
  ]);
  assert.equal(v.proposal.claims.length, 2);
  for (const c of v.proposal.claims) {
    const e = ctx.evidence.find((x) => x.id === c.evidence[0]!.evidenceId)!;
    assert.equal(e.text.slice(c.evidence[0]!.span!.start, c.evidence[0]!.span!.end), c.evidence[0]!.excerpt);
  }
  assert.ok(!JSON.stringify(v.proposal).includes('power supply'));
  // whitespace in the excerpt may differ from the message (mail line breaks)
  assert.deepEqual(locateExcerpt('one two\n  three', 'two three'), { start: 4, end: 15, excerpt: 'two\n  three' });
  assert.equal(locateExcerpt('one two', 'two four'), undefined);
});

test('extractor-llm: union keeps the rules commit intact, re-keys to the rules case and labels claims per route; the node says so', async () => {
  const s = openStore(':memory:');
  const items = importRules(s);
  const rulesClaims = new Map(s.list('claim').map((c) => [c.id, JSON.stringify(c)]));
  const cases = s.list('case').map((c) => c.id);
  assert.equal(cases.length, 1);
  const p = fakeProvider(modelAnswer, () => items[0]!.ctx.evidence);
  const r = await enrichWithModel(s, items, createLlmExtractor({ provider: p, model: 'qwen3:4b' }), { orgId: ORG, accessScope: { visibility: 'org' }, now: NOW });
  assert.equal(r.route.version, 'ollama-extract@1:qwen3:4b');
  assert.equal(r.fallback, undefined);
  assert.equal(r.dropped.length, 4);
  // no second case from the model's incident key
  assert.deepEqual(s.list('case').map((c) => c.id), cases);
  // every rules claim is still there and still labelled rules
  for (const [id] of rulesClaims) assert.equal(s.get('claim', id)!.extraction.route, 'rules');
  const model = s.list('claim').filter((c) => c.extraction.route === 'local');
  assert.deepEqual(model.map((c) => c.statement), ['The firmware update this morning triggered the flapping.']);
  assert.deepEqual(r.modelClaimIds, model.map((c) => c.id));
  assert.equal(model[0]!.caseId, cases[0]);
  assert.deepEqual(model[0]!.extraction, { route: 'local', version: 'ollama-extract@1:qwen3:4b' });
  // the restated advice was not committed a second time under the model's label
  assert.equal(s.list('claim').filter((c) => /hold timer back to 90/.test(c.statement)).every((c) => c.extraction.route === 'rules'), true);
  const view = buildCaseView(s, cases[0]!, everyone)!;
  const causes = view.timeline.find((n) => n.stage === 'hypothesis')!;
  assert.match(causes.detail, /The firmware update this morning triggered the flapping\. \(proposed by local model qwen3:4b, committed by rules\)/);
  assert.deepEqual(causes.provenance, ['proposed by local model qwen3:4b, committed by rules']);
  // nodes built only from rules claims carry no provenance
  assert.equal(view.timeline.find((n) => n.stage === 'check')!.provenance, undefined);
  // running it again is idempotent
  const before = JSON.stringify(s.list('claim'));
  await enrichWithModel(s, items, createLlmExtractor({ provider: p, model: 'qwen3:4b' }), { orgId: ORG, accessScope: { visibility: 'org' }, now: NOW });
  assert.equal(JSON.stringify(s.list('claim')), before);
});

test('extractor-llm: a failing or slow model leaves the rules import as it was and labels the fallback route', async () => {
  const s = openStore(':memory:');
  const items = importRules(s);
  const before = JSON.stringify(s.list('claim'));
  const failures: string[] = [];
  const down: Pick<ModelProvider, 'kind' | 'generateJson'> = { kind: 'local', async generateJson() { throw new ProviderError('unreachable', 'ollama /api/generate: connect ECONNREFUSED'); } };
  const r = await enrichWithModel(s, items, createLlmExtractor({ provider: down, model: 'qwen3:4b' }), { orgId: ORG, accessScope: { visibility: 'org' }, onFailure: (why) => failures.push(why) });
  assert.equal(r.route.version, 'rules-extractor@1[fallback:extract:unreachable]');
  assert.equal(r.route.route, 'rules');
  assert.deepEqual(r.modelClaimIds, []);
  assert.equal(failures.length, 1);
  assert.equal(JSON.stringify(s.list('claim')), before);
  const slow: Pick<ModelProvider, 'kind' | 'generateJson'> = { kind: 'local', generateJson: () => new Promise(() => {}) };
  const t = await enrichWithModel(s, items, createLlmExtractor({ provider: slow, model: 'qwen3:4b' }), { orgId: ORG, accessScope: { visibility: 'org' }, timeoutMs: 20 });
  assert.equal(t.route.version, 'rules-extractor@1[fallback:extract:timeout]');
  // output that does not match the schema is a failure too, never a partial commit
  const junk: Pick<ModelProvider, 'kind' | 'generateJson'> = { kind: 'local', async generateJson() { return { claims: 'none' }; } };
  const j = await enrichWithModel(s, items, createLlmExtractor({ provider: junk, model: 'qwen3:4b' }), { orgId: ORG, accessScope: { visibility: 'org' } });
  assert.match(j.route.version, /\[fallback:extract:error\]/);
  assert.equal(JSON.stringify(s.list('claim')), before);
});

test('extractor-llm: an excerpt must carry the item (no one-letter spans, ids and numbers in the excerpt, entity names in their excerpt)', () => {
  const s = openStore(':memory:');
  const ctx = importRules(s)[0]!.ctx;
  const first = byText(ctx.evidence, /keep flapping/);
  const version = byText(ctx.evidence, /Version 4\.2\.1/);
  const v = validateExtraction({
    claims: [
      { type: 'advice', statement: 'Replace the chassis of TRN-999; Erkki confirmed it fixes the problem.', subjectEntityNames: ['TRN-999'], evidence: [{ evidenceId: first.id, excerpt: 'e' }] },
      { type: 'advice', statement: 'Replace the chassis of TRN-999 tonight.', subjectEntityNames: ['RTR-117'], evidence: [{ evidenceId: first.id, excerpt: 'BGP sessions on edge router RTR-117 keep flapping' }] },
      { type: 'condition', statement: 'Firmware version 4.3.0 was installed.', subjectEntityNames: ['RTR-117'], evidence: [{ evidenceId: version.id, excerpt: 'Version 4.2.1, installed around 10:30' }] },
      { type: 'condition', statement: 'Firmware 4.2.1 installed.', subjectEntityNames: ['RTR-117'], evidence: [{ evidenceId: version.id, excerpt: 'Version 4.2.1, installed around 10:30' }], condition: { key: 'unit.age', operator: 'eq', value: 'older (2014)' } },
      { type: 'observation', statement: 'BGP sessions on RTR-117 keep flapping.', subjectEntityNames: ['RTR-117', 'TRN-999', 'core switch'], evidence: [{ evidenceId: first.id, excerpt: 'BGP sessions on edge router RTR-117 keep flapping' }] },
    ],
    entities: [
      { type: 'asset', name: 'TRN-999', aliases: [], evidence: [{ evidenceId: first.id, excerpt: 'e' }] },
      { type: 'asset', name: 'TRN-999', aliases: [], evidence: [{ evidenceId: first.id, excerpt: 'BGP sessions on edge router' }] },
      { type: 'asset', name: 'RTR-117', aliases: ['edge router RTR-117', 'the big box'], evidence: [{ evidenceId: first.id, excerpt: 'RTR-117' }] },
    ],
    links: [{ personActorId: first.author.id, contribution: 'reported-problem', evidence: [{ evidenceId: first.id, excerpt: 'e' }], firsthand: true }],
    incidents: [], usefulness: [],
  }, ctx, { route: 'local', version: 'ollama-extract@1:fake' });
  assert.deepEqual(v.dropped.map((d) => `${d.kind}:${d.reason}`), [
    'claim:excerpt-does-not-support', 'claim:excerpt-does-not-support', 'claim:excerpt-does-not-support', 'claim:excerpt-does-not-support',
    'entity:excerpt-does-not-support', 'entity:excerpt-does-not-support', 'link:excerpt-does-not-support',
  ]);
  assert.deepEqual(v.proposal.claims.map((c) => c.statement), ['BGP sessions on RTR-117 keep flapping.']);
  // subject names the thread never mentions are left out; the claim keeps the real one
  assert.deepEqual(v.proposal.claims[0]!.subjectEntityNames, ['RTR-117']);
  assert.deepEqual(v.proposal.entities.map((e) => [e.name, e.aliases]), [['RTR-117', ['edge router RTR-117']]]);
  assert.ok(!JSON.stringify(v.proposal).includes('TRN-999'));
});

test('extractor-llm: who said it is the author of the cited message, not anyone the model names', () => {
  const s = openStore(':memory:');
  const ctx = importRules(s)[0]!.ctx;
  const first = byText(ctx.evidence, /keep flapping/);
  const olli = ctx.evidence.find((e) => e.author.id !== first.author.id)!.author;
  const v = validateExtraction({
    claims: [{ type: 'observation', statement: 'BGP sessions on RTR-117 keep flapping.', subjectEntityNames: ['RTR-117'], assertedByActorId: olli.id, evidence: [{ evidenceId: first.id, excerpt: 'BGP sessions on edge router RTR-117 keep flapping' }] }],
    entities: [],
    links: [
      { personActorId: olli.id, contribution: 'reported-problem', evidence: [{ evidenceId: first.id, excerpt: 'BGP sessions on edge router RTR-117 keep flapping' }], firsthand: true },
      { personActorId: olli.id, contribution: 'mentioned', evidence: [{ evidenceId: first.id, excerpt: 'Hi Olli, BGP sessions' }], firsthand: true },
      { personActorId: first.author.id, contribution: 'reported-problem', evidence: [{ evidenceId: first.id, excerpt: 'BGP sessions on edge router RTR-117 keep flapping' }], firsthand: true },
    ],
    incidents: [], usefulness: [],
  }, ctx, { route: 'local', version: 'ollama-extract@1:fake' });
  assert.equal(v.proposal.claims[0]!.assertedByActorId, first.author.id);
  assert.deepEqual(v.dropped.map((d) => `${d.kind}:${d.reason}`), ['link:person-not-author']);
  assert.deepEqual(v.proposal.links.map((l) => [l.personActorId, l.contribution, l.firsthand]), [
    [olli.id, 'mentioned', false], [first.author.id, 'reported-problem', true],
  ]);
});
