use std::fs;
use std::io::{Read, Write as _};
use std::path::{Component, Path, PathBuf};

use sha2::{Digest as _, Sha256};

use super::catalog::{Packing, Pinned};

pub fn client() -> Result<reqwest::Client, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .build()
        .map_err(|error| error.to_string())
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes.iter().fold(String::new(), |mut out, b| {
        let _ = write!(out, "{b:02x}");
        out
    })
}

pub async fn fetch(
    client: &reqwest::Client,
    pin: &Pinned,
    path: &Path,
    moved: &mut impl FnMut(u64),
) -> Result<(), String> {
    let offline = |error: reqwest::Error| format!("The download did not finish: {error}");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let part = path.with_extension("part");
    let mut response = client
        .get(pin.url)
        .send()
        .await
        .and_then(reqwest::Response::error_for_status)
        .map_err(offline)?;
    let mut file = fs::File::create(&part).map_err(|error| error.to_string())?;
    let mut hash = Sha256::new();
    let mut size = 0u64;
    let mut unsaid = 0u64;
    let written = async {
        while let Some(chunk) = response.chunk().await.map_err(offline)? {
            size += chunk.len() as u64;
            if size > pin.size {
                return Err("The download is larger than it should be".to_owned());
            }
            hash.update(&chunk);
            file.write_all(&chunk).map_err(|error| error.to_string())?;
            unsaid += chunk.len() as u64;
            if unsaid >= 1 << 20 {
                moved(unsaid);
                unsaid = 0;
            }
        }
        Ok(())
    }
    .await;
    moved(unsaid);
    drop(file);
    let checked = written.and_then(|()| {
        if size == pin.size && hex(&hash.finalize()) == pin.sha256 {
            Ok(())
        } else {
            Err("The download is not the file it should be; nothing was kept".to_owned())
        }
    });
    match checked {
        Ok(()) => fs::rename(&part, path).map_err(|error| error.to_string()),
        Err(error) => {
            let _ = fs::remove_file(&part);
            Err(error)
        }
    }
}

fn inside(path: &Path) -> Option<PathBuf> {
    let mut parts = path.components();
    match parts.next() {
        Some(Component::Normal(_)) => {}
        _ => return None,
    }
    let mut kept = PathBuf::new();
    for part in parts {
        match part {
            Component::Normal(name) => kept.push(name),
            Component::CurDir => {}
            _ => return None,
        }
    }
    (!kept.as_os_str().is_empty()).then_some(kept)
}

fn written_out(
    into: &Path,
    relative: &Path,
    from: &mut impl Read,
    runs: bool,
) -> Result<(), String> {
    let target = into.join(relative);
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut out = fs::File::create(&target).map_err(|error| error.to_string())?;
    std::io::copy(from, &mut out).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt as _;
        let mode = if runs { 0o755 } else { 0o644 };
        fs::set_permissions(&target, fs::Permissions::from_mode(mode))
            .map_err(|error| error.to_string())?;
    }
    #[cfg(not(unix))]
    let _ = runs;
    Ok(())
}

fn untar(archive: &Path, into: &Path) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|error| error.to_string())?;
    let mut tar = tar::Archive::new(flate2::read::GzDecoder::new(file));
    for entry in tar.entries().map_err(|error| error.to_string())? {
        let mut entry = entry.map_err(|error| error.to_string())?;
        let path = entry
            .path()
            .map_err(|error| error.to_string())?
            .into_owned();
        let kind = entry.header().entry_type();
        if !(kind.is_file() || kind.is_dir()) {
            continue;
        }
        let Some(relative) = inside(&path) else {
            if path.components().count() <= 1 && kind.is_dir() {
                continue;
            }
            return Err(format!("{} is outside where it belongs", path.display()));
        };
        if kind.is_dir() {
            fs::create_dir_all(into.join(relative)).map_err(|error| error.to_string())?;
            continue;
        }
        let runs = entry.header().mode().is_ok_and(|mode| mode & 0o111 != 0);
        written_out(into, &relative, &mut entry, runs)?;
    }
    Ok(())
}

fn unzip(archive: &Path, into: &Path) -> Result<(), String> {
    let file = fs::File::open(archive).map_err(|error| error.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|error| error.to_string())?;
    for index in 0..zip.len() {
        let mut entry = zip.by_index(index).map_err(|error| error.to_string())?;
        let Some(path) = entry.enclosed_name() else {
            return Err(format!("{} is outside where it belongs", entry.name()));
        };
        let Some(relative) = inside(&path) else {
            continue;
        };
        if entry.is_dir() {
            fs::create_dir_all(into.join(relative)).map_err(|error| error.to_string())?;
            continue;
        }
        let runs = entry.unix_mode().is_some_and(|mode| mode & 0o111 != 0);
        written_out(into, &relative, &mut entry, runs)?;
    }
    Ok(())
}

