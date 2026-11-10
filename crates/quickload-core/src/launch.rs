use crate::{Game, LaunchTarget, Store};
use std::{
    path::Path,
    process::{Child, Command, Stdio},
    time::{Duration, Instant},
};

/// Observed outcome of a local start attempt. A handoff does not prove a game is running.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LaunchStatus {
    HandedOff,
    Running,
    Failed,
}

/// Copyable evidence from a launch attempt. No logs or environment variables are included.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchReport {
    pub status: LaunchStatus,
    pub route: &'static str,
    pub executable: Option<std::path::PathBuf>,
    pub pid: Option<u32>,
    pub exit_code: Option<i32>,
    pub error: Option<String>,
}

impl LaunchReport {
    /// Initialize an unconfirmed attempt for the chosen `route`.
    fn new(route: &'static str) -> Self {
        Self {
            status: LaunchStatus::HandedOff,
            route,
            executable: None,
            pid: None,
            exit_code: None,
            error: None,
        }
    }
}

/// Validate encoded store identifiers, including UTF-8, spaces and Epic's colon separators.
/// Reject escaped ASCII delimiters and control characters before Windows expands protocol arguments.
fn encoded_id(value: &str) -> bool {
    if value.is_empty() {
        return false;
    }
    let mut bytes = value.as_bytes().iter().copied();
    while let Some(byte) = bytes.next() {
        if byte == b'%' {
            let Some(high) = bytes.next().and_then(|b| (b as char).to_digit(16)) else {
                return false;
            };
            let Some(low) = bytes.next().and_then(|b| (b as char).to_digit(16)) else {
                return false;
            };
            let decoded = (high * 16 + low) as u8;
            if decoded.is_ascii() && !matches!(decoded, b' ' | b':') {
                return false;
            }
        } else if !(byte.is_ascii_alphanumeric() || b"-_.~".contains(&byte)) {
            return false;
        }
    }
    true
}

/// Build the current Heroic shortcut for the allowlisted `runner` and already encoded `id`.
pub(crate) fn heroic_uri(runner: &str, id: &str) -> String {
    format!("heroic://launch?appName={id}&runner={runner}")
}

/// Return the runner and encoded app ID carried by an older cached Heroic shortcut.
fn legacy_heroic(uri: &str) -> Option<(&str, &str)> {
    let (runner, id) = uri.strip_prefix("heroic://launch/")?.split_once('/')?;
    (matches!(runner, "legendary" | "gog") && encoded_id(id)).then_some((runner, id))
}

/// Validate display `title` and absolute executable/bundle `path`, then construct a stable manual entry. Invalid names, paths or platform permissions return an error.
pub fn manual_game(title: &str, path: &Path) -> Result<Game, String> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 160 {
        return Err("Enter a name with 1–160 characters".into());
    }
    if !path.is_absolute() {
        return Err("Choose an absolute path".into());
    }
    let path = path
        .canonicalize()
        .map_err(|e| format!("Pfad nicht erreichbar: {e}"))?;
    let target = if cfg!(target_os = "macos")
        && path.extension().is_some_and(|e| e == "app")
        && path.is_dir()
    {
        LaunchTarget::MacApp { path: path.clone() }
    } else {
        if !path.is_file() {
            return Err("Choose an executable file".into());
        }
        if cfg!(windows)
            && !path
                .extension()
                .is_some_and(|e| e.eq_ignore_ascii_case("exe"))
        {
            return Err("Choose an .exe file on Windows".into());
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if path
                .metadata()
                .map_err(|e| e.to_string())?
                .permissions()
                .mode()
                & 0o111
                == 0
            {
                return Err("The file is not executable".into());
            }
        }
        LaunchTarget::Executable {
            cwd: path.parent().ok_or("Working directory is missing")?.into(),
            path: path.clone(),
            args: vec![],
        }
    };
    // Stable per-file id; no hash randomization across process starts.
    let hash = path
        .to_string_lossy()
        .bytes()
        .fold(0xcbf29ce484222325u64, |h, b| {
            (h ^ b as u64).wrapping_mul(0x100000001b3)
        });
    Ok(Game::new(
        format!("manual:{hash:016x}"),
        title.into(),
        Store::Manual,
        target,
    ))
}

