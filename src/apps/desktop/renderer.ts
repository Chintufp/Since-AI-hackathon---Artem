/** Renderer: composes the v008 panel (ui) with Lumi (motion) against the service API. */
import { AvatarController } from '../../libs/utils/motion/index.ts';
import { createApiClient, createMockFetch, createPanel, MOCK_BASE_URL, type MockModelsScenario } from '../../libs/utils/ui/index.ts';
import type { Panel } from '../../libs/utils/ui/index.ts';
import { inRect, nearRects, parseFlags, pinsPress, RENDERER_EVENTS, toHitRect } from './flags.ts';
import type { Area, DesktopFlags, HitRect, PowerEvent, ShellCommand, ShellState } from './flags.ts';

interface KtBridge {
  serviceUrl: string;
  platform: string;
  setIgnoreMouse(flag: boolean): void;
  onShow(cb: () => void): void;
  // desktop (R31..R36)
  flags?: DesktopFlags;
  onCommand?(cb: (command: ShellCommand) => void): void;
  onPower?(cb: (event: PowerEvent) => void): void;
  onArea?(cb: (area: Area) => void): void;
  reportState?(state: ShellState): void;
  showContextMenu?(): void;
  // B2
  saveModelKey?(vendor: 'anthropic' | 'gemini', key: string): Promise<{ present: boolean; stored: boolean }>;
  // B3
  openContext?(entityName: string): void;
}
declare global {
  interface Window {
    kt?: KtBridge;
    __kt?: { panel: Panel; errors: string[]; setFailing(flag: boolean): void; setModelsScenario(scenario: MockModelsScenario): void };
    /** desktop (R31..R36): the parsed flags, read by the companion module (no Electron import there). */
    __ktFlags?: Readonly<DesktopFlags>;
  }
}

const params = new URLSearchParams(location.search);
// desktop (R31..R36): flags arrive as query params (main.ts flagsToQuery); missing params = defaults.
const flags: Readonly<DesktopFlags> = Object.freeze(parseFlags(params));
window.__ktFlags = flags;
if (flags.texture) document.getElementById('kt-panel')!.dataset.ktTexture = 'crosses'; // desktop (R44, trial)
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
  // desktop (R32): the floor-shadow strip goes with the drop surface; the companion (ui/companion.ts) runs from the flags.
  avatar: (canvas, host, surfaces) => new AvatarController(canvas, host, { drop: surfaces.drop, shadow: surfaces.shadow }),
  groups: params.get('groups')?.split(',').filter(Boolean),
  storage: shots ? null : undefined,
  entrance: params.get('entrance') !== '0',
  companion: flags,
  // B2: api keys go through the main process (safeStorage); the mock keeps them in the mock service's memory.
  keychain: !mock && window.kt?.saveModelKey ? { save: (vendor, key) => window.kt!.saveModelKey!(vendor, key) } : null,
  // B3: the case view's "Open the context layer" (hidden without the bridge, and in mock mode where there is no page).
  openContext: !mock && window.kt?.openContext ? (name) => window.kt!.openContext!(name) : null,
});

// Click-through: the window is transparent; only Lumi and the open panel take the mouse.
// desktop (R31): O(1) hit test against two cached rects instead of elementFromPoint. The rects are recomputed
// when the companion moves the carrier or the panel spring settles (`kt-companion:moved`), on resize, and, as a
// fallback, at most once per MEASURE_FALLBACK_MS on mousemove: always without the companion (nothing dispatches
// `moved` then), otherwise only within MEASURE_NEAR_PX of his / the panel's rects (shell-12: a mousemove flood far
// from him no longer forces layout reads).
const MEASURE_FALLBACK_MS = 100;
const companionMoves = flags.companion && flags.windowMode === 'area';
/** Resend an unchanged ignore state after this long: main may have forced click-through on its own (blur, lock). */
const IGNORE_RESEND_MS = 1000;
const root = document.getElementById('kt-panel')!;
let avatarRect: HitRect | null = null;
let surfaceRect: HitRect | null = null;
let measuredAt = -Infinity;
const measure = (): void => {
  measuredAt = performance.now();
  const avatar = root.querySelector<HTMLElement>('.rf-avatar');
  avatarRect = avatar ? toHitRect(avatar.getBoundingClientRect()) : null;
  const surface = root.querySelector<HTMLElement>('.rf-surface');
  // panel-motion hides the closed surface (visibility hidden, pointer-events none while closing).
  const open = !!surface && surface.style.pointerEvents !== 'none' && surface.style.visibility !== 'hidden';
  surfaceRect = open ? toHitRect(surface.getBoundingClientRect()) : null;
};
const overInteractive = (x: number, y: number): boolean => inRect(avatarRect, x, y) || inRect(surfaceRect, x, y);

