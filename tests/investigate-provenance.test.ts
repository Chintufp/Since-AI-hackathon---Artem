/**
 * R5 (D-INT-21): POST /investigate carries `provenance` whenever the recommendation (or the case it points at) rests on a
 * visible claim, and only then. The Phase 4 checkers sent {text, principal} with a text that names no asset and no
 * entityIds: that finds nothing, so there is nothing to cite. The Context Layer page sends entityIds, which finds the case.
 * Clean clone (no private/ Elisa files), default seed. No model, no network.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Engine } from '../src/apps/service/engine.ts';
import { investigateSchema } from '../src/apps/service/schemas.ts';

test('investigate provenance: present for a text that names the asset and for the context page body (entityIds, preview); absent only when nothing is found', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'kt-prov-'));
  const e = new Engine({ dbPath: join(dir, 'kt.sqlite'), elisaDir: join(dir, 'no-elisa-here') });
  try {
    await e.resetDemo(undefined);
    const trn233 = e.store.list('entity').find((x) => x.name === 'TRN-233')!;
    const principal = e.directory().find((d) => d.name === 'Aarne Koskela')!;
    const who = { id: principal.personEntityId, displayName: principal.name, groups: principal.groups, type: 'human' as const };
    const body = (b: Record<string, unknown>) => investigateSchema.parse({ principal: who, ...b });

    // 1. The minimal hand-built body {text, principal} works when the text names an asset the store knows.
    const named = await e.investigate(body({ text: 'TRN-233: what should I know before working on it?' }));
    assert.ok(named.provenance, 'text naming TRN-233 carries a provenance strip');
    assert.match(named.provenance!.text, / · /);
    assert.equal(named.provenance!.route, 'rules');

    // 2. The exact body the Context Layer page sends (context-page.ts ask()): entityIds, allowQuestions false, preview.
    const generic = 'what should I know before working on it?';
    const page = await e.investigate(body({ text: generic, entityIds: [trn233.id], allowQuestions: false, preview: true }));
    assert.ok(page.provenance, 'the page body finds the case through entityIds');
    assert.equal(page.provenance!.claimId.startsWith('claim_'), true);

    // 3. A text that names nothing and has no entityIds finds nothing: kind none, no case, nothing to cite, no strip.
    const none = await e.investigate(body({ text: generic }));
    assert.equal(none.recommendation.kind, 'none');
    assert.equal(none.provenance, undefined);
    assert.equal(none.caseView, undefined);
  } finally {
    e.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
