/** Controller glyph family; Nintendo uses its labelled A-confirm/B-cancel convention. */
export type GlyphFamily = 'xbox' | 'playstation' | 'nintendo';
/** Infer glyphs from hardware `id`; ambiguous or generic names default to Xbox. Users can override this. */

export function detectFamily(id: string): GlyphFamily {
  if (/nintendo|switch|joy-?con|057e|^pro controller(?:\s|$)/i.test(id)) return 'nintendo';
  return /dualsense|dualshock|playstation|sony|054c|^wireless controller(?:\s|$)/i.test(id)
    ? 'playstation'
    : 'xbox';
}

/** Return semantic button indices for standard-mapped `family`; labels and actions agree on Nintendo. */
export function controllerButtons(family: GlyphFamily) {
  return family === 'nintendo'
    ? { accept: 1, back: 0, favorite: 3, search: 2 }
    : { accept: 0, back: 1, favorite: 2, search: 3 };
}

/** Close the expanded custom select, restoring its trigger; return whether input was consumed. */
export function closeActiveSelect(): boolean {
  const trigger = document.querySelector<HTMLButtonElement>(
    '[role="combobox"][aria-expanded="true"]',
  );
  if (!trigger) return false;
  trigger.click();
  return true;
}

/** Convert normalized stick `axis` to pixels per second, with a drift deadzone and progressive speed.
 * Invalid readings stop scrolling; full deflection is bounded to 1150 px/s in either direction.
 */
export function scrollVelocity(axis: number): number {
  if (!Number.isFinite(axis) || Math.abs(axis) <= 0.22) return 0;
  const strength = (Math.min(Math.abs(axis), 1) - 0.22) / 0.78;
  return Math.sign(axis) * strength ** 1.6 * 1150;
}

/** Reveal focused `element` within its scroll containers, respecting CSS header/focus gutters.
 * Fixed header controls are already visible and must never pull the document back to the top.
 */
export function revealFocus(element: HTMLElement) {
  if (element.closest('.topbar')) return;
  const shelf = element.closest<HTMLElement>('.game-shelf');
  if (shelf) {
    const bounds = shelf.getBoundingClientRect();
    const target = element.getBoundingClientRect();
    const left =
      target.left < bounds.left + 16
        ? target.left - bounds.left - 16
        : target.right > bounds.right - 16
          ? target.right - bounds.right + 16
          : 0;
    shelf.scrollBy({ left, behavior: 'instant' });
    return;
  }
  const dialog = element.closest<HTMLElement>('[data-modal]');
  if (dialog) {
    const bounds = dialog.getBoundingClientRect();
    const target = element.getBoundingClientRect();
    const top =
      target.top < bounds.top + 20
        ? target.top - bounds.top - 20
        : target.bottom > bounds.bottom - 20
          ? target.bottom - bounds.bottom + 20
          : 0;
    dialog.scrollBy({ top, behavior: 'instant' });
    return;
  }
  element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
}

/** Keep keyboard, controller and programmatic focus visible; coalesce layout work to one frame.
 * Returns cleanup for the listener and any pending animation frame.
 */
export function trackFocusVisibility(): () => void {
  let frame = 0;
  /** Schedule a reveal for the final active control after all focus handlers have completed. */
  function follow() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (active instanceof HTMLElement && active.matches('[data-nav]')) revealFocus(active);
    });
  }
  document.addEventListener('focusin', follow);
  return () => {
    document.removeEventListener('focusin', follow);
    cancelAnimationFrame(frame);
  };
}

/** Scroll by pixel deltas `x`/`y` without moving focus.
 * Dialogs own both axes; otherwise vertical motion scrolls the page and horizontal motion the focused shelf.
 * Returns the shelf whose scroll snapping is temporarily disabled, or null when no shelf is scrolled.
 */
