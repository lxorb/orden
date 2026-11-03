//! The `DevTools` Protocol on one page of Orden's own Chromium: calls, and what the page
//! says back.
//!
//! The same protocol `WebView2` speaks through its COM interfaces (see
//! `agents/cdp.rs` and `web_worlds.rs`), reached the way `tauri-runtime-cef` offers it: a
//! message sent to the browser's own agent, and one observer per browser that hears
//! every message the agent sends - the answers to anybody's calls, the runtime's own
//! included, and every event. No port and no socket, so nothing else on the machine
//! reaches it.
//!
//! **Calls wait on the caller's thread, never the window's.** Sending a message waits
//! for the event loop to take it, and the answer arrives on the thread the event loop
//! runs on; a call made from that thread would be waiting for itself. Every caller here
//! is a thread of its own or a command's.
//!
//! **Every message, read whole.** The observer is handed each message twice - raw, and
//! then sorted into an answer or an event - and only the raw one says which session a
//! message belongs to, which is how a frame from another site (a process of its own,
//! attached with `Target.setAutoAttach`) is told from the page. So the raw one is read,
//! and the sorted ones are not.

use std::collections::HashMap;
use std::sync::mpsc::{sync_channel, SyncSender};
use std::sync::{Arc, LazyLock, Mutex, PoisonError};
use std::time::Duration;

use serde_json::{json, Value};
use tauri::Webview;
use tauri_runtime_cef::{allocate_devtools_message_id, DevToolsProtocol, WebviewCefExt as _};

/// What hears a page's events: the method, the session it came from (`None` for the
/// page itself), and its parameters.
type Hearing = Arc<dyn Fn(&str, Option<&str>, &Value) + Send + Sync>;

/// One page's conversation with its agent.
#[derive(Default)]
struct Page {
    /// Who is waiting for which answer.
    waiting: Mutex<HashMap<i64, SyncSender<Result<Value, String>>>>,
    /// Who hears the page's events.
    hearing: Mutex<Vec<Hearing>>,
    /// Whether the observer is registered, held while it is being registered: every
    /// caller waits for the first one's registration, since an answer the agent sends
    /// before there is an observer is heard by nobody.
    observed: Mutex<bool>,
}

/// The pages spoken to, by the webview's label.
type Pages = Mutex<HashMap<String, Arc<Page>>>;

/// Every page that has been spoken to, by the webview's label. A label is reused only
/// after its page has gone, and the observer of a page that has gone hears nothing.
static PAGES: LazyLock<Pages> = LazyLock::new(Mutex::default);

/// The conversation with this webview's page, the observer registered the first time.
fn page(view: &Webview) -> Result<Arc<Page>, String> {
    page_in(&PAGES, view.label(), |made| {
        let heard = Arc::clone(made);
        view.on_dev_tools_protocol(move |said| {
            if let DevToolsProtocol::Message(raw) = said {
                if let Ok(message) = serde_json::from_slice::<Value>(&raw) {
                    read(&heard, &message);
                }
            }
        })
        .map_err(|error| format!("the page's agent could not be reached: {error}"))
    })
}

/// The page under `label` in `pages`, made the first time and its observer registered
/// through `register` until one registration has worked.
///
/// **The list is never held while the observer is registered.** Registering waits for
/// the window's thread, which takes the runtime's message - and the window's thread takes
/// the list as well, to let go of a page that is closing (`let_go_of`, from `web_close`).
/// A page being built on one thread, held here, and another closed on the window's own
/// was each waiting for the other: Ctrl+W pressed through tabs whose pages were still
/// coming up froze the whole app for good (#1031). Only the page's own `observed` is held
/// across the wait, which nothing on the window's thread ever takes.
fn page_in(
    pages: &Pages,
    label: &str,
    register: impl FnOnce(&Arc<Page>) -> Result<(), String>,
) -> Result<Arc<Page>, String> {
    let found = Arc::clone(
        pages
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .entry(label.to_string())
            .or_default(),
    );
    let mut observed = found
        .observed
        .lock()
        .unwrap_or_else(PoisonError::into_inner);
    if !*observed {
        register(&found)?;
        *observed = true;
    }
    drop(observed);
    Ok(found)
}

