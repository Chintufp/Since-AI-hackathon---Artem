/** Renderer: composes the v008 panel (ui) with Snowbally (motion) against the service API. */
import { AvatarController } from '../../libs/utils/motion/index.ts';
import { createApiClient, createMockFetch, createPanel, MOCK_BASE_URL } from '../../libs/utils/ui/index.ts';
import type { Panel } from '../../libs/utils/ui/index.ts';

interface KtBridge {
  serviceUrl: string;
  platform: string;
  setIgnoreMouse(flag: boolean): void;
  onShow(cb: () => void): void;
}
declare global {
  interface Window {
    kt?: KtBridge;
    __kt?: { panel: Panel; errors: string[]; setFailing(flag: boolean): void };
  }
}

const params = new URLSearchParams(location.search);
const mock = params.get('mock') === '1';
const shots = params.get('shots') === '1';
const errors: string[] = [];
window.addEventListener('error', (e) => errors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => errors.push('unhandledrejection: ' + String(e.reason)));
if (shots) document.body.classList.add('shots');

// Dev mock (?mock=1): the real ApiClient over an in-renderer fake fetch. `failing` lets the screenshot
// harness show the unreachable-service state.
let failing = false;
const mockFetch = createMockFetch();
const api = mock
  ? createApiClient({ baseUrl: MOCK_BASE_URL, kind: 'mock', fetch: (u, i) => (failing ? Promise.reject(new TypeError('mock: service unreachable')) : mockFetch(u, i)) })
  : createApiClient({ baseUrl: window.kt?.serviceUrl ?? 'http://127.0.0.1:47831' });
const panel = createPanel({
  root: document.getElementById('kt-panel')!,
  api,
  avatar: (canvas, host, surfaces) => new AvatarController(canvas, host, { drop: surfaces.drop }),
  groups: params.get('groups')?.split(',').filter(Boolean),
  storage: shots ? null : undefined,
  entrance: params.get('entrance') !== '0',
});

// Click-through: the window is transparent; only Snowbally and the open panel take the mouse.
let ignoring: boolean | null = null;
const setIgnore = (flag: boolean): void => {
  if (flag === ignoring) return;
  ignoring = flag;
  window.kt?.setIgnoreMouse(flag);
};
const overInteractive = (x: number, y: number): boolean => !!document.elementFromPoint(x, y)?.closest('.rf-avatar, .rf-surface');
document.addEventListener('mousemove', (e) => setIgnore(!overInteractive(e.clientX, e.clientY)), { passive: true });
document.addEventListener('dragover', (e) => setIgnore(!overInteractive(e.clientX, e.clientY)), { passive: true });
document.documentElement.addEventListener('mouseleave', () => setIgnore(true));

window.kt?.onShow(() => {
  void panel.refresh();
});
if (params.get('open') === '1') panel.open();
if (shots) window.__kt = { panel, errors, setFailing: (flag) => (failing = flag) };
