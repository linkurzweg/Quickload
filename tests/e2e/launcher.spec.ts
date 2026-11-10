import { test, expect } from './fixtures';
import { readFileSync } from 'node:fs';

test('Quickload restores the glass header in library views and reads its own preview settings', async ({
  page,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      'quickload-preview',
      JSON.stringify({ games: [], settings: { artwork: false } }),
    );
  });
  await page.goto('/');
  const brand = page.getByRole('button', { name: 'Quickload Startseite' });
  await expect(brand).toBeVisible();
  await expect(page.locator('.game-card')).toHaveCount(0);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^Bibliothek/ })
    .click();
  await expect(page.locator('.topbar')).toHaveCSS('backdrop-filter', /blur/);
  await brand.click();
  await expect(page.getByRole('button', { name: 'Für dich', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('details layer an official logo over the panorama without changing tiles', async ({
  page,
}) => {
  await page.route('https://cdn.cloudflare.steamstatic.com/**', (route) =>
    route.fulfill({
      contentType: 'image/svg+xml',
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="620"><rect width="1920" height="620" fill="#334466"/></svg>',
    }),
  );
  await page.goto('/');
  await expect(page.locator('.cover .game-logo')).toHaveCount(0);
  await page.getByRole('button', { name: 'ELDEN RING', exact: true }).click();
  const logo = page.locator('.detail-art .game-logo');
  await expect(logo).toHaveClass(/logo-loaded/);
  await expect(logo).toHaveAttribute('src', /1245620\/logo_2x.png$/);
  await expect(logo).toHaveCSS('object-fit', 'contain');
  await page.keyboard.press('Escape');
  await expect(page.locator('.game-logo')).toHaveCount(0);
});

test('home scene spans the viewport while navigation floats without branding', async ({ page }) => {
  await page.goto('/');
  for (const [width, height] of [
    [1440, 1060],
    [1920, 1080],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    await expect(page.locator('.hero .artwork-image')).toHaveCSS('object-fit', 'cover');
    const art = await page.locator('.hero-art').boundingBox();
    expect(art!.width).toBeCloseTo(width, 0);
    await expect(page.locator('.topbar')).toHaveCSS('backdrop-filter', 'none');
    await expect(page.locator('.brand')).toHaveCount(0);
  }
});

test('duplicate store installs share a tile and retain the preferred version and independent framing', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (localStorage.getItem('quickload-preview')) return;
    const game = {
      title: 'Shared Game',
      installed: true,
      favorite: false,
      launchCount: 0,
      lastPlayed: null,
    };
    localStorage.setItem(
      'quickload-preview',
      JSON.stringify({
        games: [
          { ...game, id: 'demo:100', store: 'steam' },
          { ...game, id: 'demo:200', store: 'gog' },
          { ...game, id: 'demo:300', store: 'gog', title: 'Shared Game Deluxe' },
        ],
        settings: { artwork: false },
        lastScan: null,
      }),
    );
  });
  await page.goto('/');
  await expect(page.locator('.game-card')).toHaveCount(2);
  await page.getByRole('button', { name: 'Shared Game', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Bevorzugte Installation' }).click();
  await dialog.getByRole('option', { name: 'GOG', exact: true }).click();
  await expect(dialog.locator('.eyebrow')).toHaveText('GOG');
  await dialog.getByRole('button', { name: 'Bildausschnitt', exact: true }).click();
  await dialog.getByRole('button', { name: 'Ausschnitt nach rechts' }).click();
  await dialog.getByRole('button', { name: 'Hero-Bild' }).click();
  await dialog.getByRole('button', { name: 'Ausschnitt nach oben' }).click();
  await dialog.getByRole('button', { name: 'Ausschnitt speichern' }).click();
  await expect(dialog.getByRole('button', { name: 'Bildausschnitt', exact: true })).toBeFocused();
  await page.reload();
  const card = page.getByRole('button', { name: 'Shared Game', exact: true });
  await expect(card.locator('.store-tag')).toHaveText('GOG');
  await expect(card.locator('.artwork')).toHaveCSS('--artwork-position', '60% 50%');
  await card.focus();
  await expect(page.locator('.hero .artwork')).toHaveCSS('--artwork-position', '50% 28%');
});

test('mixed ratios keep full-bleed tiles and detail banners', async ({ page }) => {
  await page.route('https://cdn.cloudflare.steamstatic.com/**', (route) => {
    const width = route.request().url().includes('/1245620/') ? 640 : 460;
    const height = width === 640 ? 360 : 215;
    return route.fulfill({
      contentType: 'image/svg+xml',
      body: `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#456189"/></svg>`,
    });
  });
  await page.goto('/');
  const exact = page.getByRole('button', { name: 'ELDEN RING', exact: true });
  const wide = page.getByRole('button', { name: 'Cyberpunk 2077', exact: true });
  await expect(exact.locator('.artwork')).toHaveClass(/artwork-loaded/);
  await expect(wide.locator('.artwork')).toHaveClass(/artwork-loaded/);
  await expect(wide.locator('.artwork-image')).toHaveCSS('object-fit', 'cover');
  await expect(wide.locator('.artwork-extension')).toHaveCount(0);
  await expect(exact.locator('.artwork-extension')).toHaveCount(0);
  for (const width of [390, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1060 });
    for (const card of [exact, wide]) {
      const cover = await card.locator('.cover').boundingBox();
      expect(cover!.width / cover!.height).toBeCloseTo(16 / 9, 2);
    }
  }
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^Bibliothek/ })
    .click();
  await expect(wide.locator('.artwork-image')).toHaveCSS('object-fit', 'cover');
  for (const cover of await page.locator('.cover').all()) {
    const bounds = await cover.boundingBox();
    expect(bounds!.width / bounds!.height).toBeCloseTo(16 / 9, 2);
  }
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await wide.click();
    const banner = page.getByRole('dialog').locator('.detail-art');
    const image = banner.locator('.artwork-image');
    await expect(image).toHaveCSS('object-fit', 'cover');
    await expect(banner.locator('.artwork-extension')).toHaveCount(0);
    const [imageArea, dialogArea] = await Promise.all([
      image.boundingBox(),
      page.getByRole('dialog').boundingBox(),
    ]);
    expect(imageArea!.width).toBeGreaterThanOrEqual(dialogArea!.width - 3);
    await page.keyboard.press('Escape');
  }
});

