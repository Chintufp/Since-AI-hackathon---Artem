/**
 * B3: the Context Layer page (/context.html?entity=TRN-042). One self-contained HTML string like activity-page.ts: the
 * panel's palette, inline style and script, no external assets, every engine string through esc() or textContent.
 * Nothing is embedded server-side: the page fetches GET /context and POST /investigate (preview) with the viewer's
 * principalId, so the evidence gate applies to every request.
 *
 * Quiet document (Artem 8 Nov, replacing the coloured dashboard): what is known about the unit (type, statement, since,
 * until, from whom), an "as of" slider over the same time stops (layoutTimeAxis), and what an agent is told at that
 * moment; superseded or not-yet-valid rows are greyed and struck.
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
  /* Quiet technical document, like /pipeline: one system font, mono for ids, hairline rules, grey only for metadata. */
  html, body { margin: 0; background: #fff; color: #111; font: 15px/1.5 -apple-system, BlinkMacSystemFont, "Helvetica Neue", Arial, sans-serif; -webkit-font-smoothing: antialiased; }
  main { padding: 36px 44px 60px; max-width: 1280px; }
  td.who { white-space: nowrap; }
  .label { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: #6b6b6b; margin: 0 0 4px; }
  .lead { font-size: 21px; line-height: 1.4; font-weight: 500; letter-spacing: -.01em; margin: 6px 0 6px; }
  .meta { font-size: 13px; color: #6b6b6b; margin: 0; }
  .bar { display: flex; gap: 18px; align-items: center; flex-wrap: wrap; padding: 16px 0 18px; border-bottom: 1px solid #111; margin-bottom: 8px; }
  form { display: flex; gap: 8px; align-items: center; }
  input[type=text] { font: inherit; font-size: 14px; border: 0; border-bottom: 1px solid #c8c8c8; padding: 4px 2px; width: 140px; outline: none; }
  button { font: inherit; font-size: 13px; background: #fff; color: #111; border: 1px solid #111; border-radius: 0; padding: 4px 10px; cursor: pointer; }
  .t { display: flex; gap: 10px; align-items: center; font-size: 13px; color: #6b6b6b; }
  .t input { width: 260px; accent-color: #111; }
  #tlabel { color: #111; font-weight: 600; min-width: 90px; }
  h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; margin: 28px 0 8px; }
  table { border-collapse: collapse; width: 100%; }
  th { font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: .06em; text-align: left; padding: 8px 14px 8px 0; border-bottom: 1px solid #111; }
  td { padding: 10px 14px 10px 0; border-bottom: 1px solid #e6e6e6; vertical-align: top; }
  td.type, td.when { white-space: nowrap; color: #6b6b6b; font-size: 13px; }
  td.who { color: #6b6b6b; font-size: 13px; }
  tr.off td { color: #b0b0b0; }
  tr.off td.st { text-decoration: line-through; }
  .told { max-width: 760px; }
  .rtext { font-size: 18px; font-weight: 500; margin: 0 0 4px; }
  details summary { cursor: pointer; color: #6b6b6b; font-size: 13px; margin-top: 8px; }
  details p { font-size: 14px; margin: 6px 0 0; }
  .err { color: #111; }
</style>
</head>
<body>
<main>
  <p class="label">Context layer</p>
  <p class="lead"><span id="ename">…</span>: what is known, since when, and from whom.</p>
  <p class="meta" id="viewer"></p>
  <div class="bar">
    <form id="switch"><input type="text" id="entity" placeholder="Unit, e.g. TRN-117" aria-label="Unit"><button type="submit">Show</button></form>
    <div class="t"><span>as of</span><input type="range" id="t" min="0" max="0" step="1" value="0" aria-label="As of this moment"><span id="tlabel">now</span></div>
  </div>
  <h2>What is known</h2>
  <table><thead><tr><th>type</th><th>statement</th><th>since</th><th>until</th><th>from</th></tr></thead><tbody id="rows"><tr><td colspan="5" class="meta">Loading…</td></tr></tbody></table>
  <h2>What an agent is told</h2>
  <div class="told" id="told"><p class="meta">Loading…</p></div>
</main>
<script>
(function () {
  var STORIES = ${JSON.stringify(CONTEXT_STORIES)};
  var layoutTimeAxis = ${layoutTimeAxis.toString()};
  var params = new URLSearchParams(location.search);
  var entityName = (params.get('entity') || 'TRN-042').trim();
  var principalId = params.get('principalId') || '';
  var rows = document.getElementById('rows'), told = document.getElementById('told'), tlabel = document.getElementById('tlabel'), slider = document.getElementById('t');
  var data = null, layout = null, principal = null, stopIndex = 0, cache = {}, seq = 0, byClaim = {};
  var problemText = params.get('text') || STORIES[entityName.toUpperCase()] || (entityName + ': what should I know before working on it?');
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]; }); }
  function get(path) { return fetch(path, { cache: 'no-store' }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j && j.error ? j.error : ('HTTP ' + r.status)); return j; }); }); }
  function post(path, body) { return fetch(path, { method: 'POST', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j && j.error ? j.error : ('HTTP ' + r.status)); return j; }); }); }
  function q(obj) { var u = new URLSearchParams(); Object.keys(obj).forEach(function (k) { if (obj[k]) u.set(k, obj[k]); }); return u.toString(); }
  function when(pos) {
    if (!pos) return '';
    if (pos.kind === 'known' && pos.iso) return new Date(pos.iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
    if (pos.raw) return pos.raw + (pos.kind === 'time-only' ? ' (date unknown)' : '');
    return 'time unknown';
  }
  function provider(p) { return ({ teams: 'Teams', email: 'E-mail', slack: 'Slack', paste: 'Paste', file: 'File' })[p] || p; }
  function statusOf(a) {
    if (a.status === 'superseded' && a.supersededBy && byClaim[a.supersededBy]) { var n = byClaim[a.supersededBy]; return 'superseded ' + when(n.validFrom) + ' by ' + (n.assertedBy ? n.assertedBy.displayName : 'a newer source'); }
    if (a.status === 'superseded') return 'superseded';
    if (a.validityCondition && a.conditionedBy && byClaim[a.conditionedBy]) { var c = byClaim[a.conditionedBy]; return 'bounded ' + when(c.validFrom) + ' by ' + (c.assertedBy ? c.assertedBy.displayName : 'a note') + ' · holds for ' + a.validityCondition; }
    if (a.validityCondition) return 'holds while ' + a.validityCondition;
    if (a.status === 'contradicted' || a.status === 'retracted' || a.status === 'corrected') return a.status;
    if (a.validTo) return 'until ' + when(a.validTo);
    return 'still believed true';
  }
  document.getElementById('switch').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var v = document.getElementById('entity').value.trim();
    if (v) location.search = '?' + q({ entity: v, principalId: principalId });
  });
  function loadViewer() {
    return Promise.all([get('/settings').catch(function () { return {}; }), get('/directory').catch(function () { return []; })]).then(function (r) {
      var id = principalId || (r[0] && r[0].currentPersonEntityId) || '';
      var person = (r[1] || []).filter(function (d) { return d.personEntityId === id; })[0];
      principal = person ? { id: person.personEntityId, displayName: person.name, groups: person.groups, type: 'human' } : { id: id || 'context-page', displayName: id || 'Anonymous', groups: [], type: 'human' };
      if (!principalId && person) principalId = person.personEntityId;
      document.getElementById('viewer').textContent = 'Viewing as ' + (person ? person.name : 'anonymous (organization-wide knowledge only)') + '. Access is checked on every request.';
    });
  }
  function build() {
    byClaim = {};
    var items = [], seen = {};
    data.assertions.forEach(function (a) {
      byClaim[a.claimId] = a;
      if (!seen[a.source.evidenceId]) { seen[a.source.evidenceId] = 1; items.push({ id: a.source.evidenceId, position: a.source.position, thread: a.source.thread, stop: true }); }
      if (a.validTo && a.validTo.kind === 'known') items.push({ id: 'to:' + a.claimId, position: a.validTo });
    });
    layout = layoutTimeAxis(items, { x0: 0, x1: 1000, firstDated: data.earliestDated });
    stopIndex = layout.stops.length - 1;
    slider.max = String(Math.max(0, layout.stops.length - 1));
    slider.value = String(stopIndex);
  }
  function drawRows(validAt) {
    var sorted = data.assertions.slice().sort(function (a, b) { return (a.validFrom.sequence || 0) - (b.validFrom.sequence || 0); });
    // One row per sentence: claims read from the same words (an action and a condition, say) share it.
    var groups = [], at = {};
    sorted.forEach(function (a) {
      var k = (a.excerpt || a.statement) + '|' + a.source.evidenceId;
      if (at[k] === undefined) { at[k] = groups.length; groups.push({ a: a, types: [a.type], ids: [a.claimId] }); }
      else { var g = groups[at[k]]; if (g.types.indexOf(a.type) < 0) g.types.push(a.type); g.ids.push(a.claimId); }
    });
    rows.innerHTML = groups.length ? groups.map(function (g) {
      var a = g.a;
      var on = validAt ? g.ids.some(function (id) { return validAt[id] !== false; }) : a.validAt;
      return '<tr class="' + (on ? '' : 'off') + '"><td class="type">' + esc(g.types.join(' · ')) + '</td><td class="st">' + esc(a.excerpt || a.statement) + '</td><td class="when">' + esc(when(a.validFrom)) + '</td><td class="when">' + esc(statusOf(a)) + '</td><td class="who">' + esc([a.assertedBy ? a.assertedBy.displayName : '', provider(a.source.provider)].filter(Boolean).join(' · ')) + '</td></tr>';
    }).join('') : '<tr><td colspan="5" class="meta">Nothing visible to you is bound to ' + esc(data.entity.name) + '.</td></tr>';
  }
  function refresh() {
    var s = layout.stops[stopIndex], mine = ++seq;
    tlabel.textContent = stopIndex === layout.stops.length - 1 ? 'now' : s.label;
    get('/context?' + q({ entity: entityName, at: s.at, principalId: principalId })).then(function (v) {
      if (mine !== seq) return;
      var validAt = {};
      v.assertions.forEach(function (a) { validAt[a.claimId] = a.validAt; });
      drawRows(validAt);
    }).catch(function () {});
    ask();
  }
  function ask() {
    var s = layout.stops[stopIndex], key = String(stopIndex), mine = seq;
    var render = function (r) {
      if (mine !== seq) return;
      var rec = r.recommendation;
      var html = '<p class="rtext">' + esc(rec.text || 'Nothing on file.') + '</p>';
      html += '<p class="meta">' + esc(rec.kind === 'none' ? 'nothing to reuse' : rec.kind) + (rec.applicability && !/\\s/.test(rec.applicability) ? ' · ' + esc(rec.applicability) : '') + (r.provenance ? ' · ' + esc(r.provenance.text) : '') + '</p>';
      var more = (rec.caveats || []).slice(0, 4).concat(rec.nextStep ? ['Next: ' + rec.nextStep] : []);
      if (more.length) html += '<details><summary>Details</summary>' + more.map(function (c) { return '<p>' + esc(c) + '</p>'; }).join('') + '</details>';
      told.innerHTML = html;
    };
    if (cache[key]) return render(cache[key]);
    told.innerHTML = '<p class="meta">Asking…</p>';
    var body = { text: problemText, principal: principal, entityIds: [data.entity.id], allowQuestions: false, preview: true };
    if (s.at) body.at = s.at;
    if (s.atEvidence) body.atEvidence = s.atEvidence;
    post('/investigate', body).then(function (r) { cache[key] = r; render(r); }).catch(function (e) { if (mine === seq) told.innerHTML = '<p class="err">' + esc(e.message) + '</p>'; });
  }
  slider.addEventListener('input', function () { stopIndex = Number(slider.value); refresh(); });
  loadViewer().then(function () {
    return get('/context?' + q({ entity: entityName, principalId: principalId }));
  }).then(function (v) {
    data = v;
    document.getElementById('ename').textContent = v.entity.name;
    build();
    drawRows(null);
    refresh();
  }).catch(function (e) {
    rows.innerHTML = '<tr><td colspan="5" class="err">' + esc(e.message) + '</td></tr>';
    told.innerHTML = '';
  });
})();
</script>
</body>
</html>
`;
}
