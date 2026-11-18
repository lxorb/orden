#[cfg(desktop)]
mod agents;
#[cfg(desktop)]
mod ai_agent;
#[cfg(desktop)]
mod ai_cli;
#[cfg(test)]
mod calls;
#[cfg(target_os = "linux")]
mod chromium_pump;
#[cfg(desktop)]
mod downloads;
#[cfg(desktop)]
mod endpoint;
#[cfg(desktop)]
mod engine;
#[cfg(desktop)]
mod extensions;
#[cfg(desktop)]
mod handover;
#[cfg(desktop)]
mod host;
#[cfg(desktop)]
mod hotkeys;
#[cfg(desktop)]
mod kept;
#[cfg(desktop)]
mod keyboard;
#[cfg(desktop)]
mod launch;
#[cfg(desktop)]
mod lifecycle;
#[cfg(desktop)]
pub mod mcp;
#[cfg(desktop)]
pub mod old_engine;
#[cfg(desktop)]
pub mod old_home;
#[cfg(desktop)]
mod page_carry;
#[cfg(desktop)]
mod page_drag;
#[cfg(desktop)]
mod page_hide;
#[cfg(desktop)]
mod page_scale;
#[cfg(desktop)]
mod page_scheme;
#[cfg(desktop)]
mod page_style;
#[cfg(desktop)]
mod pinch;
#[cfg(desktop)]
mod quick_add;
#[cfg(test)]
mod scans;
#[cfg(desktop)]
mod shortcuts;
#[cfg(desktop)]
#[cfg(target_os = "macos")]
mod siri;
#[cfg(desktop)]
mod spelling;
mod uris;
#[cfg(desktop)]
mod web_answers;
#[cfg(desktop)]
mod web_certificate;
#[cfg(desktop)]
mod web_clear;
#[cfg(desktop)]
mod web_cookies;
#[cfg(desktop)]
mod web_cut;
#[cfg(desktop)]
mod web_dialogs;
#[cfg(desktop)]
mod web_find;
#[cfg(desktop)]
mod web_follow;
#[cfg(desktop)]
mod web_handed;
#[cfg(desktop)]
mod web_icons;
#[cfg(desktop)]
mod web_keys;
#[cfg(desktop)]
mod web_media;
#[cfg(desktop)]
mod web_opens;
#[cfg(desktop)]
mod web_page;
#[cfg(desktop)]
mod web_pass;
#[cfg(desktop)]
mod web_pause;
#[cfg(desktop)]
mod web_reload;
#[cfg(desktop)]
mod web_state;
#[cfg(desktop)]
mod web_steady;
#[cfg(desktop)]
mod web_stores;
#[cfg(desktop)]
mod web_swipe;
#[cfg(desktop)]
mod web_tabs;
#[cfg(desktop)]
mod web_tint;
#[cfg(desktop)]
mod web_worlds;
#[cfg(desktop)]
mod window_drag;

use orden_base::paths::{self, Picked};
use orden_base::{logs, trace, Engine};
use tauri::Manager;

macro_rules! commands {
    ($($desktop:tt)*) => {
        tauri::generate_handler![
            orden_notes::notes::read_note,
            orden_notes::notes::write_note,
            orden_notes::notes::write_bytes,
            orden_notes::notes::delete_note,
            orden_notes::notes::rename_note,
            orden_notes::notes::copy_path,
            orden_notes::notes::create_folder,
            orden_notes::notes::delete_folder,
            orden_notes::notes::remove_empty_folder,
            orden_notes::notes::file_stamp,
            orden_notes::notes::file_there,
            orden_notes::notes::note_evicted,
            orden_notes::notes::path_taken,
            orden_notes::tree::read_tree,
            orden_documents::assets::read_asset,
            orden_documents::assets::read_file,
            orden_documents::assets::save_asset,
            orden_notes::highlights::read_highlights,
            orden_notes::highlights::write_highlights,
            orden_notes::papers::read_paper_text,
            orden_notes::papers::write_paper_text,
            orden_notes::papers::list_paper_texts,
            orden_search::search::search_space,
            orden_search::search::space_tags,
            orden_search::search::warm_search,
            orden_search::links::scan_links,
            orden_notes::themes::theme_dir,
            orden_notes::themes::list_themes,
            orden_notes::themes::read_theme,
            orden_notes::themes::write_theme,
            orden_notes::themes::remove_theme,
            orden_notes::themes::custom_css_path,
            orden_notes::themes::read_custom_css,
            orden_notes::themes::snippets_path,
            orden_notes::themes::read_snippets,
            orden_notes::themes::scratchpad_path,
            orden_notes::history::snapshot_note,
            orden_notes::history::list_snapshots,
            orden_notes::history::read_snapshot,
            orden_notes::history::purge_snapshots,
            orden_notes::history::rehome_snapshots,
            logs::log_dir,
            logs::write_log,
            logs::read_log,
            orden_notes::spaces::spaces_root,
            orden_notes::spaces::list_spaces,
            orden_notes::spaces::create_space,
            orden_notes::spaces::rename_space,
            orden_notes::spaces::delete_space,
            orden_notes::trash::trash_item,
            orden_notes::trash::trash_words,
            orden_notes::trash::list_trash,
            orden_notes::trash::restore_trash,
            orden_notes::trash::purge_trash,
            orden_notes::trash::purge_trash_older_than,
            uris::take_startup_uris,
            trace::trace_startup,
            orden_store::sync_store::sync_store_open,
            orden_store::sync_store::sync_store_close,
            orden_store::sync_store::sync_store_read,
            orden_store::sync_store::sync_store_write,
            orden_store::sync_store::sync_store_clean_exit,
            orden_store::sync_store::sync_store_forget,
            orden_store::sync_store::sync_store_device,
            orden_store::sync_store::chats::chat_store_read,
            orden_store::sync_store::chats::chat_store_write,
            orden_store::sync_store::chats::chat_store_forget,
            orden_notes::space_watch::space_watch,
            orden_notes::space_watch::space_unwatch,
            orden_notes::space_watch::space_scan,
            orden_notes::space_watch::working_watch,
            orden_notes::space_watch::working_unwatch,
            orden_notes::space_watch::working_scan,
            orden_notes::space_watch::file_identity,
            orden_store::ai_accounts::ai_accounts_read,
            orden_store::ai_accounts::ai_accounts_write,
            orden_store::ai_threads::ai_threads_list,
            orden_store::ai_threads::ai_thread_read,
            orden_store::ai_threads::ai_thread_write,
            orden_store::ai_threads::ai_thread_delete,
            orden_store::ai_threads::ai_threads_forget,
            $($desktop)*
        ]
    };
}

