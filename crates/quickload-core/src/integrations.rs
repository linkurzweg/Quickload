//! Bounded local discovery for Ubisoft Connect, Battle.net and Rockstar Games.
//! Registry and protocol formats are documented in docs/ARCHITECTURE.md; no account data is read.

#[cfg(windows)]
use crate::discovery::ScanReport;
use crate::{Game, LaunchTarget, Store};
use std::{
    fs,
    io::Read,
    path::{Path, PathBuf},
};

#[cfg(windows)]
mod registry;

/// Maximum local metadata size; parsing is linear and never follows a directory tree.
const MAX_DATABASE: usize = 16 * 1024 * 1024;

/// Known Battle.net agent identity, public launch code and display title. Exact matching excludes agents and beta channels.
const BATTLE_PRODUCTS: &[(&str, &str, &str)] = &[
    ("wow", "WoW", "World of Warcraft"),
    ("diablo3", "D3", "Diablo III"),
    ("s2", "S2", "StarCraft II"),
    ("s1", "S1", "StarCraft"),
    ("hs_beta", "WTCG", "Hearthstone"),
    ("heroes", "Hero", "Heroes of the Storm"),
    ("prometheus", "Pro", "Overwatch 2"),
    ("viper", "VIPR", "Call of Duty: Black Ops 4"),
    ("odin", "ODIN", "Call of Duty: Modern Warfare"),
    ("w3", "W3", "Warcraft III: Reforged"),
    (
        "lazarus",
        "LAZR",
        "Call of Duty: Modern Warfare 2 Campaign Remastered",
    ),
    ("zeus", "ZEUS", "Call of Duty: Black Ops Cold War"),
    ("wlby", "WLBY", "Crash Bandicoot 4: It's About Time"),
    ("osi", "OSI", "Diablo II: Resurrected"),
    ("rtro", "RTRO", "Blizzard Arcade Collection"),
    ("fore", "FORE", "Call of Duty: Vanguard"),
    ("anbs", "ANBS", "Diablo Immortal"),
    ("auks", "AUKS", "Call of Duty: Modern Warfare II"),
    ("fen", "Fen", "Diablo IV"),
    ("d1", "D1", "Diablo"),
    ("w1r", "W1R", "Warcraft: Remastered"),
    ("w2r", "W2R", "Warcraft II: Remastered"),
    ("w1", "W1", "Warcraft: Orcs & Humans"),
    ("w2", "W2", "Warcraft II: Battle.net Edition"),
    ("gryphon", "GRY", "Warcraft Rumble"),
    ("aris", "ARIS", "DOOM: The Dark Ages"),
    ("scorpio", "SCOR", "Sea of Thieves"),
    ("arkansas", "ARK", "The Outer Worlds 2"),
    ("libra", "LBRA", "Tony Hawk's Pro Skater 3 + 4"),
    ("pinta", "PNTA", "Call of Duty: Modern Warfare III"),
    ("aqua", "AQUA", "Avowed"),
];

/// Rockstar title IDs and local executable evidence; distinct editions retain distinct identities.
const ROCKSTAR_PRODUCTS: &[(&str, &str, &str)] = &[
    ("gta5", "Grand Theft Auto V", "PlayGTAV.exe"),
    (
        "gta5_gen9",
        "Grand Theft Auto V Enhanced",
        "GTA5_Enhanced_BE.exe",
    ),
    ("rdr", "Red Dead Redemption", "RDR.exe"),
    ("rdr2", "Red Dead Redemption 2", "RDR2.exe"),
    ("lanoire", "L.A. Noire", "LANoire.exe"),
    ("mp3", "Max Payne 3", "MaxPayne3.exe"),
    (
        "lanoirevr",
        "L.A. Noire: The VR Case Files",
        "LANoireVR.exe",
    ),
    ("gtasa", "Grand Theft Auto: San Andreas", "gta_sa.exe"),
    ("gta3", "Grand Theft Auto III", "gta3.exe"),
    ("gtavc", "Grand Theft Auto: Vice City", "gta-vc.exe"),
    ("bully", "Bully: Scholarship Edition", "Bully.exe"),
    ("gta4", "Grand Theft Auto IV", "GTAIV.exe"),
    (
        "gta3unreal",
        "Grand Theft Auto III: The Definitive Edition",
        "Gameface/Binaries/Win64/LibertyCity.exe",
    ),
    (
        "gtavcunreal",
        "Grand Theft Auto: Vice City – The Definitive Edition",
        "Gameface/Binaries/Win64/ViceCity.exe",
    ),
    (
        "gtasaunreal",
        "Grand Theft Auto: San Andreas – The Definitive Edition",
        "Gameface/Binaries/Win64/SanAndreas.exe",
    ),
];

