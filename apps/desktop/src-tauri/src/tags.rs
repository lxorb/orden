//! Every tag a note uses, once per use.
//!
//! One rule, three readers: the tag tree the search panel offers, the `tag:`
//! operator in a search, and the count behind `space_tags`. The twin of this
//! is search/tags.ts, which the browser build reads with, and the tests hold
//! the two to the same answers.
//!
//! A tag is written two ways, which is Obsidian's pair and so what a file
//! written by either app says. Inline, `#work/nib`: a heading is not one
//! because it has a space after the hash and a tag never does, a tag starts a
//! word, and its name is not all digits, which is what rules out `#42`.
//! And in the front matter, under `tags:`, as a list on the line or as items
//! under it, where the hash is optional because YAML would read one as a
//! comment.
//!
//! A tag's slashes make it a path: `work/nib/canvas` sits under `work/nib`,
//! which sits under `work`, to any depth. Nothing here knows that - a tag is
//! one string to this module - but the `tag:` operator reads the slashes, and
//! so does the tree the app draws, so the characters a tag may hold are what
//! decides how deep that tree can go.

use crate::code_blocks::{CodeBlocks, CodeLine};
use crate::front_matter;
use icu_properties::props::{ExtendedPictographic, GeneralCategory, GeneralCategoryGroup};
use icu_properties::{CodePointMapData, CodePointSetData};

/// Every tag in one note's text, with the hash, in the order they are used.
#[must_use]
pub fn tags_in(body: &str) -> Vec<String> {
    let mut found = Vec::new();
    // How many bytes of the note the block takes, fences included, or zero where
    // the note opens with anything else: the tags under its key are read first,
    // and the pass over the note's own words starts after it.
    let front = front_matter::block(body).map_or(0, |block| block.end);

    read_front(body, front, &mut found);
    read_inline(body, front, &mut found);

    found
}