#[cfg(desktop)]
macro_rules! desktop_commands {
    () => {
        commands![
            endpoint::automation_result,
            endpoint::automation_listening,
            endpoint::automation_claim,
            agents::grants::agents_read,
            agents::grants::agents_write,
            agents::grants::agents_mint,
            agents::agents_stop,
            agents::agents_resume,
            agents::agents_answer,
            agents::agents_ask,
            agents::agents_dialog_path,
            agents::agents_state,
            agents::agents_log,
            agents::agents_log_after,
            agents::agents_log_days,
            agents::agents_log_clear,
            agents::agents_adopt,
            agents::agents_peek,
            agents::agents_capture,
            agents::shell::agents_shell,
            agents::shell::agents_hold,
            quick_add::quick_add_key,
            hotkeys::global_keys,
            hotkeys::global_keys_change,
            quick_add::quick_add_hide,
            quick_add::quick_add_tall,
            agents::shell::tray_keep,
            orden_reminders::reminders::reminders_set,
            orden_reminders::reminders::reminders_taken,
            orden_reminders::reminders::reminders_quietly,
            orden_reminders::notices::notice_show,
            orden_reminders::notices::notice_clear,
            mcp::program::mcp_program,
            ai_agent::ai_agent_tools,
            ai_agent::ai_agent_call,
            ai_agent::ai_agent_context,
            ai_cli::ai_cli_status,
            ai_cli::ai_cli_forget,
            ai_cli::ai_cli_enroll_read,
            ai_cli::ai_cli_enroll_write,
            ai_cli::ai_cli_ask,
            ai_cli::ai_cli_stop,
            ai_cli::ai_cli_open,
            ai_cli::ai_cli_say,
            ai_cli::ai_cli_close,
            ai_cli::ai_cli_models,
            ai_cli::ai_cli_usage,
            orden_secrets::chatgpt::chatgpt_sign_in,
            orden_secrets::chatgpt::chatgpt_account,
            orden_secrets::chatgpt::chatgpt_token,
            orden_secrets::chatgpt::chatgpt_sign_out,
            orden_system::link_preview::link_preview,
            orden_system::appearance::set_frame,
            orden_system::ground::remember_ground,
            orden_import::apple_notes::read_apple_notes,
            orden_import::apple_notes::open_full_disk_access,
            orden_import::obsidian_vaults::obsidian_vaults,
            orden_import::obsidian_vaults::obsidian_vault_files,
            orden_import::obsidian_vaults::read_obsidian_file,
            orden_system::full_screen::window_fullscreen,
            window_drag::window_move_resize,
            orden_system::gpu::gpu_seen,
            orden_system::gpu::gpu_chosen,
            orden_system::gpu::gpu_choose,
            orden_crashes::crashes::crash_reports_waiting,
            orden_crashes::crashes::crash_report_sent,
            orden_crashes::crashes::crash_report_unsent,
            orden_crashes::crashes::crash_report_js,
            orden_crashes::crashes::crash_alive,
            orden_crashes::crashes::crash_context,
            orden_crashes::crashes::crash_leaving,
            orden_crashes::crashes::crash_drill,
            kept::kept_write,
            kept::kept_forget,
            orden_system::gpu::gpu_line,
            page_scale::page_scale_seen,
            page_scale::interface_zoom_chosen,
            page_scale::interface_zoom_choose,
            page_scheme::page_scheme_seen,
            spelling::spell_languages,
            orden_system::fonts::font_families,
            window_drag::window_frame,
            orden_system::full_screen::window_is_fullscreen,
            orden_browsers::zen_profiles::zen_profiles,
            orden_browsers::zen_profiles::read_zen_file,
            orden_browsers::zen_profiles::read_zen_places,
            orden_browsers::browser_profiles::browser_profiles,
            orden_browsers::browser_profiles::read_browser_file,
            orden_browsers::firefox_profiles::read_firefox_places,
            orden_browsers::chromium_profiles::read_arc_sidebar,
            orden_browsers::browser_data::read_browser_history,
            orden_browsers::browser_data::read_browser_icons,
            orden_browsers::safari::read_safari,
            page_style::wear_page_styles,
            launch::take_startup_pages,
            launch::take_startup_pdfs,
            orden_documents::dropped_paths::dropped_paths,
            orden_documents::handed_pdfs::same_pdf,
            launch::new_window,
            launch::show_window,
            orden_notes::ahead::launch_ahead,
            orden_notes::ahead::remember_launch,
            orden_notes::outside::outside_spaces,
            orden_notes::outside::take_in_outside,
            orden_notes::outside::settle_outside,
            old_home::former_homes,
            old_home::keep_after_move,
            old_home::drop_after_move,
            orden_system::default_browser::default_browser,
            orden_system::default_browser::make_default_browser,
            lifecycle::keep_running,
            lifecycle::quit_confirmed,
            lifecycle::quit_others,
            lifecycle::quit_show,
            lifecycle::update_install_failed,
            lifecycle::update_may_install,
            lifecycle::update_settled,
            orden_system::document_window::show_document,
            orden_system::menu_bar::hand_to_keyboard,
            orden_placement::placement::take_keyboard,
            orden_placement::placement::raise_window,
            orden_documents::pandoc::has_pandoc,
            orden_documents::pandoc::run_pandoc,
            orden_documents::pandoc::import_document,
            orden_documents::pdf::pdf_supported,
            orden_documents::pdf::print_pdf,
            orden_documents::pdf::print_page,
            orden_secrets::owner::owner_can,
            orden_secrets::owner::owner_check,
            orden_secrets::pass_stretch::pass_stretch,
            orden_secrets::secrets::secret_forget,
            orden_secrets::secrets::secret_read,
            orden_secrets::secrets::secret_write,
            orden_secrets::secrets::secrets_in_file,
            orden_pty::terminal::terminal_shells,
            orden_pty::terminal::pty_spawn,
            orden_pty::terminal::pty_write,
            orden_pty::terminal::pty_resize,
            orden_pty::terminal::pty_seen,
            orden_pty::terminal::pty_busy,
            orden_apps::apps_host::apps_installed,
            orden_apps::apps_host::apps_start,
            orden_apps::apps_host::apps_watch,
            orden_apps::apps_host::apps_stop,
            orden_apps::apps_host::apps_signal,
            orden_apps::apps_host::apps_view,
            orden_pty::terminal::pty_folder,
            orden_pty::terminal::pty_usage,
            orden_pty::terminal::pty_program,
            orden_pty::terminal::pty_ssh,
            orden_pty::terminal::pty_kill,
            orden_pty::terminal::pty_detach,
            orden_pty::terminal::pty_held,
            orden_pty::terminal::pty_take,
            orden_pty::terminal::pty_name,
            orden_pty::terminal::pty_end,
            orden_pty::terminal::terminal_sessions,
            orden_pty::terminal::terminal_tmux,
            orden_pty::terminal::remote::remote_end,
            orden_pty::terminal::history::terminal_history_read,
            orden_pty::terminal::history::terminal_history_write,
            orden_pty::terminal::history::terminal_history_forget,
            orden_pty::terminal::remote::remote_hosts,
            orden_pty::terminal::remote::remote_keep,
            orden_pty::terminal::remote::remote_config_open,
            orden_pty::terminal::picture::local_image,
            orden_pty::terminal::picture::remote_image,
            orden_pty::terminal::picture::remote_shell,
            orden_system::updates::check_update,
            orden_system::system_update::system_update,
            orden_system::package_manager::install_manager,
            orden_system::app_place::app_stuck,
            orden_system::app_place::move_to_applications,
            shortcuts::shortcuts_offered,
            shortcuts::open_shortcuts,
            shortcuts::shortcuts_added,
            shortcuts::shortcuts_added_taken,
            shortcuts::shortcuts_left_inbox,
            web_tabs::web_open,
            extensions::extensions_list,
            extensions::extensions_install,
            extensions::extensions_set,
            extensions::extensions_remove,
            extensions::extensions_update,
            extensions::extensions_page,
            extensions::extensions_named,
            extensions::popup::extension_popup_open,
            extensions::popup::extension_popup_place,
            extensions::popup::extension_popup_close,
            web_tabs::web_place,
            keyboard::keyboard_watch,
            keyboard::keyboard_pressed,
            keyboard::keyboard_here,
            keyboard::keyboard_went,
            keyboard::keyboard_back,
            web_keys::web_keys_take,
            web_tabs::web_navigate,
            web_tabs::web_step,
            web_tabs::web_trail,
            web_tabs::web_clip,
            web_pass::web_pass_fill,
            web_tabs::web_close,
            web_tabs::web_look,
            web_tabs::web_scroll,
            web_tabs::web_zoom,
            web_tabs::web_print,
            web_tabs::web_devtools,
            page_carry::page_carry,
            page_carry::page_carry_end,
            page_carry::page_carry_over,
            web_certificate::web_certificate,
            web_page::web_mute,
            web_page::web_unfill,
            web_pause::web_pause,
            web_find::web_find,
            web_find::web_find_stop,
            web_tabs::web_shot,
            web_tint::web_tint,
            web_clear::web_clear,
            web_tabs::web_answer,
            web_dialogs::web_dialog_answer,
            orden_dictation::dictation::dictation_local,
            orden_dictation::dictation::dictation_local_fetch,
            orden_dictation::dictation::dictation_local_remove,
            orden_dictation::dictation::dictation_local_open,
            orden_dictation::dictation::dictation_local_hear,
            orden_explorer::explorer::listing::explorer_list,
            orden_explorer::explorer::listing::explorer_places,
            orden_explorer::explorer::listing::explorer_facts,
            orden_explorer::explorer::listing::explorer_peek,
            orden_explorer::explorer::listing::explorer_open,
            orden_explorer::explorer::listing::explorer_icon,
            orden_explorer::explorer::changes::explorer_make,
            orden_explorer::explorer::changes::explorer_rename,
            orden_explorer::explorer::changes::explorer_write,
            orden_explorer::explorer::changes::explorer_trash,
            orden_explorer::explorer::changes::explorer_untrash,
            orden_explorer::explorer::changes::explorer_delete,
            orden_explorer::explorer::jobs::explorer_cancel,
            orden_explorer::explorer::jobs::explorer_clashes,
            orden_explorer::explorer::jobs::explorer_transfer,
            orden_explorer::explorer::jobs::explorer_put,
            orden_explorer::explorer::jobs::explorer_count,
            orden_explorer::explorer::jobs::explorer_search,
            orden_explorer::explorer::watch::explorer_watch,
            orden_explorer::explorer::watch::explorer_unwatch,
            downloads::web_downloads,
            downloads::web_download_open,
            downloads::web_download_saved,
            downloads::web_download_cancel,
            web_state::web_merge,
            web_state::web_copy,
            orden_system::presence::input_idle,
            orden_system::presence::device_name,
            orden_system::time_sense::time_sense,
            orden_system::touchpad::touchpad_pan,
        ]
    };
}

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

#[cfg(all(desktop, not(feature = "cef")))]
compile_error!(
    "desktop builds from apps/desktop/src-tauri/linux/Cargo.toml: run scripts/linux-cef.sh first"
);

