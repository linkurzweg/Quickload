//! Optional global focus shortcut, with rollback when registration or persistence fails.
use std::sync::Mutex;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Modifiers, Shortcut};

/// Actual registered shortcut, independent of a saved preference whose startup registration failed.
#[derive(Default)]
pub(crate) struct FocusShortcut(pub Mutex<Option<Shortcut>>);

/// Parse enabled settings and require two modifiers to avoid ordinary typing and common OS bindings.
pub(crate) fn desired(settings: &quickload_core::Settings) -> Result<Option<Shortcut>, String> {
    if !settings.focus_shortcut_enabled {
        return Ok(None);
    }
    let shortcut: Shortcut = settings
        .focus_shortcut
        .parse()
        .map_err(|_| "Invalid focus shortcut".to_string())?;
    let modifiers = [
        Modifiers::CONTROL,
        Modifiers::ALT,
        Modifiers::SHIFT,
        Modifiers::SUPER,
    ];
    if modifiers
        .iter()
        .filter(|modifier| shortcut.mods.contains(**modifier))
        .count()
        < 2
    {
        return Err("Choose a shortcut with at least two modifiers".into());
    }
    Ok(Some(shortcut))
}

/// Register `next` before releasing `previous`, preserving the old binding on conflicts.
fn replace(
    previous: Option<Shortcut>,
    next: Option<Shortcut>,
    register: &impl Fn(Shortcut) -> Result<(), String>,
    unregister: &impl Fn(Shortcut) -> Result<(), String>,
) -> Result<(), String> {
    if previous == next {
        return Ok(());
    }
    if let Some(shortcut) = next {
        register(shortcut)?;
    }
    if let Some(shortcut) = previous {
        if let Err(error) = unregister(shortcut) {
            if let Some(added) = next {
                unregister(added)?;
            }
            return Err(error);
        }
    }
    Ok(())
}

/// Apply a binding and persist settings with injected OS callbacks; restore the prior binding on failure.
pub(crate) fn save<T>(
    previous: Option<Shortcut>,
    next: Option<Shortcut>,
    register: impl Fn(Shortcut) -> Result<(), String>,
    unregister: impl Fn(Shortcut) -> Result<(), String>,
    persist: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    replace(previous, next, &register, &unregister)?;
    match persist() {
        Ok(result) => Ok(result),
        Err(error) => {
            replace(next, previous, &register, &unregister)
                .map_err(|rollback| format!("{error}; shortcut rollback failed: {rollback}"))?;
            Err(error)
        }
    }
}

/// Persist `settings` through `persist` while updating the actual native registration for `app`.
pub(crate) fn save_native<T>(
    app: &tauri::AppHandle,
    settings: &quickload_core::Settings,
    persist: impl FnOnce() -> Result<T, String>,
) -> Result<T, String> {
    use tauri::Manager;
    let state = app.state::<FocusShortcut>();
    let mut active = state.0.lock().map_err(|_| "Shortcut state is locked")?;
    let next = desired(settings)?;
    let result = save(
        *active,
        next,
        |key| {
            app.global_shortcut()
                .register(key)
                .map_err(|e| format!("Shortcut unavailable: {e}"))
        },
        |key| {
            app.global_shortcut()
                .unregister(key)
                .map_err(|e| e.to_string())
        },
        persist,
    )?;
    *active = next;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    /// Missing preferences disable registration; single-modifier bindings are rejected when enabled.
    #[test]
    fn defaults_and_validation() {
        let mut settings = quickload_core::Settings::default();
        assert_eq!(desired(&settings).unwrap(), None);
        settings.focus_shortcut_enabled = true;
        assert!(desired(&settings).unwrap().is_some());
        settings.focus_shortcut = "Ctrl+Q".into();
        assert!(desired(&settings).is_err());
    }

    /// A conflict preserves the existing shortcut and never persists the rejected setting.
    #[test]
    fn conflict_preserves_previous() {
        let old = "Ctrl+Shift+F12".parse().unwrap();
        let new = "Ctrl+Shift+F11".parse().unwrap();
        assert!(save(
            Some(old),
            Some(new),
            |_| Err("occupied".into()),
            |_| panic!("must retain old shortcut"),
            || Ok(())
        )
        .is_err());
    }

    /// Disk failure after disabling restores the previous native registration.
    #[test]
    fn persistence_failure_restores_binding() {
        let key = "Ctrl+Shift+F12".parse().unwrap();
        let calls = RefCell::new(Vec::new());
        let result = save(
            Some(key),
            None,
            |_| {
                calls.borrow_mut().push("register");
                Ok(())
            },
            |_| {
                calls.borrow_mut().push("unregister");
                Ok(())
            },
            || Err::<(), _>("disk failure".into()),
        );
        assert!(result.is_err());
        assert_eq!(*calls.borrow(), ["unregister", "register"]);
    }
}
