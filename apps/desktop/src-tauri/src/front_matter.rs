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
//! `front-matter.test.ts`: the same notes, the same answers.

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
/// Three things make one, and the first two are Obsidian's: the opening fence is
/// the note's first line at the left margin, and the block closes. An indented
/// fence is an indented rule, and a block nobody closed is a note that opens with a
/// rule. The third is how it reads: see `closing_fence`.
pub fn block(body: &str) -> Option<Block> {
    let first = body.find('\n')?;
    // Space after the fence is nothing; space before it is a fence that is not at
    // the margin, which no reader of a markdown file takes for metadata. A byte
    // order mark in front of it is how Notepad saves a file, and is not text.
    let opening = body[..first]
        .strip_prefix('\u{feff}')
        .unwrap_or(&body[..first]);
    if !is_fence(opening.strip_suffix('\r').unwrap_or(opening)) {
        return None;
    }

    let close = closing_fence(body, first + 1)?;
    let end = body[close..]
        .find('\n')
        .map_or(body.len(), |one| close + one);
    Some(Block {
        from: first + 1,
        close,
        end,
    })
}

fn is_fence(line: &str) -> bool {
    line.strip_prefix("---")
        .is_some_and(|rest| rest.bytes().all(is_blank))
}

const fn is_blank(one: u8) -> bool {
    one == b' ' || one == b'\t'
}

const MOST_KEY_WORDS: usize = 6;
const MOST_KEY_CHARACTERS: usize = 80;

const SENTENCE_KEY_WORDS: usize = 3;
const SENTENCE_VALUE_WORDS: usize = 3;

const MOST_KEY_LENGTH: usize = 1024;

fn not_the_first_key(text: &str) -> bool {
    let bytes = text.as_bytes();
    let Some(&first) = bytes.first() else {
        return false;
    };
    let next = bytes.get(1).copied();
    if (first == b'-' || first == b'+') && next.is_some_and(is_blank) {
        return true;
    }
    if first == b'<'
        && next.is_some_and(|one| one.is_ascii_alphabetic() || matches!(one, b'/' | b'!' | b'?'))
    {
        return true;
    }
    let digits = bytes.iter().take_while(|one| one.is_ascii_digit()).count();
    digits > 0
        && matches!(bytes.get(digits), Some(b'.' | b')'))
        && bytes.get(digits + 1).copied().is_some_and(is_blank)
}

fn is_tight_key(text: &str) -> bool {
    let bytes = text.as_bytes();
    let Some(&first) = bytes.first() else {
        return false;
    };
    if !(first.is_ascii_alphabetic() || first == b'_') {
        return false;
    }
    let word = bytes
        .iter()
        .take_while(|&&one| one.is_ascii_alphanumeric() || matches!(one, b'_' | b'.' | b'$' | b'-'))
        .count();
    if bytes.get(word) != Some(&b':') || text[word + 1..].starts_with("//") {
        return false;
    }
    text[word + 1..]
        .chars()
        .next()
        .is_some_and(|one| !one.is_whitespace() && one != ':')
}

fn is_key_line(text: &str) -> bool {
    let Some(past) = past_key(text.as_bytes(), 0) else {
        return is_tight_key(text);
    };
    if not_the_first_key(text) || past == 1 {
        return false;
    }
    if text.starts_with('"') || text.starts_with('\'') {
        return true;
    }

    let key = text[..past - 1].trim_end();
    if key.contains("://") || key.chars().count() > MOST_KEY_CHARACTERS {
        return false;
    }
    let words = key.split_whitespace().count();
    if words > MOST_KEY_WORDS {
        return false;
    }

    let value = text[past..].trim();
    !(words >= SENTENCE_KEY_WORDS
        && value.split_whitespace().count() >= SENTENCE_VALUE_WORDS
        && value.ends_with(['.', '!', '?', '…']))
}

fn past_quote(line: &[u8], at: usize) -> Option<usize> {
    let quote = line[at];
    let mut over = at + 1;
    while over < line.len() {
        if quote == b'"' && line[over] == b'\\' {
            over += 1;
        } else if line[over] == quote {
            if quote == b'\'' && line.get(over + 1) == Some(&b'\'') {
                over += 1;
            } else {
                return Some(over + 1);
            }
        }
        over += 1;
    }
    None
}

