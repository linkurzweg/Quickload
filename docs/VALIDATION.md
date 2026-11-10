# Validation record — 10 November 2026

## Update relaunch and provider icon color

- `pnpm verify` passed on Windows. The provider and updater scenarios use mocked native IPC
  in Playwright and verify foreground-color rendering and the restart request through the
  close guard. Visually checked both settings sections at 390x844, 1440x1060, and
  1920x1080 in TV mode.
- Actual silent installation and native relaunch from the updated build were not exercised.

## Provider SVG folder import

- `pnpm verify` passed on Windows. The native test covers filename ranking, aliases,
  invalid SVG fallback, skipping subfolders, preserving existing icons, and repeat imports.
- All 58 Playwright tests passed against the production preview. The provider scenario mocks
  native IPC and covers directory selection, merging saved icons, and persistence on reload.
  Visually checked the settings at 390x844, 1440x1060, and 1920x1080 in TV mode.
- The native file picker and macOS/Linux execution were not exercised.

## Public release fallback — 10 November 2026

- The v0.2.1 release workflow builds DEB and RPM for Linux. The AppImage audit used a
  filename-based package mapping and did not establish an exact source set for the final
  signed binary. The workflow omits AppImage until that verification is available.
- `pnpm check` and all 40 unit tests passed on Windows. The updater manifest tests cover
  releases with and without AppImage and reject missing mandatory assets and signatures.
  The local release planner selected `v0.2.1`.

## Text-only provider labels and AppImage follow-up — 10 November 2026

- `pnpm check`, the frontend production build, and all 58 Playwright tests passed on Windows.
  The provider scenarios cover text-only filters and settings labels, SVG import, persistence,
  removal, and focus restoration. Visually checked provider settings at 390x844, 1440x1060,
  and 1920x1080 in TV mode.
- The second private Ubuntu 24.04 audit produced an unsigned v0.2.1 AppImage. Its SHA-256
  matched the runner manifest. The 96 candidate Ubuntu package versions were unchanged.
  A separate resource inspection identified the GNOME settings schemas. The source archive
  and patch for `gsettings-desktop-schemas` 46.1-0ubuntu1 matched their source descriptor.
- The embedded runtime matched the official x86-64 binary from AppImage/type2-runtime commit
  `fedfad51acc2860b2916a1eef32ba4a500ff31ef` outside the 16-byte AppImage digest field.
  The wrapped launcher matched the original AppImageKit continuous asset and the Tauri mirror
  by SHA-256. The GTK hook matches the template bundled by Tauri CLI 2.12.4.
- The audit materials contain the Ubuntu source packages, shared license texts, and the runtime
  and launcher source candidates for the unsigned audit build. The release workflow still needs
  to collect and verify these materials against the final signed AppImage and deliver them
  alongside the download. Linux GUI startup and the production update feed were not tested.

## Public v0.2.1 release preparation — 10 November 2026

