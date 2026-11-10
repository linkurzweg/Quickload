//! Local volume discovery and shallow store probes. No recursive drive walk or capacity queries.

use std::{
    fs,
    path::{Path, PathBuf},
};

/// Candidate library directories found on local mounted volumes, grouped by manifest format.
#[derive(Default)]
pub(crate) struct StoreRoots {
    pub steam: Vec<PathBuf>,
    pub gog: Vec<PathBuf>,
    pub epic: Vec<PathBuf>,
}

/// Enumerate mounted fixed/removable Windows volumes, including folder mount points.
/// Network shares and optical media are excluded; API failures become recoverable warnings.
#[cfg(windows)]
pub(crate) fn local_volumes() -> Result<Vec<PathBuf>, String> {
    use std::os::windows::ffi::OsStringExt;
    use windows_sys::Win32::{
        Foundation::{GetLastError, ERROR_MORE_DATA, ERROR_NO_MORE_FILES, INVALID_HANDLE_VALUE},
        Storage::FileSystem::{
            FindFirstVolumeW, FindNextVolumeW, FindVolumeClose, GetDriveTypeW,
            GetVolumePathNamesForVolumeNameW,
        },
        System::WindowsProgramming::{DRIVE_FIXED, DRIVE_REMOVABLE},
    };
    let mut name = [0u16; 1024];
    // SAFETY: All API buffers remain allocated for their calls and are sized in UTF-16 units.
    let handle = unsafe { FindFirstVolumeW(name.as_mut_ptr(), name.len() as u32) };
    if handle == INVALID_HANDLE_VALUE {
        return Err(std::io::Error::last_os_error().to_string());
    }
    let mut roots = Vec::new();
    let result = (|| {
        loop {
            // SAFETY: Enumeration supplies a terminated volume GUID name in `name`.
            let kind = unsafe { GetDriveTypeW(name.as_ptr()) };
            if kind == DRIVE_FIXED || kind == DRIVE_REMOVABLE {
                let mut paths = vec![0u16; 1024];
                let mut needed = 0;
                // SAFETY: Output buffer and size pointer are writable and live through the call.
                let mut ok = unsafe {
                    GetVolumePathNamesForVolumeNameW(
                        name.as_ptr(),
                        paths.as_mut_ptr(),
                        paths.len() as u32,
                        &mut needed,
                    )
                };
                if ok == 0 && unsafe { GetLastError() } == ERROR_MORE_DATA && needed <= 65_536 {
                    paths.resize(needed as usize, 0);
                    // SAFETY: The resized buffer has the capacity requested by Windows.
                    ok = unsafe {
                        GetVolumePathNamesForVolumeNameW(
                            name.as_ptr(),
                            paths.as_mut_ptr(),
                            paths.len() as u32,
                            &mut needed,
                        )
                    };
                }
                if ok == 0 {
                    return Err(std::io::Error::last_os_error().to_string());
                }
                roots.extend(
                    paths
                        .split(|unit| *unit == 0)
                        .take_while(|path| !path.is_empty())
                        .map(|path| PathBuf::from(std::ffi::OsString::from_wide(path))),
                );
            }
            // SAFETY: `handle` remains open and the name buffer retains its full capacity.
            if unsafe { FindNextVolumeW(handle, name.as_mut_ptr(), name.len() as u32) } == 0 {
                if unsafe { GetLastError() } != ERROR_NO_MORE_FILES {
                    return Err(std::io::Error::last_os_error().to_string());
                }
                break;
            }
        }
        Ok(())
    })();
    // SAFETY: Close our enumeration handle exactly once on either success or failure.
    unsafe { FindVolumeClose(handle) };
    result?;
    roots.sort();
    roots.dedup();
    Ok(roots)
}

/// Read the kernel mount table without statting remote mounts or querying free space.
#[cfg(target_os = "linux")]
pub(crate) fn local_volumes() -> Result<Vec<PathBuf>, String> {
    fs::read_to_string("/proc/self/mountinfo")
        .map(|table| linux_mounts(&table))
        .map_err(|error| error.to_string())
}

