use std::time::Duration;

use tauri::AppHandle;

const PAUSE: &str = "document.querySelectorAll('audio, video').forEach(function (one) { if (!one.paused) { one.pause(); one.setAttribute('data-nib-paused', '') } })";

const PLAY: &str = "document.querySelectorAll('[data-nib-paused]').forEach(function (one) { one.removeAttribute('data-nib-paused'); one.play().catch(function () {}) })";

type Said = tauri::async_runtime::Sender<bool>;

const PATIENCE: Duration = Duration::from_secs(3);

#[tauri::command]
pub async fn web_pause(app: AppHandle, tab: String, paused: bool) -> Result<bool, String> {
    let view = crate::web_tabs::found(&app, &tab)?;
    if paused {
        crate::web_tabs::on_the_page(&app, view.label(), |view| {
            let _ = view.hide();
        })
        .map_err(|error| format!("that page could not be hidden: {error}"))?;
    }
    let (said, mut heard) = tauri::async_runtime::channel::<bool>(1);
    engine::lull(&view, paused, said)?;
    Ok(answered(&mut heard, PATIENCE).await)
}

async fn answered(heard: &mut tauri::async_runtime::Receiver<bool>, patience: Duration) -> bool {
    tokio::time::timeout(patience, heard.recv())
        .await
        .ok()
        .flatten()
        .unwrap_or(false)
}

#[cfg(all(windows, not(feature = "cef")))]
mod engine {
    use tauri::Webview;
    use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2_3;
    use webview2_com::{ExecuteScriptCompletedHandler, TrySuspendCompletedHandler};
    use windows_core::{Interface as _, HSTRING};

    use super::{Said, PAUSE, PLAY};

    #[allow(
        unsafe_code,
        reason = "the engine's own suspend is reached through its COM interfaces"
    )]
    pub fn lull(view: &Webview, paused: bool, said: Said) -> Result<(), String> {
        view.with_webview(move |platform| {
            let Ok(core) = (unsafe { platform.controller().CoreWebView2() }) else {
                return;
            };
            let Ok(three) = core.cast::<ICoreWebView2_3>() else {
                return;
            };

            if paused {
                let then = ExecuteScriptCompletedHandler::create(Box::new(move |_, _| {
                    if said.is_closed() {
                        return Ok(());
                    }
                    let done = TrySuspendCompletedHandler::create(Box::new(move |done, frozen| {
                        let _ = said.try_send(done.is_ok() && frozen);
                        Ok(())
                    }));
                    unsafe { three.TrySuspend(&done) }
                }));
                let _ = unsafe { core.ExecuteScript(&HSTRING::from(PAUSE), &then) };
                return;
            }

            let woke = unsafe { three.Resume() };
            let _ = said.try_send(woke.is_ok());
            let done = ExecuteScriptCompletedHandler::create(Box::new(|_, _| Ok(())));
            let _ = unsafe { core.ExecuteScript(&HSTRING::from(PLAY), &done) };
        })
        .map_err(|error| format!("that page could not be reached: {error}"))
    }
}

#[cfg(feature = "cef")]
mod engine {
    use serde_json::json;
    use tauri::Webview;

    use super::{Said, PAUSE, PLAY};

    #[allow(
        clippy::unnecessary_wraps,
        clippy::needless_pass_by_value,
        reason = "the same answer as the other engines', whose calls can fail"
    )]
    pub fn lull(view: &Webview, paused: bool, said: Said) -> Result<(), String> {
        let told = if paused {
            vec![
                ("Runtime.evaluate", json!({ "expression": PAUSE })),
                ("Page.setWebLifecycleState", json!({ "state": "frozen" })),
            ]
        } else {
            vec![
                ("Page.setWebLifecycleState", json!({ "state": "active" })),
                ("Runtime.evaluate", json!({ "expression": PLAY })),
            ]
        };
        crate::engine::devtools::tell(view, None, told);
        let _ = said.try_send(true);
        Ok(())
    }
}

#[cfg(all(not(windows), not(feature = "cef")))]
mod engine {
    use tauri::Webview;

    use super::{Said, PAUSE, PLAY};

    #[allow(
        clippy::needless_pass_by_value,
        reason = "the same answer as the other engines'"
    )]
    pub fn lull(view: &Webview, paused: bool, said: Said) -> Result<(), String> {
        view.eval(if paused { PAUSE } else { PLAY })
            .map_err(|error| format!("that page could not be reached: {error}"))?;
        let _ = said.try_send(!paused);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::{answered, PAUSE, PLAY};

    #[test]
    fn a_page_that_never_answers_is_not_waited_on() {
        let (said, mut heard) = tauri::async_runtime::channel::<bool>(1);
        let patience = std::time::Duration::from_millis(200);
        let started = std::time::Instant::now();
        let paused = tauri::async_runtime::block_on(answered(&mut heard, patience));
        assert!(!paused);
        assert!(started.elapsed() < patience * 10);
        assert!(!said.is_closed());
        drop(heard);
        assert!(said.is_closed());
    }

    #[test]
    fn a_page_that_answers_is_heard() {
        let (said, mut heard) = tauri::async_runtime::channel::<bool>(1);
        said.try_send(true).expect("sent");
        let patience = std::time::Duration::from_secs(5);
        let paused = tauri::async_runtime::block_on(answered(&mut heard, patience));
        assert!(paused);
    }

    #[test]
    fn what_is_paused_is_marked_and_only_that_plays_again() {
        assert!(PAUSE.contains("if (!one.paused)"));
        assert!(PAUSE.contains("data-nib-paused"));
        assert!(PLAY.starts_with("document.querySelectorAll('[data-nib-paused]')"));
    }
}
