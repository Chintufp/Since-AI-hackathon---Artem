const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const path = require('path');
app.commandLine.appendSwitch('force-device-scale-factor', '2');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 960, height: 760, show: false });
  await w.webContents.session.clearCache();
  await w.loadURL('http://127.0.0.1:47912/index.html?mock=1');
  const out = process.argv[2]; fs.mkdirSync(out, { recursive: true });
  const js = (c) => w.webContents.executeJavaScript(c);
  await new Promise((r) => setTimeout(r, 3500));   // entrance settles
  await js(`document.body.style.background='#d9dbe1';document.documentElement.style.background='#d9dbe1'`);
  // the mock's own labels -> what the film machine shows
  await js(`setInterval(()=>{const s=document.querySelector('.rf-server'); if(s) s.textContent='http://127.0.0.1:47831';
    const v=document.querySelector('.rf-view[data-view=admin]'); if(!v) return;
    v.querySelectorAll('.rf-setting, .rf-option, div').forEach(r=>{ if(/cost/i.test(r.firstElementChild?.textContent||'') && r.closest('.rf-view')===v && r.children.length<6) r.style.display='none'; });
    v.querySelectorAll('select, .rf-you, button, span').forEach(e=>{ if(/Dev User/.test(e.textContent)) { if(e.tagName==='SELECT'){ const o=e.options[e.selectedIndex]; if(o) o.textContent='Artem Sergeyev · Field engineer'; } else if(!e.children.length) e.textContent=e.textContent.replace(/Dev User · [^˅]*/, 'Artem Sergeyev · Field engineer'); } });
  },30)`);
  const steps = [[300, null], [750, `document.querySelector('.rf-avatar').click()`], [620, `document.querySelector('.rf-footer [data-action=settings]').click()`],
    [480, `document.querySelector('.rf-view[data-view=settings] [data-action=admin]').click()`], [4200, `document.querySelector('.rf-view[data-view=admin] [data-action=connections]').click()`]];
  const log = []; let i = 0; const t0 = Date.now();
  for (const [ms, act] of steps) {
    if (act) await js(act);
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const img = await w.webContents.capturePage();
      const f = String(i++).padStart(5, '0') + '.jpg';
      fs.writeFileSync(path.join(out, f), img.toJPEG(92)); log.push([f, (Date.now() - t0) / 1000]);
    }
  }
  fs.writeFileSync(path.join(out, 'times.json'), JSON.stringify(log));
  app.quit();
});
