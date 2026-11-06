use std::collections::BTreeMap;

use tauri::AppHandle;

use super::approvals::{self, Asking};
use super::grants::{Grant, Scope, SiteRule};
use super::verbs::{Answer, Category, Code, Display, System, SystemDone, SystemInfo, SystemOp};
use super::{files, policy, Caller};

const SCHEMES: [&str; 4] = ["http", "https", "mailto", "tel"];

const SECRET_WORDS: [&str; 7] = [
    "TOKEN",
    "SECRET",
    "PASSWORD",
    "PASSWD",
    "CREDENTIAL",
    "PRIVATE",
    "COOKIE",
];

const SECRET_ENDINGS: [&str; 4] = ["_KEY", "_PAT", "_AUTH", "APIKEY"];

pub(super) fn answer(app: &AppHandle, caller: &Caller, asked: &System) -> Answer {
    if !caller.holds(Scope::Processes) {
        return Answer::error(
            Code::NotGranted,
            "the system needs the processes scope, which the reader grants in Settings > Agents",
        );
    }
    match asked.op {
        SystemOp::Open | SystemOp::Reveal => handed(app, caller, asked),
        SystemOp::Env => {
            let full = match caller {
                Caller::Reader => true,
                Caller::Agent(grant) => grant.asks_nothing(),
            };
            let (env, withheld) = environment(std::env::vars(), full);
            Answer::ok(SystemDone {
                env,
                withheld,
                ..SystemDone::default()
            })
        }
        SystemOp::Info => Answer::ok(SystemDone {
            info: Some(info(app)),
            ..SystemDone::default()
        }),
    }
}

fn handed(app: &AppHandle, caller: &Caller, asked: &System) -> Answer {
    let target = match (asked.op, asked.url.as_deref(), asked.path.as_deref()) {
        (SystemOp::Open, Some(url), None) => match address(url) {
            Ok(url) => Target::Url(url),
            Err(why) => return Answer::error(Code::BadArguments, why),
        },
        (_, None, Some(path)) => match files::absolute(app, path) {
            Ok(path) => match fenced(app, caller, path) {
                Ok(path) => Target::Path(path),
                Err(refused) => return refused,
            },
            Err(why) => return Answer::error(Code::BadArguments, why),
        },
        (SystemOp::Open, _, _) => {
            return Answer::error(Code::BadArguments, "say url or path, one of them")
        }
        _ => return Answer::error(Code::BadArguments, "say path"),
    };
    if let Caller::Agent(grant) = caller {
        if let Some(refused) = site_refused(grant, &target) {
            return refused;
        }
        if let Some(question) = question(app, grant, asked.op, &target) {
            return question;
        }
    }
    let said = target.to_string();
    let done = match (&target, asked.op) {
        (Target::Url(url), _) => tauri_plugin_opener::open_url(url, None::<&str>),
        (Target::Path(path), SystemOp::Reveal) => tauri_plugin_opener::reveal_item_in_dir(path),
        (Target::Path(path), _) => tauri_plugin_opener::open_path(path, None::<&str>),
    };
    match done {
        Ok(()) => Answer::ok(SystemDone {
            opened: Some(said),
            ..SystemDone::default()
        }),
        Err(why) => Answer::error(Code::Failed, why.to_string()),
    }
}

enum Target {
    Url(String),
    Path(std::path::PathBuf),
}

impl std::fmt::Display for Target {
    fn fmt(&self, out: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Target::Url(url) => out.write_str(url),
            Target::Path(path) => write!(out, "{}", path.display()),
        }
    }
}

fn fenced(
    app: &AppHandle,
    caller: &Caller,
    path: std::path::PathBuf,
) -> Result<std::path::PathBuf, Answer> {
    if let Caller::Agent(_) = caller {
        if let Some(refused) = files::fenced_out(app, &path) {
            return Err(refused);
        }
    }
    let path = super::working::on_disk(app, &path)
        .map_err(|why| Answer::error(Code::BadArguments, why))?;
    if std::fs::symlink_metadata(&path).is_err() {
        return Err(Answer::error(
            Code::BadArguments,
            format!("there is nothing at {}", path.display()),
        ));
    }
    Ok(path)
}

fn address(url: &str) -> Result<String, String> {
    let parsed: tauri::Url = url
        .trim()
        .parse()
        .map_err(|_| format!("{url} is not an address"))?;
    if !SCHEMES.contains(&parsed.scheme()) {
        return Err(format!(
            "{} addresses are not opened: only {}; a file is opened by its path",
            parsed.scheme(),
            SCHEMES.join(", ")
        ));
    }
    Ok(parsed.to_string())
}

fn site_refused(grant: &Grant, target: &Target) -> Option<Answer> {
    let Target::Url(url) = target else {
        return None;
    };
    let host = policy::host_of(url)?;
    let site = policy::site_of(&host);
    let why = match policy::rule_for(grant, &host)? {
        SiteRule::Allow => return None,
        SiteRule::Deny => format!("{site} is denied to this agent"),
        SiteRule::AgentStore => format!(
            "{site} is only for this agent's own store, and the system's browser is the reader's"
        ),
    };
    Some(Answer::error(Code::SiteDenied, why))
}

fn question(app: &AppHandle, grant: &Grant, op: SystemOp, target: &Target) -> Option<Answer> {
    if !grant.asks(Category::Terminal) {
        return None;
    }
    let word = if op == SystemOp::Reveal {
        "reveal"
    } else {
        "open"
    };
    let key = approvals::key("system", None, Some(&format!("{word}:{target}")));
    if approvals::allowed(&grant.id, &key) {
        return None;
    }
    let summary = if op == SystemOp::Reveal {
        format!("Show {target} in the file manager")
    } else {
        format!("Open {target}")
    };
    Some(approvals::ask(
        app,
        Asking {
            agent: &grant.id,
            name: &grant.name,
            category: Category::Terminal,
            summary,
            site: None,
            tab: None,
            key,
        },
    ))
}

