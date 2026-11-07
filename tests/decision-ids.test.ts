/** Every decision id in the day-2 decision logs is unique, so a citation in code, tests or the judge package lands on one entry. */
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

const DIR = join(import.meta.dirname, '..', 'docs', 'runs', '2026-11-07-overnight', 'day2');

test('decision ids in day2/DECISIONS-*.md are unique', () => {
  const seen = new Map<string, string>();
  const dupes: string[] = [];
  for (const f of readdirSync(DIR).filter((x) => /^DECISIONS-.*\.md$/.test(x))) {
    for (const m of readFileSync(join(DIR, f), 'utf8').matchAll(/^##\s+(D-[A-Z0-9]+-\d+)\b/gm)) {
      const id = m[1]!;
      if (seen.has(id)) dupes.push(`${id} in ${seen.get(id)} and ${f}`);
      else seen.set(id, f);
    }
  }
  assert.ok(seen.size > 100, `found ${seen.size} decision ids`);
  assert.deepEqual(dupes, []);
});
