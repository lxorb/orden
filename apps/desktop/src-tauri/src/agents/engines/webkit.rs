//! An agent's page on `WKWebView` (#1092): the same [`Engine`] every browser verb goes
//! through, on a Mac.
//!
//! **The page.** A child `WKWebView` of the reader's window, placed outside the window's
//! content the way `WebView2`'s is (`tabs.rs`): measured to run at the window's own rate
//! there (docs/agent-native.md 12.2), clipped to the window, so no pixel of it reaches a
//! screen. It is a webview of the app's, so the window's own calls - its address, closing
//! it, showing it to the reader - are the same as for any.
//!
//! **Quiet, and Orden's own.** Before it loads anything the runtime's scripts and its
//! message channel are taken out of it, and it gets a navigation delegate and a UI
//! delegate of Orden's own in place of wry's, so nothing a page does reaches the reader:
//!
//! | the page | here |
//! | --- | --- |
//! | `alert`, `confirm`, `prompt` | held for `browser_dialog`, or 30 s (`quiet`) |
//! | the site's sign-in box | held like a dialog; a client certificate is declined |
//! | a window | another agent tab of the same agent, at the address it asked for |
//! | `window.close()` | the agent tab closed |
//! | the camera, the microphone, the motion sensors | refused |
//! | a file chooser | refused, and said to the agent: `browser_upload` cannot be done here |
//! | a download | into `Downloads/nib agents/<agent>` through `WKDownload`, 500 MB at most |
//! | `print()`, `showPicker()` | nothing (`quiet::STUBS`, in the page's world) |
//!
//! A frame's navigation is judged as a frame's (`web_tabs::frame_may_open`, as #1093's
//! delegate does for a reader's tab), and the page's own as the agent's (`tabs::may_open`).
//!
//! **Asking the page.** Every question is a script in a world of nib's own
//! (`web_worlds::WORLD`, a `WKContentWorld`) through `callAsyncJavaScript`, which runs on
//! the main thread and answers there; a verb waits for it on its own thread, and stops
//! waiting when the page raises a dialog - a page holding one runs nothing - or the stop
//! is pressed.

use std::cell::RefCell;
use std::collections::HashMap;
use std::ffi::c_void;
use std::sync::atomic::Ordering;
use std::sync::mpsc::{channel, sync_channel, Receiver, Sender};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use block2::{DynBlock, RcBlock};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool, NSObject, ProtocolObject};
use objc2::{define_class, msg_send, DefinedClass, MainThreadOnly};
use objc2_foundation::{
    MainThreadMarker, NSError, NSHTTPURLResponse, NSObjectProtocol, NSString,
    NSURLAuthenticationChallenge, NSURLCredential, NSURLCredentialPersistence, NSURLRequest,
    NSURLResponse, NSURLSessionAuthChallengeDisposition, NSURL,
};
use objc2_web_kit::{
    WKContentWorld, WKDownload, WKDownloadDelegate, WKFrameInfo, WKMediaCaptureType, WKNavigation,
    WKNavigationAction, WKNavigationActionPolicy, WKNavigationDelegate, WKNavigationResponse,
    WKNavigationResponsePolicy, WKOpenPanelParameters, WKPermissionDecision, WKSecurityOrigin,
    WKUIDelegate, WKUserScript, WKUserScriptInjectionTime, WKWebView, WKWebViewConfiguration,
    WKWindowFeatures,
};
use serde_json::{json, Map, Value};
use tauri::webview::PlatformWebview;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Url, WebviewBuilder, WebviewUrl};

use super::{refused, Engine, Gate, Page, Tree, View, SETTLED};
use crate::agents::keys::Key;
use crate::agents::policy::Facts;
use crate::agents::quiet::{self, Owner, Said};
use crate::agents::snapshot::Wanted;
use crate::agents::verbs::{
    Answer, Code, ConsoleLines, Cookie, Dialog, DialogKind, Download, DownloadState, FieldValue,
    Match, Moment, Picture, ReadAs, Requests, Until,
};
use crate::pdf::PdfPage;

/// Where an agent's page sits in the window's own coordinates: far past its corner, as on
/// `WebView2` (`tabs.rs`).
const AWAY: f64 = -10_000.0;

/// How long one script may take to answer before the call gives up on it.
const PATIENCE: Duration = Duration::from_secs(10);

/// How long an act waits for a navigation it may have started to begin, for its load, and
/// for the document to be still; the same as the `DevTools` Protocol's (`page.rs`).
const NAVIGATION_STARTS: Duration = Duration::from_millis(50);
const SETTLES: Duration = Duration::from_secs(3);
const STILL: Duration = Duration::from_millis(80);

/// How long the page has to have fetched nothing new to be idle on the network.
const QUIET: Duration = Duration::from_millis(500);

/// The name wry registers its message channel under, which the page's `window.ipc` posts
/// to; taken out of an agent's page, as out of a reader's (`web_worlds.rs`).
const CHANNEL: &str = "ipc";

/// The keys the delegates are kept under on their webview. Their addresses are the keys.
static KEPT_NAVIGATION: u8 = 0;
static KEPT_UI: u8 = 0;
static KEPT_DOWNLOAD: u8 = 0;

/// An element, resolved from a ref.
#[derive(Clone, Debug)]
pub struct Element {
    /// The node.
    pub backend: u64,
}

/// What is kept about one agent page as the engine tells it.
#[derive(Default)]
struct Heard {
    /// Navigations of the page's own frame that started.
    navigations: u64,
    /// Navigations of the page's own frame that ended, loaded or failed.
    loads: u64,
    /// Why the last navigation that ended failed, and which end it was.
    failed: Option<(u64, String)>,
    /// The agent tabs the page opened since the last act answered.
    opened: Vec<String>,
}

/// Every agent page's, by label.
static HEARD: Mutex<Option<HashMap<String, Heard>>> = Mutex::new(None);

fn heard<T>(label: &str, read: impl FnOnce(&mut Heard) -> T) -> T {
    let mut all = HEARD.lock().unwrap_or_else(PoisonError::into_inner);
    read(
        all.get_or_insert_with(HashMap::new)
            .entry(label.to_string())
            .or_default(),
    )
}

/// Forgets what is kept about a page that closed.
pub fn forget(label: &str) {
    if let Some(all) = HEARD
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_mut()
    {
        all.remove(label);
    }
}

/// Notes a tab a page opened, for the answer to the act that opened it.
pub fn opened(label: &str, tab: &str) {
    heard(label, |one| one.opened.push(tab.to_string()));
}

