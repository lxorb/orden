use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager as _};

struct Leftovers {
    choice: PathBuf,
    lock: PathBuf,
    engines: PathBuf,
}

impl Leftovers {
    fn under(config: &Path, local: &Path) -> Self {
        Self {
            choice: config.join("engine.json"),
            lock: config.join("engine.lock"),
            engines: local.join("engines"),
        }
    }
}

fn named_engine(path: &Path) -> Option<String> {
    let text = std::fs::read_to_string(path).ok()?;
    let said: serde_json::Value = serde_json::from_str(&text).ok()?;
    said.get("engine")?.as_str().map(str::to_string)
}

fn retire_engine(places: &Leftovers) -> Option<String> {
    let said = named_engine(&places.choice);
    let _ = std::fs::remove_file(&places.choice);
    let _ = std::fs::remove_file(&places.lock);
    let chromium = places.engines.join("chromium");
    if chromium.is_dir() {
        let _ = std::fs::remove_dir_all(&chromium);
    }
    let _ = std::fs::remove_dir(&places.engines);
    said
}

pub fn clear_leftovers(app: &AppHandle) {
    let (Ok(config), Ok(local)) = (
        crate::paths::config_dir(app),
        app.path().app_local_data_dir(),
    ) else {
        return;
    };
    let places = Leftovers::under(&config, &local);
    if !places.choice.exists() && !places.engines.join("chromium").exists() {
        return;
    }
    std::thread::spawn(move || {
        if let Some(engine) = retire_engine(&places) {
            eprintln!("nib: engine: the choice said {engine}; running on the system's");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{named_engine, retire_engine, Leftovers};

    fn places() -> (tempfile::TempDir, Leftovers) {
        let dir = tempfile::tempdir().expect("a folder");
        let places = Leftovers::under(&dir.path().join("config"), &dir.path().join("local"));
        std::fs::create_dir_all(dir.path().join("config")).expect("config");
        (dir, places)
    }

    #[test]
    fn a_reader_who_chose_chromium_is_on_the_system_engine_and_the_build_goes() {
        let (_dir, places) = places();
        std::fs::write(&places.choice, r#"{"engine":"chromium","tries":1}"#).expect("choice");
        std::fs::write(&places.lock, "").expect("lock");
        let build = places.engines.join("chromium").join("0.15.0");
        std::fs::create_dir_all(&build).expect("build");
        std::fs::write(build.join("nib-chromium.exe"), "MZ").expect("exe");

        assert_eq!(retire_engine(&places).as_deref(), Some("chromium"));
        assert!(!places.choice.exists());
        assert!(!places.lock.exists());
        assert!(!places.engines.exists());
    }

    #[test]
    fn a_choice_that_cannot_be_read_is_no_trouble() {
        let (_dir, places) = places();
        std::fs::write(&places.choice, "{\"engine\": \"chrom").expect("choice");
        assert_eq!(named_engine(&places.choice), None);
        assert_eq!(retire_engine(&places), None);
        assert!(!places.choice.exists());

        assert_eq!(retire_engine(&places), None);
    }

    #[test]
    fn a_folder_of_engines_with_something_else_in_it_stays() {
        let (_dir, places) = places();
        std::fs::create_dir_all(places.engines.join("chromium")).expect("chromium");
        std::fs::create_dir_all(places.engines.join("other")).expect("other");
        let _ = retire_engine(&places);
        assert!(!places.engines.join("chromium").exists());
        assert!(places.engines.join("other").exists());
    }
}
