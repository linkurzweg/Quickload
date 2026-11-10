use crate::{artwork::atomic_write, AppState};
use quick_xml::{events::Event, Reader};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{ErrorKind, Read},
    path::{Path, PathBuf},
};
use tauri::{async_runtime, State};

const STORES: [&str; 7] = [
    "steam",
    "epic",
    "gog",
    "xbox",
    "ubisoft",
    "battlenet",
    "rockstar",
];
const LIMIT: u64 = 64 * 1024;

/// Read a small, regular SVG file for use solely in an image element. Reject unsupported XML and file types.
fn read_icon(path: &Path) -> Result<String, String> {
    if !path.is_absolute()
        || !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("svg"))
        || !path
            .metadata()
            .is_ok_and(|meta| meta.is_file() && meta.len() <= LIMIT)
    {
        return Err("Choose a valid SVG file up to 64 KiB.".into());
    }
    let invalid = || "Choose a valid SVG file up to 64 KiB.".to_owned();
    let mut svg = String::new();
    File::open(path)
        .and_then(|file| file.take(LIMIT + 1).read_to_string(&mut svg))
        .map_err(|_| invalid())?;
    if svg.len() as u64 > LIMIT {
        return Err(invalid());
    }
    let mut reader = Reader::from_str(&svg);
    let mut depth = 0_u32;
    let mut root = false;
    loop {
        match reader.read_event().map_err(|_| invalid())? {
            event @ (Event::Start(_) | Event::Empty(_)) => {
                let (tag, opens) = match event {
                    Event::Start(tag) => (tag, true),
                    Event::Empty(tag) => (tag, false),
                    _ => unreachable!(),
                };
                if depth == 0 {
                    if root || tag.name().as_ref() != "svg" {
                        return Err(invalid());
                    }
                    root = true;
                }
                if matches!(tag.local_name().as_ref(), "script" | "foreignObject")
                    || tag.attributes().any(|attr| attr.is_err())
                {
                    return Err(invalid());
                }
                depth += u32::from(opens);
            }
            Event::End(_) => depth = depth.checked_sub(1).ok_or_else(invalid)?,
            Event::DocType(_) | Event::PI(_) => return Err(invalid()),
            Event::Text(text) if depth == 0 && !text.as_ref().trim().is_empty() => {
                return Err(invalid());
            }
            Event::CData(_) | Event::GeneralRef(_) if depth == 0 => return Err(invalid()),
            Event::Eof => break,
            _ => {}
        }
    }
    if !root || depth != 0 {
        return Err(invalid());
    }
    Ok(svg)
}

/// Load the bounded set of saved icons off the UI thread. Missing or invalid icons use the default.
#[tauri::command]
pub(crate) async fn get_provider_icons(
    state: State<'_, AppState>,
) -> Result<BTreeMap<String, String>, String> {
    let directory = state.path.with_file_name("provider-icons");
    async_runtime::spawn_blocking(move || {
        STORES
            .into_iter()
            .filter_map(|store| {
                let svg = read_icon(&directory.join(format!("{store}.svg"))).ok()?;
                Some((store.to_owned(), svg))
            })
            .collect()
    })
    .await
    .map_err(|error| error.to_string())
}

/// Copy the chosen `path` to the fixed icon slot for `store`, or remove the saved copy if omitted.
/// Returns the accepted SVG for display or an error that leaves the previous image in place.
#[tauri::command]
pub(crate) async fn set_provider_icon(
    store: String,
    path: Option<PathBuf>,
    state: State<'_, AppState>,
) -> Result<Option<String>, String> {
    if !STORES.contains(&store.as_str()) {
        return Err("Unknown store".into());
    }
    let directory = state.path.with_file_name("provider-icons");
    async_runtime::spawn_blocking(move || {
        let destination = directory.join(format!("{store}.svg"));
        if let Some(path) = path {
            let svg = read_icon(&path)?;
            fs::create_dir_all(directory).map_err(|error| error.to_string())?;
            atomic_write(&destination, svg.as_bytes())?;
            Ok(Some(svg))
        } else {
            match fs::remove_file(destination) {
                Ok(()) => Ok(None),
                Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
                Err(error) => Err(error.to_string()),
            }
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Verify Simple Icons style SVGs are accepted and invalid or oversized inputs are rejected.
    #[test]
    fn validates_provider_icon_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("store.svg");
        let svg = r#"<svg role="img" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><title>Test</title><path d="M0 0h24v24z"/></svg>"#;
        fs::write(&path, svg).unwrap();
        assert_eq!(read_icon(&path).unwrap(), svg);
        for invalid in [
            "<html/>",
            "<svg><path></svg>",
            "<svg/><svg/>",
            "<!DOCTYPE svg><svg/>",
            "<svg><script/></svg>",
            "<svg><foreignObject/></svg>",
        ] {
            fs::write(&path, invalid).unwrap();
            assert!(read_icon(&path).is_err(), "{invalid}");
        }
        fs::write(&path, vec![b' '; LIMIT as usize + 1]).unwrap();
        assert!(read_icon(&path).is_err());
    }
}
