/**
 * B6 final (D-B6-27): a clean clone has no private/ Elisa files. The default demo reset then imports the generated
 * older-units stand-in (data/demo/older-units-synthetic), so the judge's agent path (scripts/mcp-demo.ts, the 03:00
 * sequence) still finds a gap that decides applicability, Erkki can be preferred for it, and the demo chips resolve.
 * No model, no network; the Elisa directory is pointed at a path that does not exist.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Engine } from '../src/apps/service/engine.ts';
import { defaultObservabilityPolicy, defaultQuietHours } from '../src/apps/service/org-config.ts';
import { demoChips } from '../src/libs/utils/ui/demo-chips.ts';

const TEXT = 'TRN-301: changed the SFP, link up, alarms cleared, no traffic. Not sure which unit generation this is.';
const AGENT = { id: 'agent:claude-code', displayName: 'Claude Code (judge)', groups: ['noc'], type: 'agent' as const };

test('clean clone, default seed: the agent path finds the older-unit gap, asks Erkki at 03:00 (held to 07:00) and his Yes makes the reset applicable', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kt-clean-agent-'));
  let now = '2026-11-08T01:00:00.000Z';
  const e = new Engine({ dbPath: join(dir, 'kt.sqlite'), elisaDir: join(dir, 'no-elisa-here'), clock: () => new Date(now), investigation: { observability: defaultObservabilityPolicy }, coordinator: { quietHours: defaultQuietHours } });
  try {
    await e.resetDemo(undefined);
    assert.ok(e.store.list('case').some((c) => c.title.startsWith('TRN-233')), 'the stand-in case is seeded');
    const chips = demoChips(e.directory());
    assert.deepEqual(chips.map((c) => c.label), ['Be Ville', 'Be Erkki'], 'chips on a clean clone');

    const inv = await e.investigate({ text: TEXT, principal: AGENT, allowQuestions: false }); // as kt_investigate
    const g = await e.listGaps(AGENT, inv.state.id);
    const gap = g.gaps.find((x) => x.decidesApplicability && x.askable);
    assert.ok(gap, 'a gap that decides applicability');
    assert.match(gap.description, /older unit/);
    const erkki = gap.whoCouldAnswer.find((p) => p.name === 'Erkki Expert');
    assert.ok(erkki && erkki.askableNow, 'Erkki is listed as able to answer the gap');

    const c = await e.requestClarification(AGENT, inv.state.id, { gapId: gap.id, preferPersonEntityId: erkki.personEntityId });
    assert.equal(c.status, 'question-open');
    const q = e.store.list('question').find((x) => x.personEntityId === erkki.personEntityId)!;
    assert.equal(q.status, 'queued', 'nobody is woken at 03:00');

    now = '2026-11-08T05:31:00.000Z';
    const d = e.directory().find((x) => x.personEntityId === erkki.personEntityId)!;
    await e.answer(q.id, { principal: { id: d.personEntityId, displayName: d.name, groups: d.groups, type: 'human' }, value: 'yes' });
    const after = await e.listGaps(AGENT, inv.state.id);
    assert.equal(after.confidence?.applicability.label, 'applicable');
    assert.match(after.recommendation.text, /disabling and re-enabling the interface/);
  } finally {
    e.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
