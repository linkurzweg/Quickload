import { describe, it, expect, vi } from 'vite-plus/test';
import { SettingsWriter, resetPreferences } from '../src/lib/settings';
import { defaults, type Settings } from '../src/lib/types';
import { cueSamples } from '../src/lib/sound';

describe('automatic preference persistence', () => {
  it('serializes writes and includes newer edits instead of restoring a stale response', async () => {
    const release: (() => void)[] = [];
    const snapshots: Settings[] = [];
    const persist = vi.fn((next: Settings) => {
      snapshots.push(next);
      return new Promise<void>((resolve) => release.push(resolve));
    });
    const writer = new SettingsWriter(defaults, persist, vi.fn());
    writer.update({ sound: false });
    writer.update({ language: 'en' });
    writer.update({ startupFullscreen: true });
    expect(persist).toHaveBeenCalledTimes(1);
    release.shift()!();
    await vi.waitFor(() => expect(persist).toHaveBeenCalledTimes(2));
    expect(snapshots[1]).toMatchObject({ sound: false, language: 'en', startupFullscreen: true });
    release.shift()!();
    expect(await writer.flush()).toBe(true);
  });
  it('retains failed edits for retry and normalizes paths without changing the editable input', async () => {
    const persist = vi.fn().mockRejectedValueOnce(Error('disk full')).mockResolvedValue(undefined);
    const status = vi.fn();
    const writer = new SettingsWriter(defaults, persist, status);
    writer.update({ steamRoots: [' C:/Games ', ''], sound: false });
    expect(await writer.flush()).toBe(false);
    expect(status).toHaveBeenLastCalledWith('error', expect.any(Error));
    expect(await writer.flush()).toBe(true);
    expect(persist).toHaveBeenLastCalledWith(
      expect.objectContaining({ steamRoots: ['C:/Games'], sound: false }),
    );
  });
  it('coalesces text input and flushes it immediately when leaving the field', async () => {
    vi.useFakeTimers();
    try {
      const persist = vi.fn().mockResolvedValue(undefined);
      const writer = new SettingsWriter(defaults, persist, vi.fn());
      writer.update({ gogRoots: ['D:/G'] }, 250);
      writer.update({ gogRoots: ['D:/Games'] }, 250);
      expect(persist).not.toHaveBeenCalled();
      await writer.flush();
      await vi.runAllTimersAsync();
      expect(persist).toHaveBeenCalledTimes(1);
      expect(persist).toHaveBeenCalledWith(expect.objectContaining({ gogRoots: ['D:/Games'] }));
    } finally {
      vi.useRealTimers();
    }
  });
  it('resets launch and UI preferences while retaining per-game library choices', () => {
    const current = {
      ...defaults,
      sound: false,
      startAtLogin: true,
      steamRoots: ['D:/Games'],
      preferredInstallations: { example: 'steam:42' },
      artworkPositions: { 'steam:42': { cover: [25, 50] as [number, number] } },
    };
    expect(resetPreferences(current)).toEqual({
      ...defaults,
      preferredInstallations: current.preferredInstallations,
      artworkPositions: current.artworkPositions,
    });
  });
});

describe('quiet interface cues', () => {
  it('uses a short tile cue with a quiet reflection tail', () => {
    const click = cueSamples('tile', 48000);
    const navigation = cueSamples('navigate', 48000);
    expect(click.length).toBeLessThan(navigation.length);
    expect(Math.max(...click.slice(2400).map(Math.abs))).toBeGreaterThan(0.001);
    expect(Math.max(...click.slice(2400).map(Math.abs))).toBeLessThan(0.06);
    expect(Math.max(...click.map(Math.abs))).toBeLessThan(
      2 * Math.max(...navigation.map(Math.abs)),
    );
    expect(Math.max(...click.map(Math.abs))).toBeGreaterThan(0.05);
    expect(click[0]).toBe(0);
    expect(Math.abs(click.at(-1)!)).toBeLessThan(0.00001);
    expect(cueSamples('tile', 48000)).toEqual(click);
  });
  it('uses distinct short waveforms with soft endpoints and bounded amplitude', () => {
    const waves = ['navigate', 'confirm', 'back'].map((cue) =>
      cueSamples(cue as 'navigate' | 'confirm' | 'back', 48_000),
    );
    for (const samples of waves) {
      expect(samples.length).toBeLessThan(18000);
      expect(samples[0]).toBe(0);
      expect(Math.abs(samples.at(-1)!)).toBeLessThan(0.00001);
      expect(Math.max(...samples.map(Math.abs))).toBeGreaterThan(0.005);
      expect(Math.max(...samples.map(Math.abs))).toBeLessThan(0.25);
    }
    expect(new Set(waves.map((wave) => wave.length)).size).toBe(3);
  });
});
