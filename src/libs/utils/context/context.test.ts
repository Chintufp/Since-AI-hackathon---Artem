import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseEmailText, parseSlackExport, parseTeamsJson, readSlackExportDir } from '../connectors/index.ts';
import { assembleContexts, extractionText } from './index.ts';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '../../../../data/fixtures/dev-family-01');
const opts = { orgId: 'o' };

test('teams messages form one ordered context; email is its own window', () => {
  const teams = parseTeamsJson(JSON.parse(readFileSync(join(FIX, 'teams.json'), 'utf8')), opts);
  const mail = parseEmailText(readFileSync(join(FIX, 'email.txt'), 'utf8'), opts);
  const ctxs = assembleContexts([...[...teams].reverse(), ...mail]);
  assert.equal(ctxs.length, 2);
  const t = ctxs.find((c) => c.evidence[0]!.provider === 'teams')!;
  assert.deepEqual(t.evidence.map((e) => e.thread.position), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
  const e = ctxs.find((c) => c.evidence[0]!.provider === 'email')!;
  assert.equal(e.evidence.length, 1, 'quoted segment is excluded from extraction');
  assert.equal(e.skippedSegments.length, 1);
});

test('extraction text blanks quoted spans but keeps offsets and the original', () => {
  const [mail] = parseEmailText(readFileSync(join(FIX, 'email.txt'), 'utf8'), opts);
  const x = extractionText(mail!);
  assert.equal(x.length, mail!.text.length);
  assert.ok(mail!.text.includes('keep flapping'));
  assert.ok(!x.includes('keep flapping'));
  assert.ok(x.includes('Short version'));
});

test('slack: thread continues across days; un-threaded messages group by channel and day', () => {
  const ev = parseSlackExport(readSlackExportDir(join(FIX, 'slack-export')), opts);
  const ctxs = assembleContexts(ev);
  const sizes = ctxs.map((c) => c.evidence.length).sort();
  assert.deepEqual(sizes, [1, 3, 3]);
  const thread = ctxs.find((c) => c.evidence.length === 3 && c.evidence[0]!.text.includes('RTR-117'))!;
  assert.deepEqual(thread.evidence.map((e) => e.eventTime.iso!.slice(0, 10)), ['2026-03-10', '2026-03-10', '2026-03-11']);
  assert.ok(ctxs.some((c) => c.key.startsWith('slack:ops-network:2026-03-10')));
});

test('superseded revisions are dropped from the window', () => {
  const ev = parseTeamsJson(JSON.parse(readFileSync(join(FIX, 'teams.json'), 'utf8')), opts);
  ev[0]!.metadata = { supersededBy: 'x' };
  assert.equal(assembleContexts(ev)[0]!.evidence.length, 11);
});
