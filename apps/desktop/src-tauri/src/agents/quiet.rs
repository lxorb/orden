#[cfg(all(windows, not(feature = "cef")))]
use std::cell::RefCell;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

#[cfg(all(windows, not(feature = "cef")))]
use serde_json::json;
use tauri::AppHandle;
#[cfg(all(windows, not(feature = "cef")))]
use webview2_com::Microsoft::Web::WebView2::Win32::{
    ICoreWebView2, ICoreWebView2BasicAuthenticationRequestedEventArgs,
    ICoreWebView2ClientCertificate, ICoreWebView2ClientCertificateRequestedEventArgs,
    ICoreWebView2Deferral, ICoreWebView2DownloadOperation,
    ICoreWebView2NewWindowRequestedEventArgs, ICoreWebView2ScriptDialogOpeningEventArgs,
    ICoreWebView2Settings3, ICoreWebView2Settings4, ICoreWebView2Settings5, ICoreWebView2Settings6,
    ICoreWebView2_10, ICoreWebView2_4, ICoreWebView2_5, ICoreWebView2_8,
    COREWEBVIEW2_DOWNLOAD_STATE, COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED,
    COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS, COREWEBVIEW2_PERMISSION_STATE_DENY,
    COREWEBVIEW2_SCRIPT_DIALOG_KIND, COREWEBVIEW2_SCRIPT_DIALOG_KIND_BEFOREUNLOAD,
    COREWEBVIEW2_SCRIPT_DIALOG_KIND_CONFIRM, COREWEBVIEW2_SCRIPT_DIALOG_KIND_PROMPT,
};
#[cfg(all(windows, not(feature = "cef")))]
use webview2_com::{
    BasicAuthenticationRequestedEventHandler, BytesReceivedChangedEventHandler,
    ClientCertificateRequestedEventHandler, DownloadStartingEventHandler,
    NewWindowRequestedEventHandler, PermissionRequestedEventHandler,
    ScriptDialogOpeningEventHandler, StateChangedEventHandler,
};
#[cfg(all(windows, not(feature = "cef")))]
use windows_core::{Interface as _, HSTRING, PWSTR};

#[cfg(any(windows, feature = "cef"))]
use super::cdp;
#[cfg(all(windows, not(feature = "cef")))]
use super::verbs::DialogKind;
use super::verbs::{Dialog, Download, DownloadState};

pub(super) const DIALOG_PATIENCE: Duration = Duration::from_secs(30);

pub(super) const MOST_DOWNLOAD: i64 = 500 * 1024 * 1024;

pub(super) const STUBS: &str = r"(() => {
  const nothing = () => undefined
  try { Object.defineProperty(window, 'print', { value: nothing, writable: false, configurable: false }) } catch (_) {}
  for (const kind of [window.HTMLInputElement, window.HTMLSelectElement]) {
    try { if (kind && kind.prototype.showPicker) Object.defineProperty(kind.prototype, 'showPicker', { value: nothing, writable: false, configurable: false }) } catch (_) {}
  }
})()";

struct Held {
    dialog: Dialog,
    since: Instant,
}

static DIALOGS: Mutex<Option<HashMap<String, Held>>> = Mutex::new(None);

static DOWNLOADS: Mutex<Vec<(String, Download)>> = Mutex::new(Vec::new());

#[cfg(all(windows, not(feature = "cef")))]
struct Waiting {
    asked: Holding,
    deferral: ICoreWebView2Deferral,
    number: u64,
}

#[cfg(all(windows, not(feature = "cef")))]
enum Holding {
    Script(ICoreWebView2ScriptDialogOpeningEventArgs),
    SignIn(ICoreWebView2BasicAuthenticationRequestedEventArgs),
    Certificate(
        ICoreWebView2ClientCertificateRequestedEventArgs,
        Vec<(ICoreWebView2ClientCertificate, String)>,
    ),
}

#[derive(Clone, Debug, Default)]
pub struct Said {
    pub accept: bool,
    pub text: Option<String>,
    pub username: Option<String>,
    pub password: Option<String>,
}

