use std::collections::HashSet;
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};
use std::sync::{Condvar, Mutex, PoisonError};
use std::time::Duration;
use tauri::{AppHandle, Emitter, ExitRequestApi, Manager, RunEvent, WindowEvent};

use crate::launch;

const QUIT: &str = "nib://quit";

const QUIT_ASK: &str = "nib://quit-ask";

const UPDATE_SETTLE: &str = "nib://update-settle";

const SETTLE_WAIT: Duration = Duration::from_secs(4);

#[derive(Default)]
pub struct Quitting(AtomicU8);

const RUNNING: u8 = 0;
const ASKING: u8 = 1;
const LEAVING: u8 = 2;
const CONFIRMING: u8 = 3;

impl Quitting {
    fn now(&self) -> u8 {
        self.0.load(Ordering::SeqCst)
    }

    fn set(&self, to: u8) {
        self.0.store(to, Ordering::SeqCst);
    }
}

#[derive(Default)]
pub struct Installer {
    taken: AtomicBool,
    closing: Mutex<HashSet<String>>,
    unanswered: Mutex<HashSet<String>>,
    answered: Condvar,
}

impl Installer {
    fn take(&self) -> bool {
        !self.taken.swap(true, Ordering::SeqCst)
    }

    fn release(&self) {
        self.taken.store(false, Ordering::SeqCst);
    }

    fn closing(&self, label: &str, others: impl IntoIterator<Item = String>) -> usize {
        let mut closing = self.closing.lock().unwrap_or_else(PoisonError::into_inner);
        closing.insert(label.to_owned());
        others
            .into_iter()
            .filter(|other| !closing.contains(other))
            .count()
    }

    fn expect(&self, labels: impl IntoIterator<Item = String>) {
        *self.lock() = labels.into_iter().collect();
    }

    fn heard(&self, label: &str) {
        if self.lock().remove(label) {
            self.answered.notify_all();
        }
    }

    fn gone(&self, label: &str) {
        self.closing
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(label);
        self.heard(label);
    }

    fn wait(&self, within: Duration) -> Vec<String> {
        let (left, _) = self
            .answered
            .wait_timeout_while(self.lock(), within, |unanswered| !unanswered.is_empty())
            .unwrap_or_else(PoisonError::into_inner);
        left.iter().cloned().collect()
    }

    fn lock(&self) -> std::sync::MutexGuard<'_, HashSet<String>> {
        self.unanswered
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }
}

pub fn managed(builder: tauri::Builder<crate::Engine>) -> tauri::Builder<crate::Engine> {
    builder
        .manage(Quitting::default())
        .manage(Installer::default())
}

pub fn on_event(app: &AppHandle, event: RunEvent) {
    match event {
        #[cfg(target_os = "macos")]
        RunEvent::Opened { urls } => {
            launch::hand_over(
                app,
                launch::Handed::Pages,
                crate::web_handed::pages_among(&urls),
            );
            let app = app.clone();
            std::thread::spawn(move || {
                let pdfs = crate::handed_pdfs::pdfs_among(&urls);
                launch::hand_over(
                    &app,
                    launch::Handed::Pdfs,
                    crate::handed_pdfs::admit_handed(&app, pdfs),
                );
            });
        }

        #[cfg(target_os = "macos")]
        RunEvent::Ready => asked_to_quit::listen(app),

        #[cfg(target_os = "macos")]
        RunEvent::Reopen {
            has_visible_windows: false,
            ..
        } => launch::reopen(app),

        #[cfg(target_os = "ios")]
        RunEvent::SceneRequested { scene, .. } => {
            if let Some(main) = objc2::MainThreadMarker::new() {
                objc2_ui_kit::UIApplication::sharedApplication(main)
                    .requestSceneSessionDestruction_options_errorHandler(
                        &scene.session(),
                        None,
                        None,
                    );
            }
        }

        RunEvent::ExitRequested { code, api, .. } => exit_requested(app, code, &api),

        RunEvent::Exit => {
            crate::crashes::ended_well();
            crate::terminal::end_all(app);
            crate::apps_host::end_all(app);
            crate::ai_cli::end_all(app);
            crate::notices::clear_all(app);
        }

        RunEvent::WindowEvent {
            event: WindowEvent::DragDrop(tauri::DragDropEvent::Drop { paths, .. }),
            ..
        } => crate::dropped_paths::dropped(app, &paths),

        RunEvent::WindowEvent {
            label,
            event: WindowEvent::Focused(true),
            ..
        } => {
            if let Some(window) = app.get_window(&label) {
                crate::keyboard::no_hidden_menu(&window);
            }
        }

        RunEvent::WindowEvent {
            label,
            event: WindowEvent::Destroyed,
            ..
        } => {
            if let Some(pending) = app.try_state::<launch::Pending>() {
                pending.forget(&label);
            }
            app.state::<crate::endpoint::Waiting>().forget(&label);
            app.state::<Installer>().gone(&label);
            crate::crashes::window_gone(&label);
            crate::terminal::window_gone(app, &label);
            if let Some(sockets) = app.try_state::<crate::mail_socket::MailSockets>() {
                sockets.end_where(&label);
            }
            crate::ai_cli::window_gone(app, &label);
            let now = state(app).now();
            if (now == ASKING || now == CONFIRMING) && launch::document_windows(app).is_empty() {
                leave(app);
            }
        }

        _ => {}
    }
}

