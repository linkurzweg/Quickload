import { expect, test } from './fixtures';

test('checks and stages a signed update through desktop settings', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    const requests: string[] = [];
    let onClose: ((event: { event: string; id: number }) => Promise<void>) | undefined;
    const host = window as unknown as { isTauri: boolean; __TAURI_INTERNALS__: object };
    host.isTauri = true;
    host.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' } },
      /** Capture the window close listener so the fixture can run the actual close guard. */
      transformCallback(callback: (event: { event: string; id: number }) => Promise<void>) {
        onClose = callback;
        return 1;
      },
      /** Record native commands and return deterministic release, settings and fullscreen state. */
      async invoke(
        command: string,
        args: {
          enabled?: boolean;
          restart?: boolean;
          settings?: { automaticUpdates: boolean };
        } = {},
      ) {
        requests.push(command);
        localStorage.setItem('fixture-update-requests', JSON.stringify(requests));
        if (command === 'get_library')
          return { games: [], settings: { startupScan: false, artwork: false }, lastScan: null };
        if (command === 'supports_updates' || command === 'supports_login_startup') return true;
        if (command === 'get_fullscreen') return false;
        if (command === 'set_borderless') return args.enabled;
        if (command === 'check_update') return '1.2.3';
        if (command === 'plugin:event|listen') return 1;
        if (command === 'close_window')
          await onClose?.({ event: 'tauri://close-requested', id: 1 });
        if (command === 'install_update') {
          localStorage.setItem('fixture-restart-update', String(args.restart));
        }
        if (command === 'save_settings') {
          localStorage.setItem('fixture-auto-update', String(args.settings?.automaticUpdates));
        }
        return null;
      },
    };
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  const automatic = page.getByRole('switch', { name: 'Quickload automatisch aktualisieren' });
  await expect(automatic).not.toBeChecked();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fixture-update-requests') ?? '[]'))
    .not.toContain('check_update');
  await page.getByRole('button', { name: 'Nach Updates suchen' }).click();
  await expect(page.getByText('Version 1.2.3 ist verfügbar.')).toBeVisible();
  await page.getByRole('button', { name: 'Update herunterladen' }).click();
  await expect(page.getByText('Version 1.2.3 ist zur Installation bereit.')).toBeVisible();
  const restart = page.getByRole('button', { name: 'Installieren und neu starten' });
  await expect(restart).toBeEnabled();
  await automatic.check();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fixture-auto-update')))
    .toBe('true');
  for (const [width, height] of [
    [390, 844],
    [1440, 1060],
    [1920, 1080],
  ]) {
    await page.setViewportSize({ width, height });
    if (width === 1920) {
      await page.getByRole('button', { name: 'Randloses Vollbild', exact: true }).click();
      await expect(page.locator('.tv-mode')).toBeVisible();
    }
    await page
      .getByRole('heading', { name: 'Updates' })
      .evaluate((heading) => heading.closest('section')?.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: testInfo.outputPath(`updates-${width}.png`) });
  }
  await restart.click();
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('fixture-restart-update')))
    .toBe('true');
});
