/**
 * E08 (retrieval with a local embedding model), E09 (extraction with a local schema-constrained model) and E10 (the
 * store metric and the bandit it rewards), BUILD_BRIEF 4 B2 and 5.4.
 *
 * E08 and E09 replay recorded model outputs (experiments/replay-models.ts, data/replays/e08-<model>/ and e09-<model>/),
 * so the default run is offline and hash-checked; `--record` is the one mode that reaches the local Ollama. E10 calls no
 * model: it drives the real service in-process (no socket) through the simulated-day machinery.
 * Every manifest is written before scoring. The test split is not opened here.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type {
  ConversationContext, EvidenceEnvelope, ExtractionProposal, FamilyManifestEntry, KnowledgeStore, PeopleDirectory, Principal, Split,
} from '../src/libs/utils/contracts/index.ts';
import { applyDirectory } from '../src/apps/service/directory.ts';
import { Engine } from '../src/apps/service/engine.ts';
import { createDemoClock } from '../src/apps/service/demo-clock.ts';
import { createDispatcher } from '../src/apps/service/http.ts';
import { defaultObservabilityPolicy } from '../src/apps/service/org-config.ts';
import {
  caseCard, commitProposal, createLlmExtractor, enrichWithModel, importFromPath, openStore, storeHealth, type DroppedItem, type StoreHealth,
} from '../src/libs/utils/memory/index.ts';
import { defaultInvestigationSettings, OUTCOME_KEY, parseProblemText } from '../src/libs/utils/investigation/index.ts';
import { EmbeddingIndex, resolveEntityIds, type RetrieverOptions } from '../src/libs/utils/retrieval/index.ts';
import { OllamaProvider } from '../src/libs/utils/models/providers/index.ts';
import {
  createSimClock, planDay, runDay, ServiceHttpError, type ActivityRow, type FamilyInput, type ProblemInput, type ServiceClient, type SourceInput,
} from '../src/libs/utils/simulation/index.ts';
import { knowledgeAccuracy, mergeReports, ratio, sliceFailuresByTag } from '../benchmarks/evaluator.ts';
import type { MaybeMetric, MetricReport, SystemKnowledge } from '../benchmarks/evaluator.ts';
import { familyEntry, loadHidden, loadVisibleInputs } from '../benchmarks/load.ts';
import { writeManifest, writeResults } from '../benchmarks/manifest.ts';
import type { VariantResult } from '../benchmarks/manifest.ts';
import { DEFAULT_SCENARIOS_DIR, loadFamiliesFile } from '../benchmarks/splits.ts';
import { baseManifest, familiesOf, fmt, problemTable, runVariant, writeExtra } from './common.ts';
import type { Decision, VariantRun } from './common.ts';
import { proposalToKnowledge } from './e01-convert.ts';
import { buildRetriever, collectKnowledge, evidenceSourceIdsOf, independentSupportOf, ORG } from './harness.ts';
import type { HarnessEmbedding, RetrieverName } from './harness.ts';
import { E01_METRICS, lexiconGaps } from './runners-e01.ts';
import { fixtureDir, RecordedEmbedder, RecordedGenerator, type ReplayMode } from './replay-models.ts';

export const E08_ID = 'e08-retrieval-embed';
export const E09_ID = 'e09-extraction-model';
export const E10_ID = 'e10-store-metric';

/** The brief's models: bge-m3 (embed) and qwen3:4b (extract), both recorded (D-B2-40, D-B2-50). */
export const DEFAULT_EMBED_MODEL = 'bge-m3';
export const DEFAULT_EXTRACT_MODEL = 'qwen3:4b';
const NOW = '2026-01-01T00:00:00.000Z';
const LONG_MS = 600_000;

export interface ModelRunOptions {
  mode?: ReplayMode;
  model?: string;
}

const sha16 = (s: string | Buffer): string => createHash('sha256').update(s).digest('hex').slice(0, 16);
const fileSha = (p: string): string | null => (existsSync(p) ? sha16(readFileSync(p)) : null);

/** Live provenance for a recording: the Ollama version and the model digest (record mode only). */
async function recordedBy(model: string): Promise<string> {
  const base = 'http://127.0.0.1:11434';
  const v = (await (await fetch(`${base}/api/version`)).json()) as { version?: string };
  const tags = (await (await fetch(`${base}/api/tags`)).json()) as { models?: Array<{ name: string; digest?: string }> };
  const m = tags.models?.find((x) => x.name === model || x.name === `${model}:latest`);
  if (!m) throw new Error(`model ${model} is not installed in Ollama (ollama list); nothing is pulled by the experiments`);
  return `ollama ${v.version ?? '?'} ${m.name}@${(m.digest ?? '?').slice(0, 12)} recorded ${new Date().toISOString().slice(0, 10)}`;
}

// ================================================================================================ E08

export const E08_VARIANTS = (model: string): Array<{ id: string; retriever: RetrieverName; route: 'rules' | 'local' | 'replay'; description: string }> => [
  { id: 'lexical-bm25', retriever: 'lexical', route: 'rules', description: 'BM25 only' },
  { id: 'local-trigram', retriever: 'trigram', route: 'local', description: 'hashed character-trigram vectors (local, not learned)' },
  { id: `embed-${model}`, retriever: 'embed', route: 'replay', description: `${model} embeddings alone (evidence, claims and case cards; cosine aggregated to the case by max), replayed from data/replays` },
  { id: 'hybrid-rrf', retriever: 'hybrid', route: 'local', description: 'the shipped fusion: BM25 + exact id + local trigram, reciprocal rank fusion' },
  { id: `hybrid+embed-${model}`, retriever: 'hybrid-embed', route: 'replay', description: `the fusion with the embed slot on: BM25 + exact id + ${model} in place of the trigram list (what embed=local runs)` },
];

const E08_METRICS = ['@1.linking.recall', '@3.linking.recall', '@3.accessible.linking.recall', '@3.linking.precision', 'retrieval.lookalikeTop1Rate', 'retrieval.lookalikeRejectionRate', 'recommendation.kindAccuracy', 'recommendation.falseAdviceRate'];

/** Lookalike rejection = problems tagged lookalike whose top-1 case is NOT the lookalike, over the same denominator. */
const rejection = (m: MaybeMetric | undefined): MaybeMetric | undefined => (m ? { value: m.denominator ? (m.denominator - m.numerator) / m.denominator : 0, numerator: m.denominator - m.numerator, denominator: m.denominator } : undefined);

/** Paraphrases of the judge's problem. The first is the brief's; the other two avoid every lexicon cue word (checked by the parser below). */
export const PARAPHRASES = [
  'green light, nothing flowing',
  'The lamp on the box is green, yet no data gets through to the customer.',
  'Everything on the unit looks healthy, but the customer is still getting nothing.',
];

