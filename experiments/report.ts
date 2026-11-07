/**
 * Generates experiments/RESULTS.md from experiments/results/<id>/{manifest,results,decision,problems}.json.
 * Numbers, outcomes and failure examples are read from the result files; only the framing text is static.
 *   node experiments/run.ts report
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { MaybeMetric } from '../benchmarks/evaluator.ts';
import type { RunManifest, RunResults, VariantResult } from '../benchmarks/manifest.ts';
import { loadFamiliesFile, testFamiliesUntouched } from '../benchmarks/splits.ts';
import type { Decision } from './common.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const RES = join(HERE, 'results');

const read = <T>(id: string, name: string): T | undefined => {
  const p = join(RES, id, name);
  return existsSync(p) ? (JSON.parse(readFileSync(p, 'utf8')) as T) : undefined;
};
const results = (id: string) => read<RunResults>(id, 'results.json');
const manifest = (id: string) => read<RunManifest>(id, 'manifest.json');
const decision = (id: string) => read<Decision>(id, 'decision.json');

const f = (m: MaybeMetric | undefined): string => (m ? (m.denominator === 1 || m.denominator === 1000 || !Number.isInteger(m.numerator) ? m.value.toFixed(3) : `${m.value.toFixed(3)} (${m.numerator}/${m.denominator})`) : 'n/a');
const c = (v: VariantResult, k: string): string => (v.counts[k] === undefined || v.counts[k] === null ? 'n/a' : String(v.counts[k]));

function table(variants: VariantResult[], rows: Array<{ label: string; metric?: string; count?: string }>, header = (v: VariantResult) => v.variantId): string {
  const head = `| metric | ${variants.map(header).join(' | ')} |`;
  const sep = `| --- | ${variants.map(() => '---').join(' | ')} |`;
  const body = rows.map((r) => `| ${r.label} | ${variants.map((v) => (r.metric ? f(v.metrics[r.metric]) : c(v, r.count as string))).join(' | ')} |`);
  return [head, sep, ...body].join('\n');
}

interface ProblemRow { variant: string; split: string; problem: string; expected: string; noQuestionNeeded: boolean; first: string; final: string; loopEnd: string; topCaseIncidents: string[]; questions: Array<{ cond: string; to: string; reply: string; benefit: number | null; text: string }> }

function examples(id: string, variant: string | undefined, pick: (r: ProblemRow) => string | undefined, n = 3): string {
  const rows = read<ProblemRow[]>(id, 'problems.json') ?? [];
  const out: string[] = [];
  const families = new Set<string>();
  for (const r of rows) {
    if (variant && r.variant !== variant) continue;
    const fam = r.problem.replace(/-p\d+$/, '');
    if (families.has(fam)) continue; // one example per family
    const why = pick(r);
    if (why) { families.add(fam); out.push(`- \`${r.problem}\` (${r.split}): ${why}`); }
    if (out.length >= n) break;
  }
  return out.length ? out.join('\n') : '- none in this run';
}

const short = (s: string, n = 110): string => (s.length > n ? `${s.slice(0, n - 1)}...` : s);
const recFail = (r: ProblemRow): string | undefined => (r.final !== r.expected ? `final recommendation \`${r.final}\`, key expects \`${r.expected}\`${r.questions.length ? `; asked ${r.questions.map((q) => `"${short(q.text, 70)}" -> ${q.reply}`).join(' / ')}` : '; no question asked'}` : undefined);

function failureExamples(id: string, variant: string, metricPrefix: string, n = 3, split?: string): string {
  const r = results(id);
  const v = r?.variants.find((x) => x.variantId === variant && (!split || x.split === split));
  const fs = (v?.failures ?? []).filter((x) => x.metric.includes(metricPrefix)).slice(0, n);
  return fs.length ? fs.map((x) => `- \`${x.id}\` (${x.metric}): ${x.reason}`).join('\n') : '- none in the retained failure list';
}

function section(title: string, id: string, intro: string, body: (r: RunResults, m: RunManifest, d: Decision | undefined) => string): string {
  const r = results(id);
  const m = manifest(id);
  if (!r || !m) return `## ${title}\n\nNot run (no results in experiments/results/${id}).\n`;
  const d = decision(id);
  const parts = [`## ${title}`, '', `**Hypothesis.** ${m.hypothesis}`, '', intro, '', body(r, m, d)];
  if (d) parts.push('', `**Frozen criterion.** ${d.criterion}`, '', `**Outcome.** ${d.outcome}`, '', `**Shipped choice.** ${d.shipped}`);
  return parts.join('\n') + '\n';
}


const KNOWN_LIMITATION_TEXT = '`remote-power-access-p3` shows `email:f02-access-310@kalevanet.example`, an e-mail with no ACL metadata, so its stored scope is `org` and the system has no way to know the incident is restricted to `field`/`access` (ingest limitation: e-mail has no ACL source; investigation worker report, section 1).';

/**
 * Numbers of the first (provisional) run, copied from `results/archive-provisional/RESULTS.provisional.md` (the generated report of that run).
 * Per split: [numerator, denominator]; null denominators are written as n/a.
 */
