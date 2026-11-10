use crate::{vdf, Game, LaunchTarget, Settings, Store};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashSet,
    fs,
    path::{Path, PathBuf},
};

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
/// Provider discoveries, recoverable warnings and wall-clock scan duration in milliseconds.
pub struct ScanReport {
    pub games: Vec<Game>,
    pub warnings: Vec<String>,
    pub elapsed_ms: u128,
}

/// Identify known store infrastructure in cached or newly discovered `game`, without hiding real titles.
pub fn is_system_game(game: &Game) -> bool {
    if game.store == Store::Steam {
        return game.id == "steam:228980";
    }
    if game.store != Store::Xbox {
        return false;
    }
    let lower = game.id.to_ascii_lowercase();
    let package = lower
        .strip_prefix("xbox:")
        .unwrap_or(&lower)
        .split('_')
        .next()
        .unwrap_or("");
    matches!(
        package,
        "microsoft.gamingservice"
            | "microsoft.gamingservices"
            | "microsoft.gamingapp"
            | "microsoft.xboxgamecallableui"
            | "microsoft.xboxidentityprovider"
            | "microsoft.xbox.tcui"
            | "microsoft.xboxgamingoverlay"
            | "microsoft.xboxgameoverlay"
            | "microsoft.xboxspeechtotextoverlay"
            | "microsoft.xboxapp"
            | "microsoft.gamingservicesui"
    )
}

/// Validate one bounded PowerShell AppX `item`; exclude background/technical records and preserve launch identity.
#[cfg(any(windows, test))]
fn xbox_game(item: &Value) -> Option<Game> {
    let id = text(item, "id")?;
    let title = text(item, "title")?.trim();
    if title.is_empty()
        || title.starts_with("ms-resource:")
        || !id.contains('!')
        || item["game"].as_bool() != Some(true)
        || item["visible"].as_bool() != Some(true)
    {
        return None;
    }
    let mut game = Game::new(
        format!("xbox:{id}"),
        title.into(),
        Store::Xbox,
        LaunchTarget::Xbox { aumid: id.into() },
    );
    if is_system_game(&game) {
        return None;
    }
    game.artwork_root = text(item, "root").map(PathBuf::from);
    game.artwork_files = item["images"]
        .as_array()
        .into_iter()
        .flatten()
        .take(8)
        .filter_map(Value::as_str)
        .map(PathBuf::from)
        .filter(|path| {
            !path.as_os_str().is_empty()
                && path
                    .components()
                    .all(|part| matches!(part, std::path::Component::Normal(_)))
        })
        .collect();
    Some(game)
}

/// Resolve the platform home-directory environment variable, returning an empty path when unavailable.
fn home() -> PathBuf {
    std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
        .map(PathBuf::from)
        .unwrap_or_default()
}
/// Resolve environment variable `key`, falling back to literal `fallback` when it is unset.
fn env_path(key: &str, fallback: &str) -> PathBuf {
    std::env::var_os(key)
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(fallback))
}
/// Read JSON manifest `path`, rejecting files above 16 MiB and returning filesystem or parse errors.
fn json(path: &Path) -> Result<Value, String> {
    if fs::metadata(path).map_err(|e| e.to_string())?.len() > 16 * 1024 * 1024 {
        return Err("Manifest zu groß".into());
    }
    let data = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(data.trim_start_matches('\u{feff}')).map_err(|e| e.to_string())
}
/// Borrow a nonempty string property `key` from JSON value `v`; missing or non-string properties return None.
fn text<'a>(v: &'a Value, key: &str) -> Option<&'a str> {
    v.get(key)?.as_str().filter(|s| !s.is_empty())
}
/// List immediate files under `root` matching extension `ext` without case sensitivity. Missing or inaccessible directories yield no entries.
fn entries(root: &Path, ext: &str) -> Vec<PathBuf> {
    fs::read_dir(root)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| p.extension().is_some_and(|e| e.eq_ignore_ascii_case(ext)))
        .collect()
}
/// Append error `err` annotated with manifest `path` to `report`, allowing other sources to continue.
fn warn(report: &mut ScanReport, path: &Path, err: String) {
    report.warnings.push(format!("{}: {err}", path.display()));
}

