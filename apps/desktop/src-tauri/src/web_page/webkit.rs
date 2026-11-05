//! A web tab's navigations as `WKWebView` tells them (#1093).
//!
//! wry's navigation delegate answers four of the engine's questions about a page - a
//! navigation's policy, its response's, its commit and its end - and none of the rest. Two
//! of the rest decide whether a site appears at all:
//!
//! - **A navigation that failed** (`didFailProvisionalNavigation`, `didFailNavigation`):
//!   a name that does not resolve, a certificate that is wrong, a server that never
//!   answers. Unheard, the tab had no page, no error and no end to its load: the pane
//!   stayed empty - black in a dark theme - under a spinner that never stopped, while
//!   `WebView2` drew its error page and said why. So each is said to the window as the
//!   `Arrived` event `WebView2` already sends, with what the engine gave as the reason, and
//!   one that left the tab with nothing drawn is said to be `bare`, which the window
//!   answers with a card of its own (`failed` in `web-tab/pages.svelte.ts`). A load that
//!   ended is said too, so the bar's https-first falls back on a Mac as well.
//! - **A frame's navigation**. wry asks the tab's own rule about every navigation the
//!   engine asks it about, a frame's included, and that rule is for where a tab may go:
//!   the web and nothing else. So `about:blank`, `about:srcdoc`, `data:` and `blob:`
//!   frames were turned away, and every one of them was an empty box - and each frame's
//!   navigation that was let through told the tab a load had started that no end would
//!   ever answer. A frame is judged here by `frame_may_open` instead, and never reaches
//!   the tab's rule; a frame's download, and a window the page asks for, still go to wry.
//!
//! This delegate stands in front of wry's, the way the downloads' does (`downloads.rs`) and
//! the capture gate stands in front of wry's UI delegate (`web_tabs.rs`): what it answers it
//! passes on to wry's first where wry has it, and every other question is forwarded.

use std::ffi::c_void;

use block2::DynBlock;
use objc2::rc::Retained;
use objc2::runtime::{AnyObject, NSObject, ProtocolObject, Sel};
use objc2::{define_class, msg_send, DefinedClass, MainThreadOnly};
use objc2_foundation::{MainThreadMarker, NSError, NSObjectProtocol, NSString, NSURL};
use objc2_web_kit::{
    WKNavigation, WKNavigationAction, WKNavigationActionPolicy, WKNavigationDelegate, WKWebView,
};
use tauri::webview::PlatformWebview;
use tauri::{AppHandle, Emitter as _, Url};

use super::{failure_of_error, Heard, Said, SAID};

/// The key the delegate is kept under on its webview. Its address is the key.
static KEPT: u8 = 0;

/// What the delegate holds: wry's navigation delegate, and who to tell.
struct Held {
    inner: Option<Retained<ProtocolObject<dyn WKNavigationDelegate>>>,
    app: AppHandle,
    tab: String,
    window: String,
}

define_class!(
    /// A web tab's navigation delegate: its frames judged as frames, and how each of its
    /// navigations ended said to the window; every other question passed to wry's.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "NibWebPageNavigation"]
    #[ivars = Held]
    struct Watcher;

    unsafe impl NSObjectProtocol for Watcher {}

    unsafe impl WKNavigationDelegate for Watcher {
        /// Where a navigation may go: a frame's here, the page's and a new window's wry's.
        #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
        fn decide_policy_for_navigation_action(
            &self,
            webview: &WKWebView,
            action: &WKNavigationAction,
            decide: &DynBlock<dyn Fn(WKNavigationActionPolicy)>,
        ) {
            decided(self, webview, action, decide);
        }

        /// The page's own frame started a navigation: told to wry, and noted for an agent
        /// acting in the tab (#1092).
        #[unsafe(method(webView:didStartProvisionalNavigation:))]
        fn did_start_provisional_navigation(
            &self,
            webview: &WKWebView,
            navigation: Option<&WKNavigation>,
        ) {
            started(self, webview, navigation);
        }

        /// The page's own load ended.
        #[unsafe(method(webView:didFinishNavigation:))]
        fn did_finish_navigation(&self, webview: &WKWebView, navigation: Option<&WKNavigation>) {
            finished(self, webview, navigation);
        }

        /// A navigation failed before anything of it was shown.
        #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
        fn did_fail_provisional_navigation(
            &self,
            webview: &WKWebView,
            navigation: Option<&WKNavigation>,
            error: &NSError,
        ) {
            failed(self, webview, navigation, error, true);
        }

        /// A navigation failed once its page had begun to be shown.
        #[unsafe(method(webView:didFailNavigation:withError:))]
        fn did_fail_navigation(
            &self,
            webview: &WKWebView,
            navigation: Option<&WKNavigation>,
            error: &NSError,
        ) {
            failed(self, webview, navigation, error, false);
        }
    }

    impl Watcher {
        /// Yes for what this delegate has and for what wry's has; `WebKit` reads this
        /// once, as the delegate is set.
        #[unsafe(method(respondsToSelector:))]
        fn responds_to_selector(&self, selector: Sel) -> bool {
            forwards(self, selector)
        }

        /// Everything this delegate does not answer itself goes to wry's.
        #[unsafe(method(forwardingTargetForSelector:))]
        fn forwarding_target_for_selector(&self, _selector: Sel) -> *mut AnyObject {
            self.ivars()
                .inner
                .as_ref()
                .map_or(std::ptr::null_mut(), |inner| {
                    Retained::as_ptr(inner).cast::<AnyObject>().cast_mut()
                })
        }
    }
);

