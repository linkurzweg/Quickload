# Local development

## Reference environment

- Node 24.22.1 (`.node-version`), pnpm 12.18.0 (`packageManager`).
- Vite+ 1.5.0 and Svelte adapter 7.3.1; bundled Oxfmt, Oxlint, Rolldown and Vitest.
- Rust 1.99.1, rustfmt and Clippy (`rust-toolchain.toml`).
- Windows: MSVC x64, Windows SDK and WebView2. macOS: Xcode command-line tools.
- Linux: WebKitGTK 4.1 and the packages listed in `.github/workflows/ci.yml`.

Follow the [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for system packages.
All documentation and code comments must be English; application translations are separate.

## Windows without Node or pnpm

WSL and Docker are not required. Internal coding-agent binaries are not automatically available
in a normal Windows terminal. One setup option is the [global Vite+ CLI](https://viteplus.dev/guide):

```powershell
irm https://vite.plus/ps1 | iex
```

Enable Node/package-manager management in the installer, then open a new PowerShell window:

```powershell
cd C:\Projects\Quickload
vp env on
vp install --frozen-lockfile
vp run desktop
```

Vite+ reads `.node-version` and `packageManager`. `vp env doctor` shows the active environment;
`vp run dev` starts the browser preview and `vp run check` includes the Svelte check.
A conventional Node version manager plus the pinned pnpm version works equally well.

For native prerequisites, `scripts/setup-windows.ps1` installs official Microsoft C++ Build Tools
and Rustup through winget. Installers accept their package terms and may request UAC elevation.
After installation, open a new terminal and install the pinned toolchain:

```powershell
rustup toolchain install 1.99.1 --profile minimal --component rustfmt,clippy
```

## Install and start

```sh
pnpm install --frozen-lockfile
pnpm doctor
pnpm desktop
```

Use `pnpm dev` for browser examples at `http://127.0.0.1:1427`. Vite, Tauri and Playwright share this
fixed loopback port. A busy port is an error. Close your ordinary preview before E2E tests;
Playwright does not silently reuse a server. Set `QUICKLOAD_TEST_EXTERNAL_SERVER=1` only when deliberately
managing the correct project test server yourself. Avoid source/build changes while browser tests run,
since hot reload can reset their page state. Never terminate unrelated processes to free the port.

The first native build downloads/compiles Cargo dependencies. Later builds reuse caches. Close an
old debug window before relinking the same Windows executable. Do not stop another user's active instance.

## Commands

| Command                             | Purpose                                                                        |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `pnpm setup`                        | Show prerequisites and install with the frozen lockfile.                       |
| `pnpm doctor`                       | Check Node/pnpm, Rust/Cargo and Windows C++ tools.                             |
| `pnpm dev` / `pnpm desktop`         | Browser preview / native Tauri development with Vite+ hot reload.              |
| `pnpm format` / `pnpm format:check` | Format with Oxfmt / check formatting.                                          |
| `pnpm lint`                         | Oxlint with type-aware rules and type checking; warnings fail.                 |
| `pnpm typecheck`                    | Svelte templates, runes, types and accessibility diagnostics.                  |
| `pnpm check`                        | Vite+ checks followed by Svelte diagnostics.                                   |
| `pnpm test` / `pnpm build`          | Bundled Vitest suite / production frontend build.                              |
| `pnpm verify`                       | Frontend checks/tests/build plus rustfmt, Rust tests and Clippy.               |
| `node scripts/dev.mjs browsers`     | Install the pinned Playwright Chromium.                                        |
| `pnpm test:e2e`                     | Browser integration tests with isolated storage and simulated controllers/IPC. |
| `pnpm desktop:build`                | Native optimized build.                                                        |

The scripts can also be invoked as `node scripts/dev.mjs <command>`. A project-local pnpm bootstrap
may live in `.tools/package-manager`; it is not committed and does not replace normal terminal setup.
`pnpm exec vp check` is Vite+'s built-in check; `pnpm check` also runs the project Svelte diagnostics.
`pnpm exec vp install --frozen-lockfile` delegates to pnpm.

## Configuration and data

`vite.config.ts` centralizes Vite/Vitest/Oxfmt/Oxlint. Svelte formatting is explicitly enabled;
Oxlint checks script blocks while `svelte-check` covers the full templates/runes. Tests import
`vite-plus/test`; there is no separately versioned Vitest dependency. Keep the Vite+ alias, catalog
and bundled Vitest override synchronized. The alias peer exception is deliberately narrow.

`pnpm-lock.yaml` is the only JavaScript lockfile. pnpm 12 may store multiple YAML documents in it;
do not reformat it manually. Only the pinned esbuild dependency build script is allowlisted.
Update `pnpm-workspace.yaml` and the lockfile together. CI uses frozen installations.

The development launcher pins `CARGO_TARGET_DIR` to project `target` and creates
`target/debug/quickload.portable`. Native development data lives in `target/debug/quickload-data/library.json`.
Installed apps retain their OS app-data directory. Browser examples use `localStorage/quickload-preview`.
Windows development uses `.dev-data/webview2` as a separate WebView2 profile. Build/tool/profile/native
folders are excluded from the Vite watcher; Rust has its own watcher. Production CSP/IPC permissions
are not relaxed for previews. Artwork is cached under `artwork` beside the library.

`.tools`, `target`, `dist`, `node_modules`, local libraries, browser profiles and test reports stay outside Git.

## Screenshots and native checks

```sh
pnpm verify
node scripts/dev.mjs browsers
pnpm test:e2e
```

The launcher defaults `PLAYWRIGHT_BROWSERS_PATH` to `.tools/browsers`. For direct Playwright commands,
set the same path during installation and execution:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = "$PWD/.tools/browsers"
pnpm exec playwright install chromium
```

With a preview running, `node scripts/capture-preview.mjs` writes `.tools/screenshots`, including focused
navigation/search and narrow/widescreen views. Keep `PLAYWRIGHT_BROWSERS_PATH` set for this direct script.
Set an explicit browser locale when comparing translated UI screenshots.

`scripts/native-smoke.mjs` and `scripts/artwork-smoke.mjs` require a local debug build with WebView2
remote-debugging port 9223 and `QUICKLOAD_SMOKE_EXE` pointing to a harmless executable fixture. The launch
smoke test also requires `QUICKLOAD_SMOKE_MARKER`; it must never launch an actual game. The artwork test
imports the project icon (or `QUICKLOAD_SMOKE_IMAGE`) and does not launch its fixture. Test entries are
removed afterward. Use isolated portable data when exercising discovery or settings. Close only the
owned test window afterward to release its debugging port.

## Troubleshooting

- Missing/wrong pnpm: provide 12.18.0 and honor `packageManager`; reopen the terminal after setup.
- Lock mismatch: intentionally install/update and review the diff; keep `--frozen-lockfile` in CI.
- Blocked package script: review the exact dependency rather than allowing all install scripts.
- Missing Cargo: reopen the terminal; the launcher adds `~/.cargo/bin` to its own PATH.
- Missing linker/Windows SDK: install the C++ workload with the Windows prerequisite script.
- Locked executable: close your earlier debug instance before relinking it.
- Missing Chromium: install it with the same `PLAYWRIGHT_BROWSERS_PATH` used by tests.
- Sandbox-denied processes/network/sockets: use the environment's normal execution approval flow.

Assess dependency security with an online audit of the current lockfile. Historical npm audit results
in validation notes do not describe the migrated pnpm lockfile.
