#[cfg(desktop)]
mod agents;
#[cfg(desktop)]
mod ahead;
mod ai_accounts;
#[cfg(desktop)]
mod ai_agent;
#[cfg(desktop)]
mod ai_cli;
mod ai_threads;
#[cfg(desktop)]
mod app_place;
#[cfg(desktop)]
mod appearance;
#[cfg(desktop)]
mod apple_notes;
#[cfg_attr(
    not(target_os = "macos"),
    allow(
        dead_code,
        reason = "only the Mac's own store reader asks for any of this; it is built elsewhere to be checked, not to be called"
    )
)]
mod apple_text;
#[cfg(desktop)]
mod apps_host;
mod assets;
#[cfg(desktop)]
mod browser_data;
#[cfg(desktop)]
mod browser_profiles;
#[cfg(desktop)]
mod browser_themes;
#[cfg(desktop)]
mod bundle_name;
#[cfg(test)]
mod calls;
mod carry;
#[cfg(desktop)]
mod chatgpt;
#[cfg(desktop)]
mod chromium_profiles;
#[cfg(all(target_os = "linux", feature = "cef"))]
mod chromium_pump;
mod clock;
mod code_blocks;
#[cfg(desktop)]
mod default_browser;
#[cfg(desktop)]
mod dictation;
#[cfg(desktop)]
mod document_window;
#[cfg(desktop)]
mod downloads;
#[cfg(desktop)]
mod dropped_paths;
#[cfg(desktop)]
mod endpoint;
#[cfg(desktop)]
mod engine;
#[cfg(desktop)]
mod explorer;
#[cfg(desktop)]
mod extensions;
#[cfg(desktop)]
mod firefox_profiles;
#[cfg(desktop)]
mod fonts;
#[cfg(desktop)]
mod foreground;
mod front_matter;
#[cfg(desktop)]
mod full_screen;
mod fuzzy;
#[cfg(desktop)]
mod gpu;
#[cfg(desktop)]
mod ground;
#[cfg(desktop)]
mod handed_pdfs;
#[cfg(desktop)]
mod handover;
mod highlights;
mod history;
#[cfg(desktop)]
mod hotkeys;
#[cfg(desktop)]
mod kept;
#[cfg(desktop)]
mod keyboard;
mod lane;
#[cfg(desktop)]
mod launch;
#[cfg(desktop)]
mod lifecycle;
#[cfg(target_os = "macos")]
mod lights;
#[cfg(desktop)]
mod link_preview;
mod links;
#[cfg(target_os = "linux")]
mod linux;
mod logs;
#[cfg(desktop)]
mod mail_socket;
mod matcher;
#[cfg(desktop)]
pub mod mcp;
#[cfg(desktop)]
mod menu_bar;
mod notes;
#[cfg(desktop)]
mod notices;
#[cfg(desktop)]
mod obsidian_vaults;
#[cfg(desktop)]
mod outside;
#[cfg(any(desktop, target_os = "ios"))]
mod owner;
#[cfg(desktop)]
mod package_manager;
#[cfg(target_os = "linux")]
mod packagekit;
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
mod pandoc;
mod papers;
mod paths;
#[cfg(desktop)]
mod pdf;
#[cfg(desktop)]
mod pinch;
#[cfg(desktop)]
mod placement;
#[cfg(desktop)]
mod presence;
#[cfg(desktop)]
mod presenter;
#[cfg(desktop)]
mod printed;
mod query;
#[cfg(desktop)]
mod quick_add;
mod regex;
#[cfg(desktop)]
mod reminders;
#[cfg(all(desktop, not(feature = "cef")))]
mod retired_engine;
#[cfg(desktop)]
mod safari;
mod search;
#[cfg(any(desktop, target_os = "ios"))]
mod secrets;
#[cfg(desktop)]
mod secure_dns;
#[cfg(desktop)]
mod shell_menu;
#[cfg(desktop)]
mod shortcuts;
#[cfg(target_os = "macos")]
mod siri;
mod space_watch;
mod spaces;
#[cfg(desktop)]
mod spelling;
#[cfg(desktop)]
mod stall;
mod sync_store;
#[cfg(desktop)]
mod system_update;
mod tags;
mod tasks;
#[cfg(desktop)]
mod terminal;
mod themes;
#[cfg(desktop)]
mod top_edge;
#[cfg(desktop)]
mod touchpad;
mod trace;
mod trash;
mod tree;
#[cfg(desktop)]
mod updates;
mod uris;
#[cfg(desktop)]
mod usage;
#[cfg(desktop)]
mod web_answers;
#[cfg(desktop)]
mod web_certificate;
#[cfg(desktop)]
mod web_clear;
#[cfg(any(windows, target_os = "macos", feature = "cef"))]
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
mod web_pause;
#[cfg(desktop)]
mod web_reload;
#[cfg(desktop)]
mod web_state;
#[cfg(desktop)]
mod web_stores;
#[cfg(desktop)]
mod web_swipe;
#[cfg(desktop)]
mod web_tabs;
#[cfg(desktop)]
mod web_tint;
#[cfg(all(windows, not(feature = "cef")))]
mod web_visual;
#[cfg(all(windows, not(feature = "cef")))]
mod web_wheel;
#[cfg(desktop)]
mod web_worlds;
#[cfg(desktop)]
mod window_drag;
#[cfg(desktop)]
mod zen_profiles;

