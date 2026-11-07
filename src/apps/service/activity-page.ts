/**
 * B6: the label the simulated day carries on the second screen, always visible (a sticky banner with the simulated
 * clock). It appears on this page only: the companion panel shows real-time state and never this label or that clock.
 */
export const SIMULATED_DAY_LABEL = 'Simulated day';

/**
 * Standalone page for a browser tab next to the companion. Same type scale and palette as the panel (Inter, #252729
 * text, white 16 px cards); plain HTML, no framework, polls the JSON route every two seconds.
 */
export function activityPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Knowledge Twin · simulated activity</title>
<style>
  :root { color-scheme: light; }
  html, body { margin: 0; background: #ebecee; color: #252729; font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
  main { max-width: 720px; margin: 0 auto; padding: 24px 16px 48px; }
  header { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin: 0 0 14px; }
  h1 { font-size: 19px; font-weight: 500; letter-spacing: -.035em; margin: 0; }
  .meta { font-size: 11px; color: #838990; letter-spacing: .025em; }
  .badge { display: inline-block; font-size: 11px; color: #74777b; background: #f4f5f5; border-radius: 5px; padding: 4px 7px; margin-left: 6px; }
  .card { background: #fff; border: 1px solid #e3e4e5; border-radius: 16px; box-shadow: 0 7px 20px #22242b08, 0 1px 3px #22242b05; padding: 6px 24px; margin: 0 0 12px; }
  .intro { font-size: 12px; color: #676e74; line-height: 1.45; padding: 14px 0; }
  .row { display: grid; grid-template-columns: 52px 1fr; gap: 12px; padding: 12px 0; border-top: 1px solid #f0f1f2; }
  .row:first-child { border-top: 0; }
  .time { font-size: 11px; color: #838990; letter-spacing: .025em; padding-top: 3px; font-variant-numeric: tabular-nums; }
  .text { font-size: 14px; line-height: 1.45; letter-spacing: -.01em; }
  .why { font-size: 12px; color: #676e74; line-height: 1.45; margin-top: 3px; }
  .kind { font-size: 11px; color: #838990; letter-spacing: .025em; margin-top: 4px; }
  .row[data-kind="question"] .text::before { content: "?"; display: inline-block; width: 16px; color: #8b939a; }
  .row[data-kind="answer"] .text::before { content: "·"; display: inline-block; width: 16px; color: #8b939a; }
  .row[data-kind="points"] .text::before { content: "+"; display: inline-block; width: 16px; color: #8a7330; }
  .row[data-foryou="true"] { background: #f7f8f8; margin: 0 -24px; padding-left: 24px; padding-right: 24px; }
  .row[data-foryou="true"] .kind { color: #303438; }
  .empty { font-size: 13px; color: #7f8489; padding: 18px 0; }
  .cost { padding: 14px 0; }
  .cost-title { font-size: 11px; color: #838990; letter-spacing: .025em; margin: 0 0 4px; }
  .cost-line { font-size: 14px; line-height: 1.45; letter-spacing: -.01em; margin: 0; font-variant-numeric: tabular-nums; }
  .cost-store { font-size: 12px; color: #676e74; line-height: 1.45; margin: 4px 0 0; font-variant-numeric: tabular-nums; }
  .sim { position: sticky; top: 0; z-index: 1; display: flex; align-items: baseline; gap: 10px; flex-wrap: wrap; background: #303336; color: #fff; border-radius: 0 0 12px 12px; padding: 9px 16px; margin: 0 0 14px; font-size: 13px; letter-spacing: -.01em; }
  .sim b { font-weight: 600; }
  .sim .sim-clock { font-variant-numeric: tabular-nums; }
  .sim .sim-note { font-size: 11px; color: #c9cdd1; letter-spacing: .025em; }
  @media (max-width: 480px) { main { padding: 16px 16px 40px; } .row { grid-template-columns: 44px 1fr; gap: 8px; } }
</style>
</head>
<body>
<main>
  <div class="sim" id="sim" role="note" aria-label="${SIMULATED_DAY_LABEL}: not real people, not real time"><b>${SIMULATED_DAY_LABEL}</b><span class="sim-clock" id="sim-clock">clock not read yet</span><span class="sim-note">not real people, not real time · the companion shows real time only</span></div>
  <header>
    <h1>Simulated activity<span class="badge">simulated · local · no model calls</span></h1>
    <div class="meta" id="meta">waiting for the stream…</div>
  </header>
  <section class="card">
    <p class="intro">A scripted day, sped up: chats and e-mails arrive, simulated engineers ask the service, the real question coordinator picks who to ask (within daily limits, cooldowns and access rules) and simulated colleagues answer after a while. Nothing here is a real person; rows marked <b>for you</b> involve the person chosen under Settings → You in the companion.</p>
  </section>
  <section class="card" id="cost" hidden aria-live="polite"><div class="cost"><p class="cost-title" id="cost-title">Cost</p><p class="cost-line" id="cost-line"></p><p class="cost-store" id="cost-store"></p></div></section>
  <section class="card" id="rows"><p class="empty">No activity yet. Start <code>pnpm demo:play</code> (or <code>pnpm demo:judge</code>).</p></section>
</main>
<script>
(function () {
  var rowsEl = document.getElementById('rows'), metaEl = document.getElementById('meta'), simClockEl = document.getElementById('sim-clock');
  var seen = 0, started = false;
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]; }); }
  function hhmm(iso) { var d = new Date(iso); if (isNaN(d)) return ''; return d.toTimeString().slice(0, 5); }
  function render(rows) {
    if (!started) { rowsEl.innerHTML = ''; started = true; }
    rows.forEach(function (r) {
      var div = document.createElement('div');
      div.className = 'row'; div.dataset.kind = r.kind; div.dataset.foryou = r.forYou ? 'true' : 'false';
      var who = r.who ? '<span class="kind">' + esc(r.who) + (r.forYou ? ' · for you' : '') + '</span>' : (r.forYou ? '<span class="kind">for you</span>' : '');
      div.innerHTML = '<div class="time">' + esc(hhmm(r.at)) + '</div><div><div class="text">' + esc(r.text) + '</div>' + (r.why ? '<div class="why">' + esc(r.why) + '</div>' : '') + who + '</div>';
      rowsEl.appendChild(div);
    });
    if (rows.length) window.scrollTo(0, document.body.scrollHeight);
  }
  // B3: Erkki's cost and the store line (GET /costs, from store records, not from this log), in the same tick.
  function cost() {
    fetch('/costs', { cache: 'no-store' }).then(function (r) { if (!r.ok) throw new Error(); return r.json(); }).then(function (c) {
      document.getElementById('cost-title').textContent = c.name + "'s cost" + (c.seconds.clock === 'simulated' ? ' · simulated seconds' : '');
      document.getElementById('cost-line').textContent = 'asked ' + c.asked + ' · answered ' + c.answered + ' · deferred ' + c.deferred + ' · ' + Math.round(c.seconds.total) + ' s spent · reused ' + c.reuse.total + ' times (' + c.reuse.people + ' by people, ' + c.reuse.agents + ' by agents)';
      document.getElementById('cost-store').textContent = c.storeHealth ? c.storeHealth.line : '';
      document.getElementById('cost').hidden = false;
    }).catch(function () {});
  }
  function tick() {
    cost();
    fetch('/demo/activity?since=' + seen, { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (a) {
      if (a.rows.length) { render(a.rows); seen = a.rows[a.rows.length - 1].seq; }
      fetch('/demo/clock', { cache: 'no-store' }).then(function (r) { return r.json(); }).then(function (c) {
        metaEl.textContent = (c.mode === 'simulated' ? 'simulated clock ' : 'real clock ') + hhmm(c.now) + ' · ' + a.total + ' rows' + (a.present ? '' : ' · log not found');
        simClockEl.textContent = c.mode === 'simulated' ? 'simulated ' + hhmm(c.now) + (c.rate ? ' · ' + Math.round(c.rate) + '× speed' : '') : 'not running · real clock ' + hhmm(c.now);
      }).catch(function () {});
    }).catch(function () { metaEl.textContent = 'service not reachable'; });
  }
  tick(); setInterval(tick, 2000);
})();
</script>
</body>
</html>
`;
}