export function scrollSurface(x: number, y: number): HTMLElement | null {
  const dialog = document.querySelector<HTMLElement>('[data-modal]:not([inert])');
  if (dialog) {
    dialog.scrollBy({ left: x, top: y, behavior: 'instant' });
    return null;
  }
  if (y) window.scrollBy({ top: y, behavior: 'instant' });
  const shelf = document.activeElement?.closest<HTMLElement>('.game-shelf');
  if (x && shelf) {
    if (
      (x > 0 && shelf.scrollLeft + shelf.clientWidth >= shelf.scrollWidth - 2) ||
      (x < 0 && shelf.scrollLeft <= 2)
    )
      shelf.dispatchEvent(new CustomEvent('shelf-page', { bubbles: true, detail: Math.sign(x) }));
    if (!shelf.hasAttribute('data-analog-scroll')) shelf.setAttribute('data-analog-scroll', '');
    shelf.scrollBy({ left: x, behavior: 'instant' });
    return shelf;
  }
  return null;
}
/** Choose the nearest candidate in `direction` from `origin`; `candidates` contains visible element rectangles. Returns null when none is ahead. */

export function directionTarget(
  origin: DOMRect,
  candidates: { element: HTMLElement; rect: DOMRect }[],
  direction: string,
): HTMLElement | null {
  const ox = origin.left + origin.width / 2,
    oy = origin.top + origin.height / 2;
  let best: HTMLElement | null = null,
    score = Infinity;
  for (const { element, rect } of candidates) {
    const dx = rect.left + rect.width / 2 - ox,
      dy = rect.top + rect.height / 2 - oy;
    const primary =
      direction === 'right' ? dx : direction === 'left' ? -dx : direction === 'down' ? dy : -dy;
    const secondary = direction === 'right' || direction === 'left' ? Math.abs(dy) : Math.abs(dx);
    if (primary <= 5) continue;
    const next = primary + secondary * 3 + (secondary > primary ? 1000 : 0);
    if (next < score) {
      best = element;
      score = next;
    }
  }
  return best;
}
/** Move focus in `direction` within the active dialog or page, scrolling only the selected target into view. */

export function moveFocus(direction: string) {
  const scope =
    document.querySelector('[data-select-list]') ??
    document.querySelector('[data-modal]:not([inert])') ??
    document;
  const elements = [...scope.querySelectorAll<HTMLElement>('[data-nav]:not(:disabled)')].filter(
    (e) => e.getClientRects().length && !e.closest('[inert]'),
  );
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !elements.includes(active)) {
    elements[0]?.focus();
    return;
  }
  const shelf = active.closest('.game-shelf');
  if (shelf && (direction === 'left' || direction === 'right')) {
    const cards = [...shelf.querySelectorAll<HTMLElement>('[data-game]')];
    const index = cards.indexOf(active);
    if (index >= 0) {
      const next = cards[index + (direction === 'right' ? 1 : -1)];
      if (next) next.focus({ preventScroll: true });
      else
        shelf.dispatchEvent(
          new CustomEvent('shelf-page', {
            bubbles: true,
            detail: direction === 'right' ? 1 : -1,
          }),
        );
      return;
    }
  }
  const next = directionTarget(
    active.getBoundingClientRect(),
    elements
      .filter((e) => e !== active)
      .map((element) => ({ element, rect: element.getBoundingClientRect() })),
    direction,
  );
  next?.focus({ preventScroll: true });
}
/** Poll standard gamepads with idle backoff. `onFamily` receives connection identity; `action` receives
 * semantic button actions. Optional `getFamily` applies the user's mapping override as well as glyphs.
 * Returns cleanup for timers, animation frames and input listeners.
 */

