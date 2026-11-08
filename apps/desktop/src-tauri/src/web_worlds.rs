use serde_json::{json, Value};

pub(crate) const WORLD: &str = "orden";

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
const MARK: &str = "void 0";

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn taken_back(last: &str) -> Option<std::ops::RangeInclusive<u32>> {
    let last = last.trim().parse::<u32>().ok().filter(|one| *one > 0)?;
    Some(1..=last)
}

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn registering(source: &str) -> String {
    json!({ "source": source, "worldName": WORLD }).to_string()
}

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn frame_of(tree: &str) -> Option<String> {
    let said: Value = serde_json::from_str(tree).ok()?;
    said.pointer("/frameTree/frame/id")?
        .as_str()
        .map(str::to_string)
}

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn world_in(frame: &str) -> String {
    json!({ "frameId": frame, "worldName": WORLD }).to_string()
}

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn context_of(world: &str) -> Option<i64> {
    let said: Value = serde_json::from_str(world).ok()?;
    said.get("executionContextId")?.as_i64()
}

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn evaluating(expression: &str, context: i64) -> String {
    json!({
        "expression": expression,
        "contextId": context,
        "awaitPromise": true,
        "returnByValue": true,
    })
    .to_string()
}

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
const IN_THE_PAGE: &[&str] = &["iframe", "worker"];

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
const IN_A_FRAME: &[&str] = &["iframe", "worker"];

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn attaching(kinds: &[&str]) -> String {
    let filter: Vec<Value> = kinds.iter().map(|kind| json!({ "type": kind })).collect();
    json!({
        "autoAttach": true,
        "waitForDebuggerOnStart": true,
        "flatten": true,
        "filter": filter,
    })
    .to_string()
}

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
#[derive(Debug, PartialEq, Eq)]
enum Attached {
    Frame(String),
    Held(String),
}

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn attached(event: &str) -> Option<Attached> {
    let said: Value = serde_json::from_str(event).ok()?;
    let session = said.get("sessionId")?.as_str()?.to_string();
    if said.pointer("/targetInfo/type").and_then(Value::as_str) == Some("iframe") {
        return Some(Attached::Frame(session));
    }
    said.get("waitingForDebugger")
        .and_then(Value::as_bool)
        .unwrap_or(false)
        .then_some(Attached::Held(session))
}

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn pass_binding() -> Value {
    json!({ "name": crate::web_pass::BINDING, "executionContextName": WORLD })
}

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn let_go() -> (&'static str, String) {
    ("Runtime.runIfWaitingForDebugger", "{}".to_string())
}

