import { test as base } from '@playwright/test';
export { expect, type Page, type Locator } from '@playwright/test';

/** Disable physical gamepads in a browser fixture while retaining any explicitly installed test pad.
 * Configurability and the own-property guard make initialization order independent of scenario mocks.
 */
export function isolateGamepadInput() {
  if (!Object.prototype.hasOwnProperty.call(navigator, 'getGamepads'))
    Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [] });
}

/** Isolate each test page from connected hardware; individual scenarios explicitly install simulated pads. */
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.addInitScript(isolateGamepadInput);
    await use(page);
  },
});