export function startController(
  onFamily: (family: GlyphFamily | null, name: string) => void,
  action: (action: string) => void,
  getFamily?: () => GlyphFamily,
) {
  let timer = 0,
    frame = 0,
    lastFrame = 0,
    rightX = 0,
    rightY = 0,
    stopped = false,
    previous: boolean[] = [],
    lastDirection = '',
    lastMove = 0,
    identity = '';
  let scrollingShelf: HTMLElement | null = null;
  /** Integrate right-stick velocity at rAF timestamp `now`; cap long stalls to avoid scroll jumps. */
  function scrollFrame(now: number) {
    frame = 0;
    if (stopped || document.hidden || !document.hasFocus()) return;
    const seconds = Math.min(Math.max(now - lastFrame, 0), 50) / 1000;
    lastFrame = now;
    const shelf = scrollSurface(scrollVelocity(rightX) * seconds, scrollVelocity(rightY) * seconds);
    if (scrollingShelf !== shelf) {
      scrollingShelf?.removeAttribute('data-analog-scroll');
      scrollingShelf = shelf;
    }
    if (scrollVelocity(rightX) || scrollVelocity(rightY))
      frame = requestAnimationFrame(scrollFrame);
  }
  /** Read the active standard gamepad only while focused, debounce buttons and schedule the next bounded poll. */

  function poll() {
    if (stopped) return;
    const pad =
      !document.hidden && document.hasFocus()
        ? [...(navigator.getGamepads?.() ?? [])].find((p) => p?.connected)
        : null;
    const key = pad ? `${pad.index}:${pad.id}` : '';
    if (key !== identity) {
      identity = key;
      previous = [];
      lastDirection = '';
      onFamily(pad ? detectFamily(pad.id) : null, pad?.id ?? '');
    }
    rightX = pad?.mapping === 'standard' ? (pad.axes[2] ?? 0) : 0;
    rightY = pad?.mapping === 'standard' ? (pad.axes[3] ?? 0) : 0;
    if (scrollVelocity(rightX) || scrollVelocity(rightY)) {
      document.body.classList.add('controller-input');
      if (!frame) {
        lastFrame = performance.now();
        frame = requestAnimationFrame(scrollFrame);
      }
    } else {
      cancelAnimationFrame(frame);
      frame = 0;
      scrollingShelf?.removeAttribute('data-analog-scroll');
      scrollingShelf = null;
    }
    if (pad) {
      const pressed = pad.buttons.map((b) => b.pressed);
      if (pad.mapping !== 'standard') {
        timer = window.setTimeout(poll, 250);
        return;
      }
      const x = pad.axes[0] ?? 0,
        y = pad.axes[1] ?? 0;
      const dir =
        pressed[12] || y < -0.6
          ? 'up'
          : pressed[13] || y > 0.6
            ? 'down'
            : pressed[14] || x < -0.6
              ? 'left'
              : pressed[15] || x > 0.6
                ? 'right'
                : '';
      const now = performance.now();
      if (pressed.some((down, index) => down && !previous[index]))
        document.body.classList.add('controller-input');
      if (dir && (dir !== lastDirection || now - lastMove > 190)) {
        document.body.classList.add('controller-input');
        moveFocus(dir);
        lastMove = now;
      }
      lastDirection = dir;
      const buttons = controllerButtons(getFamily?.() ?? detectFamily(pad.id));
      for (const [button, name] of [
        [buttons.accept, 'accept'],
        [buttons.back, 'back'],
        [buttons.favorite, 'favorite'],
        [buttons.search, 'search'],
        [4, 'previous'],
        [5, 'next'],
        [6, 'shift'],
        [7, 'submit-text'],
        [8, 'settings'],
        [9, 'fullscreen'],
      ] as const) {
        if (pressed[button] && !previous[button]) {
          document.body.classList.add('controller-input');
          action(name);
        }
      }
      previous = pressed;
    }
    timer = window.setTimeout(poll, pad ? 25 : 500);
  }
  /** Restore pointer/keyboard presentation immediately on physical input, before app shortcuts run. */
  function restorePointer() {
    document.body.classList.remove('controller-input');
  }
  let pointerPosition: { x: number; y: number } | null = null;
  /** Restore on changed coordinates in pointer `event`, including WebViews reporting zero movement deltas.
   * Ignore stationary pointer updates caused by scrolling beneath the mouse.
   */
  function pointerMove(event: PointerEvent) {
    if (
      event.movementX ||
      event.movementY ||
      !pointerPosition ||
      event.clientX !== pointerPosition.x ||
      event.clientY !== pointerPosition.y
    )
      restorePointer();
    pointerPosition = { x: event.clientX, y: event.clientY };
  }
  document.addEventListener('pointerdown', restorePointer, true);
  document.addEventListener('pointermove', pointerMove, { passive: true });
  document.addEventListener('wheel', restorePointer, { passive: true });
  document.addEventListener('keydown', restorePointer, true);
  poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
    cancelAnimationFrame(frame);
    scrollingShelf?.removeAttribute('data-analog-scroll');
    document.removeEventListener('pointerdown', restorePointer, true);
    document.removeEventListener('pointermove', pointerMove);
    document.removeEventListener('wheel', restorePointer);
    document.removeEventListener('keydown', restorePointer, true);
    document.body.classList.remove('controller-input');
  };
}
