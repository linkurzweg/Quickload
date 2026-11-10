import { test, expect, type Page, type Locator } from './fixtures';

/** Verify overlay visibility for scroll `surface`; hidden native tracks must never become opaque. */
async function expectThumb(surface: Locator, color: string) {
  await expect(surface).toHaveCSS('scrollbar-width', 'none');
  const visible = color !== 'rgba(0, 0, 0, 0)';
  await expect
    .poll(() =>
      surface.evaluate((element) => {
        const rect =
          element === document.documentElement
            ? { left: 0, top: 0 }
            : element.getBoundingClientRect();
        return [...document.querySelectorAll<HTMLElement>('.scroll-overlay.visible')].some(
          (overlay) =>
            Math.abs(parseFloat(overlay.style.left) - rect.left) < 1 &&
            Math.abs(parseFloat(overlay.style.top) - rect.top) < 1,
        );
      }),
    )
    .toBe(visible);
}

/** Install an isolated 90-game library and mutable standard gamepad in browser `page`. */
async function navigationFixture(page: Page) {
  await page.addInitScript(() => {
    const pad = {
      id: 'Xbox Wireless Controller',
      connected: true,
      index: 0,
      mapping: 'standard',
      axes: [0, 0, 0, 0],
      buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    };
    Object.defineProperty(navigator, 'getGamepads', { value: () => [pad] });
    (window as any).testPad = pad;
    (window as any).isTauri = true;
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string, args: any) =>
        command === 'set_borderless'
          ? args.enabled
          : {
              games: Array.from({ length: 90 }, (_, i) => ({
                id: `steam:${i + 100}`,
                title: `Navigation ${String(i).padStart(3, '0')}`,
                store: 'steam',
                installed: true,
                favorite: false,
                launchCount: 0,
                lastPlayed: null,
              })),
              settings: {
                controller: 'auto',
                reducedMotion: true,
                transparency: true,
                startupScan: false,
                artwork: false,
                steamRoots: [],
                epicRoots: [],
                gogRoots: [],
              },
              lastScan: null,
            },
    };
  });
  await page.goto('/');
  await expect(page.locator('.game-card')).toHaveCount(20);
}

test('Home pages preserve vertical scroll and continue at shelf edges with L2/R2 support', async ({
  page,
}) => {
  await navigationFixture(page);
  const initialY = await page.evaluate(() => scrollY);
  await page.getByRole('button', { name: 'Weiter', exact: true }).click();
  await expect(page.locator('.game-card').first()).toHaveAttribute('data-game', 'steam:120');
  expect(await page.evaluate(() => scrollY)).toBe(initialY);
  await page.locator('.game-card').last().focus();
  await page.evaluate(() => ((window as any).testPad.buttons[15].pressed = true));
  await expect(page.locator('.game-card').first()).toHaveAttribute('data-game', 'steam:140');
  await page.evaluate(() => ((window as any).testPad.buttons[15].pressed = false));
  await page.evaluate(() => ((window as any).testPad.buttons[6].pressed = true));
  await expect(page.locator('.game-card').first()).toHaveAttribute('data-game', 'steam:120');
  await page.evaluate(() => ((window as any).testPad.buttons[6].pressed = false));
  await page.evaluate(() => ((window as any).testPad.buttons[7].pressed = true));
  await expect(page.locator('.game-card').first()).toHaveAttribute('data-game', 'steam:140');
  await page.evaluate(() => ((window as any).testPad.buttons[7].pressed = false));
  expect(await page.evaluate(() => scrollY)).toBe(initialY);
  await expect(page.locator('.pagination .glyph.lt')).toHaveAttribute('data-symbol', 'LT');
  await expect(page.locator('.pagination .glyph.rt')).toHaveAttribute('data-symbol', 'RT');
  await page.evaluate(() => ((window as any).testPad.buttons[5].pressed = true));
  await expect(page.locator('.game-grid')).toBeVisible();
  await page.evaluate(() => ((window as any).testPad.buttons[5].pressed = false));
  await page.evaluate(() => ((window as any).testPad.buttons[4].pressed = true));
  await expect(page.locator('.game-shelf')).toBeVisible();
  await page.evaluate(() => ((window as any).testPad.buttons[4].pressed = false));
  await expect(page.locator('.card-subtitle')).toHaveCount(0);
});

