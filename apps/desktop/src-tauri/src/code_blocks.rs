//! Which lines of a note are code, judged the way the renderer judges them.
//!
//! The twin of `CodeBlocks` in fences.ts in `@orden/markdown`, which the browser build and
//! the renderer's own comment stripper read with; the tests hold the two to the
//! same answers. A fence inside a quote or a callout carries `> ` in front of
//! it, one inside a list item is indented under the item, and a line indented
//! by four spaces after a blank line is code with no fence at all. The renderer
//! (marked, which follows `CommonMark` here) draws all of those as `<pre>`, so a
//! tag in them is what the code says, not a tag.
//!
//! So this walks the note a line at a time and keeps the containers a line sits
//! in, quotes and list items, the way `CommonMark`'s block parse does: it takes
//! off the markers a line continues them with, and judges what is left. Not the
//! whole grammar: HTML blocks, tables and link definitions are words to it.

use std::borrow::Cow;

/// What one line of a note is.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CodeLine {
    /// A line of words: a paragraph's, a heading's, a blank one.
    Words,
    /// A line of code, or a fence that closes some.
    Code,
    /// A fence that opens code.
    Opens,
}

/// A quote, or a list item whose content starts so many columns in.
#[derive(Clone, Copy)]
enum Container {
    Quote,
    Item(usize),
}

/// What the innermost container holds open: a paragraph, which a line of words
/// can carry on lazily; a fence, by its character and length, until its closing
/// mark; or indented code.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum Leaf {
    #[default]
    Nothing,
    Paragraph,
    Indented,
    Fence(u8, usize),
}

/// Feed it a note's lines in order; it says of each what it is.
#[derive(Default)]
pub struct CodeBlocks {
    containers: Vec<Container>,
    leaf: Leaf,
}

impl CodeBlocks {
    /// What `raw`, the next line, is.
    pub fn line(&mut self, raw: &str) -> CodeLine {
        let line = expanded(raw.strip_suffix('\r').unwrap_or(raw));
        let line = line.as_ref();
        let mut at = 0;
        let mut matched = 0;

        // The containers this line carries on: a quote by its `>`, an item by
        // its indent, or by being blank.
        for container in &self.containers {
            let indent = spaces_at(line, at);
            match *container {
                Container::Quote => {
                    if indent > 3 || line.as_bytes().get(at + indent) != Some(&b'>') {
                        break;
                    }
                    at += indent + 1;
                    if line.as_bytes().get(at) == Some(&b' ') {
                        at += 1;
                    }
                }
                Container::Item(width) => {
                    if line[at..].trim().is_empty() {
                        at = line.len();
                    } else if indent >= width {
                        at += width;
                    } else {
                        break;
                    }
                }
            }
            matched += 1;
        }

        let rest = &line[at..];

        if matched < self.containers.len() {
            // A paragraph carries on over a line that opens nothing, whatever it
            // left out: CommonMark's lazy continuation.
            if self.leaf == Leaf::Paragraph && !rest.trim().is_empty() && !opens_block(rest) {
                return CodeLine::Words;
            }
            self.containers.truncate(matched);
            self.leaf = Leaf::Nothing;
        }

        if let Leaf::Fence(mark, length) = self.leaf {
            if closes_fence(rest, mark, length) {
                self.leaf = Leaf::Nothing;
            }
            return CodeLine::Code;
        }

        if self.leaf == Leaf::Indented {
            if rest.trim().is_empty() || spaces_at(rest, 0) >= 4 {
                return CodeLine::Code;
            }
            self.leaf = Leaf::Nothing;
        }

        self.open(rest)
    }