fn installer_may_start(closing: bool, now: u8, others: usize) -> bool {
    !closing || now == ASKING || others == 0
}

#[tauri::command]
pub fn update_may_install(webview: tauri::Webview, closing: bool) -> bool {
    if !cfg!(windows) {
        return true;
    }
    let app = webview.app_handle();
    let installer = app.state::<Installer>();
    let others = listening_windows(app, Some(webview.label()))
        .iter()
        .map(|window| window.label().to_owned())
        .collect::<Vec<_>>();
    let others = if closing {
        installer.closing(webview.label(), others)
    } else {
        others.len()
    };
    installer_may_start(closing, state(app).now(), others) && installer.take()
}

#[tauri::command]
pub fn update_install_failed(app: AppHandle) {
    app.state::<Installer>().release();
}

#[tauri::command]
pub fn update_settled(webview: tauri::Webview) {
    webview
        .app_handle()
        .state::<Installer>()
        .heard(webview.label());
}

pub fn before_installer(app: &AppHandle, from: &str) {
    crate::placement::note_every_window(app);

    let installer = app.state::<Installer>();
    let others: Vec<String> = listening_windows(app, Some(from))
        .iter()
        .map(|window| window.label().to_owned())
        .collect();
    installer.expect(others.iter().cloned());
    for label in &others {
        let _ = app.emit_to(label.as_str(), UPDATE_SETTLE, ());
    }
    let left = installer.wait(SETTLE_WAIT);
    if !left.is_empty() {
        crate::trace::mark("update: installer starting with a window not settled");
    }
}

pub fn quit(app: &AppHandle) {
    let quitting = state(app);
    if quitting.now() == ASKING || quitting.now() == LEAVING {
        return;
    }

    let windows = listening_windows(app, None);
    let asker = windows
        .iter()
        .find(|window| window.is_focused().unwrap_or(false))
        .or_else(|| {
            windows
                .iter()
                .find(|window| window.is_visible().unwrap_or(false))
        })
        .or_else(|| windows.first());

    let Some(asker) = asker else {
        quit_now(app);
        return;
    };
    quitting.set(CONFIRMING);
    let _ = app.emit_to(asker.label(), QUIT_ASK, ());
}

fn listening_windows(app: &AppHandle, except: Option<&str>) -> Vec<tauri::Window> {
    let pending = app.try_state::<launch::Pending>();
    launch::document_windows(app)
        .into_iter()
        .filter(|window| Some(window.label()) != except)
        .filter(|window| {
            pending
                .as_ref()
                .is_some_and(|pending| pending.is_listening(window.label()))
        })
        .collect()
}

#[tauri::command(async)]
pub fn quit_confirmed(webview: tauri::Webview) {
    let app = webview.app_handle();
    if launch::is_document_window(webview.label()) && state(app).now() == CONFIRMING {
        quit_now(app);
    }
}

#[tauri::command]
pub fn quit_others(webview: tauri::Webview) -> Vec<String> {
    listening_windows(webview.app_handle(), Some(webview.label()))
        .iter()
        .map(|window| window.label().to_owned())
        .collect()
}

#[tauri::command(async)]
pub fn quit_show(webview: tauri::Webview) {
    let window = webview.window();
    if !launch::is_document_window(window.label()) {
        return;
    }
    #[cfg(any(windows, target_os = "macos"))]
    if !window.is_visible().unwrap_or(true) {
        crate::agents::shell::open(webview.app_handle());
        return;
    }
    crate::placement::raised(&window);
}

