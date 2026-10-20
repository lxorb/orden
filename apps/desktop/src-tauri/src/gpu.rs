//! Whether Chromium draws on the graphics card or on the CPU, on Linux, in the log.
//!
//! A reader whose Orden sat at a whole core asked whether it was drawing in software
//! (#427, KDE). Chromium falls back to its software renderer, `SwiftShader`, quietly where
//! the GPU process cannot start - a driver it will not use, a library it cannot load -
//! and the app then works and costs the CPU what the card should have. So the app's own
//! page says, once it has settled, which renderer WebGL draws with (`SCRIPT`), and the
//! log says it in one line a reader can send: `gpu: hardware (…)` or `gpu: software (…)`,
//! with whether a GPU process is running at all.
//!
//! And where it should not draw on the card at all, Settings › General › Hardware
//! acceleration says so (#550): a file in the app's own settings folder, since the engine
//! reads it before anything of it starts (`decide`).

use std::path::Path;
use std::sync::OnceLock;

/// What the app's own page runs on CEF to say it; see the top of this file.
#[cfg_attr(not(feature = "cef"), allow(dead_code))]
pub const SCRIPT: &str = include_str!("gpu.js");

/// What draws the app's pages, as the first page said it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Seen {
    /// Whether that is the graphics card.
    pub hardware: bool,
    /// The renderer WebGL named, or why there was none.
    pub renderer: String,
    /// Whether a GPU process was running when it was asked.
    pub gpu_process: bool,
}

impl Seen {
    /// What the log says of it, after `gpu: `: `hardware (…)` or `software (…)`.
    fn said(&self) -> String {
        format!(
            "{} ({}; {})",
            if self.hardware {
                "hardware"
            } else {
                "software"
            },
            self.renderer,
            if self.gpu_process {
                "a GPU process"
            } else {
                "no GPU process"
            }
        )
    }
}

static SEEN: OnceLock<Seen> = OnceLock::new();

/// Where Hardware acceleration is kept, in the app's own settings folder: `off` for a
/// reader who turned it off. No file, or anything else in it, is on.
const FILE: &str = "gpu.txt";

/// The switches that keep Chromium off the graphics card: no GPU process, and the pages
/// put together on the CPU too, as Chrome's own setting does.
#[cfg_attr(not(any(windows, feature = "cef")), allow(dead_code))]
pub(crate) const OFF: [&str; 2] = ["--disable-gpu", "--disable-gpu-compositing"];

/// Whether this run's engine draws on the graphics card: decided once, by `decide`.
static ACCELERATED: OnceLock<bool> = OnceLock::new();

/// Decides whether this run's engine draws on the graphics card, from the setting in
/// `config`: once, as Orden starts and before the engine does. The answer is this run's,
/// so every webview of it starts with the same switches whatever the setting says by
/// then, and none of them waits on the disk for it.
#[cfg_attr(not(any(windows, feature = "cef")), allow(dead_code))]
pub fn decide(config: &Path) {
    let _ = ACCELERATED.set(chosen(config));
}

/// Whether this run's engine draws on the graphics card, as `decide` found it.
#[cfg_attr(not(any(windows, feature = "cef")), allow(dead_code))]
pub fn accelerated() -> bool {
    ACCELERATED.get() != Some(&false)
}

/// What the setting in `config` says now, which the next run starts with.
fn chosen(config: &Path) -> bool {
    !std::fs::read_to_string(config.join(FILE)).is_ok_and(|said| said.trim() == "off")
}

/// What draws the app's pages, once the first page has said; `None` before then.
pub fn seen() -> Option<&'static Seen> {
    SEEN.get()
}

/// Hardware acceleration as Settings shows it: what the next run starts with.
#[tauri::command(async)]
pub fn gpu_chosen(app: tauri::AppHandle<crate::Engine>) -> Result<bool, String> {
    Ok(chosen(&crate::paths::config_dir(&app)?))
}

/// Hardware acceleration turned on or off, kept for the next run; this one goes on as it
/// started, which is why Settings asks for a restart.
#[tauri::command(async)]
pub fn gpu_choose(app: tauri::AppHandle<crate::Engine>, on: bool) -> Result<(), String> {
    let config = crate::paths::config_dir(&app)?;
    crate::paths::made(&config)?;
    crate::paths::write_atomically(&config.join(FILE), if on { b"on" } else { b"off" })
}