test('desktop home keeps its first shelf and controls visible in taskbar-reduced client areas', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  for (const viewport of [
    { width: 1920, height: 984 },
    { width: 1536, height: 768 },
    { width: 1280, height: 624 },
    { width: 1440, height: 1060 },
  ]) {
    await page.setViewportSize(viewport);
    await page.evaluate(() => window.scrollTo(0, 0));
    const card = page.locator('.game-card').first();
    await card.focus();
    await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
    for (const selector of [
      '.topbar',
      '.hero-buttons',
      '.library-heading',
      '.filter-row',
      '.game-card',
    ]) {
      const bounds = await page.locator(selector).first().boundingBox();
      expect(bounds!.y).toBeGreaterThanOrEqual(0);
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
    }
    await expect(page.locator('.hero-buttons .primary')).toBeInViewport({ ratio: 1 });
    if (viewport.height >= 768)
      expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(
        viewport.height,
      );
  }
});

test('native tiles show local art during online lookup and crossfade to the downloaded cover', async ({
  page,
}) => {
  const png = readFileSync(new URL('../fixtures/landscape.png', import.meta.url));
  let allowDecode!: () => void;
  const decoding = new Promise<void>((resolve) => (allowDecode = resolve));
  await page.route('http://asset.localhost/**', async (route) => {
    if (route.request().url().includes('/download.png')) await decoding;
    await route.fulfill({ contentType: 'image/png', body: png });
  });
  await page.addInitScript(() => {
    const online = new Promise<void>((resolve) => {
      window.addEventListener('release-artwork', () => resolve(), { once: true });
    });
    (window as any).isTauri = true;
    (window as any).__TAURI_INTERNALS__ = {
      convertFileSrc: (path: string) => `http://asset.localhost${path}`,
      invoke: async (command: string, args: { kind: string; localOnly?: boolean }) => {
        if (command === 'resolve_artwork') {
          if (args.localOnly)
            return { path: '/local.png', source: 'Installed game package', needsUpgrade: true };
          if (args.kind === 'cover') await online;
          return {
            path: args.kind === 'cover' ? '/download.png' : '/keyart.png',
            source: 'Fixture key art',
            revision: '5-fixture',
            fit: 'contain',
          };
        }
        return {
          games: [
            {
              id: 'steam:42',
              title: 'Key art fixture',
              store: 'steam',
              installed: true,
              favorite: false,
              launchCount: 0,
              lastPlayed: null,
            },
          ],
          settings: {
            controller: 'auto',
            language: 'en',
            transparency: true,
            reducedMotion: false,
            startupScan: false,
            artwork: true,
            steamRoots: [],
            epicRoots: [],
            gogRoots: [],
          },
          lastScan: null,
        };
      },
    };
  });
  await page.goto('/');
  await expect(page.locator('.hero .artwork')).toHaveClass(/artwork-loaded/);
  await expect(page.locator('.cover .artwork')).toHaveClass(/artwork-loaded/);
  await expect(page.locator('.cover .artwork-image')).toHaveAttribute('src', /\/local\.png$/);
  await page.getByRole('button', { name: 'Key art fixture', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.evaluate(() => window.dispatchEvent(new Event('release-artwork')));
  await expect(page.locator('.cover .artwork-image')).toHaveAttribute(
    'src',
    /\/download\.png\?v=5-fixture$/,
  );
  await expect(page.locator('.cover .artwork-previous')).toHaveAttribute('src', /\/local\.png$/);
  await expect(page.locator('.cover .artwork-previous')).toHaveCSS('opacity', '1');
  allowDecode();
  await expect(page.locator('.cover .artwork')).toHaveClass(/artwork-loaded/);
  await expect(page.locator('.cover .artwork-previous')).toHaveCount(0);
  await expect(page.locator('.hero .artwork-image')).toHaveAttribute('src', /\?v=5-fixture$/);
  for (const width of [390, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1060 });
    await expect(page.locator('.hero .artwork-image')).toHaveCSS('object-fit', 'cover');
    await expect(page.locator('.cover .artwork-image')).toHaveCSS('object-fit', 'fill');
  }
});

test('search, source filters and honest preview launch behavior', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.locator('.game-card')).toHaveCount(8);
  await page.getByRole('textbox', { name: 'Spiele suchen' }).fill('hollow');
  await expect(page.locator('.game-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Hollow Knight', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Spielen', exact: true }),
  ).toBeFocused();
  await page.getByRole('dialog').getByRole('button', { name: 'Spielen', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('nicht installiert');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Spiele suchen' }).fill('');
  await page.locator('.store-filters').getByRole('button', { name: 'GOG', exact: true }).click();
  await expect(page.locator('.game-card')).toHaveCount(2);
  expect(errors).toEqual([]);
});

test('favorites and settings persist; modal traps and restores focus', async ({ page }) => {
  await page.goto('/');
  const card = page.getByRole('button', { name: 'Hollow Knight', exact: true });
  await card.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Merken', exact: true }).click();
  await page.keyboard.press('Escape');
  await expect(card).toBeFocused();
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  await expect(page.locator('.game-card')).toHaveCount(4);
  await page.reload();
  await page.getByRole('button', { name: 'Favoriten', exact: true }).click();
  await expect(page.locator('.game-card')).toHaveCount(4);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByRole('combobox', { name: 'Tastensymbole' }).click();
  await page.getByRole('option', { name: 'PlayStation', exact: true }).click();
  await page.getByRole('switch', { name: 'Animationen reduzieren' }).check();
  await expect(page.locator('.preference-feedback [role=status]')).toHaveText(
    'Alle Änderungen automatisch gespeichert.',
  );
  await expect(page.locator('.app-shell')).toHaveClass(/reduced-motion/);
  await page.reload();
  await expect(page.locator('.app-shell')).toHaveClass(/reduced-motion/);
  await expect(page.locator('footer .glyph.a')).toHaveAttribute('data-symbol', '×');
  await page.getByRole('button', { name: 'Spiel hinzufügen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByPlaceholder('Wie heißt dein Spiel?')).toBeFocused();
  await dialog.getByRole('button', { name: 'Schließen', exact: true }).focus();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Zur Bibliothek hinzufügen' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Schließen', exact: true })).toBeFocused();
});

test('standard PlayStation controller navigates, opens details and backs out', async ({ page }) => {
  await page.addInitScript(() => {
    const buttons = Array.from({ length: 17 }, () => ({
      pressed: false,
      touched: false,
      value: 0,
    }));
    const pad = {
      id: 'DualSense Wireless Controller',
      connected: true,
      index: 0,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons,
      timestamp: 0,
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] });
    (window as unknown as { testPad: typeof pad }).testPad = pad;
  });
  await page.goto('/');
  await expect(page.locator('footer .glyph.a')).toHaveAttribute('data-symbol', '×');
  await page.getByRole('button', { name: 'Hollow Knight', exact: true }).focus();
  await page.evaluate(() => {
    (window as any).testPad.buttons[0].pressed = true;
  });
  await expect(page.getByRole('dialog')).toBeVisible();
  const play = page.getByRole('dialog').getByRole('button', { name: 'Spielen', exact: true });
  await expect(play).toBeFocused();
  await expect(play.locator('.glyph.a')).toHaveCSS('color', 'rgb(23, 23, 28)');
  await page.evaluate(() => {
    (window as any).testPad.buttons[0].pressed = false;
    (window as any).testPad.buttons[1].pressed = true;
  });
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('native IPC contract: empty state, local scan, favorite and launch', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).isTauri = true;
    const library = {
      games: [] as any[],
      settings: {
        controller: 'auto',
        reducedMotion: false,
        transparency: true,
        startupScan: false,
        artwork: false,
        steamRoots: [],
        epicRoots: [],
        gogRoots: [],
      },
      lastScan: null as number | null,
    };
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: any) => {
        if (command === 'get_library') return structuredClone(library);
        if (command === 'scan_library') {
          library.games = [
            {
              id: 'steam:42',
              title: 'Fixture Game',
              store: 'steam',
              installed: true,
              favorite: false,
              launchCount: 0,
              lastPlayed: null,
            },
          ];
          library.lastScan = 1;
          return { library: structuredClone(library), warnings: [], elapsedMs: 12 };
        }
        if (command === 'set_favorite') library.games[0].favorite = args.favorite;
        if (command === 'launch_game') {
          if (args.id !== 'steam:42') throw Error('Unknown id');
          library.games[0].launchCount++;
          library.games[0].lastPlayed = 100;
          return {
            library: structuredClone(library),
            report: { status: 'running', route: 'Steam -applaunch', pid: 42 },
          };
        }
        return structuredClone(library);
      },
    };
  });
  await page.goto('/');
  await expect(page.getByText('Dein nächstes Abenteuer beginnt hier.')).toBeVisible();
  await page.getByRole('button', { name: 'Spiele entdecken', exact: true }).click();
  await expect(page.locator('.game-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Fixture Game', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Merken', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Spielen', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('status')).toHaveText('Spielprozess erkannt');
  await expect(dialog.getByRole('textbox', { name: 'Startdiagnose' })).toHaveValue(/"pid": 42/);
});