/// Find conventional Steam roots for this OS, including the Windows registry and Linux Flatpak location; does not scan entire disks.
pub fn default_steam_roots() -> Vec<PathBuf> {
    #[cfg(windows)]
    {
        let mut roots = vec![
            env_path("ProgramFiles(x86)", "C:\\Program Files (x86)").join("Steam"),
            env_path("ProgramFiles", "C:\\Program Files").join("Steam"),
        ];
        if let Ok(values) = powershell_json("$ErrorActionPreference='Stop'; $p=Get-ItemProperty 'HKCU:\\Software\\Valve\\Steam' -ErrorAction SilentlyContinue; if($p.SteamPath){ConvertTo-Json -InputObject @($p.SteamPath) -Compress}") {
            if let Some(values) = values.as_array() { roots.extend(values.iter().filter_map(Value::as_str).map(PathBuf::from)); }
        }
        roots
    }
    #[cfg(target_os = "macos")]
    {
        vec![home().join("Library/Application Support/Steam")]
    }
    #[cfg(not(any(windows, target_os = "macos")))]
    {
        let h = home();
        vec![
            h.join(".steam/steam"),
            h.join(".local/share/Steam"),
            h.join(".var/app/com.valvesoftware.Steam/.local/share/Steam"),
        ]
    }
}

/// Read Steam `root` and its libraryfolders manifests into `report`; skip incomplete installs and append individual parser warnings.
pub fn scan_steam(root: &Path, report: &mut ScanReport) {
    scan_steam_once(root, report, &mut HashSet::new());
}

/// Read `root` and its configured libraries, using `visited` to avoid parsing a shared library twice.
fn scan_steam_once(root: &Path, report: &mut ScanReport, visited: &mut HashSet<PathBuf>) {
    let mut libraries = vec![root.to_path_buf()];
    let folders = root.join("steamapps/libraryfolders.vdf");
    if folders.is_file() {
        match fs::read_to_string(&folders)
            .map_err(|e| e.to_string())
            .and_then(|s| vdf::parse(&s))
        {
            Ok(value) => {
                if let Some(folders) = value.get("libraryfolders") {
                    for entry in folders.values() {
                        if let Some(path) = entry
                            .get("path")
                            .and_then(vdf::Value::text)
                            .or_else(|| entry.text())
                        {
                            libraries.push(PathBuf::from(path));
                        }
                    }
                }
            }
            Err(err) => warn(report, &folders, err),
        }
    }
    libraries.sort();
    libraries.dedup();
    for library in libraries {
        let Ok(canonical) = library.canonicalize() else {
            continue;
        };
        if !visited.insert(canonical) {
            continue;
        }
        for manifest in entries(&library.join("steamapps"), "acf") {
            let parse = || -> Result<Option<Game>, String> {
                let data = fs::read_to_string(&manifest).map_err(|e| e.to_string())?;
                let value = vdf::parse(&data)?;
                let app = value.get("AppState").ok_or("AppState fehlt")?;
                let id = app
                    .get("appid")
                    .and_then(vdf::Value::text)
                    .ok_or("App-ID fehlt")?;
                if id.is_empty() || !id.chars().all(|c| c.is_ascii_digit()) {
                    return Err("Ungültige Steam-ID".into());
                }
                let title = app
                    .get("name")
                    .and_then(vdf::Value::text)
                    .ok_or("Spielname fehlt")?;
                let state = app
                    .get("StateFlags")
                    .and_then(vdf::Value::text)
                    .and_then(|s| s.parse::<u32>().ok())
                    .unwrap_or(0);
                let dir = app
                    .get("installdir")
                    .and_then(vdf::Value::text)
                    .unwrap_or("");
                if state & 4 == 0
                    || dir.is_empty()
                    || !library.join("steamapps/common").join(dir).is_dir()
                {
                    return Ok(None);
                }
                let mut game = Game::new(
                    format!("steam:{id}"),
                    title.into(),
                    Store::Steam,
                    LaunchTarget::Uri {
                        uri: format!("steam://rungameid/{id}"),
                    },
                )
                .with_install_path(&library.join("steamapps/common").join(dir));
                game.last_played = app
                    .get("LastPlayed")
                    .and_then(vdf::Value::text)
                    .and_then(|value| value.parse::<u64>().ok())
                    .filter(|value| *value > 0);
                Ok(Some(game))
            };
            match parse() {
                Ok(Some(game)) => report.games.push(game),
                Ok(None) => (),
                Err(e) => warn(report, &manifest, e),
            }
        }
    }
}