#[cfg_attr(all(not(windows), not(feature = "cef")), allow(dead_code))]
fn in_frame(scripts: &str) -> [(&'static str, String); 4] {
    [
        ("Page.enable", "{}".to_string()),
        (
            "Page.addScriptToEvaluateOnNewDocument",
            registering(scripts),
        ),
        ("Target.setAutoAttach", attaching(IN_A_FRAME)),
        let_go(),
    ]
}

#[derive(Default)]
pub struct Cleared {
    swept: bool,
    counted: Option<usize>,
    ours: bool,
    frames: bool,
}

impl Cleared {
    pub fn said(&self) -> String {
        let swept = match (self.swept, self.counted) {
            (false, _) => "the runtime's scripts left in".to_string(),
            (true, Some(count)) => format!("{count} of the runtime's scripts taken back"),
            (true, None) => "the runtime's scripts taken back".to_string(),
        };
        let ours = if self.ours {
            "in Orden's world"
        } else {
            "missing"
        };
        let frames = if self.frames {
            ""
        } else {
            ", not in other sites' frames"
        };
        format!("{swept}, Orden's own {ours}{frames}")
    }
}

#[cfg(not(feature = "cef"))]
pub use engine::sent;
#[cfg(all(windows, not(feature = "cef")))]
pub use engine::{cleared, evaluate};

#[cfg(all(windows, not(feature = "cef")))]
mod engine {
    use std::cell::RefCell;
    use std::rc::Rc;

    use tauri::webview::PlatformWebview;
    use webview2_com::Microsoft::Web::WebView2::Win32::{
        ICoreWebView2, ICoreWebView2DevToolsProtocolEventReceivedEventArgs2, ICoreWebView2_11,
    };
    use webview2_com::{
        AddScriptToExecuteOnDocumentCreatedCompletedHandler,
        CallDevToolsProtocolMethodCompletedHandler, DevToolsProtocolEventReceivedEventHandler,
    };
    use windows_core::{Interface as _, HSTRING, PWSTR};

    use super::{
        attached, attaching, context_of, evaluating, frame_of, in_frame, let_go, pass_binding,
        registering, taken_back, world_in, Attached, Cleared, IN_THE_PAGE, MARK,
    };

    #[allow(
        unsafe_code,
        reason = "a page's scripts and settings are WebView2's own, reached through its COM interfaces"
    )]
    pub fn cleared(webview: &PlatformWebview, scripts: &str, then: impl FnOnce(Cleared) + 'static) {
        let Ok(core) = (unsafe { webview.controller().CoreWebView2() }) else {
            then(Cleared::default());
            return;
        };

        unsafe {
            if let Ok(settings) = core.Settings() {
                let _ = settings.SetIsWebMessageEnabled(false);
                let _ = settings.SetAreHostObjectsAllowed(false);
            }
        }

        let scripts = scripts.to_string();
        let sweeping = core.clone();
        added(&core, MARK, move |last| {
            let taken = last.as_deref().and_then(taken_back).map(|every| {
                let mut count = 0usize;
                for id in every {
                    if unsafe {
                        sweeping
                            .RemoveScriptToExecuteOnDocumentCreated(&HSTRING::from(id.to_string()))
                    }
                    .is_ok()
                    {
                        count += 1;
                    }
                }
                count
            });
            let done = move |ours: bool, frames: bool| {
                then(Cleared {
                    swept: taken.is_some(),
                    counted: taken,
                    ours,
                    frames,
                });
            };
            if scripts.is_empty() {
                done(true, true);
                return;
            }
            let following_on = sweeping.clone();
            let followed = scripts.clone();
            let binding = sweeping.clone();
            call(
                &binding,
                "Runtime.addBinding",
                &pass_binding().to_string(),
                move |_| {
                    registered(&sweeping, &scripts, move |ours| {
                        let adding_to = following_on.clone();
                        following(&following_on, &followed, move |frames| {
                            added(&adding_to, crate::web_opens::PAGE_SCRIPT, move |_| {
                                done(ours, frames);
                            });
                        });
                    });
                },
            );
        });
    }

    #[allow(
        unsafe_code,
        reason = "the page is sent to the site through WebView2's own COM interface"
    )]
    pub fn sent(
        webview: &PlatformWebview,
        url: &str,
        scripts: &str,
        then: impl FnOnce(Cleared) + 'static,
    ) {
        let going = unsafe { webview.controller().CoreWebView2() }.ok();
        let url = HSTRING::from(url);
        cleared(webview, scripts, move |done| {
            if let Some(core) = going {
                unsafe {
                    let _ = core.Navigate(&url);
                }
            }
            then(done);
        });
    }

    #[allow(
        unsafe_code,
        reason = "a script is registered through WebView2's own COM interface"
    )]
    fn added(core: &ICoreWebView2, script: &str, then: impl FnOnce(Option<String>) + 'static) {
        let then = Rc::new(RefCell::new(Some(then)));
        let answering = Rc::clone(&then);
        let handler = AddScriptToExecuteOnDocumentCreatedCompletedHandler::create(Box::new(
            move |result, id| {
                let taken = answering.borrow_mut().take();
                if let Some(then) = taken {
                    then(result.ok().map(|()| id).filter(|id| !id.is_empty()));
                }
                Ok(())
            },
        ));

        let sent =
            unsafe { core.AddScriptToExecuteOnDocumentCreated(&HSTRING::from(script), &handler) };
        if sent.is_err() {
            let taken = then.borrow_mut().take();
            if let Some(then) = taken {
                then(None);
            }
        }
    }

    fn registered(core: &ICoreWebView2, scripts: &str, then: impl FnOnce(bool) + 'static) {
        let adding = core.clone();
        let source = registering(scripts);
        call(core, "Page.enable", "{}", move |enabled| {
            if enabled.is_none() {
                then(false);
                return;
            }
            call(
                &adding,
                "Page.addScriptToEvaluateOnNewDocument",
                &source,
                move |added| then(added.is_some()),
            );
        });
    }

    #[allow(
        unsafe_code,
        reason = "the DevTools protocol and its events are WebView2's own, reached through its COM interfaces"
    )]
    fn following(core: &ICoreWebView2, scripts: &str, then: impl FnOnce(bool) + 'static) {
        let Ok(sessions) = core.cast::<ICoreWebView2_11>() else {
            then(false);
            return;
        };
        let Ok(receiver) = (unsafe {
            core.GetDevToolsProtocolEventReceiver(&HSTRING::from("Target.attachedToTarget"))
        }) else {
            then(false);
            return;
        };

        let scripts = scripts.to_string();
        let handler =
            DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_sender, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let event = unsafe {
                    let mut event = PWSTR::null();
                    args.ParameterObjectAsJson(&raw mut event)?;
                    webview2_com::take_pwstr(event)
                };
                let (session, said) = match attached(&event) {
                    Some(Attached::Frame(session)) => (
                        session,
                        std::iter::once(("Runtime.addBinding", pass_binding().to_string()))
                            .chain(in_frame(&scripts))
                            .collect::<Vec<_>>(),
                    ),
                    Some(Attached::Held(session)) => (session, vec![let_go()]),
                    None => return Ok(()),
                };

                let session = HSTRING::from(session);
                for (method, params) in said {
                    let ignored =
                        CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(())));
                    let _ = unsafe {
                        sessions.CallDevToolsProtocolMethodForSession(
                            &session,
                            &HSTRING::from(method),
                            &HSTRING::from(params),
                            &ignored,
                        )
                    };
                }
                Ok(())
            }));

        let mut token = 0i64;
        let listening =
            unsafe { receiver.add_DevToolsProtocolEventReceived(&handler, &raw mut token) };
        if listening.is_err() {
            then(false);
            return;
        }
        rebinding(core);
        call(
            core,
            "Target.setAutoAttach",
            &attaching(IN_THE_PAGE),
            move |said| then(said.is_some()),
        );
    }

    #[allow(
        unsafe_code,
        reason = "the DevTools protocol and its events are WebView2's own, reached through its COM interfaces"
    )]
    fn rebinding(core: &ICoreWebView2) {
        let Ok(sessions) = core.cast::<ICoreWebView2_11>() else {
            return;
        };
        let Ok(receiver) = (unsafe {
            core.GetDevToolsProtocolEventReceiver(&HSTRING::from("Page.frameNavigated"))
        }) else {
            return;
        };
        let handler =
            DevToolsProtocolEventReceivedEventHandler::create(Box::new(move |_sender, args| {
                let Some(args) = args else {
                    return Ok(());
                };
                let session = args
                    .cast::<ICoreWebView2DevToolsProtocolEventReceivedEventArgs2>()
                    .ok()
                    .and_then(|two| unsafe {
                        let mut session = PWSTR::null();
                        two.SessionId(&raw mut session).ok()?;
                        Some(webview2_com::take_pwstr(session))
                    })
                    .unwrap_or_default();
                let ignored =
                    CallDevToolsProtocolMethodCompletedHandler::create(Box::new(|_, _| Ok(())));
                let _ = unsafe {
                    sessions.CallDevToolsProtocolMethodForSession(
                        &HSTRING::from(session),
                        &HSTRING::from("Runtime.addBinding"),
                        &HSTRING::from(pass_binding().to_string()),
                        &ignored,
                    )
                };
                Ok(())
            }));
        let mut token = 0i64;
        let _ = unsafe { receiver.add_DevToolsProtocolEventReceived(&handler, &raw mut token) };
    }

    #[allow(
        unsafe_code,
        reason = "the DevTools protocol is WebView2's own, reached through its COM interface"
    )]
    fn call(
        core: &ICoreWebView2,
        method: &str,
        params: &str,
        then: impl FnOnce(Option<String>) + 'static,
    ) {
        let then = Rc::new(RefCell::new(Some(then)));
        let answering = Rc::clone(&then);
        let handler =
            CallDevToolsProtocolMethodCompletedHandler::create(Box::new(move |result, answer| {
                let taken = answering.borrow_mut().take();
                if let Some(then) = taken {
                    then(result.ok().map(|()| answer));
                }
                Ok(())
            }));

        let sent = unsafe {
            core.CallDevToolsProtocolMethod(
                &HSTRING::from(method),
                &HSTRING::from(params),
                &handler,
            )
        };
        if sent.is_err() {
            let taken = then.borrow_mut().take();
            if let Some(then) = taken {
                then(None);
            }
        }
    }

    pub fn evaluate(
        core: &ICoreWebView2,
        expression: String,
        answer: impl FnOnce(Option<String>) + 'static,
    ) {
        let world = core.clone();
        call(core, "Page.getFrameTree", "{}", move |tree| {
            let Some(frame) = tree.as_deref().and_then(frame_of) else {
                answer(None);
                return;
            };
            let running = world.clone();
            call(
                &world,
                "Page.createIsolatedWorld",
                &world_in(&frame),
                move |made| {
                    let Some(context) = made.as_deref().and_then(context_of) else {
                        answer(None);
                        return;
                    };
                    call(
                        &running,
                        "Runtime.evaluate",
                        &evaluating(&expression, context),
                        answer,
                    );
                },
            );
        });
    }
}