pub fn quit_now(app: &AppHandle) {
    let quitting = state(app);
    quitting.set(ASKING);

    crate::placement::note_every_window(app);

    let windows = launch::document_windows(app);
    if windows.is_empty() {
        leave(app);
        return;
    }

    let pending = app.try_state::<launch::Pending>();
    for window in windows {
        let label = window.label().to_owned();
        let listening = pending
            .as_ref()
            .is_some_and(|pending| pending.is_listening(&label));

        let (app, going) = (app.clone(), window.clone());
        let ask = move || {
            if listening {
                let _ = app.emit_to(label.as_str(), QUIT, ());
            } else {
                let _ = going.destroy();
            }
        };

        #[cfg(any(windows, target_os = "macos", feature = "cef"))]
        crate::web_cookies::kept(&window, ask);
        #[cfg(not(any(windows, target_os = "macos", feature = "cef")))]
        ask();
    }
}

#[tauri::command]
pub fn keep_running(app: AppHandle) {
    let quitting = state(&app);
    if quitting.now() == ASKING || quitting.now() == CONFIRMING {
        quitting.set(RUNNING);
    }
    #[cfg(target_os = "macos")]
    asked_to_quit::answer(&app, false);
}

#[cfg(target_os = "macos")]
mod asked_to_quit {
    use objc2::runtime::{AnyObject, Imp, Sel};
    use objc2::{ffi, sel, MainThreadMarker};
    use objc2_app_kit::NSApplication;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::OnceLock;
    use tauri::AppHandle;

    static APP: OnceLock<AppHandle> = OnceLock::new();

    const NOW: usize = 1;
    const LATER: usize = 2;

    static WAITING: AtomicBool = AtomicBool::new(false);

    type ShouldTerminate = extern "C-unwind" fn(&AnyObject, Sel, *mut AnyObject) -> usize;

    #[allow(
        unsafe_code,
        reason = "adding a method to a class AppKit owns is the Objective-C runtime's own call, which has no safe wrapper"
    )]
    pub fn listen(app: &AppHandle) {
        if APP.set(app.clone()).is_err() {
            return;
        }
        let Some(main) = MainThreadMarker::new() else {
            return;
        };
        let Some(delegate) = NSApplication::sharedApplication(main).delegate() else {
            return;
        };
        let object: &AnyObject = delegate.as_ref();
        let answer: ShouldTerminate = should_terminate;

        unsafe {
            let class = ffi::object_getClass(std::ptr::from_ref(object)).cast_mut();
            let imp = std::mem::transmute::<ShouldTerminate, Imp>(answer);
            ffi::class_addMethod(
                class,
                sel!(applicationShouldTerminate:),
                imp,
                c"Q@:@".as_ptr(),
            );
        }
    }

    extern "C-unwind" fn should_terminate(_: &AnyObject, _: Sel, _: *mut AnyObject) -> usize {
        let Some(app) = APP.get() else {
            return NOW;
        };
        if super::state(app).now() == super::LEAVING {
            return NOW;
        }

        super::quit(app);
        if super::state(app).now() == super::LEAVING {
            return NOW;
        }

        WAITING.store(true, Ordering::SeqCst);
        LATER
    }

    pub fn answer(app: &AppHandle, yes: bool) -> bool {
        if !WAITING.swap(false, Ordering::SeqCst) {
            return false;
        }

        let reply = move || {
            if let Some(main) = MainThreadMarker::new() {
                NSApplication::sharedApplication(main).replyToApplicationShouldTerminate(yes);
            }
        };
        if MainThreadMarker::new().is_some() {
            reply();
        } else {
            let _ = app.run_on_main_thread(reply);
        }
        true
    }
}

fn leave(app: &AppHandle) {
    state(app).set(LEAVING);
    #[cfg(target_os = "macos")]
    if asked_to_quit::answer(app, true) {
        return;
    }
    app.exit(0);
}

fn exit_requested(app: &AppHandle, code: Option<i32>, api: &ExitRequestApi) {
    let quitting = state(app);
    match on_exit(code, quitting.now(), cfg!(target_os = "macos")) {
        Exit::Pass => quitting.set(LEAVING),
        Exit::Stay => api.prevent_exit(),
        Exit::Ask => {
            api.prevent_exit();
            quit(app);
        }
    }
}

fn state(app: &AppHandle) -> tauri::State<'_, Quitting> {
    app.state::<Quitting>()
}

#[derive(Debug, PartialEq, Eq)]
enum Exit {
    Pass,
    Stay,
    Ask,
}