/// Builds an agent's page out of sight and quiet, and sends it to `address` - or leaves
/// it on nothing, for a window a page asked for. Waits for the build.
pub fn build(
    app: &AppHandle,
    owner: &Owner,
    store: Option<&str>,
    (width, height): (u32, u32),
    address: Option<&str>,
) -> Result<(), String> {
    let window = crate::agents::shell::host(app)
        .ok_or("Orden has no window for an agent's tab to live in")?;
    let blank: Url = "about:blank"
        .parse()
        .map_err(|error| format!("no blank page: {error}"))?;
    let builder = WebviewBuilder::new(owner.label.clone(), WebviewUrl::External(blank))
        .focused(false)
        .devtools(false)
        .disable_drag_drop_handler();
    let builder = crate::engine::web_store(builder, app, store)?;

    forget(&owner.label);
    let (answered, answer) = sync_channel::<Result<(), String>>(1);
    let (building, owner, going) = (app.clone(), owner.clone(), address.map(str::to_string));
    app.run_on_main_thread(move || {
        let made = crate::engine::add_child(
            &window,
            builder,
            LogicalPosition::new(AWAY, AWAY),
            LogicalSize::new(f64::from(width), f64::from(height)),
        )
        .map_err(|error| format!("the page could not be built: {error}"));
        let made = made.and_then(|view| {
            view.with_webview(move |platform| set_up(&platform, &building, &owner, going))
                .map_err(|error| format!("the page could not be set up: {error}"))
        });
        let _ = answered.try_send(made);
    })
    .map_err(|error| format!("the window could not be reached: {error}"))?;

    answer
        .recv_timeout(crate::agents::tabs::BUILDING)
        .map_err(|_| "the page was never built".to_string())?
}

/// Quietens a page that is still on `about:blank` and sends it on: the runtime's scripts
/// and channel out, `quiet::STUBS` in the page's own world, Orden's delegates in place of
/// wry's. On the main thread, in the turn that built it, so none of it is too late.
#[allow(
    unsafe_code,
    reason = "a WKWebView's scripts and delegates are set through the Objective-C runtime"
)]
fn set_up(platform: &PlatformWebview, app: &AppHandle, owner: &Owner, going: Option<String>) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    // SAFETY: the pointer is the WKWebView wry built for this page, alive for as long as
    // the page is; this runs on the main thread, where it belongs.
    let Some(view) = (unsafe { Retained::retain(platform.inner().cast::<WKWebView>()) }) else {
        return;
    };
    // SAFETY: the view's own user content controller and delegates, on the main thread.
    // `WebKit` holds its delegates weakly, so each is kept alive by the view itself.
    unsafe {
        let content = view.configuration().userContentController();
        content.removeAllUserScripts();
        content.removeScriptMessageHandlerForName(&NSString::from_str(CHANNEL));
        let stubs = WKUserScript::initWithSource_injectionTime_forMainFrameOnly_inContentWorld(
            WKUserScript::alloc(mtm),
            &NSString::from_str(quiet::STUBS),
            WKUserScriptInjectionTime::AtDocumentStart,
            false,
            &WKContentWorld::pageWorld(mtm),
        );
        content.addUserScript(&stubs);

        let navigation = Navigator::alloc(mtm).set_ivars(Held {
            app: app.clone(),
            owner: owner.clone(),
        });
        let navigation: Retained<Navigator> = msg_send![super(navigation), init];
        view.setNavigationDelegate(Some(ProtocolObject::from_ref(&*navigation)));
        keep(
            &view,
            &KEPT_NAVIGATION,
            Retained::as_ptr(&navigation).cast(),
        );

        let ui = Asker::alloc(mtm).set_ivars(Held {
            app: app.clone(),
            owner: owner.clone(),
        });
        let ui: Retained<Asker> = msg_send![super(ui), init];
        view.setUIDelegate(Some(ProtocolObject::from_ref(&*ui)));
        keep(&view, &KEPT_UI, Retained::as_ptr(&ui).cast());

        if let Some(address) = going
            .as_deref()
            .and_then(|url| NSURL::URLWithString(&NSString::from_str(url)))
        {
            let _ = view.loadRequest(&NSURLRequest::requestWithURL(&address));
        }
    }
}

/// Keeps an object alive for as long as `owner` is, under `key`.
#[allow(
    unsafe_code,
    reason = "an associated object is set through the Objective-C runtime"
)]
fn keep(owner: &NSObject, key: &'static u8, kept: *const AnyObject) {
    // SAFETY: both are live objects; the runtime retains `kept` for `owner`'s lifetime.
    unsafe {
        objc2::ffi::objc_setAssociatedObject(
            std::ptr::from_ref(owner).cast::<AnyObject>().cast_mut(),
            std::ptr::from_ref(key).cast::<c_void>(),
            kept.cast_mut(),
            objc2::ffi::OBJC_ASSOCIATION_RETAIN_NONATOMIC,
        );
    }
}

/// What both delegates hold: the app, and whose page it is.
struct Held {
    app: AppHandle,
    owner: Owner,
}

