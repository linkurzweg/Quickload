use crate::Library;
use std::{fs, io::Write, path::Path};

/// Read the library at `path`; missing files produce an empty library, while corrupt or inaccessible files return an error and remain untouched.
pub fn load(path: &Path) -> Result<Library, String> {
    match fs::read(path) {
        Ok(bytes) => serde_json::from_slice::<Library>(&bytes)
            .map(|mut library| {
                for game in &mut library.games {
                    crate::normalize_game_title(game);
                }
                library
                    .games
                    .retain(|game| !crate::discovery::is_system_game(game));
                library
            })
            .map_err(|e| {
                format!(
                "Bibliothek konnte nicht gelesen werden. Die Originaldatei bleibt erhalten: {e}"
            )
            }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Library::default()),
        Err(e) => Err(e.to_string()),
    }
}
/// Serialize `library` to a synchronized temporary sibling of `path`, then replace the destination. The caller must serialize concurrent writes; failures are returned.
pub fn save(path: &Path, library: &Library) -> Result<(), String> {
    let parent = path.parent().ok_or("Ungültiger Speicherort")?;
    fs::create_dir_all(parent).map_err(|e| {
        format!(
            "Bibliotheksordner {} konnte nicht angelegt werden: {e}",
            parent.display()
        )
    })?;
    let tmp = path.with_extension("json.tmp");
    let bytes = serde_json::to_vec(library).map_err(|e| e.to_string())?;
    let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    file.write_all(&bytes)
        .and_then(|_| file.sync_all())
        .map_err(|e| e.to_string())?;
    drop(file);
    fs::rename(&tmp, path).map_err(|e| format!("Speichern fehlgeschlagen: {e}"))
}
#[cfg(test)]
mod tests {
    use super::*;
    /// Correct the known Ubisoft alias on cache load, preserving personal metadata and unrelated IDs.
    #[test]
    fn avatar_alias_is_repaired_without_a_scan() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("library.json");
        let mut game = crate::Game::new(
            "ubisoft:4740".into(),
            "AFOP".into(),
            crate::Store::Ubisoft,
            crate::LaunchTarget::Uri {
                uri: "uplay://launch/4740".into(),
            },
        );
        game.favorite = true;
        let mut other = game.clone();
        other.id = "ubisoft:9999".into();
        let library = Library {
            games: vec![game, other],
            ..Library::default()
        };
        save(&path, &library).unwrap();
        let loaded = load(&path).unwrap();
        assert_eq!(loaded.games[0].title, "Avatar: Frontiers of Pandora");
        assert!(loaded.games[0].favorite);
        assert_eq!(loaded.games[1].title, "AFOP");
    }
    /// Load legacy settings with safe defaults and suppress cached service entries without rewriting the file.
    #[test]
    fn legacy_cache_migrates_preferences_and_removes_system_entries() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.json");
        let data = serde_json::json!({"settings":{"controller":"playstation"}, "games":[{
            "id":"xbox:Microsoft.GamingServices_123!App", "title":"Microsoft.GamingServices", "store":"xbox", "installed":true,
            "favorite":false, "lastPlayed":null, "launchCount":0, "target":{"kind":"xbox", "aumid":"Microsoft.GamingServices_123!App"}
        }]});
        fs::write(&path, data.to_string()).unwrap();
        let library = load(&path).unwrap();
        assert!(library.games.is_empty());
        assert_eq!(library.settings.controller, "playstation");
        assert_eq!(library.settings.language, "system");
        assert!(library.settings.sound);
        assert!(!library.settings.startup_fullscreen);
        assert!(!library.settings.start_at_login);
        assert!(library.settings.controller_hints);
        assert_eq!(fs::read_to_string(path).unwrap(), data.to_string());
    }
    #[test]
    fn roundtrip_and_atomic_replacement() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.json");
        let mut library = load(&path).unwrap();
        save(&path, &library).unwrap();
        library.settings.controller = "playstation".into();
        save(&path, &library).unwrap();
        assert_eq!(load(&path).unwrap().settings.controller, "playstation");
        assert!(!path.with_extension("json.tmp").exists());
    }
    #[test]
    fn corrupt_cache_is_not_silently_reset() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("library.json");
        fs::write(&path, b"broken").unwrap();
        assert!(load(&path).is_err());
        assert_eq!(fs::read_to_string(path).unwrap(), "broken");
    }
}
