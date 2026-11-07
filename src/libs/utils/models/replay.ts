import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export interface ReplayEntry<T> {
  /** Hash of the canonical JSON of the input that produced `output` when recorded. */
  inputHash: string;
  output: T;
  /** Hash of the canonical JSON of `output` when recorded: an edited output is a ReplayOutputMismatchError, not a different number. */
  outputHash?: string;
  /** Who/what recorded it, e.g. "claude-agent-arm run 2026-11-07". Never a measured local model. */
  recordedBy?: string;
}

export interface ReplayFixture<T> {
  id: string;
  entries: Record<string, ReplayEntry<T>>;
}

export class ReplayMismatchError extends Error {
  constructor(key: string, expected: string, actual: string) {
    super(`Replay input hash mismatch for "${key}": recorded ${expected}, got ${actual}`);
    this.name = 'ReplayMismatchError';
  }
}

export class ReplayOutputMismatchError extends Error {
  constructor(key: string, detail: string) {
    super(`Replay output for "${key}" ${detail}; re-record it instead of editing the fixture`);
    this.name = 'ReplayOutputMismatchError';
  }
}

function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .filter((k) => o[k] !== undefined)
      .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(v) ?? 'null';
}

/** Stable hash of any JSON-able input (key order independent). */
export const hashInput = (input: unknown): string => createHash('sha256').update(canonical(input)).digest('hex').slice(0, 24);

/** Serves recorded outputs by key; refuses when the live input differs from the recorded one. */
export class ReplayProvider<T> {
  readonly fixtureId: string;
  private entries: Record<string, ReplayEntry<T>>;
  private readonly requireOutputHash: boolean;

  /** `requireOutputHash`: an entry without an output hash is refused too (fixtures recorded since outputs are locked). */
  constructor(fixture: ReplayFixture<T>, opts: { requireOutputHash?: boolean } = {}) {
    this.fixtureId = fixture.id;
    this.entries = fixture.entries;
    this.requireOutputHash = !!opts.requireOutputHash;
  }

  static fromFile<T>(path: string, opts: { requireOutputHash?: boolean } = {}): ReplayProvider<T> {
    return new ReplayProvider<T>(JSON.parse(readFileSync(path, 'utf8')) as ReplayFixture<T>, opts);
  }

  has(key: string): boolean {
    return key in this.entries;
  }

  /** Returns undefined when no recording exists (caller must fall back openly). Throws on hash mismatch. */
  get(key: string, input?: unknown): ReplayEntry<T> | undefined {
    const e = this.entries[key];
    if (!e) return undefined;
    if (input !== undefined) {
      const h = hashInput(input);
      if (h !== e.inputHash) throw new ReplayMismatchError(key, e.inputHash, h);
    }
    if (e.outputHash === undefined) {
      if (this.requireOutputHash) throw new ReplayOutputMismatchError(key, 'has no output hash');
    } else if (hashInput(e.output) !== e.outputHash) {
      throw new ReplayOutputMismatchError(key, `does not match its recorded output hash ${e.outputHash}`);
    }
    return e;
  }

  keys(): string[] {
    return Object.keys(this.entries);
  }
}
