use std::collections::{BTreeMap, HashSet};
use std::io::Write as _;
use std::net::{IpAddr, SocketAddr, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, PoisonError};
use std::time::{Duration, Instant};

use base64::Engine as _;
use reqwest::header::{HeaderMap, HeaderName, HeaderValue, AUTHORIZATION, COOKIE, LOCATION};
use reqwest::{redirect, Client, Method, StatusCode, Url};
use tauri::AppHandle;

use super::approvals::{self, Asking};
use super::grants::{Grant, Mode, Scope, SiteRule};
use super::verbs::{Answer, Category, Code, Http, HttpDone};
use super::{files, policy, stop, Caller};

const WAIT: u64 = 60_000;
const MOST_WAIT: u64 = 120_000;

const MOST_HOPS: usize = 10;

const MOST_BODY: usize = 1_000_000;

const MOST_SAVED: u64 = 1 << 30;

static REACHED: Mutex<Option<HashSet<(String, String)>>> = Mutex::new(None);

struct Request {
    method: Method,
    headers: HeaderMap,
    body: Option<Vec<u8>>,
    save: Option<PathBuf>,
    until: Instant,
    since: u64,
}

pub(super) fn answer(app: &AppHandle, caller: &Caller, asked: &Http, since: u64) -> Answer {
    if !caller.holds(Scope::Network) {
        return Answer::error(
            Code::NotGranted,
            "requests need the network scope, which the reader grants in Settings > Agents",
        );
    }
    let request = match request(app, caller, asked, since) {
        Ok(request) => request,
        Err(refused) => return refused,
    };
    let Ok(url) = Url::parse(asked.url.trim()) else {
        return Answer::error(
            Code::BadArguments,
            format!("{} is not an address", asked.url),
        );
    };
    let grant = match caller {
        Caller::Agent(grant) => Some(grant.as_ref()),
        Caller::Reader => None,
    };
    let check = |hop: &Url| {
        if stop::cancelled(since) {
            return Err(Answer::error(Code::Stopped, "the reader pressed the stop"));
        }
        reachable(app, grant, hop)
    };
    std::thread::scope(|scope| {
        scope
            .spawn(|| tauri::async_runtime::block_on(sent(url, request, &check)))
            .join()
            .unwrap_or_else(|_| Answer::error(Code::Failed, "the request broke off"))
    })
}

fn request(app: &AppHandle, caller: &Caller, asked: &Http, since: u64) -> Result<Request, Answer> {
    let bad = |why: String| Answer::error(Code::BadArguments, why);
    let method = asked
        .method
        .as_deref()
        .unwrap_or("GET")
        .trim()
        .to_ascii_uppercase();
    let method = Method::from_bytes(method.as_bytes())
        .map_err(|_| bad(format!("{method} is not a method")))?;
    let mut headers = HeaderMap::new();
    for (name, value) in &asked.headers {
        let name = HeaderName::from_bytes(name.trim().as_bytes())
            .map_err(|_| bad(format!("{name} is not a header's name")))?;
        let value = HeaderValue::from_str(value)
            .map_err(|_| bad(format!("{name}'s value is not one a header may hold")))?;
        headers.append(name, value);
    }
    let body = match (&asked.body, asked.base64) {
        (None, _) => None,
        (Some(text), false) => Some(text.as_bytes().to_vec()),
        (Some(text), true) => Some(
            base64::engine::general_purpose::STANDARD
                .decode(text.trim())
                .map_err(|why| bad(format!("body is not base64: {why}")))?,
        ),
    };
    let save = match asked.save_to.as_deref() {
        Some(path) => Some(files::writable(app, caller, path)?),
        None => None,
    };
    let patience = Duration::from_millis(asked.timeout_ms.unwrap_or(WAIT).min(MOST_WAIT));
    Ok(Request {
        method,
        headers,
        body,
        save,
        until: Instant::now() + patience,
        since,
    })
}

