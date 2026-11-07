import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { activityPage, SIMULATED_DAY_LABEL } from './activity-page.ts';
import { TEMPLATE } from '../../libs/utils/ui/panel.ts';

const src = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('B6: the second screen carries a persistent "Simulated day" label with the simulated clock', () => {
  assert.equal(SIMULATED_DAY_LABEL, 'Simulated day');
  const html = activityPage();
  assert.match(html, /<div class="sim" id="sim"[^>]*><b>Simulated day<\/b><span class="sim-clock" id="sim-clock">/, 'a banner, not a row that scrolls away');
  assert.match(html, /\.sim \{ position: sticky; top: 0;/, 'sticky: visible while the rows scroll');
  assert.match(html, /simClockEl\.textContent = c\.mode === 'simulated' \? 'simulated ' \+ hhmm\(c\.now\)/, 'the banner shows the simulated clock from GET /demo/clock');
  assert.ok(html.indexOf('id="sim"') < html.indexOf('id="rows"'), 'above the stream');
});

test('B6: the simulated day never reaches the companion panel (real-time state only)', () => {
  assert.ok(!TEMPLATE.includes(SIMULATED_DAY_LABEL), 'not in the panel template');
  assert.ok(!/simulated/i.test(TEMPLATE), 'no simulated wording in the panel template');
  const companionSources = ['../../libs/utils/ui/panel.ts', '../../libs/utils/ui/api-client.ts', '../desktop/renderer.ts', '../desktop/index.html'].map(src).join('\n');
  assert.ok(!companionSources.includes(SIMULATED_DAY_LABEL), 'no source of the companion renders the label');
  assert.ok(!/\/demo\/(activity|clock)/.test(companionSources), 'the companion never reads the stream or the simulated clock');
});
