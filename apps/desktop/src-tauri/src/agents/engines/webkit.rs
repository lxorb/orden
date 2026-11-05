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
use std::ptr::NonNull;
use std::sync::atomic::Ordering;
use std::sync::mpsc::{channel, sync_channel, Receiver, Sender};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use base64::Engine as _;
use block2::{DynBlock, RcBlock};
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, Bool, NSObject, ProtocolObject};
use objc2::{define_class, msg_send, DefinedClass, MainThreadOnly, Message as _};
use objc2_app_kit::{
    NSBitmapImageFileType, NSBitmapImageRep, NSEvent, NSEventModifierFlags, NSEventType, NSImage,
    NSView, NSWindow,
};
use objc2_foundation::{
    MainThreadMarker, NSArray, NSData, NSDate, NSDictionary, NSError, NSHTTPCookie,
    NSHTTPCookieDomain, NSHTTPCookieExpires, NSHTTPCookieName, NSHTTPCookiePath,
    NSHTTPCookieSecure, NSHTTPCookieValue, NSHTTPURLResponse, NSMutableDictionary, NSNumber,
    NSObjectProtocol, NSPoint, NSProcessInfo, NSRect, NSSize, NSString,
    NSURLAuthenticationChallenge, NSURLCredential, NSURLCredentialPersistence, NSURLRequest,
    NSURLResponse, NSURLSessionAuthChallengeDisposition, NSURL,
};
use objc2_web_kit::{
    WKContentWorld, WKDownload, WKDownloadDelegate, WKFrameInfo, WKMediaCaptureType, WKNavigation,
    WKNavigationAction, WKNavigationActionPolicy, WKNavigationDelegate, WKNavigationResponse,
    WKNavigationResponsePolicy, WKOpenPanelParameters, WKPDFConfiguration, WKPermissionDecision,
    WKSecurityOrigin, WKSnapshotConfiguration, WKUIDelegate, WKUserScript,
    WKUserScriptInjectionTime, WKWebView, WKWebViewConfiguration, WKWebsiteDataRecord,
    WKWebsiteDataStore, WKWindowFeatures,
};
use serde_json::{json, Map, Value};
use tauri::webview::PlatformWebview;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Url, WebviewBuilder, WebviewUrl};

use super::{refused, Engine, Gate, Page, Tree, View, SETTLED};
use crate::agents::keys::{self, Key};
use crate::agents::policy::{self, Facts, Field};
use crate::agents::quiet::{self, Owner, Said};
use crate::agents::scripts::{
    self, paint_over, png_size, CARET_ALL, CARET_END, CLIPPED, DESCRIBED, FACTS, FIELDS, INSIDE,
    IN_PAGE_KEY, SELECT, SET_VALUE, TEXT, TYPED_INTO, WHOLE,
};
use crate::agents::snapshot::{self, Part, Wanted};

/// The tallest full-page picture, in CSS pixels, as on the `DevTools` Protocol.
const TALLEST: f64 = 16_384.0;
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

/// A navigation of a page's own frame started: an agent's page's, from Orden's own
/// delegate, or a reader's tab's, from its own (`web_page/webkit.rs`).
pub fn started(label: &str) {
    heard(label, |one| one.navigations += 1);
}

