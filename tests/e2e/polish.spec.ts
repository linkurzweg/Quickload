import { test, expect } from './fixtures';
import { defaults, type Store } from '../../src/lib/types';

test('provider labels filter games and scan durations use readable units', async ({ page }) => {
  await page.addInitScript((settings) => {
    (window as any).isTauri = true;
    const library = {
      settings: { ...settings, artwork: false, startupScan: false, language: 'de' },
      lastScan: null,
      games: (['steam', 'epic', 'gog', 'xbox', 'manual'] as Store[]).map((store) => ({
        id: `${store}:fixture`,
        title: `${store} fixture`,
        store,
        installed: true,
        favorite: false,
        launchCount: 0,
        lastPlayed: null,
      })),
    };
    const times = [12, 2851, 90_000];
    (window as any).__TAURI_INTERNALS__ = {
      invoke: async (command: string) =>
        command === 'scan_library'
          ? { library: structuredClone(library), warnings: [], elapsedMs: times.shift() }
          : structuredClone(library),
    };
  }, defaults);
  await page.goto('/');
  const filters = page.locator('.store-filters');
  await expect(filters.locator('img')).toHaveCount(0);
  for (const provider of ['Steam', 'Epic Games', 'GOG', 'Xbox']) {
    await filters.getByRole('button', { name: provider, exact: true }).click();
    await expect(page.locator('.game-card')).toHaveCount(1);
  }
  for (const duration of ['12 ms', '2,9 s', '1,5 min']) {
    await page.getByRole('button', { name: 'Bibliothek scannen', exact: true }).click();
    await expect(page.locator('.library-status')).toContainText(`Letzter Scan: ${duration}`);
    await expect(page.locator('.toast')).toContainText(`Scan in ${duration}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText('Letzter Scan: 1,5 min')).toBeVisible();
});

test('surface motion is finite and both reduced-motion preferences suppress it', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await expect(page.locator('.settings-page')).toHaveCSS('animation-duration', '0.18s');
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getAnimations().filter((animation) => animation.playState === 'running').length,
      ),
    )
    .toBe(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('.settings-page')).toHaveCSS('animation-name', 'none');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('switch', { name: 'Animationen reduzieren' }).check();
  await expect(page.locator('.preference-feedback [role=status]')).toHaveText(
    'Alle Änderungen automatisch gespeichert.',
  );
  await expect(page.locator('.settings-page')).toHaveCSS('animation-name', 'none');
});