/// Percent-encode UTF-8 bytes of `s` for store protocol identifiers, leaving only unreserved URI characters unchanged.
fn encode(s: &str) -> String {
    s.bytes()
        .map(|b| {
            if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) {
                (b as char).to_string()
            } else {
                format!("%{b:02X}")
            }
        })
        .collect()
}
/// Read Epic item manifests directly under `root`, adding installed games and per-manifest warnings to `report`.
pub fn scan_epic(root: &Path, report: &mut ScanReport) {
    for manifest in entries(root, "item") {
        let parse = || -> Result<Option<Game>, String> {
            let v = json(&manifest)?;
            if v.get("bIsIncompleteInstall").and_then(Value::as_bool) == Some(true) {
                return Ok(None);
            }
            let id = text(&v, "AppName").ok_or("AppName fehlt")?;
            let title = text(&v, "DisplayName").ok_or("DisplayName fehlt")?;
            let location = text(&v, "InstallLocation").ok_or("InstallLocation fehlt")?;
            if !Path::new(location).is_dir() {
                return Ok(None);
            }
            let ns = text(&v, "CatalogNamespace").unwrap_or("");
            let item = text(&v, "CatalogItemId").unwrap_or("");
            let key = if ns.is_empty() || item.is_empty() {
                encode(id)
            } else {
                format!("{}%3A{}%3A{}", encode(ns), encode(item), encode(id))
            };
            Ok(Some(
                Game::new(
                    format!("epic:{id}"),
                    title.into(),
                    Store::Epic,
                    LaunchTarget::Uri {
                        uri: format!(
                            "com.epicgames.launcher://apps/{key}?action=launch&silent=true"
                        ),
                    },
                )
                .with_install_path(Path::new(location)),
            ))
        };
        match parse() {
            Ok(Some(game)) => report.games.push(game),
            Ok(None) => (),
            Err(e) => warn(report, &manifest, e),
        }
    }
}

/// Heroic owns Wine/Proton settings and authentication. Hand launches back to Heroic.
/// Read Heroic installation data at `root` into `report`, retaining Heroic routing for its compatibility settings.
fn scan_heroic(root: &Path, report: &mut ScanReport) {
    let manifests = [
        (
            root.join("legendaryConfig/legendary/installed.json"),
            Store::Epic,
            "legendary",
        ),
        (root.join("gog_store/installed.json"), Store::Gog, "gog"),
    ];
    for (path, store, runner) in manifests {
        if !path.is_file() {
            continue;
        }
        match json(&path) {
            Ok(v) => {
                let records: Vec<(String, &Value)> =
                    if let Some(a) = v.get("installed").and_then(Value::as_array) {
                        a.iter()
                            .filter_map(|g| text(g, "appName").map(|id| (id.to_owned(), g)))
                            .collect()
                    } else if let Some(m) = v.as_object() {
                        m.iter().map(|(k, v)| (k.clone(), v)).collect()
                    } else {
                        vec![]
                    };
                for (id, entry) in records {
                    if let Some(location) = text(entry, "install_path") {
                        if !Path::new(location).is_dir() {
                            continue;
                        }
                        let title = text(entry, "title").unwrap_or(&id);
                        let prefix = if store == Store::Epic { "epic" } else { "gog" };
                        report.games.push(
                            Game::new(
                                format!("{prefix}:{id}"),
                                title.into(),
                                store.clone(),
                                LaunchTarget::Uri {
                                    uri: crate::launch::heroic_uri(runner, &encode(&id)),
                                },
                            )
                            .with_install_path(Path::new(location)),
                        );
                    }
                }
            }
            Err(e) => warn(report, &path, e),
        }
    }
}

/// Identify the known RED launcher wrapper by the final component of `path`.
fn is_red_prelauncher(path: &Path) -> bool {
    path.file_name()
        .is_some_and(|name| name.eq_ignore_ascii_case("REDprelauncher.exe"))
}

/// Resolve a GOG `task` inside its canonical installation `root`, defaulting to the executable's
/// parent for a direct alternative. Invalid paths and unsupported arguments are rejected.
fn gog_file_target(root: &Path, task: &Value, direct: bool) -> Option<LaunchTarget> {
    if text(task, "type") != Some("FileTask") || text(task, "arguments").is_some() {
        return None;
    }
    let relative = Path::new(text(task, "path")?);
    if relative.is_absolute() {
        return None;
    }
    let path = root.join(relative).canonicalize().ok()?;
    if !path.starts_with(root)
        || !path.is_file()
        || (cfg!(windows)
            && !path
                .extension()
                .is_some_and(|ext| ext.eq_ignore_ascii_case("exe")))
    {
        return None;
    }
    let cwd = match text(task, "workingDir") {
        Some(dir) => root.join(dir).canonicalize().ok()?,
        None if direct => path.parent()?.to_path_buf(),
        None => root.to_path_buf(),
    };
    if !cwd.starts_with(root) || !cwd.is_dir() {
        return None;
    }
    Some(LaunchTarget::Executable {
        path,
        cwd,
        args: vec![],
    })
}