/// A navigation of a page's own frame ended, and why it failed if it did.
pub fn arrived(label: &str, failure: Option<String>) {
    heard(label, |one| {
        one.loads += 1;
        if let Some(why) = failure {
            one.failed = Some((one.loads, why));
        }
    });
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
            started(&owner.label);
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
            _webview: &WKWebView,
            challenge: &NSURLAuthenticationChallenge,
            answer: &DynBlock<dyn Fn(NSURLSessionAuthChallengeDisposition, *mut NSURLCredential)>,
        ) {
            challenged(self.ivars(), challenge, answer);
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
    arrived(
        &owner.label,
        failure.map(|why| format!("the page could not be reached: {why}")),
    );
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
            // The site that asks, which is the one the sign-in goes to: a frame's or a
            // request's of a site the agent may not reach is that site's (9.2), however
            // allowed the page round it.
            let url = format!(
                "{}://{}/",
                space
                    .protocol()
                    .map_or_else(|| "https".to_string(), |one| one.to_string()),
                space.host()
            );
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

thread_local! {
    /// nib's own world, held for as long as the app runs. `WebKit` keeps a content world
    /// only while something holds it: one asked for by name and let go of after a call is
    /// torn down with every global of its own, so a ref the snapshot gave was gone at the
    /// next call. A reader's tab's world lives in its user scripts (`web_worlds.rs`); an
    /// agent's page has none there.
    static NIB_WORLD: std::cell::OnceCell<Retained<WKContentWorld>> = const { std::cell::OnceCell::new() };
}

/// nib's own world, on the main thread.
#[allow(
    unsafe_code,
    reason = "a content world is asked for by name through the Objective-C runtime"
)]
fn nib_world(mtm: MainThreadMarker) -> Retained<WKContentWorld> {
    NIB_WORLD.with(|held| {
        held.get_or_init(|| {
            // SAFETY: a world asked for by name on the main thread.
            unsafe {
                WKContentWorld::worldWithName(&NSString::from_str(crate::web_worlds::WORLD), mtm)
            }
        })
        .clone()
    })
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
                nib_world(mtm)
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

/// The agent's reach into a page (`snapshot.js`): refs, the tree, the elements a ref
/// names.
const AGENT: &str = include_str!("snapshot.js");

/// The most nodes one snapshot reads.
const MOST_NODES: usize = 20_000;

/// A function body with `nibAgent` in scope: the page's own, made the first time this
/// document is asked, with refs numbered from a start of this load's own, so a ref of a
/// page the tab has left never names an element of the next.
fn with_agent(page: &Page<'_>, body: &str) -> String {
    let start = (heard(&page.label, |one| one.loads) + 1) * 100_000 + 1;
    format!(
        "if (!globalThis.nibAgent) {{\n{FIELDS}\n{AGENT}\nglobalThis.nibAgent = globalThis.nibAgentOf(describe, {start})\n}}\nconst nibAgent = globalThis.nibAgent;\n{body}"
    )
}

/// A function body run with `nibAgent` in nib's own world.
fn agent(page: &Page<'_>, body: &str) -> Result<Value, Answer> {
    run(page, &with_agent(page, body), false)
}

/// A function run with the element a ref names as `this`, answering its value; an
/// element that is gone says to look again.
fn on(
    page: &Page<'_>,
    element: &Element,
    function: &str,
    arguments: &[Value],
) -> Result<Value, Answer> {
    let said = agent(
        page,
        &format!(
            "const node = nibAgent.byId({}); if (!node) return {{ gone: true }}; return {{ value: await ({function}).apply(node, {}) }};",
            element.backend,
            Value::Array(arguments.to_vec()),
        ),
    )?;
    if said.get("gone").and_then(Value::as_bool) == Some(true) {
        return Err(gone());
    }
    Ok(said.get("value").cloned().unwrap_or_default())
}

/// What an element that is no longer in the page answers.
fn gone() -> Answer {
    Answer::error(
        Code::NoSuchRef,
        "that element is gone: take a snapshot again",
    )
}

/// Where an element is in the viewport, in CSS pixels: left, top, width, height.
fn box_of(page: &Page<'_>, element: &Element, scroll: bool) -> Result<[f64; 4], Answer> {
    let said = agent(
        page,
        &format!("return nibAgent.box({}, {scroll});", element.backend),
    )?;
    if said.get("gone").and_then(Value::as_bool) == Some(true) {
        return Err(gone());
    }
    let at = |key: &str| said.get(key).and_then(Value::as_f64).unwrap_or_default();
    Ok([at("x"), at("y"), at("width"), at("height")])
}

/// Whether a secret field on the page holds anything (`secrets`).
fn holds_a_secret(page: &Page<'_>) -> Result<bool, Answer> {
    Ok(secrets(page)?.iter().any(|(_, filled, _)| *filled))
}

/// Every field on the page words are typed into that is secret (`policy::secret`): its
/// ref, whether it holds anything, and where it is in the viewport.
fn secrets(page: &Page<'_>) -> Result<Vec<(u64, bool, [f64; 4])>, Answer> {
    let said = agent(
        page,
        &format!(
            "const list = {TYPED_INTO}; const described = ({}).call(list); return described.map((one, at) => {{ const el = list[at]; const box = el.getBoundingClientRect(); let x = box.left, y = box.top; for (let view = el.ownerDocument.defaultView; view && view !== window; view = view.parent) {{ const frame = view.frameElement; if (!frame) break; const outer = frame.getBoundingClientRect(); x += outer.left + frame.clientLeft; y += outer.top + frame.clientTop }} return Object.assign(one, {{ id: nibAgent.idOf(el), box: [x, y, box.width, box.height] }}) }});",
            *DESCRIBED
        ),
    )?;
    Ok(said
        .as_array()
        .into_iter()
        .flatten()
        .filter(|one| {
            serde_json::from_value::<Field>((*one).clone())
                .is_ok_and(|field| policy::secret(&field))
        })
        .filter_map(|one| {
            let id = one.get("id")?.as_u64()?;
            let filled = one.get("filled").and_then(Value::as_bool) != Some(false);
            let place: Vec<f64> = one
                .get("box")?
                .as_array()?
                .iter()
                .filter_map(Value::as_f64)
                .collect();
            Some((
                id,
                filled,
                [
                    *place.first()?,
                    *place.get(1)?,
                    *place.get(2)?,
                    *place.get(3)?,
                ],
            ))
        })
        .collect())
}

/// The page's cookies, as the engine keeps them for every site, from the main thread.
#[allow(
    unsafe_code,
    reason = "the cookie store is reached through WKWebView's Objective-C interface"
)]
fn all_cookies(page: &Page<'_>) -> Result<Vec<Cookie>, Answer> {
    on_main(page, PATIENCE, |view, said| {
        // SAFETY: the view's own store, read on the main thread.
        let store = unsafe { view.configuration().websiteDataStore().httpCookieStore() };
        let handler = RcBlock::new(move |cookies: NonNull<NSArray<NSHTTPCookie>>| {
            // SAFETY: the engine hands this block an array alive for its length.
            let cookies = unsafe { cookies.as_ref() };
            let _ = said.send(
                cookies
                    .iter()
                    .map(|one| cookie_of(&one))
                    .collect::<Vec<_>>(),
            );
        });
        // SAFETY: as above; the engine copies the block and calls it once.
        unsafe { store.getAllCookies(&handler) };
    })
}

/// A cookie as the agent reads it.
fn cookie_of(cookie: &NSHTTPCookie) -> Cookie {
    Cookie {
        name: cookie.name().to_string(),
        value: cookie.value().to_string(),
        domain: Some(cookie.domain().to_string()),
        path: Some(cookie.path().to_string()),
        expires: cookie
            .expiresDate()
            .map(|at| at.timeIntervalSince1970())
            .filter(|at| *at > 0.0),
        http_only: cookie.isHTTPOnly(),
        secure: cookie.isSecure(),
    }
}

/// Whether a cookie is one the page's address is sent: its domain the host or a domain
/// above it, its path above the address's.
fn sent_to(cookie: &Cookie, url: &Url) -> bool {
    let host = url.host_str().unwrap_or_default().to_lowercase();
    let domain = cookie
        .domain
        .as_deref()
        .unwrap_or_default()
        .trim_start_matches('.')
        .to_lowercase();
    let path = cookie.path.as_deref().unwrap_or("/");
    let domain_matches = host == domain || host.ends_with(&format!(".{domain}"));
    let path_matches = url.path().starts_with(path.trim_end_matches('/')) || path == "/";
    domain_matches
        && path_matches
        && (!cookie.secure || url.scheme() == "https" || host == "127.0.0.1" || host == "localhost")
}

/// One cookie written to the page's store, or deleted from it.
#[allow(
    unsafe_code,
    reason = "a cookie is made and stored through Foundation's and WKWebView's Objective-C interfaces"
)]
fn store_cookie(page: &Page<'_>, cookie: &Cookie, url: &Url, delete: bool) -> Result<bool, Answer> {
    let (name, value, path, expires, secure, http_only) = (
        cookie.name.clone(),
        cookie.value.clone(),
        cookie.path.clone().unwrap_or_else(|| "/".into()),
        cookie.expires,
        cookie.secure,
        cookie.http_only,
    );
    let domain = cookie
        .domain
        .clone()
        .unwrap_or_else(|| url.host_str().unwrap_or_default().to_string());
    on_main(page, PATIENCE, move |view, said| {
        let properties = NSMutableDictionary::<NSString, AnyObject>::new();
        let put = |key: &NSString, value: &AnyObject| properties.insert(key, value);
        // SAFETY: every key is `NSHTTPCookie`'s own, every value the type it takes.
        let made = unsafe {
            put(NSHTTPCookieName, &NSString::from_str(&name));
            put(NSHTTPCookieValue, &NSString::from_str(&value));
            put(NSHTTPCookieDomain, &NSString::from_str(&domain));
            put(NSHTTPCookiePath, &NSString::from_str(&path));
            if secure {
                put(NSHTTPCookieSecure, &NSString::from_str("TRUE"));
            }
            if http_only {
                put(&NSString::from_str("HttpOnly"), &NSString::from_str("TRUE"));
            }
            if let Some(at) = expires {
                put(
                    NSHTTPCookieExpires,
                    &NSDate::dateWithTimeIntervalSince1970(at),
                );
            }
            NSHTTPCookie::cookieWithProperties(&properties)
        };
        let Some(made) = made else {
            let _ = said.send(false);
            return;
        };
        // SAFETY: the view's own store, used on the main thread.
        let store = unsafe { view.configuration().websiteDataStore().httpCookieStore() };
        let done = RcBlock::new(move || {
            let _ = said.send(true);
        });
        // SAFETY: as above; the engine copies the block and calls it once.
        unsafe {
            if delete {
                store.deleteCookie_completionHandler(&made, Some(&done));
            } else {
                store.setCookie_completionHandler(&made, Some(&done));
            }
        }
    })
}

