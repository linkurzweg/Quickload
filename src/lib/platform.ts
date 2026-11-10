/** Return the platform family from browser `platform`, without requiring native IPC. */
export function platformFamily(platform: string): 'mac' | 'windows' | 'linux' {
  if (/mac/i.test(platform)) return 'mac';
  return /win/i.test(platform) ? 'windows' : 'linux';
}

/** Identify the conventional fullscreen shortcut in keyboard `event` for platform `platform`.
 * F11 remains an additional shortcut everywhere; repeated keydown events never toggle twice.
 */
export function isFullscreenShortcut(event: KeyboardEvent, platform: string): boolean {
  if (event.repeat) return false;
  if (event.key === 'F11' && !event.altKey && !event.ctrlKey && !event.metaKey) return true;
  if (platformFamily(platform) === 'mac')
    return (
      event.key.toLowerCase() === 'f' &&
      event.ctrlKey &&
      event.metaKey &&
      !event.altKey &&
      !event.shiftKey
    );
  return (
    event.key === 'Enter' && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey
  );
}

/** Return a compact, platform-appropriate fullscreen keycap for `platform`. */
export function fullscreenKeys(platform: string): string {
  return platformFamily(platform) === 'mac' ? '⌃⌘F' : 'Alt+Enter';
}
