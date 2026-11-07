import type { EvaluationRecord, ModelArtifact, PolicyDecision, Selector, SelectorContext } from '../contracts/index.ts';
import { actionKey, FEATURE_DIM, FEATURE_NAMES, makeDecision, vectorize, type SelectorClock } from './features.ts';

export interface LinUcbOptions extends SelectorClock {
  /** Exploration strength. */
  alpha?: number;
  /** Ridge prior; A starts as lambda * I. */
  lambda?: number;
  /** Optional: defer when the best upper-confidence value is below this (default: never defer when eligible). */
  deferBelow?: number;
}

const matVec = (m: number[][], v: number[]): number[] => m.map((row) => row.reduce((s, x, j) => s + x * (v[j] as number), 0));
const dot = (a: number[], b: number[]): number => a.reduce((s, x, i) => s + x * (b[i] as number), 0);

/**
 * LinUCB with one shared linear model over the visible features of each question-recipient pair.
 * Pure TypeScript, deterministic given its state (propensity 1; exploration is optimistic, not random).
 * update() learns only from records with a known assessedBenefit; null (unknown) is skipped, never treated as 0.
 */
export class LinUcb implements Selector {
  readonly id = 'linucb';
  readonly version = 'linucb@1';
  readonly route = 'local' as const;
  alpha: number;
  lambda: number;
  deferBelow: number;
  /** Inverse of A (maintained with Sherman-Morrison). */
  aInv: number[][];
  b: number[];
  updates = 0;
  skippedUnknown = 0;
  private clock: () => Date;

  constructor(opts: LinUcbOptions = {}) {
    this.alpha = opts.alpha ?? 0.5;
    this.lambda = opts.lambda ?? 1;
    this.deferBelow = opts.deferBelow ?? Number.NEGATIVE_INFINITY;
    this.clock = opts.clock ?? (() => new Date());
    this.aInv = Array.from({ length: FEATURE_DIM }, (_, i) => Array.from({ length: FEATURE_DIM }, (_, j) => (i === j ? 1 / this.lambda : 0)));
    this.b = new Array<number>(FEATURE_DIM).fill(0);
  }

  theta(): number[] {
    return matVec(this.aInv, this.b);
  }

  ucb(x: number[]): { mean: number; bonus: number } {
    const mean = dot(this.theta(), x);
    const bonus = this.alpha * Math.sqrt(Math.max(0, dot(x, matVec(this.aInv, x))));
    return { mean, bonus };
  }

  observe(features: Record<string, number> | undefined, reward: number): void {
    const x = vectorize(features);
    const ax = matVec(this.aInv, x);
    const denom = 1 + dot(x, ax);
    for (let i = 0; i < FEATURE_DIM; i++) {
      for (let j = 0; j < FEATURE_DIM; j++) {
        (this.aInv[i] as number[])[j] = ((this.aInv[i] as number[])[j] as number) - ((ax[i] as number) * (ax[j] as number)) / denom;
      }
      this.b[i] = (this.b[i] as number) + reward * (x[i] as number);
    }
    this.updates++;
  }

  /** stateFeatures of each record are the features of the chosen action at decision time. */
  update(records: EvaluationRecord[]): void {
    for (const r of records) {
      if (r.action === 'defer') continue;
      if (r.assessedBenefit === null) {
        this.skippedUnknown++;
        continue;
      }
      this.observe(r.stateFeatures, r.assessedBenefit.value);
    }
  }

  /** Re-measured benefit of a decision already observed: b moves by the reward difference; A (the exposure) does not. */
  correct(record: EvaluationRecord, previousValue: number): void {
    if (record.action === 'defer' || record.assessedBenefit === null) return;
    const x = vectorize(record.stateFeatures);
    const d = record.assessedBenefit.value - previousValue;
    for (let i = 0; i < FEATURE_DIM; i++) this.b[i] = (this.b[i] as number) + d * (x[i] as number);
  }

  select(ctx: SelectorContext): PolicyDecision {
    const info = { id: this.id, version: this.version, route: this.route };
    const at = this.clock();
    if (ctx.eligible.length === 0) return makeDecision(ctx, info, 'defer', 1, 'defer: no eligible question-recipient pair', at);
    const scored = ctx.eligible
      .map((a) => {
        const key = actionKey(a);
        const u = this.ucb(vectorize(ctx.features[key]));
        return { a, key, v: u.mean + u.bonus, mean: u.mean, bonus: u.bonus };
      })
      .sort((p, q) => q.v - p.v || p.key.localeCompare(q.key));
    const best = scored[0] as (typeof scored)[number];
    if (best.v < this.deferBelow) return makeDecision(ctx, info, 'defer', 1, `defer: best UCB ${best.v.toFixed(3)} below ${this.deferBelow}`, at);
    return makeDecision(ctx, info, best.a, 1, `linucb: mean ${best.mean.toFixed(3)} + ${this.alpha} x uncertainty ${(best.bonus / this.alpha || 0).toFixed(3)} (after ${this.updates} updates)`, at);
  }

  toModelArtifact(meta: { id?: string; trainedAt?: string; dataset?: { id: string; split: string; families: string[] }; seeds?: number[]; metrics?: Record<string, number> } = {}): ModelArtifact {
    return {
      id: meta.id ?? 'linucb',
      kind: 'linucb',
      version: this.version,
      trainedAt: meta.trainedAt ?? this.clock().toISOString(),
      trainingDataset: meta.dataset ?? { id: 'unspecified', split: 'unspecified', families: [] },
      seeds: meta.seeds ?? [],
      parameters: { alpha: this.alpha, lambda: this.lambda, deferBelow: Number.isFinite(this.deferBelow) ? this.deferBelow : null, features: [...FEATURE_NAMES], aInv: this.aInv, b: this.b, updates: this.updates, skippedUnknown: this.skippedUnknown },
      ...(meta.metrics ? { metrics: meta.metrics } : {}),
    };
  }

  toArtifact(): Record<string, unknown> {
    return { ...this.toModelArtifact() };
  }

  static fromArtifact(a: ModelArtifact | Record<string, unknown>, opts: SelectorClock = {}): LinUcb {
    const art = a as unknown as ModelArtifact;
    if (art.kind !== 'linucb') throw new Error(`Not a linucb artifact: ${String(art.kind)}`);
    const p = art.parameters as { alpha: number; lambda: number; deferBelow: number | null; aInv: number[][]; b: number[]; updates: number; skippedUnknown: number; features: string[] };
    if (p.features.join(',') !== FEATURE_NAMES.join(',')) throw new Error('linucb artifact feature list does not match this build');
    const m = new LinUcb({ alpha: p.alpha, lambda: p.lambda, ...(p.deferBelow !== null ? { deferBelow: p.deferBelow } : {}), ...opts });
    m.aInv = p.aInv.map((r) => [...r]);
    m.b = [...p.b];
    m.updates = p.updates;
    m.skippedUnknown = p.skippedUnknown;
    return m;
  }
}
