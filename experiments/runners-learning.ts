/**
 * E03 (selectors), E05 (pool size), E06 (recipient eligibility), E07 (budgets and cooldowns) and the local
 * usefulness classifier. Criteria are the frozen ones in EXPERIMENT_PLAN.md, written into each manifest before scoring.
 */
import type { EligibleAction, Selector } from '../src/libs/utils/contracts/index.ts';
import { defaultInvestigationSettings } from '../src/libs/utils/investigation/index.ts';
import { EpsilonGreedy, LinUcb, randomSelector, RulesSelector } from '../src/libs/utils/policies/index.ts';
import { loadArtifact, saveArtifact } from '../src/libs/utils/models/artifacts.ts';
import { LogisticHashed } from '../src/libs/utils/models/logistic-hashed.ts';
import type { LabeledText } from '../src/libs/utils/models/logistic-hashed.ts';
import { createRng, shuffleInPlace } from '../src/libs/utils/models/rng.ts';
import { defaultSimConfig, runSimulation, SelectionSimulator } from '../src/libs/utils/models/testing/simulator.ts';
import { loadHidden } from '../benchmarks/load.ts';
import { ratio } from '../benchmarks/evaluator.ts';
import type { MaybeMetric } from '../benchmarks/evaluator.ts';
import { writeManifest, writeResults } from '../benchmarks/manifest.ts';
import type { VariantResult } from '../benchmarks/manifest.ts';
import { baseManifest, familiesOf, fmt, problemTable, runVariant, runVariantPooled, writeExtra } from './common.ts';
import type { Decision, VariantRun } from './common.ts';
import { DIRECT_ONLY_OBSERVABILITY, QUESTION_DEPENDENT_OBSERVABILITY } from './config.ts';
import { benchmarkSourceId, incidentOfSources, prepareFamily, runFamily } from './harness.ts';
import { normalizeSourceId } from '../benchmarks/text.ts';
import { shippedRetriever } from './runners-core.ts';

const SEEDS = [1, 2, 3];
const num = (m: MaybeMetric | undefined): number => (m ? m.value : 0);
const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
const range = (xs: number[]): { min: number; max: number } => ({ min: Math.min(...xs), max: Math.max(...xs) });
const emptyVariant = (variantId: string, split: VariantResult['split'], provenance: VariantResult['provenance']): VariantResult => ({ variantId, provenance, split, metrics: {}, counts: {}, failures: [], failureSlicesByTag: {} });

// ------------------------------------------------------------------------------------------------ E03

interface SimRow { selector: string; seed: number; meanBenefit: number; answeredMean: number; unanswered: number; deferrals: number; ineligible: number }

export function simArm(): { rows: SimRow[]; variants: VariantResult[]; summary: Record<string, { mean: number; min: number; max: number; ineligible: number }> } {
  const make: Record<string, (seed: number) => Selector> = {
    rules: () => new RulesSelector(),
    'epsilon-greedy': (seed) => new EpsilonGreedy({ epsilon: 0.1, seed }),
    linucb: () => new LinUcb({ alpha: 0.5 }),
    random: (seed) => randomSelector(seed),
  };
  const rows: SimRow[] = [];
  for (const [name, f] of Object.entries(make)) {
    for (const seed of SEEDS) {
      const r = runSimulation(f(seed), { seed, steps: 300 });
      if (r.ineligibleSelections !== 0) throw new Error(`${name} seed ${seed} selected an ineligible pair ${r.ineligibleSelections} times`);
      rows.push({ selector: name, seed, meanBenefit: r.meanBenefit, answeredMean: r.answeredMean, unanswered: r.unanswered, deferrals: r.deferrals, ineligible: r.ineligibleSelections });
    }
  }
  const summary: Record<string, { mean: number; min: number; max: number; ineligible: number }> = {};
  const variants: VariantResult[] = [];
  for (const name of Object.keys(make)) {
    const mine = rows.filter((r) => r.selector === name);
    const mb = mine.map((r) => r.meanBenefit);
    summary[name] = { mean: mean(mb), ...range(mb), ineligible: mine.reduce((n, r) => n + r.ineligible, 0) };
    const v = emptyVariant(`sim-${name}`, 'train', 'simulated');
    v.metrics['sim.meanBenefitPerInvestigation'] = ratio(Math.round(mean(mb) * 300 * 3), 900);
    const unanswered = mine.reduce((n, r) => n + r.unanswered, 0);
    const deferrals = mine.reduce((n, r) => n + r.deferrals, 0);
    const benefitSum = Math.round(mean(mb) * 300 * 3);
    // pooled over seeds: benefit per answered question (a step is answered unless the person did not answer or the question was deferred)
    v.metrics['sim.meanBenefitAnswered'] = ratio(benefitSum, 300 * 3 - unanswered - deferrals);
    v.metrics['sim.unansweredPerStep'] = ratio(unanswered, 300 * 3);
    v.metrics['sim.deferralsPerStep'] = ratio(deferrals, 300 * 3);
    for (const r of mine) v.metrics[`sim.meanBenefitPerInvestigation.seed${r.seed}`] = ratio(Math.round(r.meanBenefit * 300), 300);
    v.counts = { 'sim.steps': 300, 'sim.seeds': 3, 'sim.ineligibleSelections': summary[name]!.ineligible, 'sim.unanswered': unanswered, 'sim.deferrals': deferrals, 'sim.benefitSum': benefitSum };
    v.repeatVariation = { 'sim.meanBenefitPerInvestigation': { ...range(mb), runs: 3 } };
    variants.push(v);
  }
  return { rows, variants, summary };
}

