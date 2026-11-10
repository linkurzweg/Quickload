//! Bounded, cached store artwork resolution. All remote URLs are constructed locally.
use quickload_core::{now, Game};
use reqwest::blocking::Client;
use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        Mutex, OnceLock,
    },
    time::Duration,
};

const MAX_IMAGE: u64 = 8 * 1024 * 1024;
const MAX_METADATA: u64 = 512 * 1024;
const RETRY_AFTER: u64 = 24 * 60 * 60;
const COVER_POLICY: u8 = 9;
static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Shared HTTP pool and cache directory, independent of persisted library metadata.
pub struct ArtworkService {
    client: Client,
    pub directory: PathBuf,
    writes: Mutex<()>,
    steam_roots: OnceLock<Vec<PathBuf>>,
}

/// Cached title match; negative results expire so unavailable titles can be retried later.
#[derive(Serialize, Deserialize)]
struct Match {
    title: String,
    steam_id: Option<u64>,
    checked: u64,
    #[serde(default)]
    version: u8,
}

/// Cache provenance for a validated image. File names never originate in remote metadata.
#[derive(Serialize, Deserialize)]
struct ImageRecord {
    file: String,
    source: String,
    #[serde(default)]
    version: u8,
}

/// Canonical URLs supplied by Steam for newer games with hashed CDN paths.
#[derive(Serialize, Deserialize)]
struct RemoteAssets {
    cover: Option<String>,
    hero: Option<String>,
    #[serde(default)]
    logo: Option<String>,
    #[serde(default)]
    checked: u64,
}

/// Accept HTTPS images only on known store CDNs; metadata never grants arbitrary HTTP access.
fn trusted_image_url(value: &str) -> bool {
    let Ok(url) = reqwest::Url::parse(value) else {
        return false;
    };
    url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none()
        && matches!(
            url.host_str(),
            Some(
                "cdn.cloudflare.steamstatic.com"
                    | "shared.fastly.steamstatic.com"
                    | "shared.akamai.steamstatic.com"
                    | "shared.steamstatic.com"
                    | "cdn2.unrealengine.com"
                    | "images.gog.com"
                    | "images-1.gog-statics.com"
                    | "images-2.gog-statics.com"
                    | "images-3.gog-statics.com"
                    | "images-4.gog-statics.com"
            )
        )
}

/// Native result returned to the UI; paths are converted to scoped asset URLs there.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Artwork {
    pub path: String,
    pub source: String,
    pub revision: String,
    pub fit: &'static str,
    pub needs_upgrade: bool,
}

/// Keep narrow key art/splash images complete in the hero; only genuine panoramic artwork fills the scene.
fn artwork_fit(kind: &str, width: usize, height: usize) -> &'static str {
    if matches!(kind, "hero" | "detail") && width as f64 / height.max(1) as f64 >= 2.4 {
        "cover"
    } else {
        "contain"
    }
}

/// Identify intentional user covers, including the legacy localized provenance label.
fn custom_source(source: &str) -> bool {
    matches!(source, "Custom cover" | "Eigenes Cover")
}

/// Validate automatic thumbnail dimensions without decoding pixels; reject icons, portraits and panoramic page backdrops.
fn suitable_cover(width: usize, height: usize) -> bool {
    let ratio = width as f64 / height.max(1) as f64;
    width >= 320
        && height >= 140
        && width <= 8192
        && height <= 8192
        && width.saturating_mul(height) <= 32_000_000
        && (1.45..=2.4).contains(&ratio)
}

/// Require landscape title art with enough pixels for a large dialog or a high-density tile.
fn high_quality(width: usize, height: usize) -> bool {
    suitable_cover(width, height)
        && width >= 1200
        && height >= 650
        && width as f64 / height as f64 <= 2.2
}

/// Accept sharp detail artwork, including library panoramas, without enlarging small store capsules.
fn detail_quality(width: usize, height: usize) -> bool {
    width >= 1600
        && height >= 500
        && width <= 8192
        && height <= 8192
        && width.saturating_mul(height) <= 32_000_000
        && (1.45..=3.5).contains(&(width as f64 / height as f64))
}

/// Require enough source pixels for a wide 4K hero crop, using the decoded width and height.
fn hero_quality(width: usize, height: usize) -> bool {
    width >= 3200 && height >= 1000
}

/// Read exact-app Steam asset roles and their individual hashed paths from store-browse metadata.
/// Only fixed CDN URLs beneath the requested app are returned; screenshots are never cover candidates.
fn steam_assets(id: u64, value: &serde_json::Value) -> Option<RemoteAssets> {
    let item = value["response"]["store_items"]
        .as_array()?
        .iter()
        .find(|item| item["appid"].as_u64() == Some(id) && item["success"].as_u64() == Some(1))?;
    let assets = &item["assets"];
    let template = assets["asset_url_format"].as_str()?;
    if !template.starts_with(&format!("steam/apps/{id}/${{FILENAME}}")) {
        return None;
    }
    let resolve = |role: &str| -> Option<String> {
        let file = assets[role].as_str()?;
        if file.is_empty()
            || file.contains("..")
            || !file
                .bytes()
                .all(|c| c.is_ascii_alphanumeric() || b"/_-.".contains(&c))
        {
            return None;
        }
        let url = format!(
            "https://shared.akamai.steamstatic.com/store_item_assets/{}",
            template.replace("${FILENAME}", file)
        );
        trusted_image_url(&url).then_some(url)
    };
    Some(RemoteAssets {
        cover: resolve("main_capsule_2x").or_else(|| resolve("main_capsule")),
        hero: resolve("library_hero_2x").or_else(|| resolve("library_hero")),
        logo: resolve("library_logo_2x").or_else(|| resolve("library_logo")),
        checked: now(),
    })
}

/// Derive Steam's wide capsule variant from a trusted header `url`, preserving cache tokens.
fn steam_capsule_url(url: &str) -> Option<reqwest::Url> {
    let mut url = reqwest::Url::parse(url).ok()?;
    let path = url.path().strip_suffix("/header.jpg")?;
    let capsule = format!("{path}/capsule_616x353_2x.jpg");
    url.set_path(&capsule);
    Some(url)
}

/// Derive a cache-busting token from image `path` and selection-policy `version`, stable until the file changes.
fn asset_revision(path: &Path, version: u8) -> String {
    let modified = fs::metadata(path)
        .and_then(|metadata| metadata.modified())
        .ok()
        .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|time| time.as_nanos())
        .unwrap_or(0);
    format!("{version}-{modified}")
}

