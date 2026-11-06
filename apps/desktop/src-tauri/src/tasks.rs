pub struct TaskItem {
    pub done: bool,
    pub mark: char,
    pub indent: usize,
    pub marker: usize,
}

const DIGITS: usize = 9;

#[must_use]
pub fn task_at(line: &str) -> Option<TaskItem> {
    let bytes = line.as_bytes();
    let mut at = 0;

    while matches!(bytes.get(at), Some(b' ' | b'\t')) {
        at += 1;
    }
    let indent = at;

    match bytes.get(at)? {
        b'-' | b'*' | b'+' => at += 1,
        b'0'..=b'9' => {
            let from = at;
            while matches!(bytes.get(at), Some(b'0'..=b'9')) && at - from < DIGITS {
                at += 1;
            }
            if !matches!(bytes.get(at), Some(b'.' | b')')) {
                return None;
            }
            at += 1;
        }
        _ => return None,
    }

    let gap = at;
    while matches!(bytes.get(at), Some(b' ' | b'\t')) {
        at += 1;
    }
    if at == gap {
        return None;
    }

    if bytes.get(at) != Some(&b'[') {
        return None;
    }

    let mark = line.get(at + 1..)?.chars().next()?;
    if mark == ']' {
        return None;
    }

    let close = at + 1 + mark.len_utf8();
    if bytes.get(close) != Some(&b']') {
        return None;
    }

    let mut end = close + 1;
    let after = end;
    while matches!(bytes.get(end), Some(b' ' | b'\t')) {
        end += 1;
    }
    if end == after && bytes.get(end).is_some() {
        return None;
    }

    Some(TaskItem {
        done: mark != ' ',
        mark,
        indent,
        marker: end,
    })
}

#[cfg(test)]
mod tests {
    use super::task_at;

    fn words(line: &str) -> Option<&str> {
        task_at(line).map(|task| &line[task.marker..])
    }

    #[test]
    fn a_task_is_a_marker_a_box_and_what_comes_after_it() {
        let task = task_at("- [ ] buy milk").expect("a task");

        assert!(!task.done);
        assert_eq!(task.marker, 6);
        assert_eq!(words("- [ ] buy milk"), Some("buy milk"));
    }

    #[test]
    fn a_box_holding_anything_but_a_space_is_done() {
        for line in ["- [x] a", "- [X] a", "- [-] a", "- [/] a"] {
            assert!(task_at(line).expect(line).done, "{line}");
        }
        assert!(!task_at("- [ ] a").expect("a task").done);
    }

    #[test]
    fn every_marker_a_list_is_written_with() {
        for line in ["- [ ] a", "* [ ] a", "+ [ ] a", "1. [ ] a", "2) [ ] a"] {
            assert!(task_at(line).is_some(), "{line}");
        }
    }

    #[test]
    fn indentation_is_kept_however_deep() {
        let task = task_at("    - [x] nested").expect("a task");

        assert_eq!(task.indent, 4);
        assert_eq!(task.marker, 10);
        assert_eq!(words("    - [x] nested"), Some("nested"));
    }

    #[test]
    fn the_box_says_what_is_in_it_as_written() {
        for (line, mark) in [
            ("- [ ] a", ' '),
            ("- [/] a", '/'),
            ("- [-] a", '-'),
            ("- [é] a", 'é'),
        ] {
            assert_eq!(task_at(line).expect(line).mark, mark, "{line}");
        }
        assert_eq!(task_at("\t- [x] a").expect("a task").indent, 1);
    }

    #[test]
    fn a_box_with_nothing_written_in_it_yet_is_a_task() {
        assert_eq!(words("- [ ]"), Some(""));
    }

    #[test]
    fn and_a_list_a_sentence_or_an_empty_box_is_not_one() {
        for line in [
            "- buy milk",
            "a [x] in a sentence",
            "- [] buy milk",
            "- [xx] buy milk",
            "-[ ] buy milk",
            "",
        ] {
            assert!(task_at(line).is_none(), "{line}");
        }
    }
}
