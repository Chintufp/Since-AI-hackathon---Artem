/**
 * E01: extraction/linking. Compares, on the visible sources of train and validation families (same evidence, same
 * evaluator, same directory):
 *   (a) rules-extractor@current   the real import path (adapters -> ingest -> context -> rules extractor -> memory commit); measured
 *   (b) claude-agent-arm          the recorded Claude-subagent proposals scored DIRECTLY (no memory/commit); replay-fixture
 *   (c) claude-agent-arm->commit  the same proposals pushed through the real memory commitProposal; replay-fixture
 * The arm is one recorded Claude Sonnet subagent pass over visible sources. It is NOT the proposed small GPT generator and NOT
 * an application route; the application never calls it. Hidden keys are read here only for scoring (benchmarks/evaluator.ts).
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EvidenceEnvelope, FamilyManifestEntry, KnowledgeStore, Split } from '../src/libs/utils/contracts/index.ts';
import { applyDirectory } from '../src/apps/service/directory.ts';
import { commitProposal, openStore } from '../src/libs/utils/memory/index.ts';
import { knowledgeAccuracy, mergeReports, ratio, sliceFailuresByTag } from '../benchmarks/evaluator.ts';
import type { FailureExample, MaybeMetric, MetricReport, SystemKnowledge } from '../benchmarks/evaluator.ts';
import { loadHidden } from '../benchmarks/load.ts';
import { writeManifest, writeResults } from '../benchmarks/manifest.ts';
import type { VariantResult } from '../benchmarks/manifest.ts';
import { incidentOfSources, collectKnowledge, evidenceSourceIdsOf, independentSupportOf, ORG, prepareFamily } from './harness.ts';
import { normalizeSourceId } from '../benchmarks/text.ts';
import { baseManifest, familiesOf, writeExtra } from './common.ts';
import type { Decision } from './common.ts';
import {
  adaptActorsForCommit, ARM_ROUTE, buildEvidenceIndex, fixtureFamilies, loadFixture, mapProposal, proposalToKnowledge, REPLAY_DIR,
} from './e01-convert.ts';
import type { MappingStats } from './e01-convert.ts';

export const E01_ID = 'e01-extraction';
export const E01_VARIANTS = {
  rules: 'rules-extractor@current',
  arm: 'claude-agent-arm',
  commit: 'claude-agent-arm→commit',
} as const;
type VariantKey = keyof typeof E01_VARIANTS;
const KEYS: VariantKey[] = ['rules', 'arm', 'commit'];
const SPLITS: Array<'train' | 'validation'> = ['train', 'validation'];

const E01_METRICS = [
  'claims.all.precision', 'claims.all.recall', 'claims.observation.recall', 'claims.hypothesis.recall', 'claims.advice.recall', 'claims.action.recall', 'claims.outcome.recall', 'claims.condition.recall',
  'entities.recall', 'cases.falseMergeRate', 'cases.falseSplitRate', 'attribution.claimPersonErrorRate', 'attribution.firsthandLinkErrorRate', 'attribution.attemptPerformerErrorRate',
  'attribution.attemptPerformedStateErrorRate', 'attribution.outcomeReporterErrorRate', 'copies.overcountRate', 'copies.overcountRate.noLineage', 'usefulness.accuracy',
];

const sha = (path: string): string => createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16);

interface FamilyOutcome {
  report: MetricReport;
  /** Same knowledge scored without the system's independent-support counts (raw distinct sources). Only the copies metric is read from it. */
  rawCopies: MaybeMetric | undefined;
  stats: Record<string, number>;
  usefulness: { correct: number; decided: number; abstained: number };
}

/** Truth-side usefulness label (harness side, same labelling as the local usefulness classifier): evidence belongs to some truth incident. */
function usefulnessScore(familyId: string, labels: Array<{ evidenceId: string; label: string }>, sourceOf: Record<string, string>): { correct: number; decided: number; abstained: number } {
  const incidentOf = incidentOfSources(loadHidden(familyId).truth.incidents);
  let correct = 0, decided = 0, abstained = 0;
  for (const l of labels) {
    if (l.label === 'uncertain') { abstained++; continue; }
    const src = sourceOf[l.evidenceId];
    if (!src) continue;
    decided++;
    if ((l.label === 'useful') === incidentOf.has(normalizeSourceId(src))) correct++;
  }
  return { correct, decided, abstained };
}

