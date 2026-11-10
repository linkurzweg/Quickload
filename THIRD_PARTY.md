# Third-party notices

Quickload's MIT license covers its own code and icon. Dependencies retain their respective licenses;
exact versions are recorded in `Cargo.lock` and `pnpm-lock.yaml`.

- [Tauri](https://github.com/tauri-apps/tauri): MIT / Apache-2.0, plus transitive dependencies.
- [Tauri autostart plugin](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/autostart):
  MIT / Apache-2.0. Its transitive `auto-launch` integration retains its own license.
- [Svelte](https://github.com/sveltejs/svelte): MIT.
- [Vite+](https://github.com/voidzero-dev/vite-plus): MIT; bundled Vite, Rolldown, Vitest,
  Oxfmt and Oxlint retain their respective notices.
- [pnpm](https://github.com/pnpm/pnpm): MIT.
- [Lucide](https://github.com/lucide-icons/lucide): ISC.
- [Reqwest](https://github.com/seanmonstar/reqwest): MIT / Apache-2.0, including transitive TLS dependencies.
- [imagesize](https://github.com/Roughsketch/imagesize): MIT; header-only dimension checks with only
  JPEG, PNG and WebP support enabled.
- [Microsoft WebView2 SDK 1.0.3800.47](https://www.nuget.org/packages/Microsoft.Web.WebView2/1.0.3800.47/License):
  Windows builds link the SDK's static loader. The SDK license and notices are included under
  `licenses/`. The Evergreen Runtime is a separate Microsoft component with its own terms.

Game names, marks and artwork belong to their respective owners. Quickload uses provider names
to identify integrations. Provider labels show text by default and can display user-imported SVGs.
Quickload has no affiliation with the providers or controller manufacturers.
Controller glyphs are drawn by Quickload to describe button functions.
Interface sounds are synthesized by Quickload; no third-party sound recordings are bundled.

The release workflow generates Rust and frontend dependency notices with license texts. Rust
notices identify exact published source versions, including MPL-2.0 components.

## Store artwork

Packaged desktop builds use local files, user imports and the user's existing artwork cache.
The development artwork code uses Steam StoreBrowse and store search, Epic's product content
endpoint, GOG's product API and allowlisted image CDNs. Those development requests can disclose a
title or product ID and the requesting IP address. The local browser preview requests artwork by
explicit Steam app ID. The relevant terms include the
[Steam Web API terms](https://steamcommunity.com/dev/apiterms),
[Epic Games Store EULA](https://legal.epicgames.com/store/eula) and
[GOG User Agreement](https://support.gog.com/hc/en-us/articles/212632089-GOG-User-Agreement).
Public access to an asset URL alone does not establish redistribution rights. These sources have
not been cleared for use by packaged builds.