test('layout has no horizontal overflow at desktop, TV and mobile sizes', async ({ page }) => {
  await page.goto('/');
  for (const [width, height] of [
    [1440, 1060],
    [1920, 1080],
    [390, 844],
  ]) {
    await page.setViewportSize({ width, height });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBeTruthy();
  }
});

test('large libraries render bounded pages and reset pagination when searching', async ({
  page,
}) => {
  await page.addInitScript(() => {
    (window as any).isTauri = true;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async () => ({
        games: Array.from({ length: 126 }, (_, i) => ({
          id: `steam:${i}`,
          title: `Game ${String(i).padStart(3, '0')}`,
          store: 'steam',
          installed: true,
          favorite: false,
          launchCount: 0,
          lastPlayed: null,
        })),
        settings: {
          controller: 'auto',
          reducedMotion: true,
          transparency: false,
          startupScan: false,
          artwork: false,
          steamRoots: [],
          epicRoots: [],
          gogRoots: [],
        },
        lastScan: null,
      }),
    };
  });
  await page.goto('/');
  await expect(page.locator('.game-card')).toHaveCount(20);
  for (let index = 0; index < 6; index++)
    await page.getByRole('button', { name: 'Weiter', exact: true }).click();
  await expect(page.locator('.game-card')).toHaveCount(6);
  await expect(page.getByRole('button', { name: 'Game 125', exact: true })).toBeAttached();
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^Bibliothek/ })
    .click();
  await expect(page.locator('.game-card')).toHaveCount(60);
  await page.getByRole('button', { name: 'Weiter', exact: true }).click();
  await expect(page.getByText('Seite 2 / 3 · 126 Spiele')).toBeVisible();
  await page.getByRole('button', { name: 'Weiter', exact: true }).click();
  await expect(page.locator('.game-card')).toHaveCount(6);
  await page.getByRole('textbox', { name: 'Spiele suchen' }).fill('Game 001');
  await expect(page.locator('.game-card')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Game 001', exact: true })).toBeVisible();
});

