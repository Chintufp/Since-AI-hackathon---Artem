const { app, BrowserWindow } = require('electron');
const fs = require('fs'); const path = require('path');
app.commandLine.appendSwitch('force-device-scale-factor', '1.5');
app.whenReady().then(async () => {
  const w = new BrowserWindow({ width: 1280, height: 832, show: false, useContentSize: true });
  await w.loadFile(process.argv[2]);
  const out = process.argv[3], T = parseFloat(process.argv[4]), fps = 30, only = process.argv[5];
  fs.mkdirSync(out, { recursive: true });
  const times = only ? only.split(',').map(Number) : Array.from({ length: Math.ceil(T * fps) }, (_, i) => i / fps);
  for (let i = 0; i < times.length; i++) {
    await w.webContents.executeJavaScript(`setT(${times[i]})`);
    await new Promise((r) => setTimeout(r, 12));
    fs.writeFileSync(path.join(out, (only ? 'at_' + times[i] : String(i).padStart(5, '0')) + '.jpg'), (await w.webContents.capturePage()).toJPEG(90));
  }
  app.quit();
});
