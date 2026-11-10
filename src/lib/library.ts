import type { Game, Store } from './types';

/** A title and its distinct store installations. The key persists a preferred installation. */
export interface GameGroup {
  key: string;
  installations: Game[];
}

/** Group exact titles across stores, preserving edition names and ambiguous same-store entries. */
export function groupGames(games: readonly Game[]): GameGroup[] {
  const candidates = new Map<string, Game[]>();
  for (const game of games) {
    const title = game.title.normalize('NFC').trim().replace(/\s+/gu, ' ').toLowerCase();
    const key = game.store === 'manual' ? `entry:${game.id}` : `title:${title}`;
    const list = candidates.get(key);
    if (list) list.push(game);
    else candidates.set(key, [game]);
  }
  const groups = [...candidates].flatMap(([key, installations]) =>
    installations.length === 1 ||
    new Set(installations.map((game) => game.store)).size === installations.length
      ? [{ key, installations }]
      : installations.map((game) => ({ key: `entry:${game.id}`, installations: [game] })),
  );
  const parents = groups.map((_, index) => index);
  const providers = groups.map((group) => new Set(group.installations.map((game) => game.store)));
  const paths = new Map<string, number>();
  const pathOwners = new Map<string, Map<Store, string>>();
  const ambiguousPaths = new Set<string>();
  for (const game of games) {
    if (!game.installPath || game.store === 'manual' || !game.installed) continue;
    const path = installationKey(game.installPath);
    let owners = pathOwners.get(path);
    if (!owners) pathOwners.set(path, (owners = new Map()));
    const previous = owners.get(game.store);
    if (previous && previous !== game.id) ambiguousPaths.add(path);
    owners.set(game.store, game.id);
  }
  /** Resolve and compress a grouping index so repeated installation aliases remain near-linear. */
  function root(index: number): number {
    let result = index;
    while (parents[result] !== result) result = parents[result];
    while (parents[index] !== index) {
      const next = parents[index];
      parents[index] = result;
      index = next;
    }
    return result;
  }
  groups.forEach((group, index) => {
    for (const game of group.installations) {
      if (!game.installPath || game.store === 'manual' || !game.installed) continue;
      const path = installationKey(game.installPath);
      if (ambiguousPaths.has(path)) continue;
      const previous = paths.get(path);
      if (previous === undefined) paths.set(path, index);
      else {
        const a = root(previous);
        const b = root(index);
        if (a === b || [...providers[b]].some((store) => providers[a].has(store))) continue;
        parents[b] = a;
        for (const store of providers[b]) providers[a].add(store);
      }
    }
  });
  const merged = new Map<number, GameGroup>();
  groups.forEach((group, index) => {
    const parent = root(index);
    const existing = merged.get(parent);
    if (existing) existing.installations.push(...group.installations);
    else merged.set(parent, { key: groups[parent].key, installations: [...group.installations] });
  });
  return [...merged.values()];
}

/** Normalize canonical `path` for comparison; Windows ignores case while Unix paths remain case-sensitive. */
function installationKey(path: string): string {
  const normalized = path
    .replaceAll('\\', '/')
    .replace(/^\/\/\?\/UNC\//iu, '//')
    .replace(/^\/\/\?\//u, '')
    .replace(/\/+$/u, '');
  return /^[a-z]:\//iu.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized;
}

/** Choose one card per group in `scope`, preferring installed and explicitly selected versions. */
export function groupCards(
  groups: readonly GameGroup[],
  preferred: Record<string, string> | undefined,
  scope: Store | 'all',
): Game[] {
  return groups.flatMap(({ key, installations }) => {
    if (installations.length === 1) {
      const game = installations[0];
      return scope === 'all' || game.store === scope ? [game] : [];
    }
    const choices =
      scope === 'all' ? installations : installations.filter((game) => game.store === scope);
    const installed = choices.filter((game) => game.installed);
    const eligible = installed.length ? installed : choices;
    const selected =
      eligible.find((game) => game.id === preferred?.[key]) ?? featuredGame(eligible, null);
    if (!selected) return [];
    return [
      {
        ...selected,
        favorite: installations.some((game) => game.favorite),
        lastPlayed: featuredGame(installations, null)?.lastPlayed ?? null,
      },
    ];
  });
}

/** Select games without mutating the library.
 * @param games Cached game entries, including unavailable installations.
 * @param query Case-insensitive title fragment; normalized once per selection.
 * @param source Store filter, or `all` for every provider.
 * @param favoritesOnly Whether to exclude games without a favorite flag.
 * @param sort Title order or descending last launch; equal dates use title order.
 * @returns A new sorted array; the input order remains unchanged.
 */
export function selectGames(
  games: readonly Game[],
  query: string,
  source: Store | 'all',
  favoritesOnly: boolean,
  sort: 'recent' | 'title',
): Game[] {
  const needle = query.toLocaleLowerCase();
  return games
    .filter(
      (game) =>
        (source === 'all' || game.store === source) &&
        (!favoritesOnly || game.favorite) &&
        (!needle || game.title.toLocaleLowerCase().includes(needle)),
    )
    .sort((a, b) =>
      sort === 'title'
        ? a.title.localeCompare(b.title)
        : (b.lastPlayed ?? 0) - (a.lastPlayed ?? 0) || a.title.localeCompare(b.title),
    );
}

/** Find the featured entry in one pass, retaining the first entry for tied dates.
 * @param games Full cached library in its original order.
 * @param preferredId Explicitly focused entry, if any; missing IDs fall back to recency.
 * @returns The focused or most recently played entry; undefined for an empty library.
 */
export function featuredGame(games: readonly Game[], preferredId: string | null): Game | undefined {
  let recent: Game | undefined;
  for (const game of games) {
    if (game.id === preferredId) return game;
    if (!recent || (game.lastPlayed ?? 0) > (recent.lastPlayed ?? 0)) recent = game;
  }
  return recent;
}