/// One message from the agent: an answer for whoever waits on its id, or an event for
/// whoever hears the page.
fn read(page: &Page, message: &Value) {
    let session = message.get("sessionId").and_then(Value::as_str);
    if let Some(id) = message.get("id").and_then(Value::as_i64) {
        let waiting = page
            .waiting
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .remove(&id);
        if let Some(waiting) = waiting {
            let _ = waiting.try_send(answer(message));
        }
        return;
    }
    let Some(method) = message.get("method").and_then(Value::as_str) else {
        return;
    };
    let params = message.get("params").cloned().unwrap_or(Value::Null);
    let hearing = page
        .hearing
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .clone();
    for one in hearing {
        one(method, session, &params);
    }
}

/// What an answer says: its result, or the agent's own words for why there is none.
fn answer(message: &Value) -> Result<Value, String> {
    if let Some(error) = message.get("error") {
        return Err(error
            .get("message")
            .and_then(Value::as_str)
            .unwrap_or("the page refused")
            .to_string());
    }
    Ok(message.get("result").cloned().unwrap_or(Value::Null))
}

/// The message a call is sent as.
fn asking(id: i64, method: &str, params: &Value, session: Option<&str>) -> Value {
    let mut message = json!({ "id": id, "method": method, "params": params });
    if let Some(session) = session {
        message["sessionId"] = Value::from(session);
    }
    message
}

/// Calls one method on the page - or on the frame `session` names - and waits at most
/// `patience` for the answer. From any thread but the window's; see the top of this file.
pub fn call(
    view: &Webview,
    session: Option<&str>,
    method: &str,
    params: &Value,
    patience: Duration,
) -> Result<Value, String> {
    let page = page(view)?;
    let id = i64::from(
        allocate_devtools_message_id()
            .map_err(|_| "the page's agent has answered all it will".to_string())?,
    );
    let (answered, waiting) = sync_channel(1);
    page.waiting
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .insert(id, answered);

    let sent = view
        .send_dev_tools_message(asking(id, method, params, session).to_string().as_bytes())
        .map_err(|error| format!("the page's agent could not be reached: {error}"));
    let outcome = sent.and_then(|()| {
        waiting
            .recv_timeout(patience)
            .map_err(|_| format!("the page did not answer {method}"))?
    });
    page.waiting
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(&id);
    outcome
}

