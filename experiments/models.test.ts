/**
 * E08/E09/E10 runners: recorded model outputs replay offline and refuse a changed input; the E09 arms run on a family
 * with a fake model (no Ollama); the E10 simulated day runs in-process against the real service; the E08 paraphrase
 * probe ranks the demo store with a deterministic fake embedder. Run with: node --test experiments/
 */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { ReplayMismatchError } from '../src/libs/utils/models/replay.ts';
import { ProviderError } from '../src/libs/utils/models/providers/index.ts';
import { installNetworkGuard } from '../src/libs/utils/models/routes.ts';
import { fixtureDir, RecordedEmbedder, RecordedGenerator } from './replay-models.ts';
import { familiesOf } from './common.ts';
import { DEFAULT_EXTRACT_MODEL, E08_VARIANTS, PARAPHRASES, paraphraseProbe, runE09Family, runE10Arm } from './runners-models.ts';

const tmp = () => mkdtempSync(join(tmpdir(), 'kt-e0810-'));

/** Bag-of-words hashed into 64 dims: deterministic, no model. */
const fakeEmbedder = {
  calls: 0,
  async embed(_model: string, texts: string[]): Promise<Float32Array[]> {
    this.calls += texts.length;
    return texts.map((t) => {
      const v = new Float32Array(64);
      for (const w of t.toLowerCase().split(/\W+/).filter(Boolean)) {
        let h = 0;
        for (const ch of w) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        v[h % 64]! += 1;
      }
      return v;
    });
  },
};

