//! Read-only Win32 registry adapter; no PowerShell processes, account databases or recursive disk scans.

use super::*;
use std::collections::HashMap;
use windows_sys::Win32::{
    Foundation::{ERROR_FILE_NOT_FOUND, ERROR_NO_MORE_ITEMS, ERROR_PATH_NOT_FOUND, ERROR_SUCCESS},
    System::Registry::*,
};

/// Owned registry handle; every successful open is closed even on parse or enumeration errors.
struct Key(HKEY);

impl Drop for Key {
    /// Release the handle owned by this key without mutating registry values.
    fn drop(&mut self) {
        unsafe {
            RegCloseKey(self.0);
        }
    }
}

impl Key {
    /// Open `path` under `parent` in explicit WOW64 `view`; absent keys are normal, other errors propagate.
    fn open(parent: HKEY, path: &str, view: u32) -> Result<Option<Self>, String> {
        let name: Vec<u16> = path.encode_utf16().chain(Some(0)).collect();
        let mut handle = std::ptr::null_mut();
        let result =
            unsafe { RegOpenKeyExW(parent, name.as_ptr(), 0, KEY_READ | view, &mut handle) };
        match result {
            ERROR_SUCCESS => Ok(Some(Self(handle))),
            ERROR_FILE_NOT_FOUND | ERROR_PATH_NOT_FOUND => Ok(None),
            _ => Err(format!("Registry read failed ({result}): {path}")),
        }
    }

    /// Read a bounded REG_SZ string named `name`; other value types and missing fields are ignored.
    fn string(&self, name: &str) -> Option<String> {
        let name: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
        let mut kind = 0;
        let mut size = 0;
        let result = unsafe {
            RegQueryValueExW(
                self.0,
                name.as_ptr(),
                std::ptr::null(),
                &mut kind,
                std::ptr::null_mut(),
                &mut size,
            )
        };
        if result != ERROR_SUCCESS || kind != REG_SZ || size == 0 || size > 65536 || size % 2 != 0 {
            return None;
        }
        let mut data = vec![0u16; (size / 2) as usize];
        let result = unsafe {
            RegQueryValueExW(
                self.0,
                name.as_ptr(),
                std::ptr::null(),
                &mut kind,
                data.as_mut_ptr().cast(),
                &mut size,
            )
        };
        if result != ERROR_SUCCESS || kind != REG_SZ {
            return None;
        }
        data.truncate((size / 2) as usize);
        while data.last() == Some(&0) {
            data.pop();
        }
        let value = String::from_utf16(&data).ok()?;
        (!value.contains('\0')).then_some(value)
    }

