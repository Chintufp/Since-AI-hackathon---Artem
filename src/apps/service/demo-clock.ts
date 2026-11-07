/**
 * Demo clock: the engine's notion of "now". Real time by default; the simulated activity stream (`pnpm demo:play`) may
 * move it to a simulated moment that then advances at `rate` simulated seconds per real second, so daily question
 * limits and cooldowns are counted in simulated hours while the stream runs. Reset returns to real time.
 */
export interface DemoClockStatus {
  mode: 'real' | 'simulated';
  now: string;
  /** Simulated seconds per real second (1 in real mode). */
  rate: number;
  /** When the simulated clock was last set (real time), in simulated mode. */
  setAt?: string;
}

export interface DemoClock {
  now(): Date;
  /** `null` returns to real time. */
  set(input: { now: string; rate?: number } | null): DemoClockStatus;
  status(): DemoClockStatus;
}

export function createDemoClock(real: () => Date = () => new Date()): DemoClock {
  let anchorSim: number | null = null;
  let anchorReal = 0;
  let rate = 1;
  let setAt: string | undefined;
  const now = (): Date => (anchorSim === null ? real() : new Date(anchorSim + (real().getTime() - anchorReal) * rate));
  const status = (): DemoClockStatus => ({ mode: anchorSim === null ? 'real' : 'simulated', now: now().toISOString(), rate, ...(setAt ? { setAt } : {}) });
  return {
    now,
    status,
    set(input) {
      if (input === null) {
        anchorSim = null;
        rate = 1;
        setAt = undefined;
        return status();
      }
      const ms = Date.parse(input.now);
      if (!Number.isFinite(ms)) throw new RangeError(`Invalid clock time ${input.now}`);
      const r = input.rate ?? rate;
      if (!(r > 0) || !Number.isFinite(r)) throw new RangeError(`Invalid clock rate ${String(input.rate)}`);
      anchorSim = ms;
      anchorReal = real().getTime();
      rate = r;
      setAt = real().toISOString();
      return status();
    },
  };
}
