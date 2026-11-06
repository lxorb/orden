mod oauth;

use std::io::{BufRead as _, BufReader, Write as _};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, Webview};

use oauth::{Attempt, Callback, Tokens};

const REFRESH: &str = "chatgpt.refresh";

const KEPT: &str = "chatgpt.installation";

const PORT: u16 = 1455;

const SIGNING_IN: Duration = Duration::from_secs(300);

const EARLY: Duration = Duration::from_secs(120);

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Installation {
    host: String,
    #[serde(default)]
    client: Option<String>,
    #[serde(default)]
    email: Option<String>,
}

#[derive(Default)]
pub struct ChatGpt {
    access: tokio::sync::Mutex<Option<(String, Instant)>>,
    signing: std::sync::Mutex<Option<Arc<AtomicBool>>>,
}

#[derive(Serialize)]
pub struct Account {
    email: Option<String>,
}

fn owner(webview: &Webview) -> Result<(), String> {
    let label = webview.label();
    if label == webview.window().label() && crate::launch::is_document_window(label) {
        Ok(())
    } else {
        Err("not a window of this app".to_owned())
    }
}

fn installation_file(app: &AppHandle) -> Result<PathBuf, String> {
    let folder = app
        .path()
        .app_local_data_dir()
        .map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&folder).map_err(|error| error.to_string())?;
    Ok(folder.join("chatgpt.json"))
}

fn installation(app: &AppHandle) -> Result<Installation, String> {
    let file = installation_file(app)?;
    if let Some(found) = std::fs::read(&file)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<Installation>(&bytes).ok())
        .filter(|found| !found.host.is_empty())
    {
        return Ok(found);
    }
    if let Some(found) = crate::secrets::get(app, KEPT)
        .ok()
        .flatten()
        .and_then(|text| serde_json::from_str::<Installation>(&text).ok())
        .filter(|found| !found.host.is_empty())
    {
        let _ = std::fs::write(&file, serde_json::to_vec(&found).unwrap_or_default());
        return Ok(found);
    }
    let mut random = [0_u8; 16];
    getrandom::fill(&mut random).map_err(|error| error.to_string())?;
    let made = Installation {
        host: oauth::host_id(&random),
        ..Installation::default()
    };
    keep(app, &made)?;
    Ok(made)
}

fn keep(app: &AppHandle, installation: &Installation) -> Result<(), String> {
    let text = serde_json::to_vec(installation).map_err(|error| error.to_string())?;
    if let Ok(words) = std::str::from_utf8(&text) {
        let _ = crate::secrets::set(app, KEPT, words);
    }
    std::fs::write(installation_file(app)?, text).map_err(|error| error.to_string())
}

fn refresh_token(app: &AppHandle) -> Result<Option<String>, String> {
    crate::secrets::get(app, REFRESH)
}

fn client() -> Result<reqwest::Client, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    reqwest::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())
}

async fn tokens(form: &[(&str, &str)]) -> Result<Tokens, String> {
    let answer = client()?
        .post(oauth::TOKEN)
        .header("content-type", "application/x-www-form-urlencoded")
        .body(oauth::form(form))
        .send()
        .await
        .map_err(|error| format!("could not reach OpenAI: {error}"))?;
    let status = answer.status();
    let body = answer.bytes().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        let code = oauth::token_error(&body).unwrap_or_else(|| status.as_u16().to_string());
        return Err(if oauth::grant_gone(&code) {
            "signed out".to_owned()
        } else {
            code
        });
    }
    serde_json::from_slice(&body).map_err(|error| error.to_string())
}