impl Said {
    pub(super) fn only(accept: bool) -> Self {
        Said {
            accept,
            ..Said::default()
        }
    }

    pub(super) fn chosen<'a>(&self, offered: impl IntoIterator<Item = &'a str>) -> Option<usize> {
        if !self.accept {
            return None;
        }
        let wanted = self
            .text
            .as_deref()
            .map(str::trim)
            .filter(|one| !one.is_empty())
            .map(str::to_lowercase);
        let mut first = None;
        for (at, words) in offered.into_iter().enumerate() {
            first.get_or_insert(at);
            if wanted
                .as_deref()
                .is_some_and(|wanted| words.to_lowercase().contains(wanted))
            {
                return Some(at);
            }
        }
        if wanted.is_some() {
            None
        } else {
            first
        }
    }
}

#[cfg(all(windows, not(feature = "cef")))]
struct Asked {
    opener: ICoreWebView2,
    args: ICoreWebView2NewWindowRequestedEventArgs,
    deferral: ICoreWebView2Deferral,
}

#[cfg(all(windows, not(feature = "cef")))]
thread_local! {
    static WAITING: RefCell<HashMap<String, Waiting>> = RefCell::new(HashMap::new());
    static POPUPS: RefCell<HashMap<String, Asked>> = RefCell::new(HashMap::new());
}

pub(super) static NUMBER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(1);

#[derive(Clone)]
pub struct Owner {
    pub agent: String,
    pub tab: String,
    pub label: String,
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "the page's settings and events are WebView2's own, reached through its COM interfaces"
)]
pub fn quieten(app: &AppHandle, core: &ICoreWebView2, owner: &Owner) {
    unsafe {
        if let Ok(settings) = core.Settings() {
            let _ = settings.SetAreDefaultScriptDialogsEnabled(false);
            let _ = settings.SetAreDefaultContextMenusEnabled(false);
            let _ = settings.SetIsStatusBarEnabled(false);
            let _ = settings.SetIsZoomControlEnabled(false);
            let _ = settings.SetAreDevToolsEnabled(false);
            if let Ok(three) = settings.cast::<ICoreWebView2Settings3>() {
                let _ = three.SetAreBrowserAcceleratorKeysEnabled(false);
            }
            if let Ok(four) = settings.cast::<ICoreWebView2Settings4>() {
                let _ = four.SetIsGeneralAutofillEnabled(false);
                let _ = four.SetIsPasswordAutosaveEnabled(false);
            }
            if let Ok(five) = settings.cast::<ICoreWebView2Settings5>() {
                let _ = five.SetIsPinchZoomEnabled(false);
            }
            if let Ok(six) = settings.cast::<ICoreWebView2Settings6>() {
                let _ = six.SetIsSwipeNavigationEnabled(false);
            }
        }
        if let Ok(eight) = core.cast::<ICoreWebView2_8>() {
            let _ = eight.SetIsMuted(true);
        }
    }

    dialogs(app, core, owner);
    windows(app, core, owner);
    permissions(core, owner);
    downloads(app, core, owner);
    sign_ins(app, core, owner);

    cdp::post(core, "Page.enable", &json!({}));
    cdp::post(
        core,
        "Page.setInterceptFileChooserDialog",
        &json!({ "enabled": true }),
    );
    cdp::post(
        core,
        "Page.addScriptToEvaluateOnNewDocument",
        &json!({ "source": STUBS, "runImmediately": true }),
    );
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "a dialog is one of WebView2's own events, reached through its COM interfaces"
)]
fn dialogs(app: &AppHandle, core: &ICoreWebView2, owner: &Owner) {
    let app = app.clone();
    let label = owner.label.clone();
    let handler = ScriptDialogOpeningEventHandler::create(Box::new(move |_, args| {
        let Some(args) = args else {
            return Ok(());
        };
        if super::tabs::owner(&label).is_none() {
            return Ok(());
        }
        let (kind, message, default_text, url) = unsafe {
            let mut kind = COREWEBVIEW2_SCRIPT_DIALOG_KIND::default();
            args.Kind(&raw mut kind)?;
            (
                kind,
                text(|out| args.Message(out)),
                text(|out| args.DefaultText(out)),
                text(|out| args.Uri(out)),
            )
        };
        let kind = match kind {
            COREWEBVIEW2_SCRIPT_DIALOG_KIND_CONFIRM => DialogKind::Confirm,
            COREWEBVIEW2_SCRIPT_DIALOG_KIND_PROMPT => DialogKind::Prompt,
            COREWEBVIEW2_SCRIPT_DIALOG_KIND_BEFOREUNLOAD => DialogKind::Beforeunload,
            _ => DialogKind::Alert,
        };
        let deferral = unsafe { args.GetDeferral()? };
        let dialog = Dialog {
            kind,
            message: cdp::cut(message, 4_000),
            default_text: (kind == DialogKind::Prompt).then_some(default_text),
            url,
            open_ms: 0,
        };
        waiting(
            &app,
            &label,
            dialog,
            Holding::Script(args.clone()),
            deferral,
        );
        Ok(())
    }));
    let mut token = 0i64;
    let _ = unsafe { core.add_ScriptDialogOpening(&handler, &raw mut token) };
}