async fn sent(
    start: Url,
    mut request: Request,
    check: &dyn Fn(&Url) -> Result<(), Answer>,
) -> Answer {
    let first = host(&start);
    let mut url = start;
    for _ in 0..=MOST_HOPS {
        if let Err(refused) = check(&url) {
            return refused;
        }
        let left = request.until.saturating_duration_since(Instant::now());
        if left.is_zero() {
            return Answer::error(Code::Timeout, "it took longer than its time");
        }
        let address = match address(&url).await {
            Ok(address) => address,
            Err(refused) => return refused,
        };
        if host(&url) != first {
            strip_credentials(&mut request.headers);
        }
        let response = match once(&url, address, &request, left).await {
            Ok(response) => response,
            Err(why) => return why,
        };
        if response.status().is_redirection() {
            if let Some(next) = response
                .headers()
                .get(LOCATION)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| url.join(value).ok())
            {
                (request.method, request.body) =
                    redirected(response.status(), &request.method, request.body.take());
                url = next;
                continue;
            }
        }
        let site = policy::site_of(&host(&url));
        let answered = read(response, url.as_str(), &request).await;
        return match answered {
            Ok(done) => Answer::Ok {
                result: serde_json::to_value(done).unwrap_or_default(),
                untrusted: Some(format!("the answer from {site}")),
                dialog: None,
            },
            Err(why) => why,
        };
    }
    Answer::error(
        Code::Failed,
        format!("more than {MOST_HOPS} redirects: not followed further"),
    )
}

async fn once(
    url: &Url,
    address: SocketAddr,
    request: &Request,
    left: Duration,
) -> Result<reqwest::Response, Answer> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    let client = Client::builder()
        .redirect(redirect::Policy::none())
        .resolve(&host(url), address)
        .timeout(left)
        .build()
        .map_err(|why| Answer::error(Code::Failed, why.to_string()))?;
    let mut sending = client
        .request(request.method.clone(), url.clone())
        .headers(request.headers.clone());
    if let Some(body) = &request.body {
        sending = sending.body(body.clone());
    }
    sending.send().await.map_err(failed)
}

fn failed(why: reqwest::Error) -> Answer {
    if why.is_timeout() {
        Answer::error(Code::Timeout, "it took longer than its time")
    } else {
        Answer::error(Code::Failed, why.to_string())
    }
}

async fn read(
    mut response: reqwest::Response,
    url: &str,
    request: &Request,
) -> Result<HttpDone, Answer> {
    let mut done = HttpDone {
        status: response.status().as_u16(),
        url: url.to_owned(),
        headers: headers_of(response.headers()),
        ..HttpDone::default()
    };
    if let Some(path) = &request.save {
        done.size = saved(&mut response, path, request.since).await?;
        done.saved = Some(path.display().to_string());
        return Ok(done);
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(failed)? {
        if stop::cancelled(request.since) {
            return Err(Answer::error(Code::Stopped, "the reader pressed the stop"));
        }
        bytes.extend_from_slice(&chunk);
        if bytes.len() > MOST_BODY {
            bytes.truncate(MOST_BODY);
            done.truncated = true;
            break;
        }
    }
    done.size = u64::try_from(bytes.len()).unwrap_or(u64::MAX);
    let (body, base64) = body_of(bytes, done.truncated);
    done.body = Some(body);
    done.base64 = base64;
    Ok(done)
}

fn body_of(bytes: Vec<u8>, cut: bool) -> (String, bool) {
    match String::from_utf8(bytes) {
        Ok(text) => (text, false),
        Err(error) => {
            let broken = error.utf8_error();
            let bytes = error.into_bytes();
            if cut && broken.error_len().is_none() {
                let whole = &bytes[..broken.valid_up_to()];
                (String::from_utf8_lossy(whole).into_owned(), false)
            } else {
                (
                    base64::engine::general_purpose::STANDARD.encode(&bytes),
                    true,
                )
            }
        }
    }
}

async fn saved(response: &mut reqwest::Response, path: &Path, since: u64) -> Result<u64, Answer> {
    let failing = |why: String| Answer::error(Code::Failed, why);
    if let Some(folder) = path.parent() {
        std::fs::create_dir_all(folder).map_err(|why| failing(why.to_string()))?;
    }
    let part = path.with_file_name(format!(
        ".{}.orden-part",
        path.file_name()
            .map_or_else(String::new, |name| name.to_string_lossy().into_owned())
    ));
    let mut file = std::fs::File::create(&part).map_err(|why| failing(why.to_string()))?;
    let mut size = 0_u64;
    let written = loop {
        let chunk = match response.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break Ok(()),
            Err(why) => break Err(failed(why)),
        };
        if stop::cancelled(since) {
            break Err(Answer::error(Code::Stopped, "the reader pressed the stop"));
        }
        size += u64::try_from(chunk.len()).unwrap_or(u64::MAX);
        if size > MOST_SAVED {
            break Err(failing(format!("past {MOST_SAVED} bytes: not saved")));
        }
        if let Err(why) = file.write_all(&chunk) {
            break Err(failing(why.to_string()));
        }
    };
    let written = written.and_then(|()| file.sync_all().map_err(|why| failing(why.to_string())));
    drop(file);
    let written =
        written.and_then(|()| std::fs::rename(&part, path).map_err(|why| failing(why.to_string())));
    if written.is_err() {
        let _ = std::fs::remove_file(&part);
    }
    written.map(|()| size)
}

