/** Suppress native title tooltips during controller input, restoring current labels on mouse/keyboard use.
 * Observe only title changes, inserted content and input-mode classes; no polling is required.
 */
export function manageTooltips(): () => void {
  const saved = new Map<Element, string>();
  /** Reconcile native titles after input-mode or DOM changes without changing accessible names. */
  function update() {
    if (document.body.classList.contains('controller-input')) {
      for (const element of document.querySelectorAll('[title]')) {
        saved.set(element, element.getAttribute('title') ?? '');
        element.removeAttribute('title');
      }
      for (const element of saved.keys()) if (!element.isConnected) saved.delete(element);
    } else {
      for (const [element, title] of saved)
        if (element.isConnected && !element.hasAttribute('title'))
          element.setAttribute('title', title);
      saved.clear();
    }
  }
  const mode = new MutationObserver(update);
  const content = new MutationObserver(update);
  mode.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  content.observe(document.body, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['title'],
  });
  update();
  return () => {
    mode.disconnect();
    content.disconnect();
    for (const [element, title] of saved)
      if (element.isConnected) element.setAttribute('title', title);
    saved.clear();
  };
}
