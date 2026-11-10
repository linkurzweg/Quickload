// Start a debug-port-enabled local Quickload build before running this developer-only check.
// The caller supplies a harmless executable fixture and its marker path, never a real game.
import { chromium, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
const executable = process.env.QUICKLOAD_SMOKE_EXE;
const marker = process.env.QUICKLOAD_SMOKE_MARKER;
if (!executable || !marker)
  throw Error('QUICKLOAD_SMOKE_EXE and QUICKLOAD_SMOKE_MARKER are required.');
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser.contexts()[0].pages()[0];
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await expect(page.locator('.brand')).toBeVisible();
await expect(page.locator('.preview-badge')).toHaveCount(0);
await expect(page.getByRole('button', { name: 'Bibliothek scannen', exact: true })).toBeEnabled({
  timeout: 35000,
});
const initialCount = await page.locator('.nav-count').textContent();
await page.getByRole('button', { name: 'Spiel hinzufügen', exact: true }).click();
await page.getByPlaceholder('Wie heißt dein Spiel?').fill('Quickload Integrationstest');
await page.getByPlaceholder('Absoluter Pfad zur Spieldatei').fill(executable);
await page.getByRole('button', { name: 'Zur Bibliothek hinzufügen', exact: true }).click();
await expect(page.getByRole('dialog')).toHaveCount(0);
await page.getByRole('textbox', { name: 'Spiele suchen' }).fill('Quickload Integrationstest');
await page.getByRole('button', { name: 'Quickload Integrationstest', exact: true }).click();
await page.getByRole('dialog').getByRole('button', { name: 'Spielen', exact: true }).click();
await expect.poll(async () => readFile(marker, 'utf8').catch(() => '')).toBe('launched');
await expect(page.getByRole('status')).toContainText(
  'Start von Quickload Integrationstest übergeben',
);
await page.getByRole('button', { name: 'Quickload Integrationstest', exact: true }).click();
await expect(page.locator('.detail-stats')).toContainText('1');
await page.getByRole('button', { name: 'Eintrag entfernen', exact: true }).click();
await page.getByRole('textbox', { name: 'Spiele suchen' }).fill('');
const before = await page.evaluate(() => ({ width: screen.width, height: screen.height }));
await page.getByRole('button', { name: 'Vollbild umschalten', exact: true }).click();
await expect(page.locator('.app-shell')).toHaveClass(/tv-mode/);
const after = await page.evaluate(() => ({ width: screen.width, height: screen.height }));
expect(after).toEqual(before);
await page.getByRole('button', { name: 'Vollbild umschalten', exact: true }).click();
await expect(page.locator('.app-shell')).not.toHaveClass(/tv-mode/);
await expect(page.locator('.nav-count')).toHaveText(initialCount.trim());
await mkdir('docs/screenshots', { recursive: true });
await page.screenshot({ path: 'docs/screenshots/native-windows.png', animations: 'disabled' });
console.log(
  JSON.stringify({
    native: true,
    games: Number(initialCount),
    manualLaunch: 'passed',
    cleanup: 'passed',
    fullscreen: 'passed',
    resolutionBefore: before,
    resolutionAfter: after,
    pageErrors: errors,
  }),
);
if (errors.length) process.exitCode = 1;
await browser.close();