fn past_key(line: &[u8], at: usize) -> Option<usize> {
    let first = *line.get(at)?;
    if b"#*>|[]{}!&%@`,".contains(&first) {
        return None;
    }

    let mut from = at;
    if first == b'"' || first == b'\'' {
        from = past_quote(line, at)?;
        while line.get(from).copied().is_some_and(is_blank) {
            from += 1;
        }
        if line.get(from) != Some(&b':') {
            return None;
        }
    }

    for (over, &one) in line.iter().enumerate().skip(from) {
        if one == b':' {
            if over - at > MOST_KEY_LENGTH {
                return None;
            }
            if line.get(over + 1).is_none_or(|&next| is_blank(next)) {
                return Some(over + 1);
            }
        }
    }
    None
}

#[derive(Default, Clone, Copy)]
struct Open {
    quote: u8,
    depth: i32,
}

fn stays_open(line: &[u8], open: &mut Open) -> bool {
    let mut starts = true;
    let mut at = 0;
    while at < line.len() {
        let one = line[at];
        if open.quote != 0 {
            if open.quote == b'"' && one == b'\\' {
                at += 1;
            } else if one == open.quote {
                if open.quote == b'\'' && line.get(at + 1) == Some(&b'\'') {
                    at += 1;
                } else {
                    open.quote = 0;
                    if open.depth == 0 {
                        return false;
                    }
                    starts = false;
                }
            }
        } else if one == b'#' && (at == 0 || is_blank(line[at - 1])) {
            return true;
        } else if (one == b'"' || one == b'\'') && starts {
            open.quote = one;
        } else if one == b'[' || one == b'{' {
            open.depth += 1;
            starts = true;
        } else if one == b']' || one == b'}' {
            open.depth -= 1;
            if open.depth <= 0 {
                return false;
            }
            starts = false;
        } else if one == b',' || one == b':' {
            starts = true;
        } else if !is_blank(one) {
            starts = false;
        }
        at += 1;
    }
    true
}

pub fn value_closes_at(body: &str, from: usize, limit: usize) -> Option<usize> {
    let bytes = body.as_bytes();
    let line_end = |at: usize| {
        bytes[at..limit]
            .iter()
            .position(|&one| one == b'\n')
            .map_or(limit, |one| at + one)
    };
    let without_return =
        |line: &'_ [u8]| -> usize { line.len() - usize::from(line.last() == Some(&b'\r')) };

    let mut stop = line_end(from);
    let first = &bytes[from..stop];
    let blanks = first.iter().take_while(|&&one| is_blank(one)).count();
    let said = without_properties(&first[blanks..]);
    let said = &said[..without_return(said)];
    if !matches!(said.first(), Some(b'"' | b'\'' | b'[' | b'{')) {
        return None;
    }
    let mut open = Open::default();
    if !stays_open(said, &mut open) {
        return None;
    }

    while stop + 1 < limit {
        let at = stop + 1;
        stop = line_end(at);
        let line = &bytes[at..stop];
        if !stays_open(&line[..without_return(line)], &mut open) {
            return Some(stop);
        }
    }
    None
}

fn is_block_scalar(said: &[u8]) -> bool {
    if !matches!(said.first(), Some(b'|' | b'>')) {
        return false;
    }
    let after = said[1..]
        .iter()
        .take_while(|&&one| one == b'+' || one == b'-' || one.is_ascii_digit())
        .count();
    let rest = &said[1 + after..];
    let text = rest.iter().position(|&one| !is_blank(one));
    text.is_none_or(|at| rest[at] == b'#')
}

fn without_properties(said: &[u8]) -> &[u8] {
    let mut rest = said;
    while matches!(rest.first(), Some(b'&' | b'!')) {
        let word = rest
            .iter()
            .position(|&one| is_blank(one))
            .unwrap_or(rest.len());
        rest = &rest[word..];
        let blanks = rest.iter().take_while(|&&one| is_blank(one)).count();
        rest = &rest[blanks..];
    }
    rest
}