fn headers_of(headers: &HeaderMap) -> BTreeMap<String, String> {
    let mut all: BTreeMap<String, String> = BTreeMap::new();
    for (name, value) in headers {
        let value = String::from_utf8_lossy(value.as_bytes()).into_owned();
        all.entry(name.as_str().to_owned())
            .and_modify(|kept| {
                kept.push_str(", ");
                kept.push_str(&value);
            })
            .or_insert(value);
    }
    all
}

fn host(url: &Url) -> String {
    url.host_str()
        .unwrap_or_default()
        .trim_start_matches('[')
        .trim_end_matches(']')
        .trim_end_matches('.')
        .to_lowercase()
}

#[derive(Debug, PartialEq, Eq)]
enum Reach {
    Go,
    Ask { site: String, always: String },
}

fn reachable(app: &AppHandle, grant: Option<&Grant>, url: &Url) -> Result<(), Answer> {
    if !web(url) {
        return Err(Answer::error(
            Code::BadArguments,
            format!("{url} is not an http or https address"),
        ));
    }
    let Some(grant) = grant else {
        return Ok(());
    };
    let before = reached(&grant.id, &policy::site_of(&host(url)));
    let Reach::Ask { site, always } = decided(grant, url, before)? else {
        return Ok(());
    };
    let key = approvals::key("http", None, Some(&site));
    if approvals::allowed(&grant.id, &key) {
        remember(&grant.id, &site);
        return Ok(());
    }
    Err(approvals::ask(
        app,
        Asking {
            agent: &grant.id,
            name: &grant.name,
            category: Category::Writing,
            summary: format!("Send requests to {site}"),
            site: Some(always),
            tab: None,
            key,
        },
    ))
}

fn decided(grant: &Grant, url: &Url, before: bool) -> Result<Reach, Answer> {
    let host = host(url);
    let site = policy::site_of(&host);
    let rule = policy::rule_for(grant, &host);
    if rule == Some(SiteRule::Deny) {
        return Err(Answer::error(
            Code::SiteDenied,
            format!("{site} is denied to this agent"),
        ));
    }
    if grant.mode != Mode::Confirm
        || !grant.asks(Category::Writing)
        || rule == Some(SiteRule::Allow)
    {
        return Ok(Reach::Go);
    }
    let always = format!("http:{site}");
    if grant.always(&always, Category::Writing) || before {
        return Ok(Reach::Go);
    }
    Ok(Reach::Ask { site, always })
}

fn web(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https") && url.host_str().is_some_and(|host| !host.is_empty())
}

fn reached(agent: &str, site: &str) -> bool {
    REACHED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .as_ref()
        .is_some_and(|all| all.contains(&(agent.to_owned(), site.to_owned())))
}

fn remember(agent: &str, site: &str) {
    REACHED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .get_or_insert_with(HashSet::new)
        .insert((agent.to_owned(), site.to_owned()));
}

async fn address(url: &Url) -> Result<SocketAddr, Answer> {
    let named = host(url);
    let Some(port) = url.port_or_known_default() else {
        return Err(Answer::error(
            Code::BadArguments,
            format!("{url} has no port"),
        ));
    };
    let looked = named.clone();
    let found: Vec<SocketAddr> = tauri::async_runtime::spawn_blocking(move || {
        (looked.as_str(), port)
            .to_socket_addrs()
            .map(Iterator::collect)
            .unwrap_or_default()
    })
    .await
    .unwrap_or_default();
    if found
        .iter()
        .any(|one| own_endpoint(*one, crate::endpoint::own_port()))
    {
        return Err(Answer::error(
            Code::NotGranted,
            format!("{named}:{port} is Orden's own endpoint, which no agent's request reaches"),
        ));
    }
    found
        .first()
        .copied()
        .ok_or_else(|| Answer::error(Code::Failed, format!("{named} is not a name that resolves")))
}

fn own_endpoint(address: SocketAddr, own: Option<u16>) -> bool {
    let Some(own) = own else {
        return false;
    };
    let ip = match address.ip() {
        IpAddr::V6(v6) => v6.to_ipv4_mapped().map_or(IpAddr::V6(v6), IpAddr::V4),
        IpAddr::V4(v4) => IpAddr::V4(v4),
    };
    address.port() == own && (ip.is_loopback() || ip.is_unspecified())
}

fn strip_credentials(headers: &mut HeaderMap) {
    headers.remove(AUTHORIZATION);
    headers.remove(COOKIE);
    headers.remove(reqwest::header::PROXY_AUTHORIZATION);
}

