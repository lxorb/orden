//! The block of metadata a note may open with, and the two ways one key of it is
//! read.
//!
//! YAML between two `---` fences, which is Obsidian's convention and so this
//! app's: a note that says what it is says it there, and every other editor that
//! reads markdown leaves the block alone.
//!
//! Here rather than in one of the two modules that ask, because both do: `links`
//! reads the icon a row wears and the other names a note gives itself, and `tags`
//! reads the `tags:` key and then leaves the block out of its own pass. A second
//! copy of where the block is would be a second answer to what a note's metadata
//! is.
//!
//! Top-level keys only. A key indented under another one belongs to that one:
//! `paper` under `export:` is not the note's paper, and nothing here pretends
//! otherwise.
//!
//! The twin of this is `packages/markdown/src/front-matter.ts`, which the browser
//! build reads a space with, and the tests at the bottom are the twin of
//! `front-matter.test.ts`: the same notes, the same answers. One difference, which
//! no test on either side fixes: an opening fence indented by a space opens a
//! block here, where the twin asks for it at the left margin.

/// Where a note's front matter sits, in bytes.
///
/// Three offsets, because the two readers ask different things: what the block
/// says is `from` to `close`, and where the note's own words start is `end`.
pub struct Block {
    /// Where the lines between the fences start: just past the opening one.
    pub from: usize,
    /// Where the closing fence's own line begins, which is where those lines end.
    pub close: usize,
    /// Where that line ends, its break not included: the last byte of the block.
    pub end: usize,
}

/// Where the block sits, or None where the note opens with anything else, which
/// is most notes.
///
/// The block has to close, or the note opens with a rule rather than metadata.
pub fn block(body: &str) -> Option<Block> {
    let first = body.find('\n')?;
    if body[..first].trim() != "---" {
        return None;
    }

    let mut at = first + 1;
    while at <= body.len() {
        let end = body[at..].find('\n').map_or(body.len(), |one| at + one);
        if body[at..end].trim() == "---" {
            return Some(Block {
                from: first + 1,
                close: at,
                end,
            });
        }
        if end >= body.len() {
            break;
        }
        at = end + 1;
    }

    None
}

/// A top-level `key: value`, quotes stripped, or None where the note has no
/// block, no such key, or nothing after the colon.
///
/// The twin of `frontMatterValue`.
pub fn value(body: &str, key: &str) -> Option<String> {
    let block = block(body)?;
    lines_of(body, &block).find_map(|line| value_of(line, key))
}

/// A top-level key read as a list: `key: [a, b]`, the `- a` lines written under
/// `key:`, or a single value standing for a list of one. Empty where the note has
/// no block, no such key, or nothing under it.
///
/// The twin of `frontMatterList`.
pub fn list(body: &str, key: &str) -> Vec<String> {
    let Some(block) = block(body) else {
        return Vec::new();
    };

    let mut lines = lines_of(body, &block);
    while let Some(line) = lines.next() {
        let Some(said) = named(line, key) else {
            continue;
        };

        // A key with nothing after it is a list written underneath it.
        return if said.is_empty() {
            dash_items(lines)
        } else {
            flow_items(said)
        };
    }

    Vec::new()
}

/// The block's own lines, without their breaks: from just past the opening fence
/// to the line the closing one is on.
fn lines_of<'a>(body: &'a str, block: &Block) -> std::str::Lines<'a> {
    body.get(block.from..block.close).unwrap_or_default().lines()
}

/// What one line says under `key`, trimmed, or None when the line is another key,
/// a list item, or a line indented under something else.
fn named<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    let (name, said) = line.split_once(':')?;
    // A key of the note's own stands at the left margin; an indented one belongs
    // to the key above it.
    if name.starts_with(char::is_whitespace) || !name.trim_end().eq_ignore_ascii_case(key) {
        return None;
    }

    Some(said.trim())
}

/// What one line says under `key`, or None when it says nothing at all.
fn value_of(line: &str, key: &str) -> Option<String> {
    unquoted(named(line, key)?)
}

/// `[One, Two]` on the key's own line, or a single value standing for a list of
/// one.
fn flow_items(value: &str) -> Vec<String> {
    if let Some(list) = value
        .strip_prefix('[')
        .and_then(|one| one.strip_suffix(']'))
    {
        return list
            .split(',')
            .filter_map(|one| unquoted(one.trim()))
            .collect();
    }

    unquoted(value).into_iter().collect()
}

/// The `- item` lines written under a key, up to the next key of the note's own
/// or anything else that is not an item.
fn dash_items(lines: std::str::Lines<'_>) -> Vec<String> {
    let mut out = Vec::new();

    for line in lines {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }

        let Some(item) = line.strip_prefix('-') else {
            break;
        };
        // A dash with no space after it is not an item, and neither is a dash on
        // its own: `-One` is a word and `-` is a rule.
        if !item.starts_with(char::is_whitespace) {
            break;
        }
        if let Some(said) = unquoted(item.trim()) {
            out.push(said);
        }
    }

    out
}

