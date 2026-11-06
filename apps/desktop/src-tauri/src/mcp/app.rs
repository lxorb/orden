use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::path::Path;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

use serde::Deserialize;
use serde_json::Value;

const CONNECT: Duration = Duration::from_secs(2);

const STARTING: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, PartialEq, Eq, Deserialize)]
pub struct Endpoint {
    pub port: u16,
    pub secret: String,
    #[serde(default)]
    pub pid: u32,
}

pub fn endpoint(dir: &Path) -> Option<Endpoint> {
    let text = std::fs::read_to_string(dir.join("automation.json")).ok()?;
    serde_json::from_str(&text).ok()
}

#[derive(Debug)]
pub struct Said {
    pub status: u16,
    pub body: Value,
}

pub fn post(
    endpoint: &Endpoint,
    bearer: Option<&str>,
    body: &Value,
    patience: Duration,
) -> std::io::Result<Said> {
    let address = SocketAddr::from((Ipv4Addr::LOCALHOST, endpoint.port));
    let mut stream = TcpStream::connect_timeout(&address, CONNECT)?;
    stream.set_read_timeout(Some(patience))?;
    stream.set_write_timeout(Some(CONNECT))?;

    let body = body.to_string();
    let credential = bearer
        .map(|token| format!("authorization: Bearer {token}\r\n"))
        .unwrap_or_default();
    let head = format!(
        "POST / HTTP/1.1\r\nhost: 127.0.0.1:{}\r\ncontent-type: application/json\r\n{credential}content-length: {}\r\nconnection: close\r\n\r\n",
        endpoint.port,
        body.len()
    );
    stream.write_all(head.as_bytes())?;
    stream.write_all(body.as_bytes())?;
    stream.flush()?;

    let mut bytes = Vec::new();
    stream.read_to_end(&mut bytes)?;
    parse(&bytes)
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidData, "not an HTTP answer"))
}

fn parse(bytes: &[u8]) -> Option<Said> {
    let text = String::from_utf8_lossy(bytes);
    let (head, body) = text.split_once("\r\n\r\n")?;
    let status = head
        .lines()
        .next()?
        .split(' ')
        .nth(1)?
        .parse::<u16>()
        .ok()?;
    let body = serde_json::from_str(body).unwrap_or_else(|_| Value::String(body.to_owned()));
    Some(Said { status, body })
}

pub fn answers(endpoint: &Endpoint) -> bool {
    let asked = serde_json::json!({ "verb": "agent_status" });
    post(endpoint, None, &asked, CONNECT).is_ok_and(|said| {
        said.status == 401 && said.body.get("error").is_some_and(Value::is_string)
    })
}

pub fn running(dir: &Path) -> Option<Endpoint> {
    endpoint(dir).filter(answers)
}

pub fn start(dir: &Path) -> Result<Endpoint, String> {
    let before = endpoint(dir);
    launch()?;

    let started = Instant::now();
    while started.elapsed() < STARTING {
        std::thread::sleep(Duration::from_millis(100));
        if let Some(now) = endpoint(dir) {
            if Some(&now) != before.as_ref() && answers(&now) {
                return Ok(now);
            }
        }
    }
    Err("Orden did not start in 30 seconds".to_owned())
}

#[cfg(windows)]
fn launch() -> Result<(), String> {
    use std::os::windows::process::CommandExt as _;

    const NO_WINDOW: u32 = 0x0800_0000;

    keep_the_pipes();
    let program = super::program::program()?;
    let shell = std::env::var_os("ComSpec").unwrap_or_else(|| "cmd.exe".into());
    let mut command = Command::new(shell);
    command
        .raw_arg(format!(
            "/d /c start \"\" /min \"{}\" {}",
            program.display(),
            crate::launch::BACKGROUND_FLAG
        ))
        .creation_flags(NO_WINDOW);
    if let Some(folder) = program.parent() {
        command.current_dir(folder);
    }
    quiet(&mut command)
        .status()
        .map_err(|error| format!("Orden could not be started: {error}"))
        .map(drop)
}