const BEFORE: Record<string, Record<string, [number, number] | null>> = {
  'claim recall (all types)': { demo: [6, 25], train: [10, 47], validation: [4, 22] },
  'claim precision (all types)': { demo: [6, 26], train: [10, 44], validation: [4, 26] },
  'outcome claim recall': { demo: [0, 4], train: [2, 9], validation: [1, 4] },
  'cases false merge': { demo: [1, 2], train: [2, 5], validation: [1, 3] },
  'recommendation kind accuracy': { demo: [1, 6], train: [2, 12], validation: [1, 6] },
  'questions asked per investigation': { demo: [8, 6], train: [7, 12], validation: [0, 6] },
  'wrong recipient rate': { demo: [3, 5], train: [3, 4], validation: null },
  'false advice rate': { demo: [0, 0], train: [1, 2], validation: null },
  'eligible coverage': { demo: [1, 5], train: [1, 9], validation: [0, 5] },
};
/** Numbers of re-run 1, copied from `results/archive-rerun-1/RESULTS.rerun-1.md` (its generated report; the result directories copied beside it were overwritten at 04:02 by a partial re-run during extractor tuning, so they are not re-run 1 proper). */
const PREV: Record<string, Record<string, [number, number] | null>> = {
  'claim recall (all types)': { demo: [10, 25], train: [32, 47], validation: [15, 22] },
  'claim precision (all types)': { demo: [10, 28], train: [32, 58], validation: [15, 36] },
  'outcome claim recall': { demo: [1, 4], train: [9, 9], validation: [3, 4] },
  'cases false merge': { demo: [1, 3], train: [0, 7], validation: [1, 4] },
  'recommendation kind accuracy': { demo: [0, 6], train: [3, 12], validation: [3, 6] },
  'questions asked per investigation': { demo: [0, 6], train: [2, 12], validation: [0, 6] },
  'wrong recipient rate': { demo: null, train: [1, 1], validation: null },
  'false advice rate': { demo: [1, 3], train: [3, 9], validation: [1, 5] },
  'eligible coverage': { demo: [2, 5], train: [6, 9], validation: [4, 5] },
};
const AFTER_METRIC: Record<string, string> = {
  'claim recall (all types)': 'claims.all.recall', 'claim precision (all types)': 'claims.all.precision', 'outcome claim recall': 'claims.outcome.recall',
  'cases false merge': 'cases.falseMergeRate', 'recommendation kind accuracy': 'recommendation.kindAccuracy', 'questions asked per investigation': 'question.questionsPerInvestigation',
  'wrong recipient rate': 'question.wrongRecipientRate', 'false advice rate': 'recommendation.falseAdviceRate', 'eligible coverage': 'recommendation.eligibleCoverage',
};

function beforeAfterSection(): string[] {
  const r = results('e00-baseline');
  const out: string[] = ['## Before and after the src/ fixes and extractor tuning (E00)', ''];
  if (!r) return [...out, 'E00 results missing.', ''];
  const fmtB = (x: [number, number] | null | undefined): string => (!x || x[1] === 0 ? 'n/a' : `${(x[0] / x[1]).toFixed(3)} (${x[0]}/${x[1]})`);
  const splits = r.variants.map((v) => v.split);
  out.push('Three runs, same harness, same E00 configuration, same oracle: (1) first provisional run (library defaults, access leak open, extractor untuned; archived in `results/archive-provisional/`), (2) re-run 1 (access fix and first extractor pass; its report is archived as `results/archive-rerun-1/RESULTS.rerun-1.md`), (3) this final run (fix pass: per-recipient access gates, copy merging, case-boundary and lasting-confirmation rules, validation-contamination cleanup). Format `provisional -> re-run 1 -> final`. Same 24 investigations; small denominators, so one problem moves a rate by 0.08 to 0.17.');
  out.push('');
  out.push(`| metric | ${splits.join(' | ')} |`);
  out.push(`| --- | ${splits.map(() => '---').join(' | ')} |`);
  for (const [label, key] of Object.entries(AFTER_METRIC)) {
    const cells = r.variants.map((v) => {
      return `${fmtB(BEFORE[label]?.[v.split ?? ''])} -> ${fmtB(PREV[label]?.[v.split ?? ''])} -> ${f(v.metrics[key])}`;
    });
    out.push(`| ${label} | ${cells.join(' | ')} |`);
  }
  out.push('');
  const kind = r.variants.map((v) => `${v.split} ${f(v.metrics['recommendation.kindAccuracy'])} vs majority-class ${f(v.metrics['recommendation.majorityBaselineKindAccuracy'])}`).join('; ');
  out.push(`**How to read it.** Extraction recall and the outcome claims improved a lot, false merges fell, and far more investigations now end in an actionable recommendation (eligible coverage up). Recommendation kind accuracy did **not** improve in step: ${kind}. It is at or below the majority-class baseline on every split, and the false advice rate on train rose with the extra advice (before 1/2, after ${f(r.variants.find((v) => v.split === 'train')?.metrics['recommendation.falseAdviceRate'])}). The number of questions asked fell (the causes were not isolated: both the leak fix and the extractor changed at once); the wrong-recipient rate rests on at most a single question per split and is not an estimate. This is a better extraction layer feeding an assessor whose recommendation kinds are not yet right; it is not evidence that the recommendations are good.`);
  out.push('');
  out.push('### Decisions before and after (frozen rules applied mechanically; compared with the first provisional run and with re-run 1)');
  out.push('');
  out.push('| experiment | provisional | re-run 1 | final | changed |');
  out.push('| --- | --- | --- | --- | --- |');
  for (const [id, name] of [['e02-retrieval', 'E02'], ['e04-assessor', 'E04'], ['e03-selectors', 'E03'], ['e05-pool-size', 'E05'], ['e06-eligibility', 'E06'], ['e07-budgets', 'E07']] as const) {
    const before = read<Decision>(`archive-provisional/${id}`, 'decision.json')?.shipped ?? 'n/a';
    const mid = read<Decision>(`archive-rerun-1/${id}`, 'decision.json')?.shipped ?? 'n/a';
    const now = decision(id)?.shipped ?? 'n/a';
    const c = (x: string): string => x.split(' (')[0];
    out.push(`| ${name} | ${c(before)} | ${c(mid)} | ${c(now)} | ${c(before) === c(now) && c(mid) === c(now) ? 'no' : '**yes**'} |`);
  }
  out.push('');
  const anyChanged = out.some((l) => l.endsWith('| **yes** |'));
  out.push(`${anyChanged ? 'At least one shipped choice CHANGED (see the table).' : 'Every shipped choice is unchanged.'} The outcome text changed for some (E04: in the first run a tie at 0 coverage, now separate has 0.800 (4/5) coverage with false advice 1/5 against combined 0/5 coverage, so neither dominates and the rule keeps separate; E06 and E05 rest on at most 1 question). The E02/E04 validation decisions ${anyChanged ? 'changing would justify' : 'being unchanged is the reason for not'} re-opening the test split.`);
  out.push('');
  return out;
}

