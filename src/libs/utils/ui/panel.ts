/**
 * The v008 panel as a factory. It renders into `root` (id "kt-panel"), talks to the service only
 * through an ApiClient and drives Snowbally only through the Avatar interface.
 *
 * Views: input, question, queue, settings, receipt (v008) plus result, people, case and contact
 * (new, same visual language). Behaviour kept from app.js: avatar click toggles the panel and
 * restores view/draft/attachments/expanded context/selected node, Back-to-questions arrow,
 * Dismiss + Undo, Escape closes, Cmd/Ctrl+Enter sends, paste/drop attachments as chips,
 * reduced motion settles instantly, stationary avatar hitbox.
 */
import { renderBurst, BURST } from '../motion/burst.ts';
import type { ActKey, AvatarHost, AvatarStatus, CompanionAvatar } from '../motion/avatar.ts';
import type { UserSettings } from '../contracts/outcomes.ts';
import type { DirectoryEntry, Principal } from '../contracts/service.ts';
import type { ContactDraft } from '../contracts/questions.ts';
import type { CaseView, PersonView, QuestionView, ResultView, TimelineNode } from '../contracts/views.ts';
import { ApiError } from './api-client.ts';
import type { ApiClient } from './api-client.ts';
import { hydrateIcons, iconSvg } from './icons.ts';
import { createPanelMotion } from './panel-motion.ts';
import type { PanelMotion, PanelMotionStatus } from './panel-motion.ts';
import { attachCompanion, createCompanion } from './companion.ts';
import type { Companion, CompanionCommand, CompanionFlags, CompanionPower, CompanionStatus } from './companion.ts';
import { createAttention } from './attention.ts';
import type { Attention, EngagementCounters } from './attention.ts';
import { createQuestionWatch } from './question-watch.ts';
import type { QuestionWatch } from './question-watch.ts';
import { focusOptions, trackModality } from './focus.ts';
import type { InputModality } from './focus.ts';

export type ViewName = 'input' | 'question' | 'queue' | 'settings' | 'receipt' | 'result' | 'people' | 'case' | 'contact';
const RESTORABLE: ViewName[] = ['input', 'queue', 'settings'];
const BACK: Partial<Record<ViewName, ViewName>> = { people: 'result', case: 'people', contact: 'people' };

export interface PanelOptions {
  root: HTMLElement;
  api: ApiClient;
  /**
   * Build Snowbally on the panel's canvas. The host callbacks let him react to panel state.
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
   * desktop (R31..R36): the companion flags (drag, away, gaze, fidgets). Default: `window.__ktFlags`
   * (set by the desktop renderer). null, `companion: false` or `windowMode: 'column'` = the R28 panel.
   */
  companion?: CompanionFlags | null;
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
  /** Run the service connection check; used at startup and by Retry. */
  connect(): Promise<boolean>;
  /** desktop (R31..R36): companion hooks for the harness; null when the companion is off. */
  companion: PanelCompanion | null;
  destroy(): void;
}

interface ReceiptAction {
  label: string;
  run: () => void;
}