pub fn unpack(archive: &Path, packing: Packing, into: &Path) -> Result<(), String> {
    fs::create_dir_all(into).map_err(|error| error.to_string())?;
    match packing {
        Packing::TarGz => untar(archive, into),
        Packing::Zip => unzip(archive, into),
    }
}

#[cfg(test)]
mod tests {
    use super::{fetch, inside, unpack, Pinned};
    use crate::sidecar::catalog::Packing;
    use std::io::{Read as _, Write as _};
    use std::net::TcpListener;
    use std::path::Path;

    fn served(body: Vec<u8>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let place = listener.local_addr().unwrap();
        std::thread::spawn(move || {
            if let Ok((mut socket, _)) = listener.accept() {
                let mut asked = [0u8; 4096];
                let _ = socket.read(&mut asked);
                let head = format!(
                    "HTTP/1.1 200 OK\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                    body.len()
                );
                let _ = socket.write_all(head.as_bytes());
                let _ = socket.write_all(&body);
            }
        });
        format!("http://{place}/archive")
    }

    fn pin(url: &str, size: u64, sha256: &'static str) -> Pinned {
        Pinned {
            url: Box::leak(url.to_owned().into_boxed_str()),
            size,
            sha256,
            packing: Packing::TarGz,
        }
    }

    #[test]
    fn a_download_that_is_not_the_pinned_file_is_refused_and_nothing_is_kept() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("archive.tar.gz");
        let url = served(b"not what was pinned".to_vec());
        let wrong = pin(
            &url,
            19,
            "0000000000000000000000000000000000000000000000000000000000000000",
        );
        let client = super::client().unwrap();
        let fetched = tauri::async_runtime::block_on(fetch(&client, &wrong, &path, &mut |_| {}));
        assert!(fetched.is_err());
        assert!(!path.exists());
        assert!(!path.with_extension("part").exists());
    }

    #[test]
    fn a_download_that_is_the_pinned_file_is_kept() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("archive.tar.gz");
        let url = served(b"hello".to_vec());
        let right = pin(
            &url,
            5,
            "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
        );
        let client = super::client().unwrap();
        let mut moved = 0;
        tauri::async_runtime::block_on(fetch(&client, &right, &path, &mut |more| moved += more))
            .unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"hello");
        assert_eq!(moved, 5);
    }

    #[test]
    fn only_paths_below_the_top_folder_are_unpacked() {
        assert_eq!(
            inside(Path::new("jdk/bin/java")).as_deref(),
            Some(Path::new("bin/java"))
        );
        assert!(inside(Path::new("jdk")).is_none());
        assert!(inside(Path::new("jdk/../../etc/passwd")).is_none());
        assert!(inside(Path::new("/etc/passwd")).is_none());
    }

    #[test]
    fn a_tar_is_unpacked_without_its_top_folder_and_keeps_what_runs() {
        let folder = tempfile::tempdir().unwrap();
        let archive = folder.path().join("a.tar.gz");
        {
            let file = std::fs::File::create(&archive).unwrap();
            let gz = flate2::write::GzEncoder::new(file, flate2::Compression::fast());
            let mut tar = tar::Builder::new(gz);
            let mut header = tar::Header::new_gnu();
            header.set_size(4);
            header.set_mode(0o755);
            header.set_cksum();
            tar.append_data(&mut header, "top/bin/run", &b"echo"[..])
                .unwrap();
            let mut header = tar::Header::new_gnu();
            header.set_size(2);
            header.set_mode(0o644);
            header.set_cksum();
            tar.append_data(&mut header, "top/lib/a.jar", &b"jr"[..])
                .unwrap();
            tar.into_inner().unwrap().finish().unwrap();
        }
        let into = folder.path().join("out");
        unpack(&archive, Packing::TarGz, &into).unwrap();
        assert_eq!(std::fs::read(into.join("bin/run")).unwrap(), b"echo");
        assert_eq!(std::fs::read(into.join("lib/a.jar")).unwrap(), b"jr");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            let mode = std::fs::metadata(into.join("bin/run"))
                .unwrap()
                .permissions()
                .mode();
            assert_eq!(mode & 0o111, 0o111);
        }
    }
}