/// Parse Linux `mountinfo`, retaining known disk filesystems and decoding mount-point escapes.
#[cfg(any(target_os = "linux", test))]
fn linux_mounts(mountinfo: &str) -> Vec<PathBuf> {
    let mut roots = Vec::new();
    for line in mountinfo.lines() {
        let Some((fields, filesystem)) = line.split_once(" - ") else {
            continue;
        };
        let kind = filesystem.split_whitespace().next().unwrap_or("");
        if !matches!(
            kind,
            "ext2"
                | "ext3"
                | "ext4"
                | "btrfs"
                | "xfs"
                | "f2fs"
                | "vfat"
                | "exfat"
                | "ntfs"
                | "ntfs3"
                | "fuseblk"
                | "zfs"
                | "bcachefs"
                | "hfsplus"
                | "apfs"
        ) {
            continue;
        }
        if let Some(path) = fields.split_whitespace().nth(4) {
            roots.push(PathBuf::from(
                path.replace("\\040", " ")
                    .replace("\\011", "\t")
                    .replace("\\012", "\n")
                    .replace("\\134", "\\"),
            ));
        }
    }
    roots.sort();
    roots.dedup();
    roots
}

/// Copy local macOS mount paths using cached mount metadata, avoiding network filesystem refreshes.
#[cfg(target_os = "macos")]
pub(crate) fn local_volumes() -> Result<Vec<PathBuf>, String> {
    use std::{ffi::CStr, os::unix::ffi::OsStrExt};
    // getmntinfo owns a static buffer; serialize access before copying paths out of it.
    static MOUNTS: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let _guard = MOUNTS.lock().map_err(|error| error.to_string())?;
    let mut buffer = std::ptr::null_mut();
    // SAFETY: A valid pointer receives the OS-owned statfs array; MNT_NOWAIT avoids I/O refreshes.
    let count = unsafe { libc::getmntinfo(&mut buffer, libc::MNT_NOWAIT) };
    if count <= 0 || buffer.is_null() {
        return Err(std::io::Error::last_os_error().to_string());
    }
    // SAFETY: The OS returned `count` records, copied while our enumeration lock is held.
    let mounts = unsafe { std::slice::from_raw_parts(buffer, count as usize) };
    Ok(mounts
        .iter()
        .filter(|mount| mount.f_flags & libc::MNT_LOCAL as u32 != 0)
        .filter_map(|mount| {
            // SAFETY: statfs mount names are NUL-terminated system path buffers.
            let name = unsafe { CStr::from_ptr(mount.f_mntonname.as_ptr()) };
            let path = PathBuf::from(std::ffi::OsStr::from_bytes(name.to_bytes()));
            (!path.starts_with("/System/Volumes")).then_some(path)
        })
        .collect())
}

/// Unsupported platforms keep configured provider roots rather than guessing mount locations.
#[cfg(not(any(windows, target_os = "macos", target_os = "linux")))]
pub(crate) fn local_volumes() -> Result<Vec<PathBuf>, String> {
    Ok(Vec::new())
}

/// Resolve an existing `relative` directory below `root` without following child symlinks/junctions.
fn local_directory(root: &Path, relative: impl AsRef<Path>) -> Option<PathBuf> {
    let mut path = root.to_path_buf();
    for component in relative.as_ref().components() {
        path.push(component);
        let metadata = fs::symlink_metadata(&path).ok()?;
        if !metadata.is_dir() || metadata.file_type().is_symlink() {
            return None;
        }
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if metadata.file_attributes() & 0x400 != 0 {
                return None;
            }
        }
    }
    Some(path)
}