#[cfg(all(windows, not(feature = "cef")))]
fn waiting(
    app: &AppHandle,
    label: &str,
    dialog: Dialog,
    asked: Holding,
    deferral: ICoreWebView2Deferral,
) {
    let number = NUMBER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let kind = dialog.kind;
    WAITING.with_borrow_mut(|held| {
        held.insert(
            label.to_string(),
            Waiting {
                asked,
                deferral,
                number,
            },
        );
    });
    hold(label, dialog);
    let late = app.clone();
    let named = label.to_string();
    std::thread::spawn(move || {
        std::thread::sleep(DIALOG_PATIENCE);
        let answering = late.clone();
        let _ = late.run_on_main_thread(move || {
            let _ = answering;
            settle(&named, Some(number), Said::only(kind == DialogKind::Alert));
        });
    });
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "a string the engine allocated is read and freed through COM"
)]
fn text(read: impl FnOnce(*mut PWSTR) -> windows_core::Result<()>) -> String {
    let mut out = PWSTR::null();
    if read(&raw mut out).is_err() {
        return String::new();
    }
    webview2_com::take_pwstr(out)
}

pub fn dialog_of(label: &str) -> Option<Dialog> {
    DIALOGS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()?
        .get(label)
        .map(|held| Dialog {
            open_ms: u64::try_from(held.since.elapsed().as_millis()).unwrap_or(u64::MAX),
            ..held.dialog.clone()
        })
}

pub fn answer_dialog(app: &AppHandle, label: &str, said: Said) -> Result<(), String> {
    if dialog_of(label).is_none() {
        return Err("the page is holding no dialog".into());
    }
    #[cfg(feature = "cef")]
    return super::engines::cef::answer_dialog(app, label, said);
    #[cfg(all(target_os = "macos", not(feature = "cef")))]
    return super::engines::webkit::answer_dialog(app, label, said);
    #[cfg(all(windows, not(feature = "cef")))]
    {
        let named = label.to_string();
        app.run_on_main_thread(move || settle(&named, None, said))
            .map_err(|error| error.to_string())
    }
}

pub(super) fn hold(label: &str, dialog: Dialog) {
    DIALOGS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get_or_insert_with(HashMap::new)
        .insert(
            label.to_string(),
            Held {
                dialog,
                since: Instant::now(),
            },
        );
}

