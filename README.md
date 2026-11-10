# Quickload

[Download releases](https://github.com/linkurzweg/Quickload/releases/latest) ·
[Release and versioning policy](docs/RELEASING.md)

**A quiet home for your games.** A local desktop launcher built with Rust, Tauri 2 and Svelte 5.
Quickload puts fast access to your games first.

## Status: 0.2.1 alpha

This is a usable prototype, not yet a complete Playnite replacement. Windows has been built and
checked locally. macOS/Linux CI jobs are configured, but their native behavior and real controller
hardware still need testing. There is no controlled performance comparison against Playnite.

- Discover installed games, cache the library, launch through store clients or validated executables.
- Probe mounted local drives for common library folders, with bounded discovery and readable scan times.
- Favorites, search, provider filters, sorting, manual entries and last-launch history.
- Group matching store installations and pick a preferred version from game details.
- Local launch diagnostics and independently adjustable cover and hero framing.
- Mouse, keyboard and standard-mapped Xbox, PlayStation and Nintendo Switch/Switch 2 controllers.
- German and English UI, automatic system-language selection and an explicit settings override.
- Borderless fullscreen without changing display resolution; larger controls in TV mode.
- tvOS-inspired glass, subtle rounded focus, optional transparency and reduced motion.
- Left-aligned navigation, quiet optional interface sounds and automatically saved preferences.
- Optional borderless fullscreen on launch and login startup for standalone desktop builds.
- 16:9 game tiles with full-cover rendering, role-aware artwork selection and offline caching.
- Height-aware desktop Home keeps the first game shelf visible with the taskbar.
- Controller-operated on-screen keyboard with local fuzzy library suggestions.
- At most 20 home tiles or 60 library tiles per page; images load on demand.
- No accounts, telemetry or Quickload cloud database.

All repository documentation and code comments use English. Application translations are maintained
in `src/lib/i18n.ts`. Project conventions are in [AGENTS.md](AGENTS.md).

## Run locally

Use Node **24.22.1**, pnpm **12.18.0**, Rust **1.99.1** and the
[Tauri system prerequisites](https://v2.tauri.app/start/prerequisites/).
The frontend uses **Vite+ 1.5.0**, including Oxfmt, Oxlint and Vitest.
Windows development uses MSVC and Microsoft C++ Build Tools. WSL is not required.
If Node/pnpm are missing in your terminal, follow the
[Windows setup guide](docs/DEVELOPMENT.md#windows-without-node-or-pnpm).

```sh
pnpm install --frozen-lockfile
pnpm desktop
```

Browser preview only:

```sh
pnpm dev
```

Open `http://127.0.0.1:1427`. The port is fixed and will not silently change if occupied.
**The browser shows explicitly labelled example games; it cannot scan or launch local games.**
The native app uses the real local library. Development data is isolated in
`target/debug/quickload-data/library.json`; installed application data is separate.

```sh
pnpm doctor
pnpm check
pnpm verify
node scripts/dev.mjs browsers
pnpm test:e2e
pnpm desktop:build
```

See [DEVELOPMENT.md](docs/DEVELOPMENT.md) for toolchain setup, troubleshooting, screenshots and smoke tests.
`cargo run -p quickload-core --example scan` checks scanners without opening the UI or launching games.

A Windows x64 portable ZIP is included with GitHub releases. Extract it into a writable folder and
keep `Quickload.exe` and `quickload.portable` together. The
[WebView2 runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) is required.
The alpha is unsigned. A `quickload.portable` file enables writable `quickload-data` storage beside
the executable. Without that marker, the app uses the platform application-data directory. To update
the portable build, quit Quickload and replace the extracted application files, keeping `quickload-data`.

Update-enabled Windows installers and macOS builds offer **Check for updates** in Settings. Enable
**Automatically update Quickload** to download updates in the background and install them on quit.
Portable Windows, Debian and RPM builds use manual or package-manager updates.
Linux releases currently include DEB and RPM packages. AppImage downloads are pending verification
of their bundled license notices and corresponding sources.

## Store integrations

| Provider            | Windows      | macOS                   | Linux                   | Implementation and limits                                                                                                                |
| ------------------- | ------------ | ----------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Steam               | Implemented  | Implemented, unverified | Implemented, unverified | Known roots, libraryfolders.vdf and installed ACF manifests; launch through Steam, which handles Proton.                                 |
| Epic Games          | Implemented  | Implemented, unverified | Through Heroic          | Installed .item manifests; launch through Epic. Additional manifest roots are configurable.                                              |
| GOG                 | Implemented  | Heroic/manual           | Heroic/manual           | Registry and goggame-*.info; skip DLC without launch tasks. Additional roots are configurable.                                           |
| Heroic Epic/GOG     | Implemented  | Implemented, unverified | Implemented, unverified | Local Heroic records; launch back through Heroic to preserve its Wine/Proton configuration.                                              |
| Xbox / PC Game Pass | Experimental | Unavailable             | Unavailable             | Visible game applications with game metadata; infrastructure packages are excluded. Not every GDK/MSIXVC installation format is covered. |
| Ubisoft Connect     | Implemented  | Unavailable             | Unavailable             | Local registered installations on any drive; numeric Ubisoft launch URI. Registered titles or installation-folder names are used.        |
| Battle.net          | Implemented  | Not implemented         | Unavailable             | Local uninstall records and bounded Agent product.db; known retail products only, launched through Battle.net.                           |
| Rockstar Games      | Implemented  | Unavailable             | Unavailable             | Registered title IDs and executable evidence, including GTA V Enhanced; launch through Rockstar's installed client.                      |
| Manual entries      | .exe         | .app / executable       | Executable              | Absolute paths and native execution; no automatic Wine setup.                                                                            |

Store clients and sign-in may still be required. Handing over a launch request does not prove that
the game finished starting. GOG tasks with additional arguments require a suitable manual entry.
Game details show observed launch status and offer a copyable diagnostic after an attempt.
Standalone Legendary, Lutris and EA are not integrated yet. The new integrations discover installed
Windows games only; they do not sign in or import an account's uninstalled purchases. Provider clients
must be installed and may require sign-in. Unknown Battle.net products and beta channels are skipped.
Shared canonical installation paths group cross-launcher aliases even when their display names differ.
Provider filters and launch choices remain available; distinct editions and ambiguous same-store entries
stay separate. No recursive disk search or new scanning subprocess is added for these integrations.
Known Xbox infrastructure entries and Steam Common Redistributables are also suppressed from old
cached libraries; genuine missing games retain favorites/history and appear as unavailable.

Scans include mounted local disks and removable storage. Windows also includes volumes mounted as
folders; network shares and optical drives are excluded from automatic probing. Quickload checks common
Steam/GOG folders and Epic manifest locations, plus at most 256 immediate entries in each volume root
and its `Games` directory for custom Steam library names. It never recursively walks a whole disk.
Registered Steam libraries, Epic/Heroic records and Xbox registrations already point to installations
across drives. Unusual/deep library locations can still be added in Settings. Offline, locked and
inaccessible locations may be unavailable. Scan results show milliseconds, seconds or minutes in both
the completion message and status line.

## Controls

| Action         | Keyboard / mouse                                                         | Xbox                      | PlayStation                        | Nintendo                  |
| -------------- | ------------------------------------------------------------------------ | ------------------------- | ---------------------------------- | ------------------------- |
| Navigate       | Arrow keys / Tab                                                         | Left stick / D-pad        | Left stick / D-pad                 | Left stick / D-pad        |
| Scroll         | Wheel / trackpad                                                         | Right stick               | Right stick                        | Right stick               |
| Select         | Enter / Space                                                            | A                         | Cross                              | A                         |
| Back / cancel  | Escape                                                                   | B                         | Circle                             | B                         |
| Favorite       | Heart in details                                                         | X                         | Square                             | X                         |
| Focus search   | /                                                                        | Y                         | Triangle                           | Y                         |
| Switch section | Focus top navigation                                                     | LB / RB                   | L1 / R1                            | L / R                     |
| Settings       | Settings icon                                                            | View                      | Create / Share                     | Minus                     |
| Fullscreen     | Alt+Enter on Windows/Linux; Control+Command+F on macOS; F11 additionally | Menu                      | Options                            | Plus                      |
| Quit           | Power button in header, then confirm                                     | Focus Power, A; B cancels | Focus Power, Cross; Circle cancels | Focus Power, A; B cancels |

Header button hints can be disabled in Settings; shortcuts remain available. Controllers need to be
reported by the OS/browser with **standard Gamepad mapping**. Nintendo names/vendor IDs are detected
where exposed, and glyphs/mapping can be overridden. Switch/Switch 2 driver, USB/Bluetooth and
paired Joy-Con support depend on the OS/browser; Quickload does not install a controller driver.
Generic virtual Xbox devices do not reveal their underlying Nintendo hardware automatically.
Press the controller search button to open the on-screen keyboard, or select a focused text field
with the controller. In the keyboard, the shoulder buttons move the text cursor. Square/X deletes
and Triangle/Y inserts a space. The left trigger toggles shift and the right trigger accepts the
draft. Circle/B cancels. The layout follows the UI language with QWERTY or QWERTZ and a symbols page.
Search suggestions use titles in the current library scope. Selecting one searches for that title,
and submitting an otherwise unmatched query can show fuzzy matches.

The fixed navigation stays reachable while focus navigation reveals obscured controls. The glass
bar and centered Quickload wordmark appear in views without a hero, leaving navigation in the same left
position. Compact layouts retain the centered icon. The right stick scrolls the page vertically, the focused shelf horizontally, or only
an open dialog. A deadzone suppresses drift and speed increases with deflection.
Trackless overlay thumbs appear temporarily or near a scroll edge and support mouse dragging.
Forced-colors mode uses native system scrollbars. Controller use hides the cursor only in fullscreen;
mouse movement, clicks, wheel input or keyboard input restore it.

Navigation sits on the left to leave the center of hero artwork clear. Optional interface sounds
provide short, quiet feedback for focus navigation, confirmation and going back. Game tiles use a
separate quiet 18 ms filtered click; the other sounds are unchanged. They are generated
locally and share one audio context that suspends when idle. Browser autoplay restrictions can require
a mouse or keyboard interaction before sounds become available.

Settings take effect immediately and save automatically. Path typing is coalesced for 250 ms and
flushed when leaving the field/page or closing the native window. Failed writes retain the edits and
show a retry action. **Restore defaults** resets app preferences and additional library folders while
keeping games, favorites, launch history, imported artwork and per-game installation/framing choices.

**Start in fullscreen** applies on the next native launch, using the same borderless mode as the
fullscreen button. **Open at login** registers this installation with the OS; both default to off.
Login startup requires an independently runnable desktop build (`pnpm desktop:build`), because a
development executable needs Vite running. It is disabled in development and browser previews.
Moving a portable executable can invalidate its login registration; re-enable it from its new location.
The app reads the OS registration on startup and does not silently re-enable externally disabled entries.

## Data, artwork and privacy

Quickload uses a fresh profile and does not migrate previous product names' settings, caches or login
registrations. The project checkout is `C:\Projects\Quickload`. Portable and development profiles use
the executable-relative `quickload-data` directory and the new `quickload.portable` marker.
The normal library is stored under `app.quickload.launcher/library.json` in the platform app-data directory:
usually `%APPDATA%` on Windows, `~/Library/Application Support` on macOS, or
`$XDG_DATA_HOME` / `~/.local/share` on Linux. Updates use a synchronized temporary sibling and atomic
replacement; corrupt data is reported rather than silently overwritten. Counts measure launch requests,
not playtime. See [ARCHITECTURE.md](docs/ARCHITECTURE.md) for security and component boundaries.

Packaged desktop builds resolve artwork from custom imports, the local artwork cache, Steam's local
cache and installed game packages. Use **Details > Change cover** to import JPEG, PNG or WebP images
up to 8 MiB. Quickload copies the image into its cache and leaves the original file intact. Disable
**Load game artwork** to hide artwork and stop new resolutions.

Development builds and the local browser preview can request artwork from store services. See
[THIRD_PARTY.md](THIRD_PARTY.md) for sources, limitations and third-party rights.

## Custom provider icons

In **Settings > Provider icons**, select an SVG file up to 64 KiB for each provider. Quickload
keeps a copy in the local profile so you can move the original file. Remove the copy in Settings
to show only the provider name. [Simple Icons](https://simpleicons.org/) is one source for SVGs.
Check the [individual icon and trademark terms](https://github.com/simple-icons/simple-icons/blob/develop/DISCLAIMER.md)
before using or redistributing a logo.

Use **Import SVG folder** to fill empty icon slots in one pass. Quickload matches filenames such
as `steam.svg`, `Epic Games.svg`, and `battledotnet.svg`, ignores case and punctuation, and
prefers exact names over variants such as `Steam-dark.svg`. The import examines only the selected
folder and keeps existing icon choices.

## License

Quickload is available under the [MIT License](LICENSE). Forks and redistribution are welcome.
Third-party components retain their own licenses, documented in [THIRD_PARTY.md](THIRD_PARTY.md)
and in the `licenses` directory of release packages.

## Next steps

- Native macOS/Linux, real Bluetooth/USB controllers and multi-monitor fullscreen validation.
- Controlled cold-start, memory, scan and focus latency comparisons on identical hardware/data.
- More providers, explicit artwork matching UI and store-duplicate reconciliation.
- More Game Pass installation formats, playtime, collections and extensions.
- Platform code signing and end-to-end validation of signed updates.

Actual checks and their limitations are recorded in [VALIDATION.md](docs/VALIDATION.md).
