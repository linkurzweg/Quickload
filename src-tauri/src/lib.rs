use quickload_core::{discovery, launch, storage, Library, Settings, Store};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{Manager, State};
mod artwork;
mod preferences;
mod provider_icons;
mod shortcut;
mod updates;
use artwork::{Artwork, ArtworkService};

#[tauri::command]
/// Resolve `kind` artwork for known game `id` from `state`; run disk/network work off the UI thread.
async fn resolve_artwork(
    id: String,
    kind: String,
    local_only: Option<bool>,
    state: State<'_, AppState>,
    artwork: State<'_, Arc<ArtworkService>>,
) -> Result<Option<Artwork>, String> {
    let game = {
        let library = state.library.lock().map_err(|_| "Library is locked")?;
        if !library.settings.artwork {
            return Ok(None);
        }
        library
            .games
            .iter()
            .find(|g| g.id == id)
            .cloned()
            .ok_or("Game not found")?
    };
    let service = artwork.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        if local_only == Some(true) && kind == "cover" {
            service.local_cover(&game)
        } else {
            service.resolve(&game, &kind, cfg!(dev))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
/// Copy user-selected raster `path` into the cache for known game `id`; never modify source images.
async fn import_artwork(
    id: String,
    path: PathBuf,
    state: State<'_, AppState>,
    artwork: State<'_, Arc<ArtworkService>>,
) -> Result<Artwork, String> {
    let game = state
        .library
        .lock()
        .map_err(|_| "Library is locked")?
        .games
        .iter()
        .find(|g| g.id == id)
        .cloned()
        .ok_or("Game not found")?;
    let service = artwork.inner().clone();
    tauri::async_runtime::spawn_blocking(move || service.import(&game, &path))
        .await
        .map_err(|e| e.to_string())?
}

/// Shared cached library, persistent destination and guard against concurrent scans.
struct AppState {
    library: Mutex<Library>,
    path: PathBuf,
    scanning: Arc<AtomicBool>,
    borderless: AtomicBool,
}
impl AppState {
    /// Apply `change` to a copy of the locked library; persist before publishing. Returns the new snapshot or leaves state unchanged on error.
    fn update(
        &self,
        change: impl FnOnce(&mut Library) -> Result<(), String>,
    ) -> Result<Library, String> {
        let mut guard = self.library.lock().map_err(|_| "Library is locked")?;
        let mut next = guard.clone();
        change(&mut next)?;
        storage::save(&self.path, &next)?;
        *guard = next.clone();
        Ok(next)
    }
}
#[tauri::command]
/// Return a cloned cached library from `state`; report a poisoned lock instead of blocking the UI with a scan.
fn get_library(state: State<AppState>) -> Result<Library, String> {
    Ok(state
        .library
        .lock()
        .map_err(|_| "Library is locked")?
        .clone())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
/// IPC scan response with the saved library, provider warnings and elapsed milliseconds.
struct ScanResult {
    library: Library,
    warnings: Vec<String>,
    elapsed_ms: u128,
}
/// RAII guard that releases the scan-in-progress flag on every exit path.
struct ScanGuard(Arc<AtomicBool>);
impl Drop for ScanGuard {
    /// Release the shared scan flag when this guard leaves scope, including early returns and failed scans.
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}
#[tauri::command]
/// Scan using settings from `state` on a blocking worker; reject overlapping scans and persist the merged result before returning it.
async fn scan_library(state: State<'_, AppState>) -> Result<ScanResult, String> {
    if state
        .scanning
        .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
        .is_err()
    {
        return Err("A scan is already running".into());
    }
    let _guard = ScanGuard(state.scanning.clone());
    let settings = state
        .library
        .lock()
        .map_err(|_| "Library is locked")?
        .settings
        .clone();
    let report = tauri::async_runtime::spawn_blocking(move || discovery::scan(&settings))
        .await
        .map_err(|e| e.to_string())?;
    let library = state.update(|library| {
        quickload_core::reconcile(library, report.games);
        Ok(())
    })?;
    Ok(ScanResult {
        library,
        warnings: report.warnings,
        elapsed_ms: report.elapsed_ms,
    })
}
#[tauri::command]
/// Persist `favorite` for known game `id` in `state`; unknown IDs and storage failures return errors.
fn set_favorite(id: String, favorite: bool, state: State<AppState>) -> Result<Library, String> {
    state.update(|l| {
        l.games
            .iter_mut()
            .find(|g| g.id == id)
            .ok_or("Game not found")?
            .favorite = favorite;
        Ok(())
    })
}
#[tauri::command]
/// Validate `settings`, reconcile login registration through `app`, and persist on a blocking worker.
/// Return the updated library; registration or storage errors leave the previous library in memory.
async fn save_settings(settings: Settings, app: tauri::AppHandle) -> Result<Library, String> {
    if !["auto", "xbox", "playstation", "nintendo"].contains(&settings.controller.as_str()) {
        return Err("Unknown controller type".into());
    }
    if !["system", "de", "en"].contains(&settings.language.as_str()) {
        return Err("Unknown language preference".into());
    }
    if settings.artwork_positions.values().any(|position| {
        [position.cover, position.hero]
            .into_iter()
            .flatten()
            .flatten()
            .any(|value| value > 100)
    }) {
        return Err("Invalid artwork position".into());
    }
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let mut guard = state.library.lock().map_err(|_| "Library is locked")?;
        if settings.start_at_login && !guard.settings.start_at_login && !supports_login_startup() {
            return Err("Login startup requires a packaged desktop build.".into());
        }
        let previous = if guard.settings.start_at_login != settings.start_at_login {
            preferences::login_enabled(&app)?
        } else {
            settings.start_at_login
        };
        let mut next = guard.clone();
        next.settings = settings;
        shortcut::save_native(&app, &next.settings, || {
            preferences::save_with_login(
                previous,
                next.settings.start_at_login,
                |enabled| preferences::set_login(&app, enabled),
                || storage::save(&state.path, &next),
            )
        })?;
        *guard = next.clone();
        Ok(next)
    })
    .await
    .map_err(|error| error.to_string())?
}
#[tauri::command]
/// Validate `title` and executable `path`, reject duplicates, then persist the new game in `state`.
fn add_manual(title: String, path: PathBuf, state: State<AppState>) -> Result<Library, String> {
    let game = launch::manual_game(&title, &path)?;
    state.update(|l| {
        if l.games.iter().any(|g| g.id == game.id) {
            return Err("This game is already in your library".into());
        }
        l.games.push(game);
        Ok(())
    })
}
#[tauri::command]
/// Remove manual game `id` from `state`; reject store-managed or unknown IDs and never delete game files.
fn remove_manual(id: String, state: State<AppState>) -> Result<Library, String> {
    state.update(|l| {
        if !l
            .games
            .iter()
            .any(|g| g.id == id && g.store == Store::Manual)
        {
            return Err("Only manual entries can be removed".into());
        }
        l.games.retain(|g| g.id != id);
        Ok(())
    })
}
#[tauri::command]
/// Dispatch installed game `id` from `app` off the UI thread, then record the successful handoff.
/// A history error after dispatch cannot undo the launch.
async fn launch_game(id: String, app: tauri::AppHandle) -> Result<LaunchResult, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let game = state
            .library
            .lock()
            .map_err(|_| "Library is locked")?
            .games
            .iter()
            .find(|game| game.id == id)
            .cloned()
            .ok_or("Game not found")?;
        if !game.installed {
            return Err("This game is no longer installed. Scan the library again.".into());
        }
        let report = launch::launch(&discovery::launch_target(&game))?;
        if matches!(report.status, launch::LaunchStatus::Failed) {
            let library = state
                .library
                .lock()
                .map_err(|_| "Library is locked")?
                .clone();
            return Ok(LaunchResult { library, report });
        }
        let library = state
            .update(|library| {
                let game = library
                    .games
                    .iter_mut()
                    .find(|game| game.id == id)
                    .ok_or("Game not found")?;
                game.last_played = Some(quickload_core::now());
                game.launch_count = game.launch_count.saturating_add(1);
                Ok(())
            })
            .map_err(|e| {
                format!("Start übergeben, aber Verlauf konnte nicht gespeichert werden: {e}")
            })?;
        Ok(LaunchResult { library, report })
    })
    .await
    .map_err(|e| e.to_string())?
}
/// Updated library and local evidence returned by a completed launch attempt.
#[derive(serde::Serialize)]
struct LaunchResult {
    library: Library,
    report: launch::LaunchReport,
}
#[tauri::command]
/// Set desktop-borderless fullscreen on `window` according to `enabled`; return the applied state without requesting a resolution change.
async fn set_borderless(
    enabled: bool,
    window: tauri::WebviewWindow,
    state: State<'_, AppState>,
) -> Result<bool, String> {
    apply_borderless(&window, enabled)?;
    state.borderless.store(enabled, Ordering::Release);
    Ok(enabled)
}

