import { test, expect, type Page } from './fixtures';
import { defaults } from '../../src/lib/types';

/** Install isolated native preferences with delayed writes; no real OS login item is touched. */
async function settingsFixture(page: Page, startupFullscreen = false) {
  await page.addInitScript(
    ({ defaults, startupFullscreen }) => {
      (window as any).isTauri = true;
      (window as any).failSettings = false;
      (window as any).settingWrites = [];
      const library = {
        games: [
          {
            id: 'steam:42',
            title: 'Saved game',
            store: 'steam',
            installed: true,
            favorite: true,
            launchCount: 4,
            lastPlayed: 100,
          },
        ],
        settings: JSON.parse(localStorage.getItem('settings-fixture') ?? 'null') ?? {
          ...defaults,
          startupScan: false,
          artwork: false,
          startupFullscreen,
          artworkPositions: { 'steam:42': { cover: [20, 60] } },
          preferredInstallations: { example: 'steam:42' },
        },
        lastScan: null,
      };
      let fullscreen = library.settings.startupFullscreen;
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (command: string, args: any) => {
          if (command === 'get_fullscreen') return fullscreen;
          if (command === 'supports_login_startup') return true;
          if (command === 'set_borderless') return (fullscreen = args.enabled);
          if (command === 'save_settings') {
            (window as any).settingWrites.push(structuredClone(args.settings));
            await new Promise((resolve) => setTimeout(resolve, 80));
            if ((window as any).failSettings) throw Error('Fixture: storage unavailable');
            library.settings = structuredClone(args.settings);
            localStorage.setItem('settings-fixture', JSON.stringify(library.settings));
          }
          return structuredClone(library);
        },
      };
    },
    { defaults, startupFullscreen },
  );
  await page.goto('/');
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
}

test('global focus shortcut is opt-in, configurable and can be disabled persistently', async ({
  page,
}) => {
  await settingsFixture(page);
  const enabled = page.getByRole('switch', { name: 'Globaler Shortcut zum Aufrufen' });
  const combination = page.getByRole('textbox', { name: 'Tastenkombination zum Aufrufen' });
  await expect(enabled).not.toBeChecked();
  await combination.fill('Ctrl+Shift+F11');
  await enabled.check();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('settings-fixture') ?? '{}')))
    .toMatchObject({ focusShortcutEnabled: true, focusShortcut: 'Ctrl+Shift+F11' });
  await page.reload();
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await expect(enabled).toBeChecked();
  await expect(combination).toHaveValue('Ctrl+Shift+F11');
  await enabled.uncheck();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('settings-fixture') ?? '{}')))
    .toMatchObject({ focusShortcutEnabled: false });
});

test('preferences apply immediately, serialize rapid edits and survive reload without a Save button', async ({
  page,
}) => {
  await settingsFixture(page);
  await expect(page.getByRole('button', { name: 'Einstellungen speichern' })).toHaveCount(0);
  await page.getByRole('switch', { name: 'Transparente Glasflächen' }).uncheck();
  await expect(page.locator('.app-shell')).toHaveClass(/solid/);
  await page.getByRole('switch', { name: 'Bedienungstöne' }).uncheck();
  await page.getByRole('switch', { name: 'Im Vollbild starten' }).check();
  await page.getByRole('switch', { name: 'Bei der Anmeldung öffnen' }).check();
  await page.getByLabel('Steam-Ordner', { exact: true }).fill('D:/Games\nE:/Steam');
  await page.getByRole('button', { name: 'Zurück zu deinen Spielen' }).click();
  await expect
    .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('settings-fixture') ?? '{}')))
    .toMatchObject({
      sound: false,
      transparency: false,
      startupFullscreen: true,
      startAtLogin: true,
      steamRoots: ['D:/Games', 'E:/Steam'],
    });
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveClass(/tv-mode/);
  await expect(page.locator('.app-shell')).toHaveClass(/solid/);
});