    /// The containers `rest` opens, and then what is in them.
    fn open(&mut self, start: &str) -> CodeLine {
        let mut rest = start;

        loop {
            let indent = spaces_at(rest, 0);
            if indent > 3 {
                break;
            }
            let text = &rest[indent..];

            if let Some(inside) = text.strip_prefix('>') {
                self.containers.push(Container::Quote);
                self.leaf = Leaf::Nothing;
                rest = inside.strip_prefix(' ').unwrap_or(inside);
                continue;
            }

            if thematic_break(rest) {
                break;
            }
            let Some(width) = marker(text, self.leaf == Leaf::Paragraph) else {
                break;
            };

            self.containers.push(Container::Item(indent + width));
            self.leaf = Leaf::Nothing;
            rest = text.get(width..).unwrap_or("");
        }

        if rest.trim().is_empty() {
            self.leaf = Leaf::Nothing;
            return CodeLine::Words;
        }

        if spaces_at(rest, 0) >= 4 {
            if self.leaf == Leaf::Paragraph {
                return CodeLine::Words;
            }
            self.leaf = Leaf::Indented;
            return CodeLine::Code;
        }

        if let Some((mark, length)) = fence_mark(rest) {
            self.leaf = Leaf::Fence(mark, length);
            return CodeLine::Opens;
        }

        self.leaf = if heading(rest) || thematic_break(rest) {
            Leaf::Nothing
        } else {
            Leaf::Paragraph
        };
        CodeLine::Words
    }
}

/// Whether `rest` opens a block of its own rather than carrying a paragraph on.
/// Any list marker does, not only one that may break into a paragraph: the
/// paragraph is inside the containers this line left, so a marker opens an
/// item beside them.
fn opens_block(rest: &str) -> bool {
    let indent = spaces_at(rest, 0);
    if indent > 3 {
        return false;
    }
    let text = &rest[indent..];
    text.starts_with('>')
        || fence_mark(rest).is_some()
        || heading(rest)
        || thematic_break(rest)
        || marker(text, false).is_some()
}

/// How wide a list marker at the start of `text` is, its spaces included, or
/// nothing when there is none. One that would break into a paragraph has to
/// have words after it, and be a bullet or a `1`.
fn marker(text: &str, interrupting: bool) -> Option<usize> {
    let bytes = text.as_bytes();
    let (mark, number) = if matches!(bytes.first(), Some(b'-' | b'*' | b'+')) {
        (1, None)
    } else {
        let digits = bytes.iter().take_while(|one| one.is_ascii_digit()).count();
        if !(1..=9).contains(&digits) || !matches!(bytes.get(digits), Some(b'.' | b')')) {
            return None;
        }
        (digits + 1, Some(&text[..digits]))
    };

    let spaces = spaces_at(text, mark);
    let words = bytes.get(mark + spaces).is_some();
    if spaces == 0 && words {
        return None;
    }
    if interrupting && (!words || number.is_some_and(|number| number.parse() != Ok(1_u32))) {
        return None;
    }

    // Nothing after the marker, or code after it: the content starts one past it.
    Some(if !words || spaces > 4 {
        mark + 1
    } else {
        mark + spaces
    })
}

/// The run of backticks or tildes a fence opens with, as its character and
/// length: up to three spaces of indent, three or more marks, and for
/// backticks no backtick after them on the line (`CommonMark` 4.5).
fn fence_mark(line: &str) -> Option<(u8, usize)> {
    let indent = spaces_at(line, 0);
    if indent > 3 {
        return None;
    }
    let rest = &line.as_bytes()[indent..];
    let mark = *rest.first()?;
    if mark != b'`' && mark != b'~' {
        return None;
    }
    let length = rest.iter().take_while(|&&one| one == mark).count();
    if length < 3 || (mark == b'`' && rest[length..].contains(&b'`')) {
        return None;
    }
    Some((mark, length))
}

/// Whether a line closes the fence of `mark` and `length`: the same character,
/// at least as many of them, and nothing after them.
fn closes_fence(line: &str, mark: u8, length: usize) -> bool {
    let Some((found, run)) = fence_mark(line) else {
        return false;
    };
    let after = &line[spaces_at(line, 0) + run..];
    found == mark && run >= length && after.trim_start_matches([' ', '\t']).is_empty()
}

/// A thematic break, which looks like a list item and is none.
fn thematic_break(line: &str) -> bool {
    let indent = spaces_at(line, 0);
    if indent > 3 {
        return false;
    }
    let rest = &line.as_bytes()[indent..];
    let Some(&mark) = rest.first() else {
        return false;
    };
    matches!(mark, b'-' | b'*' | b'_')
        && rest
            .iter()
            .all(|&one| one == mark || one == b' ' || one == b'\t')
        && rest
            .iter()
            .fold(0, |marks, &one| marks + usize::from(one == mark))
            >= 3
}

