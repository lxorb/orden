//! Dictation heard on this device, with nothing sent anywhere (#1151).
//!
//! The window records and cuts the voice as it does for every road (dictation/
//! listening.ts); this hears a stretch of it. The model and the runtime that runs it are
//! downloaded when the reader turns this on, once, into `<app local data>/dictation`,
//! each file checked against the hash `catalog` pins, and removed from Settings with
//! `dictation_local_remove`. The model is opened when a dictation starts and closed again
//! after a few idle minutes, since it holds a gigabyte of memory.

mod catalog;
mod device;
mod sherpa;

use std::fs;
use std::io::{Read as _, Write as _};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use serde::Serialize;
use sha2::{Digest as _, Sha256};
use tauri::ipc::{Channel, InvokeBody, Request};
use tauri::{AppHandle, Manager};

use catalog::{Model, Pinned, Runtime, PARAKEET};
use device::{Device, Fit};

/// How long an open model stays open with nothing to hear.
const IDLE: Duration = Duration::from_secs(5 * 60);

/// What Settings and the engine choice read: whether this device can hear on its own,
/// with which model, and whether that is here yet.
#[derive(Serialize)]
pub struct Local {
    device: Device,
    fit: Fit,
    model: Offered,
    installed: bool,
}

/// The model this device would download.
#[derive(Serialize)]
struct Offered {
    id: &'static str,
    name: &'static str,
    bytes: u64,
}

/// How far a download has come, in bytes of all of it.
#[derive(Clone, Serialize)]
pub struct Fetched {
    done: u64,
    total: u64,
}

/// The open model, when it last heard, and how fast it heard as it opened.
#[derive(Default)]
pub struct Loaded {
    engine: Mutex<Option<(sherpa::Engine, Instant, f32)>>,
}

/// One download at a time.
static FETCHING: AtomicBool = AtomicBool::new(false);

fn model() -> &'static Model {
    &PARAKEET
}

fn folder(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_local_data_dir()
        .map(|dir| dir.join("dictation"))
        .map_err(|error| error.to_string())
}

fn runtime_folder(root: &Path, runtime: &Runtime) -> PathBuf {
    root.join(format!(
        "runtime-{}-{}",
        runtime.rid,
        catalog::RUNTIME_VERSION
    ))
}

/// Whether a file is there at the size it is pinned at.
fn present(path: &Path, pin: &Pinned) -> bool {
    fs::metadata(path).is_ok_and(|found| found.len() == pin.size)
}

fn sha256_of(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path).map_err(|error| error.to_string())?;
    let mut hash = Sha256::new();
    let mut buffer = vec![0u8; 1 << 20];
    loop {
        let read = file.read(&mut buffer).map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
    }
    Ok(hex(&hash.finalize()))
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write as _;
    bytes.iter().fold(String::new(), |mut out, b| {
        let _ = write!(out, "{b:02x}");
        out
    })
}

fn installed(root: &Path) -> bool {
    let Some(runtime) = catalog::this_runtime() else {
        return false;
    };
    let libraries = runtime_folder(root, runtime);
    present(
        &libraries.join(runtime.onnxruntime.name),
        &runtime.onnxruntime,
    ) && present(&libraries.join(runtime.api.name), &runtime.api)
        && model()
            .files
            .iter()
            .all(|one| present(&root.join(model().id).join(one.name), one))
}

/// Whether this device can dictate on its own, and whether the model is here.
#[tauri::command(async)]
pub fn dictation_local(app: AppHandle) -> Result<Local, String> {
    let here = device::this();
    let model = model();
    Ok(Local {
        fit: device::fit(&here, model),
        device: here,
        model: Offered {
            id: model.id,
            name: model.name,
            bytes: model.bytes(),
        },
        installed: installed(&folder(&app)?),
    })
}

/// Downloads the runtime and the model, whatever of them is not here yet, saying how far
/// it has come on `progress`.
#[tauri::command]
pub async fn dictation_local_fetch(
    app: AppHandle,
    progress: Channel<Fetched>,
) -> Result<(), String> {
    let root = folder(&app)?;
    if FETCHING.swap(true, Ordering::SeqCst) {
        return Err("The speech model is already being downloaded.".to_owned());
    }
    let result = fetch_all(&root, &mut |fetched| {
        let _ = progress.send(fetched);
    })
    .await;
    FETCHING.store(false, Ordering::SeqCst);
    result
}