pub(super) fn release(label: &str) {
    if let Some(all) = DIALOGS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_mut()
    {
        all.remove(label);
    }
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "a dialog's answer is given through WebView2's COM interfaces"
)]
fn settle(label: &str, number: Option<u64>, said: Said) {
    let Some(waiting) = WAITING.with_borrow_mut(|held| {
        let fits = held
            .get(label)
            .is_some_and(|one| number.is_none_or(|number| one.number == number));
        if fits {
            held.remove(label)
        } else {
            None
        }
    }) else {
        return;
    };
    if let Some(all) = DIALOGS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_mut()
    {
        all.remove(label);
    }
    unsafe {
        match &waiting.asked {
            Holding::Script(args) => {
                if let Some(text) = &said.text {
                    let _ = args.SetResultText(&HSTRING::from(text.as_str()));
                }
                if said.accept {
                    let _ = args.Accept();
                }
            }
            Holding::SignIn(args) => {
                let answered = said.accept.then(|| args.Response().ok()).flatten();
                match answered {
                    Some(response) => {
                        let name = said.username.as_deref().unwrap_or_default();
                        let password = said.password.as_deref().unwrap_or_default();
                        let _ = response.SetUserName(&HSTRING::from(name));
                        let _ = response.SetPassword(&HSTRING::from(password));
                    }
                    None => {
                        let _ = args.SetCancel(true);
                    }
                }
            }
            Holding::Certificate(args, offered) => {
                if let Some(at) = said.chosen(offered.iter().map(|(_, words)| words.as_str())) {
                    let _ = args.SetSelectedCertificate(&offered[at].0);
                }
                let _ = args.SetHandled(true);
            }
        }
        let _ = waiting.deferral.Complete();
    }
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "a new window is one of WebView2's own events, reached through its COM interfaces"
)]
fn windows(app: &AppHandle, core: &ICoreWebView2, owner: &Owner) {
    let app = app.clone();
    let label = owner.label.clone();
    let handler = NewWindowRequestedEventHandler::create(Box::new(move |opener, args| {
        let (Some(opener), Some(args)) = (opener, args) else {
            return Ok(());
        };
        let url = unsafe { text(|out| args.Uri(out)) };
        let Some(owner) = super::tabs::owner(&label) else {
            crate::web_tabs::opened_from_adopted(&app, &label, &url);
            return Ok(());
        };
        unsafe { args.SetHandled(true)? };
        if let Err(why) = super::tabs::may_open(&owner, &url) {
            say(
                &label,
                "warning",
                format!("Orden refused a window to {url}: {why}"),
            );
            return Ok(());
        }
        let deferral = unsafe { args.GetDeferral()? };
        let Some(tab) = super::tabs::reserve_popup(&owner, &url) else {
            let _ = unsafe { deferral.Complete() };
            return Ok(());
        };
        POPUPS.with_borrow_mut(|held| {
            held.insert(
                tab.clone(),
                Asked {
                    opener: opener.clone(),
                    args: args.clone(),
                    deferral,
                },
            );
        });
        let building = app.clone();
        let _ = app.run_on_main_thread(move || super::tabs::build_popup(&building, &tab));
        Ok(())
    }));
    let mut token = 0i64;
    let _ = unsafe { core.add_NewWindowRequested(&handler, &raw mut token) };
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "the new window is handed over through WebView2's COM interfaces"
)]
pub fn hand_over(tab: &str, made: Option<&ICoreWebView2>) {
    let Some(asked) = POPUPS.with_borrow_mut(|held| held.remove(tab)) else {
        return;
    };
    unsafe {
        if let Some(core) =
            made.filter(|core| wry::still_open(&asked.opener) && wry::still_open(core))
        {
            let _ = asked.args.SetNewWindow(core);
        }
        let _ = asked.deferral.Complete();
    }
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "a permission request is one of WebView2's own events, reached through its COM interfaces"
)]
fn permissions(core: &ICoreWebView2, owner: &Owner) {
    let label = owner.label.clone();
    let handler = PermissionRequestedEventHandler::create(Box::new(move |_, args| {
        let Some(args) = args else {
            return Ok(());
        };
        unsafe {
            let mut kind = webview2_com::Microsoft::Web::WebView2::Win32::COREWEBVIEW2_PERMISSION_KIND::default();
            let _ = args.PermissionKind(&raw mut kind);
            args.SetState(COREWEBVIEW2_PERMISSION_STATE_DENY)?;
            say(
                &label,
                "warning",
                format!("Orden refused the page {}", permission_named(kind.0)),
            );
        }
        Ok(())
    }));
    let mut token = 0i64;
    let _ = unsafe { core.add_PermissionRequested(&handler, &raw mut token) };
}