pub fn run() {
    #[cfg(target_os = "linux")]
    orden_base::linux::prepare();
    #[cfg(mobile)]
    run_on(tauri::Builder::default());
    #[cfg(desktop)]
    run_on(tauri::Builder::default().runtime(engine::cef_runtime()));
}

#[cfg(desktop)]
#[must_use]
pub fn terminal_hold() -> Option<i32> {
    std::env::args_os()
        .nth(1)
        .is_some_and(|first| first == orden_pty::terminal::hold::MODE)
        .then(orden_pty::terminal::hold::serve)
}

#[cfg(desktop)]
#[must_use]
pub fn cef_helper() -> bool {
    if !std::env::args_os().any(|arg| arg.as_encoded_bytes().starts_with(b"--type=")) {
        return false;
    }
    engine::renderer::run();
    true
}

pub fn run_on(builder: tauri::Builder<Engine>) {
    #[cfg(target_os = "macos")]
    orden_system::bundle_name::carry_over(env!("ORDEN_IDENTIFIER"));

    trace::begin();

    #[cfg(desktop)]
    if orden_placement::foreground::hold() {
        eprintln!(
            "orden: this probe started able to take the foreground; it is locked (see src-tauri/crates/placement/src/foreground.rs)"
        );
    }

    #[cfg_attr(
        not(desktop),
        allow(
            unused_mut,
            reason = "a phone has no window in the config to take out of it"
        )
    )]
    let mut context = tauri::generate_context!();

    #[cfg(desktop)]
    if handover::handed_over(&context.config().identifier) {
        return;
    }
    #[cfg(desktop)]
    trace::mark("engine chosen");

    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_single_instance::init(
            launch::second_launch_heard,
        ))
        .manage(launch::Pending::default())
        .manage(launch::restart_env());
    #[cfg(desktop)]
    let builder = lifecycle::managed(builder);
    #[cfg(desktop)]
    trace::mark("plugins: updater, dialog, process, one instance");

    let builder = links_out_and_in(builder);
    trace::mark("plugins: opener, os, deep link");

    let builder = builder
        .manage(orden_store::sync_store::Stores::default())
        .manage(orden_notes::space_watch::Watching::default())
        .manage(orden_notes::space_watch::Working::default());

    #[cfg(desktop)]
    let builder = builder.manage(endpoint::Waiting::default());

    #[cfg(desktop)]
    let builder = orden_placement::placement::managed(web_tabs::managed(builder));

    #[cfg(desktop)]
    let builder = orden_pty::terminal::managed(builder);

    #[cfg(desktop)]
    let builder = builder.manage(orden_apps::apps_host::Hosted::default());

    #[cfg(desktop)]
    let builder = builder
        .manage(orden_explorer::explorer::reach::Explored::default())
        .manage(orden_explorer::explorer::watch::Watching::default());

    #[cfg(desktop)]
    let builder = builder.manage(std::sync::Arc::new(
        orden_dictation::dictation::Loaded::default(),
    ));

    #[cfg(desktop)]
    let builder = builder
        .manage(ai_cli::Asks::default())
        .manage(orden_secrets::chatgpt::ChatGpt::default());

    #[cfg(desktop)]
    let builder = builder.invoke_handler(named(desktop_commands!()));

    #[cfg(target_os = "ios")]
    let builder = builder.invoke_handler(commands![
        orden_secrets::owner::owner_can,
        orden_secrets::owner::owner_check,
        orden_secrets::pass_stretch::pass_stretch,
        orden_secrets::secrets::secret_forget,
        orden_secrets::secrets::secret_read,
        orden_secrets::secrets::secret_write,
        orden_secrets::secrets::secrets_in_file,
    ]);
    #[cfg(target_os = "android")]
    let builder = builder.invoke_handler(commands![]);
    trace::mark("commands registered");

    #[cfg(desktop)]
    let ui = engine::take_ui_window(&mut context);

    let builder = pages_that_end(builder);

    #[cfg(desktop)]
    let builder = builder.setup(move |app| ready(app, ui.as_ref()));
    #[cfg(not(desktop))]
    let builder = builder.setup(|app| ready(app, None));

    builder
        .build(context)
        .unwrap_or_else(|error| {
            eprintln!("Orden could not start: {error}");
            std::process::exit(1);
        })
        .run(on_event);
}

fn pages_that_end(builder: tauri::Builder<Engine>) -> tauri::Builder<Engine> {
    #[cfg(desktop)]
    let builder = builder.on_web_content_process_terminate(|view, ended| {
        use tauri::webview::WebContentProcessTerminationReason as Reason;
        if !matches!(ended.reason, Reason::Normal) {
            orden_crashes::crashes::page_ended(view.label());
            web_page::ended(view);
        }
    });
    builder
}

#[cfg(desktop)]
fn first_window(handle: &tauri::AppHandle) {
    pinch::first_window(handle);
    orden_documents::dropped_paths::first_window(handle);
}

fn links_out_and_in(builder: tauri::Builder<Engine>) -> tauri::Builder<Engine> {
    #[cfg(desktop)]
    let builder = builder.on_page_load(|webview, payload| {
        if payload.event() == tauri::webview::PageLoadEvent::Started {
            orden_pty::terminal::page_started(webview);
            orden_explorer::explorer::watch::window_gone(webview.app_handle(), webview.label());
            if let Some(waiting) = webview.try_state::<endpoint::Waiting>() {
                waiting.forget(webview.label());
            }
            ai_cli::page_started(webview.app_handle(), webview.label());
        }
    });
    builder
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_deep_link::init())
        .manage(Picked::default())
        .manage(uris::Pending::default())
}

#[cfg(desktop)]
fn named(
    answer: impl Fn(tauri::ipc::Invoke<Engine>) -> bool + Send + Sync + 'static,
) -> impl Fn(tauri::ipc::Invoke<Engine>) -> bool + Send + Sync + 'static {
    move |invoke| {
        let command = invoke.message.command();
        orden_crashes::crashes::crumb(command);
        let _doing = orden_crashes::stall::doing(command);
        answer(invoke)
    }
}

fn on_event(app: &tauri::AppHandle<Engine>, event: tauri::RunEvent) {
    #[cfg(desktop)]
    lifecycle::on_event(app, event);
    #[cfg(not(desktop))]
    let _ = (app, event);
}

#[cfg(desktop)]
fn hearing(handle: &tauri::AppHandle) {
    web_tabs::hearing(handle);
    page_carry::forget_carried(handle);
    #[cfg(windows)]
    orden_system::touchpad::start(handle);
    #[cfg(windows)]
    std::thread::spawn(orden_system::shell_menu::forget);
}

#[cfg(desktop)]
fn reminders_started(handle: &tauri::AppHandle) {
    orden_reminders::reminders::start(
        handle,
        orden_reminders::reminders::Host {
            #[cfg(target_os = "macos")]
            reopen: launch::reopen,
            quit_now: lifecycle::quit_now,
            in_tray: agents::shell::in_tray,
            notify: agents::shell::notify,
        },
    );
}

#[cfg(desktop)]
fn engine_started(handle: &tauri::AppHandle<Engine>) {
    #[cfg(target_os = "linux")]
    chromium_pump::start(handle);
    page_scale::start(handle);
    orden_documents::pdf::hand_engine(orden_documents::pdf::Engine {
        profile: engine::own_profile,
        call: engine::devtools::call,
    });
    extensions::tabs::start(handle);
    extensions::preinstall(handle);
}

#[cfg(desktop)]
fn first_of_all(handle: &tauri::AppHandle) {
    orden_crashes::crashes::start(handle);
    trace::mark("crash reports");
    orden_system::updates::hand_lifecycle(orden_system::updates::Lifecycle {
        quit: lifecycle::quit,
        before_installer: lifecycle::before_installer,
    });
    paths::decide_spaces(handle);
    if let Ok(config) = paths::config_dir(handle) {
        let _ = std::fs::remove_file(config.join("dns.json"));
    }
}