export interface ProbeRow {
  text: string;
  parsedConditions: string[];
  target: string;
  ranks: Record<string, number | null>;
  top3: Record<string, string[]>;
}

/** The demo store as demo:reset makes it (synthetic: demo families + dev fixture; the Elisa files are absent here). */
async function demoEngine(start = '2026-11-09T07:00:00.000Z'): Promise<{ engine: Engine; requester: Principal }> {
  const engine = new Engine({
    dbPath: ':memory:', linucbStatePath: false, demoClock: createDemoClock(() => new Date(start)),
    investigation: { observability: defaultObservabilityPolicy }, elisaDir: join(DEFAULT_SCENARIOS_DIR, '__no-elisa__'),
  });
  const reset = await engine.resetDemo('synthetic');
  const d = engine.directory().find((x) => x.personEntityId === reset.defaultPersonEntityId) ?? engine.directory()[0]!;
  return { engine, requester: { id: d.personEntityId, displayName: d.name, groups: d.groups, type: 'human' } };
}

/**
 * Where the target case lands for each paraphrase and retriever on the demo store. The target is TRN-042 when the
 * Elisa files are imported, else its stand-in TRN-117 of optic-forwarding-a (same story: SFP swapped, link up, no traffic).
 */
export async function paraphraseProbe(emb: HarnessEmbedding, variants: ReturnType<typeof E08_VARIANTS>): Promise<ProbeRow[]> {
  const { engine, requester } = await demoEngine();
  const store = engine.store;
  try {
    const settings = defaultInvestigationSettings({});
    const index = new EmbeddingIndex(store, emb.embedder, emb.model, { cardText: (id) => caseCard(store, id), ...(emb.timeoutMs ? { indexTimeoutMs: emb.timeoutMs, queryTimeoutMs: emb.timeoutMs } : {}) });
    await index.indexStore();
    const embedding: RetrieverOptions['embedding'] = { index, ...(emb.timeoutMs ? { timeoutMs: emb.timeoutMs } : {}), ...(emb.onFailure ? { onFailure: emb.onFailure } : {}) };
    const entityName = new Map(store.list('entity').map((e) => [e.id, e.name]));
    const hasAsset = (caseId: string, asset: string) => (store.get('case', caseId)?.entityIds ?? []).some((id) => entityName.get(id) === asset);
    const target = store.list('entity').some((e) => e.name === 'TRN-042') ? 'TRN-042' : 'TRN-117';
    const label = (caseId: string) => store.get('case', caseId)?.title ?? caseId;
    const rows: ProbeRow[] = [];
    for (const text of PARAPHRASES) {
      const parsed = parseProblemText(text, 'probe', { olderThroughYear: settings.ageFold.olderThroughYear });
      const visible = store.list('entity');
      const { ids: entityIds } = resolveEntityIds(text, visible, []);
      const row: ProbeRow = { text, parsedConditions: parsed.conditions.map((c) => c.key), target, ranks: {}, top3: {} };
      for (const v of variants) {
        const r = buildRetriever(v.retriever, store, settings, embedding);
        const hits = (await r.search({ text, conditions: parsed.conditions, entityIds, requesterPrincipal: requester, k: 8 })).flatMap((c) => (c.caseId ? [c.caseId] : []));
        const at = hits.findIndex((id) => hasAsset(id, target));
        row.ranks[v.id] = at >= 0 ? at + 1 : null;
        row.top3[v.id] = hits.slice(0, 3).map(label);
      }
      rows.push(row);
    }
    return rows;
  } finally {
    engine.close();
  }
}