/// Read a local database `path` with a hard allocation bound, including files that grow during reading.
fn read_database(path: &Path) -> Result<Vec<u8>, String> {
    let file = fs::File::open(path).map_err(|e| e.to_string())?;
    let mut bytes = Vec::new();
    file.take((MAX_DATABASE + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_DATABASE {
        return Err("Launcher database exceeds 16 MiB".into());
    }
    Ok(bytes)
}

/// Consume one checked protobuf varint from `data`; reject overflow and truncated integers.
fn varint(data: &mut &[u8]) -> Result<u64, String> {
    let mut result = 0u64;
    for shift in (0..70).step_by(7) {
        let (&byte, rest) = data.split_first().ok_or("Truncated launcher database")?;
        *data = rest;
        if shift == 63 && byte > 1 {
            return Err("Launcher integer overflow".into());
        }
        result |= u64::from(byte & 127) << shift;
        if byte & 128 == 0 {
            return Ok(result);
        }
    }
    Err("Launcher integer overflow".into())
}

/// Extract length-delimited fields from bounded protobuf `data`, skipping scalar fields without recursion.
fn fields(mut data: &[u8]) -> Result<Vec<(u64, &[u8])>, String> {
    let mut result = Vec::new();
    let mut count = 0;
    while !data.is_empty() {
        count += 1;
        if count > 4096 {
            return Err("Too many launcher database fields".into());
        }
        let tag = varint(&mut data)?;
        if tag >> 3 == 0 {
            return Err("Invalid launcher field".into());
        }
        let length = match tag & 7 {
            0 => {
                varint(&mut data)?;
                continue;
            }
            1 => 8,
            2 => usize::try_from(varint(&mut data)?).map_err(|_| "Launcher length overflow")?,
            5 => 4,
            _ => return Err("Unsupported launcher field encoding".into()),
        };
        let value = data.get(..length).ok_or("Truncated launcher database")?;
        if tag & 7 == 2 {
            result.push((tag >> 3, value));
        }
        data = &data[length..];
    }
    Ok(result)
}

/// Borrow one UTF-8 string field `number` from parsed `message`; bound identity/path strings to 32 KiB.
fn string_field<'a>(message: &[(u64, &'a [u8])], number: u64) -> Option<&'a str> {
    let bytes = message.iter().find(|(field, _)| *field == number)?.1;
    (bytes.len() <= 32768)
        .then(|| std::str::from_utf8(bytes).ok())
        .flatten()
}

/// Decode Battle.net's product.db `bytes` into product IDs and installation paths, ignoring agent metadata.
fn battle_records(bytes: &[u8]) -> Result<Vec<(String, PathBuf)>, String> {
    if bytes.len() > MAX_DATABASE {
        return Err("Launcher database exceeds 16 MiB".into());
    }
    let mut records = Vec::new();
    for (_, record) in fields(bytes)?.into_iter().filter(|(field, _)| *field == 1) {
        let message = fields(record)?;
        let Some(id) = string_field(&message, 1) else {
            continue;
        };
        let Some((_, data)) = message.iter().find(|(field, _)| *field == 3) else {
            continue;
        };
        let install = fields(data)?;
        if let Some(path) = string_field(&install, 1) {
            records.push((id.into(), PathBuf::from(path)));
        }
    }
    Ok(records)
}

/// Construct a known installed Battle.net product `id` at `root`, launched by validated `client`.
fn battle_game(id: &str, root: &Path, client: &Path) -> Option<Game> {
    let id = if id.eq_ignore_ascii_case("fenris") {
        "fen"
    } else {
        id
    };
    let (_, code, title) = BATTLE_PRODUCTS
        .iter()
        .find(|(internal, _, _)| internal.eq_ignore_ascii_case(id))?;
    if !root.is_absolute() || !root.is_dir() || !client.is_absolute() || !client.is_file() {
        return None;
    }
    Some(
        Game::new(
            format!("battlenet:{}", id.to_ascii_lowercase()),
            (*title).into(),
            Store::Battlenet,
            LaunchTarget::Executable {
                path: client.into(),
                args: vec![format!("--exec=launch {code}")],
                cwd: client.parent()?.into(),
            },
        )
        .with_install_path(root),
    )
}

/// Construct an installed numeric Ubisoft `id` at `root`; prefer a registered display `title` to the directory name.
fn ubisoft_game(id: &str, title: Option<&str>, root: &Path) -> Option<Game> {
    if id.is_empty()
        || id.len() > 20
        || !id.bytes().all(|byte| byte.is_ascii_digit())
        || !root.is_absolute()
        || !root.is_dir()
    {
        return None;
    }
    let title = title
        .filter(|name| !name.trim().is_empty())
        .or_else(|| root.file_name()?.to_str())?;
    Some(
        Game::new(
            format!("ubisoft:{id}"),
            title.into(),
            Store::Ubisoft,
            LaunchTarget::Uri {
                uri: format!("uplay://launch/{id}"),
            },
        )
        .with_install_path(root),
    )
}

