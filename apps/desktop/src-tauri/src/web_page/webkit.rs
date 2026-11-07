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

static KEPT: u8 = 0;

struct Held {
    inner: Option<Retained<ProtocolObject<dyn WKNavigationDelegate>>>,
    app: AppHandle,
    tab: String,
    window: String,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "OrdenWebPageNavigation"]
    #[ivars = Held]
    struct Watcher;

    unsafe impl NSObjectProtocol for Watcher {}

    unsafe impl WKNavigationDelegate for Watcher {
        #[unsafe(method(webView:decidePolicyForNavigationAction:decisionHandler:))]
        fn decide_policy_for_navigation_action(
            &self,
            webview: &WKWebView,
            action: &WKNavigationAction,
            decide: &DynBlock<dyn Fn(WKNavigationActionPolicy)>,
        ) {
            decided(self, webview, action, decide);
        }

        #[unsafe(method(webView:didStartProvisionalNavigation:))]
        fn did_start_provisional_navigation(
            &self,
            webview: &WKWebView,
            navigation: Option<&WKNavigation>,
        ) {
            started(self, webview, navigation);
        }

        #[unsafe(method(webView:didFinishNavigation:))]
        fn did_finish_navigation(&self, webview: &WKWebView, navigation: Option<&WKNavigation>) {
            finished(self, webview, navigation);
        }

        #[unsafe(method(webView:didFailProvisionalNavigation:withError:))]
        fn did_fail_provisional_navigation(
            &self,
            webview: &WKWebView,
            navigation: Option<&WKNavigation>,
            error: &NSError,
        ) {
            failed(self, webview, navigation, error, true);
        }

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
        #[unsafe(method(respondsToSelector:))]
        fn responds_to_selector(&self, selector: Sel) -> bool {
            forwards(self, selector)
        }

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

#[allow(
    unsafe_code,
    reason = "the superclass's own answer is asked for through the Objective-C runtime"
)]
fn forwards(watcher: &Watcher, selector: Sel) -> bool {
    let own: bool = unsafe { msg_send![super(watcher), respondsToSelector: selector] };
    own || watcher
        .ivars()
        .inner
        .as_ref()
        .is_some_and(|inner| inner.respondsToSelector(selector))
}

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

#[allow(
    unsafe_code,
    reason = "wry's delegate is called through the Objective-C runtime with the engine's own arguments"
)]
fn started(watcher: &Watcher, webview: &WKWebView, navigation: Option<&WKNavigation>) {
    let selector = objc2::sel!(webView:didStartProvisionalNavigation:);
    if let Some(inner) = &watcher.ivars().inner {
        if inner.respondsToSelector(selector) {
            unsafe {
                let () = msg_send![&**inner, webView: webview, didStartProvisionalNavigation: navigation];
            }
        }
    }
    crate::agents::engines::webkit::started(&crate::web_tabs::label_of(&watcher.ivars().tab));
}

#[allow(
    unsafe_code,
    reason = "wry's delegate is called through the Objective-C runtime with the engine's own arguments"
)]
fn finished(watcher: &Watcher, webview: &WKWebView, navigation: Option<&WKNavigation>) {
    let selector = objc2::sel!(webView:didFinishNavigation:);
    if let Some(inner) = &watcher.ivars().inner {
        if inner.respondsToSelector(selector) {
            unsafe {
                let () = msg_send![&**inner, webView: webview, didFinishNavigation: navigation];
            }
        }
    }
    crate::agents::engines::webkit::arrived(&crate::web_tabs::label_of(&watcher.ivars().tab), None);
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
            bare: provisional,
            reason: Some(error.localizedDescription().to_string()).filter(|one| !one.is_empty()),
        },
    );
}

fn tell(watcher: &Watcher, said: Said) {
    let held = watcher.ivars();
    let heard = Heard {
        tab: held.tab.clone(),
        said,
    };
    let _ = held.app.emit_to(held.window.as_str(), SAID, heard);
}

#[allow(
    unsafe_code,
    reason = "a WKWebView's navigation delegate is set, and kept alive, through the Objective-C runtime"
)]
pub fn listen(webview: &PlatformWebview, app: AppHandle, tab: String, window: String) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };

    let Some(view) = (unsafe { Retained::retain(webview.inner().cast::<WKWebView>()) }) else {
        return;
    };

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