define_class!(
    /// An agent page's navigation delegate, Orden's own in place of wry's: where the page
    /// may go, what it fetched as a download, and how each navigation ended.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "NibAgentNavigation"]
    #[ivars = Held]
    struct Navigator;

    unsafe impl NSObjectProtocol for Navigator {}

    unsafe impl WKNavigationDelegate for Navigator {
        /// Where a navigation may go.
        #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
        fn decide_policy_for_navigation_action(
            &self,
            _webview: &WKWebView,
            action: &WKNavigationAction,
            decide: &DynBlock<dyn Fn(WKNavigationActionPolicy)>,
        ) {
            decide.call((going(self.ivars(), action),));
        }

        /// Whether a response is shown or downloaded.
        #[unsafe(method(webView:decidePolicyForNavigationResponse:decisionHandler:))]
        fn decide_policy_for_navigation_response(
            &self,
            _webview: &WKWebView,
            response: &WKNavigationResponse,
            decide: &DynBlock<dyn Fn(WKNavigationResponsePolicy)>,
        ) {
            decide.call((shown_or_downloaded(response),));
        }

        /// The page's own frame started a navigation.
        #[unsafe(method(webView:didStartProvisionalNavigation:))]
        fn did_start_provisional_navigation(
            &self,
            _webview: &WKWebView,
            _navigation: Option<&WKNavigation>,
        ) {
            let owner = &self.ivars().owner;
            heard(&owner.label, |one| one.navigations += 1);
            crate::agents::tabs::set(&owner.tab, |one| one.loading = true);
        }

        /// The page's own load ended.
        #[unsafe(method(webView:didFinishNavigation:))]
        fn did_finish_navigation(&self, webview: &WKWebView, _navigation: Option<&WKNavigation>) {
            ended(self.ivars(), webview, None);
        }

        /// A navigation failed before anything of it was shown.
        #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
        fn did_fail_provisional_navigation(
            &self,
            webview: &WKWebView,
            _navigation: Option<&WKNavigation>,
            error: &NSError,
        ) {
            ended(self.ivars(), webview, Some(error));
        }

        /// A navigation failed once its page had begun to be shown.
        #[unsafe(method(webView:didFailNavigation:withError:))]
        fn did_fail_navigation(
            &self,
            webview: &WKWebView,
            _navigation: Option<&WKNavigation>,
            error: &NSError,
        ) {
            ended(self.ivars(), webview, Some(error));
        }

        /// The site's sign-in box, or its request for a client certificate.
        #[unsafe(method(webView:didReceiveAuthenticationChallenge:completionHandler:))]
        fn did_receive_authentication_challenge(
            &self,
            webview: &WKWebView,
            challenge: &NSURLAuthenticationChallenge,
            answer: &DynBlock<dyn Fn(NSURLSessionAuthChallengeDisposition, *mut NSURLCredential)>,
        ) {
            challenged(self.ivars(), webview, challenge, answer);
        }

        /// A link or a script's navigation turned out to be a download.
        #[unsafe(method(webView:navigationAction:didBecomeDownload:))]
        fn action_became_download(
            &self,
            _webview: &WKWebView,
            action: &WKNavigationAction,
            download: &WKDownload,
        ) {
            let url = address_of(action);
            downloading(self.ivars(), download, url);
        }

        /// A response turned out to be a download.
        #[unsafe(method(webView:navigationResponse:didBecomeDownload:))]
        fn response_became_download(
            &self,
            _webview: &WKWebView,
            response: &WKNavigationResponse,
            download: &WKDownload,
        ) {
            let url = response_address(response);
            downloading(self.ivars(), download, url);
        }

        /// The page's process ended under it.
        #[unsafe(method(webViewWebContentProcessDidTerminate:))]
        fn web_content_process_did_terminate(&self, webview: &WKWebView) {
            let owner = &self.ivars().owner;
            heard(&owner.label, |one| {
                one.loads += 1;
                one.failed = Some((one.loads, "the page's process ended".into()));
            });
            reload(webview);
        }
    }
);

define_class!(
    /// An agent page's UI delegate, Orden's own in place of wry's: every way a page has of
    /// reaching a person, answered out of sight and said to the agent.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "NibAgentUi"]
    #[ivars = Held]
    struct Asker;

    unsafe impl NSObjectProtocol for Asker {}

    unsafe impl WKUIDelegate for Asker {
        /// `alert()`.
        #[unsafe(method(webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:))]
        fn alert(
            &self,
            _webview: &WKWebView,
            message: &NSString,
            frame: &WKFrameInfo,
            done: &DynBlock<dyn Fn()>,
        ) {
            held_dialog(
                self.ivars(),
                DialogKind::Alert,
                message.to_string(),
                None,
                frame_address(frame),
                Waiting::Alert(done.copy()),
            );
        }

        /// `confirm()`.
        #[unsafe(method(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:))]
        fn confirm(
            &self,
            _webview: &WKWebView,
            message: &NSString,
            frame: &WKFrameInfo,
            done: &DynBlock<dyn Fn(Bool)>,
        ) {
            held_dialog(
                self.ivars(),
                DialogKind::Confirm,
                message.to_string(),
                None,
                frame_address(frame),
                Waiting::Confirm(done.copy()),
            );
        }

        /// `prompt()`.
        #[unsafe(method(webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:))]
        fn prompt(
            &self,
            _webview: &WKWebView,
            message: &NSString,
            default_text: Option<&NSString>,
            frame: &WKFrameInfo,
            done: &DynBlock<dyn Fn(*mut NSString)>,
        ) {
            held_dialog(
                self.ivars(),
                DialogKind::Prompt,
                message.to_string(),
                Some(default_text.map(ToString::to_string).unwrap_or_default()),
                frame_address(frame),
                Waiting::Prompt(done.copy()),
            );
        }

        /// A file chooser: refused, and the agent told why.
        #[unsafe(method(webView:runOpenPanelWithParameters:initiatedByFrame:completionHandler:))]
        fn open_panel(
            &self,
            _webview: &WKWebView,
            _parameters: &WKOpenPanelParameters,
            _frame: &WKFrameInfo,
            done: &DynBlock<dyn Fn(*mut objc2_foundation::NSArray<NSURL>)>,
        ) {
            done.call((std::ptr::null_mut(),));
        }

        /// The camera or the microphone: refused.
        #[unsafe(method(webView:requestMediaCapturePermissionForOrigin:initiatedByFrame:type:decisionHandler:))]
        fn media_capture(
            &self,
            _webview: &WKWebView,
            _origin: &WKSecurityOrigin,
            _frame: &WKFrameInfo,
            _kind: WKMediaCaptureType,
            decide: &DynBlock<dyn Fn(WKPermissionDecision)>,
        ) {
            decide.call((WKPermissionDecision::Deny,));
        }

        /// The motion sensors: refused.
        #[unsafe(method(webView:requestDeviceOrientationAndMotionPermissionForOrigin:initiatedByFrame:decisionHandler:))]
        fn motion(
            &self,
            _webview: &WKWebView,
            _origin: &WKSecurityOrigin,
            _frame: &WKFrameInfo,
            decide: &DynBlock<dyn Fn(WKPermissionDecision)>,
        ) {
            decide.call((WKPermissionDecision::Deny,));
        }

        /// A window the page asked for: another agent tab of the same agent.
        #[unsafe(method(webView:createWebViewWithConfiguration:forNavigationAction:windowFeatures:))]
        fn create_web_view(
            &self,
            _webview: &WKWebView,
            _configuration: &WKWebViewConfiguration,
            action: &WKNavigationAction,
            _features: &WKWindowFeatures,
        ) -> *mut WKWebView {
            if let Some(url) = address_of(action) {
                let held = self.ivars();
                crate::agents::tabs::open_popup(&held.app, &held.owner, &url);
            }
            std::ptr::null_mut()
        }

        /// `window.close()`: the agent tab closed.
        #[unsafe(method(webViewDidClose:))]
        fn did_close(&self, _webview: &WKWebView) {
            let held = self.ivars();
            let (app, tab) = (held.app.clone(), held.owner.tab.clone());
            // After this turn of the loop: the page is still inside its own call.
            std::thread::spawn(move || crate::agents::tabs::close(&app, &tab));
        }
    }
);