/// Whether the delegate answers a selector, itself or through wry's.
#[allow(
    unsafe_code,
    reason = "the superclass's own answer is asked for through the Objective-C runtime"
)]
fn forwards(watcher: &Watcher, selector: Sel) -> bool {
    // SAFETY: `respondsToSelector:` is `NSObject`'s, takes a selector and answers a
    // boolean; this is the superclass being asked what it has.
    let own: bool = unsafe { msg_send![super(watcher), respondsToSelector: selector] };
    own || watcher
        .ivars()
        .inner
        .as_ref()
        .is_some_and(|inner| inner.respondsToSelector(selector))
}

/// A navigation's policy. A frame's that is no download is judged here, as a frame; the
/// page's own, a new window's and a frame's download are wry's, which asks the tab's rule
/// and starts what downloads.
#[allow(
    unsafe_code,
    reason = "a navigation action is read, and wry's delegate asked, through the Objective-C runtime"
)]
fn decided(
    watcher: &Watcher,
    webview: &WKWebView,
    action: &WKNavigationAction,
    decide: &DynBlock<dyn Fn(WKNavigationActionPolicy)>,
) {
    // SAFETY: the engine's own action, read on the main thread during its own call.
    let frame = unsafe {
        let framed = action
            .targetFrame()
            .is_some_and(|frame| !frame.isMainFrame());
        let downloads = action.respondsToSelector(objc2::sel!(shouldPerformDownload))
            && action.shouldPerformDownload();
        (framed && !downloads).then(|| {
            action
                .request()
                .URL()
                .and_then(|url| url.absoluteString())
                .map(|url| url.to_string())
        })
    };
    if let Some(address) = frame {
        let may = address
            .and_then(|one| Url::parse(&one).ok())
            .is_some_and(|url| crate::web_tabs::frame_may_open(&url));
        decide.call((if may {
            WKNavigationActionPolicy::Allow
        } else {
            WKNavigationActionPolicy::Cancel
        },));
        return;
    }

    let selector = objc2::sel!(webView:decidePolicyForNavigationAction:decisionHandler:);
    match &watcher.ivars().inner {
        // SAFETY: the selector `WKNavigationDelegate` declares, sent to the delegate wry
        // set with the objects the engine handed this call, and only where it has it.
        Some(inner) if inner.respondsToSelector(selector) => unsafe {
            let () = msg_send![
                &**inner,
                webView: webview,
                decidePolicyForNavigationAction: action,
                decisionHandler: decide
            ];
        },
        _ => decide.call((WKNavigationActionPolicy::Allow,)),
    }
}

/// A navigation of the page's own frame started: wry is told, and an agent acting in the
/// tab can wait for where it goes (`agents/engines/webkit.rs`).
#[allow(
    unsafe_code,
    reason = "wry's delegate is called through the Objective-C runtime with the engine's own arguments"
)]
fn started(watcher: &Watcher, webview: &WKWebView, navigation: Option<&WKNavigation>) {
    let selector = objc2::sel!(webView:didStartProvisionalNavigation:);
    if let Some(inner) = &watcher.ivars().inner {
        if inner.respondsToSelector(selector) {
            // SAFETY: as in `decided`.
            unsafe {
                let () = msg_send![&**inner, webView: webview, didStartProvisionalNavigation: navigation];
            }
        }
    }
    crate::agents::engines::webkit::started(&crate::web_tabs::label_of(&watcher.ivars().tab));
}

/// The page's load ended: wry is told first, which is the tab's own end of load, and then
/// the window hears that it arrived.
#[allow(
    unsafe_code,
    reason = "wry's delegate is called through the Objective-C runtime with the engine's own arguments"
)]
fn finished(watcher: &Watcher, webview: &WKWebView, navigation: Option<&WKNavigation>) {
    let selector = objc2::sel!(webView:didFinishNavigation:);
    if let Some(inner) = &watcher.ivars().inner {
        if inner.respondsToSelector(selector) {
            // SAFETY: as in `decided`.
            unsafe {
                let () = msg_send![&**inner, webView: webview, didFinishNavigation: navigation];
            }
        }
    }
    crate::agents::engines::webkit::arrived(&crate::web_tabs::label_of(&watcher.ivars().tab), None);
    // SAFETY: the view's own address, read on the main thread.
    let url = unsafe { webview.URL() }
        .and_then(|url| url.absoluteString())
        .map(|url| url.to_string())
        .unwrap_or_default();
    tell(
        watcher,
        Said::Arrived {
            url,
            failure: None,
            bare: false,
            reason: None,
        },
    );
}

