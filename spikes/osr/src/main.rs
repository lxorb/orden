#[cfg(windows)]
mod comp;
#[cfg(windows)]
mod handlers;
#[cfg(windows)]
mod log;
#[cfg(windows)]
mod win;

#[cfg(not(windows))]
fn main() {
    eprintln!("the OSR spike runs on Windows only");
}

#[cfg(windows)]
fn main() {
    use cef::*;
    let _ = api_hash(sys::CEF_API_VERSION_LAST, 0);
    let args = cef::args::Args::new();
    let mut app = handlers::SpikeApp::new();
    let code = execute_process(Some(args.as_main_args()), Some(&mut app), std::ptr::null_mut());
    if code >= 0 {
        std::process::exit(code);
    }
    win::dpi_aware();
    let cfg = win::Config::parse();
    log::open(&cfg.log);
    let cache = std::env::temp_dir().join(format!("osr-spike-{}", std::process::id()));
    let cache = cache.to_string_lossy().to_string();
    let settings = Settings {
        no_sandbox: 1,
        windowless_rendering_enabled: i32::from(cfg.composed),
        root_cache_path: CefString::from(cache.as_str()),
        cache_path: CefString::from(cache.as_str()),
        log_file: CefString::from(format!("{}.cef.txt", cfg.log).as_str()),
        log_severity: LogSeverity::WARNING,
        ..Default::default()
    };
    win::CFG.set(cfg).ok();
    if initialize(Some(args.as_main_args()), Some(&settings), Some(&mut app), std::ptr::null_mut()) != 1 {
        log::line(r#"{"ev":"error","what":"cef initialize failed"}"#.into());
        log::flush();
        std::process::exit(3);
    }
    win::start();
    run_message_loop();
    log::line(format!(r#"{{"ev":"end","t":{}}}"#, log::qpc()));
    log::flush();
    shutdown();
}