function usefulnessFromStore(store: KnowledgeStore): Array<{ evidenceId: string; label: string }> {
  return store.list('evidence').flatMap((e) => { const u = (e.metadata as { usefulness?: { label?: string } } | undefined)?.usefulness; return u?.label ? [{ evidenceId: e.id, label: u.label }] : []; });
}

interface FamilyRunE01 {
  familyId: string;
  outcomes: Record<VariantKey, FamilyOutcome>;
  mapping: MappingStats;
  ambiguousKeys: number;
}

export function runOneFamily(familyId: string): FamilyRunE01 {
  const { people, truth } = loadHidden(familyId);
  const prepared = prepareFamily(familyId);
  const storeA = prepared.store;
  const evidence = storeA.list('evidence');
  const sourceOf = evidenceSourceIdsOf(storeA);
  const fixture = loadFixture(familyId);
  const index = buildEvidenceIndex(evidence);
  const { proposal, stats } = mapProposal(fixture, index);

  // (a) the real import path, exactly as E00 collects it.
  const sysA = collectKnowledge(storeA, sourceOf);

  // (b) the proposals scored directly.
  const sysB = proposalToKnowledge(proposal, {
    orgId: ORG, familyId, directory: people, evidenceSourceIds: sourceOf, independentSupport: (ids) => independentSupportOf(storeA, ids),
  });

  // (c) the proposals through the real memory commit, in a store holding the same evidence but none of the rules extractor's output.
  const storeC = openStore(':memory:');
  const copyEv = (e: EvidenceEnvelope): EvidenceEnvelope => {
    const { usefulness: _u, ...meta } = (e.metadata ?? {}) as Record<string, unknown>;
    return { ...e, metadata: meta };
  };
  for (const e of evidence) storeC.put('evidence', copyEv(e));
  const live = evidence.filter((e) => !e.metadata?.supersededBy && e.metadata?.segment !== 'quoted').map(copyEv);
  const adapted = adaptActorsForCommit(proposal, live, people);
  const committed = commitProposal(storeC, adapted.proposal, { evidence: live }, { orgId: ORG, accessScope: { visibility: 'org' }, now: '2026-01-01T00:00:00.000Z' });
  applyDirectory(storeC, ORG, people);
  const sysC = collectKnowledge(storeC, sourceOf);

  const score = (sys: SystemKnowledge, labels: Array<{ evidenceId: string; label: string }>, extra: Record<string, number>): FamilyOutcome => {
    const report = knowledgeAccuracy(sys, truth, { people });
    const raw = knowledgeAccuracy({ ...sys, independentSupport: undefined }, truth, { people });
    return {
      report, rawCopies: raw.metrics['copies.overcountRate'],
      stats: { 'e01.claims': sys.claims.length, 'e01.entities': sys.entities.length, 'e01.cases': sys.cases.length, 'e01.links': sys.links.length, 'e01.attempts': sys.attempts?.length ?? 0, 'e01.outcomes': sys.outcomes?.length ?? 0, ...extra },
      usefulness: usefulnessScore(familyId, labels, sourceOf),
    };
  };
  const out: Record<VariantKey, FamilyOutcome> = {
    rules: score(sysA, usefulnessFromStore(storeA), {}),
    arm: score(sysB, proposal.usefulness, {
      'mapping.evidenceRefs': stats.evidenceRefs, 'mapping.evidenceRefsMapped': stats.evidenceRefsMapped, 'mapping.unmappedIds': stats.unmappedIds.length, 'mapping.claimsProposed': stats.claims,
      'mapping.claimsDropped': stats.claimsDropped, 'mapping.linksProposed': stats.links, 'mapping.linksDropped': stats.linksDropped, 'mapping.incidentsProposed': stats.incidents,
      'mapping.incidentEvidenceIds': stats.incidentEvidenceIds, 'mapping.incidentEvidenceIdsMapped': stats.incidentEvidenceIdsMapped, 'mapping.ambiguousKeys': index.ambiguous.length,
    }),
    commit: score(sysC, usefulnessFromStore(storeC), {
      'commit.claimsProposed': adapted.proposal.claims.length, 'commit.claimsStored': new Set(committed.claimIds).size, 'commit.linksProposed': adapted.proposal.links.length,
      'commit.linksStored': new Set(committed.linkIds).size, 'commit.actorIdsTranslated': adapted.translated, 'commit.casesStored': new Set(committed.caseIds).size,
    }),
  };
  storeA.close();
  storeC.close();
  return { familyId, outcomes: out, mapping: stats, ambiguousKeys: index.ambiguous.length };
}

