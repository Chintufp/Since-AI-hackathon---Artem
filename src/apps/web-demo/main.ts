/**
 * Web preview: the real Lumi panel and companion in a browser tab, against the in-page mock API (sample data,
 * no service). Every write is answered by the mock so the UI moves, and a notice says the real engine runs
 * locally or on the organisation's server. Model downloads and API keys are refused outright.
 */
import { AvatarController } from '../../libs/utils/motion/index.ts';
import { createApiClient, createMockFetch, createPanel, MOCK_BASE_URL } from '../../libs/utils/ui/index.ts';
import type { FetchLike } from '../../libs/utils/ui/index.ts';
import { DEFAULT_FLAGS } from '../desktop/flags.ts';

const flags = Object.freeze({ ...DEFAULT_FLAGS, demo: true, shortcut: false });
(window as unknown as { __ktFlags: typeof flags }).__ktFlags = flags;

const toast = document.getElementById('demo-toast')!;
let toastTimer = 0;
const notify = (text: string): void => {
  toast.textContent = text;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 4200);
};

const WHAT: Array<[RegExp, string]> = [
  [/\/investigate$/, 'Search and matching'],
  [/\/import$/, 'Capturing a conversation'],
  [/\/questions\/[^/]+\/(answer|defer|dismiss|undo|cancel)$/, 'Your answer'],
  [/\/contact-draft$/, 'Drafting a message'],
  [/\/(observations|outcomes)$/, 'Recording an outcome'],
  [/\/settings$/, 'Settings'],
  [/\/participation\//, 'Points'],
];

const mockFetch = createMockFetch({ demo: true });
const previewFetch: FetchLike = (url, init) => {
  const method = (init?.method ?? 'GET').toUpperCase();
  const path = String(url).replace(MOCK_BASE_URL, '').split('?')[0];
  if (method !== 'GET') {
    if (path.startsWith('/models/')) {
      notify('Models are installed on your own machine or server, so they can’t be set up in this preview.');
      return Promise.reject(new TypeError('Not available in the web preview'));
    }
    const what = WHAT.find(([rx]) => rx.test(path))?.[1] ?? 'This action';
    notify(`${what} runs on Lumi’s engine, which lives on your machine or your organisation’s server. Here you see sample data.`);
  }
  return mockFetch(url, init);
};

const api = createApiClient({ baseUrl: MOCK_BASE_URL, kind: 'mock', fetch: previewFetch });
const panel = createPanel({
  root: document.getElementById('kt-panel')!,
  api,
  avatar: (canvas, host, surfaces) => new AvatarController(canvas, host, { drop: surfaces.drop, shadow: surfaces.shadow }),
  storage: null,
  entrance: true,
  companion: flags,
  demo: true,
  keychain: null,
  openContext: null,
});

document.getElementById('demo-open')?.addEventListener('click', () => panel.open());
