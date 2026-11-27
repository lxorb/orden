use std::collections::BTreeMap;
use std::fs;
use std::io::{self, Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::{Duration, Instant};

use base64::Engine as _;
use flate2::read::GzDecoder;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha512};

pub const SOURCE: &str = "registry.npmjs.org";
pub const REGISTRY: &str = "https://registry.npmjs.org";
const BINARY: &str = if cfg!(windows) { "opencode.exe" } else { "opencode" };
const TOLD_EVERY: Duration = Duration::from_millis(250);
#[derive(Debug, Deserialize)]
pub struct Pin {
    pub version: String,
    pub sha512: BTreeMap<String, String>,
    #[serde(default)]
    pub bytes: BTreeMap<String, u64>,
}
pub fn pin() -> &'static Pin {
    static PIN: OnceLock<Pin> = OnceLock::new();
    PIN.get_or_init(|| {
        serde_json::from_str(include_str!("../../../opencode.json")).expect("opencode.json")
    })
}
pub fn platform() -> Option<&'static str> {
    match (std::env::consts::OS, std::env::consts::ARCH) {
        ("linux", "x86_64") => Some("linux-x64-baseline"),
        ("linux", "aarch64") => Some("linux-arm64"),
        ("macos", "aarch64") => Some("darwin-arm64"),
        ("macos", "x86_64") => Some("darwin-x64-baseline"),
        ("windows", "x86_64") => Some("windows-x64-baseline"),
        ("windows", "aarch64") => Some("windows-arm64"),
        _ => None,
    }
}
pub fn tarball(registry: &str, platform: &str, version: &str) -> String {
    format!("{registry}/opencode-{platform}/-/opencode-{platform}-{version}.tgz")
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    NotDownloaded,
    Offline,
    DiskFull,
    Checksum,
    Http,
    Cancelled,
    Busy,
    Failed,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Failure {
    pub kind: Kind,
    pub detail: String,
}
impl Failure {
    pub fn new(kind: Kind, detail: impl Into<String>) -> Failure {
        Failure { kind, detail: detail.into() }
    }
    fn of_disk(why: &io::Error) -> Failure {
        let kind =
            if matches!(why.kind(), io::ErrorKind::StorageFull | io::ErrorKind::QuotaExceeded) {
                Kind::DiskFull
            } else {
                Kind::Failed
            };
        Failure::new(kind, why.to_string())
    }
    fn of_net(why: &reqwest::Error) -> Failure {
        let kind = if why.is_connect() || why.is_timeout() { Kind::Offline } else { Kind::Http };
        Failure::new(kind, why.to_string())
    }
}
impl From<String> for Failure {
    fn from(detail: String) -> Failure {
        Failure::new(Kind::Failed, detail)
    }
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum Heard {
    Progress { received: u64, total: u64 },
    Done { version: String },
    Failed { kind: Kind, detail: String },
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Engines {
    pub folder: PathBuf,
}
#[derive(Default, Deserialize, Serialize)]
struct Consent {
    background: bool,
}
impl Engines {
    pub fn binary_of(&self, version: &str) -> PathBuf {
        self.folder.join(version).join(BINARY)
    }
    fn part(&self, version: &str) -> PathBuf {
        self.folder.join(format!("{version}.part"))
    }
    fn fresh(&self, version: &str) -> PathBuf {
        self.folder.join(format!("{version}.new"))
    }
    fn consent(&self) -> PathBuf {
        self.folder.join("consent.json")
    }
    pub fn has(&self, version: &str) -> bool {
        self.binary_of(version).is_file()
    }
    pub fn usable(&self, version: &str) -> Option<PathBuf> {
        if self.has(version) {
            return Some(self.binary_of(version));
        }
        let mut others: Vec<(std::time::SystemTime, PathBuf)> = fs::read_dir(&self.folder)
            .into_iter()
            .flatten()
            .flatten()
            .map(|one| one.path().join(BINARY))
            .filter(|one| one.is_file())
            .filter_map(|one| {
                Some((fs::metadata(&one).and_then(|meta| meta.modified()).ok()?, one))
            })
            .collect();
        others.sort();
        others.pop().map(|(_, newest)| newest)
    }
    pub fn background(&self) -> bool {
        fs::read_to_string(self.consent())
            .ok()
            .and_then(|text| serde_json::from_str::<Consent>(&text).ok())
            .is_some_and(|consent| consent.background)
    }
    pub fn set_background(&self, background: bool) -> io::Result<()> {
        fs::create_dir_all(&self.folder)?;
        fs::write(
            self.consent(),
            serde_json::to_string(&Consent { background }).unwrap_or_default(),
        )
    }
    pub fn tidy(&self, keep: &[&Path]) {
        let kept = |path: &Path| keep.iter().any(|one| one.starts_with(path));
        for one in fs::read_dir(&self.folder).into_iter().flatten().flatten() {
            let path = one.path();
            if path.is_dir() && !kept(&path) {
                let _ = fs::remove_dir_all(&path);
            }
        }
    }
}
fn sha512_of(path: &Path) -> io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hash = Sha512::new();
    let mut piece = vec![0u8; 1 << 16];
    loop {
        let size = file.read(&mut piece)?;
        if size == 0 {
            break;
        }
        hash.update(&piece[..size]);
    }
    Ok(base64::engine::general_purpose::STANDARD.encode(hash.finalize()))
}
fn octal(field: &[u8]) -> u64 {
    let text: String =
        field.iter().take_while(|one| **one != 0).map(|one| char::from(*one)).collect();
    u64::from_str_radix(text.trim(), 8).unwrap_or(0)
}
pub fn unpacked(tgz: &Path, wanted: &str, out: &Path) -> io::Result<()> {
    let mut tar = GzDecoder::new(fs::File::open(tgz)?);
    let mut head = [0u8; 512];
    loop {
        tar.read_exact(&mut head)?;
        let name: String =
            head[..100].iter().take_while(|one| **one != 0).map(|one| char::from(*one)).collect();
        if name.is_empty() {
            return Err(io::Error::new(
                io::ErrorKind::NotFound,
                format!("{wanted} is not in the package"),
            ));
        }
        let size = octal(&head[124..136]);
        let padded = size.div_ceil(512) * 512;
        if name == wanted {
            let mut file = fs::File::create(out)?;
            io::copy(&mut (&mut tar).take(size), &mut file)?;
            file.flush()?;
            return Ok(());
        }
        io::copy(&mut (&mut tar).take(padded), &mut io::sink())?;
    }
}
#[cfg(unix)]
fn runnable(path: &Path) -> io::Result<()> {
    use std::os::unix::fs::PermissionsExt as _;
    fs::set_permissions(path, fs::Permissions::from_mode(0o755))
}
#[cfg(not(unix))]
#[allow(clippy::unnecessary_wraps)]
fn runnable(_: &Path) -> io::Result<()> {
    Ok(())
}
pub struct Asked<'a> {
    pub engines: &'a Engines,
    pub registry: &'a str,
    pub version: &'a str,
    pub platform: &'a str,
    pub sha512: &'a str,
    pub bytes: Option<u64>,
}
async fn fetched(
    asked: &Asked<'_>,
    cancel: &AtomicBool,
    tell: &mut impl FnMut(Heard),
) -> Result<(), Failure> {
    let part = asked.engines.part(asked.version);
    let mut have = fs::metadata(&part).map_or(0, |meta| meta.len());
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .read_timeout(Duration::from_secs(60))
        .build()
        .map_err(|why| Failure::of_net(&why))?;
    let mut request = client.get(tarball(asked.registry, asked.platform, asked.version));
    if have > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={have}-"));
    }
    let mut response = request.send().await.map_err(|why| Failure::of_net(&why))?;
    let status = response.status();
    let total = match status.as_u16() {
        206 => asked.bytes.or_else(|| response.content_length().map(|rest| rest + have)),
        200 => {
            have = 0;
            asked.bytes.or_else(|| response.content_length())
        }
        416 if asked.bytes.is_some_and(|bytes| bytes == have) => return Ok(()),
        _ => {
            let _ = fs::remove_file(&part);
            return Err(Failure::new(Kind::Http, format!("{SOURCE} answered {status}")));
        }
    }
    .unwrap_or(0);
    let mut file = fs::OpenOptions::new()
        .create(true)
        .write(true)
        .append(have > 0)
        .truncate(have == 0)
        .open(&part)
        .map_err(|why| Failure::of_disk(&why))?;
    let mut told = Instant::now();
    tell(Heard::Progress { received: have, total });
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(Failure::new(Kind::Cancelled, "the download was stopped"));
        }
        let Some(chunk) = response.chunk().await.map_err(|why| Failure::of_net(&why))? else {
            break;
        };
        have += chunk.len() as u64;
        if asked.bytes.is_some_and(|bytes| have > bytes) {
            drop(file);
            let _ = fs::remove_file(&part);
            return Err(Failure::new(Kind::Checksum, "the package is larger than the one pinned"));
        }
        file.write_all(&chunk).map_err(|why| Failure::of_disk(&why))?;
        if told.elapsed() >= TOLD_EVERY {
            told = Instant::now();
            tell(Heard::Progress { received: have, total });
        }
    }
    file.flush().map_err(|why| Failure::of_disk(&why))?;
    tell(Heard::Progress { received: have, total });
    Ok(())
}
pub async fn download(
    asked: &Asked<'_>,
    cancel: &AtomicBool,
    tell: &mut impl FnMut(Heard),
) -> Result<PathBuf, Failure> {
    let engines = asked.engines;
    let version = asked.version;
    if engines.has(version) {
        tell(Heard::Done { version: version.to_owned() });
        return Ok(engines.binary_of(version));
    }
    fs::create_dir_all(&engines.folder).map_err(|why| Failure::of_disk(&why))?;
    fetched(asked, cancel, tell).await?;
    let part = engines.part(version);
    let held = sha512_of(&part).map_err(|why| Failure::of_disk(&why))?;
    if held != asked.sha512 {
        let _ = fs::remove_file(&part);
        return Err(Failure::new(
            Kind::Checksum,
            format!("sha512 {held}, pinned {}", asked.sha512),
        ));
    }
    let fresh = engines.fresh(version);
    let _ = fs::remove_dir_all(&fresh);
    fs::create_dir_all(&fresh).map_err(|why| Failure::of_disk(&why))?;
    let binary = fresh.join(BINARY);
    unpacked(&part, &format!("package/bin/{BINARY}"), &binary)
        .and_then(|()| runnable(&binary))
        .map_err(|why| Failure::of_disk(&why))?;
    let home = engines.folder.join(version);
    let _ = fs::remove_dir_all(&home);
    fs::rename(&fresh, &home).map_err(|why| Failure::of_disk(&why))?;
    let _ = fs::remove_file(&part);
    tell(Heard::Done { version: version.to_owned() });
    Ok(engines.binary_of(version))
}
#[cfg(test)]
mod tests {
    use super::*;
    use flate2::write::GzEncoder;
    use std::io::{BufRead as _, BufReader};
    use std::net::{TcpListener, TcpStream};
    use std::sync::{Arc, Mutex};

