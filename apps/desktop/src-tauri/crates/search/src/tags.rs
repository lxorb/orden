use crate::code_blocks::{CodeBlocks, CodeLine};
use crate::front_matter;
use icu_properties::props::{ExtendedPictographic, GeneralCategory, GeneralCategoryGroup};
use icu_properties::{CodePointMapData, CodePointSetData};

#[must_use]
pub fn tags_in(body: &str) -> Vec<String> {
    let mut found = Vec::new();
    let (front, close) = front_matter::block(body).map_or((0, 0), |one| (one.end, one.close));
    read_front(body, front, close, &mut found);
    read_inline(body, front, &mut found);
    found
}
fn read_front(body: &str, front: usize, close: usize, found: &mut Vec<String>) {
    if front == 0 {
        return;
    }
    let mut at = body.find('\n').map_or(front, |one| one + 1);
    while at < front {
        let end = body[at..].find('\n').map_or(front, |one| at + one).min(front);
        let line = &body[at..end];
        if let Some(rest) = key_value(line) {
            let value = at + line.len() - rest.len();
            if let Some(closes) = front_matter::value_closes_at(body, value, close) {
                for one in body[value..closes].lines() {
                    read_values(without_comment(one), found);
                }
                at = closes + 1;
                continue;
            }
            read_values(without_comment(rest), found);
            at = read_items(body, end + 1, front, found);
            continue;
        }
        if end >= front {
            break;
        }
        at = end + 1;
    }
}
fn without_comment(line: &str) -> &str {
    let opens = line
        .match_indices("# ")
        .map(|(at, _)| at)
        .find(|&at| line[..at].chars().next_back().is_none_or(char::is_whitespace));
    opens.map_or(line, |at| &line[..at])
}
fn key_value(line: &str) -> Option<&str> {
    let lowered = line.to_ascii_lowercase();
    for key in ["tags:", "tag:"] {
        if lowered.starts_with(key) {
            return Some(&line[key.len()..]);
        }
    }
    None
}
fn read_items(body: &str, from: usize, front: usize, found: &mut Vec<String>) -> usize {
    let mut at = from;
    while at < front {
        let end = body[at..].find('\n').map_or(front, |one| at + one).min(front);
        let line = &body[at..end];
        if line.trim().is_empty() || line.trim_start().starts_with('#') {
            if end >= front {
                return front;
            }
            at = end + 1;
            continue;
        }
        let Some(item) = line.trim_start().strip_prefix('-') else {
            return at;
        };
        read_values(without_comment(item), found);
        if end >= front {
            return front;
        }
        at = end + 1;
    }
    at
}
fn read_values(text: &str, found: &mut Vec<String>) {
    for piece in text.split(|one: char| one.is_whitespace() || ",[]'\"".contains(one)) {
        let name = piece.strip_prefix('#').unwrap_or(piece);
        if named(name) {
            found.push(format!("#{name}"));
        }
    }
}
fn named(name: &str) -> bool {
    let mut letters = name.chars();
    let Some(first) = letters.next() else {
        return false;
    };
    name_start(first) && letters.all(name_char) && !name.chars().all(char::is_numeric)
}
fn name_start(one: char) -> bool {
    let category = CodePointMapData::<GeneralCategory>::new().get(one);
    GeneralCategoryGroup::Letter.contains(category)
        || GeneralCategoryGroup::Mark.contains(category)
        || GeneralCategoryGroup::Number.contains(category)
        || CodePointSetData::new::<ExtendedPictographic>().contains(one)
}
fn name_char(one: char) -> bool {
    name_start(one) || "-_/".contains(one)
}
fn read_inline(body: &str, front: usize, found: &mut Vec<String>) {
    for block in blocks(&body[front..]) {
        if !block.contains('#') {
            continue;
        }
        let code = code_spans(block);
        let mut at = 0;
        while let Some(hash) = block[at..].find('#') {
            let start = at + hash;
            let before = &block[..start];
            let opens =
                opens_tag(before) && !code.iter().any(|&(from, to)| (from..to).contains(&start));
            let rest = &block[start + 1..];
            let name = closed_by(
                rest.find(|one: char| !name_char(one)).map_or(rest, |end| &rest[..end]),
                before.len() - before.trim_end_matches('_').len(),
            );
            if opens && named(name) {
                found.push(block[start..start + 1 + name.len()].to_string());
            }
            at = start + 1 + name.len();
        }
    }
}
const MARKS: &[char] = &['*', '_', '~', '='];
fn opens_tag(before: &str) -> bool {
    let bare = before.trim_end_matches(MARKS);
    let Some(one) = bare.chars().next_back() else {
        return true;
    };
    let ahead = &bare[..bare.len() - one.len_utf8()];
    match one {
        '(' => !ahead.ends_with(']'),
        '|' => {
            let line = ahead.rfind('\n').map_or(ahead, |at| &ahead[at + 1..]);
            line.trim_start().is_empty() || line.trim_start().starts_with('|')
        }
        _ => one.is_whitespace(),
    }
}
fn closed_by(name: &str, underscores: usize) -> &str {
    if underscores == 0 || name.len() < underscores {
        return name;
    }
    let at = name.len() - underscores;
    if !name.as_bytes()[at..].iter().all(|&one| one == b'_') {
        return name;
    }
    let cut = &name[..at];
    if named(cut) {
        cut
    } else {
        ""
    }
}
fn blocks(words: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let mut code = CodeBlocks::default();
    let mut start: Option<usize> = None;
    let mut at = 0;
    for whole in words.split_inclusive('\n') {
        let line = whole.trim_end_matches(['\n', '\r']);
        let words_line = code.line(line) == CodeLine::Words;
        let blank = line.trim_start().is_empty();
        if !words_line || blank || opens_block(line) {
            if let Some(from) = start.take() {
                out.push(words[from..at].trim_end_matches(['\n', '\r']));
            }
        }
        if words_line && !blank {
            let from = *start.get_or_insert(at);
            if heading(line) {
                out.push(&words[from..at + line.len()]);
                start = None;
            }
        }
        at += whole.len();
    }
    if let Some(from) = start {
        out.push(words[from..].trim_end_matches(['\n', '\r']));
    }
    out
}
fn opens_block(line: &str) -> bool {
    let rest = line.trim_start_matches(' ');
    if line.len() - rest.len() > 3 {
        return false;
    }
    let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
    let marker = if rest.starts_with(['-', '*', '+']) {
        Some(&rest[1..])
    } else if (1..=9).contains(&digits) && rest[digits..].starts_with(['.', ')']) {
        Some(&rest[digits + 1..])
    } else {
        None
    };
    marker.is_some_and(ends_marker) || rest.starts_with('>') || heading(line)
}
fn heading(line: &str) -> bool {
    let rest = line.trim_start_matches(' ');
    let hashes = rest.bytes().take_while(|&one| one == b'#').count();
    line.len() - rest.len() <= 3 && (1..=6).contains(&hashes) && ends_marker(&rest[hashes..])
}
fn ends_marker(after: &str) -> bool {
    after.is_empty() || after.starts_with([' ', '\t'])
}
fn code_spans(line: &str) -> Vec<(usize, usize)> {
    let bytes = line.as_bytes();
    let mut spans = Vec::new();
    let mut at = 0;
    while at < bytes.len() {
        match bytes[at] {
            b'\\' if bytes.get(at + 1).is_some_and(u8::is_ascii_punctuation) => at += 2,
            b'`' => {
                let run = backticks_at(bytes, at);
                if let Some(close) = closing_run(bytes, at + run, run) {
                    spans.push((at, close + run));
                    at = close + run;
                } else {
                    at += run;
                }
            }
            _ => at += 1,
        }
    }
    spans
}
fn backticks_at(bytes: &[u8], at: usize) -> usize {
    bytes[at..].iter().take_while(|&&one| one == b'`').count()
}
fn closing_run(bytes: &[u8], from: usize, length: usize) -> Option<usize> {
    let mut at = from;
    while at < bytes.len() {
        if bytes[at] == b'`' {
            let run = backticks_at(bytes, at);
            if run == length {
                return Some(at);
            }
            at += run;
        } else {
            at += 1;
        }
    }
    None
}
#[cfg(test)]
mod tests {
    use super::tags_in;