export async function runE08(opts: ModelRunOptions = {}): Promise<Decision> {
  const model = opts.model ?? DEFAULT_EMBED_MODEL;
  const mode = opts.mode ?? 'replay';
  const splits: Split[] = ['demo', 'train', 'validation'];
  const dir = fixtureDir('e08', model);
  const fixture = join(dir, 'embeddings.json');
  if (mode === 'replay' && !existsSync(fixture)) throw new Error(`E08: no recording at ${fixture}; run \`node experiments/run.ts e08 --record\` once with Ollama and ${model} installed`);
  const variants = E08_VARIANTS(model);
  const live = mode === 'record' ? new OllamaProvider() : undefined;
  const embedder = new RecordedEmbedder(fixture, { mode, ...(live ? { live, recordedBy: await recordedBy(model) } : {}) });
  const failures: Record<string, number> = {};
  let current = '';
  const emb: HarnessEmbedding = { embedder, model, ...(mode === 'record' ? { timeoutMs: 120_000 } : {}), onFailure: (reason) => { failures[current] = (failures[current] ?? 0) + 1; void reason; } };
  if (live) await live.warm(model, '10m', { embedding: true });

  const manifest = baseManifest({
    id: E08_ID,
    hypothesis: `A local embedding model (${model}) finds the relevant case by meaning: the fusion with ${model} in place of the trigram list keeps recall@3 and the lookalike rejection of the shipped hybrid on the hash-locked splits, and finds the judge's paraphrased problem that the lexical lists miss.`,
    splits,
    visibleInputs: ['sources/ (through the scenario-dir importer)', 'people.json', 'incoming problem text', 'incoming observations', `data/replays/${dir.split('/').pop()}/embeddings.json (vectors recorded once from the local Ollama ${model}; replayed, hash-checked per text)`],
    variants: variants.map((v) => ({ id: v.id, description: v.description, route: v.route })),
    route: 'mixed',
    config: {
      k: 8, embedModel: model, fixture: `data/replays/${dir.split('/').pop()}/embeddings.json`, fixtureSha256: fileSha(fixture), mode,
      index: 'evidence text, live claim statements and case cards (memory/case-card.ts), indexed once after the import; brute-force cosine, hits below 0.3 dropped, aggregated to the case by max; the embed list is pruned at 0.75 of its best hit (retrieval/hybrid.ts defaults)',
      decisionSplit: 'validation', testSplit: 'not opened: the test split was opened once for E02/E04 (results/e02-test, e04-test); E08 stays on demo/train/validation',
      lookalikeDefinition: 'top-1 candidate case maps to an incident outside key.relatedIncidentKeys, over problems tagged lookalike-different-cause; rejection = 1 - that rate over the same denominator',
      paraphraseProbe: { texts: PARAPHRASES, store: 'the demo store as demo:reset --synthetic builds it (demo families + dev fixture)', target: 'TRN-042 when the Elisa files are present, else its stand-in TRN-117 (optic-forwarding-a)' },
    },
    seeds: [0],
    metrics: E08_METRICS,
    acceptanceCriteria: [
      `On validation: hybrid+embed recall@3 >= hybrid-rrf recall@3 AND hybrid+embed lookalike-top-1 rate <= hybrid-rrf's -> embed=local may be offered as the opt-in embed slot for the demo; else the embed slot stays rules by default and the result is reported as is. (The default is rules either way; nothing is enabled silently.)`,
      'Paraphrase probe: reported per retriever as the rank of the target case (null = not in the top 8); not a pass/fail criterion.',
      'Any embedding fallback (no recording, mismatch) in replay mode fails the run.',
    ],
    stopRule: 'deterministic; one recording pass; none',
  });
  writeManifest(manifest);

  const out: VariantResult[] = [];
  const table: Array<Record<string, unknown>> = [];
  const byVariant: Record<string, VariantRun> = {};
  for (const split of splits) {
    for (const v of variants) {
      current = v.id;
      const needs = v.retriever === 'embed' || v.retriever === 'hybrid-embed';
      const vr = await runVariant(v.id, split, { retriever: v.retriever, ...(needs ? { embedding: emb } : {}) });
      const rej = rejection(vr.result.metrics['retrieval.lookalikeTop1Rate']);
      if (rej) vr.result.metrics['retrieval.lookalikeRejectionRate'] = rej;
      vr.result.counts['embed.fallbacks'] = needs ? failures[v.id] ?? 0 : null;
      if (needs) vr.result.provenance = 'replay-fixture';
      failures[v.id] = 0;
      out.push(vr.result);
      table.push(...problemTable(vr));
      if (split === 'validation') byVariant[v.id] = vr;
    }
  }
  current = 'probe';
  const probe = await paraphraseProbe(emb, variants);
  embedder.save();
  if (mode === 'replay' && (embedder.stats.missing > 0 || out.some((v) => (v.counts['embed.fallbacks'] ?? 0) > 0) || (failures.probe ?? 0) > 0)) {
    throw new Error(`E08 replay incomplete: ${embedder.stats.missing} texts had no recording; record again with --record`);
  }

  const h = byVariant['hybrid-rrf']!;
  const he = byVariant[`hybrid+embed-${model}`]!;
  const rH = h.scored.metrics['@3.linking.recall'];
  const rE = he.scored.metrics['@3.linking.recall'];
  const kH = h.scored.metrics['retrieval.lookalikeTop1Rate'];
  const kE = he.scored.metrics['retrieval.lookalikeTop1Rate'];
  const recallOk = !!rH && !!rE && rE.value >= rH.value;
  const lookOk = !!kH && !!kE && kE.value <= kH.value;
  const probeLine = probe.map((p) => `"${p.text}" -> ${p.target} at ${variants.map((v) => `${v.id} ${p.ranks[v.id] ?? '-'}`).join(', ')}`).join('; ');
  const decision: Decision = {
    experiment: 'E08',
    hypothesis: manifest.hypothesis,
    criterion: manifest.acceptanceCriteria[0]!,
    outcome: `validation recall@3 hybrid+embed ${fmt(rE)} vs hybrid ${fmt(rH)} -> ${recallOk ? 'met' : 'not met'}; lookalike-top-1 hybrid+embed ${fmt(kE)} vs hybrid ${fmt(kH)} -> ${lookOk ? 'met' : 'not met'}. Paraphrase probe (rank of the target case, - = not in the top 8): ${probeLine}.`,
    shipped: recallOk && lookOk ? `embed=local (${model}) is offered as the opt-in embed slot; the default stays rules (hybrid-rrf).` : `The embed slot stays rules by default (hybrid-rrf); ${model} is not offered on the strength of this run.`,
    detail: Object.fromEntries(Object.entries(byVariant).map(([k, v]) => [k, `recall@1 ${fmt(v.scored.metrics['@1.linking.recall'])}; recall@3 ${fmt(v.scored.metrics['@3.linking.recall'])}; lookalike-top-1 ${fmt(v.scored.metrics['retrieval.lookalikeTop1Rate'])}; kindAccuracy ${fmt(v.scored.metrics['recommendation.kindAccuracy'])}`])),
  };
  writeExtra(E08_ID, 'problems.json', table);
  writeExtra(E08_ID, 'probe.json', probe);
  writeExtra(E08_ID, 'decision.json', decision);
  writeResults({
    manifestId: E08_ID, finishedAt: new Date().toISOString(), variants: out,
    notes: [
      `Embedding vectors are replayed from data/replays/${dir.split('/').pop()}/embeddings.json (recorded once from the local Ollama; ${embedder.stats.served} lookups served, ${embedder.stats.recorded} recorded in this run, 0 fallbacks). The replay is per text and hash-checked, so a changed case card or claim fails the run instead of silently changing a number.`,
      'The test split was not opened: it was opened once already for E02/E04. E08 is scored on demo, train and validation; validation is the decision split.',
      'The embedding index is built once after the import, as the service does after demo:reset; answers within a run do not re-index (the first investigation, which the retrieval metrics read, is unaffected).',
      'Lookalike rejection is 1 - lookalike-top-1 over the same denominator (problems tagged lookalike-different-cause with a candidate).',
      `Paraphrase probe on the demo store (Elisa files absent, so the target is ${probe[0]?.target}): parsed condition keys per text ${probe.map((p) => `[${p.parsedConditions.join(', ') || 'none'}]`).join(' ')}. ${probeLine}.`,
      'Answer keys are unreviewed (data/scenarios/REVIEW.md); results are provisional.',
    ],
  });
  console.log(`${E08_ID}: ${decision.outcome}`);
  return decision;
}

// ================================================================================================ E09

interface Prepared {
  store: KnowledgeStore;
  people: PeopleDirectory;
  items: Array<{ ctx: ConversationContext; proposal: ExtractionProposal }>;
  scope: { visibility: 'org' } | { visibility: 'group'; groups: string[] };
}

/** prepareFamily plus the committed rules items (the extract slot's model pass runs on exactly these). */
function prepareWithItems(familyId: string): Prepared {
  const entry = familyEntry(familyId);
  const people = loadVisibleInputs(familyId).people;
  const store = openStore(':memory:');
  let items: Prepared['items'] = [];
  let scope: Prepared['scope'] = { visibility: 'org' };
  importFromPath(store, { format: 'scenario-dir', path: join(DEFAULT_SCENARIOS_DIR, entry.dir), orgId: ORG, now: NOW, onCommitted: (it, s) => { items = it; scope = s as Prepared['scope']; } });
  applyDirectory(store, ORG, people);
  return { store, people, items, scope };
}

export const E09_VARIANTS = (model: string) => ({
  rules: 'rules-extractor@current',
  direct: `ollama-extract ${model} (direct)`,
  commit: `ollama-extract ${model}→commit`,
  union: `rules ∪ ${model} (union commit)`,
}) as const;
type E09Key = 'rules' | 'direct' | 'commit' | 'union';
const E09_KEYS: E09Key[] = ['rules', 'direct', 'commit', 'union'];

export interface E09FamilyRun {
  familyId: string;
  reports: Record<E09Key, MetricReport>;
  counts: Record<E09Key, Record<string, number>>;
  dropped: DroppedItem[];
  modelClaims: Array<{ statement: string; type: string }>;
  /** Threads where the model's output could not be used (bad JSON, schema mismatch, timeout), with the reason. */
  failed: string[];
}