    fn tgz(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut tar = Vec::new();
        for (name, body) in files {
            let mut head = [0u8; 512];
            head[..name.len()].copy_from_slice(name.as_bytes());
            head[100..108].copy_from_slice(b"0000755\0");
            let size = format!("{:011o}\0", body.len());
            head[124..136].copy_from_slice(size.as_bytes());
            head[156] = b'0';
            head[257..263].copy_from_slice(b"ustar\0");
            tar.extend_from_slice(&head);
            tar.extend_from_slice(body);
            tar.resize(tar.len().div_ceil(512) * 512, 0);
        }
        tar.resize(tar.len() + 1024, 0);
        let mut gz = GzEncoder::new(Vec::new(), flate2::Compression::fast());
        gz.write_all(&tar).expect("gz");
        gz.finish().expect("gz")
    }
    fn sha(bytes: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(Sha512::digest(bytes))
    }
    struct Registry {
        url: String,
        ranges: Arc<Mutex<Vec<Option<String>>>>,
    }
    fn registry(body: Vec<u8>, honours_range: bool, status: u16) -> Registry {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let url = format!("http://127.0.0.1:{}", listener.local_addr().expect("addr").port());
        let ranges = Arc::new(Mutex::new(Vec::new()));
        let kept = ranges.clone();
        std::thread::spawn(move || {
            for stream in listener.incoming().flatten() {
                let range = served(stream, &body, honours_range, status);
                kept.lock().expect("ranges").push(range);
            }
        });
        Registry { url, ranges }
    }
    fn served(stream: TcpStream, body: &[u8], honours_range: bool, status: u16) -> Option<String> {
        let mut reader = BufReader::new(stream.try_clone().expect("clone"));
        let mut range = None;
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line).unwrap_or(0) == 0 || line == "\r\n" {
                break;
            }
            if let Some(value) = line.to_ascii_lowercase().strip_prefix("range: bytes=") {
                range = Some(value.trim().trim_end_matches('-').to_owned());
            }
        }
        let mut stream = stream;
        if status != 200 {
            let _ = write!(
                stream,
                "HTTP/1.1 {status} No\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            return range;
        }
        let from =
            range.as_deref().filter(|_| honours_range).and_then(|one| one.parse::<usize>().ok());
        let (code, rest) = match from {
            Some(from) => ("206 Partial Content", &body[from.min(body.len())..]),
            None => ("200 OK", body),
        };
        let _ = write!(
            stream,
            "HTTP/1.1 {code}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
            rest.len()
        );
        let _ = stream.write_all(rest);
        range
    }
    struct Case {
        dir: tempfile::TempDir,
        engines: Engines,
        package: Vec<u8>,
    }
    fn fresh_case() -> Case {
        let dir = tempfile::tempdir().expect("a folder");
        let engines = Engines { folder: dir.path().join("engine") };
        let package = tgz(&[
            ("package/package.json", b"{}"),
            (&format!("package/bin/{BINARY}"), b"#!/bin/sh\necho opencode\n"),
        ]);
        Case { dir, engines, package }
    }
    fn asked<'a>(case: &'a Case, registry: &'a str, sha512: &'a str) -> Asked<'a> {
        Asked {
            engines: &case.engines,
            registry,
            version: "9.9.9",
            platform: "linux-x64-baseline",
            sha512,
            bytes: Some(case.package.len() as u64),
        }
    }
    fn run(asked: &Asked<'_>, cancel: &AtomicBool) -> (Result<PathBuf, Failure>, Vec<Heard>) {
        let mut heard = Vec::new();
        let done =
            tauri::async_runtime::block_on(download(asked, cancel, &mut |one| heard.push(one)));
        (done, heard)
    }
    #[test]
    fn a_pinned_engine_downloads_checks_and_lands_whole_and_a_cut_one_carries_on() {
        let case = fresh_case();
        let sha512 = sha(&case.package);
        let server = registry(case.package.clone(), true, 200);
        let (done, heard) = run(&asked(&case, &server.url, &sha512), &AtomicBool::new(false));
        let binary = done.expect("installed");
        assert_eq!(binary, case.engines.binary_of("9.9.9"));
        assert_eq!(fs::read(&binary).expect("binary"), b"#!/bin/sh\necho opencode\n");
        assert_eq!(heard.last(), Some(&Heard::Done { version: "9.9.9".into() }));
        assert!(heard.iter().any(|one| matches!(one, Heard::Progress { total, .. } if *total == case.package.len() as u64)));
        assert!(!case.engines.part("9.9.9").exists() && !case.engines.fresh("9.9.9").exists());
        assert_eq!(case.engines.usable("9.9.9"), Some(binary.clone()));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt as _;
            assert_eq!(fs::metadata(&binary).expect("meta").permissions().mode() & 0o777, 0o755);
        }
        let again = fresh_case();
        let half = again.package.len() / 2;
        fs::create_dir_all(&again.engines.folder).expect("folder");
        fs::write(again.engines.part("9.9.9"), &again.package[..half]).expect("part");
        let sha512 = sha(&again.package);
        let server = registry(again.package.clone(), true, 200);
        let (done, _) = run(&asked(&again, &server.url, &sha512), &AtomicBool::new(false));
        assert!(done.is_ok(), "{done:?}");
        assert_eq!(server.ranges.lock().expect("ranges").as_slice(), [Some(half.to_string())]);
        let stubborn = fresh_case();
        fs::create_dir_all(&stubborn.engines.folder).expect("folder");
        fs::write(stubborn.engines.part("9.9.9"), b"stale bytes").expect("part");
        let sha512 = sha(&stubborn.package);
        let server = registry(stubborn.package.clone(), false, 200);
        let (done, _) = run(&asked(&stubborn, &server.url, &sha512), &AtomicBool::new(false));
        assert!(done.is_ok(), "a server that ignores the range sends it whole: {done:?}");
        drop((case.dir, again.dir, stubborn.dir));
    }
    #[test]
    fn a_wrong_missing_unreachable_or_stopped_download_says_which_and_keeps_nothing_false() {
        let case = fresh_case();
        let server = registry(case.package.clone(), true, 200);
        let (done, _) = run(&asked(&case, &server.url, "not-the-hash"), &AtomicBool::new(false));
        assert_eq!(done.map_err(|one| one.kind), Err(Kind::Checksum));
        assert!(!case.engines.part("9.9.9").exists() && !case.engines.has("9.9.9"));
        let sha512 = sha(&case.package);
        let missing = registry(Vec::new(), true, 404);
        let (done, _) = run(&asked(&case, &missing.url, &sha512), &AtomicBool::new(false));
        assert_eq!(done.map_err(|one| one.kind), Err(Kind::Http));
        let closed = TcpListener::bind("127.0.0.1:0").expect("bind");
        let gone = format!("http://127.0.0.1:{}", closed.local_addr().expect("addr").port());
        drop(closed);
        let (done, heard) = run(&asked(&case, &gone, &sha512), &AtomicBool::new(false));
        assert_eq!(done.map_err(|one| one.kind), Err(Kind::Offline));
        assert!(heard.is_empty());
        let (done, _) = run(&asked(&case, &server.url, &sha512), &AtomicBool::new(true));
        assert_eq!(done.map_err(|one| one.kind), Err(Kind::Cancelled));
        assert!(
            case.engines.part("9.9.9").exists(),
            "a stopped download keeps what came to carry on"
        );
        assert!(!case.engines.has("9.9.9"));
        let error = serde_json::to_value(Failure::new(Kind::DiskFull, "full")).expect("json");
        assert_eq!(error, serde_json::json!({ "kind": "disk_full", "detail": "full" }));
        let said = serde_json::to_value(Heard::Progress { received: 1, total: 2 }).expect("json");
        assert_eq!(said, serde_json::json!({ "type": "progress", "received": 1, "total": 2 }));
    }
    #[test]
    fn an_older_engine_stays_usable_until_the_pinned_one_lands_and_the_reader_s_choice_is_kept() {
        let case = fresh_case();
        assert_eq!(case.engines.usable("2.0.0"), None);
        assert!(!case.engines.background());
        let old = case.engines.binary_of("1.0.0");
        fs::create_dir_all(old.parent().expect("folder")).expect("folder");
        fs::write(&old, "old").expect("old");
        assert_eq!(case.engines.usable("2.0.0"), Some(old.clone()));
        let new = case.engines.binary_of("2.0.0");
        fs::create_dir_all(new.parent().expect("folder")).expect("folder");
        fs::write(&new, "new").expect("new");
        assert_eq!(case.engines.usable("2.0.0"), Some(new.clone()));
        case.engines.tidy(&[&new]);
        assert!(!old.exists() && new.exists());
        case.engines.set_background(true).expect("kept");
        assert!(case.engines.background());
        case.engines.set_background(false).expect("kept");
        assert!(!case.engines.background());
        assert!(new.exists(), "tidying keeps the choice and the kept engine");
    }
    #[test]
    fn every_platform_orden_ships_for_has_a_pinned_package() {
        let pin = pin();
        assert!(!pin.version.is_empty());
        for one in [
            "linux-x64-baseline",
            "linux-arm64",
            "darwin-arm64",
            "darwin-x64-baseline",
            "windows-x64-baseline",
            "windows-arm64",
        ] {
            assert!(pin.sha512.contains_key(one), "{one}");
        }
        if let Some(here) = platform() {
            assert!(pin.sha512.contains_key(here), "{here}");
        }
        assert_eq!(
            tarball(REGISTRY, "linux-arm64", "1.19.6"),
            "https://registry.npmjs.org/opencode-linux-arm64/-/opencode-linux-arm64-1.19.6.tgz"
        );
    }
    #[test]
    fn the_pinned_engine_comes_from_npm_whole_and_runs() {
        if std::env::var_os("ORDEN_OPENCODE_DOWNLOAD").is_none() {
            return;
        }
        let dir = tempfile::tempdir().expect("a folder");
        let engines = Engines { folder: dir.path().join("engine") };
        let pin = pin();
        let platform = platform().expect("a pinned platform");
        let asked = Asked {
            engines: &engines,
            registry: REGISTRY,
            version: &pin.version,
            platform,
            sha512: &pin.sha512[platform],
            bytes: pin.bytes.get(platform).copied(),
        };
        let mut heard = Vec::new();
        let binary =
            tauri::async_runtime::block_on(download(&asked, &AtomicBool::new(false), &mut |one| {
                heard.push(one);
            }))
            .expect("downloaded");
        let said = std::process::Command::new(&binary).arg("--version").output().expect("ran");
        assert_eq!(String::from_utf8_lossy(&said.stdout).trim(), pin.version);
        assert!(heard.len() > 2);
    }
}
