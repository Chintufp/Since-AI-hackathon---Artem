/**
 * Preload: context isolation on, sandboxed. Exposes only { serviceUrl, platform, setIgnoreMouse, onShow } plus
 * desktop (R31..R36): { flags, onCommand, onPower, onArea, reportState, showContextMenu }. Payloads are validated
 * on both sides; nothing else of Electron reaches the page.
 */
import { contextBridge, ipcRenderer } from 'electron';
import { IPC, isPowerEvent, isShellCommand, normaliseState, parseFlags } from './flags.ts';
import type { Area, PowerEvent, ShellCommand, ShellState } from './flags.ts';

const prefix = '--kt-service-url=';
const arg = process.argv.find((a) => a.startsWith(prefix));

contextBridge.exposeInMainWorld('kt', {
  serviceUrl: arg ? arg.slice(prefix.length) : 'http://127.0.0.1:47831',
  platform: process.platform,
  setIgnoreMouse: (flag: boolean): void => ipcRenderer.send(IPC.ignoreMouse, !!flag),
  onShow: (cb: () => void): void => {
    ipcRenderer.on(IPC.show, () => cb());
  },
  // desktop (R31..R36): the parsed flags (same query params the renderer parses).
  flags: Object.freeze(parseFlags(globalThis.location?.search ?? '')),
  onCommand: (cb: (command: ShellCommand) => void): void => {
    ipcRenderer.on(IPC.command, (_e, payload: { command?: unknown } | undefined) => {
      if (isShellCommand(payload?.command)) cb(payload.command);
    });
  },
  onPower: (cb: (event: PowerEvent) => void): void => {
    ipcRenderer.on(IPC.power, (_e, payload: { event?: unknown } | undefined) => {
      if (isPowerEvent(payload?.event)) cb(payload.event);
    });
  },
  onArea: (cb: (area: Area) => void): void => {
    ipcRenderer.on(IPC.area, (_e, payload: Partial<Area> | undefined) => {
      const width = Number(payload?.width), height = Number(payload?.height);
      if (width > 0 && height > 0) cb({ width, height });
    });
  },
  reportState: (state: ShellState): void => ipcRenderer.send(IPC.state, normaliseState(state)),
  showContextMenu: (): void => ipcRenderer.send(IPC.contextMenu),
});
