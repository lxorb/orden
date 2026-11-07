use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{Manager, Webview};

use super::shells::Launch;
use super::ssh_config::{self, ConfigHost};

pub const PREFIX: &str = "ssh:";

const OWN: &str = "n-";

const MOST_HOSTS: usize = 500;
const MOST_WORDS: usize = 200;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Own {
    pub id: String,
    pub name: String,
    pub hostname: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub user: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub port: Option<u16>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct About {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub colour: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub pinned: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last: Option<u64>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Kept {
    #[serde(default)]
    pub own: Vec<Own>,
    #[serde(default)]
    pub about: BTreeMap<String, About>,
    #[serde(default)]
    pub order: Vec<String>,
    #[serde(default)]
    pub groups: Vec<String>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Destination {
    pub user: Option<String>,
    pub hostname: String,
    pub port: Option<u16>,
}

const SSH_VALUED: &[u8] = b"BbcDEeFIiJLlmOoPpQRSWw";
const SSH_NO_SESSION: &[u8] = b"fFGNOPQsVW";

pub fn ssh_destination(program: &str, args: &[String]) -> Option<Destination> {
    if program != "ssh" {
        return None;
    }

    let mut user = None;
    let mut port = None;
    let mut target = None;
    let mut words = args.iter();
    let mut options = true;

    while let Some(word) = words.next() {
        if options && word == "--" {
            options = false;
            continue;
        }
        if options && word.len() > 1 && word.starts_with('-') {
            let flags = &word.as_bytes()[1..];
            for (at, &flag) in flags.iter().enumerate() {
                if SSH_NO_SESSION.contains(&flag) {
                    return None;
                }
                if SSH_VALUED.contains(&flag) {
                    let attached = word.get(2 + at..)?;
                    let value = if attached.is_empty() {
                        words.next()?.clone()
                    } else {
                        attached.to_owned()
                    };
                    let (key, value) = match flag {
                        b'o' => ssh_setting(&value)?,
                        _ => (String::new(), value),
                    };
                    match (flag, key.as_str()) {
                        (b'l', _) | (b'o', "user") => {
                            user.get_or_insert(value);
                        }
                        (b'p', _) | (b'o', "port") => {
                            let number = value.parse::<u16>().ok().filter(|one| *one > 0)?;
                            port.get_or_insert(number);
                        }
                        (b'o', "hostname") => return None,
                        (b'o', "sessiontype") if !value.eq_ignore_ascii_case("default") => {
                            return None
                        }
                        (b'o', "remotecommand") if !value.eq_ignore_ascii_case("none") => {
                            return None
                        }
                        (b'o', "forkafterauthentication") if value.eq_ignore_ascii_case("yes") => {
                            return None
                        }
                        _ => {}
                    }
                    break;
                }
            }
            continue;
        }
        if target.is_some() {
            return None;
        }
        let found = destination_of(word)?;
        if let Some(one) = found.user.clone() {
            user.get_or_insert(one);
        }
        if let Some(one) = found.port {
            port.get_or_insert(one);
        }
        target = Some(found);
    }

    let destination = Destination {
        user,
        port,
        ..target?
    };
    let fits = is_address(&destination.hostname) && destination.user.as_deref().is_none_or(is_user);
    fits.then_some(destination)
}

fn ssh_setting(setting: &str) -> Option<(String, String)> {
    let setting = setting.trim_start();
    let at = setting.find(|one: char| one == '=' || one.is_whitespace())?;
    let key = setting[..at].to_ascii_lowercase();
    let value = setting[at..]
        .trim_start_matches(|one: char| one.is_whitespace())
        .strip_prefix('=')
        .unwrap_or_else(|| setting[at..].trim_start())
        .trim()
        .to_owned();
    Some((key, value))
}

fn destination_of(target: &str) -> Option<Destination> {
    let (rest, uri) = match target.strip_prefix("ssh://") {
        Some(rest) => (rest, true),
        None => (target, false),
    };
    let (user, address) = match rest.rfind('@') {
        Some(at) => (Some(rest[..at].to_owned()), &rest[at + 1..]),
        None => (None, rest),
    };
    if !uri {
        return Some(Destination {
            user,
            hostname: address.to_owned(),
            port: None,
        });
    }

    let address = address.strip_suffix('/').unwrap_or(address);
    let (hostname, port) = if let Some(inner) = address.strip_prefix('[') {
        let (hostname, after) = inner.split_once(']')?;
        (hostname, after.strip_prefix(':'))
    } else {
        match address.rsplit_once(':') {
            Some((hostname, port)) if !hostname.contains(':') => (hostname, Some(port)),
            _ => (address, None),
        }
    };
    let port = match port {
        Some(port) => Some(port.parse::<u16>().ok().filter(|one| *one > 0)?),
        None => None,
    };
    Some(Destination {
        user,
        hostname: hostname.to_owned(),
        port,
    })
}

#[derive(Serialize)]
pub struct Hosts {
    config: Vec<ConfigHost>,
    kept: Kept,
    file: Option<String>,
}

pub fn host_id(shell: &str) -> Option<&str> {
    shell.strip_prefix(PREFIX).filter(|one| !one.is_empty())
}

fn plain(word: &str) -> bool {
    !word.trim().is_empty()
        && word.chars().count() <= MOST_WORDS
        && !word.chars().any(char::is_control)
}

pub fn is_address(address: &str) -> bool {
    !address.is_empty()
        && address.len() <= 253
        && !address.starts_with('-')
        && address.bytes().all(|one| {
            one.is_ascii_alphanumeric() || matches!(one, b'.' | b'-' | b'_' | b':' | b'%')
        })
}

pub fn is_user(user: &str) -> bool {
    !user.is_empty()
        && user.len() <= 64
        && !user.starts_with('-')
        && user.bytes().all(|one| {
            one.is_ascii_alphanumeric() || matches!(one, b'.' | b'-' | b'_' | b'@' | b'\\' | b'$')
        })
}

fn is_own_id(id: &str) -> bool {
    id.starts_with(OWN)
        && id.len() <= 64
        && id[OWN.len()..]
            .bytes()
            .all(|one| one.is_ascii_alphanumeric() || one == b'-' || one == b'_')
        && id.len() > OWN.len()
}

pub fn checked(kept: Kept) -> Result<Kept, String> {
    if kept.own.len() > MOST_HOSTS || kept.about.len() > MOST_HOSTS * 2 {
        return Err("too many hosts".to_owned());
    }
    for own in &kept.own {
        let fits = is_own_id(&own.id)
            && plain(&own.name)
            && is_address(&own.hostname)
            && own.user.as_deref().is_none_or(is_user)
            && own.port.is_none_or(|port| port > 0);
        if !fits {
            return Err(format!("{:?} is not a host", own.name));
        }
    }
    for (id, about) in &kept.about {
        let fits = plain(id)
            && about
                .colour
                .as_deref()
                .is_none_or(|one| matches!(one, "1" | "2" | "3" | "4" | "5" | "6"))
            && about.group.as_deref().is_none_or(plain);
        if !fits {
            return Err(format!("{id:?} is not a host"));
        }
    }
    let words_fit = kept.order.len() <= MOST_HOSTS * 2
        && kept.groups.len() <= MOST_HOSTS
        && kept.order.iter().chain(&kept.groups).all(|one| plain(one));
    if !words_fit {
        return Err("not an order of hosts".to_owned());
    }
    Ok(kept)
}

fn merged(mut kept: Kept, before: &Kept) -> Kept {
    for (id, was) in &before.about {
        let Some(last) = was.last else { continue };
        let now = kept.about.entry(id.clone()).or_default();
        now.last = Some(now.last.map_or(last, |one| one.max(last)));
    }
    kept
}

pub fn arguments(target: &Target, config: Option<&Path>) -> Vec<String> {
    let mut args = Vec::new();
    if let Some(config) = config {
        args.extend(["-F".to_owned(), config.to_string_lossy().into_owned()]);
    }
    match target {
        Target::Config(alias) => args.extend(["--".to_owned(), (*alias).to_owned()]),
        Target::Own(own) => {
            if let Some(user) = &own.user {
                args.extend(["-l".to_owned(), user.clone()]);
            }
            if let Some(port) = own.port {
                args.extend(["-p".to_owned(), port.to_string()]);
            }
            args.extend(["--".to_owned(), own.hostname.clone()]);
        }
    }
    args
}

pub enum Target<'a> {
    Config(&'a str),
    Own(&'a Own),
}

fn target<'a>(id: &'a str, config: &[ConfigHost], kept: &'a Kept) -> Option<Target<'a>> {
    if is_own_id(id) {
        if let Some(own) = kept.own.iter().find(|one| one.id == id) {
            return Some(Target::Own(own));
        }
    }
    config
        .iter()
        .any(|one| one.id == id)
        .then_some(Target::Config(id))
}

struct Places {
    home: PathBuf,
    config: PathBuf,
    elsewhere: bool,
    kept: PathBuf,
}

fn places(webview: &Webview) -> Result<Places, String> {
    let home = dirs::home_dir().ok_or_else(|| "no home folder".to_owned())?;
    let own = std::env::var_os("NIB_SSH_CONFIG").filter(|one| !one.is_empty());
    let config = own
        .clone()
        .map_or_else(|| home.join(".ssh").join("config"), PathBuf::from);
    let data = webview
        .app_handle()
        .path()
        .app_local_data_dir()
        .map_err(|error| format!("could not find the app's data folder: {error}"))?;
    Ok(Places {
        home,
        config,
        elsewhere: own.is_some(),
        kept: data.join("remote").join("hosts.json"),
    })
}

static WRITING: Mutex<()> = Mutex::new(());

fn read_kept(path: &Path) -> Kept {
    fs::read(path)
        .ok()
        .filter(|bytes| bytes.len() <= 1 << 20)
        .and_then(|bytes| serde_json::from_slice::<Kept>(&bytes).ok())
        .and_then(|kept| checked(kept).ok())
        .unwrap_or_default()
}

fn write_kept(path: &Path, kept: &Kept) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "the hosts have a folder".to_owned())?;
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    let bytes = serde_json::to_vec_pretty(kept).map_err(|error| error.to_string())?;
    let part = path.with_extension("part");
    fs::write(&part, bytes).map_err(|error| error.to_string())?;
    fs::rename(&part, path).map_err(|error| {
        let _ = fs::remove_file(&part);
        error.to_string()
    })
}

fn ssh_program() -> Option<PathBuf> {
    if let Some(own) = std::env::var_os("NIB_SSH").filter(|one| !one.is_empty()) {
        return Some(PathBuf::from(own));
    }
    let name = if cfg!(windows) { "ssh.exe" } else { "ssh" };
    let system = std::env::var_os("SystemRoot")
        .filter(|_| cfg!(windows))
        .map(|root| Path::new(&root).join(r"System32\OpenSSH\ssh.exe"));
    let path = std::env::var_os("PATH").unwrap_or_default();
    system
        .into_iter()
        .chain(std::env::split_paths(&path).map(|folder| folder.join(name)))
        .chain((!cfg!(windows)).then(|| PathBuf::from("/usr/bin/ssh")))
        .find(|one| one.is_file())
}

pub fn connect(webview: &Webview, id: &str) -> Result<Launch, String> {
    let places = places(webview)?;
    let config = ssh_config::hosts(&places.config, &places.home, &ssh_config::Disk);

    let _writing = WRITING
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let mut kept = read_kept(&places.kept);
    let args = {
        let target = target(id, &config, &kept).ok_or_else(|| format!("no host {id} here"))?;
        arguments(&target, places.elsewhere.then_some(places.config.as_path()))
    };
    let program = ssh_program().ok_or_else(|| "no ssh on this machine".to_owned())?;

    kept.about.entry(id.to_owned()).or_default().last = Some(crate::clock::now());
    let _ = write_kept(&places.kept, &kept);

    Ok(Launch {
        program,
        args,
        folder: Some(places.home),
        env: vec![
            ("TERM".to_owned(), "xterm-256color".to_owned()),
            ("COLORTERM".to_owned(), "truecolor".to_owned()),
        ],
    })
}

pub(super) fn reach(webview: &Webview, id: &str) -> Result<(PathBuf, Vec<String>), String> {
    let places = places(webview)?;
    let config = ssh_config::hosts(&places.config, &places.home, &ssh_config::Disk);
    let kept = read_kept(&places.kept);
    let target = target(id, &config, &kept).ok_or_else(|| format!("no host {id} here"))?;
    let args = arguments(&target, places.elsewhere.then_some(places.config.as_path()));
    let program = ssh_program().ok_or_else(|| "no ssh on this machine".to_owned())?;
    Ok((program, args))
}

#[tauri::command(async)]
pub fn remote_hosts(webview: Webview) -> Result<Hosts, String> {
    super::owner(&webview)?;
    let places = places(&webview)?;
    let config = ssh_config::hosts(&places.config, &places.home, &ssh_config::Disk);
    let file = places
        .config
        .is_file()
        .then(|| places.config.to_string_lossy().into_owned());
    Ok(Hosts {
        config,
        kept: read_kept(&places.kept),
        file,
    })
}

#[tauri::command(async)]
pub fn remote_keep(webview: Webview, kept: Kept) -> Result<Kept, String> {
    super::owner(&webview)?;
    let places = places(&webview)?;
    let kept = checked(kept)?;

    let _writing = WRITING
        .lock()
        .unwrap_or_else(std::sync::PoisonError::into_inner);
    let kept = merged(kept, &read_kept(&places.kept));
    write_kept(&places.kept, &kept)?;
    Ok(kept)
}

#[tauri::command(async)]
pub fn remote_config_open(webview: Webview) -> Result<(), String> {
    super::owner(&webview)?;
    let path = places(&webview)?.config;
    if !path.is_file() {
        return Err("there is no ssh config".to_owned());
    }

    let mut command = if cfg!(windows) {
        let mut notepad = std::process::Command::new("notepad.exe");
        notepad.arg(&path);
        notepad
    } else if cfg!(target_os = "macos") {
        let mut open = std::process::Command::new("open");
        open.arg("-t").arg(&path);
        open
    } else {
        let mut open = std::process::Command::new("xdg-open");
        open.arg(&path);
        open
    };
    command.spawn().map(drop).map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn own(id: &str, hostname: &str) -> Own {
        Own {
            id: id.to_owned(),
            name: "Box".to_owned(),
            hostname: hostname.to_owned(),
            user: None,
            port: None,
        }
    }

    #[test]
    fn a_host_is_named_in_the_shell_id() {
        assert_eq!(host_id("ssh:pi"), Some("pi"));
        assert_eq!(host_id("ssh:"), None);
        assert_eq!(host_id("pwsh"), None);
    }

    #[test]
    fn nothing_kept_can_be_read_as_an_option() {
        for bad in ["-oProxyCommand=calc", "", "a b", "a;b", "host/x", "a\nb"] {
            assert!(!is_address(bad), "{bad:?} was an address");
        }
        for good in [
            "pi",
            "10.0.0.5",
            "fe80::1%eth0",
            "box.example.com",
            "my_host",
        ] {
            assert!(is_address(good), "{good:?} was refused");
        }
        for bad in ["-l", "", "a b", "a;b", "me:x"] {
            assert!(!is_user(bad), "{bad:?} was a user");
        }
        for good in ["emil", "DOMAIN\\emil", "emil@corp.example", "build$"] {
            assert!(is_user(good), "{good:?} was refused");
        }
    }

    #[test]
    fn a_kept_file_is_held_to_what_it_may_hold() {
        let mut kept = Kept::default();
        kept.own.push(own("n-abc", "box.example.com"));
        assert!(checked(kept.clone()).is_ok());

        let mut bad = kept.clone();
        bad.own[0].hostname = "-oProxyCommand=calc".to_owned();
        assert!(checked(bad).is_err());

        let mut not_ours = kept.clone();
        not_ours.own[0].id = "pi".to_owned();
        assert!(checked(not_ours).is_err());

        let mut colour = kept.clone();
        colour.about.insert(
            "pi".to_owned(),
            About {
                colour: Some("red".to_owned()),
                ..About::default()
            },
        );
        assert!(checked(colour).is_err());

        let mut fine = kept;
        fine.about.insert(
            "pi".to_owned(),
            About {
                colour: Some("4".to_owned()),
                group: Some("Home".to_owned()),
                pinned: true,
                last: Some(1),
            },
        );
        assert!(checked(fine).is_ok());
    }

    #[test]
    fn the_destination_goes_after_the_options_end() {
        let config = arguments(&Target::Config("pi"), None);
        assert_eq!(config, vec!["--", "pi"]);

        let mut made = own("n-abc", "10.0.0.5");
        made.user = Some("emil".to_owned());
        made.port = Some(2222);
        assert_eq!(
            arguments(&Target::Own(&made), None),
            vec!["-l", "emil", "-p", "2222", "--", "10.0.0.5"]
        );

        let elsewhere = arguments(&Target::Config("pi"), Some(Path::new("/tmp/config")));
        assert_eq!(elsewhere[..2], ["-F".to_owned(), "/tmp/config".to_owned()]);
    }

    #[test]
    fn an_id_names_a_host_of_the_config_or_one_made_here_and_nothing_else() {
        let config = vec![ConfigHost {
            id: "pi".to_owned(),
            ..ConfigHost::default()
        }];
        let mut kept = Kept::default();
        kept.own.push(own("n-abc", "box"));

        assert!(matches!(
            target("pi", &config, &kept),
            Some(Target::Config("pi"))
        ));
        assert!(matches!(
            target("n-abc", &config, &kept),
            Some(Target::Own(_))
        ));
        assert!(target("n-gone", &config, &kept).is_none());
        assert!(target("other", &config, &kept).is_none());
    }

    #[test]
    fn a_connection_noted_down_is_never_set_back() {
        let mut before = Kept::default();
        before.about.insert(
            "pi".to_owned(),
            About {
                last: Some(20),
                ..About::default()
            },
        );
        let mut saving = Kept::default();
        saving.about.insert(
            "pi".to_owned(),
            About {
                last: Some(10),
                pinned: true,
                ..About::default()
            },
        );

        let kept = merged(saving, &before);
        assert_eq!(kept.about["pi"].last, Some(20));
        assert!(kept.about["pi"].pinned);
    }

    fn ssh(args: &[&str]) -> Option<Destination> {
        let args: Vec<String> = args.iter().map(|one| (*one).to_owned()).collect();
        ssh_destination("ssh", &args)
    }

    fn at(user: Option<&str>, hostname: &str, port: Option<u16>) -> Destination {
        Destination {
            user: user.map(str::to_owned),
            hostname: hostname.to_owned(),
            port,
        }
    }

    #[test]
    fn an_ssh_session_is_read_off_its_arguments() {
        assert_eq!(ssh(&["pi"]), Some(at(None, "pi", None)));
        assert_eq!(
            ssh(&["emil@10.0.0.5"]),
            Some(at(Some("emil"), "10.0.0.5", None))
        );
        assert_eq!(
            ssh(&["-p", "2222", "-l", "emil", "box"]),
            Some(at(Some("emil"), "box", Some(2222)))
        );
        assert_eq!(
            ssh(&["-p2222", "-tt", "box"]),
            Some(at(None, "box", Some(2222)))
        );
        assert_eq!(
            ssh(&["-A", "-i", "/home/emil/.ssh/id", "-J", "jump", "pi"]),
            Some(at(None, "pi", None))
        );
        assert_eq!(
            ssh(&["-vl", "emil", "pi"]),
            Some(at(Some("emil"), "pi", None))
        );
        assert_eq!(
            ssh(&["-l", "root", "emil@pi"]),
            Some(at(Some("root"), "pi", None))
        );
        assert_eq!(
            ssh(&["-p", "1111", "ssh://pi:2222"]),
            Some(at(None, "pi", Some(1111)))
        );
        assert_eq!(
            ssh(&["-l", "a", "-l", "b", "-p", "1111", "-p", "3333", "pi"]),
            Some(at(Some("a"), "pi", Some(1111)))
        );
        assert_eq!(
            ssh(&["pi", "-p", "4444", "-l", "zed"]),
            Some(at(Some("zed"), "pi", Some(4444)))
        );
        assert_eq!(ssh(&["pi", "-tA"]), Some(at(None, "pi", None)));
        assert_eq!(
            ssh(&["emil@pi", "-l", "zed", "-oUser=x"]),
            Some(at(Some("emil"), "pi", None))
        );
        assert_eq!(
            ssh(&["ssh://a@pi:2222", "-p", "1111", "-oPort=33"]),
            Some(at(Some("a"), "pi", Some(2222)))
        );
        assert_eq!(
            ssh(&["-o", "SessionType=default", "-oRemoteCommand=none", "pi"]),
            Some(at(None, "pi", None))
        );
        assert_eq!(
            ssh(&["-oUser=ou", "-l", "lu", "-o", "Port 5555", "pi"]),
            Some(at(Some("ou"), "pi", Some(5555)))
        );
        assert_eq!(
            ssh(&["-o", "port = 22", "-oProxyJump=jump", "pi"]),
            Some(at(None, "pi", Some(22)))
        );
        assert_eq!(
            ssh(&["ssh://emil@box.example.com:2222"]),
            Some(at(Some("emil"), "box.example.com", Some(2222)))
        );
        assert_eq!(
            ssh(&["ssh://[fe80::1]:22"]),
            Some(at(None, "fe80::1", Some(22)))
        );
        assert_eq!(ssh(&["--", "pi"]), Some(at(None, "pi", None)));
    }

    #[test]
    fn ssh_that_opens_no_session_here_is_none() {
        assert_eq!(ssh(&["pi", "uptime"]), None);
        assert_eq!(ssh(&["pi", "-v", "uptime"]), None);
        assert_eq!(ssh(&["--", "pi", "-p", "1"]), None);
        assert_eq!(ssh(&["pi", "-N"]), None);
        assert_eq!(ssh(&["-oHostName=10.0.0.5", "pi"]), None);
        assert_eq!(ssh(&["-o", "SessionType=none", "pi"]), None);
        assert_eq!(ssh(&["-o", "RemoteCommand=uptime", "pi"]), None);
        assert_eq!(ssh(&["-oForkAfterAuthentication=yes", "pi"]), None);
        assert_eq!(ssh(&["-F", "/home/emil/work.conf", "pi"]), None);
        assert_eq!(ssh(&["-P", "work", "pi"]), None);
        assert_eq!(ssh(&["-o", "User"]), None);
        assert_eq!(ssh(&["-N", "-L", "8080:localhost:80", "pi"]), None);
        assert_eq!(ssh(&["-fN", "pi"]), None);
        assert_eq!(ssh(&["-W", "host:22", "jump"]), None);
        assert_eq!(ssh(&["-G", "pi"]), None);
        assert_eq!(ssh(&["-V"]), None);
        assert_eq!(ssh(&["-O", "check", "pi"]), None);
        assert_eq!(ssh(&[]), None);
        assert_eq!(ssh(&["-p"]), None);
        assert_eq!(ssh(&["-p", "zero", "pi"]), None);
        assert_eq!(ssh(&["-l", "-oProxyCommand=x", "pi"]), None);
        assert_eq!(ssh(&["--", "-oProxyCommand=x"]), None);
        assert_eq!(ssh(&["@pi"]), None);
        assert_eq!(
            ssh_destination("scp", &["pi".to_owned()]),
            None,
            "only ssh itself"
        );
    }
}