#[cfg(feature = "cef")]
pub use engine::{asking, sent, value};

#[cfg(feature = "cef")]
mod engine {
    use std::time::Duration;

    use serde_json::{json, Value};
    use tauri::{Url, Webview};

    use crate::engine::devtools;

    use super::{
        attached, attaching, context_of, evaluating, frame_of, in_frame, let_go, pass_binding,
        registering, taken_back, world_in, Attached, Cleared, IN_THE_PAGE, MARK,
    };

    const PATIENCE: Duration = Duration::from_secs(10);

    fn binding() -> Value {
        json!({ "name": crate::web_opens::BINDING, "executionContextName": super::WORLD })
    }

    pub(super) fn bound_again(method: &str) -> Vec<(&'static str, Value)> {
        if method == "Page.frameNavigated" {
            vec![
                ("Runtime.addBinding", binding()),
                ("Runtime.addBinding", pass_binding()),
            ]
        } else {
            Vec::new()
        }
    }

    pub fn asking(view: &Webview, app: &tauri::AppHandle, tab: &str, window: &str) {
        let (app, tab, window) = (app.clone(), tab.to_string(), window.to_string());
        let page = view.clone();
        let _ = devtools::hear(view, move |method, session, params| {
            if method != "Runtime.bindingCalled" {
                return;
            }
            let Some(payload) = params.get("payload").and_then(Value::as_str) else {
                return;
            };
            match params.get("name").and_then(Value::as_str) {
                Some(crate::web_opens::BINDING) => {
                    crate::web_opens::heard_on_chromium(&app, &window, &tab, payload);
                }
                Some(crate::web_swipe::BINDING) => {
                    crate::web_swipe::heard(&app, &window, &tab, payload);
                }
                Some(crate::web_pass::BINDING) => {
                    crate::web_pass::binding_called(&page, &app, &window, &tab, session, params);
                }
                _ => {}
            }
        });
    }