fn wait_for_callback(
    listener: &TcpListener,
    state: &str,
    stop: &AtomicBool,
) -> Result<(String, Option<String>), String> {
    listener
        .set_nonblocking(true)
        .map_err(|error| error.to_string())?;
    let started = Instant::now();
    while started.elapsed() < SIGNING_IN {
        if stop.load(Ordering::SeqCst) {
            return Err("stopped".to_owned());
        }
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(result) = answer_callback(stream, state) {
                    return result;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("timed out".to_owned())
}

fn answer_callback(
    mut stream: TcpStream,
    state: &str,
) -> Option<Result<(String, Option<String>), String>> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut line = String::new();
    BufReader::new(&stream).read_line(&mut line).ok()?;

    let (status, words, result) = match oauth::callback(&line, state) {
        Callback::Code { code, client } => (
            "200 OK",
            "Orden is signed in to ChatGPT. This tab can be closed.",
            Some(Ok((code, client))),
        ),
        Callback::Refused(why) => (
            "200 OK",
            "Orden was not signed in to ChatGPT.",
            Some(Err(why)),
        ),
        Callback::Other => ("404 Not Found", "", None),
    };
    let page = format!(
        "<!doctype html><meta charset=utf-8><title>Orden</title>\
         <p style=\"font:16px system-ui;margin:3em;text-align:center\">{words}</p>"
    );
    let _ = write!(
        stream,
        "HTTP/1.1 {status}\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{page}",
        page.len()
    );
    result
}

#[tauri::command]
pub async fn chatgpt_sign_in(webview: Webview) -> Result<Account, String> {
    owner(&webview)?;
    let app = webview.app_handle().clone();
    let state = app.state::<ChatGpt>();

    let stop = Arc::new(AtomicBool::new(false));
    let earlier = state
        .signing
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner)
        .replace(Arc::clone(&stop));
    if let Some(earlier) = earlier {
        earlier.store(true, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    let mut found = installation(&app)?;
    let mut random = [0_u8; 96];
    getrandom::fill(&mut random).map_err(|error| error.to_string())?;
    let attempt = Attempt::from_random(&random);

    let listener = TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, PORT)))
        .or_else(|_| TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, 0))))
        .map_err(|error| error.to_string())?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();

    let url = oauth::authorize_url(&attempt, port, &found.host, found.client.as_deref());
    tauri_plugin_opener::open_url(url, None::<&str>).map_err(|error| error.to_string())?;

    let expected = attempt.state.clone();
    let waiting = Arc::clone(&stop);
    let (code, issued) = tauri::async_runtime::spawn_blocking(move || {
        wait_for_callback(&listener, &expected, &waiting)
    })
    .await
    .map_err(|error| error.to_string())??;

    let client_id = issued
        .or_else(|| found.client.clone())
        .ok_or_else(|| "OpenAI issued no client".to_owned())?;
    let redirect = oauth::redirect(port);
    let got = tokens(&[
        ("grant_type", "authorization_code"),
        ("client_id", &client_id),
        ("code", &code),
        ("code_verifier", &attempt.verifier),
        ("redirect_uri", &redirect),
        ("resource", oauth::RESOURCE),
    ])
    .await?;

    let refresh = got
        .refresh_token
        .clone()
        .ok_or_else(|| "OpenAI sent no refresh token".to_owned())?;
    crate::secrets::set(&app, REFRESH, &refresh)?;

    found.client = Some(client_id);
    found.email = got.id_token.as_deref().and_then(oauth::email_in);
    keep(&app, &found)?;
    *state.access.lock().await = Some(fresh(&got));
    Ok(Account { email: found.email })
}

fn fresh(got: &Tokens) -> (String, Instant) {
    let lasts = Duration::from_secs(got.expires_in.unwrap_or(3600)).saturating_sub(EARLY);
    (got.access_token.clone(), Instant::now() + lasts)
}

#[tauri::command(async)]
pub fn chatgpt_account(webview: Webview) -> Result<Option<Account>, String> {
    owner(&webview)?;
    if refresh_token(webview.app_handle())?.is_none() {
        return Ok(None);
    }
    let found = installation(webview.app_handle())?;
    Ok(Some(Account { email: found.email }))
}

#[tauri::command]
pub async fn chatgpt_token(webview: Webview) -> Result<String, String> {
    owner(&webview)?;
    let app = webview.app_handle().clone();
    let state = app.state::<ChatGpt>();
    let mut access = state.access.lock().await;
    if let Some((token, until)) = access.as_ref() {
        if Instant::now() < *until {
            return Ok(token.clone());
        }
    }

    let refresh = refresh_token(&app)?.ok_or_else(|| "signed out".to_owned())?;
    let found = installation(&app)?;
    let client_id = found.client.ok_or_else(|| "signed out".to_owned())?;
    let got = match tokens(&[
        ("grant_type", "refresh_token"),
        ("client_id", &client_id),
        ("refresh_token", &refresh),
        ("resource", oauth::RESOURCE),
    ])
    .await
    {
        Ok(got) => got,
        Err(error) => {
            if error == "signed out" {
                let _ = crate::secrets::delete(&app, REFRESH);
            }
            return Err(error);
        }
    };
    if let Some(next) = &got.refresh_token {
        crate::secrets::set(&app, REFRESH, next)?;
    }
    let (token, until) = fresh(&got);
    *access = Some((token.clone(), until));
    Ok(token)
}

#[tauri::command]
pub async fn chatgpt_sign_out(webview: Webview) -> Result<(), String> {
    owner(&webview)?;
    let app = webview.app_handle().clone();
    let state = app.state::<ChatGpt>();
    *state.access.lock().await = None;

    let mut found = installation(&app)?;
    if let (Some(refresh), Some(client_id)) = (refresh_token(&app)?, found.client.clone()) {
        let _ = revoke(&refresh, &client_id).await;
    }
    crate::secrets::delete(&app, REFRESH)?;
    found.client = None;
    found.email = None;
    keep(&app, &found)
}

async fn revoke(refresh: &str, client_id: &str) -> Result<(), String> {
    let http = client()?;
    let configuration: serde_json::Value = serde_json::from_slice(
        &http
            .get(oauth::CONFIGURATION)
            .send()
            .await
            .map_err(|error| error.to_string())?
            .bytes()
            .await
            .map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;
    let endpoint = configuration
        .get("revocation_endpoint")
        .and_then(serde_json::Value::as_str)
        .ok_or_else(|| "no revocation endpoint".to_owned())?;
    http.post(endpoint)
        .header("content-type", "application/x-www-form-urlencoded")
        .body(oauth::form(&[
            ("token", refresh),
            ("token_type_hint", "refresh_token"),
            ("client_id", client_id),
        ]))
        .send()
        .await
        .map_err(|error| error.to_string())?;
    Ok(())
}