#[cfg(all(windows, not(feature = "cef")))]
fn permission_named(kind: i32) -> &'static str {
    match kind {
        1 => "the microphone",
        2 => "the camera",
        3 => "where it is",
        4 => "notifications",
        5 => "the sensors",
        6 => "reading the clipboard",
        7 => "several downloads at once",
        8 => "files on the machine",
        9 => "playing sound by itself",
        10 => "the machine's fonts",
        11 => "MIDI devices",
        12 => "placing windows",
        _ => "a permission",
    }
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "a download is one of WebView2's own events, reached through its COM interfaces"
)]
fn downloads(app: &AppHandle, core: &ICoreWebView2, owner: &Owner) {
    let Ok(four) = core.cast::<ICoreWebView2_4>() else {
        return;
    };
    let owner = owner.clone();
    let app = app.clone();
    let handler = DownloadStartingEventHandler::create(Box::new(move |_, args| {
        let Some(args) = args else {
            return Ok(());
        };
        unsafe {
            args.SetHandled(true)?;
            let operation = args.DownloadOperation()?;
            let url = text(|out| operation.Uri(out));
            let suggested = text(|out| args.ResultFilePath(out));
            let mut total = 0i64;
            let _ = operation.TotalBytesToReceive(&raw mut total);
            let Some(path) = destination(&app, &owner.agent, &suggested) else {
                args.SetCancel(true)?;
                return Ok(());
            };
            let record = Download {
                tab: owner.tab.clone(),
                url,
                path: path.to_string_lossy().into_owned(),
                state: DownloadState::Going,
            };
            if total > MOST_DOWNLOAD {
                args.SetCancel(true)?;
                noted(
                    &owner.agent,
                    Download {
                        state: DownloadState::TooLarge,
                        ..record
                    },
                );
                return Ok(());
            }
            args.SetResultFilePath(&HSTRING::from(path.as_os_str()))?;
            noted(&owner.agent, record.clone());
            watch_download(&operation, &owner.agent, &record.path);
        }
        Ok(())
    }));
    let mut token = 0i64;
    let _ = unsafe { four.add_DownloadStarting(&handler, &raw mut token) };
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "a download's progress is WebView2's own, reached through its COM interfaces"
)]
fn watch_download(operation: &ICoreWebView2DownloadOperation, agent: &str, path: &str) {
    let (agent, path) = (agent.to_string(), path.to_string());
    let growing = BytesReceivedChangedEventHandler::create(Box::new({
        let (agent, path) = (agent.clone(), path.clone());
        move |operation, _| {
            let Some(operation) = operation else {
                return Ok(());
            };
            let mut received = 0i64;
            unsafe {
                let _ = operation.BytesReceived(&raw mut received);
                if received > MOST_DOWNLOAD {
                    let _ = operation.Cancel();
                    moved(&agent, &path, DownloadState::TooLarge);
                }
            }
            Ok(())
        }
    }));
    let ended = StateChangedEventHandler::create(Box::new(move |operation, _| {
        let Some(operation) = operation else {
            return Ok(());
        };
        let mut state = COREWEBVIEW2_DOWNLOAD_STATE::default();
        unsafe {
            let _ = operation.State(&raw mut state);
        }
        if state == COREWEBVIEW2_DOWNLOAD_STATE_IN_PROGRESS {
            return Ok(());
        }
        let done = if state == COREWEBVIEW2_DOWNLOAD_STATE_COMPLETED {
            DownloadState::Done
        } else {
            DownloadState::Failed
        };
        moved(&agent, &path, done);
        Ok(())
    }));
    let mut token = 0i64;
    unsafe {
        let _ = operation.add_BytesReceivedChanged(&growing, &raw mut token);
        let _ = operation.add_StateChanged(&ended, &raw mut token);
    }
}