    fn called(view: &Webview, method: &str, params: &str) -> Option<Value> {
        let params: Value = serde_json::from_str(params).ok()?;
        devtools::call(view, None, method, &params, PATIENCE).ok()
    }

    pub fn sent(view: &Webview, url: &Url, scripts: &str) -> Cleared {
        let enabled = called(view, "Page.enable", "{}").is_some();
        let taken = called(
            view,
            "Page.addScriptToEvaluateOnNewDocument",
            &json!({ "source": MARK }).to_string(),
        )
        .and_then(|said| said.get("identifier")?.as_str().map(str::to_string))
        .as_deref()
        .and_then(taken_back)
        .map(|every| {
            every
                .filter(|id| {
                    called(
                        view,
                        "Page.removeScriptToEvaluateOnNewDocument",
                        &json!({ "identifier": id.to_string() }).to_string(),
                    )
                    .is_some()
                })
                .count()
        });

        let _ = called(view, "Runtime.addBinding", &binding().to_string());
        let _ = called(
            view,
            "Runtime.addBinding",
            &crate::web_swipe::binding().to_string(),
        );
        let _ = called(view, "Runtime.addBinding", &pass_binding().to_string());
        let ours = scripts.is_empty()
            || (enabled
                && called(
                    view,
                    "Page.addScriptToEvaluateOnNewDocument",
                    &registering(scripts),
                )
                .is_some());
        let frames = scripts.is_empty() || following(view, scripts);
        if !scripts.is_empty() {
            let _ = called(
                view,
                "Page.addScriptToEvaluateOnNewDocument",
                &json!({ "source": crate::web_opens::PAGE_SCRIPT }).to_string(),
            );
        }

        let _ = view.navigate(url.clone());
        Cleared {
            swept: taken.is_some(),
            counted: taken,
            ours,
            frames,
        }
    }