export async function runE03(): Promise<Decision> {
  const id = 'e03-selectors';
  const trainFamilies = familiesOf('train').map((f) => f.id);
  const manifest = baseManifest({
    id,
    hypothesis: 'A LinUCB contextual bandit selects more beneficial question-person pairs than the rule selector with identical candidate pools and hard gates.',
    splits: ['train', 'validation'],
    variants: [
      { id: 'rules', description: 'deterministic rule selector (baseline)', route: 'rules' },
      { id: 'epsilon-greedy', description: 'non-contextual per-recipient running mean, epsilon 0.1 (simulator only)', route: 'local' },
      { id: 'linucb', description: 'LinUCB alpha 0.5; simulator learns online; family arm trained on train families per seed, frozen artifact scored on validation', route: 'local' },
      { id: 'random', description: 'uniform random reference (simulator only)', route: 'local' },
    ],
    route: 'mixed',
    seeds: SEEDS,
    config: {
      simulatorArm: { steps: 300, seeds: SEEDS, source: 'src/libs/utils/models/testing/simulator.ts (hidden knowledge stays in the simulator)', provenance: 'simulated' },
      familyArm: { trainFamilies, learning: 'LinUCB.update from harness-labelled EvaluationRecords; assessedBenefit = 1 if the answer moved the recommendation to the key expected class, 0 if answered without that change, null if unanswered', seedsMean: 'LinUCB is deterministic given its data; the seed sets the ORDER of training families', artifacts: SEEDS.map((s) => `data/models/linucb-e03-seed${s}.json`), retriever: 'hybrid', assessor: 'separate' },
      benefitDefinition: 'mean over investigations of the labelled benefit of their questions (unanswered and no-question investigations contribute 0 to the numerator; the denominator is all investigations)',
    },
    metrics: ['benefit.meanPerInvestigation', 'question.wrongRecipientRate', 'question.questionsPerInvestigation', 'question.hardRuleViolations', 'question.missedConsequentialGaps', 'sim.meanBenefitPerInvestigation'],
    acceptanceCriteria: ['bandit ships behind the setting only if mean benefit on validation > rules by >= 0.05 with all 3 seeds above rules (each by >= 0.05) and 0 hard-rule violations; else rules stay (EXPERIMENT_PLAN.md E03)', 'simulator arm: 0 ineligible selections asserted for every selector and seed'],
    stopRule: 'stop if simulator rewards leak hidden truth into features (selectors see only eligible pairs and visible features)',
  });
  writeManifest(manifest);

  // (a) simulator arm
  const sim = simArm();

  // (b) family arm: train per seed, save artifacts, score on validation
  const trained: Array<{ seed: number; order: string[]; updates: number; skipped: number; path: string }> = [];
  for (const seed of SEEDS) {
    const order = shuffleInPlace([...trainFamilies], createRng(seed));
    const sel = new LinUcb({ alpha: 0.5 });
    for (const fid of order) await runFamily(fid, { selector: sel, learn: true });
    const art = sel.toModelArtifact({ id: `linucb-e03-seed${seed}`, dataset: { id: `scenarios-${manifest.datasetVersion}`, split: 'train', families: order }, seeds: [seed], metrics: { updates: sel.updates, skippedUnknown: sel.skippedUnknown } });
    trained.push({ seed, order, updates: sel.updates, skipped: sel.skippedUnknown, path: saveArtifact(art) });
  }
  const variants: VariantResult[] = [...sim.variants];
  const rules = await runVariant('family-rules', 'validation', () => ({ selector: new RulesSelector() }));
  const arms: VariantRun[] = [rules];
  for (const t of trained) {
    const sel = LinUcb.fromArtifact(loadArtifact(`linucb-e03-seed${t.seed}`));
    arms.push(await runVariant(`family-linucb-seed${t.seed}`, 'validation', { selector: sel }));
  }
  const table: Array<Record<string, unknown>> = [];
  for (const a of arms) {
    variants.push(a.result);
    table.push(...problemTable(a));
  }
  const rb = num(rules.extras['benefit.meanPerInvestigation']);
  const diffs = arms.slice(1).map((a) => num(a.extras['benefit.meanPerInvestigation']) - rb);
  const violations = arms.map((a) => a.scored.counts['question.hardRuleViolations'] ?? 0);
  const allAbove = diffs.every((d) => d >= 0.05);
  const ship = allAbove && violations.every((v) => v === 0);
  const asked = arms.map((a) => a.scored.metrics['question.questionsPerInvestigation']?.numerator ?? 0);
  const untestable = asked.every((n) => n === 0);
  const simDiffs = SEEDS.map((s) => (sim.rows.find((r) => r.selector === 'linucb' && r.seed === s)?.meanBenefit ?? 0) - (sim.rows.find((r) => r.selector === 'rules' && r.seed === s)?.meanBenefit ?? 0));
  const simOk = simDiffs.every((d) => d >= 0.05);
  const decision: Decision = {
    experiment: 'E03',
    hypothesis: 'A LinUCB bandit selects more beneficial question-person pairs than the rule selector with identical candidate pools and hard gates.',
    criterion: 'Family arm on validation: LinUCB mean benefit exceeds rules by >= 0.05 on ALL 3 seeds with 0 hard-rule violations -> bandit may ship behind the setting; else rules stay. The simulator arm is reported (mean +- range over 3 seeds, 300 steps) with 0 ineligible selections asserted.',
    outcome: `Family arm: rules benefit ${rb.toFixed(3)}; LinUCB minus rules per seed ${diffs.map((d) => d.toFixed(3)).join(', ')}; hard-rule violations ${violations.join('/')} -> ${untestable ? 'criterion UNTESTABLE: no arm asked a single question on the validation families (questions asked per arm: ' + asked.join('/') + '), so benefit is 0 for every selector by construction and this says nothing about LinUCB versus rules' : ship ? 'criterion met' : 'criterion NOT met'}. Simulator arm (not the shipping criterion): LinUCB minus rules per seed ${simDiffs.map((d) => d.toFixed(3)).join(', ')} -> ${simOk ? 'above rules by >= 0.05 on all seeds' : 'not above rules by 0.05 on every seed'}.`,
    shipped: ship ? 'linucb behind the setting (rules remain the default)' : untestable ? 'rules (criterion untestable on the family arm: 0 questions asked on validation; not a negative result for LinUCB)' : 'rules',
    detail: {
      ...Object.fromEntries(Object.entries(sim.summary).map(([k, v]) => [`sim ${k}`, `mean benefit ${v.mean.toFixed(3)} (range ${v.min.toFixed(3)} to ${v.max.toFixed(3)}), ineligible selections ${v.ineligible}`])),
      ...Object.fromEntries(arms.map((a) => [a.variantId, `benefit ${fmt(a.extras['benefit.meanPerInvestigation'])}; wrong recipient ${fmt(a.scored.metrics['question.wrongRecipientRate'])}; questions/investigation ${fmt(a.scored.metrics['question.questionsPerInvestigation'])}; violations ${a.scored.counts['question.hardRuleViolations']}; missed consequential gaps ${a.scored.counts['question.missedConsequentialGaps']}`])),
      training: trained.map((t) => `seed ${t.seed}: ${t.order.join(' > ')}; ${t.updates} updates, ${t.skipped} unanswered skipped`).join(' | '),
    },
  };
  writeExtra(id, 'problems.json', table);
  writeExtra(id, 'decision.json', decision);
  writeExtra(id, 'simulator-rows.json', sim.rows);
  writeResults({
    manifestId: id, finishedAt: new Date().toISOString(), variants,
    notes: [
      decision.outcome,
      'The simulator benefit depends on the visible features by construction (firsthand knowledge, decisive gaps): the LinUCB advantage there shows only that the contextual model can learn them (policies/README.md).',
      'LinUCB is deterministic: the 3 family-arm seeds only change the order of the training families. Variation across seeds is therefore small by design and is not a stochastic confidence interval.',
      `Training data is tiny (${trained.map((t) => `${t.updates}`).join('/')} labelled questions per seed); unanswered questions are skipped, never scored 0.`,
      ...(untestable ? ['Family arm asked 0 questions on validation for every selector (0/6 investigations): the frozen family-arm criterion could not be evaluated. The plan words E03 as "on the simulator"; that arm passes the >= 0.05 on all 3 seeds bar with 0 ineligible selections, but it is simulated and favours learnable visible features by construction.'] : []),
      'Rules benefit is bounded by the baseline pipeline: most recommendations stay "none" with the default extraction, so few questions can change a recommendation toward the expected class (see E00 notes).',
    ],
  });
  console.log(`${id}: ${decision.outcome} -> ${decision.shipped}`);
  return decision;
}