/// Request the original GOG title artwork behind a logo rendition, retaining the exact product asset hash.
fn gog_card_url(url: &str) -> Option<String> {
    let url = if url.starts_with("//") {
        format!("https:{url}")
    } else {
        url.into()
    };
    if !trusted_image_url(&url) {
        return None;
    }
    let base = url
        .strip_suffix("_glx_logo_2x.jpg")
        .or_else(|| url.strip_suffix("_glx_logo.jpg"))?;
    Some(format!("{base}.jpg"))
}

/// Normalize `title` for conservative exact matching, retaining digits and edition names.
/// Trademark symbols and punctuation are ignored; sequels and editions remain distinct.
fn normalized(title: &str) -> String {
    search_title(title)
        .chars()
        .filter(|c| c.is_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect()
}

/// Remove explicit trademark/platform annotations from `title`, retaining edition and sequel identity.
fn search_title(title: &str) -> String {
    let mut clean = title
        .replace("(TM)", "")
        .replace("(tm)", "")
        .replace("(R)", "");
    for suffix in [
        " (PC)",
        " (Windows)",
        " (Windows 10)",
        " for Windows",
        " (Xbox)",
    ] {
        if clean
            .trim_end()
            .to_lowercase()
            .ends_with(&suffix.to_lowercase())
        {
            clean = clean.trim_end()[..clean.trim_end().len() - suffix.len()].into();
        }
    }
    clean.trim().to_owned()
}

/// Build at most two lookup terms for `title`; short queries discover candidates but never relax exact title validation.
fn search_terms(title: &str) -> Vec<String> {
    let full = search_title(title);
    let prefix = full
        .split(|c: char| !c.is_alphanumeric())
        .filter(|word| !word.is_empty())
        .take(2)
        .collect::<Vec<_>>()
        .join(" ");
    let mut terms = vec![full.clone()];
    if !prefix.is_empty() && prefix.to_lowercase() != full.to_lowercase() {
        terms.push(prefix);
    }
    terms
}

/// Construct a bounded Epic product slug from display `title`; metadata must still verify the exact title.
fn epic_slug(title: &str) -> String {
    search_title(title)
        .to_lowercase()
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
        .chars()
        .take(160)
        .collect()
}

/// Read store image metadata `value` for `game`, validating identity and host before accepting any URL.
fn provider_images(game: &Game, value: &serde_json::Value) -> Option<RemoteAssets> {
    let (cover, hero, fallback) = if game.store == quickload_core::Store::Gog {
        let id = game.id.strip_prefix("gog:")?.parse::<u64>().ok()?;
        if value["id"].as_u64()? != id {
            return None;
        }
        (
            value["images"]["logo2x"].as_str(),
            value["images"]["background"].as_str(),
            value["images"]["logo2x"].as_str(),
        )
    } else if game.store == quickload_core::Store::Epic {
        if normalized(value["productName"].as_str()?) != normalized(&game.title) {
            return None;
        }
        let data = value["pages"]
            .as_array()?
            .iter()
            .find_map(|page| page.get("data"))?;
        let background = data["hero"]["backgroundImageUrl"].as_str();
        (
            background,
            background,
            data["about"]["image"]["src"].as_str(),
        )
    } else {
        return None;
    };
    let safe = |candidate: Option<&str>| {
        candidate.and_then(|url| {
            let url = if url.starts_with("//") {
                format!("https:{url}")
            } else {
                url.to_owned()
            };
            trusted_image_url(&url).then_some(url)
        })
    };
    Some(RemoteAssets {
        logo: None,
        checked: now(),
        cover: if game.store == quickload_core::Store::Gog {
            cover.and_then(gog_card_url).or_else(|| safe(fallback))
        } else {
            safe(cover).or_else(|| safe(fallback))
        },
        hero: safe(hero),
    })
}

/// Find only manifest-declared local images for `game`, including bounded scale-qualified siblings.
fn local_package_images(game: &Game) -> Vec<PathBuf> {
    let Some(root) = game
        .artwork_root
        .as_ref()
        .and_then(|root| fs::canonicalize(root).ok())
    else {
        return vec![];
    };
    let mut images = Vec::new();
    for relative in game.artwork_files.iter().take(8) {
        if relative.as_os_str().is_empty()
            || !relative
                .components()
                .all(|part| matches!(part, std::path::Component::Normal(_)))
        {
            continue;
        }
        let path = root.join(relative);
        let mut candidates = vec![path.clone()];
        if let (Some(parent), Some(stem)) =
            (path.parent(), path.file_stem().and_then(|s| s.to_str()))
        {
            let prefix = format!("{}.", stem.to_lowercase());
            candidates.extend(
                fs::read_dir(parent)
                    .into_iter()
                    .flatten()
                    .take(64)
                    .filter_map(Result::ok)
                    .filter(|entry| {
                        entry
                            .file_name()
                            .to_string_lossy()
                            .to_lowercase()
                            .starts_with(&prefix)
                    })
                    .map(|entry| entry.path()),
            );
        }
        for candidate in candidates {
            if let Ok(path) = fs::canonicalize(candidate) {
                if path.starts_with(&root) && path.is_file() && !images.contains(&path) {
                    images.push(path);
                }
            }
        }
    }
    images
}

/// Pick an unambiguous exact normalized title from bounded store-search `value` results.
fn matching_id(title: &str, value: &serde_json::Value) -> Option<u64> {
    let key = normalized(title);
    if key.is_empty() {
        return None;
    }
    let mut matches = value.get("items")?.as_array()?.iter().filter_map(|item| {
        (normalized(item.get("name")?.as_str()?) == key)
            .then(|| item.get("id")?.as_u64())
            .flatten()
    });
    let first = matches.next()?;
    if matches.any(|id| id != first) {
        None
    } else {
        Some(first)
    }
}

/// Derive a path-safe cache directory name from known game `id` without using path components.
fn cache_key(id: &str) -> String {
    let hash = id.bytes().fold(0xcbf29ce484222325u64, |h, b| {
        (h ^ u64::from(b)).wrapping_mul(0x100000001b3)
    });
    format!("{hash:016x}")
}

/// Detect supported raster image magic in `bytes`; reject SVG, HTML and executable payloads.
fn image_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("jpg")
    } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        Some("webp")
    } else {
        None
    }
}