/// Resolve the primary GOG launch task in `manifest`. For the known RED wrapper, prefer a
/// unique, same-named executable task explicitly supplied by the game manifest in `dir`.
fn gog_target(dir: &Path, manifest: &Value) -> Option<LaunchTarget> {
    let tasks = manifest.get("playTasks")?.as_array()?;
    let primary = tasks.iter().find(|task| {
        task.get("isPrimary").and_then(Value::as_bool) == Some(true)
            && text(task, "type") == Some("FileTask")
    })?;
    let root = dir.canonicalize().ok()?;
    if text(primary, "path").is_some_and(|path| is_red_prelauncher(Path::new(path))) {
        if let Some(name) = text(primary, "name") {
            let mut direct = tasks
                .iter()
                .filter(|task| {
                    text(task, "name") == Some(name)
                        && text(task, "path")
                            .is_some_and(|path| !is_red_prelauncher(Path::new(path)))
                })
                .filter_map(|task| gog_file_target(&root, task, true));
            if let Some(target) = direct.next() {
                if direct.next().is_none() {
                    return Some(target);
                }
            }
        }
    }
    gog_file_target(&root, primary, false)
}

/// Resolve the cached GOG RED wrapper for `game` using its own local manifest and matching product ID.
/// All other targets and unavailable or mismatched manifests retain the cached launch route.
pub fn launch_target(game: &Game) -> LaunchTarget {
    if let (Store::Gog, LaunchTarget::Executable { path, .. }) = (&game.store, &game.target) {
        if is_red_prelauncher(path) {
            if let (Some(id), Some(dir)) = (game.id.strip_prefix("gog:"), path.parent()) {
                if !id.is_empty() && id.bytes().all(|byte| byte.is_ascii_digit()) {
                    if let Ok(manifest) = json(&dir.join(format!("goggame-{id}.info"))) {
                        if text(&manifest, "gameId") == Some(id) {
                            if let Some(target) = gog_target(dir, &manifest) {
                                return target;
                            }
                        }
                    }
                }
            }
        }
    }
    game.target.clone()
}

/// Read GOG metadata at `root` and immediate game directories into `report`; skip DLC and unsupported tasks.
pub fn scan_gog(root: &Path, report: &mut ScanReport) {
    scan_gog_once(root, report, &mut HashSet::new());
}

/// Read GOG `root` and direct game folders only once per scan using canonical `visited` identities.
fn scan_gog_once(root: &Path, report: &mut ScanReport, visited: &mut HashSet<PathBuf>) {
    let mut dirs = vec![root.to_path_buf()];
    dirs.extend(
        fs::read_dir(root)
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .map(|e| e.path())
            .filter(|p| p.is_dir()),
    );
    for dir in dirs {
        let Ok(canonical) = dir.canonicalize() else {
            continue;
        };
        if !visited.insert(canonical) {
            continue;
        }
        for path in entries(&dir, "info").into_iter().filter(|p| {
            p.file_name()
                .is_some_and(|n| n.to_string_lossy().starts_with("goggame-"))
        }) {
            let parse = || -> Result<Option<Game>, String> {
                let v = json(&path)?;
                let id = text(&v, "gameId").ok_or("gameId fehlt")?;
                let title = text(&v, "name").ok_or("Name fehlt")?;
                let tasks = v.get("playTasks").and_then(Value::as_array);
                // DLC manifests have no launch task; the base game is the library entry.
                if tasks.is_none_or(|a| a.is_empty()) {
                    return Ok(None);
                }
                let target = gog_target(&dir, &v).ok_or("No usable GOG launch task")?;
                Ok(Some(
                    Game::new(format!("gog:{id}"), title.into(), Store::Gog, target)
                        .with_install_path(&dir),
                ))
            };
            match parse() {
                Ok(Some(g)) => report.games.push(g),
                Ok(None) => (),
                Err(e) => warn(report, &path, e),
            }
        }
    }
}

