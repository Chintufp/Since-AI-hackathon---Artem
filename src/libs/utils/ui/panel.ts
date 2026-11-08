/**
 * The v008 panel as a factory. It renders into `root` (id "kt-panel"), talks to the service only
 * through an ApiClient and drives Lumi only through the Avatar interface.
 *
 * Views: input, question, queue, settings, receipt (v008) plus result, people, case and contact
 * (new, same visual language). Behaviour kept from app.js: avatar click toggles the panel and
 * restores view/draft/attachments/expanded context/selected node, Back-to-questions arrow,
 * Dismiss + Undo, Escape closes, Cmd/Ctrl+Enter sends, paste/drop attachments as chips,
 * reduced motion settles instantly, stationary avatar hitbox.
 */
import { modelNotes } from './model-notes.ts';
import { renderBurst, BURST } from '../motion/burst.ts';
import type { ActKey, AvatarHost, AvatarStatus, CompanionAvatar } from '../motion/avatar.ts';
import type { ParticipationOptIn, ParticipationRating, UserSettings } from '../contracts/outcomes.ts';
import type { DirectoryEntry, InstallJobView, ModelsView, Principal, PullJobView } from '../contracts/service.ts';
import type { ModelSlotName, ModelSlots, SlotChoice } from '../contracts/models.ts';
import type { ContactDraft } from '../contracts/questions.ts';
import type { CaseView, PersonView, QuestionView, ResultView, TimelineNode } from '../contracts/views.ts';
import { ApiError } from './api-client.ts';
import { detectPasteKind } from '../connectors/paste-thread.ts';
import type { ImportCaptured } from '../contracts/service.ts';
import type { ApiClient } from './api-client.ts';
import { hydrateIcons, iconSvg } from './icons.ts';
import { createPanelMotion } from './panel-motion.ts';
import { costRow, setProvenance } from './b3-rows.ts';
import { demoChips } from './demo-chips.ts';
import type { PanelMotion, PanelMotionStatus } from './panel-motion.ts';
import { attachCompanion, createCompanion } from './companion.ts';
import type { Companion, CompanionCommand, CompanionFlags, CompanionPower, CompanionStatus } from './companion.ts';
import { createAttention } from './attention.ts';
import type { Attention, EngagementCounters } from './attention.ts';
import { createQuestionWatch } from './question-watch.ts';
import type { QuestionWatch } from './question-watch.ts';
import { focusOptions, trackModality } from './focus.ts';
import type { InputModality } from './focus.ts';

export type ViewName = 'input' | 'question' | 'queue' | 'settings' | 'admin' | 'receipt' | 'result' | 'people' | 'case' | 'contact' | 'points' | 'connections' | 'models';
const RESTORABLE: ViewName[] = ['input', 'queue', 'settings'];
const BACK: Partial<Record<ViewName, ViewName>> = { admin: 'settings', result: 'input', people: 'result', case: 'people', contact: 'people', points: 'settings', connections: 'admin', models: 'admin' };
// B2: Settings -> Models.
type ApiVendorName = 'anthropic' | 'gemini';
const MODEL_SLOTS: ModelSlotName[] = ['embed', 'extract', 'phrase'];
const SLOT_TITLES: Record<ModelSlotName, string> = { embed: 'Find by meaning', extract: 'Read threads', phrase: 'Word questions' };
const SLOT_WHAT: Record<ModelSlotName, string> = {
  embed: 'Finds earlier cases described in other words. Rules: matching by spelling.',
  extract: 'Proposes claims from an imported thread; every claim must quote its message. Rules: the built-in extractor.',
  phrase: 'Rewords the one question asked; checked before use. Rules: the templates.',
};
const API_MODELS: Record<ModelSlotName, string[]> = { embed: ['none (falls back to rules)'], extract: ['claude-haiku-5-5', 'gemini-2.5-flash-lite'], phrase: ['claude-sonnet-5-5', 'gemini-2.5-flash-lite'] };
const KEY_PAGES: Record<ApiVendorName, string> = { anthropic: 'https://console.anthropic.com/settings/keys', gemini: 'https://aistudio.google.com/app/apikey' };
const PULL_POLL_MS = 1000;
const sizeLabel = (b: number): string => (b >= 1e9 ? `${(b / 1e9).toFixed(1)} GB` : `${Math.round(b / 1e6)} MB`);
const recommended = (v: ModelsView, slot: ModelSlotName): string => (v.catalog[slot].find((e) => e.recommended) ?? v.catalog[slot][0])?.model ?? '';
/** "all rules" or "local: find, read · hosted: word" for the Settings row. */
function modelsSummary(m: ModelSlots | undefined): string {
  if (!m) return 'all rules';
  const by = (p: SlotChoice['provider']) => MODEL_SLOTS.filter((s) => m[s].provider === p).map((s) => SLOT_TITLES[s].split(' ')[0]!.toLowerCase());
  const parts = [by('local').length ? `local: ${by('local').join(', ')}` : '', by('api').length ? `hosted: ${by('api').join(', ')}` : ''].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'all rules';
}

export interface PanelOptions {
  root: HTMLElement;
  api: ApiClient;
  /**
   * Build Lumi on the panel's canvas. The host callbacks let him react to panel state.
   * desktop (R31..R36): `surfaces.shadow` is the `.rf-shadow` floor strip (pass it as AvatarOptions.shadow).
   */
  avatar: (canvas: HTMLCanvasElement, host: AvatarHost, surfaces: { drop: HTMLCanvasElement; shadow: HTMLCanvasElement }) => CompanionAvatar;
  /** Groups for the principal; default comes from the shared contract's demo principal. */
  groups?: string[];
  /** Persist small per-viewer conveniences (draft, last view). Defaults to localStorage when available. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Plays the launch entrance (R05). Disable for tests/screenshots that want a still start. */
  entrance?: boolean;
  /**
   * desktop (B2): where an api key goes. The desktop passes the preload bridge (Electron safeStorage in the main
   * process, which hands the key to the service in memory); without it the key goes straight to POST /models/key
   * and lasts until the service restarts.
   */
  keychain?: { save(provider: 'anthropic' | 'gemini', key: string): Promise<{ present: boolean; stored: boolean }> } | null;
  /** B3: opens the Context Layer page for an entity name (desktop: the system browser). null/absent hides the button. */
  openContext?: ((entityName: string) => void) | null;
  /**
   * desktop (R31..R36): the companion flags (drag, away, gaze, fidgets). Default: `window.__ktFlags`
   * (set by the desktop renderer). null, `companion: false` or `windowMode: 'column'` = the R28 panel.
   */
  companion?: CompanionFlags | null;
  /**
   * B6: demo mode (desktop KT_DEMO, set by `pnpm demo:judge`): the "Be Veikko / Be Erkki" chips in the footer.
   * Default: `window.__ktFlags.demo`; absent = off, and the footer is the normal one.
   */
  demo?: boolean;
  /**
   * Film (two desktops on one service): this app's own person (entity id), kept on this app only, so two apps can be
   * two people. Picking "You" then changes only this app. Absent = the service-wide setting, as before.
   */
  person?: string;
  /** Film: the collapsed question poll in ms (default COLLAPSED_POLL_MS, 90 s). */
  questionPollMs?: number;
  /**
   * Film (KT_FILM_ARRIVE=1): Lumi starts away at the edge and, when he arrives with a new question, opens that
   * question's card by himself once he is at the perch (instead of waiting there for a click). Off by default.
   */
  filmArrive?: boolean;
}

/** desktop (R31..R36): harness / test surface of the companion (also `panel.status().companion`). */
export interface PanelCompanion {
  command(command: CompanionCommand): void;
  status(): CompanionStatus;
  /** Feed a pointer position (window CSS px; null = left the window), as mousemove does. */
  pointer(x: number | null, y?: number): void;
  power(event: CompanionPower): void;
  /** Make him arrive with `id` (default: the next eligible open question); true when he goes. */
  arrive(id?: string): boolean;
  /** Run the collapsed-poll refresh now. */
  poll(): Promise<void>;
  engagement(): EngagementCounters & { medianOpenDelayMs: number | null };
  setFidgets(on: boolean): void;
}

export interface PanelStatus {
  view: ViewName | 'collapsed';
  panelOpen: boolean;
  uiMotion: PanelMotionStatus;
  lastOpen: ViewName;
  openNodes: Record<string, string | null>;
  expanded: boolean;
  attachments: string[];
  draft: string;
  reduced: boolean;
  serviceDown: boolean;
  busy: boolean;
  openQuestions: number;
  /** Id of the investigation shown in the result view, when there is one. */
  investigationId?: string;
  avatar: AvatarStatus;
  /** desktop (R31..R36): the companion state (null when the companion is off). */
  companion: CompanionStatus | null;
  /** desktop (R34): an unseen question is waiting. */
  unseenQuestion: boolean;
}

export interface Panel {
  open(): void;
  close(): void;
  toggle(): void;
  status(): PanelStatus;
  /** Add files as attachment chips (same path as paste/drop). */
  attachFiles(files: File[]): void;
  /** Re-read settings and open questions (e.g. when the window is shown again). */
  refresh(): Promise<void>;
  /** desktop (R46): open the panel on a view (the harness captures the points view this way). */
  showView(view: 'input' | 'queue' | 'settings' | 'points'): void;
  /** Run the service connection check; used at startup and by Retry. */
  connect(): Promise<boolean>;
  /** desktop (R31..R36): companion hooks for the harness; null when the companion is off. */
  companion: PanelCompanion | null;
  destroy(): void;
}

/** B4: files "Remember this" reads as text; anything else (photos, PDFs) is never read. */
const TEXT_FILE = /\.(txt|eml|json|md)$/i;
const MAX_TEXT_BYTES = 1_000_000;
const isTextFile = (f: File): boolean => TEXT_FILE.test(f.name) || f.type.startsWith('text/') || f.type === 'message/rfc822' || f.type === 'application/json';

interface ReceiptAction {
  label: string;
  run: () => void;
}

