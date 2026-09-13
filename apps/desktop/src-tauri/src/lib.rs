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
//!
//! One rule about every command that waits for the disk: it says `async`.
//!
//! `#[tauri::command]` on a function that is not itself async runs the body *on
//! the main thread*, inside the webview's own request handler. On Windows that is
//! the thread with the message loop on it, so a command that reads a folder full
//! of notes stops the window repainting, stops it answering the mouse, and stops
//! the webview loading anything else for as long as the read takes - the app looks
//! wedged, and the wait is the disk's. `#[tauri::command(async)]` on the same
//! synchronous function runs it on a thread of the runtime's instead and answers
//! the window when it is done, which is the same command with the freeze taken
//! out. So everything that touches a file, walks a folder, starts a subprocess or
//! asks the machine's keychain says it.
//!
//! Four kinds of command deliberately do not. The ones that only read state this
//! builder manages, which is a mutex and no wait at all. `write_log`, whose lines
//! are appended in the order they were written and would not be if two could be in
//! the air at once. The two that reach Windows through COM or the registry, since
//! an apartment belongs to the thread that made it. And `new_window`, which builds
//! a window.

#[cfg(desktop)]
mod apple_notes;
// The words of a note are read where the database holding them is, and that is a
// Mac: SQLite, a gzipped protobuf and a group container no other system has.
#[cfg(target_os = "macos")]
mod apple_text;
mod assets;
mod clock;
#[cfg(desktop)]
mod endpoint;
mod front_matter;
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
mod papers;
mod paths;
#[cfg(desktop)]
mod pdf;
mod query;
#[cfg(desktop)]
mod recent;
mod regex;
mod search;
#[cfg(desktop)]
mod secrets;
#[cfg(desktop)]
mod shell_menu;
mod spaces;
mod tags;
mod tasks;
mod themes;
mod trace;
mod trash;
mod tree;
#[cfg(desktop)]
mod updates;
mod uris;
#[cfg(desktop)]
mod web_tabs;

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
            papers::read_paper_text,
            papers::write_paper_text,
            papers::list_paper_texts,
            search::search_space,
            search::space_tags,
            search::warm_search,
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
            uris::take_startup_uris,
            trace::trace_startup,
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
    // First, so that the one step nothing inside the process can time - the
    // machine loading the binary before any of this ran - is on the trace as well;
    // see trace.rs. Off unless NIB_TRACE_STARTUP says otherwise.
    trace::begin();

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
            // The window, not the webview window, which a window holding a page in
            // a tab is not; see web_tabs.rs.
            if let Some(window) = app.get_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }

            let files = launch::markdown_paths(argv);
            remember(app, &files);
            let _ = app.emit("nib://open-files", files);
        }))
        .manage(launch::Pending::default());
    #[cfg(desktop)]
    trace::mark("plugins: updater, dialog, process, one instance");

    // The opener is how a link leaves the app anywhere, and the os plugin is how
    // the window knows which build it is running as.
    //
    // Deep links come after single instance above, which is the order that plugin
    // asks for: on Windows and Linux a `nib://` link reaching an app that is
    // already open arrives as a second launch, and single instance is what hands
    // it over to be read as a link. See uris.rs.
    let builder = builder
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(Opened::default())
        .manage(uris::Pending::default());
    trace::mark("plugins: opener, os, deep link");

    // What the `nib` command's requests wait in while the window answers them.
    // Managed here rather than where the socket opens, because a builder is the
    // one place state can be added; see endpoint.rs.
    #[cfg(desktop)]
    let builder = builder.manage(endpoint::Waiting::default());

    // Which page each web tab is on, so a back arrow is lit only where there is
    // something behind it. A phone has no child webviews to keep a trail for; see
    // web_tabs.rs and docs/web-tabs.md.
    #[cfg(desktop)]
    let builder = builder.manage(web_tabs::WebTabs::default());

    #[cfg(desktop)]
    let builder = builder.invoke_handler(commands![
        endpoint::automation_result,
        apple_notes::read_apple_notes,
        apple_notes::open_full_disk_access,
        launch::take_startup_files,
        launch::new_window,
        pandoc::has_pandoc,
        pandoc::run_pandoc,
        pandoc::import_document,
        pdf::pdf_supported,
        pdf::print_pdf,
        recent::remember_recent,
        secrets::secret_forget,
        secrets::secret_read,
        secrets::secret_write,
        shell_menu::new_menu_registered,
        shell_menu::set_new_menu,
        updates::check_update,
        web_tabs::web_open,
        web_tabs::web_place,
        web_tabs::web_navigate,
        web_tabs::web_step,
        web_tabs::web_clip,
        web_tabs::web_close,
    ]);

    #[cfg(mobile)]
    let builder = builder.invoke_handler(commands![]);
    trace::mark("commands registered");

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
    // Everything between the last mark and this one is Tauri's own: the context,
    // the window and - on Windows, where it is most of a launch - the webview
    // runtime being started and pointed at the page.
    trace::mark("app built, window created");

    let handle = app.handle();

    // A picture in a note is loaded by the webview itself, over the asset
    // protocol, which has a scope of its own. The spaces folder is in it from the
    // start; the folder a note was opened from elsewhere is added when that
    // happens, and nothing else is ever readable this way.
    if let Ok(root) = paths::spaces_root(handle) {
        let _ = handle.asset_protocol_scope().allow_directory(&root, true);
    }
    trace::mark("asset scope");

    // Links into the app, on every platform: the one the app was launched by, and
    // every one that arrives while it is running.
    uris::watch(handle);
    trace::mark("deep links");

    // And the socket the `nib` command drives the app through, which only a
    // desktop has. It comes up after the links above and before the window is
    // seen, so a request that arrives in the first moment finds a window to ask.
    #[cfg(desktop)]
    endpoint::start(handle);
    #[cfg(desktop)]
    trace::mark("automation endpoint");

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

    trace::mark("launch arguments");

    // Built hidden, so nobody watches the window paint itself.
    // The window, not the webview window; see web_tabs.rs.
    if let Some(window) = app.get_window("main") {
        window.show()?;
    }

    trace::mark("window shown");
    // Written here as well as when the window reports in, so a launch that never
    // gets as far as a window still leaves behind what it did get through.
    trace::write(handle);

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
