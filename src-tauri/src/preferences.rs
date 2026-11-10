//! Transaction boundary between application preferences and the OS login registration.

/// Build a per-user Windows login entry for absolute `executable`, explicitly quoting paths with spaces.
/// Construction performs no OS writes. Reject characters that cannot form a Windows executable path.
#[cfg(windows)]
fn windows_login_entry(executable: &std::path::Path) -> Result<auto_launch::AutoLaunch, String> {
    let path = executable
        .to_str()
        .ok_or("Executable path is not valid Unicode")?;
    if !executable.is_absolute() || path.contains(['"', '\r', '\n', '\0']) {
        return Err("Invalid login executable path".into());
    }
    auto_launch::AutoLaunchBuilder::new()
        .set_app_name("Quickload")
        .set_app_path(&format!("\"{path}\""))
        .set_windows_enable_mode(auto_launch::WindowsEnableMode::CurrentUser)
        .build()
        .map_err(|error| error.to_string())
}

/// Read the OS login state for `app` using the same backend as registration.
pub(crate) fn login_enabled(app: &tauri::AppHandle) -> Result<bool, String> {
    #[cfg(windows)]
    {
        let _ = app;
        windows_login_entry(&std::env::current_exe().map_err(|error| error.to_string())?)?
            .is_enabled()
            .map_err(|error| error.to_string())
    }
    #[cfg(not(windows))]
    {
        use tauri_plugin_autostart::ManagerExt;
        app.autolaunch()
            .is_enabled()
            .map_err(|error| error.to_string())
    }
}

/// Change login registration for `app` to `enabled`; Windows needs a quoted executable path.
pub(crate) fn set_login(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        let _ = app;
        let manager =
            windows_login_entry(&std::env::current_exe().map_err(|error| error.to_string())?)?;
        (if enabled {
            manager.enable()
        } else {
            manager.disable()
        })
        .map_err(|error| error.to_string())
    }
    #[cfg(not(windows))]
    {
        use tauri_plugin_autostart::ManagerExt;
        let manager = app.autolaunch();
        (if enabled {
            manager.enable()
        } else {
            manager.disable()
        })
        .map_err(|error| error.to_string())
    }
}

/// Apply login change `next` from actual `previous`, then `persist` settings. Restore the previous
/// registration if persistence fails. Injected callbacks allow failure tests without editing the OS.
pub(crate) fn save_with_login<T>(
    previous: bool,
    next: bool,
    set_login: impl Fn(bool) -> Result<(), String>,
    persist: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    if previous != next {
        if let Err(error) = set_login(next) {
            return match set_login(previous) {
                Ok(()) => Err(error),
                Err(rollback) => Err(format!(
                    "{error}; login registration could not be restored: {rollback}"
                )),
            };
        }
    }
    match persist() {
        Ok(value) => Ok(value),
        Err(error) => {
            if previous != next {
                if let Err(rollback) = set_login(previous) {
                    return Err(format!(
                        "{error}; login registration could not be restored: {rollback}"
                    ));
                }
            }
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// Windows startup paths remain a single quoted executable even inside Program Files.
    #[cfg(windows)]
    #[test]
    fn login_paths_are_quoted_without_registering_them() {
        let manager = windows_login_entry(std::path::Path::new(
            r"C:\Program Files\Quickload\quickload.exe",
        ))
        .unwrap();
        assert_eq!(
            manager.get_app_path(),
            r#""C:\Program Files\Quickload\quickload.exe""#
        );
        assert!(windows_login_entry(std::path::Path::new("quickload.exe")).is_err());
        assert!(windows_login_entry(std::path::Path::new("C:/Quickload/invalid\".exe")).is_err());
    }

    /// A denied OS change cannot publish a preference claiming that autostart is active.
    #[test]
    fn registration_failure_does_not_persist() {
        let result = save_with_login(
            false,
            true,
            |_| Err("denied".into()),
            || -> Result<(), String> { panic!("must not persist") },
        );
        assert!(result.unwrap_err().starts_with("denied"));
    }

    /// An OS API can change registration before reporting a later error; restore it in that case too.
    #[test]
    fn partial_registration_failure_is_rolled_back() {
        let calls = RefCell::new(Vec::new());
        let result = save_with_login(
            false,
            true,
            |enabled| {
                calls.borrow_mut().push(enabled);
                if enabled {
                    Err("partial failure".into())
                } else {
                    Ok(())
                }
            },
            || -> Result<(), String> { panic!("must not persist") },
        );
        assert_eq!(result.unwrap_err(), "partial failure");
        assert_eq!(*calls.borrow(), vec![true, false]);
    }

    /// Failed persistence restores the prior login registration rather than leaving a hidden side effect.
    #[test]
    fn storage_failure_restores_registration() {
        let calls = RefCell::new(Vec::new());
        let result = save_with_login(
            false,
            true,
            |value| {
                calls.borrow_mut().push(value);
                Ok(())
            },
            || -> Result<(), String> { Err("disk full".into()) },
        );
        assert_eq!(result.unwrap_err(), "disk full");
        assert_eq!(*calls.borrow(), vec![true, false]);
    }

    /// Unrelated preferences never rewrite the OS registration, while reset can disable it.
    #[test]
    fn unchanged_registration_is_not_written() {
        assert_eq!(
            save_with_login(false, false, |_| panic!("unexpected OS write"), || Ok(42)),
            Ok(42)
        );
        assert_eq!(
            save_with_login(
                true,
                false,
                |enabled| {
                    assert!(!enabled);
                    Ok(())
                },
                || Ok(7)
            ),
            Ok(7)
        );
    }
}