fn on_exit(code: Option<i32>, now: u8, mac: bool) -> Exit {
    if code == Some(tauri::RESTART_EXIT_CODE) || now == LEAVING {
        return Exit::Pass;
    }

    match code {
        None if now == ASKING || now == CONFIRMING || !mac => Exit::Pass,
        None => Exit::Stay,
        Some(_) if mac => Exit::Ask,
        Some(_) => Exit::Pass,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        installer_may_start, on_exit, Exit, Installer, ASKING, CONFIRMING, LEAVING, RUNNING,
    };
    use std::sync::Arc;
    use std::time::Duration;

    #[test]
    fn only_the_last_window_closing_starts_the_installer() {
        assert!(!installer_may_start(true, RUNNING, 1));
        assert!(installer_may_start(true, RUNNING, 0));
        assert!(!installer_may_start(true, CONFIRMING, 2));
    }

    #[test]
    fn a_quit_or_a_restart_starts_the_installer_with_windows_open() {
        assert!(installer_may_start(true, ASKING, 2));
        assert!(installer_may_start(false, RUNNING, 2));
    }

    #[test]
    fn the_installer_is_started_once() {
        let installer = Installer::default();
        assert!(installer.take());
        assert!(!installer.take());
    }

    #[test]
    fn an_installer_that_did_not_start_may_be_tried_again() {
        let installer = Installer::default();
        assert!(installer.take());
        installer.release();
        assert!(installer.take());
    }

    #[test]
    fn of_two_windows_closing_together_the_second_is_the_last() {
        let installer = Installer::default();
        assert_eq!(installer.closing("a", ["b".to_owned()]), 1);
        assert_eq!(installer.closing("b", ["a".to_owned()]), 0);
    }

    #[test]
    fn a_window_gone_is_no_longer_closing() {
        let installer = Installer::default();
        installer.closing("a", []);
        installer.gone("a");
        assert_eq!(installer.closing("b", ["a".to_owned()]), 1);
    }

    #[test]
    fn a_window_gone_ends_the_wait_for_it() {
        let installer = Installer::default();
        installer.expect(["a".to_owned()]);
        installer.gone("a");
        assert!(installer.wait(Duration::from_secs(3600)).is_empty());
    }

    #[test]
    fn nothing_to_wait_for_is_not_waited_for() {
        let installer = Installer::default();
        assert!(installer.wait(Duration::from_secs(3600)).is_empty());
    }

    #[test]
    fn every_window_answering_ends_the_wait() {
        let installer = Arc::new(Installer::default());
        installer.expect(["a".to_owned(), "b".to_owned()]);
        installer.heard("a");

        let answering = installer.clone();
        let answer = std::thread::spawn(move || answering.heard("b"));
        assert!(installer.wait(Duration::from_secs(3600)).is_empty());
        answer.join().expect("the answer");
    }

    #[test]
    fn a_window_that_does_not_answer_is_given_up_on() {
        let installer = Installer::default();
        installer.expect(["a".to_owned(), "b".to_owned()]);
        installer.heard("b");
        assert_eq!(installer.wait(Duration::ZERO), vec!["a".to_owned()]);
    }

    #[test]
    fn a_window_not_waited_for_is_ignored() {
        let installer = Installer::default();
        installer.expect(["a".to_owned()]);
        installer.heard("z");
        assert_eq!(installer.wait(Duration::ZERO), vec!["a".to_owned()]);
    }

    #[test]
    fn a_mac_app_outlives_its_last_window() {
        assert_eq!(on_exit(None, RUNNING, true), Exit::Stay);
    }

    #[test]
    fn elsewhere_the_last_window_still_ends_the_app() {
        assert_eq!(on_exit(None, RUNNING, false), Exit::Pass);
        assert_eq!(on_exit(Some(0), RUNNING, false), Exit::Pass);
    }

    #[test]
    fn quitting_on_a_mac_asks_every_window_first() {
        assert_eq!(on_exit(Some(0), RUNNING, true), Exit::Ask);
        assert_eq!(on_exit(Some(0), ASKING, true), Exit::Ask);
    }

    #[test]
    fn the_exit_after_every_window_said_yes_goes_through() {
        assert_eq!(on_exit(None, ASKING, true), Exit::Pass);
        assert_eq!(on_exit(Some(0), LEAVING, true), Exit::Pass);
        assert_eq!(on_exit(None, LEAVING, true), Exit::Pass);
    }

    #[test]
    fn a_quit_being_confirmed_ends_with_its_last_window() {
        assert_eq!(on_exit(None, CONFIRMING, true), Exit::Pass);
        assert_eq!(on_exit(None, CONFIRMING, false), Exit::Pass);
        assert_eq!(on_exit(Some(0), CONFIRMING, true), Exit::Ask);
    }

    #[test]
    fn a_restart_is_never_held() {
        assert_eq!(
            on_exit(Some(tauri::RESTART_EXIT_CODE), RUNNING, true),
            Exit::Pass
        );
    }
}