/// What draws the app's pages, as the log said it, for Settings to show under Hardware
/// acceleration: `None` until the first page has said, which on Windows is never, since
/// the page's script runs on nib's own Chromium only.
#[tauri::command(async)]
pub fn gpu_line() -> Option<String> {
    seen().map(Seen::said)
}

/// Whether a renderer WebGL names is one that draws on the CPU.
fn software(renderer: &str) -> bool {
    let renderer = renderer.to_lowercase();
    [
        "swiftshader",
        "llvmpipe",
        "softpipe",
        "lavapipe",
        "software",
    ]
    .iter()
    .any(|one| renderer.contains(one))
}

/// Whether one of this process's children is Chromium's GPU process.
fn gpu_process() -> bool {
    let own = std::process::id().to_string();
    let Ok(all) = std::fs::read_dir("/proc") else {
        return false;
    };
    all.flatten().any(|entry| {
        let path = entry.path();
        let parent = std::fs::read_to_string(path.join("stat"))
            .ok()
            .and_then(|stat| {
                stat.rsplit_once(')')
                    .and_then(|(_, rest)| rest.split_whitespace().nth(1).map(str::to_owned))
            });
        parent.as_deref() == Some(own.as_str())
            && std::fs::read(path.join("cmdline")).is_ok_and(|line| {
                line.split(|byte| *byte == 0)
                    .any(|arg| arg == b"--type=gpu-process")
            })
    })
}

/// What the page's WebGL said draws it: kept, and said in the log, the first time.
#[tauri::command(async)]
pub fn gpu_seen(app: tauri::AppHandle<crate::Engine>, renderer: Option<String>) {
    if SEEN.get().is_some() {
        return;
    }
    let gpu_process = gpu_process();
    let seen = match renderer {
        Some(renderer) if !renderer.trim().is_empty() => Seen {
            hardware: !software(&renderer),
            renderer,
            gpu_process,
        },
        _ => Seen {
            hardware: false,
            renderer: "no WebGL".to_owned(),
            gpu_process,
        },
    };
    let line = format!("gpu: {}", seen.said());
    if SEEN.set(seen).is_ok() {
        crate::logs::say(&app, "info", &line);
    }
}

#[cfg(test)]
mod tests {
    use super::{chosen, software, Seen, FILE, SCRIPT};

    /// Settings shows what the log says: which of the two, and why.
    #[test]
    fn what_draws_is_said_as_the_log_says_it() {
        let seen = Seen {
            hardware: false,
            renderer: "no WebGL".to_owned(),
            gpu_process: false,
        };
        assert_eq!(seen.said(), "software (no WebGL; no GPU process)");
    }

    /// Hardware acceleration is on until the file says `off`, and only that turns it off.
    #[test]
    fn only_off_in_the_file_turns_hardware_acceleration_off() {
        let config = tempfile::tempdir().unwrap();
        assert!(chosen(config.path()), "no file is on");
        std::fs::write(config.path().join(FILE), "off\n").unwrap();
        assert!(!chosen(config.path()));
        std::fs::write(config.path().join(FILE), "on").unwrap();
        assert!(chosen(config.path()));
        std::fs::write(config.path().join(FILE), "").unwrap();
        assert!(chosen(config.path()), "half a file is on");
    }

    /// The renderers that draw on the CPU are told from the cards.
    #[test]
    fn a_software_renderer_is_told_from_a_card() {
        assert!(software("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)"));
        assert!(software(
            "ANGLE (Mesa, llvmpipe (LLVM 19.1.7, 256 bits), OpenGL 4.5)"
        ));
        assert!(!software(
            "ANGLE (Intel, Mesa Intel(R) UHD Graphics 620 (KBL GT2), OpenGL 4.6)"
        ));
        assert!(!software(
            "ANGLE (AMD, AMD Radeon RX 6600 (radeonsi, navi23, LLVM 19.1.7, DRM 3.59), OpenGL 4.6)"
        ));
    }

    /// The script asks the command by its name, once, after the page has loaded.
    #[test]
    fn the_script_asks_by_the_command_s_name() {
        assert!(SCRIPT.contains("'gpu_seen'"));
        assert!(SCRIPT.contains("'load'"));
    }
}