/// Everything the page's store keeps for its site but its cookies, gone: storage,
/// caches, databases.
#[allow(
    unsafe_code,
    reason = "a store's data is removed through WKWebView's Objective-C interface"
)]
fn clear_site(page: &Page<'_>, host: String) -> Result<(), Answer> {
    on_main(page, Duration::from_secs(10), move |view, said| {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        // SAFETY: the view's own store, used on the main thread; each block is copied by
        // the engine and called once.
        unsafe {
            let store = view.configuration().websiteDataStore();
            let types = WKWebsiteDataStore::allWebsiteDataTypes(mtm);
            let removing = store.clone();
            let removed_types = types.clone();
            let found = RcBlock::new(move |records: NonNull<NSArray<WKWebsiteDataRecord>>| {
                let records = records.as_ref();
                let site: Vec<Retained<WKWebsiteDataRecord>> = records
                    .iter()
                    .filter(|one| {
                        let name = one.displayName().to_string().to_lowercase();
                        host == name || host.ends_with(&format!(".{name}"))
                    })
                    .collect();
                let said = said.clone();
                let done = RcBlock::new(move || {
                    let _ = said.send(());
                });
                let site = NSArray::from_retained_slice(&site);
                removing.removeDataOfTypes_forDataRecords_completionHandler(
                    &removed_types,
                    &site,
                    &done,
                );
            });
            store.fetchDataRecordsOfTypes_completionHandler(&types, &found);
        }
    })
}

/// A picture of the view, as a PNG: of `rect` in the view's own points, `width` pixels
/// across. `tall` is how tall the view is made while the picture is taken, for a picture
/// of the whole page; it is put back after.
#[allow(
    unsafe_code,
    reason = "WKWebView's snapshot is reached through the Objective-C runtime"
)]
fn photograph(
    page: &Page<'_>,
    rect: [f64; 4],
    width: f64,
    tall: Option<f64>,
) -> Result<Option<Vec<u8>>, Answer> {
    on_main(page, PATIENCE, move |view, said| {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let was = view.frame();
        if let Some(tall) = tall {
            view.setFrameSize(NSSize::new(was.size.width, tall));
        }
        // SAFETY: a configuration of the view's own, made and used on the main thread;
        // the engine copies the block and calls it once.
        unsafe {
            let configuration = WKSnapshotConfiguration::new(mtm);
            configuration.setRect(NSRect::new(
                NSPoint::new(rect[0], rect[1]),
                NSSize::new(rect[2], rect[3]),
            ));
            configuration.setSnapshotWidth(Some(&NSNumber::new_f64(width)));
            configuration.setAfterScreenUpdates(true);
            let restoring = view.retain();
            let handler = RcBlock::new(move |image: *mut NSImage, _error: *mut NSError| {
                if tall.is_some() {
                    restoring.setFrameSize(was.size);
                }
                let _ = said.send(image.as_ref().and_then(png_of));
            });
            view.takeSnapshotWithConfiguration_completionHandler(Some(&configuration), &handler);
        }
    })
}

/// A picture as a PNG.
#[allow(
    unsafe_code,
    reason = "a bitmap is encoded through AppKit's Objective-C interface"
)]
fn png_of(image: &NSImage) -> Option<Vec<u8>> {
    let tiff = image.TIFFRepresentation()?;
    let bitmap = NSBitmapImageRep::imageRepWithData(&tiff)?;
    // SAFETY: an empty dictionary is a valid set of encoding properties.
    let data = unsafe {
        bitmap.representationUsingType_properties(NSBitmapImageFileType::PNG, &NSDictionary::new())
    }?;
    let bytes = data.to_vec();
    (!bytes.is_empty()).then_some(bytes)
}

/// How many of the screen's pixels the view's window draws a point with.
fn backing(page: &Page<'_>) -> f64 {
    on_main(page, PATIENCE, |view, said| {
        let _ = said.send(
            view.window()
                .map_or(1.0, |window| window.backingScaleFactor()),
        );
    })
    .unwrap_or(1.0)
    .max(1.0)
}

/// A statement list run in the page's world or nib's, answering the value of its last
/// statement as `evaluateJavaScript` does: for what `browser_evaluate` is handed that is
/// not one expression.
#[allow(
    unsafe_code,
    reason = "a script is run in the page through the Objective-C runtime"
)]
fn statements(page: &Page<'_>, source: &str, page_world: bool) -> Result<Value, Answer> {
    let source = source.to_string();
    let said = on_main(
        page,
        PATIENCE,
        move |view, said: Sender<Result<Value, String>>| {
            let Some(mtm) = MainThreadMarker::new() else {
                return;
            };
            let world = if page_world {
                // SAFETY: the page's own world, asked for on the main thread.
                unsafe { WKContentWorld::pageWorld(mtm) }
            } else {
                nib_world(mtm)
            };
            let done = RcBlock::new(move |value: *mut AnyObject, error: *mut NSError| {
                // SAFETY: the engine's own answer, alive for this call, on the main thread.
                let answer = unsafe {
                    match error.as_ref() {
                        Some(error) => Err(thrown(error)),
                        None => Ok(value.as_ref().map_or(Value::Null, value_of)),
                    }
                };
                let _ = said.send(answer);
            });
            // SAFETY: as in `run`.
            unsafe {
                view.evaluateJavaScript_inFrame_inContentWorld_completionHandler(
                    &NSString::from_str(&source),
                    None,
                    &world,
                    Some(&done),
                );
            }
        },
    )?;
    said.map_err(|why| {
        Answer::error(
            Code::Failed,
            format!("the script threw: {}", super::cut(why, 2_000)),
        )
    })
}

