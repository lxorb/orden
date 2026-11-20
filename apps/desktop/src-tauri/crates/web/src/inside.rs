use std::path::Path;
use std::sync::OnceLock;

pub const FILE: &str = "pages-inside";
static AT_LAUNCH: OnceLock<bool> = OnceLock::new();
fn chosen_in(config: &Path) -> bool {
    std::fs::read_to_string(config.join(FILE)).is_ok_and(|text| text.trim() == "1")
}
fn choose_in(config: &Path, on: bool) -> Result<(), String> {
    orden_base::paths::made(config)?;
    orden_base::paths::write_atomically(&config.join(FILE), if on { b"1" } else { b"0" })
}
pub fn wanted(config: &Path) -> bool {
    *AT_LAUNCH.get_or_init(|| chosen_in(config))
}
#[tauri::command(async)]
pub fn web_inside(app: tauri::AppHandle<orden_base::Engine>) -> bool {
    orden_base::paths::config_dir(&app).is_ok_and(|config| chosen_in(&config))
}
#[tauri::command(async)]
pub fn web_inside_choose(
    app: tauri::AppHandle<orden_base::Engine>,
    on: bool,
) -> Result<(), String> {
    choose_in(&orden_base::paths::config_dir(&app)?, on)
}
#[cfg(test)]
mod tests {
    use super::{choose_in, chosen_in, FILE};

    #[test]
    fn pages_are_drawn_inside_only_when_the_file_says_1_and_the_choice_is_kept_in_it() {
        let config = tempfile::tempdir().expect("a folder");
        assert!(!chosen_in(config.path()));
        choose_in(config.path(), true).expect("chosen");
        assert_eq!(std::fs::read_to_string(config.path().join(FILE)).expect("kept"), "1");
        assert!(chosen_in(config.path()));
        choose_in(config.path(), false).expect("chosen");
        assert!(!chosen_in(config.path()));
        std::fs::write(config.path().join(FILE), "1\n").expect("written");
        assert!(chosen_in(config.path()));
        std::fs::write(config.path().join(FILE), "yes").expect("written");
        assert!(!chosen_in(config.path()));
    }
}
