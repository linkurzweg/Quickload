import { test, expect, type Page } from './fixtures';
import { defaults } from '../../src/lib/types';

/** Provide isolated launcher entries, a mutable standard controller and recorded IPC without OS actions. */
async function fixture(page: Page) {
  await page.addInitScript(
    ({ defaults }) => {
      const pad = {
        id: 'Xbox Wireless Controller',
        connected: true,
        index: 0,
        mapping: 'standard',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      };
      Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] });
      const state = { pad, closes: 0, fail: false, saved: true, calls: [] as string[] };
      (window as any).quickloadTest = state;
      (window as any).isTauri = true;
      const game = { installed: true, favorite: false, lastPlayed: null, launchCount: 0 };
      const library = {
        games: [
          {
            ...game,
            id: 'steam:1',
            title: 'GTA V Legacy',
            store: 'steam',
            installPath: 'C:/Games/GTAV',
          },
          {
            ...game,
            id: 'rockstar:gta5',
            title: 'Grand Theft Auto V',
            store: 'rockstar',
            installPath: '//?/c:/games/gtav/',
          },
          {
            ...game,
            id: 'ubisoft:1',
            title: 'Assassin’s Creed Unity',
            store: 'ubisoft',
            installPath: 'D:/Games/Unity',
          },
          {
            ...game,
            id: 'battlenet:fen',
            title: 'Diablo IV',
            store: 'battlenet',
            installPath: 'D:/Games/Diablo IV',
          },
        ],
        settings: { ...defaults, startupScan: false, reducedMotion: true, artwork: false },
        lastScan: null,
      };
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (command: string, args: any) => {
          if (command === 'get_fullscreen' || command === 'supports_login_startup') return false;
          if (command === 'set_borderless') return args.enabled;
          if (command === 'close_window') {
            state.closes++;
            state.calls.push('close');
            return;
          }
          if (command === 'save_settings') {
            state.saved = false;
            await new Promise((resolve) => setTimeout(resolve, 100));
            if (state.fail) throw Error('Fixture write failure');
            library.settings = args.settings;
            state.saved = true;
            state.calls.push('save');
          }
          return structuredClone(library);
        },
      };
    },
    { defaults },
  );
  await page.goto('/');
  await expect(page.locator('.game-card')).toHaveCount(3);
}

/** Press and release standard controller `button`, allowing one input polling cycle on either edge. */
async function press(page: Page, button: number) {
  await page.evaluate((index) => {
    (window as any).quickloadTest.pad.buttons[index] = { pressed: true, touched: true, value: 1 };
  }, button);
  await page.waitForTimeout(110);
  await page.evaluate((index) => {
    (window as any).quickloadTest.pad.buttons[index] = { pressed: false, touched: false, value: 0 };
  }, button);
  await page.waitForTimeout(80);
}

test('header branding is centered without moving navigation and fits native controller actions', async ({
  page,
}) => {
  await fixture(page);
  for (const width of [390, 960, 1440, 1920]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1060 });
    for (const section of ['Bibliothek', 'Favoriten', 'Einstellungen']) {
      await page
        .getByRole('button', { name: new RegExp(`^${section}`) })
        .first()
        .click();
      const brand = (await page.locator('.brand').boundingBox())!;
      const nav = (await page.locator('nav').boundingBox())!;
      const actions = (await page.locator('.header-actions').boundingBox())!;
      expect(Math.abs(brand.x + brand.width / 2 - width / 2)).toBeLessThan(2);
      expect(nav.x).toBeLessThan(width * 0.06 + 1);
      expect(actions.x + actions.width).toBeLessThan(width);
      expect(actions.x).toBeGreaterThan(brand.x + brand.width);
      if (width > 500) expect(nav.x + nav.width).toBeLessThan(brand.x);
      else expect(nav.y).toBeGreaterThan(brand.y + brand.height);
    }
  }
});

test('new providers have named filters, searchable titles and one card for shared installations', async ({
  page,
}) => {
  await fixture(page);
  for (const [store, title] of [
    ['Ubisoft Connect', 'Assassin'],
    ['Battle.net', 'Diablo'],
    ['Rockstar Games', 'Grand Theft'],
  ]) {
    const filter = page.locator('.store-filters').getByRole('button', { name: store });
    await expect(filter).toHaveText(store);
    await expect(filter.locator('img, svg')).toHaveCount(0);
    await filter.click();
    await page.getByRole('textbox', { name: 'Spiele suchen' }).fill(title);
    await expect(page.locator('.game-card')).toHaveCount(1);
    await page.getByRole('textbox', { name: 'Spiele suchen' }).fill('');
  }
});

test('controller can reach exit, cancel with B, confirm with A and preserve pending saves', async ({
  page,
}) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).focus();
  await press(page, 14);
  await press(page, 14);
  await expect(page.getByRole('button', { name: 'Quickload beenden', exact: true })).toBeFocused();
  await press(page, 0);
  await expect(page.locator('.quit-cancel')).toBeFocused();
  await expect(page.locator('.quit-modal')).toHaveCSS('padding-top', '36px');
  await press(page, 1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).quickloadTest.closes)).toBe(0);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByRole('textbox', { name: 'Steam-Ordner' }).fill('D:/Pending');
  await page.getByRole('button', { name: 'Quickload beenden', exact: true }).click();
  await press(page, 15);
  await expect(page.getByRole('button', { name: 'Beenden', exact: true })).toBeFocused();
  await press(page, 0);
  await expect.poll(() => page.evaluate(() => (window as any).quickloadTest.closes)).toBe(1);
  expect(await page.evaluate(() => (window as any).quickloadTest.calls.slice(-2))).toEqual([
    'save',
    'close',
  ]);
});

test('failed preference writes keep exit from closing the app', async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.evaluate(() => {
    (window as any).quickloadTest.fail = true;
  });
  await page.getByRole('switch', { name: 'Bedienungstöne' }).uncheck();
  await page.getByRole('button', { name: 'Quickload beenden', exact: true }).click();
  await page.getByRole('button', { name: 'Beenden', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Erneut versuchen' })).toBeVisible();
  expect(await page.evaluate(() => (window as any).quickloadTest.closes)).toBe(0);
});

test('controller tile navigation plays the short click instead of the general navigation tone', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).cueDurations = [];
    const NativeAudio = window.AudioContext;
    window.AudioContext = class extends NativeAudio {
      createBufferSource(): AudioBufferSourceNode {
        const source = super.createBufferSource();
        const start = source.start.bind(source);
        source.start = (...args) => {
          (window as any).cueDurations.push(source.buffer?.duration);
          start(...args);
        };
        return source;
      }
    };
  });
  await fixture(page);
  await page.getByRole('button', { name: 'Für dich', exact: true }).click();
  await page.waitForTimeout(180);
  await page.locator('.game-card').first().focus();
  await press(page, 15);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (window as any).cueDurations.some(
          (duration: number) => duration >= 0.274 && duration < 0.276,
        ),
      ),
    )
    .toBe(true);
});