/// Probe conventional folders on every supplied volume `roots`. Inspect at most 256 direct
/// children per volume and Games folder for custom Steam library names; never descend recursively.
/// Truncated probes add `warnings`; custom/deeper roots remain available through settings.
pub(crate) fn store_roots(roots: &[PathBuf], warnings: &mut Vec<String>) -> StoreRoots {
    let mut stores = StoreRoots::default();
    for root in roots {
        for relative in [
            "Steam",
            "SteamLibrary",
            "Steam Library",
            "Games/Steam",
            "Games/SteamLibrary",
            "Program Files/Steam",
            "Program Files (x86)/Steam",
        ] {
            if let Some(path) = local_directory(root, relative) {
                stores.steam.push(path);
            }
        }
        for relative in [
            "GOG Games",
            "GOG Galaxy/Games",
            "Games/GOG",
            "Games/GOG Games",
            "Program Files/GOG Galaxy/Games",
            "Program Files (x86)/GOG Galaxy/Games",
        ] {
            if let Some(path) = local_directory(root, relative) {
                stores.gog.push(path);
            }
        }
        if let Some(path) =
            local_directory(root, "ProgramData/Epic/EpicGamesLauncher/Data/Manifests")
        {
            stores.epic.push(path);
        }
        let mut containers = vec![root.clone()];
        if let Some(games) = local_directory(root, "Games") {
            containers.push(games);
        }
        for container in containers {
            if local_directory(&container, "steamapps").is_some() {
                stores.steam.push(container.clone());
            }
            let Ok(entries) = fs::read_dir(&container) else {
                continue;
            };
            for (index, entry) in entries.take(257).enumerate() {
                if index == 256 {
                    warnings.push(format!("Drive discovery: shallow probe limited to 256 entries in {}. Configure additional library roots in Settings.", container.display()));
                    break;
                }
                let Ok(entry) = entry else { continue };
                let Some(path) = local_directory(&container, entry.file_name()) else {
                    continue;
                };
                if local_directory(&path, "steamapps").is_some() {
                    stores.steam.push(path);
                }
            }
        }
    }
    for paths in [&mut stores.steam, &mut stores.gog, &mut stores.epic] {
        paths.sort();
        paths.dedup();
    }
    stores
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Network/pseudo mounts are ignored; paths with escaped spaces and repeated mounts stay valid.
    #[test]
    fn linux_mounts_exclude_network_and_decode_paths() {
        let table = "1 0 8:1 / / rw - ext4 /dev/sda1 rw\n2 0 8:2 / /media/Game\\040Disk rw - ntfs3 /dev/sdb1 rw\n3 0 0:1 / /net rw - nfs host:/games rw\n4 0 0:2 / /proc rw - proc proc rw\n5 0 8:2 / /media/Game\\040Disk rw - ntfs3 /dev/sdb1 rw\nbroken";
        assert_eq!(
            linux_mounts(table),
            vec![PathBuf::from("/"), PathBuf::from("/media/Game Disk")]
        );
    }

    /// Every volume contributes known libraries; custom Steam folder names are found only shallowly.
    #[test]
    fn probes_multiple_volumes_without_recursive_walks() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        for (volume, path) in [
            (first.path(), "SteamLibrary/steamapps"),
            (second.path(), "Games/My Library/steamapps"),
            (second.path(), "GOG Games"),
            (second.path(), "Archive/deep/Steam/steamapps"),
        ] {
            fs::create_dir_all(volume.join(path)).unwrap();
        }
        let mut warnings = Vec::new();
        let roots = store_roots(&[first.path().into(), second.path().into()], &mut warnings);
        assert_eq!(roots.steam.len(), 2);
        assert!(roots
            .steam
            .contains(&second.path().join("Games/My Library")));
        assert_eq!(roots.gog, vec![second.path().join("GOG Games")]);
        assert!(warnings.is_empty());
    }

    /// A large unrelated directory cannot cause unlimited metadata probes and reports its limit.
    #[test]
    fn shallow_probe_has_a_visible_budget() {
        let volume = tempfile::tempdir().unwrap();
        for index in 0..260 {
            fs::create_dir(volume.path().join(format!("Folder{index}"))).unwrap();
        }
        let mut warnings = Vec::new();
        let roots = store_roots(&[volume.path().into()], &mut warnings);
        assert!(roots.steam.is_empty());
        assert_eq!(warnings.len(), 1);
    }

    /// Automatic probes must not traverse a child symlink into an unrelated or remote tree.
    #[cfg(unix)]
    #[test]
    fn probes_ignore_symbolic_links() {
        let volume = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        fs::create_dir(outside.path().join("steamapps")).unwrap();
        std::os::unix::fs::symlink(outside.path(), volume.path().join("SteamLibrary")).unwrap();
        let roots = store_roots(&[volume.path().into()], &mut Vec::new());
        assert!(roots.steam.is_empty());
    }
}
