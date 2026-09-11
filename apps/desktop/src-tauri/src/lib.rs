//! Nib, on a desktop and on a phone: the plugins it runs with, the commands the
//! window may call, and the window itself.
//!
//! Every command lives in the module that owns the thing it touches - `notes`,
//! `spaces`, `trash` and so on - and every path a command is given is judged by
//! `paths` before anything on disk is touched.
//!
//! A phone has no second window, no installer, no file dialog and no shell, so
//! the modules that are only about those are `#[cfg(desktop)]` and their commands
//! reach the handler only there. Everything about notes is the same on both: the
//! same folder under the documents directory, read and written by the same
//! commands.

mod assets;
mod clock;
mod fuzzy;
mod highlights;
mod history;
#[cfg(desktop)]
mod launch;
mod links;
mod logs;
mod matcher;
mod notes;
#[cfg(desktop)]
mod pandoc;
mod paths;
#[cfg(desktop)]
mod pdf;
mod query;
#[cfg(desktop)]
mod recent;
mod regex;
mod search;
#[cfg(desktop)]
mod shell_menu;
mod spaces;
mod tags;
mod tasks;
mod themes;
mod trash;
mod tree;
#[cfg(desktop)]
mod updates;

use paths::Opened;
#[cfg(desktop)]
use paths::{note_from_outside, outside_spaces};
#[cfg(desktop)]
use std::path::Path;
use tauri::Manager;
#[cfg(desktop)]
use tauri::{AppHandle, Emitter};

/// The commands the window may call, as one list. A builder takes a single
/// handler, so the desktop-only ones are passed in here rather than added
/// afterwards, and the names both builds share are written once.
macro_rules! commands {
    ($($desktop:tt)*) => {
        tauri::generate_handler![
            notes::read_note,
            notes::write_note,
            notes::write_bytes,
            notes::delete_note,
            notes::rename_note,
            notes::create_folder,
            notes::delete_folder,
            notes::remove_empty_folder,
            notes::file_stamp,
            tree::read_tree,
            assets::read_asset,
            assets::read_file,
            assets::save_asset,
            highlights::read_highlights,
            highlights::write_highlights,
            search::search_space,
            search::space_tags,
            links::scan_links,
            themes::theme_dir,
            themes::list_themes,
            themes::read_theme,
            themes::write_theme,
            themes::remove_theme,
            themes::custom_css_path,
            themes::read_custom_css,
            themes::snippets_path,
            themes::read_snippets,
            history::snapshot_note,
            history::list_snapshots,
            history::read_snapshot,
            history::purge_snapshots,
            logs::log_dir,
            logs::write_log,
            logs::read_log,
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
            $($desktop)*
        ]
    };
}

/// How a phone starts the app. The attribute writes the symbol the Android and
/// iOS projects load the library through, which a desktop does not have: there
/// the binary beside this library calls `run` itself.
///
/// In a module of its own so that the one item the macro writes without a doc
/// comment is excepted here rather than crate-wide. Everything of ours is still
/// documented, and the desktop builds hold the whole crate to that.
#[cfg(mobile)]
#[allow(
    missing_docs,
    reason = "the entry point is written by a macro, which cannot document it"
)]
mod entry {
    #[tauri::mobile_entry_point]
    fn start() {
        super::run();
    }
}

/// Starts the app. Returns when the last window has closed, and exits with a
/// message if the app could not be built at all.
pub fn run() {
    let builder = tauri::Builder::default();

    // A second launch belongs to the window that is already open: it raises it
    // and hands over whatever file it was asked to open. A phone launches an app
    // once, has no installer to run and no dialog to pick a file in.
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }

            let files = launch::markdown_paths(argv);
            remember(app, &files);
            let _ = app.emit("nib://open-files", files);
        }))
        .manage(launch::Pending::default());

    // The opener is how a link leaves the app anywhere, and the os plugin is how
    // the window knows which build it is running as.
    let builder = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .manage(Opened::default());

    #[cfg(desktop)]
    let builder = builder.invoke_handler(commands![
        launch::take_startup_files,
        launch::new_window,
        pandoc::has_pandoc,
        pandoc::run_pandoc,
        pandoc::import_document,
        pdf::pdf_supported,
        pdf::print_pdf,
        recent::remember_recent,
        shell_menu::new_menu_registered,
        shell_menu::set_new_menu,
        updates::check_update,
    ]);

    #[cfg(mobile)]
    let builder = builder.invoke_handler(commands![]);

    builder
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

    // A command line is a desktop's way of being handed a file. A phone app is
    // launched by tapping it, and there is nothing in `args` worth reading.
    #[cfg(desktop)]
    {
        let files = launch::markdown_paths(std::env::args());
        if !files.is_empty() {
            remember(handle, &files);
            if let Some(pending) = handle.try_state::<launch::Pending>() {
                if let Ok(mut waiting) = pending.0.lock() {
                    *waiting = files;
                }
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
#[cfg(desktop)]
fn remember(app: &AppHandle, files: &[String]) {
    for file in files {
        let path = Path::new(file);
        if outside_spaces(app, path) {
            note_from_outside(app, path);
        }
    }
}
