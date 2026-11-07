/**
 * B3: the Context Layer page is served by the service, self-contained, and reads its data per viewer from GET /context
 * and POST /investigate (preview). The data side is checked on the synthetic demo store: the TRN-117 thread (time-only)
 * and Helmi's dated firmware note give the page a clock segment and a calendar.
 */
import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutTimeAxis, type AxisItem } from '../src/libs/utils/context/time-axis.ts';
import { startService, type Running } from './support.ts';

let svc: Running;
before(async () => {
  svc = await startService();
  await svc.call('POST', '/demo/reset', { seed: 'synthetic' });
});
after(async () => svc.close());

test('GET /context.html: 200 text/html, an svg, the open-bar label, the fetch paths, no external assets', async () => {
  const res = await fetch(svc.http.url + '/context.html?entity=TRN-042');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /^text\/html/);
  assert.equal(res.headers.get('cache-control'), 'no-store');
  const html = await res.text();
  assert.match(html, /<svg/);
  assert.match(html, /still believed true/);
  assert.match(html, /'\/context\?'/);
  assert.match(html, /'\/investigate'/);
  assert.match(html, /preview: true/);
  assert.match(html, /role: 'slider'/);
  assert.match(html, /atEvidence/);
  assert.match(html, /function layoutTimeAxis/, 'the tested layout function is embedded');
  assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=|https?:\/\/(?!www\.w3\.org\/2000\/svg')/, 'no external script, stylesheet or URL (the SVG namespace aside)');
  // The served script parses (the embedded function and the string building survive the template literal).
  const script = /<script>([\s\S]*)<\/script>/.exec(html)![1]!;
  assert.doesNotThrow(() => new Function(script));
});

test('the page data: GET /context gives thread ids, routes and the bounding note; the layout puts them on the axis', async () => {
  const v = await svc.call('GET', '/context?entity=TRN-117');
  assert.ok(v.assertions.length > 5);
  const timeOnly = v.assertions.filter((a: any) => a.source.position.kind === 'time-only');
  assert.ok(timeOnly.length > 0 && timeOnly.every((a: any) => typeof a.source.thread === 'string' && !a.source.position.iso));
  assert.ok(v.assertions.every((a: any) => a.route === 'rules'));
  const bounded = v.assertions.filter((a: any) => a.validityCondition);
  assert.ok(bounded.length > 0, 'the firmware note bounds the older advice');
  for (const a of bounded) assert.ok(v.assertions.some((n: any) => n.claimId === a.conditionedBy), 'conditionedBy names a visible claim');
  const items: AxisItem[] = [];
  for (const a of v.assertions) if (!items.some((i) => i.id === a.source.evidenceId)) items.push({ id: a.source.evidenceId, position: a.source.position, thread: a.source.thread, stop: true });
  const l = layoutTimeAxis(items, { x0: 128, x1: 760 });
  assert.equal(l.segments[0]!.kind, 'time-only');
  assert.ok(l.segments.some((s) => s.kind === 'calendar'), 'the dated note sits on the calendar');
  const first = l.stops[0]!;
  assert.equal(first.kind, 'time-only');
  // What the page sends for the first stop: the agent is told nothing yet; at now the fix is reused or bounded.
  const principal = { id: 'context-page', displayName: 'Anonymous', groups: [], type: 'human' };
  const text = 'TRN-117: link up after the optics change, counters zero, no traffic.';
  const early = await svc.call('POST', '/investigate', { text, principal, entityIds: [v.entity.id], at: first.at, atEvidence: first.atEvidence, allowQuestions: false, preview: true });
  assert.equal(early.recommendation.kind, 'none');
  const now = await svc.call('POST', '/investigate', { text, principal, entityIds: [v.entity.id], allowQuestions: false, preview: true });
  assert.notEqual(now.recommendation.kind, 'none');
  assert.equal(svc.engine.store.list('investigation').filter((s) => s.origin !== 'standing').length, 0, 'the slider persisted nothing');
});