#[allow(clippy::too_many_lines)]
fn closing_fence(body: &str, from: usize) -> Option<usize> {
    let mut base: Option<usize> = None;
    let mut comment = false;
    let mut list = false;
    let mut gap = false;
    let mut scalar: Option<usize> = None;
    let mut open: Option<Open> = None;
    let mut whole = false;
    let mut opens = true;
    let mut reread = 0;

    let mut at = from;
    while at <= body.len() {
        let end = body[at..].find('\n').map(|one| at + one);
        let stop = end.unwrap_or(body.len());
        let text = &body[at..stop];
        let text = text.strip_suffix('\r').unwrap_or(text);
        let line = text.as_bytes();

        if is_fence(text) {
            if open.is_none() {
                return (base.is_some() || !comment).then_some(at);
            }
            open = None;
            opens = false;
            at = reread;
            continue;
        }

        if let Some(state) = open.as_mut() {
            if !stays_open(line, state) {
                open = None;
            }
        } else {
            let indent = line.iter().take_while(|&&one| is_blank(one)).count();

            if indent == line.len() {
                gap = true;
            } else if scalar.is_none_or(|past| indent <= past) {
                scalar = None;

                if line[indent] == b'#' {
                    comment = true;
                } else if whole {
                    return None;
                } else {
                    let first = base.is_none();
                    if first {
                        let rest = &text[indent..];
                        let complex =
                            rest == "?" || rest.starts_with("? ") || rest.starts_with("?\t");
                        if !is_key_line(rest) && !complex && !rest.starts_with('{') {
                            return None;
                        }
                        base = Some(indent);
                    }
                    let mapping = base.unwrap_or(indent);

                    let mut col = indent;
                    let mut dash = None;
                    while line.get(col) == Some(&b'-')
                        && line.get(col + 1).is_none_or(|&next| is_blank(next))
                    {
                        dash = Some(col);
                        col += 1;
                        while line.get(col).copied().is_some_and(is_blank) {
                            col += 1;
                        }
                    }
                    let own = indent == mapping;

                    let complex = matches!(line.get(col), Some(b'?' | b':'))
                        && line.get(col + 1).is_none_or(|&next| is_blank(next));
                    let past = if complex {
                        Some(col + 1)
                    } else {
                        past_key(line, col)
                    };
                    let keyed = past.is_some() || is_tight_key(&text[col..]);
                    let continues = indent > mapping || (dash.is_some() && list);
                    if gap && !keyed && !continues {
                        return None;
                    }
                    gap = false;

                    let mut value = past.unwrap_or(col);
                    while line.get(value).copied().is_some_and(is_blank) {
                        value += 1;
                    }
                    let said = without_properties(line.get(value..).unwrap_or_default());
                    let start = said.first().copied().unwrap_or(0);
                    let empty = said.is_empty() || start == b'#';

                    if own && dash.is_none() {
                        list = empty;
                    }
                    whole = first && start == b'{' && past.is_none();

                    let as_value = past.is_some() || dash.is_some() || indent > mapping || whole;
                    if is_block_scalar(said) {
                        scalar = Some(if past.is_some() {
                            col
                        } else {
                            dash.unwrap_or(indent)
                        });
                    } else if opens && as_value && matches!(start, b'"' | b'\'' | b'[' | b'{') {
                        let mut opening = Open::default();
                        if stays_open(said, &mut opening) {
                            open = Some(opening);
                            reread = stop + 1;
                        }
                    } else if !empty {
                        scalar = if past.is_some() {
                            Some(col)
                        } else {
                            dash.or_else(|| indent.checked_sub(1))
                        };
                    }
                }
            }
        }

        match end {
            Some(_) => at = stop + 1,
            None => return None,
        }
    }
    None
}

/// A top-level `key: value` of a block the caller has already found, quotes
/// stripped, or None where the block holds no such key or nothing after the colon.
///
/// The block comes in rather than being looked for here, because a caller that wants
/// one key wants four: the icon a row wears, the colour of it, the other names the
/// note answers to and the address it stands for are four keys of one block. Looking
/// for that block per key is four passes down a note that opens with a fence nothing
/// closes, for every note in the space.
///
/// The twin of `frontMatterValue`.
pub fn value(body: &str, block: &Block, key: &str) -> Option<String> {
    lines_of(body, block).find_map(|line| value_of(line, key))
}