async fn fetch_all(root: &Path, progress: &mut impl FnMut(Fetched)) -> Result<(), String> {
    let runtime = catalog::this_runtime().ok_or("This device has no speech runtime.")?;
    let model = model();
    let libraries = runtime_folder(root, runtime);
    let runtime_here = present(
        &libraries.join(runtime.onnxruntime.name),
        &runtime.onnxruntime,
    ) && present(&libraries.join(runtime.api.name), &runtime.api);
    let mut wanted: Vec<(String, Pinned, PathBuf)> = Vec::new();
    if !runtime_here {
        wanted.push((
            runtime.url(),
            runtime.package,
            root.join(format!("{}.zip", runtime.rid)),
        ));
    }
    let models = root.join(model.id);
    for file in model.files {
        let path = models.join(file.name);
        if !present(&path, file) {
            wanted.push((model.url(file), *file, path));
        }
    }
    let total = wanted.iter().map(|(_, pin, _)| pin.size).sum();
    let mut done = 0;
    progress(Fetched { done, total });
    let client = client()?;
    for (url, pin, path) in &wanted {
        fetch_one(&client, url, pin, path, &mut |more| {
            done += more;
            progress(Fetched { done, total });
        })
        .await?;
    }
    if !runtime_here {
        let zip = root.join(format!("{}.zip", runtime.rid));
        let unpacked = unpack(&zip, runtime, &libraries);
        let _ = fs::remove_file(&zip);
        unpacked?;
    }
    Ok(())
}

fn client() -> Result<reqwest::Client, String> {
    // Set once for the process; a second setting is refused harmlessly.
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .build()
        .map_err(|error| error.to_string())
}