fn ready(
    app: &mut tauri::App,
    ui: Option<&tauri::utils::config::WindowConfig>,
) -> Result<(), Box<dyn std::error::Error>> {
    trace::mark("app built, window created");

    let handle = app.handle();

    #[cfg(desktop)]
    first_of_all(handle);

    #[cfg(desktop)]
    let web_first = orden_notes::ahead::start(handle);

    #[cfg(target_os = "macos")]
    orden_system::menu_bar::leave_out_system_rows();

    if let Ok(root) = paths::spaces_dir(handle) {
        let _ = handle.asset_protocol_scope().allow_directory(&root, true);
    }
    paths::hear_picks(handle);
    trace::mark("asset scope");

    uris::watch(handle);
    #[cfg(desktop)]
    reminders_started(handle);
    trace::mark("deep links");

    #[cfg(desktop)]
    endpoint::start(handle);
    #[cfg(desktop)]
    trace::mark("automation endpoint");

    #[cfg(desktop)]
    {
        let args: Vec<std::ffi::OsString> = std::env::args_os().collect();
        let cwd = std::env::current_dir().unwrap_or_default();
        launch::hold_handed(handle, &args, &cwd);
        quick_add::asked_at_launch(&args);
        trace::mark(if orden_base::handed::for_a_link(&args) {
            "launch arguments, a link's"
        } else {
            "launch arguments"
        });
    }
    #[cfg(not(desktop))]
    trace::mark("launch arguments");

    #[cfg(desktop)]
    hearing(handle);
    #[cfg(desktop)]
    engine_started(handle);

    #[cfg(desktop)]
    if let Some(config) = ui {
        let config = orden_placement::placement::restored(handle, config);
        trace::mark("window placement");
        let building = engine::ui_window(app, &config)?;
        if let Some(at) = orden_placement::placement::away() {
            let window = orden_placement::placement::built_away(building, at)?;
            orden_crashes::stall::watch_page(handle, window.as_ref(), "the window's");
        } else if uris::launched_quietly(handle) {
            let window = building.visible(false).build()?;
            orden_placement::top_edge::mind(&window.as_ref().window());
            orden_crashes::stall::watch_page(handle, window.as_ref(), "the window's");
        } else {
            let colour = orden_system::ground::remembered(handle);
            let at_once = colour.is_some() && !cfg!(target_os = "macos");
            let building = match colour {
                Some(colour) => building.background_color(colour),
                None => building,
            };
            let window = orden_placement::placement::settled(building.visible(at_once))?;
            orden_placement::top_edge::mind(&window.as_ref().window());
            orden_crashes::stall::watch_page(handle, window.as_ref(), "the window's");
            if !at_once {
                #[cfg(target_os = "macos")]
                orden_system::lights::hold(&window);
                window.show()?;
                orden_placement::placement::raised(&window.as_ref().window());
            }
        }
        first_window(handle);
    }

    #[cfg(not(desktop))]
    {
        let _ = ui;
        if let Some(window) = app.get_window("main") {
            window.show()?;
        }
    }

    #[cfg(desktop)]
    if let Some(pending) = handle.try_state::<launch::Pending>() {
        pending.launched();
    }

    trace::mark("window shown");
    #[cfg(desktop)]
    watched(handle);
    #[cfg(desktop)]
    if web_first {
        web_tabs::warm(handle);
    }
    trace::write(handle);

    #[cfg(desktop)]
    kept_listed(handle);

    Ok(())
}

#[cfg(desktop)]
fn kept_listed(handle: &tauri::AppHandle<Engine>) {
    orden_system::default_browser::keep_registered(handle);
    ai_cli::keep_enrolled(handle);
    orden_secrets::retired_chats::clear_leftovers(handle);
}

#[cfg(desktop)]
fn watched(handle: &tauri::AppHandle) {
    logs::say(
        handle,
        "info",
        &format!(
            "started Orden {} (pid {})",
            handle.package_info().version,
            std::process::id()
        ),
    );
    handover::said(handle);
    orden_crashes::stall::start(handle);
}

#[cfg(test)]
pub(crate) fn app_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf()
}

#[cfg(test)]
pub(crate) fn sources() -> Vec<(String, std::path::PathBuf)> {
    let app = app_dir();
    let mut roots = vec![(String::new(), app.join("src"))];
    for one in std::fs::read_dir(app.join("crates"))
        .expect("the crates")
        .flatten()
    {
        let name = one.file_name().to_string_lossy().into_owned();
        roots.push((format!("crates/{name}/src/"), one.path().join("src")));
    }
    let mut found = Vec::new();
    for (prefix, root) in roots {
        let mut pending = vec![root.clone()];
        while let Some(dir) = pending.pop() {
            for entry in std::fs::read_dir(&dir).expect("the sources").flatten() {
                let path = entry.path();
                if path.is_dir() {
                    pending.push(path);
                    continue;
                }
                let name = path
                    .strip_prefix(&root)
                    .expect("under the source")
                    .to_string_lossy()
                    .replace('\\', "/");
                if prefix.is_empty() && name == "scans.rs" {
                    continue;
                }
                found.push((format!("{prefix}{name}"), path));
            }
        }
    }
    found
}

#[cfg(test)]
mod tests {
    use crate::calls;

    fn app_page_load_hooks(text: &str) -> usize {
        let mut signature = String::new();
        let mut opening = false;
        let mut hooks = 0;
        for line in text.lines() {
            let head = line.trim_start().split('(').next().unwrap_or_default();
            if (head.starts_with("fn ") || head.starts_with("pub") || head.starts_with("async "))
                && head.contains("fn ")
            {
                signature.clear();
                opening = true;
            }
            if opening {
                signature.push_str(line);
                opening = !line.contains('{');
            }
            if line.contains(".on_page_load(") && signature.contains("tauri::Builder<") {
                hooks += 1;
            }
        }
        hooks
    }

    #[test]
    fn the_app_has_one_page_load_hook_as_a_second_would_replace_it() {
        let mut hooks = Vec::new();
        for (name, path) in crate::sources() {
            if path.extension().is_some_and(|ext| ext == "rs") {
                let text = std::fs::read_to_string(&path).expect("a source");
                for _ in 0..app_page_load_hooks(&text) {
                    hooks.push(name.clone());
                }
            }
        }
        assert_eq!(hooks.len(), 1, "{hooks:?}");
        let second = "fn a(builder: tauri::Builder<Engine>) -> tauri::Builder<Engine> {\n    builder.on_page_load(|_, _| {})\n}\nfn b(view: WebviewBuilder) {\n    view.on_page_load(|_, _| {});\n}\n";
        assert_eq!(app_page_load_hooks(second), 1);
    }

    const EXCEPTED: [&str; 3] = [
        "orden_base::logs::write_log",
        "crate::kept::kept_write",
        "crate::kept::kept_forget",
    ];

    const WAITS: [&str; 38] = [
        "fs::",
        "File::",
        "OpenOptions",
        "Command::new",
        "get_password",
        "set_password",
        "delete_credential",
        "canonicalize",
        "tauri_plugin_opener::",
        ".resize(",
        "CreateToolhelp32Snapshot",
        "EnumProcesses",
        ".wait(",
        ".wait_timeout(",
        ".wait_while(",
        ".wait_timeout_while(",
        "WaitForSingleObject",
        "WaitForMultipleObjects",
        "MsgWaitForMultipleObjects",
        "wait_for_async_operation",
        "wait_with_pump",
        ".recv(",
        ".recv_timeout(",
        ".join()",
        "block_on",
        "blocking_recv",
        "blocking_lock",
        "thread::sleep",
        "SendMessageW",
        "TcpStream::connect",
        ".exists()",
        ".try_exists()",
        ".is_file()",
        ".is_dir()",
        ".metadata()",
        ".symlink_metadata()",
        ".read_dir()",
        "blocking::",
    ];

    const TARGETS: [calls::Target; 3] = [
        calls::Target::WINDOWS,
        calls::Target::MACOS,
        calls::Target::LINUX,
    ];

    const SMALL_ON_THE_WINDOW_S_THREAD: [&str; 6] = [
        "orden_crashes::crashes::exit::ended_well",
        "orden_placement::placement::keep",
        "orden_placement::placement::read",
        "crate::extensions::webview2::reconcile",
        "crate::engine::web_store",
        "crate::agents::quiet::destination",
    ];

    const OPENS_ON_THE_WINDOW_S_THREAD: [&str; 2] = [
        "orden_system::default_browser::platform::make_default::main#0",
        "crate::downloads::saving::main#0",
    ];

    const BUILDS: [&str; 2] = ["WebviewWindowBuilder::new(", "WebviewBuilder::new("];

    const BUILT_OFF_THE_CALLBACK: [&str; 1] = ["crate::quick_add::bring_up"];

    fn own() -> calls::Crate {
        own_on(calls::Target::WINDOWS)
    }

    fn own_on(target: calls::Target) -> calls::Crate {
        let own = calls::read(&crate::app_dir().join("src").join("lib.rs"), target);
        assert!(
            own.modules() > 20,
            "only {} modules were read",
            own.modules()
        );
        own
    }

    #[test]
    fn a_command_that_waits_says_async() {
        let mut seen: Vec<String> = Vec::new();
        for target in TARGETS {
            let own = own_on(target);
            let waits = own.waiting(&WAITS, &[]);
            seen.extend(own.commands().iter().cloned());
            let late: Vec<String> = own
                .commands()
                .iter()
                .filter(|path| waits.contains(path) && !EXCEPTED.contains(&path.as_str()))
                .map(|path| own.chain(path, &WAITS, &waits).join(" -> "))
                .collect();
            assert!(
                late.is_empty(),
                "on {target:?} {late:#?} wait without saying async"
            );
        }
        for excepted in EXCEPTED {
            assert!(
                seen.iter().any(|one| one == excepted),
                "{excepted} is no command on the calling thread"
            );
        }
    }

    const BLOCKS_THE_RUNTIME: [&str; 6] = [
        "block_on(",
        "blocking_recv(",
        "blocking_send(",
        "blocking_lock(",
        "blocking_read(",
        "blocking_write(",
    ];