test('failed autosave retains edits, retries, and defaults preserve personal game data', async ({
  page,
}) => {
  await settingsFixture(page);
  await page.evaluate(() => {
    (window as any).failSettings = true;
  });
  await page.getByRole('switch', { name: 'Bei der Anmeldung öffnen' }).check();
  await expect(page.locator('.preference-feedback [role=status]')).toHaveText(
    'Änderungen konnten nicht gespeichert werden.',
  );
  await page.evaluate(() => {
    (window as any).failSettings = false;
  });
  await page.getByRole('button', { name: 'Erneut versuchen', exact: true }).click();
  await expect(page.locator('.preference-feedback [role=status]')).toHaveText(
    'Alle Änderungen automatisch gespeichert.',
  );
  await page.getByRole('button', { name: 'Standards wiederherstellen' }).click();
  await expect(page.locator('.preference-feedback [role=status]')).toHaveText(
    'Alle Änderungen automatisch gespeichert.',
  );
  await expect(page.getByRole('switch', { name: 'Bei der Anmeldung öffnen' })).not.toBeChecked();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('settings-fixture')!));
  expect(saved).toMatchObject({
    sound: true,
    startupFullscreen: false,
    startAtLogin: false,
    artworkPositions: { 'steam:42': { cover: [20, 60] } },
    preferredInstallations: { example: 'steam:42' },
  });
  await page
    .getByRole('navigation')
    .getByRole('button', { name: 'Favoriten', exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Saved game', exact: true })).toBeVisible();
});

test('startup fullscreen uses native state and browser startup controls explain their limitation', async ({
  page,
}) => {
  await settingsFixture(page, true);
  await expect(page.locator('.app-shell')).toHaveClass(/tv-mode/);
  await page.getByRole('switch', { name: 'Im Vollbild starten' }).uncheck();
  await expect(page.locator('.app-shell')).toHaveClass(/tv-mode/);
  await page.getByRole('button', { name: 'Vollbild umschalten' }).click();
  await expect(page.locator('.app-shell')).not.toHaveClass(/tv-mode/);
});

test('left navigation keeps the center of desktop hero art clear', async ({ page }) => {
  await page.goto('/');
  for (const width of [960, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1080 });
    const bounds = await page.getByRole('navigation').boundingBox();
    expect(bounds!.x + bounds!.width).toBeLessThan(width / 2);
  }
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await expect(page.getByRole('switch', { name: 'Bei der Anmeldung öffnen' })).toBeDisabled();
  await expect(page.getByRole('switch', { name: 'Im Vollbild starten' })).toBeDisabled();
  await expect(page.getByText('Startoptionen sind in der Desktop-App verfügbar.')).toBeVisible();
});

test('sounds use one ready audio context and suspend after disabling', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).audioStats = { contexts: 0, plays: 0, suspends: 0 };
    const NativeAudio = window.AudioContext;
    window.AudioContext = class extends NativeAudio {
      constructor(options?: AudioContextOptions) {
        super(options);
        (window as any).audioStats.contexts++;
      }
      createBufferSource(): AudioBufferSourceNode {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        source.start = (...args) => {
          (window as any).audioStats.plays++;
          start(...args);
        };
        return source;
      }
      suspend(): Promise<void> {
        (window as any).audioStats.suspends++;
        return super.suspend();
      }
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as any).audioStats.plays)).toBeGreaterThan(0);
  await page.keyboard.press('Tab');
  await page.waitForTimeout(1600);
  expect(await page.evaluate(() => (window as any).audioStats.suspends)).toBe(0);
  expect(await page.evaluate(() => (window as any).audioStats.contexts)).toBe(1);
  const beforeResume = await page.evaluate(() => (window as any).audioStats.plays);
  await page.keyboard.press('Tab');
  await expect
    .poll(() => page.evaluate(() => (window as any).audioStats.plays))
    .toBeGreaterThan(beforeResume);
  await page.getByRole('switch', { name: 'Bedienungstöne' }).uncheck();
  const plays = await page.evaluate(() => (window as any).audioStats.plays);
  await page.getByRole('switch', { name: 'Transparente Glasflächen' }).uncheck();
  await page.getByRole('button', { name: 'Zurück zu deinen Spielen' }).click();
  expect(await page.evaluate(() => (window as any).audioStats.plays)).toBe(plays);
  await page.reload();
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  expect(await page.evaluate(() => (window as any).audioStats.contexts)).toBe(0);
});
