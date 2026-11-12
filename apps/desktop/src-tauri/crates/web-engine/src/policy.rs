use url::Url;

pub const APP_HOSTS: [&str; 4] = [
    "tauri.localhost",
    "ipc.localhost",
    "asset.localhost",
    "nib.localhost",
];

pub const INTERNAL_MARK: &str = "data-tauri-cef-internal";

pub trait ExtensionUrls {
    fn is_extension(&self, url: &Url) -> bool;
}

impl<F: Fn(&Url) -> bool> ExtensionUrls for F {
    fn is_extension(&self, url: &Url) -> bool {
        self(url)
    }
}

pub struct NoExtensions;

impl ExtensionUrls for NoExtensions {
    fn is_extension(&self, _url: &Url) -> bool {
        false
    }
}

#[must_use]
pub fn app_host(host: &str) -> bool {
    let plain = host.trim_end_matches('.').to_ascii_lowercase();
    APP_HOSTS.contains(&plain.as_str())
}

#[must_use]
pub fn allowed(url: &Url) -> bool {
    if url.scheme() == "view-source" {
        return url
            .as_str()
            .strip_prefix("view-source:")
            .and_then(|inner| Url::parse(inner).ok())
            .is_some_and(|inner| inner.scheme() != "view-source" && allowed(&inner));
    }
    if !matches!(url.scheme(), "http" | "https") {
        return false;
    }
    !app_host(url.host_str().unwrap_or_default())
}

pub fn tab_may_open(url: &Url, extensions: &impl ExtensionUrls) -> bool {
    allowed(url) || extensions.is_extension(url)
}

pub fn frame_may_open(url: &Url, extensions: &impl ExtensionUrls) -> bool {
    match url.scheme() {
        "about" => matches!(url.path(), "blank" | "srcdoc"),
        "data" => true,
        "blob" => {
            Url::parse(url.path()).is_ok_and(|inner| inner.scheme() != "blob" && allowed(&inner))
        }
        _ => tab_may_open(url, extensions),
    }
}

#[must_use]
pub fn internal(url: &str) -> bool {
    url.starts_with("data:") && url.contains(INTERNAL_MARK)
}

#[must_use]
pub fn blank(url: &Url) -> bool {
    url.scheme() == "about" && url.path() == "blank"
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Becomes {
    Tab(String),
    Window,
    Blocked(String),
    Nothing,
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Asked {
    pub sized: bool,
    pub said: bool,
    pub unasked: bool,
}

pub fn becomes(url: &Url, asked: Asked, extensions: &impl ExtensionUrls) -> Becomes {
    let handed = || tab_may_open(url, extensions).then(|| url.to_string());
    if asked.said {
        return handed().map_or(Becomes::Nothing, Becomes::Tab);
    }
    if asked.unasked {
        return handed().map_or(Becomes::Nothing, Becomes::Blocked);
    }
    if extensions.is_extension(url) {
        return Becomes::Tab(url.to_string());
    }
    if asked.sized || blank(url) || signs_in(url) {
        return Becomes::Window;
    }
    handed().map_or(Becomes::Nothing, Becomes::Tab)
}

const SIGNING_IN: &[&str] = &[
    "auth",
    "authorize",
    "authorization",
    "authenticate",
    "oidc",
    "openid",
    "saml",
    "saml2",
    "sso",
    "signin",
    "login",
    "logon",
    "consent",
    "3ds",
    "threeds",
    "challenge",
];

const SIGNING_IN_HOSTS: &[&str] = &[
    "accounts", "account", "auth", "login", "sso", "id", "secure",
];

#[must_use]
pub fn signs_in(url: &Url) -> bool {
    let words = |text: &str| {
        text.to_ascii_lowercase()
            .split(|one: char| !one.is_ascii_alphanumeric())
            .filter(|word| !word.is_empty())
            .map(str::to_string)
            .collect::<Vec<_>>()
    };
    let host = url.host_str().unwrap_or_default();
    let first = host
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_lowercase();
    let path = words(url.path());
    let said = |word: &str| SIGNING_IN.contains(&word) || word.starts_with("oauth");
    SIGNING_IN_HOSTS.contains(&first.as_str())
        || path.iter().any(|word| said(word))
        || path.windows(2).any(|pair| {
            matches!(
                (pair[0].as_str(), pair[1].as_str()),
                ("sign" | "log", "in" | "on")
            )
        })
}
