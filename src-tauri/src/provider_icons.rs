use crate::{artwork::atomic_write, AppState};
use quick_xml::{events::Event, Reader};
use std::{
    collections::BTreeMap,
    fs::{self, File},
    io::{ErrorKind, Read},
    path::{Path, PathBuf},
    sync::Mutex,
};
use tauri::{async_runtime, State};

const STORES: [(&str, &[&str]); 7] = [
    ("steam", &["steam"]),
    ("epic", &["epicgames", "epicgamesstore", "epic"]),
    ("gog", &["gog", "gogcom", "gogdotcom", "goggalaxy"]),
    ("xbox", &["xbox", "xboxgamepass", "pcgamepass", "gamepass"]),
    ("ubisoft", &["ubisoftconnect", "ubisoft", "uplay"]),
    ("battlenet", &["battlenet", "battledotnet"]),
    (
        "rockstar",
        &["rockstargames", "rockstargameslauncher", "rockstar"],
    ),
];
const LIMIT: u64 = 64 * 1024;
const DIRECTORY_LIMIT: usize = 8192;
const CANDIDATE_LIMIT: usize = 8;
static ICON_WRITES: Mutex<()> = Mutex::new(());

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
            .filter_map(|(store, _)| {
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
    if !STORES.iter().any(|(id, _)| *id == store) {
        return Err("Unknown store".into());
    }
    let directory = state.path.with_file_name("provider-icons");
    async_runtime::spawn_blocking(move || {
        let _guard = ICON_WRITES.lock().map_err(|error| error.to_string())?;
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

/// Report saved SVGs and whether any matching icon could not be written.
#[derive(Default, serde::Serialize)]
pub(crate) struct FolderImport {
    icons: BTreeMap<String, String>,
    failed: bool,
}

/// Resolve a filename stem to a provider and preference rank, ignoring case and punctuation.
fn match_stem(stem: &str) -> Option<(usize, bool, usize)> {
    let normalized: String = stem
        .chars()
        .filter(char::is_ascii_alphanumeric)
        .map(|ch| ch.to_ascii_lowercase())
        .collect();
    let exact = |name: &str| {
        STORES.iter().enumerate().find_map(|(store, (_, aliases))| {
            aliases
                .iter()
                .position(|alias| *alias == name)
                .map(|rank| (store, rank))
        })
    };
    if let Some((store, rank)) = exact(&normalized) {
        return Some((store, false, rank));
    }
    [
        "logo",
        "icon",
        "monochrome",
        "light",
        "dark",
        "white",
        "black",
    ]
    .into_iter()
    .find_map(|suffix| {
        let (store, rank) = exact(normalized.strip_suffix(suffix)?)?;
        Some((store, true, rank))
    })
}

/// Scan direct regular files in an absolute source directory and fill unoccupied icon slots.
/// Directory errors stop the scan before writes. Save failures are reported with successful imports.
fn import_folder(source: &Path, destination: &Path) -> Result<FolderImport, String> {
    let invalid = "Choose a readable local SVG folder.";
    if !source.is_absolute() {
        return Err(invalid.into());
    }
    let mut candidates: [_; STORES.len()] = std::array::from_fn(|_| Vec::new());
    for (index, entry) in fs::read_dir(source).map_err(|_| invalid)?.enumerate() {
        if index >= DIRECTORY_LIMIT {
            return Err("Choose a folder with at most 8192 entries.".into());
        }
        let entry = entry.map_err(|_| invalid)?;
        let path = entry.path();
        if !path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("svg"))
        {
            continue;
        }
        let Some((store, variant, rank)) = path
            .file_stem()
            .and_then(|stem| stem.to_str())
            .and_then(match_stem)
        else {
            continue;
        };
        if entry.file_type().is_ok_and(|kind| kind.is_file()) {
            candidates[store].push((variant, rank, path));
        }
    }
    let _guard = ICON_WRITES.lock().map_err(|error| error.to_string())?;
    let mut result = FolderImport::default();
    for ((store, _), mut paths) in STORES.into_iter().zip(candidates) {
        if paths.is_empty() {
            continue;
        }
        let target = destination.join(format!("{store}.svg"));
        match target.symlink_metadata() {
            Ok(_) => continue,
            Err(error) if error.kind() == ErrorKind::NotFound => {}
            Err(_) => {
                result.failed = true;
                continue;
            }
        }
        paths.sort_unstable();
        let Some(svg) = paths
            .iter()
            .take(CANDIDATE_LIMIT)
            .find_map(|(_, _, path)| read_icon(path).ok())
        else {
            continue;
        };
        if fs::create_dir_all(destination).is_err()
            || atomic_write(&target, svg.as_bytes()).is_err()
        {
            result.failed = true;
        } else {
            result.icons.insert(store.to_owned(), svg);
        }
    }
    Ok(result)
}

/// Import matching local SVGs on a blocking worker, preserving previously saved icons.
#[tauri::command]
pub(crate) async fn import_provider_icons(
    path: PathBuf,
    state: State<'_, AppState>,
) -> Result<FolderImport, String> {
    let directory = state.path.with_file_name("provider-icons");
    async_runtime::spawn_blocking(move || import_folder(&path, &directory))
        .await
        .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Prefer exact aliases, skip invalid files and subfolders, and keep existing icon slots.
    #[test]
    fn imports_ranked_icons_without_overwriting() {
        let source = tempfile::tempdir().unwrap();
        let profile = tempfile::tempdir().unwrap();
        let destination = profile.path().join("provider-icons");
        let exact = "<svg><title>Exact</title></svg>";
        let variant = "<svg><title>Variant</title></svg>";
        fs::create_dir(&destination).unwrap();
        fs::write(destination.join("steam.svg"), variant).unwrap();
        fs::create_dir(source.path().join("nested")).unwrap();
        for (name, svg) in [
            ("Steam.svg", exact),
            ("Epic Games.SVG", exact),
            ("Epic Games - Dark.svg", variant),
            ("gog.svg", "<invalid/>"),
            ("gogdotcom.svg", exact),
            ("Battle.net.svg", exact),
            ("unrelated-xbox.svg", variant),
            ("nested/rockstargames.svg", variant),
        ] {
            fs::write(source.path().join(name), svg).unwrap();
        }
        let result = import_folder(source.path(), &destination).unwrap();
        assert!(!result.failed);
        assert_eq!(
            result.icons,
            BTreeMap::from([
                ("battlenet".into(), exact.into()),
                ("epic".into(), exact.into()),
                ("gog".into(), exact.into()),
            ])
        );
        assert_eq!(read_icon(&destination.join("steam.svg")).unwrap(), variant);
        assert_eq!(read_icon(&destination.join("epic.svg")).unwrap(), exact);
        assert!(import_folder(source.path(), &destination)
            .unwrap()
            .icons
            .is_empty());
    }

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