test('accessibility preferences remove glass and motion and survive reopening dialogs', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByRole('switch', { name: 'Animationen reduzieren' }).check();
  await page.getByRole('switch', { name: 'Transparente Glasflächen' }).uncheck();
  await expect(page.locator('.preference-feedback [role=status]')).toHaveText(
    'Alle Änderungen automatisch gespeichert.',
  );
  await page.reload();
  await page.getByRole('button', { name: 'Hollow Knight', exact: true }).click();
  const glass = await page
    .locator(
      '.topbar, nav, .secondary, .search-box, .bordered, .modal-backdrop, dialog, .modal-close, .store-tag, .favorite-badge',
    )
    .evaluateAll((elements) =>
      elements.map((element) => ({
        blur: getComputedStyle(element).backdropFilter,
        animation: getComputedStyle(element).animationName,
        transition: getComputedStyle(element).transitionDuration,
      })),
    );
  for (const style of glass) {
    expect(style.blur).toBe('none');
    expect(style.animation).toBe('none');
    expect(style.transition).toBe('0s');
  }
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Hollow Knight', exact: true })).toBeFocused();
});

test('native fullscreen applies readable TV layout without overflowing', async ({ page }) => {
  await page.addInitScript(() => {
    (window as any).isTauri = true;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: any) => {
        if (command === 'set_borderless') return args.enabled;
        return {
          games: [
            {
              id: 'steam:42',
              title: 'TV fixture',
              store: 'steam',
              installed: true,
              favorite: false,
              launchCount: 0,
              lastPlayed: null,
            },
          ],
          settings: {
            controller: 'auto',
            reducedMotion: true,
            transparency: false,
            startupScan: false,
            artwork: false,
            steamRoots: [],
            epicRoots: [],
            gogRoots: [],
          },
          lastScan: null,
        };
      },
    };
  });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto('/');
  const before = await page
    .locator('.card-title')
    .evaluate((element) => parseFloat(getComputedStyle(element).fontSize));
  await page.keyboard.press('F11');
  await expect(page.locator('.app-shell')).toHaveClass(/tv-mode/);
  const tvCover = await page.locator('.cover').boundingBox();
  expect(tvCover!.width / tvCover!.height).toBeCloseTo(16 / 9, 2);
  await expect(page.locator('.game-card')).toBeInViewport({ ratio: 1 });
  expect(
    await page
      .locator('.card-title')
      .evaluate((element) => parseFloat(getComputedStyle(element).fontSize)),
  ).toBeGreaterThan(before);
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
  await page.keyboard.press('Escape');
  await expect(page.locator('.app-shell')).not.toHaveClass(/tv-mode/);
});