define_class!(
    /// An agent's download: where it goes, and how it ended.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "NibAgentDownload"]
    #[ivars = Fetching]
    struct Fetcher;

    unsafe impl NSObjectProtocol for Fetcher {}

    unsafe impl WKDownloadDelegate for Fetcher {
        /// Where the file goes: the agent's own folder, or nowhere past 500 MB.
        #[unsafe(method(download:decideDestinationUsingResponse:suggestedFilename:completionHandler:))]
        fn decide_destination(
            &self,
            _download: &WKDownload,
            response: &NSURLResponse,
            suggested: &NSString,
            done: &DynBlock<dyn Fn(*mut NSURL)>,
        ) {
            destined(self.ivars(), response, &suggested.to_string(), done);
        }

        /// The file is in the folder.
        #[unsafe(method(downloadDidFinish:))]
        fn did_finish(&self, _download: &WKDownload) {
            finished_download(self.ivars(), DownloadState::Done);
        }

        /// It stopped, and there is no file.
        #[unsafe(method(download:didFailWithError:resumeData:))]
        fn did_fail(
            &self,
            _download: &WKDownload,
            _error: &NSError,
            _resume: Option<&objc2_foundation::NSData>,
        ) {
            finished_download(self.ivars(), DownloadState::Failed);
        }
    }
);

/// What a download's delegate holds.
struct Fetching {
    app: AppHandle,
    owner: Owner,
    url: String,
    path: RefCell<Option<String>>,
}

/// Where a navigation may go: the page's own frame as the agent's grant says
/// (`tabs::may_open`), a frame as a frame (`web_tabs::frame_may_open`), and what the page
/// asked to download, downloaded.
#[allow(
    unsafe_code,
    reason = "a navigation action is read through the Objective-C runtime"
)]
fn going(held: &Held, action: &WKNavigationAction) -> WKNavigationActionPolicy {
    // SAFETY: the engine's own action, read on the main thread during its own call.
    let (frame, downloads) = unsafe {
        (
            action.targetFrame().is_some_and(|one| !one.isMainFrame()),
            action.shouldPerformDownload(),
        )
    };
    if downloads {
        return WKNavigationActionPolicy::Download;
    }
    let Some(url) = address_of(action) else {
        return WKNavigationActionPolicy::Allow;
    };
    if frame {
        return if Url::parse(&url).is_ok_and(|one| crate::web_tabs::frame_may_open(&one)) {
            WKNavigationActionPolicy::Allow
        } else {
            WKNavigationActionPolicy::Cancel
        };
    }
    if url == "about:blank" {
        return WKNavigationActionPolicy::Allow;
    }
    match crate::agents::tabs::may_open(&held.owner, &url) {
        Ok(()) => WKNavigationActionPolicy::Allow,
        Err(why) => {
            heard(&held.owner.label, |one| {
                one.failed = Some((
                    one.loads + 1,
                    format!("Orden stopped the page going to {url}: {why}"),
                ));
            });
            WKNavigationActionPolicy::Cancel
        }
    }
}

/// A response the engine cannot show, or one the site says is an attachment, is a
/// download; anything else is shown.
fn shown_or_downloaded(response: &WKNavigationResponse) -> WKNavigationResponsePolicy {
    #[allow(
        unsafe_code,
        reason = "a navigation response is read through the Objective-C runtime"
    )]
    // SAFETY: the engine's own response, read on the main thread during its own call.
    let (main, showable, answer) = unsafe {
        (
            response.isForMainFrame(),
            response.canShowMIMEType(),
            response.response(),
        )
    };
    let attachment = answer
        .downcast_ref::<NSHTTPURLResponse>()
        .and_then(|http| http.valueForHTTPHeaderField(&NSString::from_str("Content-Disposition")))
        .is_some_and(|said| {
            said.to_string()
                .trim()
                .to_lowercase()
                .starts_with("attachment")
        });
    if main && (!showable || attachment) {
        WKNavigationResponsePolicy::Download
    } else {
        WKNavigationResponsePolicy::Allow
    }
}

/// A navigation of the page's own frame ended: counted, its failure kept, and the tab's
/// address and title told to the window.
#[allow(
    unsafe_code,
    reason = "the view's address and title are read through the Objective-C runtime"
)]
fn ended(held: &Held, webview: &WKWebView, error: Option<&NSError>) {
    let owner = &held.owner;
    // A navigation this delegate cancelled, or one a newer one replaced, is no failure
    // of the page's: `NSURLErrorCancelled`, and WebKit's "frame load interrupted".
    let failure = error
        .filter(|one| {
            let domain = one.domain().to_string();
            !((domain == "NSURLErrorDomain" && one.code() == -999)
                || (domain == "WebKitErrorDomain" && one.code() == 102))
        })
        .map(|one| one.localizedDescription().to_string());
    heard(&owner.label, |one| {
        one.loads += 1;
        if let Some(why) = failure {
            one.failed = Some((one.loads, format!("the page could not be reached: {why}")));
        }
    });
    // SAFETY: the view's own address and title, read on the main thread.
    let (url, title) = unsafe {
        (
            webview
                .URL()
                .and_then(|one| one.absoluteString())
                .map(|one| one.to_string()),
            webview.title().map(|one| one.to_string()),
        )
    };
    crate::agents::tabs::set(&owner.tab, |one| {
        one.loading = false;
        if let Some(url) = url.filter(|one| one != "about:blank") {
            one.url = url;
        }
        if let Some(title) = title {
            one.title = title;
        }
    });
    if let Some(tab) = crate::agents::tabs::of(&owner.agent)
        .into_iter()
        .find(|one| one.id == owner.tab)
    {
        crate::agents::tabs::said(&held.app, &tab);
    }
}

/// Loads the page again after its process ended.
#[allow(
    unsafe_code,
    reason = "a reload is asked of the view through the Objective-C runtime"
)]
fn reload(webview: &WKWebView) {
    // SAFETY: a reload asked of the view on the main thread.
    let _ = unsafe { webview.reload() };
}

/// The address a navigation action goes to.
#[allow(
    unsafe_code,
    reason = "a navigation action's request is read through the Objective-C runtime"
)]
fn address_of(action: &WKNavigationAction) -> Option<String> {
    // SAFETY: the engine's own action, read on the main thread.
    unsafe { action.request().URL() }
        .and_then(|url| url.absoluteString())
        .map(|url| url.to_string())
}

/// The address a navigation response came from.
#[allow(
    unsafe_code,
    reason = "a navigation response is read through the Objective-C runtime"
)]
fn response_address(response: &WKNavigationResponse) -> Option<String> {
    // SAFETY: the engine's own response, read on the main thread.
    unsafe { response.response() }
        .URL()
        .and_then(|url| url.absoluteString())
        .map(|url| url.to_string())
}