// ------------------------------------------------------------------------------------------------ E05

const POOLED = ['train', 'validation'] as const;

export async function runE05(): Promise<Decision> {
  const id = 'e05-pool-size';
  const retriever = shippedRetriever();
  const sizes = [1, 2, 4];
  const manifest = baseManifest({
    id,
    hypothesis: 'Template generation with a validated small pool (<= 2 candidates) finds the consequential gap as often as a larger pool with less burden.',
    splits: [...POOLED],
    variants: sizes.map((n) => ({ id: `pool-${n}`, description: `template generator emits at most ${n} candidate question(s) per request`, route: 'rules' as const })),
    config: { pooled: 'train+validation (nothing is fitted in this experiment, so train families are not a leak); same gaps, retriever and assessor for every size', retriever, selector: 'rules', primary: 'question.gapFoundRate' },
    seeds: [0],
    metrics: ['question.gapFoundRate', 'question.questionsPerInvestigation', 'burden.duplicateQuestions', 'question.wrongRecipientRate', 'question.unnecessaryQuestionRate'],
    acceptanceCriteria: ['smallest pool whose consequential-gap-found rate is within 0.02 of the best -> ship (EXPERIMENT_PLAN.md E05)'],
    stopRule: 'deterministic; none',
  });
  writeManifest(manifest);
  const runs: VariantRun[] = [];
  const base = defaultInvestigationSettings();
  for (const n of sizes) runs.push(await runVariantPooled(`pool-${n}@train+validation`, [...POOLED], { retriever, settings: { questions: { ...base.questions, maxCandidates: n } } }, 'train+validation'));
  const found = runs.map((r) => num(r.scored.metrics['question.gapFoundRate']));
  const best = Math.max(...found);
  const idx = found.findIndex((f) => f >= best - 0.02);
  const shipped = sizes[idx] as number;
  const decision: Decision = {
    experiment: 'E05',
    hypothesis: 'A validated small pool (<= 2) finds the consequential gap as often as a larger pool with less burden.',
    criterion: 'Smallest pool whose gap-found rate is within 0.02 of the best pool -> ship.',
    outcome: `gap-found rate by pool size ${sizes.map((n, i) => `${n}: ${fmt(runs[i]?.scored.metrics['question.gapFoundRate'])}`).join('; ')}; best ${best.toFixed(3)} -> smallest within 0.02 is pool ${shipped}.`,
    shipped: `pool size ${shipped}`,
    detail: Object.fromEntries(runs.map((r, i) => [`pool-${sizes[i]}`, `gapFound ${fmt(r.scored.metrics['question.gapFoundRate'])}; questions/investigation ${fmt(r.scored.metrics['question.questionsPerInvestigation'])}; duplicates ${r.result.counts['burden.duplicateQuestions']}; wrongRecipient ${fmt(r.scored.metrics['question.wrongRecipientRate'])}; unnecessary ${fmt(r.scored.metrics['question.unnecessaryQuestionRate'])}`])),
  };
  writeExtra(id, 'problems.json', runs.flatMap((r) => problemTable(r)));
  writeExtra(id, 'decision.json', decision);
  writeResults({ manifestId: id, finishedAt: new Date().toISOString(), variants: runs.map((r) => r.result), notes: [decision.outcome, 'Variants are pooled over train+validation families; the split label on each variant is nominal.'] });
  console.log(`${id}: ${decision.outcome}`);
  return decision;
}

