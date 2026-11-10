import { test, expect } from './fixtures';

test('clear search restores the shelf and returns focus to the input', async ({ page }) => {
  await page.goto('/');
  const search = page.getByRole('textbox', { name: 'Spiele suchen' });
  await search.fill('Cyberpunk');
  await expect(page.locator('.game-card')).toHaveCount(1);
  await page.getByRole('button', { name: 'Suche leeren' }).click();
  await expect(search).toHaveValue('');
  await expect(search).toBeFocused();
  await expect(page.locator('.game-card')).toHaveCount(8);
  await expect(page.getByRole('button', { name: 'Suche leeren' })).toBeDisabled();
});

test('Home store filters retain the hero and feature the first matching game', async ({ page }) => {
  await page.goto('/');
  const heroHeight = (await page.locator('.hero').boundingBox())!.height;
  await page.locator('.store-filters').getByRole('button', { name: 'GOG', exact: true }).click();
  const shelf = page.locator('.game-shelf');
  await expect(shelf.locator('.game-card')).toHaveCount(2);
  const firstTitle = await shelf.locator('.card-title').first().innerText();
  await expect(page.locator('.hero h1')).toHaveText(firstTitle);
  await expect(page.locator('.hero-art')).toBeVisible();
  expect((await page.locator('.hero').boundingBox())!.height).toBe(heroHeight);
});

test('controller mode suppresses native titles and pointer input restores them', async ({
  page,
}) => {
  await page.goto('/');
  const settings = page.getByRole('button', { name: 'Einstellungen', exact: true });
  await expect(settings).toHaveAttribute('title', 'Einstellungen');
  await page.evaluate(() => document.body.classList.add('controller-input'));
  await expect(page.locator('[title]')).toHaveCount(0);
  await page.evaluate(() => document.body.classList.remove('controller-input'));
  await expect(settings).toHaveAttribute('title', 'Einstellungen');
});

test('hero reuse, stable header actions and finite page transitions survive navigation', async ({
  page,
}) => {
  await page.route('**/*', (route) =>
    route.request().resourceType() === 'image'
      ? route.fulfill({ path: 'tests/fixtures/landscape.png', contentType: 'image/png' })
      : route.continue(),
  );
  await page.goto('/');
  await expect(page.locator('.hero-art .artwork')).toHaveClass(/artwork-loaded/);
  const image = await page.locator('.hero-art .artwork-image').getAttribute('src');
  const before = (await page.locator('.header-actions').boundingBox())!;
  await page.getByRole('button', { name: 'Einstellungen', exact: true }).click();
  const after = (await page.locator('.header-actions').boundingBox())!;
  expect(Math.abs(before.x - after.x)).toBeLessThan(1);
  expect(Math.abs(before.y - after.y)).toBeLessThan(1);
  await page.getByRole('button', { name: 'Für dich', exact: true }).click();
  await expect(page.locator('.hero-art .artwork-image')).toHaveAttribute('src', image!);
  await expect(page.locator('.hero-art .artwork')).toHaveClass(/artwork-loaded/);
  await expect(page.locator('.hero-art .artwork-placeholder')).toBeHidden();
  await expect(page.locator('.hero-art')).toHaveCSS('bottom', '-72px');
  await expect
    .poll(() => page.locator('main').evaluate((element) => element.getAnimations().length))
    .toBe(0);
});