#[allow(
    unsafe_code,
    reason = "whether a handle is inherited is Win32's own flag, with no safe wrapper"
)]
#[cfg(windows)]
pub(crate) fn keep_the_pipes() {
    use std::os::windows::io::AsRawHandle as _;
    use windows::Win32::Foundation::{
        SetHandleInformation, HANDLE, HANDLE_FLAGS, HANDLE_FLAG_INHERIT,
    };

    let handles = [
        std::io::stdin().as_raw_handle(),
        std::io::stdout().as_raw_handle(),
        std::io::stderr().as_raw_handle(),
    ];
    for raw in handles.into_iter().filter(|one| !one.is_null()) {
        let _ =
            unsafe { SetHandleInformation(HANDLE(raw), HANDLE_FLAG_INHERIT.0, HANDLE_FLAGS(0)) };
    }
}

#[cfg(target_os = "macos")]
fn launch() -> Result<(), String> {
    let program = super::program::program()?;
    let bundle = program
        .ancestors()
        .find(|one| one.extension().is_some_and(|ext| ext == "app"));
    match bundle {
        Some(bundle) => quiet(
            Command::new("open")
                .args(["-g", "-j"])
                .arg(bundle)
                .args(["--args", crate::launch::BACKGROUND_FLAG]),
        )
        .status()
        .map(drop)
        .map_err(|error| format!("Orden could not be started: {error}")),
        None => detached(&program),
    }
}

#[cfg(all(unix, not(target_os = "macos")))]
fn launch() -> Result<(), String> {
    detached(&super::program::program()?)
}

#[cfg(unix)]
fn detached(program: &Path) -> Result<(), String> {
    use std::os::unix::process::CommandExt as _;

    let mut child = quiet(
        Command::new(program)
            .arg(crate::launch::BACKGROUND_FLAG)
            .process_group(0),
    )
    .spawn()
    .map_err(|error| format!("Orden could not be started: {error}"))?;
    std::thread::spawn(move || child.wait());
    Ok(())
}

fn quiet(command: &mut Command) -> &mut Command {
    command
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn an_answer_is_its_status_and_its_json() {
        let said = parse(b"HTTP/1.1 401 Unauthorized\r\ncontent-type: application/json\r\n\r\n{\"error\":\"no\"}")
            .expect("an answer");
        assert_eq!(said.status, 401);
        assert_eq!(said.body["error"], "no");
        let said = parse(b"HTTP/1.1 200 OK\r\n\r\nnot json").expect("an answer");
        assert_eq!(said.body, Value::String("not json".into()));
        assert!(parse(b"garbage").is_none());
    }

    #[test]
    fn the_file_reads_as_the_app_writes_it() {
        let dir = tempfile::tempdir().expect("a folder");
        assert_eq!(endpoint(dir.path()), None);
        std::fs::write(
            dir.path().join("automation.json"),
            r#"{"port":4321,"secret":"ab","eval":false,"pid":77}"#,
        )
        .expect("written");
        assert_eq!(
            endpoint(dir.path()),
            Some(Endpoint {
                port: 4321,
                secret: "ab".into(),
                pid: 77
            })
        );
    }

    #[test]
    fn a_stranger_on_the_port_is_not_nib() {
        let listener = TcpListener::bind("127.0.0.1:0").expect("a port");
        let port = listener.local_addr().expect("its address").port();
        let heard = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("a caller");
            let mut request = vec![0_u8; 4096];
            let read = stream.read(&mut request).expect("a request");
            stream
                .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 2\r\n\r\nhi")
                .expect("an answer");
            String::from_utf8_lossy(&request[..read]).to_lowercase()
        });
        let stranger = Endpoint {
            port,
            secret: "s3cret".into(),
            pid: 0,
        };
        assert!(!answers(&stranger));
        let request = heard.join().expect("the stranger");
        assert!(!request.contains("authorization"), "{request}");
        assert!(!request.contains("s3cret"));
    }

    #[test]
    fn nobody_on_the_port_is_not_nib() {
        let port = TcpListener::bind("127.0.0.1:0")
            .and_then(|one| one.local_addr())
            .expect("a port")
            .port();
        assert!(!answers(&Endpoint {
            port,
            secret: String::new(),
            pid: 0
        }));
    }
}