use paths::Picked;
use tauri::Manager;

macro_rules! commands {
    ($($desktop:tt)*) => {
        tauri::generate_handler![
            notes::read_note,
            notes::write_note,
            notes::write_bytes,
            notes::delete_note,
            notes::rename_note,
            notes::copy_path,
            notes::create_folder,
            notes::delete_folder,
            notes::remove_empty_folder,
            notes::file_stamp,
            notes::file_there,
            notes::note_evicted,
            notes::path_taken,
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
            themes::read_settings_file,
            themes::scratchpad_path,
            history::snapshot_note,
            history::list_snapshots,
            history::read_snapshot,
            history::purge_snapshots,
            history::rehome_snapshots,
            logs::log_dir,
            logs::write_log,
            logs::read_log,
            spaces::spaces_root,
            spaces::list_spaces,
            spaces::create_space,
            spaces::rename_space,
            spaces::delete_space,
            trash::trash_item,
            trash::trash_words,
            trash::list_trash,
            trash::restore_trash,
            trash::purge_trash,
            trash::purge_trash_older_than,
            uris::take_startup_uris,
            trace::trace_startup,
            sync_store::sync_store_open,
            sync_store::sync_store_close,
            sync_store::sync_store_read,
            sync_store::sync_store_write,
            sync_store::sync_store_clean_exit,
            sync_store::sync_store_forget,
            sync_store::sync_store_device,
            sync_store::chats::chat_store_read,
            sync_store::chats::chat_store_write,
            sync_store::chats::chat_store_forget,
            space_watch::space_watch,
            space_watch::space_unwatch,
            space_watch::space_scan,
            space_watch::working_watch,
            space_watch::working_unwatch,
            space_watch::working_scan,
            space_watch::file_identity,
            ai_accounts::ai_accounts_read,
            ai_accounts::ai_accounts_write,
            ai_threads::ai_threads_list,
            ai_threads::ai_thread_read,
            ai_threads::ai_thread_write,
            ai_threads::ai_thread_delete,
            ai_threads::ai_threads_forget,
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
            presenter::presenter_open,
            agents::shell::tray_keep,
            reminders::reminders_set,
            reminders::reminders_taken,
            reminders::reminders_quietly,
            notices::notice_show,
            notices::notice_clear,
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
            chatgpt::chatgpt_sign_in,
            chatgpt::chatgpt_account,
            chatgpt::chatgpt_token,
            chatgpt::chatgpt_sign_out,
            link_preview::link_preview,
            appearance::set_frame,
            appearance::set_translucency,
            ground::remember_material,
            ground::remember_ground,
            apple_notes::read_apple_notes,
            apple_notes::open_full_disk_access,
            obsidian_vaults::obsidian_vaults,
            obsidian_vaults::obsidian_vault_files,
            obsidian_vaults::read_obsidian_file,
            full_screen::window_fullscreen,
            window_drag::window_move_resize,
            gpu::gpu_seen,
            gpu::gpu_chosen,
            gpu::gpu_choose,
            kept::kept_write,
            kept::kept_forget,
            secure_dns::dns_chosen,
            secure_dns::dns_choose,
            gpu::gpu_line,
            page_scale::page_scale_seen,
            page_scale::interface_zoom_chosen,
            page_scale::interface_zoom_choose,
            page_scheme::page_scheme_seen,
            spelling::spell_languages,
            fonts::font_families,
            window_drag::window_frame,
            full_screen::window_is_fullscreen,
            zen_profiles::zen_profiles,
            zen_profiles::read_zen_file,
            zen_profiles::read_zen_places,
            browser_profiles::browser_profiles,
            browser_profiles::read_browser_file,
            firefox_profiles::read_firefox_places,
            chromium_profiles::read_arc_sidebar,
            browser_data::read_browser_history,
            browser_data::read_browser_icons,
            safari::read_safari,
            browser_themes::browser_themes,
            page_style::wear_page_styles,
            launch::take_startup_pages,
            launch::take_startup_pdfs,
            dropped_paths::dropped_paths,
            handed_pdfs::same_pdf,
            launch::new_window,
            launch::show_window,
            ahead::launch_ahead,
            ahead::remember_launch,
            outside::outside_spaces,
            outside::take_in_outside,
            outside::settle_outside,
            default_browser::default_browser,
            default_browser::make_default_browser,
            lifecycle::keep_running,
            lifecycle::quit_confirmed,
            lifecycle::quit_others,
            lifecycle::quit_show,
            lifecycle::update_install_failed,
            lifecycle::update_may_install,
            lifecycle::update_settled,
            document_window::show_document,
            menu_bar::hand_to_keyboard,
            placement::take_keyboard,
            placement::raise_window,
            pandoc::has_pandoc,
            pandoc::run_pandoc,
            pandoc::import_document,
            pdf::pdf_supported,
            pdf::print_pdf,
            pdf::print_page,
            owner::owner_can,
            owner::owner_check,
            secrets::secret_forget,
            secrets::secret_read,
            secrets::secret_write,
            shell_menu::new_menu_registered,
            shell_menu::set_new_menu,
            mail_socket::mail_socket_open,
            mail_socket::mail_socket_write,
            mail_socket::mail_socket_tls,
            mail_socket::mail_socket_close,
            terminal::terminal_shells,
            terminal::pty_spawn,
            terminal::pty_write,
            terminal::pty_resize,
            terminal::pty_seen,
            terminal::pty_busy,
            apps_host::apps_installed,
            apps_host::apps_start,
            apps_host::apps_watch,
            apps_host::apps_stop,
            apps_host::apps_signal,
            apps_host::apps_view,
            terminal::pty_folder,
            terminal::pty_usage,
            terminal::pty_program,
            terminal::pty_kill,
            terminal::history::terminal_history_read,
            terminal::history::terminal_history_write,
            terminal::history::terminal_history_forget,
            terminal::remote::remote_hosts,
            terminal::remote::remote_keep,
            terminal::remote::remote_config_open,
            terminal::picture::local_image,
            terminal::picture::remote_image,
            updates::check_update,
            system_update::system_update,
            package_manager::install_manager,
            app_place::app_stuck,
            app_place::move_to_applications,
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
            dictation::dictation_local,
            dictation::dictation_local_fetch,
            dictation::dictation_local_remove,
            dictation::dictation_local_open,
            dictation::dictation_local_hear,
            explorer::listing::explorer_list,
            explorer::listing::explorer_places,
            explorer::listing::explorer_facts,
            explorer::listing::explorer_peek,
            explorer::listing::explorer_open,
            explorer::listing::explorer_reveal,
            explorer::changes::explorer_make,
            explorer::changes::explorer_rename,
            explorer::changes::explorer_write,
            explorer::changes::explorer_trash,
            explorer::changes::explorer_untrash,
            explorer::changes::explorer_delete,
            explorer::jobs::explorer_cancel,
            explorer::jobs::explorer_clashes,
            explorer::jobs::explorer_transfer,
            explorer::jobs::explorer_put,
            explorer::jobs::explorer_count,
            explorer::jobs::explorer_search,
            explorer::watch::explorer_watch,
            explorer::watch::explorer_unwatch,
            downloads::web_downloads,
            downloads::web_download_open,
            downloads::web_download_show,
            downloads::web_download_cancel,
            web_state::web_merge,
            web_state::web_copy,
            presence::input_idle,
            presence::device_name,
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

#[cfg(all(target_os = "linux", not(feature = "cef")))]
compile_error!(
    "Linux builds from apps/desktop/src-tauri/linux/Cargo.toml: run scripts/linux-cef.sh first"
);

#[cfg(not(feature = "cef"))]
pub type Engine = tauri::Wry;

#[cfg(feature = "cef")]
pub type Engine = tauri::DynRuntime;

pub fn run() {
    #[cfg(target_os = "linux")]
    linux::prepare();
    #[cfg(all(windows, not(feature = "cef")))]
    web_visual::arm_visuals();
    #[cfg(all(target_os = "macos", not(feature = "cef")))]
    page_carry::mac::arm();
    #[cfg(target_os = "macos")]
    dropped_paths::arm();
    #[cfg(not(feature = "cef"))]
    run_on(tauri::Builder::default());
    #[cfg(feature = "cef")]
    run_on(tauri::Builder::default().runtime(engine::cef_runtime()));
}

#[cfg(feature = "cef")]
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
    bundle_name::carry_over();

    trace::begin();

    #[cfg(desktop)]
    if foreground::hold() {
        eprintln!(
            "nib: this probe started able to take the foreground; it is locked (see src-tauri/src/foreground.rs)"
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
        .manage(launch::Pending::default());
    #[cfg(desktop)]
    let builder = lifecycle::managed(builder);
    #[cfg(desktop)]
    trace::mark("plugins: updater, dialog, process, one instance");

    let builder = links_out_and_in(builder);
    trace::mark("plugins: opener, os, deep link");

    let builder = builder
        .manage(sync_store::Stores::default())
        .manage(space_watch::Watching::default())
        .manage(space_watch::Working::default());

    #[cfg(desktop)]
    let builder = builder.manage(endpoint::Waiting::default());

    #[cfg(desktop)]
    let builder = placement::managed(web_tabs::managed(builder));

    #[cfg(desktop)]
    let builder = terminal::managed(builder);

    #[cfg(desktop)]
    let builder = builder.manage(apps_host::Hosted::default());

    #[cfg(desktop)]
    let builder = builder.manage(mail_socket::MailSockets::default());

    #[cfg(desktop)]
    let builder = builder
        .manage(explorer::reach::Explored::default())
        .manage(explorer::watch::Watching::default());

    #[cfg(desktop)]
    let builder = builder.manage(std::sync::Arc::new(dictation::Loaded::default()));

    #[cfg(desktop)]
    let builder = builder
        .manage(ai_cli::Asks::default())
        .manage(chatgpt::ChatGpt::default());

    #[cfg(desktop)]
    let builder = builder.invoke_handler(named(desktop_commands!()));

    #[cfg(target_os = "ios")]
    let builder = builder.invoke_handler(commands![
        owner::owner_can,
        owner::owner_check,
        secrets::secret_forget,
        secrets::secret_read,
        secrets::secret_write,
    ]);
    #[cfg(target_os = "android")]
    let builder = builder.invoke_handler(commands![]);
    trace::mark("commands registered");

    #[cfg(desktop)]
    let ui = engine::take_ui_window(&mut context);

    #[cfg(feature = "cef")]
    let builder = builder.on_web_content_process_terminate(|view, ended| {
        use tauri::webview::WebContentProcessTerminationReason as Reason;
        if !matches!(ended.reason, Reason::Normal) {
            web_page::ended(view);
        }
    });
    #[cfg(all(target_os = "macos", not(feature = "cef")))]
    let builder = builder.on_web_content_process_terminate(web_page::ended);

    #[cfg(desktop)]
    let builder = builder.setup(move |app| ready(app, ui.as_ref()));
    #[cfg(not(desktop))]
    let builder = builder.setup(|app| ready(app, None));

    builder
        .build(context)
        .unwrap_or_else(|error| {
            eprintln!("Nib could not start: {error}");
            std::process::exit(1);
        })
        .run(on_event);
}

#[cfg(desktop)]
fn first_window(handle: &tauri::AppHandle) {
    pinch::first_window(handle);
    dropped_paths::first_window(handle);
}

fn links_out_and_in(builder: tauri::Builder<Engine>) -> tauri::Builder<Engine> {
    #[cfg(desktop)]
    let builder = builder.on_page_load(|webview, payload| {
        if payload.event() == tauri::webview::PageLoadEvent::Started {
            if let Some(waiting) = webview.try_state::<endpoint::Waiting>() {
                waiting.forget(webview.label());
            }
            if let Some(sockets) = webview.try_state::<mail_socket::MailSockets>() {
                sockets.end_where(webview.label());
            }
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
        let _doing = stall::doing(invoke.message.command());
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
    touchpad::start(handle);
}

#[cfg(feature = "cef")]
fn engine_started(handle: &tauri::AppHandle<Engine>) {
    #[cfg(target_os = "linux")]
    chromium_pump::start(handle);
    #[cfg(target_os = "linux")]
    page_scale::start(handle);
    secure_dns::start(handle);
    extensions::tabs::start(handle);
}

fn ready(
    app: &mut tauri::App,
    ui: Option<&tauri::utils::config::WindowConfig>,
) -> Result<(), Box<dyn std::error::Error>> {
    trace::mark("app built, window created");

    let handle = app.handle();

    #[cfg(desktop)]
    paths::decide_spaces(handle);

    #[cfg(desktop)]
    let web_first = ahead::start(handle);

    #[cfg(target_os = "macos")]
    menu_bar::leave_out_system_rows();

    if let Ok(root) = paths::spaces_dir(handle) {
        let _ = handle.asset_protocol_scope().allow_directory(&root, true);
    }
    paths::hear_picks(handle);
    trace::mark("asset scope");

    uris::watch(handle);
    #[cfg(desktop)]
    reminders::start(handle);
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
        trace::mark(if web_handed::for_a_link(&args) {
            "launch arguments, a link's"
        } else {
            "launch arguments"
        });
    }
    #[cfg(not(desktop))]
    trace::mark("launch arguments");

    #[cfg(desktop)]
    hearing(handle);
    #[cfg(feature = "cef")]
    engine_started(handle);

    #[cfg(desktop)]
    if let Some(config) = ui {
        let config = placement::restored(handle, config);
        trace::mark("window placement");
        let building = engine::ui_window(app, &config)?;
        let see_through = ground::see_through(handle);
        if let Some(at) = placement::away() {
            let window = placement::built_away(building, at)?;
            if see_through {
                appearance::wear_from_the_start(&window.as_ref().window());
            }
            stall::watch_page(handle, window.as_ref(), "the window's");
        } else if uris::launched_quietly(handle) {
            let window = building.visible(false).build()?;
            top_edge::mind(&window.as_ref().window());
            stall::watch_page(handle, window.as_ref(), "the window's");
        } else {
            let colour = ground::remembered(handle);
            let at_once = colour.is_some() && !cfg!(target_os = "macos");
            let building = match colour {
                Some(colour) => building.background_color(colour),
                None => building,
            };
            let window = placement::settled(building.visible(at_once))?;
            top_edge::mind(&window.as_ref().window());
            if see_through {
                appearance::wear_from_the_start(&window.as_ref().window());
            }
            stall::watch_page(handle, window.as_ref(), "the window's");
            if !at_once {
                #[cfg(target_os = "macos")]
                lights::hold(&window);
                window.show()?;
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
    #[cfg(all(desktop, not(feature = "cef")))]
    retired_engine::clear_leftovers(handle);
    trace::write(handle);

    #[cfg(desktop)]
    kept_listed(handle);

    Ok(())
}

#[cfg(desktop)]
fn kept_listed(handle: &tauri::AppHandle<Engine>) {
    default_browser::keep_registered(handle);
    ai_cli::keep_enrolled(handle);
}

#[cfg(desktop)]
fn watched(handle: &tauri::AppHandle) {
    logs::say(
        handle,
        "info",
        &format!(
            "started nib {} (pid {})",
            handle.package_info().version,
            std::process::id()
        ),
    );
    handover::said(handle);
    stall::start(handle);
}

#[cfg(test)]
pub(crate) fn app_dir() -> std::path::PathBuf {
    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).to_path_buf()
}

#[cfg(test)]
mod tests {
    use crate::calls;

    const EXCEPTED: [&str; 5] = [
        "crate::logs::write_log",
        "crate::shell_menu::new_menu_registered",
        "crate::shell_menu::set_new_menu",
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

    const SMALL_ON_THE_WINDOW_S_THREAD: [&str; 5] = [
        "crate::placement::keep",
        "crate::placement::read",
        "crate::extensions::webview2::reconcile",
        "crate::engine::web_store",
        "crate::agents::quiet::destination",
    ];

    const OPENS_ON_THE_WINDOW_S_THREAD: [&str; 2] = [
        "crate::default_browser::platform::make_default::main#0",
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
        assert!(
            builds.contains("crate::presenter::built_window")
                && builds.contains("crate::launch::open_window")
        );

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