test('artwork retries landscape variants, fills its tile and uses sans-serif type', async ({
  page,
}) => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  );
  await page.route('https://cdn.cloudflare.steamstatic.com/**', async (route) => {
    if (route.request().url().endsWith('library_header.jpg'))
      await route.fulfill({ contentType: 'image/png', body: png });
    else await route.fulfill({ status: 404, body: '' });
  });
  await page.goto('/');
  const card = page.locator('.game-card').first();
  await expect(card.locator('.artwork')).toHaveClass(/artwork-loaded/);
  await expect(card.locator('.artwork-image')).toHaveAttribute('src', /library_header\.jpg$/);
  expect(
    await card.locator('.artwork-image').evaluate((image) => getComputedStyle(image).objectFit),
  ).toBe('cover');
  const cover = await card.locator('.cover').boundingBox();
  expect(cover!.width / cover!.height).toBeCloseTo(16 / 9, 1);
  expect(
    await page.locator('.hero h1').evaluate((element) => getComputedStyle(element).fontFamily),
  ).toContain('sans-serif');
  await card.focus();
  await expect(card).toBeFocused();
  expect(
    await card.locator('.cover').evaluate((element) => getComputedStyle(element).boxShadow),
  ).not.toBe('none');
});

test('unavailable artwork has a real illustration and PlayStation symbols are SVG paths', async ({
  page,
}) => {
  await page.route('https://cdn.cloudflare.steamstatic.com/**', (route) =>
    route.fulfill({ status: 404, body: '' }),
  );
  await page.goto('/');
  const placeholder = page.locator('.game-card .artwork-placeholder').first();
  await expect(placeholder).toBeVisible();
  expect(
    await placeholder.evaluate((element) => (element as HTMLImageElement).naturalWidth),
  ).toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.getByRole('combobox', { name: 'Tastensymbole' }).click();
  await page.getByRole('option', { name: 'PlayStation', exact: true }).click();
  await expect(page.locator('.preference-feedback [role=status]')).toHaveText(
    'Alle Änderungen automatisch gespeichert.',
  );
  await expect(page.locator('footer .glyph.a svg path')).toHaveAttribute('d', /m8 8/);
  await expect(page.locator('footer .glyph.x svg rect')).toBeVisible();
});

