import type { EligibleAction, EvaluationRecord, InvestigationState, QuestionCandidate, Selector, SelectorContext } from '../../contracts/index.ts';
import { createRng } from '../rng.ts';

/**
 * Question-selection simulator.
 *
 * Hidden knowledge (who knows which fact, what they would say, how responsive they are, the true value of each
 * fact) lives ONLY in this file's closure/config. Selectors see `eligible`, `candidates` and visible `features`
 * (the same feature names as policies/features.ts, repeated here as string literals so models/ stays independent
 * of policies/). Benefit is computed independently of the selector:
 *   1  a definite answer that equals the truth AND the gap decides applicability (the recommendation changes correctly)
 *   0  an answer that changes nothing (unknown, non-decisive gap, or a wrong answer)
 *   null  no response at all (unanswered): unknown, never zero
 */
export interface SimPerson {
  id: string;
  /** Visible: this person has a firsthand link relevant to these fact keys. */
  firsthandFor: string[];
  /** HIDDEN: what the person would answer for each fact key they know. */
  knows: Record<string, 'yes' | 'no'>;
  /** HIDDEN: probability of responding at all. */
  responsiveness: number;
}

export interface SimConfig {
  seed: number;
  keys: string[];
  /** HIDDEN truth per key. */
  truth: Record<string, 'yes' | 'no'>;
  people: SimPerson[];
}

export interface SimQuestion {
  key: string;
  consequential: boolean;
  decidesApplicability: boolean;
  supportLevel: number;
}

export interface SimSituation {
  step: number;
  state: InvestigationState;
  candidates: QuestionCandidate[];
  eligible: EligibleAction[];
  /** Hard-ineligible pairs (budget/cooldown); a selector choosing one is a violation. */
  ineligible: EligibleAction[];
  features: Record<string, Record<string, number>>;
  questions: Record<string, SimQuestion>;
  /** Pre-drawn response uniforms so a reveal depends only on (situation, action). */
  draws: Record<string, number>;
}

export interface SimReveal {
  answer: 'yes' | 'no' | 'unknown' | 'none';
  benefit: number | null;
}

const KEYS = ['unit.age', 'unit.model', 'unit.revision', 'software.version', 'unit.installed_year', 'site.access'];
const keyOf = (a: EligibleAction): string => `${a.questionId}|${a.personEntityId}`;

export function defaultSimConfig(seed: number): SimConfig {
  const rng = createRng(seed * 7919 + 13);
  const truth: Record<string, 'yes' | 'no'> = {};
  for (const k of KEYS) truth[k] = rng() < 0.5 ? 'yes' : 'no';
  const people: SimPerson[] = Array.from({ length: 6 }, (_, i) => {
    const firsthandFor = KEYS.filter(() => rng() < 0.33);
    const knows: Record<string, 'yes' | 'no'> = {};
    for (const k of KEYS) {
      const fh = firsthandFor.includes(k);
      if (fh || rng() < 0.1) {
        const correct = rng() < (fh ? 0.92 : 0.7);
        knows[k] = correct ? (truth[k] as 'yes' | 'no') : truth[k] === 'yes' ? 'no' : 'yes';
      }
    }
    return { id: `sim_person_${i}`, firsthandFor, knows, responsiveness: 0.55 + rng() * 0.4 };
  });
  return { seed, keys: KEYS, truth, people };
}

const stubState = (id: string): InvestigationState => ({
  id, orgId: 'org:sim', problem: { id: `p_${id}`, orgId: 'org:sim', text: 'simulated problem', requester: { id: 'person:sim:requester', displayName: 'Requester' }, createdAt: '2026-01-01T00:00:00.000Z' },
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', candidates: [], hypotheses: [], gaps: [],
  recommendation: { kind: 'none', text: '', basis: [], applicability: 'unsupported', caveats: [], actionClass: 'none' },
  people: [], questionIds: [], decisionIds: [], loop: 'deferred', events: [], routes: [],
});

export class SelectionSimulator {
  readonly cfg: SimConfig;
  constructor(cfg: SimConfig) {
    this.cfg = cfg;
  }