const sysCounts = (sys: SystemKnowledge): Record<string, number> => ({ 'e09.claims': sys.claims.length, 'e09.entities': sys.entities.length, 'e09.cases': sys.cases.length, 'e09.links': sys.links.length, 'e09.attempts': sys.attempts?.length ?? 0, 'e09.outcomes': sys.outcomes?.length ?? 0 });

/** One family through the four arms; `generator` is the recorded (or recording) model. */
export async function runE09Family(familyId: string, generator: RecordedGenerator, model: string): Promise<E09FamilyRun> {
  const { people, truth } = loadHidden(familyId);
  const route = { route: 'replay' as const, version: `replay:${fixtureDir('e09', model).split('/').pop()}/ollama-extract@1:${model}` };
  const extractor = createLlmExtractor({ provider: generator, model, route, timeoutMs: LONG_MS });

  // (a) rules: the real import path.
  const a = prepareWithItems(familyId);
  const sourceOf = evidenceSourceIdsOf(a.store);
  const sysA = collectKnowledge(a.store, sourceOf);

  // (b) the model's validated proposals scored directly (no memory commit), merged over the family's threads.
  const dropped: DroppedItem[] = [];
  const validated = [];
  const failed: string[] = [];
  for (const it of a.items.filter((i) => i.ctx.evidence.length > 0)) {
    try {
      const v = await extractor.extractValidated(it.ctx);
      dropped.push(...v.dropped);
      validated.push({ ctx: it.ctx, proposal: v.proposal });
    } catch (e) {
      // Bad JSON, a schema mismatch or a timeout: the thread yields nothing from the model (counted, not hidden).
      if (e instanceof Error && /no recorded generation/.test(e.message)) throw e;
      failed.push(`${it.ctx.evidence[0]?.id ?? '?'}: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`);
    }
  }
  const merged: ExtractionProposal = {
    route, entities: validated.flatMap((v) => v.proposal.entities), claims: validated.flatMap((v) => v.proposal.claims), links: validated.flatMap((v) => v.proposal.links),
    incidents: validated.flatMap((v) => v.proposal.incidents), usefulness: validated.flatMap((v) => v.proposal.usefulness),
  };
  const sysB = proposalToKnowledge(merged, { orgId: ORG, familyId, directory: people, evidenceSourceIds: sourceOf, independentSupport: (ids) => independentSupportOf(a.store, ids) });

  // (c) the same proposals alone through the real commitProposal, in a store holding only the evidence.
  const c = openStore(':memory:');
  const copyEv = (e: EvidenceEnvelope): EvidenceEnvelope => {
    const { usefulness: _u, ...meta } = (e.metadata ?? {}) as Record<string, unknown>;
    return { ...e, metadata: meta };
  };
  for (const e of a.store.list('evidence')) c.put('evidence', copyEv(e));
  for (const v of validated) commitProposal(c, v.proposal, v.ctx, { orgId: ORG, accessScope: a.scope, now: NOW });
  applyDirectory(c, ORG, people);
  const sysC = collectKnowledge(c, sourceOf);

  // (d) the union, exactly as POST /import commits it with extract=local: rules first, then the model's proposal re-keyed to the rules incidents.
  const d = prepareWithItems(familyId);
  const rep = await enrichWithModel(d.store, d.items, extractor, { orgId: ORG, accessScope: d.scope, now: NOW, timeoutMs: LONG_MS });
  // enrich.ts is all-or-nothing per import, as in the app: one failed thread leaves the family on rules alone.
  if (rep.fallback && /no recorded generation/.test(rep.fallback.reason)) throw new Error(`E09 ${familyId}: ${rep.fallback.reason}`);
  applyDirectory(d.store, ORG, people);
  const sysD = collectKnowledge(d.store, sourceOf);
  const modelClaims = rep.modelClaimIds.map((id) => d.store.get('claim', id)).flatMap((x) => (x ? [{ statement: x.statement, type: x.type }] : []));

  const score = (sys: SystemKnowledge) => knowledgeAccuracy(sys, truth, { people });
  const out: E09FamilyRun = {
    familyId,
    reports: { rules: score(sysA), direct: score(sysB), commit: score(sysC), union: score(sysD) },
    counts: {
      rules: sysCounts(sysA), direct: { ...sysCounts(sysB), 'e09.validatorDropped': dropped.length, 'e09.threads': validated.length + failed.length, 'e09.threadsFailed': failed.length },
      commit: sysCounts(sysC), union: { ...sysCounts(sysD), 'e09.modelOnlyClaimsCommitted': rep.modelClaimIds.length, 'e09.importsFellBack': rep.fallback ? 1 : 0 },
    },
    dropped, modelClaims, failed,
  };
  a.store.close();
  c.close();
  d.store.close();
  return out;
}