/// The address of the frame that raised a dialog.
#[allow(
    unsafe_code,
    reason = "a frame is read through the Objective-C runtime"
)]
fn frame_address(frame: &WKFrameInfo) -> String {
    // SAFETY: the engine's own frame, read on the main thread.
    unsafe { frame.request().URL() }
        .and_then(|url| url.absoluteString())
        .map(|url| url.to_string())
        .unwrap_or_default()
}

/// A download, given a delegate of Orden's own that the download keeps alive.
#[allow(
    unsafe_code,
    reason = "a download's delegate is set through the Objective-C runtime"
)]
fn downloading(held: &Held, download: &WKDownload, url: Option<String>) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let fetcher = Fetcher::alloc(mtm).set_ivars(Fetching {
        app: held.app.clone(),
        owner: held.owner.clone(),
        url: url.unwrap_or_default(),
        path: RefCell::new(None),
    });
    // SAFETY: a new object of this module's own class, initialised as `NSObject` is; the
    // download holds its delegate weakly, so it keeps this one itself.
    unsafe {
        let fetcher: Retained<Fetcher> = msg_send![super(fetcher), init];
        download.setDelegate(Some(ProtocolObject::from_ref(&*fetcher)));
        keep(download, &KEPT_DOWNLOAD, Retained::as_ptr(&fetcher).cast());
    }
}

/// Where a download goes, and whether it may at all.
#[allow(
    unsafe_code,
    reason = "a download's answer is a block the engine handed over"
)]
fn destined(
    fetching: &Fetching,
    response: &NSURLResponse,
    suggested: &str,
    done: &DynBlock<dyn Fn(*mut NSURL)>,
) {
    let agent = &fetching.owner.agent;
    let size = response.expectedContentLength();
    let place = quiet::destination(&fetching.app, agent, suggested);
    let note = |path: String, state: DownloadState| {
        quiet::noted(
            agent,
            Download {
                tab: fetching.owner.tab.clone(),
                url: fetching.url.clone(),
                path,
                state,
            },
        );
    };
    let Some(place) = place else {
        note(String::new(), DownloadState::Failed);
        done.call((std::ptr::null_mut(),));
        return;
    };
    let path = place.to_string_lossy().into_owned();
    if size > quiet::MOST_DOWNLOAD {
        note(path, DownloadState::TooLarge);
        done.call((std::ptr::null_mut(),));
        return;
    }
    note(path.clone(), DownloadState::Going);
    *fetching.path.borrow_mut() = Some(path.clone());
    let url = NSURL::fileURLWithPath(&NSString::from_str(&path));
    done.call((Retained::as_ptr(&url).cast_mut(),));
}

/// A download ended.
fn finished_download(fetching: &Fetching, state: DownloadState) {
    if let Some(path) = fetching.path.borrow().as_deref() {
        quiet::moved(&fetching.owner.agent, path, state);
    }
}

/// The site's sign-in box, held for the agent like a dialog; a client certificate is
/// declined, so the site goes on without one; anything else is the engine's own.
#[allow(
    unsafe_code,
    reason = "an authentication challenge is read through the Objective-C runtime"
)]
fn challenged(
    held: &Held,
    webview: &WKWebView,
    challenge: &NSURLAuthenticationChallenge,
    answer: &DynBlock<dyn Fn(NSURLSessionAuthChallengeDisposition, *mut NSURLCredential)>,
) {
    let space = challenge.protectionSpace();
    let method = space.authenticationMethod().to_string();
    match method.as_str() {
        "NSURLAuthenticationMethodHTTPBasic"
        | "NSURLAuthenticationMethodHTTPDigest"
        | "NSURLAuthenticationMethodNTLM" => {
            // A sign-in the agent already answered wrong is not asked again.
            if challenge.previousFailureCount() > 0 && held_answered(&held.owner.label) {
                answer.call((
                    NSURLSessionAuthChallengeDisposition::CancelAuthenticationChallenge,
                    std::ptr::null_mut(),
                ));
                return;
            }
            let realm = space.realm().map(|one| one.to_string()).unwrap_or_default();
            // SAFETY: the view's own address, read on the main thread.
            let url = unsafe { webview.URL() }
                .and_then(|one| one.absoluteString())
                .map(|one| one.to_string())
                .unwrap_or_default();
            held_dialog(
                held,
                DialogKind::SignIn,
                quiet::signing_in(&realm),
                None,
                url,
                Waiting::SignIn(answer.copy()),
            );
        }
        "NSURLAuthenticationMethodClientCertificate" => answer.call((
            NSURLSessionAuthChallengeDisposition::RejectProtectionSpace,
            std::ptr::null_mut(),
        )),
        _ => answer.call((
            NSURLSessionAuthChallengeDisposition::PerformDefaultHandling,
            std::ptr::null_mut(),
        )),
    }
}

/// What the engine waits on for a held dialog.
enum Waiting {
    /// `alert()`.
    Alert(RcBlock<dyn Fn()>),
    /// `confirm()`.
    Confirm(RcBlock<dyn Fn(Bool)>),
    /// `prompt()`.
    Prompt(RcBlock<dyn Fn(*mut NSString)>),
    /// The site's sign-in box.
    SignIn(RcBlock<dyn Fn(NSURLSessionAuthChallengeDisposition, *mut NSURLCredential)>),
}

thread_local! {
    /// The dialogs' answers waiting, by label, on the main thread; and the labels whose
    /// last sign-in the agent answered.
    static WAITING: RefCell<HashMap<String, (u64, Waiting)>> = RefCell::new(HashMap::new());
    static SIGNED: RefCell<Vec<String>> = const { RefCell::new(Vec::new()) };
}

fn held_answered(label: &str) -> bool {
    SIGNED.with_borrow(|all| all.iter().any(|one| one == label))
}

/// A dialog held for the agent, on the main thread: the engine's answer kept here, what
/// the agent is told kept for `quiet::dialog_of`, and answered the safe way if nobody
/// answers in time - an alert read, anything else no.
fn held_dialog(
    held: &Held,
    kind: DialogKind,
    message: String,
    default_text: Option<String>,
    url: String,
    waiting: Waiting,
) {
    let label = held.owner.label.clone();
    let number = quiet::NUMBER.fetch_add(1, Ordering::Relaxed);
    // One dialog at a time, as an engine holds them: one left over is answered no.
    if let Some((_, old)) =
        WAITING.with_borrow_mut(|all| all.insert(label.clone(), (number, waiting)))
    {
        answered(old, &Said::only(false));
    }
    quiet::hold(
        &label,
        Dialog {
            kind,
            message: super::cut(message, 4_000),
            default_text,
            url,
            open_ms: 0,
        },
    );
    let late = held.app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(quiet::DIALOG_PATIENCE);
        let named = label.clone();
        let _ = late.run_on_main_thread(move || {
            settle(&named, Some(number), &Said::only(kind == DialogKind::Alert));
        });
    });
}

