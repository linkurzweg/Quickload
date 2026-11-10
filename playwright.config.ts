import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  use: {
    locale: 'de-DE',
    baseURL: process.env.QUICKLOAD_PREVIEW_URL ?? 'http://127.0.0.1:1427',
    viewport: { width: 1440, height: 1060 },
    trace: 'retain-on-failure',
  },
  webServer: process.env.QUICKLOAD_TEST_EXTERNAL_SERVER
    ? undefined
    : {
        command: 'node node_modules/vite-plus/bin/vp dev --host 127.0.0.1',
        url: 'http://127.0.0.1:1427',
        reuseExistingServer: false,
      },
  reporter: 'list',
});