// ------------------------------------------------------------------------------------------------ E06

export async function runE06(): Promise<Decision> {
  const id = 'e06-eligibility';
  const retriever = shippedRetriever();
  const manifest = baseManifest({
    id,
    hypothesis: 'Question-dependent broader eligibility (observers of current conditions by directory group) answers more gaps than direct-contributors-only without more wrong recipients.',
    splits: [...POOLED],
    variants: [
      { id: 'baseline-default', description: 'library default: firsthand case/entity links, empty observability policy (reference, not part of the rule)', route: 'rules' },
      { id: 'direct-only', description: 'empty observability policy; recipients restricted to people with a firsthand link to the question\'s own case', route: 'rules' },
      { id: 'question-dependent', description: 'configured observability policy by directory group (experiments/config.ts) on top of firsthand links', route: 'rules' },
    ],
    config: { pooled: 'train+validation (rules only, nothing fitted)', retriever, observabilityPolicy: QUESTION_DEPENDENT_OBSERVABILITY, policyNote: 'written from group names visible in people.json before running; never tuned', directOnly: 'wrapper generator filters candidate recipients to personLink.caseId === gap case, firsthand' },
    seeds: [0],
    metrics: ['routing.answerableRoutingRate', 'question.wrongRecipientRate', 'question.gapFoundRate', 'question.questionsPerInvestigation', 'burden.maxQuestionsToOnePersonPerFamily'],
    acceptanceCriteria: ['question-dependent ships if its wrong-recipient rate does not rise by more than 0.02 over direct-only (a null rate, no questions, is read as 0) (EXPERIMENT_PLAN.md E06)'],
    stopRule: 'deterministic; none',
  });
  writeManifest(manifest);
  const arms: Array<[string, Parameters<typeof runVariantPooled>[2]]> = [
    ['baseline-default', { retriever }],
    ['direct-only', { retriever, directOnly: true, settings: { observability: DIRECT_ONLY_OBSERVABILITY } }],
    ['question-dependent', { retriever, settings: { observability: QUESTION_DEPENDENT_OBSERVABILITY } }],
  ];
  const runs: VariantRun[] = [];
  for (const [vid, opts] of arms) runs.push(await runVariantPooled(`${vid}@train+validation`, [...POOLED], opts, 'train+validation'));
  const d = runs[1] as VariantRun;
  const q = runs[2] as VariantRun;
  const wd = num(d.scored.metrics['question.wrongRecipientRate']);
  const wq = num(q.scored.metrics['question.wrongRecipientRate']);
  const ship = wq - wd <= 0.02;
  const decision: Decision = {
    experiment: 'E06',
    hypothesis: 'Question-dependent eligibility answers more gaps than direct-only without more wrong recipients.',
    criterion: 'Question-dependent ships if wrong-recipient rate does not rise by more than 0.02 over direct-only. Answerable-routing rate is reported next to it.',
    outcome: `wrong-recipient rate direct-only ${fmt(d.scored.metrics['question.wrongRecipientRate'])} vs question-dependent ${fmt(q.scored.metrics['question.wrongRecipientRate'])} (rise ${(wq - wd).toFixed(3)}) -> ${ship ? 'ships' : 'does not ship'}; answerable-routing rate direct-only ${fmt(d.extras['routing.answerableRoutingRate'])} vs question-dependent ${fmt(q.extras['routing.answerableRoutingRate'])}.`,
    shipped: ship ? 'question-dependent (observability policy configured)' : 'direct-only',
    detail: Object.fromEntries(runs.map((r) => [r.variantId, `routing ${fmt(r.extras['routing.answerableRoutingRate'])}; wrongRecipient ${fmt(r.scored.metrics['question.wrongRecipientRate'])}; gapFound ${fmt(r.scored.metrics['question.gapFoundRate'])}; questions/investigation ${fmt(r.scored.metrics['question.questionsPerInvestigation'])}; max questions to one person ${r.result.counts['burden.maxQuestionsToOnePersonPerFamily']}; unanswered ${r.result.counts['burden.unansweredQuestions']}`])),
  };
  writeExtra(id, 'problems.json', runs.flatMap((r) => problemTable(r)));
  writeExtra(id, 'decision.json', decision);
  writeResults({ manifestId: id, finishedAt: new Date().toISOString(), variants: runs.map((r) => r.result), notes: [decision.outcome, 'The observability policy is an organization-configuration guess made from group names; a different policy would give different numbers.', 'Variants pooled over train+validation; the split label is nominal.'] });
  console.log(`${id}: ${decision.outcome}`);
  return decision;
}