/// Gives the engine its answer to a held dialog, on the main thread: the one with
/// `number` when named, whichever is held otherwise.
fn settle(label: &str, number: Option<u64>, said: &Said) {
    let taken = WAITING.with_borrow_mut(|all| {
        let matches = all
            .get(label)
            .is_some_and(|(held, _)| number.is_none_or(|one| one == *held));
        if matches {
            all.remove(label)
        } else {
            None
        }
    });
    let Some((_, waiting)) = taken else {
        return;
    };
    if matches!(waiting, Waiting::SignIn(_)) {
        SIGNED.with_borrow_mut(|all| {
            all.retain(|one| one != label);
            if said.accept {
                all.push(label.to_string());
            }
        });
    }
    quiet::release(label);
    answered(waiting, said);
}

/// The engine told the answer.
fn answered(waiting: Waiting, said: &Said) {
    match waiting {
        Waiting::Alert(done) => done.call(()),
        Waiting::Confirm(done) => done.call((Bool::new(said.accept),)),
        Waiting::Prompt(done) => {
            if said.accept {
                let words = NSString::from_str(said.text.as_deref().unwrap_or_default());
                done.call((Retained::as_ptr(&words).cast_mut(),));
            } else {
                done.call((std::ptr::null_mut(),));
            }
        }
        Waiting::SignIn(done) => match (said.accept, &said.username, &said.password) {
            (true, Some(user), Some(password)) => {
                let credential = NSURLCredential::credentialWithUser_password_persistence(
                    &NSString::from_str(user),
                    &NSString::from_str(password),
                    NSURLCredentialPersistence::ForSession,
                );
                done.call((
                    NSURLSessionAuthChallengeDisposition::UseCredential,
                    Retained::as_ptr(&credential).cast_mut(),
                ));
            }
            _ => done.call((
                NSURLSessionAuthChallengeDisposition::CancelAuthenticationChallenge,
                std::ptr::null_mut(),
            )),
        },
    }
}

/// Answers the dialog a page is holding, from any thread; the answer is given on the main
/// thread.
pub fn answer_dialog(app: &AppHandle, label: &str, said: Said) -> Result<(), String> {
    if matches!(
        quiet::dialog_of(label).map(|one| one.kind),
        Some(DialogKind::SignIn)
    ) && said.accept
        && (said.username.is_none() || said.password.is_none())
    {
        return Err("a sign-in box is answered with username and password".into());
    }
    let named = label.to_string();
    app.run_on_main_thread(move || settle(&named, None, &said))
        .map_err(|error| error.to_string())
}

/// The webview a view is, on a Mac: always one of the app's.
fn webview_of(view: &View) -> &tauri::Webview {
    match view {
        View::Webview(one) => one,
    }
}

/// Runs `work` on the main thread with the page's `WKWebView`, and waits for what it
/// sends back - at once, or later from a completion the engine calls. Stops waiting at
/// `most`, when the page raises a dialog, or when the stop is pressed.
#[allow(
    unsafe_code,
    reason = "the page's WKWebView is reached through the pointer wry hands out"
)]
fn on_main<T: Send + 'static>(
    page: &Page<'_>,
    most: Duration,
    work: impl FnOnce(&WKWebView, Sender<T>) + Send + 'static,
) -> Result<T, Answer> {
    let (said, heard) = channel();
    webview_of(page.view)
        .with_webview(move |platform| {
            // SAFETY: the pointer is the WKWebView wry built for this page, alive for as
            // long as the page is; this runs on the main thread.
            if let Some(view) = unsafe { Retained::retain(platform.inner().cast::<WKWebView>()) } {
                work(&view, said);
            }
        })
        .map_err(|error| Answer::error(Code::Failed, format!("the page is gone: {error}")))?;
    waited(page, &heard, most)
}

/// Waits for an answer on its own thread, as `on_main` says.
fn waited<T>(page: &Page<'_>, heard: &Receiver<T>, most: Duration) -> Result<T, Answer> {
    let started = Instant::now();
    loop {
        match heard.recv_timeout(Duration::from_millis(50)) {
            Ok(one) => return Ok(one),
            Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => {
                return Err(Answer::error(Code::Failed, "the page did not answer"))
            }
            Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {}
        }
        if quiet::dialog_of(&page.label).is_some() {
            return Err(Answer::error(
                Code::Failed,
                "the page is holding a dialog: answer it with browser_dialog",
            ));
        }
        if crate::agents::stop::cancelled(page.since) {
            return Err(Answer::error(Code::Stopped, "the reader pressed the stop"));
        }
        if started.elapsed() >= most {
            return Err(Answer::error(
                Code::Timeout,
                format!("the page did not answer in {} ms", most.as_millis()),
            ));
        }
    }
}

/// A function body run in the page - in nib's own world, or the page's - answering what
/// it returns, as JSON. Its `await`s are waited for.
#[allow(
    unsafe_code,
    reason = "a script is run in the page through the Objective-C runtime"
)]
fn run(page: &Page<'_>, body: &str, page_world: bool) -> Result<Value, Answer> {
    let wrapped = format!(
        "const nibAnswer = await (async () => {{\n{body}\n}})();\nreturn JSON.stringify(nibAnswer === undefined ? null : nibAnswer);"
    );
    let said = on_main(
        page,
        PATIENCE,
        move |view, said: Sender<Result<String, String>>| {
            let Some(mtm) = MainThreadMarker::new() else {
                return;
            };
            let world = if page_world {
                // SAFETY: the page's own world, asked for on the main thread.
                unsafe { WKContentWorld::pageWorld(mtm) }
            } else {
                // SAFETY: nib's own world, asked for by name on the main thread.
                unsafe {
                    WKContentWorld::worldWithName(
                        &NSString::from_str(crate::web_worlds::WORLD),
                        mtm,
                    )
                }
            };
            let done = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
                // SAFETY: the engine's own answer, alive for this call, on the main thread.
                let answer = unsafe {
                    if let Some(error) = error.as_ref() {
                        Err(thrown(error))
                    } else {
                        Ok(value
                            .as_ref()
                            .and_then(|one| one.downcast_ref::<NSString>())
                            .map_or_else(|| "null".into(), ToString::to_string))
                    }
                };
                let _ = said.send(answer);
            });
            // SAFETY: a script run in the view on the main thread, its answer handed to a
            // block the engine copies.
            unsafe {
                view.callAsyncJavaScript_arguments_inFrame_inContentWorld_completionHandler(
                    &NSString::from_str(&wrapped),
                    None,
                    None,
                    &world,
                    Some(&done),
                );
            }
        },
    )?;
    match said {
        Ok(text) => Ok(serde_json::from_str(&text).unwrap_or(Value::String(text))),
        Err(why) => Err(Answer::error(
            Code::Failed,
            format!("the script threw: {}", super::cut(why, 2_000)),
        )),
    }
}

