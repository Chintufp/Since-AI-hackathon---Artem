/** Preload: context isolation on; exposes only { serviceUrl, platform, setIgnoreMouse, onShow }. */
import { contextBridge, ipcRenderer } from 'electron';

const prefix = '--kt-service-url=';
const arg = process.argv.find((a) => a.startsWith(prefix));

contextBridge.exposeInMainWorld('kt', {
  serviceUrl: arg ? arg.slice(prefix.length) : 'http://127.0.0.1:47831',
  platform: process.platform,
  setIgnoreMouse: (flag: boolean): void => ipcRenderer.send('kt:ignore-mouse', !!flag),
  onShow: (cb: () => void): void => {
    ipcRenderer.on('kt:show', () => cb());
  },
});