// ------------------------------------------------------------------------------------------------ E07

interface BudgetSimRow { limit: number; cooldown: number; seed: number; meanBenefit: number; questionsPerInvestigation: number; maxPerPersonPerDay: number; budgetDeferrals: number; unanswered: number }

/** Budget layer over the selection simulator: investigations arrive every `spacing` minutes; hard budgets are applied before the selector. */
export function budgetSim(limit: number, cooldown: number, seed: number, steps = 300, spacingMin = 10): BudgetSimRow {
  const sim = new SelectionSimulator(defaultSimConfig(seed));
  const selector = new RulesSelector();
  const asked = new Map<string, number[]>();
  let total = 0, questions = 0, budgetDeferrals = 0, unanswered = 0;
  const perDay = new Map<string, number>();
  for (let step = 0; step < steps; step++) {
    const t = step * spacingMin;
    const s = sim.situation(step);
    const ok = (a: EligibleAction): boolean => {
      const hist = asked.get(a.personEntityId) ?? [];
      const today = hist.filter((x) => Math.floor(x / 1440) === Math.floor(t / 1440)).length;
      const last = hist.at(-1);
      return today < limit && (last === undefined || t - last >= cooldown);
    };
    const eligible = s.eligible.filter(ok);
    if (eligible.length === 0 && s.eligible.length > 0) budgetDeferrals++;
    const d = selector.select({ ...sim.context(s), eligible });
    if (d.chosen === 'defer') continue;
    questions++;
    asked.set(d.chosen.personEntityId, [...(asked.get(d.chosen.personEntityId) ?? []), t]);
    const dk = `${d.chosen.personEntityId}|${Math.floor(t / 1440)}`;
    perDay.set(dk, (perDay.get(dk) ?? 0) + 1);
    const r = sim.reveal(s, d.chosen);
    if (r.benefit === null) unanswered++;
    else total += r.benefit;
  }
  return { limit, cooldown, seed, meanBenefit: total / steps, questionsPerInvestigation: questions / steps, maxPerPersonPerDay: Math.max(0, ...perDay.values()), budgetDeferrals, unanswered };
}

export interface FrontierPoint { arm: string; limit: number; cooldown: number; benefit: number; questionsPerInvestigation: number; maxPerPerson: number; dominated: boolean }

const dominates = (a: FrontierPoint, b: FrontierPoint): boolean =>
  a.benefit >= b.benefit && a.questionsPerInvestigation <= b.questionsPerInvestigation && a.maxPerPerson <= b.maxPerPerson &&
  (a.benefit > b.benefit || a.questionsPerInvestigation < b.questionsPerInvestigation || a.maxPerPerson < b.maxPerPerson);

