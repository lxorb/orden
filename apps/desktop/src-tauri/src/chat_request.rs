use std::time::Duration;

use serde::Deserialize;
use tauri::ipc::{Request, Response};
use tauri::Webview;

const BEARER_HOSTS: [&str; 3] = ["slack.com", "files.slack.com", "files-origin.slack.com"];
const OPEN_SUFFIX: &str = ".slack-edge.com";
const MOST_BYTES: usize = 1024 * 1024 * 1024;
const MOST_HOPS: usize = 5;

#[derive(Deserialize)]
struct Asked {
    url: String,
    method: String,
    bearer: Option<String>,
    #[serde(rename = "type")]
    kind: Option<String>,
}

#[derive(Debug, PartialEq, Eq)]
enum Reach {
    WithBearer,
    Open,
}

fn owner(webview: &Webview) -> Result<(), String> {
    let label = webview.label();
    if label == webview.window().label() && crate::launch::is_document_window(label) {
        Ok(())
    } else {
        Err("only Orden's own window may reach a chat service".to_owned())
    }
}

fn reach(url: &reqwest::Url) -> Option<Reach> {
    let host = url.host_str()?;
    let plain = url.scheme() == "https"
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none();
    if !plain {
        return None;
    }
    if BEARER_HOSTS.contains(&host) {
        Some(Reach::WithBearer)
    } else if host.ends_with(OPEN_SUFFIX) && host.len() > OPEN_SUFFIX.len() {
        Some(Reach::Open)
    } else {
        None
    }
}

fn place(url: &str) -> Result<(reqwest::Url, Reach), String> {
    let parsed = reqwest::Url::parse(url)
        .map_err(|_| "that is not an address Orden reaches for chats".to_owned())?;
    let known = reach(&parsed).ok_or_else(|| {
        format!(
            "{} is not a chat service Orden reaches",
            parsed.host_str().unwrap_or("that address")
        )
    })?;
    Ok((parsed, known))
}

fn next_place(from: &reqwest::Url, location: &str) -> Result<(reqwest::Url, Reach), String> {
    let joined = from
        .join(location)
        .map_err(|_| "the chat service sent Orden somewhere odd".to_owned())?;
    let known = reach(&joined).ok_or_else(|| {
        format!(
            "the chat service sent Orden on to {}",
            joined.host_str().unwrap_or("an unknown address")
        )
    })?;
    Ok((joined, known))
}

#[tauri::command]
pub async fn chat_request(webview: Webview, request: Request<'_>) -> Result<Response, String> {
    owner(&webview)?;
    let (asked, body) = crate::notes::raw_sent::<Asked>(request.headers(), request.body())?;
    let body = body.into_owned();
    let posting = match asked.method.as_str() {
        "GET" => false,
        "POST" => true,
        _ => return Err("a chat service is only asked with GET or POST".to_owned()),
    };
    let (mut url, mut known) = place(&asked.url)?;
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(600))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(|error| error.to_string())?;
    for _ in 0..=MOST_HOPS {
        let mut sent = if posting {
            client.post(url.clone()).body(body.clone())
        } else {
            client.get(url.clone())
        };
        if posting {
            let kind = asked.kind.as_deref().unwrap_or("application/octet-stream");
            sent = sent.header("content-type", kind);
        }
        if let (Some(token), Reach::WithBearer) = (asked.bearer.as_deref(), &known) {
            sent = sent.bearer_auth(token);
        }
        let mut answer = sent
            .send()
            .await
            .map_err(|_| "the chat service could not be reached".to_owned())?;
        let status = answer.status();
        if status.is_redirection() && !posting {
            let location = answer
                .headers()
                .get("location")
                .and_then(|value| value.to_str().ok())
                .ok_or("the chat service sent Orden nowhere")?;
            (url, known) = next_place(&url, location)?;
            continue;
        }
        if !status.is_success() {
            return Err(format!("the chat service answered {}", status.as_u16()));
        }
        if answer
            .content_length()
            .is_some_and(|length| length > MOST_BYTES as u64)
        {
            return Err("that file is too large".to_owned());
        }
        let mut bytes: Vec<u8> = Vec::new();
        while let Some(chunk) = answer
            .chunk()
            .await
            .map_err(|_| "the chat service stopped sending".to_owned())?
        {
            if bytes.len() + chunk.len() > MOST_BYTES {
                return Err("that file is too large".to_owned());
            }
            bytes.extend_from_slice(&chunk);
        }
        return Ok(Response::new(bytes));
    }
    Err("the chat service sent Orden around too often".to_owned())
}

#[cfg(test)]
mod tests {
    use super::{next_place, place, Reach};

    #[test]
    fn only_slack_is_reached_and_only_slack_gets_the_token() {
        let (_, files) = place("https://files.slack.com/files-pri/T1-F1/a.png").expect("files");
        assert_eq!(files, Reach::WithBearer);
        let (_, api) = place("https://slack.com/api/auth.test").expect("api");
        assert_eq!(api, Reach::WithBearer);
        let (_, avatar) = place("https://avatars.slack-edge.com/a.png").expect("avatar");
        assert_eq!(avatar, Reach::Open);
        for refused in [
            "http://files.slack.com/a",
            "https://files.slack.com:8443/a",
            "https://evil.com/a",
            "https://slack.com.evil.com/a",
            "https://evilslack.com/a",
            "https://user@files.slack.com/a",
            "https://slack-edge.com/a",
            "https://xslack-edge.com/a",
            "file:///etc/passwd",
        ] {
            assert!(place(refused).is_err(), "{refused}");
        }
    }

    #[test]
    fn a_redirect_stays_within_slack() {
        let (from, _) = place("https://files.slack.com/files-pri/T1-F1/a.png").expect("files");
        let (to, known) = next_place(
            &from,
            "https://files-origin.slack.com/files-pri/T1-F1/a.png",
        )
        .expect("on");
        assert_eq!(to.host_str(), Some("files-origin.slack.com"));
        assert_eq!(known, Reach::WithBearer);
        let (relative, _) = next_place(&from, "/files-pri/T1-F1/b.png").expect("relative");
        assert_eq!(relative.host_str(), Some("files.slack.com"));
        assert!(next_place(&from, "https://evil.com/steal").is_err());
        assert!(next_place(&from, "http://files.slack.com/a").is_err());
    }
}