/// Return whether `uri` uses an allowed store protocol and safe protocol-specific characters; no shell syntax is accepted.
pub fn valid_uri(uri: &str) -> bool {
    if let Some(id) = uri.strip_prefix("uplay://launch/") {
        return !id.is_empty() && id.len() <= 20 && id.bytes().all(|byte| byte.is_ascii_digit());
    }
    if let Some(id) = uri.strip_prefix("steam://rungameid/") {
        return !id.is_empty() && id.bytes().all(|b| b.is_ascii_digit());
    }
    if let Some(id) = uri
        .strip_prefix("com.epicgames.launcher://apps/")
        .and_then(|value| value.strip_suffix("?action=launch&silent=true"))
    {
        return encoded_id(id);
    }
    if let Some((id, runner)) = uri
        .strip_prefix("heroic://launch?appName=")
        .and_then(|value| value.split_once("&runner="))
    {
        return encoded_id(id) && matches!(runner, "legendary" | "gog");
    }
    legacy_heroic(uri).is_some()
}

#[cfg(windows)]
/// Ask Windows to dispatch validated `uri` to its registered handler and return the OS error on failure.
fn open_windows_uri(uri: &str) -> std::io::Result<()> {
    use windows_sys::Win32::{
        System::Com::{
            CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
        },
        UI::{
            Shell::{
                AssocQueryStringW, ShellExecuteExW, ASSOCF_INIT_IGNOREUNKNOWN, ASSOCF_IS_PROTOCOL,
                ASSOCSTR_EXECUTABLE, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC, SHELLEXECUTEINFOW,
            },
            WindowsAndMessaging::SW_SHOWNORMAL,
        },
    };

    let url: Vec<u16> = uri.encode_utf16().chain(Some(0)).collect();
    let verb = windows_sys::w!("open");
    let scheme: Vec<u16> = uri
        .split_once(':')
        .map_or(uri, |(scheme, _)| scheme)
        .encode_utf16()
        .chain(Some(0))
        .collect();
    let mut request = SHELLEXECUTEINFOW {
        cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
        fMask: SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI,
        lpVerb: verb,
        lpFile: url.as_ptr(),
        nShow: SW_SHOWNORMAL,
        ..Default::default()
    };
    // The URL and structure outlive the call. No process handle is requested.
    unsafe {
        let com = CoInitializeEx(
            std::ptr::null(),
            (COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE) as u32,
        );
        if com < 0 {
            return Err(std::io::Error::other(format!(
                "COM HRESULT 0x{:08X}",
                com as u32
            )));
        }
        // Without this lookup, Windows can report success for its app picker on an unknown scheme.
        let mut required = 0;
        let association = AssocQueryStringW(
            ASSOCF_IS_PROTOCOL | ASSOCF_INIT_IGNOREUNKNOWN,
            ASSOCSTR_EXECUTABLE,
            scheme.as_ptr(),
            verb,
            std::ptr::null_mut(),
            &mut required,
        );
        let result = if association < 0 || required <= 1 {
            Err(std::io::Error::from_raw_os_error(
                windows_sys::Win32::Foundation::ERROR_NO_ASSOCIATION as i32,
            ))
        } else if ShellExecuteExW(&mut request) == 0 {
            Err(std::io::Error::last_os_error())
        } else {
            Ok(())
        };
        CoUninitialize();
        result
    }
}

