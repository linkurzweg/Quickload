# Releases

Every push to main, including a merged pull request, runs the Release workflow. Prefer squash merges
with a Conventional Commit PR title. The PR-title check validates that convention. New commits use
`type(scope): description`, with optional scope and `!` for incompatible changes.

## Version policy

The first release uses the checked-in baseline, currently 0.2.1. Later releases inspect all commits
since the highest reachable stable release tag. Breaking changes bump major, features bump minor,
and other changes bump patch. Maintenance-only merges therefore also produce downloadable builds.
Breaking changes bump major even before 1.0. Published history is not rewritten.

Tags are authoritative. Package JSON, both Cargo manifests, Cargo.lock, Tauri metadata and the UI
version are stamped together in the build checkout. Main keeps its development baseline and receives
no generated version commits. To reproduce a release, check out its tag, run
`node scripts/release.mjs apply VERSION`, then use the documented build command.

## Downloads and publication

The workflow verifies frontend/browser tests and Rust tests/lints, then builds these assets:

| Platform                      | Downloads                                   |
| ----------------------------- | ------------------------------------------- |
| Windows x64                   | NSIS setup executable, MSI and portable ZIP |
| macOS Intel and Apple Silicon | Universal DMG                               |
| Linux x64                     | AppImage, Debian and RPM packages           |

All platforms must finish before a draft release is created. Assets and SHA256SUMS.txt are uploaded
before the release becomes public on the repository's Releases page. Only the publishing job needs
`contents: write`; GitHub's built-in token is sufficient. No npm publication occurs.

Release jobs are serialized. GitHub may replace an older queued run with a newer queued run, whose
release contains all intervening commits. Rerunning an already tagged commit skips another version.
An interrupted draft upload can be retried; existing assets are replaced before publication.

macOS builds are currently unsigned and unnotarized. Windows builds have no Authenticode certificate.
Configure platform signing credentials before distributing signed production installers.
Linux packaging is built on Ubuntu 24.04 and requires compatible system libraries.
Windows ARM and Linux ARM are outside the current download matrix.

## Updater signing

Generate a dedicated Tauri updater key with `pnpm tauri signer generate -w <private-key-path>`.
Keep a secure backup of the private key and its password. Add the public key contents to the GitHub
Actions repository variable `QUICKLOAD_UPDATER_PUBLIC_KEY` and the private key contents to the
Actions secret `TAURI_SIGNING_PRIVATE_KEY`. If the key is password protected, set
`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` as an Actions secret. Keep the same key for subsequent
releases so existing installs can verify updates. These credentials are separate from Windows
Authenticode and Apple Developer ID signing.

When the public key variable is configured, the build embeds it and the fixed GitHub update feed URL
in the app. Publication requires signatures for NSIS, MSI, the macOS app archive and AppImage, then
publishes `latest.json` with the matching per-format URLs. An unsigned release still ships the
regular downloads, including the Windows portable ZIP, when no updater public key is configured.
Once the updater is enabled, keep the variable and secrets configured for subsequent releases.
Users of previous builds need to install an updater-enabled release once.

## Public distribution

Release publication and CI binary uploads require the repository variable `QUICKLOAD_PUBLISH_RELEASES` is set to
`true`. Keep it unset for a source-only publication while reviewing binary packages.

The release workflow uses pinned cargo-about and pnpm to collect dependency license texts from
the locked packages. Each bundle and the portable ZIP include a `licenses` directory with these
notices, the Quickload license and the applicable WebView2 SDK notices on Windows. The Rust notices
link to the published crate versions for source access. Recheck the Microsoft SDK license and
notices if the WebView2 loader changes.

Review the contents of each final package before public binary distribution. In particular, extract
the AppImage and check notices and source availability for any system libraries added by linuxdeploy.
The application dependency reports do not enumerate files injected by platform packaging tools.

Keep the original private history separate from a clean public import if historical artwork is
not cleared. Deleting screenshots from the working tree does not remove them from old commits
or source archives. Before switching visibility, review old releases and Actions logs for
credentials, local paths and personal data. A clean import requires its own repository secrets,
and the updater feed and asset URLs must refer to the repository that hosts the official releases.
Preserve the official signing key and release version sequence when moving an existing feed.
Forks that distribute their own updates need separate signing keys and update endpoints.

## Checks

`node scripts/release.mjs` prints a read-only release plan. Unit tests cover version precedence and
manifest/lockfile synchronization. The GitHub matrix is the validation for native platform packages.
If a platform fails, inspect its build log, fix the underlying issue and rerun or push the correction.