export async function runE09(opts: ModelRunOptions = {}): Promise<void> {
  const model = opts.model ?? DEFAULT_EXTRACT_MODEL;
  const mode = opts.mode ?? 'replay';
  const SPLITS: Array<'train' | 'validation'> = ['train', 'validation'];
  const dir = fixtureDir('e09', model);
  const fams: Record<string, string[]> = Object.fromEntries(SPLITS.map((s) => [s, familiesOf(s).map((f) => f.id)]));
  const all = [...fams.train!, ...fams.validation!];
  if (mode === 'replay') for (const f of all) if (!existsSync(join(dir, `${f}.json`))) throw new Error(`E09: no recording at ${join(dir, `${f}.json`)}; run \`node experiments/run.ts e09 --record\` once with Ollama and ${model} installed`);
  const live = mode === 'record' ? new OllamaProvider() : undefined;
  const by = live ? await recordedBy(model) : undefined;
  const V = E09_VARIANTS(model);
  const manifest = baseManifest({
    id: E09_ID,
    hypothesis: `A local schema-constrained model (${model}, four few-shot examples, evidence-substring validator) recovers claims the rules extractor misses on the E01 families, and the union commit (rules first, model-only claims labelled with the model's route) raises claim recall without lowering precision or merging cases falsely.`,
    splits: SPLITS,
    visibleInputs: ['sources/ (through the scenario-dir importer)', 'people.json', `data/replays/${dir.split('/').pop()}/<family>.json (the model's raw JSON per thread, recorded once from the local Ollama; replayed, hash-checked on model + prompt + schema)`],
    variants: [
      { id: V.rules, description: 'The real import path with the rules extractor (as E01 variant a)', route: 'rules' },
      { id: V.direct, description: `${model} proposals after the validator, scored directly without memory/commit (as E01 variant b)`, route: 'replay' },
      { id: V.commit, description: `the same proposals alone through the real commitProposal in an evidence-only store (as E01 variant c)`, route: 'replay' },
      { id: V.union, description: 'what POST /import commits with extract=local: the rules commit, then enrichWithModel commits the model proposal re-keyed to the rules incidents (memory/enrich.ts)', route: 'replay' },
    ],
    route: 'mixed',
    config: {
      model, mode, families: fams, fixtureSha256: Object.fromEntries(all.map((f) => [f, fileSha(join(dir, `${f}.json`))])),
      prompt: 'memory/extractor-llm.ts buildExtractionPrompt (four few-shot examples, indexed messages with evidence and actor ids); Ollama format = the zod schema as JSON schema; think:false, temperature 0, seed 7',
      validator: 'validateExtraction: drop any claim/entity/link citing an unknown message or an excerpt not in the message text (whitespace-tolerant); links to unknown people dropped',
      claimMatch: 'same ClaimType and token Jaccard >= 0.5 (benchmarks/evaluator.ts), as E01',
      budget: 'the live extract slot has one 60 s deadline per import; the experiment lifts it (600 s per call) so the model output is scored, and reports the recorded latencies against the 60 s budget',
      briefModel: 'qwen3:4b is the brief\'s extract model; when it is not installed the runner records with the installed model named here (D-B2-40)',
      test: 'test families are never read',
    },
    seeds: [7],
    metrics: E01_METRICS,
    acceptanceCriteria: ['Report all four arms side by side per split; no winner is declared (as E01).', 'The rules extractor remains the default extract route regardless of the result; extract=local stays opt-in.', 'List the truth claims the model recovered and the rules missed, and every item the validator dropped.'],
    stopRule: 'One recording pass per family; replay thereafter. A fallback or a missing recording in replay mode fails the run.',
  });
  writeManifest(manifest);

  const variants: VariantResult[] = [];
  const found: Array<{ split: string; familyId: string; type: string; statement: string }> = [];
  const foundUnion: Array<{ split: string; familyId: string; type: string; statement: string }> = [];
  const droppedAll: Array<DroppedItem & { familyId: string }> = [];
  const modelOnly: Array<{ familyId: string; type: string; statement: string }> = [];
  const failedThreads: Array<{ familyId: string; thread: string }> = [];
  const latencies: number[] = [];
  const importMs: Record<string, number> = {};
  for (const split of SPLITS) {
    const entries: FamilyManifestEntry[] = familiesOf(split);
    const runs: E09FamilyRun[] = [];
    for (const f of entries) {
      const gen = new RecordedGenerator(join(dir, `${f.id}.json`), { mode, ...(live ? { live, recordedBy: by! } : {}) });
      const t0 = performance.now();
      runs.push(await runE09Family(f.id, gen, model));
      gen.save();
      if (gen.stats.missing) throw new Error(`E09 replay incomplete for ${f.id}: ${gen.stats.missing} prompts had no recording`);
      latencies.push(...gen.recordedLatencies());
      importMs[f.id] = gen.recordedLatencies().reduce((n, x) => n + x, 0);
      if (mode === 'record') console.log(`  ${f.id}: ${gen.stats.recorded} recorded, ${gen.stats.served} served, ${((performance.now() - t0) / 1000).toFixed(0)} s`);
    }
    for (const key of E09_KEYS) {
      const merged = mergeReports(runs.map((r) => r.reports[key]));
      const counts: Record<string, number | null> = { ...merged.counts, 'e09.families': runs.length };
      for (const r of runs) for (const [k, v] of Object.entries(r.counts[key])) counts[k] = ((counts[k] as number | undefined) ?? 0) + v;
      variants.push({ variantId: V[key], provenance: key === 'rules' ? 'measured' : 'replay-fixture', split, metrics: merged.metrics, counts, failures: merged.failures.slice(0, 40), failureSlicesByTag: sliceFailuresByTag(merged.failures, entries) });
    }
    const rulesM = mergeReports(runs.map((r) => r.reports.rules));
    found.push(...lexiconGaps(rulesM, mergeReports(runs.map((r) => r.reports.direct))).map((g) => ({ split, ...g })));
    foundUnion.push(...lexiconGaps(rulesM, mergeReports(runs.map((r) => r.reports.union))).map((g) => ({ split, ...g })));
    for (const r of runs) {
      droppedAll.push(...r.dropped.map((x) => ({ ...x, familyId: r.familyId })));
      modelOnly.push(...r.modelClaims.map((x) => ({ familyId: r.familyId, ...x })));
      failedThreads.push(...r.failed.map((t) => ({ familyId: r.familyId, thread: t })));
    }
  }
  const byReason: Record<string, number> = {};
  for (const x of droppedAll) byReason[`${x.kind}:${x.reason}`] = (byReason[`${x.kind}:${x.reason}`] ?? 0) + 1;
  const over = latencies.filter((ms) => ms > 60_000).length;
  const mean = latencies.length ? latencies.reduce((s, x) => s + x, 0) / latencies.length : 0;
  writeExtra(E09_ID, 'model-found.json', {
    note: 'Truth claims the model recovered (direct arm, and through the union commit) that the rules extractor missed. A statement here is the key statement.',
    direct: found, union: foundUnion, modelOnlyClaimsCommitted: modelOnly,
  });
  writeExtra(E09_ID, 'validator-dropped.json', { countByKindAndReason: byReason, items: droppedAll, threadsWhereTheModelOutputWasUnusable: failedThreads });
  writeExtra(E09_ID, 'latency.json', { calls: latencies.length, meanMs: Math.round(mean), maxMs: Math.max(0, ...latencies), over60s: over, msPerCall: latencies, msPerImport: importMs, importsOver60s: Object.values(importMs).filter((ms) => ms > 60_000).length });

  const v = (split: string, id: string, m: string) => variants.find((x) => x.split === split && x.variantId === id)?.metrics[m];
  const line = (s: string) => `${s}: claim recall ${E09_KEYS.map((k) => `${k} ${fmt(v(s, V[k], 'claims.all.recall'))}`).join(', ')}; precision ${E09_KEYS.map((k) => `${k} ${fmt(v(s, V[k], 'claims.all.precision'))}`).join(', ')}; false merges ${E09_KEYS.map((k) => `${k} ${fmt(v(s, V[k], 'cases.falseMergeRate'))}`).join(', ')}`;
  const decision: Decision = {
    experiment: 'E09',
    hypothesis: manifest.hypothesis,
    criterion: manifest.acceptanceCriteria.join(' '),
    outcome: `${SPLITS.map(line).join('. ')}. The model recovered ${found.length} truth claims the rules missed (direct), ${foundUnion.length} through the union; ${failedThreads.length} threads gave no usable output; the validator dropped ${droppedAll.length} items (${Object.entries(byReason).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}). Recorded latency ${latencies.length} calls, mean ${(mean / 1000).toFixed(1)} s, ${over}/${latencies.length} over 60 s.`,
    shipped: 'The rules extractor stays the default extract route; extract=local stays opt-in and commits only as a labelled union.',
    detail: { model, fixtures: String(all.length) },
  };
  writeExtra(E09_ID, 'decision.json', decision);
  writeResults({
    manifestId: E09_ID, finishedAt: new Date().toISOString(), variants,
    notes: [
      `Model: ${model}. ${model === 'qwen3:4b' ? '' : 'The brief names qwen3:4b; it was not installed when the fixtures were recorded, so these numbers are for ' + model + ' (a larger model of the same family), not for qwen3:4b. '}Outputs are replayed from data/replays/${dir.split('/').pop()}/ (one recording pass, hash-checked on model + prompt + schema + seed); route 'replay'.`,
      `Live latency (recorded): ${latencies.length} calls, mean ${(mean / 1000).toFixed(1)} s, max ${(Math.max(0, ...latencies) / 1000).toFixed(1)} s; ${over}/${latencies.length} calls alone exceed the extract slot's 60 s per-import budget, and summed per import (one family = one import, its threads in sequence) ${Object.values(importMs).filter((ms) => ms > 60_000).length}/${Object.keys(importMs).length} imports exceed it (${Object.entries(importMs).map(([f, ms]) => `${f} ${(ms / 1000).toFixed(0)} s`).join(', ')}), so with that budget those live imports fall back to rules (enrich.ts is all-or-nothing per import). The experiment lifts the budget to score the model's output.`,
      'Direct scoring (variant 2) uses the E01 converter: cases are the proposed incidents, attempts and outcomes are not derived. The commit arms derive them through commitProposal.',
      'The union arm is the shipped path: claims the rules produced keep the rules label; model-only claims carry the replay route; incidents are the rules ones (re-keyed), so the union cannot add a case split or merge of its own beyond what its extra claims cause.',
      'Claims are matched to truth by type and token Jaccard >= 0.5 on the statement; a correct paraphrase below the threshold counts as a miss and as unsupported.',
      'Answer keys are unreviewed (data/scenarios/REVIEW.md); results are provisional.',
    ],
  });
  console.log(`${E09_ID}: ${decision.outcome}`);
}