let ignoring: boolean | null = null;
let sentAt = 0;
const setIgnore = (flag: boolean): void => {
  const now = performance.now();
  if (flag === ignoring && now - sentAt < IGNORE_RESEND_MS) return;
  ignoring = flag;
  sentAt = now;
  window.kt?.setIgnoreMouse(flag);
};
// desktop (R32): pinned between pointerdown on Lumi and pointerup / pointercancel / lostpointercapture.
// shell-03: only a plain primary press pins; a right-click / ctrl-click opens the menu, whose tracking loop eats
// the release, and `contextmenu` drops any pin so the next mousemove re-runs the hit test.
let pinned = false;
let last: { x: number; y: number } | null = null;
const check = (): void => {
  if (pinned) return;
  setIgnore(!last || !overInteractive(last.x, last.y));
};
const track = (e: MouseEvent): void => {
  last = { x: e.clientX, y: e.clientY };
  if (pinned) return;
  if (performance.now() - measuredAt >= MEASURE_FALLBACK_MS && (!companionMoves || nearRects([avatarRect, surfaceRect], e.clientX, e.clientY))) measure();
  check();
};
document.addEventListener('mousemove', track, { passive: true });
document.addEventListener('dragover', track, { passive: true });
document.documentElement.addEventListener('mouseleave', () => {
  last = null;
  check();
});
window.addEventListener(
  'pointerdown',
  (e) => {
    if (!pinsPress(e) || !(e.target instanceof Element) || !e.target.closest('.rf-avatar')) return;
    last = { x: e.clientX, y: e.clientY };
    pinned = true;
    ignoring = null; // force the send
    setIgnore(false);
  },
  { capture: true, passive: true },
);
const unpin = (e: PointerEvent): void => {
  last = { x: e.clientX, y: e.clientY };
  if (!pinned) return;
  pinned = false;
  measure();
  check();
};
for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) window.addEventListener(type, unpin, { capture: true, passive: true });
window.addEventListener(
  'contextmenu',
  () => {
    pinned = false;
    ignoring = null; // the menu may leave main's state unknown: resend on the next check
  },
  { capture: true, passive: true },
);
const remeasure = (): void => {
  measure();
  check();
};
window.addEventListener(RENDERER_EVENTS.moved, remeasure);
window.addEventListener('resize', remeasure);
// The window lost focus or main forced click-through: forget the cached state and drop a stale pin.
// shell-06: and the stale pointer position (the next real mousemove decides).
window.addEventListener('blur', () => {
  pinned = false;
  ignoring = null;
  last = null;
});

// desktop (R31..R36): main → page as CustomEvents on window, so the companion module never imports Electron.
const emit = <T>(type: string, detail: T): void => {
  window.dispatchEvent(new CustomEvent<T>(type, { detail }));
};
window.kt?.onCommand?.((command) => emit(RENDERER_EVENTS.command, { command }));
window.kt?.onPower?.((event) => {
  if (event === 'lock-screen') {
    pinned = false;
    ignoring = null;
  }
  emit(RENDERER_EVENTS.power, { event });
});
window.kt?.onArea?.((area) => {
  emit(RENDERER_EVENTS.area, { width: area.width, height: area.height });
  remeasure();
});
// page → main: the companion reports {away, question} and asks for the right-click menu.
window.addEventListener(RENDERER_EVENTS.state, (e) => {
  const d = (e as CustomEvent<Partial<ShellState> | undefined>).detail;
  window.kt?.reportState?.({ away: d?.away === true, question: d?.question === true });
});
window.addEventListener(RENDERER_EVENTS.contextMenu, () => window.kt?.showContextMenu?.());

window.kt?.onShow(() => {
  void panel.refresh();
  ignoring = null;
  last = null; // shell-06: the pre-hide pointer position must not un-ignore the whole work area
  remeasure();
});
measure();
if (params.get('open') === '1') panel.open();
if (shots) window.__kt = { panel, errors, setFailing: (flag) => (failing = flag), setModelsScenario: (scenario) => mockFetch.setModelsScenario(scenario) };
