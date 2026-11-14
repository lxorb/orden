pub const NOT_ANSWERING: &str = "that page is not answering";

pub fn said(app: &tauri::AppHandle) {
    use std::sync::Mutex;
    use std::time::{Duration, Instant};

    static LAST: Mutex<Option<Instant>> = Mutex::new(None);
    let Ok(mut last) = LAST.lock() else { return };
    if last.is_some_and(|at| at.elapsed() < Duration::from_secs(60)) {
        return;
    }
    *last = Some(Instant::now());
    crate::logs::say(
        app,
        "warn",
        "stall: a web page's browser is not answering; the page waits rather than the window",
    );
}

pub fn answers(_view: &tauri::Webview) -> bool {
    true
}

pub fn put_away(_view: &tauri::Webview) {}

pub fn close_when_answering(app: &tauri::AppHandle, label: String) {
    use tauri::Manager as _;
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_secs(1));
        let (told, heard) = std::sync::mpsc::channel();
        let asking = app.clone();
        let named = label.clone();
        let posted = app.run_on_main_thread(move || {
            use tauri::Manager as _;
            let done = match asking.get_webview(&named) {
                None => true,
                Some(view) if answers(&view) => {
                    let _ = view.close();
                    true
                }
                Some(_) => false,
            };
            let _ = told.send(done);
        });
        if posted.is_err() || heard.recv().unwrap_or(true) {
            return;
        }
    });
}