test('fixed header remains reachable and focus scrolling clears the header', async ({ page }) => {
  await navigationFixture(page);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^Bibliothek/ })
    .click();
  await expect(page.locator('.game-card')).toHaveCount(60);
  const last = page.locator('.game-card').last();
  await last.focus();
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(500);
  await expect
    .poll(async () => {
      const header = await page.locator('.topbar').boundingBox();
      const card = await last.boundingBox();
      return header!.y >= -1 && card!.y >= header!.height + 10;
    })
    .toBe(true);
  await expect(
    page.getByRole('navigation').getByRole('button', { name: 'Für dich', exact: true }),
  ).toBeInViewport();
  const before = await page.evaluate(() => scrollY);
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^Bibliothek/ })
    .focus();
  await expect(
    page.getByRole('navigation').getByRole('button', { name: /^Bibliothek/ }),
  ).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBeCloseTo(before, 0);
  await page.keyboard.press('ArrowDown');
  await expect
    .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('main'))))
    .toBe(true);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const active = document.activeElement!.getBoundingClientRect();
        return active.top >= document.querySelector('.topbar')!.getBoundingClientRect().bottom;
      }),
    )
    .toBe(true);
  // Reach the persistent navigation through actual D-pad input from the library.
  await page.evaluate(() => {
    (window as any).testPad.buttons[12].pressed = true;
  });
  await expect
    .poll(() => page.evaluate(() => Boolean(document.activeElement?.closest('.topbar'))), {
      timeout: 6000,
    })
    .toBe(true);
  await page.evaluate(() => {
    (window as any).testPad.buttons[12].pressed = false;
  });
});

test('scrollbars reveal on activity and edge hover, then hide without changing layout', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 480 });
  await navigationFixture(page);
  await page.mouse.move(400, 250);
  const root = page.locator('html');
  const shelf = page.locator('.game-shelf');
  await expectThumb(root, 'rgba(0, 0, 0, 0)');
  const width = await root.evaluate((element) => element.clientWidth);
  await page.mouse.wheel(0, 160);
  await expect(root).toHaveAttribute('data-scroll-active');
  await expectThumb(root, 'rgba(169, 169, 179, 0.5)');
  await expect(root).not.toHaveAttribute('data-scroll-active', { timeout: 2500 });
  expect(await root.evaluate((element) => element.clientWidth)).toBe(width);
  await page.mouse.move(1438, 300);
  await expect(root).toHaveAttribute('data-scroll-hover');
  await page.mouse.move(400, 250);
  await expect(root).not.toHaveAttribute('data-scroll-hover');
  await shelf.evaluate((element) => element.scrollBy({ left: 180, behavior: 'instant' }));
  await expect(shelf).toHaveAttribute('data-scroll-active');
  await expect(
    page.locator('.scroll-overlay.visible .scroll-thumb.horizontal:not([hidden])'),
  ).toHaveCSS('height', '12px');
  expect(
    await root.evaluate((element) => getComputedStyle(element, '::-webkit-scrollbar').display),
  ).toBe('none');
  await expect(shelf).not.toHaveAttribute('data-scroll-active', { timeout: 2500 });
  await expectThumb(shelf, 'rgba(0, 0, 0, 0)');
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(root).toHaveCSS('scrollbar-color', 'auto');
});

test('dialog and text areas own contextual scrollbars', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 480 });
  await navigationFixture(page);
  await page.locator('.game-card').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog.evaluate((element) => element.scrollBy({ top: 120, behavior: 'instant' }));
  await expect(dialog).toHaveAttribute('data-scroll-active');
  await expectThumb(dialog, 'rgba(169, 169, 179, 0.5)');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  const textarea = page.locator('textarea').first();
  await textarea.fill(Array.from({ length: 25 }, (_, i) => `C:\\Games\\${i}`).join('\n'));
  await textarea.evaluate((element) => (element.scrollTop = 50));
  await expect(textarea).toHaveAttribute('data-scroll-active');
  await expect(textarea).toHaveCSS('scrollbar-width', 'none');
});

