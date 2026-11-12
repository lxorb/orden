use std::path::{Path, PathBuf};

use tauri::{AppHandle, Manager as _};

const SIDECAR_SECRET: &str = "sidecar-signal-cli";

fn sidecars_under(local: &Path) -> PathBuf {
    local.join("sidecars")
}

fn retire_sidecars(sidecars: &Path) -> bool {
    sidecars.exists() && std::fs::remove_dir_all(sidecars).is_ok()
}

pub fn clear_leftovers(app: &AppHandle) {
    let Ok(local) = app.path().app_local_data_dir() else {
        return;
    };
    let sidecars = sidecars_under(&local);
    if !sidecars.exists() {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        retire_sidecars(&sidecars);
        if let Ok(name) = crate::secrets::filed(SIDECAR_SECRET, &app.config().identifier) {
            let _ = crate::secrets::delete(&app, &name);
        }
    });
}

#[cfg(test)]
mod tests {
    use super::{retire_sidecars, sidecars_under};

    #[test]
    fn the_downloaded_chat_programs_and_their_state_go() {
        let dir = tempfile::tempdir().expect("a folder");
        let sidecars = sidecars_under(dir.path());
        let program = sidecars
            .join("signal-cli")
            .join("program")
            .join("0.14.9-25.0.5");
        std::fs::create_dir_all(&program).expect("program");
        std::fs::write(program.join("signal-cli.jar"), "PK").expect("jar");
        std::fs::write(sidecars.join("signal-cli").join("state.sealed"), "OSS1").expect("state");
        std::fs::write(dir.path().join("secrets.json"), "{}").expect("other");

        assert!(retire_sidecars(&sidecars));
        assert!(!sidecars.exists());
        assert!(dir.path().join("secrets.json").exists());
    }

    #[test]
    fn nothing_to_clear_is_no_trouble() {
        let dir = tempfile::tempdir().expect("a folder");
        assert!(!retire_sidecars(&sidecars_under(dir.path())));
    }
}
