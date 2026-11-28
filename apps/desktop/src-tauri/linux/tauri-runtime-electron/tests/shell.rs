use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::io::{PipeReader, PipeWriter, Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc::{channel, Receiver, Sender};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use serde_json::{json, Value};
use tauri::Manager as _;
use tauri_runtime_electron::wire::{
    Bounds, FromShell, PageEvent, Point, ToShell, Transport, WebviewCall, WindowCall, WindowChange,
    PROTOCOL, SCHEMES,
};
use tauri_runtime_electron::Electron;

const ORIGIN: &str = "tauri://localhost";

#[tauri::command]
fn whoami(webview: tauri::Webview) -> String {
    webview.label().to_owned()
}

#[tauri::command]
fn count(channel: tauri::ipc::Channel<u32>) -> Result<(), String> {
    (0..5).try_for_each(|one| channel.send(one).map_err(|error| error.to_string()))
}

#[tauri::command]
fn width(window: tauri::Window) -> Result<u32, String> {
    window.inner_size().map(|size| size.width).map_err(|error| error.to_string())
}

fn read_frame(reader: &mut impl Read) -> Option<(Vec<u8>, Vec<u8>)> {
    let mut sizes = [0u8; 8];
    reader.read_exact(&mut sizes).ok()?;
    let head = u32::from_le_bytes([sizes[0], sizes[1], sizes[2], sizes[3]]);
    let body = u32::from_le_bytes([sizes[4], sizes[5], sizes[6], sizes[7]]);
    let mut head = vec![0u8; usize::try_from(head).ok()?];
    reader.read_exact(&mut head).ok()?;
    let mut body = vec![0u8; usize::try_from(body).ok()?];
    reader.read_exact(&mut body).ok()?;
    Some((head, body))
}

fn write_frame(writer: &mut impl Write, message: &FromShell, body: &[u8]) -> bool {
    let head = serde_json::to_vec(message).expect("a message");
    let mut frame = Vec::new();
    frame.extend_from_slice(&u32::try_from(head.len()).expect("a head").to_le_bytes());
    frame.extend_from_slice(&u32::try_from(body.len()).expect("a body").to_le_bytes());
    frame.extend_from_slice(&head);
    frame.extend_from_slice(body);
    writer.write_all(&frame).and_then(|()| writer.flush()).is_ok()
}

fn said(reader: &mut impl Read) -> Option<(ToShell, Vec<u8>)> {
    let (head, body) = read_frame(reader)?;
    Some((serde_json::from_slice(&head).expect("a message of the protocol"), body))
}

fn canned(message: &ToShell) -> Option<(u64, Value)> {
    let bounds = || json!(Bounds { x: 10, y: 20, width: 800, height: 600 });
    match message {
        ToShell::WindowCall { id: Some(id), call, .. } => Some((
            *id,
            match call {
                WindowCall::ScaleFactor => json!(1.0),
                WindowCall::InnerBounds | WindowCall::OuterBounds => bounds(),
                WindowCall::GetTitle => json!("a title"),
                _ => json!(false),
            },
        )),
        ToShell::WebviewCall { id: Some(id), call, .. } => Some((
            *id,
            match call {
                WebviewCall::GetUrl => json!("tauri://localhost/"),
                WebviewCall::Bounds => bounds(),
                _ => json!(false),
            },
        )),
        ToShell::Eval { id: Some(id), .. } => Some((*id, Value::Null)),
        ToShell::Screen { id, .. } => Some((*id, json!([]))),
        ToShell::Cursor { id } => Some((*id, json!(Point { x: 1.0, y: 2.0 }))),
        ToShell::Dark { id } => Some((*id, json!(false))),
        ToShell::Version { id } => Some((*id, json!("156.0"))),
        _ => None,
    }
}

enum Answer {
    Responded { status: u16, headers: HashMap<String, String>, body: Vec<u8> },
    Refused,
}

impl Answer {
    fn responded(self) -> (u16, HashMap<String, String>, Vec<u8>) {
        match self {
            Self::Responded { status, headers, body } => (status, headers, body),
            Self::Refused => panic!("the request was refused"),
        }
    }
}

struct Shell {
    writer: Arc<Mutex<Option<PipeWriter>>>,
    frames: Receiver<(ToShell, Vec<u8>)>,
    kept: RefCell<VecDeque<(ToShell, Vec<u8>)>>,
    answering: Arc<AtomicBool>,
    requests: u64,
}

impl Shell {
    fn over(mut reader: PipeReader, writer: PipeWriter) -> Self {
        let writer = Arc::new(Mutex::new(Some(writer)));
        let answering = Arc::new(AtomicBool::new(true));
        let (tx, frames): (Sender<(ToShell, Vec<u8>)>, _) = channel();
        let (answers, on) = (writer.clone(), answering.clone());
        std::thread::spawn(move || {
            while let Some((message, body)) = said(&mut reader) {
                if let (true, Some((id, value))) = (on.load(Ordering::SeqCst), canned(&message)) {
                    if let Some(writer) = answers.lock().expect("the writer").as_mut() {
                        write_frame(writer, &FromShell::Reply { id, value }, &[]);
                    }
                }
                if tx.send((message, body)).is_err() {
                    break;
                }
            }
        });
        Self { writer, frames, kept: RefCell::default(), answering, requests: 0 }
    }

    fn send(&self, message: &FromShell, body: &[u8]) {
        let mut writer = self.writer.lock().expect("the writer");
        assert!(write_frame(writer.as_mut().expect("an open pipe"), message, body));
    }

    fn hang_up(&self) {
        self.writer.lock().expect("the writer").take();
    }

    fn until<R>(&self, mut pick: impl FnMut(&ToShell, &[u8]) -> Option<R>) -> R {
        let mut kept = self.kept.borrow_mut();
        for at in 0..kept.len() {
            if let Some(found) = pick(&kept[at].0, &kept[at].1) {
                kept.remove(at);
                return found;
            }
        }
        loop {
            let (message, body) = self.frames.recv().expect("the core left before it said this");
            if let Some(found) = pick(&message, &body) {
                return found;
            }
            kept.push_back((message, body));
        }
    }

    fn request(
        &mut self,
        webview: Option<u32>,
        url: &str,
        method: &str,
        headers: &[(&str, &str)],
        body: &[u8],
    ) -> Answer {
        self.requests += 1;
        let request = self.requests;
        self.send(
            &FromShell::Request {
                request,
                webview,
                url: url.to_owned(),
                method: method.to_owned(),
                headers: headers.iter().map(|&(name, value)| (name.into(), value.into())).collect(),
            },
            body,
        );
        self.until(|message, body| match message {
            ToShell::Respond { request: answered, status, headers } if *answered == request => {
                Some(Answer::Responded {
                    status: *status,
                    headers: headers.iter().cloned().collect(),
                    body: body.to_vec(),
                })
            }
            ToShell::Refuse { request: answered } if *answered == request => Some(Answer::Refused),
            _ => None,
        })
    }

    fn invoke(
        &mut self,
        webview: Option<u32>,
        key: &str,
        command: &str,
        payload: &Value,
    ) -> Answer {
        self.request(
            webview,
            &format!("ipc://localhost/{command}"),
            "POST",
            &[
                ("content-type", "application/json"),
                ("tauri-callback", "1"),
                ("tauri-error", "2"),
                ("tauri-invoke-key", key),
                ("origin", ORIGIN),
            ],
            payload.to_string().as_bytes(),
        )
    }

    fn post(&self, webview: Option<u32>, key: &str, command: &str, payload: &Value, callback: u32) {
        let message = json!({
            "cmd": command,
            "callback": callback,
            "error": callback + 1,
            "payload": payload,
            "options": null,
            "__TAURI_INVOKE_KEY__": key,
        });
        self.send(
            &FromShell::Post { webview, url: format!("{ORIGIN}/") },
            message.to_string().as_bytes(),
        );
    }

    fn evaluated(&self, webview: u32, holding: &str) -> String {
        self.until(|message, _| match message {
            ToShell::Eval { webview: at, script, .. }
                if *at == webview && script.contains(holding) =>
            {
                Some(script.clone())
            }
            _ => None,
        })
    }
}

fn pipes() -> (PipeReader, PipeWriter, PipeReader, PipeWriter) {
    let (core_reads, shell_writes) = std::io::pipe().expect("a pipe");
    let (shell_reads, core_writes) = std::io::pipe().expect("a pipe");
    (core_reads, core_writes, shell_reads, shell_writes)
}

fn greet(reader: &mut PipeReader, writer: &mut PipeWriter, protocol: u32) -> ToShell {
    let (hello, _) = said(reader).expect("a hello");
    assert!(write_frame(writer, &FromShell::Welcome { protocol }, &[]));
    hello
}

struct Running {
    shell: Shell,
    app: tauri::AppHandle,
    key: String,
    events: Receiver<(String, String)>,
    webviews: HashMap<String, u32>,
    windows: HashMap<String, u32>,
    thread: JoinHandle<i32>,
}

fn started(transport: Transport, labels: &'static [&'static str]) -> Running {
    let (core_reads, core_writes, mut shell_reads, mut shell_writes) = pipes();
    let (ready, readied) = channel();
    let (seen, events) = channel();
    let thread = std::thread::spawn(move || {
        let app = tauri::Builder::default()
            .enable_macos_default_menu(false)
            .runtime(Electron::over(core_reads, core_writes).transport(transport))
            .invoke_handler(tauri::generate_handler![whoami, count, width])
            .on_window_event(move |window, event| {
                let _ = seen.send((window.label().to_owned(), format!("{event:?}")));
            })
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("an app");
        for label in labels {
            tauri::WebviewWindowBuilder::new(
                &app,
                *label,
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title(*label)
            .build()
            .expect("a window");
        }
        ready.send((app.handle().clone(), app.invoke_key().to_owned())).expect("a test");
        app.run_return(|_, _| {})
    });
    greet(&mut shell_reads, &mut shell_writes, PROTOCOL);
    let shell = Shell::over(shell_reads, shell_writes);
    let mut windows = HashMap::new();
    let mut webviews = HashMap::new();
    while webviews.len() < labels.len() {
        shell.until(|message, _| match message {
            ToShell::WindowCreate { window, label, options } => {
                assert_eq!(options.title.as_deref(), Some(label.as_str()));
                windows.insert(label.clone(), *window);
                None
            }
            ToShell::WebviewCreate { window, webview, label, url, scripts, .. } => {
                assert_eq!(windows.get(label), Some(window));
                assert!(url.starts_with(ORIGIN), "{url}");
                assert!(scripts.iter().any(|one| one.script.contains("__TAURI_INTERNALS__")));
                webviews.insert(label.clone(), *webview);
                Some(())
            }
            _ => None,
        });
    }
    let (app, key) = readied.recv().expect("a built app");
    Running { shell, app, key, events, webviews, windows, thread }
}

impl Running {
    fn ended(self) -> i32 {
        self.shell.hang_up();
        self.thread.join().expect("the core's thread")
    }
}

fn real(path: &std::path::Path) -> std::path::PathBuf {
    if cfg!(windows) {
        path.to_path_buf()
    } else {
        path.canonicalize().expect("a real path")
    }
}

fn body_of(answer: Answer) -> String {
    let (status, headers, body) = answer.responded();
    assert_eq!(status, 200);
    assert_eq!(headers.get("tauri-response").map(String::as_str), Some("ok"));
    String::from_utf8(body).expect("text")
}

#[test]
fn the_hello_names_the_protocol_and_a_shell_of_another_is_refused() {
    for answer in [Some(PROTOCOL + 1), None] {
        let (core_reads, core_writes, mut shell_reads, mut shell_writes) = pipes();
        let thread = std::thread::spawn(move || {
            tauri::Builder::default()
                .enable_macos_default_menu(false)
                .runtime(Electron::over(core_reads, core_writes))
                .build(tauri::test::mock_context(tauri::test::noop_assets()))
                .map(|_| ())
                .map_err(|error| error.to_string())
        });
        if let Some(protocol) = answer {
            let hello = greet(&mut shell_reads, &mut shell_writes, protocol);
            let ToShell::Hello { protocol, schemes, transport, .. } = hello else {
                panic!("the first message was {hello:?}");
            };
            assert_eq!(protocol, PROTOCOL);
            assert_eq!(schemes, SCHEMES);
            assert_eq!(transport, Transport::PostMessage);
        } else {
            drop(shell_writes);
        }
        let refused = thread.join().expect("the core's thread").expect_err("a refusal");
        let why = if answer.is_some() { "protocol" } else { "left before" };
        assert!(refused.contains(why), "{refused}");
    }
}

#[test]
fn a_window_is_made_with_its_label_and_a_script_reaches_its_page() {
    let running = started(Transport::PostMessage, &["main"]);
    assert_eq!(running.windows.len(), 1);
    let main = running.webviews["main"];
    running.app.get_webview_window("main").expect("the window").eval("1 + 1").expect("sent");
    assert_eq!(running.shell.evaluated(main, "1 + 1"), "1 + 1");
    running.app.get_webview_window("main").expect("the window").set_title("renamed").expect("sent");
    running.shell.until(|message, _| {
        matches!(
            message,
            ToShell::WindowCall { call: WindowCall::SetTitle(title), id: None, .. } if title == "renamed"
        )
        .then_some(())
    });
    assert_eq!(running.ended(), 0);
}

#[test]
fn a_command_answers_over_the_scheme() {
    let mut running = started(Transport::Scheme, &["main"]);
    let main = running.webviews["main"];
    let answer = running.shell.invoke(Some(main), &running.key, "whoami", &json!({}));
    assert_eq!(body_of(answer), "\"main\"");
    let size = running.shell.invoke(Some(main), &running.key, "width", &json!({}));
    assert_eq!(body_of(size), "800");
    assert_eq!(running.ended(), 0);
}

#[test]
fn a_command_answers_over_post_message_and_the_scheme_is_shut_there() {
    let mut running = started(Transport::PostMessage, &["main"]);
    let main = running.webviews["main"];
    running.shell.post(Some(main), &running.key, "whoami", &json!({}), 7);
    let script = running.shell.evaluated(main, "runCallback(7,");
    assert!(script.contains("main"), "{script}");
    let over_scheme = running.shell.invoke(Some(main), &running.key, "whoami", &json!({}));
    assert!(matches!(over_scheme, Answer::Refused));
    assert_eq!(running.ended(), 0);
}

#[test]
fn what_the_window_does_is_heard_in_the_core() {
    let running = started(Transport::PostMessage, &["main"]);
    let window = running.windows["main"];
    let webview = running.webviews["main"];
    for event in [
        WindowChange::Focus,
        WindowChange::Resize { width: 640, height: 480 },
        WindowChange::Move { x: 3, y: 4 },
        WindowChange::Blur,
    ] {
        running.shell.send(&FromShell::Window { window, event }, &[]);
    }
    running.shell.send(
        &FromShell::Page { webview, url: format!("{ORIGIN}/"), event: PageEvent::Finished },
        &[],
    );
    let heard: Vec<String> = (0..4).map(|_| running.events.recv().expect("an event").1).collect();
    assert!(heard[0].contains("Focused(true)"), "{heard:?}");
    assert!(heard[1].contains("640") && heard[1].contains("480"), "{heard:?}");
    assert!(heard[2].contains("Moved"), "{heard:?}");
    assert!(heard[3].contains("Focused(false)"), "{heard:?}");
    assert_eq!(running.ended(), 0);
}

#[test]
fn a_channel_streams_in_order_over_both_transports() {
    for transport in [Transport::PostMessage, Transport::Scheme] {
        let mut running = started(transport, &["main"]);
        let main = running.webviews["main"];
        let payload = json!({ "channel": "__CHANNEL__:40" });
        if transport == Transport::Scheme {
            let answer = running.shell.invoke(Some(main), &running.key, "count", &payload);
            assert_eq!(body_of(answer), "null");
        } else {
            running.shell.post(Some(main), &running.key, "count", &payload, 9);
        }
        let mut sent = Vec::new();
        while sent.len() < 5 {
            sent.push(running.shell.evaluated(main, "runCallback(40,"));
        }
        for (index, script) in sent.iter().enumerate() {
            let streamed = format!("{{message:{index},index:{index}}}");
            assert!(script.replace(' ', "").contains(&streamed), "{index}: {script}");
        }
        assert_eq!(running.ended(), 0);
    }
}

#[test]
fn a_file_is_served_whole_in_part_and_not_at_all_outside_the_scope() {
    let mut running = started(Transport::PostMessage, &["main"]);
    let main = running.webviews["main"];
    let allowed = tempfile::tempdir().expect("a folder");
    let outside = tempfile::tempdir().expect("a folder");
    let inside = real(allowed.path());
    std::fs::write(inside.join("picture.bin"), b"0123456789abcdef").expect("a file");
    std::fs::write(outside.path().join("secret.bin"), b"secret").expect("a file");
    running.app.asset_protocol_scope().allow_directory(&inside, true).expect("a scope");
    let address = |path: &std::path::Path| {
        let encoded = percent_encoding::utf8_percent_encode(
            &path.to_string_lossy(),
            percent_encoding::NON_ALPHANUMERIC,
        )
        .to_string();
        format!("asset://localhost/{encoded}")
    };
    let picture = address(&inside.join("picture.bin"));
    let origin = [("origin", ORIGIN)];
    let (status, _, body) =
        running.shell.request(Some(main), &picture, "GET", &origin, &[]).responded();
    assert_eq!((status, body.as_slice()), (200, b"0123456789abcdef".as_slice()));
    let ranged = [("origin", ORIGIN), ("range", "bytes=2-5")];
    let (status, headers, body) =
        running.shell.request(Some(main), &picture, "GET", &ranged, &[]).responded();
    assert_eq!((status, body.as_slice()), (206, b"2345".as_slice()));
    assert_eq!(headers.get("content-range").map(String::as_str), Some("bytes 2-5/16"));
    let secret = address(&real(outside.path()).join("secret.bin"));
    let (status, _, body) =
        running.shell.request(Some(main), &secret, "GET", &origin, &[]).responded();
    assert_eq!(status, 403);
    assert!(!body.windows(6).any(|part| part == b"secret"));
    assert_eq!(running.ended(), 0);
}

#[test]
fn a_request_that_names_no_window_is_refused() {
    for transport in [Transport::PostMessage, Transport::Scheme] {
        let mut running = started(transport, &["main"]);
        let main = running.webviews["main"];
        for webview in [None, Some(main + 1000)] {
            let invoked = running.shell.invoke(webview, &running.key, "whoami", &json!({}));
            assert!(matches!(invoked, Answer::Refused));
            let page =
                running.shell.request(webview, &format!("{ORIGIN}/index.html"), "GET", &[], &[]);
            assert!(matches!(page, Answer::Refused));
            running.shell.post(webview, &running.key, "whoami", &json!({}), 50);
        }
        running.shell.post(Some(main), &running.key, "whoami", &json!({}), 60);
        let mut scripts = Vec::new();
        running.shell.until(|message, _| match message {
            ToShell::Eval { script, .. } => {
                scripts.push(script.clone());
                script.contains("runCallback(60,").then_some(())
            }
            _ => None,
        });
        assert!(!scripts.iter().any(|one| one.contains("runCallback(50,")), "{scripts:?}");
        assert_eq!(running.ended(), 0);
    }
}

#[test]
fn each_of_two_windows_is_answered_as_itself_and_the_core_leaves_with_the_last() {
    for transport in [Transport::PostMessage, Transport::Scheme] {
        let mut running = started(transport, &["main", "second"]);
        let (main, second) = (running.webviews["main"], running.webviews["second"]);
        assert_ne!(main, second);
        for _ in 0..20 {
            for (label, webview) in [("second", second), ("main", main)] {
                let named = format!("\"{label}\"");
                if transport == Transport::Scheme {
                    let answer =
                        running.shell.invoke(Some(webview), &running.key, "whoami", &json!({}));
                    assert_eq!(body_of(answer), named);
                } else {
                    running.shell.post(Some(webview), &running.key, "whoami", &json!({}), 11);
                    let script = running.shell.evaluated(webview, "runCallback(11,");
                    assert!(script.contains(label), "{script}");
                }
            }
        }
        let gone = running.windows["second"];
        running.shell.send(&FromShell::Window { window: gone, event: WindowChange::Close }, &[]);
        running.shell.until(|message, _| {
            matches!(message, ToShell::WindowCall { window, call: WindowCall::Destroy, .. } if *window == gone)
                .then_some(())
        });
        running.shell.send(&FromShell::Window { window: gone, event: WindowChange::Closed }, &[]);
        if transport == Transport::Scheme {
            let late = running.shell.invoke(Some(second), &running.key, "whoami", &json!({}));
            assert!(matches!(late, Answer::Refused));
            let answer = running.shell.invoke(Some(main), &running.key, "whoami", &json!({}));
            assert_eq!(body_of(answer), "\"main\"");
        }
        let last = running.windows["main"];
        running.shell.send(&FromShell::Window { window: last, event: WindowChange::Close }, &[]);
        running.shell.until(|message, _| {
            matches!(message, ToShell::WindowCall { window, call: WindowCall::Destroy, .. } if *window == last)
                .then_some(())
        });
        running.shell.send(&FromShell::Window { window: last, event: WindowChange::Closed }, &[]);
        let code = running.shell.until(|message, _| match message {
            ToShell::Exit { code } => Some(*code),
            _ => None,
        });
        assert_eq!(code, 0);
        assert_eq!(running.thread.join().expect("the core's thread"), 0);
    }
}

#[test]
fn a_shell_that_leaves_in_the_middle_of_a_question_does_not_hold_the_core() {
    let running = started(Transport::Scheme, &["main"]);
    let main = running.webviews["main"];
    running.shell.answering.store(false, Ordering::SeqCst);
    running.shell.send(
        &FromShell::Request {
            request: 900,
            webview: Some(main),
            url: "ipc://localhost/width".to_owned(),
            method: "POST".to_owned(),
            headers: [
                ("content-type", "application/json"),
                ("tauri-callback", "1"),
                ("tauri-error", "2"),
                ("tauri-invoke-key", running.key.as_str()),
                ("origin", ORIGIN),
            ]
            .iter()
            .map(|&(name, value)| (name.to_owned(), value.to_owned()))
            .collect(),
        },
        b"{}",
    );
    running.shell.until(|message, _| {
        matches!(message, ToShell::WindowCall { id: Some(_), call: WindowCall::InnerBounds, .. })
            .then_some(())
    });
    assert_eq!(running.ended(), 0);
}

#[test]
fn a_scheme_outside_the_table_makes_no_page() {
    let (core_reads, core_writes, mut shell_reads, mut shell_writes) = pipes();
    let thread = std::thread::spawn(move || {
        let app = tauri::Builder::default()
            .enable_macos_default_menu(false)
            .runtime(Electron::over(core_reads, core_writes))
            .register_uri_scheme_protocol("elsewhere", |_, _| http::Response::new(Vec::new()))
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("an app");
        tauri::WebviewWindowBuilder::new(&app, "main", tauri::WebviewUrl::App("index.html".into()))
            .build()
            .map(|_| ())
            .map_err(|error| error.to_string())
    });
    greet(&mut shell_reads, &mut shell_writes, PROTOCOL);
    let shell = Shell::over(shell_reads, shell_writes);
    let refused = thread.join().expect("the core's thread").expect_err("a refusal");
    assert!(refused.contains("elsewhere"), "{refused}");
    drop(shell);
}

#[cfg(unix)]
#[test]
fn the_core_finds_the_shell_at_a_socket_by_its_path() {
    use std::os::unix::net::UnixListener;

    let folder = tempfile::tempdir().expect("a folder");
    let path = folder.path().join("shell.sock");
    let listener = UnixListener::bind(&path).expect("a socket");
    let at = path.to_string_lossy().into_owned();
    let thread = std::thread::spawn(move || {
        let app = tauri::Builder::default()
            .enable_macos_default_menu(false)
            .runtime(Electron::default().pipe(at))
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .expect("an app");
        app.run_return(|_, _| {})
    });
    let (mut stream, _) = listener.accept().expect("the core");
    let (head, _) = read_frame(&mut stream).expect("a hello");
    let hello: ToShell = serde_json::from_slice(&head).expect("a message of the protocol");
    assert!(matches!(hello, ToShell::Hello { protocol: PROTOCOL, .. }), "{hello:?}");
    assert!(write_frame(&mut stream, &FromShell::Welcome { protocol: PROTOCOL }, &[]));
    stream.shutdown(std::net::Shutdown::Both).expect("a hang up");
    assert_eq!(thread.join().expect("the core's thread"), 0);
}