test('recorded embeddings replay offline, per text, and refuse a tampered recording', async () => {
  const dir = tmp();
  try {
    const path = join(dir, 'embeddings.json');
    const rec = new RecordedEmbedder(path, { mode: 'record', live: fakeEmbedder, recordedBy: 'test' });
    const live = await rec.embed('m', ['alpha beta', 'gamma']);
    assert.equal(rec.stats.recorded, 2);
    rec.save();
    const restore = installNetworkGuard();
    try {
      const rep = new RecordedEmbedder(path, { mode: 'replay' });
      const again = await rep.embed('m', ['gamma', 'alpha beta']);
      assert.deepEqual([...again[1]!], [...live[0]!]);
      assert.deepEqual([...again[0]!], [...live[1]!]);
      await assert.rejects(rep.embed('m', ['never recorded']), (e: unknown) => e instanceof ProviderError && e.code === 'model-missing');
      await assert.rejects(rep.embed('other-model', ['gamma']), ProviderError);
    } finally {
      restore();
    }
    const fx = JSON.parse(readFileSync(path, 'utf8')) as { entries: Record<string, { inputHash: string }> };
    const k = Object.keys(fx.entries)[0]!;
    fx.entries[k]!.inputHash = 'tampered';
    writeFileSync(path, JSON.stringify(fx));
    const bad = new RecordedEmbedder(path, { mode: 'replay' });
    await assert.rejects(bad.embed('m', ['alpha beta', 'gamma']), ReplayMismatchError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('recorded generations are keyed on model and prompt and hash-checked on the schema too', async () => {
  const dir = tmp();
  try {
    const path = join(dir, 'fam.json');
    const rec = new RecordedGenerator(path, { mode: 'record', live: { generateJson: async () => ({ ok: 1 }) }, recordedBy: 'test' });
    assert.deepEqual(await rec.generateJson('m', 'p', { type: 'object' }), { ok: 1 });
    const rep = new RecordedGenerator(path, { mode: 'replay' });
    assert.deepEqual(await rep.generateJson('m', 'p', { type: 'object' }), { ok: 1 });
    assert.equal(rep.recordedLatencies().length, 1);
    await assert.rejects(rep.generateJson('m', 'p', { type: 'array' }), ReplayMismatchError);
    await assert.rejects(rep.generateJson('m', 'other prompt', { type: 'object' }), ProviderError);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('E09 arms on a family with a fake model: a fabricated excerpt is dropped, a grounded model-only claim is committed in the union with the replay route', async () => {
  const dir = tmp();
  try {
    // The fake cites the first line of the first real message (grounded) and a sentence nobody wrote (fabricated).
    const live = {
      generateJson: async (_m: string, prompt: string) => {
        const real = prompt.slice(prompt.lastIndexOf('Now the real thread.'));
        const m = /\[1\] id=(\S+) author=[^\n]*\n([^\n]+)/.exec(real)!;
        const excerpt = m[2]!.trim().split(/\s+/).slice(0, 6).join(' ');
        return {
          claims: [
            { type: 'observation', statement: `Model-only reading: ${excerpt} (paraphrased)`, subjectEntityNames: [], evidence: [{ evidenceId: m[1], excerpt }] },
            { type: 'advice', statement: 'Replace the PSU', subjectEntityNames: [], evidence: [{ evidenceId: m[1], excerpt: 'nobody ever wrote this sentence' }] },
          ],
          entities: [], links: [], incidents: [], usefulness: [],
        };
      },
    };
    const gen = new RecordedGenerator(join(dir, 'bgp-firmware-flaps.json'), { mode: 'record', live, recordedBy: 'test' });
    const run = await runE09Family('bgp-firmware-flaps', gen, 'fake:1b');
    assert.equal(gen.stats.missing, 0);
    assert.ok(run.dropped.some((d) => d.kind === 'claim' && d.reason === 'excerpt-not-in-evidence'));
    assert.equal(run.counts.direct['e09.validatorDropped'], run.dropped.length);
    assert.ok(run.counts.union['e09.modelOnlyClaimsCommitted']! >= 1);
    assert.ok(run.modelClaims.every((c) => c.statement.startsWith('Model-only reading')));
    // The union never removes what the rules committed.
    assert.ok(run.counts.union['e09.claims']! >= run.counts.rules['e09.claims']!);
    assert.ok(run.reports.rules.metrics['claims.all.recall']);
    // Replaying the same prompts offline gives the same arms.
    const restore = installNetworkGuard();
    try {
      const again = await runE09Family('bgp-firmware-flaps', new RecordedGenerator(join(dir, 'bgp-firmware-flaps.json'), { mode: 'replay' }), 'fake:1b');
      assert.deepEqual(again.counts, run.counts);
    } finally {
      restore();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('E10 arm: a simulated day runs in-process against the real service under the network guard and every answer carries a measured reward', async () => {
  const restore = installNetworkGuard();
  try {
    const a = await runE10Arm('linucb', 1, 4);
    assert.equal(a.summary.errors, 0);
    assert.ok(a.before.denominators.cases > 0);
    assert.ok(a.after.denominators.cases >= a.before.denominators.cases);
    assert.equal(a.afterSameCases.denominators.cases, a.before.denominators.cases);
    assert.equal(a.rewards.length, a.deltas.length);
    assert.equal(a.selectorUpdates, a.rewards.length);
  } finally {
    restore();
  }
});

test('E08 paraphrase probe: every retriever ranks the demo store and the target is the TRN-117 stand-in without the Elisa files', async () => {
  const rows = await paraphraseProbe({ embedder: fakeEmbedder, model: 'fake-embed' }, E08_VARIANTS('fake-embed'));
  assert.equal(rows.length, PARAPHRASES.length);
  for (const r of rows) {
    assert.equal(r.target, 'TRN-117');
    assert.deepEqual(Object.keys(r.ranks).sort(), E08_VARIANTS('fake-embed').map((v) => v.id).sort());
  }
  // The two extra paraphrases avoid every lexicon cue: the parser finds no condition in them.
  assert.deepEqual(rows[1]!.parsedConditions, []);
  assert.deepEqual(rows[2]!.parsedConditions, []);
});

test('E09 fixtures: the brief\'s qwen3:4b is the default and a recording exists for every train and validation family, made by that model', () => {
  assert.equal(DEFAULT_EXTRACT_MODEL, 'qwen3:4b');
  const dir = fixtureDir('e09', DEFAULT_EXTRACT_MODEL);
  for (const f of [...familiesOf('train'), ...familiesOf('validation')]) {
    const file = JSON.parse(readFileSync(join(dir, `${f.id}.json`), 'utf8')) as { entries: Record<string, { recordedBy: string }> };
    const entries = Object.values(file.entries);
    assert.ok(entries.length > 0, `${f.id}: empty recording`);
    for (const e of entries) assert.match(e.recordedBy, /qwen3:4b@/, `${f.id}: recorded by ${e.recordedBy}`);
  }
});
