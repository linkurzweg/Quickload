import { describe, expect, it } from 'vite-plus/test';
import { featuredGame, groupCards, groupGames, selectGames } from '../src/lib/library';
import { demoLibrary } from '../src/lib/demo';

describe('library selection', () => {
  it('groups canonical cross-launcher paths despite different titles and retains provider filtering', () => {
    const steam = {
      ...demoLibrary.games[0],
      title: 'Grand Theft Auto V Legacy',
      installPath: 'C:\\Games\\GTAV',
    };
    const rockstar = {
      ...steam,
      id: 'rockstar:gta5',
      title: 'Grand Theft Auto V',
      store: 'rockstar' as const,
      installPath: '//?/C:/games/gtav/',
    };
    const other = {
      ...rockstar,
      id: 'rockstar:gta5_gen9',
      title: 'Grand Theft Auto V Enhanced',
      installPath: 'C:/Games/GTAV Enhanced',
    };
    const groups = groupGames([steam, rockstar, other]);
    expect(groups).toHaveLength(2);
    expect(groupCards(groups, undefined, 'all')).toHaveLength(2);
    expect(groupCards(groups, undefined, 'rockstar').map((game) => game.id)).toEqual([
      rockstar.id,
      other.id,
    ]);
    expect(groupGames([steam, { ...rockstar, store: 'steam', id: 'steam:other' }])).toHaveLength(2);
    expect(
      groupGames([
        { ...steam, installPath: '/games/Title' },
        { ...rockstar, installPath: '/games/title' },
      ]),
    ).toHaveLength(2);
    expect(
      groupGames([
        { ...steam, installPath: '//?/UNC/Server/Games/GTAV' },
        { ...rockstar, installPath: '//server/games/gtav/' },
      ]),
    ).toHaveLength(1);
    expect(
      groupGames([
        steam,
        { ...steam, id: 'steam:other', title: 'Another game sharing the folder' },
        rockstar,
      ]),
    ).toHaveLength(3);
  });
  it('merges cross-store titles without hiding editions, same-store ambiguity or installed alternatives', () => {
    const steam = demoLibrary.games[0];
    const gog = { ...steam, id: 'gog:1', store: 'gog' as const, installed: false };
    const edition = { ...gog, id: 'gog:2', title: `${steam.title} Deluxe` };
    const groups = groupGames([steam, gog, edition]);
    expect(groups).toHaveLength(2);
    const preferred = { [groups[0].key]: gog.id };
    expect(groupCards(groups, preferred, 'all')[0].id).toBe(steam.id);
    expect(groupCards(groups, preferred, 'gog')[0].id).toBe(gog.id);
    expect(groupGames([steam, { ...steam, id: 'steam:2' }, gog])).toHaveLength(3);
  });
  it('combines case-insensitive search, provider and favorites', () => {
    const games = demoLibrary.games;
    expect(selectGames(games, 'elden', 'steam', true, 'recent').map((g) => g.title)).toEqual([
      'ELDEN RING',
    ]);
    expect(selectGames(games, 'elden', 'gog', false, 'recent')).toEqual([]);
    expect(selectGames(games, 'hollow', 'all', true, 'recent')).toEqual([]);
  });

  it('sorts dates and null dates consistently without changing cached entries', () => {
    const games = Object.freeze([
      { ...demoLibrary.games[0], title: 'Zebra', lastPlayed: null },
      { ...demoLibrary.games[1], title: 'Alpha', lastPlayed: null },
      { ...demoLibrary.games[2], title: 'Recent', lastPlayed: 42 },
    ]);
    expect(selectGames(games, '', 'all', false, 'recent').map((g) => g.title)).toEqual([
      'Recent',
      'Alpha',
      'Zebra',
    ]);
    expect(selectGames(games, '', 'all', false, 'title').map((g) => g.title)).toEqual([
      'Alpha',
      'Recent',
      'Zebra',
    ]);
    expect(games[0].title).toBe('Zebra');
  });

  it('handles empty libraries and a focused game disappearing after a scan', () => {
    expect(featuredGame([], null)).toBeUndefined();
    expect(featuredGame(demoLibrary.games, 'missing')).toBe(demoLibrary.games[0]);
    expect(featuredGame(demoLibrary.games, demoLibrary.games[4].id)).toBe(demoLibrary.games[4]);
  });

  it('retains the first featured entry on ties and supports large libraries', () => {
    const games = Array.from({ length: 10_000 }, (_, i) => ({
      ...demoLibrary.games[0],
      id: `steam:${i}`,
      lastPlayed: i < 2 ? 100_000 : i,
    }));
    expect(featuredGame(games, null)).toBe(games[0]);
    expect(featuredGame(games, 'steam:9999')).toBe(games[9999]);
    expect(selectGames(games, '', 'steam', true, 'recent')).toHaveLength(10_000);
  });
});
