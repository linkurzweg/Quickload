export type Store =
  | 'steam'
  | 'epic'
  | 'gog'
  | 'xbox'
  | 'ubisoft'
  | 'battlenet'
  | 'rockstar'
  | 'manual';
export type Controller = 'auto' | 'xbox' | 'playstation' | 'nintendo';
/** Persisted language preference; system follows the operating system's preferred languages. */
export type Language = 'system' | 'de' | 'en';
/** Frontend subset of game metadata; launch actions reference validated native IDs. */
export interface Game {
  id: string;
  title: string;
  store: Store;
  installed: boolean;
  favorite: boolean;
  lastPlayed: number | null;
  launchCount: number;
  /** Canonical installation directory from discovery; used for cross-launcher grouping without UI filesystem calls. */
  installPath?: string | null;
}
/** Persisted accessibility, artwork, controller and additional discovery-root preferences. */
export interface Settings {
  controller: Controller;
  language: Language;
  controllerHints: boolean;
  reducedMotion: boolean;
  transparency: boolean;
  startupScan: boolean;
  startupFullscreen: boolean;
  startAtLogin: boolean;
  automaticUpdates: boolean;
  sound: boolean;
  focusShortcutEnabled: boolean;
  focusShortcut: string;
  steamRoots: string[];
  epicRoots: string[];
  gogRoots: string[];
  artwork: boolean;
  preferredInstallations?: Record<string, string>;
  artworkPositions?: Record<string, ArtworkPositions>;
}
/** Horizontal and vertical artwork focus expressed as percentages. */
export type ArtworkPosition = [number, number];
/** Saved framing can be adjusted independently for tiles and hero artwork. */
export interface ArtworkPositions {
  cover?: ArtworkPosition | null;
  hero?: ArtworkPosition | null;
}
/** Local evidence from native launch dispatch and brief process observation. */
export interface LaunchReport {
  status: 'handedOff' | 'running' | 'failed';
  route: string;
  executable?: string | null;
  pid?: number | null;
  exitCode?: number | null;
  error?: string | null;
}
/** Cached native or isolated preview library, including settings and Unix scan time. */
export interface Library {
  games: Game[];
  settings: Settings;
  lastScan: number | null;
}
export const defaults: Settings = {
  controller: 'auto',
  language: 'system',
  controllerHints: true,
  reducedMotion: false,
  transparency: true,
  startupScan: true,
  startupFullscreen: false,
  startAtLogin: false,
  automaticUpdates: false,
  sound: true,
  focusShortcutEnabled: false,
  focusShortcut: 'Ctrl+Shift+F12',
  steamRoots: [],
  epicRoots: [],
  gogRoots: [],
  artwork: true,
};
export const storeNames: Record<Store, string> = {
  steam: 'Steam',
  epic: 'Epic Games',
  gog: 'GOG',
  xbox: 'Xbox · Game Pass',
  ubisoft: 'Ubisoft Connect',
  battlenet: 'Battle.net',
  rockstar: 'Rockstar Games',
  manual: 'Your own games',
};
