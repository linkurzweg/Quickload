import { convertFileSrc, invoke } from '@tauri-apps/api/core';
import { native } from './api';
import type { Game } from './types';

export type ArtworkKind = 'cover' | 'hero' | 'detail' | 'logo';
/** Resolved artwork URL and human-readable provenance; cached files use the scoped asset protocol. */
export interface ArtworkImage {
  url: string;
  source: string;
  fit?: 'contain' | 'cover';
  needsUpgrade?: boolean;
}
/** Native cache result; only the backend chooses the actual filesystem path. */
interface NativeArtwork {
  path: string;
  source: string;
  revision?: string;
  fit?: 'contain' | 'cover';
  needsUpgrade?: boolean;
}

const cache = new Map<string, Promise<ArtworkImage | null>>();
const localCache = new Map<string, Promise<ArtworkImage | null>>();
const settled = new Set<string>();
const missing = new Set<string>();
const remoteLane = { running: 0, waiting: [] as (() => void)[] };
const localLane = { running: 0, waiting: [] as (() => void)[] };
const LIMIT = 3;
const artworkVisibility = new WeakMap<Element, () => void>();
let artworkObserver: IntersectionObserver | undefined;

/** Observe `element` until it approaches the viewport, then call `reveal` once.
 * All lazy artwork shares one observer. The returned cleanup cancels a pending observation.
 */
export function observeArtwork(element: Element, reveal: () => void): () => void {
  artworkObserver ??= new IntersectionObserver(
    (entries, observer) => {
      for (const { target, isIntersecting } of entries) {
        if (!isIntersecting) continue;
        const callback = artworkVisibility.get(target);
        artworkVisibility.delete(target);
        observer.unobserve(target);
        callback?.();
      }
    },
    { rootMargin: '160px' },
  );
  artworkVisibility.set(element, reveal);
  artworkObserver.observe(element);
  return () => {
    artworkVisibility.delete(element);
    artworkObserver?.unobserve(element);
  };
}

/** Run async `work` with at most three image-resolution jobs active; release slots on failures too. */
async function scheduled<T>(
  work: () => Promise<T>,
  lane = remoteLane,
  priority = false,
): Promise<T> {
  if (lane.running >= LIMIT)
    await new Promise<void>((resolve) => {
      if (priority) lane.waiting.unshift(resolve);
      else lane.waiting.push(resolve);
    });
  else lane.running++;
  try {
    return await work();
  } finally {
    const next = lane.waiting.shift();
    if (next) next();
    else lane.running--;
  }
}

/** Convert a native `result` to a scoped URL and retain its framing and upgrade hints. */
function artworkUrl(result: NativeArtwork | null): ArtworkImage | null {
  return result?.path
    ? {
        url:
          convertFileSrc(result.path) +
          (result.revision ? `?v=${encodeURIComponent(result.revision)}` : ''),
        source: result.source,
        ...(result.fit ? { fit: result.fit } : {}),
        ...(result.needsUpgrade ? { needsUpgrade: true } : {}),
      }
    : null;
}

/** Read `game`'s local cover using a lane that is independent of active network requests. */
export function resolveLocalCover(game: Game): Promise<ArtworkImage | null> {
  if (!native) return Promise.resolve(null);
  const key = `${game.id}:${game.title}:cover`;
  let request = localCache.get(key);
  if (!request) {
    request = scheduled(
      async () =>
        artworkUrl(
          await invoke<NativeArtwork | null>('resolve_artwork', {
            id: game.id,
            kind: 'cover',
            localOnly: true,
          }),
        ),
      localLane,
    ).catch(() => null);
    localCache.set(key, request);
  }
  return request;
}

/** Fit near-16:9 publisher art without trimming lettering or leaving thin borders.
 * Larger mismatches retain proportional full-bleed rendering while better artwork resolves.
 */
export function tileImageFit(width: number, height: number): 'fill' | 'cover' {
  return height > 0 && Math.abs(width / height / (16 / 9) - 1) <= 0.03 ? 'fill' : 'cover';
}

/** Return ordered landscape/hero CDN candidates for `game`; store IDs are numeric and never title guesses.
 * Preview fixtures retain their explicit Steam IDs. Native cross-store lookup runs in Rust.
 */