/// Apply startup or interactive borderless `enabled` to `window` through the same platform route.
fn apply_borderless(window: &tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    // tao uses desktop/borderless fullscreen; no exclusive display-mode API is called.
    #[cfg(target_os = "macos")]
    window
        .set_simple_fullscreen(enabled)
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "macos"))]
    window.set_fullscreen(enabled).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
/// Read the actual fullscreen state of `window`, including the initial native startup preference.
fn get_fullscreen(window: tauri::WebviewWindow, _state: State<AppState>) -> Result<bool, String> {
    #[cfg(target_os = "macos")]
    {
        let _ = window;
        Ok(_state.borderless.load(Ordering::Acquire))
    }
    #[cfg(not(target_os = "macos"))]
    window.is_fullscreen().map_err(|error| error.to_string())
}

#[tauri::command]
/// Development executables depend on a running Vite server and must not be registered for login.
fn supports_login_startup() -> bool {
    cfg!(not(dev))
}
#[tauri::command]
/// Close the supplied local `window`, returning native window errors to the caller.
fn close_window(window: tauri::WebviewWindow) -> Result<(), String> {
    window.close().map_err(|e| e.to_string())
}

/// Initialize Tauri plugins, choose portable or OS data storage, load the library and register the restricted IPC commands.
pub fn run() {
    tauri::Builder::default()
        .manage(shortcut::FocusShortcut::default())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.unminimize();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri_plugin_autostart::Builder::new()
                .app_name("Quickload")
                .build(),
        )
        .setup(|app| {
            let executable = std::env::current_exe()?;
            let folder = executable
                .parent()
                .ok_or_else(|| std::io::Error::other("App-Ordner nicht gefunden"))?;
            let portable = folder.join("quickload.portable").is_file();
            let directory = if portable {
                folder.join("quickload-data")
            } else {
                app.path().app_data_dir()?
            };
            let path = directory.join("library.json");
            // A damaged cache must surface as an error, never silently overwrite the user's data.
            let mut library = storage::load(&path).map_err(std::io::Error::other)?;
            if let Err(error) = shortcut::save_native(app.handle(), &library.settings, || Ok(())) {
                eprintln!("Quickload focus shortcut could not be registered: {error}");
            }
            // Read OS state without re-enabling a login item the user disabled outside Quickload.
            if let Ok(enabled) = preferences::login_enabled(app.handle()) {
                library.settings.start_at_login = enabled;
            }
            if let Some(window) = app.get_webview_window("main") {
                apply_borderless(&window, library.settings.startup_fullscreen)
                    .map_err(std::io::Error::other)?;
                window.show()?;
                // Showing the initially hidden window does not necessarily activate it at login.
                if let Err(error) = window.set_focus() {
                    eprintln!("Quickload startup focus could not be requested: {error}");
                }
            }
            let artwork =
                ArtworkService::new(directory.join("artwork")).map_err(std::io::Error::other)?;
            app.asset_protocol_scope()
                .allow_directory(&artwork.directory, true)?;
            app.manage(Arc::new(artwork));
            app.manage(updates::Updates::new(app.handle(), portable));
            app.manage(AppState {
                borderless: AtomicBool::new(library.settings.startup_fullscreen),
                library: Mutex::new(library),
                path,
                scanning: Arc::new(AtomicBool::new(false)),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_library,
            resolve_artwork,
            import_artwork,
            provider_icons::get_provider_icons,
            provider_icons::set_provider_icon,
            provider_icons::import_provider_icons,
            scan_library,
            set_favorite,
            save_settings,
            add_manual,
            remove_manual,
            launch_game,
            set_borderless,
            get_fullscreen,
            supports_login_startup,
            updates::supports_updates,
            updates::check_update,
            updates::stage_update,
            updates::install_update,
            updates::open_release_downloads,
            close_window
        ])
        .run(tauri::generate_context!())
        .expect("Quickload konnte nicht gestartet werden");
}
