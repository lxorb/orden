#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Act {
    Done,
    Open,
}

impl Act {
    #[cfg_attr(
        not(windows),
        allow(
            dead_code,
            reason = "a Windows toast's buttons are links; a Mac's are actions"
        )
    )]
    fn word(self) -> &'static str {
        match self {
            Self::Done => "done",
            Self::Open => "open",
        }
    }
}

const HOST: &str = "orden://reminder";
const OLD_HOST: &str = "nib://reminder";

#[cfg_attr(
    not(windows),
    allow(
        dead_code,
        reason = "a Windows toast's buttons are links; a Mac's are actions"
    )
)]
pub fn link(act: Act, id: &str, nonce: &str) -> String {
    format!("{HOST}?act={}&id={id}&n={nonce}", act.word())
}

fn host_end(url: &str) -> Option<usize> {
    [HOST, OLD_HOST]
        .into_iter()
        .find(|host| {
            url.get(..host.len())
                .is_some_and(|start| start.eq_ignore_ascii_case(host))
        })
        .map(str::len)
}

pub fn is_reminder(url: &str) -> bool {
    host_end(url.trim()).is_some()
}

pub fn parsed(url: &str) -> Option<(Act, String, String)> {
    let url = url.trim();
    let query = url.get(host_end(url)?..)?.strip_prefix('?')?;

    let (mut act, mut id, mut nonce) = (None, None, None);
    for pair in query.split('&') {
        let (key, value) = pair.split_once('=')?;
        let (slot, hex) = match key {
            "act" => (&mut act, false),
            "id" => (&mut id, true),
            "n" => (&mut nonce, true),
            _ => continue,
        };
        if slot.is_some() || (hex && !plain(value)) {
            return None;
        }
        *slot = Some(value.to_string());
    }

    let act = match act?.as_str() {
        "done" => Act::Done,
        "open" => Act::Open,
        _ => return None,
    };
    Some((act, id?, nonce?))
}

fn plain(value: &str) -> bool {
    !value.is_empty() && value.len() <= 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_link_reads_back_as_what_it_said() {
        let made = link(Act::Done, "00ff00ff00ff00ff", "abcdef0123456789");
        assert_eq!(
            made,
            "orden://reminder?act=done&id=00ff00ff00ff00ff&n=abcdef0123456789"
        );
        assert_eq!(
            parsed(&made),
            Some((
                Act::Done,
                "00ff00ff00ff00ff".to_string(),
                "abcdef0123456789".to_string()
            ))
        );
        assert_eq!(
            parsed(&link(Act::Open, "aa", "bb")).map(|(act, _, _)| act),
            Some(Act::Open)
        );
    }

    #[test]
    fn a_link_a_notice_was_given_before_the_rename_still_reads() {
        assert_eq!(
            parsed("nib://reminder?act=done&id=aa&n=bb"),
            Some((Act::Done, "aa".to_string(), "bb".to_string()))
        );
        assert!(is_reminder("NIB://Reminder?act=open"));
    }

    #[test]
    fn anything_else_is_no_reminder() {
        assert_eq!(parsed("orden://open?path=Plan.md"), None);
        assert!(!is_reminder("orden://open?path=Plan.md"));
        assert!(is_reminder("ORDEN://Reminder?act=done"));
        assert_eq!(parsed("orden://reminder?act=delete&id=aa&n=bb"), None);
        assert_eq!(parsed("orden://reminder?act=done&id=aa"), None);
        assert_eq!(parsed("orden://reminder?act=done&id=aa&id=bb&n=cc"), None);
        assert_eq!(parsed("orden://reminder?act=done&id=../x&n=cc"), None);
        assert_eq!(parsed("orden://reminders?act=done&id=aa&n=cc"), None);
    }
}
