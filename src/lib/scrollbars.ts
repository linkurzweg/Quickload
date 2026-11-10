const surfaces = 'html, .game-shelf, dialog, textarea, .select-options';

/** Trackless overlay associated with a native scrolling element. */
interface Overlay {
  surface: HTMLElement;
  host: HTMLDivElement;
  vertical: HTMLDivElement;
  horizontal: HTMLDivElement;
}

/** Reveal draggable overlay thumbs only in the active native scroll context, without an opaque track.
 * Scroll/focus activity expires after 900 ms; the page scrollbar also appears near its edge.
 * Returns cleanup for delegated listeners, pending timers and temporary attributes.
 */
export function trackScrollbars(): () => void {
  const timers = new Map<HTMLElement, number>();
  let hovered: HTMLElement | null = null;
  const overlays = new Map<HTMLElement, Overlay>();
  let frame = 0;
  let drag: {
    overlay: Overlay;
    axis: 'x' | 'y';
    start: number;
    scroll: number;
    ratio: number;
  } | null = null;

  /** Coalesce geometry reads/writes after scroll, resize or content changes into one frame. */
  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }

  /** Refresh indicator position and length using actual native scroll extents, removing detached surfaces. */
  function update() {
    frame = 0;
    for (const [surface, overlay] of overlays) {
      if (!surface.isConnected) {
        overlay.host.remove();
        overlays.delete(surface);
        resize.unobserve(surface);
        continue;
      }
      const rect =
        surface === document.documentElement
          ? { left: 0, top: 0, width: innerWidth, height: innerHeight }
          : surface.getBoundingClientRect();
      const visible =
        !surface.closest('[inert]') &&
        !(surface === document.documentElement && document.querySelector('[data-modal]')) &&
        rect.width > 0 &&
        rect.height > 0 &&
        rect.top < innerHeight &&
        rect.top + rect.height > 0;
      overlay.host.classList.toggle(
        'visible',
        visible &&
          (surface.hasAttribute('data-scroll-active') ||
            surface.hasAttribute('data-scroll-hover') ||
            drag?.overlay === overlay),
      );
      overlay.host.style.cssText = `left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px`;
      for (const axis of ['y', 'x'] as const) {
        const viewport = axis === 'y' ? surface.clientHeight : surface.clientWidth;
        const extent = axis === 'y' ? surface.scrollHeight : surface.scrollWidth;
        const position = axis === 'y' ? surface.scrollTop : surface.scrollLeft;
        const track = Math.max(0, (axis === 'y' ? rect.height : rect.width) - 12);
        const length = Math.min(track, Math.max(28, (track * viewport) / Math.max(extent, 1)));
        const offset =
          6 +
          Math.max(0, Math.min(1, position / Math.max(1, extent - viewport))) * (track - length);
        const thumb = axis === 'y' ? overlay.vertical : overlay.horizontal;
        thumb.hidden = !visible || extent <= viewport + 1 || track < 28;
        thumb.style.cssText =
          axis === 'y'
            ? `height:${length}px;transform:translateY(${offset}px)`
            : `width:${length}px;transform:translateX(${offset}px)`;
      }
    }
  }

  /** Begin pointer `event` dragging of `overlay` along `axis`, translating thumb travel into native scroll. */
  function beginDrag(event: PointerEvent, overlay: Overlay, axis: 'x' | 'y') {
    event.preventDefault();
    const thumb = event.currentTarget as HTMLDivElement;
    thumb.setPointerCapture(event.pointerId);
    const { surface, host } = overlay;
    const viewport = axis === 'y' ? surface.clientHeight : surface.clientWidth;
    const extent = axis === 'y' ? surface.scrollHeight : surface.scrollWidth;
    const travel =
      (axis === 'y'
        ? host.clientHeight - thumb.clientHeight
        : host.clientWidth - thumb.clientWidth) - 12;
    drag = {
      overlay,
      axis,
      start: axis === 'y' ? event.clientY : event.clientX,
      scroll: axis === 'y' ? surface.scrollTop : surface.scrollLeft,
      ratio: (extent - viewport) / Math.max(1, travel),
    };
    host.classList.add('dragging');
    reveal(surface);
  }

  /** Create a transparent overlay lazily for `surface`; its hidden thumbs never intercept input. */
  function ensure(surface: HTMLElement) {
    if (overlays.has(surface)) return;
    const host = document.createElement('div');
    host.className = 'scroll-overlay';
    host.setAttribute('aria-hidden', 'true');
    const vertical = document.createElement('div'),
      horizontal = document.createElement('div');
    vertical.className = 'scroll-thumb vertical';
    horizontal.className = 'scroll-thumb horizontal';
    host.append(vertical, horizontal);
    document.body.append(host);
    const overlay = { surface, host, vertical, horizontal };
    overlays.set(surface, overlay);
    resize.observe(surface);
    vertical.addEventListener('pointerdown', (event) => beginDrag(event, overlay, 'y'));
    horizontal.addEventListener('pointerdown', (event) => beginDrag(event, overlay, 'x'));
  }

  /** Release an active drag and retain its context hint briefly after release or window focus loss. */
  function endDrag() {
    drag?.overlay.host.classList.remove('dragging');
    if (drag) reveal(drag.overlay.surface);
    drag = null;
    schedule();
  }

  const resize = new ResizeObserver(schedule);
  const mutations = new MutationObserver(schedule);
  mutations.observe(document.body, { childList: true, subtree: true });

  /** Reveal `surface` and renew its idle timeout without installing per-element listeners. */
  function reveal(surface: HTMLElement) {
    ensure(surface);
    clearTimeout(timers.get(surface));
    surface.setAttribute('data-scroll-active', '');
    timers.set(
      surface,
      window.setTimeout(() => {
        surface.removeAttribute('data-scroll-active');
        timers.delete(surface);
        schedule();
      }, 900),
    );
    schedule();
  }

  /** Map delegated scroll/focus `event` to its own supported scrolling surface. */
  function activity(event: Event) {
    const surface =
      event.target === document
        ? document.documentElement
        : event.target instanceof Element
          ? event.target.closest<HTMLElement>(surfaces)
          : null;
    if (surface) reveal(surface);
  }

  /** Expose the native drag target when mouse `event` approaches a scrollable edge. */
  function edge(event: PointerEvent) {
    if (drag) {
      const value =
        drag.scroll +
        ((drag.axis === 'y' ? event.clientY : event.clientX) - drag.start) * drag.ratio;
      if (drag.axis === 'y') drag.overlay.surface.scrollTop = value;
      else drag.overlay.surface.scrollLeft = value;
      reveal(drag.overlay.surface);
      return;
    }
    const surface =
      event.target instanceof Element
        ? (event.target.closest<HTMLElement>(surfaces) ?? document.documentElement)
        : document.documentElement;
    const rect =
      surface === document.documentElement
        ? { right: window.innerWidth, bottom: window.innerHeight }
        : surface.getBoundingClientRect();
    const near =
      (surface.scrollHeight > surface.clientHeight && event.clientX >= rect.right - 16) ||
      (surface.scrollWidth > surface.clientWidth && event.clientY >= rect.bottom - 16);
    const next = near ? surface : null;
    if (next === hovered) return;
    hovered?.removeAttribute('data-scroll-hover');
    hovered = next;
    hovered?.setAttribute('data-scroll-hover', '');
    if (hovered) ensure(hovered);
    schedule();
  }

  /** Clear edge-hover state when the pointer leaves the application window. */
  function leave() {
    hovered?.removeAttribute('data-scroll-hover');
    hovered = null;
    schedule();
  }

  document.addEventListener('scroll', activity, { capture: true, passive: true });
  document.addEventListener('focusin', activity);
  document.addEventListener('pointermove', edge, { passive: true });
  document.addEventListener('pointerup', endDrag);
  document.addEventListener('pointercancel', endDrag);
  window.addEventListener('blur', endDrag);
  window.addEventListener('resize', schedule);
  document.documentElement.addEventListener('pointerleave', leave);
  return () => {
    document.removeEventListener('scroll', activity, true);
    document.removeEventListener('focusin', activity);
    document.removeEventListener('pointermove', edge);
    document.removeEventListener('pointerup', endDrag);
    document.removeEventListener('pointercancel', endDrag);
    window.removeEventListener('blur', endDrag);
    window.removeEventListener('resize', schedule);
    document.documentElement.removeEventListener('pointerleave', leave);
    leave();
    for (const [surface, timer] of timers) {
      clearTimeout(timer);
      surface.removeAttribute('data-scroll-active');
    }
    timers.clear();
    resize.disconnect();
    mutations.disconnect();
    cancelAnimationFrame(frame);
    for (const overlay of overlays.values()) overlay.host.remove();
    overlays.clear();
  };
}
