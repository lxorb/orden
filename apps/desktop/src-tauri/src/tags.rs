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
        let end = body[at..]
            .find('\n')
            .map_or(front, |one| at + one)
            .min(front);
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
            read_values(rest, found);
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
    let opens = line.match_indices("# ").map(|(at, _)| at).find(|&at| {
        line[..at]
            .chars()
            .next_back()
            .is_none_or(char::is_whitespace)
    });
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
        let end = body[at..]
            .find('\n')
            .map_or(front, |one| at + one)
            .min(front);
        let line = &body[at..end];

        let Some(item) = line.trim_start().strip_prefix('-') else {
            return at;
        };

        read_values(item, found);
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
                rest.find(|one: char| !name_char(one))
                    .map_or(rest, |end| &rest[..end]),
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
    fn finds_tags_but_not_headings() {
        assert_eq!(tags_in("# Heading\n#tag here"), vec!["#tag"]);
        assert_eq!(tags_in("## Also a heading"), Vec::<String>::new());
    }

    #[test]
    fn a_tag_has_to_start_a_word() {
        assert_eq!(tags_in("a#b"), Vec::<String>::new());
        assert_eq!(tags_in("(#nested)"), vec!["#nested"]);
        assert_eq!(tags_in("issue #42"), Vec::<String>::new());
    }

    #[test]
    fn keeps_the_characters_a_tag_may_contain() {
        assert_eq!(
            tags_in("#work/2026 #a-b #c_d"),
            vec!["#work/2026", "#a-b", "#c_d"]
        );
    }

    #[test]
    fn a_name_holds_marks_and_emoji_and_is_not_all_digits() {
        assert_eq!(
            tags_in("#हिन्दी #cafe\u{301} #tag👍 #2024-review #2024"),
            vec!["#हिन्दी", "#cafe\u{301}", "#tag👍", "#2024-review"]
        );
    }

    #[test]
    fn nests_as_deep_as_somebody_writes_it() {
        assert_eq!(
            tags_in("#work/orden/canvas/deep/deeper"),
            vec!["#work/orden/canvas/deep/deeper"]
        );
    }

    #[test]
    fn ignores_anything_inside_a_fence() {
        assert_eq!(tags_in("```\n#notatag\n```\n#real"), vec!["#real"]);
    }

    #[test]
    fn ignores_anything_inside_inline_code() {
        assert_eq!(
            tags_in("run `a #no` and #yes, `#not` ``x `#b` y`` #also"),
            vec!["#yes", "#also"]
        );
    }

    #[test]
    fn inline_code_runs_on_across_the_lines_of_a_paragraph() {
        assert_eq!(tags_in("`a\nb` #x `c`"), vec!["#x"]);
        assert_eq!(tags_in("`a\n#b\nc`"), Vec::<String>::new());
    }

    #[test]
    fn but_not_past_the_end_of_a_block() {
        assert_eq!(tags_in("a `b\n\nc` #t"), vec!["#t"]);
        assert_eq!(tags_in("- a `x\n- b` #t"), vec!["#t"]);
        assert_eq!(tags_in("# A `x\nb` #t"), vec!["#t"]);
    }

    #[test]
    fn reads_on_past_a_backtick_that_opens_no_code() {
        assert_eq!(tags_in("\\` #yes ` #too"), vec!["#yes", "#too"]);
    }

    #[test]
    fn ignores_a_fence_inside_a_quote_or_a_callout() {
        assert_eq!(
            tags_in("> [!example] Button\n> ```css\n> .button { color: #fff; }\n> ```\n> #after\n"),
            vec!["#after"]
        );
        assert_eq!(tags_in("> ```\n> #no\n\n#yes"), vec!["#yes"]);
        assert_eq!(tags_in("- item\n\n  ```\n  #no\n  ```\n#yes"), vec!["#yes"]);
    }

    #[test]
    fn ignores_indented_code() {
        assert_eq!(
            tags_in("Notes\n\n    #include <stdio.h>\n\n#yes"),
            vec!["#yes"]
        );
        assert_eq!(tags_in("- item\n\n      #define X\n#yes"), vec!["#yes"]);
        assert_eq!(tags_in("> words\n>\n>     #no"), Vec::<String>::new());
    }

    #[test]
    fn but_reads_an_indented_line_that_carries_a_paragraph_on() {
        assert_eq!(tags_in("words\n    #yes"), vec!["#yes"]);
    }

    #[test]
    fn closes_a_fence_only_on_the_same_mark_at_least_as_long() {
        assert_eq!(tags_in("````md\n```\n#todo\n```\n````\n#yes"), vec!["#yes"]);
        assert_eq!(tags_in("```\n~~~\n#no\n```\n#yes"), vec!["#yes"]);
        assert_eq!(tags_in("```\n``` ts\n#no\n```\n#yes"), vec!["#yes"]);
    }

    #[test]
    fn opens_a_fence_at_three_spaces_of_indent_but_not_four() {
        assert_eq!(tags_in("   ```\n#no\n```\n#yes"), vec!["#yes"]);
        assert_eq!(tags_in("words\n    ```\n#yes"), vec!["#yes"]);
    }

    #[test]
    fn opens_no_fence_on_backticks_with_a_backtick_after_them() {
        assert_eq!(tags_in("```a`a\n#yes"), vec!["#yes"]);
    }

    #[test]
    fn ends_a_quoted_fence_with_the_quote() {
        assert_eq!(tags_in("> ```\n> #no\n#yes"), vec!["#yes"]);
    }

    #[test]
    fn counts_a_tag_once_per_use() {
        assert_eq!(tags_in("#a #a #b").len(), 3);
    }

    #[test]
    fn reads_a_list_on_the_key() {
        assert_eq!(
            tags_in("---\ntags: work/orden, other\n---\n\nwords\n"),
            vec!["#work/orden", "#other"]
        );
    }

    #[test]
    fn reads_a_list_in_brackets() {
        assert_eq!(
            tags_in("---\ntags: [work/orden, other]\n---\n\nwords\n"),
            vec!["#work/orden", "#other"]
        );
    }

    #[test]
    fn reads_items_under_the_key() {
        assert_eq!(
            tags_in("---\ntags:\n  - work/orden\n  - other\n---\n\nwords\n"),
            vec!["#work/orden", "#other"]
        );
    }

    #[test]
    fn reads_a_flow_list_across_lines_as_the_list_it_is() {
        let note = "---\ntags: [\n  work, # mine\n  # a comment\n  \"b\",\n]\nz: 1\n---\nrest\n";
        assert_eq!(tags_in(note), vec!["#work", "#b"]);
        assert_eq!(tags_in("---\ntags: [a\nz: b\n---\n"), vec!["#a"]);
        assert_eq!(tags_in("---\ntags: [\n  a# b,\n]\n---\n"), vec!["#b"]);
        assert_eq!(tags_in("---\ntags: [a, b]\nz: 1\n---\n"), vec!["#a", "#b"]);
    }

    #[test]
    fn takes_the_hash_as_optional_in_the_front_matter() {
        assert_eq!(
            tags_in("---\ntags: [#work/orden]\n---\n\nwords\n"),
            vec!["#work/orden"]
        );
    }

    #[test]
    fn takes_either_spelling_of_the_key() {
        assert_eq!(
            tags_in("---\ntag: work/orden\n---\n\nwords\n"),
            vec!["#work/orden"]
        );
    }

    #[test]
    fn reads_nothing_under_another_key() {
        assert_eq!(
            tags_in("---\nstatus: done\nproject: Orden\n---\n\nwords\n"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn leaves_a_yaml_comment_alone() {
        assert_eq!(
            tags_in("---\nstatus: done # not a tag\n---\n\nwords\n"),
            Vec::<String>::new()
        );
    }

    #[test]
    fn counts_both_halves_of_a_note() {
        assert_eq!(
            tags_in("---\ntags: [work]\n---\n\nwords #orden\n"),
            vec!["#work", "#orden"]
        );
    }

    #[test]
    fn reads_front_matter_tags_in_a_crlf_note() {
        assert_eq!(
            tags_in("---\r\ntags: [work]\r\n---\r\nx\r\n"),
            vec!["#work"]
        );
        assert_eq!(
            tags_in("---\r\ntags:\r\n  - work\r\n---\r\nx #orden\r\n"),
            vec!["#work", "#orden"]
        );
    }

    #[test]
    fn a_link_to_a_heading_is_no_tag() {
        assert_eq!(
            tags_in("## Setup\n\nSee [setup](#setup) and ![x](#y). Real #setup.\n"),
            vec!["#setup"]
        );
    }

    #[test]
    fn reads_a_tag_inside_emphasis_strike_highlight_or_a_cell() {
        assert_eq!(
            tags_in("**#a** *#b* ~~#d~~ ==#e== call\n"),
            vec!["#a", "#b", "#d", "#e"]
        );
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
            (
                "_#u_ and __#todo__ and _#snake_case_",
                &["#u", "#todo", "#snake_case"],
            ),
            ("| x | y |\n| - | - |\n|#f|#g|", &["#f", "#g"]),
        ];
        for (source, tags) in rows {
            assert_eq!(tags_in(&format!("{source}\n")), tags, "{source}");
        }
    }
}
