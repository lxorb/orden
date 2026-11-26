use std::path::{Path, PathBuf};

const FORMER: [&str; 5] = [
    "nib-handler.desktop",
    "nib.desktop",
    "nibeditor.desktop",
    "ch.emilvinu.nib.desktop",
    "nib_nib.desktop",
];
const ASIDE: &str = "before-orden";
fn renamed(text: &str, now: &str) -> Option<String> {
    let mut changed = false;
    let lines: Vec<String> = text
        .split('\n')
        .map(|line| {
            let Some((key, entries)) = line.split_once('=') else {
                return line.to_owned();
            };
            let (entries, end) =
                entries.strip_suffix('\r').map_or((entries, ""), |rest| (rest, "\r"));
            if key.trim_start().starts_with('#') {
                return line.to_owned();
            }
            let mut kept: Vec<&str> = Vec::new();
            let (mut touched, mut named) = (false, false);
            for entry in entries.split(';') {
                let former = FORMER.iter().any(|one| one.eq_ignore_ascii_case(entry.trim()));
                touched |= former;
                let entry = if former { now } else { entry };
                let ours = entry.trim() == now;
                if !(ours && named) {
                    kept.push(entry);
                }
                named |= ours;
            }
            if !touched {
                return line.to_owned();
            }
            changed = true;
            format!("{key}={}{end}", kept.join(";"))
        })
        .collect();
    changed.then(|| lines.join("\n"))
}
fn aside_of(list: &Path) -> PathBuf {
    let mut name = list.file_name().unwrap_or_default().to_os_string();
    name.push(".");
    name.push(ASIDE);
    list.with_file_name(name)
}
pub(crate) fn carried(list: &Path, now: &str) -> Result<bool, String> {
    let Ok(before) = std::fs::read_to_string(list) else {
        return Ok(false);
    };
    let Some(after) = renamed(&before, now) else {
        return Ok(false);
    };
    let aside = aside_of(list);
    if !aside.exists() {
        std::fs::write(&aside, &before)
            .map_err(|error| orden_base::paths::cannot("keep a copy of", list, &error))?;
    }
    let written = orden_base::paths::write_atomically(list, after.as_bytes());
    if written.is_ok() && std::fs::read_to_string(list).is_ok_and(|back| back == after) {
        return Ok(true);
    }
    let restored = orden_base::paths::write_atomically(list, before.as_bytes());
    Err(format!(
        "{} still names the former desktop entry: {}{}",
        list.display(),
        written.err().unwrap_or_else(|| "it did not read back as written".to_owned()),
        restored
            .err()
            .map(|error| format!("; and it was not put back: {error}"))
            .unwrap_or_default()
    ))
}
pub(crate) fn lists(config: Option<PathBuf>, data: Option<PathBuf>) -> Vec<PathBuf> {
    [
        config.map(|dir| dir.join("mimeapps.list")),
        data.map(|dir| dir.join("applications").join("mimeapps.list")),
    ]
    .into_iter()
    .flatten()
    .collect()
}
#[cfg(test)]
mod tests {
    use super::{aside_of, carried, lists, renamed};
    use std::fs;

    const NOW: &str = "orden.desktop";
    const OLD: &str = "[Default Applications]\nx-scheme-handler/http=nib.desktop\nx-scheme-handler/https=nib-handler.desktop;\ntext/html=firefox.desktop;Nib.desktop;orden.desktop;\ntext/markdown=nibbles.desktop\n\n[Added Associations]\napplication/pdf=nibeditor.desktop;evince.desktop;\n";
    const NEW: &str = "[Default Applications]\nx-scheme-handler/http=orden.desktop\nx-scheme-handler/https=orden.desktop;\ntext/html=firefox.desktop;orden.desktop;\ntext/markdown=nibbles.desktop\n\n[Added Associations]\napplication/pdf=orden.desktop;evince.desktop;\n";
    #[test]
    fn every_former_entry_becomes_the_new_one_and_nothing_else_changes() {
        assert_eq!(renamed(OLD, NOW).as_deref(), Some(NEW));
        assert_eq!(renamed(NEW, NOW), None);
        assert_eq!(renamed("", NOW), None);
        assert_eq!(
            renamed("a=nib.desktop\r\nb=x.desktop\r\n", NOW).as_deref(),
            Some("a=orden.desktop\r\nb=x.desktop\r\n")
        );
        assert_eq!(renamed("# a=nib.desktop\n", NOW), None);
    }
    #[test]
    fn the_list_is_rewritten_once_with_the_original_kept_beside_it() {
        let dir = tempfile::tempdir().expect("a folder");
        let list = dir.path().join("mimeapps.list");
        fs::write(&list, OLD).expect("the list");
        assert_eq!(carried(&list, NOW), Ok(true));
        assert_eq!(fs::read_to_string(&list).expect("the list"), NEW);
        assert_eq!(fs::read_to_string(aside_of(&list)).expect("the copy"), OLD);
        assert_eq!(carried(&list, NOW), Ok(false));
        assert_eq!(fs::read_to_string(&list).expect("the list"), NEW);
    }
    #[test]
    fn a_list_that_names_nothing_former_or_is_not_there_is_left_alone() {
        let dir = tempfile::tempdir().expect("a folder");
        let list = dir.path().join("mimeapps.list");
        assert_eq!(carried(&list, NOW), Ok(false));
        assert!(!list.exists());
        fs::write(&list, NEW).expect("the list");
        assert_eq!(carried(&list, NOW), Ok(false));
        assert!(!aside_of(&list).exists());
    }
    #[test]
    fn an_earlier_copy_beside_the_list_is_not_written_over() {
        let dir = tempfile::tempdir().expect("a folder");
        let list = dir.path().join("mimeapps.list");
        fs::write(&list, OLD).expect("the list");
        fs::write(aside_of(&list), "an earlier copy").expect("an earlier copy");
        assert_eq!(carried(&list, NOW), Ok(true));
        assert_eq!(fs::read_to_string(aside_of(&list)).expect("the copy"), "an earlier copy");
    }
    #[test]
    fn both_places_a_desktop_keeps_its_list_are_looked_in() {
        let found = lists(Some("/home/a/.config".into()), Some("/home/a/.local/share".into()));
        assert_eq!(
            found,
            [
                std::path::PathBuf::from("/home/a/.config/mimeapps.list"),
                std::path::PathBuf::from("/home/a/.local/share/applications/mimeapps.list"),
            ]
        );
        assert!(lists(None, None).is_empty());
    }
}