test('focus changes crossfade hero art while retaining the previous image during loading', async ({
  page,
}) => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
    'base64',
  );
  let release!: () => void;
  const gate = new Promise<void>((resolve) => (release = resolve));
  await page.route('https://cdn.cloudflare.steamstatic.com/**', async (route) => {
    if (route.request().url().includes('/1091500/library_hero_2x.jpg')) await gate;
    await route.fulfill({ contentType: 'image/png', body: png });
  });
  await page.goto('/');
  await expect(page.locator('.hero .artwork')).toHaveClass(/artwork-loaded/);
  const previous = await page.locator('.hero .artwork-image').getAttribute('src');
  await page.getByRole('button', { name: 'Cyberpunk 2077', exact: true }).focus();
  await expect(page.locator('.hero h1')).toHaveText('Cyberpunk 2077');
  await expect(page.locator('.hero .artwork-previous')).toHaveAttribute('src', previous!);
  await expect(page.locator('.hero .artwork-previous')).toHaveCSS('opacity', '1');
  release();
  await expect(page.locator('.hero .artwork')).toHaveClass(/artwork-loaded/);
  await expect(page.locator('.hero .artwork-previous')).toHaveCount(0);
  await expect(page.locator('footer .keycap').first()).toHaveText('↵');
});
