# Architecture and technical decisions

## Runtime and boundaries

Provider icon imports copy at most one 64 KiB UTF-8 SVG per known provider to the profile's
`provider-icons` directory. A bounded native read validates the XML and returns the SVG to the
frontend for display as a data URL in an image element. The WebView handles it in image mode,
without inserting its markup into the document. The originals are left in place and the icons are
independent of game artwork and general preference resets. Provider labels remain text-only when
there is no usable SVG.

The signed updater is available only in configured NSIS, MSI, macOS app and AppImage builds.
Portable Windows and package-managed Linux builds open the fixed GitHub releases page for manual
downloads. An opt-in check runs once per session at most, after startup and local scanning, with a
one-day interval between automatic checks when webview storage is available. GitHub receives the
usual HTTP request metadata for checks and package downloads.

The native bridge exposes separate check, stage and install operations without accepting URLs or
paths from the frontend. Tauri verifies the package with the embedded public key. Staging keeps the
verified bytes in a temporary file to release the download buffer between staging and installation.
The close guard flushes settings before installation. A failed installation leaves the window open
and the update available for another download. Ordinary app use requires no update polling loop.

The native desktop offers an opt-in, configurable shortcut through Tauri's global-shortcut plugin
to show, restore and focus the existing main window. It is disabled by default, including old
profiles. Ctrl+Shift+F12 is a suggestion, not a guaranteed globally available binding. Saving
registers the replacement before releasing the previous shortcut and restores registration on
persistence failure. Conflicts surface through the existing settings error feedback. Startup
registration conflicts are logged without preventing app startup.
Controller remappers can emit this shortcut. Direct background PS/Guide/Home HID input is not
implemented. Steam's Guide binding must be disabled or adjusted separately by the user.
The Battle.net fenris agent identity maps to the existing fen game identity to preserve history
and avoid duplicate Diablo IV entries when registry and product.db discovery both succeed.

Home exposes the complete filtered library in controller-accessible pages of 20 cards. Library
pages retain their 60-card limit. Steam discovery imports the manifest LastPlayed timestamp and
reconciliation keeps the newer external or Quickload launch time. Other providers currently retain
Quickload-recorded history. Shared installations already aggregate the newest launch timestamp.
The audio context stays ready while the app is visible and sound is enabled. Hiding the app or
disabling sound suspends it. This avoids repeated audio-device wakeups between navigation cues.
Home shelf focus reveals only the horizontal axis. Edge navigation advances bounded pages, with
L2 selecting the previous result page and R2 the next page outside dialogs and the screen keyboard.
L1/R1 switch between Home, Library and Favorites. Pagination shows family-specific trigger glyphs
when controller input is active.

Detail banners and logos are resolved and decoded serially during idle periods. The warmup shares
the artwork request cache and queue with visible content, and uses low fetch priority for image
bytes. Changing the library or disabling artwork cancels future work in the current pass. The
browser manages decoded image eviction.

Page navigation animates only main-content opacity and translation for 200 ms through the Web
Animations API; rapid navigation cancels the preceding animation. Both application and system
reduced-motion preferences bypass it. Header actions reserve identical padding and border dimensions
on every page, with symmetric grid tracks also on narrow windows.

The hero artwork and its gradient extend 72 px below their layout box without moving the shelf or
intercepting pointer input. Artwork retains one successfully loaded hero URL and identity across page
unmounts, keyed by game ID, title and artwork revision. This bounded reuse avoids the placeholder
flash on return without another lookup queue; actual image bytes remain managed by the browser cache.

Native title tooltips are temporarily removed during controller input and restored for pointer or
keyboard input. Mutation observers cover input-mode changes, new content and updated titles without
polling; disconnected elements are released and accessible labels are left intact.

Tauri uses the operating system WebView instead of shipping Chromium. Rust owns filesystem access,
scanning and process launch; Svelte handles presentation, focus and input. This is a plausible
performance foundation, not a measured advantage over Playnite. Large blur regions can still be
expensive on weak GPUs; transparency and motion are optional.

- `crates/quickload-core`: serialized library/settings, store adapters, reconciliation and validated launch routing.
- `src-tauri`: restricted IPC, cached artwork resolution and native window operations.
- `src/lib`: bounded artwork queue, pure library selection, controller input, locale/keyboard helpers and scrolling.
- `src/components`: artwork, tiles, SVG glyphs and controller-accessible select controls.