  /** Deterministic in (seed, step); independent of any earlier selection. */
  situation(step: number): SimSituation {
    const cfg = this.cfg;
    const rng = createRng(cfg.seed * 100003 + step * 31 + 7);
    const nQ = 2 + Math.floor(rng() * 2);
    const keys = [...cfg.keys].sort(() => rng() - 0.5).slice(0, nQ);
    const questions: Record<string, SimQuestion> = {};
    const candidates: QuestionCandidate[] = [];
    for (const k of keys) {
      const consequential = rng() < 0.75;
      const q: SimQuestion = { key: k, consequential, decidesApplicability: consequential && rng() < 0.8, supportLevel: [1, 0.5, 0.25][Math.floor(rng() * 3)] as number };
      const id = `q_${step}_${k}`;
      questions[id] = q;
      candidates.push({
        id, orgId: 'org:sim', investigationId: `inv_sim_${step}`, gapId: `gap_${k}`, kind: 'quick', text: `Is ${k} true?`, answerType: 'yes-no-unknown',
        scope: { entityIds: [] }, rationale: 'simulated', consequences: { yes: 'applies', no: 'does not apply' }, generatedBy: { route: 'rules', version: 'sim' },
        dedupKey: k, recipientIds: [],
      });
    }
    const eligible: EligibleAction[] = [];
    const ineligible: EligibleAction[] = [];
    const features: Record<string, Record<string, number>> = {};
    const draws: Record<string, number> = {};
    const pairs: Array<{ c: QuestionCandidate; p: SimPerson }> = [];
    const shuffled = [...cfg.people].sort(() => rng() - 0.5);
    for (const c of candidates) for (const p of shuffled.slice(0, 4)) pairs.push({ c, p });
    for (const { c, p } of pairs) {
      const q = questions[c.id] as SimQuestion;
      const open = Math.floor(rng() * 3);
      const asked = Math.floor(rng() * 4);
      const a: EligibleAction = { questionId: c.id, personEntityId: p.id };
      draws[keyOf(a)] = rng();
      features[keyOf(a)] = {
        consequential: q.consequential ? 1 : 0,
        firsthand: p.firsthandFor.includes(q.key) ? 1 : 0,
        recipientOpenQuestions: open,
        recipientAskedToday: asked,
        candidateCount: pairs.length,
        gapDecidesApplicability: q.decidesApplicability ? 1 : 0,
        hypothesisSupportLevel: q.supportLevel,
        recency: 1,
      };
      (asked >= 3 || open >= 2 ? ineligible : eligible).push(a);
    }
    return { step, state: stubState(`inv_sim_${step}`), candidates, eligible, ineligible, features, questions, draws };
  }

  reveal(s: SimSituation, action: EligibleAction): SimReveal {
    const q = s.questions[action.questionId];
    const p = this.cfg.people.find((x) => x.id === action.personEntityId);
    if (!q || !p) throw new Error('unknown action');
    const open = s.features[keyOf(action)]?.recipientOpenQuestions ?? 0;
    const responds = (s.draws[keyOf(action)] as number) < p.responsiveness * (1 - 0.15 * open);
    if (!responds) return { answer: 'none', benefit: null };
    const said = p.knows[q.key];
    if (!said) return { answer: 'unknown', benefit: 0 };
    return { answer: said, benefit: q.decidesApplicability && said === this.cfg.truth[q.key] ? 1 : 0 };
  }

  context(s: SimSituation): SelectorContext {
    return { state: s.state, eligible: s.eligible, candidates: s.candidates, features: s.features };
  }
}

export interface SimResult {
  steps: number;
  /** Mean benefit with unanswered scored 0 by THIS evaluator (policies never learn from that convention). */
  meanBenefit: number;
  answeredMean: number;
  unanswered: number;
  deferrals: number;
  ineligibleSelections: number;
  records: EvaluationRecord[];
}

export function runSimulation(selector: Selector, opts: { seed: number; steps: number; learn?: boolean; config?: SimConfig }): SimResult {
  const sim = new SelectionSimulator(opts.config ?? defaultSimConfig(opts.seed));
  const records: EvaluationRecord[] = [];
  let total = 0, answered = 0, answeredSum = 0, unanswered = 0, deferrals = 0, violations = 0;
  for (let step = 0; step < opts.steps; step++) {
    const s = sim.situation(step);
    const d = selector.select(sim.context(s));
    let rec: EvaluationRecord;
    if (d.chosen === 'defer') {
      deferrals++;
      rec = { decisionId: d.id, investigationId: s.state.id, at: d.at, stateFeatures: {}, eligible: s.eligible, action: 'defer', propensity: d.propensity, assessedBenefit: null, effort: { questionsAsked: 0, interruptions: 0 }, missingFeedback: false };
    } else {
      const chosen = d.chosen;
      if (s.ineligible.some((x) => keyOf(x) === keyOf(chosen)) || !s.eligible.some((x) => keyOf(x) === keyOf(chosen))) violations++;
      const r = sim.reveal(s, chosen);
      if (r.benefit === null) unanswered++;
      else {
        answered++;
        answeredSum += r.benefit;
        total += r.benefit;
      }
      rec = {
        decisionId: d.id, investigationId: s.state.id, at: d.at, stateFeatures: s.features[keyOf(chosen)] ?? {}, eligible: s.eligible, action: chosen, propensity: d.propensity,
        response: { value: r.answer }, assessedBenefit: r.benefit === null ? null : { value: r.benefit, method: 'simulator-hidden-truth' },
        effort: { questionsAsked: 1, interruptions: 1 }, missingFeedback: r.benefit === null,
      };
    }
    records.push(rec);
    if (opts.learn !== false) selector.update?.([rec]);
  }
  return { steps: opts.steps, meanBenefit: total / opts.steps, answeredMean: answered ? answeredSum / answered : 0, unanswered, deferrals, ineligibleSelections: violations, records };
}
