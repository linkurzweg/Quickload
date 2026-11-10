import { chromium } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    locale: 'de-DE',
    viewport: { width: 1440, height: 1060 },
    deviceScaleFactor: 1,
  });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.addInitScript(() =>
    Object.defineProperty(navigator, 'getGamepads', { value: () => [] }),
  );
  await page.goto(process.env.QUICKLOAD_PREVIEW_URL ?? 'http://127.0.0.1:1427');
  await page.locator('.game-card').first().waitFor();
  await page.evaluate(async () => {
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
  });
  await mkdir('.tools/screenshots', { recursive: true });
  await page.screenshot({
    path: '.tools/screenshots/home.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^Bibliothek/ })
    .focus();
  await page.screenshot({
    path: '.tools/screenshots/navigation-focus.png',
    animations: 'disabled',
  });
  await page.getByRole('textbox', { name: 'Spiele suchen' }).focus();
  await page.screenshot({ path: '.tools/screenshots/search-focus.png', animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.evaluate(() => window.scrollTo({ top: 300, behavior: 'instant' }));
  await page.locator('.game-card').first().focus();
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  await page.screenshot({ path: '.tools/screenshots/focus.png', animations: 'disabled' });
  await page.setViewportSize({ width: 1440, height: 1060 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page
    .getByRole('navigation')
    .getByRole('button', { name: /^Bibliothek/ })
    .click();
  await page.screenshot({ path: '.tools/screenshots/library.png', fullPage: true });
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  await page.screenshot({ path: '.tools/screenshots/settings.png', fullPage: true });
  await page.getByRole('button', { name: 'Quickload Startseite' }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: '.tools/screenshots/mobile.png', fullPage: true });
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: '.tools/screenshots/widescreen.png', fullPage: true });
  // Capture the actual client area after reserving desktop chrome/taskbar or display scaling.
  for (const [width, height] of [
    [1920, 984],
    [1536, 768],
    [1280, 624],
  ]) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({
      path: `.tools/screenshots/home-${width}x${height}.png`,
      animations: 'disabled',
    });
  }
  console.log('Saved preview screenshots to .tools/screenshots.');
} finally {
  await browser.close();
}