/// A top-level key of that block read as a list: `key: [a, b]`, the `- a` lines
/// written under `key:`, or a single value standing for a list of one. Empty where
/// the block holds no such key or nothing under it.
///
/// The twin of `frontMatterList`.
pub fn list(body: &str, block: &Block, key: &str) -> Vec<String> {
    let mut lines = lines_of(body, block);
    while let Some(line) = lines.next() {
        let Some(said) = named(line, key) else {
            continue;
        };

        let from = line.as_ptr() as usize - body.as_ptr() as usize;
        let past = line.find(':').map_or(0, |one| one + 1);
        if let Some(close) = value_closes_at(body, from + past, block.close) {
            let joined: Vec<&str> = body[from + past..close]
                .lines()
                .map(|one| {
                    let line = one.trim();
                    if line.starts_with('#') {
                        ""
                    } else {
                        line.split(" #").next().unwrap_or_default().trim()
                    }
                })
                .collect();
            return flow_items(&joined.join(" "));
        }

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
    body.get(block.from..block.close)
        .unwrap_or_default()
        .lines()
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
    ///
    /// None for a note with no block at all, the way the reader in `links` answers
    /// for one: a key of a block that is not there is a key nothing said.
    fn icon(body: &str) -> Option<String> {
        value(body, &block(body)?, "icon")
    }

    /// The other names a note gives itself, and the other twin.
    fn aliases(body: &str) -> Vec<String> {
        block(body).map_or_else(Vec::new, |one| list(body, &one, "aliases"))
    }

    #[test]
    fn the_block_is_the_lines_between_two_fences() {
        let note = "---\nicon: rocket\n---\n\n# Plan\n";
        let found = block(note).expect("a block");

        assert_eq!(&note[found.from..found.close], "icon: rocket\n");
        assert_eq!(&note[found.end..], "\n\n# Plan\n");
    }

    #[test]
    fn what_counts_as_front_matter_is_the_table_both_read() {
        let table: Vec<(String, bool)> = serde_json::from_str(include_str!(
            "../../../../packages/markdown/src/front-matter-table.json"
        ))
        .expect("the table parses");

        for (note, expected) in table {
            assert_eq!(block(&note).is_some(), expected, "{note:?}");
        }
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

    /// A file saved by Notepad opens with a byte order mark. The twin of "a byte
    /// order mark in front of the fence" in front-matter.test.ts.
    #[test]
    fn a_byte_order_mark_in_front_of_the_fence() {
        let note = "\u{feff}---\naliases: [Proj]\nicon: star\n---\nbody\n";
        let found = block(note).expect("a block");

        assert_eq!(
            &note[found.from..found.close],
            "aliases: [Proj]\nicon: star\n"
        );
        assert_eq!(&note[found.end..], "\nbody\n");
        assert_eq!(icon(note).as_deref(), Some("star"));
        assert_eq!(aliases(note), vec!["Proj"]);
    }

    /// The opening fence stands at the left margin, which is where Obsidian and
    /// every other reader of a markdown file look for it. The twin of "an opening
    /// fence stands at the left margin".
    #[test]
    fn an_indented_opening_fence_opens_nothing() {
        assert!(block("  ---\nicon: rocket\n---\n").is_none());
        assert!(block("\t---\nicon: rocket\n---\n").is_none());
        assert_eq!(icon("  ---\nicon: rocket\n---\n"), None);
        // Space after the fence is nothing at all, though.
        assert_eq!(
            icon("---  \nicon: rocket\n---\n").as_deref(),
            Some("rocket")
        );
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
    fn reads_a_list_written_across_lines() {
        assert_eq!(
            aliases("---\naliases: [\n  One, # first\n  # a note\n  \"Two\",\n]\nz: 1\n---\n"),
            vec!["One", "Two"]
        );
        assert_eq!(
            aliases("---\r\naliases: [\r\n  One,\r\n]\r\nz: 1\r\n---\r\n"),
            vec!["One"]
        );
        assert_eq!(aliases("---\naliases: [One\nz: 1\n---\n"), vec!["[One"]);
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
