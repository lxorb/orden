//! Nib, the desktop app: the plugins it runs with, the commands the window may
//! call, and the window itself.
//!
//! Every command lives in the module that owns the thing it touches - `notes`,
//! `spaces`, `trash` and so on - and every path a command is given is judged by
//! `paths` before anything on disk is touched.

mod assets;
mod clock;
mod history;
mod launch;
mod links;
mod logs;
mod notes;
mod pandoc;
mod paths;
mod pdf;
mod recent;
mod search;
mod shell_menu;
mod spaces;
mod themes;
mod trash;
mod tree;

use launch::{markdown_paths, Pending};
use paths::{note_from_outside, outside_spaces, Opened};
use std::path::Path;
use tauri::{AppHandle, Emitter, Manager};

/// Starts the app. Returns when the last window has closed, and exits with a
/// message if the app could not be built at all.
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

            let files = markdown_paths(argv);
            remember(app, &files);
            let _ = app.emit("nib://open-files", files);
        }));
    }

    builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Pending::default())
        .manage(Opened::default())
        .invoke_handler(tauri::generate_handler![
            notes::read_note,
            notes::write_note,
            notes::delete_note,
            notes::rename_note,
            notes::create_folder,
            notes::delete_folder,
            tree::read_tree,
            assets::read_asset,
            assets::save_asset,
            search::search_space,
            search::space_tags,
            links::scan_links,
            themes::theme_dir,
            themes::list_themes,
            themes::read_theme,
            themes::custom_css_path,
            themes::read_custom_css,
            themes::snippets_path,
            themes::read_snippets,
            pandoc::has_pandoc,
            pandoc::run_pandoc,
            pandoc::import_document,
            pdf::pdf_supported,
            pdf::print_pdf,
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
            trash::trash_item,
            trash::list_trash,
            trash::restore_trash,
            trash::purge_trash,
            trash::purge_trash_older_than,
        ])
        .setup(ready)
        .run(tauri::generate_context!())
        .unwrap_or_else(|error| {
            eprintln!("Nib could not start: {error}");
            std::process::exit(1);
        });
}

/// Everything that has to happen once, after the app is built and before the
/// window is seen: what the webview may load, what the app was launched with, and
/// then showing the window that was built hidden.
fn ready(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let handle = app.handle();

    // A picture in a note is loaded by the webview itself, over the asset
    // protocol, which has a scope of its own. The spaces folder is in it from the
    // start; the folder a note was opened from elsewhere is added when that
    // happens, and nothing else is ever readable this way.
    if let Ok(root) = paths::spaces_root(handle) {
        let _ = handle.asset_protocol_scope().allow_directory(&root, true);
    }

    let files = markdown_paths(std::env::args());
    if !files.is_empty() {
        remember(handle, &files);
        if let Some(pending) = handle.try_state::<Pending>() {
            if let Ok(mut waiting) = pending.0.lock() {
                *waiting = files;
            }
        }
    }

    // Built hidden, so nobody watches the window paint itself.
    if let Some(window) = app.get_webview_window("main") {
        window.show()?;
    }

    Ok(())
}

/// Notes the app was launched with come from outside the spaces folder as often
/// as not, and a file handed over by the shell is as deliberate a choice as one
/// picked in a dialog. Recording them is what lets the pictures beside them load.
fn remember(app: &AppHandle, files: &[String]) {
    for file in files {
        let path = Path::new(file);
        if outside_spaces(app, path) {
            note_from_outside(app, path);
        }
    }
}