fn secret(name: &str) -> bool {
    let name = name.to_ascii_uppercase();
    SECRET_WORDS.iter().any(|word| name.contains(word))
        || SECRET_ENDINGS.iter().any(|ending| name.ends_with(ending))
        || name == "KEY"
}

fn secret_value(value: &str) -> bool {
    value
        .trim()
        .parse::<tauri::Url>()
        .is_ok_and(|url| url.password().is_some())
}

fn environment(
    vars: impl Iterator<Item = (String, String)>,
    full: bool,
) -> (BTreeMap<String, String>, Vec<String>) {
    let mut env = BTreeMap::new();
    let mut withheld = Vec::new();
    for (name, value) in vars {
        if !full && (secret(&name) || secret_value(&value)) {
            withheld.push(name);
        } else {
            env.insert(name, value);
        }
    }
    withheld.sort();
    (env, withheld)
}

fn engine() -> &'static str {
    if cfg!(feature = "cef") {
        "Chromium (CEF)"
    } else if cfg!(windows) {
        "WebView2"
    } else if cfg!(target_os = "macos") {
        "WKWebView"
    } else {
        "WebKitGTK"
    }
}

fn info(app: &AppHandle) -> SystemInfo {
    let mut screens = app.available_monitors().unwrap_or_default();
    if let Ok(Some(primary)) = app.primary_monitor() {
        if let Some(at) = screens
            .iter()
            .position(|one| one.position() == primary.position())
        {
            screens.swap(0, at);
        }
    }
    SystemInfo {
        os: std::env::consts::OS.to_owned(),
        os_version: tauri_plugin_os::version().to_string(),
        arch: std::env::consts::ARCH.to_owned(),
        locale: tauri_plugin_os::locale(),
        app_version: app.package_info().version.to_string(),
        webview: Some(engine().to_owned()),
        displays: screens
            .iter()
            .map(|one| Display {
                name: one.name().cloned(),
                width: one.size().width,
                height: one.size().height,
                scale: one.scale_factor(),
            })
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_secret_is_left_out_by_its_name_unless_the_grant_is_full() {
        let vars = [
            ("PATH", "/usr/bin"),
            ("HOME", "/home/me"),
            ("GITHUB_TOKEN", "ghp_x"),
            ("OpenAI_Api_Key", "sk-x"),
            ("AWS_SECRET_ACCESS_KEY", "x"),
            ("DB_PASSWORD", "x"),
            ("NPM_AUTH", "x"),
            ("GH_PAT", "x"),
            ("MYAPIKEY", "x"),
            ("GOOGLE_APPLICATION_CREDENTIALS", "/x.json"),
            ("SSH_PRIVATE", "x"),
            ("DATABASE_URL", "postgres://me:pw@db.example/x"),
            ("HOMEPAGE", "https://me@a.example/"),
        ]
        .map(|(name, value)| (name.to_owned(), value.to_owned()));
        let (env, withheld) = environment(vars.clone().into_iter(), false);
        assert_eq!(env.keys().collect::<Vec<_>>(), ["HOME", "HOMEPAGE", "PATH"]);
        assert_eq!(withheld.len(), 10);
        assert!(withheld.contains(&"DATABASE_URL".to_owned()));
        assert!(!withheld.contains(&"PATH".to_owned()));
        let (env, withheld) = environment(vars.into_iter(), true);
        assert_eq!(env.len(), 13);
        assert!(withheld.is_empty());
    }

    #[test]
    fn only_the_webs_mails_and_telephones_addresses_are_opened() {
        for fine in [
            "https://a.example/x",
            "http://a.example",
            "mailto:me@a.example",
            "tel:+41",
        ] {
            assert!(address(fine).is_ok(), "{fine}");
        }
        for refused in [
            "file:///etc/passwd",
            "nib://command?id=sign-out",
            "orden://command?id=publish",
            "javascript:alert(1)",
            "ms-settings:privacy",
            "ftp://a.example/",
        ] {
            assert!(address(refused).is_err(), "{refused}");
        }
    }

    #[test]
    fn a_site_the_grant_keeps_from_the_reader_s_browser_is_not_opened_there() {
        let mut grant = Grant::own("system-sites".into(), "A");
        grant.sites.insert("bank.example".into(), SiteRule::Deny);
        grant
            .sites
            .insert("mail.example".into(), SiteRule::AgentStore);
        grant.sites.insert("ok.example".into(), SiteRule::Allow);
        let url = |said: &str| Target::Url(said.to_owned());
        for refused in [
            "https://bank.example/",
            "https://login.BANK.example./x",
            "https://mail.example/inbox",
        ] {
            assert!(
                matches!(
                    site_refused(&grant, &url(refused)),
                    Some(Answer::Error {
                        code: Code::SiteDenied,
                        ..
                    })
                ),
                "{refused}"
            );
        }
        let mut full = grant.clone();
        full.mode = crate::agents::grants::Mode::Autonomous;
        assert!(site_refused(&full, &url("https://bank.example/")).is_some());
        for fine in [
            "https://ok.example/",
            "https://docs.example/",
            "mailto:me@bank.example",
            "tel:+41",
        ] {
            assert!(site_refused(&grant, &url(fine)).is_none(), "{fine}");
        }
        let path = Target::Path(std::path::PathBuf::from("/tmp/bank.example"));
        assert!(site_refused(&grant, &path).is_none());
    }
}
