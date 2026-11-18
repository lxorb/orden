#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Stat {
    pub state: String,
    pub parent: u32,
    pub group: u32,
    pub session: i32,
    pub front: i64,
    pub ticks: u64,
}

impl Stat {
    pub fn gone(&self) -> bool {
        matches!(self.state.as_str(), "Z" | "X")
    }
}

pub fn of(text: &str) -> Option<Stat> {
    let rest = &text[text.rfind(')')? + 1..];
    let fields: Vec<&str> = rest.split_whitespace().collect();
    let user: u64 = fields.get(11)?.parse().ok()?;
    let system: u64 = fields.get(12)?.parse().ok()?;
    Some(Stat {
        state: (*fields.first()?).to_owned(),
        parent: fields.get(1)?.parse().ok()?,
        group: fields.get(2)?.parse().ok()?,
        session: fields.get(3)?.parse().ok()?,
        front: fields.get(5)?.parse().ok()?,
        ticks: user + system,
    })
}

#[cfg(target_os = "linux")]
pub fn read(pid: impl std::fmt::Display) -> Option<Stat> {
    of(&std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?)
}

pub fn running(pid: u32) -> bool {
    if cfg!(windows) {
        let listed = std::process::Command::new("tasklist")
            .args(["/FI", &format!("PID eq {pid}"), "/NH", "/FO", "CSV"])
            .output()
            .map(|out| String::from_utf8_lossy(&out.stdout).into_owned())
            .unwrap_or_default();
        listed.contains(&format!("\"{pid}\""))
    } else {
        let state = std::process::Command::new("ps")
            .args(["-o", "stat=", "-p", &pid.to_string()])
            .output()
            .map(|out| String::from_utf8_lossy(&out.stdout).trim().to_owned())
            .unwrap_or_default();
        !state.is_empty() && !state.starts_with('Z')
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_a_process_past_a_name_with_spaces_and_parentheses() {
        let text = "4242 (my (odd) prog) S 1 4242 77 0 4300 4194560 100 0 0 0 250 50 0 0 20 0";
        let stat = of(text).expect("a stat");
        assert_eq!(
            (
                stat.parent,
                stat.group,
                stat.session,
                stat.front,
                stat.ticks
            ),
            (1, 4242, 77, 4300, 300)
        );
        assert!(!stat.gone());
        assert!(of(text.replacen(") S", ") Z", 1).as_str())
            .expect("a stat")
            .gone());
        assert_eq!(of("garbage"), None);
    }

    #[test]
    fn this_process_runs_and_one_that_ended_does_not() {
        assert!(running(std::process::id()));
        let mut ended = std::process::Command::new(if cfg!(windows) { "cmd" } else { "true" })
            .args(if cfg!(windows) {
                &["/C", "exit"][..]
            } else {
                &[][..]
            })
            .spawn()
            .expect("a process");
        let pid = ended.id();
        ended.wait().expect("it ends");
        assert!(!running(pid));
    }
}