    /// Enumerate at most 4096 immediate child names; registry failures and exhausted budgets are reported.
    fn children(&self) -> Result<Vec<String>, String> {
        let mut result = Vec::new();
        for index in 0..4096 {
            let mut data = [0u16; 256];
            let mut length = data.len() as u32;
            let status = unsafe {
                RegEnumKeyExW(
                    self.0,
                    index,
                    data.as_mut_ptr(),
                    &mut length,
                    std::ptr::null(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                    std::ptr::null_mut(),
                )
            };
            if status == ERROR_NO_MORE_ITEMS {
                return Ok(result);
            }
            if status != ERROR_SUCCESS {
                return Err(format!("Registry enumeration failed ({status})"));
            }
            if let Ok(name) = String::from_utf16(&data[..length as usize]) {
                result.push(name);
            }
        }
        Err("Registry discovery exceeded 4096 entries".into())
    }
}

/// Minimal uninstall metadata used only for local discovery and known client executable locations.
#[derive(Default)]
struct Program {
    name: String,
    root: PathBuf,
    uninstall: String,
}

/// Normalize quoted installation directories without accepting relative paths or command arguments.
fn directory(value: String) -> Option<PathBuf> {
    let path = PathBuf::from(value.trim().trim_matches('"'));
    (path.is_absolute() && path.is_dir()).then_some(path)
}

/// Compare registered Windows paths without touching unrelated programs' disks or network shares.
fn path_key(path: &Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

/// Read immediate records below `path` from both per-user and machine views, appending recoverable errors.
fn records(path: &str, report: &mut ScanReport) -> Vec<(String, Key)> {
    let mut entries = Vec::new();
    for hive in [HKEY_LOCAL_MACHINE, HKEY_CURRENT_USER] {
        for view in [KEY_WOW64_32KEY, KEY_WOW64_64KEY] {
            let read = || -> Result<Vec<(String, Key)>, String> {
                let Some(key) = Key::open(hive, path, view)? else {
                    return Ok(vec![]);
                };
                let mut result = Vec::new();
                for name in key.children()? {
                    if let Some(child) = Key::open(key.0, &name, view)? {
                        result.push((name, child));
                    }
                }
                Ok(result)
            };
            match read() {
                Ok(values) => entries.extend(values),
                Err(error) => report.warnings.push(error),
            }
        }
    }
    entries
}

/// Find a known client from uninstall metadata or a conventional folder; never parse an executable from a command string.
fn client(
    programs: &[Program],
    name: &str,
    executable: &str,
    conventional: &str,
) -> Option<PathBuf> {
    programs
        .iter()
        .filter(|program| program.name.eq_ignore_ascii_case(name))
        .map(|program| program.root.join(executable))
        .chain(
            ["ProgramFiles(x86)", "ProgramFiles"]
                .into_iter()
                .filter_map(std::env::var_os)
                .map(|root| PathBuf::from(root).join(conventional).join(executable)),
        )
        .find(|path| path.is_absolute() && path.is_file())
}

/// Read all three providers through bounded native registry calls and Battle.net's local product database.
pub(super) fn scan(report: &mut ScanReport) {
    let programs: Vec<Program> = records(
        r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall",
        report,
    )
    .into_iter()
    .filter_map(|(_, key)| {
        Some(Program {
            name: key.string("DisplayName")?,
            root: PathBuf::from(key.string("InstallLocation")?.trim().trim_matches('"')),
            uninstall: key.string("UninstallString").unwrap_or_default(),
        })
    })
    .collect();
    let names: HashMap<String, &str> = programs
        .iter()
        .map(|program| (path_key(&program.root), program.name.as_str()))
        .collect();
    for (id, key) in records(r"SOFTWARE\Ubisoft\Launcher\Installs", report) {
        let Some(root) = key.string("InstallDir").and_then(directory) else {
            continue;
        };
        let title = names.get(&path_key(&root)).copied();
        if let Some(game) = ubisoft_game(&id, title, &root) {
            report.games.push(game);
        }
    }
    let battle = client(&programs, "Battle.net", "Battle.net.exe", "Battle.net");
    let rockstar = client(
        &programs,
        "Rockstar Games Launcher",
        "Launcher.exe",
        "Rockstar Games/Launcher",
    );
    for program in &programs {
        let command = program.uninstall.to_ascii_lowercase();
        if let Some(client) = &battle {
            if command.contains("battle.net") {
                if let Some(id) = option_id(&program.uninstall, "--uid=") {
                    if let Some(game) = battle_game(id, &program.root, client) {
                        report.games.push(game);
                    }
                }
            }
        }
        if let Some(client) = &rockstar {
            if command.contains("launcher.exe") || command.contains("uninstall.exe") {
                if let Some(id) = option_id(&program.uninstall, "-uninstall=") {
                    if let Some(game) = rockstar_game(id, &program.root, client) {
                        report.games.push(game);
                    }
                }
            }
        }
    }
    if let Some(client) = battle {
        let path = PathBuf::from(
            std::env::var_os("PROGRAMDATA").unwrap_or_else(|| r"C:\ProgramData".into()),
        )
        .join("Battle.net/Agent/product.db");
        if path.is_file() {
            match read_database(&path).and_then(|bytes| battle_records(&bytes)) {
                Ok(records) => {
                    for (id, root) in records {
                        if let Some(game) = battle_game(&id, &root, &client) {
                            report.games.push(game);
                        }
                    }
                }
                Err(error) => report
                    .warnings
                    .push(format!("Battle.net product.db: {error}")),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Registry path parsing removes quoting but does not accept relative or missing installations.
    #[test]
    fn directory_values_are_existing_absolute_paths() {
        let temp = tempfile::tempdir().unwrap();
        assert_eq!(
            directory(format!("\"{}\"", temp.path().display())),
            Some(temp.path().into())
        );
        assert!(directory("relative/game".into()).is_none());
        assert!(directory(temp.path().join("missing").display().to_string()).is_none());
    }
}
