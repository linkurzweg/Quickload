# Quickload project conventions

## Purpose and language

Quickload is a local, cross-platform game launcher built with Rust, Tauri 2 and Svelte 5.
Read `README.md`, `docs/ARCHITECTURE.md` and `docs/VALIDATION.md` before changing code.
Record design decisions and checks actually performed; historical results are not current evidence.

**All repository documentation and code comments must be written in English.** This includes
README files, architecture/development/validation notes, agent instructions, Rustdoc and JSDoc.
Localized application strings belong in the translation dictionary; they are not documentation.
User-facing conversations may follow the user's preferred language.

## Structure and implementation

- `crates/quickload-core`: data model, manifest adapters, persistence and launch routing.
- `src-tauri`: restricted IPC bridge, artwork service and native window operations.
- `src/lib`: typed frontend logic; `src/components`: reusable UI components.
- `scripts`: reproducible development tools; `tests`: unit and browser integration tests.
- Use the pinned Node/Rust toolchains and lockfiles. Change dependencies only when justified.
- Document every named function, method, class and public data type with meaningful English
  Rustdoc/JSDoc: purpose, parameters, return value, errors and relevant side effects.
  Document private named helpers too. Avoid comments that merely repeat the name.
- Keep modules small and types explicit. Do not use `any` in production code.
- Vite+ bundles Oxfmt, Oxlint, Vite/Rolldown and Vitest. Keep their configuration in
  `vite.config.ts`; retain `svelte-check` for Svelte templates, runes and accessibility.
- Use pnpm from `packageManager`, `pnpm install --frozen-lockfile`, and only `pnpm-lock.yaml`
  for JavaScript. Update the Vite+ catalog alias and bundled Vitest override together.
  Do not add separate Prettier/Oxfmt/Oxlint/Vitest versions. Retain strict peer checks and
  narrowly allowlisted dependency build scripts.

## Performance, UI and accessibility

- Show cached data first; scan off the UI thread. Never recursively scan an entire drive.
- Bound rendered games to 20 on Home and 60 per library page; load artwork lazily/asynchronously.
- Keep header navigation in the same left position across pages; center branding independently.
- Group canonical cross-provider installation paths without UI filesystem calls; retain provider routes.
- Keep additional launcher discovery bounded and local; never execute uninstall command strings.
- Avoid repeated sorting and quadratic reconciliation. Support performance claims with measurements;
  do not claim superiority over Playnite without the same hardware and dataset.
- Follow tvOS-inspired hierarchy and spacing, neutral graphite/silver surfaces and restrained blue
  accents. Do not introduce a green base theme or serif UI fonts.
- Use edge-to-edge 16:9 game tiles with consistent aspect ratios in TV mode.
  Prefer store capsules over splash screens, icons and panoramic page backgrounds. Preserve complete
  key art when it is used as a hero fallback instead of automatically cropping faces or embedded titles.
  Keep cover geometry independent of source dimensions. Never substitute gameplay screenshots for title art.
  Use role-specific metadata paths and original/high-density images. Near-16:9 covers may use
  at most three percent aspect correction to avoid borders without clipping titles.
  Explicit per-game framing may crop. Show
  local art first and upgrade mismatched sources in the background when a close ratio is available.
  Detail banners fill their width with a single image.
  Desktop Home must leave its first shelf
  visible in a taskbar-reduced client area.
- Draw Xbox, PlayStation and Nintendo glyphs as SVG. Keep displayed labels consistent with
  semantic controller actions, including Nintendo A-confirm/B-cancel.
- Translate UI strings through the shared dictionary. Default to supported system languages,
  allow an explicit language override, update document language and use localized dates.
- Resolve images through the bounded shared queue. Prefer custom/local assets and caches;
  require exact identity checks for external metadata, fixed endpoints and allowlisted HTTPS CDNs.
  Document sources, privacy implications and limits. Never introduce generic HTTP/file IPC.
- Use system fonts and limited glass surfaces; avoid nested full-screen blur chains.
  Animate mainly transforms/opacity. Honor reduced motion and disabled transparency completely.
- Support mouse, keyboard and controller equally. Keep visible rounded focus, padded text actions,
  labelled controls, usable controller dropdowns, dialog focus traps and focus restoration.
- Do not clip focus/lift at scroll edges. Account for the fixed header in focus scrolling.
  Keep the initial hero artwork below the header. Right-stick scrolling must not change focus;
  stop animation loops when idle and isolate dialogs from background scrolling.
- Overlay scrollbars must have no painted track, preserve dragging and remain accessible through
  native scrollbars in forced-colors mode. Hide the cursor only for controller use in fullscreen.
- Check 390x844, 1440x1060 and 1920x1080 layouts and TV mode.

## Safety and data

- Never execute IPC/manifest shell command strings. Validate IDs, protocols and manual paths;
  spawn processes with separate arguments. Leave store files and credentials untouched.
- Do not add telemetry. Surface corrupt libraries instead of silently resetting them.
  Persist atomically and retain favorites/history across scans. Remove only explicitly identified
  infrastructure entries; do not broadly hide legitimate games on provider failures.
- Keep browser examples separate from real native libraries. Do not start actual games in tests.

## Verification and completion

- Use Conventional Commits for all new commits and PR titles, for example
  `feat(library): add a provider` or `fix(input): retain controller focus`.
- Breaking changes require `!` in the subject or a `BREAKING CHANGE:` footer.
- Release tags are the version source of truth. The main release workflow stamps all build
  manifests with the calculated version and publishes only after every platform succeeds.

- Cover behavior with meaningful tests: parser errors, data loss, IPC, artwork, search, pagination,
  language migration, focus, controller dropdowns, shortcuts and mapping consistency.
- `pnpm check` runs Oxfmt/Oxlint including types and Svelte diagnostics; warnings are errors.
- `pnpm verify` / `node scripts/dev.mjs verify` additionally runs frontend tests/build, rustfmt,
  Rust tests and Clippy. Run `node scripts/dev.mjs e2e` separately.
- Render and visually inspect screenshots for UI changes, including settings, missing/offline art,
  accessibility preferences and controller hints. Do not run build mutations alongside browser tests.
- State missing hardware/toolchains and untested platforms honestly. Never claim native/hardware
  validation that was not performed. Include actual checks in `docs/VALIDATION.md`.
- Do not commit generated builds, local libraries, toolchains, profiles or `node_modules`.