#[cfg(windows)]
/// Read a nonempty Steam path value from `key` and the registry view selected by `flags`.
fn steam_registry_path(
    key: windows_sys::Win32::System::Registry::HKEY,
    name: windows_sys::core::PCWSTR,
    flags: u32,
) -> Option<std::path::PathBuf> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::System::Registry::{RegGetValueW, RRF_RT_REG_SZ};

    let mut path = vec![0u16; 32768];
    let mut size = (path.len() * std::mem::size_of::<u16>()) as u32;
    // The buffer is sized in bytes as required by RegGetValueW and is valid for the whole call.
    let result = unsafe {
        RegGetValueW(
            key,
            windows_sys::w!("Software\\Valve\\Steam"),
            name,
            flags | RRF_RT_REG_SZ,
            std::ptr::null_mut(),
            path.as_mut_ptr().cast(),
            &mut size,
        )
    };
    let end = path.iter().position(|&unit| unit == 0)?;
    (result == 0 && end > 0)
        .then(|| std::path::PathBuf::from(std::ffi::OsString::from_wide(&path[..end])))
}

#[cfg(windows)]
/// Build a Steam command for numeric `id` using the first existing absolute Steam executable.
fn steam_command(
    id: &str,
    candidates: impl IntoIterator<Item = std::path::PathBuf>,
) -> Option<Command> {
    if !id.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    let id = id.parse::<std::num::NonZeroU32>().ok()?;
    let client = candidates.into_iter().find(|path| {
        path.is_absolute()
            && path
                .file_name()
                .is_some_and(|name| name.eq_ignore_ascii_case("steam.exe"))
            && path.is_file()
    })?;
    let mut cmd = Command::new(&client);
    cmd.args(["-applaunch", &id.to_string()])
        .current_dir(client.parent()?);
    Some(cmd)
}

#[cfg(windows)]
/// Resolve a cached Steam `uri` through Valve's installation records and conventional paths.
fn windows_steam_command(uri: &str) -> Option<Command> {
    use windows_sys::Win32::System::Registry::{
        HKEY_CURRENT_USER, HKEY_LOCAL_MACHINE, RRF_SUBKEY_WOW6432KEY,
    };
    let id = uri.strip_prefix("steam://rungameid/")?;
    let per_user = steam_registry_path(HKEY_CURRENT_USER, windows_sys::w!("SteamExe"), 0);
    let machine = || {
        steam_registry_path(
            HKEY_LOCAL_MACHINE,
            windows_sys::w!("InstallPath"),
            RRF_SUBKEY_WOW6432KEY,
        )
        .map(|path| path.join("steam.exe"))
    };
    let conventional = ["ProgramFiles(x86)", "ProgramFiles"]
        .into_iter()
        .filter_map(|name| {
            std::env::var_os(name)
                .map(|path| std::path::PathBuf::from(path).join("Steam/steam.exe"))
        });
    steam_command(
        id,
        per_user
            .into_iter()
            .chain(std::iter::once_with(machine).flatten())
            .chain(conventional),
    )
}

/// Read newly appended Steam process records for `id` after `offset`, within a bounded tail.
fn steam_game_pid(log: &Path, offset: u64, id: &str) -> Option<u32> {
    use std::io::{Read, Seek, SeekFrom};
    let mut file = std::fs::File::open(log).ok()?;
    let size = file.metadata().ok()?.len();
    let start = if size < offset { 0 } else { offset };
    if size == start {
        return None;
    }
    file.seek(SeekFrom::Start(start.max(size.saturating_sub(65536))))
        .ok()?;
    let mut bytes = Vec::new();
    file.take(65536).read_to_end(&mut bytes).ok()?;
    let prefix = format!("AppID {id} adding PID ");
    String::from_utf8_lossy(&bytes).lines().find_map(|line| {
        let (_, record) = line.split_once("] ")?;
        record
            .strip_prefix(&prefix)?
            .split_whitespace()
            .next()?
            .parse()
            .ok()
    })
}

