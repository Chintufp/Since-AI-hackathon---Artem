/**
 * desktop (ux fix M1): programmatic focus without the keyboard focus ring after a mouse action.
 *
 * The panel moves focus after it opens / closes / changes view (v008 a11y). After a pointer action
 * Chromium may still draw `:focus-visible` (the grey ring) on the focused button; Chromium 140
 * (Electron 45) supports `focus({ focusVisible: false })`. Keyboard-initiated moves keep the ring.
 */
export type InputModality = 'keyboard' | 'pointer';

type Focusable = { focus(options?: FocusOptions): void };
type ProbeDocument = { createElement(tag: string): Focusable };

/** True when `focus()` reads the `focusVisible` option (feature detection; no element gets focus). */
export function probeFocusVisible(doc: ProbeDocument | null | undefined): boolean {
  let read = false;
  try {
    const options = {
      preventScroll: true,
      get focusVisible(): boolean {
        read = true;
        return false;
      },
    };
    // A detached element: the option dictionary is converted (and read) before focus is refused.
    doc?.createElement('div').focus(options as FocusOptions);
  } catch {
    return false;
  }
  return read;
}

let supported: boolean | undefined;
const focusVisibleSupported = (): boolean =>
  (supported ??= probeFocusVisible((globalThis as { document?: ProbeDocument }).document));

/** Focus options for a move caused by `via`: no ring after a pointer action (when supported). */
export function focusOptions(via: InputModality, canHideRing: boolean = focusVisibleSupported()): FocusOptions {
  return canHideRing ? ({ preventScroll: true, focusVisible: via === 'keyboard' } as FocusOptions) : { preventScroll: true };
}

/**
 * The last input modality in `root`'s document: pointerdown anywhere = pointer, a keydown = keyboard
 * (capture phase, before any handler moves focus). Returns the reader and the detach function.
 */
export function trackModality(target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>, initial: InputModality = 'pointer'): { current(): InputModality; detach(): void } {
  let modality = initial;
  const onPointer = (): void => {
    modality = 'pointer';
  };
  const onKey = (): void => {
    modality = 'keyboard';
  };
  target.addEventListener('pointerdown', onPointer, true);
  target.addEventListener('keydown', onKey, true);
  return {
    current: () => modality,
    detach() {
      target.removeEventListener('pointerdown', onPointer, true);
      target.removeEventListener('keydown', onKey, true);
    },
  };
}
