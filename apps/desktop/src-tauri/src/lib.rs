mod export;
mod history;
mod launch;
mod logs;
mod notes;
mod recent;
mod shell_menu;
mod spaces;
mod themes;

use launch::{markdown_paths, Pending};
use tauri::{Emitter, Manager};

pub fn run() {
    let mut builder = tauri::Builder::default();

    // A second launch belongs to the window that is already open: it raises it
    // and hands over whatever file it was asked to open.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            let _ = app.emit("nib://open-files", markdown_paths(argv));
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(Pending::default())
        .invoke_handler(tauri::generate_handler![
            notes::read_note,
            notes::write_note,
            notes::read_tree,
            notes::delete_note,
            notes::rename_note,
            notes::create_folder,
            notes::delete_folder,
            notes::read_asset,
            notes::space_tags,
            notes::save_asset,
            notes::search_space,
            themes::theme_dir,
            themes::list_themes,
            themes::read_theme,
            themes::custom_css_path,
            themes::read_custom_css,
            themes::snippets_path,
            themes::read_snippets,
            export::has_pandoc,
            export::run_pandoc,
            export::import_document,
            export::pdf_supported,
            export::print_pdf,
            launch::take_startup_files,
            launch::new_window,
            history::snapshot_note,
            history::list_snapshots,
            history::read_snapshot,
            logs::log_dir,
            logs::write_log,
            logs::read_log,
            recent::remember_recent,
            shell_menu::new_menu_registered,
            shell_menu::set_new_menu,
            spaces::spaces_root,
            spaces::list_spaces,
            spaces::create_space,
            spaces::rename_space,
            spaces::delete_space,
        ])
        .setup(|app| {
            let files = markdown_paths(std::env::args());
            if !files.is_empty() {
                if let Ok(mut pending) = app.state::<Pending>().0.lock() {
                    *pending = files;
                }
            }

            if let Some(window) = app.get_webview_window("main") {
                window.show()?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("failed to start Nib");
}
