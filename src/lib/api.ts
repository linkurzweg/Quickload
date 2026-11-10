import { invoke, isTauri } from '@tauri-apps/api/core';
import { demoLibrary } from './demo';
import { defaults, type LaunchReport, type Library, type Settings, type Store } from './types';
export const native = isTauri();
let preview: Library = structuredClone(demoLibrary);
try {
  const saved = localStorage.getItem('quickload-preview');
  if (saved) {
    const parsed = JSON.parse(saved);
    if (Array.isArray(parsed.games) && parsed.settings)
      preview = { ...parsed, settings: { ...defaults, ...parsed.settings } };
  }
} catch {
  /* Isolated preview data may be discarded. */
}
/** Persist browser-preview state if storage is available and return a detached library snapshot. */

function persist() {
  try {
    localStorage.setItem('quickload-preview', JSON.stringify(preview));
  } catch {
    /* Storage can be disabled in private browser windows. */
  }
  return structuredClone(preview);
}
export const api = {
  /** Request native closure through the pending-preference close guard; reject browser previews. */
  async quit(): Promise<void> {
    if (!native) throw new Error('Closing is available in the desktop app.');
    await invoke('close_window');
  },
  /** Return whether this native executable can start independently of a development server. */
  async loginStartupSupported(): Promise<boolean> {
    return native && (await invoke('supports_login_startup')) === true;
  },
  /** Flush pending preferences before native closure and report failures without closing. */
  async guardClose(flush: () => Promise<boolean>, failed: () => void): Promise<() => void> {
    if (!native) return () => {};
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    let approved = false;
    let closing = false;
    return getCurrentWindow().onCloseRequested(async (event) => {
      if (approved) return;
      event.preventDefault();
      if (closing) return;
      closing = true;
      try {
        if (await flush()) {
          approved = true;
          await invoke('close_window');
        } else failed();
      } catch {
        approved = false;
        failed();
      } finally {
        closing = false;
      }
    });
  },
  /** Read updater availability from the native bundle without making a network request. */
  async updatesSupported(): Promise<boolean> {
    return native && (await invoke('supports_updates')) === true;
  },
  /** Read the local copies of custom SVGs keyed by provider. */
  async providerIcons(): Promise<Partial<Record<Store, string>>> {
    return (await invoke<Partial<Record<Store, string>> | null>('get_provider_icons')) ?? {};
  },
  /** Import an SVG from the selected `path`, or restore the default when it is omitted. */
  async setProviderIcon(store: Store, path?: string): Promise<string | null> {
    return invoke('set_provider_icon', { store, path });
  },
  /** Fill empty provider icon slots from the selected local directory and report save failures. */
  async importProviderIcons(
    path: string,
  ): Promise<{ icons: Partial<Record<Store, string>>; failed: boolean }> {
    return invoke('import_provider_icons', { path });
  },
  /** Check the fixed release feed and return the newer version, if any. */
  async checkUpdate(): Promise<string | null> {
    return invoke('check_update');
  },
  /** Stage the checked release on disk after verifying its signature. */
  async stageUpdate(): Promise<void> {
    await invoke('stage_update');
  },
  /** Install a staged release after preferences are saved. Windows may exit during handoff. */
  async installUpdate(restart: boolean): Promise<void> {
    await invoke('install_update', { restart });
  },
  /** Open the project's fixed release downloads page in the system browser. */
  async releaseDownloads(): Promise<void> {
    await invoke('open_release_downloads');
  },
  /** Load a detached library snapshot from native storage or the isolated browser preview. */
  async load(): Promise<Library> {
    return native ? invoke('get_library') : structuredClone(preview);
  },
  /** Scan known local providers through native IPC; browser preview rejects filesystem access. */
  async scan(): Promise<{ library: Library; warnings: string[]; elapsedMs: number }> {
    if (!native) throw new Error('Local game discovery is available in the desktop app.');
    return invoke('scan_library');
  },
  /** Persist boolean `favorite` for known game `id` and return the updated library. */
  async favorite(id: string, favorite: boolean): Promise<Library> {
    if (native) return invoke('set_favorite', { id, favorite });
    preview.games = preview.games.map((g) => (g.id === id ? { ...g, favorite } : g));
    return persist();
  },
  /** Persist the complete `settings` snapshot and return the updated library. */
  async settings(settings: Settings): Promise<Library> {
    if (native) return invoke('save_settings', { settings });
    preview.settings = settings;
    return persist();
  },
  /** Launch known game `id`; preview/demo entries reject the request without launching processes. */
  async launch(id: string): Promise<{ library: Library; report: LaunchReport }> {
    if (!native || id.startsWith('demo:'))
      throw new Error('Design preview: example games are not installed.');
    const result = await invoke<Library | { library: Library; report: LaunchReport }>(
      'launch_game',
      { id },
    );
    return 'report' in result
      ? result
      : { library: result, report: { status: 'handedOff', route: 'Legacy IPC' } };
  },
  /** Add display `title` and absolute executable `path`; native validation errors propagate. */
  async add(title: string, path: string): Promise<Library> {
    if (!native) throw new Error('You can add your own games in the desktop app.');
    return invoke('add_manual', { title, path });
  },
  /** Remove manual entry `id` through native IPC, leaving the executable on disk. */
  async remove(id: string): Promise<Library> {
    return invoke('remove_manual', { id });
  },
  /** Read actual native fullscreen after startup, or the browser's current fullscreen state. */
  async fullscreenState(): Promise<boolean> {
    return native ? invoke('get_fullscreen') : Boolean(document.fullscreenElement);
  },
  /** Apply fullscreen `enabled` through the native bridge or browser API; return the applied state. */
  async fullscreen(enabled: boolean): Promise<boolean> {
    if (native) return invoke('set_borderless', { enabled });
    if (enabled) await document.documentElement.requestFullscreen();
    else if (document.fullscreenElement) await document.exitFullscreen();
    return enabled;
  },
};
