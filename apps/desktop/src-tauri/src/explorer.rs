mod bin;
pub mod changes;
pub mod jobs;
pub mod listing;
pub mod reach;
pub mod watch;

pub fn shown(app: &tauri::AppHandle, path: &str) -> Result<std::path::PathBuf, String> {
    listing::asked(app, path, reach::Use::Look)
}

#[cfg(test)]
mod tests {
    const SOURCES: [(&str, &str); 6] = [
        ("bin.rs", include_str!("explorer/bin.rs")),
        ("changes.rs", include_str!("explorer/changes.rs")),
        ("jobs.rs", include_str!("explorer/jobs.rs")),
        ("listing.rs", include_str!("explorer/listing.rs")),
        ("reach.rs", include_str!("explorer/reach.rs")),
        ("watch.rs", include_str!("explorer/watch.rs")),
    ];

    const QUICK: [&str; 1] = ["explorer_cancel"];

    #[test]
    fn no_file_explorer_command_waits_on_a_disk_on_the_runtime_or_the_window_s_thread() {
        for (file, source) in SOURCES {
            let lines: Vec<&str> = source.lines().collect();
            for (at, line) in lines.iter().enumerate() {
                if !line.trim_start().starts_with("#[tauri::command") {
                    continue;
                }
                let next = lines.get(at + 1).copied().unwrap_or_default();
                if next.starts_with("pub async fn ") {
                    continue;
                }
                let name = next
                    .trim_start_matches("pub fn ")
                    .split(['(', '<'])
                    .next()
                    .unwrap_or_default();
                assert!(
                    *line == "#[tauri::command]" && QUICK.contains(&name),
                    "{file}: {next}: a disk can take minutes to answer; make it an async fn that hands its work off_the_runtime"
                );
            }
        }
    }
}
