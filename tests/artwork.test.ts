import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import { demoLibrary } from '../src/lib/demo';

const mocks = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock('../src/lib/api', () => ({ native: true }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: mocks.invoke,
  convertFileSrc: (path: string) => `asset://${path}`,
}));

beforeEach(() => {
  vi.resetModules();
  mocks.invoke.mockReset();
});

describe('artwork resolution', () => {
  it('prioritizes dialog resolution without exceeding the shared download limit', async () => {
    const release: (() => void)[] = [];
    mocks.invoke.mockImplementation(
      () => new Promise((resolve) => release.push(() => resolve(null))),
    );
    const { resolveArtwork } = await import('../src/lib/artwork');
    const jobs = demoLibrary.games.slice(0, 4).map((game) => resolveArtwork(game, 'cover'));
    jobs.push(resolveArtwork(demoLibrary.games[4], 'detail'));
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    release[0]();
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(4));
    expect(mocks.invoke).toHaveBeenLastCalledWith('resolve_artwork', {
      id: demoLibrary.games[4].id,
      kind: 'detail',
    });
    release[1]();
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(5));
    release.slice(2).forEach((done) => done());
    await Promise.all(jobs);
  });
  it('preserves all lettering on near-ratio capsules without borders', async () => {
    const { tileImageFit } = await import('../src/lib/artwork');
    expect(tileImageFit(1232, 706)).toBe('fill');
    expect(tileImageFit(1920, 1080)).toBe('fill');
    expect(tileImageFit(460, 215)).toBe('cover');
    expect(tileImageFit(0, 0)).toBe('cover');
  });
  it('retries misses after discovery without refetching successful images', async () => {
    mocks.invoke
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ path: '/cache/known.jpg', source: 'Steam' })
      .mockResolvedValueOnce({ path: '/cache/found.jpg', source: 'Installed game package' });
    const { resolveArtwork, refreshMissingArtwork } = await import('../src/lib/artwork');
    expect(await resolveArtwork(demoLibrary.games[0], 'cover')).toBeNull();
    const known = await resolveArtwork(demoLibrary.games[1], 'cover');
    refreshMissingArtwork();
    expect(await resolveArtwork(demoLibrary.games[1], 'cover')).toBe(known);
    expect((await resolveArtwork(demoLibrary.games[0], 'cover'))?.source).toBe(
      'Installed game package',
    );
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
  });
  it('uses landscape assets and accepts only explicit numeric provider IDs', async () => {
    const { artworkCandidates } = await import('../src/lib/artwork');
    const game = demoLibrary.games[0];
    expect(artworkCandidates(game, 'cover')[0]).toMatch(/1245620\/capsule_616x353_2x\.jpg$/);
    expect(artworkCandidates(game, 'hero')[0]).toMatch(/library_hero_2x\.jpg$/);
    expect(artworkCandidates(game, 'hero')[1]).toMatch(/library_hero\.jpg$/);
    expect(artworkCandidates({ ...game, id: 'gog:1245620' }, 'cover')).toEqual([]);
    expect(artworkCandidates({ ...game, id: 'steam:../../evil' }, 'cover')).toEqual([]);
  });

  it('versions native asset URLs so corrected cached thumbnails replace stale browser images', async () => {
    mocks.invoke.mockResolvedValue({
      path: '/cache/cover.jpg',
      source: 'Steam',
      revision: '4-123456',
    });
    const { resolveArtwork } = await import('../src/lib/artwork');
    expect((await resolveArtwork(demoLibrary.games[0], 'cover'))?.url).toBe(
      'asset:///cache/cover.jpg?v=4-123456',
    );
  });

  it('shares inflight lookups and reuses cached native asset paths', async () => {
    mocks.invoke.mockResolvedValue({ path: '/cache/cover.jpg', source: 'Steam' });
    const { resolveArtwork } = await import('../src/lib/artwork');
    const first = resolveArtwork(demoLibrary.games[0], 'cover');
    expect(resolveArtwork(demoLibrary.games[0], 'cover')).toBe(first);
    expect(await first).toEqual({ url: 'asset:///cache/cover.jpg', source: 'Steam' });
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });

  it('limits simultaneous work to three and releases slots after failures', async () => {
    const release: (() => void)[] = [];
    mocks.invoke.mockImplementation(
      () => new Promise((resolve) => release.push(() => resolve(null))),
    );
    const { resolveArtwork } = await import('../src/lib/artwork');
    const jobs = demoLibrary.games.slice(0, 5).map((game) => resolveArtwork(game, 'cover'));
    expect(mocks.invoke).toHaveBeenCalledTimes(3);
    release[0]();
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(4));
    release[1]();
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(5));
    release.slice(2).forEach((done) => done());
    expect(await Promise.all(jobs)).toEqual([null, null, null, null, null]);
    mocks.invoke.mockRejectedValueOnce(new Error('offline'));
    expect(await resolveArtwork(demoLibrary.games[6], 'cover')).toBeNull();
    mocks.invoke.mockResolvedValueOnce({ path: '/cached.jpg', source: 'Steam' });
    expect(await resolveArtwork(demoLibrary.games[7], 'cover')).not.toBeNull();
  });

  it('replaces a resolved cover immediately after a manual import', async () => {
    mocks.invoke
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ path: '/custom.png', source: 'Eigenes Cover' });
    const { resolveArtwork, importArtwork } = await import('../src/lib/artwork');
    const game = demoLibrary.games[0];
    expect(await resolveArtwork(game, 'cover')).toBeNull();
    const imported = await importArtwork(game, '/picked.png');
    expect(await resolveArtwork(game, 'cover')).toEqual(imported);
    expect(mocks.invoke).toHaveBeenLastCalledWith('import_artwork', {
      id: game.id,
      path: '/picked.png',
    });
  });

  it('reads local covers while all online slots are busy and shares the disk lookup', async () => {
    const release: (() => void)[] = [];
    mocks.invoke.mockImplementation((_command, args) =>
      args.localOnly
        ? Promise.resolve({ path: '/local.png', source: 'Local Steam cache', needsUpgrade: true })
        : new Promise((resolve) => release.push(() => resolve(null))),
    );
    const { resolveArtwork, resolveLocalCover } = await import('../src/lib/artwork');
    const pending = demoLibrary.games.slice(0, 3).map((game) => resolveArtwork(game, 'cover'));
    const game = demoLibrary.games[3];
    const local = resolveLocalCover(game);
    expect(resolveLocalCover(game)).toBe(local);
    expect(await local).toMatchObject({ url: 'asset:///local.png', needsUpgrade: true });
    expect(release).toHaveLength(3);
    release.forEach((done) => done());
    await Promise.all(pending);
  });
});