    #[test]
    fn a_command_run_on_the_runtime_is_followed_to_what_blocks_on_it() {
        let source = concat!(
            "#[tauri::command(async)]\npub fn handed() {\n    fetched();\n}\n\n",
            "fn fetched() {\n    tauri::async_runtime::block_on(sent());\n}\n\n",
            "#[tauri::command]\npub async fn awaited() {\n    tauri::async_runtime::block_on(sent());\n}\n\n",
            "#[tauri::command(async)]\npub fn apart() {\n    std::thread::spawn(|| tauri::async_runtime::block_on(sent()));\n}\n\n",
            "#[tauri::command]\npub fn here() {\n    fetched();\n}\n",
        );
        let own = calls::of(&[("crate", source)]);
        let mut workers = own.workers().to_vec();
        workers.sort();
        assert_eq!(workers, ["crate::apart", "crate::awaited", "crate::handed"]);
        let blocks = own.reaching(&BLOCKS_THE_RUNTIME, &[]);
        assert!(blocks.contains("crate::handed"));
        assert!(blocks.contains("crate::awaited"));
        assert!(!blocks.contains("crate::apart"));
    }

    #[test]
    fn blocking_on_the_runtime_from_inside_one_of_its_tasks_panics() {
        let panicked = tauri::async_runtime::block_on(tauri::async_runtime::spawn(async {
            std::panic::catch_unwind(|| tauri::async_runtime::block_on(async {})).is_err()
        }))
        .expect("the task ran");
        assert!(panicked);
    }

    #[test]
    fn nothing_a_command_runs_on_the_runtime_blocks_on_it() {
        let mut late: Vec<String> = Vec::new();
        for target in TARGETS {
            let own = own_on(target);
            assert!(
                own.workers().len() > 100,
                "only {} commands on the runtime",
                own.workers().len()
            );
            let waits = own.waiting(&BLOCKS_THE_RUNTIME, &[]);
            late.extend(
                own.workers()
                    .iter()
                    .filter(|path| waits.contains(path))
                    .map(|path| {
                        format!(
                            "{target:?} {}",
                            own.chain(path, &BLOCKS_THE_RUNTIME, &waits).join(" -> ")
                        )
                    }),
            );
        }
        assert!(late.is_empty(), "blocks the runtime it runs on: {late:#?}");
    }

    const HOLDS_A_WORKER: [&str; 16] = [
        "Command::new",
        ".wait(",
        ".wait_timeout(",
        ".wait_while(",
        ".wait_timeout_while(",
        "WaitForSingleObject",
        "WaitForMultipleObjects",
        "MsgWaitForMultipleObjects",
        "wait_for_async_operation",
        "wait_with_pump",
        ".recv(",
        ".recv_timeout(",
        ".join()",
        "thread::sleep",
        "SendMessageW",
        "TcpStream::connect",
    ];

    #[test]
    fn a_command_on_the_runtime_that_waits_is_found_unless_the_wait_is_handed_off() {
        let source = concat!(
            "#[tauri::command(async)]\npub fn held(heard: Receiver<u8>) {\n    let _ = heard.recv();\n}\n\n",
            "#[tauri::command]\npub async fn slept() {\n    asked();\n}\n\n",
            "fn asked() {\n    std::thread::sleep(Duration::from_secs(3));\n}\n\n",
            "#[tauri::command]\npub async fn handed() {\n    let _ = tauri::async_runtime::spawn_blocking(asked_later).await;\n}\n\n",
            "fn asked_later() {\n    tauri::async_runtime::spawn_blocking(|| asked());\n}\n\n",
            "#[tauri::command]\npub async fn heard(mut heard: tokio::sync::mpsc::Receiver<u8>) {\n    let _ = heard.recv().await;\n}\n\n",
            "#[tauri::command]\npub async fn timed(mut heard: tokio::sync::mpsc::Receiver<u8>) {\n    let _ = tokio::time::timeout(Duration::from_secs(1), heard.recv()).await;\n}\n\n",
            "#[tauri::command]\npub async fn off() {\n    let _ = crate::lane::off_the_runtime(asked).await;\n}\n",
        );
        let own = calls::of(&[("crate", source)]);
        let waits = own.waiting(&HOLDS_A_WORKER, &[]);
        let mut held: Vec<&String> = own
            .workers()
            .iter()
            .filter(|path| waits.contains(path))
            .collect();
        held.sort();
        assert_eq!(held, ["crate::held", "crate::slept"]);
    }

    const WAITS_IN_WHAT_IT_HANDS_ON: [&str; 2] = [
        "orden_documents::pdf::print_pdf",
        "orden_system::updates::check_update",
    ];

    #[test]
    fn no_command_on_the_runtime_waits_on_one_of_its_workers() {
        let mut late: Vec<String> = Vec::new();
        for target in TARGETS {
            let own = own_on(target);
            for excepted in WAITS_IN_WHAT_IT_HANDS_ON {
                assert!(
                    own.workers().iter().any(|one| one == excepted),
                    "{excepted} is no command on the runtime"
                );
            }
            let waits = own.waiting(&HOLDS_A_WORKER, &[]);
            late.extend(
                own.workers()
                    .iter()
                    .filter(|path| {
                        waits.contains(path) && !WAITS_IN_WHAT_IT_HANDS_ON.contains(&path.as_str())
                    })
                    .map(|path| {
                        format!(
                            "{target:?} {}",
                            own.chain(path, &HOLDS_A_WORKER, &waits).join(" -> ")
                        )
                    }),
            );
        }
        assert!(late.is_empty(), "holds a worker of the runtime: {late:#?}");
    }

    #[test]
    fn nothing_the_window_s_thread_runs_waits() {
        let mut late: Vec<String> = Vec::new();
        for target in TARGETS {
            let own = own_on(target);
            assert!(own.mains().len() > 5, "only {:?}", own.mains());
            let waits = own.waiting(&WAITS, &SMALL_ON_THE_WINDOW_S_THREAD);
            late.extend(
                own.mains()
                    .iter()
                    .filter(|path| {
                        waits.contains(path)
                            && !OPENS_ON_THE_WINDOW_S_THREAD.contains(&path.as_str())
                    })
                    .map(|path| {
                        format!(
                            "{target:?} {}",
                            own.chain(path, &WAITS, &waits).join(" -> ")
                        )
                    }),
            );
        }
        assert!(late.is_empty(), "the window's thread waits in {late:#?}");
    }

    const ASKS_THE_WINDOW_S_THREAD: [&str; 27] = [
        ".inner_size(",
        ".outer_size(",
        ".inner_position(",
        ".outer_position(",
        ".scale_factor(",
        ".is_visible(",
        ".is_focused(",
        ".is_maximized(",
        ".is_minimized(",
        ".is_fullscreen(",
        ".is_decorated(",
        ".is_resizable(",
        ".is_enabled(",
        ".is_always_on_top(",
        ".is_devtools_open(",
        ".current_monitor(",
        ".primary_monitor(",
        ".available_monitors(",
        ".monitor_from_point(",
        ".cursor_position(",
        ".hwnd(",
        ".window_handle(",
        ".bounds(",
        ".cookies(",
        "WebviewWindowBuilder::new(",
        "WebviewBuilder::new(",
        ".add_child(",
    ];

    fn asks_the_window_s_thread(said: &str) -> bool {
        let says = |word: &str| said.contains(&calls::spaced(word));
        says("run_on_main_thread(")
            && [".recv(", ".recv_timeout(", ".blocking_recv("]
                .iter()
                .any(|word| says(word))
            || ASKS_THE_WINDOW_S_THREAD.iter().any(|word| says(word))
    }

    #[test]
    fn a_lock_held_while_asking_the_window_s_thread_is_followed_to_it() {
        let source = concat!(
            "static HELD: Mutex<u8> = Mutex::new(0);\n\nstatic SENT: Mutex<u8> = Mutex::new(0);\n\nstatic FREE: Mutex<u8> = Mutex::new(0);\n\n",
            "#[tauri::command(async)]\npub fn asks(window: Window) {\n    let held = HELD.lock().unwrap();\n    let _ = window.inner_size();\n    drop(held);\n}\n\n",
            "#[tauri::command(async)]\npub fn sends(app: AppHandle) {\n    let held = SENT.lock().unwrap();\n    let (told, heard) = channel();\n    let _ = app.run_on_main_thread(move || told.send(1));\n    let _ = heard.recv();\n    drop(held);\n}\n\n",
            "#[tauri::command(async)]\npub fn frees(window: Window) {\n    let held = FREE.lock().unwrap();\n    drop(held);\n    let _ = window.inner_size();\n}\n\n",
            "pub fn started(app: &App) {\n    app.on_window_event(|window, event| {\n        *HELD.lock().unwrap() = 1;\n        *SENT.lock().unwrap() = 1;\n        *FREE.lock().unwrap() = 1;\n    });\n}\n",
        );
        let own = calls::of(&[("crate", source)]);
        let asking = own.saying(asks_the_window_s_thread);
        let found = own
            .taking_held(asks_the_window_s_thread, &asking, &[])
            .join("\n");
        assert!(found.contains("crate::HELD"), "{found}");
        assert!(found.contains("crate::SENT"), "{found}");
        assert!(!found.contains("crate::FREE"), "{found}");
    }