/// Find format-specific art for numeric `id` in known Steam `roots`, including one hashed directory level.
/// Limits directory traversal to this single app's cache and never scans a drive recursively.
fn local_steam_image(roots: &[PathBuf], id: u64, kind: &str) -> Option<PathBuf> {
    let names: &[&str] = if kind == "hero" {
        &[
            "library_hero_2x.jpg",
            "library_hero.jpg",
            "library_hero.png",
            "library_header.jpg",
            "header.jpg",
        ]
    } else {
        &[
            "capsule_616x353.jpg",
            "library_header.jpg",
            "header.jpg",
            "library_capsule.jpg",
            "library_600x900.jpg",
        ]
    };
    for root in roots {
        let cache = root.join("appcache/librarycache");
        let app = cache.join(id.to_string());
        let mut directories = vec![app.clone()];
        directories.extend(
            fs::read_dir(&app)
                .into_iter()
                .flatten()
                .filter_map(Result::ok)
                .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
                .take(32)
                .map(|entry| entry.path()),
        );
        for name in names {
            let legacy = cache.join(format!("{id}_{name}"));
            if legacy.is_file() {
                return Some(legacy);
            }
            for directory in &directories {
                let image = directory.join(name);
                if image.is_file() {
                    return Some(image);
                }
            }
        }
    }
    None
}

/// Write `bytes` to a temporary sibling of `path`, replacing only after the complete write.
pub(crate) fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let temporary = path.with_extension(format!(
        "{}.{}.tmp",
        std::process::id(),
        TEMP_COUNTER.fetch_add(1, Ordering::Relaxed)
    ));
    fs::write(&temporary, bytes).map_err(|e| e.to_string())?;
    fs::rename(temporary, path).map_err(|e| e.to_string())
}

impl ArtworkService {
    /// Create an HTTPS-only pooled client and local `directory`; fail on filesystem/TLS setup errors.
    pub fn new(directory: PathBuf) -> Result<Self, String> {
        fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
        let client = Client::builder()
            .https_only(true)
            .timeout(Duration::from_secs(5))
            .connect_timeout(Duration::from_secs(3))
            .redirect(reqwest::redirect::Policy::none())
            .user_agent("Quickload/0.1 (local game library artwork)")
            .build()
            .map_err(|e| e.to_string())?;
        Ok(Self {
            client,
            directory,
            writes: Mutex::new(()),
            steam_roots: OnceLock::new(),
        })
    }

    /// Resolve the stable cache directory for `game`; verify its identity to detect hash collisions.
    fn folder(&self, game: &Game) -> Result<PathBuf, String> {
        let _guard = self.writes.lock().map_err(|_| "Artwork cache is locked")?;
        let folder = self.directory.join(cache_key(&game.id));
        fs::create_dir_all(&folder).map_err(|e| e.to_string())?;
        let identity = folder.join("identity");
        if identity.exists() {
            if fs::read_to_string(&identity).map_err(|e| e.to_string())? != game.id {
                return Err("Artwork cache identity collision".into());
            }
        } else {
            atomic_write(&identity, game.id.as_bytes())?;
        }
        Ok(folder)
    }

    /// Read a previously downloaded `kind` from `folder`; reject manipulated cache filenames.
    fn cached(&self, folder: &Path, kind: &str) -> Option<Artwork> {
        let record: ImageRecord =
            serde_json::from_slice(&fs::read(folder.join(format!("{kind}.json"))).ok()?).ok()?;
        if ![
            format!("{kind}.jpg"),
            format!("{kind}.png"),
            format!("{kind}.webp"),
            format!("{kind}-v6.jpg"),
            format!("{kind}-v6.png"),
            format!("{kind}-v6.webp"),
            format!("{kind}-v7.jpg"),
            format!("{kind}-v7.png"),
            format!("{kind}-v7.webp"),
        ]
        .contains(&record.file)
        {
            return None;
        }
        let path = folder.join(record.file);
        let file = fs::File::open(&path).ok()?;
        if file.metadata().ok()?.len() > MAX_IMAGE {
            return None;
        }
        let mut magic = Vec::new();
        file.take(12).read_to_end(&mut magic).ok()?;
        image_extension(&magic)?;
        Some(Artwork {
            needs_upgrade: false,
            path: path.to_string_lossy().into_owned(),
            source: match record.source.as_str() {
                "Eigenes Cover" => "Custom cover".into(),
                "Lokaler Steam-Cache" => "Local Steam cache".into(),
                _ => record.source,
            },
            revision: asset_revision(&path, record.version),
            fit: if matches!(kind, "hero" | "detail") {
                imagesize::size(&path)
                    .map(|size| artwork_fit(kind, size.width, size.height))
                    .unwrap_or("contain")
            } else {
                "contain"
            },
        })
    }

