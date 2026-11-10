import { defaults, type Settings } from './types';

/** Persistence feedback for immediately applied preferences. Errors retain the latest desired values. */
export type SaveStatus = 'saved' | 'saving' | 'error';

/** Restore app defaults while preserving per-game choices, which belong to the library. */
export function resetPreferences(current: Settings): Settings {
  return {
    ...structuredClone(defaults),
    preferredInstallations: current.preferredInstallations,
    artworkPositions: current.artworkPositions,
  };
}

/** Serialize preference writes, coalesce typing and retain failed edits for explicit retry.
 * `initial` is the loaded snapshot, `persist` writes one snapshot, and `status` reports completion/errors.
 */
export class SettingsWriter {
  private desired: Settings;
  private revision = 0;
  private saved = 0;
  private failed = -1;
  private running?: Promise<boolean>;
  private timer?: ReturnType<typeof setTimeout>;

  /** Copy `initial`; retain the persistence and feedback callbacks without starting any work. */
  constructor(
    initial: Settings,
    private persist: (settings: Settings) => Promise<unknown>,
    private status: (state: SaveStatus, error?: unknown) => void,
  ) {
    this.desired = structuredClone(initial);
  }

  /** Apply `patch` immediately; optional `delay` coalesces text input before disk writes. */
  update(patch: Partial<Settings>, delay = 0): void {
    this.desired = { ...this.desired, ...structuredClone(patch) };
    this.revision++;
    this.status('saving');
    clearTimeout(this.timer);
    if (delay) this.timer = setTimeout(() => void this.flush(), delay);
    else void this.flush();
  }

  /** Flush queued edits or retry a failed write. Resolve false on failure without dropping changes. */
  flush(): Promise<boolean> {
    clearTimeout(this.timer);
    if (!this.running)
      this.running = this.drain().finally(() => {
        this.running = undefined;
        if (this.saved !== this.revision && this.failed !== this.revision) void this.flush();
      });
    return this.running;
  }

  /** Persist successive latest snapshots until caught up; an older failure cannot discard newer edits. */
  private async drain(): Promise<boolean> {
    while (this.saved !== this.revision) {
      const revision = this.revision;
      const snapshot = structuredClone(this.desired);
      for (const key of ['steamRoots', 'epicRoots', 'gogRoots'] as const)
        snapshot[key] = snapshot[key].map((path) => path.trim()).filter(Boolean);
      this.status('saving');
      try {
        await this.persist(snapshot);
        this.saved = revision;
      } catch (error) {
        if (revision !== this.revision) continue;
        this.failed = revision;
        this.status('error', error);
        return false;
      }
    }
    this.status('saved');
    return true;
  }
}
