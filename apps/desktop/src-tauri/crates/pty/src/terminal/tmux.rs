use std::path::PathBuf;

use serde::Serialize;

use super::shells::Launch;

pub const PREFIX: &str = "tmux:";
const FORMAT: &str =
    "#{session_name}\t#{session_attached}\t#{session_activity}\t#{pane_current_command}\t#{pane_current_path}";
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct Found {
    pub name: String,
    pub attached: bool,
    pub last: u64,
    pub program: Option<String>,
    pub folder: Option<String>,
}
pub fn name_of(shell: &str) -> Option<&str> {
    shell.strip_prefix(PREFIX).filter(|one| fits(one))
}
fn fits(name: &str) -> bool {
    !name.is_empty() && name.chars().count() <= 200 && !name.chars().any(char::is_control)
}
fn program() -> Option<PathBuf> {
    orden_base::program::which("tmux")
}
pub fn parsed(listed: &str) -> Vec<Found> {
    listed
        .lines()
        .filter_map(|line| {
            let [name, attached, last, program, folder] =
                <[&str; 5]>::try_from(line.split('\t').collect::<Vec<_>>()).ok()?;
            let said = |one: &str| (!one.is_empty()).then(|| one.to_owned());
            fits(name).then(|| Found {
                name: name.to_owned(),
                attached: attached.parse::<u32>().is_ok_and(|count| count > 0),
                last: last
                    .parse::<u64>()
                    .map_or(0, |seconds| seconds.saturating_mul(1000)),
                program: said(program),
                folder: said(folder),
            })
        })
        .collect()
}
pub fn listed() -> Vec<Found> {
    let Some(tmux) = program() else {
        return Vec::new();
    };
    std::process::Command::new(tmux)
        .args(["list-sessions", "-F", FORMAT])
        .stdin(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .output()
        .ok()
        .filter(|done| done.status.success())
        .map(|done| parsed(&String::from_utf8_lossy(&done.stdout)))
        .unwrap_or_default()
}
pub fn launch(name: &str, home: Option<PathBuf>) -> Result<Launch, String> {
    let program = program().ok_or_else(|| "there is no tmux here".to_owned())?;
    Ok(Launch {
        program,
        args: vec![
            "attach-session".to_owned(),
            "-t".to_owned(),
            format!("={name}"),
        ],
        folder: home,
        env: vec![
            ("TERM".to_owned(), "xterm-256color".to_owned()),
            ("COLORTERM".to_owned(), "truecolor".to_owned()),
            ("TMUX".to_owned(), String::new()),
        ],
    })
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_session_is_read_off_its_line() {
        let found =
            parsed("work\t1\t1700000000\tvim\t/home/emil/notes\nbuild\t0\t1700000100\t\t\n");
        assert_eq!(
            found,
            vec![
                Found {
                    name: "work".to_owned(),
                    attached: true,
                    last: 1_700_000_000_000,
                    program: Some("vim".to_owned()),
                    folder: Some("/home/emil/notes".to_owned()),
                },
                Found {
                    name: "build".to_owned(),
                    attached: false,
                    last: 1_700_000_100_000,
                    program: None,
                    folder: None,
                },
            ]
        );
        assert!(parsed("odd line\n").is_empty());
    }
    #[test]
    fn a_session_is_named_in_the_shell_id_and_attached_exactly() {
        assert_eq!(name_of("tmux:work"), Some("work"));
        assert_eq!(name_of("tmux:"), None);
        assert_eq!(name_of("tmux:a\nb"), None);
        assert_eq!(name_of("pwsh"), None);
        if let Ok(launch) = launch("work", None) {
            assert_eq!(launch.args, ["attach-session", "-t", "=work"]);
        }
    }
    #[cfg(unix)]
    #[test]
    fn a_tmux_session_of_this_machine_is_listed_and_adopted() {
        use super::super::hold;
        use super::super::session::{Fresh, Out, Place, Session};

        let Some(tmux) = program() else {
            return;
        };
        let dir = tempfile::tempdir().unwrap();
        let sockets = dir.path().join("tmux");
        std::fs::create_dir_all(&sockets).unwrap();
        let tmux_here = |args: &[&str]| {
            std::process::Command::new(&tmux)
                .env("TMUX_TMPDIR", &sockets)
                .env_remove("TMUX")
                .args(args)
                .output()
                .expect("tmux")
        };
        let made = tmux_here(&["new-session", "-d", "-s", "mine", "sh"]);
        assert!(made.status.success());
        let listed = tmux_here(&["list-sessions", "-F", FORMAT]);
        let found = parsed(&String::from_utf8_lossy(&listed.stdout));
        assert_eq!(
            found
                .iter()
                .map(|one| one.name.as_str())
                .collect::<Vec<_>>(),
            ["mine"]
        );
        assert!(!found[0].attached);
        tmux_here(&[
            "send-keys",
            "-t",
            "=mine:",
            "echo orden-\"\"adopted",
            "Enter",
        ]);
        let place = Place {
            folder: dir.path().join("held"),
            starter: hold::tests::starter(),
        };
        let (session, started) = Session::open(&place, "adopt", 80, 24, || {
            let mut launch = launch("mine", None)?;
            launch.env.push((
                "TMUX_TMPDIR".to_owned(),
                sockets.to_string_lossy().into_owned(),
            ));
            Ok(Fresh {
                launch,
                farewell: Vec::new(),
                label: hold::Label::default(),
            })
        })
        .expect("adopted");
        let (tell, heard) = std::sync::mpsc::channel();
        let tell = std::sync::Mutex::new(tell);
        started.run(
            Box::new(move |out| {
                let _ = tell.lock().expect("the channel").send(out);
            }),
            |_| {},
        );
        let until = std::time::Instant::now() + std::time::Duration::from_secs(20);
        let mut seen = Vec::new();
        while let Ok(out) =
            heard.recv_timeout(until.saturating_duration_since(std::time::Instant::now()))
        {
            if let Out::Bytes(more) = out {
                seen.extend(more);
                if String::from_utf8_lossy(&seen).contains("orden-adopted") {
                    break;
                }
            }
        }
        assert!(String::from_utf8_lossy(&seen).contains("orden-adopted"));
        session.end();
        std::thread::sleep(std::time::Duration::from_millis(500));
        let still = tmux_here(&["has-session", "-t", "=mine"]);
        assert!(
            still.status.success(),
            "closing the tab ended the session it adopted"
        );
        tmux_here(&["kill-server"]);
    }
}
