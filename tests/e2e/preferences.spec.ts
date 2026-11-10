import { test, expect, isolateGamepadInput, type Page } from './fixtures';

/** Install an isolated persistent native library and mutable Nintendo standard gamepad in browser `page`. */
async function controllerFixture(
  page: Page,
  name = 'Nintendo Switch 2 Pro Controller',
  reducedMotion = true,
) {
  await page.addInitScript(
    ({ name, reducedMotion }) => {
      const pad = {
        id: name,
        connected: true,
        index: 0,
        mapping: 'standard',
        axes: [0, 0, 0, 0],
        buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
      };
      (window as any).testPad = pad;
      (window as any).padReads = 0;
      Object.defineProperty(navigator, 'getGamepads', {
        value: () => {
          (window as any).padReads++;
          return [pad];
        },
      });
      (window as any).isTauri = true;
      const library = {
        games: [
          {
            id: 'steam:fixture',
            title: 'Controller fixture',
            store: 'steam',
            installed: true,
            favorite: false,
            launchCount: 0,
            lastPlayed: 1700000000,
          },
        ],
        settings: JSON.parse(localStorage.getItem('fixture-settings') ?? 'null') ?? {
          controller: 'auto',
          language: 'system',
          controllerHints: true,
          reducedMotion,
          transparency: true,
          startupScan: false,
          artwork: false,
          steamRoots: [],
          epicRoots: [],
          gogRoots: [],
        },
        lastScan: null,
      };
      (window as any).__TAURI_INTERNALS__ = {
        invoke: async (command: string, args: any) => {
          if (command === 'set_borderless') return args.enabled;
          if (command === 'save_settings') {
            library.settings = args.settings;
            localStorage.setItem('fixture-settings', JSON.stringify(args.settings));
          }
          return structuredClone(library);
        },
      };
    },
    { name, reducedMotion },
  );
  await page.goto('/');
  await expect(page.locator('.game-card')).toHaveCount(1);
}

/** Press standard gamepad `button` on `page`, waiting for polling to observe both press and release. */
async function pressPad(page: Page, button: number) {
  const before = await page.evaluate((index) => {
    (window as any).testPad.buttons[index].pressed = true;
    return (window as any).padReads as number;
  }, button);
  await expect
    .poll(() => page.evaluate(() => (window as any).padReads as number), { intervals: [10, 20] })
    .toBeGreaterThan(before);
  const release = await page.evaluate((index) => {
    (window as any).testPad.buttons[index].pressed = false;
    return (window as any).padReads as number;
  }, button);
  await expect
    .poll(() => page.evaluate(() => (window as any).padReads as number), { intervals: [10, 20] })
    .toBeGreaterThan(release);
}

test('DualSense keyboard edits a draft, accepts fuzzy titles and restores focus', async ({
  page,
}) => {
  await controllerFixture(page, 'DualSense Wireless Controller');
  const search = page.getByRole('textbox', { name: 'Spiele suchen' });
  await pressPad(page, 3);
  const keyboard = page.getByRole('dialog', { name: 'Spiele suchen' });
  const editor = keyboard.getByRole('textbox');
  await expect(keyboard.getByRole('button', { name: 'q', exact: true })).toBeFocused();
  await pressPad(page, 15);
  await pressPad(page, 0);
  await expect(editor).toHaveValue('w');
  await pressPad(page, 2);
  await expect(editor).toHaveValue('');
  await editor.fill('clear this entire draft');
  await keyboard.getByRole('button', { name: 'Eingabe leeren' }).focus();
  await pressPad(page, 0);
  await expect(editor).toHaveValue('');
  await expect(keyboard.getByRole('button', { name: 'q', exact: true })).toBeFocused();
  await editor.fill('contorller fix');
  const suggestion = keyboard.getByRole('button', { name: 'Controller fixture' });
  await expect(suggestion).toBeVisible();
  await suggestion.focus();
  await pressPad(page, 0);
  await expect(keyboard).toHaveCount(0);
  await expect(search).toHaveValue('Controller fixture');
  await expect(search).toBeFocused();
  await expect(page.getByRole('button', { name: 'Controller fixture' })).toBeVisible();
  await pressPad(page, 0);
  await editor.fill('contorller fix');
  await pressPad(page, 7);
  await expect(search).toHaveValue('contorller fix');
  await expect(page.getByRole('button', { name: 'Controller fixture' })).toBeVisible();
  await pressPad(page, 0);
  await editor.fill('discard me');
  await pressPad(page, 1);
  await expect(search).toHaveValue('contorller fix');
  await expect(search).toBeFocused();
  await page.getByRole('button', { name: 'Spiel hinzufügen' }).click();
  const title = page.locator('.add-modal input').first();
  await expect(title).toBeFocused();
  await pressPad(page, 0);
  const formKeyboard = page.locator('.screen-keyboard');
  await formKeyboard.getByRole('textbox').fill('New game');
  await pressPad(page, 7);
  await expect(formKeyboard).toHaveCount(0);
  await expect(title).toHaveValue('New game');
  await expect(title).toBeFocused();
});

