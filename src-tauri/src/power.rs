use crate::{is_fullscreen, AppState};
use std::process::{Command, Stdio};
use tauri::{async_runtime, State, WebviewWindow};

/// The two local system actions accepted from the fullscreen power menu.
#[derive(Clone, Copy, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub(crate) enum PowerAction {
    Shutdown,
    Restart,
}

/// Create a fixed OS power request for `action`, without forcing other applications to close.
/// Return an error if the system utility cannot be resolved.
fn power_command(action: PowerAction) -> Result<Command, String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        let root = std::env::var_os("SystemRoot")
            .map(std::path::PathBuf::from)
            .filter(|path| path.is_absolute())
            .ok_or("The system power request could not be completed.")?;
        let mut command = Command::new(root.join("System32").join("shutdown.exe"));
        command
            .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
            .args([
                match action {
                    PowerAction::Shutdown => "/s",
                    PowerAction::Restart => "/r",
                },
                "/t",
                "0",
            ]);
        Ok(command)
    }
    #[cfg(target_os = "linux")]
    {
        let mut command = Command::new("/usr/bin/systemctl");
        command.args([
            "--check-inhibitors=yes",
            match action {
                PowerAction::Shutdown => "poweroff",
                PowerAction::Restart => "reboot",
            },
        ]);
        Ok(command)
    }
    #[cfg(target_os = "macos")]
    {
        let mut command = Command::new("/usr/bin/osascript");
        command.args([
            "-e",
            match action {
                PowerAction::Shutdown => r#"tell application "System Events" to shut down"#,
                PowerAction::Restart => r#"tell application "System Events" to restart"#,
            },
        ]);
        Ok(command)
    }
    #[cfg(not(any(windows, target_os = "linux", target_os = "macos")))]
    {
        let _ = action;
        Err("System power actions are unavailable on this platform.".into())
    }
}

/// Submit `action` from the fullscreen launcher window, returning OS failures without blocking the UI.
#[tauri::command]
pub(crate) async fn system_power(
    action: PowerAction,
    window: WebviewWindow,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if window.label() != "main" || !is_fullscreen(&window, &state)? {
        return Err("System power actions are available in fullscreen only.".into());
    }
    let mut command = power_command(action)?;
    async_runtime::spawn_blocking(move || {
        if command
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
        {
            Ok(())
        } else {
            Err("The system power request could not be completed.".into())
        }
    })
    .await
    .map_err(|error| error.to_string())?
}