    #[test]
    fn the_window_s_thread_takes_no_lock_held_while_asking_it() {
        let mut late: Vec<String> = Vec::new();
        for target in TARGETS {
            let own = own_on(target);
            let asking = own.saying(asks_the_window_s_thread);
            late.extend(
                own.taking_held(
                    asks_the_window_s_thread,
                    &asking,
                    &SMALL_ON_THE_WINDOW_S_THREAD,
                )
                .into_iter()
                .map(|one| format!("{target:?} {one}")),
            );
        }
        assert!(
            late.is_empty(),
            "the window's thread could wait for itself in {late:#?}"
        );
    }

    #[test]
    fn a_lock_taken_again_under_itself_or_in_the_other_order_is_found() {
        let source = concat!(
            "static ONE: Mutex<u8> = Mutex::new(0);\n\nstatic TWO: Mutex<u8> = Mutex::new(0);\n\nstatic ASKED: Mutex<u8> = Mutex::new(0);\n\nstatic FIRST: Mutex<u8> = Mutex::new(0);\n\n",
            "fn one() -> u8 {\n    *ONE.lock().unwrap()\n}\n\n",
            "fn asked() -> u8 {\n    *ASKED.lock().unwrap()\n}\n\n",
            "fn first() -> u8 {\n    *FIRST.lock().unwrap()\n}\n\n",
            "pub fn again() {\n    if let Some(seen) = Some(*ONE.lock().unwrap()) {\n        one();\n    }\n}\n\n",
            "pub fn forth() {\n    let one = ONE.lock().unwrap();\n    *TWO.lock().unwrap() = *one;\n}\n\n",
            "pub fn back() {\n    let two = TWO.lock().unwrap();\n    one();\n    drop(two);\n}\n\n",
            "pub fn condition() {\n    if *ASKED.lock().unwrap() == 0 {\n        asked();\n    }\n}\n\n",
            "pub fn before() {\n    *holder(first()).lock().unwrap() = 1;\n}\n\n",
            "fn holder(_: u8) -> &'static Mutex<u8> {\n    &FIRST\n}\n",
        );
        let own = calls::of(&[("crate", source)]);
        let found = own.lock_orders(&[]).join("\n");
        assert!(
            found.contains(
                "crate::again holds crate::ONE and calls on to crate::one, which takes it again"
            ),
            "{found}"
        );
        assert!(
            found.contains("crate::forth holds crate::ONE and takes crate::TWO under it"),
            "{found}"
        );
        assert!(found.contains("crate::back holds crate::TWO"), "{found}");
        assert!(!found.contains("crate::condition"), "{found}");
        assert!(!found.contains("crate::before"), "{found}");
    }

    #[test]
    fn no_lock_is_taken_again_or_in_the_other_order_under_another() {
        let mut found: Vec<String> = Vec::new();
        for target in TARGETS {
            let own = own_on(target);
            found.extend(
                own.lock_orders(&[])
                    .into_iter()
                    .map(|one| format!("{target:?} {one}")),
            );
        }
        assert!(
            found.is_empty(),
            "locks that wait on each other: {found:#?}"
        );
    }

    #[test]
    fn a_lock_held_across_a_wait_is_a_wait_for_whoever_takes_it() {
        let source = concat!(
            "static HELD: Mutex<u8> = Mutex::new(0);\n\n",
            "static FREE: Mutex<u8> = Mutex::new(0);\n\n",
            "#[tauri::command(async)]\npub fn slow() {\n    let held = HELD.lock().unwrap();\n    fs::write(one, two);\n    drop(held);\n}\n\n",
            "#[tauri::command]\npub fn quick() -> u8 {\n    *HELD.lock().unwrap()\n}\n\n",
            "#[tauri::command(async)]\npub fn let_go() {\n    let held = FREE.lock().unwrap();\n    drop(held);\n    fs::write(one, two);\n}\n\n",
            "#[tauri::command]\npub fn free() -> u8 {\n    let read = *FREE.lock().unwrap();\n    read\n}\n\n",
            "fn lock<T>(held: &Mutex<T>) -> MutexGuard<'_, T> {\n    held.lock().unwrap()\n}\n\n",
            "#[tauri::command(async)]\npub fn opening() {\n    let open = lock(&FREE);\n    let _ = Command::new(one).spawn();\n}\n\n",
            "#[tauri::command]\npub fn closing() {\n    lock(&HELD).take();\n}\n",
        );
        let own = calls::of(&[("crate", source)]);
        let waits = own.waiting(&WAITS, &[]);
        assert!(waits.contains("crate::quick") && waits.contains("crate::closing"));
        assert!(
            waits.contains("crate::free"),
            "a guard a helper hands out is held as well"
        );
        let quiet = concat!(
            "static FREE: Mutex<u8> = Mutex::new(0);\n\n",
            "#[tauri::command(async)]\npub fn let_go() {\n    let held = FREE.lock().unwrap();\n    drop(held);\n    fs::write(one, two);\n}\n\n",
            "#[tauri::command]\npub fn free() -> u8 {\n    let read = *FREE.lock().unwrap();\n    read\n}\n",
        );
        let own = calls::of(&[("crate", quiet)]);
        assert!(!own.waiting(&WAITS, &[]).contains("crate::free"));
    }

    #[test]
    fn a_method_is_followed_through_what_its_receiver_is() {
        let source = concat!(
            "pub struct Gemini;\n\nimpl Gemini {\n    pub fn stop(&self) {\n        fs::write(one, two);\n    }\n}\n\n",
            "pub struct Quiet;\n\nimpl Quiet {\n    pub fn stop(&self) {}\n}\n\n",
            "enum On {\n    Loud(Box<Gemini>),\n    Calm(Quiet),\n}\n\n",
            "pub struct Asks {\n    on: Mutex<HashMap<String, On>>,\n    kept: Arc<Gemini>,\n    calm: Quiet,\n}\n\n",
            "#[tauri::command]\npub fn by_field(asks: State<'_, Asks>) {\n    asks.kept.stop();\n}\n\n",
            "#[tauri::command]\npub fn by_state(app: AppHandle) {\n    if let Some(asks) = app.try_state::<Asks>() {\n        asks.kept.stop();\n    }\n}\n\n",
            "#[tauri::command]\npub fn by_variant(on: &On) {\n    match on {\n        On::Loud(gemini) => gemini.stop(),\n        On::Calm(quiet) => quiet.stop(),\n    }\n}\n\n",
            "#[tauri::command]\npub fn by_loop(asks: &Asks) {\n    for one in asks.on.lock().unwrap().values() {\n        if let On::Loud(gemini) = one {\n            gemini.stop();\n        }\n    }\n}\n\n",
            "#[tauri::command]\npub fn calm(asks: &Asks) {\n    asks.calm.stop();\n}\n\n",
            "pub struct Gone;\n\nimpl Drop for Gone {\n    fn drop(&mut self) {\n        fs::remove_file(one);\n    }\n}\n\n",
            "pub struct Holds {\n    gone: Gone,\n}\n\n",
            "#[tauri::command]\npub fn dropping(gone: Option<Holds>) {\n    drop(gone);\n}\n",
        );
        let own = calls::of(&[("crate", source)]);
        let waits = own.waiting(&WAITS, &[]);
        for loud in [
            "crate::by_field",
            "crate::by_state",
            "crate::by_variant",
            "crate::by_loop",
            "crate::dropping",
        ] {
            assert!(waits.contains(loud), "{loud} was not followed");
        }
        assert!(!waits.contains("crate::calm"));
    }

    #[test]
    fn a_lock_is_known_by_whose_it_is() {
        let source = concat!(
            "pub struct One {\n    held: Mutex<u8>,\n}\n\npub struct Two {\n    held: Mutex<u8>,\n}\n\n",
            "pub struct Inner {\n    shared: Mutex<u8>,\n}\n\n",
            "impl Inner {\n    fn lock(&self) -> MutexGuard<'_, u8> {\n        self.shared.lock().unwrap()\n    }\n}\n\n",
            "pub struct Peer {\n    inner: Arc<Inner>,\n}\n\n",
            "static SHARED: RwLock<u8> = RwLock::new(0);\n\n",
            "#[tauri::command(async)]\npub fn slow(one: &One, peer: &Peer) {\n    let held = one.held.lock().unwrap();\n    let shared = peer.inner.lock();\n    let read = SHARED.read().unwrap();\n    fs::write(a, b);\n    drop(held);\n}\n\n",
            "#[tauri::command]\npub fn written() {\n    *SHARED.write().unwrap() = 1;\n}\n\n",
            "#[tauri::command]\npub fn other(two: &Two) -> u8 {\n    *two.held.lock().unwrap()\n}\n\n",
            "#[tauri::command]\npub fn same(one: &One) -> u8 {\n    *one.held.lock().unwrap()\n}\n\n",
            "#[tauri::command]\npub fn inside(inner: &Inner) -> u8 {\n    *inner.shared.lock().unwrap()\n}\n",
        );
        let own = calls::of(&[("crate", source)]);
        let waits = own.waiting(&WAITS, &[]);
        assert!(waits.contains("crate::same"));
        assert!(
            waits.contains("crate::written"),
            "a read lock is held as a lock is"
        );
        assert!(
            waits.contains("crate::inside"),
            "a type's own lock is the lock it hands out"
        );
        assert!(
            !waits.contains("crate::other"),
            "another type's lock of the same name was taken for it"
        );
    }

