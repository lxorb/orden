use std::path::Path;
use std::sync::OnceLock;

pub const SCRIPT: &str = include_str!("gpu.js");

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Seen {
    pub hardware: bool,
    pub renderer: String,
    pub gpu_process: bool,
}

impl Seen {
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

const FILE: &str = "gpu.txt";

pub(crate) const OFF: [&str; 2] = ["--disable-gpu", "--disable-gpu-compositing"];

static ACCELERATED: OnceLock<bool> = OnceLock::new();

pub fn accelerated(config: &Path) -> bool {
    *ACCELERATED.get_or_init(|| chosen(config))
}

fn chosen(config: &Path) -> bool {
    !std::fs::read_to_string(config.join(FILE)).is_ok_and(|said| said.trim() == "off")
}

pub fn seen() -> Option<&'static Seen> {
    SEEN.get()
}

#[tauri::command(async)]
pub fn gpu_chosen(app: tauri::AppHandle<crate::Engine>) -> Result<bool, String> {
    Ok(chosen(&crate::paths::config_dir(&app)?))
}

#[tauri::command(async)]
pub fn gpu_choose(app: tauri::AppHandle<crate::Engine>, on: bool) -> Result<(), String> {
    let config = crate::paths::config_dir(&app)?;
    crate::paths::made(&config)?;
    crate::paths::write_atomically(&config.join(FILE), if on { b"on" } else { b"off" })
}

#[tauri::command(async)]
pub fn gpu_line() -> Option<String> {
    seen().map(Seen::said)
}

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

    #[test]
    fn what_draws_is_said_as_the_log_says_it() {
        let seen = Seen {
            hardware: false,
            renderer: "no WebGL".to_owned(),
            gpu_process: false,
        };
        assert_eq!(seen.said(), "software (no WebGL; no GPU process)");
    }

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

    #[test]
    fn the_script_asks_by_the_command_s_name() {
        assert!(SCRIPT.contains("'gpu_seen'"));
        assert!(SCRIPT.contains("'load'"));
    }
}