fn redirected(
    status: StatusCode,
    method: &Method,
    body: Option<Vec<u8>>,
) -> (Method, Option<Vec<u8>>) {
    let again = matches!(
        status,
        StatusCode::TEMPORARY_REDIRECT | StatusCode::PERMANENT_REDIRECT
    );
    if again
        || ((*method == Method::GET || *method == Method::HEAD) && status != StatusCode::SEE_OTHER)
    {
        (method.clone(), body)
    } else {
        (Method::GET, None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_apps_own_endpoint_is_never_reached() {
        let own = Some(4100);
        for address in [
            "127.0.0.1:4100",
            "127.0.0.2:4100",
            "0.0.0.0:4100",
            "[::1]:4100",
            "[::]:4100",
            "[::ffff:127.0.0.1]:4100",
        ] {
            let address: SocketAddr = address.parse().expect("an address");
            assert!(own_endpoint(address, own), "{address}");
        }
        for address in ["127.0.0.1:4101", "192.0.2.1:4100", "[2001:db8::1]:4100"] {
            let address: SocketAddr = address.parse().expect("an address");
            assert!(!own_endpoint(address, own), "{address}");
        }
        assert!(!own_endpoint(
            "127.0.0.1:4100".parse().expect("an address"),
            None
        ));
        for named in [
            "http://localhost:4100/",
            "http://127.1:4100/",
            "http://2130706433:4100/",
        ] {
            let url = Url::parse(named).expect("an address");
            let found: Vec<SocketAddr> = (host(&url).as_str(), 4100)
                .to_socket_addrs()
                .map(Iterator::collect)
                .unwrap_or_default();
            assert!(found.iter().any(|one| own_endpoint(*one, own)), "{named}");
        }
    }

    #[test]
    fn only_http_and_https_are_sent() {
        for allowed in ["http://a.example/", "https://a.example:8443/x?y"] {
            assert!(web(&Url::parse(allowed).expect("an address")), "{allowed}");
        }
        for refused in [
            "file:///etc/passwd",
            "file://localhost/C:/Users/me/AppData/Roaming/Orden/agents.json",
            "ftp://a.example/",
            "data:text/plain,hi",
            "javascript:alert(1)",
            "ws://a.example/",
        ] {
            assert!(!web(&Url::parse(refused).expect("an address")), "{refused}");
        }
    }

    #[test]
    fn a_host_is_named_as_a_rule_and_a_pin_name_it() {
        let url = Url::parse("https://Bank.Example./x").expect("an address");
        assert_eq!(host(&url), "bank.example");
        let url = Url::parse("http://[::1]:8080/").expect("an address");
        assert_eq!(host(&url), "::1");
    }

    #[test]
    fn a_credential_goes_to_its_own_site_alone() {
        let mut headers = HeaderMap::new();
        headers.insert(AUTHORIZATION, HeaderValue::from_static("Bearer t"));
        headers.insert(COOKIE, HeaderValue::from_static("a=b"));
        headers.insert("x-kept", HeaderValue::from_static("1"));
        strip_credentials(&mut headers);
        assert_eq!(headers.len(), 1);
        assert!(headers.contains_key("x-kept"));
    }

    #[test]
    fn a_redirect_goes_on_as_a_browser_follows_it() {
        let body = Some(b"x".to_vec());
        assert_eq!(
            redirected(StatusCode::FOUND, &Method::POST, body.clone()),
            (Method::GET, None)
        );
        assert_eq!(
            redirected(StatusCode::SEE_OTHER, &Method::PUT, body.clone()),
            (Method::GET, None)
        );
        assert_eq!(
            redirected(StatusCode::TEMPORARY_REDIRECT, &Method::POST, body.clone()),
            (Method::POST, body.clone())
        );
        assert_eq!(
            redirected(StatusCode::MOVED_PERMANENTLY, &Method::GET, None),
            (Method::GET, None)
        );
    }

    #[test]
    fn a_body_is_words_where_it_is_text_and_base64_where_not() {
        assert_eq!(body_of(b"hi".to_vec(), false), ("hi".into(), false));
        assert_eq!(body_of(vec![0xff, 0x00], false), ("/wA=".into(), true));
        let mut cut = "gr\u{fc}".as_bytes().to_vec();
        cut.pop();
        assert_eq!(body_of(cut, true), ("gr".into(), false));
    }

    #[test]
    fn headers_said_twice_are_joined() {
        let mut headers = HeaderMap::new();
        headers.append("set-cookie", HeaderValue::from_static("a=1"));
        headers.append("set-cookie", HeaderValue::from_static("b=2"));
        assert_eq!(headers_of(&headers)["set-cookie"], "a=1, b=2");
    }

    fn url(said: &str) -> Url {
        Url::parse(said).expect("an address")
    }

    #[test]
    fn a_hop_goes_asks_or_is_refused_as_the_grant_says() {
        let mut own = Grant::own("http-own".into(), "A");
        own.sites.insert("Bank.Example.".into(), SiteRule::Deny);
        let refused = |grant: &Grant, said: &str| {
            matches!(
                decided(grant, &url(said), false),
                Err(Answer::Error {
                    code: Code::SiteDenied,
                    ..
                })
            )
        };
        assert!(refused(&own, "https://login.BANK.example./x"));
        assert_eq!(
            decided(&own, &url("https://docs.example/"), false),
            Ok(Reach::Go)
        );

        let mut full = own.clone();
        full.mode = Mode::Autonomous;
        assert!(refused(&full, "https://bank.example/"));
        assert_eq!(
            decided(&full, &url("https://docs.example/"), false),
            Ok(Reach::Go)
        );

        let mut confirm = Grant::third_party("http-third".into(), "B");
        confirm.sites.insert("bank.example".into(), SiteRule::Deny);
        assert!(refused(&confirm, "https://bank.example./"));
        assert_eq!(
            decided(&confirm, &url("https://api.docs.example/v1"), false),
            Ok(Reach::Ask {
                site: "docs.example".into(),
                always: "http:docs.example".into(),
            })
        );
        assert_eq!(
            decided(&confirm, &url("https://api.docs.example/v1"), true),
            Ok(Reach::Go)
        );
        let mut always = confirm.clone();
        always
            .always
            .insert("http:docs.example".into(), vec![Category::Writing]);
        assert_eq!(
            decided(&always, &url("https://docs.example/"), false),
            Ok(Reach::Go)
        );
        let mut allowed = confirm.clone();
        allowed.sites.insert("docs.example".into(), SiteRule::Allow);
        assert_eq!(
            decided(&allowed, &url("https://docs.example/"), false),
            Ok(Reach::Go)
        );
        let mut quiet = confirm;
        quiet.asks.insert(Category::Writing, false);
        assert_eq!(
            decided(&quiet, &url("https://docs.example/"), false),
            Ok(Reach::Go)
        );
    }

    #[test]
    fn every_redirect_is_held_to_the_grant_before_it_is_sent() {
        use std::io::{Read as _, Write as _};
        use std::net::TcpListener;

        let there = TcpListener::bind("127.0.0.1:0").expect("a port");
        there.set_nonblocking(true).expect("not blocking");
        let there_port = there.local_addr().expect("its address").port();
        let first = TcpListener::bind("127.0.0.1:0").expect("a port");
        let first_port = first.local_addr().expect("its address").port();
        let answering = std::thread::spawn(move || {
            let (mut stream, _) = first.accept().expect("the first hop");
            let mut heard = Vec::new();
            let mut buffer = [0; 1024];
            while !heard.windows(4).any(|end| end == b"\r\n\r\n") {
                let read = stream.read(&mut buffer).expect("the request");
                if read == 0 {
                    break;
                }
                heard.extend_from_slice(&buffer[..read]);
            }
            let moved = format!(
                "HTTP/1.1 302 Found\r\nLocation: http://localhost:{there_port}/\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            );
            stream.write_all(moved.as_bytes()).expect("the answer");
        });

        let mut grant = Grant::own("http-hops".into(), "A");
        grant.sites.insert("localhost".into(), SiteRule::Deny);
        let seen = Mutex::new(Vec::new());
        let check = |hop: &Url| {
            let mut all = seen.lock().unwrap_or_else(PoisonError::into_inner);
            all.push(hop.to_string());
            decided(&grant, hop, false).map(|_| ())
        };
        let request = Request {
            method: Method::GET,
            headers: HeaderMap::new(),
            body: None,
            save: None,
            until: Instant::now() + Duration::from_secs(20),
            since: stop::generation(),
        };
        let start = url(&format!("http://127.0.0.1:{first_port}/"));
        let answer = tauri::async_runtime::block_on(sent(start, request, &check));
        answering.join().expect("the first hop answered");

        assert!(
            matches!(
                answer,
                Answer::Error {
                    code: Code::SiteDenied,
                    ..
                }
            ),
            "{answer:?}"
        );
        assert_eq!(
            *seen.lock().unwrap_or_else(PoisonError::into_inner),
            [
                format!("http://127.0.0.1:{first_port}/"),
                format!("http://localhost:{there_port}/"),
            ]
        );
        assert!(there.accept().is_err(), "nothing reached the denied site");
    }
}