const TEMPLATE = `
<div class="rf-stage" data-view="input">
 <div class="rf-window">
  <div class="rf-motion-skin" aria-hidden="true"></div>
  <div class="rf-surface"><div class="rf-content">
   <section class="rf-view rf-input" data-view="input" aria-label="Input">
    <textarea class="rf-writing" aria-label="Message to your companion" placeholder="Tell me what happened…"></textarea>
    <div class="rf-attachments" hidden></div>
    <input class="rf-files" type="file" multiple aria-label="Attach files">
   </section>
   <section class="rf-view" data-view="question" hidden>
    <div class="rf-question">
     <p class="rf-case"></p><button class="rf-tool rf-close" type="button" data-action="queue" aria-label="Back to questions"><i data-icon="arrow-left"></i></button>
     <h2></h2>
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
     <div class="rf-setting"><span>Server</span><span class="rf-setting-value rf-server rf-selectable"></span></div>
     <label class="rf-setting"><span>You</span><select class="rf-you" aria-label="Who you are"></select></label>
     <label class="rf-setting"><span>Provider</span><select class="rf-provider" disabled aria-label="Provider"><option>Local only</option></select></label>
     <div class="rf-setting"><span>Model</span><span class="rf-setting-value rf-model"></span></div>
     <label class="rf-setting rf-option"><span>MCP</span><input class="rf-mcp" type="checkbox"></label>
     <label class="rf-setting rf-option"><span>Reduced motion</span><input class="rf-motion" type="checkbox"></label>
     <label class="rf-setting rf-option"><span>Points &amp; rewards</span><input class="rf-points" type="checkbox"></label>
     <label class="rf-setting rf-option"><span>Sound</span><em class="rf-setting-note">No sounds yet</em><input class="rf-sound" type="checkbox" disabled aria-label="Sound (no sounds yet)"></label>
     <div class="rf-setting rf-option"><span>Demo data</span><button class="rf-later" type="button" data-action="reset-demo">Reset demo</button></div>
     <label class="rf-setting rf-option rf-desktop-companion" hidden><span>Fidgets</span><input class="rf-fidgets" type="checkbox"></label>
     <div class="rf-setting rf-option rf-desktop-companion" hidden><span>Position</span><button class="rf-later" type="button" data-action="reset-position">Put Snowbally back in the corner</button></div>
    </div>
   </section>
   <section class="rf-view rf-receipt" data-view="receipt" hidden aria-live="polite"><p class="rf-receipt-title"></p><div class="rf-receipt-detail"></div><div class="rf-reward" hidden><canvas width="${BURST.width}" height="${BURST.height}" aria-hidden="true"></canvas><span></span></div><button class="rf-undo" type="button" data-action="receipt-action">Undo</button></section>
   <section class="rf-view rf-result" data-view="result" aria-label="Result" hidden>
    <div class="rf-result-head"><p class="rf-result-title"></p><div class="rf-result-notes"></div></div>
    <div class="rf-case-path"></div>
    <div class="rf-result-rows"></div>
   </section>
   <section class="rf-view rf-panel-content" data-view="people" aria-label="People with relevant experience" hidden>
    <h2>People with relevant experience</h2><button class="rf-tool rf-close" type="button" data-action="back" aria-label="Back to result"><i data-icon="arrow-left"></i></button>
    <div class="rf-people-list rf-list-scroll"></div>
   </section>
   <section class="rf-view rf-panel-content" data-view="case" aria-label="Case" hidden>
    <p class="rf-case"></p><button class="rf-tool rf-close" type="button" data-action="back" aria-label="Back to people"><i data-icon="arrow-left"></i></button>
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
    $('.rf-question .rf-case').textContent = q ? q.caseLabel + (q.deferred ? ' · later' : '') : '';
    root.querySelectorAll<HTMLButtonElement>('.rf-answer[data-action], .rf-secondary-responses .rf-later').forEach((b) => (b.disabled = !q));
    const h = $('.rf-history');
    h.replaceChildren();
    if (!q) return;
    if (state.panelOpen && attention && attention.get(q.questionId)?.seen === undefined) {
      attention.markSeen(q.questionId); // desktop (R34)
      syncGlyph();
    }
    // Internal evidence ids are for traces, not for the person answering.
    h.append(el('p', 'rf-why', q.why.replace(/\s*Evidence:\s*(?:ev_\w+[,\s]*)+\.?\s*$/, '')));
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
  function renderQueue(): void {
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
      if (state.view === 'queue' && state.panelOpen) { renderQueue(); motion.view(false); }
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
      if (state.view === 'queue' && state.panelOpen) { renderQueue(); motion.view(false); }
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
  function renderResult(): void {
    if (!result) return;
    const r = result.recommendation;
    $('.rf-result-title').textContent = r.text;
    const notes = $('.rf-result-notes');
    notes.replaceChildren();
    // The engine's applicability is a one-word enum (qualified, ...): the sentence above already says it, so only prose is shown.
    const prose = /\s/.test(r.applicability) ? [r.applicability] : [];
    [...prose, ...r.caveats.slice(0, 3)].filter(Boolean).forEach((t) => notes.append(el('p', 'rf-result-note', t)));
    if (r.nextStep) notes.append(el('p', 'rf-result-note', 'Next: ' + r.nextStep));
    const path = $('.rf-case-path');
    path.replaceChildren();
    const cv = result.caseView;
    if (cv?.timeline.length) {
      path.hidden = false;
      path.append(el('p', 'rf-case', cv.title));
      path.append(evidencePath(cv.timeline, 'result', 'Matched case timeline; expand a title for details'));
      if (cv.caveat) path.append(el('p', 'rf-context-caveat', cv.caveat));
    } else path.hidden = true;
    const rows = $('.rf-result-rows');
    rows.replaceChildren();
    renderRow('People with relevant experience', String(result.people.length), 'people', rows).disabled = !result.people.length;
    if (result.question) {
      // The engine routes the question to someone else, never the requester: show it read-only.
      const asked = el('p', 'rf-asked', 'Asked a colleague with relevant experience');
      asked.append(el('span', 'rf-row-meta', result.question.status));
      rows.append(asked);
    } else if (result.loopReason) {
      rows.append(el('p', 'rf-loop-reason', result.loopReason));
    }
    motion.registerDetails(state.openNodes.result, path);
  }
  function renderPeople(): void {
    const list = $('.rf-people-list');
    list.replaceChildren();
    const people = result?.people ?? [];
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
    $('.rf-view[data-view="case"] .rf-case').textContent = caseView.title;
    const body = $('.rf-case-body');
    body.replaceChildren();
    const wrap = el('div', 'rf-case-path');
    wrap.style.borderTop = '0';
    wrap.style.padding = '8px 0 0';
    wrap.append(evidencePath(caseView.timeline, 'case', 'Case timeline; expand a title for details'));
    if (caseView.caveat) wrap.append(el('p', 'rf-context-caveat', caseView.caveat));
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
    $('.rf-model').textContent = settings?.model ?? '—';
    renderYou();
    $<HTMLInputElement>('.rf-mcp').checked = !!settings?.mcp;
    $<HTMLInputElement>('.rf-points').checked = state.points;
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
  }
  function applySettings(s: UserSettings): void {
    settings = s;
    state.points = !!s.points;
    state.reducedSetting = !!s.reducedMotion;
    syncMotion();
    if (state.view === 'settings') renderSettings();
  }
  async function saveSetting(patch: Partial<UserSettings>): Promise<void> {
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
    if (!['receipt', 'contact'].includes(view)) state.lastOpen = view;
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
    if (view === 'settings') renderSettings();
    if (view === 'result') renderResult();
    if (view === 'people') renderPeople();
    if (view === 'case') renderCase();
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
    companion?.panelClosed(); // desktop (R33): the idle timer starts; a displaced Snowbally rolls back to his spot
  }
  function focusFor(view: ViewName, via: InputModality = modality.current()): void {
    const target =
      view === 'input' ? field
      : view === 'question' ? root.querySelector<HTMLElement>('[data-action="yes"]')
      : view === 'receipt' ? (viewEl('receipt').querySelector<HTMLElement>('[data-action="receipt-action"]:not([hidden])') ?? $('[data-action="attach"]'))
      : view === 'queue' ? root.querySelector<HTMLElement>('.rf-question-item') ?? $('.rf-view[data-view="queue"] [data-action="input"]')
      : view === 'settings' ? $('.rf-view[data-view="settings"] [data-action="input"]')
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
  /** `user`: a direct click / key on Snowbally. Programmatic opens never move focus (desktop R33). */
  function openPanel(user = false, via: InputModality = modality.current()): void {
    if (state.serviceDown) {
      showError(new ApiError('unreachable', 'GET /health', 'Couldn’t reach the service'), () => void retryConnect());
    } else if (!state.panelOpen) {
      // desktop (R34): the glyph promised a question; a direct click opens it.
      const waiting = user && attention ? attention.unseen(openIds())[0] : undefined;
      if (waiting) {
        if (state.active !== waiting) { state.openNodes.question = null; state.expanded = false; }
        state.active = waiting;
        setView('question');
        focusFor('question', via);
        return;
      }
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
    state.busy = true;
    state.expanded = false;
    try {
      const p = principal();
      const res = value === 'later' ? await api.defer(q.questionId, p) : value === 'dismiss' ? await api.dismiss(q.questionId, p) : await api.answer(q.questionId, { principal: p, value });
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
    const text = field.value.trim();
    const names = attachments.map((f) => f.name);
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
  function updateSend(): void {
    send.disabled = state.busy || (!field.value.trim() && !attachments.length);
  }
  function renderAttachments(): void {
    const wrap = $('.rf-attachments');
    wrap.replaceChildren();
    attachments.forEach((file, i) => {
      const chip = el('div', 'rf-chip');
      const remove = el('button', undefined, '×');
      remove.type = 'button';
      remove.dataset.action = 'remove-attachment';
      remove.dataset.index = String(i);
      remove.setAttribute('aria-label', 'Remove ' + file.name);
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
      case 'remove-attachment': attachments.splice(Number(button.dataset.index), 1); renderAttachments(); return;
      case 'people': setView('people'); focusFor('people'); return;
      case 'back': { const to = BACK[state.view]; if (to) { setView(to); focusFor(to); } return; }
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
  field.addEventListener('input', () => { motion.settle(); updateSend(); if (field.value && !inputNoticed) { inputNoticed = true; avatar.play('input'); } if (!field.value) inputNoticed = false; persist(); });
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
    if ((event.metaKey || event.ctrlKey) && event.key === 'Enter' && state.panelOpen && state.view === 'input' && !send.disabled) { event.preventDefault(); void submit(); }
  };
  document.addEventListener('keydown', onKey);
  $<HTMLInputElement>('.rf-motion').addEventListener('change', (e) => void saveSetting({ reducedMotion: (e.target as HTMLInputElement).checked }));
  $<HTMLSelectElement>('.rf-you').addEventListener('change', (e) => {
    const id = (e.target as HTMLSelectElement).value;
    if (!id) return;
    void (async () => {
      await saveSetting({ currentPersonEntityId: id });
      cache.clear(); state.active = null; state.expanded = false; state.openNodes.question = null;
      await refreshQuestions();
    })();
  });
  $<HTMLInputElement>('.rf-points').addEventListener('change', (e) => void saveSetting({ points: (e.target as HTMLInputElement).checked }));
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

  // ---- boot: panel starts collapsed (R05); Snowbally alone is visible ----
  syncMotion();
  setView(state.view, false);
  state.panelOpen = false;
  syncPoll();
  syncPanelA11y();
  motion.panel(false, false);
  updateSend();
  if (companionFlags) {
    // desktop (R31..R36): the companion owns the carrier from here; the entrance lands at his home spot.
    const att = createAttention({ storage });
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
      arrive: (id, kind) => c.arrive(id, kind),
    });
    root.dataset.ktCompanion = 'on';
    if (companionFlags.drag) root.dataset.ktDrag = 'on';
    detachCompanion = attachCompanion(c, { root, avatarButton, win: window });
    c.start();
    watch.sync();
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
    }),
    destroy: () => {
      destroyed = true;
      timers.forEach(clearTimeout);
      syncPoll();
      detachCompanion();
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
