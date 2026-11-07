/**
 * B3: the Context Layer page (/context.html?entity=TRN-042). One self-contained HTML string like activity-page.ts: the
 * panel's palette, inline style and script, no external assets, every engine string through esc() or textContent.
 * Nothing is embedded server-side: the page fetches GET /context and POST /investigate (preview) with the viewer's
 * principalId, so the evidence gate applies to every request.
 *
 * Rows top to bottom as in Elisa's reference architecture: as observed (evidence diamonds on the time axis), as
 * experienced (claims as bars from valid-from to valid-to), bindings (entity chips, firsthand or hedged), people (who
 * asserted what). A draggable t line (pointer, arrow keys, role=slider) snaps to evidence positions; the card on the
 * right shows what an agent is told at t.
 */
import { layoutTimeAxis } from '../../libs/utils/context/time-axis.ts';

/** Problem text the card asks with by default, per story; any other entity gets a generic one. */
export const CONTEXT_STORIES: Record<string, string> = {
  'TRN-042': 'TRN-042 on firmware 4.2: replaced the SFP, link up, counters zero, no traffic.',
  'RBS-310': 'Driving to RBS-310 Thursday, what is the barrier code?',
};

export function contextPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Context layer</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  html, body { margin: 0; background: #ebecee; color: #252729; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; overflow-x: hidden; }
  main { max-width: 1320px; margin: 0 auto; padding: 22px 16px 40px; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 0 0 12px; }
  h1 { font-size: 19px; font-weight: 500; letter-spacing: -.035em; margin: 0; }
  h1 .entity { color: #5e666e; }
  .meta { font-size: 11px; color: #838990; letter-spacing: .025em; }
  .badge { display: inline-block; font-size: 11px; color: #74777b; background: #f4f5f5; border-radius: 5px; padding: 4px 7px; margin-left: 6px; }
  .switch { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; font-size: 12px; }
  .switch a { color: #303336; text-decoration: none; background: #fff; border: 1px solid #e3e4e5; border-radius: 999px; padding: 4px 10px; }
  .switch a[aria-current="page"] { background: #303336; color: #fff; border-color: #303336; }
  .switch input { font: inherit; font-size: 12px; border: 1px solid #e3e4e5; border-radius: 999px; padding: 4px 10px; width: 120px; background: #fff; color: #252729; }
  .switch button { font: inherit; font-size: 12px; border: 0; border-radius: 999px; padding: 5px 10px; background: #303336; color: #fff; cursor: pointer; }
  .grid { display: grid; grid-template-columns: minmax(0, 1fr) 330px; gap: 12px; align-items: start; }
  .card { background: #fff; border: 1px solid #e3e4e5; border-radius: 16px; box-shadow: 0 7px 20px #22242b08, 0 1px 3px #22242b05; padding: 14px 18px; min-width: 0; }
  .scroll { overflow-x: auto; overscroll-behavior-x: contain; -webkit-overflow-scrolling: touch; }
  svg#chart { display: block; width: 100%; min-width: 880px; height: auto; touch-action: pan-y; user-select: none; -webkit-user-select: none; }
  svg text { font-family: inherit; }
  .lbl { font-size: 11px; fill: #838990; letter-spacing: .025em; }
  .row-lbl { font-size: 11px; fill: #5e666e; font-weight: 500; letter-spacing: .025em; text-transform: uppercase; }
  .tick { font-size: 10px; fill: #8d959c; font-variant-numeric: tabular-nums; }
  .status { font-size: 10px; fill: #8d959c; }
  .status.sup { fill: #8a6d6f; }
  .hit { cursor: pointer; }
  .hit:focus { outline: none; }
  .hit:focus-visible > * { stroke: #8b939a; stroke-width: 2px; }
  .dim { opacity: .2; transition: opacity .15s; }
  .live { opacity: 1; transition: opacity .15s; }
  #t { cursor: ew-resize; outline: none; }
  #t:focus-visible circle { stroke: #8b939a; stroke-width: 3px; }
  .detail { font-size: 13px; line-height: 1.5; border-top: 1px solid #f0f1f2; margin-top: 10px; padding-top: 10px; min-height: 58px; }
  .detail .hint { color: #8d959c; font-size: 12px; margin: 0; }
  .detail .statement { margin: 0 0 4px; }
  .detail .sentence { margin: 0 0 4px; color: #5e666e; }
  .detail .dmeta { margin: 0; color: #8d959c; font-size: 11px; letter-spacing: .025em; }
  .legend { display: flex; flex-wrap: wrap; gap: 4px 14px; font-size: 11px; color: #747b82; margin-top: 8px; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; margin-right: 5px; vertical-align: -1px; }
  aside h2 { font-size: 15px; font-weight: 500; letter-spacing: -.02em; margin: 0 0 2px; }
  .tlabel { font-size: 11px; color: #838990; letter-spacing: .025em; margin: 0 0 10px; font-variant-numeric: tabular-nums; }
  textarea#problem { width: 100%; font: inherit; font-size: 12px; line-height: 1.4; color: #252729; border: 1px solid #e3e4e5; border-radius: 10px; padding: 8px 10px; resize: vertical; min-height: 54px; background: #fafafa; }
  .plabel { font-size: 11px; color: #838990; letter-spacing: .025em; margin: 0 0 4px; }
  .told { margin-top: 12px; border-top: 1px solid #f0f1f2; padding-top: 12px; }
  .kind { display: inline-block; font-size: 11px; color: #74777b; background: #f4f5f5; border-radius: 5px; padding: 3px 7px; margin-bottom: 6px; }
  .kind[data-kind="reuse"] { color: #43765a; background: #eef5f0; }
  .kind[data-kind="check-first"], .kind[data-kind="qualified"] { color: #886b24; background: #f8f3e4; }
  .rtext { font-size: 15px; line-height: 1.4; letter-spacing: -.02em; margin: 0 0 6px; }
  .prov { font-size: 11px; color: #8d959c; letter-spacing: .025em; margin: 0 0 8px; }
  .note { font-size: 12px; line-height: 1.5; color: #747b82; margin: 0 0 5px; }
  .note.caveat:first-of-type { color: #8a5254; }
  .next { font-size: 12px; line-height: 1.5; color: #303336; margin: 8px 0 0; }
  .empty, .err { font-size: 13px; color: #7f8489; }
  @media (max-width: 900px) { .grid { grid-template-columns: minmax(0, 1fr); } }
  @media (max-width: 480px) { main { padding: 14px 16px 32px; } .card { padding: 12px 14px; } }
</style>
</head>
<body>
<main>
  <header>
    <h1>Context layer <span class="entity" id="ename"></span><span class="badge" id="clock">local</span></h1>
    <form class="switch" id="switch" autocomplete="off">
      <a href="?entity=TRN-042" data-entity="TRN-042">TRN-042</a>
      <a href="?entity=RBS-310" data-entity="RBS-310">RBS-310</a>
      <input id="entity" name="entity" aria-label="Entity name" placeholder="Entity, e.g. TRN-117">
      <button type="submit">Show</button>
    </form>
  </header>
  <p class="meta" id="viewer">loading…</p>
  <div class="grid">
    <section class="card" aria-label="Context layer of the entity">
      <div class="scroll"><svg id="chart" viewBox="0 0 1000 300" role="group" aria-label="Evidence, assertions, bindings and people on a time axis"></svg></div>
      <div class="legend" id="legend"></div>
      <div class="detail" id="detail" aria-live="polite"><p class="hint">Click a diamond or a bar to see the sentence it came from. Drag the t line (or focus it and use the arrow keys) to see what an agent is told at that moment.</p></div>
    </section>
    <aside class="card" aria-label="What an agent is told at t">
      <h2>What an agent is told at t</h2>
      <p class="tlabel" id="tlabel">t = now</p>
      <p class="plabel">Problem the agent brings</p>
      <textarea id="problem" aria-label="Problem the agent brings"></textarea>
      <div class="told" id="told" aria-live="polite"><p class="empty">Loading…</p></div>
    </aside>
  </div>
</main>
<script>
(function () {
  var STORIES = ${JSON.stringify(CONTEXT_STORIES)};
  var layoutTimeAxis = ${layoutTimeAxis.toString()};
  var NS = 'http://www.w3.org/2000/svg';
  var W = 1000, X0 = 128, X1 = 730, STATUS_X = 742;
  var COLORS = { observation: '#c87474', condition: '#d79a9a', advice: '#d4b452', hypothesis: '#e2cc85', action: '#aeb6bd', outcome: '#6da287', 'access-fact': '#5c7fa3', other: '#c4c8cc' };
  var TYPE_ORDER = { observation: 0, condition: 1, hypothesis: 2, advice: 3, action: 4, outcome: 5, 'access-fact': 6, other: 7 };
  var params = new URLSearchParams(location.search);
  var entityName = (params.get('entity') || 'TRN-042').trim();
  var principalId = params.get('principalId') || '';
  var svg = document.getElementById('chart'), detail = document.getElementById('detail'), told = document.getElementById('told');
  var tlabel = document.getElementById('tlabel'), problem = document.getElementById('problem');
  var data = null, layout = null, principal = null, stopIndex = 0, validAt = {}, cache = {}, debounce = 0, seq = 0;
  var byClaim = {}, byEvidence = {};

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function get(path) { return fetch(path, { cache: 'no-store' }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j && j.error ? j.error : ('HTTP ' + r.status)); return j; }); }); }
  function post(path, body) { return fetch(path, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j && j.error ? j.error : ('HTTP ' + r.status)); return j; }); }); }
  function q(obj) { var u = new URLSearchParams(); Object.keys(obj).forEach(function (k) { if (obj[k]) u.set(k, obj[k]); }); return u.toString(); }
  var MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  function when(pos) {
    if (!pos) return 'time unknown';
    if (pos.kind === 'known' && pos.iso) { var d = new Date(pos.iso); return d.getUTCDate() + ' ' + MONTHS[d.getUTCMonth()]; }
    if (pos.kind === 'time-only' && pos.raw) return pos.raw + ' (date unknown)';
    if (pos.kind === 'date-only' && pos.raw) return pos.raw + ' (time unknown)';
    return 'time unknown';
  }
  function provider(p) { return ({ teams: 'Teams', email: 'E-mail', slack: 'Slack', paste: 'Paste', file: 'File' })[p] || p; }
  function trunc(s, n) { s = String(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function node(name, attrs, text) {
    var e = document.createElementNS(NS, name);
    Object.keys(attrs || {}).forEach(function (k) { e.setAttribute(k, attrs[k]); });
    if (text != null) e.textContent = text;
    return e;
  }
  function titled(e, text) { e.appendChild(node('title', {}, text)); return e; }

  // ---- switch, viewer --------------------------------------------------------------------------------------------
  document.getElementById('ename').textContent = '· ' + entityName;
  document.title = 'Context layer · ' + entityName;
  Array.prototype.forEach.call(document.querySelectorAll('#switch a'), function (a) {
    a.href = '?' + q({ entity: a.dataset.entity, principalId: principalId });
    if (a.dataset.entity.toLowerCase() === entityName.toLowerCase()) a.setAttribute('aria-current', 'page');
  });
  document.getElementById('switch').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var v = document.getElementById('entity').value.trim();
    if (v) location.search = '?' + q({ entity: v, principalId: principalId });
  });
  problem.value = params.get('text') || STORIES[entityName.toUpperCase()] || (entityName + ': what should I know before working on it?');
  problem.addEventListener('change', function () { cache = {}; ask(); });

  function loadViewer() {
    return Promise.all([get('/settings').catch(function () { return {}; }), get('/directory').catch(function () { return []; })]).then(function (r) {
      var id = principalId || (r[0] && r[0].currentPersonEntityId) || '';
      var person = (r[1] || []).filter(function (d) { return d.personEntityId === id; })[0];
      principal = person ? { id: person.personEntityId, displayName: person.name, groups: person.groups, type: 'human' } : { id: id || 'context-page', displayName: id || 'Anonymous', groups: [], type: 'human' };
      if (!principalId && person) principalId = person.personEntityId;
      document.getElementById('viewer').textContent = 'viewing as ' + (person ? person.name + (person.groups.length ? ' (' + person.groups.join(', ') + ')' : '') : 'anonymous (organization-wide knowledge only)') + ' · access is checked on every request';
    });
  }
  get('/demo/clock').then(function (c) { document.getElementById('clock').textContent = c.mode === 'simulated' ? 'simulated clock' : 'local · real clock'; }).catch(function () {});

  // ---- layout ----------------------------------------------------------------------------------------------------
  function build() {
    byClaim = {}; byEvidence = {};
    var items = [], seen = {};
    data.assertions.forEach(function (a) {
      byClaim[a.claimId] = a;
      (byEvidence[a.source.evidenceId] = byEvidence[a.source.evidenceId] || []).push(a);
      if (!seen[a.source.evidenceId]) { seen[a.source.evidenceId] = 1; items.push({ id: a.source.evidenceId, position: a.source.position, thread: a.source.thread, stop: true }); }
      if (a.validTo && a.validTo.kind === 'known') items.push({ id: 'to:' + a.claimId, position: a.validTo });
    });
    layout = layoutTimeAxis(items, { x0: X0, x1: X1 });
    stopIndex = layout.stops.length - 1;
  }

  function statusOf(a) {
    if (a.status === 'superseded' && a.supersededBy && byClaim[a.supersededBy]) {
      var n = byClaim[a.supersededBy];
      return { text: 'superseded ' + when(n.validFrom) + ' by ' + (n.assertedBy ? n.assertedBy.displayName : 'a newer source'), sup: true };
    }
    if (a.status === 'superseded') return { text: 'superseded', sup: true };
    if (a.validityCondition && a.conditionedBy && byClaim[a.conditionedBy]) {
      var c = byClaim[a.conditionedBy];
      return { text: 'superseded ' + when(c.validFrom) + ' by ' + (c.assertedBy ? c.assertedBy.displayName : 'a note') + ' · still true for ' + a.validityCondition, sup: true, bound: c };
    }
    if (a.validityCondition) return { text: 'holds while ' + a.validityCondition, sup: false };
    if (a.status === 'contradicted' || a.status === 'retracted' || a.status === 'corrected') return { text: a.status, sup: true };
    if (a.validTo) return { text: 'valid until ' + when(a.validTo), sup: false };
    return { text: 'still believed true', sup: false, open: true };
  }

  function draw() {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var defs = node('defs');
    defs.innerHTML = '<marker id="arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#9aa0a6"/></marker>'
      + '<pattern id="hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#eceef0"/><line x1="0" y1="0" x2="0" y2="5" stroke="#c9ccd0" stroke-width="2"/></pattern>';
    Object.keys(COLORS).forEach(function (t) {
      defs.innerHTML += '<linearGradient id="fade-' + t + '" x1="0" x2="1"><stop offset="0" stop-color="' + COLORS[t] + '" stop-opacity="1"/><stop offset=".75" stop-color="' + COLORS[t] + '" stop-opacity=".55"/><stop offset="1" stop-color="' + COLORS[t] + '" stop-opacity="0"/></linearGradient>';
    });
    svg.appendChild(defs);
    var y = 0;
    // Axis: segment labels, ticks, baseline, break marks.
    layout.segments.forEach(function (s) {
      svg.appendChild(node('text', { x: s.x0 + 2, y: 13, class: 'lbl' }, s.kind === 'unknown' ? '? time unknown' : s.label));
      svg.appendChild(node('line', { x1: s.x0, x2: s.x1, y1: 40, y2: 40, stroke: s.kind === 'time-only' ? '#b9bec3' : '#d5d8db', 'stroke-width': 2, 'stroke-dasharray': s.kind === 'unknown' ? '3 3' : null }));
      var lastX = -99;
      s.ticks.forEach(function (t) {
        if (t.x - lastX < 30) return;
        lastX = t.x;
        svg.appendChild(node('line', { x1: t.x, x2: t.x, y1: 36, y2: 40, stroke: '#c4c8cc' }));
        svg.appendChild(node('text', { x: t.x, y: 31, class: 'tick', 'text-anchor': 'middle' }, t.label));
      });
    });
    layout.breaks.forEach(function (bx) {
      svg.appendChild(node('path', { d: 'M' + (bx - 6) + ',46 l4,-12 l4,12 l4,-12', fill: 'none', stroke: '#9aa0a6', 'stroke-width': 1.2 }));
    });
    svg.appendChild(node('text', { x: STATUS_X, y: 13, class: 'lbl' }, 'status now'));
    y = 58;

    // As observed: one diamond per evidence item.
    svg.appendChild(node('text', { x: 0, y: y + 16, class: 'row-lbl' }, 'As observed'));
    Object.keys(byEvidence).forEach(function (id) {
      var x = layout.x[id], a = byEvidence[id][0];
      var g = node('g', { class: 'hit ev', 'data-evidence': id, tabindex: 0, role: 'button', 'aria-label': provider(a.source.provider) + ' ' + when(a.source.position) });
      g.appendChild(node('rect', { x: x - 5, y: y + 7, width: 10, height: 10, transform: 'rotate(45 ' + x + ' ' + (y + 12) + ')', fill: '#fff', stroke: '#5e666e', 'stroke-width': 1.4 }));
      titled(g, provider(a.source.provider) + ' · ' + when(a.source.position) + ' · ' + (a.assertedBy ? a.assertedBy.displayName : ''));
      svg.appendChild(g);
    });
    y += 38;

    // As experienced: one lane per claim, bars from valid-from to valid-to.
    svg.appendChild(node('text', { x: 0, y: y + 10, class: 'row-lbl' }, 'As experienced'));
    var lanes = data.assertions.slice().sort(function (a, b) {
      return (layout.x[a.source.evidenceId] - layout.x[b.source.evidenceId]) || ((TYPE_ORDER[a.type] || 9) - (TYPE_ORDER[b.type] || 9));
    });
    var laneY = {}, LANE = 14;
    lanes.forEach(function (a, i) { laneY[a.claimId] = y + i * LANE; });
    var arrows = [];
    lanes.forEach(function (a) {
      var ly = laneY[a.claimId], x0 = layout.x[a.source.evidenceId], st = statusOf(a), color = COLORS[a.type] || COLORS.other;
      var x1 = a.validTo && a.validTo.kind === 'known' && layout.x['to:' + a.claimId] != null ? layout.x['to:' + a.claimId] : null;
      if (a.status === 'superseded' && x1 == null && a.supersededBy && byClaim[a.supersededBy]) x1 = layout.x[byClaim[a.supersededBy].source.evidenceId];
      var open = x1 == null;
      var end = open ? STATUS_X - 6 : Math.max(x1, x0 + 6);
      var g = node('g', { class: 'hit bar', 'data-claim': a.claimId, tabindex: 0, role: 'button', 'aria-label': a.type + ': ' + trunc(a.statement, 80) });
      var fill = a.status === 'superseded' ? '#c9ccd0' : open ? 'url(#fade-' + (COLORS[a.type] ? a.type : 'other') + ')' : color;
      g.appendChild(node('rect', { x: x0, y: ly + 2, width: Math.max(4, end - x0), height: 9, rx: 4.5, fill: fill }));
      if (st.bound) {
        var bx = layout.x[st.bound.source.evidenceId];
        if (bx > x0) g.appendChild(node('rect', { x: bx, y: ly + 2, width: Math.max(2, end - bx), height: 9, rx: 2, fill: 'url(#hatch)', opacity: .9 }));
      }
      titled(g, a.type + ' · ' + a.statement);
      svg.appendChild(g);
      var s = node('text', { x: STATUS_X, y: ly + 10, class: 'status' + (st.sup ? ' sup' : ''), 'data-claim-status': a.claimId }, trunc(st.text, 50));
      titled(s, st.text);
      svg.appendChild(s);
      if (a.status === 'superseded' && a.supersededBy && laneY[a.supersededBy] != null) {
        var n = byClaim[a.supersededBy], nx = layout.x[n.source.evidenceId], ny = laneY[a.supersededBy] + 6;
        arrows.push(node('path', { d: 'M' + (end + 2) + ',' + (ly + 6) + ' C' + (end + 18) + ',' + (ly + 6) + ' ' + (nx - 18) + ',' + ny + ' ' + (nx - 3) + ',' + ny, fill: 'none', stroke: '#9aa0a6', 'stroke-width': 1.2, 'marker-end': 'url(#arrow)' }));
      }
    });
    arrows.forEach(function (p) { svg.appendChild(p); });
    y += lanes.length * LANE + 18;

    // Bindings: chips (firsthand solid, hedged dashed).
    svg.appendChild(node('text', { x: 0, y: y + 15, class: 'row-lbl' }, 'Bindings'));
    var cx = X0, cy = y;
    (data.bindings || []).forEach(function (b) {
      var hedged = b.kind === 'hedged-class';
      var text = hedged ? b.entityName + ': ' + b.label + ' · hedged' + (b.byPerson ? ' (' + b.byPerson + ')' : '') : (b.byPerson || b.entityName) + ' · ' + String(b.label).replace(/-/g, ' ') + ' · firsthand';
      var w = Math.min(320, text.length * 5.6 + 18);
      if (cx + w > STATUS_X + 210) { cx = X0; cy += 26; }
      var g = node('g', { class: 'chip' });
      g.appendChild(node('rect', { x: cx, y: cy + 3, width: w, height: 20, rx: 6, fill: hedged ? '#fff' : '#f4f5f5', stroke: hedged ? '#a6aab0' : '#e3e4e5', 'stroke-dasharray': hedged ? '4 3' : null }));
      g.appendChild(node('text', { x: cx + 9, y: cy + 17, class: 'tick', fill: '#74777b' }, text));
      titled(g, text + ' · recorded ' + when(b.recorded));
      svg.appendChild(g);
      cx += w + 6;
    });
    if (!(data.bindings || []).length) svg.appendChild(node('text', { x: X0, y: cy + 17, class: 'tick' }, 'none recorded'));
    y = cy + 40;

    // People: who asserted what, one lane per person, a dot at each of their claims.
    svg.appendChild(node('text', { x: 0, y: y + 10, class: 'row-lbl' }, 'People'));
    var people = [];
    data.assertions.forEach(function (a) { var n = a.assertedBy ? a.assertedBy.displayName : 'unknown'; if (people.indexOf(n) < 0) people.push(n); });
    people.forEach(function (name, i) {
      var py = y + 16 + i * 18;
      svg.appendChild(node('text', { x: 0, y: py + 4, class: 'tick' }, trunc(name, 20)));
      svg.appendChild(node('line', { x1: X0, x2: X1, y1: py, y2: py, stroke: '#f0f1f2' }));
      var done = {};
      data.assertions.forEach(function (a) {
        if ((a.assertedBy ? a.assertedBy.displayName : 'unknown') !== name) return;
        var x = layout.x[a.source.evidenceId], k = Math.round(x) + ':' + a.type;
        if (done[k]) return; done[k] = 1;
        var g = node('g', { class: 'hit person', 'data-claim': a.claimId });
        g.appendChild(node('circle', { cx: x, cy: py, r: 4, fill: COLORS[a.type] || COLORS.other }));
        titled(g, name + ' · ' + a.type + ' · ' + a.statement);
        svg.appendChild(g);
      });
      var count = data.assertions.filter(function (a) { return (a.assertedBy ? a.assertedBy.displayName : 'unknown') === name; }).length;
      svg.appendChild(node('text', { x: STATUS_X, y: py + 4, class: 'status' }, count + ' assertion' + (count === 1 ? '' : 's')));
    });
    y += 16 + people.length * 18 + 8;

    // The t line and its handle (role=slider).
    var top = 40;
    var line = node('line', { id: 'tline', x1: 0, x2: 0, y1: top, y2: y, stroke: '#303336', 'stroke-width': 1.5, 'stroke-dasharray': '4 3' });
    svg.appendChild(line);
    var t = node('g', { id: 't', role: 'slider', tabindex: 0, 'aria-label': 't, the moment the agent asks', 'aria-valuemin': 0, 'aria-valuemax': layout.stops.length - 1 });
    t.appendChild(node('circle', { cx: 0, cy: top, r: 9, fill: '#303336', stroke: '#fff', 'stroke-width': 2 }));
    t.appendChild(node('text', { x: 0, y: top + 3.5, 'text-anchor': 'middle', 'font-size': 9, fill: '#fff' }, 't'));
    svg.appendChild(t);
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + (y + 8));
    legend();
    place();
  }

  function legend() {
    var el = document.getElementById('legend');
    el.innerHTML = ['observation', 'condition', 'hypothesis', 'advice', 'action', 'outcome', 'access-fact', 'other'].map(function (t) {
      return '<span><i style="background:' + COLORS[t] + '"></i>' + esc(t) + '</span>';
    }).join('') + '<span><i style="background:#c9ccd0"></i>superseded</span><span><i style="background:#fff;border:1px dashed #a6aab0"></i>hedged binding</span><span><i style="background:#eceef0;border:1px solid #c9ccd0"></i>bounded by a later note</span>';
  }

  // ---- slider ----------------------------------------------------------------------------------------------------
  function place() {
    var s = layout.stops[stopIndex];
    document.getElementById('tline').setAttribute('x1', s.x);
    document.getElementById('tline').setAttribute('x2', s.x);
    var t = document.getElementById('t');
    t.setAttribute('transform', 'translate(' + s.x + ',0)');
    t.setAttribute('aria-valuenow', stopIndex);
    t.setAttribute('aria-valuetext', s.label);
    tlabel.textContent = 't = ' + s.label + (s.kind === 'time-only' ? ' · only this thread up to here counts' : s.kind === 'calendar' ? ' · everything dated up to here, and every undated source' : ' · everything on file');
    dimming();
  }
  function dimming() {
    var s = layout.stops[stopIndex], vis = {};
    s.visible.forEach(function (id) { vis[id] = 1; });
    Array.prototype.forEach.call(svg.querySelectorAll('.ev'), function (g) { g.setAttribute('class', 'hit ev ' + (vis[g.getAttribute('data-evidence')] ? 'live' : 'dim')); });
    Array.prototype.forEach.call(svg.querySelectorAll('.bar, .person'), function (g) {
      var a = byClaim[g.getAttribute('data-claim')];
      var ok = vis[a.source.evidenceId] && validAt[a.claimId] !== false;
      g.setAttribute('class', g.getAttribute('class').replace(/ (live|dim)$/, '') + (ok ? ' live' : ' dim'));
    });
  }
  function moveTo(i, now) {
    i = Math.max(0, Math.min(layout.stops.length - 1, i));
    if (i === stopIndex && !now) return;
    stopIndex = i;
    place();
    clearTimeout(debounce);
    debounce = setTimeout(refresh, now ? 0 : 150);
  }
  function nearest(clientX) {
    var pt = svg.createSVGPoint(); pt.x = clientX; pt.y = 0;
    var x = pt.matrixTransform(svg.getScreenCTM().inverse()).x, best = 0;
    layout.stops.forEach(function (s, i) { if (Math.abs(s.x - x) < Math.abs(layout.stops[best].x - x)) best = i; });
    return best;
  }
  var dragging = false;
  svg.addEventListener('pointerdown', function (ev) {
    var target = ev.target.closest ? ev.target.closest('.hit') : null;
    if (target) return;
    dragging = true;
    svg.setPointerCapture(ev.pointerId);
    moveTo(nearest(ev.clientX));
    ev.preventDefault();
  });
  svg.addEventListener('pointermove', function (ev) { if (dragging) moveTo(nearest(ev.clientX)); });
  svg.addEventListener('pointerup', function () { dragging = false; });
  svg.addEventListener('pointercancel', function () { dragging = false; });
  svg.addEventListener('keydown', function (ev) {
    if (!ev.target || ev.target.id !== 't') {
      if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.closest && ev.target.closest('.hit')) { ev.preventDefault(); show(ev.target.closest('.hit')); }
      return;
    }
    var k = ev.key, i = stopIndex;
    if (k === 'ArrowLeft' || k === 'ArrowDown') i--; else if (k === 'ArrowRight' || k === 'ArrowUp') i++; else if (k === 'Home') i = 0; else if (k === 'End') i = layout.stops.length - 1; else return;
    ev.preventDefault();
    moveTo(i);
  });
  svg.addEventListener('click', function (ev) { var g = ev.target.closest ? ev.target.closest('.hit') : null; if (g) show(g); });

  // ---- detail: the sentence a diamond or a bar came from ---------------------------------------------------------
  function show(g) {
    var a = g.getAttribute('data-claim') ? byClaim[g.getAttribute('data-claim')] : (byEvidence[g.getAttribute('data-evidence')] || [])[0];
    if (!a) return;
    detail.innerHTML = '';
    var list = g.getAttribute('data-evidence') ? byEvidence[g.getAttribute('data-evidence')] : [a];
    var p = document.createElement('p'); p.className = 'sentence'; p.textContent = '“' + a.excerpt + '”'; detail.appendChild(p);
    list.slice(0, 4).forEach(function (c) {
      var s = document.createElement('p'); s.className = 'statement'; s.textContent = c.type + ': ' + c.statement; detail.appendChild(s);
    });
    var m = document.createElement('p'); m.className = 'dmeta';
    m.textContent = [a.assertedBy ? a.assertedBy.displayName : '', provider(a.source.provider) + ' ' + when(a.source.position), statusOf(a).text, a.route ? 'read by ' + a.route : '', a.orderBasis === 'import-order' ? 'order from import (undated)' : ''].filter(Boolean).join(' · ');
    detail.appendChild(m);
  }

  // ---- what an agent is told at t --------------------------------------------------------------------------------
  function refresh() {
    var s = layout.stops[stopIndex], mine = ++seq;
    get('/context?' + q({ entity: entityName, at: s.at, principalId: principalId })).then(function (v) {
      if (mine !== seq) return;
      validAt = {};
      v.assertions.forEach(function (a) { validAt[a.claimId] = a.validAt; });
      dimming();
    }).catch(function () {});
    ask();
  }
  function ask() {
    var s = layout.stops[stopIndex], key = stopIndex + '|' + problem.value, mine = seq;
    var render = function (r) {
      if (mine !== seq) return;
      told.innerHTML = '';
      told.setAttribute('data-t', s.label);
      var rec = r.recommendation;
      var k = document.createElement('span'); k.className = 'kind'; k.dataset.kind = rec.kind; k.textContent = rec.kind === 'none' ? 'nothing to reuse' : rec.kind; told.appendChild(k);
      var h = document.createElement('p'); h.className = 'rtext'; h.textContent = rec.text || 'Nothing on file.'; told.appendChild(h);
      if (r.provenance) { var pv = document.createElement('p'); pv.className = 'prov'; pv.textContent = r.provenance.text; told.appendChild(pv); }
      (rec.caveats || []).slice(0, 4).forEach(function (c) { var n = document.createElement('p'); n.className = 'note caveat'; n.textContent = c; told.appendChild(n); });
      if (/\\s/.test(rec.applicability || '')) { var ap = document.createElement('p'); ap.className = 'note'; ap.textContent = rec.applicability; told.appendChild(ap); }
      else if (rec.applicability) { var ap2 = document.createElement('p'); ap2.className = 'note'; ap2.textContent = 'Applicability: ' + rec.applicability; told.appendChild(ap2); }
      if (rec.nextStep) { var nx = document.createElement('p'); nx.className = 'next'; nx.textContent = 'Next: ' + rec.nextStep; told.appendChild(nx); }
    };
    if (cache[key]) return render(cache[key]);
    told.innerHTML = '<p class="empty">Asking…</p>';
    told.removeAttribute('data-t');
    var body = { text: problem.value.trim() || entityName, principal: principal, entityIds: [data.entity.id], allowQuestions: false, preview: true };
    if (s.at) body.at = s.at;
    if (s.atEvidence) body.atEvidence = s.atEvidence;
    post('/investigate', body).then(function (r) { cache[key] = r; render(r); }).catch(function (e) {
      if (mine !== seq) return;
      told.innerHTML = '<p class="err">' + esc(e.message) + '</p>';
    });
  }

  loadViewer().then(function () {
    return get('/context?' + q({ entity: entityName, principalId: principalId }));
  }).then(function (v) {
    data = v;
    document.getElementById('ename').textContent = '· ' + v.entity.name;
    v.assertions.forEach(function (a) { validAt[a.claimId] = a.validAt; });
    if (!v.assertions.length) {
      svg.innerHTML = '';
      detail.innerHTML = '<p class="hint">Nothing visible to you is bound to ' + esc(v.entity.name) + '.</p>';
    }
    build();
    draw();
    refresh();
  }).catch(function (e) {
    detail.innerHTML = '<p class="err">' + esc(e.message) + '</p>';
    told.innerHTML = '';
  });
})();
</script>
</body>
</html>
`;
}