export function writeReport(): void {
  const fam = loadFamiliesFile();
  const bySplit: Record<string, number> = {};
  for (const x of fam.families) bySplit[x.split] = (bySplit[x.split] ?? 0) + 1;
  const lock = testFamiliesUntouched();
  const times = read<{ at: string; seconds: Record<string, number> }>('.', 'run-times.json');
  const out: string[] = [];
  out.push('# Experiment results (overnight run, 7 November 2026)');
  out.push('');
  out.push('Generated by `node experiments/run.ts report` from `experiments/results/`. Every number is `value (numerator/denominator)`; `n/a` means the denominator was zero (undefined stays undefined). Frozen hypotheses and rules: `docs/runs/2026-11-07-overnight/EXPERIMENT_PLAN.md`.');
  out.push('');
  out.push(`- Dataset: scenario families v${fam.version}, ${fam.families.length} families (${Object.entries(bySplit).map(([k, v]) => `${k} ${v}`).join(', ')}), 3 problems each. Test families untouched since freeze: **${lock.untouched}**.`);
  out.push('- System under test: the real pipeline (SQLite store, import pipeline, investigation, question coordinator, a selector), routes `rules` or `local` only. No network model call was made (a network guard is installed by the runner). Provenance is `measured` for real-system runs and `simulated` for simulator runs.');
  out.push('- Simulated people: every answer comes from the benchmark oracle reading the hidden answer key, one reply at a time. These are simulated people, not engineers.');
  if (times) out.push(`- Runtime: ${Object.entries(times.seconds).map(([k, v]) => `${k} ${v.toFixed(1)} s`).join(', ')} (one Mac, whole queue under ${Math.ceil(Object.values(times.seconds).reduce((a, b) => a + b, 0))} s; each experiment far below the 10 minute bound).`);
  out.push('');
  const e00checks = read<Array<{ name: string; pass: boolean; detail: string; knownLimitation?: boolean }>>('e00-baseline', 'checks.json') ?? [];
  const e00failed = e00checks.filter((k) => !k.pass);
  const e00known = e00checks.filter((k) => k.knownLimitation);
  if (e00failed.length) {
    const rt = read<{ stopRuleOverridden?: boolean }>('.', 'run-times.json');
    out.push('## E00 stop rule fired: everything below is provisional');
    out.push('');
    out.push(`The frozen E00 stop rule is "any leak or broken trace -> fix before continuing". ${e00failed.length} E00 check(s) fail (${e00failed.map((k) => k.name).join(', ')}).${rt?.stopRuleOverridden ? ' The queue was run on by recorded override (--continue-despite-e00); all later results are provisional.' : ' The queue stops at E00 unless --continue-despite-e00 is passed and recorded.'}`);
    out.push('');
  } else {
    out.push('## E00 stop rule: did not fire (re-run after the src/ fixes and extractor tuning)');
    out.push('');
    out.push(`All ${e00checks.length} E00 checks pass. The earlier run of this queue is **provisional** (E00 access checks failed, queue was run on regardless); its results are kept unchanged under \`experiments/results/archive-provisional/\`, and the second run (re-run 1) under \`experiments/results/archive-rerun-1/\` (the E00 directory there was rewritten once by another worker's partial re-run, so the "before" numbers below are taken from the archived \`RESULTS.provisional.md\`, the generated report of the original run).`);
    if (e00known.length) {
      out.push('');
      out.push(`**Known limitation, not a leak the system can detect:** ${e00known.map((k) => `\`${k.name}\``).join(', ')} is truth-based and still reports 1/42 on demo: ${KNOWN_LIMITATION_TEXT} The system-detectable check \`access-own-scope\` passes on every split (0 evidence shown whose stored scope excludes the requester). The E00 runner tolerates this only for the listed source id and only while the own-scope check passes (\`KNOWN_UNDETECTABLE_LEAKS\` in \`runners-core.ts\`); any other leaked source fails E00. The truth-based number stays visible in the tables.`);
    }
    out.push('');
    out.push('**Test split:** not re-scored in this re-run. The validation decisions for E02 and E04 did not change (see "Decisions before and after"), so by the plan\'s own condition there was no reason to re-open it. The test split was opened exactly once, before the fixes; its numbers below describe that earlier system, and `testFamiliesUntouched()` is still true because no test family file changed.');
    out.push('');
    out.push(...beforeAfterSection());
  }
  out.push('## Reading the results first');
  out.push('');
  const e00p = read<ProblemRow[]>('e00-baseline', 'problems.json') ?? [];
  const e00r = results('e00-baseline');
  const qs = e00p.flatMap((x) => x.questions);
  const pct = (n: number, d: number): string => (d ? `${n}/${d}` : '0/0');
  const noneN = e00p.filter((x) => x.final === 'none').length;
  const unknownN = qs.filter((q) => q.reply === 'unknown').length;
  const recall = e00r?.variants.map((v) => `${v.split} ${f(v.metrics['claims.all.recall'])}`).join(', ') ?? 'n/a';
  const outRecall = e00r?.variants.map((v) => `${v.split} ${f(v.metrics['claims.outcome.recall'])}`).join(', ') ?? 'n/a';
  out.push(`With library defaults and the tuned rules extractor, all-type claim recall is ${recall} and outcome recall is ${outRecall}. In E00, ${pct(noneN, e00p.length)} investigations end in the recommendation \`none\`, and ${pct(unknownN, qs.length)} questions asked were answered "unknown" by their recipient (${pct(qs.length, e00p.length)} questions over ${e00p.length} investigations). Extraction coverage was the binding constraint in the first run; it is much less binding now, but the downstream experiments still have very small denominators: E03 on the family arm asked no validation question, and E05 and E06 see 0 or 1 gap-relevant questions, so those three tie by construction and say nothing about the variants. The frozen rules were applied mechanically and ties are reported as ties.`);
  out.push('');

  out.push(section('E00 - rules baseline on the real system', 'e00-baseline', 'Reference baseline: every stage on its deterministic route with the library defaults and no scenario-specific configuration. Saved as `results/e00-baseline/`.', (r) => {
    const rows = [
      { label: 'claims precision (all types)', metric: 'claims.all.precision' }, { label: 'claims recall (all types)', metric: 'claims.all.recall' },
      { label: 'cases false merge', metric: 'cases.falseMergeRate' }, { label: 'cases false split', metric: 'cases.falseSplitRate' },
      { label: 'false "solved" (reported recovery claimed verified)', metric: 'resolution.falseSolvedRate' },
      { label: 'recommendation kind accuracy', metric: 'recommendation.kindAccuracy' }, { label: 'majority-class baseline for kind accuracy', metric: 'recommendation.majorityBaselineKindAccuracy' },
      { label: 'false advice rate', metric: 'recommendation.falseAdviceRate' }, { label: 'eligible coverage', metric: 'recommendation.eligibleCoverage' }, { label: 'missed opportunity', metric: 'recommendation.missedOpportunityRate' },
      { label: 'consequential gap asked about', metric: 'question.gapFoundRate' }, { label: 'unnecessary question rate', metric: 'question.unnecessaryQuestionRate' },
      { label: 'wrong recipient rate', metric: 'question.wrongRecipientRate' }, { label: 'questions per investigation', metric: 'question.questionsPerInvestigation' },
      { label: 'incoming linking recall@1', metric: '@1.linking.recall' }, { label: 'incoming linking recall@3', metric: '@3.linking.recall' }, { label: 'incoming linking precision@3', metric: '@3.linking.precision' },
      { label: 'access leakage (truth-based)', metric: 'access.leakageRate' }, { label: 'shown evidence the store itself restricts', metric: 'access.shownRestrictedEvidenceRate' },
      { label: 'mean latency per investigation (ms)', metric: 'efficiency.meanLatencyMs' },
    ];
    const checks = read<Array<{ name: string; pass: boolean; detail: string; knownLimitation?: boolean }>>('e00-baseline', 'checks.json') ?? [];
    return [table(r.variants, rows, (v) => v.split), '', '**E00 checks**', '', ...checks.map((k) => `- ${k.knownLimitation ? '**PASS (known limitation)**' : k.pass ? 'PASS' : '**FAIL**'} ${k.name}: ${k.detail}`), '',
      '**Concrete failure examples (train split)**', '', examples('e00-baseline', 'baseline-rules', (x) => (x.split === 'train' ? recFail(x) : undefined)), '',
      'Access leakage: the system-detectable leak (private evidence cited to non-members) is closed; the one truth-based residual on demo is a known, system-undetectable limitation (see the top of this file and "Findings in src/").'].join('\n');
  }));

  out.push(section('E01 - extraction: rules extractor vs a recorded Claude-agent arm', 'e01-extraction', '**What the arm is.** One recorded pass of a Claude Sonnet subagent over the visible sources of the train and validation families (route `claude-agent-arm`, provenance `replay-fixture`). It is **not the proposed small GPT generator and not an application route**; the application never calls it, and it is one pass on six families, so it says nothing about a small model. Variants: `rules-extractor@current` is the real import path on the working tree (provenance measured); `claude-agent-arm` scores the recorded proposals **directly, without memory/commit** (cases are the proposed incidents, attempts and outcomes are not derived); `claude-agent-arm→commit` pushes the same proposals through the real `commitProposal` (which derives attempts, outcomes and case records). Train and validation are scored separately, not pooled. Recorded fixtures: `data/replays/e01-claude-arm/`; saved as `results/e01-extraction/`.', (r) => {
    const rows = [
      { label: 'claims precision (all types)', metric: 'claims.all.precision' }, { label: 'claims recall (all types)', metric: 'claims.all.recall' },
      { label: 'recall: observation', metric: 'claims.observation.recall' }, { label: 'recall: hypothesis', metric: 'claims.hypothesis.recall' }, { label: 'recall: advice', metric: 'claims.advice.recall' },
      { label: 'recall: action', metric: 'claims.action.recall' }, { label: 'recall: outcome', metric: 'claims.outcome.recall' }, { label: 'recall: condition', metric: 'claims.condition.recall' },
      { label: 'precision: observation', metric: 'claims.observation.precision' }, { label: 'precision: action', metric: 'claims.action.precision' }, { label: 'precision: outcome', metric: 'claims.outcome.precision' },
      { label: 'entities recall', metric: 'entities.recall' },
      { label: 'cases false merge', metric: 'cases.falseMergeRate' }, { label: 'cases false split', metric: 'cases.falseSplitRate' }, { label: 'cases missing an incident (count)', count: 'cases.missingIncidents' },
      { label: 'attribution: claim person error', metric: 'attribution.claimPersonErrorRate' }, { label: 'attribution: firsthand link error', metric: 'attribution.firsthandLinkErrorRate' },
      { label: 'attribution: attempt performer error (n/a = no attempts derived)', metric: 'attribution.attemptPerformerErrorRate' }, { label: 'attribution: outcome reporter error', metric: 'attribution.outcomeReporterErrorRate' },
      { label: 'copies: independent-support overcount (importer lineage)', metric: 'copies.overcountRate' }, { label: 'copies: overcount counting raw distinct sources', metric: 'copies.overcountRate.noLineage' },
      { label: 'usefulness label accuracy (uncertain abstains)', metric: 'usefulness.accuracy' },
      { label: 'claims produced (count)', count: 'e01.claims' }, { label: 'attempts / outcomes derived (counts)', count: 'e01.attempts' },
    ];
    const parts: string[] = [];
    for (const split of ['train', 'validation']) {
      const vs = r.variants.filter((v) => v.split === split);
      const fams = vs[0]?.counts['e01.families'];
      parts.push(`**${split}** (${fams} families)`, '', table(vs, rows), '');
    }
    const gaps = read<{ countByType: Record<string, number>; gaps: Array<{ familyId: string; type: string; statement: string }> }>('e01-extraction', 'lexicon-gaps.json');
    const map = r.variants.filter((v) => v.variantId === 'claude-agent-arm').map((v) => `${v.split}: ${c(v, 'mapping.evidenceRefsMapped')}/${c(v, 'mapping.evidenceRefs')} evidence references mapped, ${c(v, 'mapping.claimsDropped')} claims dropped`).join('; ');
    const slice = (id: string): string => r.variants.filter((v) => v.variantId === id).map((v) => `${v.split}: ${Object.entries(v.failureSlicesByTag).map(([t, x]) => `${t} ${x.count}`).join(', ') || 'none'}`).join('; ');
    parts.push('**Evidence-id mapping.** The fixtures cite `teams:<seq>`, `email:<Message-ID>` and `slack:<ts>`; each id is matched exactly (provider plus seq / Message-ID / ts) to the one stored evidence record the harness imports. ' + map + '.', '');
    parts.push('**Failure slices by scenario tag** (failure counts, all failing metrics together)', '', `- rules-extractor@current: ${slice('rules-extractor@current')}`, `- claude-agent-arm: ${slice('claude-agent-arm')}`, '');
    parts.push('**Concrete failure examples (claude-agent-arm, validation)**', '', failureExamples('e01-extraction', 'claude-agent-arm', 'claims.precision', 3, 'validation'), failureExamples('e01-extraction', 'claude-agent-arm', 'claims.recall', 3, 'validation'), failureExamples('e01-extraction', 'claude-agent-arm', 'attribution', 3, 'validation'), '');
    parts.push('**Concrete failure examples (rules-extractor@current, validation)**', '', failureExamples('e01-extraction', 'rules-extractor@current', 'claims.recall', 3, 'validation'), failureExamples('e01-extraction', 'rules-extractor@current', 'claims.precision', 3, 'validation'), '');
    if (gaps) parts.push(`**Lexicon gaps.** ${gaps.gaps.length} truth claims were recovered by the arm and missed by the rules extractor (${Object.entries(gaps.countByType).map(([k, n]) => `${k} ${n}`).join(', ')}); the full list is \`results/e01-extraction/lexicon-gaps.json\`. This is where the agent arm may inform lexicon fixes; for example:`, '', ...gaps.gaps.slice(0, 5).map((x) => `- ${x.familyId} (${x.type}): "${x.statement}"`), '');
    parts.push('**How to read this.** Both arms are scored by the same evaluator on the same evidence. The matcher requires token overlap of at least 0.5 with the key statement, so an agent paraphrase can count as a miss and as an unsupported claim; the arm is measured on only six families and one recording pass, so differences of a few claims are not evidence. The rules numbers are for the extractor after tuning (re-run with `node experiments/run.ts e01`); the fixtures do not change, so the arm numbers are the same as in the first run. Before tuning the rules extractor had all-type recall 0.213 (10/47) on train and 0.182 (4/22) on validation, i.e. below the arm; after tuning it is above the arm on recall on both splits (and above on precision on train, below on validation). The direct and committed arms score the same claims; they differ in cases, attempts and outcomes (commit derives them and inherits the memory layer\'s case and outcome rules).');
    return parts.join('\n');
  }));

  out.push(section('E02 - retrieval: lexical vs exact vs local trigram vs hybrid', 'e02-retrieval', 'Same cases and access filters; only the retriever changes. The decision split is validation (2 families); train and demo are reported for context.', (r) => {
    const val = r.variants.filter((v) => v.split === 'validation');
    const rows = [
      { label: 'recall@1 of relatedIncidentKeys', metric: '@1.linking.recall' }, { label: 'recall@3', metric: '@3.linking.recall' },
      { label: 'recall@3 (only incidents the requester may see)', metric: '@3.accessible.linking.recall' }, { label: 'precision@3', metric: '@3.linking.precision' },
      { label: 'lookalike top-1 rate (lower is better)', metric: 'retrieval.lookalikeTop1Rate' },
      { label: 'downstream: kind accuracy', metric: 'recommendation.kindAccuracy' }, { label: 'downstream: false advice', metric: 'recommendation.falseAdviceRate' }, { label: 'downstream: eligible coverage', metric: 'recommendation.eligibleCoverage' },
    ];
    const other = r.variants.filter((v) => v.split !== 'validation').map((v) => `- ${v.variantId} on ${v.split}: recall@3 ${f(v.metrics['@3.linking.recall'])}, lookalike top-1 ${f(v.metrics['retrieval.lookalikeTop1Rate'])}`);
    return [table(val, rows), '', '**Other splits**', '', ...other, '', '**Concrete failure examples (hybrid, validation then train)**', '', failureExamples('e02-retrieval', 'hybrid-rrf', 'retrieval.lookalike'), failureExamples('e02-retrieval', 'hybrid-rrf', 'linking.recall'),
      '', 'The retrievers separate little here: each family has one to two cases, so most variants rank the same small candidate set and a single problem moves a rate by 0.1 or more.'].join('\n');
  }));

  out.push(section('E04 - assessor: combined vs separate', 'e04-assessor', 'Same evidence, candidates and retriever (E02 choice); only the assessor mode changes. The decision split is validation.', (r) => {
    const val = r.variants.filter((v) => v.split === 'validation');
    const rows = [
      { label: 'false advice rate', metric: 'recommendation.falseAdviceRate' }, { label: 'supported-applicable rate (of issued)', metric: 'recommendation.supportedApplicableRate' },
      { label: 'eligible coverage', metric: 'recommendation.eligibleCoverage' }, { label: 'kind accuracy', metric: 'recommendation.kindAccuracy' }, { label: 'missed opportunity', metric: 'recommendation.missedOpportunityRate' },
    ];
    const other = r.variants.filter((v) => v.split !== 'validation').map((v) => `- ${v.variantId} on ${v.split}: false advice ${f(v.metrics['recommendation.falseAdviceRate'])}, coverage ${f(v.metrics['recommendation.eligibleCoverage'])}`);
    return [table(val, rows), '', '**Other splits**', '', ...other, '', '**Concrete failure examples (separate mode)**', '', examples('e04-assessor', 'separate', recFail), '', 'False advice cannot differ when almost no advice is issued: both modes issue nothing on validation, so the tie rule decides.'].join('\n');
  }));

  out.push(section('E03 - question selectors: rules vs epsilon-greedy vs LinUCB', 'e03-selectors', 'Two arms. (a) Simulator: 300 steps, seeds 1-3, hidden knowledge stays in the simulator, 0 ineligible selections asserted. (b) Family arm: LinUCB trained on the train families (3 seeds = 3 training orders; artifacts `data/models/linucb-e03-seed<N>.json`), frozen, then scored against the rules selector on the validation families. Benefit is labelled by the harness from the key: 1 if the answer moved the recommendation to the expected class, 0 if answered without that change, unknown (not 0) if unanswered.', (r, _m, d) => {
    const sim = r.variants.filter((v) => v.variantId.startsWith('sim-'));
    const fam = r.variants.filter((v) => v.variantId.startsWith('family-'));
    const simRows = sim.map((v) => `| ${v.variantId.replace('sim-', '')} | ${f(v.metrics['sim.meanBenefitPerInvestigation'])} | ${v.repeatVariation?.['sim.meanBenefitPerInvestigation'] ? `${v.repeatVariation['sim.meanBenefitPerInvestigation'].min.toFixed(3)} to ${v.repeatVariation['sim.meanBenefitPerInvestigation'].max.toFixed(3)}` : 'n/a'} | ${c(v, 'sim.ineligibleSelections')} | ${c(v, 'sim.deferrals')} | ${c(v, 'sim.unanswered')} |`);
    const famRows = [
      { label: 'mean benefit per investigation', metric: 'benefit.meanPerInvestigation' }, { label: 'wrong recipient rate', metric: 'question.wrongRecipientRate' }, { label: 'questions per investigation', metric: 'question.questionsPerInvestigation' },
      { label: 'hard-rule violations', count: 'question.hardRuleViolations' }, { label: 'missed consequential gaps', count: 'question.missedConsequentialGaps' },
    ];
    return ['**Simulator arm** (provenance: simulated)', '', '| selector | mean benefit (steps x seeds) | range over 3 seeds | ineligible selections | deferrals | unanswered |', '| --- | --- | --- | --- | --- | --- |', ...simRows, '',
      '**Family arm, validation families** (provenance: measured)', '', table(fam, famRows), '', '**Training**', '', `- ${d?.detail.training ?? 'n/a'}`, '', '**Concrete failure examples (family-rules, validation)**', '', examples('e03-selectors', 'family-rules', (x) => {
        const q = x.questions.find((y) => y.benefit === 0 || y.benefit === null);
        return q ? `asked "${short(q.text, 80)}" of ${q.to.split(':').pop()}: reply ${q.reply}, benefit ${q.benefit === null ? 'unknown' : q.benefit}` : undefined;
      })].join('\n');
  }));

  out.push(section('E05 - question pool size', 'e05-pool-size', 'Template generator emitting at most 1, 2 or 4 candidates; same gaps. Pooled over train+validation (nothing is fitted).', (r) => {
    const rows = [
      { label: 'consequential gap asked about', metric: 'question.gapFoundRate' }, { label: 'questions per investigation', metric: 'question.questionsPerInvestigation' },
      { label: 'duplicate questions (same condition and person)', count: 'burden.duplicateQuestions' }, { label: 'wrong recipient rate', metric: 'question.wrongRecipientRate' }, { label: 'unnecessary question rate', metric: 'question.unnecessaryQuestionRate' },
    ];
    return [table(r.variants, rows, (v) => v.variantId.split('@')[0] as string), '', '**Concrete failure examples (pool-2)**', '', failureExamples('e05-pool-size', 'pool-2@train+validation', 'gapFound')].join('\n');
  }));

  out.push(section('E06 - recipient eligibility: direct-only vs question-dependent', 'e06-eligibility', 'Direct-only: empty observability policy and recipients restricted to firsthand links on the question\'s own case. Question-dependent: directory groups configured to observe condition keys (`experiments/config.ts`, written from group names before the run). The default library behaviour is shown as a reference row.', (r) => {
    const rows = [
      { label: 'answerable-routing rate (a question reached a person who can answer the gap)', metric: 'routing.answerableRoutingRate' }, { label: 'wrong recipient rate', metric: 'question.wrongRecipientRate' },
      { label: 'consequential gap asked about', metric: 'question.gapFoundRate' }, { label: 'questions per investigation', metric: 'question.questionsPerInvestigation' },
      { label: 'max questions to one person (per family)', count: 'burden.maxQuestionsToOnePersonPerFamily' }, { label: 'unanswered questions', count: 'burden.unansweredQuestions' },
    ];
    const same = new Set(r.variants.map((v) => `${f(v.metrics['routing.answerableRoutingRate'])}|${f(v.metrics['question.wrongRecipientRate'])}|${f(v.metrics['question.questionsPerInvestigation'])}`)).size === 1;
    const caveat = same ? ['', '**Caveat.** All three arms behaved identically on these families: the questions the baseline asks are about unconfirmed outcomes (recipients come from case links, not from observability), so the observability policy never comes into play. The frozen rule (wrong-recipient rate does not rise by more than 0.02) is therefore met trivially; this is **not** evidence that question-dependent eligibility routes more gaps to people who can answer them.'] : [];
    return [table(r.variants, rows, (v) => v.variantId.split('@')[0] as string), ...caveat, '', '**Concrete failure examples (question-dependent)**', '', failureExamples('e06-eligibility', 'question-dependent@train+validation', 'wrongRecipient')].join('\n');
  }));

  out.push(section('E07 - budgets and cooldowns', 'e07-budgets', 'Daily limit {1,3,5} x cooldown {0,30} minutes. Family arm: train families, problems 20 minutes apart so budgets bind across investigations. Simulator arm: the selection simulator with a budget layer applied before the selector (labelled simulated).', (r) => {
    const fr = read<{ family: Array<{ limit: number; cooldown: number; benefit: number; questionsPerInvestigation: number; maxPerPerson: number; dominated: boolean }>; simulator: Array<{ limit: number; cooldown: number; benefit: number; questionsPerInvestigation: number; maxPerPerson: number; dominated: boolean }> }>('e07-budgets', 'frontier.json');
    const rowsOf = (pts: NonNullable<typeof fr>['family']) => pts.map((p) => `| ${p.limit} / ${p.cooldown} | ${p.benefit.toFixed(3)} | ${p.questionsPerInvestigation.toFixed(3)} | ${p.maxPerPerson} | ${p.dominated ? 'dominated' : 'frontier'}${p.limit === 3 && p.cooldown === 30 ? ' (default)' : ''} |`);
    const dup = r.variants.filter((v) => v.variantId.startsWith('family-')).map((v) => `| ${v.variantId.replace('family-', '')} | ${c(v, 'burden.duplicateQuestions')} | ${c(v, 'burden.cancelledDuplicate')} | ${c(v, 'burden.cancelledObsoleteOrResolved')} | ${c(v, 'burden.unansweredQuestions')} |`);
    const hdr = ['| limit / cooldown | benefit per investigation | questions per investigation | max questions to one person | frontier |', '| --- | --- | --- | --- | --- |'];
    return [
      '**Family arm (train families)**', '', ...hdr, ...(fr ? rowsOf(fr.family) : []), '', '**Burden counts, family arm**', '', '| setting | duplicate questions | cancelled as duplicate | cancelled as obsolete or resolved | unanswered |', '| --- | --- | --- | --- | --- |', ...dup, '',
      '**Simulator arm (simulated; max per person is per day)**', '', ...hdr, ...(fr ? rowsOf(fr.simulator) : []), '',
      '**Concrete failure examples (family d3-c30, default)**', '', examples('e07-budgets', 'family-d3-c30', (x) => (x.loopEnd !== 'no-question' && x.loopEnd !== 'no-question-needed' ? `loop ended \`${x.loopEnd}\` after ${x.questions.length} question(s)` : undefined)),
    ].join('\n');
  }));

  const u = results('usefulness-logistic-v1');
  out.push('## Local usefulness classifier (hashed logistic regression)\n');
  if (u) {
    out.push('**Weak result.** Validation accuracy beats the majority class by about one example (see confusion counts below): the model predicts almost everything useful and overfits the 66 training examples. It does not demonstrably separate incident evidence from chatter. A local learned model, trained tonight on this Mac from synthetic data (train families only), pure TypeScript. Label: evidence is `useful` when its source id belongs to any truth incident, `irrelevant` otherwise (labelled harness side). Saved as `data/models/usefulness-logistic-v1.json`. It is **not wired into the application**.');
    out.push('');
    out.push(table(u.variants, [{ label: 'accuracy (mean of 3 seeds)', metric: 'usefulness.accuracy' }, { label: 'majority-class accuracy', metric: 'usefulness.majorityBaselineAccuracy' }, { label: 'precision', metric: 'usefulness.precision' }, { label: 'recall', metric: 'usefulness.recall' }, { label: 'examples', count: 'usefulness.examples' }, { label: 'positives', count: 'usefulness.positives' }], (v) => v.split));
    out.push('');
    out.push(...(u.notes.filter((n) => /^(validation|demo|train):/.test(n)).map((n) => `- ${n}`)));
    out.push('');
  } else out.push('Not run.\n');

  const t2 = decision('e02-test');
  const t4 = decision('e04-test');
  out.push('## Test split: one-shot confirmation of the E02 and E04 choices\n');
  if (t2 && t4) {
    const c2 = read<{ validationChoice: string; testChoice: string; confirmed: boolean }>('e02-test', 'confirmation.json');
    const c4 = read<{ validationChoice: string; testChoice: string; confirmed: boolean }>('e04-test', 'confirmation.json');
    out.push('The test families were scored once, at the very end, with the criteria frozen before any scored run. Nothing was tuned afterwards. Recorded separately as `results/e02-test/` and `results/e04-test/`.');
    out.push('');
    out.push(`- **E02 (test):** ${t2.outcome} Test choice: **${t2.shipped}**; validation choice: ${c2?.validationChoice}; ${c2?.confirmed ? 'confirmed' : 'NOT confirmed'}.`);
    out.push(`- **E04 (test):** ${t4.outcome} Test choice: **${t4.shipped}**; validation choice: ${c4?.validationChoice}; ${c4?.confirmed ? 'confirmed' : 'NOT confirmed'}.`);
    out.push('');
  } else out.push('Not yet run (`node experiments/run.ts test-final`, once).\n');

  out.push('## Findings in src/\n');
  out.push('1. **Access leak: closed.** The first run showed private-channel evidence ids in `recommendation.basis`, `hypotheses[].basis` and people reasons for non-members (train, `config-rollback-private`). After the investigation worker\'s per-evidence gate, `access-leakage` and `access-own-scope` pass on train and validation and `access-own-scope` passes on demo (E00 checks above).');
  out.push(`2. **Known limitation, not detectable from visible inputs.** ${KNOWN_LIMITATION_TEXT} Recorded as a limitation of the scenario/ingest, not as a leak the system could prevent; fixing it needs an ACL source for e-mail.`);
  out.push('3. **Case identity is the asset id**, so incidents on one asset can merge (false merge is 0/7 on train and 1/4 on validation after tuning); known in `memory/README.md`.');
  out.push('4. **Recommendation kinds lag extraction.** Kind accuracy remains at or below the majority-class baseline even with 0.68 claim recall; look at the assessor/applicability rules, not at extraction, for the next gain.');
  out.push('');

  out.push('## What the results do NOT show\n');
  out.push('- **No real engineer benefit.** All people are simulated by an oracle that reads a hidden answer key authored by one agent in one pass, unreviewed (`data/scenarios/REVIEW.md`). Nothing here measures whether an engineer is helped (U04).');
  out.push('- **Synthetic, small, single-author data.** Ten families (demo 2, train 4, validation 2, test 2), 30 problems; the validation and test splits have 6 problems each, so one problem moves a rate by 0.17 or more. Shared phrasing across families may flatter learned components.');
  out.push('- **Ties are not equivalence.** E03 (family arm), E05 and E06 see 0 to 2 gap-relevant questions and cannot separate their variants; E02 recall@3 ties on 7/9 and the E04 choice rests on a handful of recommendations.');
  out.push('- **The simulator advantage of LinUCB is by construction.** Benefit in the simulator depends on the same visible features the bandit sees; it shows the model can learn them, not that it helps with real people.');
  out.push('- **The family arm cannot train a useful bandit.** Only a handful of labelled questions exist per seed (unanswered ones are skipped, never 0), and LinUCB is deterministic: the 3 seeds only reorder the training families.');
  out.push('- **Test split not re-scored.** The one-shot E02/E04 test confirmation predates the src/ fixes and extractor tuning (see the top of this file).');
  out.push('- **No learned retrieval.** The "local" vector route is hashed character trigrams, not a trained encoder. The usefulness classifier is a small local model on synthetic labels and is not part of the application.');
  out.push('- **No time-to-decision, no token or call counts** were measured (null, never 0).');
  out.push('');
  out.push('## Harness limitations\n');
  out.push('- Outcome questions ("Did traffic return after ...?") are free text; the harness translates them into recovery-state condition keys (`traffic.state`, `bgp.session`, `alarms.state`, `temperature.state`, `interface.status`) before the oracle answers. The oracle is therefore somewhat more forgiving than a real person.');
  out.push('- An unavailable or non-answering recipient is modelled by shelving (`defer`) the question so another person can be tried; the evaluator counts it as unanswered.');
  out.push('- Time is simulated: each problem is on its own day (budgets are per day) unless an experiment sets a spacing; each answer advances 5 minutes, so a 30 minute cooldown blocks a second question to the same person inside one investigation.');
  out.push('- `importFromPath(scenario-dir)` reads sources only and ignores `truth.json`/`incoming.json`; the family folder path is passed to it. Hidden keys are read by the harness only for the oracle and for scoring.');
  out.push('- `lookalike-different-cause` is a family tag; the per-problem list comes from the evaluation owner\'s tag table in `data/scenarios/REVIEW.md` (the sealed test family uses all of its problems).');
  out.push('- `mergeReports` sums counts across families, so latency percentiles are recomputed from per-problem latencies.');
  out.push('- Code under `src/` is edited by other workers during the night; results come from the working tree at the time of the run.');
  out.push('');
  writeFileSync(join(HERE, 'RESULTS.md'), out.join('\n'));
  console.log('RESULTS.md written');
}