test('controller changes library sort through the rounded combobox', async ({ page }) => {
  await controllerFixture(page, 'DualSense Wireless Controller');
  const sort = page.getByRole('combobox', { name: 'Spiele sortieren' });
  await sort.focus();
  await pressPad(page, 0);
  await expect(page.getByRole('option', { name: 'Zuletzt gestartet' })).toBeFocused();
  await pressPad(page, 13);
  await pressPad(page, 0);
  await expect(sort).toContainText('Alphabetisch');
  await expect(sort).toBeFocused();
});

test('header hints stay inside controls and keyboard labels share centered line boxes', async ({
  page,
}) => {
  await controllerFixture(page, 'DualSense Wireless Controller');
  for (const [width, height] of [
    [390, 844],
    [1440, 1060],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    for (const fullscreen of [false, true]) {
      if (fullscreen) await pressPad(page, 9);
      const hints = await page.locator('.header-shortcut').evaluateAll((nodes) =>
        nodes.map((node) => {
          const hint = node.getBoundingClientRect();
          const button = node.closest('button')!.getBoundingClientRect();
          return (
            hint.left >= button.left + 6 &&
            hint.right <= button.right - 6 &&
            hint.top >= button.top + 6 &&
            hint.bottom <= button.bottom - 6
          );
        }),
      );
      expect(hints).toEqual([true, true]);
      if (fullscreen) await pressPad(page, 9);
    }
    await pressPad(page, 3);
    const keyboard = page.locator('.screen-keyboard');
    await expect(keyboard).toBeVisible();
    for (const mode of ['letters', 'shift', 'symbols']) {
      if (mode === 'shift')
        await keyboard.getByRole('button', { name: 'Umschalt', exact: true }).click();
      if (mode === 'symbols')
        await keyboard.getByRole('button', { name: 'Sonderzeichen', exact: true }).click();
      const offsets = await keyboard.locator('.key-label').evaluateAll((labels) =>
        labels.map((label) => {
          const text = label.getBoundingClientRect();
          const key = label.parentElement!.getBoundingClientRect();
          return Math.abs((text.top + text.bottom - key.top - key.bottom) / 2);
        }),
      );
      expect(offsets.length).toBeGreaterThan(30);
      expect(Math.max(...offsets)).toBeLessThan(1);
    }
    await pressPad(page, 1);
    await expect(keyboard).toHaveCount(0);
  }
});

test('keyboard glass follows appearance settings and closing releases focus during the fade', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await controllerFixture(page, 'DualSense Wireless Controller', false);
  await pressPad(page, 3);
  const panel = page.locator('.screen-keyboard');
  await expect(panel).toHaveCSS('backdrop-filter', /blur\(20px\)/);
  const outgoing = await panel.evaluate(async (dialog) => {
    dialog.querySelector<HTMLButtonElement>('.keyboard-heading .icon-button')!.click();
    await new Promise(requestAnimationFrame);
    return {
      inert: dialog.hasAttribute('inert'),
      fading: dialog.getAnimations().some((animation) => animation.playState === 'running'),
    };
  });
  expect(outgoing).toEqual({ inert: true, fading: true });
  await expect(page.getByPlaceholder('Spiele suchen')).toBeFocused();
  await expect(panel).toHaveCount(0);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByRole('switch', { name: 'Transparente Glasflächen' }).uncheck();
  await expect(page.locator('.preference-feedback [role=status]')).toHaveText(
    'Alle Änderungen automatisch gespeichert.',
  );
  await page.getByRole('navigation').getByRole('button', { name: 'Für dich', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await pressPad(page, 3);
  await expect(panel).toHaveCSS('backdrop-filter', 'none');
  const count = await panel.evaluate((dialog) => dialog.getAnimations().length);
  expect(count).toBe(0);
});

for (const [name, symbol] of [
  ['Xbox Wireless Controller', 'Menu'],
  ['DualSense Wireless Controller', 'Options'],
  ['Nintendo Switch 2 Pro Controller', '+'],
]) {
  test(`fullscreen footer uses the actual ${symbol} controller shortcut instead of a keyboard keycap`, async ({
    page,
  }) => {
    await controllerFixture(page, name);
    const hint = page.locator('.fullscreen-hint');
    await expect(hint.locator('.glyph.menu')).toHaveAttribute('data-symbol', symbol);
    await expect(hint.locator('kbd')).toHaveCount(0);
    if (symbol === 'Options') {
      await expect(hint.locator('svg rect')).toHaveCount(0);
      await expect(hint.locator('svg path')).toHaveAttribute('d', 'M5 6h14M5 12h14M5 18h14');
    }
    await pressPad(page, 9);
    await expect(page.locator('.app-shell')).toHaveClass(/tv-mode/);
    await page.evaluate(() => {
      (window as any).testPad.connected = false;
    });
    await expect(hint.locator('kbd')).toHaveText('Alt+Enter');
    await expect(hint.locator('.glyph')).toHaveCount(0);
  });
}

test('Nintendo A/B navigate dropdowns, settings shortcuts and configurable header hints', async ({
  page,
}) => {
  await controllerFixture(page);
  await expect(page.locator('.header-shortcut .glyph.menu')).toHaveAttribute('data-symbol', '+');
  await expect(page.locator('.header-shortcut .glyph.view')).toHaveAttribute('data-symbol', '−');
  await pressPad(page, 8);
  const symbols = page.getByRole('combobox', { name: 'Tastensymbole' });
  await symbols.focus();
  await pressPad(page, 1); // Nintendo A confirms, unlike Xbox's south button.
  await expect(symbols).toHaveAttribute('aria-expanded', 'true');
  await pressPad(page, 13);
  await expect(page.getByRole('option', { name: 'Xbox', exact: true })).toBeFocused();
  await pressPad(page, 0); // Nintendo B cancels without changing the value.
  await expect(symbols).toBeFocused();
  await expect(symbols).toContainText('Automatisch erkennen');
  await pressPad(page, 1);
  await pressPad(page, 13);
  await pressPad(page, 13);
  await pressPad(page, 13);
  await expect(page.getByRole('option', { name: 'Nintendo Switch / Switch 2' })).toBeFocused();
  await pressPad(page, 1);
  await expect(symbols).toContainText('Nintendo Switch / Switch 2');
  const chevron = await symbols.locator('svg').boundingBox(),
    bounds = await symbols.boundingBox();
  expect(bounds!.x + bounds!.width - chevron!.x - chevron!.width).toBeGreaterThanOrEqual(15);
  await expect(page.locator('.preference-feedback [role=status]')).toHaveText(
    'Alle Änderungen automatisch gespeichert.',
  );
  await pressPad(page, 9);
  await expect(page.locator('.app-shell')).toHaveClass(/tv-mode/);
  const hints = page.getByRole('switch', { name: 'Controller-Shortcuts anzeigen' });
  await hints.focus();
  await pressPad(page, 1);
  await expect(hints).not.toBeChecked();
  await expect(page.locator('.preference-feedback [role=status]')).toHaveText(
    'Alle Änderungen automatisch gespeichert.',
  );
  await expect(page.locator('.header-shortcut')).toHaveCount(0);
  await pressPad(page, 9);
  await expect(page.locator('.app-shell')).not.toHaveClass(/tv-mode/);
  await page.reload();
  await pressPad(page, 8);
  await expect(
    page.getByRole('switch', { name: 'Controller-Shortcuts anzeigen' }),
  ).not.toBeChecked();
  await expect(page.getByRole('combobox', { name: 'Tastensymbole' })).toContainText('Nintendo');
});

test('system language, explicit overrides, localized dates and keyboard fullscreen persist', async ({
  page,
}) => {
  await controllerFixture(page, 'Xbox Wireless Controller');
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByRole('combobox', { name: 'Sprache' }).click();
  await page.getByRole('option', { name: 'English', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page.getByRole('heading', { name: 'Your setup.' })).toBeVisible();
  await expect(page.locator('.preference-feedback [role=status]')).toHaveText(
    'All changes saved automatically.',
  );
  await page.reload();
  await expect(page.getByRole('button', { name: 'For you', exact: true })).toBeVisible();
  await expect(page).toHaveTitle('Quickload · Your next adventure');
  await page.locator('.game-card').click();
  await expect(page.getByRole('dialog')).toContainText(
    new Date(1700000000 * 1000).toLocaleDateString('en'),
  );
  await page.keyboard.press('Escape');
  await page.keyboard.press('Alt+Enter');
  await expect(page.locator('.app-shell')).toHaveClass(/tv-mode/);
  await page.keyboard.press('Alt+Enter');
  await expect(page.locator('.app-shell')).not.toHaveClass(/tv-mode/);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('combobox', { name: 'Language' }).click();
  await page.getByRole('option', { name: 'Follow system language', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page.locator('.preference-feedback [role=status]')).toHaveText(
    'Alle Änderungen automatisch gespeichert.',
  );
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('lang', 'de');
  await expect(page).toHaveTitle('Quickload · Dein nächstes Abenteuer');
});

test('English system locale is selected automatically and unsupported languages fall back to English', async ({
  browser,
}) => {
  for (const locale of ['en-GB', 'ja-JP']) {
    const context = await browser.newContext({ locale });
    await context.addInitScript(isolateGamepadInput);
    const page = await context.newPage();
    await page.goto(process.env.QUICKLOAD_PREVIEW_URL ?? 'http://127.0.0.1:1427');
    await expect(page.locator('html')).toHaveAttribute('lang', 'en');
    await expect(page.getByRole('button', { name: 'For you', exact: true })).toBeVisible();
    await context.close();
  }
});

test('overlay thumbs stay trackless and support pointer dragging with native high-contrast fallback', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 480 });
  await controllerFixture(page);
  await page.mouse.move(1438, 300);
  const overlay = page.locator('.scroll-overlay.visible');
  await expect(overlay).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  expect(await page.evaluate(() => document.documentElement.clientWidth)).toBe(1440);
  const thumb = overlay.locator('.vertical:not([hidden])');
  const box = await thumb.boundingBox();
  await page.mouse.move(box!.x + 3, box!.y + 20);
  await page.mouse.down();
  await page.mouse.move(box!.x + 3, box!.y + 140, { steps: 6 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(50);
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(overlay).toHaveCSS('display', 'none');
  await expect(page.locator('html')).toHaveCSS('scrollbar-width', 'auto');
});
