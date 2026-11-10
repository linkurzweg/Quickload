import { defaults } from '../../src/lib/types';
import { expect, test } from './fixtures';

test('imports a provider SVG, reuses the saved copy and restores the neutral symbol', async ({
  page,
}, testInfo) => {
  await page.addInitScript((settings) => {
    const svg =
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="white" d="M0 0h24v24z"/></svg>';
    const host = window as unknown as { isTauri: boolean; __TAURI_INTERNALS__: object };
    host.isTauri = true;
    host.__TAURI_INTERNALS__ = {
      /** Simulate the picker and native persistence without touching the host profile. */
      invoke(command: string, args: { store?: string; path?: string; enabled?: boolean } = {}) {
        if (command === 'get_library') {
          return {
            settings: { ...settings, artwork: false, startupScan: false, reducedMotion: true },
            games: [{ id: 'steam:1', store: 'steam', title: 'Fixture', installed: true }],
            lastScan: null,
          };
        }
        if (command === 'plugin:dialog|open') return 'C:/fixtures/store.svg';
        if (command === 'set_borderless') return args.enabled;
        if (command === 'get_provider_icons') {
          const saved = localStorage.getItem('fixture-provider-icon');
          return saved ? { steam: saved } : {};
        }
        if (command === 'set_provider_icon' && args.store === 'steam') {
          if (args.path) {
            localStorage.setItem('fixture-provider-icon', svg);
            return svg;
          }
          localStorage.removeItem('fixture-provider-icon');
        }
        return null;
      },
    };
  }, defaults);
  await page.goto('/');
  const filter = page.locator('.store-filters').getByRole('button', { name: 'Steam', exact: true });
  await expect(filter.locator('svg')).toBeVisible();
  const settings = page.getByRole('button', { name: 'Einstellungen', exact: true });
  const choose = page.getByRole('button', { name: 'SVG für Steam auswählen' });
  const remove = page.getByRole('button', { name: 'Symbol für Steam entfernen' });
  await settings.click();
  await choose.click();
  await expect(remove).toBeVisible();
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
    await choose.evaluate((button) => button.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: testInfo.outputPath(`provider-icons-${width}.png`) });
  }
  await page.reload();
  await expect(filter.locator('img')).toHaveAttribute('src', /^data:image\/svg\+xml,/);
  await settings.click();
  await remove.click();
  await expect(choose).toBeFocused();
  await page.reload();
  await expect(filter.locator('svg')).toBeVisible();
});
