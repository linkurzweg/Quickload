import { defineConfig, lazyPlugins } from 'vite-plus';
import { svelte } from '@sveltejs/vite-plugin-svelte';
export default defineConfig({
  lint: {
    jsPlugins: [{ name: 'vite-plus', specifier: 'vite-plus/oxlint-plugin' }],
    rules: { 'vite-plus/prefer-vite-plus-imports': 'error' },
    options: { typeAware: true, typeCheck: true },
    ignorePatterns: [
      '.tools/**',
      '.dev-data/**',
      'target/**',
      'dist/**',
      'src-tauri/gen/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  fmt: {
    singleQuote: true,
    printWidth: 100,
    trailingComma: 'all',
    sortPackageJson: false,
    svelte: {},
    ignorePatterns: [
      'node_modules',
      'dist',
      'target',
      'src-tauri/gen',
      'test-results',
      'pnpm-lock.yaml',
      'src-tauri/icons',
      'public/providers/LICENSE.md',
      '.tools',
      '.dev-data',
      'playwright-report',
    ],
  },
  plugins: lazyPlugins(() => [svelte()]),
  test: { include: ['tests/*.test.ts'], environment: 'node' },
  clearScreen: false,
  server: {
    port: 1427,
    strictPort: true,
    // Rust has its own watcher. Avoid watching locked EXEs and large toolchain caches.
    watch: {
      ignored: [
        '**/target/**',
        '**/.tools/**',
        '**/.dev-data/**',
        '**/src-tauri/**',
        '**/crates/**',
        '**/docs/**',
      ],
    },
  },
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  build: { target: 'es2022' },
});