/// Whether a line is a heading: up to three spaces, one to six hashes, and a
/// blank or nothing after them.
fn heading(line: &str) -> bool {
    let indent = spaces_at(line, 0);
    let rest = &line.as_bytes()[indent..];
    let hashes = rest.iter().take_while(|&&one| one == b'#').count();
    indent <= 3
        && (1..=6).contains(&hashes)
        && rest
            .get(hashes)
            .is_none_or(|&one| one == b' ' || one == b'\t')
}

/// How many spaces stand in a row from `at`.
fn spaces_at(line: &str, at: usize) -> usize {
    line.as_bytes().get(at..).map_or(0, |rest| {
        rest.iter().take_while(|&&one| one == b' ').count()
    })
}

/// The line with each tab as the spaces it stands for, as `CommonMark` counts
/// columns: to the next multiple of four.
fn expanded(line: &str) -> Cow<'_, str> {
    if !line.contains('\t') {
        return Cow::Borrowed(line);
    }
    let mut out = String::with_capacity(line.len() + 8);
    let mut column = 0;
    for one in line.chars() {
        if one == '\t' {
            let stop = 4 - column % 4;
            out.extend(std::iter::repeat_n(' ', stop));
            column += stop;
        } else {
            out.push(one);
            column += one.len_utf16();
        }
    }
    Cow::Owned(out)
}

#[cfg(test)]
mod tests {
    use super::{CodeBlocks, CodeLine};

    /// What the walk says of each line of `note`, as one letter a line: `w` for
    /// words, `c` for code and `o` for a fence that opens.
    fn walk(note: &str) -> String {
        let mut code = CodeBlocks::default();
        note.split('\n')
            .map(|line| match code.line(line) {
                CodeLine::Words => 'w',
                CodeLine::Code => 'c',
                CodeLine::Opens => 'o',
            })
            .collect()
    }

    #[test]
    fn reads_a_fence_at_the_margin() {
        assert_eq!(walk("a\n```\n#x\n```\nb"), "woccw");
    }

    #[test]
    fn reads_a_fence_inside_a_quote_and_ends_it_with_the_quote() {
        assert_eq!(walk("> ```css\n> #fff\n> ```\n> b"), "occw");
        assert_eq!(walk("> ```\n> #no\n#yes"), "ocw");
    }

    #[test]
    fn reads_a_fence_inside_a_list_item() {
        assert_eq!(walk("- item\n\n  ```\n  #no\n  ```\n#yes"), "wwoccw");
    }

    #[test]
    fn reads_indented_code_but_not_an_indented_line_carrying_a_paragraph() {
        assert_eq!(walk("Notes\n\n    #include\n\n#yes"), "wwccw");
        assert_eq!(walk("words\n    #yes"), "ww");
        assert_eq!(walk("- item\n\n      #define X\n#yes"), "wwcw");
        assert_eq!(walk("> words\n>\n>     #no"), "wwc");
    }

    #[test]
    fn closes_a_fence_only_on_the_same_mark_at_least_as_long_with_nothing_after() {
        assert_eq!(walk("````\n```\n#x\n```\n````\nb"), "occccw");
        assert_eq!(walk("```\n~~~\n```\nb"), "occw");
        assert_eq!(walk("```\n``` ts\n```\nb"), "occw");
    }

    #[test]
    fn opens_a_fence_at_three_spaces_but_not_four() {
        assert_eq!(walk("   ```\nx\n```\nb"), "occw");
        assert_eq!(walk("words\n    ```\nb"), "www");
    }

    #[test]
    fn opens_no_fence_on_backticks_with_a_backtick_after_them() {
        assert_eq!(walk("```a`a\n#yes"), "ww");
    }

    #[test]
    fn counts_a_tab_as_the_columns_it_stands_for() {
        assert_eq!(walk("\t#include"), "c");
        assert_eq!(walk(">\t#include"), "w");
        assert_eq!(walk(">\t\t#include"), "c");
    }

    #[test]
    fn takes_a_line_break_written_as_crlf() {
        assert_eq!(walk("```\r\n#x\r\n```\r\nb"), "occw");
    }
}
