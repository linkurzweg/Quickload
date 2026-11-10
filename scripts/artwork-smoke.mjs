// Run against a local debug WebView on port 9223. Only a caller-supplied harmless EXE is registered.
// This check never launches the executable or modifies any real game's cover.
import { chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';

const executable = process.env.QUICKLOAD_SMOKE_EXE;
if (!executable)
  throw new Error('QUICKLOAD_SMOKE_EXE must point to a harmless executable fixture.');
const image = process.env.QUICKLOAD_SMOKE_IMAGE ?? resolve('src-tauri/icons/128x128.png');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts()[0].pages()[0];
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
let addedId;
try {
  const imported = await page.evaluate(
    async ({ executable }) => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const before = await invoke('get_library');
      const next = await invoke('add_manual', { title: 'Quickload Cover-Test', path: executable });
      const added = next.games.find((game) => !before.games.some((old) => old.id === game.id));
      if (!added) throw Error('No isolated fixture was added.');
      // Return the ID before testing imports so outer cleanup can always remove this entry.
      return added.id;
    },
    { executable, image },
  );
  addedId = imported;
  const results = await page.evaluate(
    async ({ id, image }) => {
      const invoke = window.__TAURI_INTERNALS__.invoke;
      const imported = await invoke('import_artwork', { id, path: image });
      const first = await invoke('resolve_artwork', { id, kind: 'cover' });
      const start = performance.now();
      const cached = await invoke('resolve_artwork', { id, kind: 'cover' });
      let unknownRejected = false;
      try {
        await invoke('resolve_artwork', { id: 'unknown:fixture', kind: 'cover' });
      } catch {
        unknownRejected = true;
      }
      return {
        imported: imported.source,
        samePath: first.path === cached.path,
        cachedMs: Math.round(performance.now() - start),
        unknownRejected,
      };
    },
    { id: addedId, image },
  );
  expect(results.imported).toBe('Custom cover');
  expect(results.samePath).toBe(true);
  expect(results.unknownRejected).toBe(true);
  await page.reload();
  await page.getByRole('textbox', { name: 'Spiele suchen' }).fill('Quickload Cover-Test');
  await page.getByRole('button', { name: 'Quickload Cover-Test', exact: true }).click();
  await expect(page.locator('dialog .artwork')).toHaveClass(/artwork-loaded/);
  expect(
    await page.locator('dialog .artwork-image').evaluate((element) => element.naturalWidth),
  ).toBeGreaterThan(0);
  await page.keyboard.press('Escape');
  await page.reload();
  await page.getByRole('textbox', { name: 'Spiele suchen' }).fill('Quickload Cover-Test');
  await page.getByRole('button', { name: 'Quickload Cover-Test', exact: true }).click();
  await expect(page.locator('dialog .artwork')).toHaveClass(/artwork-loaded/);
  expect(errors).toEqual([]);
  console.log(
    JSON.stringify({
      ...results,
      assetDecoded: true,
      persistedAfterReload: true,
      pageErrors: errors,
    }),
  );
} finally {
  await page.keyboard.press('Escape').catch(() => {});
  if (addedId)
    await page.evaluate(
      (id) => window.__TAURI_INTERNALS__.invoke('remove_manual', { id }),
      addedId,
    );
  await page
    .getByRole('textbox', { name: 'Spiele suchen' })
    .fill('')
    .catch(() => {});
  await page.reload().catch(() => {});
  await browser.close();
}