/// Observe `child` on the caller's blocking worker and record evidence for `report`.
/// A Steam client exit by itself does not confirm a game process.
fn observe(
    mut child: Child,
    mut report: LaunchReport,
    direct: bool,
    steam: Option<(&Path, u64, &str)>,
) -> LaunchReport {
    let window = if steam.is_some() {
        Duration::from_secs(4)
    } else {
        Duration::from_millis(700)
    };
    let deadline = Instant::now() + window;
    let mut reaped = false;
    loop {
        if let Some((log, offset, id)) = steam {
            if let Some(pid) = steam_game_pid(log, offset, id) {
                report.status = LaunchStatus::Running;
                report.pid = Some(pid);
                report.error = None;
                break;
            }
        }
        if !reaped {
            match child.try_wait() {
                Ok(Some(status)) => {
                    reaped = true;
                    report.exit_code = status.code();
                    if !status.success() {
                        report.status = LaunchStatus::Failed;
                        report.error = Some(status.to_string());
                    }
                    if steam.is_none() {
                        break;
                    }
                }
                Err(error) => {
                    report.error = Some(error.to_string());
                    break;
                }
                Ok(None) => {}
            }
        }
        if Instant::now() >= deadline {
            if direct && !reaped {
                report.status = LaunchStatus::Running;
                report.pid = Some(child.id());
            }
            break;
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    if !reaped {
        std::thread::spawn(move || {
            let _ = child.wait();
        });
    }
    report
}

/// Identify client handoffs in `target`, whose running process does not establish that the game started.
fn client_handoff(target: &LaunchTarget) -> bool {
    let LaunchTarget::Executable { path, args, .. } = target else {
        return false;
    };
    path.file_name().is_some_and(|name| {
        name.eq_ignore_ascii_case("REDprelauncher.exe")
            || (name.eq_ignore_ascii_case("Battle.net.exe")
                && args
                    .first()
                    .is_some_and(|arg| arg.starts_with("--exec=launch ")))
            || (name.eq_ignore_ascii_case("Launcher.exe")
                && args
                    .first()
                    .is_some_and(|arg| arg == "-launchTitleInFolder"))
    })
}

/// Dispatch validated `target`, returning observed status and errors for a local diagnostic.
pub fn launch(target: &LaunchTarget) -> Result<LaunchReport, String> {
    let mut report = LaunchReport::new(match target {
        LaunchTarget::Uri { .. } => "Store URI",
        LaunchTarget::Executable { .. } => {
            if client_handoff(target) {
                "Store client"
            } else {
                "Executable"
            }
        }
        LaunchTarget::MacApp { .. } => "macOS application",
        LaunchTarget::Xbox { .. } => "Xbox AppsFolder",
    });
    #[allow(unused_mut)]
    let mut steam_log = None;
    let mut cmd = match target {
        LaunchTarget::Uri { uri } => {
            if !valid_uri(uri) {
                return Err("Launch protocol is not allowed".into());
            }
            let upgraded = legacy_heroic(uri).map(|(runner, id)| heroic_uri(runner, id));
            let uri = upgraded.as_deref().unwrap_or(uri);
            #[cfg(windows)]
            if let Some(steam) = windows_steam_command(uri) {
                report.route = "Steam -applaunch";
                let log = steam
                    .get_current_dir()
                    .expect("Steam working directory")
                    .join("logs/gameprocess_log.txt");
                let offset = std::fs::metadata(&log).map_or(0, |metadata| metadata.len());
                steam_log = Some((
                    log,
                    offset,
                    uri.strip_prefix("steam://rungameid/")
                        .unwrap_or("")
                        .to_owned(),
                ));
                steam
            } else {
                return open_windows_uri(uri).map(|()| report).map_err(|error| {
                    if error.raw_os_error()
                        == Some(windows_sys::Win32::Foundation::ERROR_NO_ASSOCIATION as i32)
                    {
                        "No store client is registered for this game".into()
                    } else {
                        format!("Start fehlgeschlagen: {error}")
                    }
                });
            }
            #[cfg(not(windows))]
            {
                let mut cmd = Command::new(if cfg!(target_os = "macos") {
                    "open"
                } else {
                    "xdg-open"
                });
                cmd.arg(uri);
                cmd
            }
        }
        LaunchTarget::Executable { path, args, cwd } => {
            if !path.is_file() || !path.is_absolute() {
                return Err("The game file no longer exists".into());
            }
            if !cwd.is_absolute() || !cwd.is_dir() {
                return Err("The game working directory is unavailable".into());
            }
            let mut cmd = Command::new(path);
            cmd.args(args).current_dir(cwd);
            cmd
        }
        LaunchTarget::MacApp { path } => {
            if !cfg!(target_os = "macos") || !path.is_dir() {
                return Err("This macOS app is unavailable".into());
            }
            let mut cmd = Command::new("open");
            cmd.arg("-a").arg(path);
            cmd
        }
        LaunchTarget::Xbox { aumid } => {
            if !cfg!(windows)
                || aumid.is_empty()
                || !aumid
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"._!-".contains(&b))
            {
                return Err("Invalid Xbox app ID".into());
            }
            let mut cmd = Command::new("explorer.exe");
            cmd.arg(format!("shell:AppsFolder\\{aumid}"));
            cmd
        }
    };
    if matches!(target, LaunchTarget::Executable { .. }) || steam_log.is_some() {
        report.executable = Some(cmd.get_program().into());
    }
    // No command interpreter or frontend-supplied command string.
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let child = match cmd.spawn() {
        Ok(child) => child,
        Err(error) => {
            report.status = LaunchStatus::Failed;
            report.error = Some(error.to_string());
            return Ok(report);
        }
    };
    if matches!(target, LaunchTarget::Xbox { .. }) {
        let mut child = child;
        std::thread::spawn(move || {
            let _ = child.wait();
        });
        return Ok(report);
    }
    Ok(observe(
        child,
        report,
        matches!(target, LaunchTarget::Executable { .. }) && !client_handoff(target),
        steam_log
            .as_ref()
            .map(|(path, offset, id): &(std::path::PathBuf, u64, String)| {
                (path.as_path(), *offset, id.as_str())
            }),
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    /// Use a fake Steam installation to verify the literal application ID and working directory.
    #[cfg(windows)]
    #[test]
    fn steam_routes_a_cached_app_id_to_the_client_executable() {
        let root = tempfile::Builder::new()
            .prefix("Steam library ")
            .tempdir()
            .unwrap();
        let client = root.path().join("Steam.exe");
        std::fs::write(&client, "").unwrap();
        let command = steam_command(
            "42",
            [root.path().join("missing/steam.exe"), client.clone()],
        )
        .unwrap();
        assert_eq!(command.get_program(), client.as_os_str());
        assert_eq!(command.get_current_dir(), Some(root.path()));
        assert_eq!(command.get_args().collect::<Vec<_>>(), ["-applaunch", "42"]);
        assert!(steam_command("42 -shutdown", [client.clone()]).is_none());
        assert!(steam_command("0", [client]).is_none());
    }
    /// Verify that allowed store routes cannot carry additional parameters or encoded shell syntax.
    #[test]
    fn rejects_shell_and_protocol_injection() {
        assert!(valid_uri("uplay://launch/123"));
        for invalid in [
            "uplay://launch/",
            "uplay://launch/12&calc",
            "uplay://launch/12/0",
            "uplay://launch/%22",
        ] {
            assert!(!valid_uri(invalid));
        }
        assert!(!valid_uri("https://evil.invalid"));
        assert!(!valid_uri("steam://rungameid/42 & calc"));
        assert!(!valid_uri("com.epicgames.launcher://apps/a\""));
        assert!(valid_uri("steam://rungameid/42"));
        assert!(valid_uri("heroic://launch/gog/123"));
        assert!(valid_uri("heroic://launch?appName=123&runner=gog"));
        assert!(!valid_uri("heroic://launch?appName=123&runner=gog&extra=x"));
        assert!(valid_uri(
            "com.epicgames.launcher://apps/ns%3Aitem%3Aa%20b?action=launch&silent=true"
        ));
        assert!(!valid_uri(
            "com.epicgames.launcher://apps/%22?action=launch&silent=true"
        ));
    }
    /// Client processes are handoffs, while actual game executables can establish a running game.
    #[test]
    fn launcher_processes_are_not_game_evidence() {
        for (name, argument, expected) in [
            ("Battle.net.exe", "--exec=launch Fen", true),
            ("Launcher.exe", "-launchTitleInFolder", true),
            ("Game.exe", "", false),
        ] {
            let target = LaunchTarget::Executable {
                path: name.into(),
                args: vec![argument.into()],
                cwd: "unused".into(),
            };
            assert_eq!(client_handoff(&target), expected);
        }
    }
    /// Verify that Windows reports an unregistered protocol as a dispatch failure.
    #[cfg(windows)]
    #[test]
    fn windows_rejects_unregistered_protocol() {
        let error = open_windows_uri("quickload-unregistered-test-scheme://launch").unwrap_err();
        assert_eq!(
            error.raw_os_error(),
            Some(windows_sys::Win32::Foundation::ERROR_NO_ASSOCIATION as i32)
        );
    }
    /// Confirm executable dispatch sets the working directory and passes arguments literally.
    #[test]
    fn dispatches_executable_with_working_directory() {
        let temp = tempfile::tempdir().unwrap();
        let cwd = temp.path().join("quickload-launch-fixture");
        std::fs::create_dir(&cwd).unwrap();
        launch(&LaunchTarget::Executable {
            path: std::env::current_exe().unwrap(),
            cwd: cwd.clone(),
            args: vec!["--exact".into(), "launch::tests::child_fixture".into()],
        })
        .unwrap();
        let marker = cwd.join("started");
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
        while !marker.is_file() && std::time::Instant::now() < deadline {
            std::thread::sleep(std::time::Duration::from_millis(10));
        }
        assert!(
            marker.is_file(),
            "fixture did not start in its assigned working directory"
        );
    }
    /// Write a harmless marker only when invoked inside the isolated launch fixture directory.
    #[test]
    fn child_fixture() {
        let cwd = std::env::current_dir().unwrap();
        if cwd.ends_with("quickload-failed-launch-fixture") {
            std::process::exit(37);
        }
        if cwd.ends_with("quickload-launch-fixture") {
            std::fs::write(cwd.join("started"), "").unwrap();
        }
    }
    /// Capture the actual exit code when an executable starts and then fails immediately.
    #[test]
    fn observes_early_process_failure() {
        let temp = tempfile::tempdir().unwrap();
        let cwd = temp.path().join("quickload-failed-launch-fixture");
        std::fs::create_dir(&cwd).unwrap();
        let report = launch(&LaunchTarget::Executable {
            path: std::env::current_exe().unwrap(),
            cwd,
            args: vec!["--exact".into(), "launch::tests::child_fixture".into()],
        })
        .unwrap();
        assert!(matches!(report.status, LaunchStatus::Failed));
        assert_eq!(report.exit_code, Some(37));
    }
    /// Ignore older Steam records and unrelated app IDs when looking for a fresh process.
    #[test]
    fn steam_observes_only_new_process_entries_for_the_requested_app() {
        let temp = tempfile::tempdir().unwrap();
        let log = temp.path().join("gameprocess_log.txt");
        let old = "[2026-11-07 10:00:00] AppID 42 adding PID 123 as a tracked process\n";
        std::fs::write(&log, format!("{old}[2026-11-07 10:00:01] AppID 43 adding PID 456 as a tracked process\n[2026-11-07 10:00:02] AppID 42 adding PID 789 as a tracked process\n")).unwrap();
        assert_eq!(steam_game_pid(&log, old.len() as u64, "42"), Some(789));
        assert_eq!(steam_game_pid(&log, old.len() as u64, "44"), None);
    }
    /// Reject relative manual targets instead of resolving them against the launcher's directory.
    #[test]
    fn refuses_relative_manual_paths() {
        assert!(manual_game("Game", Path::new("game.exe")).is_err());
    }
}