    #[test]
    fn a_method_of_a_trait_is_followed_to_what_implements_it() {
        let source = concat!(
            "pub trait Machine {\n    fn look(&self) -> bool;\n\n    fn twice(&self) -> bool {\n        fs::read(one).is_ok()\n    }\n}\n\n",
            "pub struct Real;\n\nimpl Machine for Real {\n    fn look(&self) -> bool {\n        fs::metadata(one).is_ok()\n    }\n}\n\n",
            "pub struct Quiet;\n\nimpl Machine for Quiet {\n    fn look(&self) -> bool {\n        false\n    }\n}\n\n",
            "pub struct Reading<F: Machine> {\n    machine: F,\n}\n\n",
            "type Kept = Box<dyn Machine + Send>;\n\n",
            "pub struct Holding {\n    kept: Kept,\n}\n\n",
            "#[tauri::command]\npub fn by_impl(machine: &impl Machine) -> bool {\n    machine.look()\n}\n\n",
            "#[tauri::command]\npub fn by_dyn(machine: &dyn Machine) -> bool {\n    machine.look()\n}\n\n",
            "#[tauri::command]\npub fn by_box(machine: Box<dyn Machine>) -> bool {\n    machine.look()\n}\n\n",
            "#[tauri::command]\npub fn by_generic<M: Machine>(machine: &M) -> bool {\n    machine.look()\n}\n\n",
            "#[tauri::command]\npub fn by_where<M>(machine: &M) -> bool\nwhere\n    M: Machine,\n{\n    machine.look()\n}\n\n",
            "#[tauri::command]\npub fn by_field<F: Machine>(reading: &Reading<F>) -> bool {\n    reading.machine.look()\n}\n\n",
            "#[tauri::command]\npub fn by_alias(holding: &Holding) -> bool {\n    holding.kept.look()\n}\n\n",
            "#[tauri::command]\npub fn by_path(real: &Real) -> bool {\n    Machine::look(real)\n}\n\n",
            "#[tauri::command]\npub fn defaulted(quiet: &Quiet) -> bool {\n    quiet.twice()\n}\n\n",
            "#[tauri::command]\npub fn calm(quiet: &Quiet) -> bool {\n    quiet.look()\n}\n",
        );
        let own = calls::of(&[("crate", source)]);
        let waits = own.waiting(&WAITS, &[]);
        for loud in [
            "crate::by_impl",
            "crate::by_dyn",
            "crate::by_box",
            "crate::by_generic",
            "crate::by_where",
            "crate::by_field",
            "crate::by_alias",
            "crate::by_path",
            "crate::defaulted",
        ] {
            assert!(waits.contains(loud), "{loud} was not followed");
        }
        assert!(
            !waits.contains("crate::calm"),
            "another type's method was taken for a type's own"
        );
    }

    #[test]
    fn a_closure_kept_in_a_field_is_followed_to_where_it_is_called() {
        let source = concat!(
            "pub struct Hook {\n    then: Box<dyn Fn() + Send>,\n    calm: Box<dyn Fn() + Send>,\n}\n\n",
            "pub fn made() -> Hook {\n    Hook {\n        then: Box::new(|| {\n            fs::write(one, two);\n        }),\n        calm: Box::new(|| {}),\n    }\n}\n\n",
            "#[tauri::command]\npub fn fired(hook: &Hook) {\n    (hook.then)();\n}\n\n",
            "#[tauri::command]\npub fn calm(hook: &Hook) {\n    (hook.calm)();\n}\n\n",
            "pub struct Later {\n    then: Mutex<Option<Box<dyn FnOnce() + Send>>>,\n    all: Mutex<Vec<Box<dyn Fn() + Send>>>,\n    first: Box<dyn Fn() + Send>,\n}\n\n",
            "impl Later {\n    pub fn new(first: impl Fn() + Send + 'static) -> Self {\n        Self {\n            then: Mutex::new(None),\n            all: Mutex::new(Vec::new()),\n            first: Box::new(first),\n        }\n    }\n}\n\n",
            "pub fn kept() -> Later {\n    let later = Later::new(|| {\n        fs::read(three);\n    });\n    *later.then.lock().unwrap() = Some(Box::new(|| {\n        fs::read(four);\n    }));\n    later.all.lock().unwrap().push(Box::new(|| {\n        fs::read(five);\n    }));\n    later\n}\n\n",
            "#[tauri::command]\npub fn taken(later: &Later) {\n    if let Some(then) = later.then.lock().unwrap().take() {\n        then();\n    }\n}\n\n",
            "#[tauri::command]\npub fn each(later: &Later) {\n    for one in later.all.lock().unwrap().iter() {\n        one();\n    }\n}\n\n",
            "#[tauri::command]\npub fn first(later: &Later) {\n    (later.first)();\n}\n",
        );
        let own = calls::of(&[("crate", source)]);
        let waits = own.waiting(&WAITS, &[]);
        for loud in [
            "crate::fired",
            "crate::taken",
            "crate::each",
            "crate::first",
        ] {
            assert!(waits.contains(loud), "{loud} was not followed");
        }
        assert!(!waits.contains("crate::calm"));
    }

    #[test]
    fn a_function_handed_on_as_a_value_is_called() {
        let source = concat!(
            "fn loud(one: &u8) -> u8 {\n    fs::read(one);\n    1\n}\n\n",
            "pub struct Shelf;\n\nimpl Shelf {\n    fn read(one: &u8) -> u8 {\n        fs::read(one);\n        2\n    }\n}\n\n",
            "#[tauri::command]\npub fn each(items: Vec<u8>) {\n    items.iter().for_each(loud);\n}\n\n",
            "#[tauri::command]\npub fn mapped(item: Option<u8>) -> Option<u8> {\n    item.as_ref().map(Shelf::read)\n}\n\n",
            "#[tauri::command]\npub fn away() {\n    std::thread::spawn(loud);\n}\n\n",
            "#[tauri::command]\npub fn named(loud: u8) -> Option<u8> {\n    Some(loud)\n}\n",
        );
        let own = calls::of(&[("crate", source)]);
        let waits = own.waiting(&WAITS, &[]);
        assert!(waits.contains("crate::each") && waits.contains("crate::mapped"));
        assert!(!waits.contains("crate::away") && !waits.contains("crate::named"));
    }

    #[test]
    fn a_value_let_go_where_it_ends_runs_its_drop_there() {
        let source = concat!(
            "pub struct Gone;\n\nimpl Gone {\n    pub fn new() -> Self {\n        Self\n    }\n\n    pub fn finish(self) {}\n}\n\n",
            "impl Drop for Gone {\n    fn drop(&mut self) {\n        fs::remove_file(one);\n    }\n}\n\n",
            "pub struct Holds {\n    gone: Option<Gone>,\n}\n\n",
            "#[tauri::command]\npub fn scoped() {\n    let gone = Gone::new();\n}\n\n",
            "#[tauri::command]\npub fn unit() {\n    let _gone = Gone;\n}\n\n",
            "#[tauri::command]\npub fn ignored() {\n    let _ = Gone::new();\n}\n\n",
            "#[tauri::command]\npub fn replaced(kept: &Mutex<Option<Gone>>) {\n    *kept.lock().unwrap() = None;\n}\n\n",
            "#[tauri::command]\npub fn removed(map: &Mutex<HashMap<String, Holds>>) {\n    map.lock().unwrap().remove(\"a\");\n}\n\n",
            "#[tauri::command]\npub fn cleared(map: &Mutex<HashMap<String, Gone>>) {\n    map.lock().unwrap().clear();\n}\n\n",
            "#[tauri::command]\npub fn taken(holds: &mut Holds) {\n    if let Some(gone) = holds.gone.take() {\n        let _ = 1;\n    }\n}\n\n",
            "#[tauri::command]\npub fn consumed(gone: Gone) {}\n\n",
            "#[tauri::command]\npub fn finished() {\n    Gone::new().finish();\n}\n\n",
            "#[tauri::command]\npub fn handed_back() -> Gone {\n    let gone = Gone::new();\n    gone\n}\n\n",
            "#[tauri::command]\npub fn sent_away() {\n    let gone = Gone::new();\n    std::thread::spawn(move || drop(gone));\n}\n\n",
            "#[tauri::command]\npub fn looked(map: &HashMap<String, Gone>) {\n    let one = map.get(\"a\");\n}\n\n",
            "#[tauri::command]\npub fn lent(gone: &Gone) {}\n\n",
            "#[tauri::command]\npub fn stored(holds: &mut Vec<Gone>) {\n    let gone = Gone::new();\n    holds.push(gone);\n}\n",
        );
        let own = calls::of(&[("crate", source)]);
        let waits = own.waiting(&WAITS, &[]);
        for loud in [
            "crate::scoped",
            "crate::unit",
            "crate::ignored",
            "crate::replaced",
            "crate::removed",
            "crate::cleared",
            "crate::taken",
            "crate::consumed",
            "crate::finished",
        ] {
            assert!(
                waits.contains(loud),
                "{loud} was not followed into its drop"
            );
        }
        for quiet in [
            "crate::handed_back",
            "crate::sent_away",
            "crate::looked",
            "crate::lent",
            "crate::stored",
        ] {
            assert!(!waits.contains(quiet), "{quiet} lets nothing go");
        }
    }