test('fullscreen cursor follows real input and ignores an idle connected controller', async ({
  page,
}) => {
  await navigationFixture(page);
  const button = page
    .getByRole('navigation')
    .getByRole('button', { name: 'Für dich', exact: true });
  await page.evaluate(() => {
    (window as any).testPad.buttons[9].pressed = true;
  });
  await expect(page.locator('.app-shell')).toHaveClass(/tv-mode/);
  await page.evaluate(() => {
    (window as any).testPad.buttons[9].pressed = false;
  });
  await expect(button).toHaveCSS('cursor', 'none');
  await page.mouse.move(250, 170);
  await expect(button).toHaveCSS('cursor', 'pointer');
  // An unsupported face/shoulder action still counts as controller use.
  await page.evaluate(() => {
    (window as any).testPad.buttons[10].pressed = true;
  });
  await expect(button).toHaveCSS('cursor', 'none');
  await page.evaluate(() => {
    (window as any).testPad.buttons[10].pressed = false;
  });
  await page.keyboard.press('Shift');
  await expect(button).toHaveCSS('cursor', 'pointer');
  await page.waitForTimeout(120);
  await expect(button).toHaveCSS('cursor', 'pointer');
  await page.evaluate(() => {
    (window as any).testPad.axes[3] = 1;
  });
  await expect(button).toHaveCSS('cursor', 'none');
  await page.evaluate(() => {
    (window as any).testPad.axes[3] = 0;
  });
  await page.mouse.wheel(0, 10);
  await expect(button).toHaveCSS('cursor', 'pointer');
  await page.evaluate(() => {
    (window as any).testPad.buttons[10].pressed = true;
  });
  await expect(button).toHaveCSS('cursor', 'none');
  await page.evaluate(() => {
    (window as any).testPad.buttons[10].pressed = false;
  });
  await page.keyboard.press('Escape');
  await expect(page.locator('.app-shell')).not.toHaveClass(/tv-mode/);
  await page.evaluate(() => {
    (window as any).testPad.buttons[11].pressed = true;
  });
  await expect(page.locator('body')).toHaveClass(/controller-input/);
  await expect(button).toHaveCSS('cursor', 'pointer');
});

test('right stick scrolls the page and shelf without activating games, and drift stops', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 480 });
  await navigationFixture(page);
  const first = page.locator('.game-card').first();
  await first.focus();
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            window.scrollTo({ top: 0, behavior: 'instant' });
            resolve();
          }),
        ),
      ),
  );
  await expect.poll(() => page.evaluate(() => scrollY)).toBe(0);
  const start = await page.evaluate(() => scrollY);
  await page.evaluate(() => {
    (window as any).testPad.axes[3] = 1;
  });
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(start + 100);
  await page.evaluate(() => {
    (window as any).testPad.axes[3] = 0.1;
  });
  // Wait for a neutral controller poll, then verify no ongoing animation moves the page.
  await page.waitForTimeout(80);
  const stopped = await page.evaluate(() => scrollY);
  await page.waitForTimeout(150);
  expect(await page.evaluate(() => scrollY)).toBe(stopped);
  await expect(first).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.evaluate(() => {
    (window as any).testPad.axes[2] = 1;
  });
  await expect
    .poll(() => page.locator('.game-shelf').evaluate((element) => element.scrollLeft))
    .toBeGreaterThan(120);
  await page.evaluate(() => {
    (window as any).testPad.axes[2] = 0;
  });
  await expect(page.locator('.game-shelf')).not.toHaveAttribute('data-analog-scroll');
  await expect(first).toBeFocused();
});

test('right stick scrolls dialogs without moving the inert background', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 480 });
  await navigationFixture(page);
  await page.locator('.game-card').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const background = await page.evaluate(() => scrollY);
  await page.evaluate(() => {
    (window as any).testPad.axes[3] = 1;
  });
  await expect.poll(() => dialog.evaluate((element) => element.scrollTop)).toBeGreaterThan(80);
  expect(await page.evaluate(() => scrollY)).toBe(background);
  await page.evaluate(() => {
    (window as any).testPad.axes[3] = 0;
  });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  expect(await page.evaluate(() => document.body.style.overflow)).not.toBe('hidden');
});

