//! Whether Chromium draws on the graphics card or on the CPU, on Linux, in the log.
//!
//! A reader whose Orden sat at a whole core asked whether it was drawing in software
//! (#427, KDE). Chromium falls back to its software renderer, `SwiftShader`, quietly where
//! the GPU process cannot start - a driver it will not use, a library it cannot load -
//! and the app then works and costs the CPU what the card should have. So the app's own
//! page says, once it has settled, which renderer WebGL draws with (`SCRIPT`), and the
//! log says it in one line a reader can send: `gpu: hardware (…)` or `gpu: software (…)`,
//! with whether a GPU process is running at all.

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

static SEEN: OnceLock<Seen> = OnceLock::new();

/// What draws the app's pages, once the first page has said; `None` before then.
#[allow(
    dead_code,
    reason = "read by the setting for the GPU (#550), which comes next"
)]
pub fn seen() -> Option<&'static Seen> {
    SEEN.get()
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
    let line = format!(
        "gpu: {} ({}; {})",
        if seen.hardware {
            "hardware"
        } else {
            "software"
        },
        seen.renderer,
        if seen.gpu_process {
            "a GPU process"
        } else {
            "no GPU process"
        }
    );
    if SEEN.set(seen).is_ok() {
        crate::logs::say(&app, "info", &line);
    }
}

#[cfg(test)]
mod tests {
    use super::{software, SCRIPT};

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
