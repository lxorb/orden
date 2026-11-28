#![cfg(all(feature = "electron", unix))]

use std::io::{Read, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::path::Path;
use std::process::{Command, Stdio};

use serde_json::{json, Value};
use tauri_runtime_electron::wire::{
    Bounds, FromShell, Point, ToShell, Transport, WebviewCall, WindowCall, PIPE_ENV, PROTOCOL,
};

const ORIGIN: &str = "tauri://localhost/";
const KEY: &str = "const __TAURI_INVOKE_KEY__ = ";

fn core(home: &Path) -> Command {
    let mut core = Command::new(env!("CARGO_BIN_EXE_orden"));
    core.env("HOME", home)
        .env("ORDEN_USAGE", "off")
        .env_remove("XDG_CONFIG_HOME")
        .env_remove("XDG_DATA_HOME")
        .env_remove(PIPE_ENV)
        .stdin(Stdio::null());
    core
}
fn read(stream: &mut UnixStream) -> Option<(ToShell, Vec<u8>)> {
    let mut sizes = [0u8; 8];
    stream.read_exact(&mut sizes).ok()?;
    let head = u32::from_le_bytes([sizes[0], sizes[1], sizes[2], sizes[3]]);
    let body = u32::from_le_bytes([sizes[4], sizes[5], sizes[6], sizes[7]]);
    let mut head = vec![0u8; usize::try_from(head).ok()?];
    stream.read_exact(&mut head).ok()?;
    let mut body = vec![0u8; usize::try_from(body).ok()?];
    stream.read_exact(&mut body).ok()?;
    Some((serde_json::from_slice(&head).expect("a message of the protocol"), body))
}
fn write(stream: &mut UnixStream, message: &FromShell, body: &[u8]) {
    let head = serde_json::to_vec(message).expect("a message");
    let mut frame = Vec::new();
    frame.extend_from_slice(&u32::try_from(head.len()).expect("a head").to_le_bytes());
    frame.extend_from_slice(&u32::try_from(body.len()).expect("a body").to_le_bytes());
    frame.extend_from_slice(&head);
    frame.extend_from_slice(body);
    stream.write_all(&frame).expect("the core still listens");
}
fn canned(message: &ToShell) -> Option<(u64, Value)> {
    let bounds = || json!(Bounds { x: 0, y: 0, width: 1180, height: 760 });
    match message {
        ToShell::WindowCall { id: Some(id), call, .. } => Some((
            *id,
            match call {
                WindowCall::ScaleFactor => json!(1.0),
                WindowCall::InnerBounds | WindowCall::OuterBounds => bounds(),
                WindowCall::GetTitle => json!("Orden"),
                _ => json!(false),
            },
        )),
        ToShell::WebviewCall { id: Some(id), call, .. } => Some((
            *id,
            match call {
                WebviewCall::GetUrl => json!(ORIGIN),
                WebviewCall::Bounds => bounds(),
                _ => json!(false),
            },
        )),
        ToShell::Eval { id: Some(id), .. } => Some((*id, Value::Null)),
        ToShell::Screen { id, .. } => Some((*id, json!([]))),
        ToShell::Cursor { id } => Some((*id, json!(Point { x: 0.0, y: 0.0 }))),
        ToShell::Dark { id } => Some((*id, json!(false))),
        ToShell::Version { id } => Some((*id, json!("156.0"))),
        _ => None,
    }
}
fn until<R>(stream: &mut UnixStream, mut pick: impl FnMut(&ToShell) -> Option<R>) -> R {
    loop {
        let (message, _) = read(stream).expect("the core left before it said this");
        if let Some((id, value)) = canned(&message) {
            write(stream, &FromShell::Reply { id, value }, &[]);
        }
        if let Some(found) = pick(&message) {
            return found;
        }
    }
}
fn asked(stream: &mut UnixStream, webview: u32, key: &str, command: &str, callback: u32) -> String {
    let message = json!({
        "cmd": command,
        "callback": callback,
        "error": callback + 1,
        "payload": { "channel": "stable" },
        "options": null,
        "__TAURI_INVOKE_KEY__": key,
    });
    write(
        stream,
        &FromShell::Post { webview: Some(webview), url: ORIGIN.to_owned() },
        message.to_string().as_bytes(),
    );
    let (ok, failed) =
        (format!("runCallback({callback},"), format!("runCallback({},", callback + 1));
    until(stream, |message| match message {
        ToShell::Eval { script, .. } if script.contains(&ok) || script.contains(&failed) => {
            Some(script.clone())
        }
        _ => None,
    })
}

#[test]
fn without_a_shell_the_core_says_so_and_leaves() {
    let home = tempfile::tempdir().expect("a home");
    let ran = core(home.path()).output().expect("the core");
    let said = String::from_utf8_lossy(&ran.stderr);
    assert_eq!(ran.status.code(), Some(2), "{said}");
    assert!(said.contains("Electron shell") && said.contains(PIPE_ENV), "{said}");
}

#[test]
fn a_shell_is_greeted_a_command_answers_and_no_update_is_looked_for() {
    let home = tempfile::tempdir().expect("a home");
    let at = home.path().join("shell.sock");
    let listener = UnixListener::bind(&at).expect("a socket");
    let mut running = core(home.path())
        .arg(format!("--orden-electron-pipe={}", at.display()))
        .spawn()
        .expect("the core");
    let (mut stream, _) = listener.accept().expect("the core's call");
    let (hello, _) = read(&mut stream).expect("a hello");
    let ToShell::Hello { protocol, transport, .. } = hello else {
        panic!("the first message was {hello:?}");
    };
    assert_eq!((protocol, transport), (PROTOCOL, Transport::PostMessage));
    write(&mut stream, &FromShell::Welcome { protocol: PROTOCOL }, &[]);
    let (webview, key) = until(&mut stream, |message| match message {
        ToShell::WebviewCreate { webview, label, scripts, .. } if label == "main" => {
            let key = scripts.iter().find_map(|one| {
                let rest = one.script.split_once(KEY)?.1;
                let rest = rest.strip_prefix("JSON.parse('").unwrap_or(rest);
                Some(rest.strip_prefix('"')?.split_once('"')?.0.to_owned())
            });
            Some((*webview, key.expect("the page's invoke key")))
        }
        _ => None,
    });
    let root = asked(&mut stream, webview, &key, "spaces_root", 11);
    assert!(root.contains("runCallback(11,") && root.contains("Spaces"), "{root}");
    let update = asked(&mut stream, webview, &key, "check_update", 21);
    assert!(update.contains("runCallback(22,") && update.contains("its own updates"), "{update}");
    let plugin = asked(&mut stream, webview, &key, "plugin:updater|check", 31);
    assert!(plugin.contains("runCallback(32,"), "{plugin}");
    stream.shutdown(std::net::Shutdown::Both).expect("a hang up");
    assert!(running.wait().expect("the core's end").code().is_some());
}

#[test]
fn the_updater_is_registered_only_beside_cef() {
    let source = include_str!("../src/lib.rs");
    let at = source.find(".plugin(tauri_plugin_updater::").expect("the updater's registration");
    let before = &source[..at];
    let guard = before.rfind("#[cfg(").expect("a guard");
    assert!(
        before[guard..].starts_with("#[cfg(not(feature = \"electron\"))]"),
        "{}",
        &before[guard..]
    );
    assert_eq!(source.matches("tauri_plugin_updater::").count(), 1);
}