/// A value with the quotes YAML would take off taken off, or None where nothing
/// is left of it.
fn unquoted(value: &str) -> Option<String> {
    let bare = value
        .strip_prefix('"')
        .and_then(|one| one.strip_suffix('"'))
        .or_else(|| {
            value
                .strip_prefix('\'')
                .and_then(|one| one.strip_suffix('\''))
        })
        .unwrap_or(value);

    if bare.is_empty() {
        None
    } else {
        Some(bare.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::{block, list, value};

    /// The icon a row wears, which is what `links` reads a note's front matter
    /// for. Every case here has its twin in
    /// `packages/markdown/src/front-matter.test.ts`.
    fn icon(body: &str) -> Option<String> {
        value(body, "icon")
    }

    /// The other names a note gives itself, and the other twin.
    fn aliases(body: &str) -> Vec<String> {
        list(body, "aliases")
    }

    #[test]
    fn the_block_is_the_lines_between_two_fences() {
        let note = "---\nicon: rocket\n---\n\n# Plan\n";
        let found = block(note).expect("a block");

        assert_eq!(&note[found.from..found.close], "icon: rocket\n");
        assert_eq!(&note[found.end..], "\n\n# Plan\n");
    }

    #[test]
    fn a_block_with_nothing_in_it_is_still_a_block() {
        let found = block("---\n---\n").expect("a block");

        assert_eq!(found.from, found.close);
        assert_eq!(found.end, 7);
    }

    #[test]
    fn a_note_that_opens_with_anything_else_has_no_block() {
        assert!(block("# Plan\n\nwords").is_none());
        assert!(block("").is_none());
        assert!(block("---").is_none());
        // A block that never closes is a note that opens with a rule.
        assert!(block("---\nicon: rocket\n\n# Plan").is_none());
    }

    #[test]
    fn reads_a_key_from_the_front_matter() {
        assert_eq!(
            icon("---\nicon: rocket\n---\n\n# Plan").as_deref(),
            Some("rocket")
        );
        assert_eq!(
            icon("---\ntitle: Plan\nicon: file-text\n---\n").as_deref(),
            Some("file-text")
        );
        assert_eq!(icon("---\nICON: rocket\n---\n").as_deref(), Some("rocket"));
    }

    #[test]
    fn takes_the_quotes_off_a_value() {
        assert_eq!(
            icon("---\nicon: \"rocket\"\n---\n").as_deref(),
            Some("rocket")
        );
        assert_eq!(
            icon("---\nicon: 'rocket'\n---\n").as_deref(),
            Some("rocket")
        );
    }

    #[test]
    fn reads_an_emoji_as_what_it_says() {
        assert_eq!(icon("---\nicon: 🚀\n---\n").as_deref(), Some("🚀"));
    }

    #[test]
    fn reads_nothing_where_there_is_nothing_to_read() {
        assert_eq!(icon("# Plan\n\nwords"), None);
        assert_eq!(icon("---\ntitle: Plan\n---\n"), None);
        assert_eq!(icon("---\nicon:\n---\n"), None);
        // A block that never closes is a note that opens with a rule.
        assert_eq!(icon("---\nicon: rocket\n\n# Plan"), None);
        // And a key below the block is the note's words rather than its metadata.
        assert_eq!(icon("---\ntitle: Plan\n---\n\nicon: rocket\n"), None);
    }

    #[test]
    fn a_key_indented_under_another_is_not_the_notes_own() {
        assert_eq!(icon("---\nexport:\n  icon: rocket\n---\n"), None);
    }

    /// A note written on Windows carries `\r\n`, and the carriage return is no
    /// part of what the key says.
    #[test]
    fn reads_a_note_written_with_carriage_returns() {
        assert_eq!(
            icon("---\r\nicon: rocket\r\n---\r\n").as_deref(),
            Some("rocket")
        );
    }

    #[test]
    fn reads_a_list_written_on_the_key_s_own_line() {
        assert_eq!(
            aliases("---\naliases: [One, Two]\n---\n"),
            vec!["One".to_string(), "Two".to_string()]
        );
    }

    #[test]
    fn reads_a_list_written_under_the_key() {
        assert_eq!(
            aliases("---\naliases:\n  - One\n  - Two\n---\n"),
            vec!["One".to_string(), "Two".to_string()]
        );
        assert_eq!(
            aliases("---\naliases:\n- One\n---\n"),
            vec!["One".to_string()]
        );
    }

    #[test]
    fn reads_a_single_value_as_a_list_of_one() {
        assert_eq!(aliases("---\naliases: One\n---\n"), vec!["One".to_string()]);
    }

    #[test]
    fn takes_the_quotes_off_every_item() {
        assert_eq!(
            aliases("---\naliases: [\"One\", 'Two']\n---\n"),
            vec!["One".to_string(), "Two".to_string()]
        );
        assert_eq!(
            aliases("---\naliases:\n  - \"One two\"\n---\n"),
            vec!["One two".to_string()]
        );
    }

    #[test]
    fn stops_at_the_next_key_of_the_notes_own() {
        assert_eq!(
            aliases("---\naliases:\n  - One\ntitle: Not an alias\n---\n"),
            vec!["One".to_string()]
        );
    }

    #[test]
    fn reads_nothing_where_there_is_no_list() {
        assert!(aliases("Words.\n").is_empty());
        assert!(aliases("---\ntitle: A note\n---\n").is_empty());
        assert!(aliases("---\naliases:\n---\n").is_empty());
        assert!(aliases("---\naliases: []\n---\n").is_empty());
        assert!(aliases("---\nexport:\n  aliases: [One]\n---\n").is_empty());
    }
}
