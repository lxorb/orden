use std::io::{BufRead as _, BufReader, Write as _};
use std::net::{Ipv4Addr, SocketAddr, TcpListener, TcpStream};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine as _;
use orden_base::Held as _;
use reqwest::header::{ACCEPT, AUTHORIZATION, CONTENT_TYPE};
use reqwest::{Client as Web, Url};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest as _, Sha256};

use crate::http::run;

pub const SIGN_IN: &str = "This server signs in with OAuth. Sign in to use it.";
const SIGNING_IN: Duration = Duration::from_secs(300);
const EARLY: u64 = 60;
const CALLBACK: &str = "/callback";
#[derive(Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Grant {
    pub resource: String,
    #[serde(default)]
    pub client_id: Option<String>,
    #[serde(default)]
    pub client_secret: Option<String>,
    #[serde(default)]
    pub basic: bool,
    #[serde(default)]
    pub registered: bool,
    #[serde(default)]
    pub port: Option<u16>,
    #[serde(default)]
    pub scopes: Vec<String>,
    #[serde(default)]
    pub authorization_url: Option<String>,
    #[serde(default)]
    pub token_url: Option<String>,
    #[serde(default)]
    pub audience: Option<String>,
    #[serde(default)]
    pub access: Option<String>,
    #[serde(default)]
    pub refresh: Option<String>,
    #[serde(default)]
    pub expires: Option<u64>,
}
pub fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |since| since.as_secs())
}
fn same_place(one: &str, other: &str) -> bool {
    one.trim_end_matches('/') == other.trim_end_matches('/')
}
impl Grant {
    pub fn preset(resource: &str) -> Self {
        Self { resource: resource.to_owned(), ..Self::default() }
    }
    pub fn belongs_to(&self, url: &str) -> bool {
        same_place(&self.resource, url)
    }
    pub fn signed_in(&self) -> bool {
        self.access.is_some() || self.refresh.is_some()
    }
    #[must_use]
    pub fn signed_out(mut self) -> Self {
        self.access = None;
        self.refresh = None;
        self.expires = None;
        self
    }
    fn fresh(&self) -> Option<&str> {
        self.access.as_deref().filter(|_| self.expires.is_none_or(|at| at > now() + EARLY))
    }
    pub fn values(&self) -> impl Iterator<Item = &str> {
        [&self.client_secret, &self.access, &self.refresh].into_iter().flatten().map(String::as_str)
    }
    fn took(&mut self, tokens: Tokens) {
        self.expires = tokens.expires_in.map(|lasts| now() + lasts);
        self.access = Some(tokens.access_token);
        if tokens.refresh_token.is_some() {
            self.refresh = tokens.refresh_token;
        }
    }
}
#[derive(Deserialize)]
struct Tokens {
    access_token: String,
    #[serde(default)]
    refresh_token: Option<String>,
    #[serde(default)]
    expires_in: Option<u64>,
}
enum Refusal {
    Gone,
    Failed(String),
}
pub(crate) fn web() -> Result<Web, String> {
    let _ = rustls::crypto::ring::default_provider().install_default();
    Web::builder()
        .connect_timeout(Duration::from_secs(15))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::limited(5))
        .build()
        .map_err(|error| error.to_string())
}
fn form(pairs: &[(&str, &str)]) -> String {
    let mut url = Url::parse("http://form.invalid/").expect("a fixed address");
    url.query_pairs_mut().extend_pairs(pairs);
    url.query().unwrap_or_default().to_owned()
}
pub fn challenged(header: &str, name: &str) -> Option<String> {
    let after = header.split_once(' ').map_or(header, |(_, rest)| rest);
    after.split(',').find_map(|pair| {
        let (key, value) = pair.trim().split_once('=')?;
        (key.trim().eq_ignore_ascii_case(name)).then(|| value.trim().trim_matches('"').to_owned())
    })
}
async fn json_at(web: &Web, url: &str) -> Option<Value> {
    let answer = web.get(url).header(ACCEPT, "application/json").send().await.ok()?;
    if !answer.status().is_success() {
        return None;
    }
    let bytes = answer.bytes().await.ok()?;
    serde_json::from_slice::<Value>(&bytes).ok().filter(Value::is_object)
}
struct Found {
    authorize: String,
    token: String,
    register: Option<String>,
    audience: String,
    scopes: Vec<String>,
}
fn texts(value: Option<&Value>) -> Vec<String> {
    value
        .and_then(Value::as_array)
        .map(|all| all.iter().filter_map(Value::as_str).map(str::to_owned).collect())
        .unwrap_or_default()
}
fn wells(base: &Url, well: &str) -> Vec<String> {
    let origin = base.origin().ascii_serialization();
    let path = base.path().trim_end_matches('/');
    let mut all = vec![format!("{origin}/.well-known/{well}{path}")];
    if !path.is_empty() {
        all.push(format!("{origin}/.well-known/{well}"));
    }
    all
}
async fn first_json(web: &Web, places: &[String]) -> Option<Value> {
    for place in places {
        if let Some(found) = json_at(web, place).await {
            return Some(found);
        }
    }
    None
}
async fn discovered(web: Web, url: Url, challenge: Option<String>) -> Result<Found, String> {
    let mut places: Vec<String> = challenge
        .as_deref()
        .and_then(|said| challenged(said, "resource_metadata"))
        .into_iter()
        .collect();
    places.extend(wells(&url, "oauth-protected-resource"));
    let resource = first_json(&web, &places).await;
    let issuer = resource
        .as_ref()
        .and_then(|found| texts(found.get("authorization_servers")).into_iter().next())
        .unwrap_or_else(|| url.origin().ascii_serialization());
    let issuer = Url::parse(&issuer).map_err(|_| format!("'{issuer}' is no sign-in server"))?;
    let mut places = wells(&issuer, "oauth-authorization-server");
    places.extend(wells(&issuer, "openid-configuration"));
    places.push(format!(
        "{}/.well-known/openid-configuration",
        issuer.as_str().trim_end_matches('/')
    ));
    places.dedup();
    let metadata = first_json(&web, &places).await;
    let origin = issuer.origin().ascii_serialization();
    let endpoint = |name: &str, fallback: &str| {
        metadata
            .as_ref()
            .and_then(|found| found.get(name))
            .and_then(Value::as_str)
            .map(str::to_owned)
            .or_else(|| {
                (resource.is_none() && metadata.is_none()).then(|| format!("{origin}{fallback}"))
            })
    };
    let (Some(authorize), Some(token)) =
        (endpoint("authorization_endpoint", "/authorize"), endpoint("token_endpoint", "/token"))
    else {
        return Err("the server's sign-in service says nothing about how to sign in".to_owned());
    };
    let mut scopes: Vec<String> = challenge
        .as_deref()
        .and_then(|said| challenged(said, "scope"))
        .map(|scope| scope.split_whitespace().map(str::to_owned).collect())
        .unwrap_or_default();
    if scopes.is_empty() {
        scopes = texts(resource.as_ref().and_then(|found| found.get("scopes_supported")));
    }
    let mut audience = url.clone();
    audience.set_fragment(None);
    Ok(Found {
        authorize,
        token,
        register: endpoint("registration_endpoint", "/register"),
        audience: resource
            .as_ref()
            .and_then(|found| found.get("resource"))
            .and_then(Value::as_str)
            .map_or_else(|| audience.to_string(), str::to_owned),
        scopes,
    })
}
async fn registered(
    web: Web,
    endpoint: String,
    redirect: String,
) -> Result<(String, Option<String>, bool), String> {
    let asked = json!({
        "client_name": "Orden",
        "redirect_uris": [redirect],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none"
    });
    let answer = web
        .post(endpoint)
        .header(CONTENT_TYPE, "application/json")
        .body(asked.to_string())
        .send()
        .await
        .map_err(|error| format!("could not reach the sign-in service: {error}"))?;
    let status = answer.status();
    let said: Value = answer
        .bytes()
        .await
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    let id = said.get("client_id").and_then(Value::as_str).filter(|_| status.is_success());
    let Some(id) = id else {
        return Err(format!("the sign-in service would not register Orden (HTTP {status})"));
    };
    let secret = said.get("client_secret").and_then(Value::as_str).map(str::to_owned);
    let basic = said.get("token_endpoint_auth_method").and_then(Value::as_str)
        == Some("client_secret_basic");
    Ok((id.to_owned(), secret, basic))
}
async fn tokens(web: &Web, grant: &Grant, pairs: &[(&str, &str)]) -> Result<Tokens, Refusal> {
    let url = grant
        .token_url
        .clone()
        .ok_or_else(|| Refusal::Failed("no token address is known".to_owned()))?;
    let client = grant.client_id.as_deref().unwrap_or_default();
    let mut pairs = pairs.to_vec();
    pairs.push(("client_id", client));
    if let Some(audience) = &grant.audience {
        pairs.push(("resource", audience));
    }
    let mut asked = web
        .post(url)
        .header(CONTENT_TYPE, "application/x-www-form-urlencoded")
        .header(ACCEPT, "application/json");
    match (&grant.client_secret, grant.basic) {
        (Some(secret), true) => {
            asked = asked.header(
                AUTHORIZATION,
                format!("Basic {}", STANDARD.encode(format!("{client}:{secret}"))),
            );
        }
        (Some(secret), false) => pairs.push(("client_secret", secret)),
        (None, _) => {}
    }
    let answer = asked.body(form(&pairs)).send().await.map_err(|error| {
        Refusal::Failed(format!("could not reach the sign-in service: {error}"))
    })?;
    let status = answer.status();
    let said: Value = answer
        .bytes()
        .await
        .ok()
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
        .unwrap_or_default();
    if status.is_success() {
        return serde_json::from_value(said)
            .map_err(|_| Refusal::Failed("the sign-in service sent no token".to_owned()));
    }
    match said.get("error").and_then(Value::as_str) {
        Some("invalid_grant" | "invalid_client" | "unauthorized_client") => Err(Refusal::Gone),
        Some(code) => Err(Refusal::Failed(format!("the sign-in service refused: {code}"))),
        None => Err(Refusal::Failed(format!("the sign-in service answered HTTP {status}"))),
    }
}
fn random(bytes: usize) -> Result<String, String> {
    let mut drawn = vec![0_u8; bytes];
    getrandom::fill(&mut drawn).map_err(|error| error.to_string())?;
    Ok(URL_SAFE_NO_PAD.encode(drawn))
}
fn listening(grant: &Grant) -> Result<TcpListener, String> {
    let at = |port: u16| TcpListener::bind(SocketAddr::from((Ipv4Addr::LOCALHOST, port)));
    match grant.port {
        Some(port) if !grant.registered => at(port)
            .map_err(|_| format!("port {port}, which this server's sign-in needs, is taken")),
        Some(port) => at(port).or_else(|_| at(0)).map_err(|error| error.to_string()),
        None => at(0).map_err(|error| error.to_string()),
    }
}
pub fn sign_in(
    url: &str,
    mut grant: Grant,
    challenge: Option<String>,
    open: &dyn Fn(&str) -> Result<(), String>,
) -> Result<Grant, String> {
    let web = web()?;
    let parsed = Url::parse(url).map_err(|_| format!("'{url}' is no web address"))?;
    let found =
        run(discovered(web.clone(), parsed, challenge)).ok_or("the sign-in was dropped")??;
    let listener = listening(&grant)?;
    let port = listener.local_addr().map_err(|error| error.to_string())?.port();
    let redirect = format!("http://localhost:{port}{CALLBACK}");
    if grant.client_id.is_none() || (grant.registered && grant.port != Some(port)) {
        let register = found
            .register
            .clone()
            .ok_or("this server's sign-in needs a client id, and it offers no way to get one")?;
        let (id, secret, basic) = run(registered(web.clone(), register, redirect.clone()))
            .ok_or("the sign-in was dropped")??;
        grant.client_id = Some(id);
        grant.client_secret = secret;
        grant.basic = basic;
        grant.registered = true;
    }
    grant.port = Some(port);
    url.clone_into(&mut grant.resource);
    grant.audience = Some(found.audience);
    grant.token_url = grant.token_url.take().or(Some(found.token));
    if grant.scopes.is_empty() {
        grant.scopes = found.scopes;
    }
    let verifier = random(48)?;
    let state = random(24)?;
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let authorize = grant.authorization_url.clone().unwrap_or(found.authorize);
    let mut link =
        Url::parse(&authorize).map_err(|_| format!("'{authorize}' is no sign-in page"))?;
    {
        let client = grant.client_id.clone().unwrap_or_default();
        let audience = grant.audience.clone().unwrap_or_default();
        let mut query = link.query_pairs_mut();
        query.extend_pairs([
            ("response_type", "code"),
            ("client_id", client.as_str()),
            ("redirect_uri", redirect.as_str()),
            ("code_challenge", challenge.as_str()),
            ("code_challenge_method", "S256"),
            ("state", state.as_str()),
            ("resource", audience.as_str()),
        ]);
        if !grant.scopes.is_empty() {
            query.append_pair("scope", &grant.scopes.join(" "));
        }
    }
    open(link.as_str())?;
    let code = waited_for(&listener, &state)?;
    let got = run({
        let (web, grant) = (web.clone(), grant.clone());
        async move {
            tokens(
                &web,
                &grant,
                &[
                    ("grant_type", "authorization_code"),
                    ("code", code.as_str()),
                    ("redirect_uri", redirect.as_str()),
                    ("code_verifier", verifier.as_str()),
                ],
            )
            .await
        }
    })
    .ok_or("the sign-in was dropped")?;
    match got {
        Ok(tokens) => {
            grant.took(tokens);
            Ok(grant)
        }
        Err(Refusal::Gone) => Err("the sign-in service did not take the sign-in".to_owned()),
        Err(Refusal::Failed(why)) => Err(why),
    }
}
fn waited_for(listener: &TcpListener, state: &str) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|error| error.to_string())?;
    let started = Instant::now();
    while started.elapsed() < SIGNING_IN {
        match listener.accept() {
            Ok((stream, _)) => {
                if let Some(said) = answered(stream, state) {
                    return said;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    Err("the sign-in was not finished within 5 minutes".to_owned())
}
pub fn called_back(line: &str, state: &str) -> Option<Result<String, String>> {
    let mut parts = line.split_whitespace();
    let (Some("GET"), Some(target)) = (parts.next(), parts.next()) else {
        return None;
    };
    let url = Url::parse(&format!("http://localhost{target}")).ok()?;
    if url.path() != CALLBACK {
        return None;
    }
    let said = |name: &str| {
        url.query_pairs().find(|(key, _)| key == name).map(|(_, value)| value.into_owned())
    };
    if said("state").as_deref() != Some(state) {
        return None;
    }
    if let Some(error) = said("error") {
        return Some(Err(said("error_description").unwrap_or(error)));
    }
    Some(said("code").filter(|code| !code.is_empty()).ok_or_else(|| "no code came back".to_owned()))
}
fn answered(mut stream: TcpStream, state: &str) -> Option<Result<String, String>> {
    let _ = stream.set_nonblocking(false);
    let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
    let mut line = String::new();
    BufReader::new(&stream).read_line(&mut line).ok()?;
    let said = called_back(&line, state);
    let (status, words) = match &said {
        Some(Ok(_)) => ("200 OK", "Orden is signed in. This tab can be closed."),
        Some(Err(_)) => ("200 OK", "Orden was not signed in."),
        None => ("404 Not Found", ""),
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
    said
}
pub(crate) struct Auth {
    web: Option<Web>,
    grant: tokio::sync::Mutex<Option<Grant>>,
    refused: Mutex<Option<String>>,
    keep: Box<dyn Fn(Grant) + Send + Sync>,
}
impl Auth {
    pub fn new(grant: Option<Grant>, keep: impl Fn(Grant) + Send + Sync + 'static) -> Self {
        Self {
            web: web().ok(),
            grant: tokio::sync::Mutex::new(grant),
            refused: Mutex::new(None),
            keep: Box::new(keep),
        }
    }
    pub fn none() -> Self {
        Self::new(None, |_| {})
    }
    pub async fn bearer(&self) -> Option<String> {
        let mut held = self.grant.lock().await;
        let grant = held.as_mut()?;
        if let Some(fresh) = grant.fresh() {
            return Some(fresh.to_owned());
        }
        if grant.refresh.is_none() {
            return grant.access.clone();
        }
        self.renew(grant).await
    }
    pub async fn renewed(&self, stale: &str) -> Option<String> {
        let mut held = self.grant.lock().await;
        let grant = held.as_mut()?;
        if grant.access.as_deref() != Some(stale) {
            return grant.access.clone();
        }
        self.renew(grant).await
    }
    async fn renew(&self, grant: &mut Grant) -> Option<String> {
        let web = self.web.as_ref()?;
        let refresh = grant.refresh.clone()?;
        match tokens(web, grant, &[("grant_type", "refresh_token"), ("refresh_token", &refresh)])
            .await
        {
            Ok(got) => {
                grant.took(got);
                (self.keep)(grant.clone());
                grant.access.clone()
            }
            Err(Refusal::Gone) => {
                *grant = grant.clone().signed_out();
                (self.keep)(grant.clone());
                None
            }
            Err(Refusal::Failed(_)) => None,
        }
    }
    pub fn refused(&self, challenge: Option<&str>) {
        *self.refused.held() = Some(challenge.unwrap_or_default().to_owned());
    }
    pub fn challenge(&self) -> Option<String> {
        self.refused.held().clone()
    }
}
#[cfg(test)]
mod tests {
    use super::{called_back, challenged, form};

    #[test]
    fn a_challenge_names_where_the_sign_in_is_described() {
        let said = r#"Bearer error="invalid_token", resource_metadata="https://x.example/.well-known/oauth-protected-resource", scope="read write""#;
        assert_eq!(
            challenged(said, "resource_metadata").as_deref(),
            Some("https://x.example/.well-known/oauth-protected-resource")
        );
        assert_eq!(challenged(said, "scope").as_deref(), Some("read write"));
        assert_eq!(challenged("Bearer", "scope"), None);
    }
    #[test]
    fn only_this_sign_in_s_callback_is_taken() {
        assert_eq!(
            called_back("GET /callback?code=a%2Fb&state=s1 HTTP/1.1", "s1"),
            Some(Ok("a/b".to_owned()))
        );
        assert_eq!(called_back("GET /callback?code=a&state=other HTTP/1.1", "s1"), None);
        assert_eq!(called_back("GET /favicon.ico HTTP/1.1", "s1"), None);
        assert_eq!(
            called_back("GET /callback?error=access_denied&state=s1 HTTP/1.1", "s1"),
            Some(Err("access_denied".to_owned()))
        );
    }
    #[test]
    fn a_form_is_encoded() {
        assert_eq!(form(&[("a", "b c"), ("d", "e&f")]), "a=b+c&d=e%26f");
    }
}