/// What a script that threw says: the page's exception, or the engine's reason.
#[allow(
    unsafe_code,
    reason = "an error's details are read through the Objective-C runtime"
)]
fn thrown(error: &NSError) -> String {
    let info = error.userInfo();
    let message = info
        .objectForKey(&NSString::from_str("WKJavaScriptExceptionMessage"))
        .and_then(|one| one.downcast::<NSString>().ok())
        .map(|one| one.to_string());
    message.unwrap_or_else(|| error.localizedDescription().to_string())
}

/// An expression run in nib's own world.
fn isolated(page: &Page<'_>, expression: &str) -> Result<Value, Answer> {
    run(page, &format!("return ({expression});"), false)
}

/// Waits for a navigation of the page's own frame to end after `loads` had, up to `most`.
fn loaded_after(page: &Page<'_>, loads: u64, most: Duration) {
    let started = Instant::now();
    while started.elapsed() < most && !interrupted(page) {
        if heard(&page.label, |one| one.loads) > loads {
            return;
        }
        std::thread::sleep(Duration::from_millis(25));
    }
}

/// Whether a wait should end early: the stop, or a dialog the page is holding.
fn interrupted(page: &Page<'_>) -> bool {
    crate::agents::stop::cancelled(page.since) || quiet::dialog_of(&page.label).is_some()
}

/// The failure of the navigation that ended after `loads`, if it failed.
fn failure_after(page: &Page<'_>, loads: u64) -> Option<String> {
    heard(&page.label, |one| {
        one.failed
            .as_ref()
            .filter(|(at, _)| *at > loads)
            .map(|(_, why)| why.clone())
    })
}

/// Sends the view somewhere, on the main thread.
#[allow(
    unsafe_code,
    reason = "a load is asked of the view through the Objective-C runtime"
)]
fn load(view: &WKWebView, url: &str) -> bool {
    let Some(address) = NSURL::URLWithString(&NSString::from_str(url)) else {
        return false;
    };
    // SAFETY: a load asked of the view on the main thread.
    let _ = unsafe { view.loadRequest(&NSURLRequest::requestWithURL(&address)) };
    true
}

/// One step along the view's history, or the same page again; whether there was one.
#[allow(
    unsafe_code,
    reason = "history is asked of the view through the Objective-C runtime"
)]
fn stepped(view: &WKWebView, by: i64) -> bool {
    // SAFETY: the view's own history, asked on the main thread.
    unsafe {
        match by {
            0 => view.reload().is_some(),
            1.. => view.canGoForward() && view.goForward().is_some(),
            _ => view.canGoBack() && view.goBack().is_some(),
        }
    }
}

/// How many resources the page has fetched, and whether it has loaded: the road to
/// "network idle" on an engine that says nothing of its requests.
const FETCHED: &str = "({ loaded: document.readyState === 'complete', fetched: performance.getEntriesByType('resource').length })";