export async function runE07(): Promise<Decision> {
  const id = 'e07-budgets';
  const retriever = shippedRetriever();
  const limits = [1, 3, 5];
  const cooldowns = [0, 30];
  const manifest = baseManifest({
    id,
    hypothesis: 'Budgets and cooldowns reduce duplicate/obsolete questions and burden with bounded loss of benefit.',
    splits: ['train'],
    variants: limits.flatMap((l) => cooldowns.map((c) => ({ id: `d${l}-c${c}`, description: `daily limit ${l} per person, cooldown ${c} min`, route: 'rules' as const }))),
    config: {
      familyArm: { split: 'train', problemSpacingMinutes: 20, answerDelayMinutes: 5, note: 'problems of a family arrive 20 minutes apart on one day so budgets bind across investigations', retriever, selector: 'rules' },
      simulatorArm: { steps: 300, seeds: SEEDS, spacingMinutes: 10, source: 'SelectionSimulator with an experiments-side budget layer applied before the selector; selector rules', provenance: 'simulated' },
      defaults: { dailyLimitPerPerson: 3, cooldownMinutes: 30 },
    },
    seeds: SEEDS,
    metrics: ['benefit.meanPerInvestigation', 'question.questionsPerInvestigation', 'burden.maxQuestionsToOnePersonPerFamily', 'burden.duplicateQuestions', 'burden.cancelledDuplicate', 'burden.cancelledObsoleteOrResolved', 'sim.meanBenefitPerInvestigation'],
    acceptanceCriteria: ['report the frontier; keep defaults (3 / 30) unless a setting dominates (>= benefit, <= questions per investigation, <= max questions to one person, strictly better on one). DEVIATION from the plan: the plan states the rule on the simulator only; this run required domination on BOTH the family arm and the simulator arm (stricter). The plan-literal simulator-only result is reported alongside.'],
    stopRule: 'deterministic family arm; simulator over 3 seeds; none',
  });
  writeManifest(manifest);
  const variants: VariantResult[] = [];
  const famPoints: FrontierPoint[] = [];
  const simPoints: FrontierPoint[] = [];
  const table: Array<Record<string, unknown>> = [];
  for (const l of limits) {
    for (const c of cooldowns) {
      const vr = await runVariant(`family-d${l}-c${c}`, 'train', { retriever, coordinator: { dailyLimitPerPerson: l, cooldownMinutes: c }, problemSpacingMinutes: 20 });
      variants.push(vr.result);
      table.push(...problemTable(vr));
      famPoints.push({ arm: 'family', limit: l, cooldown: c, benefit: num(vr.extras['benefit.meanPerInvestigation']), questionsPerInvestigation: num(vr.scored.metrics['question.questionsPerInvestigation']), maxPerPerson: vr.result.counts['burden.maxQuestionsToOnePersonPerFamily'] ?? 0, dominated: false });
      const rows = SEEDS.map((seed) => budgetSim(l, c, seed));
      const sv = emptyVariant(`sim-d${l}-c${c}`, 'train', 'simulated');
      sv.metrics['sim.meanBenefitPerInvestigation'] = ratio(Math.round(mean(rows.map((r) => r.meanBenefit)) * 300 * 3 * 1000) / 1000, 900);
      sv.metrics['sim.questionsPerInvestigation'] = ratio(Math.round(mean(rows.map((r) => r.questionsPerInvestigation)) * 300 * 3 * 1000) / 1000, 900);
      sv.counts = { 'sim.maxQuestionsToOnePersonPerDay': Math.max(...rows.map((r) => r.maxPerPersonPerDay)), 'sim.investigationsDeferredByBudget': rows.reduce((n, r) => n + r.budgetDeferrals, 0), 'sim.unansweredQuestions': rows.reduce((n, r) => n + r.unanswered, 0) };
      sv.repeatVariation = { 'sim.meanBenefitPerInvestigation': { ...range(rows.map((r) => r.meanBenefit)), runs: 3 } };
      variants.push(sv);
      simPoints.push({ arm: 'simulator', limit: l, cooldown: c, benefit: mean(rows.map((r) => r.meanBenefit)), questionsPerInvestigation: mean(rows.map((r) => r.questionsPerInvestigation)), maxPerPerson: Math.max(...rows.map((r) => r.maxPerPersonPerDay)), dominated: false });
    }
  }
  for (const pts of [famPoints, simPoints]) for (const p of pts) p.dominated = pts.some((o) => o !== p && dominates(o, p));
  const defOf = (pts: FrontierPoint[]) => pts.find((p) => p.limit === 3 && p.cooldown === 30) as FrontierPoint;
  const dominatingBoth = limits.flatMap((l) => cooldowns.map((c) => [l, c] as const)).filter(([l, c]) => !(l === 3 && c === 30)).filter(([l, c]) => {
    const f = famPoints.find((p) => p.limit === l && p.cooldown === c) as FrontierPoint;
    const s = simPoints.find((p) => p.limit === l && p.cooldown === c) as FrontierPoint;
    return dominates(f, defOf(famPoints)) && dominates(s, defOf(simPoints));
  });
  const settings = limits.flatMap((l) => cooldowns.map((c) => [l, c] as const)).filter(([l, c]) => !(l === 3 && c === 30));
  const domOn = (pts: FrontierPoint[]) => settings.filter(([l, c]) => dominates(pts.find((p) => p.limit === l && p.cooldown === c) as FrontierPoint, defOf(pts))).map(([l, c]) => `${l}/${c}`);
  const domSim = domOn(simPoints);
  const domFam = domOn(famPoints);
  const fmtP = (p: FrontierPoint) => `d${p.limit}/c${p.cooldown}: benefit ${p.benefit.toFixed(3)}, q/inv ${p.questionsPerInvestigation.toFixed(3)}, max/person ${p.maxPerPerson}${p.dominated ? ' (dominated)' : ' (frontier)'}`;
  const decision: Decision = {
    experiment: 'E07',
    hypothesis: 'Budgets and cooldowns reduce burden with bounded loss of benefit.',
    criterion: 'Plan (literal, simulator arm): report the frontier; keep the defaults (3 per day / 30 min) unless a setting dominates them. This run additionally required domination on the family arm too (a deviation: stricter than the plan).',
    outcome: (dominatingBoth.length ? `Setting(s) dominating the default on both arms: ${dominatingBoth.map(([l, c]) => `d${l}/c${c}`).join(', ')}.` : 'No setting dominates the default 3/30 on both arms; defaults kept.') + ` Plan-literal (simulator arm only): ${domSim.length ? 'dominating ' + domSim.join(', ') : 'no setting dominates 3/30'}. Family arm only: ${domFam.length ? 'dominating ' + domFam.join(', ') + ' (equal benefit, fewer questions; train families only)' : 'no setting dominates 3/30'}. ${domSim.length ? 'Shipped choice would change under the plan-literal rule.' : 'The shipped choice is the same under the plan-literal rule.'}`,
    shipped: (dominatingBoth.length || domSim.length) ? `defaults would change to ${(domSim.length ? domSim : dominatingBoth.map(([l, c]) => `${l}/${c}`)).join(' or ')} (not applied tonight: U08 stays open)` : 'defaults 3 per day / 30 min cooldown',
    detail: { ...Object.fromEntries(famPoints.map((p) => [`family ${p.limit}/${p.cooldown}`, fmtP(p)])), ...Object.fromEntries(simPoints.map((p) => [`simulator ${p.limit}/${p.cooldown}`, fmtP(p)])) },
  };
  writeExtra(id, 'problems.json', table);
  writeExtra(id, 'frontier.json', { family: famPoints, simulator: simPoints });
  writeExtra(id, 'decision.json', decision);
  writeResults({
    manifestId: id, finishedAt: new Date().toISOString(), variants,
    notes: [
      decision.outcome,
      'Not computed: time-to-supported-decision (the harness has no model of waiting for a human reply) and missed opportunities in the simulator (a deferred investigation has no counterfactual benefit).',
      'Duplicate/obsolete counts come from persisted question records (cancelled:duplicate, cancelled:obsolete|gap-resolved) per investigation.',
      'The simulator budget layer is an experiments-side extension (the simulator itself has fixed ineligibility); it is labelled simulated.',
    ],
  });
  console.log(`${id}: ${decision.outcome}`);
  return decision;
}