// ================================================================================================ E10

/** The service route table as a ServiceClient, in-process (no socket; the network guard stays installed). */
export function inProcessClient(engine: Engine): ServiceClient {
  const dispatch = createDispatcher(engine);
  const call = async <T>(method: string, path: string, body?: unknown): Promise<T> => {
    const r = await dispatch(method, path, body);
    if (r.status !== 200) throw new ServiceHttpError(r.status, (r.body as { error?: string })?.error ?? `${method} ${path} -> ${r.status}`);
    return r.body as T;
  };
  return { get: (p) => call('GET', p), post: (p, b) => call('POST', p, b), put: (p, b) => call('PUT', p, b) };
}

/** The day's inputs as demo:play builds them: demo families seeded, train+validation sources arriving (visible files only). */
export function dayFamilies(): FamilyInput[] {
  const families: FamilyInput[] = [];
  for (const f of loadFamiliesFile().families) {
    if (!['demo', 'train', 'validation'].includes(f.split)) continue;
    const seeded = f.split === 'demo';
    const v = loadVisibleInputs(f.id);
    const people = v.people as PeopleDirectory;
    const who = (id: string): ProblemInput['requester'] => {
      const p = people.people.find((x) => x.id === id);
      return { id, name: p?.name ?? id, groups: p?.groups ?? [] };
    };
    const teams = v.teams as { messages: Array<{ author: string }> };
    const sources: SourceInput[] = [
      { format: 'teams-json', payload: v.teams, label: `Teams thread, ${teams.messages.length} messages` },
      ...Object.entries(v.emails).map(([name, text]) => ({ format: 'email-text' as const, payload: text, label: `E-mail ${name}` })),
      ...Object.entries(v.slack.days).map(([key, day]) => {
        const [channel, date] = key.split('/') as [string, string];
        return { format: 'slack-export' as const, payload: { users: v.slack.users, channels: v.slack.channels, days: [{ channel, date, messages: day }] }, label: `Slack #${channel} ${date}` };
      }),
    ];
    families.push({
      id: f.id, description: f.description, seeded, ...(seeded ? {} : { directory: people }), sources: seeded ? [] : sources,
      problems: v.problems.map((p) => ({ id: p.id, text: p.text, requester: who(p.requester), ...(p.observations ? { observations: p.observations } : {}) })),
    });
  }
  return families;
}

export interface E10Arm {
  selector: 'rules' | 'linucb';
  seed: number;
  before: StoreHealth;
  after: StoreHealth;
  /** The same cases as `before` (the day's new cases excluded). */
  afterSameCases: StoreHealth;
  summary: Awaited<ReturnType<typeof runDay>>;
  rewards: number[];
  /** Measured delta of completeness x correctness of the touched case, one per rewarded answer (before the burden). */
  deltas: number[];
  /** Touched cases whose product was 0 before the answer because no claim of the case was supported yet. */
  zeroCorrectnessTouches: number;
  selectorUpdates: number;
}

const product = (h: StoreHealth): number => h.completenessUnweighted * (h.correctness ?? 0);

/** One simulated day on a fresh demo store with one selector. Deterministic in (seed, selector). */
export async function runE10Arm(selector: 'rules' | 'linucb', seed: number, hours = 10): Promise<E10Arm> {
  const start = '2026-11-09T07:00:00.000Z';
  const { engine } = await demoEngine(start);
  try {
    const client = inProcessClient(engine);
    await client.put('/settings', { selectorId: selector });
    const keys = defaultInvestigationSettings({}).distinguishingKeys;
    const health = (now: Date, caseIds?: string[]) => storeHealth(engine.store, undefined, { now, distinguishingKeys: keys, outcomeKey: OUTCOME_KEY, ...(caseIds ? { caseIds } : {}) });
    const before = health(new Date(start));
    const plan = planDay({ seed, families: dayFamilies(), hours, judgeEveryMinutes: 24 * 60 });
    const clock = createSimClock('2026-11-09T07:30:00.000Z', 0);
    const rows: ActivityRow[] = [];
    const summary = await runDay({ client, plan, clock, seed, sink: { write: (r) => rows.push(r) }, judgePrompts: [] });
    const after = health(clock.now());
    const afterSameCases = health(clock.now(), before.cases.map((c) => c.caseId));
    const questions = engine.store.list('question');
    const rewards = questions.flatMap((q) => (q.reward ? [q.reward.value] : []));
    const deltas = questions.flatMap((q) => (q.reward ? [q.reward.delta] : []));
    const touched = [...new Set(questions.flatMap((q) => q.reward?.cases ?? []))];
    const touchedHealth = touched.length ? health(clock.now(), touched) : undefined;
    const zeroCorrectnessTouches = touchedHealth ? touchedHealth.cases.filter((c) => {
      const claims = engine.store.list('claim').filter((cl) => cl.caseId === c.caseId && (cl.status === 'provisional' || cl.status === 'supported'));
      return claims.length > 0 && claims.every((cl) => cl.status !== 'supported');
    }).length : 0;
    const selectorUpdates = engine.store.list('evaluation').filter((e) => e.assessedBenefit && e.assessedBenefit.method === 'store-metric-delta@1').length;
    return { selector, seed, before, after, afterSameCases, summary, rewards, deltas, zeroCorrectnessTouches, selectorUpdates };
  } finally {
    engine.close();
  }
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0);
const r4 = (x: number): number => Math.round(x * 10_000) / 10_000;

