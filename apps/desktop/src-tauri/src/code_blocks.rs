use std::borrow::Cow;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum CodeLine {
    Words,
    Code,
    Opens,
}

#[derive(Clone, Copy)]
enum Container {
    Quote,
    Item(usize),
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
enum Leaf {
    #[default]
    Nothing,
    Paragraph,
    Indented,
    Fence(u8, usize),
}

#[derive(Default)]
pub struct CodeBlocks {
    containers: Vec<Container>,
    leaf: Leaf,
    named: Option<String>,
}

impl CodeBlocks {
    pub fn closed_name(&self) -> Option<&str> {
        self.named.as_deref()
    }

    pub fn line(&mut self, raw: &str) -> CodeLine {
        self.named = None;
        let line = expanded(raw.strip_suffix('\r').unwrap_or(raw));
        let line = line.as_ref();
        let mut at = 0;
        let mut matched = 0;

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
            if self.leaf == Leaf::Paragraph && !rest.trim().is_empty() && !opens_block(rest) {
                return CodeLine::Words;
            }
            self.containers.truncate(matched);
            self.leaf = Leaf::Nothing;
        }

        if let Leaf::Fence(mark, length) = self.leaf {
            if closes_fence(rest, mark, length) {
                self.leaf = Leaf::Nothing;
                self.named = fence_name(rest, mark).map(str::to_string);
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

    Some(if !words || spaces > 4 {
        mark + 1
    } else {
        mark + spaces
    })
}

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

fn closes_fence(line: &str, mark: u8, length: usize) -> bool {
    let Some((found, run)) = fence_mark(line) else {
        return false;
    };
    let after = &line[spaces_at(line, 0) + run..];
    found == mark
        && run >= length
        && (after.trim_start_matches([' ', '\t']).is_empty() || fence_name(line, mark).is_some())
}

fn fence_name(line: &str, mark: u8) -> Option<&str> {
    let run = line[spaces_at(line, 0)..]
        .bytes()
        .take_while(|&one| one == mark)
        .count();
    let after = &line[spaces_at(line, 0) + run..];
    let spaced = after.trim_start_matches([' ', '\t']);
    if spaced.len() == after.len() {
        return None;
    }
    let name = spaced.strip_prefix('^')?.trim_end_matches([' ', '\t']);
    (!name.is_empty()
        && name
            .bytes()
            .all(|one| one.is_ascii_alphanumeric() || one == b'-'))
    .then_some(name)
}

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

fn spaces_at(line: &str, at: usize) -> usize {
    line.as_bytes().get(at..).map_or(0, |rest| {
        rest.iter().take_while(|&&one| one == b' ').count()
    })
}

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

    #[test]
    fn every_parser_of_a_fence_reads_the_one_table() {
        let table: Vec<(String, String, Vec<String>)> = serde_json::from_str(include_str!(
            "../../../../packages/markdown/src/fence-table.json"
        ))
        .expect("the table parses");

        for (note, shape, ids) in table {
            assert_eq!(walk(&note), shape, "{note:?}");
            let mut code = CodeBlocks::default();
            let found: Vec<String> = note
                .split('\n')
                .filter_map(|line| {
                    code.line(line);
                    code.closed_name().map(str::to_string)
                })
                .collect();
            assert_eq!(found, ids, "{note:?}");
        }
    }

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