    fn following(view: &Webview, scripts: &str) -> bool {
        let telling = view.clone();
        let scripts = scripts.to_string();
        let heard = devtools::hear(view, move |method, session, params| {
            let again = bound_again(method);
            if !again.is_empty() {
                devtools::tell(&telling, session, again);
                return;
            }
            if method != "Target.attachedToTarget" {
                return;
            }
            let parsed = |(method, params): (&'static str, String)| {
                Some((method, serde_json::from_str(&params).ok()?))
            };
            let (session, said) = match attached(&params.to_string()) {
                Some(Attached::Frame(session)) => (
                    session,
                    [
                        ("Runtime.addBinding", binding()),
                        ("Runtime.addBinding", crate::web_swipe::binding()),
                        ("Runtime.addBinding", pass_binding()),
                    ]
                    .into_iter()
                    .chain(in_frame(&scripts).into_iter().filter_map(parsed))
                    .collect(),
                ),
                Some(Attached::Held(session)) => (session, parsed(let_go()).into_iter().collect()),
                None => return,
            };
            devtools::tell(&telling, Some(&session), said);
        });
        heard.is_ok() && called(view, "Target.setAutoAttach", &attaching(IN_THE_PAGE)).is_some()
    }

    pub fn value(view: &Webview, expression: &str) -> Option<Value> {
        let tree = called(view, "Page.getFrameTree", "{}")?;
        let frame = frame_of(&tree.to_string())?;
        let world = called(view, "Page.createIsolatedWorld", &world_in(&frame))?;
        let context = context_of(&world.to_string())?;
        called(view, "Runtime.evaluate", &evaluating(expression, context))?
            .pointer("/result/value")
            .cloned()
    }
}

#[cfg(all(not(windows), not(feature = "cef")))]
const CHANNEL: &str = "ipc";

#[cfg(all(target_os = "macos", not(feature = "cef")))]
mod engine {
    use objc2::rc::Retained;
    use objc2::{MainThreadMarker, MainThreadOnly as _};
    use objc2_foundation::{NSString, NSURLRequest, NSURL};
    use objc2_web_kit::{WKContentWorld, WKUserScript, WKUserScriptInjectionTime, WKWebView};
    use tauri::webview::PlatformWebview;

    use super::{Cleared, CHANNEL, WORLD};

    pub fn sent(
        webview: &PlatformWebview,
        url: &str,
        scripts: &str,
        then: impl FnOnce(Cleared) + 'static,
    ) {
        then(swept(webview, url, scripts));
    }

    #[allow(
        unsafe_code,
        reason = "a WKWebView's user scripts are reached through the Objective-C runtime"
    )]
    fn swept(webview: &PlatformWebview, url: &str, scripts: &str) -> Cleared {
        let Some(mtm) = MainThreadMarker::new() else {
            return Cleared::default();
        };
        let Some(view) = (unsafe { Retained::retain(webview.inner().cast::<WKWebView>()) }) else {
            return Cleared::default();
        };

        let content = unsafe { view.configuration().userContentController() };
        let counted = unsafe {
            let counted = content.userScripts().count();
            content.removeAllUserScripts();
            content.removeScriptMessageHandlerForName(&NSString::from_str(CHANNEL));
            counted
        };

        if !scripts.is_empty() {
            unsafe {
                let page = WKUserScript::initWithSource_injectionTime_forMainFrameOnly(
                    WKUserScript::alloc(mtm),
                    &NSString::from_str(&crate::web_opens::engine_page_script()),
                    WKUserScriptInjectionTime::AtDocumentStart,
                    false,
                );
                content.addUserScript(&page);
                let world = WKContentWorld::worldWithName(&NSString::from_str(WORLD), mtm);
                let script =
                    WKUserScript::initWithSource_injectionTime_forMainFrameOnly_inContentWorld(
                        WKUserScript::alloc(mtm),
                        &NSString::from_str(scripts),
                        WKUserScriptInjectionTime::AtDocumentStart,
                        false,
                        &world,
                    );
                content.addUserScript(&script);
            }
        }

        if let Some(address) = NSURL::URLWithString(&NSString::from_str(url)) {
            let _ = unsafe { view.loadRequest(&NSURLRequest::requestWithURL(&address)) };
        }

        Cleared {
            swept: true,
            counted: Some(counted),
            ours: true,
            frames: true,
        }
    }
}