// ------------------------------------------------------------------------------------------------ usefulness classifier

interface Prf { tp: number; fp: number; fn: number; tn: number; accuracy: number; precision: number | null; recall: number | null; f1: number | null; majority: number; n: number; positives: number }

function evalClassifier(model: LogisticHashed, data: LabeledText[]): Prf {
  let tp = 0, fp = 0, fn = 0, tn = 0, correct = 0, pos = 0;
  for (const d of data) {
    const p = model.predict(d.text);
    if (p === d.label) correct++;
    if (d.label === 1) pos++;
    if (p === 1 && d.label === 1) tp++;
    else if (p === 1 && d.label === 0) fp++;
    else if (p === 0 && d.label === 1) fn++;
    else tn++;
  }
  const precision = tp + fp ? tp / (tp + fp) : null;
  const recall = tp + fn ? tp / (tp + fn) : null;
  const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : null;
  return { tp, fp, fn, tn, accuracy: data.length ? correct / data.length : 0, precision, recall, f1, majority: data.length ? Math.max(pos, data.length - pos) / data.length : 0, n: data.length, positives: pos };
}

/** Evidence labelled useful (1) / irrelevant (0) by whether its source belongs to ANY truth incident. Harness side only. */
export function usefulnessData(split: 'demo' | 'train' | 'validation' | 'test'): LabeledText[] {
  const out: LabeledText[] = [];
  for (const f of familiesOf(split)) {
    const { truth } = loadHidden(f.id);
    const incidentOf = incidentOfSources(truth.incidents);
    const { store } = prepareFamily(f.id);
    for (const e of store.list('evidence')) out.push({ text: e.text, label: incidentOf.has(normalizeSourceId(benchmarkSourceId(e.provider, e.sourceId))) ? 1 : 0 });
    store.close();
  }
  return out;
}

