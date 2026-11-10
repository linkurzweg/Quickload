use std::{
    fs::File,
    io::{Read, Seek, Write},
    time::Duration,
};
use tauri::{async_runtime, AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::{Mutex, MutexGuard};

const RELEASES: &str = "https://github.com/linkurzweg/Quickload/releases";

/// A checked release and its optional verified, session-local download.
struct PendingUpdate {
    release: Update,
    package: Option<File>,
}

/// Keep update operations serialized and restrict installation to supported release packages.
pub struct Updates {
    supported: bool,
    pending: Mutex<Option<PendingUpdate>>,
}

impl Updates {
    /// Derive updater availability from the embedded release configuration and actual bundle type.
    pub fn new(app: &AppHandle, portable: bool) -> Self {
        use tauri::utils::{config::BundleType, platform::bundle_type};
        let supported_bundle = matches!(
            bundle_type(),
            Some(BundleType::App | BundleType::AppImage | BundleType::Msi | BundleType::Nsis)
        );
        let signed = app
            .config()
            .plugins
            .0
            .get("updater")
            .and_then(|config| config.get("pubkey"))
            .and_then(serde_json::Value::as_str)
            .is_some_and(|key| !key.is_empty());
        Self {
            supported: !cfg!(dev) && !portable && supported_bundle && signed,
            pending: Mutex::new(None),
        }
    }

    /// Reject unsupported builds and concurrent update requests without blocking the UI.
    fn lock(&self) -> Result<MutexGuard<'_, Option<PendingUpdate>>, String> {
        if !self.supported {
            return Err("In-app updates are unavailable for this build.".into());
        }
        self.pending
            .try_lock()
            .map_err(|_| "An update operation is already running.".into())
    }
}

/// Return whether this build supports signed in-app updates without performing a network request.
#[tauri::command]
pub fn supports_updates(updates: State<'_, Updates>) -> bool {
    updates.supported
}

/// Check the release feed asynchronously and remember a newer version for a later download.
#[tauri::command]
pub async fn check_update(
    app: AppHandle,
    updates: State<'_, Updates>,
) -> Result<Option<String>, String> {
    let mut pending = updates.lock()?;
    if let Some(update) = pending.as_ref().filter(|update| update.package.is_some()) {
        return Ok(Some(update.release.version.clone()));
    }
    let release = app
        .updater_builder()
        .timeout(Duration::from_secs(15))
        .restart_after_install(false)
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?;
    if let Some(release) = &release {
        let url = &release.download_url;
        if url.scheme() != "https"
            || url.host_str() != Some("github.com")
            || !url
                .path()
                .starts_with("/linkurzweg/Quickload/releases/download/")
        {
            return Err("Unexpected update download URL.".into());
        }
    }
    *pending = release.map(|release| PendingUpdate {
        release,
        package: None,
    });
    Ok(pending
        .as_ref()
        .map(|update| update.release.version.clone()))
}

/// Download and verify the checked release, then keep it on disk until installation or exit.
#[tauri::command]
pub async fn stage_update(updates: State<'_, Updates>) -> Result<(), String> {
    let mut pending = updates.lock()?;
    let update = pending.as_mut().ok_or("Check for updates first.")?;
    if update.package.is_none() {
        let mut release = update.release.clone();
        release.timeout = Some(Duration::from_secs(180));
        let bytes = release
            .download(|_, _| {}, || {})
            .await
            .map_err(|error| error.to_string())?;
        let package = async_runtime::spawn_blocking(move || {
            let mut package = tempfile::tempfile()?;
            package.write_all(&bytes)?;
            package.rewind()?;
            Ok::<_, std::io::Error>(package)
        })
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())?;
        update.package = Some(package);
    }
    Ok(())
}

/// Install a staged update off the UI thread after the window close guard has saved preferences.
#[tauri::command]
pub async fn install_update(updates: State<'_, Updates>) -> Result<(), String> {
    let mut pending = updates.lock()?;
    let update = pending.as_mut().ok_or("Check for updates first.")?;
    let mut package = update.package.take().ok_or("Download the update first.")?;
    let release = update.release.clone();
    async_runtime::spawn_blocking(move || {
        let mut bytes = Vec::new();
        package
            .read_to_end(&mut bytes)
            .map_err(|error| error.to_string())?;
        release.install(bytes).map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Open the fixed GitHub downloads page in the system browser, returning launch errors.
#[tauri::command]
pub fn open_release_downloads() -> Result<(), String> {
    open::that_detached(RELEASES).map_err(|error| error.to_string())
}