#[cfg(windows)]
/// Run fixed internal PowerShell `script` with separate pipe readers and a 15-second deadline; parse its JSON output or return an error.
fn powershell_json(script: &str) -> Result<Value, String> {
    use std::{
        io::Read,
        os::windows::process::CommandExt,
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    let mut child = Command::new("powershell.exe")
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            &format!("[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; {script}"),
        ])
        .creation_flags(0x08000000)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| e.to_string())?;
    let mut out = child.stdout.take().unwrap();
    let mut err = child.stderr.take().unwrap();
    let out_thread = std::thread::spawn(move || {
        let mut b = vec![];
        let _ = out.read_to_end(&mut b);
        b
    });
    let err_thread = std::thread::spawn(move || {
        let mut b = vec![];
        let _ = err.read_to_end(&mut b);
        b
    });
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            let out = out_thread
                .join()
                .map_err(|_| "Scanner-Ausgabe fehlgeschlagen")?;
            let err = err_thread
                .join()
                .map_err(|_| "Scanner-Fehlerausgabe fehlgeschlagen")?;
            if !status.success() {
                return Err(String::from_utf8_lossy(&err).trim().to_owned());
            }
            let output = String::from_utf8_lossy(&out);
            return if output.trim().is_empty() {
                Ok(Value::Array(vec![]))
            } else {
                serde_json::from_str(output.trim_start_matches('\u{feff}'))
                    .map_err(|e| e.to_string())
            };
        }
        if start.elapsed() > Duration::from_secs(15) {
            let _ = child.kill();
            let _ = child.wait();
            return Err("Scanner nach 15 Sekunden abgebrochen".into());
        }
        std::thread::sleep(Duration::from_millis(30));
    }
}

#[cfg(windows)]
/// Append Windows-only registry GOG and gaming AppX discoveries to `report`; unavailable sources add warnings.
fn scan_windows(report: &mut ScanReport, gog_visited: &mut HashSet<PathBuf>) {
    let script = r#"$ErrorActionPreference='Stop'; $games=@(); foreach($root in @('HKLM:\SOFTWARE\WOW6432Node\GOG.com\Games','HKLM:\SOFTWARE\GOG.com\Games')) { if(Test-Path $root){Get-ChildItem $root | ForEach-Object { $g=Get-ItemProperty $_.PSPath; if($g.gameID -and $g.path){$games+=@{id=[string]$g.gameID;path=[string]$g.path}} } } }; ConvertTo-Json -InputObject @($games) -Compress"#;
    match powershell_json(script) {
        Ok(v) => {
            for item in v.as_array().into_iter().flatten() {
                if let Some(path) = text(item, "path") {
                    scan_gog_once(Path::new(path), report, gog_visited);
                }
            }
        }
        Err(e) => report.warnings.push(format!("GOG-Registry: {e}")),
    }
    // Require a launchable, visible game application rather than an incidental Xbox SDK/service reference.
    let script = r#"
$ErrorActionPreference='Stop'
$games=@(); $names=@{}
if(Get-Command Get-StartApps -ErrorAction SilentlyContinue) {
    Get-StartApps -ErrorAction SilentlyContinue | ForEach-Object { $names[$_.AppID]=$_.Name }
}
Get-AppxPackage | ForEach-Object {
    $p=$_
    if($p.IsFramework -or $p.IsResourcePackage -or $p.Name -match '^Microsoft\.(GamingServices?(UI)?|GamingApp|XboxGameCallableUI|XboxIdentityProvider|Xbox\.TCUI|XboxGamingOverlay|XboxGameOverlay|XboxSpeechToTextOverlay|XboxApp)$') { return }
    if(!$p.InstallLocation) { return }
    $config=$null; $g=$null
    foreach($relative in @('MicrosoftGame.config','Content\MicrosoftGame.config')) {
        $candidate=Join-Path $p.InstallLocation $relative
        if((Test-Path -LiteralPath $candidate) -and (Get-Item -LiteralPath $candidate).Length -le 1048576) {
            try { $g=[xml](Get-Content -LiteralPath $candidate -Raw); $config=$candidate; break } catch {}
        }
    }
    try {
        $m=Get-AppxPackageManifest $p -ErrorAction Stop
        $gaming=($m.OuterXml -match 'GameExplorer|XboxLiveTitleId|<TitleId>')
        if($config -or $gaming) {
            foreach($a in $m.Package.Applications.Application) {
                $id=$p.PackageFamilyName+'!'+$a.Id
                $executable=@($g.Game.ExecutableList.Executable | Where-Object { $_.Id -eq $a.Id -or $_.Name -eq $a.Executable })
                $visible=($a.VisualElements -and $a.VisualElements.AppListEntry -ne 'none' -and ($names[$id] -or $executable.Count -gt 0))
                if(!$visible) { continue }
                $title=[string]$a.VisualElements.DisplayName
                if($names[$id]) { $title=[string]$names[$id] }
                if((!$title -or $title.StartsWith('ms-resource:')) -and $g.Game.ShellVisuals.DefaultDisplayName) { $title=[string]$g.Game.ShellVisuals.DefaultDisplayName }
                if(!$title -or $title.StartsWith('ms-resource:') -or $title -eq $p.Name) { continue }
                $images=@($g.Game.ShellVisuals.SplashScreenImage,$a.VisualElements.SplashScreen.Image,$a.VisualElements.DefaultTile.Wide310x150Logo,$g.Game.ShellVisuals.Square480x480Logo,$a.VisualElements.Square150x150Logo) | Where-Object { $_ }
                $games+=@{id=$id;title=$title;game=[bool]($gaming -or ($config -and $executable.Count -gt 0));visible=[bool]$visible;root=[string]$p.InstallLocation;images=@($images)}
            }
        }
    } catch {}
}
ConvertTo-Json -InputObject @($games) -Compress
"#;
    match powershell_json(script) {
        Ok(v) => {
            for item in v.as_array().into_iter().flatten() {
                if let Some(game) = xbox_game(item) {
                    report.games.push(game);
                }
            }
        }
        Err(e) => report.warnings.push(format!("Xbox/Game Pass: {e}")),
    }
}