    #[test]
    fn a_guard_given_up_is_not_held() {
        let source = concat!(
            "static SAID: Mutex<u8> = Mutex::new(0);\n\nstatic HEARD: Condvar = Condvar::new();\n\n",
            "#[tauri::command(async)]\npub fn waiting() {\n    let mut said = SAID.lock().unwrap();\n    while *said == 0 {\n        said = HEARD.wait(said).unwrap();\n    }\n}\n\n",
            "#[tauri::command(async)]\npub fn handed() -> u8 {\n    *HEARD.wait_while(SAID.lock().unwrap(), |one| *one == 0).unwrap()\n}\n\n",
            "#[tauri::command(async)]\npub fn branching(gone: bool) {\n    let said = SAID.lock().unwrap();\n    if gone {\n        drop(said);\n        fs::write(one, two);\n        return;\n    }\n    drop(said);\n}\n\n",
            "#[tauri::command]\npub fn quick() -> u8 {\n    *SAID.lock().unwrap()\n}\n",
        );
        let own = calls::of(&[("crate", source)]);
        assert!(!own.waiting(&WAITS, &[]).contains("crate::quick"));
    }

    #[test]
    fn what_the_window_s_thread_runs_is_followed_and_a_thread_s_is_not() {
        let source = concat!(
            "#[tauri::command]\npub fn away() {\n    std::thread::spawn(move || fs::write(one, two));\n}\n\n",
            "pub fn later(app: &AppHandle) {\n    let _ = app.run_on_main_thread(move || {\n        fs::write(one, two);\n    });\n}\n\n",
            "pub fn on_page(app: &AppHandle, then: impl FnOnce() + Send + 'static) {\n    let _ = app.run_on_main_thread(move || then());\n}\n\n",
            "pub fn handed(app: &AppHandle) {\n    on_page(app, move || {\n        let _ = Command::new(one).status();\n    });\n}\n\n",
            "pub fn pumped(view: &Webview) {\n    with_platform!(view, move |platform| {\n        Handler::wait_for_async_operation(one, two);\n    });\n}\n\n",
            "#[cfg(target_os = \"macos\")]\npub fn elsewhere(app: &AppHandle) {\n    let _ = app.run_on_main_thread(move || {\n        fs::write(one, two);\n    });\n}\n",
        );
        let own = calls::of(&[("crate", source)]);
        let waits = own.waiting(&WAITS, &[]);
        assert!(!waits.contains("crate::away"));
        let waiting: Vec<&String> = own
            .mains()
            .iter()
            .filter(|one| waits.contains(one))
            .collect();
        assert_eq!(
            waiting,
            [
                "crate::later::main#0",
                "crate::handed::passed#0",
                "crate::pumped::main#0"
            ]
        );
    }

    #[test]
    fn a_command_that_builds_a_webview_says_async() {
        let own = own();
        let builds = own.reaching(&BUILDS, &BUILT_OFF_THE_CALLBACK);
        assert!(builds.contains("crate::launch::open_window"));

        let late: Vec<&String> = own
            .commands()
            .iter()
            .filter(|path| builds.contains(*path))
            .collect();
        assert!(
            late.is_empty(),
            "{late:?} build a webview without saying async"
        );
    }

    #[test]
    fn building_a_webview_is_followed_to_the_command() {
        let source = concat!(
            "#[tauri::command]\npub fn opens() {\n    opened();\n}\n\n",
            "fn opened() {\n    let _ = WebviewWindowBuilder::new(app, one, two);\n}\n\n",
            "#[tauri::command]\npub fn child() {\n    let _ = WebviewBuilder::new(one, two);\n}\n\n",
            "#[tauri::command]\npub async fn waited() {\n    opened();\n}\n",
        );
        let own = calls::of(&[("crate", source)]);
        let builds = own.reaching(&BUILDS, &[]);
        assert!(own.commands().iter().all(|one| builds.contains(one)));
        assert_eq!(own.commands(), ["crate::opens", "crate::child"]);
    }

    #[test]
    fn a_command_waits_when_what_it_calls_waits() {
        let source = concat!(
            "#[tauri::command]\npub fn here() -> bool {\n    asked()\n}\n\n",
            "fn asked() -> bool {\n    deeper()\n}\n\n",
            "fn deeper() -> bool {\n    fs::metadata(one).is_ok()\n}\n\n",
            "#[tauri::command(async)]\npub fn elsewhere() {\n    fs::read(two);\n}\n\n",
            "#[tauri::command]\npub async fn waited() {\n    fs::read(three);\n}\n",
        );
        let own = calls::of(&[("crate", source)]);
        assert_eq!(own.commands(), ["crate::here"]);

        let waits = own.reaching(&WAITS, &[]);
        assert!(waits.contains("crate::here"), "the chain was not followed");
        assert!(waits.contains("crate::deeper"));
        assert!(!calls::called("one.read(two)").contains("read"));
        assert!(calls::called("read(two)").contains("read"));
        assert!(calls::called("held::<u8>(one)").contains("held"));
        assert!(calls::called("DispatchQueue::main()").contains("DispatchQueue::main"));
        assert!(calls::called("crate::launch::main()").contains("crate::launch::main"));
    }

    #[test]
    fn a_name_another_module_shares_is_not_what_is_called() {
        let quiet = concat!(
            "pub fn take() -> u8 {\n    1\n}\n\n",
            "pub fn prefs() -> u8 {\n    crate::prefs::get()\n}\n\n",
            "pub struct Shelf;\n\n",
            "impl Shelf {\n    pub fn held() -> u8 {\n        Self::counted()\n    }\n\n",
            "    fn counted() -> u8 {\n        2\n    }\n}\n",
        );
        let loud = concat!(
            "use std::fs;\n\n",
            "pub fn take() -> Vec<u8> {\n    fs::read(one).unwrap()\n}\n\n",
            "pub fn counted() -> u8 {\n    3\n}\n\n",
            "pub struct Shelf;\n\n",
            "impl Shelf {\n    pub fn held() -> Vec<u8> {\n        Self::read()\n    }\n\n",
            "    fn read() -> Vec<u8> {\n        File::open(two)\n    }\n}\n",
        );
        let prefs = "pub fn get() -> u8 {\n    4\n}\n";
        let root = concat!(
            "use crate::quiet::take;\nuse quiet::Shelf;\n\n",
            "fn held() -> u8 {\n    take() + Shelf::held()\n}\n\n",
            "#[tauri::command]\npub fn kept() -> u8 {\n    take() + Shelf::held() + held() + quiet::prefs()\n}\n\n",
            "#[tauri::command]\npub fn taken() -> Vec<u8> {\n    loud::take()\n}\n\n",
            "#[tauri::command]\npub fn shelved() -> Vec<u8> {\n    crate::loud::Shelf::held()\n}\n\n",
            "#[tauri::command]\npub fn counted() -> u8 {\n    use crate::loud::*;\n    counted_twice()\n}\n\n",
            "fn counted_twice() -> u8 {\n    loud::counted() * 2\n}\n",
        );
        let own = calls::of(&[
            ("crate::quiet", quiet),
            ("crate::loud", loud),
            ("crate::prefs", prefs),
            ("crate", root),
        ]);
        let waits = own.reaching(&WAITS, &[]);

        assert_eq!(
            own.commands(),
            [
                "crate::kept",
                "crate::taken",
                "crate::shelved",
                "crate::counted"
            ]
        );
        assert!(waits.contains("crate::taken") && waits.contains("crate::shelved"));
        assert!(waits.contains("crate::loud::Shelf::held"));
        for quiet in [
            "crate::kept",
            "crate::held",
            "crate::counted",
            "crate::quiet::take",
            "crate::quiet::prefs",
            "crate::quiet::Shelf::held",
        ] {
            assert!(
                !waits.contains(quiet),
                "{quiet} was taken for one that waits"
            );
        }
    }
}