pub(super) fn destination(app: &AppHandle, agent: &str, suggested: &str) -> Option<PathBuf> {
    let name = std::path::Path::new(suggested)
        .file_name()
        .map_or_else(|| std::ffi::OsString::from("download"), ToOwned::to_owned);
    let folder = crate::downloads::folder(app)
        .ok()?
        .join("nib agents")
        .join(agent);
    crate::paths::made(&folder).ok()?;
    let name = crate::downloads::clean_name(&name);
    let taken: Vec<String> = DOWNLOADS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .iter()
        .filter(|(_, one)| one.state == DownloadState::Going)
        .map(|(_, one)| one.path.clone())
        .collect();
    Some(crate::downloads::free_path(&folder, &name, |path| {
        crate::downloads::on_disk(path) || taken.iter().any(|one| std::path::Path::new(one) == path)
    }))
}

pub(super) fn noted(agent: &str, download: Download) {
    let mut all = DOWNLOADS.lock().unwrap_or_else(PoisonError::into_inner);
    all.push((agent.to_string(), download));
    if all.len() > 500 {
        all.remove(0);
    }
}

pub(super) fn moved(agent: &str, path: &str, state: DownloadState) {
    let mut all = DOWNLOADS.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some((_, one)) = all
        .iter_mut()
        .rev()
        .find(|(owner, one)| owner == agent && one.path == path)
    {
        if one.state == DownloadState::Going {
            one.state = state;
        }
    }
}

pub fn downloads_of(agent: &str, tab: Option<&str>) -> Vec<Download> {
    DOWNLOADS
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .iter()
        .filter(|(owner, one)| owner == agent && tab.is_none_or(|tab| one.tab == tab))
        .map(|(_, one)| one.clone())
        .collect()
}

#[cfg(all(windows, not(feature = "cef")))]
#[allow(
    unsafe_code,
    reason = "sign-in requests are WebView2's own events, reached through its COM interfaces"
)]
fn sign_ins(app: &AppHandle, core: &ICoreWebView2, owner: &Owner) {
    if let Ok(ten) = core.cast::<ICoreWebView2_10>() {
        let (app, label) = (app.clone(), owner.label.clone());
        let handler = BasicAuthenticationRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            if super::tabs::owner(&label).is_none() {
                return Ok(());
            }
            let (url, challenge, deferral) = unsafe {
                (
                    text(|out| args.Uri(out)),
                    text(|out| args.Challenge(out)),
                    args.GetDeferral()?,
                )
            };
            let dialog = Dialog {
                kind: DialogKind::SignIn,
                message: cdp::cut(signing_in(&challenge), 4_000),
                default_text: None,
                url,
                open_ms: 0,
            };
            waiting(
                &app,
                &label,
                dialog,
                Holding::SignIn(args.clone()),
                deferral,
            );
            Ok(())
        }));
        let mut token = 0i64;
        let _ = unsafe { ten.add_BasicAuthenticationRequested(&handler, &raw mut token) };
    }
    if let Ok(five) = core.cast::<ICoreWebView2_5>() {
        let (app, label) = (app.clone(), owner.label.clone());
        let handler = ClientCertificateRequestedEventHandler::create(Box::new(move |_, args| {
            let Some(args) = args else {
                return Ok(());
            };
            if super::tabs::owner(&label).is_none() {
                return Ok(());
            }
            let (host, offered, deferral) = unsafe {
                let mut offered = Vec::new();
                if let Ok(all) = args.MutuallyTrustedCertificates() {
                    let mut count = 0u32;
                    let _ = all.Count(&raw mut count);
                    for at in 0..count {
                        if let Ok(one) = all.GetValueAtIndex(at) {
                            let words = text(|out| one.Subject(out));
                            offered.push((one, words));
                        }
                    }
                }
                (text(|out| args.Host(out)), offered, args.GetDeferral()?)
            };
            let message = certificates(offered.iter().map(|(_, words)| words.as_str()));
            let dialog = Dialog {
                kind: DialogKind::Certificate,
                message: cdp::cut(message, 4_000),
                default_text: None,
                url: format!("https://{host}/"),
                open_ms: 0,
            };
            waiting(
                &app,
                &label,
                dialog,
                Holding::Certificate(args.clone(), offered),
                deferral,
            );
            Ok(())
        }));
        let mut token = 0i64;
        let _ = unsafe { five.add_ClientCertificateRequested(&handler, &raw mut token) };
    }
}

