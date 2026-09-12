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
//! word, and its first character is a letter, which is what rules out `#42`.
//! And in the front matter, under `tags:`, as a list on the line or as items
//! under it, where the hash is optional because YAML would read one as a
//! comment.
//!
//! A tag's slashes make it a path: `work/nib/canvas` sits under `work/nib`,
//! which sits under `work`, to any depth. Nothing here knows that - a tag is
//! one string to this module - but the `tag:` operator reads the slashes, and
//! so does the tree the app draws, so the characters a tag may hold are what
//! decides how deep that tree can go.

use crate::front_matter;

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

/// Whether a name is one a tag may have: a letter, then letters, digits, and
/// the three characters that join words, the slash among them.
fn named(name: &str) -> bool {
    let mut letters = name.chars();
    let Some(first) = letters.next() else {
        return false;
    };

    first.is_alphabetic() && letters.all(|one| one.is_alphanumeric() || "-_/".contains(one))
}

/// Every `#tag` in the note's own words. The front matter is left out of this
/// pass: a hash there is a YAML comment, and the tags it holds have been read
/// already. Fenced code is left out too, where a `#` is a comment or a heading
/// in some other language.
fn read_inline(body: &str, front: usize, found: &mut Vec<String>) {
    let mut in_fence = false;

    for line in body[front..].lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") || trimmed.starts_with("~~~") {
            in_fence = !in_fence;
            continue;
        }
        if in_fence {
            continue;
        }

        let letters: Vec<char> = line.chars().collect();
        let mut at = 0;

        while at < letters.len() {
            if letters[at] != '#' {
                at += 1;
                continue;
            }

            // A tag starts a word, so what comes before it must be a space.
            let opens = at == 0 || letters[at - 1].is_whitespace() || letters[at - 1] == '(';
            let mut end = at + 1;
            while end < letters.len()
                && (letters[end].is_alphanumeric() || "-_/".contains(letters[end]))
            {
                end += 1;
            }

            // The first character has to be a letter, which rules out `#1`.
            let is_named = end > at + 1 && letters[at + 1].is_alphabetic();

            if opens && is_named {
                found.push(letters[at..end].iter().collect());
            }

            at = end.max(at + 1);
        }
    }
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
}