export async function runE10(seeds = [1, 2, 3]): Promise<void> {
  const selectors: Array<'rules' | 'linucb'> = ['rules', 'linucb'];
  const manifest = baseManifest({
    id: E10_ID,
    hypothesis: 'A simulated day of questions answered by simulated colleagues raises the store metric (completeness x correctness, BUILD_BRIEF 5.1-5.2) of the demo store, and the LinUCB selector rewarded by the measured delta of that metric minus burden (5.4) gains at least as much per question asked as the rules selector on the same store and the same day.',
    splits: ['demo'],
    visibleInputs: ['sources/ and people.json of the demo, train and validation families (demo seeded by demo:reset --synthetic, train and validation arriving during the day as demo:play sends them)', 'incoming problem text and observations (asked by simulated engineers)', 'data/fixtures/dev-family-01'],
    variants: selectors.map((s) => ({ id: `${s}@store-metric`, description: s === 'rules' ? 'rules selector (the fixed prior); the coordinator still writes the measured reward' : 'LinUCB (alpha 0.5, fresh per seed), updated live after every answer with the store-metric reward', route: 'rules' as const })),
    route: 'rules',
    config: {
      store: 'Engine on :memory:, demo:reset --synthetic (the Elisa files are absent here), clock frozen at 2026-11-09T07:00Z and moved only by the simulated day',
      day: 'simulation/schedule.ts planDay (10 h, seeded) + simulation/runner.ts runDay against the real service through createDispatcher (in-process, no socket); simulated colleagues answer from a seeded model, never from answer keys; no judge prompts',
      reward: 'QuestionCoordinator.answer: delta of completeness x correctness of the touched case before and after the answer, minus burden (0.02 per question asked today, 0.02 per other open question); selector.update after each answer (store-metric-delta@1)',
      metric: 'memory/store-health.ts storeHealth over every case (no principal); completenessUnweighted is compared before/after because the weighted mean needs retrievals, which only exist after the day',
      questionsPerPoint: 'questions asked / (100 x the gain in completenessUnweighted x correctness over the cases that existed before the day); null when there is no gain',
      linucbState: 'linucbStatePath false (nothing written to data/local)',
      familiesSha256: fileSha(join(DEFAULT_SCENARIOS_DIR, 'families.json')),
    },
    seeds,
    metrics: ['store.completeness.before', 'store.completeness.after', 'store.correctness.before', 'store.correctness.after', 'store.product.sameCases.gain', 'questions.asked', 'questions.answered', 'questions.perPointGained', 'reward.mean'],
    acceptanceCriteria: [
      'Report before/after per seed and the mean over 3 seeds, with every denominator (cases, case claims, questions).',
      'Bandit vs rules: LinUCB is reported as better only if its mean same-case gain per question asked is higher than the rules selector\'s on at least 2 of 3 seeds; otherwise the rules selector stays the default (it is the default either way until a judge-visible reason exists).',
    ],
    stopRule: 'deterministic per seed; 3 seeds; none',
  });
  writeManifest(manifest);
  const arms: E10Arm[] = [];
  for (const seed of seeds) for (const s of selectors) {
    arms.push(await runE10Arm(s, seed));
    const a = arms.at(-1)!;
    console.log(`  seed ${seed} ${s.padEnd(6)} asked ${a.summary.questionsAsked} answered ${a.summary.answered}; product (same cases) ${r4(product(a.before))} -> ${r4(product(a.afterSameCases))}; mean reward ${r4(mean(a.rewards))}`);
  }
  const variants: VariantResult[] = [];
  const perSeed: Array<Record<string, unknown>> = [];
  const gainPerQ = (a: E10Arm) => (a.summary.questionsAsked ? (product(a.afterSameCases) - product(a.before)) / a.summary.questionsAsked : 0);
  for (const s of selectors) {
    const mine = arms.filter((a) => a.selector === s);
    for (const a of mine) {
      const gain = product(a.afterSameCases) - product(a.before);
      perSeed.push({
        selector: s, seed: a.seed, casesBefore: a.before.denominators.cases, casesAfter: a.after.denominators.cases,
        completenessBefore: a.before.completenessUnweighted, completenessAfterSameCases: a.afterSameCases.completenessUnweighted, completenessAfterAll: a.after.completenessUnweighted, completenessAfterAllWeighted: a.after.completeness,
        correctnessBefore: a.before.correctness, correctnessAfterSameCases: a.afterSameCases.correctness, correctnessAfterAll: a.after.correctness,
        caseClaimsBefore: a.before.denominators.caseClaims, supportedBefore: a.before.denominators.supportedClaims, caseClaimsAfterSameCases: a.afterSameCases.denominators.caseClaims, supportedAfterSameCases: a.afterSameCases.denominators.supportedClaims,
        productBefore: r4(product(a.before)), productAfterSameCases: r4(product(a.afterSameCases)), gainPoints: r4(100 * gain),
        asked: a.summary.questionsAsked, answered: a.summary.answered, deferred: a.summary.deferred, dismissed: a.summary.dismissed, unanswered: a.summary.unanswered, investigations: a.summary.investigations,
        questionsPerPoint: gain > 0 ? r4(a.summary.questionsAsked / (100 * gain)) : null, rewards: a.rewards.length, meanReward: r4(mean(a.rewards)), sumDeltaPoints: r4(100 * a.deltas.reduce((x, y) => x + y, 0)), positiveDeltas: a.deltas.filter((d) => d > 0).length, touchedCasesWithNoSupportedClaim: a.zeroCorrectnessTouches,
        productAfterAll: r4(product(a.after)), selectorUpdates: a.selectorUpdates, errors: a.summary.errors,
        singletonsBefore: a.before.singletons, singletonsAfterSameCases: a.afterSameCases.singletons, thinPairsBefore: a.before.thinPairs, thinPairsAfterSameCases: a.afterSameCases.thinPairs,
      });
    }
    const asked = mine.reduce((n, a) => n + a.summary.questionsAsked, 0);
    const answered = mine.reduce((n, a) => n + a.summary.answered, 0);
    const gains = mine.map((a) => product(a.afterSameCases) - product(a.before));
    const rewards = mine.flatMap((a) => a.rewards);
    const span = (xs: number[]) => ({ min: r4(Math.min(...xs)), max: r4(Math.max(...xs)), runs: xs.length });
    const meanGain = mean(gains);
    variants.push({
      variantId: `${s}@store-metric`, provenance: 'simulated', split: 'demo',
      metrics: {
        'questions.answerRate': ratio(answered, asked),
        'store.supportedClaims.after': ratio(mine.reduce((n, a) => n + a.afterSameCases.denominators.supportedClaims, 0), mine.reduce((n, a) => n + a.afterSameCases.denominators.caseClaims, 0)),
        'store.supportedClaims.before': ratio(mine.reduce((n, a) => n + a.before.denominators.supportedClaims, 0), mine.reduce((n, a) => n + a.before.denominators.caseClaims, 0)),
        'reward.positiveRate': ratio(rewards.filter((x) => x > 0).length, rewards.length),
      },
      counts: {
        seeds: mine.length, 'questions.asked': asked, 'questions.answered': answered, 'rewards.measured': rewards.length,
        'store.cases.before': mine[0]!.before.denominators.cases, 'store.cases.after.meanOverSeeds': r4(mean(mine.map((a) => a.after.denominators.cases))),
        'store.completeness.before': r4(mean(mine.map((a) => a.before.completenessUnweighted))), 'store.completeness.after.sameCases': r4(mean(mine.map((a) => a.afterSameCases.completenessUnweighted))),
        'store.correctness.before': r4(mean(mine.map((a) => a.before.correctness ?? 0))), 'store.correctness.after.sameCases': r4(mean(mine.map((a) => a.afterSameCases.correctness ?? 0))),
        'store.product.gainPoints.mean': r4(100 * meanGain), 'questions.perPointGained': meanGain > 0 ? r4(mean(mine.map((a) => a.summary.questionsAsked)) / (100 * meanGain)) : null,
        'reward.mean': r4(mean(rewards)),
        'reward.deltaPoints.sum': r4(100 * mine.reduce((n, a) => n + a.deltas.reduce((x, y) => x + y, 0), 0)),
        'reward.deltas.positive': mine.reduce((n, a) => n + a.deltas.filter((d) => d > 0).length, 0),
        'questions.perMeasuredPoint': (() => { const pts = 100 * mine.reduce((n, a) => n + a.deltas.reduce((x, y) => x + y, 0), 0); return pts > 0 ? r4(asked / pts) : null; })(),
      },
      failures: [], failureSlicesByTag: {},
      repeatVariation: { 'store.product.gainPoints': span(gains.map((g) => 100 * g)), 'questions.asked': span(mine.map((a) => a.summary.questionsAsked)), 'reward.mean': span(mine.map((a) => mean(a.rewards))) },
    });
  }
  const wins = seeds.filter((sd) => {
    const l = arms.find((a) => a.seed === sd && a.selector === 'linucb')!;
    const r = arms.find((a) => a.seed === sd && a.selector === 'rules')!;
    return gainPerQ(l) > gainPerQ(r);
  }).length;
  const vr = (s: string) => variants.find((v) => v.variantId === `${s}@store-metric`)!;
  const decision: Decision = {
    experiment: 'E10',
    hypothesis: manifest.hypothesis,
    criterion: manifest.acceptanceCriteria[1]!,
    outcome: selectors.map((s) => `${s}: completeness ${vr(s).counts['store.completeness.before']} -> ${vr(s).counts['store.completeness.after.sameCases']}, correctness ${vr(s).counts['store.correctness.before']} -> ${vr(s).counts['store.correctness.after.sameCases']} (same ${vr(s).counts['store.cases.before']} cases, mean of ${seeds.length} seeds); gain ${vr(s).counts['store.product.gainPoints.mean']} points for ${vr(s).counts['questions.asked']} questions asked over ${seeds.length} simulated days (one per seed) (${vr(s).counts['questions.perPointGained'] ?? 'n/a'} questions per point); answered ${fmt(vr(s).metrics['questions.answerRate'])}; mean reward ${vr(s).counts['reward.mean']}; measured per-answer deltas sum to ${vr(s).counts['reward.deltaPoints.sum']} points (${vr(s).counts['reward.deltas.positive']}/${vr(s).counts['rewards.measured']} positive)`).join('. ') + `. LinUCB gains more per question on ${wins}/${seeds.length} seeds.`,
    shipped: wins >= 2 ? 'LinUCB gained more per question on at least 2 of 3 seeds; the rules selector stays the default until the gain shows in a judge-visible run (Settings can switch to bandit).' : 'The rules selector stays the default; LinUCB did not gain more per question on 2 of 3 seeds.',
    detail: { wins: `${wins}/${seeds.length}` },
  };
  writeExtra(E10_ID, 'per-seed.json', perSeed);
  writeExtra(E10_ID, 'decision.json', decision);
  writeResults({
    manifestId: E10_ID, finishedAt: new Date().toISOString(), variants,
    notes: [
      'Simulated: the day, the engineers asking and the colleagues answering are the demo:play simulation (seeded), run in-process against the real service; no model is called and no answer key is read.',
      'Before/after are compared on the same cases (the demo store\'s cases before the day); the day also imports the train and validation families, whose new cases are reported separately (casesAfter, completenessAfterAll).',
      'Completeness is the unweighted mean over cases here: the weighted one needs retrievals in the last 30 days, which only exist after the day, so it would not compare like with like (both are in per-seed.json).',
      'Per point = one percentage point of completeness x correctness. questions.perPointGained uses the same-case before/after gain; questions.perMeasuredPoint uses the sum of the per-answer deltas the coordinator measured on the touched cases (QuestionRecord.reward.delta). Either is null when nothing was gained.',
      'The product is multiplicative: a touched case with no supported claim has correctness 0, so an answer that fills a completeness slot there measures a delta of 0 and the reward is the burden alone (touchedCasesWithNoSupportedClaim in per-seed.json).',
      'Each seed starts from a fresh demo store and a fresh selector, so LinUCB learns only within one day; the rules selector is the fixed prior with the same reward written for comparison.',
      'Where the negative deltas come from (probe of seed 2, D-B2-51): Every non-zero measured delta (-6.77 points) is a "no" answer to an applicability question (missing|unit.model: does the earlier unit share the current unit\'s model). The coordinator writes it as a contradict update on the case\'s claim, and store-health counts any contradict update on a claim still cited by a standing recommendation as a contradicted claim, so that case\'s correctness goes negative. Under the brief\'s 5.2 wording that is a contradicted claim still cited; the coordinator\'s own note says the historical claim is unchanged. The metric is left as the brief words it; the reading is open.',
      'B1 pairing links do not exist yet, so the correctness term "links made without an answer" counts 0 (store-health links hook).',
    ],
  });
  console.log(`${E10_ID}: ${decision.outcome}`);
}

