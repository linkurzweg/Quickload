pub mod discovery;
#[cfg(any(windows, test))]
pub mod integrations;
pub mod launch;
pub mod storage;
pub mod vdf;
mod volumes;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

/// Provider used for discovery, filtering and platform-specific launch routing.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Store {
    Steam,
    Epic,
    Gog,
    Xbox,
    Ubisoft,
    Battlenet,
    Rockstar,
    Manual,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
/// Persisted native launch destination; never accepts shell command strings.
pub enum LaunchTarget {
    Uri {
        uri: String,
    },
    Executable {
        path: PathBuf,
        args: Vec<String>,
        cwd: PathBuf,
    },
    MacApp {
        path: PathBuf,
    },
    Xbox {
        aumid: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
/// Cached installation identity, personal metadata and validated launch destination.
pub struct Game {
    pub id: String,
    pub title: String,
    pub store: Store,
    pub installed: bool,
    pub favorite: bool,
    pub last_played: Option<u64>,
    pub launch_count: u32,
    /// Canonical game directory for cross-launcher grouping; distinct from the client's executable directory.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install_path: Option<PathBuf>,
    pub target: LaunchTarget,
    /// Optional package-owned image directory; never used as a generic IPC file path.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artwork_root: Option<PathBuf>,
    /// Relative, manifest-declared package images, resolved only inside `artwork_root`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub artwork_files: Vec<PathBuf>,
}

impl Game {
    /// Create an installed game using stable `id`, display `title`, owning `store` and validated launch `target`; personal metadata starts empty.
    pub fn new(id: String, title: String, store: Store, target: LaunchTarget) -> Self {
        Self {
            id,
            title,
            store,
            installed: true,
            favorite: false,
            last_played: None,
            launch_count: 0,
            install_path: None,
            target,
            artwork_root: None,
            artwork_files: vec![],
        }
    }

    /// Attach the canonical installation `path`, resolving directory aliases once during discovery.
    pub fn with_install_path(mut self, path: &std::path::Path) -> Self {
        self.install_path = path.canonicalize().ok();
        self
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
/// User preferences and additional provider roots; missing serialized fields use defaults.
pub struct Settings {
    pub controller: String,
    pub language: String,
    pub controller_hints: bool,
    pub reduced_motion: bool,
    pub transparency: bool,
    pub startup_scan: bool,
    pub startup_fullscreen: bool,
    pub start_at_login: bool,
    pub automatic_updates: bool,
    pub sound: bool,
    pub focus_shortcut_enabled: bool,
    pub focus_shortcut: String,
    pub artwork: bool,
    pub steam_roots: Vec<PathBuf>,
    pub epic_roots: Vec<PathBuf>,
    pub gog_roots: Vec<PathBuf>,
    pub preferred_installations: HashMap<String, String>,
    pub artwork_positions: HashMap<String, ArtworkPositions>,
}
/// Optional horizontal and vertical focus percentages for each artwork role.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ArtworkPositions {
    pub cover: Option<[u8; 2]>,
    pub hero: Option<[u8; 2]>,
}
impl Default for Settings {
    /// Return default local-only settings with automatic glyphs, startup scanning and optional Steam artwork enabled.
    fn default() -> Self {
        Self {
            controller: "auto".into(),
            language: "system".into(),
            controller_hints: true,
            reduced_motion: false,
            transparency: true,
            startup_scan: true,
            startup_fullscreen: false,
            start_at_login: false,
            automatic_updates: false,
            sound: true,
            focus_shortcut_enabled: false,
            focus_shortcut: "Ctrl+Shift+F12".into(),
            artwork: true,
            steam_roots: vec![],
            epic_roots: vec![],
            gog_roots: vec![],
            preferred_installations: HashMap::new(),
            artwork_positions: HashMap::new(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
/// Persistent cache combining installations, settings and the last successful scan time.
pub struct Library {
    pub games: Vec<Game>,
    pub settings: Settings,
    pub last_scan: Option<u64>,
}

/// Return Unix time in seconds for launch and scan timestamps; pre-epoch clock errors produce zero.
pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Expand a verified provider-specific directory alias without changing unknown IDs or edition titles.
pub fn normalize_game_title(game: &mut Game) {
    if game.store == Store::Ubisoft
        && game.id == "ubisoft:4740"
        && game.title.trim().eq_ignore_ascii_case("AFOP")
    {
        game.title = "Avatar: Frontiers of Pandora".into();
    }
}

/// Merge `found` installations into `library`, retaining personal metadata and manual entries.
/// Missing store entries remain visible as unavailable. Duplicate IDs use the last scan entry.
/// An ID index makes reconciliation linear before the final cached-key title sort.
pub fn reconcile(library: &mut Library, found: Vec<Game>) {
    library
        .games
        .retain(|game| !discovery::is_system_game(game));
    let mut indices: HashMap<String, usize> = library
        .games
        .iter()
        .enumerate()
        .map(|(index, game)| (game.id.clone(), index))
        .collect();
    for game in &mut library.games {
        if game.store != Store::Manual {
            game.installed = false;
        }
    }
    for mut game in found
        .into_iter()
        .filter(|game| !discovery::is_system_game(game))
    {
        normalize_game_title(&mut game);
        if let Some(&index) = indices.get(&game.id) {
            let old = &mut library.games[index];
            game.favorite = old.favorite;
            game.last_played = game.last_played.max(old.last_played);
            game.launch_count = old.launch_count;
            *old = game;
        } else {
            indices.insert(game.id.clone(), library.games.len());
            library.games.push(game);
        }
    }
    library.games.sort_by_cached_key(|g| g.title.to_lowercase());
    library.last_scan = Some(now());
}

#[cfg(test)]
mod tests {
    use super::*;
    fn game(id: &str) -> Game {
        Game::new(
            id.into(),
            id.into(),
            Store::Steam,
            LaunchTarget::Uri {
                uri: "steam://rungameid/42".into(),
            },
        )
    }
    #[test]
    fn rescan_preserves_favorites_and_history_and_marks_uninstalled() {
        let mut library = Library::default();
        let mut old = game("steam:42");
        old.favorite = true;
        old.last_played = Some(15);
        old.launch_count = 2;
        library.games = vec![old, game("steam:43")];
        reconcile(&mut library, vec![game("steam:42"), game("steam:42")]);
        assert_eq!(library.games.len(), 2);
        assert!(library.games[0].favorite);
        assert_eq!(library.games[0].last_played, Some(15));
        assert_eq!(library.games[0].launch_count, 2);
        assert!(!library.games[1].installed);
    }

    #[test]
    fn large_rescan_keeps_manual_entries_and_deduplicates_new_ids() {
        let mut library = Library::default();
        let mut manual = game("manual:kept");
        manual.store = Store::Manual;
        library.games.push(manual);
        let mut found: Vec<Game> = (0..10_000).map(|i| game(&format!("steam:{i}"))).collect();
        let mut duplicate = game("steam:9999");
        duplicate.title = "Updated title".into();
        found.push(duplicate);
        reconcile(&mut library, found);
        assert_eq!(library.games.len(), 10_001);
        assert!(
            library
                .games
                .iter()
                .find(|g| g.id == "manual:kept")
                .unwrap()
                .installed
        );
        assert_eq!(
            library
                .games
                .iter()
                .filter(|g| g.id == "steam:9999")
                .count(),
            1
        );
        assert_eq!(
            library
                .games
                .iter()
                .find(|g| g.id == "steam:9999")
                .unwrap()
                .title,
            "Updated title"
        );
        reconcile(&mut library, vec![]);
        assert_eq!(library.games.iter().filter(|g| g.installed).count(), 1);
    }
}