All project documentation and code comments use English. UI translations live in `src/lib/i18n.ts`.

## Library lifecycle

1. Load the last JSON snapshot and show it immediately. Missing preference fields receive defaults.
2. Optionally scan using `spawn_blocking`; an atomic guard prevents concurrent scans.
3. Read known provider locations, bounded local-volume probes and user-specified roots, never recursively scan a drive.
4. Reconcile by stable store/native ID through a HashMap. Preserve favorites/history and manual entries.
   Missing games remain visible as unavailable. Known infrastructure IDs are suppressed on both cache
   load and reconciliation, so previously discovered services do not persist as games.
5. Persist under a mutex using a copied snapshot, synchronized temporary sibling and replacement.
   Publish only after saving succeeds. A handed-off process launch cannot be undone if saving history fails.

Sorting uses cached normalized title keys. Frontend selection normalizes search once, sorts a copy
and finds the featured entry in one pass. Tests include 10,000 synthetic records; that is not a real-world benchmark.
At most 20 home tiles / 60 library tiles render, with lazy image loading.

Library cards group the same case-folded title across distinct stores. Edition text is retained.
Manual and ambiguous same-store entries stay independent. A saved preference selects the
installation for a group, with installed alternatives preferred over unavailable versions.
Store filters select from the matching store, and native records retain their own IDs and history.

## Discovery

Steam reads known roots, `libraryfolders.vdf` and installed ACF manifests. Epic uses local `.item`
records. GOG uses registry locations and `goggame-*.info`, excluding DLC without launch tasks.
Heroic launches back through Heroic to preserve Wine/Proton settings.

`volumes.rs` enumerates mounted local filesystems without free-space or recursive file queries.
Windows uses volume GUID enumeration and mount paths, retaining fixed/removable storage and
excluding remote/optical drives. Linux parses `/proc/self/mountinfo` for supported disk filesystems;
macOS uses cached `getmntinfo(MNT_NOWAIT)` data and the local flag, excluding duplicate internal
System volumes. These Unix branches still require native platform verification.

Each volume receives fixed Steam/GOG/Epic folder probes. Up to 256 immediate entries in its root and
`Games` folder are inspected for `steamapps`; reaching the limit produces a discovery note. Child
symlinks and Windows reparse points are not followed by automatic probes. Explicit registered/configured
roots retain their existing behavior. Canonical path sets prevent duplicate Steam/GOG manifest reads
when registered libraries overlap these probes. Xbox registration and Epic/Heroic manifests remain
authoritative across drives; arbitrary executable folders cannot reliably identify games.
The full native scan duration includes volume probing and all provider queries; the frontend formats
it as localized milliseconds, seconds or minutes in both result surfaces.

Windows AppX discovery excludes frameworks, resource packages, Gaming Services, Xbox identity/UI
components and overlays. A candidate must be a visible, launchable game with a matching GDK
executable or specific legacy gaming metadata. An incidental Xbox SDK reference alone is insufficient.
Display names use Start Apps or GDK shell visuals instead of unresolved `ms-resource:`/package IDs.
Manifest-declared splash/tile images are retained as relative paths under the known package root.
AppX/GDK coverage remains experimental; permissions and installation formats differ across systems.

PowerShell queries have a 15-second timeout, hidden consoles and separate stdout/stderr readers.
Each provider reports recoverable warnings. Provider failure does not delete legitimate cached games.

## Artwork

The frontend coalesces identical requests and limits each disk and network queue to three jobs.
Disk covers remain available while network slots are busy. Failures never block library rendering
or launch controls. Browser examples use explicit Steam IDs. Native search, provider metadata and
disk caching run in Rust.
Lazy artwork shares one visibility observer and loads near the viewport.

Packaged desktop builds stop after local and cached resolution. The network steps below describe
the native development build. Its browser preview can also load explicitly identified Steam
examples. Prior downloaded cache entries remain usable by their local owner.

Resolution order:

1. Explicit custom covers and downloaded cache.
2. Known local Steam capsules or installed package artwork. The local fallback is saved separately.
3. Exact native GOG product metadata or title-verified Epic product metadata where applicable.
4. Unambiguous exact Steam title search, English/US and German/DE for localized names. A full-title
   query can fall back to the first two words to discover candidates; the final title match stays exact.
5. Canonical Steam CDN variants and metadata for newer hashed paths.