/** Failure ids are only unique within a family (`<incident key>#<n>`), so key them by family too. */
const failedIds = (r: MetricReport, metric: string): Set<string> => new Set(r.failures.filter((f) => f.metric === metric).map((f) => `${f.familyId ?? ''}|${f.id}`));

export interface LexiconGap { familyId: string; id: string; type: string; statement: string }

/** Truth claims the arm recovered and the rules extractor missed (candidate lexicon fixes), from the full failure lists. */
export function lexiconGaps(rules: MetricReport, arm: MetricReport): LexiconGap[] {
  const armMissed = failedIds(arm, 'claims.recall');
  return rules.failures.filter((f) => f.metric === 'claims.recall' && !armMissed.has(`${f.familyId ?? ''}|${f.id}`)).map((f) => {
    const m = /^missed (\S+) claim: "(.*)"$/.exec(f.reason);
    return { familyId: f.familyId ?? '', id: f.id, type: m?.[1] ?? 'unknown', statement: m?.[2] ?? f.reason };
  });
}

const keepFailures = (fs: FailureExample[]): FailureExample[] => {
  const per = new Map<string, number>();
  return fs.filter((x) => { const n = per.get(x.metric) ?? 0; per.set(x.metric, n + 1); return n < 6; });
};

export async function runE01(): Promise<void> {
  const fams: Record<string, string[]> = { train: fixtureFamilies(['train']), validation: fixtureFamilies(['validation']) };
  const manifest = baseManifest({
    id: E01_ID,
    hypothesis: 'Structured rules extraction recovers claim types/links; a Claude-agent arm on the same visible threads may differ (recorded, labeled, not a small-GPT result).',
    splits: SPLITS,
    visibleInputs: ['sources/ (through the scenario-dir importer for variant a)', 'people.json', 'data/replays/e01-claude-arm/<family>.json (one recorded Claude Sonnet subagent pass that read only sources/** and people.json of train and validation families)'],
    variants: [
      { id: E01_VARIANTS.rules, description: 'The real import path (adapters -> ingest -> context -> rules extractor -> memory commit) on the current working tree; provenance measured', route: 'rules' },
      { id: E01_VARIANTS.arm, description: 'Recorded Claude-agent ExtractionProposals converted to SystemKnowledge and scored directly (NOT run through memory/commit); provenance replay-fixture', route: ARM_ROUTE },
      { id: E01_VARIANTS.commit, description: 'The same recorded proposals pushed through the real memory commitProposal (directory ids translated to evidence actor ids, then the directory applied as in the app); provenance replay-fixture', route: ARM_ROUTE },
    ],
    route: 'mixed',
    config: {
      armIdentity: 'one-shot recorded Claude Sonnet subagent (claude-sonnet-subagent-2026-11-07) on visible sources; not the proposed small GPT generator; not an application route; the application never calls it',
      families: fams,
      fixtureSha256: Object.fromEntries([...fams.train!, ...fams.validation!].map((f) => [f, sha(join(REPLAY_DIR, `${f}.json`))])),
      evidenceIdMapping: 'replay teams:<seq> / email:<Message-ID> / slack:<ts> -> the single non-quoted evidence record with the same provider and seq / Message-ID / ts (benchmarks key); unmatched ids are dropped and counted',
      directScoring: 'variant b scores the proposals as given: claims verbatim, one case per proposed incident, attempts/outcomes not derived (those come from commit), independent support counted with the importer\'s own copy/retelling lineage',
      claimMatch: 'same ClaimType and token Jaccard >= 0.5 (benchmarks/evaluator.ts)',
      scoredSplitsSeparately: true,
      test: 'test families are never read; fixtures exist only for train and validation',
    },
    seeds: [0],
    metrics: E01_METRICS,
    acceptanceCriteria: ['Report both arms side by side on train and validation separately; no winner is declared.', 'The rules extractor remains the default route regardless of the result (EXPERIMENT_PLAN E01).', 'The agent arm informs lexicon fixes only: truth claims it recovered and the rules extractor missed are listed in lexicon-gaps.json.'],
    stopRule: 'One scoring pass over one recorded fixture per family; skipped if it needed hidden truth or more than one recording pass (the fixtures were recorded once from visible sources only).',
  });
  writeManifest(manifest);

  const variants: VariantResult[] = [];
  const perFamily: Record<string, Record<string, Record<string, MaybeMetric>>> = {};
  const gaps: LexiconGap[] = [];
  const statsOut: Record<string, unknown> = {};
  const pooled: Record<string, Record<string, { claimsAllP: MaybeMetric | undefined; claimsAllR: MaybeMetric | undefined }>> = {};
  for (const split of SPLITS) {
    const entries: FamilyManifestEntry[] = familiesOf(split as Split).filter((f) => fams[split]!.includes(f.id));
    const runs = entries.map((f) => runOneFamily(f.id));
    pooled[split] = {};
    for (const key of KEYS) {
      const reports = runs.map((r) => r.outcomes[key].report);
      const merged = mergeReports(reports);
      const rawCopies = mergeReports(runs.map((r) => ({ metrics: { 'copies.overcountRate.noLineage': r.outcomes[key].rawCopies ?? null }, counts: {}, failures: [] })));
      const counts: Record<string, number | null> = { ...merged.counts, 'e01.families': runs.length };
      for (const r of runs) for (const [k, v] of Object.entries(r.outcomes[key].stats)) counts[k] = ((counts[k] as number | undefined) ?? 0) + v;
      const u = runs.reduce((a, r) => ({ correct: a.correct + r.outcomes[key].usefulness.correct, decided: a.decided + r.outcomes[key].usefulness.decided, abstained: a.abstained + r.outcomes[key].usefulness.abstained }), { correct: 0, decided: 0, abstained: 0 });
      counts['usefulness.abstained'] = u.abstained;
      const metrics = { ...merged.metrics, ...rawCopies.metrics, 'usefulness.accuracy': ratio(u.correct, u.decided) };
      const variantId = E01_VARIANTS[key];
      variants.push({
        variantId, provenance: key === 'rules' ? 'measured' : 'replay-fixture', split: split as Split, metrics, counts, failures: keepFailures(merged.failures),
        failureSlicesByTag: sliceFailuresByTag(merged.failures, entries),
      });
      pooled[split]![key] = { claimsAllP: merged.metrics['claims.all.precision'], claimsAllR: merged.metrics['claims.all.recall'] };
      perFamily[variantId] ??= {};
      for (const r of runs) perFamily[variantId]![r.familyId] = r.outcomes[key].report.metrics as Record<string, MaybeMetric>;
      if (key === 'arm') {
        const rulesMerged = mergeReports(runs.map((r) => r.outcomes.rules.report));
        gaps.push(...lexiconGaps(rulesMerged, merged));
      }
    }
    statsOut[split] = Object.fromEntries(runs.map((r) => [r.familyId, { mapping: r.mapping, ambiguousKeys: r.ambiguousKeys }]));
  }

  const byType: Record<string, number> = {};
  for (const g of gaps) byType[g.type] = (byType[g.type] ?? 0) + 1;
  writeExtra(E01_ID, 'lexicon-gaps.json', { note: 'Truth claims the Claude-agent arm matched (variant b) and the rules extractor missed. Candidate lexicon/cue fixes; a statement here is the key statement, not an extraction rule.', countByType: byType, gaps });
  writeExtra(E01_ID, 'per-family.json', perFamily);
  writeExtra(E01_ID, 'mapping.json', statsOut);

  const v = (split: string, id: string, m: string): MaybeMetric | undefined => variants.find((x) => x.split === split && x.variantId === id)?.metrics[m];
  const fx = (m: MaybeMetric | undefined): string => (m ? `${m.value.toFixed(3)} (${m.numerator}/${m.denominator})` : 'n/a');
  const outcome = SPLITS.map((s) => `${s}: claim recall rules ${fx(v(s, E01_VARIANTS.rules, 'claims.all.recall'))} vs arm ${fx(v(s, E01_VARIANTS.arm, 'claims.all.recall'))} vs arm-committed ${fx(v(s, E01_VARIANTS.commit, 'claims.all.recall'))}; precision rules ${fx(v(s, E01_VARIANTS.rules, 'claims.all.precision'))} vs arm ${fx(v(s, E01_VARIANTS.arm, 'claims.all.precision'))} vs arm-committed ${fx(v(s, E01_VARIANTS.commit, 'claims.all.precision'))}`).join('. ');
  const decision: Decision = {
    experiment: 'E01',
    hypothesis: manifest.hypothesis,
    criterion: 'Report both arms; rules remain the default; the agent arm informs lexicon fixes only (no winner is declared).',
    outcome: `${outcome}. ${gaps.length} truth claims were recovered by the arm and missed by the rules extractor (${Object.entries(byType).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}).`,
    shipped: 'The rules extractor stays the default route. The recorded arm is one Claude Sonnet subagent on visible sources; it is not the proposed small GPT, not an application route, and not evidence about either.',
    detail: { lexiconGaps: String(gaps.length), fixtures: String(fams.train!.length + fams.validation!.length) },
  };
  writeExtra(E01_ID, 'decision.json', decision);

  const unmapped = Object.values(statsOut).flatMap((s) => Object.values(s as Record<string, { mapping: MappingStats }>)).reduce((n, x) => n + x.mapping.unmappedIds.length, 0);
  const notes = [
    'The Claude-agent arm is one recorded Claude Sonnet subagent pass over visible sources (route claude-agent-arm). It is not the proposed small GPT generator, not an application route and not an inference the app can make; provenance is replay-fixture.',
    'Variant b scores the proposals directly, without memory/commit: its case boundaries are the proposed incidents (no asset-id merging), attempts and outcomes are not derived, and its claim statements are the agent\'s own wording (verbatim sentences are not required). Variant c runs the same proposals through commitProposal, which derives attempts, outcomes and case records.',
    'Copy handling: variants b and c count independent support with the importer\'s own copy/retelling lineage (the same for every variant); copies.overcountRate.noLineage counts raw distinct sources for comparison.',
    'Evidence-id mapping is exact (provider + seq / Message-ID / ts); ' + (unmapped === 0 ? 'every replay id mapped to exactly one stored record.' : `${unmapped} replay ids did not map and their references were dropped (see mapping.json).`),
    'Usefulness accuracy: a label counts as correct when "useful"/"irrelevant" agrees with membership of the evidence in any truth incident (harness side); "uncertain" labels abstain (counted separately).',
    'Claims are matched to truth by type and token Jaccard >= 0.5 on the statement. An agent paraphrase that stays below the threshold scores as a miss and as an unsupported claim even when it is semantically right; verbatim-sentence extractors are favored by this matcher.',
    'Fixtures were recorded once and never re-recorded, so these numbers are for a single agent pass; the rules numbers will change when the extractor is tuned (rerun `node experiments/run.ts e01`).',
    'Answer keys are unreviewed (data/scenarios/REVIEW.md); results are provisional.',
  ];
  writeResults({ manifestId: E01_ID, finishedAt: new Date().toISOString(), variants, notes });
  console.log(`E01 written: experiments/results/${E01_ID}`);
  for (const s of SPLITS) {
    for (const key of KEYS) console.log(`  ${s.padEnd(10)} ${E01_VARIANTS[key].padEnd(26)} claims P ${fx(v(s, E01_VARIANTS[key], 'claims.all.precision'))}  R ${fx(v(s, E01_VARIANTS[key], 'claims.all.recall'))}`);
  }
}