#[cfg(all(
    any(
        target_os = "linux",
        target_os = "dragonfly",
        target_os = "freebsd",
        target_os = "netbsd",
        target_os = "openbsd"
    ),
    not(feature = "cef")
))]
mod engine {
    use tauri::webview::PlatformWebview;
    use webkit2gtk::{
        UserContentInjectedFrames, UserContentManagerExt, UserScript, UserScriptInjectionTime,
        WebViewExt,
    };

    use super::{Cleared, CHANNEL, WORLD};

    pub fn sent(
        webview: &PlatformWebview,
        url: &str,
        scripts: &str,
        then: impl FnOnce(Cleared) + 'static,
    ) {
        then(swept(webview, url, scripts));
    }

    fn swept(webview: &PlatformWebview, url: &str, scripts: &str) -> Cleared {
        let view = webview.inner();
        let Some(content) = view.user_content_manager() else {
            view.load_uri(url);
            return Cleared::default();
        };

        content.remove_all_scripts();
        content.unregister_script_message_handler(CHANNEL);
        if !scripts.is_empty() {
            content.add_script(&UserScript::new(
                &crate::web_opens::engine_page_script(),
                UserContentInjectedFrames::AllFrames,
                UserScriptInjectionTime::Start,
                &[],
                &[],
            ));
            content.add_script(&UserScript::for_world(
                scripts,
                UserContentInjectedFrames::AllFrames,
                UserScriptInjectionTime::Start,
                WORLD,
                &[],
                &[],
            ));
        }
        view.load_uri(url);

        Cleared {
            swept: true,
            counted: None,
            ours: true,
            frames: true,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{
        attached, attaching, context_of, evaluating, frame_of, in_frame, let_go, registering,
        taken_back, world_in, Attached, Cleared, IN_A_FRAME, IN_THE_PAGE, WORLD,
    };

    #[test]
    fn the_trace_says_what_was_taken_back_and_what_was_put_in() {
        let all = Cleared {
            swept: true,
            counted: Some(14),
            ours: true,
            frames: true,
        };
        assert_eq!(
            all.said(),
            "14 of the runtime's scripts taken back, Orden's own in Orden's world"
        );
        let none = Cleared::default();
        assert_eq!(
            none.said(),
            "the runtime's scripts left in, Orden's own missing, not in other sites' frames"
        );
    }

    #[test]
    fn every_script_up_to_the_marker_is_taken_back() {
        assert_eq!(taken_back("7"), Some(1..=7));
        assert_eq!(taken_back("1"), Some(1..=1));
    }

    #[test]
    fn a_numbering_this_does_not_read_takes_nothing_back() {
        for said in ["", "0", "-3", "{A1B2}", "7a", "4294967296"] {
            assert_eq!(taken_back(said), None, "{said:?}");
        }
    }

    #[test]
    fn orden_s_scripts_are_registered_in_orden_s_world_and_never_the_page_s() {
        let asked: serde_json::Value =
            serde_json::from_str(&registering("(function () {})()")).expect("json");
        assert_eq!(asked["worldName"], WORLD);
        assert_eq!(asked["source"], "(function () {})()");
        assert!(!WORLD.is_empty());
    }

    #[test]
    fn the_world_is_asked_for_in_the_page_s_own_frame() {
        let tree =
            r#"{"frameTree":{"frame":{"id":"4F2A","url":"https://a.example/"},"childFrames":[]}}"#;
        assert_eq!(frame_of(tree).as_deref(), Some("4F2A"));
        assert_eq!(frame_of("{}"), None);
        assert_eq!(frame_of("not json"), None);

        let asked: serde_json::Value = serde_json::from_str(&world_in("4F2A")).expect("json");
        assert_eq!(asked["frameId"], "4F2A");
        assert_eq!(asked["worldName"], WORLD);
    }

    #[cfg(feature = "cef")]
    #[test]
    fn a_document_arriving_has_orden_s_binding_put_in_its_world() {
        let again = super::engine::bound_again("Page.frameNavigated");
        let names: Vec<&str> = again
            .iter()
            .map(|(method, params)| {
                assert_eq!(*method, "Runtime.addBinding");
                assert_eq!(params["executionContextName"], WORLD);
                params["name"].as_str().expect("a name")
            })
            .collect();
        assert_eq!(names, [crate::web_opens::BINDING, crate::web_pass::BINDING]);
        assert!(super::engine::bound_again("Runtime.bindingCalled").is_empty());
    }

    #[test]
    fn a_frame_from_another_site_is_followed_and_held_until_it_has_orden_s_world() {
        let asked: serde_json::Value = serde_json::from_str(&attaching(IN_THE_PAGE)).expect("json");
        assert_eq!(asked["autoAttach"], true);
        assert_eq!(asked["waitForDebuggerOnStart"], true);
        assert_eq!(asked["flatten"], true);
        assert_eq!(
            asked["filter"],
            serde_json::json!([{ "type": "iframe" }, { "type": "worker" }])
        );

        let frame = r#"{"sessionId":"S1","targetInfo":{"targetId":"T1","type":"iframe","url":"https://b.example/"},"waitingForDebugger":true}"#;
        assert_eq!(attached(frame), Some(Attached::Frame("S1".into())));
        assert_eq!(attached("{}"), None);
        assert_eq!(attached("not json"), None);
    }

    #[test]
    fn anything_else_held_at_its_start_is_let_go_and_given_nothing() {
        let worker = r#"{"sessionId":"S2","targetInfo":{"targetId":"T2","type":"worker","url":"blob:https://challenges.cloudflare.com/1"},"waitingForDebugger":true}"#;
        assert_eq!(attached(worker), Some(Attached::Held("S2".into())));
        assert_eq!(let_go().0, "Runtime.runIfWaitingForDebugger");

        let running = r#"{"sessionId":"S3","targetInfo":{"targetId":"T3","type":"worker"},"waitingForDebugger":false}"#;
        assert_eq!(attached(running), None);
        let unsaid = r#"{"sessionId":"S4","targetInfo":{"targetId":"T4","type":"service_worker"}}"#;
        assert_eq!(attached(unsaid), None);
    }

    #[test]
    fn a_frame_is_given_orden_s_world_and_always_let_go_last() {
        let sent = in_frame("(function () {})()");
        let methods: Vec<&str> = sent.iter().map(|(method, _)| *method).collect();
        assert_eq!(
            methods,
            [
                "Page.enable",
                "Page.addScriptToEvaluateOnNewDocument",
                "Target.setAutoAttach",
                let_go().0,
            ]
        );
        let registered: serde_json::Value = serde_json::from_str(&sent[1].1).expect("json");
        assert_eq!(registered["worldName"], WORLD);

        let following: serde_json::Value = serde_json::from_str(&sent[2].1).expect("json");
        assert_eq!(following["waitForDebuggerOnStart"], true);
        assert_eq!(
            following["filter"],
            serde_json::json!([{ "type": "iframe" }, { "type": "worker" }])
        );
        assert_eq!(sent[2].1, attaching(IN_A_FRAME));
    }

    #[test]
    fn an_expression_runs_in_that_world_and_answers_with_its_value() {
        assert_eq!(context_of(r#"{"executionContextId":12}"#), Some(12));
        assert_eq!(context_of(r#"{"executionContextId":"12"}"#), None);
        assert_eq!(context_of("{}"), None);

        let asked: serde_json::Value =
            serde_json::from_str(&evaluating("1 + 1", 12)).expect("json");
        assert_eq!(asked["contextId"], 12);
        assert_eq!(asked["expression"], "1 + 1");
        assert_eq!(asked["awaitPromise"], true);
        assert_eq!(asked["returnByValue"], true);
    }
}