export const TEMPLATE = `
<div class="rf-stage" data-view="input">
 <div class="rf-window">
  <div class="rf-motion-skin" aria-hidden="true"></div><div class="rf-texture" aria-hidden="true"></div>
  <div class="rf-surface"><div class="rf-content">
   <section class="rf-view rf-input" data-view="input" aria-label="Input">
    <textarea class="rf-writing" aria-label="Message to your companion" placeholder="Tell me what happened…"></textarea>
    <div class="rf-attachments" hidden></div><p class="rf-preview-note" hidden></p>
    <div class="rf-offer" hidden><button class="rf-chip rf-offer-chip" type="button" data-action="remember">Looks like a conversation · Remember this</button></div>
    <input class="rf-files" type="file" multiple aria-label="Attach files">
   </section>
   <section class="rf-view" data-view="question" hidden>
    <div class="rf-question">
     <p class="rf-case"></p><button class="rf-tool rf-close" type="button" data-action="queue" aria-label="Back to questions"><i data-icon="arrow-left"></i></button>
     <h2></h2><p class="rf-provenance" hidden></p>
     <textarea class="rf-free-text" aria-label="Your answer in your own words" placeholder="What did you see?" hidden></textarea>
     <div class="rf-responses"><button class="rf-answer" type="button" data-action="yes">Yes</button><button class="rf-answer" type="button" data-action="no">No</button></div>
     <div class="rf-secondary-responses"><button class="rf-later" type="button" data-action="unknown">Not sure</button><button class="rf-later" type="button" data-action="later">Later</button><span class="rf-spacer"></span><button class="rf-later" type="button" data-action="dismiss">Dismiss</button></div>
    </div>
    <div class="rf-reveal" id="kt-context" inert><div class="rf-history"></div></div>
    <button class="rf-context-button" type="button" data-action="context" aria-expanded="false" aria-controls="kt-context" data-open="false">Why this question?<i data-icon="chevron-down"></i></button>
   </section>
   <section class="rf-view rf-panel-content" data-view="queue" aria-label="Questions" hidden>
    <h2>Questions</h2><button class="rf-tool rf-close" type="button" data-action="input" aria-label="Back to input"><i data-icon="corner-up-left"></i></button>
    <div class="rf-queue-list rf-list-scroll"></div>
   </section>
   <section class="rf-view rf-panel-content" data-view="settings" aria-label="Settings" hidden>
    <h2>Settings</h2><button class="rf-tool rf-close" type="button" data-action="input" aria-label="Back to input"><i data-icon="corner-up-left"></i></button>
    <div class="rf-settings-rows">
     <label class="rf-setting rf-option"><span>Reduced motion</span><input class="rf-motion" type="checkbox"></label>
     <label class="rf-setting rf-option rf-desktop-companion" hidden><span>Fidgets</span><input class="rf-fidgets" type="checkbox"></label>
     <label class="rf-setting rf-option"><span>Sound</span><em class="rf-setting-note">No sounds yet</em><input class="rf-sound" type="checkbox" disabled aria-label="Sound (no sounds yet)"></label>
     <div class="rf-setting rf-option"><span>Points &amp; rating</span><button class="rf-later" type="button" data-action="points">Open</button></div>
     <div class="rf-setting rf-option rf-desktop-companion" hidden><span>Position</span><button class="rf-later" type="button" data-action="reset-position">Put Lumi back in the corner</button></div>
     <div class="rf-setting rf-option"><span>Admin</span><em class="rf-setting-note">who you are, server, models, MCP, data</em><button class="rf-later" type="button" data-action="admin">Open</button></div>
    </div>
   </section>
   <section class="rf-view rf-receipt" data-view="receipt" hidden aria-live="polite"><p class="rf-receipt-title"></p><div class="rf-receipt-detail"></div><div class="rf-reward" hidden><canvas width="${BURST.width}" height="${BURST.height}" aria-hidden="true"></canvas><span></span><button class="rf-later" type="button" data-action="points">See your points</button></div><button class="rf-undo" type="button" data-action="receipt-action">Undo</button></section>
   <section class="rf-view rf-panel-content rf-points-view" data-view="points" aria-label="Points and rating" hidden>
    <h2>Points &amp; rating</h2><button class="rf-tool rf-close" type="button" data-action="back" aria-label="Back"><i data-icon="arrow-left"></i></button>
    <div class="rf-settings-rows">
     <label class="rf-setting rf-option"><span>I take part in points</span><input class="rf-optin" type="checkbox"></label>
     <label class="rf-setting rf-option rf-points-display" hidden><span>Show +points in receipts</span><input class="rf-points" type="checkbox"></label>
    </div>
    <p class="rf-points-note"></p>
    <span class="rf-info" tabindex="0" role="note" aria-label="About points"><i>i</i><span class="rf-info-tip"></span></span>
    <div class="rf-points-body" hidden>
     <div class="rf-points-balance"><span class="rf-points-big"></span><span class="rf-points-meta"></span></div>
     <p class="rf-points-sub">Recent</p><div class="rf-points-events"></div>
     <p class="rf-points-sub">Participants</p><div class="rf-points-list"></div>
    </div>
   </section>
   <section class="rf-view rf-panel-content" data-view="admin" aria-label="Admin" hidden>
    <h2>Admin</h2><button class="rf-tool rf-close" type="button" data-action="back" aria-label="Back to settings"><i data-icon="arrow-left"></i></button>
    <div class="rf-settings-rows">
     <label class="rf-setting"><span>You</span><select class="rf-you" aria-label="Who you are"></select></label>
     <div class="rf-setting"><span>Server</span><span class="rf-setting-value rf-server rf-selectable"></span></div>
     <div class="rf-setting rf-cost-row" hidden><span class="rf-cost-label">Cost</span><span class="rf-cost"><span class="rf-cost-line"></span><small class="rf-cost-store"></small></span></div>
     <label class="rf-setting rf-option"><span>MCP</span><input class="rf-mcp" type="checkbox"></label>
     <div class="rf-setting rf-option"><span>Models</span><em class="rf-setting-note rf-models-summary"></em><button class="rf-later" type="button" data-action="models">Open</button></div>
     <div class="rf-setting rf-option"><span>Connections</span><button class="rf-later" type="button" data-action="connections">Open</button></div>
     <div class="rf-setting rf-option"><span>Demo data</span><button class="rf-later" type="button" data-action="reset-demo">Reset demo</button></div>
    </div>
   </section>
   <section class="rf-view rf-panel-content rf-connections-view" data-view="connections" aria-label="Connections" hidden>
    <h2>Connections</h2><button class="rf-tool rf-close" type="button" data-action="back" aria-label="Back"><i data-icon="arrow-left"></i></button>
    <p class="rf-conn-note">Channels Lumi will read as they are, through Nango. Nothing is connected yet.</p>
    <div class="rf-conn-grid"><button class="rf-conn" type="button" data-action="conn" data-conn="slack" aria-label="Slack (available soon)"><img class="rf-conn-logo" src="logos/slack.svg" alt=""><span class="rf-conn-name">Slack</span><span class="rf-conn-soon" aria-hidden="true">Available soon</span></button><button class="rf-conn" type="button" data-action="conn" data-conn="teams" aria-label="Microsoft Teams (available soon)"><img class="rf-conn-logo" src="logos/teams.svg" alt=""><span class="rf-conn-name">Microsoft Teams</span><span class="rf-conn-soon" aria-hidden="true">Available soon</span></button><button class="rf-conn" type="button" data-action="conn" data-conn="outlook" aria-label="Outlook mail (available soon)"><img class="rf-conn-logo" src="logos/outlook.svg" alt=""><span class="rf-conn-name">Outlook mail</span><span class="rf-conn-soon" aria-hidden="true">Available soon</span></button><button class="rf-conn" type="button" data-action="conn" data-conn="gmail" aria-label="Gmail (available soon)"><img class="rf-conn-logo" src="logos/gmail.svg" alt=""><span class="rf-conn-name">Gmail</span><span class="rf-conn-soon" aria-hidden="true">Available soon</span></button><button class="rf-conn" type="button" data-action="conn" data-conn="jira" aria-label="Jira (available soon)"><img class="rf-conn-logo" src="logos/jira.svg" alt=""><span class="rf-conn-name">Jira</span><span class="rf-conn-soon" aria-hidden="true">Available soon</span></button><button class="rf-conn" type="button" data-action="conn" data-conn="confluence" aria-label="Confluence (available soon)"><img class="rf-conn-logo" src="logos/confluence.svg" alt=""><span class="rf-conn-name">Confluence</span><span class="rf-conn-soon" aria-hidden="true">Available soon</span></button><button class="rf-conn" type="button" data-action="conn" data-conn="servicenow" aria-label="ServiceNow (available soon)"><img class="rf-conn-logo" src="logos/servicenow.svg" alt=""><span class="rf-conn-name">ServiceNow</span><span class="rf-conn-soon" aria-hidden="true">Available soon</span></button><button class="rf-conn" type="button" data-action="conn" data-conn="github" aria-label="GitHub (available soon)"><img class="rf-conn-logo" src="logos/github.svg" alt=""><span class="rf-conn-name">GitHub</span><span class="rf-conn-soon" aria-hidden="true">Available soon</span></button></div>
   </section>
   <section class="rf-view rf-panel-content rf-models-view" data-view="models" aria-label="Models" hidden>
    <h2>Models</h2><button class="rf-tool rf-close" type="button" data-action="back" aria-label="Back to settings"><i data-icon="arrow-left"></i></button>
    <p class="rf-models-note">Rules work with nothing installed. A local model runs on this Mac; a hosted one sends text over the internet and only runs with your key.</p>
    <div class="rf-models-body rf-list-scroll"></div>
   </section>
   <section class="rf-view rf-result" data-view="result" aria-label="Result" hidden>
    <div class="rf-result-head"><p class="rf-result-title"></p><p class="rf-provenance" hidden></p><div class="rf-result-notes"></div><button class="rf-tool rf-close" type="button" data-action="back" aria-label="Back to writing"><i data-icon="arrow-left"></i></button></div>
    <div class="rf-result-case"></div>
    <div class="rf-case-path rf-chain-big"></div>
    <div class="rf-result-rows"></div>
   </section>
   <section class="rf-view rf-panel-content" data-view="people" aria-label="People with relevant experience" hidden>
    <h2>People with relevant experience</h2><button class="rf-tool rf-close" type="button" data-action="back" aria-label="Back to result"><i data-icon="arrow-left"></i></button>
    <div class="rf-people-list rf-list-scroll"></div>
   </section>
   <section class="rf-view rf-panel-content" data-view="case" aria-label="Case" hidden>
    <p class="rf-case"></p><button class="rf-tool rf-close" type="button" data-action="back" aria-label="Back to people"><i data-icon="arrow-left"></i></button>
    <p class="rf-provenance" hidden></p>
    <div class="rf-case-body"></div>
   </section>
   <section class="rf-view rf-receipt" data-view="contact" aria-label="Message draft" hidden aria-live="polite">
    <button class="rf-tool rf-close" type="button" data-action="back" aria-label="Back to people"><i data-icon="arrow-left"></i></button>
    <p class="rf-receipt-title"></p><div class="rf-receipt-detail">Draft for you to review · nothing is sent</div>
    <p class="rf-draft-subject rf-selectable"></p><pre class="rf-draft-body rf-selectable"></pre>
    <div class="rf-draft-actions"><button class="rf-answer" type="button" data-action="copy-draft">Copy</button><button class="rf-later" type="button" data-action="back">Back</button></div>
   </section>
  </div>
  <footer class="rf-footer">
   <button class="rf-tool" type="button" data-action="attach" aria-label="Attach text, images or files"><i data-icon="paperclip"></i></button>
   <span class="rf-divider"></span>
   <button class="rf-tool" type="button" data-action="queue" aria-label="Open questions"><i data-icon="messages-square"></i><span class="rf-count"></span></button>
   <button class="rf-tool" type="button" data-action="settings" aria-label="Open settings"><i data-icon="sliders-horizontal"></i></button>
   <span class="rf-spacer"></span>
   <button class="rf-later rf-remember" type="button" data-action="remember" title="Store this text, thread or e-mail as knowledge (nothing is asked)" disabled>Remember this</button>
   <button class="rf-send" type="button" data-action="send" aria-label="Send message" disabled><i data-icon="arrow-up"></i></button>
  </footer>
  </div>
  <button class="rf-avatar" type="button" data-action="avatar" aria-label="Close panel" aria-expanded="true"><canvas width="44" height="44" role="img" aria-label="White pixel companion at rest"></canvas><canvas class="rf-drop" width="44" height="86" hidden aria-hidden="true"></canvas><canvas class="rf-shadow" width="44" height="8" aria-hidden="true"></canvas></button>
 </div>
</div>`;

const STORE_KEY = 'kt-panel.v1';
const POLL_MS = 20000;

/**
 * desktop (R35): reactions to the person's answer (named so it can be reverted in one place; the
 * v009 behaviour was `result` for all). Equal warmth for Yes / No; never yawn or sheepish here.
 * 'settle' = the composed 2-frame low settle (crouch, low). A points reward plays `hop` instead (opt-in).
 */
const REACTIONS: Record<'yes' | 'no' | 'unknown' | 'later' | 'dismiss' | 'undo', ActKey | 'settle'> = {
  yes: 'hello',
  no: 'hello',
  unknown: 'peek',
  later: 'peek',
  dismiss: 'settle',
  undo: 'peek',
};
const SETTLE_REACTION_MS = 62;

/** desktop (R31..R36): the flags the desktop renderer sets on window; elsewhere absent (companion off). */
const globalFlags = (): CompanionFlags | null => (globalThis as { __ktFlags?: CompanionFlags }).__ktFlags ?? null;