/// A navigation failed: wry is told where it has an answer for it, and the window hears
/// why, and whether the engine left the tab with nothing drawn for it.
#[allow(
    unsafe_code,
    reason = "wry's delegate is called, and the engine's error read, through the Objective-C runtime"
)]
fn failed(
    watcher: &Watcher,
    webview: &WKWebView,
    navigation: Option<&WKNavigation>,
    error: &NSError,
    provisional: bool,
) {
    if let Some(inner) = &watcher.ivars().inner {
        // SAFETY: as in `decided`.
        unsafe {
            if provisional {
                if inner.respondsToSelector(
                    objc2::sel!(webView:didFailProvisionalNavigation:withError:),
                ) {
                    let () = msg_send![
                        &**inner,
                        webView: webview,
                        didFailProvisionalNavigation: navigation,
                        withError: error
                    ];
                }
            } else if inner.respondsToSelector(objc2::sel!(webView:didFailNavigation:withError:)) {
                let () = msg_send![
                    &**inner,
                    webView: webview,
                    didFailNavigation: navigation,
                    withError: error
                ];
            }
        }
    }

    let Some(failure) = failure_of_error(&error.domain().to_string(), error.code()) else {
        crate::agents::engines::webkit::arrived(
            &crate::web_tabs::label_of(&watcher.ivars().tab),
            None,
        );
        return;
    };
    crate::agents::engines::webkit::arrived(
        &crate::web_tabs::label_of(&watcher.ivars().tab),
        Some(format!(
            "the page could not be reached: {}",
            error.localizedDescription()
        )),
    );
    // Where it was going: the failing address the error carries - as a string, or as the
    // address itself, whichever this system's error has - or the view's own.
    let said = error.userInfo();
    let going = said
        .objectForKey(&NSString::from_str("NSErrorFailingURLStringKey"))
        .and_then(|one| one.downcast::<NSString>().ok())
        .map(|one| one.to_string())
        .or_else(|| {
            said.objectForKey(&NSString::from_str("NSErrorFailingURLKey"))
                .and_then(|one| one.downcast::<NSURL>().ok())
                .and_then(|url| url.absoluteString())
                .map(|url| url.to_string())
        })
        .filter(|one| !one.is_empty());
    // SAFETY: the view's own address, read on the main thread.
    let url = going.unwrap_or_else(|| {
        unsafe { webview.URL() }
            .and_then(|url| url.absoluteString())
            .map(|url| url.to_string())
            .unwrap_or_default()
    });
    tell(
        watcher,
        Said::Arrived {
            url,
            failure: Some(failure),
            // Failed before it was shown: the engine draws no page for that, and the tab
            // holds what it held - for a new one, nothing.
            bare: provisional,
            reason: Some(error.localizedDescription().to_string()).filter(|one| !one.is_empty()),
        },
    );
}

/// Says something about the page to its window.
fn tell(watcher: &Watcher, said: Said) {
    let held = watcher.ivars();
    let heard = Heard {
        tab: held.tab.clone(),
        said,
    };
    let _ = held.app.emit_to(held.window.as_str(), SAID, heard);
}

/// Puts the delegate in front of wry's navigation delegate on a tab's webview. Called on
/// the main thread as the page is built, before `downloads.rs` puts its own in front of this
/// one; each forwards what it does not answer to the one behind it.
#[allow(
    unsafe_code,
    reason = "a WKWebView's navigation delegate is set, and kept alive, through the Objective-C runtime"
)]
pub fn listen(webview: &PlatformWebview, app: AppHandle, tab: String, window: String) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };

    // SAFETY: the pointer is the WKWebView wry built for this tab, alive for as long as
    // the tab's page is, and this runs on the main thread where it belongs.
    let Some(view) = (unsafe { Retained::retain(webview.inner().cast::<WKWebView>()) }) else {
        return;
    };

    // SAFETY: reading and setting a delegate on the main thread. The delegate is kept
    // alive by the webview itself below, because `WebKit` holds its navigation delegate
    // weakly; wry's own is held both by wry and by this one.
    unsafe {
        let inner = view.navigationDelegate();
        let watcher = Watcher::alloc(mtm).set_ivars(Held {
            inner,
            app,
            tab,
            window,
        });
        let watcher: Retained<Watcher> = msg_send![super(watcher), init];

        view.setNavigationDelegate(Some(ProtocolObject::from_ref(&*watcher)));
        objc2::ffi::objc_setAssociatedObject(
            Retained::as_ptr(&view).cast::<AnyObject>().cast_mut(),
            (&raw const KEPT).cast::<c_void>(),
            Retained::as_ptr(&watcher).cast::<AnyObject>().cast_mut(),
            objc2::ffi::OBJC_ASSOCIATION_RETAIN_NONATOMIC,
        );
    }
}
