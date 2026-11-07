import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Engine } from '../src/apps/service/engine.ts';
import { defaultObservabilityPolicy } from '../src/apps/service/org-config.ts';

/** B1 review: on a clean clone (no private/ Elisa files) the firmware 4.2 story still bounds advice (D-B1-34). */
test('without Elisa\'s files the demo reset imports the synthetic firmware note: the 4.2 problem carries the 14 Oct caveat', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kt-fu-syn-'));
  try {
    const e = new Engine({ dbPath: join(dir, 'kt.sqlite'), elisaDir: join(dir, 'no-elisa-here'), investigation: { observability: defaultObservabilityPolicy } });
    e.setClock({ now: '2026-11-07T10:00:00.000Z' });
    for (const seed of [undefined, 'synthetic'] as const) {
      await e.resetDemo(seed);
      const ilmari = e.directory().find((p) => p.name === 'Ilmari Karjalainen')!;
      const principal = { id: ilmari.personEntityId, displayName: ilmari.name, groups: ilmari.groups, type: 'human' as const };
      const after: any = await e.investigate({ text: 'TRN-077 older unit on firmware 4.2: changed the module, link up, counters zero, no traffic.', principal });
      // Default seed on a clean clone also imports the older-units stand-in (D-B6-27): TRN-233 is then the closest case and
      // Pekka Laine's 14 Oct note bounds it; seed 'synthetic' keeps Helmi's TRN-117 note as before (D-B1-34).
      const who = seed === undefined ? 'Pekka Laine' : 'Helmi Virtanen';
      assert.ok(after.state.recommendation.caveats.includes(`Superseded on 14 Oct by ${who}: fixed in firmware 4.2`), `caveat at ${seed}`);
      assert.match(after.state.recommendation.nextStep ?? '', new RegExp(`ask ${who}`));
      const before: any = await e.investigate({ text: 'TRN-077 older unit on firmware 4.2: changed the module, link up, counters zero, no traffic.', principal, at: '2026-10-13T12:00:00+03:00' });
      assert.ok(!before.state.recommendation.caveats.some((c: string) => c.startsWith('Superseded')), 'before 14 Oct nothing is superseded');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