test('shelf edge focus is inset, visible and not clipped', async ({ page }) => {
  await navigationFixture(page);
  for (const card of [page.locator('.game-card').first(), page.locator('.game-card').last()]) {
    await card.focus();
    await expect
      .poll(() =>
        card.evaluate((element) => {
          const card = element.getBoundingClientRect();
          const shelf = element.closest('.game-shelf')!.getBoundingClientRect();
          return card.left >= shelf.left + 2 && card.right <= shelf.right - 2;
        }),
      )
      .toBe(true);
    const focus = await card.locator('.cover').evaluate((element) => {
      const ring = getComputedStyle(element, '::after');
      return { inset: ring.top, width: ring.borderTopWidth, opacity: ring.opacity };
    });
    expect(focus).toEqual({ inset: '0px', width: '1px', opacity: '1' });
  }
  await page.emulateMedia({ forcedColors: 'active' });
  await page.locator('.game-card').first().focus();
  await expect(page.locator('.game-card').first()).toHaveCSS('outline-width', '2px');
  await expect(page.locator('.game-card').first()).toHaveCSS('outline-style', 'solid');
});

test('header controls fit inside the glass surface at narrow and desktop widths', async ({
  page,
}) => {
  await navigationFixture(page);
  for (const width of [390, 800, 1440, 1920]) {
    await page.setViewportSize({ width, height: 844 });
    const fits = await page.locator('.topbar').evaluate((header) => {
      const frame = header.getBoundingClientRect();
      return [...header.querySelectorAll('button')].every((button) => {
        const rect = button.getBoundingClientRect();
        return (
          rect.top >= frame.top &&
          rect.bottom <= frame.bottom &&
          rect.left >= 0 &&
          rect.right <= innerWidth
        );
      });
    });
    expect(fits).toBe(true);
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await expect(page.locator('.hero-art')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Quickload Startseite' })).toBeVisible();
  }
});

test('text actions, navigation and search keep rounded, separated focus surfaces', async ({
  page,
}) => {
  await navigationFixture(page);
  const showAll = page.getByRole('button', { name: 'Alle 90 Spiele ansehen' });
  await showAll.focus();
  await expect(showAll).toHaveCSS('border-radius', '12px');
  await expect(showAll).toHaveCSS('padding', '12px 14px');
  await expect(showAll).toHaveCSS('outline-style', 'none');
  await expect(showAll).toBeInViewport();
  const search = page.getByRole('textbox', { name: 'Spiele suchen' });
  await search.focus();
  await expect(search).toHaveCSS('box-shadow', 'none');
  await expect(search).toHaveCSS('outline-style', 'none');
  await expect(page.locator('.search-box')).toHaveCSS('border-radius', '12px');
  await expect(page.locator('.search-box')).not.toHaveCSS('box-shadow', 'none');
  await page.evaluate(() => document.body.classList.add('controller-input'));
  await expect(search).toHaveCSS('box-shadow', 'none');
  for (const width of [390, 800, 1440, 1920]) {
    await page.setViewportSize({ width, height: 1060 });
    const nav = page.getByRole('navigation');
    const selected = nav.getByRole('button', { name: 'Für dich', exact: true });
    const focused = nav.getByRole('button', { name: /^Bibliothek/ });
    await focused.focus();
    const activeBounds = await selected.boundingBox();
    const focusBounds = await focused.boundingBox();
    // Both three-pixel focus halos have room before reaching the neighboring segment.
    expect(focusBounds!.x - activeBounds!.x - activeBounds!.width).toBeGreaterThanOrEqual(7.5);
    await focused.click();
    const alignment = await nav.evaluate((element) => {
      const indicator = getComputedStyle(element, '::before');
      const active = element.querySelector('.active')!.getBoundingClientRect();
      const parent = element.getBoundingClientRect();
      const x = parent.left + parseFloat(indicator.left) + new DOMMatrix(indicator.transform).m41;
      return {
        offset: Math.abs(x - active.left),
        width: Math.abs(parseFloat(indicator.width) - active.width),
      };
    });
    expect(alignment.offset).toBeLessThan(1);
    expect(alignment.width).toBeLessThan(1);
    await selected.click();
  }
  await search.focus();
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(page.locator('.search-box')).toHaveCSS('outline-style', 'solid');
});