/// One file, to `path` by way of a `.part` beside it, kept only if it is the size and
/// the hash `pin` says.
async fn fetch_one(
    client: &reqwest::Client,
    url: &str,
    pin: &Pinned,
    path: &Path,
    moved: &mut impl FnMut(u64),
) -> Result<(), String> {
    let offline =
        |error: reqwest::Error| format!("The speech model could not be downloaded: {error}");
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let part = path.with_extension("part");
    let mut response = client
        .get(url)
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
                return Err(format!("{} is larger than it should be", pin.name));
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
            Err(format!(
                "{} did not arrive as it should; nothing was kept",
                pin.name
            ))
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

/// The two libraries out of the runtime's package, each checked as it is written.
fn unpack(zip: &Path, runtime: &Runtime, into: &Path) -> Result<(), String> {
    let file = fs::File::open(zip).map_err(|error| error.to_string())?;
    let mut archive = zip::ZipArchive::new(file).map_err(|error| error.to_string())?;
    fs::create_dir_all(into).map_err(|error| error.to_string())?;
    for pin in [runtime.onnxruntime, runtime.api] {
        let inside = format!("runtimes/{}/native/{}", runtime.rid, pin.name);
        let mut entry = archive
            .by_name(&inside)
            .map_err(|error| format!("{inside}: {error}"))?;
        let path = into.join(pin.name);
        let mut out = fs::File::create(&path).map_err(|error| error.to_string())?;
        std::io::copy(&mut entry, &mut out).map_err(|error| error.to_string())?;
        drop(out);
        if sha256_of(&path)? != pin.sha256 {
            let _ = fs::remove_file(&path);
            return Err(format!("{} is not the file it should be", pin.name));
        }
    }
    Ok(())
}

/// Closes the model and deletes everything local dictation downloaded.
#[tauri::command(async)]
pub fn dictation_local_remove(app: AppHandle) -> Result<(), String> {
    if FETCHING.load(Ordering::SeqCst) {
        return Err("The speech model is being downloaded.".to_owned());
    }
    *lock(&app.state::<Arc<Loaded>>()) = None;
    let root = folder(&app)?;
    match fs::remove_dir_all(&root) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn lock(loaded: &Loaded) -> std::sync::MutexGuard<'_, Option<(sherpa::Engine, Instant, f32)>> {
    loaded
        .engine
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
}

/// How fast an open model heard its first stretch: seconds of work per second of sound.
#[derive(Serialize)]
pub struct Opened {
    pace: f32,
}

/// Opens the model, where it is not open already, and says how fast it hears here.
#[tauri::command(async)]
pub fn dictation_local_open(app: AppHandle) -> Result<Opened, String> {
    let loaded = Arc::clone(&app.state::<Arc<Loaded>>());
    let mut held = lock(&loaded);
    let (pace, fresh) = opened(
        &mut held,
        || open_engine(&folder(&app)?),
        |engine| {
            // Two seconds of a quiet room, twice: the first pass's own start-up paid here
            // rather than in the reader's first words, and the second is what a live pass
            // costs.
            let quiet: Vec<f32> = (0..32_000u16)
                .map(|i| f32::from(i.wrapping_mul(7919) % 200) / 100_000.0 - 0.001)
                .collect();
            engine.hear(&quiet, "")?;
            let started = Instant::now();
            engine.hear(&quiet, "")?;
            Ok(started.elapsed().as_secs_f32() / 2.0)
        },
    )?;
    drop(held);
    if fresh {
        watch_idle(loaded);
    }
    Ok(Opened { pace })
}

/// The engine `held` has open, opened and timed where it has none: answers its pace, and
/// whether it was opened just now. A dictation starts with this, and the microphone only
/// after it, so the two passes that time a model are its opening's alone.
fn opened<E>(
    held: &mut Option<(E, Instant, f32)>,
    open: impl FnOnce() -> Result<E, String>,
    timed: impl FnOnce(&mut E) -> Result<f32, String>,
) -> Result<(f32, bool), String> {
    if let Some((_, used, pace)) = held.as_mut() {
        *used = Instant::now();
        return Ok((*pace, false));
    }
    let mut engine = open()?;
    let pace = timed(&mut engine)?;
    *held = Some((engine, Instant::now(), pace));
    Ok((pace, true))
}

/// The model in `root`, opened, with the runtime's libraries checked against their
/// hashes before they are loaded.
fn open_engine(root: &Path) -> Result<sherpa::Engine, String> {
    let runtime = catalog::this_runtime().ok_or("This device has no speech runtime.")?;
    if !installed(root) {
        return Err("The speech model is not downloaded.".to_owned());
    }
    let libraries = runtime_folder(root, runtime);
    for pin in [runtime.onnxruntime, runtime.api] {
        if sha256_of(&libraries.join(pin.name))? != pin.sha256 {
            return Err(format!("{} has changed since it was downloaded", pin.name));
        }
    }
    let files = root.join(model().id);
    let vocab = files.join("bpe.vocab");
    if !vocab.exists() {
        let tokens =
            fs::read_to_string(files.join("tokens.txt")).map_err(|error| error.to_string())?;
        fs::write(&vocab, vocabulary(&tokens)).map_err(|error| error.to_string())?;
    }
    sherpa::Engine::open(
        &libraries,
        runtime.onnxruntime.name,
        runtime.api.name,
        &sherpa::Opening {
            files: &files,
            threads: device::threads(device::this().cores),
            provider: "cpu",
        },
    )
}

/// The vocabulary sherpa-onnx finds a name's pieces with, from the model's tokens: each
/// piece in their order, the earlier ones, which a byte-pair model merged first, scored
/// higher. The model ships `tokens.txt` alone, as `piece id` lines.
fn vocabulary(tokens: &str) -> String {
    use std::fmt::Write as _;
    let mut out = String::new();
    for (i, line) in tokens
        .lines()
        .filter(|line| !line.trim().is_empty())
        .enumerate()
    {
        let piece = line.rsplit_once(' ').map_or(line, |(piece, _)| piece);
        let _ = writeln!(out, "{piece}\t-{i}");
    }
    out
}

/// Closes the model once it has been idle for `IDLE`.
fn watch_idle(loaded: Arc<Loaded>) {
    std::thread::spawn(move || loop {
        std::thread::sleep(Duration::from_secs(30));
        let mut held = lock(&loaded);
        match held.as_ref() {
            None => return,
            Some((_, used, _)) if used.elapsed() > IDLE => {
                *held = None;
                return;
            }
            Some(_) => {}
        }
    });
}

/// The words in a stretch, sent as one body: the length of the context words in four
/// little-endian bytes, the context words (names, comma-separated), then the samples,
/// 16 kHz mono, as little-endian 32-bit floats.
#[tauri::command(async)]
pub fn dictation_local_hear(app: AppHandle, request: Request<'_>) -> Result<String, String> {
    let InvokeBody::Raw(body) = request.body() else {
        return Err("dictation was sent something that is not sound".to_owned());
    };
    let (context, samples) = framed(body)?;
    let loaded = app.state::<Arc<Loaded>>();
    let mut held = lock(&loaded);
    let (engine, used, _) = held.as_mut().ok_or("The speech model is not open.")?;
    let words = engine.hear(&samples, &context);
    *used = Instant::now();
    words
}

fn framed(body: &[u8]) -> Result<(String, Vec<f32>), String> {
    let wrong = || "dictation was sent a body it cannot read".to_owned();
    let head: [u8; 4] = body
        .get(..4)
        .and_then(|b| b.try_into().ok())
        .ok_or_else(wrong)?;
    let length = u32::from_le_bytes(head) as usize;
    let context = body.get(4..4 + length).ok_or_else(wrong)?;
    let context = String::from_utf8(context.to_vec()).map_err(|_| wrong())?;
    let sound = &body[4 + length..];
    if !sound.len().is_multiple_of(4) {
        return Err(wrong());
    }
    let samples = sound
        .as_chunks::<4>()
        .0
        .iter()
        .map(|b| f32::from_le_bytes(*b))
        .collect();
    Ok((context, samples))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(context: &str, samples: &[f32]) -> Vec<u8> {
        let mut body = u32::try_from(context.len()).unwrap().to_le_bytes().to_vec();
        body.extend(context.as_bytes());
        for one in samples {
            body.extend(one.to_le_bytes());
        }
        body
    }

    #[test]
    fn a_stretch_is_read_as_it_was_sent() {
        let (context, samples) = framed(&frame("Jürgen Weißmüller,Tauri", &[0.5, -0.25])).unwrap();
        assert_eq!(context, "Jürgen Weißmüller,Tauri");
        assert_eq!(samples, vec![0.5, -0.25]);
        let (context, samples) = framed(&frame("", &[])).unwrap();
        assert_eq!((context.as_str(), samples.len()), ("", 0));
    }

    #[test]
    fn a_body_cut_short_is_refused() {
        assert!(framed(&[]).is_err());
        assert!(framed(&[9, 0, 0, 0, b'a']).is_err());
        let mut body = frame("", &[1.0]);
        body.pop();
        assert!(framed(&body).is_err());
    }

    #[test]
    fn the_vocabulary_is_the_tokens_in_their_order() {
        assert_eq!(
            vocabulary("<unk> 0\n\u{2581}the 1\nü 2\n"),
            "<unk>\t-0\n\u{2581}the\t-1\nü\t-2\n"
        );
    }

    /// A model already open is handed to the next dictation as it is: the passes that warm
    /// and time it ran when it opened, and the microphone waits on nothing more.
    #[test]
    fn a_model_is_timed_once_as_it_opens() {
        let mut held: Option<(u32, Instant, f32)> = None;
        let mut opens = 0;
        let mut timings = 0;
        for _ in 0..3 {
            let answer = opened(
                &mut held,
                || {
                    opens += 1;
                    Ok(7)
                },
                |_| {
                    timings += 1;
                    Ok(0.25)
                },
            );
            assert_eq!(answer.map(|(pace, _)| pace), Ok(0.25));
        }
        assert_eq!((opens, timings), (1, 1));

        held = None;
        assert_eq!(opened(&mut held, || Ok(8), |_| Ok(0.5)), Ok((0.5, true)));
        assert_eq!(opened(&mut held, || Ok(9), |_| Ok(0.9)), Ok((0.5, false)));
        assert!(opened(
            &mut None::<(u32, Instant, f32)>,
            || Err("gone".into()),
            |_| Ok(1.0)
        )
        .is_err());
    }

    #[test]
    fn nothing_is_installed_in_an_empty_folder() {
        let dir = tempfile::tempdir().unwrap();
        assert!(!installed(dir.path()));
    }

    #[test]
    fn a_file_is_present_only_at_its_size() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tokens.txt");
        fs::write(&path, "abc").unwrap();
        let pin = Pinned {
            name: "tokens.txt",
            size: 3,
            sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        };
        assert!(present(&path, &pin));
        assert_eq!(sha256_of(&path).unwrap(), pin.sha256);
        assert!(!present(&path, &Pinned { size: 4, ..pin }));
    }

    /// The recordings of #1151 heard through this engine, as the app hears them: a live
    /// pass every half second over the sentence so far, then the final pass, with the
    /// names around a field for the dictated sentences. Downloads
    /// the runtime and the model, so it runs only when asked:
    ///
    ///     python scripts/dictation-bench.py --export DIR
    ///     ORDEN_DICTATION_SAMPLES=DIR cargo test --lib heard_here -- --ignored --nocapture
    #[test]
    #[ignore = "downloads the speech model"]
    fn the_recordings_heard_here() {
        let samples = PathBuf::from(std::env::var("ORDEN_DICTATION_SAMPLES").unwrap());
        let root = std::env::var("ORDEN_DICTATION_MODELS")
            .map_or_else(|_| samples.join("models"), PathBuf::from);
        let started = Instant::now();
        tauri::async_runtime::block_on(fetch_all(&root, &mut |_| {})).unwrap();
        println!("fetched in {:.1} s", started.elapsed().as_secs_f32());
        let started = Instant::now();
        let engine = open_engine(&root).unwrap();
        println!("opened in {:.1} s", started.elapsed().as_secs_f32());
        let list: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(samples.join("samples.json")).unwrap())
                .unwrap();
        let names = fs::read_to_string(samples.join("context.txt")).unwrap();
        let mut rows = Vec::new();
        let mut terms = (0, 0);
        for one in list.as_array().unwrap() {
            let raw =
                fs::read(samples.join(format!("{}.f32", one["file"].as_str().unwrap()))).unwrap();
            let sound: Vec<f32> = raw
                .as_chunks::<4>()
                .0
                .iter()
                .map(|b| f32::from_le_bytes(*b))
                .collect();
            let group = one["group"].as_str().unwrap().to_owned();
            let mut live = Vec::new();
            if group != "phone" {
                for to in (8_000..sound.len()).step_by(8_000) {
                    let at = Instant::now();
                    engine.hear(&sound[..to], "").unwrap();
                    live.push(at.elapsed().as_secs_f32());
                }
            }
            let at = Instant::now();
            let heard = engine
                .hear(&sound, if group == "phone" { "" } else { &names })
                .unwrap();
            for term in one["terms"].as_array().unwrap() {
                terms.1 += 1;
                terms.0 += usize::from(heard.contains(term.as_str().unwrap()));
            }
            let took = at.elapsed().as_secs_f32();
            println!("{:20} {took:5.2}s {heard}", one["file"].as_str().unwrap());
            let reference = one["ref"].as_str().unwrap().to_owned();
            #[allow(clippy::cast_precision_loss, reason = "a measurement")]
            let seconds = sound.len() as f32 / 16_000.0;
            rows.push((group, reference, heard, took, seconds, live));
        }
        for group in ["mixed", "mono", "phone"] {
            let mine: Vec<_> = rows.iter().filter(|row| row.0 == group).collect();
            let (wrong, words) = mine.iter().fold((0, 0), |(w, n), row| {
                let (a, b) = (words_of(&row.1), words_of(&row.2));
                (w + edits(&a, &b), n + a.len())
            });
            #[allow(clippy::cast_precision_loss, reason = "a measurement")]
            let wer = wrong as f32 / words.max(1) as f32;
            println!("{group:6} WER {wer:.3}");
        }
        let mut live: Vec<f32> = rows.iter().flat_map(|row| row.5.iter().copied()).collect();
        live.sort_by(f32::total_cmp);
        let took: f32 = rows.iter().map(|row| row.3).sum();
        let heard: f32 = rows.iter().map(|row| row.4).sum();
        println!("names {}/{}", terms.0, terms.1);
        println!(
            "RTF {:.3}  live p50 {:.2} s  max {:.2} s",
            took / heard,
            live[live.len() / 2],
            live[live.len() - 1]
        );
    }

    fn words_of(text: &str) -> Vec<String> {
        text.to_lowercase()
            .replace('-', " ")
            .chars()
            .map(|c| {
                if c.is_alphanumeric() || c == '\'' || c.is_whitespace() {
                    c
                } else {
                    ' '
                }
            })
            .collect::<String>()
            .split_whitespace()
            .map(str::to_owned)
            .collect()
    }

    fn edits(reference: &[String], heard: &[String]) -> usize {
        let mut row: Vec<usize> = (0..=heard.len()).collect();
        for (i, r) in reference.iter().enumerate() {
            let mut previous = row[0];
            row[0] = i + 1;
            for (j, h) in heard.iter().enumerate() {
                let here = (row[j + 1] + 1)
                    .min(row[j] + 1)
                    .min(previous + usize::from(r != h));
                previous = row[j + 1];
                row[j + 1] = here;
            }
        }
        row[heard.len()]
    }
}