Tiles retain fixed 16:9 geometry independently of source dimensions. Sources within three percent
of 16:9 fill the tile with at most three percent aspect correction, preserving embedded lettering
without narrow borders. Wider fallbacks use proportional cropping; saved framing remains available.
The detail banner uses one full-width image and a separate, prioritized resolution request.

Policy v9 selects title artwork, never gameplay screenshots. Steam store-browse metadata supplies
main_capsule_2x and its own hash path; a header's hash cannot locate a different artwork role.
GOG uses the original image behind the exact product's logo rendition, rather than its 639-pixel
card derivative. Epic keeps exact-title verification. Cover downloads prefer high-resolution art but also accept correctly composed near-16:9 capsules
from 600 pixels wide. A small correct capsule must not lose to a badly composed local fallback.
Details require at least 1600x500 pixels and can use official library panoramas up to 3.5:1.
If a large cover is unavailable, the detail request uses the role-specific library hero. Each
role has its own retry marker, so a failed cover upgrade does not suppress a detail upgrade.
Old screenshot selections are excluded from the cache and resolved again. Custom covers remain
preferred. Local artwork appears immediately and upgrades crossfade only after image decoding.
Upgrade attempts retain daily backoff. Dialog requests move ahead of waiting tile jobs while the
shared three-request network limit remains unchanged. A suitable cached cover is reused for details.
Header-only dimension inspection avoids full pixel decoding in Rust. Raster byte/dimension limits,
fixed provider endpoints and CDN allowlists still apply.