/// What the engine answered a script with, as JSON: strings, numbers, booleans, arrays
/// and dictionaries of them, and nothing else.
fn value_of(said: &AnyObject) -> Value {
    if let Some(text) = said.downcast_ref::<NSString>() {
        return Value::String(text.to_string());
    }
    if let Some(number) = said.downcast_ref::<NSNumber>() {
        // A boolean is a number to Foundation; its type says which.
        if number.encoding() == objc2::encode::Encoding::Char
            || number.encoding() == objc2::encode::Encoding::Bool
        {
            return Value::Bool(number.as_bool());
        }
        let float = number.as_f64();
        return serde_json::Number::from_f64(float).map_or(Value::Null, |one| {
            if float.fract() == 0.0 && float.abs() < 9.0e15 {
                #[allow(clippy::cast_possible_truncation, reason = "a whole number, checked")]
                Value::from(float as i64)
            } else {
                Value::Number(one)
            }
        });
    }
    if let Some(list) = said.downcast_ref::<NSArray>() {
        return Value::Array(list.iter().map(|one| value_of(&one)).collect());
    }
    if let Some(map) = said.downcast_ref::<NSDictionary>() {
        let mut out = Map::new();
        for key in map.allKeys() {
            if let (Some(name), Some(one)) =
                (key.downcast_ref::<NSString>(), map.objectForKey(&key))
            {
                out.insert(name.to_string(), value_of(&one));
            }
        }
        return Value::Object(out);
    }
    Value::Null
}

/// What the pointer does, as `AppKit`'s events.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Pointer {
    Moved,
    Down,
    Up,
}

/// The modifiers an agent held, as `AppKit`'s flags.
fn flags_of(modifiers: u8) -> NSEventModifierFlags {
    let mut flags = NSEventModifierFlags::empty();
    if modifiers & 1 != 0 {
        flags |= NSEventModifierFlags::Option;
    }
    if modifiers & 2 != 0 {
        flags |= NSEventModifierFlags::Control;
    }
    if modifiers & 4 != 0 {
        flags |= NSEventModifierFlags::Command;
    }
    if modifiers & 8 != 0 {
        flags |= NSEventModifierFlags::Shift;
    }
    flags
}

/// The pointer at a point of the page's viewport, in CSS pixels, as an `NSEvent` sent to
/// the view itself: trusted, inside the page, and never through the system's queue, so the
/// system's own pointer and the window in front are untouched (docs/agent-native.md
/// 12.2).
fn send_pointer(
    view: &WKWebView,
    (x, y): (f64, f64),
    kind: Pointer,
    button: &str,
    count: u8,
    modifiers: u8,
) -> bool {
    let plain: &NSView = view;
    let Some(window) = plain.window() else {
        return false;
    };
    let height = plain.bounds().size.height;
    let local = NSPoint::new(x, if plain.isFlipped() { y } else { height - y });
    let at = plain.convertPoint_toView(local, None);
    let type_of = match (kind, button) {
        (Pointer::Moved, _) => NSEventType::MouseMoved,
        (Pointer::Down, "left") => NSEventType::LeftMouseDown,
        (Pointer::Up, "left") => NSEventType::LeftMouseUp,
        (Pointer::Down, "right") => NSEventType::RightMouseDown,
        (Pointer::Up, "right") => NSEventType::RightMouseUp,
        (Pointer::Down, _) => NSEventType::OtherMouseDown,
        (Pointer::Up, _) => NSEventType::OtherMouseUp,
    };
    let Some(event) = NSEvent::mouseEventWithType_location_modifierFlags_timestamp_windowNumber_context_eventNumber_clickCount_pressure(
        type_of,
        at,
        flags_of(modifiers),
        NSProcessInfo::processInfo().systemUptime(),
        window.windowNumber(),
        None,
        0,
        isize::from(count.max(1)),
        if kind == Pointer::Down { 1.0 } else { 0.0 },
    ) else {
        return false;
    };
    keeping_focus(&window, || match type_of {
        NSEventType::MouseMoved => plain.mouseMoved(&event),
        NSEventType::LeftMouseDown => plain.mouseDown(&event),
        NSEventType::LeftMouseUp => plain.mouseUp(&event),
        NSEventType::RightMouseDown => plain.rightMouseDown(&event),
        NSEventType::RightMouseUp => plain.rightMouseUp(&event),
        NSEventType::OtherMouseDown => plain.otherMouseDown(&event),
        _ => plain.otherMouseUp(&event),
    });
    true
}

/// Runs `act` and gives the window's keyboard back to whatever held it before: a press
/// the engine answers by making its view the window's first responder would otherwise
/// leave the reader's typing in Orden's window going to the agent's page (7.2), and a
/// view that is first responder ignores the pointer moving outside what of it shows,
/// which for a page out of sight is everywhere.
fn keeping_focus<T>(window: &NSWindow, act: impl FnOnce() -> T) -> T {
    let before = window.firstResponder();
    let done = act();
    let now = window.firstResponder();
    let moved = match (&before, &now) {
        (Some(before), Some(now)) => !std::ptr::eq(Retained::as_ptr(before), Retained::as_ptr(now)),
        (None, None) => false,
        _ => true,
    };
    if moved {
        window.makeFirstResponder(before.as_deref());
    }
    done
}

/// One key pressed and let go of, as the `NSEvent`s a Mac's keyboard sends, to the view
/// itself.
fn send_key(view: &WKWebView, code: u16, typed: &str, plain_text: &str, modifiers: u8) -> bool {
    let plain: &NSView = view;
    let Some(window) = plain.window() else {
        return false;
    };
    let key = |kind: NSEventType| {
        NSEvent::keyEventWithType_location_modifierFlags_timestamp_windowNumber_context_characters_charactersIgnoringModifiers_isARepeat_keyCode(
            kind,
            NSPoint::new(0.0, 0.0),
            flags_of(modifiers),
            NSProcessInfo::processInfo().systemUptime(),
            window.windowNumber(),
            None,
            &NSString::from_str(typed),
            &NSString::from_str(plain_text),
            false,
            code,
        )
    };
    let (Some(down), Some(up)) = (key(NSEventType::KeyDown), key(NSEventType::KeyUp)) else {
        return false;
    };
    keeping_focus(&window, || {
        plain.keyDown(&down);
        plain.keyUp(&up);
    });
    true
}