impl Engine for Page<'_> {
    fn wake(&self) {}

    fn url(&self) -> String {
        self.view.url()
    }

    fn title(&self) -> String {
        isolated(self, "document.title")
            .ok()
            .and_then(|one| one.as_str().map(str::to_string))
            .unwrap_or_default()
    }

    fn element(&self, _reference: &str) -> Result<Element, Answer> {
        Err(refused("browser_snapshot"))
    }

    fn element_at(&self, _point: (f64, f64)) -> Result<Element, Answer> {
        Err(refused("browser_click"))
    }

    fn facts(&self, _element: &Element) -> Result<Facts, Answer> {
        Err(refused("browser_click"))
    }

    fn active_facts(&self) -> Result<Option<Facts>, Answer> {
        Err(refused("browser_press"))
    }

    fn facts_of_press(&self, _element: &Element) -> Result<Facts, Answer> {
        Err(refused("browser_click"))
    }

    fn at_first_point(&self, _element: &Element) -> Result<Element, Answer> {
        Err(refused("browser_click"))
    }

    fn aimed(&self, _element: &Element) -> Result<Element, Answer> {
        Err(refused("browser_click"))
    }

    fn may_act_in(&self, facts: &Facts) -> Result<(), Answer> {
        self.frame_may_be_acted_in(facts)
    }

    fn limits_sites(&self) -> bool {
        self.grant_limits_sites()
    }

    fn tick_changes(&self, _element: &Element, _wanted: bool) -> Result<bool, Answer> {
        Err(refused("browser_fill_form"))
    }

    fn navigate(&self, url: &str) -> Result<(), Answer> {
        let loads = heard(&self.label, |one| one.loads);
        let address = url.to_string();
        let sent = on_main(self, PATIENCE, move |view, said| {
            let _ = said.send(load(view, &address));
        })?;
        if !sent {
            return Err(Answer::error(
                Code::BadArguments,
                format!("{url} is not an address"),
            ));
        }
        loaded_after(self, loads, Duration::from_secs(10));
        match failure_after(self, loads) {
            Some(why) => Err(Answer::error(Code::Failed, why)),
            None => Ok(()),
        }
    }

    fn step(&self, by: i64) -> Result<(), Answer> {
        // The tab's history is the reader's too, and goes through sites they may reach and
        // the agent may not: the DevTools page asks the grant of the entry before it steps.
        // Here that entry's address is not read yet, so an agent does not step at all.
        if self.limits.is_some() {
            return Err(Answer::error(
                Code::UnsupportedOnThisEngine,
                "browser_back and browser_forward are not available to an agent on WKWebView yet: where history goes cannot be put to the grant first",
            ));
        }
        let loads = heard(&self.label, |one| one.loads);
        let went = on_main(self, PATIENCE, move |view, said| {
            let _ = said.send(stepped(view, by));
        })?;
        if !went {
            return Err(Answer::error(
                Code::BadArguments,
                "there is nowhere to step to",
            ));
        }
        loaded_after(self, loads, Duration::from_secs(10));
        Ok(())
    }

    fn wait(&self, until: &Until, most: Duration) -> Result<u64, Answer> {
        let started = Instant::now();
        // For the network: how many resources the page had fetched, and since when.
        let mut fetched: Option<(u64, Instant)> = None;
        loop {
            let done = match until {
                Until::Moment(Moment::Load) => isolated(self, "document.readyState")
                    .is_ok_and(|state| state.as_str() == Some("complete")),
                Until::Moment(Moment::NetworkIdle) => {
                    let now = isolated(self, FETCHED).unwrap_or_default();
                    let count = now.get("fetched").and_then(Value::as_u64).unwrap_or(0);
                    let loaded = now.get("loaded").and_then(Value::as_bool) == Some(true);
                    match fetched {
                        Some((was, _)) if was != count => fetched = Some((count, Instant::now())),
                        None => fetched = Some((count, Instant::now())),
                        _ => {}
                    }
                    loaded && fetched.is_some_and(|(_, since)| since.elapsed() >= QUIET)
                }
                // The DevTools page asks again with the secret regions out (9.4), which is not
                // built here: an agent cannot wait for words on WKWebView yet.
                Until::Text { .. } if self.limits.is_some() => {
                    return Err(Answer::error(
                        Code::UnsupportedOnThisEngine,
                        "browser_wait for text is not available to an agent on WKWebView yet: a secret field's words cannot be left out of the look",
                    ))
                }
                Until::Text { text } => isolated(
                    self,
                    &format!(
                        "(document.body ? document.body.innerText : '').includes({})",
                        json!(text)
                    ),
                )
                .is_ok_and(|found| found.as_bool() == Some(true)),
                Until::Element { .. } => return Err(refused("browser_snapshot")),
                Until::Url { url } => self.view.url().contains(url.as_str()),
            };
            let spent = u64::try_from(started.elapsed().as_millis()).unwrap_or(u64::MAX);
            if done {
                return Ok(spent);
            }
            if crate::agents::stop::cancelled(self.since) {
                return Err(Answer::error(Code::Stopped, "the reader pressed the stop"));
            }
            if quiet::dialog_of(&self.label).is_some() {
                return Err(Answer::error(
                    Code::Failed,
                    "the page is holding a dialog: answer it with browser_dialog",
                ));
            }
            if started.elapsed() >= most {
                return Err(Answer::error(
                    Code::Timeout,
                    format!("not in {} ms", most.as_millis()),
                ));
            }
            std::thread::sleep(Duration::from_millis(100));
        }
    }

    fn settle(&self, navigations_before: u64) {
        let started = Instant::now();
        let navigated = loop {
            if heard(&self.label, |one| one.navigations) > navigations_before {
                break true;
            }
            if started.elapsed() >= NAVIGATION_STARTS || interrupted(self) {
                break false;
            }
            std::thread::sleep(Duration::from_millis(10));
        };
        if navigated {
            let loads = heard(&self.label, |one| one.loads);
            loaded_after(self, loads, SETTLES);
        }
        if interrupted(self) {
            return;
        }
        let _ = run(
            self,
            &format!(
                "return await ({SETTLED})({}, {});",
                STILL.as_millis(),
                SETTLES.as_millis()
            ),
            false,
        );
    }

    fn navigations(&self) -> u64 {
        heard(&self.label, |one| one.navigations)
    }

    fn opened(&self) -> Vec<String> {
        heard(&self.label, |one| std::mem::take(&mut one.opened))
    }

    fn hosts(&self) -> Vec<String> {
        Vec::new()
    }

    fn parts(&self) -> Result<Tree, Answer> {
        Err(refused("browser_snapshot"))
    }

    fn find(&self, _wanted: &Wanted<'_>) -> Result<Vec<Match>, Answer> {
        Err(refused("browser_find"))
    }

    fn read(&self, _app: &AppHandle, _shape: ReadAs) -> Result<(String, String, String), Answer> {
        Err(refused("browser_read"))
    }

    fn clip(&self) -> Result<(String, String, String), Answer> {
        Err(refused("capture_to_note"))
    }

    fn pdf(&self, _paper: &PdfPage) -> Result<String, Answer> {
        Err(refused("capture_to_note"))
    }

    fn click(
        &self,
        _element: &Element,
        _button: &str,
        _count: u8,
        _modifiers: u8,
        _gate: Gate<'_>,
    ) -> Result<(), Answer> {
        Err(refused("browser_click"))
    }

    fn click_at(
        &self,
        _point: (f64, f64),
        _judged: &Element,
        _button: &str,
        _count: u8,
        _modifiers: u8,
        _gate: Gate<'_>,
    ) -> Result<(), Answer> {
        Err(refused("browser_click"))
    }

    fn hover(&self, _element: &Element) -> Result<(), Answer> {
        Err(refused("browser_hover"))
    }

    fn type_text(&self, _element: &Element, _text: &str, _replace: bool) -> Result<(), Answer> {
        Err(refused("browser_type"))
    }

    fn press(&self, _key: &Key) -> Result<(), Answer> {
        Err(refused("browser_press"))
    }

    fn press_in_page(&self, _key: &Key) -> Result<(), Answer> {
        Err(refused("browser_press"))
    }

    fn scroll(&self, _element: Option<&Element>, _dx: f64, _dy: f64) -> Result<(), Answer> {
        Err(refused("browser_scroll"))
    }

    fn select(&self, _element: &Element, _values: &[String]) -> Result<Vec<String>, Answer> {
        Err(refused("browser_select"))
    }

    fn fill(&self, _element: &Element, _value: &FieldValue, _gate: Gate<'_>) -> Result<(), Answer> {
        Err(refused("browser_fill_form"))
    }

    fn drag(
        &self,
        _from: (&Element, &Element),
        _to: (&Element, &Element),
        _gates: (Gate<'_>, Gate<'_>),
    ) -> Result<(), Answer> {
        Err(refused("browser_drag"))
    }

    fn upload(&self, _element: &Element, _files: &[String], _gate: Gate<'_>) -> Result<(), Answer> {
        Err(refused("browser_upload"))
    }

    fn screenshot(
        &self,
        _element: Option<&Element>,
        _full: bool,
        _scale: Option<f64>,
    ) -> Result<Picture, Answer> {
        Err(refused("browser_screenshot"))
    }

    fn console(&self, _since: Option<u64>, _level: Option<&str>) -> Result<ConsoleLines, Answer> {
        Err(refused("browser_console"))
    }

    fn network(
        &self,
        _since: Option<u64>,
        _matching: Option<&str>,
        _bodies: bool,
    ) -> Result<Requests, Answer> {
        Err(refused("browser_network"))
    }

    fn evaluate(&self, _expression: &str, _page_world: bool) -> Result<Value, Answer> {
        Err(refused("browser_evaluate"))
    }

    fn cookies(&self) -> Result<Vec<Cookie>, Answer> {
        Err(refused("browser_storage"))
    }

    fn set_cookie(&self, _cookie: &Cookie) -> Result<(), Answer> {
        Err(refused("browser_storage"))
    }

    fn clear(&self) -> Result<(), Answer> {
        Err(refused("browser_storage"))
    }

    fn local(&self) -> Result<Map<String, Value>, Answer> {
        Err(refused("browser_storage"))
    }
}