Playnite separates cover/background roles and uses metadata providers, including optional extensions:
[metadata documentation](https://api.playnite.link/docs/manual/library/games/metadata.html).
SteamGridDB was considered as a specialized additional source. Its authenticated API needs a user
key and a dedicated configuration flow; it is not integrated or silently scraped. A future provider
should support exact identity mapping, explicit candidate selection, role/dimension ranking and
persisted user overrides. Neither this implementation nor four sample checks establish Playnite parity.

Home with artwork uses a full-width hero and floating navigation. Views without hero artwork use
a fixed glass bar with the Quickload wordmark and a Home action. Solid appearance disables blur.
The detail panorama can layer a cached official Steam logo through the bounded artwork queue.

Matching removes trademark punctuation and explicit PC/Windows suffixes, retaining edition names
and sequel numbers. Epic slugs are only candidate locations: returned product names must match exactly.
GOG product IDs must equal the installed native ID. Ambiguous, translated or unavailable editions
can still require manual cover import; there is no unconstrained web-image selection.

Rust uses a pooled HTTPS-only client, no redirects, explicit CDN host allowlists, 512 KiB metadata,
8 MiB raster files, a 3-second connection timeout and 5-second request timeout. JPEG/PNG/WebP magic
is checked. Relative local image paths must stay inside their canonical package root, including
symlinks; there is no recursive local artwork scan. Network/metadata work runs off the UI thread.

Cache identities use safe derived names and checked identity records. Metadata cannot supply local
filenames. Writes use unique temporary siblings; custom covers win over late downloads. Negative
matches expire after a day. Versioned negative records let improved matching retry old misses.
Transport failures remain retryable. After discovery, failed/pending frontend lookups retry with
updated package metadata while successful lookups remain cached. Turning artwork off stops new
resolutions and hides images; in-flight requests may complete. Only the cache directory is exposed
through the asset protocol.

Public metadata/CDN requests disclose a product ID or title and IP address to the relevant provider.
Custom covers copy the source file. Provider art retains its original ownership; see `THIRD_PARTY.md`.

## Localization, focus and controls

Desktop navigation is anchored to the left, independently of the centered wordmark in non-hero views. Hero views omit
the wordmark and use the left glass pill alone, leaving central subjects unobstructed. Narrow layouts
retain a separate navigation row so all controls remain reachable.

## Preferences, feedback and startup

Frontend preferences update optimistically and are persisted through one `SettingsWriter`. It
serializes IPC writes, merges newer patches and never replaces game data with an old settings response.
Only text-path edits use a 250 ms debounce; blur, navigation and native close flush the latest snapshot.
Failures keep the desired values and show a retry action. The native close listener prevents closing
until a pending save completes, retaining the window on failure. Reset preserves per-game metadata
while restoring application defaults and clearing additional discovery roots.

The native save worker serializes changes under the library mutex. The official Tauri autostart plugin
manages login registration. Windows uses the same `auto-launch` backend with an explicitly quoted
executable path and current-user scope, including installations under `Program Files`. Registration
changes precede atomic storage. Errors in registration or persistence attempt to restore the previous
registration, with rollback failures reported. Unrelated preference changes do not rewrite
login entries. Startup reads the OS state without enabling anything. Development builds cannot enable
login startup because they depend on the Vite server. Fullscreen is applied before the initially hidden
main window is shown; macOS uses simple fullscreen and Windows/Linux use desktop fullscreen.
Once visible, the window requests native foreground focus on startup, including from existing OS
login entries. Focus is best effort and a rejected request does not abort startup.

`sound.ts` lazily creates one Web Audio context and caches short cue buffers. Game tile navigation uses
an 18 ms deterministic filtered-noise click with a soft envelope; other cues keep their sine-based sound. Navigation
uses actual focus changes, confirmation uses actionable clicks and controller shortcuts, and Back has
its own cue. Repeats are limited to one cue per 65 ms; focus restoration after confirmation is silent.
Audio suspends after 1.5 seconds idle or when hidden, and disabling sounds stops active sources.
There are no audio downloads, recurring audio timers or additional audio dependencies. Playback failures
never block input. Browser autoplay restrictions are respected; cues delayed beyond 150 ms are discarded.

The native header Power action opens a focus-trapped exit confirmation with Cancel initially focused.
Controller confirmation flushes pending preferences before invoking the normal window-close route.
Back cancels and restores focus; failed saves retain the window and show the Settings retry action.
The main local window has `core:window:allow-destroy`, which Tauri's `onCloseRequested` handler needs
to finish closing after the deferred save is approved. This permission is not granted to remote windows.

New preference fields migrate with sound enabled, fullscreen startup disabled and login startup disabled.
See the [official autostart plugin](https://v2.tauri.app/plugin/autostart/) for platform registration details.

## Additional local launcher integrations

`quickload-core::integrations` reads Ubisoft Connect, Battle.net and Rockstar installations on Windows.
Its Win32 registry adapter opens machine/user 32/64-bit views read-only, bounds child enumeration to
4096 entries and string values to 64 KiB, and never executes registry command strings. Unrelated
program paths are not probed. Registered paths naturally cover installations on other drives.
No new subprocess, network lookup or recursive directory traversal is needed during these scans.

Ubisoft uses numeric keys below `SOFTWARE\Ubisoft\Launcher\Installs` and `InstallDir`; titles prefer
matching uninstall metadata and otherwise use the directory name. Battle.net reads uninstall product
IDs and `ProgramData/Battle.net/Agent/product.db`, capped at 16 MiB. A narrow checked protobuf reader
extracts product identity and install directory, skipping unknown scalar fields and rejecting malformed
lengths/varints. Known retail product IDs exclude infrastructure and unsupported channels. Rockstar
matches known registered title IDs and a specific executable inside the canonical game root.

Ubisoft dispatches `uplay://launch/<numeric-id>`. Battle.net receives one literal `--exec=launch <code>`
argument. Rockstar receives `-launchTitleInFolder` and the game directory as separate arguments.
Clients are resolved from registered installation locations or conventional program folders, never
from executable fragments in uninstall commands. A running store client is reported as a handoff,
not proof of a running game. These readers do not import uninstalled purchases or credentials.

Discovery stores canonical `installPath` independently of launch destinations. Frontend grouping joins
cross-provider path aliases with path compression in addition to exact-title groups, preserving source
filters and alternate launch routes. Windows comparison ignores case/separator differences; Unix stays
case-sensitive. Same-provider ambiguity and distinct editions remain separate. UI grouping performs
no filesystem operations. Render and artwork concurrency limits are unchanged.

Format references: Playnite's [Ubisoft reader](https://github.com/JosefNemec/PlayniteExtensions/blob/master/source/Libraries/UplayLibrary/UplayLibrary.cs),
[Battle.net database model](https://github.com/JosefNemec/PlayniteExtensions/blob/master/source/Libraries/BattleNetLibrary/BattleNetGames.cs),
[Battle.net launch route](https://github.com/JosefNemec/PlayniteExtensions/blob/master/source/Libraries/BattleNetLibrary/BattleNetGameController.cs),
[Rockstar discovery](https://github.com/JosefNemec/PlayniteExtensions/blob/master/source/Libraries/RockstarLibrary/RockstarGamesLibrary.cs)
and [Rockstar launch route](https://github.com/JosefNemec/PlayniteExtensions/blob/master/source/Libraries/RockstarLibrary/RockstarGamesController.cs).
Quickload implements its own bounded Rust readers; provider formats may change.

## Language and focus

`language` is `system`, `de` or `en`. Ordered browser/OS languages choose a supported locale; unknown
languages fall back to English. Explicit preferences override the system. UI text, accessible labels,
notifications and dates follow the locale, and `document.lang` updates. Legacy settings default to
system language and enabled controller hints.

The UI uses sans-serif system fonts, graphite surfaces, edge-to-edge landscape tiles and a hero that
starts below the fixed glass header. Focus uses rounded inset highlights and gentle transform/opacity
transitions. Navigation segments reserve an eight-pixel gap. Search focuses its enclosing surface,
not a second square input ring. Forced-colors mode retains system focus indicators.

Header shortcuts occupy a reserved slot inside each pill-shaped button. Provider filter marks are
small locally bundled SVGs with visible text labels; no runtime logo fetch is required. Keyboard keys
use centered flex line boxes with an explicit line height for letters, numbers and symbols.
New sections and dropdowns enter over 180 ms with transform/opacity only. Chevron and header-icon
feedback is event-driven, with no animation library, permanent layer promotion or idle animation loop.
Application and system reduced-motion preferences suppress these transitions.

Desktop Home (above 1100 CSS pixels wide) budgets the available client height between a flexible hero,
the intrinsic first shelf and the footer. It uses dynamic viewport units, the fixed header height and
the larger TV footer rather than a fixed 640/710-pixel hero. Short desktop windows use a compact header,
five shelf columns and fewer decorative hero lines while preserving launch/details controls and titles.
The hero retains a usable minimum height; very short windows still scroll naturally. Narrow/mobile
layouts and the full library retain normal document scrolling. No body overflow lock hides content.

A shared focus listener coalesces visibility work into one frame, accounting for header height and
scroll gutters. Dialogs trap keyboard/controller focus, restore the trigger and isolate background
scrolling. Select controls use a labelled combobox trigger and scoped listbox. A/Enter opens and
commits, B/Escape cancels, and directional keys/stick navigate options without leaking to the page.

Standard Gamepad API devices are polled every 25 ms while active and every 500 ms while disconnected;
unfocused/hidden windows do not process input. Nintendo family detection includes Switch/Switch 2,
Joy-Con and exposed vendor IDs. Nintendo uses labelled A-confirm/B-cancel; overrides affect actions
as well as glyphs. Non-standard raw HID layouts need an OS/driver mapping. No controller driver is installed.

View/Create/Minus opens Settings; Menu/Options/Plus toggles fullscreen. Header hints can be hidden
independently of shortcut functionality. Windows/Linux support Alt+Enter; macOS supports Control+Command+F;
F11 remains available. Repeated shortcut keydowns do not retrigger toggles. Fullscreen hides the cursor
on controller activity only; actual mouse/keyboard input restores it. An idle connected pad does not hide it again.
The footer uses the same Menu/Options/Plus shortcut glyph while a controller is selected/connected,
and returns to the platform keyboard keycap otherwise. PlayStation Options uses three standalone
horizontal bars; Create uses the three-ray mark rather than a download/share arrow.

The right stick scrolls page/dialog vertically and the focused shelf horizontally without changing
focus. A 22% deadzone and progressive speed up to 1150 px/s suppress drift. A frame loop runs only
while deflected and caps elapsed integration at 50 ms. Shelf snapping is temporarily disabled.

## Controller text entry

The on-screen keyboard is a separate frontend chunk loaded on first use. It edits a local draft
and uses the existing input event binding on commit. The parent page or form is inert while
editing, and focus returns to the original field on accept or cancel.

Only the keyboard panel blurs the surface behind it. The dimmer and panel animate opacity and
vertical position, with no motion when either the app or operating system requests reduced motion.
The panel becomes inert at the start of its exit transition so it cannot keep focus or input.

Library titles are normalized once per search session. A 45 ms trailing debounce ranks a maximum
of five candidates using prefixes, substrings and one-edit word prefixes including transpositions.
Numeric tokens require exact characters. Empty queries skip ranking, and closing the keyboard
cancels pending work. Plain search keeps its original match rules. A submitted keyboard query can
use the local shortlist when the original search finds no matches. Text entry makes no network
requests for predictions and has no additional dependency.

## Trackless scroll indicators

Some WebViews paint native tracks opaque despite transparent scrollbar CSS. Quickload therefore hides
native scrollbars and draws only trackless overlay thumbs. Actual scrolling remains native; pointer
capture maps dragging to scroll coordinates. Delegated events reveal the current surface for 900 ms
or while the pointer is near its edge. Resize/content observers schedule geometry once per frame;
there is no idle animation loop. Detached surfaces and timers are cleaned up. Overlay hosts have no
background and reserve no layout width. Dialogs suppress background indicators. Forced-colors mode
uses visible native system scrollbars instead of the overlays.

## Native launch and safety

Windows checks that a store URI has a registered handler and dispatches it with
`ShellExecuteExW` on a blocking worker. The launch history is recorded after successful dispatch,
and the library mutex is released while Windows performs the handoff. Windows Steam games first
use the installed `steam.exe` with `-applaunch` and the numeric ID from the cached URI. The client
is found from Valve's registry entries or conventional installation paths. The URI remains
available when the executable cannot be located. Epic uses its store protocol. Heroic uses the
query form emitted by its desktop shortcuts, with legacy
cached path-style shortcuts translated at launch.

References are the Windows [association query](https://learn.microsoft.com/en-us/windows/win32/api/shlwapi/nf-shlwapi-assocquerystringw),
[shell dispatch API](https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecuteexw)
and [Heroic shortcut generator](https://github.com/Heroic-Games-Launcher/HeroicGamesLauncher/blob/main/src/backend/shortcuts/shortcuts/shortcuts.ts).

For a GOG primary task that names REDprelauncher, Quickload prefers a unique, same-named executable
task from the same product manifest. Executable and working directory paths are checked against
the canonical installation root. Older cached RED launcher entries resolve the same manifest
directly on launch, and ambiguous or missing alternatives fall back to the primary task.

The detail Play action receives initial focus when available. The launch worker distinguishes an
unconfirmed handoff, a detected process and a failure. It watches the requested Steam App ID in
new process-log records for up to four seconds and observes direct executables for early exit.
OS errors and nonzero exit codes are included in a local diagnostic. Failure does not increment
launch history. The report includes the chosen route, executable when known, PID or exit code.
Steam log lines themselves are not sent to the frontend.

IPC accepts known game IDs, not arbitrary shell commands or unvalidated HTTP URLs. Protocols are
allowlisted and process arguments are separate. Manual entries require existing absolute executable
paths; store files and credentials remain untouched. The CSP limits scripts to the app bundle and
native dialogs to the local window. Local manifests are local configuration, not a security boundary
against a compromised machine.

Windows/Linux use desktop/borderless fullscreen through Tao. macOS uses simple fullscreen. No
resolution-change API is called. Dock/taskbar, Wayland and multi-monitor behavior need hardware testing.

## Development toolchain

Pinned tools: Node 24.22.1, pnpm 12.18.0, Rust 1.99.1 and Vite+ 1.5.0. Vite+ bundles Vite 8.3.5,
Rolldown 1.2.16, Vitest 5.1.0, Oxfmt 0.76.0 and Oxlint 1.91.0. The Svelte adapter is 7.3.1.
The pnpm catalog keeps Vite+ and its Vite alias aligned; the narrow peer exception accepts that alias
version only. `vite.config.ts` centralizes formatting, lint/types, tests and bundling; Svelte diagnostics
remain separate. esbuild is the only allowlisted dependency build script. See `DEVELOPMENT.md`.

## Primary references

- [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- [Tauri configuration and CSP](https://v2.tauri.app/reference/config/)
- [Tauri window API](https://docs.rs/tauri/latest/tauri/webview/struct.WebviewWindow.html)
- [W3C Gamepad standard mapping](https://www.w3.org/TR/gamepad/)
- [Microsoft GDK shell visuals](https://learn.microsoft.com/en-us/gaming/gdk/docs/reference/system/microsoftgameconfig/elements/microsoftgameconfig-element-shellvisuals)
- [Microsoft Start Apps](https://learn.microsoft.com/en-us/powershell/module/startlayout/get-startapps)
- [Apple keyboard shortcuts](https://support.apple.com/en-us/102650)
- [Official DualSense button symbols](https://controller.dl.playstation.net/controller/lang/en/2100002.html)
- [Apple focus and selection](https://developer.apple.com/design/human-interface-guidelines/focus-and-selection/)
- [Steam graphical assets](https://partner.steamgames.com/doc/store/assets)

Provider manifest and public endpoint formats can change; fixtures and conservative matching limit
false positives, but do not imply official provider support.