/// The tags under a `tags:` key, whether they are on its line or in items
/// beneath it.
fn read_front(body: &str, front: usize, found: &mut Vec<String>) {
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

/// What follows `tags:` or `tag:` at the left margin, or nothing when the line
/// is some other key. Both spellings, because Obsidian takes both.
fn key_value(line: &str) -> Option<&str> {
    let lowered = line.to_ascii_lowercase();

    for key in ["tags:", "tag:"] {
        if lowered.starts_with(key) {
            return Some(&line[key.len()..]);
        }
    }

    None
}

/// The `- item` lines under a key, stopping at the first line that is not one.
/// Answers where it stopped, so the caller reads on from there.
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

/// Every name in a written-out value: `[a, b]`, `a, b` and `a b` all read.
fn read_values(text: &str, found: &mut Vec<String>) {
    for piece in text.split(|one: char| one.is_whitespace() || ",[]'\"".contains(one)) {
        // The hash is optional here, because YAML reads one as a comment; a
        // value that has one is the same tag as a value that has not.
        let name = piece.strip_prefix('#').unwrap_or(piece);
        if named(name) {
            found.push(format!("#{name}"));
        }
    }
}

/// Whether a name is one a tag may have: opened by a letter, mark, digit or emoji,
/// then those and the three joiners, and not all digits.
fn named(name: &str) -> bool {
    let mut letters = name.chars();
    let Some(first) = letters.next() else {
        return false;
    };

    name_start(first) && letters.all(name_char) && !name.chars().all(char::is_numeric)
}

/// A character a name may open with: a letter, mark, digit or emoji.
fn name_start(one: char) -> bool {
    let category = CodePointMapData::<GeneralCategory>::new().get(one);
    GeneralCategoryGroup::Letter.contains(category)
        || GeneralCategoryGroup::Mark.contains(category)
        || GeneralCategoryGroup::Number.contains(category)
        || CodePointSetData::new::<ExtendedPictographic>().contains(one)
}

/// A character a name holds after its first: those, and the three that join words.
fn name_char(one: char) -> bool {
    name_start(one) || "-_/".contains(one)
}

/// Every `#tag` in the note's own words. The front matter is left out of this
/// pass: a hash there is a YAML comment, and the tags it holds have been read
/// already. Code is left out too, fenced or indented, where a `#` is a comment or a heading
/// in some other language, and so is inline code, which shows what is in it as
/// written. A code span runs on across the lines of a paragraph, so the spans are
/// cut a block at a time. Raw HTML and autolinks, which `CommonMark` reads before a
/// backtick, are not looked for: a backtick in an attribute can hide a tag.
fn read_inline(body: &str, front: usize, found: &mut Vec<String>) {
    for block in blocks(&body[front..]) {
        // Read through the block as it is written rather than as a list of
        // characters: this runs over every line of every note in a space, and an
        // array of one block's letters is an allocation a tag does not need. Nor
        // are its code spans, where it holds no hash.
        if !block.contains('#') {
            continue;
        }
        let code = code_spans(block);
        let mut at = 0;
        while let Some(hash) = block[at..].find('#') {
            let start = at + hash;

            // A tag starts a word, so what comes before it must be a space.
            let opens = block[..start]
                .chars()
                .next_back()
                .is_none_or(|one| one.is_whitespace() || one == '(')
                && !code.iter().any(|&(from, to)| (from..to).contains(&start));

            // The name is what a tag may hold, which rules out `#1`.
            let rest = &block[start + 1..];
            let name = rest
                .find(|one: char| !name_char(one))
                .map_or(rest, |end| &rest[..end]);

            if opens && named(name) {
                found.push(block[start..start + 1 + name.len()].to_string());
            }

            at = start + 1 + name.len();
        }
    }
}

/// The blocks of words in a note: a paragraph's lines, a list item's or a
/// heading's, which no code span reaches out of. A blank line, a line of code and
/// a line that opens a block end one, and code is in none. What is code is
/// judged as the renderer judges it, fences in quotes and list items and indented
/// code included; see `code_blocks`.
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

/// Whether a line opens a block of its own: a list item, a quote or a heading.
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

/// Whether a line is a heading, which is one line long.
fn heading(line: &str) -> bool {
    let rest = line.trim_start_matches(' ');
    let hashes = rest.bytes().take_while(|&one| one == b'#').count();
    line.len() - rest.len() <= 3 && (1..=6).contains(&hashes) && ends_marker(&rest[hashes..])
}

/// Whether what follows a block's marker lets it open one: a blank or nothing.
fn ends_marker(after: &str) -> bool {
    after.is_empty() || after.starts_with([' ', '\t'])
}

/// Where the code spans in a line start and end, in bytes, cut the way
/// `codeAndWords` in tags.ts cuts them: a run of backticks opens a span that
/// the next run of the same length closes, one with no such run after it is
/// backticks, and a backtick behind a backslash opens nothing. Every mark this
/// looks for is ASCII, so reading bytes never lands inside a character.
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

/// How many backticks stand in a row from `at`.
fn backticks_at(bytes: &[u8], at: usize) -> usize {
    bytes[at..].iter().take_while(|&&one| one == b'`').count()
}

/// Where the run of exactly `length` backticks closing a span starts, from `from`.
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
            tags_in("#work/nib/canvas/deep/deeper"),
            vec!["#work/nib/canvas/deep/deeper"]
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
            tags_in("---\ntags: work/nib, other\n---\n\nwords\n"),
            vec!["#work/nib", "#other"]
        );
    }

    #[test]
    fn reads_a_list_in_brackets() {
        assert_eq!(
            tags_in("---\ntags: [work/nib, other]\n---\n\nwords\n"),
            vec!["#work/nib", "#other"]
        );
    }

    #[test]
    fn reads_items_under_the_key() {
        assert_eq!(
            tags_in("---\ntags:\n  - work/nib\n  - other\n---\n\nwords\n"),
            vec!["#work/nib", "#other"]
        );
    }

    #[test]
    fn takes_the_hash_as_optional_in_the_front_matter() {
        assert_eq!(
            tags_in("---\ntags: [#work/nib]\n---\n\nwords\n"),
            vec!["#work/nib"]
        );
    }

    #[test]
    fn takes_either_spelling_of_the_key() {
        assert_eq!(
            tags_in("---\ntag: work/nib\n---\n\nwords\n"),
            vec!["#work/nib"]
        );
    }

    #[test]
    fn reads_nothing_under_another_key() {
        assert_eq!(
            tags_in("---\nstatus: done\nproject: Nib\n---\n\nwords\n"),
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
            tags_in("---\ntags: [work]\n---\n\nwords #nib\n"),
            vec!["#work", "#nib"]
        );
    }

    /// Twin of the CRLF case in scan-note.test.ts: the launch scan and a save
    /// read the same tags out of a note written with Windows endings.
    #[test]
    fn reads_front_matter_tags_in_a_crlf_note() {
        assert_eq!(
            tags_in("---\r\ntags: [work]\r\n---\r\nx\r\n"),
            vec!["#work"]
        );
        assert_eq!(
            tags_in("---\r\ntags:\r\n  - work\r\n---\r\nx #nib\r\n"),
            vec!["#work", "#nib"]
        );
    }
}