export function artworkCandidates(game: Game, kind: ArtworkKind): string[] {
  const match = /^(?:steam|demo):(\d+)$/.exec(game.id);
  if (!match) return [];
  const files =
    kind === 'logo'
      ? ['logo_2x.png', 'logo.png']
      : kind === 'detail'
        ? ['library_hero_2x.jpg', 'library_hero.jpg', 'capsule_616x353.jpg']
        : kind === 'hero'
          ? ['library_hero_2x.jpg', 'library_hero.jpg', 'header.jpg']
          : ['capsule_616x353_2x.jpg', 'capsule_616x353.jpg', 'header.jpg', 'library_header.jpg'];
  return files.map(
    (file) => `https://cdn.cloudflare.steamstatic.com/steam/apps/${match[1]}/${file}`,
  );
}

/** Resolve `game`/`kind` once per session, using a bounded shared queue and native offline cache.
 * Background requests join the normal queue. Interactive heroes, details and logos get priority.
 */
export function resolveArtwork(
  game: Game,
  kind: ArtworkKind,
  background = false,
): Promise<ArtworkImage | null> {
  const key = `${game.id}:${game.title}:${kind}`;
  let request = cache.get(key);
  if (!request) {
    request = scheduled(
      async () => {
        if (!native) {
          const url = artworkCandidates(game, kind)[0];
          return url ? { url, source: 'Steam' } : null;
        }
        const result = await invoke<NativeArtwork | null>('resolve_artwork', { id: game.id, kind });
        return artworkUrl(result);
      },
      remoteLane,
      !background && (kind === 'detail' || kind === 'logo' || kind === 'hero'),
    )
      .catch(() => null)
      .then((image) => {
        if (cache.get(key) === request) {
          settled.add(key);
          if (!image) missing.add(key);
          else if (kind === 'cover' && native) localCache.set(key, Promise.resolve(image));
        }
        return image;
      });
    cache.set(key, request);
  }
  return request;
}

/** Warm detail artwork for `games` in library order, one low-priority image at a time.
 * Cleanup stops future work. The browser manages its own image cache.
 */
export function warmDetails(games: readonly Game[]): () => void {
  let cancelled = false;
  let index = 0;
  let idle = 0;
  /** Yield to rendering and input before processing the next game. */
  function scheduleNext() {
    if (!cancelled && index < games.length)
      idle = window.requestIdleCallback
        ? window.requestIdleCallback(warmNext)
        : window.setTimeout(warmNext, 120);
  }
  /** Resolve and decode a single game's banner and logo without retaining image elements. */
  async function warmNext() {
    const game = games[index++];
    for (const kind of ['detail', 'logo'] as const) {
      if (cancelled) return;
      const asset = await resolveArtwork(game, kind, true);
      if (cancelled) return;
      if (asset) {
        const image = new Image();
        image.fetchPriority = 'low';
        image.src = asset.url;
        await image.decode().catch(() => {});
      }
    }
    scheduleNext();
  }
  scheduleNext();
  return () => {
    cancelled = true;
    if (window.cancelIdleCallback) window.cancelIdleCallback(idle);
    else window.clearTimeout(idle);
  };
}

/** Retry failed or pending artwork after discovery updates package metadata, retaining successful asset URLs.
 * Detached older requests may finish but cannot replace the new shared lookup or imported covers.
 */
export function refreshMissingArtwork() {
  for (const key of cache.keys()) {
    if (!settled.has(key) || missing.has(key)) {
      cache.delete(key);
      settled.delete(key);
    }
  }
  missing.clear();
  localCache.clear();
}

/** Import local raster `path` as `game`'s cover, invalidate the shared result and return its asset URL. */
export async function importArtwork(game: Game, path: string): Promise<ArtworkImage> {
  const result = await invoke<NativeArtwork>('import_artwork', { id: game.id, path });
  const image = { url: `${convertFileSrc(result.path)}?v=${Date.now()}`, source: result.source };
  const key = `${game.id}:${game.title}:cover`;
  cache.set(key, Promise.resolve(image));
  const detailKey = `${game.id}:${game.title}:detail`;
  cache.delete(detailKey);
  settled.delete(detailKey);
  missing.delete(detailKey);
  localCache.set(key, Promise.resolve(image));
  settled.add(key);
  missing.delete(key);
  return image;
}