/// Words put in where the page's caret is, through the view's own text input: what a
/// person's typing becomes once the keyboard has done its part.
#[allow(
    unsafe_code,
    reason = "a view's text input is reached through the Objective-C runtime"
)]
fn insert_text(view: &WKWebView, text: &str) {
    let words = NSString::from_str(text);
    let insert = || {
        // SAFETY: `insertText:` is `NSResponder`'s, which WKWebView answers as its text
        // input does, with a string; sent on the main thread.
        unsafe {
            let () = msg_send![view, insertText: &*words];
        }
    };
    let plain: &NSView = view;
    match plain.window() {
        Some(window) => keeping_focus(&window, insert),
        None => insert(),
    }
}

/// Whether the pointer is over an element, as the page's style sees it.
const HOVERED: &str = "function () { const el = this.nodeType === 1 ? this : this.parentElement; return !!el && el.matches(':hover') }";

/// The events a pointer arriving over an element raises, as the page's own.
const HOVER_EVENTS: &str = "function (x, y) { const el = this.nodeType === 1 ? this : this.parentElement; if (!el) return; for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove']) { const Kind = type.startsWith('pointer') ? PointerEvent : MouseEvent; el.dispatchEvent(new Kind(type, { bubbles: !type.endsWith('enter'), cancelable: true, composed: true, clientX: x, clientY: y, view: window })) } }";

/// The pointer, through the main thread.
fn pointer(
    page: &Page<'_>,
    point: (f64, f64),
    kind: Pointer,
    button: &'static str,
    count: u8,
    modifiers: u8,
) -> Result<(), Answer> {
    let sent = on_main(page, PATIENCE, move |view, said| {
        let _ = said.send(send_pointer(view, point, kind, button, count, modifiers));
    })?;
    if sent {
        Ok(())
    } else {
        Err(Answer::error(
            Code::Failed,
            "the page has no window to be pressed in",
        ))
    }
}

/// A button's name as the pointer's events take it.
fn button_of(button: &str) -> &'static str {
    match button {
        "right" => "right",
        "middle" => "middle",
        _ => "left",
    }
}

/// A press at a point: the pointer moved there, pressed and let go `count` times, and
/// the page let settle.
fn press_at(
    page: &Page<'_>,
    point: (f64, f64),
    button: &str,
    count: u8,
    modifiers: u8,
) -> Result<(), Answer> {
    let before = page.navigations();
    let button = button_of(button);
    pointer(page, point, Pointer::Moved, "none", 1, modifiers)?;
    for press in 1..=count.max(1) {
        pointer(page, point, Pointer::Down, button, press, modifiers)?;
        pointer(page, point, Pointer::Up, button, press, modifiers)?;
    }
    page.settle(before);
    Ok(())
}

/// Where an element can be pressed, scrolled into view first: its middle, then the middle
/// of each quarter of it, as on the `DevTools` Protocol.
fn points(page: &Page<'_>, element: &Element) -> Result<Vec<(f64, f64)>, Answer> {
    let [x, y, width, height] = box_of(page, element, true)?;
    if width <= 0.0 || height <= 0.0 {
        return Err(Answer::error(
            Code::Failed,
            "the element is not visible: nothing of it is on the page",
        ));
    }
    let middle = (x + width / 2.0, y + height / 2.0);
    Ok(std::iter::once(middle)
        .chain(
            [
                (x, y),
                (x + width, y),
                (x, y + height),
                (x + width, y + height),
            ]
            .into_iter()
            .map(|corner| {
                (
                    f64::midpoint(middle.0, corner.0),
                    f64::midpoint(middle.1, corner.1),
                )
            }),
        )
        .collect())
}

/// The first of an element's points a press there lands on it: it, inside it, round it,
/// its label, or a frame it is in; and what covers it when none does.
fn landing(page: &Page<'_>, element: &Element) -> Result<(f64, f64), Answer> {
    let mut first = None;
    for (x, y) in points(page, element)? {
        let said = agent(
            page,
            &format!(
                "const target = nibAgent.byId({id}); if (!target) return {{ gone: true }}; const at = nibAgent.at({x}, {y}); const hit = at === null ? null : nibAgent.byId(at); if (!hit || hit === target) return {{ ok: true }}; if (({INSIDE}).call(hit, target) !== false) return {{ ok: true }}; const el = hit.nodeType === 1 ? hit : hit.parentElement; return {{ covered: at, what: el ? (el.getAttribute('aria-label') || el.innerText || el.tagName).replace(/\\s+/g, ' ').trim().slice(0, 80) : '' }};",
                id = element.backend,
            ),
        )?;
        if said.get("gone").and_then(Value::as_bool) == Some(true) {
            return Err(gone());
        }
        if said.get("ok").and_then(Value::as_bool) == Some(true) {
            return Ok((x, y));
        }
        let covered = said
            .get("covered")
            .and_then(Value::as_u64)
            .unwrap_or_default();
        let what = said.get("what").and_then(Value::as_str).unwrap_or_default();
        first.get_or_insert_with(|| {
            Answer::error(
                Code::Failed,
                format!("e{} is covered by e{covered} (\u{201c}{what}\u{201d}) where it would be pressed: deal with that first, or, where the element is what shows there, press there with browser_click's x and y", element.backend),
            )
        });
    }
    Err(first.unwrap_or_else(|| {
        Answer::error(
            Code::Failed,
            "the element is not visible: nothing of it is on the page",
        )
    }))
}

/// Words put into the element with the keyboard through the page itself, in one task of
/// the page's own: a reader's tab, where the reader may be typing too (7.3), and the road
/// for words the view's own text input did not put in.
fn insert_in_page(
    page: &Page<'_>,
    element: &Element,
    text: &str,
    placing: &str,
) -> Result<bool, Answer> {
    let said = on(
        page,
        element,
        &format!("function (text) {{ this.focus(); ({placing}).call(this); return document.execCommand('insertText', false, text) }}"),
        &[json!(text)],
    )?;
    Ok(said.as_bool() == Some(true))
}

/// What a field holds now, for whether words reached it.
fn held_words(page: &Page<'_>, element: &Element) -> String {
    on(
        page,
        element,
        "function () { return String(this.value !== undefined ? this.value : this.innerText || '') }",
        &[],
    )
    .ok()
    .and_then(|one| one.as_str().map(str::to_string))
    .unwrap_or_default()
}