/// Scan known locations, shallow local-volume folders and roots from `settings`; return deduplicated
/// discoveries, recoverable warnings and total elapsed time without launching games.
pub fn scan(settings: &Settings) -> ScanReport {
    let start = std::time::Instant::now();
    let mut report = ScanReport::default();
    let volumes = crate::volumes::local_volumes().unwrap_or_else(|error| {
        report
            .warnings
            .push(format!("Local volume discovery: {error}"));
        Vec::new()
    });
    let extra = crate::volumes::store_roots(&volumes, &mut report.warnings);
    let mut steam = default_steam_roots();
    steam.extend(settings.steam_roots.clone());
    steam.extend(extra.steam);
    let mut seen = HashSet::new();
    let mut libraries_seen = HashSet::new();
    for root in steam {
        if root.is_dir() && seen.insert(fs::canonicalize(&root).unwrap_or(root.clone())) {
            scan_steam_once(&root, &mut report, &mut libraries_seen);
        }
    }
    let h = home();
    let mut epic = settings.epic_roots.clone();
    epic.extend(extra.epic);
    if cfg!(windows) {
        epic.push(
            env_path("PROGRAMDATA", "C:\\ProgramData")
                .join("Epic/EpicGamesLauncher/Data/Manifests"),
        );
    }
    if cfg!(target_os = "macos") {
        epic.push(PathBuf::from(
            "/Users/Shared/Epic Games/EpicGamesLauncher/Data/Manifests",
        ));
    }
    let mut epic_seen = HashSet::new();
    for root in epic {
        if root.is_dir() && epic_seen.insert(root.canonicalize().unwrap_or(root.clone())) {
            scan_epic(&root, &mut report);
        }
    }
    let heroic = if cfg!(windows) {
        env_path("APPDATA", "").join("heroic")
    } else if cfg!(target_os = "macos") {
        h.join("Library/Application Support/heroic")
    } else {
        h.join(".config/heroic")
    };
    scan_heroic(&heroic, &mut report);
    if cfg!(target_os = "linux") {
        scan_heroic(
            &h.join(".var/app/com.heroicgameslauncher.hgl/config/heroic"),
            &mut report,
        );
    }
    let mut gog_seen = HashSet::new();
    for root in settings.gog_roots.iter().chain(&extra.gog) {
        scan_gog_once(root, &mut report, &mut gog_seen);
    }
    #[cfg(windows)]
    scan_windows(&mut report, &mut gog_seen);
    #[cfg(windows)]
    crate::integrations::scan(&mut report);
    let mut seen = HashSet::new();
    report
        .games
        .retain(|g| !is_system_game(g) && seen.insert(g.id.clone()));
    report.elapsed_ms = start.elapsed().as_millis();
    report
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Reject infrastructure and invisible/non-game applications while preserving genuine Xbox launch IDs.
    #[test]
    fn xbox_metadata_requires_a_visible_game_and_excludes_services() {
        let mut item = serde_json::json!({"id":"Microsoft.Avowed_8wekyb3d8bbwe!Game", "title":"Avowed", "visible":true, "game":true, "root":"C:/Games/Avowed", "images":["Assets/Splash.png", "../outside.png"]});
        let game = xbox_game(&item).unwrap();
        assert_eq!(game.id, "xbox:Microsoft.Avowed_8wekyb3d8bbwe!Game");
        assert_eq!(game.artwork_files, vec![PathBuf::from("Assets/Splash.png")]);
        for package in [
            "Microsoft.GamingServices",
            "Microsoft.XboxIdentityProvider",
            "Microsoft.XboxGameCallableUI",
            "Microsoft.GamingApp",
        ] {
            item["id"] = serde_json::json!(format!("{package}_8wekyb3d8bbwe!App"));
            assert!(xbox_game(&item).is_none());
        }
        item["id"] = serde_json::json!("Publisher.RealGame_123!Game");
        item["visible"] = serde_json::json!(false);
        assert!(xbox_game(&item).is_none());
        item["visible"] = serde_json::json!(true);
        item["game"] = serde_json::json!(false);
        assert!(xbox_game(&item).is_none());
        item["game"] = serde_json::json!(true);
        item["title"] = serde_json::json!("ms-resource:Name");
        assert!(xbox_game(&item).is_none());
    }
    #[test]
    fn steam_discovers_secondary_library_and_skips_incomplete_installs() {
        let d = tempfile::tempdir().unwrap();
        let root = d.path();
        fs::create_dir_all(root.join("steamapps/common/Space")).unwrap();
        fs::write(
            root.join("steamapps/appmanifest_42.acf"),
            r#""AppState" { "appid" "42" "name" "Space" "StateFlags" "4" "installdir" "Space" "LastPlayed" "1700000000" }"#,
        )
        .unwrap();
        fs::write(root.join("steamapps/appmanifest_43.acf"), r#""AppState" { "appid" "43" "name" "Pending" "StateFlags" "2" "installdir" "Pending" }"#).unwrap();
        let mut r = ScanReport::default();
        scan_steam(root, &mut r);
        assert_eq!(r.games.len(), 1);
        assert_eq!(r.games[0].id, "steam:42");
        assert_eq!(r.games[0].last_played, Some(1700000000));
        assert!(r.warnings.is_empty());
    }
    #[test]
    fn epic_encodes_ids_and_reports_broken_manifests() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("ok.item"), serde_json::json!({"AppName":"a b","DisplayName":"A game","InstallLocation":d.path(),"CatalogNamespace":"ns","CatalogItemId":"id"}).to_string()).unwrap();
        fs::write(d.path().join("bad.item"), "broken").unwrap();
        let mut r = ScanReport::default();
        scan_epic(d.path(), &mut r);
        assert_eq!(r.games.len(), 1);
        assert_eq!(r.warnings.len(), 1);
        if let LaunchTarget::Uri { uri } = &r.games[0].target {
            assert!(uri.contains("ns%3Aid%3Aa%20b"));
        } else {
            panic!();
        }
    }
    #[test]
    fn heroic_preserves_runner_and_ignores_missing_installations() {
        let d = tempfile::tempdir().unwrap();
        fs::create_dir_all(d.path().join("gog_store")).unwrap();
        fs::write(d.path().join("gog_store/installed.json"), serde_json::json!({"installed":[{"appName":"123","title":"Game","install_path":d.path()}]}).to_string()).unwrap();
        let mut r = ScanReport::default();
        scan_heroic(d.path(), &mut r);
        assert_eq!(r.games[0].id, "gog:123");
        if let LaunchTarget::Uri { uri } = &r.games[0].target {
            assert_eq!(uri, "heroic://launch?appName=123&runner=gog");
        }
    }
    #[test]
    fn gog_skips_dlc_and_starts_primary_task_without_shell() {
        let d = tempfile::tempdir().unwrap();
        fs::write(d.path().join("game.exe"), "fixture").unwrap();
        fs::write(d.path().join("goggame-10.info"), serde_json::json!({"gameId":"10","name":"Base Game","playTasks":[{"type":"FileTask","isPrimary":true,"path":"game.exe"}]}).to_string()).unwrap();
        fs::write(
            d.path().join("goggame-11.info"),
            serde_json::json!({"gameId":"11","rootGameId":"10","name":"DLC","playTasks":[]})
                .to_string(),
        )
        .unwrap();
        let mut r = ScanReport::default();
        scan_gog(d.path(), &mut r);
        assert_eq!(r.games.len(), 1);
        assert_eq!(r.games[0].id, "gog:10");
        assert!(r.warnings.is_empty());
        assert!(matches!(r.games[0].target, LaunchTarget::Executable { .. }));
    }
    /// Fresh discoveries and older cached RED wrapper targets use the same explicit direct task.
    #[test]
    fn gog_uses_manifest_direct_task_for_cached_red_wrapper() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        fs::create_dir(root.join("bin")).unwrap();
        fs::write(root.join("REDprelauncher.exe"), "").unwrap();
        fs::write(root.join("bin/game.exe"), "").unwrap();
        let manifest = serde_json::json!({
            "gameId": "42", "name": "RED Game",
            "playTasks": [
                {"type": "FileTask", "isPrimary": true, "name": "RED Game", "path": "REDprelauncher.exe"},
                {"type": "FileTask", "name": "RED Game", "path": "bin/game.exe", "workingDir": "bin"},
                {"type": "URLTask", "name": "Support", "path": "https://example.invalid"}
            ]
        });
        fs::write(root.join("goggame-42.info"), manifest.to_string()).unwrap();
        let cached = Game::new(
            "gog:42".into(),
            "RED Game".into(),
            Store::Gog,
            LaunchTarget::Executable {
                path: root.join("REDprelauncher.exe"),
                cwd: root.into(),
                args: vec![],
            },
        );
        let mut report = ScanReport::default();
        scan_gog(root, &mut report);
        assert_eq!(report.games.len(), 1);
        for target in [launch_target(&cached), report.games.remove(0).target] {
            let LaunchTarget::Executable { path, cwd, .. } = target else {
                panic!("expected executable");
            };
            assert_eq!(path, root.join("bin/game.exe").canonicalize().unwrap());
            assert_eq!(cwd, root.join("bin").canonicalize().unwrap());
        }
        let mut escaped = manifest;
        escaped["playTasks"][1]["workingDir"] = serde_json::json!("..");
        let Some(LaunchTarget::Executable { path, .. }) = gog_target(root, &escaped) else {
            panic!("expected wrapper fallback");
        };
        assert!(is_red_prelauncher(&path));
    }

    #[test]
    fn steam_follows_secondary_library_folders() {
        let root = tempfile::tempdir().unwrap();
        let secondary = tempfile::tempdir().unwrap();
        fs::create_dir_all(root.path().join("steamapps")).unwrap();
        let path = secondary.path().to_string_lossy().replace('\\', "\\\\");
        fs::write(
            root.path().join("steamapps/libraryfolders.vdf"),
            format!("\"libraryfolders\" {{ \"1\" {{ \"path\" \"{path}\" }} }}"),
        )
        .unwrap();
        fs::create_dir_all(secondary.path().join("steamapps/common/Test")).unwrap();
        fs::write(
            secondary.path().join("steamapps/appmanifest_42.acf"),
            r#""AppState" { "appid" "42" "name" "Test" "StateFlags" "4" "installdir" "Test" }"#,
        )
        .unwrap();
        let mut r = ScanReport::default();
        scan_steam(root.path(), &mut r);
        assert_eq!(r.games.len(), 1);
        assert_eq!(r.games[0].id, "steam:42");
    }

    /// Overlapping configured and volume-discovered roots parse each game and broken manifest once.
    #[test]
    fn overlapping_library_roots_do_not_repeat_manifest_work() {
        let steam = tempfile::tempdir().unwrap();
        fs::create_dir_all(steam.path().join("steamapps/common/Test")).unwrap();
        fs::write(
            steam.path().join("steamapps/appmanifest_42.acf"),
            r#""AppState" { "appid" "42" "name" "Test" "StateFlags" "4" "installdir" "Test" }"#,
        )
        .unwrap();
        fs::write(steam.path().join("steamapps/appmanifest_bad.acf"), "broken").unwrap();
        let mut report = ScanReport::default();
        let mut visited = HashSet::new();
        scan_steam_once(steam.path(), &mut report, &mut visited);
        scan_steam_once(&steam.path().join("."), &mut report, &mut visited);
        assert_eq!(report.games.len(), 1);
        assert_eq!(report.warnings.len(), 1);

        let gog = tempfile::tempdir().unwrap();
        let game = gog.path().join("Game");
        fs::create_dir(&game).unwrap();
        fs::write(game.join("goggame-bad.info"), "broken").unwrap();
        let mut report = ScanReport::default();
        let mut visited = HashSet::new();
        scan_gog_once(gog.path(), &mut report, &mut visited);
        scan_gog_once(&game, &mut report, &mut visited);
        assert_eq!(report.warnings.len(), 1);
    }
}