    #[test]
    fn a_tag_starts_a_word_and_holds_what_a_name_may() {
        assert_eq!(tags_in("# Heading\n#tag here"), vec!["#tag"]);
        assert_eq!(tags_in("## Also a heading"), Vec::<String>::new());
        assert_eq!(tags_in("a#b"), Vec::<String>::new());
        assert_eq!(tags_in("(#nested)"), vec!["#nested"]);
        assert_eq!(tags_in("issue #42"), Vec::<String>::new());
        assert_eq!(tags_in("#work/2026 #a-b #c_d"), vec!["#work/2026", "#a-b", "#c_d"]);
        assert_eq!(
            tags_in("#हिन्दी #cafe\u{301} #tag👍 #2024-review #2024"),
            vec!["#हिन्दी", "#cafe\u{301}", "#tag👍", "#2024-review"]
        );
        assert_eq!(
            tags_in("#work/orden/canvas/deep/deeper"),
            vec!["#work/orden/canvas/deep/deeper"]
        );
        assert_eq!(tags_in("#a #a #b").len(), 3);
    }
    #[test]
    fn code_inline_or_fenced_holds_no_tag() {
        assert_eq!(tags_in("```\n#notatag\n```\n#real"), vec!["#real"]);
        assert_eq!(
            tags_in("run `a #no` and #yes, `#not` ``x `#b` y`` #also"),
            vec!["#yes", "#also"]
        );
        assert_eq!(tags_in("`a\nb` #x `c`"), vec!["#x"]);
        assert_eq!(tags_in("`a\n#b\nc`"), Vec::<String>::new());
        assert_eq!(tags_in("a `b\n\nc` #t"), vec!["#t"]);
        assert_eq!(tags_in("- a `x\n- b` #t"), vec!["#t"]);
        assert_eq!(tags_in("# A `x\nb` #t"), vec!["#t"]);
        assert_eq!(tags_in("\\` #yes ` #too"), vec!["#yes", "#too"]);
        assert_eq!(
            tags_in("> [!example] Button\n> ```css\n> .button { color: #fff; }\n> ```\n> #after\n"),
            vec!["#after"]
        );
        assert_eq!(tags_in("> ```\n> #no\n\n#yes"), vec!["#yes"]);
        assert_eq!(tags_in("- item\n\n  ```\n  #no\n  ```\n#yes"), vec!["#yes"]);
        assert_eq!(tags_in("Notes\n\n    #include <stdio.h>\n\n#yes"), vec!["#yes"]);
        assert_eq!(tags_in("- item\n\n      #define X\n#yes"), vec!["#yes"]);
        assert_eq!(tags_in("> words\n>\n>     #no"), Vec::<String>::new());
        assert_eq!(tags_in("words\n    #yes"), vec!["#yes"]);
        assert_eq!(tags_in("````md\n```\n#todo\n```\n````\n#yes"), vec!["#yes"]);
        assert_eq!(tags_in("```\n~~~\n#no\n```\n#yes"), vec!["#yes"]);
        assert_eq!(tags_in("```\n``` ts\n#no\n```\n#yes"), vec!["#yes"]);
        assert_eq!(tags_in("   ```\n#no\n```\n#yes"), vec!["#yes"]);
        assert_eq!(tags_in("words\n    ```\n#yes"), vec!["#yes"]);
        assert_eq!(tags_in("```a`a\n#yes"), vec!["#yes"]);
        assert_eq!(tags_in("> ```\n> #no\n#yes"), vec!["#yes"]);
    }
    #[test]
    fn the_front_matter_lists_tags_on_its_key_in_any_shape() {
        assert_eq!(
            tags_in("---\ntags: work/orden, other\n---\n\nwords\n"),
            vec!["#work/orden", "#other"]
        );
        assert_eq!(
            tags_in("---\ntags: [work/orden, other]\n---\n\nwords\n"),
            vec!["#work/orden", "#other"]
        );
        assert_eq!(
            tags_in("---\ntags:\n  - work/orden\n  - other\n---\n\nwords\n"),
            vec!["#work/orden", "#other"]
        );
        assert_eq!(tags_in("---\ntags:\n  - a\n\n  - b\n---\n"), vec!["#a", "#b"]);
        assert_eq!(tags_in("---\ntags:\n  - a\n  # c\n  - b\nother: x\n---\n"), vec!["#a", "#b"]);
        assert_eq!(tags_in("---\r\ntags:\r\n  - a\r\n\r\n  - b\r\n---\r\n"), vec!["#a", "#b"]);
        let note = "---\ntags: [\n  work, # mine\n  # a comment\n  \"b\",\n]\nz: 1\n---\nrest\n";
        assert_eq!(tags_in(note), vec!["#work", "#b"]);
        assert_eq!(tags_in("---\ntags: [a\nz: b\n---\n"), vec!["#a"]);
        assert_eq!(tags_in("---\ntags: [\n  a# b,\n]\n---\n"), vec!["#b"]);
        assert_eq!(tags_in("---\ntags: [a, b]\nz: 1\n---\n"), vec!["#a", "#b"]);
        assert_eq!(tags_in("---\ntags: [#work/orden]\n---\n\nwords\n"), vec!["#work/orden"]);
        assert_eq!(tags_in("---\ntag: work/orden\n---\n\nwords\n"), vec!["#work/orden"]);
        assert_eq!(
            tags_in("---\nstatus: done\nproject: Orden\n---\n\nwords\n"),
            Vec::<String>::new()
        );
        assert_eq!(tags_in("---\nstatus: done # not a tag\n---\n\nwords\n"), Vec::<String>::new());
        assert_eq!(tags_in("---\ntags:\n  - project # active\n---\n\nwords\n"), vec!["#project"]);
        assert_eq!(tags_in("---\ntags: [a] # old\n---\n\nwords\n"), vec!["#a"]);
        assert_eq!(tags_in("---\ntags: a # old\n---\n"), vec!["#a"]);
        assert_eq!(tags_in("---\ntags: [work]\n---\n\nwords #orden\n"), vec!["#work", "#orden"]);
        assert_eq!(tags_in("---\r\ntags: [work]\r\n---\r\nx\r\n"), vec!["#work"]);
        assert_eq!(
            tags_in("---\r\ntags:\r\n  - work\r\n---\r\nx #orden\r\n"),
            vec!["#work", "#orden"]
        );
    }
    #[test]
    fn a_tag_in_emphasis_counts_and_a_link_to_a_heading_does_not() {
        assert_eq!(
            tags_in("## Setup\n\nSee [setup](#setup) and ![x](#y). Real #setup.\n"),
            vec!["#setup"]
        );
        assert_eq!(tags_in("**#a** *#b* ~~#d~~ ==#e== call\n"), vec!["#a", "#b", "#d", "#e"]);
        assert_eq!(tags_in("| x | y |\n| - | - |\n|#f|#g|\n"), vec!["#f", "#g"]);
    }
    #[test]
    fn reads_the_parity_rows() {
        let rows: [(&str, &[&str]); 11] = [
            ("see https://x.test/?q=#x", &[]),
            ("[link](https://x.test/?q=#x)", &[]),
            ("<https://x.test/#a> <https://x.test/?a=#b>", &[]),
            ("plain a|#b text", &[]),
            ("code-ish a=#b prose and color=#ff8800", &[]),
            ("snake_#x 3*#y a~#z", &[]),
            ("[[Note|#alias]]", &[]),
            ("[s](#setup) ![i](#img) and [s](#open", &[]),
            ("**#a** ~~#d~~ ==#e== x **#f**", &["#a", "#d", "#e", "#f"]),
            ("_#u_ and __#todo__ and _#snake_case_", &["#u", "#todo", "#snake_case"]),
            ("| x | y |\n| - | - |\n|#f|#g|", &["#f", "#g"]),
        ];
        for (source, tags) in rows {
            assert_eq!(tags_in(&format!("{source}\n")), tags, "{source}");
        }
    }
}
