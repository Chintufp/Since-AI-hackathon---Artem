/**
 * desktop (R34): keeps the open-question list fresh while the panel is collapsed, so a question
 * can reach the person while Lumi is away.
 *
 * Before the UX pass the panel polled `/questions` only while open (20 s) and ran no timer at all
 * while collapsed. Now, while collapsed and the document is visible, it polls every
 * COLLAPSED_POLL_MS (90 s), and refreshes at once on show, unlock, resume and when he comes back.
 * After every refresh (`handle(ids)`, called by the panel whatever triggered the refresh) the
 * attention rules decide whether he arrives with a new question or reminds about an old one.
 */
import { ATTENTION } from './attention.ts';
import type { Attention } from './attention.ts';

export const COLLAPSED_POLL_MS = 90000;

export type WakeReason = 'show' | 'return' | 'resume' | 'unlock-screen';

export interface WatchClock {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(id: unknown): void;
}

export interface QuestionWatchOptions {
  attention: Attention;
  /** Re-read the open questions (the panel's refresh; it calls `handle(ids)` afterwards). */
  refresh(): Promise<void> | void;
  /** The panel is collapsed. */
  collapsed(): boolean;
  /** document.hidden (window hidden / "Hide completely"): no polling. */
  hidden(): boolean;
  /** Ask the companion to come with `id`; true when he goes (only from away). */
  arrive(id: string, kind: 'arrival' | 'reminder'): boolean;
  clock?: WatchClock;
  pollMs?: number;
}

export interface QuestionWatch {
  /** Start / stop the collapsed poll to match the panel state; call after open / close. */
  sync(): void;
  /** Refresh now (show, return, unlock, resume); `awayForMs` arms one reminder when long enough. */
  wake(reason: WakeReason, awayForMs?: number): void;
  /** The open question ids after a refresh: arrivals and reminders go through the attention rules. */
  handle(ids: readonly string[]): void;
  status(): { polling: boolean; pendingReminder: boolean; polls: number };
  destroy(): void;
}

const defaultClock: WatchClock = {
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id as ReturnType<typeof setInterval>),
};

export function createQuestionWatch(o: QuestionWatchOptions): QuestionWatch {
  const clock = o.clock ?? defaultClock;
  const pollMs = o.pollMs ?? COLLAPSED_POLL_MS;
  let timer: unknown = null;
  let destroyed = false;
  let pendingReminder = false;
  let polls = 0;

  const tick = (): void => {
    if (destroyed || o.hidden() || !o.collapsed()) return;
    polls++;
    void o.refresh();
  };

  return {
    sync() {
      const want = !destroyed && o.collapsed();
      if (want && timer === null) timer = clock.setInterval(tick, pollMs);
      else if (!want && timer !== null) {
        clock.clearInterval(timer);
        timer = null;
      }
    },
    wake(reason, awayForMs = 0) {
      if (destroyed) return;
      if ((reason === 'resume' || reason === 'unlock-screen') && awayForMs >= ATTENTION.REMIND_AFTER_AWAY_MS) pendingReminder = true;
      // shell-05: hidden ("Hide completely"): no refresh; the reminder stays armed for the refresh on show.
      if (o.hidden()) return;
      void o.refresh();
    },
    handle(ids) {
      if (destroyed) return;
      o.attention.observe(ids);
      // shell-05: nobody can see an arrival while hidden; it must not use up the id's one arrival.
      if (o.hidden()) return;
      const arrival = o.attention.nextArrival(ids);
      if (arrival) {
        if (o.arrive(arrival, 'arrival')) o.attention.markAnnounced(arrival);
        return;
      }
      if (!pendingReminder) return;
      const reminder = o.attention.nextReminder(ids);
      // statemachine-reminder-dropped-when-refused: keep it armed until he actually goes (or nothing is left to remind).
      if (!reminder) pendingReminder = false;
      else if (o.arrive(reminder, 'reminder')) {
        o.attention.markReminded(reminder);
        pendingReminder = false;
      }
    },
    status: () => ({ polling: timer !== null, pendingReminder, polls }),
    destroy() {
      destroyed = true;
      if (timer !== null) clock.clearInterval(timer);
      timer = null;
    },
  };
}
