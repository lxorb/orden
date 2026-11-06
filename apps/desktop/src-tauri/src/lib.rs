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
            agents::agents_log_days,
            agents::agents_log_clear,
            agents::agents_adopt,
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
            terminal::picture::remote_image,
            updates::check_update,
            system_update::system_update,
            package_manager::install_manager,
            app_place::app_stuck,
            app_place::move_to_applications,
            shortcuts::shortcuts_offered,
            shortcuts::open_shortcuts,
            shortcuts::remember_inbox,
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
        .manage(space_watch::Watching::default());

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
    use std::collections::{HashMap, HashSet};
    use std::fs;

    const EXCEPTED: [&str; 5] = [
        "write_log",
        "new_menu_registered",
        "set_new_menu",
        "kept_write",
        "kept_forget",
    ];

    const WAITS: [&str; 9] = [
        "fs::",
        "File::",
        "OpenOptions",
        "Command::new",
        "get_password",
        "set_password",
        "delete_credential",
        "canonicalize",
        "tauri_plugin_opener::",
    ];

    const BUILDS: [&str; 2] = ["WebviewWindowBuilder::new(", "WebviewBuilder::new("];

    const BUILT_OFF_THE_CALLBACK: [&str; 1] = ["bring_up"];

    struct Function {
        name: String,
        body: String,
    }

    fn functions(source: &str) -> Vec<Function> {
        let mut found = Vec::new();
        let lines: Vec<&str> = source.lines().collect();

        for (at, line) in lines.iter().enumerate() {
            let Some((indent, name)) = signature(line) else {
                continue;
            };

            let closes = format!("{}}}", " ".repeat(indent));
            let body = lines[at + 1..]
                .iter()
                .take_while(|held| **held != closes)
                .fold(String::new(), |mut body, held| {
                    body.push_str(held);
                    body.push('\n');
                    body
                });

            found.push(Function { name, body });
        }

        found
    }

    fn signature(line: &str) -> Option<(usize, String)> {
        let indent = line.len() - line.trim_start().len();
        let mut rest = line.trim_start();
        for said in ["pub(crate) ", "pub ", "async "] {
            rest = rest.strip_prefix(said).unwrap_or(rest);
        }

        let name = rest
            .strip_prefix("fn ")?
            .split(['(', '<'])
            .next()?
            .to_owned();
        Some((indent, name))
    }

    fn calls(body: &str) -> HashSet<String> {
        let mut found = HashSet::new();
        let letters: Vec<char> = body.chars().collect();
        let mut at = 0;

        while at < letters.len() {
            if !letters[at].is_alphanumeric() && letters[at] != '_' {
                at += 1;
                continue;
            }

            let from = at;
            while at < letters.len() && (letters[at].is_alphanumeric() || letters[at] == '_') {
                at += 1;
            }

            let after_a_dot = from > 0 && letters[from - 1] == '.';
            if !after_a_dot && !after_a_type(&letters, from) && letters.get(at) == Some(&'(') {
                found.insert(letters[from..at].iter().collect());
            }
        }

        found
    }

    fn after_a_type(letters: &[char], from: usize) -> bool {
        if from < 2 || letters[from - 1] != ':' || letters[from - 2] != ':' {
            return false;
        }

        let mut start = from - 2;
        while start > 0 && (letters[start - 1].is_alphanumeric() || letters[start - 1] == '_') {
            start -= 1;
        }
        letters[start].is_uppercase()
    }

    fn waiting(functions: &[Function]) -> HashSet<String> {
        reaching(functions, &WAITS, &[])
    }

    fn reaching(functions: &[Function], words: &[&str], stops: &[&str]) -> HashSet<String> {
        let mut waits: HashSet<String> = HashSet::new();
        let mut made_by: HashMap<String, HashSet<String>> = HashMap::new();

        for function in functions {
            if stops.contains(&function.name.as_str()) {
                continue;
            }
            if words.iter().any(|said| function.body.contains(said)) {
                waits.insert(function.name.clone());
            }
            made_by
                .entry(function.name.clone())
                .or_default()
                .extend(calls(&function.body));
        }

        loop {
            let found: Vec<String> = made_by
                .iter()
                .filter(|(name, called)| {
                    !waits.contains(*name) && called.iter().any(|one| waits.contains(one))
                })
                .map(|(name, _)| name.clone())
                .collect();
            if found.is_empty() {
                return waits;
            }
            waits.extend(found);
        }
    }

    fn on_the_calling_thread(source: &str) -> Vec<String> {
        let mut found = Vec::new();
        let mut lines = source.lines();

        while let Some(line) = lines.next() {
            if line.trim() != "#[tauri::command]" {
                continue;
            }
            let Some(line) = lines.find(|one| one.contains("fn ")) else {
                break;
            };
            if line.contains("async fn ") {
                continue;
            }
            if let Some((_indent, name)) = signature(line) {
                found.push(name);
            }
        }

        found
    }

    #[test]
    fn a_command_that_waits_says_async() {
        let sources = own_sources();
        let functions: Vec<Function> = sources.iter().flat_map(|one| functions(one)).collect();
        let waits = waiting(&functions);

        for name in sources.iter().flat_map(|one| on_the_calling_thread(one)) {
            assert!(
                !waits.contains(&name) || EXCEPTED.contains(&name.as_str()),
                "{name} waits without saying async",
            );
        }
    }

    #[test]
    fn a_command_that_builds_a_webview_says_async() {
        let sources = own_sources();
        let functions: Vec<Function> = sources.iter().flat_map(|one| functions(one)).collect();
        let builds = reaching(&functions, &BUILDS, &BUILT_OFF_THE_CALLBACK);
        assert!(builds.contains("built_window") && builds.contains("open_window"));

        for name in sources.iter().flat_map(|one| on_the_calling_thread(one)) {
            assert!(
                !builds.contains(&name),
                "{name} builds a webview without saying async"
            );
        }
    }

    #[test]
    fn building_a_webview_is_followed_to_the_command() {
        let source = concat!(
            "#[tauri::command]\npub fn opens() {\n    opened();\n}\n\n",
            "fn opened() {\n    let _ = WebviewWindowBuilder::new(app, one, two);\n}\n\n",
            "#[tauri::command]\npub fn child() {\n    let _ = WebviewBuilder::new(one, two);\n}\n\n",
            "#[tauri::command]\npub async fn waited() {\n    opened();\n}\n",
        );
        let builds = reaching(&functions(source), &BUILDS, &[]);
        let sync = on_the_calling_thread(source);
        assert!(sync.iter().all(|one| builds.contains(one)));
        assert_eq!(sync, vec!["opens".to_owned(), "child".to_owned()]);
    }

    fn own_sources() -> Vec<String> {
        let src = crate::app_dir().join("src");
        let mut sources = Vec::new();

        for file in fs::read_dir(src).expect("the crate's own source").flatten() {
            let path = file.path();
            if path.extension().is_some_and(|one| one == "rs") {
                sources.push(fs::read_to_string(&path).expect("one module"));
            }
        }
        assert!(
            sources.len() > 20,
            "only {} modules were read",
            sources.len()
        );
        sources
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

        assert_eq!(on_the_calling_thread(source), vec!["here".to_owned()]);

        let waits = waiting(&functions(source));
        assert!(waits.contains("here"), "the chain was not followed");
        assert!(waits.contains("deeper"));
        assert!(!calls("one.read(two)").contains("read"));
        assert!(calls("read(two)").contains("read"));
        assert!(!calls("DispatchQueue::main()").contains("main"));
        assert!(calls("crate::launch::main()").contains("main"));
    }
}