export async function runUsefulness(): Promise<void> {
  const id = 'usefulness-logistic-v1';
  const manifest = baseManifest({
    id,
    hypothesis: 'A hashed-feature logistic regression trained on the train families\' evidence separates evidence belonging to an incident from irrelevant chatter better than the majority-class rate on validation families.',
    splits: ['train', 'validation'],
    variants: [{ id: 'logistic-hashed-v1', description: 'LogisticHashed dim 4096, unigram+bigram hashed features, SGD epochs 30, lr 0.5, l2 1e-4; trained tonight on synthetic data on this Mac', route: 'local' }],
    route: 'local',
    config: { labels: 'useful = the evidence source id belongs to any truth incident (labelled harness side from truth.json); irrelevant otherwise', dim: 4096, epochs: 30, seeds: SEEDS, artifact: 'data/models/usefulness-logistic-v1.json' },
    seeds: SEEDS,
    metrics: ['usefulness.accuracy', 'usefulness.precision', 'usefulness.recall', 'usefulness.majorityBaselineAccuracy'],
    acceptanceCriteria: [],
    stopRule: 'single training pass per seed',
  });
  writeManifest(manifest);
  const train = usefulnessData('train');
  const sets = { validation: usefulnessData('validation'), demo: usefulnessData('demo'), train };
  const trainFamilies = familiesOf('train').map((f) => f.id);
  const models = SEEDS.map((seed) => { const m = new LogisticHashed(4096); m.train(train, { seed, epochs: 30 }); return { seed, m }; });
  const variants: VariantResult[] = [];
  const notes: string[] = [];
  const val = models.map(({ m }) => evalClassifier(m, sets.validation));
  for (const [split, data] of Object.entries(sets) as Array<['validation' | 'demo' | 'train', LabeledText[]]>) {
    const per = models.map(({ m }) => evalClassifier(m, data));
    const v = emptyVariant('logistic-hashed-v1', split, 'measured');
    v.metrics['usefulness.accuracy'] = ratio(Math.round(mean(per.map((p) => p.accuracy)) * data.length), data.length);
    v.metrics['usefulness.majorityBaselineAccuracy'] = ratio(Math.round(per[0]!.majority * data.length), data.length);
    // pooled over the seeds: true positives over predicted-useful, and over actual positives (real counts, no scaled denominators)
    const tp = per.reduce((n, p) => n + p.tp, 0);
    v.metrics['usefulness.precision'] = ratio(tp, tp + per.reduce((n, p) => n + p.fp, 0));
    v.metrics['usefulness.recall'] = ratio(tp, tp + per.reduce((n, p) => n + p.fn, 0));
    v.counts = { 'usefulness.examples': data.length, 'usefulness.positives': per[0]!.positives, 'usefulness.seeds': SEEDS.length };
    v.repeatVariation = { 'usefulness.accuracy': { ...range(per.map((p) => p.accuracy)), runs: SEEDS.length } };
    variants.push(v);
    const c0 = per[0]!;
    const beat = Math.round((c0.accuracy - c0.majority) * data.length);
    notes.push(`${split}: confusion (seed 1) TP ${c0.tp} FP ${c0.fp} FN ${c0.fn} TN ${c0.tn}; predicted useful ${c0.tp + c0.fp}/${data.length}; beats the majority class by ${beat} example(s) of ${data.length}. n=${data.length}, positives ${per[0]!.positives}, accuracy ${per.map((p) => p.accuracy.toFixed(3)).join('/')} (seeds 1/2/3), majority ${per[0]!.majority.toFixed(3)}, precision ${per.map((p) => p.precision?.toFixed(3) ?? 'n/a').join('/')}, recall ${per.map((p) => p.recall?.toFixed(3) ?? 'n/a').join('/')}`);
  }
  const best = models[0]!; // seed 1 is the saved artifact
  const art = best.m.toArtifact({ id, version: '1', dataset: { id: `scenarios-${manifest.datasetVersion}`, split: 'train', families: trainFamilies }, seeds: [best.seed], metrics: { validationAccuracy: val[0]!.accuracy, validationMajorityBaseline: val[0]!.majority, validationExamples: val[0]!.n, trainExamples: train.length } });
  saveArtifact(art);
  notes.push('Caution: the validation accuracy edge over the majority class is about one example, and the model labels almost everything useful; train accuracy is far higher than validation (overfit on 66 examples). This classifier does not demonstrably separate the classes.');
  notes.push('Local learned model trained tonight on synthetic data (train families only), on this Mac, pure TypeScript. It is saved as data/models/usefulness-logistic-v1.json and is NOT wired into the application.');
  notes.push('Labels come from hidden truth (harness side): evidence that belongs to an incident is useful, small talk and unrelated messages are irrelevant. All ten families were written by one author, so shared phrasing may flatter validation accuracy.');
  writeResults({ manifestId: id, finishedAt: new Date().toISOString(), variants, notes });
  console.log(`${id}: ${notes[0]}`);
}