- The public CI run [42795870937](https://github.com/linkurzweg/Quickload/actions/runs/42795870937)
  passed frontend and desktop checks on Windows, macOS and Linux.
- A private Ubuntu 24.04 audit built and extracted an unsigned x86-64 v0.2.1 AppImage. Matching
  installed package ownership by filename associated 216 packaged files with 96 Ubuntu source
  package versions. The other files considered were Quickload, two launcher files and three
  generated caches. This was a candidate mapping and did not compare ELF build IDs.
- The current Ubuntu source index provided checksums for 312 source files across 95 packages.
  All 312 downloaded files matched the indexed size and checksum. The missing PCRE2 version
  (`10.42-4ubuntu2.1`) was recovered from the official Ubuntu snapshot at
  `20261101T120000Z`. Its source archive and packaging patch matched the SHA-256 checksums and
  sizes in the snapshot's source descriptor.
- The AppImage contained 111 package copyright files. Of those, 81 referenced
  `/usr/share/common-licenses/`, which was absent from the package. The embedded AppImage
  runtime, launcher provenance, and notice and source delivery with the signed build remain
  open. The public release workflow was kept gated.

## Custom provider icons — 10 November 2026

- `pnpm verify` passed on Windows with 39 frontend tests and 54 Rust tests. The native validation
  test covered a Simple Icons style SVG, malformed and unsupported XML, and the 64 KiB limit.
- All 58 Playwright tests passed against the built frontend. The new scenario used mocked native
  IPC to exercise selection, reload, removal, neutral fallback and focus restoration. The provider
  settings were visually checked at 390x844, 1440x1060 and 1920x1080 in TV mode.
- The operating system's file chooser and native macOS/Linux behavior were not exercised.

## Private GitHub publication audit

- Reviewed the four published releases from v0.1.0 through v0.2.0. Each tagged source tree
  contains 27 historical screenshots. The v0.2.0 portable ZIP matched its release checksum and
  contains the executable, portable marker and WebView2 loader DLL. It predates the new notice
  packaging. The v0.2.0 release has neither an updater manifest nor signature assets.
- Scanned all 194 available log files from 17 workflow attempts and the four release notes with
  redacted Gitleaks output. Additional log checks for GitHub token patterns, PEM and Tauri
  private-key markers, and non-runner home paths returned no matches. These checks cover the
  available text, not the contents of every historical binary or CI artifact.
- Verified the v0.2.0 AppImage checksum and listed its SquashFS without launching it. The
  listing contains 200 shared-library paths including aliases, with GTK and WebKitGTK among
  them, and 111 Ubuntu package copyright files. This inventory does not establish corresponding
  source availability or verify a newly built AppImage.

## Public distribution preparation

- `pnpm verify` passed on Windows with 39 frontend and 53 Rust tests. All 57 Playwright tests
  passed against the built frontend. Coverage includes named provider filters and packaged
  artwork resolution with network access disabled.
- Visually checked the neutral filters and artwork placeholders at 390x844, 1440x1060 and
  1920x1080 in TV mode using a fictional library, reduced motion and disabled transparency.
- Two isolated Windows NSIS test builds used a disposable signing key, a separate application ID
  and a loopback-only feed. The running 0.1.0 build automatically discovered and staged 0.1.1.
  A second run verified installation on normal quit and showed 0.1.1 after relaunch. The test
  installation was removed. The test feed and its HTTP exception existed only in the test copy.
- Generated Rust and frontend license reports from the pinned dependencies. The frontend report
  used the modules emitted by a production build and included the Vite runtime helpers. The x64
  static WebView2 loader matched the Microsoft SDK package by SHA-256.
- Verified all six notice files in an installed NSIS build, an administratively extracted MSI and
  an extracted portable ZIP. The portable executable reached its main window without a loader DLL.
- Scanned eight reachable local commits with Gitleaks and additional key patterns, including the
  Tauri private-key prefix. The sole Gitleaks finding was the default keyboard shortcut in a Rust
  test. Private GitHub Actions logs and existing release assets were outside the local scan.
- The hosted production update feed, Linux and macOS native packages, and third-party system
  libraries added by AppImage tooling were not validated locally.

## Windows portable ZIP and signed updater

- `pnpm verify` passed on Windows with 39 frontend tests and 53 Rust tests. Formatting, linting,
  Svelte diagnostics, the frontend build and Clippy passed. Cargo copied incremental files when
  hard links were unavailable.
- All 57 Playwright tests passed against the production preview on an isolated local port. The
  updater scenario used mocked native IPC. It verified manual checking, staging and saving the
  automatic-update preference. The update card screenshots were visually checked at 390x844,
  1440x1060 and 1920x1080, with TV mode at 1920x1080.
- A Windows debug build with embedded frontend assets started from a freshly extracted ZIP with
  the x64 WebView2 loader and portable marker. The smoke check verified the main window and the
  executable-relative artwork directory with isolated library and WebView data.
- The release feed unit tests cover bundle routing, shared universal macOS assets and rejection of
  incomplete signing inputs. A signed GitHub release, a native update installation and native
  macOS/Linux packaging were not exercised locally. Startup and idle performance were not benchmarked.

## Startup foreground focus

- Rust formatting, all 53 workspace tests, and workspace Clippy with warnings denied passed on
  Windows. Cargo fell back to copying incremental cache files when hard links were unavailable.
- A standalone Windows debug build with embedded frontend assets reached the foreground in both
  windowed and startup fullscreen configurations. The smoke check compared the isolated portable
  instance's main window handle with Win32 `GetForegroundWindow`.
- The smoke check launched the executable directly. Sign-in with an OS login entry and native
  macOS/Linux behavior were not exercised.

## Packaged login startup

- Login startup uses Tauri's build-generated `dev` configuration instead of checking the app's
  Cargo feature. The capability query and the settings save use the same check.
- Windows reads and writes login registration through the same backend. Local Clippy and Rust
  workspace tests passed. Actual login after installing the updated bundle remains to be verified.

## Linux and macOS release build fix

- The release run passed the browser suite and Windows packaging. Linux and macOS stopped at
  Clippy because Steam discovery declared a mutable binding for Windows registry results on all
  targets. Only the Windows target now compiles that branch.
- Local Windows formatting, workspace Clippy with warnings denied, and all 53 Rust tests passed.

## Conventional Commits and automatic releases

- Added main-only release planning, three-platform bundle builds, checksums and publication after
  every build succeeds. PR titles are checked against Conventional Commit syntax.
- Local full verification passed with 37 frontend and 53 Rust tests. All 56 browser scenarios passed.
  Version tests cover breaking/minor/patch precedence and updating all manifest/lockfile versions.
- The initial read-only release plan selects v0.1.0. Hosted installer builds and release publication
  have not been verified locally. Authenticated GitHub status inspection was blocked by approval
  review; Windows/macOS signing credentials are not configured.

## Configurable global focus shortcut

- Removed the unconditional Ctrl+Alt+Q registration. Existing and fresh profiles default to disabled.
  Settings expose the enable switch and editable combination, suggesting Ctrl+Shift+F12.
- Native validation requires two modifiers. Registration conflicts preserve the previous binding,
  and persistence failures restore it. Three Rust tests cover defaults, conflicts and rollback.
- Full verification passed with 34 frontend and 53 Rust tests. All 56 browser scenarios passed,
  including enabling, changing, persisting and disabling the shortcut. OS-wide binding availability
  depends on the machine; startup registration failures are logged.

## Subtle scroll indicators and visible clear controls

- Overlay thumbs paint a 4 px translucent indicator inside a 12 px pointer target. Horizontal
  transforms ease over 160 ms, with immediate dragging and reduced-motion overrides.
- The search clear button remains visible when empty (disabled). The screen keyboard now exposes
  Clear input for its uncommitted draft and restores key focus after clearing.
- All 55 browser, 34 frontend and 50 Rust tests passed, with build/types/lint/Clippy passing.
  Browser coverage includes controller draft clearing, restored search results and scrollbar dragging.
  Corrected an older browser test's hardcoded server URL and its positional close-button selector.
  Inspected the narrow 390x844 keyboard capture.

## Search clearing, Battle.net identity and global focus shortcut

- Search clearing resets exact/fuzzy input, restores input focus and removes the button when empty.
  All 55 browser scenarios passed, plus 34 frontend and 50 Rust tests, build, type/lint and Clippy.
- Read the installed Battle.net registry entry and product.db, confirming Diablo IV uses fenris.
  A temporary read-only native discovery probe returned battlenet:fen / Diablo IV from both sources.
  Existing reconciliation merges those equal IDs. No game was launched or library file modified.
- Ctrl+Alt+Q is registered by the native global-shortcut plugin. Compilation passed, but native
  foreground activation and physical Guide-button mapping were not exercised. Direct background
  controller input remains unimplemented; Steam Input or another mapper must emit the shortcut.

## Trigger paging and simplified tiles

- L2/R2 now select previous/next result pages, and L1/R1 retain main-page navigation. Controller
  pagination displays LT/RT, L2/R2 or ZL/ZR glyphs according to the selected family.
- Removed the subtitle beneath game tiles and increased hero play-button transparency and highlights.
  Inspected the updated 1536x768 screenshot.
- All 54 browser, 34 frontend and 50 Rust tests passed, including trigger paging, bumper navigation,
  pagination glyphs, keyboard overlays and compact Home layouts. Build, types, lint and Clippy passed.

## Shelf continuity and ready audio

- Home page changes use preventScroll focus. Shelf reveal only adjusts horizontal position.
  A new browser scenario verifies unchanged document scroll, right-edge continuation and R1/R2 paging.
- Audio stays running between cues while visible, and suspends on hide or disable. The browser test
  checks readiness after a 1.6-second pause and playback afterward. Fullscreen cues use steady pitches.
- The hero play button uses a bright glass surface with an opaque fallback. Cancel is translated
  as Abbrechen in German, including the exit dialog.
- All 54 browser, 34 frontend and 50 Rust tests passed. Native audio-device reliability and
  subjective sound quality still require listening on the target hardware.

## Complete Home browsing, playback recovery and fullscreen feedback

- Home pagination reaches all 126 fixture games with at most 20 cards rendered. Library pagination
  still renders at most 60 cards. Fullscreen hides library status and the View all shortcut.
- Added playback recovery coverage after idle suspension. Audio transitions are serialized and each
  start replaces the idle timer. Fullscreen uses ascending/descending cues and a reduced-motion-aware
  180 ms content animation. Native OS window geometry itself is controlled by the window manager.
- Hero crossfades retain the decoded background until the 280 ms incoming fade completes.
- Steam manifest coverage includes LastPlayed. Reconciliation preserves the newer external/local
  launch timestamp. External history for other launchers is not imported in this implementation.
- All 53 browser, 34 frontend and 50 Rust tests passed, along with type/lint/build and Clippy checks.
  Inspected the 1536x768 Home capture. Physical audio and native fullscreen animation were not tested.

## Stable Home geometry and softer audio revision

- Home hero grid height now depends on viewport height, with a fixed compact row. The filter
  regression checks equal hero heights before and after selecting GOG. All 53 browser tests passed.
- Removed the reserved title slot, widened line spacing and added descender clearance. Inspected
  a 1440x1060 capture with Dragon Age: Inquisition. Decorative Home copy is hidden to simplify hierarchy.
- Replaced pitch glides with steady tones and 20 damped reflections over approximately 240 ms.
  Lowered duplicate-event suppression to 15 ms and allow deliberate tile focus after confirmation.
  Frontend tests (34), Rust tests (50), build, types and lint passed. Subjective listening and physical
  controller audio latency remain unverified.

## Home filters, title alignment and sound

- Home keeps its shelf and hero when a store filter has matches and features the first result.
  The title aligns to the bottom of its two-line slot with more room for descenders.
- Sound buffers use smooth tonal envelopes and short, quiet reflections. Tests check bounded
  peaks, soft endpoints, a reflection tail and controller playback of the tile cue.
- Production preview passed 53 browser scenarios. All 34 frontend and 50 Rust tests passed.
  Inspected the narrow Home capture. Subjective sound quality was not evaluated by listening.

## Stable title slots and higher-resolution artwork

- Hero and tile titles reserve two lines. Compact Home spacing keeps the first shelf and controls
  within the tested taskbar-reduced client areas. Inspected the 1920x984 production preview capture.
- Frontend and Rust verification passed with 34 and 50 tests respectively. The final production
  preview passed all 52 browser scenarios, including artwork fallback, hero crossfade and Home layout.
- Detail warmup is serial and shares the existing request limits. Physical 4K display quality and
  warmup performance on a large native library were not measured.

## Page transitions, hero continuity and controller tooltips

- Full verification passed: 34 frontend tests, 50 Rust tests, production build, formatting, types,
  lint and Clippy. All 52 browser scenarios passed against an isolated production preview on port 1430.
- Added regression checks for native title suppression/restoration, reuse of the loaded hero on
  return, hidden hero placeholders, stable header action positions and completed page animations.
  The existing narrow-window branding test caught asymmetric grid sizing after action padding was
  normalized; symmetric minimum-zero tracks fixed it before the successful complete rerun.
- Inspected Home at 1440x1060, 390x844 and 1920x1080, plus Settings. The extended gradient blends
  behind the existing content without moving the shelf. Some preview tile captures still show
  asynchronous loading placeholders; these screenshots do not establish remote artwork availability.
- Controller tooltip checks simulate the input-mode class in Chromium. Native WebView tooltip
  dismissal and physical controller hardware were not independently tested in this iteration.
- Set `QUICKLOAD_PREVIEW_URL` alongside `QUICKLOAD_TEST_EXTERNAL_SERVER=1` to test an isolated
  preview without stopping an existing development instance.

## Feedback: audible cues, Avatar identity and top-aligned heroes

- Increased tonal cue amplitude fourfold and the short tile click twentyfold, preserving duration,
  envelopes, cached buffers and idle suspension. Waveform tests bound peaks below clipping; perceived
  loudness relative to OS sounds still depends on the system mixer and speakers.
- Correct the exact Ubisoft 4740 / AFOP alias to Avatar: Frontiers of Pandora at cache load and scan
  reconciliation, preserving favorites and launch identity. Title-aware artwork matching retries the
  corrected name instead of reusing the negative AFOP match. Unknown IDs are unchanged.
- Home hero backgrounds now default to center/top; explicit per-game framing retains precedence.
- Full verification passed: 34 frontend tests, 50 Rust tests, production build, types, lint and Clippy.
  Live artwork downloads and acoustic listening were not verified in this iteration.
- All 50 browser scenarios passed against production preview. The development-server run had three
  transient failures during navigation; production verification passed. Refreshed and inspected the
  Home screenshot with top-aligned hero artwork.

## Current iteration: Quickload, centered branding, controller exit and more launchers

- Renamed the checkout to `C:\Projects\Quickload`, crate/package/binary names, application identifier
  (`app.quickload.launcher`), preview storage, portable marker, development data folder, IDE references
  and documentation. Reinstalled pnpm links in the new folder with the frozen lockfile. The icon is unchanged.
  Active source/configuration files contain no previous product names; old runtime data is not imported.
- Navigation keeps its left position while non-hero branding is centered independently. Inspected
  refreshed Home, Library, Settings and 390-pixel screenshots and the native fullscreen exit dialog.
  Browser checks cover header containment at 390/960/1440/1920 pixels and existing TV layouts.
- Added a quieter 18 ms tile click without changing other cues, audio dependencies or idle behavior.
  Tests check waveform bounds and actual scheduling of the tile cue after controller navigation.
- Controller-accessible Power opens a focus-trapped exit confirmation. Cancel restores focus;
  confirmation flushes settings, and failed writes keep the app open. An isolated Windows native
  profile verified Quickload branding, fullscreen startup, simulated controller cancellation and exit,
  and persisted preferences. This caught and fixed the Tauri destroy permission required after the
  close guard approves closure. No actual games or OS login registration were changed.
- Added bounded Windows readers for Ubisoft registrations, Battle.net uninstall/product.db records,
  and Rockstar registrations with executable evidence. Parser tests cover corrupt/truncated/oversized
  metadata, unknown infrastructure/beta IDs, missing files, safe launch arguments and client handoff status.
- The read-only local scan found **66 installation records, zero warnings, 2,960 ms** in one run.
  The additional provider readers alone found **seven games in 10.09 ms**, with zero warnings:
  five Ubisoft and two Rockstar records. Battle.net was validated with fixtures, not a local installation.
  These warm observations are not controlled cold-start or frame-time benchmarks.
- The real 66-record snapshot groups into **65 cards in 1.06 ms** in one Node run, retaining both
  Epic/Rockstar routes for Red Dead Redemption 2. Regression tests also cover different display names
  sharing a Windows path, drive/UNC aliases, source filters, Unix case sensitivity, distinct editions
  and ambiguous folders shared by multiple games from the same provider.
- Verification: **34 frontend tests, 49 Rust tests and 50 browser scenarios** passed, together with
  formatting, type-aware lint, Svelte diagnostics, production build, rustfmt and Clippy. A standalone
  Windows custom-protocol build was also compiled and exercised with the isolated profile.
- Physical controllers, acoustic listening, actual provider game launches, account-owned uninstalled
  games, cold Battle.net startup and native macOS/Linux behavior remain unverified. These three new
  provider readers currently support Windows only. Unknown products require manual entries.

## Previous iteration: left navigation, automatic preferences, sounds and startup

- Moved desktop navigation to the left and retained the responsive second row at narrow widths.
  Refreshed and inspected Home, Settings and mobile screenshots, including the branded glass header.
- Preferences apply immediately with serialized/coalesced persistence, visible error/retry feedback
  and reset-to-defaults behavior that preserves personal game metadata. Native close flushes pending
  changes. Tests cover delayed writes, failure/retry, migration, reset and startup flags.
- Synthesized navigation/confirmation/back cues reuse a single audio context. Browser instrumentation
  verifies playback, idle suspension and persisted mute behavior; waveform tests check duration,
  amplitude and soft endpoints. There are no downloaded sound assets or added audio dependencies.
- Added the official Tauri autostart plugin, default-off login/fullscreen preferences and OS-state
  synchronization. Unit tests inject registration/storage failures and rollback without changing the OS.
  Windows login executable paths are quoted, including paths under Program Files; construction tests
  do not write registration. Development builds cannot enable login registration.
  A real login/reboot has not been tested.
- A standalone Windows test build used an isolated empty portable profile with scanning/artwork off.
  Confirmed native startup fullscreen, audio scheduling after simulated controller navigation, sound
  preference persistence, and a pending path edit saved before native close. The actual login entry
  was unchanged. The WebView reported prior user activation, so this is not proof of autoplay behavior
  in a gesture-locked context. Physical controllers and acoustic listening were not validated.
- Native macOS/Linux startup, real login activation and OS-specific policy restrictions remain untested.
- Final verification passed: **32 frontend unit tests, 44 Rust tests and 45 browser scenarios**,
  formatting, type-aware lint, Svelte diagnostics, production build, rustfmt and Clippy.
  Browser scenarios ran against a separate local production preview after the build completed.

## Previous iteration: controls, provider marks, motion and local volumes

- Header hints now fit inside their buttons, including TV mode. Provider filters use locally bundled
  SVG marks. Keyboard character keys share explicitly centered line boxes in lower/upper/symbol modes.
  Short surface/menu/icon animations honor both app and system reduced-motion preferences.
- Added bounded mounted-volume probes, canonical Steam/GOG deduplication and localized duration units
  in the scan toast and status. Windows fixed/removable volumes include folder mount points. Network
  and optical drives are excluded. Automatic probes do not traverse child symlinks/reparse points.
- The real read-only Windows scan returned **59 games, zero warnings, 11,066 ms**. It did not save the
  library or launch any game. A separate warm probe enumerated **five volumes in 0.21 ms** and checked
  their conventional/shallow folders in **9.22 ms** (four Steam, one GOG and one Epic root). This warm
  sample does not establish cold-drive latency or a performance comparison with another launcher.
- Browser checks cover logos/filtering, both duration surfaces, hint containment and keyboard label
  alignment at 390x844, 1440x1060 and 1920x1080, TV mode, finite animations and reduced motion.
  Inspected Home, Library, Settings, TV and narrow/desktop keyboard screenshots.
- Final verification passed: **27 frontend unit tests, 39 Rust tests and 40 browser scenarios**,
  formatting, type-aware lint, Svelte diagnostics, production build, rustfmt and Clippy.
  Browser tests used a separate local production preview. No animation dependency was added.
- Native macOS/Linux enumeration, physical controllers, unmounted/encrypted/offline media, and GPU
  frame-time measurements remain unverified. Unusual deep library folders still require configured roots.

## Previous iteration: Quickload application identifier

- Changed the installed application identifier to `app.quickload.launcher` so installed builds use a
  separate profile. Portable and development profiles still use executable-relative storage.
- `cargo test -p quickload --lib --locked` passed all 12 tests. No installer or cold-start benchmark ran.

## Previous iteration: Quickload branding and contextual header

- Renamed the product, Rust workspace packages, build artifacts, scripts and documentation.
  The installed application identifier and legacy portable marker remain compatible.
- Regenerated platform icons from the controller and play glyph in `public/icon.svg`.
- Restored the branded glass header for Library, Favorites, Settings and views without a hero.
  Home with artwork retains floating navigation. Browser coverage includes the legacy preview key.
- Verification passed with 25 frontend unit tests, 35 Rust tests and 37 browser scenarios.
  Inspected the generated icon, desktop Library and narrow Home screenshots. Installed-package
  upgrades and native window icon presentation were not tested.

## Previous iteration: composed heroes and independent detail quality

- Native Windows checks used an isolated three-game profile with games marked uninstalled.
  Fallout 4, Miles Morales and Elden Ring use their official 616x353 title capsules, with no title
  cropping. Steam metadata for these examples did not advertise a 2x main capsule.
- Detail images decoded at 3840x1240 for Elden Ring and Miles Morales, and 1920x620 for Fallout 4.
  These are official library hero assets, not gameplay screenshot substitutes for covers.
- Visually inspected native tiles, the complete Fallout hero and the Elden Ring detail banner.
  Browser screenshots cover 390x844, 1440x1060 and 1920x1080, including placeholder and loaded art.
- Home artwork uses containment beside the title on desktop and above it on narrow windows.
  No added image layers, blur effects, animation loops or increased request concurrency.
- Full verification passed (25 frontend and 35 Rust tests, build, formatting, types and Clippy).
  All 35 browser scenarios passed, including the new hero composition regression. No comparative
  frame-time benchmark or physical controller check was performed. No actual games were launched.

## Previous iteration: role-aware high-resolution title artwork

- Removed the unsuccessful screenshot fallback. Steam store-browse assets now supply each main
  capsule's own hash and 2x filename. GOG resolves the original exact-product title artwork.
- An isolated Windows WebView profile checked only the four user-named examples, with all entries
  marked uninstalled. No actual games were launched and the user's library was not modified.
- Visually inspected all four tiles and the Indiana Jones, Witcher and Tony Hawk detail banners.
  Embedded titles were visible, tiles had no painted borders and banners filled their width.
- Measured decoded dimensions in tiles and details: Alan Wake 2 2560x1440, Indiana Jones 1232x706,
  Witcher 3 1600x740, Tony Hawk 3+4 1232x706. Sources were Epic, Steam, GOG and Steam respectively.
- 25 frontend unit tests and 35 Rust tests passed; formatting, type-aware lint, Svelte diagnostics,
  production frontend build and Clippy passed. All 34 browser scenarios passed against an isolated
  production preview after the previously used dev server became unavailable.
- Tests cover distinct role hashes, wrong-app rejection, path traversal, resolution thresholds,
  local-first loading, full-bleed geometry and prioritized dialog requests within the three-job limit.
- No comparative performance benchmark or full-library quality audit was performed. SteamGridDB
  authentication and a candidate-selection interface remain unimplemented.

## Previous iteration: independent tile and banner fit

- Tile artwork uses proportional containment by default. A saved crop remains an explicit
  override. The detail image covers the entire banner using a single image layer.
- Checked detail banners and tiles at desktop and narrow widths. Browser coverage includes
  wide image sources, the full-width banner and the delayed local-to-online cover swap.
- Verified that reusing a resolved panorama triggers no new request. Lazy artwork shares
  one visibility observer. No comparative frame-time benchmark was performed.
- **24 frontend unit tests**, **33 Rust tests** and **34 browser scenarios** passed.

## Previous iteration: local-first cover replacement

- Tiles again use a single sharp 16:9 crop and the original single-line captions. The detail
  banner retains its separate full-width artwork treatment. Preview captures were inspected.
- The browser test delayed both the online lookup and the downloaded image. The local cover
  stayed visible, the detail dialog could open and close, and the previous layer was released
  after the replacement loaded and faded in.
- Tests cover independent disk and network queues, close-ratio acceptance, hashed Steam variants,
  fallback preservation and custom-cover precedence. **23 frontend unit tests**, **33 Rust tests**
  and **34 browser scenarios** passed. The delayed network scenario used fixtures.

## Previous iteration: complete cover artwork and responsive detail banners

- Browser coverage checks 16:9 tile frames with exact and wider source images, full cover
  composition, wrapped long titles and full-width detail banners at 390 and 1440 pixels.
- Visually inspected the desktop shelf and detail banners with actual preview artwork.
- **34 browser scenarios**, **22 frontend unit tests** and **33 Rust tests** passed.

## Previous iteration: launch diagnostics, grouping and artwork framing

- An isolated native Windows build received a Play action from its focused detail button and
  started a harmless executable with a GOG-style target in the configured working directory.
  The dialog showed a detected PID. A second executable invocation deliberately exited with
  code 37. The dialog showed the error and the failed attempt did not increment history.
- Rust coverage checks direct Steam command routing, fresh matching Steam process records and
  early process failure. Actual Steam and GOG games were not launched in verification.
- Browser coverage checks controller sort selection, initial Play focus and glyph contrast,
  group preference persistence, separate edition cards and independent cover and hero framing.
  The desktop sort menu and desktop/narrow framing editor were visually inspected.
- Full verification passed with **22 frontend unit tests**, **33 Rust tests** and **34 browser
  scenarios**. The browser suite used the local production preview.

## Previous iteration: direct Steam dispatch and keyboard glass

- Verified the installed Steam executable path in Valve's Windows registry records. A Windows
  fixture checks executable selection, working directory and literal `-applaunch` arguments,
  including a path with spaces. No real Steam game was started during verification.
- Inspected desktop and 390x844 keyboard previews. Browser coverage verifies the glass toggle,
  reduced motion, focus restoration during the exit animation and eventual panel removal.
- Full verification passed with **21 frontend unit tests**, **31 Rust tests** and **32 browser
  scenarios**. Browser tests used the existing Quickload development server.

## Previous iteration: Windows store and GOG launch routing

- A read-only Windows association query confirmed the installed Steam and Epic handlers.
  A native test verified that an unregistered protocol fails before dispatch. A harmless
  executable fixture ran in its configured working directory and wrote a test marker.
- A read-only check of the existing library validated 31 Steam and two Epic launch URIs.
  Cached GOG wrapper entries resolved to `Cyberpunk2077.exe` and `witcher3.exe` using their
  installed manifests. Tests also checked cached and newly scanned GOG entries, working
  directory confinement and legacy Heroic URI acceptance.
- Full verification passed with **21 frontend unit tests** and **30 Rust tests**. All **31 browser
  tests** passed against the production preview after the dev server returned stale optimized
  modules to two scenarios.
  Automated verification used no real game starts. Store authentication, game startup
  and non-Windows dispatch still require validation on those systems.

## Previous iteration: full-bleed tiles and controller keyboard

- Mixed-ratio artwork fixtures verify the same 16:9 geometry in Home shelves, Library grids
  and TV mode. One sharp layer fills each tile. A centered crop can remove source edges, and
  the detail panel shows the complete image.
- The simulated DualSense scenario checks the search shortcut, directional key selection,
  deletion, typo-tolerant suggestions, query submission, cancellation and nested form focus.
  Desktop and 390x844 keyboard screenshots were visually checked.
- The keyboard is split into its own production chunk. In Node on this machine, building an
  index of 10,000 synthetic titles took about 8 ms. Over 100 repeated typo queries, the ranking
  median was 0.82 ms and the 95th percentile was 1.47 ms. These measurements exclude the 45 ms
  debounce, rendering and input latency.
- Full verification passed with **21 frontend unit tests** and **26 Rust tests**. **31 Playwright
  scenarios** passed against the production preview. The initial dev-server run had a cold Vite
  dependency optimization race that returned HTTP 504 for stale module URLs. The native WebView
  and physical controller hardware were outside this iteration's validation.

## Previous iteration: filled 16:9 tiles and height-aware Home

- Cover artwork is positioned independently of its 16:9 frame. Mismatched source ratios use a dim,
  blurred copy of the same image to fill the surface while retaining the complete sharp foreground.
  Matching images and unavailable artwork do not add the backdrop.
- Desktop Home distributes available client height between hero and first shelf. Short windows use
  a compact header and five columns. TV mode follows the same layout budget with larger controls.
  Mobile and full-library scrolling remain available; no overflow lock conceals content.
- Measured browser client areas **1920x984**, **1536x768** and **1440x1060** contain the whole Home
  including footer without vertical overflow. At **1280x624**, the complete first shelf and hero
  controls fit without scrolling; part of the footer remains below the viewport.
- **30 Playwright scenarios passed**, including mixed source ratios in shelves/grids, 390/1440/1920
  tile geometry, keyboard focus without an initial scroll, taskbar-reduced layouts and TV sizing.
  Scroll tests use a genuinely short 480-pixel client area now that desktop Home normally fits.
- Full verification passed: **19 frontend unit tests**, **26 Rust tests**, formatting, type-aware lint,
  Svelte diagnostics, production build, rustfmt and Clippy. Browser tests used the existing project
  Vite server. No user instance was stopped and no game was launched.
- Preview/settings/mobile/widescreen and taskbar-reduced screenshots were regenerated and visually
  inspected. These are browser checks, not new native OS/taskbar or real controller hardware validation.

## Previous iteration: thumbnail selection and fullscreen glyphs

Artwork selection now prefers landscape store capsules/product cards, validates image dimensions,
and uses 16:9 tiles with contained images. Hero images that cannot fill a panoramic region retain
their complete composition. Header-only dimension inspection avoids decoding pixels during selection.
Automatic cover policy v5 upgrades older choices with daily retry backoff and keeps cached artwork
available offline. Manual covers remain authoritative. Revisioned URLs invalidate WebView image caches.

Steam cross-store lookup keeps exact normalized title matching while trying a bounded shorter search
query and both English/US and German/DE storefronts. This finds the requested Tony Hawk and Indiana
Jones entries without accepting a different sequel or edition. GOG cards use the exact product's asset
hash instead of a panoramic background or small logo.

### Native Windows check

A separate portable profile under `.tools/thumbnail-qa` contained only the four requested examples.
Its copied entries were deliberately marked uninstalled to prevent accidental launches; the labels in
the screenshot are not discovery results. Only these four titles were checked online. The user's
running desktop instance and library were left untouched. No game was launched.

| Game                               | Selected cover source | Decoded dimensions |
| ---------------------------------- | --------------------- | ------------------ |
| Alan Wake 2                        | Epic Games            | 2560 x 1440        |
| Indiana Jones and the Great Circle | Steam                 | 616 x 353          |
| The Witcher 3: Wild Hunt           | GOG                   | 639 x 361          |
| Tony Hawk's Pro Skater 3+4         | Steam                 | 460 x 215          |

All four images decoded in the native WebView without JavaScript errors. Tiles measured 16:9 and
used `object-fit: contain`; the Tony Hawk header retains small letterboxing rather than losing content.
Alan Wake keeps its verified Epic artwork with the complete composition visible in both tile and hero.
The native four-game screenshot was visually inspected.

The bottom-right fullscreen hint uses Menu, Options or Plus in controller mode and restores the
platform keyboard shortcut when disconnected. PlayStation Options uses three horizontal bars;
Create uses the three-ray mark from Sony's controller reference. Controller scenarios use simulated
standard Gamepad input; physical controller behavior has not been verified in this iteration.

### Automated checks

- **19 frontend unit tests**, **26 Rust tests** and **28 Playwright scenarios** passed.
- Added cover geometry/source-policy, bounded search terms, GOG product-card URL, cache migration,
  offline fallback and custom-cover preservation coverage. Native asset revisions and contained hero
  artwork are covered, including responsive layouts at 390, 1440 and 1920 pixels.
- All three controller families have footer/fullscreen coverage, including PlayStation Options geometry,
  actual button-9 fullscreen actions and keyboard-hint restoration after disconnect.
- Full `node scripts/dev.mjs verify` passed: formatting, type-aware linting, Svelte checks,
  production build, rustfmt, workspace tests and Clippy with warnings denied.
- Browser tests used the existing project Vite server with `QUICKLOAD_TEST_EXTERNAL_SERVER=1`.
  Responsive preview screenshots were regenerated with physical gamepads suppressed.

## Previous iteration: discovery, artwork, preferences and controllers

Implemented and checked:

- Exclude known Gaming Services, Xbox identity/callable UI/overlay packages and Steam Common
  Redistributables. Suppress old infrastructure entries on cache load without rewriting that file;
  reconciliation also excludes them. Real missing games retain their personal metadata.
- Require visible game applications with GDK executable or specific legacy game metadata. Preserve
  original AUMIDs and read manifest-declared splash/tile image paths inside the installation root.
- Add exact-ID GOG and exact-title Epic artwork metadata, installed-package image fallbacks, bounded
  scale-qualified file lookup, German Steam search and trademark/platform-suffix normalization.
  Updated negative-cache versions let old misses retry; editions/sequels remain distinct.
- German/English UI with ordered system-language detection, explicit persisted overrides, translated
  accessible labels, notifications, document title/language and localized dates. Old settings receive
  system-language and enabled-hint defaults. All repository documentation/comments are English.
- Controller-accessible combobox/listbox controls, padded chevrons, cancel/commit/focus restoration,
  Nintendo Switch/Switch 2 family recognition and A-confirm/B-cancel mapping with matching SVG glyphs.
- Settings shortcuts: Xbox View, PlayStation Create/Share, Nintendo Minus. Fullscreen shortcuts:
  Xbox Menu, PlayStation Options, Nintendo Plus. Header hints can be hidden while shortcuts remain active.
- Alt+Enter on Windows/Linux and Control+Command+F on macOS, with F11 retained and repeated keydowns ignored.
- Trackless overlay scroll thumbs replace native tracks that some WebViews paint black. Actual native
  scrolling, pointer dragging, right-stick input, idle hiding and forced-colors native fallback remain.

### Automated checks

- **18 frontend unit tests**: library selection, image queue/fallbacks and post-scan retry, controller identity, Nintendo
  actions, analog velocity, spatial navigation, locale fallback/interpolation and platform shortcuts.
- **24 Rust tests**: 16 core and 8 artwork tests. New fixtures cover visible-game classification,
  cached infrastructure cleanup, legacy preference defaults, provider identity/host validation,
  platform/trademark matching and local package confinement/offline resolution.
- **24 Playwright scenarios**: existing library/IPC/artwork/focus/accessibility behavior plus Nintendo
  dropdown commit/cancel, persistent hint preferences, settings/fullscreen shortcuts, system/explicit
  languages, translated dates/title, pointer dragging and high-contrast native scrollbars.
- Full `node scripts/dev.mjs verify` succeeded: Oxfmt, Oxlint including type-aware checks,
  `svelte-check`, production build, rustfmt, workspace tests and Clippy with warnings denied.
  The final browser suite also passed. A connected DualSense interfered with an earlier run;
  shared fixtures now suppress physical devices and retain only explicitly simulated controllers.
- Browser tests deliberately used the already-running project Vite server with
  `QUICKLOAD_TEST_EXTERNAL_SERVER=1`; the user's desktop instance was not stopped or used for mutable tests.

### Native Windows check

A separate portable executable/profile under `.tools/native-qa` used a copied library and its own
artwork cache. No actual game was launched and the user's active instance/data was left untouched.

- A real local scan returned **57 cached entries / 56 installed**, no provider warnings, in approximately
  **2.85 seconds** for this machine. This single observation is not a performance benchmark.
- Cached Gaming Services / Xbox UI entries were absent on load and after scanning.
- Five previously missing cover cases returned images: **Alan Wake 2** via Epic, **The Witcher 3** via
  GOG, and **Indiana Jones**, **Tony Hawk's Pro Skater 3+4**, **Fallout: New Vegas Ultimate Edition (PC)**
  via installed game-package artwork. Mixed cache/network timings are not generalized performance claims.
- The real WebView reported German-first language preferences matching Windows, and the document
  selected German automatically.
- All five targeted images decoded successfully in the WebView: Alan Wake 2 at 2560x1440,
  The Witcher 3 at 2560x655, and the three package splash images at 1920x1080. The low-resolution
  GOG logo cache is automatically upgraded to the larger background. English/Nintendo settings
  persisted across reload and invalid locale preferences were rejected; no JavaScript errors occurred.
- Screenshots of native artwork and the English Nintendo dropdown were rendered and visually inspected,
  alongside responsive preview/settings images. No real controller hardware test is claimed.
- An additional library-wide online artwork audit was rejected by automatic approval review because
  it could transmit the entire library's titles/IDs to external providers. It was not executed.
  A network-free check of the fresh QA cache found cover records for 17 of 56 installed games;
  the other 39 were not individually checked online. This fresh-cache count is not a missing-image
  count for the user's normal library.

## Earlier iterations on this Windows machine

These are historical checks, not claims that every former scenario was repeated in the current iteration.

| Iteration                           | Frontend / browser / Rust tests | Recorded outcome                                                                                                                                                                                                                                                                                                 |
| ----------------------------------- | ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Rounded focus and independent hero  | 13 / 20 / 19                    | Text-action padding, separated navigation segments, search surface focus and artwork below the fixed header. Type/lint/build/rustfmt/Clippy passed; screenshots inspected at narrow/desktop/widescreen sizes. A first browser run was interrupted by a development-server reload; the managed-server run passed. |
| Context scrollbars and cursor       | 13 / 19 / 19                    | Activity/edge hints and fullscreen input-dependent cursor. Subsequent real UI feedback revealed native opaque tracks, replaced in the current iteration.                                                                                                                                                         |
| Fixed glass header and right stick  | 13 / 16 / 19                    | Reachable navigation, focus gutters, page/shelf/dialog analog scrolling, drift suppression and contrast-mode focus. Browser controllers were simulated.                                                                                                                                                          |
| Vite+ and pnpm migration            | 11 / 11 / 19                    | Vite+ 1.5.0, Vite 8.3.5, Rolldown 1.2.16, Vitest 5.1.0, Oxfmt 0.76.0, Oxlint 1.91.0, pnpm 12.18.0 and Svelte adapter 7.3.1. Frozen pnpm/Vite+ installs, native debug build, Windows WebView settings smoke, formatting/types/Clippy passed. CI was migrated, not executed locally.                               |
| tvOS layout, SVG glyphs and artwork | 11 / 11 / 19                    | Landscape art, bounded queues, exact matching, Steam cache/hash paths, import priority and raster/size/path limits. Native Cyberpunk cross-store and private Steam cache examples, custom-cover import/persistence and unknown-ID rejection passed.                                                              |
| Windows development setup           | 7 / 8 / 14                      | Git main initialized; pinned Node 24.22.1/Rust 1.99.1, MSVC and reproducible launcher. Separate WebView profile and watcher exclusions fixed initial native startup issues. Harmless executable fixture, history, settings and borderless fullscreen checked.                                                    |
| Original alpha                      | 3 / 6 / 13                      | Earlier GNU-based Windows release, manifest parsers, local scanner and harmless executable launch smoke. A 36-installation scan took roughly 1.2–1.5 seconds then; not comparable to current datasets or Playnite.                                                                                               |

Earlier main JavaScript builds ranged from roughly 92–101 kB (34–37 kB gzip). Current translations,
select controls and overlay logic increase that artifact; figures exclude artwork and system WebView
memory. Historical npm audits do not describe the current pnpm lockfile.

## Limits

Controller inputs are simulated through standard Gamepad API objects, including Nintendo semantics;
real USB/Bluetooth Switch, Switch 2, Xbox and PlayStation hardware has not been tested here. Raw HID
and OS driver support are outside this implementation. Native Windows metadata/artwork checks do
not prove full Game Pass coverage or successful launches of actual store games.

macOS/Linux native behavior, multi-monitor/window-manager differences, signing, installers, updates,
GPU/memory measurements and very large real libraries remain unverified. CI configuration alone is
not evidence of a completed CI run. No actual store game is launched by these automated checks.