pub(super) fn signing_in(realm: &str) -> String {
    let realm = realm.trim();
    if realm.is_empty() {
        "The site asks to sign in: answer with username and password".to_string()
    } else {
        format!("The site asks to sign in to {realm}: answer with username and password")
    }
}

pub(super) fn certificates<'a>(offered: impl IntoIterator<Item = &'a str>) -> String {
    let all: Vec<&str> = offered.into_iter().collect();
    if all.is_empty() {
        "The site asks for a client certificate, and none is installed that it takes: accept to go on without one"
            .to_string()
    } else {
        format!(
            "The site asks for a client certificate: accept to present the first, or name one in text. Offered: {}",
            all.join("; ")
        )
    }
}

#[cfg(any(windows, feature = "cef"))]
pub(super) fn say(label: &str, level: &str, text: String) {
    cdp::heard(label)
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .say(level, text);
}

pub fn forget(app: &AppHandle, label: &str) {
    release(label);
    #[cfg(all(windows, not(feature = "cef")))]
    {
        let named = label.to_string();
        let _ = app.run_on_main_thread(move || {
            WAITING.with_borrow_mut(|held| held.remove(&named));
        });
    }
    #[cfg(not(all(windows, not(feature = "cef"))))]
    let _ = app;
}

#[cfg(test)]
mod tests {
    use super::{certificates, signing_in, Said, STUBS};
    use crate::agents::verbs::{AnswerDialog, DialogKind};

    #[test]
    fn a_certificate_is_the_one_named_or_the_first() {
        let offered = ["CN=Ada Lovelace, O=Example", "CN=Build bot, O=Example"];
        let yes = Said::only(true);
        assert_eq!(yes.chosen(offered), Some(0));
        let named = Said {
            text: Some("build BOT".into()),
            ..Said::only(true)
        };
        assert_eq!(named.chosen(offered), Some(1));
        let missing = Said {
            text: Some("nobody".into()),
            ..Said::only(true)
        };
        assert_eq!(missing.chosen(offered), None);
        assert_eq!(Said::only(false).chosen(offered), None);
        assert_eq!(yes.chosen(std::iter::empty()), None);
    }

    #[test]
    fn the_agent_is_told_how_to_answer_a_sign_in_and_a_certificate() {
        assert!(signing_in("Staff").contains("sign in to Staff"));
        assert!(signing_in(" ").contains("username and password"));
        assert!(certificates(["CN=A", "CN=B"]).ends_with("CN=A; CN=B"));
        assert!(certificates(std::iter::empty()).contains("go on without one"));
    }

    #[test]
    fn browser_dialog_takes_a_user_name_and_a_password() {
        let answer: AnswerDialog = serde_json::from_value(serde_json::json!({
            "tab": "a1", "accept": true, "username": "ada", "password": "secret"
        }))
        .expect("an answer");
        assert_eq!(answer.username.as_deref(), Some("ada"));
        assert_eq!(answer.password.as_deref(), Some("secret"));
        assert_eq!(
            serde_json::to_value(DialogKind::SignIn).expect("json"),
            "sign_in"
        );
        assert_eq!(
            serde_json::to_value(DialogKind::Certificate).expect("json"),
            "certificate"
        );
        assert!(DialogKind::SignIn.signs_in() && DialogKind::Certificate.signs_in());
        assert!(!DialogKind::Prompt.signs_in());
    }

    #[test]
    fn the_stubs_touch_nothing_but_print_and_the_pickers() {
        assert!(STUBS.contains("'print'"));
        assert!(STUBS.contains("'showPicker'"));
        assert!(!STUBS.contains("alert"));
    }
}