export function createPanel(options: PanelOptions): Panel {
  const { root, api } = options;
  root.id = 'kt-panel';
  root.innerHTML = TEMPLATE;
  hydrateIcons(root);

  const $ = <T extends HTMLElement = HTMLElement>(sel: string): T => {
    const el = root.querySelector<T>(sel);
    if (!el) throw new Error('kt-panel: missing ' + sel);
    return el;
  };
  const surface = $('.rf-surface'), content = $('.rf-content'), footer = $('.rf-footer'), stage = $('.rf-stage'), win = $('.rf-window');
  const field = $<HTMLTextAreaElement>('.rf-writing'), send = $<HTMLButtonElement>('.rf-send'), reveal = $('.rf-reveal');
  const rememberBtn = $<HTMLButtonElement>('.rf-remember'), offer = $('.rf-offer');
  const contextButton = $('.rf-context-button'), avatarButton = $('.rf-avatar'), canvas = $<HTMLCanvasElement>('.rf-avatar canvas');
  const views = [...root.querySelectorAll<HTMLElement>('.rf-view')];
  const viewEl = (name: ViewName): HTMLElement => views.find((v) => v.dataset.view === name)!;

  const media = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let systemReduced = !!media?.matches;

  const storage: Pick<Storage, 'getItem' | 'setItem'> | null = options.storage !== undefined ? options.storage : (() => { try { return globalThis.localStorage ?? null; } catch { return null; } })();
  const persisted = (() => { try { return JSON.parse(storage?.getItem(STORE_KEY) ?? 'null') as { draft?: string; lastOpen?: string } | null; } catch { return null; } })();
  const persist = (): void => { try { storage?.setItem(STORE_KEY, JSON.stringify({ draft: field.value, lastOpen: RESTORABLE.includes(state.lastOpen) ? state.lastOpen : 'input' })); } catch { /* optional */ } };

  const state = {
    view: (RESTORABLE.includes(persisted?.lastOpen as ViewName) ? persisted!.lastOpen : 'input') as ViewName,
    panelOpen: false,
    lastOpen: 'input' as ViewName,
    expanded: false,
    active: null as string | null,
    openNodes: { question: null, result: null, case: null } as Record<string, string | null>,
    points: false,
    reducedSetting: false,
    serviceDown: false,
    busy: false,
  };
  state.lastOpen = state.view;
  if (persisted?.draft) field.value = persisted.draft;

  let settings: UserSettings | null = null;
  let directory: DirectoryEntry[] = [];
  let attachments: File[] = [];
  let open: QuestionView[] = [];
  const cache = new Map<string, QuestionView>();
  let result: (ResultView & { state?: unknown }) | null = null;
  let caseView: CaseView | null = null;
  let draftText = '';
  let receiptAction: ReceiptAction | null = null;
  // desktop (R46): points. The opt-in is the person's own record on the service; `state.points` stays the device display switch.
  let pointsOptIn: ParticipationOptIn | null = null;
  let pointsRating: ParticipationRating | null = null;
  let pointsFrom: ViewName = 'settings';
  let pointsLoad = 0;
  let costsLoad = 0;
  // B2: Settings -> Models.
  let modelsView: ModelsView | null = null;
  let modelsError: string | null = null;
  let modelsLoad = 0;
  let installView: InstallJobView | null = null;
  const modelJobs = new Map<string, PullJobView>();
  const keyMessages = new Map<ApiVendorName, { ok: boolean; text: string }>();
  let modelTimers: Array<ReturnType<typeof setTimeout>> = [];
  let timers: Array<ReturnType<typeof setTimeout>> = [];
  let pollTimer: ReturnType<typeof setInterval> | 0 = 0;
  let destroyed = false;
  // desktop (ux fix M1): focus moved after a mouse action never shows the keyboard focus ring.
  const modality = trackModality(document);

  const isReduced = (): boolean => state.reducedSetting || systemReduced;
  // desktop (R31..R36): companion, attention and the collapsed question watch (null = the R28 panel).
  const companionFlags: CompanionFlags | null = (() => {
    const f = options.companion !== undefined ? options.companion : globalFlags();
    return f && f.companion && f.windowMode !== 'column' ? f : null;
  })();
  let attention: Attention | null = null;
  let companion: Companion | null = null;
  let selfOpened = false; // the card opened by itself (a question he came with), not by a click
  let detachMakeWay = (): void => {};
  let watch: QuestionWatch | null = null;
  let detachCompanion: () => void = () => {};
  const openIds = (): string[] => open.map((q) => q.questionId);
  const unseenWaiting = (): boolean => !!attention && attention.hasUnseen(openIds());
  // desktop (R34): with the companion the glyph also means "an unseen question is waiting".
  const hasQuestion = (): boolean => (state.panelOpen && state.view === 'question') || (!!companion && unseenWaiting());
  // Never invent an identity: without a resolved current person the panel neither lists nor answers questions.
  const hasIdentity = (): boolean => Boolean(settings?.currentPersonEntityId);
  /** Chosen directory person (id, name, groups from the directory); otherwise a clearly labeled guest. */
  const GUEST: Principal = { id: 'person:desktop:guest', displayName: 'Guest', groups: [], type: 'human' };
  const principal = (): Principal => {
    const id = settings?.currentPersonEntityId;
    if (!id) return { ...GUEST };
    const me = directory.find((d) => d.personEntityId === id);
    return { id, displayName: me?.name ?? 'You', groups: me ? [...me.groups] : [...(options.groups ?? [])], type: 'human' };
  };

  const shadowCanvas = $<HTMLCanvasElement>('.rf-shadow');
  const avatar = options.avatar(canvas, { reduced: isReduced, hasQuestion }, { drop: $<HTMLCanvasElement>('.rf-drop'), shadow: shadowCanvas });
  const natural = (): number => {
    const v = views.find((n) => !n.hidden);
    return (v?.getBoundingClientRect().height || 0) + footer.getBoundingClientRect().height + 2;
  };
  const motion: PanelMotion = createPanelMotion({
    surface, skin: $('.rf-motion-skin'), content, footer, canvas, reveal,
    history: () => reveal.querySelector<HTMLElement>('.rf-history'),
    naturalHeight: natural,
    reduced: isReduced,
  });

  // ---- helpers ----
  const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string): HTMLElementTagNameMap[K] => {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const later = (fn: () => void, ms: number): void => { const t = setTimeout(() => { timers = timers.filter((x) => x !== t); fn(); }, ms); timers.push(t); };

  function evidencePath(nodes: TimelineNode[], scope: string, label: string): HTMLOListElement {
    const path = el('ol', 'rf-evidence-path');
    path.setAttribute('aria-label', label);
    const opened = state.openNodes[scope] ?? null;
    nodes.forEach((node) => {
      const li = el('li', 'rf-evidence-node');
      li.dataset.kind = node.kind;
      const button = el('button', 'rf-node-title');
      button.type = 'button';
      button.dataset.action = 'node';
      button.dataset.node = node.id;
      button.dataset.scope = scope;
      const id = `kt-${scope}-${node.id}`;
      button.setAttribute('aria-controls', id);
      button.setAttribute('aria-expanded', String(opened === node.id));
      button.append(el('span', undefined, node.label));
      button.insertAdjacentHTML('beforeend', iconSvg('chevron-down'));
      const detail = el('div', 'rf-node-detail');
      detail.id = id;
      detail.dataset.node = node.id;
      detail.setAttribute('aria-hidden', String(opened !== node.id));
      const inner = el('div', 'rf-node-inner');
      inner.append(el('p', undefined, node.detail));
      const meta = [node.who, node.when].filter(Boolean).join(' · ');
      if (meta) inner.append(el('p', 'rf-node-meta', meta));
      detail.append(inner);
      li.append(button, detail);
      path.append(li);
    });
    return path;
  }

  const activeQuestion = (): QuestionView | null => (state.active ? cache.get(state.active) ?? null : null) ?? open[0] ?? null;

  // ---- question view ----
  function renderQuestion(): void {
    const q = activeQuestion();
    $('.rf-question h2').textContent = q?.text ?? 'No open question';
    caseTitle($('.rf-question .rf-case'), q ? q.caseLabel : '', q?.deferred ? ' · later' : '');
    setProvenance($('.rf-question .rf-provenance'), q?.provenance);
    root.querySelectorAll<HTMLButtonElement>('.rf-answer[data-action], .rf-secondary-responses .rf-later').forEach((b) => (b.disabled = !q));
    // B1 review: a free-text question (a standing missing symptom) takes words; Yes becomes Send and No goes away.
    const free = q?.answerType === 'free-text';
    const box = $<HTMLTextAreaElement>('.rf-free-text');
    if (box.hidden !== !free) box.value = '';
    box.hidden = !free;
    $<HTMLButtonElement>('.rf-responses [data-action="yes"]').textContent = free ? 'Send' : 'Yes';
    $<HTMLButtonElement>('.rf-responses [data-action="no"]').hidden = free;
    const h = $('.rf-history');
    h.replaceChildren();
    if (!q) return;
    if (state.panelOpen && attention && attention.get(q.questionId)?.seen === undefined) {
      attention.markSeen(q.questionId); // desktop (R34)
      syncGlyph();
    }
    // Internal evidence ids are for traces, not for the person answering.
    h.append(el('p', 'rf-why', q.why.replace(/\s*Evidence:\s*(?:ev_\w+[,\s]*)+\.?\s*$/, '')));
    if (q.wordedBy) {
      // Honesty on screen (B2): the wording came from the phrase model; the template's wording is one hover away.
      const w = el('p', 'rf-worded', q.wordedBy[0]!.toUpperCase() + q.wordedBy.slice(1));
      if (q.templateText) w.title = `Template wording: ${q.templateText}`;
      h.append(w);
    }
    if (q.compare) {
      const ul = el('ul', 'rf-compare');
      q.compare.forEach((c, i) => ul.append(el('li', undefined, `${i === 0 ? 'A' : 'B'} · ${c.text}`)));
      h.append(ul);
    }
    h.append(evidencePath(q.timeline, 'question', 'Incident context; expand a title for details'));
    if (q.caveat) h.append(el('p', 'rf-context-caveat', q.caveat));
    motion.registerDetails(state.openNodes.question);
  }

  function setExpanded(value: boolean, animate = true): void {
    state.expanded = !!value;
    reveal.inert = !state.expanded;
    reveal.setAttribute('aria-hidden', String(!state.expanded));
    contextButton.setAttribute('aria-expanded', String(state.expanded));
    contextButton.dataset.open = String(state.expanded);
    motion.context(state.expanded, animate);
  }

  // ---- queue ----
  const openCount = (): number => open.length;
  function updateCount(): void {
    const count = openCount();
    $('.rf-count').textContent = count ? String(count) : '';
    $('.rf-footer [data-action="queue"]').setAttribute('aria-label', `Open questions (${count})`);
  }
  /** What the queue shows; a refresh that changes nothing does not re-render (and never snaps the open transition). */
  const queueSig = (): string => open.map((q) => q.questionId + (q.deferred ? 'l' : '')).join(',') + '|' + String(state.serviceDown) + String(hasIdentity());
  let lastQueueSig = '';
  function renderQueue(): void {
    lastQueueSig = queueSig();
    const list = $('.rf-queue-list');
    list.replaceChildren();
    open.forEach((q) => {
      const b = el('button', 'rf-question-item');
      b.type = 'button';
      b.dataset.action = 'open-question';
      b.dataset.question = q.questionId;
      b.append(el('small', undefined, q.caseLabel + (q.deferred ? ' · later' : '')), document.createTextNode(q.text));
      list.append(b);
    });
    if (!open.length) {
      const p = el('p', undefined, state.serviceDown ? 'Waiting for the service.' : !hasIdentity() ? 'Choose who you are in Settings to see your questions.' : 'All quiet.');
      p.style.cssText = 'font-size:13px;color:#747b82;margin:0 0 12px';
      list.append(p);
    }
  }
  async function refreshQuestions(): Promise<void> {
    if (!hasIdentity()) {
      open = [];
      state.serviceDown = false;
      updateCount();
      if (state.view === 'queue' && state.panelOpen && queueSig() !== lastQueueSig) { renderQueue(); motion.view(true); }
      afterQuestions();
      return;
    }
    try {
      const list = await api.questions({ personEntityId: settings?.currentPersonEntityId });
      if (destroyed) return; // statemachine-refresh-after-destroy: a request in flight at destroy changes nothing
      open = list.filter((q) => ['queued', 'delivered', 'deferred'].includes(q.status));
      list.forEach((q) => cache.set(q.questionId, q));
      state.serviceDown = false;
      if (state.active && !cache.has(state.active)) state.active = null;
      updateCount();
      if (state.view === 'queue' && state.panelOpen && queueSig() !== lastQueueSig) { renderQueue(); motion.view(true); }
      afterQuestions();
    } catch {
      state.serviceDown = true;
    }
  }
  /** desktop (R34): after every refresh the attention rules may send him to the perch; the glyph may change. */
  function afterQuestions(): void {
    if (!companion || destroyed) return;
    watch?.handle(openIds());
    syncGlyph();
  }
  let glyphShown = false;
  function syncGlyph(): void {
    if (!companion) return;
    const u = unseenWaiting();
    if (u !== glyphShown) {
      glyphShown = u;
      avatar.refresh();
    }
    companion.questionsChanged();
  }

  // ---- result / people / case / contact ----
  function renderRow(label: string, meta: string, action: string, target?: HTMLElement): HTMLButtonElement {
    const b = el('button', 'rf-row-button');
    b.type = 'button';
    b.dataset.action = action;
    b.append(el('span', undefined, label));
    if (meta) b.append(el('span', 'rf-row-meta', meta));
    b.insertAdjacentHTML('beforeend', iconSvg('chevron-right'));
    target?.append(b);
    return b;
  }
  /** "TRN-117 · no traffic after SFP change": the unit in bold, the short symptom quieter (Artem 8 Nov). */
  function caseTitle(target: HTMLElement, title: string, suffix = ''): void {
    const i = title.indexOf(' · ');
    target.replaceChildren();
    if (i < 0) { target.append(el('strong', 'rf-case-id', title + suffix)); return; }
    target.append(el('strong', 'rf-case-id', title.slice(0, i)), el('span', 'rf-case-rest', ' · ' + title.slice(i + 3) + suffix));
  }
  function renderResult(): void {
    if (!result) return;
    const r = result.recommendation;
    $('.rf-result-title').textContent = r.text;
    // Calm answer (Artem 8 Nov): the headline, the case path and the people; the source line, caveats, next step and
    // similar cases go into one folded "Details" at the bottom.
    setProvenance($('.rf-result-head .rf-provenance'), undefined);
    $('.rf-result-notes').replaceChildren();
    const notes = el('div', 'rf-more-notes');
    if (result.provenance?.text) notes.append(el('p', 'rf-result-note', result.provenance.text));
    // The engine's applicability is a one-word enum (qualified, ...): the sentence above already says it, so only prose is shown.
    const prose = /\s/.test(r.applicability) ? [r.applicability] : [];
    [...prose, ...r.caveats.slice(0, 3)].filter(Boolean).forEach((t) => notes.append(el('p', 'rf-result-note', t)));
    if (r.nextStep) notes.append(el('p', 'rf-result-note', 'Next: ' + r.nextStep));
    // B5: other experts' advice on record for this problem, never merged into the recommendation above. Only the qualified
    // branches (a fact still decides between them): an inapplicable one is already a caveat ("TRN-512 does not apply: ..."),
    // and an 'applicable' one with no deciding fact is not a disagreement the panel can explain (D-B5-15).
    (result.alternatives ?? []).filter((a) => a.applicability === 'qualified').slice(0, 2).forEach((a) => notes.append(el('p', 'rf-result-note rf-on-record', 'Also on record: ' + a.text)));
    modelNotes(result.routes ?? []).forEach((t) => notes.append(el('p', 'rf-model-note', t)));
    // Same layout as the case view (Artem 8 Nov): the case name on the left, the People row in the same style, the larger chain.
    const head = $('.rf-result-case');
    head.replaceChildren();
    const path = $('.rf-case-path');
    path.replaceChildren();
    const cv = result.caseView;
    if (cv?.timeline.length) {
      path.hidden = false;
      { const t = el('p', 'rf-case'); caseTitle(t, cv.title); head.append(t); }
      path.append(evidencePath(cv.timeline, 'result', 'Matched case timeline; expand a title for details'));
      if (cv.caveat) path.append(el('p', 'rf-context-caveat', cv.caveat));
    } else path.hidden = true;
    const rows = $('.rf-result-rows');
    rows.replaceChildren();
    // desktop (R48, Artem 7 Nov): similar cases, one line each with their date; a near miss asks the requester, not a colleague.
    const basisId = cv?.caseId;
    const others = result.matches.filter((m) => m.caseId && m.caseId !== basisId);
    const none = r.kind === 'none' && !cv?.timeline.length;
    const top = result.matches[0]?.score ?? 0;
    const alts = (none ? others : others.filter((m) => m.score >= top - 0.1)).slice(0, 3);
    if (none && alts.length) $('.rf-result-title').textContent = 'Nothing close enough yet.';
    const more = el('details', 'rf-more');
    more.append(el('summary', 'rf-more-summary', 'Details'));
    more.append(notes);
    if (alts.length) {
      const box = el('div', 'rf-alts');
      box.append(el('p', 'rf-alts-title', none ? 'Closest' : 'Also similar'));
      alts.forEach((m) => {
        const b = el('button', 'rf-alt');
        b.type = 'button';
        b.dataset.action = 'view-case';
        b.dataset.caseId = m.caseId!;
        const hint = m.conflicting[0] ? `differs: ${m.conflicting[0]}` : m.missing[0] ? `if ${m.missing[0]}` : '';
        { const t = el('span', 'rf-alt-title'); caseTitle(t, m.title); b.append(t); }
        b.append(el('span', 'rf-alt-when', m.startedAt ? monthLabel(m.startedAt) : ''));
        if (hint) b.append(el('small', undefined, hint));
        box.append(b);
      });
      if (none) rows.append(box); else more.append(box);
    }
    if (none && alts.length) { motion.registerDetails(state.openNodes.result, path); return; } // Artem: nothing else before a case is chosen
    {
      const people = el('button', 'rf-fold-link');
      people.type = 'button';
      people.dataset.action = 'people';
      people.disabled = !result.people.length;
      people.append(el('span', 'rf-fold-title', 'People with relevant experience'), el('span', 'rf-fold-count', String(result.people.length)));
      head.append(people);
    }
    if (result.question) {
      // The engine routes the question to someone else, never the requester: show it read-only.
      const asked = el('p', 'rf-asked', 'Asked a colleague with relevant experience');
      asked.append(el('span', 'rf-row-meta', result.question.status));
      rows.append(asked);
    }
    if (notes.childElementCount || more.querySelector('.rf-alts')) rows.append(more);
    motion.registerDetails(state.openNodes.result, path);
  }
  let peopleFromCase = false;
  function renderPeople(): void {
    const list = $('.rf-people-list');
    list.replaceChildren();
    const people = (peopleFromCase ? caseView?.people : result?.people) ?? [];
    people.forEach((p) => list.append(personRow(p)));
    if (!people.length) list.append(el('p', 'rf-empty', 'No one found yet.'));
  }
  function personRow(p: PersonView): HTMLElement {
    const row = el('div', 'rf-person');
    const reason = p.reasons[0];
    row.append(el('small', undefined, [p.name, p.role, reason && !reason.firsthand ? 'mentioned only' : ''].filter(Boolean).join(' · ')));
    row.append(document.createTextNode(reason?.text ?? 'No specific reason recorded.'));
    const actions = el('div', 'rf-person-actions');
    if (reason?.caseId) {
      const view = el('button', 'rf-later', 'View case');
      view.type = 'button';
      view.dataset.action = 'view-case';
      view.dataset.caseId = reason.caseId;
      actions.append(view);
    }
    if (p.askable) {
      const prepare = el('button', 'rf-later', 'Prepare message');
      prepare.type = 'button';
      prepare.dataset.action = 'prepare';
      prepare.dataset.person = p.personEntityId;
      actions.append(prepare);
    } else {
      actions.append(el('span', 'rf-unavailable', 'Not available to ask right now'));
    }
    row.append(actions);
    return row;
  }
  function renderCase(): void {
    if (!caseView) return;
    // Case view (Artem 8 Nov): the name; two folded sections in plain black text (what happened, who and where); the
    // people; then the chain, larger. The verification caveat sits behind an (i).
    caseTitle($('.rf-view[data-view="case"] .rf-case'), caseView.title);
    setProvenance($('.rf-view[data-view="case"] .rf-provenance'), undefined);
    const body = $('.rf-case-body');
    body.replaceChildren();
    const fold = (title: string, lines: string[]): HTMLDetailsElement | null => {
      if (!lines.length) return null;
      const d = el('details', 'rf-fold');
      d.append(el('summary', 'rf-fold-title', title));
      lines.forEach((t) => d.append(el('p', 'rf-fold-line', t)));
      return d;
    };
    // One folded Summary: what happened (the reported problem and conditions as written), then who and where.
    const said = caseView.timeline.filter((n) => n.stage === 'observation').flatMap((n) => n.detail.split('\n').filter((l) => l && !/^Reported by /.test(l)));
    const where = [
      ...(caseView.provenance?.text ? [caseView.provenance.text] : []),
      ...caseView.sources.slice(0, 5).map((src) => [src.author, src.provider, src.when].filter(Boolean).join(' · ')),
    ].filter((v, k, a) => a.indexOf(v) === k);
    const folds = el('div', 'rf-folds');
    const summary = fold('Summary', [...new Set(said)].slice(0, 6));
    if (summary || where.length) {
      const d = summary ?? (() => { const x = el('details', 'rf-fold'); x.append(el('summary', 'rf-fold-title', 'Summary')); return x; })();
      where.forEach((t, k) => d.append(el('p', k === 0 && summary ? 'rf-fold-line rf-fold-meta rf-fold-sep' : 'rf-fold-line rf-fold-meta', t)));
      folds.append(d);
    }
    // People with relevant experience, in the same style as the Summary row (it opens the people view).
    const cp = caseView.people ?? [];
    const people = el('button', 'rf-fold-link');
    people.type = 'button';
    people.dataset.action = 'case-people';
    people.disabled = !cp.length;
    people.append(el('span', 'rf-fold-title', 'People with relevant experience'), el('span', 'rf-fold-count', String(cp.length)));
    folds.append(people);
    body.append(folds);
    const wrap = el('div', 'rf-case-path rf-chain-big');
    wrap.append(evidencePath(caseView.timeline, 'case', 'Case timeline; expand a title for details'));
    if (caseView.caveat) {
      const info = el('details', 'rf-info');
      info.append(el('summary', 'rf-info-button', 'i'));
      info.querySelector('summary')!.setAttribute('aria-label', 'How sure is this?');
      info.append(el('p', 'rf-context-caveat', caseView.caveat));
      wrap.append(info);
    }
    // B3: the case's asset on the Context Layer page, when the host can open it.
    const asset = caseView.entities.find((e) => e.type !== 'person');
    if (options.openContext && asset) {
      const open = el('button', 'rf-later rf-open-context', 'Open the context layer');
      open.type = 'button';
      open.dataset.action = 'open-context';
      open.dataset.entity = asset.name;
      wrap.append(open);
    }
    body.append(wrap);
    motion.registerDetails(state.openNodes.case, wrap);
  }
  function renderContact(draft: ContactDraft): void {
    const v = viewEl('contact');
    v.querySelector('.rf-receipt-title')!.textContent = 'Message to ' + draft.to.displayName;
    v.querySelector('.rf-draft-subject')!.textContent = draft.subject;
    v.querySelector('.rf-draft-body')!.textContent = draft.body;
    draftText = draft.subject ? `${draft.subject}\n\n${draft.body}` : draft.body;
    const copy = v.querySelector<HTMLButtonElement>('[data-action="copy-draft"]')!;
    copy.textContent = 'Copy';
  }

  // ---- settings ----
  function renderSettings(): void {
    $('.rf-server').textContent = api.kind === 'mock' ? 'Dev mock · no service' : api.baseUrl;
    $('.rf-models-summary').textContent = modelsSummary(settings?.models);
    renderYou();
    $<HTMLInputElement>('.rf-mcp').checked = !!settings?.mcp;
    const m = $<HTMLInputElement>('.rf-motion');
    m.checked = isReduced();
    m.disabled = systemReduced;
    const reset = $<HTMLButtonElement>('[data-action="reset-demo"]');
    reset.textContent = 'Reset demo';
    delete reset.dataset.armed;
    // desktop (R35/R36): companion rows, only when the companion runs.
    root.querySelectorAll<HTMLElement>('.rf-desktop-companion').forEach((r) => (r.hidden = !companion));
    $<HTMLInputElement>('.rf-fidgets').checked = !!companion?.fidgets();
  }
  function renderYou(): void {
    const sel = $<HTMLSelectElement>('.rf-you');
    sel.replaceChildren();
    const current = settings?.currentPersonEntityId ?? '';
    const add = (value: string, label: string): void => { const o = el('option', undefined, label); o.value = value; sel.append(o); };
    if (!current || !directory.some((d) => d.personEntityId === current)) add(current, current ? 'Unknown person' : 'Choose…');
    directory.forEach((d) => add(d.personEntityId, d.role ? `${d.name} · ${d.role}` : d.name));
    sel.value = current;
    sel.disabled = !directory.length;
  }
  async function loadDirectory(): Promise<void> {
    try { directory = await api.directory(); } catch { /* older service or offline: guest only */ }
    // Film: a KT_PERSON name resolves only once the directory is known; re-apply the last settings with it.
    if (personOverride && rawSettings) applySettings(rawSettings);
    // Not in the directory yet (the service has not imported them): look again shortly.
    if (personOverride && !directory.some((d) => d.personEntityId === personOverride || d.name === personOverride)) setTimeout(() => void loadDirectory(), 3000);
    renderDemoChips();
  }
  /** Act as another directory person: Settings -> You and the B6 demo chips share this path. */
  async function switchPerson(id: string): Promise<void> {
    await saveSetting({ currentPersonEntityId: id });
    cache.clear(); state.active = null; state.expanded = false; state.openNodes.question = null;
    pointsOptIn = null; pointsRating = null;
    await refreshQuestions();
  }
  // ---- B6 (demo flag only): "Be Veikko / Be Erkki" chips in the footer ----
  const demoMode = options.demo !== undefined ? options.demo : globalFlags()?.demo === true;
  const demoChipsEl: HTMLElement | null = demoMode ? el('span', 'rf-demo-chips') : null;
  if (demoChipsEl) {
    demoChipsEl.setAttribute('role', 'group');
    demoChipsEl.setAttribute('aria-label', 'Demo: act as');
    demoChipsEl.hidden = true;
    footer.dataset.demo = 'true';
    surface.dataset.demo = 'true'; // the surface grid's footer row grows by the chip row
    footer.prepend(demoChipsEl);
    demoChipsEl.addEventListener('click', (e) => {
      const b = (e.target as Element).closest<HTMLButtonElement>('button[data-person]');
      if (!b || b.getAttribute('aria-pressed') === 'true') return;
      void switchPerson(b.dataset.person!);
    });
  }
  function renderDemoChips(): void {
    if (!demoChipsEl) return;
    const chips = demoChips(directory, settings?.currentPersonEntityId);
    demoChipsEl.replaceChildren(el('span', 'rf-demo-tag', 'Demo'), ...chips.map((c) => {
      const b = el('button', 'rf-demo-chip', c.label);
      b.type = 'button';
      b.dataset.person = c.personEntityId;
      b.dataset.persona = c.key;
      b.title = `Act as ${c.name} (${c.part === 'field' ? 'asks' : 'answers'}); same as Settings -> You`;
      b.setAttribute('aria-pressed', String(c.active));
      return b;
    }));
    const wasHidden = demoChipsEl.hidden;
    demoChipsEl.hidden = !chips.length;
    // The footer grew or shrank by the chip row: re-fit the card as a resize does.
    if (wasHidden !== demoChipsEl.hidden) { motion.view(false); motion.settle(); }
  }
  // ---- points (desktop, R46): opt-in toggle, balance, rank, recent events, participants ----
  const POINTS_NOTE = 'Points count what you contribute, never whether an answer was right. Opting out hides your points; nothing is deleted.';
  function renderPoints(): void {
    const id = settings?.currentPersonEntityId;
    const toggle = $<HTMLInputElement>('.rf-optin');
    const participates = !!pointsOptIn?.participates;
    toggle.checked = participates;
    toggle.disabled = !id;
    $<HTMLInputElement>('.rf-points').checked = state.points;
    $('.rf-points-display').hidden = !participates;
    $('.rf-points-note').textContent = !id ? 'Choose who you are in Settings first.' : '';
    $('.rf-points-note').hidden = !!id;
    $('.rf-info').hidden = !id;
    $('.rf-info-tip').textContent = POINTS_NOTE; // desktop (Artem 7 Nov): the note lives in a small i, shown on hover/focus
    const body = $('.rf-points-body');
    const r = pointsRating;
    body.hidden = !(participates && r?.me);
    if (!participates || !r?.me) return;
    $('.rf-points-big').textContent = String(r.me.balance);
    $('.rf-points-meta').textContent = `${r.me.balance === 1 ? 'point' : 'points'} · rank ${r.me.rank} of ${r.totals.participants}`;
    const events = $('.rf-points-events');
    events.replaceChildren();
    if (!r.me.events.length) events.append(el('p', 'rf-points-none', 'Nothing yet. Your next answer counts.'));
    r.me.events.slice(0, 5).forEach((e) => {
      const row = el('div', 'rf-points-event');
      const left = el('span');
      left.append(el('span', undefined, e.summary), el('small', undefined, whenLabel(e.at)));
      row.append(left, el('span', 'rf-points-plus', e.points > 0 ? `+${e.points}` : '0'));
      events.append(row);
    });
    const list = $('.rf-points-list');
    list.replaceChildren();
    r.participants.slice(0, 10).forEach((p) => {
      const row = el('div', 'rf-points-row');
      row.dataset.me = String(p.personEntityId === id);
      row.append(el('span', 'rf-points-rank', String(p.rank)), el('span', 'rf-points-name', p.personEntityId === id ? `${p.displayName} (you)` : p.displayName), el('span', 'rf-points-plus', String(p.balance)));
      list.append(row);
    });
    if (state.view === 'points') motion.view(false);
  }
  /** 'Jun 2026' for a case date (years matter for stale fixes). */
  function monthLabel(iso: string): string {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  }
  function whenLabel(iso: string): string {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    const days = Math.floor((Date.now() - d.getTime()) / 86400000);
    return days <= 0 ? 'today' : days === 1 ? 'yesterday' : days < 7 ? `${days} days ago` : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  }
  async function loadPoints(): Promise<void> {
    const id = settings?.currentPersonEntityId;
    const n = ++pointsLoad;
    if (!id) { pointsOptIn = null; pointsRating = null; renderPoints(); return; }
    try {
      const optIn = await api.optIn(id);
      const rating = optIn.participates ? await api.rating(id, id) : null;
      if (n !== pointsLoad) return;
      pointsOptIn = optIn;
      pointsRating = rating;
      renderPoints();
    } catch (e) {
      if (n === pointsLoad) showError(e, () => { setView('points'); });
    }
  }
  /**
   * B3: "Erkki's cost" row: what answering cost the most-asked person and how often their knowledge was reused, plus the
   * store line. Loaded after the view opens; any failure (older service, mock without the route) leaves the row hidden.
   */
  async function loadCosts(): Promise<void> {
    const n = ++costsLoad;
    const row = $('.rf-cost-row');
    try {
      const c = await api.costs(settings?.currentPersonEntityId ? { principalId: settings.currentPersonEntityId } : {});
      if (n !== costsLoad) return;
      const r = costRow(c);
      $('.rf-cost-label').textContent = r.label;
      $('.rf-cost-line').textContent = r.line;
      $('.rf-cost-store').textContent = r.store;
      row.title = r.title;
      row.hidden = false;
    } catch {
      if (n === costsLoad) row.hidden = true;
    }
  }
  async function setOptIn(on: boolean): Promise<void> {
    const id = settings?.currentPersonEntityId;
    if (!id) return;
    try {
      pointsOptIn = await api.setOptIn(id, principal(), on);
      // Taking part turns the receipt's +points on too, so the first answer shows what happened; opting out leaves the switch alone.
      if (on && !state.points) await saveSetting({ points: true });
      await loadPoints();
      if (on && companion) react('hop');
    } catch (e) { showError(e, () => { setView('points'); }); }
  }

  // ---- models (B2: Settings -> Models) ----
  function renderModels(): void {
    const body = $('.rf-models-body');
    body.replaceChildren();
    const v = modelsView;
    if (!v) { body.append(el('p', 'rf-points-none', modelsError ?? 'Checking this Mac…')); return; }
    const slots: ModelSlots = settings?.models ?? { embed: v.slots.embed.choice, extract: v.slots.extract.choice, phrase: v.slots.phrase.choice };
    for (const slot of MODEL_SLOTS) body.append(slotRow(slot, slots[slot], v));
    const d = v.detection;
    const machine = el('p', 'rf-models-machine', d.running ? `Ollama ${d.version ?? ''} running${d.totalMemBytes ? ` · ${Math.round(d.totalMemBytes / 1e9)} GB memory` : ''}${d.freeDiskBytes ? ` · ${Math.round(d.freeDiskBytes / 1e9)} GB free` : ''}`.replace(/\s+·/g, ' ·') : d.installed ? 'Ollama is installed but not running; it starts when a slot is set to local.' : 'Ollama is not installed.');
    body.append(machine);
    if (!d.installed && !d.running) body.append(installBlock(v));
  }
  function slotRow(slot: ModelSlotName, choice: SlotChoice, v: ModelsView): HTMLElement {
    const row = el('div', 'rf-model-slot');
    row.dataset.slot = slot;
    const status = v.slots[slot];
    const head = el('div', 'rf-model-head');
    head.append(el('span', 'rf-model-name', SLOT_TITLES[slot]));
    const chip = el('span', 'rf-chip', status.chip);
    chip.dataset.state = status.state;
    if (status.reason) chip.title = status.reason;
    head.append(chip);
    row.append(head, el('p', 'rf-model-what', SLOT_WHAT[slot]));
    const seg = el('div', 'rf-segmented');
    seg.setAttribute('role', 'radiogroup');
    seg.setAttribute('aria-label', `${SLOT_TITLES[slot]}: who runs it`);
    for (const p of ['rules', 'local', 'api'] as const) {
      const b = el('button', 'rf-seg', p === 'api' ? 'hosted' : p);
      b.type = 'button';
      b.setAttribute('role', 'radio');
      b.setAttribute('aria-checked', String(choice.provider === p));
      b.dataset.on = String(choice.provider === p);
      // No hosted embedding model in this build (DECISIONS-models D-B2-06): the option is shown, not offered.
      if (slot === 'embed' && p === 'api' && choice.provider !== 'api') { b.disabled = true; b.title = 'No hosted embedding model in this build'; }
      b.addEventListener('click', () => { if (choice.provider !== p) void saveSlot(slot, { provider: p, ...(p === 'local' ? { model: recommended(v, slot) } : p === 'api' ? { model: API_MODELS[slot][0]! } : {}) }); });
      seg.append(b);
    }
    row.append(seg);
    if (choice.provider === 'local') {
      const sel = el('select', 'rf-model-select');
      sel.setAttribute('aria-label', `${SLOT_TITLES[slot]} model`);
      const current = choice.model ?? recommended(v, slot);
      for (const e of v.catalog[slot]) {
        const o = el('option', undefined, `${e.model}${e.recommended ? ' · recommended' : ''} · ${e.sizeBytes ? sizeLabel(e.sizeBytes) + ' · ' : ''}${e.label.replace(/ · Download$/, '').replace(/ · \d.*GB$/, '')}`);
        o.value = e.model;
        o.title = e.why ?? '';
        o.disabled = e.availability === 'too-large' && e.model !== current;
        sel.append(o);
      }
      sel.value = current;
      sel.addEventListener('change', () => void saveSlot(slot, { provider: 'local', model: sel.value }));
      row.append(sel);
      const entry = v.catalog[slot].find((e) => e.model === current);
      if (entry?.why) row.append(el('p', 'rf-model-why', entry.why));
      const job = modelJobs.get(current);
      if (job?.state === 'running') row.append(progressLine(job));
      else if (entry?.availability === 'not-downloaded' && v.detection.running) {
        const dl = el('button', 'rf-later rf-model-action', `Download ${entry.sizeBytes ? sizeLabel(entry.sizeBytes) : ''}`.trim());
        dl.type = 'button'; dl.dataset.action = 'model-download'; dl.dataset.model = current;
        row.append(dl);
      } else if (entry?.availability === 'too-large') row.append(el('p', 'rf-model-why', `Too large for this Mac: needs about ${entry.minRamGb} GB of memory.`));
      if (job?.state === 'failed') row.append(el('p', 'rf-model-error', `Download failed: ${job.error ?? job.status}`));
    } else if (choice.provider === 'api') {
      const sel = el('select', 'rf-model-select');
      sel.setAttribute('aria-label', `${SLOT_TITLES[slot]} hosted model`);
      for (const m of API_MODELS[slot]) { const o = el('option', undefined, m); o.value = m; sel.append(o); }
      sel.value = choice.model ?? API_MODELS[slot][0]!;
      sel.addEventListener('change', () => void saveSlot(slot, { provider: 'api', model: sel.value }));
      row.append(sel);
      const vendor: ApiVendorName = /^gemini/i.test(sel.value) ? 'gemini' : 'anthropic';
      const keyRow = el('div', 'rf-model-key');
      const input = el('input', 'rf-key-input');
      input.type = 'password';
      input.autocomplete = 'off';
      input.spellcheck = false;
      input.placeholder = v.apiKeys[vendor] ? 'Key held · paste to replace' : `${vendor === 'gemini' ? 'Gemini' : 'Anthropic'} API key`;
      input.dataset.vendor = vendor;
      input.setAttribute('aria-label', `${vendor} API key`);
      const save = el('button', 'rf-later', 'Save key'); save.type = 'button'; save.dataset.action = 'model-key'; save.dataset.vendor = vendor;
      const test = el('button', 'rf-later', 'Test'); test.type = 'button'; test.dataset.action = 'model-test'; test.dataset.vendor = vendor; test.dataset.model = sel.value;
      keyRow.append(input, save, test);
      row.append(keyRow);
      const link = el('a', 'rf-model-link', vendor === 'gemini' ? 'Create a key in Google AI Studio' : 'Create a key in the Anthropic Console');
      link.href = KEY_PAGES[vendor];
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      row.append(link);
      const msg = keyMessages.get(vendor);
      if (msg) row.append(el('p', msg.ok ? 'rf-model-why' : 'rf-model-error', msg.text));
      row.append(el('p', 'rf-model-why', options.keychain ? 'The key is kept in the macOS keychain and given to the service in memory only.' : 'The key is held in memory by the service until it restarts; never written to disk.'));
    }
    return row;
  }
  function installBlock(v: ModelsView): HTMLElement {
    const box = el('div', 'rf-model-install');
    const job = installView;
    if (!job || job.state === 'idle' || job.state === 'failed') {
      const b = el('button', 'rf-answer rf-model-action', job?.state === 'failed' ? 'Try the install again' : 'Install Ollama');
      b.type = 'button'; b.dataset.action = 'model-install';
      box.append(b);
    }
    if (job?.state === 'unavailable') {
      box.append(el('p', 'rf-model-why', 'Homebrew was not found on this Mac.'));
      const a = el('a', 'rf-model-link', 'Download Ollama for macOS');
      a.href = job.downloadUrl; a.target = '_blank'; a.rel = 'noopener noreferrer';
      box.append(a);
    }
    if (job && job.log.length) box.append(el('pre', 'rf-model-log rf-selectable', job.log.slice(-8).join('\n')));
    if (job?.state === 'failed' && job.error) box.append(el('p', 'rf-model-error', job.error));
    box.append(el('p', 'rf-points-sub', 'Or set it up yourself'));
    for (const c of v.detection.setup) {
      const line = el('div', 'rf-model-cmd');
      line.append(el('code', 'rf-selectable', c));
      const copy = el('button', 'rf-later', 'Copy'); copy.type = 'button'; copy.dataset.action = 'model-copy'; copy.dataset.text = c;
      line.append(copy);
      box.append(line);
    }
    return box;
  }
  function progressLine(job: PullJobView): HTMLElement {
    const p = el('div', 'rf-model-progress');
    const bar = el('span', 'rf-model-bar');
    bar.style.setProperty('--pct', `${job.percent ?? 0}%`);
    p.append(bar, el('span', undefined, `downloading ${job.percent ?? 0}%`));
    return p;
  }
  async function loadModels(): Promise<void> {
    const n = ++modelsLoad;
    try {
      const v = await api.models();
      if (n !== modelsLoad) return;
      modelsView = v;
      modelsError = null;
      try { installView = await api.installJob(); } catch { /* older service */ }
    } catch (e) {
      if (n !== modelsLoad) return;
      modelsError = e instanceof ApiError ? `Could not read the models: ${e.message}` : 'Could not read the models.';
    }
    if (state.view === 'models') { renderModels(); motion.view(false); }
  }
  async function saveSlot(slot: ModelSlotName, choice: SlotChoice): Promise<void> {
    await saveSetting({ models: { [slot]: choice } });
    await loadModels();
  }
  async function downloadModel(model: string): Promise<void> {
    try {
      const job = await api.pullModel(model);
      modelJobs.set(model, job);
      renderModels();
      pollPull(job.jobId, model);
    } catch (e) { showError(e, () => { setView('models'); }); }
  }
  function pollPull(jobId: string, model: string): void {
    const t = setTimeout(() => {
      modelTimers = modelTimers.filter((x) => x !== t);
      if (destroyed) return;
      void api.pullJob(jobId).then((job) => {
        modelJobs.set(model, job);
        if (job.state === 'running') pollPull(jobId, model);
        else void loadModels();
        if (state.view === 'models') renderModels();
      }, () => undefined);
    }, PULL_POLL_MS);
    modelTimers.push(t);
  }
  async function installOllama(): Promise<void> {
    try {
      installView = await api.installOllama();
      renderModels();
      if (installView.state === 'running') pollInstall();
    } catch (e) { showError(e, () => { setView('models'); }); }
  }
  function pollInstall(): void {
    const t = setTimeout(() => {
      modelTimers = modelTimers.filter((x) => x !== t);
      if (destroyed) return;
      void api.installJob().then((job) => {
        installView = job;
        if (job.state === 'running') pollInstall();
        else void loadModels();
        if (state.view === 'models') renderModels();
      }, () => undefined);
    }, PULL_POLL_MS);
    modelTimers.push(t);
  }
  async function saveKey(vendor: ApiVendorName): Promise<void> {
    const input = root.querySelector<HTMLInputElement>(`.rf-key-input[data-vendor="${vendor}"]`);
    const key = input?.value.trim() ?? '';
    if (!key) return;
    try {
      const r = options.keychain ? await options.keychain.save(vendor, key) : { ...(await api.setModelKey(vendor, key)), stored: false };
      keyMessages.set(vendor, { ok: r.present, text: r.present ? (r.stored ? 'Key saved in the keychain.' : 'Key held in memory.') : 'The key was not accepted.' });
    } catch (e) {
      keyMessages.set(vendor, { ok: false, text: e instanceof Error ? e.message : 'The key could not be saved.' });
    }
    if (input) input.value = '';
    await loadModels();
  }
  async function testKey(vendor: ApiVendorName, model?: string): Promise<void> {
    keyMessages.set(vendor, { ok: true, text: 'Testing…' });
    renderModels();
    try {
      const r = await api.testModelKey(vendor, model);
      keyMessages.set(vendor, r.ok ? { ok: true, text: `Reached ${r.model ?? 'the model'}.` } : { ok: false, text: `Test failed: ${r.error ?? 'no answer'}` });
    } catch (e) {
      keyMessages.set(vendor, { ok: false, text: e instanceof Error ? e.message : 'Test failed.' });
    }
    if (state.view === 'models') renderModels();
  }

  let personOverride = options.person;
  let rawSettings: UserSettings | null = null;
  function applySettings(s: UserSettings): void {
    rawSettings = s;
    // Film: KT_PERSON may be an entity id or a directory name ("Mark"); resolved against the directory when it is loaded.
    const own = personOverride ? (directory.find((d) => d.personEntityId === personOverride || d.name === personOverride)?.personEntityId ?? personOverride) : undefined;
    settings = own ? { ...s, currentPersonEntityId: own } : s;
    state.points = !!s.points;
    state.reducedSetting = !!s.reducedMotion;
    syncMotion();
    if (state.view === 'settings') renderSettings();
    renderDemoChips();
  }
  async function saveSetting(patch: Omit<Partial<UserSettings>, 'models'> & { models?: Partial<ModelSlots> }): Promise<void> {
    if (personOverride && patch.currentPersonEntityId !== undefined) {
      // Film: this app's person stays on this app; the other app sharing the service keeps its own.
      personOverride = patch.currentPersonEntityId;
      const { currentPersonEntityId: _mine, ...rest } = patch;
      if (!Object.keys(rest).length) { if (settings) applySettings(settings); return; }
      patch = rest;
    }
    try { applySettings(await api.putSettings(patch)); } catch (e) { showError(e, () => void saveSetting(patch)); }
  }

  // ---- generic view switching (v008 setView) ----
  function syncPanelA11y(): void {
    avatarButton.setAttribute('aria-expanded', String(state.panelOpen));
    avatarButton.setAttribute('aria-label', state.panelOpen ? 'Close panel' : 'Open panel');
  }
  function setView(view: ViewName, animate = true): void {
    const wasOpen = state.panelOpen;
    if (!wasOpen) companion?.makeRoom(); // desktop (R33): the card fits before it opens
    state.view = view;
    if (!['receipt', 'contact', 'points'].includes(view)) state.lastOpen = view;
    state.panelOpen = true;
    syncPoll();
    stage.dataset.view = view;
    views.forEach((v) => (v.hidden = v.dataset.view !== view));
    send.hidden = view !== 'input';
    contextButton.hidden = view !== 'question';
    syncPanelA11y();
    const compose = $('[data-action="attach"]');
    compose.setAttribute('aria-label', view === 'input' ? 'Attach text, images or files' : 'Write a message');
    compose.innerHTML = iconSvg(view === 'input' ? 'paperclip' : 'square-pen');
    if (view === 'queue') renderQueue();
    if (view === 'question') renderQuestion();
    if (view === 'settings' || view === 'admin') { renderSettings(); void loadCosts(); }
    if (view === 'result') renderResult();
    if (view === 'people') renderPeople();
    if (view === 'case') renderCase();
    if (view === 'points') { renderPoints(); void loadPoints(); }
    if (view === 'models') { renderModels(); void loadModels(); }
    // The expanded flag survives leaving the question view (restored on return); other views stay collapsed.
    if (view === 'question') setExpanded(state.expanded, false);
    else motion.context(false, false);
    updateCount();
    motion.panel(true, animate);
    motion.view(animate);
    avatar.refresh();
    persist();
    if (!wasOpen) companion?.panelOpened();
  }
  /**
   * Poll the questions queue every 20 s while the panel is open. Collapsed: no timer in the R28 panel;
   * with the companion (desktop R34) the question watch polls every COLLAPSED_POLL_MS instead.
   */
  function syncPoll(): void {
    if (state.panelOpen && !pollTimer && !destroyed) pollTimer = setInterval(() => { if (!document.hidden && !state.busy) void refreshQuestions(); }, POLL_MS);
    else if ((!state.panelOpen || destroyed) && pollTimer) { clearInterval(pollTimer); pollTimer = 0; }
    watch?.sync();
  }
  function closePanel(animate = true, via: InputModality = modality.current()): void {
    state.panelOpen = false;
    syncPoll();
    syncPanelA11y();
    motion.panel(false, animate);
    avatar.refresh();
    avatarButton.focus(focusOptions(via)); // ux fix M1: no ring after a mouse close; Escape keeps it
    companion?.panelClosed(); // desktop (R33): the idle timer starts; a displaced Lumi rolls back to his spot
  }
  function focusFor(view: ViewName, via: InputModality = modality.current()): void {
    const target =
      view === 'input' ? field
      : view === 'question' ? root.querySelector<HTMLElement>('[data-action="yes"]')
      : view === 'receipt' ? (viewEl('receipt').querySelector<HTMLElement>('[data-action="receipt-action"]:not([hidden])') ?? $('[data-action="attach"]'))
      : view === 'queue' ? root.querySelector<HTMLElement>('.rf-question-item') ?? $('.rf-view[data-view="queue"] [data-action="input"]')
      : view === 'settings' ? $('.rf-view[data-view="settings"] [data-action="input"]')
      : view === 'points' ? $('.rf-optin')
      : viewEl(view).querySelector<HTMLElement>('button:not([disabled])');
    if (!target) return;
    // desktop (ux fix): on the first frame of an open the surface is still visibility:hidden (panel-motion sets it
    // from the spring value), so an immediate focus() fails silently. Retry on the next frames until it takes.
    const opts = focusOptions(via);
    const attempt = (left: number): void => {
      target.focus(opts);
      if (document.activeElement !== target && left > 0 && !destroyed) requestAnimationFrame(() => attempt(left - 1));
    };
    attempt(12);
  }
  /** `user`: a direct click / key on Lumi. Programmatic opens never move focus (desktop R33). */
  function openPanel(user = false, via: InputModality = modality.current()): void {
    if (state.serviceDown) {
      showError(new ApiError('unreachable', 'GET /health', 'Couldn’t reach the service'), () => void retryConnect());
    } else if (!state.panelOpen) {
      // desktop (ux, Artem 7 Nov): a direct click opens the text panel (last view) as v009; a waiting question shows as the badge and the glyph.
      selfOpened = !user;
      companion?.makeRoom(); // desktop (R33): slide to where the card fits (with the hop) before it opens
      state.panelOpen = true;
      syncPoll();
      void refreshQuestions();
      if (state.view === 'queue') renderQueue();
      else if (state.view === 'question') renderQuestion();
      syncPanelA11y();
      motion.panel(true);
      if (user) focusFor(state.view, via);
      avatar.refresh(); // v009: opening itself is quiet; a direct click adds the Springy tap, programmatic opens do not
      persist();
      companion?.panelOpened();
      return;
    }
  }

  // ---- receipts and errors ----
  function showReceipt(title: string, detail: string, action: ReceiptAction | null, points = 0): void {
    $('.rf-receipt-title').textContent = title;
    $('.rf-receipt-detail').textContent = detail;
    const btn = $<HTMLButtonElement>('[data-action="receipt-action"]');
    receiptAction = action;
    btn.hidden = !action;
    if (action) btn.textContent = action.label;
    const reward = $('.rf-reward');
    const show = state.points && points > 0;
    reward.hidden = !show;
    if (show) {
      reward.querySelector('span')!.textContent = '+' + points;
      runBurst(reward.querySelector('canvas')!);
    }
    setView('receipt');
    focusFor('receipt');
  }
  function runBurst(c: HTMLCanvasElement): void {
    const ctx = c.getContext('2d');
    if (!ctx) return;
    if (isReduced()) { ctx.clearRect(0, 0, BURST.width, BURST.height); return; }
    let f = 0;
    const tick = (): void => {
      if (destroyed) return;
      renderBurst(ctx, f);
      if (++f < BURST.frames) later(tick, 1000 / BURST.fps);
    };
    tick();
  }
  function showError(e: unknown, retry: () => void, keptDraft = false): void {
    const unreachable = e instanceof ApiError && (e.code === 'unreachable' || e.code === 'timeout');
    state.busy = false;
    setBusy(false);
    showReceipt(
      unreachable ? 'Couldn’t reach the service' : 'Something went wrong',
      unreachable ? (keptDraft ? 'Nothing was lost; your draft is still here.' : 'Nothing was changed. Try again when the service is back.') : e instanceof Error ? e.message : 'Please try again.',
      { label: 'Retry', run: retry },
    );
    // statemachine-showerror-open-skips-makeroom: after showReceipt (whose setView opens the panel and runs
    // make-room, with its hop), so the error reaction is not replaced by the make-room hop.
    avatar.play('error');
    if (!state.panelOpen) { state.panelOpen = true; syncPoll(); syncPanelA11y(); motion.panel(true); }
  }

  // ---- actions ----
  async function respond(value: 'yes' | 'no' | 'unknown' | 'later' | 'dismiss'): Promise<void> {
    const q = activeQuestion();
    if (!q || state.busy) return;
    const box = $<HTMLTextAreaElement>('.rf-free-text');
    const words = q.answerType === 'free-text' ? box.value.trim() : '';
    if (q.answerType === 'free-text' && (value === 'yes' || value === 'no') && !words) { box.focus(); return; }
    state.busy = true;
    state.expanded = false;
    try {
      const p = principal();
      const res = value === 'later' ? await api.defer(q.questionId, p) : value === 'dismiss' ? await api.dismiss(q.questionId, p) : await api.answer(q.questionId, { principal: p, value, ...(words && value !== 'unknown' ? { text: words } : {}) });
      if (words) box.value = '';
      state.busy = false;
      const rc = res.receipt;
      attention?.record(value === 'later' ? 'deferred' : value === 'dismiss' ? 'dismissed' : 'answered', q.questionId);
      showReceipt(rc.title, rc.detail, rc.canUndo ? { label: 'Undo', run: () => void undo(q.questionId) } : null, rc.pointsAwarded ?? 0);
      // fidelity-08: the R35 reaction map only with the companion; the R28 column fallback keeps v009's 'result'.
      if (companion) react(state.points && (rc.pointsAwarded ?? 0) > 0 ? 'hop' : REACTIONS[value]);
      else avatar.play('result');
      void refreshQuestions();
    } catch (e) {
      showError(e, () => { setView('question'); void respond(value); });
    }
  }
  async function undo(id: string): Promise<void> {
    try {
      await api.undo(id, principal());
      const q = await api.question(id);
      cache.set(id, q);
      state.active = id;
      await refreshQuestions();
      setView('question');
      focusFor('question');
      if (companion) react(REACTIONS.undo); // fidelity-08: v009 had no undo reaction
    } catch (e) { showError(e, () => void undo(id)); }
  }
  /** desktop (R35): play a reaction from REACTIONS ('settle' = the composed crouch, low settle). */
  function react(r: ActKey | 'settle'): void {
    if (r !== 'settle') { avatar.play(r); return; }
    if (isReduced()) return;
    avatar.pose({ kind: 'settle', frame: 0 });
    later(() => {
      if (avatar.status().mode !== 'pose:settle') return;
      avatar.pose({ kind: 'settle', frame: 1 });
      later(() => { if (avatar.status().mode === 'pose:settle') avatar.rest(); }, SETTLE_REACTION_MS);
    }, SETTLE_REACTION_MS);
  }
  function setBusy(busy: boolean): void {
    state.busy = busy;
    field.readOnly = busy;
    send.dataset.busy = String(busy);
    stage.setAttribute('aria-busy', String(busy));
    updateSend();
  }
  async function submit(): Promise<void> {
    if (state.busy || send.disabled) return;
    const names = attachments.map((f) => f.name);
    // Artem 7 Nov: a photo alone used to be rejected by the service (text required). Photos are not read by anything
    // (no vision model, local only): they travel as names for colleagues, and the matching runs on the words.
    const text = field.value.trim() || `Attached without a description: ${names.join(', ')}`;
    setBusy(true);
    avatar.play('processing', { loop: true });
    try {
      const res = await api.investigate({ text, principal: principal(), attachmentNames: names, allowQuestions: true });
      result = res;
      state.openNodes.result = null;
      field.value = '';
      attachments = [];
      renderAttachments();
      setBusy(false);
      state.serviceDown = false;
      persist();
      setView('result');
      avatar.play('result');
      void refreshQuestions();
    } catch (e) {
      showError(e, () => { setView('input'); void submit(); }, true);
    }
  }
  /**
   * B4 "Remember this": the typed or pasted text and every attached text file (read here with File.text(), at most
   * 1 MB each) go to POST /import as format 'paste', one source each. Photos and other binaries are never read or
   * sent; they are named in the receipt. A thread is imported with the pasting person's groups when they have any.
   */
  async function remember(): Promise<void> {
    if (state.busy) return;
    const typed = field.value.trim() ? field.value : '';
    const texts = attachments.filter((f) => isTextFile(f) && f.size <= MAX_TEXT_BYTES);
    const skipped = attachments.filter((f) => !texts.includes(f));
    const notRead = skipped.length ? `Not read (only text files up to 1 MB): ${skipped.map((f) => f.name).join(', ')}` : '';
    if (!typed && !texts.length) { showReceipt('Nothing to remember', notRead || 'Paste a thread, an e-mail or a note first.', null); return; }
    setBusy(true);
    avatar.play('processing', { loop: true });
    try {
      const p = principal();
      const sources: string[] = [];
      if (typed) sources.push(typed);
      for (const f of texts) sources.push(await f.text());
      const got: ImportCaptured[] = [];
      let claims = 0;
      for (const text of sources.filter((t) => t.trim())) {
        const res = await api.call('POST /import', {
          body: { format: 'paste', payload: { text, ...(hasIdentity() ? { authorName: p.displayName } : {}) }, ...(p.groups.length ? { accessGroups: [...p.groups] } : {}) },
        });
        claims += res.claims;
        if (res.captured) got.push(res.captured);
      }
      field.value = '';
      attachments = skipped;
      renderAttachments();
      setBusy(false);
      state.serviceDown = false;
      persist();
      const cases = new Map(got.flatMap((c) => c.cases.map((x) => [x.id, x.title] as const)));
      const bound = [...new Set(got.flatMap((c) => [...c.entities, ...c.people]))];
      const from = got.map((c) => c.from).find(Boolean);
      const end = got.map((c) => c.to ?? c.from).filter(Boolean).at(-1);
      const range = from ? `${from}${end && end !== from ? '–' + end : ''}${got.some((c) => c.dateKnown) ? '' : ' (date unknown)'}` : got.some((c) => c.dateKnown) ? '' : 'date unknown';
      const wider = got.some((c) => c.widerAccess) ? 'already visible beyond your groups' : '';
      const detail = [bound.length ? `bound to ${bound.join(', ')}` : 'no asset or person named', range, wider, notRead].filter(Boolean).join(' · ');
      if (got.length && got.every((c) => c.alreadyKnown)) showReceipt('Already captured', detail, null);
      else showReceipt(`Captured: ${cases.size} case${cases.size === 1 ? '' : 's'} · ${claims} claim${claims === 1 ? '' : 's'}`, detail, null);
      if (companion) react('hop');
      else avatar.play('result');
    } catch (e) {
      showError(e, () => { setView('input'); void remember(); }, true);
    }
  }
  function updateSend(): void {
    send.disabled = state.busy || (!field.value.trim() && !attachments.length);
    rememberBtn.disabled = send.disabled;
    // B4: offer capture only when the text looks like a conversation or e-mail, or a text file is attached.
    // Never captured on its own: a problem description is asked about, not stored.
    const kind = field.value.trim() ? detectPasteKind(field.value) : 'empty';
    offer.hidden = state.busy || !(kind === 'thread' || kind === 'email' || kind === 'teams-json' || attachments.some(isTextFile));
  }
  function renderAttachments(): void {
    const note = $('.rf-preview-note');
    const onlyFiles = attachments.length > 0 && !field.value.trim();
    note.textContent = onlyFiles ? 'Photos are attached for colleagues; one sentence about the problem is what gets matched.' : '';
    note.hidden = !onlyFiles;
    const wrap = $('.rf-attachments');
    wrap.replaceChildren();
    attachments.forEach((file, i) => {
      const chip = el('div', 'rf-chip');
      const remove = el('button', undefined, '×');
      remove.type = 'button';
      remove.dataset.action = 'remove-attachment';
      remove.dataset.index = String(i);
      remove.setAttribute('aria-label', 'Remove ' + file.name);
      // Artem 7 Nov: a thumbnail for images so you can see which picture is which (object URL, revoked on remove/send).
      if (file.type.startsWith('image/') && typeof URL.createObjectURL === 'function') {
        const img = document.createElement('img');
        img.className = 'rf-chip-thumb';
        img.alt = '';
        img.src = URL.createObjectURL(file);
        img.addEventListener('load', () => URL.revokeObjectURL(img.src), { once: true });
        chip.append(img);
      }
      chip.append(el('span', undefined, file.name), remove);
      wrap.append(chip);
    });
    wrap.hidden = !attachments.length;
    updateSend();
    motion.view(false);
  }
  function addFiles(files: File[]): void {
    attachments.push(...files);
    renderAttachments();
    avatar.play('input');
  }

  async function copyDraft(btn: HTMLElement): Promise<void> {
    let ok = false;
    try { await navigator.clipboard.writeText(draftText); ok = true; } catch {
      try {
        const t = el('textarea');
        t.value = draftText;
        t.style.cssText = 'position:fixed;opacity:0;pointer-events:none';
        document.body.append(t);
        t.select();
        ok = document.execCommand('copy');
        t.remove();
      } catch { ok = false; }
    }
    btn.textContent = ok ? 'Copied' : 'Select the text to copy';
  }

  function syncMotion(event?: { matches: boolean }): void {
    if (typeof event?.matches === 'boolean') systemReduced = event.matches;
    root.classList.toggle('rf-reduced', isReduced());
    const m = $<HTMLInputElement>('.rf-motion');
    m.checked = isReduced();
    m.disabled = systemReduced;
    if (isReduced()) { motion.settle(); avatar.refresh(); }
  }

  // ---- connection ----
  async function connect(): Promise<boolean> {
    const deadline = Date.now() + 12000;
    for (;;) {
      try {
        await loadDirectory();
        applySettings(await api.getSettings());
        state.serviceDown = false;
        await refreshQuestions();
        return true;
      } catch {
        if (destroyed || Date.now() > deadline) break;
        await new Promise((r) => setTimeout(r, 600));
      }
    }
    state.serviceDown = true;
    avatar.play('error');
    return false;
  }
  async function retryConnect(): Promise<void> {
    avatar.play('processing', { loop: true });
    const ok = await connect();
    if (ok) { avatar.play('hello'); setView('input'); focusFor('input'); } else showError(new ApiError('unreachable', 'GET /health', 'Couldn’t reach the service'), () => void retryConnect());
  }

  // ---- events (delegated, so dynamic content needs no re-binding) ----
  root.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!button || !root.contains(button)) return;
    const a = button.dataset.action!;
    switch (a) {
      // v009: the Springy tap on every direct click. desktop (R32): with the companion, pointer clicks go through
      // its gesture recogniser (press pose, then run('click', 2)) and the native click is suppressed; this path is the keyboard / programmatic click.
      case 'avatar': state.panelOpen ? closePanel() : openPanel(true); avatar.play('click'); return;
      case 'reset-position': companion?.command('reset-position'); return;
      case 'yes': case 'no': case 'unknown': case 'later': case 'dismiss': void respond(a); return;
      case 'input': case 'settings': case 'queue':
        if (a === 'queue') void refreshQuestions();
        setView(a);
        focusFor(a);
        if (a === 'queue' && state.active) root.querySelector<HTMLElement>(`.rf-question-item[data-question="${CSS.escape(state.active)}"]`)?.focus(focusOptions(modality.current()));
        return;
      case 'attach':
        if (state.view === 'input') $<HTMLInputElement>('.rf-files').click();
        else { setView('input'); field.focus(focusOptions(modality.current())); avatar.play('hello'); }
        return;
      case 'context': setExpanded(!state.expanded); return;
      case 'node': {
        const scope = button.dataset.scope!;
        const id = button.dataset.node!;
        state.openNodes[scope] = state.openNodes[scope] === id ? null : id;
        button.closest('.rf-evidence-path')?.querySelectorAll<HTMLElement>('.rf-node-title').forEach((b) => b.setAttribute('aria-expanded', String(b.dataset.node === state.openNodes[scope])));
        motion.node(state.openNodes[scope]!);
        return;
      }
      case 'open-question': {
        const id = button.dataset.question!;
        if (state.active !== id) { state.openNodes.question = null; state.expanded = false; }
        state.active = id;
        setView('question');
        focusFor('question');
        avatar.play('question');
        return;
      }
      case 'receipt-action': receiptAction?.run(); return;
      case 'send': void submit(); return;
      case 'remember': void remember(); return;
      case 'remove-attachment': attachments.splice(Number(button.dataset.index), 1); renderAttachments(); return;
      case 'people': peopleFromCase = false; setView('people'); focusFor('people'); return;
      case 'case-people': peopleFromCase = true; setView('people'); focusFor('people'); return;
      case 'points': pointsFrom = state.view === 'receipt' ? 'receipt' : 'settings'; setView('points'); focusFor('points'); return;
      case 'connections': setView('connections'); focusFor('connections'); return;
      case 'admin': setView('admin'); return;
      case 'conn': { // Artem 7 Nov: nothing connects yet; a click shows "Available soon" on that tile for a moment
        button.dataset.soon = '1';
        setTimeout(() => { delete button.dataset.soon; }, 1400);
        return;
      }
      case 'models': setView('models'); focusFor('models'); return;
      case 'model-download': void downloadModel(button.dataset.model!); return;
      case 'model-install': void installOllama(); return;
      case 'model-key': void saveKey(button.dataset.vendor as ApiVendorName); return;
      case 'model-test': void testKey(button.dataset.vendor as ApiVendorName, button.dataset.model); return;
      case 'model-copy': void navigator.clipboard?.writeText(button.dataset.text ?? '').catch(() => undefined); button.textContent = 'Copied'; return;
      case 'back': { const to = state.view === 'points' ? pointsFrom : state.view === 'people' && peopleFromCase ? 'case' : BACK[state.view]; if (to) { setView(to); focusFor(to); } return; }
      case 'open-context': {
        const name = button.dataset.entity;
        if (name) options.openContext?.(name);
        return;
      }
      case 'view-case': {
        const id = button.dataset.caseId!;
        void (async () => {
          try {
            caseView = result?.caseView?.caseId === id ? result.caseView : await api.caseView(id);
            state.openNodes.case = null;
            setView('case');
            focusFor('case');
          } catch (e) { showError(e, () => { setView('people'); }); }
        })();
        return;
      }
      case 'prepare': {
        const personId = button.dataset.person!;
        void (async () => {
          if (!result) return;
          try {
            const draft = await api.contactDraft({ principal: principal(), investigationId: result.investigationId, personEntityId: personId });
            renderContact(draft);
            setView('contact');
            focusFor('contact');
            avatar.play('result');
          } catch (e) { showError(e, () => { setView('people'); }); }
        })();
        return;
      }
      case 'copy-draft': void copyDraft(button); return;
      case 'reset-demo':
        if (button.dataset.armed !== 'true') {
          button.dataset.armed = 'true';
          button.textContent = 'Click again to reset';
          later(() => { if (button.dataset.armed === 'true') { delete button.dataset.armed; button.textContent = 'Reset demo'; } }, 3000);
          return;
        }
        delete button.dataset.armed;
        button.textContent = 'Resetting…';
        void (async () => {
          try {
            await api.resetDemo();
            await loadDirectory();
            applySettings(await api.getSettings());
            result = null; cache.clear(); state.active = null; state.expanded = false; state.openNodes = { question: null, result: null, case: null };
            await refreshQuestions();
            button.textContent = 'Demo reset';
            avatar.play('hello');
          } catch (e) { button.textContent = 'Reset demo'; showError(e, () => { setView('settings'); }); }
        })();
        return;
    }
  });
  field.addEventListener('input', () => { motion.settle(); updateSend(); if (attachments.length) renderAttachments(); if (field.value && !inputNoticed) { inputNoticed = true; avatar.play('input'); } if (!field.value) inputNoticed = false; persist(); });
  let inputNoticed = false;
  field.addEventListener('paste', (event) => { const files = event.clipboardData?.files; if (files?.length) { addFiles([...files]); } });
  $<HTMLInputElement>('.rf-files').addEventListener('change', (event) => { const input = event.target as HTMLInputElement; addFiles([...(input.files ?? [])]); input.value = ''; });
  let dragDepth = 0;
  win.addEventListener('dragenter', (e) => { e.preventDefault(); dragDepth++; win.dataset.drag = 'true'; });
  win.addEventListener('dragover', (e) => e.preventDefault());
  win.addEventListener('dragleave', () => { dragDepth--; if (dragDepth <= 0) win.dataset.drag = 'false'; });
  win.addEventListener('drop', (e) => {
    e.preventDefault(); dragDepth = 0; win.dataset.drag = 'false';
    if (state.view !== 'input') setView('input');
    if (e.dataTransfer?.files.length) addFiles([...e.dataTransfer.files]);
    else { const text = e.dataTransfer?.getData('text/plain'); if (text) field.value += (field.value ? '\n' : '') + text; updateSend(); persist(); }
  });
  const onKey = (event: KeyboardEvent): void => {
    if (event.key === 'Escape' && state.panelOpen) { event.preventDefault(); closePanel(true, 'keyboard'); }
    // Artem 7 Nov: Enter sends (Shift+Enter keeps a newline); Cmd/Ctrl+Enter still works. Only while typing in the field.
    // B4: Cmd/Ctrl+Shift+Enter is "Remember this".
    if (event.key === 'Enter' && event.shiftKey && (event.metaKey || event.ctrlKey) && state.panelOpen && state.view === 'input' && !rememberBtn.disabled) {
      event.preventDefault();
      void remember();
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && state.panelOpen && state.view === 'input' && document.activeElement === field) {
      event.preventDefault();
      if (!send.disabled) void submit();
    }
  };
  document.addEventListener('keydown', onKey);
  $<HTMLInputElement>('.rf-motion').addEventListener('change', (e) => void saveSetting({ reducedMotion: (e.target as HTMLInputElement).checked }));
  $<HTMLSelectElement>('.rf-you').addEventListener('change', (e) => {
    const id = (e.target as HTMLSelectElement).value;
    if (!id) return;
    void switchPerson(id);
  });
  $<HTMLInputElement>('.rf-points').addEventListener('change', (e) => void saveSetting({ points: (e.target as HTMLInputElement).checked }));
  $<HTMLInputElement>('.rf-optin').addEventListener('change', (e) => void setOptIn((e.target as HTMLInputElement).checked));
  $<HTMLInputElement>('.rf-mcp').addEventListener('change', (e) => void saveSetting({ mcp: (e.target as HTMLInputElement).checked }));
  $<HTMLInputElement>('.rf-fidgets').addEventListener('change', (e) => companion?.setFidgets((e.target as HTMLInputElement).checked));
  const onMedia = (e: MediaQueryListEvent): void => syncMotion(e);
  media?.addEventListener('change', onMedia);
  const onResize = (): void => { motion.view(false); motion.settle(); };
  window.addEventListener('resize', onResize);
  avatarButton.addEventListener('pointerdown', () => motion.press(true));
  const onPointerUp = (): void => motion.press(false);
  window.addEventListener('pointerup', onPointerUp);
  avatarButton.addEventListener('pointercancel', onPointerUp);

  // ---- boot: panel starts collapsed (R05); Lumi alone is visible ----
  syncMotion();
  setView(state.view, false);
  state.panelOpen = false;
  syncPoll();
  syncPanelA11y();
  motion.panel(false, false);
  updateSend();
  if (companionFlags) {
    // desktop (R31..R36): the companion owns the carrier from here; the entrance lands at his home spot.
    // Film (KT_FILM_ARRIVE): attention in memory only, started fresh whenever no question is open (a reset, all
    // answered), so a retake's question (same deterministic id) arrives again. Otherwise unchanged.
    let inner = createAttention({ storage: options.filmArrive ? null : storage });
    const att: Attention = options.filmArrive
      ? new Proxy({} as Attention, {
        get: (_t, key: keyof Attention) => (key === 'observe'
          ? (ids: readonly string[]) => { if (!ids.length) inner = createAttention({ storage: null }); inner.observe(ids); }
          : (...a: unknown[]) => (inner[key] as (...x: unknown[]) => unknown)(...a)),
      })
      : inner;
    attention = att;
    const c = createCompanion({
      avatar,
      flags: companionFlags,
      storage,
      panel: {
        isOpen: () => state.panelOpen,
        // ux fix M1: these come from his pointer gesture, the tray or the global shortcut: never the ring.
        toggle: () => (state.panelOpen ? closePanel(true, 'pointer') : openPanel(true, 'pointer')),
        open: () => { if (!state.panelOpen) openPanel(true, 'pointer'); },
        close: () => { if (state.panelOpen) closePanel(true, 'pointer'); },
        busy: () => state.busy,
        motionActive: () => motion.status().active,
        hasQuestion: unseenWaiting,
      },
      render: {
        carrier: (x, y) => { win.style.transform = `translate3d(${x}px, ${-y}px, 0)`; },
        shadow: (lift) => { shadowCanvas.style.transform = lift > 0 ? `translateY(${lift}px)` : ''; },
        carried: (on) => { if (on) root.dataset.ktCarried = 'true'; else delete root.dataset.ktCarried; },
      },
      area: () => ({ width: window.innerWidth, height: window.innerHeight }),
      dpr: () => globalThis.devicePixelRatio || 1,
      reduced: isReduced,
      emit: (type, detail) => { window.dispatchEvent(new CustomEvent(type, { detail })); },
      onReturn: () => watch?.wake('return'),
      onWake: (event, ms) => watch?.wake(event === 'resume' ? 'resume' : 'unlock-screen', ms),
      onIgnored: (id) => att.ignored(id),
    });
    companion = c;
    watch = createQuestionWatch({
      attention: att,
      refresh: refreshQuestions,
      collapsed: () => !state.panelOpen,
      hidden: () => !!document.hidden,
      arrive: (id, kind) => {
        const ok = c.arrive(id, kind);
        // Film: once at the perch, open the question he came with (the same path as a click on him there).
        if (ok && options.filmArrive) {
          const started = Date.now();
          const t = setInterval(() => {
            const s = c.status().state;
            if (s === 'perched' || Date.now() - started > 8000) {
              clearInterval(t);
              if (s === 'perched' && !state.panelOpen) { state.active = id; selfOpened = true; setView('question'); }
            }
          }, 100);
        }
        return ok;
      },
      ...(options.questionPollMs ? { pollMs: options.questionPollMs } : {}),
    });
    root.dataset.ktCompanion = 'on';
    if (companionFlags.drag) root.dataset.ktDrag = 'on';
    detachCompanion = attachCompanion(c, { root, avatarButton, win: window });
    c.start();
    watch.sync();
    // Make way (Artem 8 Nov): when he works elsewhere while the card is open, the card closes and Lumi tucks away at
    // the edge (he peeks out when the pointer comes near, and arrives with the next question). Two signals: he clicks
    // into another app, or the pointer keeps working elsewhere (6 s; 12 s when the card opened by itself). Never while
    // a message is being written or the service is busy.
    {
      const MAKE_WAY_MS = 6000, MAKE_WAY_SELF_MS = 12000, PAD = 24;
      let elsewhere = 0, lastMove = 0;
      const near = (x: number, y: number): boolean => [win, avatarButton].some((e) => {
        const r = e.getBoundingClientRect();
        return x >= r.left - PAD && x <= r.right + PAD && y >= r.top - PAD && y <= r.bottom + PAD;
      });
      const makeWay = (): void => {
        elsewhere = 0;
        if (!state.panelOpen || state.busy || field.value.trim() || destroyed) return;
        closePanel(true, 'pointer');
        if (companionFlags.away) c.command('away');
      };
      const onMove = (e: MouseEvent): void => {
        const now = performance.now();
        const dt = now - lastMove;
        lastMove = now;
        if (!state.panelOpen || near(e.clientX, e.clientY)) { elsewhere = 0; return; }
        if (dt < 500) elsewhere += dt; // continuous work counts, not one stray move
        if (elsewhere >= (selfOpened ? MAKE_WAY_SELF_MS : MAKE_WAY_MS)) makeWay();
      };
      const onBlur = (): void => {
        if (!state.panelOpen) return;
        setTimeout(() => { if (!document.hasFocus()) makeWay(); }, 400);
      };
      window.addEventListener('mousemove', onMove, { passive: true });
      window.addEventListener('blur', onBlur);
      detachMakeWay = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('blur', onBlur); };
    }
    // Film: start away at the edge, so a question makes him come in (after the launch entrance).
    if (options.filmArrive && companionFlags.away) setTimeout(() => c.command('away'), 2500);
  }
  if (options.entrance !== false) avatar.playEntranceThenRest();
  void connect();

  const companionHooks: PanelCompanion | null = companion && attention
    ? ((c: Companion, att: Attention): PanelCompanion => ({
        command: (command) => c.command(command),
        status: () => c.status(),
        pointer: (x, y) => c.pointer(x, y),
        power: (event) => c.power(event),
        arrive: (id) => {
          const target = id ?? att.nextArrival(openIds()) ?? openIds()[0];
          if (!target || !c.arrive(target, 'arrival')) return false;
          att.markAnnounced(target);
          return true;
        },
        poll: () => refreshQuestions(),
        engagement: () => att.counters(),
        setFidgets: (on) => c.setFidgets(on),
      }))(companion, attention)
    : null;

  return {
    open: () => { if (!state.panelOpen) openPanel(); },
    close: () => { if (state.panelOpen) closePanel(); },
    toggle: () => (state.panelOpen ? closePanel() : openPanel()),
    companion: companionHooks,
    attachFiles: addFiles,
    refresh: async () => { try { await loadDirectory(); applySettings(await api.getSettings()); } catch { state.serviceDown = true; return; } await refreshQuestions(); },
    showView: (view) => { if (view === 'points') pointsFrom = 'settings'; setView(view); },
    connect,
    status: () => ({
      view: state.panelOpen ? state.view : 'collapsed',
      panelOpen: state.panelOpen,
      uiMotion: motion.status(),
      lastOpen: state.lastOpen,
      openNodes: { ...state.openNodes },
      expanded: state.expanded,
      attachments: attachments.map((f) => f.name),
      draft: field.value,
      reduced: isReduced(),
      serviceDown: state.serviceDown,
      busy: state.busy,
      openQuestions: open.length,
      ...(result ? { investigationId: result.investigationId } : {}),
      avatar: avatar.status(),
      companion: companion?.status() ?? null,
      unseenQuestion: unseenWaiting(),
      points: { display: state.points, participates: pointsOptIn ? pointsOptIn.participates : null, balance: pointsRating?.me?.balance ?? null, rank: pointsRating?.me?.rank ?? null },
    }),
    destroy: () => {
      destroyed = true;
      timers.forEach(clearTimeout);
      modelTimers.forEach(clearTimeout);
      syncPoll();
      detachCompanion();
      detachMakeWay();
      modality.detach();
      companion?.destroy();
      watch?.destroy();
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('pointerup', onPointerUp);
      media?.removeEventListener('change', onMedia);
      avatar.destroy();
    },
  };
}