/// The page as a PDF, as `WKWebView` makes one: the whole page laid out as it shows, on
/// one sheet as tall as it is, `[width, height]` in CSS pixels.
#[allow(
    unsafe_code,
    reason = "WKWebView's PDF is made through the Objective-C runtime"
)]
fn printed(page: &Page<'_>, size: [f64; 2]) -> Result<Option<Vec<u8>>, Answer> {
    on_main(page, Duration::from_secs(30), move |view, said| {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        // SAFETY: a configuration of the view's own, made and used on the main thread;
        // the engine copies the block and calls it once.
        unsafe {
            let configuration = WKPDFConfiguration::new(mtm);
            configuration.setRect(NSRect::new(
                NSPoint::new(0.0, 0.0),
                NSSize::new(size[0], size[1]),
            ));
            let handler = RcBlock::new(move |data: *mut NSData, _error: *mut NSError| {
                let _ = said.send(
                    data.as_ref()
                        .map(NSData::to_vec)
                        .filter(|one| !one.is_empty()),
                );
            });
            view.createPDFWithConfiguration_completionHandler(Some(&configuration), &handler);
        }
    })
}

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

    fn element(&self, reference: &str) -> Result<Element, Answer> {
        match snapshot::parse_ref(reference) {
            Some((None, backend)) => Ok(Element { backend }),
            Some((Some(_), _)) => Err(Answer::error(
                Code::NoSuchRef,
                format!("{reference} is in a frame of another site, which WKWebView does not reach: take a snapshot again"),
            )),
            None => Err(Answer::error(
                Code::NoSuchRef,
                format!("{reference} is not a ref: refs look like e12 or f2e17"),
            )),
        }
    }

    fn element_at(&self, (x, y): (f64, f64)) -> Result<Element, Answer> {
        agent(self, &format!("return nibAgent.at({x}, {y});"))?
            .as_u64()
            .map(|backend| Element { backend })
            .ok_or_else(|| Answer::error(Code::Failed, "nothing of the page is at that point"))
    }

    fn facts(&self, element: &Element) -> Result<Facts, Answer> {
        let said = on(self, element, &FACTS, &[])?;
        Ok(serde_json::from_value(said).unwrap_or_default())
    }

    fn active_facts(&self) -> Result<Option<Facts>, Answer> {
        let said = agent(
            self,
            &format!(
                "const id = nibAgent.active(); if (id === null) return null; return ({}).apply(nibAgent.byId(id));",
                *FACTS
            ),
        )?;
        Ok(serde_json::from_value(said).ok())
    }

    fn facts_of_press(&self, element: &Element) -> Result<Facts, Answer> {
        self.facts(&self.aimed(element)?)
    }

    fn at_first_point(&self, element: &Element) -> Result<Element, Answer> {
        let first = points(self, element)?[0];
        self.element_at(first)
    }

    fn aimed(&self, element: &Element) -> Result<Element, Answer> {
        let point = landing(self, element)?;
        self.element_at(point)
    }

    fn may_act_in(&self, facts: &Facts) -> Result<(), Answer> {
        self.frame_may_be_acted_in(facts)
    }

    fn limits_sites(&self) -> bool {
        self.grant_limits_sites()
    }

    fn tick_changes(&self, element: &Element, wanted: bool) -> Result<bool, Answer> {
        let now = on(self, element, "function () { return this.checked }", &[])?;
        Ok(now.as_bool() != Some(wanted))
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
                // The DevTools page asks again with the secret regions out (9.4); here a
                // filled secret field on the page is no answer either way.
                Until::Text { .. } if self.limits.is_some() && holds_a_secret(self)? => {
                    return Err(Answer::error(
                        Code::PasswordField,
                        "a filled secret field is on the page, and its words cannot be left out of the look here: wait for something else",
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
                Until::Element { element } => self.element(element).is_ok_and(|element| {
                    box_of(self, &element, false)
                        .is_ok_and(|[_, _, width, height]| width > 0.0 && height > 0.0)
                }),
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
        let said = isolated(
            self,
            "(() => { const all = new Set([location.host]); for (const one of performance.getEntriesByType('resource')) { try { all.add(new URL(one.name).host) } catch (_) {} } for (const frame of document.querySelectorAll('iframe, frame')) { try { all.add(new URL(frame.src).host) } catch (_) {} } return [...all].filter(Boolean) })()",
        )
        .unwrap_or_default();
        said.as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter_map(|host| policy::host_of(&format!("https://{host}/")))
            .collect()
    }

    fn parts(&self) -> Result<Tree, Answer> {
        let said = agent(self, &format!("return nibAgent.tree({MOST_NODES});"))?;
        let nodes = said
            .get("nodes")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let secret = said
            .get("fields")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
            .filter(|one| {
                serde_json::from_value::<Field>((*one).clone())
                    .is_ok_and(|field| policy::secret(&field))
            })
            .filter_map(|one| one.get("id").and_then(Value::as_u64))
            .map(|id| (String::new(), id))
            .collect();
        Ok((
            vec![Part {
                prefix: String::new(),
                nodes,
                owner: None,
            }],
            secret,
        ))
    }

    fn find(&self, wanted: &Wanted<'_>) -> Result<Vec<Match>, Answer> {
        let (parts, secret) = self.parts()?;
        Ok(snapshot::find(&parts, &secret, wanted))
    }

    fn read(&self, app: &AppHandle, shape: ReadAs) -> Result<(String, String, String), Answer> {
        // The DevTools page leaves a secret region's words out of a read (9.4); here an
        // agent's read is refused while one is filled.
        if self.limits.is_some() && holds_a_secret(self)? {
            return Err(Answer::error(
                Code::PasswordField,
                "a filled secret field is on the page, and its words cannot be left out of a read here: take a snapshot, which leaves them out",
            ));
        }
        let said = match shape {
            ReadAs::Text => isolated(self, TEXT)?,
            ReadAs::Markdown => isolated(self, &WHOLE)?,
            ReadAs::Article => isolated(self, &CLIPPED)?,
        };
        Ok(scripts::words(app, shape, &said))
    }

    fn clip(&self) -> Result<(String, String, String), Answer> {
        if self.limits.is_some() && holds_a_secret(self)? {
            return Err(Answer::error(
                Code::PasswordField,
                "a filled secret field is on the page, and its words cannot be left out of a clip here",
            ));
        }
        let said = isolated(self, &CLIPPED)?;
        let text = |key: &str| {
            said.get(key)
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string()
        };
        Ok((text("url"), text("title"), text("html")))
    }

    fn pdf(&self, _paper: &PdfPage) -> Result<String, Answer> {
        if !self.may_touch_credentials() && secrets(self)?.iter().any(|(_, filled, _)| *filled) {
            return Err(Answer::error(
                Code::PasswordField,
                "a filled secret field is on the page, and it would print as bullets that say how long it is: capture a screenshot, which paints it over",
            ));
        }
        let size = isolated(
            self,
            "[document.documentElement.scrollWidth, Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0)]",
        )?;
        let width = size
            .get(0)
            .and_then(Value::as_f64)
            .unwrap_or(1280.0)
            .max(1.0);
        let height = size
            .get(1)
            .and_then(Value::as_f64)
            .unwrap_or(800.0)
            .clamp(1.0, TALLEST);
        printed(self, [width, height])?
            .map(|bytes| base64::engine::general_purpose::STANDARD.encode(bytes))
            .ok_or_else(|| Answer::error(Code::Failed, "the engine printed nothing"))
    }

    fn click(
        &self,
        element: &Element,
        button: &str,
        count: u8,
        modifiers: u8,
        gate: Gate<'_>,
    ) -> Result<(), Answer> {
        let facts = self.facts(element)?;
        if facts.picker() {
            return Err(Answer::error(
                Code::BadArguments,
                "that opens a list of the engine's own: set it with browser_select or browser_fill_form",
            ));
        }
        let point = landing(self, element)?;
        // What the press lands on there, a child or a frame of the element, is put to the
        // question as the element was (the DevTools page's `press_judged`).
        let hit = self.element_at(point)?;
        if hit.backend != element.backend {
            gate(&hit)?;
        }
        press_at(self, point, button, count, modifiers)
    }

    fn click_at(
        &self,
        point: (f64, f64),
        judged: &Element,
        button: &str,
        count: u8,
        modifiers: u8,
        gate: Gate<'_>,
    ) -> Result<(), Answer> {
        let size = isolated(self, "[innerWidth, innerHeight]")?;
        let width = size.get(0).and_then(Value::as_f64).unwrap_or_default();
        let height = size.get(1).and_then(Value::as_f64).unwrap_or_default();
        if !(0.0..width).contains(&point.0) || !(0.0..height).contains(&point.1) {
            return Err(Answer::error(
                Code::BadArguments,
                format!(
                    "{}, {} is outside the tab, which is {width} by {height}",
                    point.0, point.1
                ),
            ));
        }
        if let Ok(element) = self.element_at(point) {
            if self.facts(&element).is_ok_and(|facts| facts.picker()) {
                return Err(Answer::error(
                    Code::BadArguments,
                    "that opens a list of the engine's own: set it with browser_select or browser_fill_form",
                ));
            }
            if element.backend != judged.backend {
                gate(&element)?;
            }
        }
        press_at(self, point, button, count, modifiers)
    }

    fn hover(&self, element: &Element) -> Result<(), Answer> {
        let point = points(self, element)?[0];
        // From a pixel beside it, so the engine sees the pointer arrive.
        pointer(
            self,
            (point.0 - 1.0, point.1 - 1.0),
            Pointer::Moved,
            "none",
            1,
            0,
        )?;
        pointer(self, point, Pointer::Moved, "none", 1, 0)?;
        // `WebKit` gives a page the pointer's moves only while its window is the active
        // one; where Orden's is not, the element hears them as the page's own events
        // instead (`isTrusted` false), as `WebKitGTK`'s would (docs/agent-native.md 12.2).
        let over = on(self, element, HOVERED, &[])?;
        if over.as_bool() != Some(true) {
            on(
                self,
                element,
                HOVER_EVENTS,
                &[json!(point.0), json!(point.1)],
            )?;
        }
        Ok(())
    }

    fn type_text(&self, element: &Element, text: &str, replace: bool) -> Result<(), Answer> {
        let facts = self.facts(element)?;
        self.refuse_secret(&facts)?;
        if facts.sensitive() {
            crate::agents::log::sensitive();
        }
        if facts.tag == "select" {
            return Err(Answer::error(
                Code::BadArguments,
                "that is a list: use browser_select",
            ));
        }
        if facts.kind == "file" {
            return Err(Answer::error(
                Code::BadArguments,
                "that takes files: use browser_upload",
            ));
        }
        if facts.picker() {
            let said = on(self, element, SET_VALUE, &[json!(text)])?;
            return if said.as_str() == Some(text) || text.is_empty() {
                Ok(())
            } else {
                Err(Answer::error(
                    Code::BadArguments,
                    format!("the field did not take {text:?}: a date is written 2026-09-30, a time 14:30, a colour #336699"),
                ))
            };
        }
        if !facts.editable {
            return Err(Answer::error(
                Code::BadArguments,
                "that is not a field words can be typed into",
            ));
        }
        let placing = if replace { CARET_ALL } else { CARET_END };
        // A reader's tab: in one task of the page's own, so a key of the reader's lands
        // before the words or after them and never between (7.3).
        if !self.own && !text.is_empty() && insert_in_page(self, element, text, placing)? {
            return Ok(());
        }
        on(
            self,
            element,
            &format!("function () {{ this.focus(); ({placing}).call(this) }}"),
            &[],
        )?;
        if text.is_empty() {
            if replace {
                self.press(
                    &keys::chord("Delete").map_err(|why| Answer::error(Code::Failed, why))?,
                )?;
            }
            return Ok(());
        }
        let before = held_words(self, element);
        let words = text.to_string();
        on_main(self, PATIENCE, move |view, said| {
            insert_text(view, &words);
            let _ = said.send(());
        })?;
        // The view's text input goes where the window's keyboard is; where it did not
        // reach the field, the words go in through the page, as in a reader's tab.
        if held_words(self, element) == before && !insert_in_page(self, element, text, CARET_END)? {
            return Err(Answer::error(Code::Failed, "the field took no words"));
        }
        Ok(())
    }

    fn press(&self, key: &Key) -> Result<(), Answer> {
        self.may_press(key)?;
        let before = self.navigations();
        let (code, typed, plain) = key.mac();
        let modifiers = key.modifiers;
        let sent = on_main(self, PATIENCE, move |view, said| {
            let _ = said.send(send_key(view, code, &typed, &plain, modifiers));
        })?;
        if !sent {
            return Err(Answer::error(
                Code::Failed,
                "the page has no window to press keys in",
            ));
        }
        self.settle(before);
        Ok(())
    }

    fn press_in_page(&self, key: &Key) -> Result<(), Answer> {
        self.may_press(key)?;
        let before = self.navigations();
        let said = agent(
            self,
            &format!(
                "const at = nibAgent.active(); const node = (at === null ? null : nibAgent.byId(at)) || document.body; if (!node) return null; return ({IN_PAGE_KEY}).apply(node, {});",
                json!([key.name, key.code, key.modifiers])
            ),
        )?;
        if said.as_str() == Some("type") {
            if let Some(text) = key.text.as_deref() {
                let text = if text == "\r" { "\n" } else { text };
                isolated(
                    self,
                    &format!("document.execCommand('insertText', false, {})", json!(text)),
                )?;
            }
        }
        self.settle(before);
        Ok(())
    }

    fn scroll(&self, element: Option<&Element>, dx: f64, dy: f64) -> Result<(), Answer> {
        if let Some(element) = element {
            box_of(self, element, true)?;
            return Ok(());
        }
        isolated(
            self,
            &format!("window.scrollBy({{ left: {dx}, top: {dy}, behavior: 'instant' }})"),
        )?;
        Ok(())
    }

    fn select(&self, element: &Element, values: &[String]) -> Result<Vec<String>, Answer> {
        let said = on(self, element, SELECT, &[json!(values)])?;
        if let Some(error) = said.get("error").and_then(Value::as_str) {
            return Err(Answer::error(Code::BadArguments, error));
        }
        Ok(said
            .get("chosen")
            .and_then(Value::as_array)
            .map(|all| {
                all.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_string)
                    .collect()
            })
            .unwrap_or_default())
    }

    fn fill(&self, element: &Element, value: &FieldValue, gate: Gate<'_>) -> Result<(), Answer> {
        let facts = self.facts(element)?;
        self.refuse_secret(&facts)?;
        if facts.sensitive() {
            crate::agents::log::sensitive();
        }
        match value {
            FieldValue::Ticked(wanted) => {
                if !matches!(facts.kind.as_str(), "checkbox" | "radio") {
                    return Err(Answer::error(
                        Code::BadArguments,
                        "true and false are for a checkbox or a radio button",
                    ));
                }
                let now = on(self, element, "function () { return this.checked }", &[])?;
                if now.as_bool() != Some(*wanted) {
                    self.click(element, "left", 1, 0, gate)?;
                }
                Ok(())
            }
            FieldValue::Options(values) => self.select(element, values).map(|_| ()),
            FieldValue::Words(text) if facts.tag == "select" => {
                self.select(element, std::slice::from_ref(text)).map(|_| ())
            }
            FieldValue::Words(text) => self.type_text(element, text, true),
        }
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
        element: Option<&Element>,
        full: bool,
        scale: Option<f64>,
    ) -> Result<Picture, Answer> {
        if !self.may_touch_credentials()
            && self.active_facts()?.is_some_and(|facts| facts.password())
        {
            return Err(Answer::error(
                Code::PasswordField,
                "a password field has the keyboard: nothing is photographed while one does",
            ));
        }
        let page = isolated(
            self,
            "({ width: innerWidth, height: innerHeight, x: scrollX, y: scrollY, tall: Math.max(document.documentElement.scrollHeight, document.body ? document.body.scrollHeight : 0), wide: document.documentElement.scrollWidth })",
        )?;
        let at = |key: &str| page.get(key).and_then(Value::as_f64).unwrap_or_default();
        let (rect, tall) = match (element, full) {
            (Some(element), _) => (box_of(self, element, true)?, None),
            (None, true) => {
                let tall = at("tall").clamp(at("height"), TALLEST);
                // The whole page, from its top: the view made as tall as the page, and the
                // page scrolled to its start while it is.
                let _ = isolated(self, "window.scrollTo(0, 0)");
                ([0.0, 0.0, at("width"), tall], Some(tall))
            }
            (None, false) => ([0.0, 0.0, at("width"), at("height")], None),
        };
        if rect[2] < 1.0 || rect[3] < 1.0 {
            return Err(Answer::error(
                Code::Failed,
                "nothing of it is on the page to photograph",
            ));
        }
        let wanted = scale.unwrap_or(1.0).clamp(0.1, 4.0);
        let secret = secrets(self)?;
        let png = photograph(self, rect, rect[2] * wanted / backing(self), tall)?
            .ok_or_else(|| Answer::error(Code::Failed, "the engine took no picture"))?;
        if full {
            let _ = isolated(self, &format!("window.scrollTo({}, {})", at("x"), at("y")));
        }
        let png = base64::engine::general_purpose::STANDARD.encode(png);
        let (width, height) = png_size(&png).unwrap_or_default();
        let (across, down) = (f64::from(width) / rect[2], f64::from(height) / rect[3]);
        let rects: Vec<[f64; 4]> = secret
            .into_iter()
            .filter(|(_, filled, _)| *filled)
            .map(|(_, _, [x, y, w, h])| {
                [
                    (x - rect[0]) * across,
                    (y - rect[1]) * down,
                    (x + w - rect[0]) * across,
                    (y + h - rect[1]) * down,
                ]
            })
            .collect();
        let png = if rects.is_empty() {
            png
        } else {
            paint_over(&png, &rects).map_err(|why| {
                Answer::error(
                    Code::Failed,
                    format!("a secret field could not be hidden in the picture, so there is none: {why}"),
                )
            })?
        };
        Ok(Picture { png, width, height })
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

    fn evaluate(&self, expression: &str, page_world: bool) -> Result<Value, Answer> {
        match run(self, &format!("return (\n{expression}\n);"), page_world) {
            Err(Answer::Error { message, .. }) if message.contains("SyntaxError") => {
                statements(self, expression, page_world)
            }
            answered => answered,
        }
    }

    fn cookies(&self) -> Result<Vec<Cookie>, Answer> {
        let url = Url::parse(&self.view.url())
            .map_err(|_| Answer::error(Code::Failed, "the page has no address"))?;
        Ok(all_cookies(self)?
            .into_iter()
            .filter(|one| sent_to(one, &url))
            .collect())
    }

    fn set_cookie(&self, cookie: &Cookie) -> Result<(), Answer> {
        let url = Url::parse(&self.view.url())
            .map_err(|_| Answer::error(Code::Failed, "the page has no address"))?;
        if store_cookie(self, cookie, &url, false)? {
            Ok(())
        } else {
            Err(Answer::error(
                Code::Failed,
                "the engine refused that cookie",
            ))
        }
    }

    fn clear(&self) -> Result<(), Answer> {
        let url = Url::parse(&self.view.url())
            .map_err(|_| Answer::error(Code::Failed, "the page has no address"))?;
        for cookie in self.cookies()? {
            let _ = store_cookie(self, &cookie, &url, true);
        }
        let _ = isolated(self, "(() => { try { localStorage.clear() } catch (_) {} try { sessionStorage.clear() } catch (_) {} })()");
        clear_site(self, url.host_str().unwrap_or_default().to_lowercase())
    }

    fn local(&self) -> Result<Map<String, Value>, Answer> {
        let said = isolated(self, "(() => { const out = {}; for (let at = 0; at < localStorage.length; at++) { const key = localStorage.key(at); out[key] = localStorage.getItem(key) } return out })()")?;
        Ok(said.as_object().cloned().unwrap_or_default())
    }
}