/// Construct known Rockstar `id` at `root`; verify its executable without recursively inspecting the disk.
fn rockstar_game(id: &str, root: &Path, client: &Path) -> Option<Game> {
    let (_, title, executable) = ROCKSTAR_PRODUCTS.iter().find(|(key, _, _)| *key == id)?;
    if !root.is_absolute() || !client.is_absolute() || !client.is_file() {
        return None;
    }
    let canonical = root.canonicalize().ok()?;
    if !root.join(executable).is_file()
        || !root
            .join(executable)
            .canonicalize()
            .ok()?
            .starts_with(&canonical)
    {
        return None;
    }
    Some(
        Game::new(
            format!("rockstar:{id}"),
            (*title).into(),
            Store::Rockstar,
            LaunchTarget::Executable {
                path: client.into(),
                args: vec![
                    "-launchTitleInFolder".into(),
                    root.to_string_lossy().into_owned(),
                ],
                cwd: client.parent()?.into(),
            },
        )
        .with_install_path(root),
    )
}

/// Extract a safe allowlisted-style identifier after `option` in registry `command`; never execute this string.
fn option_id<'a>(command: &'a str, option: &str) -> Option<&'a str> {
    let start = command.to_ascii_lowercase().find(option)? + option.len();
    let value = command[start..]
        .split_whitespace()
        .next()?
        .trim_matches('"');
    (!value.is_empty()
        && value.len() <= 64
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_'))
    .then_some(value)
}

/// Scan registered launcher locations and one bounded Battle.net database into `report`, without process launches.
#[cfg(windows)]
pub fn scan(report: &mut ScanReport) {
    registry::scan(report);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Encode a short protobuf field `number` containing `value` for parser fixtures.
    fn field(number: u8, value: &[u8]) -> Vec<u8> {
        let mut data = vec![(number << 3) | 2];
        let mut length = value.len();
        while length >= 128 {
            data.push((length as u8 & 127) | 128);
            length >>= 7;
        }
        data.push(length as u8);
        data.extend(value);
        data
    }

    /// Product database parsing keeps exact identity and rejects truncated or oversized records.
    #[test]
    fn product_database_is_bounded_and_checked() {
        let mut product = field(1, b"fen");
        product.extend(field(3, &field(1, b"C:/Games/Diablo IV")));
        let bytes = field(1, &product);
        assert_eq!(
            battle_records(&bytes).unwrap(),
            vec![("fen".into(), PathBuf::from("C:/Games/Diablo IV"))]
        );
        for end in 1..bytes.len() {
            assert!(battle_records(&bytes[..end]).is_err());
        }
        assert!(battle_records(&[255; 11]).is_err());
        assert!(battle_records(&[0]).is_err());
        assert!(battle_records(&vec![0; MAX_DATABASE + 1]).is_err());
    }

    /// Registry identifiers never become shell text, infrastructure entries or arbitrary product launches.
    #[test]
    fn provider_identities_and_routes_are_conservative() {
        let temp = tempfile::tempdir().unwrap();
        let root = temp.path().join("Game with spaces");
        fs::create_dir(&root).unwrap();
        let client = temp.path().join("Client.exe");
        fs::write(&client, []).unwrap();
        let ubi = ubisoft_game("123", Some("Game title"), &root).unwrap();
        assert_eq!(ubi.title, "Game title");
        assert!(matches!(ubi.target, LaunchTarget::Uri { uri } if crate::launch::valid_uri(&uri)));
        assert!(ubisoft_game("123/0&bad", None, &root).is_none());
        assert!(ubisoft_game("1", None, &root.join("missing")).is_none());
        let battle = battle_game("fen", &root, &client).unwrap();
        let alias = battle_game("fenris", &root, &client).unwrap();
        assert_eq!(alias.id, battle.id);
        assert_eq!(alias.title, "Diablo IV");
        assert!(
            matches!(battle.target, LaunchTarget::Executable { args, .. } if args == ["--exec=launch Fen"])
        );
        assert!(battle_game("agent", &root, &client).is_none());
        assert!(battle_game("fen_beta", &root, &client).is_none());
        assert!(battle_game("fen", &root, &root.join("missing.exe")).is_none());
        assert!(rockstar_game("rdr2", &root, &client).is_none());
        fs::write(root.join("RDR2.exe"), []).unwrap();
        let rockstar = rockstar_game("rdr2", &root, &client).unwrap();
        assert!(
            matches!(rockstar.target, LaunchTarget::Executable { args, .. } if args == ["-launchTitleInFolder", root.to_str().unwrap()])
        );
        assert!(rockstar_game("launcher", &root, &client).is_none());
        assert_eq!(
            option_id("Battle.net.exe --uid=fen --uninstall", "--uid="),
            Some("fen")
        );
        assert_eq!(
            option_id("Launcher.exe -uninstall=rdr2", "-uninstall="),
            Some("rdr2")
        );
        assert_eq!(
            option_id("Launcher.exe -uninstall=rdr2&calc", "-uninstall="),
            None
        );
    }

    /// Files larger than the metadata cap fail without unbounded allocation.
    #[test]
    fn oversized_database_is_rejected() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join("product.db");
        fs::File::create(&path)
            .unwrap()
            .set_len((MAX_DATABASE + 1) as u64)
            .unwrap();
        assert!(read_database(&path).unwrap_err().contains("16 MiB"));
    }
}