/// Sends methods one after another, in order, on a thread of their own, and waits for
/// none of their answers: for what a page is told from inside one of its own events,
/// which run on the thread a call would be waiting on. The order is the order the page
/// runs them in, which matters to a frame held at its start until the last of them.
pub fn tell(view: &Webview, session: Option<&str>, said: Vec<(&'static str, Value)>) {
    let view = view.clone();
    let session = session.map(str::to_string);
    std::thread::spawn(move || {
        for (method, params) in said {
            let Ok(id) = allocate_devtools_message_id() else {
                return;
            };
            let message = asking(i64::from(id), method, &params, session.as_deref());
            let _ = view.send_dev_tools_message(message.to_string().as_bytes());
        }
    });
}

/// Hears every event the page says from now on, for as long as it is open.
pub fn hear(
    view: &Webview,
    heard: impl Fn(&str, Option<&str>, &Value) + Send + Sync + 'static,
) -> Result<(), String> {
    page(view)?
        .hearing
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .push(Arc::new(heard));
    Ok(())
}

/// Lets go of a page that has closed, so its label can be a new page's. On the window's
/// own thread, and so never waiting on a page being registered; see `page_in`.
pub fn let_go_of(label: &str) {
    forget(&PAGES, label);
}

/// `label`'s page taken off `pages`.
fn forget(pages: &Pages, label: &str) {
    pages
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(label);
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use std::sync::mpsc::channel;
    use std::sync::Arc;
    use std::time::Duration;

    use super::{answer, asking, forget, page_in, read, Page, Pages};

    /// #1031: a page being registered on one thread - which waits for the window's thread -
    /// while the window's thread lets go of another page that is closing. The letting go
    /// has to come back without the registration having ended, or each waits for the other.
    #[test]
    fn a_page_closing_never_waits_for_another_being_registered() {
        let pages: Arc<Pages> = Arc::default();
        let (registering, registered) = channel();
        let (window, waiting_for_window) = channel::<()>();

        let building = Arc::clone(&pages);
        let builder = std::thread::spawn(move || {
            page_in(&building, "web-a", |_| {
                registering.send(()).unwrap();
                // The runtime's message, which only the window's thread answers.
                waiting_for_window.recv().map_err(|error| error.to_string())
            })
            .map(|_| ())
        });
        registered.recv().unwrap();

        // The window's thread, closing another tab's page meanwhile.
        let (closed, closing) = channel();
        let window_thread = Arc::clone(&pages);
        std::thread::spawn(move || {
            forget(&window_thread, "web-b");
            closed.send(()).unwrap();
        });
        let answered = closing.recv_timeout(Duration::from_secs(5));

        // The window's thread answers the registration either way, so a failing run ends.
        window.send(()).unwrap();
        builder.join().unwrap().unwrap();
        assert!(
            answered.is_ok(),
            "closing a page waited for another being registered"
        );
    }

    /// Everybody asking for a page while its observer is registered waits for that, and
    /// it is registered once; one that failed is tried again by the next.
    #[test]
    fn a_page_is_observed_once_and_after_a_failure_again() {
        let pages = Pages::default();
        let mut tries = 0;
        let failed = page_in(&pages, "web-a", |_| {
            tries += 1;
            Err("not yet".to_string())
        });
        assert!(failed.is_err());
        let first = page_in(&pages, "web-a", |_| {
            tries += 1;
            Ok(())
        })
        .unwrap();
        let again = page_in(&pages, "web-a", |_| {
            tries += 1;
            Ok(())
        })
        .unwrap();
        assert_eq!(tries, 2);
        assert!(Arc::ptr_eq(&first, &again));

        forget(&pages, "web-a");
        let fresh = page_in(&pages, "web-a", |_| Ok(())).unwrap();
        assert!(!Arc::ptr_eq(&first, &fresh));
    }

    #[test]
    fn an_answer_is_its_result_or_the_agent_s_words() {
        assert_eq!(
            answer(&json!({ "id": 3, "result": { "identifier": "4" } })),
            Ok(json!({ "identifier": "4" }))
        );
        assert_eq!(
            answer(&json!({ "id": 3, "error": { "code": -32000, "message": "No frame" } })),
            Err("No frame".to_string())
        );
    }

    #[test]
    fn a_call_names_its_session_only_when_it_has_one() {
        let page = asking(7, "Runtime.evaluate", &json!({ "expression": "1" }), None);
        assert!(page.get("sessionId").is_none());
        let frame = asking(7, "Runtime.evaluate", &json!({}), Some("S1"));
        assert_eq!(frame["sessionId"], "S1");
        assert_eq!(frame["id"], 7);
    }

    #[test]
    fn an_event_reaches_every_hearer_with_its_session() {
        let page = Page::default();
        let seen = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let noting = seen.clone();
        page.hearing.lock().unwrap().push(std::sync::Arc::new(
            move |method: &str, session: Option<&str>, _: &serde_json::Value| {
                noting
                    .lock()
                    .unwrap()
                    .push((method.to_string(), session.map(str::to_string)));
            },
        ));
        read(
            &page,
            &json!({ "method": "Target.attachedToTarget", "params": {}, "sessionId": "S9" }),
        );
        read(&page, &json!({ "id": 99, "result": {} }));
        assert_eq!(
            *seen.lock().unwrap(),
            vec![(
                "Target.attachedToTarget".to_string(),
                Some("S9".to_string())
            )]
        );
    }
}