    /// Find the game's Steam identity directly or by exact title; persist successful/negative matches.
    fn steam_id(&self, game: &Game, folder: &Path) -> Result<Option<u64>, String> {
        if let Some(id) = game.id.strip_prefix("steam:").and_then(|s| s.parse().ok()) {
            return Ok(Some(id));
        }
        let path = folder.join("match.json");
        if let Ok(bytes) = fs::read(&path) {
            if let Ok(found) = serde_json::from_slice::<Match>(&bytes) {
                if found.title == game.title
                    && (found.steam_id.is_some()
                        || (found.version >= 4
                            && now().saturating_sub(found.checked) < RETRY_AFTER))
                {
                    return Ok(found.steam_id);
                }
            }
        }
        let mut steam_id = None;
        'lookup: for term in search_terms(&game.title) {
            for (language, country) in [("english", "us"), ("german", "de")] {
                let mut url =
                    reqwest::Url::parse("https://store.steampowered.com/api/storesearch/")
                        .map_err(|e| e.to_string())?;
                url.query_pairs_mut()
                    .append_pair("term", &term)
                    .append_pair("l", language)
                    .append_pair("cc", country);
                let response = self
                    .client
                    .get(url)
                    .send()
                    .and_then(|r| r.error_for_status())
                    .map_err(|e| e.to_string())?;
                let mut bytes = Vec::new();
                response
                    .take(MAX_METADATA + 1)
                    .read_to_end(&mut bytes)
                    .map_err(|e| e.to_string())?;
                if bytes.len() as u64 > MAX_METADATA {
                    return Err("Artwork search response is too large".into());
                }
                let value = serde_json::from_slice(&bytes).map_err(|e| e.to_string())?;
                steam_id = matching_id(&game.title, &value);
                if steam_id.is_some() {
                    break 'lookup;
                }
            }
        }
        atomic_write(
            &path,
            &serde_json::to_vec(&Match {
                title: game.title.clone(),
                steam_id,
                checked: now(),
                version: 4,
            })
            .map_err(|e| e.to_string())?,
        )?;
        Ok(steam_id)
    }

    /// Fetch a fixed store metadata `url` within byte/time limits; return only parsed JSON, never HTML.
    fn metadata(&self, url: &str) -> Result<serde_json::Value, String> {
        let response = self
            .client
            .get(url)
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        response
            .take(MAX_METADATA + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        if bytes.len() as u64 > MAX_METADATA {
            return Err("Artwork metadata exceeds the size limit".into());
        }
        serde_json::from_slice(&bytes).map_err(|e| e.to_string())
    }

    /// Resolve exact native GOG IDs or title-verified Epic products for `game`, caching canonical asset URLs in `folder`.
    fn provider(&self, game: &Game, folder: &Path) -> Result<Option<RemoteAssets>, String> {
        let url = match game.store {
            quickload_core::Store::Gog => game
                .id
                .strip_prefix("gog:")
                .and_then(|id| id.parse::<u64>().ok())
                .map(|id| format!("https://api.gog.com/products/{id}")),
            quickload_core::Store::Epic => Some(format!(
                "https://store-content.ak.epicgames.com/api/en-US/content/products/{}",
                epic_slug(&game.title)
            )),
            _ => None,
        };
        let Some(url) = url else {
            return Ok(None);
        };
        let path = folder.join("provider-assets-v8.json");
        if let Ok(bytes) = fs::read(&path) {
            if let Ok(assets) = serde_json::from_slice::<RemoteAssets>(&bytes) {
                if now().saturating_sub(assets.checked) < RETRY_AFTER {
                    return Ok(Some(assets));
                }
            }
        }
        let value = self.metadata(&url)?;
        let Some(assets) = provider_images(game, &value) else {
            return Ok(None);
        };
        atomic_write(
            &path,
            &serde_json::to_vec(&assets).map_err(|e| e.to_string())?,
        )?;
        Ok(Some(assets))
    }

    /// Download trusted raster `url` into `folder` for `kind`, preserving `source` and custom-cover precedence.
    fn download(
        &self,
        folder: &Path,
        kind: &str,
        url: &str,
        source: &str,
        strict: bool,
    ) -> Option<Artwork> {
        if !trusted_image_url(url) {
            return None;
        }
        let response = self.client.get(url).send().ok()?.error_for_status().ok()?;
        let mut bytes = Vec::new();
        response.take(MAX_IMAGE + 1).read_to_end(&mut bytes).ok()?;
        self.store_remote(folder, kind, &bytes, source, strict)
    }

    /// Load canonical images for numeric Steam `id`, caching only allowlisted URLs in `folder`.
    fn canonical(&self, id: u64, folder: &Path) -> Result<RemoteAssets, String> {
        let path = folder.join("assets-v8.json");
        if let Ok(bytes) = fs::read(&path) {
            if let Ok(assets) = serde_json::from_slice::<RemoteAssets>(&bytes) {
                if now().saturating_sub(assets.checked) < RETRY_AFTER {
                    return Ok(assets);
                }
            }
        }
        let query = serde_json::json!({"ids":[{"appid":id}],"context":{"language":"english","country_code":"US"},"data_request":{"include_assets":true}});
        let mut url =
            reqwest::Url::parse("https://api.steampowered.com/IStoreBrowseService/GetItems/v1/")
                .map_err(|e| e.to_string())?;
        url.query_pairs_mut()
            .append_pair("input_json", &query.to_string());
        let json = self.metadata(url.as_str())?;
        let assets =
            steam_assets(id, &json).ok_or("Steam artwork identity or asset metadata is invalid")?;
        atomic_write(
            &path,
            &serde_json::to_vec(&assets).map_err(|e| e.to_string())?,
        )?;
        Ok(assets)
    }

    /// Validate and store raster `bytes` under `kind` in `folder`, recording `source` attribution.
    fn store(
        &self,
        folder: &Path,
        kind: &str,
        bytes: &[u8],
        source: &str,
    ) -> Result<Artwork, String> {
        let _guard = self.writes.lock().map_err(|_| "Artwork cache is locked")?;
        if !["Eigenes Cover", "Custom cover"].contains(&source) {
            if let Some(custom) = self
                .cached(folder, kind)
                .filter(|image| ["Eigenes Cover", "Custom cover"].contains(&image.source.as_str()))
            {
                return Ok(custom);
            }
        }
        if bytes.len() as u64 > MAX_IMAGE {
            return Err("Covers must not exceed 8 MiB".into());
        }
        let extension = image_extension(bytes).ok_or("Choose a JPEG, PNG or WebP image")?;
        let dimensions = imagesize::blob_size(bytes).map_err(|_| "Cannot read image dimensions")?;
        if dimensions.width == 0
            || dimensions.height == 0
            || dimensions.width > 8192
            || dimensions.height > 8192
            || dimensions.width.saturating_mul(dimensions.height) > 32_000_000
        {
            return Err("Artwork dimensions exceed the safe limit".into());
        }
        if kind == "cover"
            && !custom_source(source)
            && !suitable_cover(dimensions.width, dimensions.height)
        {
            return Err("Artwork is not a suitable landscape thumbnail".into());
        }
        let file = if kind == "cover" {
            format!("{kind}-v7.{extension}")
        } else {
            format!("{kind}.{extension}")
        };
        let path = folder.join(&file);
        atomic_write(&path, bytes)?;
        atomic_write(
            &folder.join(format!("{kind}.json")),
            &serde_json::to_vec(&ImageRecord {
                file,
                source: source.into(),
                version: COVER_POLICY,
            })
            .map_err(|e| e.to_string())?,
        )?;
        Ok(Artwork {
            needs_upgrade: false,
            path: path.to_string_lossy().into_owned(),
            source: source.into(),
            revision: asset_revision(&path, COVER_POLICY),
            fit: artwork_fit(kind, dimensions.width, dimensions.height),
        })
    }

    /// Accept a remote replacement only when it fits the tile if `strict` is set.
    fn store_remote(
        &self,
        folder: &Path,
        kind: &str,
        bytes: &[u8],
        source: &str,
        strict: bool,
    ) -> Option<Artwork> {
        if (strict || kind == "detail")
            && !imagesize::blob_size(bytes).is_ok_and(|size| {
                if kind == "hero" {
                    hero_quality(size.width, size.height)
                } else if kind == "detail" {
                    detail_quality(size.width, size.height)
                } else {
                    high_quality(size.width, size.height)
                        || (size.width >= 600
                            && suitable_cover(size.width, size.height)
                            && ((size.width as f64 / size.height as f64) / (16.0 / 9.0) - 1.0)
                                .abs()
                                <= 0.03)
                }
            })
        {
            return None;
        }
        self.store(folder, kind, bytes, source).ok()
    }

    /// Read manifest-declared package images for `game` into the scoped `kind` slot under `folder`.
    fn package_image(&self, game: &Game, kind: &str, folder: &Path) -> Option<Artwork> {
        for path in local_package_images(game) {
            if let Ok(file) = fs::File::open(path) {
                let mut bytes = Vec::new();
                if file.take(MAX_IMAGE + 1).read_to_end(&mut bytes).is_ok() {
                    if let Ok(image) = self.store(folder, kind, &bytes, "Installed game package") {
                        return Some(image);
                    }
                }
            }
        }
        None
    }

    /// Load cached, Steam or installed-package artwork without contacting an online provider.
    /// Local fallbacks have their own slot so a download cannot overwrite an image being displayed.
    pub fn local_cover(&self, game: &Game) -> Result<Option<Artwork>, String> {
        let folder = self.folder(game)?;
        let mut image = self
            .cached(&folder, "cover")
            .filter(|image| image.source != "Steam screenshot")
            .or_else(|| self.cached(&folder, "local-cover"));
        if image.is_none() {
            if let Some(id) = game
                .id
                .strip_prefix("steam:")
                .and_then(|id| id.parse().ok())
            {
                let roots = self
                    .steam_roots
                    .get_or_init(quickload_core::discovery::default_steam_roots);
                if let Some(path) = local_steam_image(roots, id, "cover") {
                    if let Ok(file) = fs::File::open(path) {
                        let mut bytes = Vec::new();
                        if file.take(MAX_IMAGE + 1).read_to_end(&mut bytes).is_ok() {
                            image = self
                                .store(&folder, "local-cover", &bytes, "Local Steam cache")
                                .ok();
                        }
                    }
                }
            }
            if image.is_none() {
                image = self.package_image(game, "local-cover", &folder);
            }
        }
        if let Some(image) = &mut image {
            image.needs_upgrade = !custom_source(&image.source)
                && (matches!(
                    image.source.as_str(),
                    "Local Steam cache" | "Installed game package"
                ) || !imagesize::size(&image.path)
                    .is_ok_and(|size| high_quality(size.width, size.height)));
        }
        Ok(image)
    }

    /// Resolve a transparent official logo for `game`; cache successful images and daily misses.
    /// The exact Steam identity and fixed CDN paths prevent unrelated title/logo combinations.
    fn logo(&self, game: &Game, allow_network: bool) -> Result<Option<Artwork>, String> {
        let folder = self.folder(game)?;
        if let Some(image) = self.cached(&folder, "logo") {
            return Ok(Some(image));
        }
        if !allow_network {
            return Ok(None);
        }
        let retry = folder.join("logo.missing");
        if fs::read_to_string(&retry)
            .ok()
            .and_then(|s| s.parse::<u64>().ok())
            .is_some_and(|time| now().saturating_sub(time) < RETRY_AFTER)
        {
            return Ok(None);
        }
        let Some(id) = self.steam_id(game, &folder)? else {
            return Ok(None);
        };
        let mut urls = Vec::new();
        if let Ok(assets) = self.canonical(id, &folder) {
            urls.extend(assets.logo);
        }
        for name in ["logo_2x.png", "logo.png"] {
            urls.push(format!(
                "https://cdn.cloudflare.steamstatic.com/steam/apps/{id}/{name}"
            ));
        }
        for url in urls {
            if let Some(image) = self.download(&folder, "logo", &url, "Steam logo", false) {
                return Ok(Some(image));
            }
        }
        atomic_write(&retry, now().to_string().as_bytes())?;
        Ok(None)
    }

    /// Resolve `kind` for `game` on disk and use bounded CDN fallbacks only if `allow_network` is set.
    /// Missing images are cached for a day; network failures remain retryable on the next app session.
    pub fn resolve(
        &self,
        game: &Game,
        kind: &str,
        allow_network: bool,
    ) -> Result<Option<Artwork>, String> {
        if kind == "logo" {
            return self.logo(game, allow_network);
        }
        if !["cover", "hero", "detail"].contains(&kind) {
            return Err("Unknown artwork format".into());
        }
        let folder = self.folder(game)?;
        let mut fallback = if kind == "cover" {
            self.local_cover(game)?
        } else {
            self.cached(&folder, kind)
                .filter(|image| image.source != "Steam screenshot")
        };
        let policy = folder.join(format!(
            "{kind}.upgrade-v{}",
            if kind == "hero" { 10 } else { 9 }
        ));
        if let Some(ref image) = fallback {
            let recent = fs::read_to_string(&policy)
                .ok()
                .and_then(|time| time.parse::<u64>().ok())
                .is_some_and(|time| now().saturating_sub(time) < RETRY_AFTER);
            if (kind == "hero"
                && imagesize::size(&image.path)
                    .is_ok_and(|size| hero_quality(size.width, size.height)))
                || (kind == "cover" && !image.needs_upgrade)
                || (kind == "detail"
                    && imagesize::size(&image.path)
                        .is_ok_and(|size| detail_quality(size.width, size.height)))
                || recent
            {
                return Ok(fallback);
            }
            // Upgrade poor legacy choices once per day, retaining the image if offline or providers are unavailable.
            if allow_network {
                atomic_write(&policy, now().to_string().as_bytes())?;
            }
        }
        let mut strict = kind != "hero" || fallback.is_some();
        // Reuse a sufficiently large cover on disk before doing any dialog-specific online work.
        if kind == "detail" {
            if let Some(image) = self.local_cover(game)?.filter(|image| {
                !image.needs_upgrade
                    && imagesize::size(&image.path)
                        .is_ok_and(|size| detail_quality(size.width, size.height))
            }) {
                return Ok(Some(image));
            }
        }
        if let Some(id) = game
            .id
            .strip_prefix("steam:")
            .and_then(|value| value.parse().ok())
            .filter(|_| kind == "hero")
        {
            let roots = self
                .steam_roots
                .get_or_init(quickload_core::discovery::default_steam_roots);
            if let Some(path) = local_steam_image(roots, id, kind) {
                let high_resolution =
                    imagesize::size(&path).is_ok_and(|size| hero_quality(size.width, size.height));
                if let Some(file) = fs::File::open(path)
                    .ok()
                    .filter(|_| high_resolution || fallback.is_none())
                {
                    let mut bytes = Vec::new();
                    if file.take(MAX_IMAGE + 1).read_to_end(&mut bytes).is_ok() {
                        if let Ok(image) = self.store(&folder, kind, &bytes, "Local Steam cache") {
                            if high_resolution {
                                return Ok(Some(image));
                            }
                            fallback = Some(image);
                            strict = true;
                            if allow_network {
                                atomic_write(&policy, now().to_string().as_bytes())?;
                            }
                        }
                    }
                }
            }
        }
        if kind == "hero" && fallback.is_none() {
            if let Some(image) = self.package_image(game, kind, &folder) {
                return Ok(Some(image));
            }
        }
        if !allow_network {
            return Ok(fallback);
        }
        let missing = folder.join(format!(
            "{kind}.missing-v{}",
            if kind == "hero" { 10 } else { 9 }
        ));
        if let Ok(timestamp) = fs::read_to_string(&missing) {
            if timestamp
                .parse::<u64>()
                .is_ok_and(|time| now().saturating_sub(time) < RETRY_AFTER)
            {
                return Ok(fallback);
            }
        }
        if let Ok(Some(assets)) = self.provider(game, &folder) {
            let urls = if kind == "hero" {
                [assets.hero, assets.cover]
            } else {
                [assets.cover, assets.hero]
            };
            for url in urls.into_iter().flatten() {
                if let Some(image) = self.download(
                    &folder,
                    kind,
                    &url,
                    if game.store == quickload_core::Store::Gog {
                        "GOG"
                    } else {
                        "Epic Games"
                    },
                    strict,
                ) {
                    return Ok(Some(image));
                }
            }
        }
        let id = match self.steam_id(game, &folder) {
            Ok(Some(id)) => id,
            _ => return Ok(fallback),
        };
        let variants: &[&str] = if kind == "hero" {
            &["library_hero_2x.jpg", "library_hero.jpg", "header.jpg"]
        } else {
            &["capsule_616x353_2x.jpg"]
        };
        let mut unavailable = true;
        for variant in variants {
            let url = format!("https://cdn.cloudflare.steamstatic.com/steam/apps/{id}/{variant}");
            let response = match self.client.get(&url).send() {
                Ok(r) => r,
                Err(_) => {
                    unavailable = false;
                    continue;
                }
            };
            if response.status() == reqwest::StatusCode::NOT_FOUND {
                continue;
            }
            if !response.status().is_success() {
                unavailable = false;
                continue;
            }
            let mut bytes = Vec::new();
            response
                .take(MAX_IMAGE + 1)
                .read_to_end(&mut bytes)
                .map_err(|e| e.to_string())?;
            if let Some(image) = self.store_remote(&folder, kind, &bytes, "Steam", strict) {
                return Ok(Some(image));
            }
        }
        // Current releases can use hashed paths, available only through store metadata.
        if let Ok(assets) = self.canonical(id, &folder) {
            let url = if kind == "hero" || kind == "detail" {
                assets.hero.or(assets.cover)
            } else {
                assets.cover
            };
            if let Some(url) = url.filter(|url| trusted_image_url(url)) {
                if kind != "hero" {
                    if let Some(capsule) = steam_capsule_url(&url) {
                        if let Some(image) =
                            self.download(&folder, kind, capsule.as_str(), "Steam", strict)
                        {
                            return Ok(Some(image));
                        }
                    }
                }
                if let Ok(response) = self
                    .client
                    .get(url)
                    .send()
                    .and_then(|r| r.error_for_status())
                {
                    let mut bytes = Vec::new();
                    if response.take(MAX_IMAGE + 1).read_to_end(&mut bytes).is_ok() {
                        if let Some(image) =
                            self.store_remote(&folder, kind, &bytes, "Steam", strict)
                        {
                            return Ok(Some(image));
                        }
                    }
                } else {
                    unavailable = false;
                }
            }
        } else {
            unavailable = false;
        }
        if kind == "cover" && fallback.is_none() {
            // A legacy capsule is still better than an empty tile when no large artwork exists.
            for variant in ["capsule_616x353.jpg", "header.jpg"] {
                let url =
                    format!("https://cdn.cloudflare.steamstatic.com/steam/apps/{id}/{variant}");
                if let Some(image) = self.download(&folder, kind, &url, "Steam", false) {
                    atomic_write(&policy, now().to_string().as_bytes())?;
                    return Ok(Some(image));
                }
            }
        }
        if unavailable {
            atomic_write(&missing, now().to_string().as_bytes())?;
        }
        Ok(fallback)
    }

    /// Import a user-chosen raster `path` as `game`'s cover; no source file is modified.
    pub fn import(&self, game: &Game, path: &Path) -> Result<Artwork, String> {
        if !path.is_absolute() {
            return Err("An absolute image path is required".into());
        }
        let file = fs::File::open(path).map_err(|e| e.to_string())?;
        let mut bytes = Vec::new();
        file.take(MAX_IMAGE + 1)
            .read_to_end(&mut bytes)
            .map_err(|e| e.to_string())?;
        self.store(&self.folder(game)?, "cover", &bytes, "Custom cover")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Do not mistake a compatible but small image for a sharp dialog or high-density cover.
    #[test]
    fn quality_requires_resolution_and_composition() {
        assert!(!detail_quality(616, 353));
        assert!(!detail_quality(1232, 706));
        assert!(detail_quality(3840, 1240));
        assert!(detail_quality(1920, 1080));
        assert!(!detail_quality(2560, 300));
        assert!(high_quality(1232, 706));
        assert!(high_quality(1920, 1080));
        assert!(!high_quality(616, 353));
        assert!(!high_quality(639, 361));
        assert!(!high_quality(3840, 1240));
        assert!(!high_quality(2560, 655));
        assert!(!high_quality(0, 0));
    }
    /// Keep role-specific hashes, reject a different app and disallow path traversal in asset metadata.
    #[test]
    fn steam_role_paths_are_not_derived_from_header_hashes() {
        let mut data = serde_json::json!({"response":{"store_items":[{"appid":42,"success":1,"assets":{
            "asset_url_format":"steam/apps/42/${FILENAME}?t=1",
            "header":"header-hash/header.jpg",
            "main_capsule_2x":"cover-hash/capsule_616x353_2x.jpg"
        }}]}});
        assert!(steam_assets(42, &data)
            .unwrap()
            .cover
            .unwrap()
            .contains("cover-hash/capsule_616x353_2x.jpg"));
        assert!(steam_assets(43, &data).is_none());
        data["response"]["store_items"][0]["assets"]["main_capsule_2x"] = "../wrong.jpg".into();
        assert!(steam_assets(42, &data).unwrap().cover.is_none());
    }
    /// Reject low-resolution icons, portrait art and panoramic backdrops while accepting store capsules.
    #[test]
    fn thumbnail_geometry_prefers_landscape_capsules() {
        assert!(suitable_cover(616, 353));
        assert!(suitable_cover(639, 361));
        assert!(suitable_cover(460, 215));
        assert_eq!(
            steam_capsule_url("https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/42/hash/header.jpg?t=1").unwrap().path(),
            "/store_item_assets/steam/apps/42/hash/capsule_616x353_2x.jpg"
        );
        assert!(suitable_cover(1920, 1080));
        assert!(!suitable_cover(2560, 655));
        assert!(!suitable_cover(200, 120));
        assert!(!suitable_cover(1200, 1600));
        assert!(!suitable_cover(100000, 100000));
        assert!(!suitable_cover(500, 0));
        assert_eq!(artwork_fit("hero", 2560, 1440), "contain");
        assert_eq!(artwork_fit("hero", 3840, 1240), "cover");
        assert_eq!(artwork_fit("cover", 460, 215), "contain");
        assert_eq!(
            search_terms("Tony Hawk's(TM) Pro Skater(TM) 3 + 4")[1],
            "Tony Hawk"
        );
        assert_eq!(search_terms("Hades"), vec!["Hades"]);
    }

    /// Preserve old cached images during offline upgrade backoff and never replace explicit user covers.
    #[test]
    fn cover_policy_migration_preserves_offline_and_custom_artwork() {
        let directory = tempfile::tempdir().unwrap();
        let service = ArtworkService::new(directory.path().join("artwork")).unwrap();
        let game = Game::new(
            "gog:fixture".into(),
            "Fixture".into(),
            quickload_core::Store::Gog,
            quickload_core::LaunchTarget::Uri {
                uri: "heroic://launch/gog/fixture".into(),
            },
        );
        let folder = service.folder(&game).unwrap();
        let bytes =
            fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("icons/32x32.png")).unwrap();
        fs::write(folder.join("cover.png"), &bytes).unwrap();
        fs::write(
            folder.join("cover.json"),
            br#"{"file":"cover.png","source":"GOG","version":3}"#,
        )
        .unwrap();
        fs::write(folder.join("cover.upgrade-v9"), now().to_string()).unwrap();
        assert!(service.local_cover(&game).unwrap().unwrap().needs_upgrade);
        assert_eq!(
            service
                .resolve(&game, "cover", true)
                .unwrap()
                .unwrap()
                .source,
            "GOG"
        );
        fs::remove_file(folder.join("cover.upgrade-v9")).unwrap();
        fs::write(
            folder.join("cover.json"),
            br#"{"file":"cover.png","source":"Eigenes Cover","version":0}"#,
        )
        .unwrap();
        assert_eq!(
            service
                .resolve(&game, "cover", true)
                .unwrap()
                .unwrap()
                .source,
            "Custom cover"
        );
        assert!(service.store(&folder, "cover", &bytes, "Steam").is_ok());
        assert!(!service.local_cover(&game).unwrap().unwrap().needs_upgrade);
        assert!(gog_card_url("https://evil.test/hash_glx_logo_2x.jpg").is_none());
    }
    /// Match localized platform/trademark annotations without confusing editions or sequels.
    #[test]
    fn platform_suffixes_and_ascii_trademarks_are_not_part_of_title_identity() {
        assert_eq!(
            matching_id(
                "Tony Hawk's(TM) Pro Skater(TM) 3 + 4",
                &serde_json::json!({"items":[{"id":42,"name":"Tony Hawk’s Pro Skater™ 3 + 4"}]})
            ),
            Some(42)
        );
        assert_eq!(
            normalized("Fallout: New Vegas Ultimate Edition (PC)"),
            normalized("Fallout: New Vegas Ultimate Edition")
        );
        assert_ne!(
            normalized("Fallout: New Vegas Ultimate Edition (PC)"),
            normalized("Fallout: New Vegas")
        );
        assert_ne!(normalized("Hades II"), normalized("Hades"));
        assert_eq!(epic_slug("Alan Wake 2"), "alan-wake-2");
    }

    /// Accept GOG's exact product ID and Epic's exact title, rejecting mismatched or off-CDN metadata.
    #[test]
    fn provider_metadata_validates_identity_and_image_hosts() {
        let mut game = Game::new(
            "gog:42".into(),
            "Fixture".into(),
            quickload_core::Store::Gog,
            quickload_core::LaunchTarget::Uri {
                uri: "goggalaxy://launch/42".into(),
            },
        );
        let gog = serde_json::json!({"id":42,"images":{"logo2x":"//images-4.gog-statics.com/hash_glx_logo_2x.jpg","background":"https://evil.test/background.jpg"}});
        let assets = provider_images(&game, &gog).unwrap();
        assert_eq!(
            assets.cover.as_deref(),
            Some("https://images-4.gog-statics.com/hash.jpg")
        );
        assert!(assets.hero.is_none());
        game.id = "gog:43".into();
        assert!(provider_images(&game, &gog).is_none());
        game.store = quickload_core::Store::Epic;
        game.title = "Alan Wake 2".into();
        let epic = serde_json::json!({"productName":"Alan Wake 2", "pages":[{"data":{"hero":{"backgroundImageUrl":"https://cdn2.unrealengine.com/art.jpg"}}}]});
        assert!(provider_images(&game, &epic).unwrap().cover.is_some());
        game.title = "Alan Wake".into();
        assert!(provider_images(&game, &epic).is_none());
        assert!(!trusted_image_url(
            "https://cdn2.unrealengine.com.evil.test/art.jpg"
        ));
    }

    /// Resolve package splash images offline, support scale-qualified files and reject traversal paths.
    #[test]
    fn package_images_are_confined_to_the_declared_installation() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("game");
        fs::create_dir_all(root.join("Assets")).unwrap();
        let image = root.join("Assets/Splash.scale-200.png");
        let source =
            PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../tests/fixtures/landscape.png");
        fs::copy(&source, &image).unwrap();
        let mut game = Game::new(
            "xbox:fixture!Game".into(),
            "Fixture".into(),
            quickload_core::Store::Xbox,
            quickload_core::LaunchTarget::Xbox {
                aumid: "fixture!Game".into(),
            },
        );
        game.artwork_root = Some(root);
        game.artwork_files = vec!["../outside.png".into(), "Assets/Splash.png".into()];
        assert_eq!(
            local_package_images(&game),
            vec![fs::canonicalize(image).unwrap()]
        );
        let service = ArtworkService::new(directory.path().join("artwork")).unwrap();
        let local = service.local_cover(&game).unwrap().unwrap();
        assert_eq!(local.source, "Installed game package");
        assert!(local.needs_upgrade);
        let folder = service.folder(&game).unwrap();
        let icon =
            fs::read(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("icons/32x32.png")).unwrap();
        assert!(service
            .store_remote(&folder, "cover", &icon, "Steam", true)
            .is_none());
        let bytes = fs::read(source).unwrap();
        assert!(service
            .store_remote(&folder, "detail", &bytes, "Steam", true)
            .is_none());
        let downloaded = service
            .store_remote(&folder, "cover", &bytes, "Steam", true)
            .unwrap();
        assert_ne!(local.path, downloaded.path);
        assert_eq!(fs::read(&local.path).unwrap(), bytes);
    }
    /// Verify conservative title matching never selects a sequel, soundtrack or ambiguous edition.
    #[test]
    fn exact_title_matching_preserves_identity() {
        let data = serde_json::json!({"items":[{"id":1,"name":"Hollow Knight: Silksong"},{"id":2,"name":"Hollow Knight™"},{"id":3,"name":"Hollow Knight Soundtrack"}]});
        assert_eq!(matching_id("Hollow Knight", &data), Some(2));
        assert_eq!(matching_id("Hollow Knight Deluxe", &data), None);
        assert_eq!(matching_id("", &data), None);
        assert_eq!(
            matching_id(
                "Hades",
                &serde_json::json!({"items":[{"id":1,"name":"Hades"},{"id":2,"name":"Hades"}]})
            ),
            None
        );
        assert_ne!(cache_key("steam:1"), cache_key("gog:1"));
    }
    /// Verify downloads reject non-raster payloads and identify supported formats by magic bytes.
    #[test]
    fn validates_raster_headers() {
        assert_eq!(image_extension(b"<html>error</html>"), None);
        assert_eq!(image_extension(b"<svg></svg>"), None);
        assert_eq!(image_extension(b"\xff\xd8\xffrest"), Some("jpg"));
        assert_eq!(image_extension(b"\x89PNG\r\n\x1a\nrest"), Some("png"));
        assert_eq!(image_extension(b"RIFF1234WEBPrest"), Some("webp"));
        assert!(trusted_image_url(
            "https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1/hash/header.jpg"
        ));
        assert!(!trusted_image_url(
            "https://shared.fastly.steamstatic.com.evil.test/image.jpg"
        ));
        assert!(!trusted_image_url(
            "https://user@shared.fastly.steamstatic.com/image.jpg"
        ));
        assert!(!trusted_image_url(
            "http://shared.fastly.steamstatic.com/image.jpg"
        ));
    }

    /// Verify an imported cover survives a new service instance and wins over late online responses.
    #[test]
    fn imported_cover_is_persistent_and_has_priority() {
        let directory = tempfile::tempdir().unwrap();
        let service = ArtworkService::new(directory.path().join("artwork")).unwrap();
        let game = Game::new(
            "gog:fixture".into(),
            "Fixture".into(),
            quickload_core::Store::Gog,
            quickload_core::LaunchTarget::Uri {
                uri: "heroic://launch/gog/fixture".into(),
            },
        );
        let source = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("icons/32x32.png");
        let imported = service.import(&game, &source).unwrap();
        assert_eq!(imported.source, "Custom cover");
        let cached = ArtworkService::new(service.directory.clone())
            .unwrap()
            .resolve(&game, "cover", false)
            .unwrap()
            .unwrap();
        assert_eq!(cached.path, imported.path);
        let bytes = fs::read(source).unwrap();
        let late = service
            .store(&service.folder(&game).unwrap(), "cover", &bytes, "Steam")
            .unwrap();
        assert_eq!(late.source, "Custom cover");
        assert!(service.import(&game, Path::new("relative.png")).is_err());
    }

    /// Verify negative caching, oversized images and manipulated cache records without making HTTP calls.
    #[test]
    fn rejects_cache_escape_and_bounds_imports() {
        let directory = tempfile::tempdir().unwrap();
        let service = ArtworkService::new(directory.path().join("artwork")).unwrap();
        service.steam_roots.set(vec![]).unwrap();
        let game = Game::new(
            "steam:42".into(),
            "Fixture".into(),
            quickload_core::Store::Steam,
            quickload_core::LaunchTarget::Uri {
                uri: "steam://rungameid/42".into(),
            },
        );
        let folder = service.folder(&game).unwrap();
        for kind in ["cover", "hero", "detail", "logo"] {
            assert!(service.resolve(&game, kind, false).unwrap().is_none());
        }
        fs::write(folder.join("cover.missing-v6"), now().to_string()).unwrap();
        assert!(service.resolve(&game, "cover", true).unwrap().is_none());
        fs::write(
            folder.join("cover.json"),
            br#"{"file":"../outside.png","source":"Steam"}"#,
        )
        .unwrap();
        assert!(service.cached(&folder, "cover").is_none());
        assert!(service
            .store(
                &folder,
                "cover",
                &vec![0; MAX_IMAGE as usize + 1],
                "Eigenes Cover"
            )
            .is_err());
        assert!(service.resolve(&game, "../../outside", false).is_err());
        fs::write(folder.join("identity"), "another-game").unwrap();
        assert!(service.folder(&game).is_err());
    }

    /// Verify local caches select landscape headers and support modern hashed subdirectories.
    #[test]
    fn finds_local_images_without_recursive_scanning() {
        let root = tempfile::tempdir().unwrap();
        let hashed = root.path().join("appcache/librarycache/42/hash");
        fs::create_dir_all(&hashed).unwrap();
        fs::write(hashed.join("library_capsule.jpg"), b"portrait").unwrap();
        fs::write(hashed.join("library_header.jpg"), b"landscape").unwrap();
        fs::write(hashed.join("library_hero.jpg"), b"hero").unwrap();
        let roots = vec![root.path().into()];
        assert_eq!(
            local_steam_image(&roots, 42, "cover"),
            Some(hashed.join("library_header.jpg"))
        );
        assert_eq!(
            local_steam_image(&roots, 42, "hero"),
            Some(hashed.join("library_hero.jpg"))
        );
        assert!(local_steam_image(&roots, 999, "cover").is_none());
    }
}
