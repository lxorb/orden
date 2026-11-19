use std::cell::{Cell, OnceCell};
use std::cmp::Ordering;
use std::collections::HashMap;

use serde::Serialize;

use crate::code_blocks::{CodeBlocks, CodeLine};
use crate::front_matter::block as front_matter_block;
use crate::query::{Compare, Query, Unit};
use crate::regex::{budget_for, is_space, Pattern};
use crate::tags::tags_in;
use crate::tasks::task_at;

const LINE: usize = 200;
#[derive(Clone, Copy)]
struct Region {
    from: usize,
    to: usize,
}
struct Span {
    from: usize,
    to: usize,
}
#[derive(Serialize, Clone)]
pub struct Range {
    pub(crate) from: usize,
    pub(crate) to: usize,
}
#[derive(Serialize, Clone)]
pub struct Hit {
    path: String,
    name: String,
    line: usize,
    text: String,
    ranges: Vec<Range>,
    #[serde(skip_serializing_if = "std::ops::Not::not")]
    bare: bool,
}
pub struct Note<'a> {
    pub path: &'a str,
    pub relative: &'a str,
    pub name: &'a str,
    pub body: &'a str,
    lowered: OnceCell<String>,
}
impl<'a> Note<'a> {
    #[must_use]
    pub fn new(path: &'a str, relative: &'a str, name: &'a str, body: &'a str) -> Self {
        Self {
            path,
            relative,
            name,
            body,
            lowered: OnceCell::new(),
        }
    }
    pub(crate) fn folded(&self) -> &str {
        self.lowered.get_or_init(|| fold(self.body))
    }
}
enum Term {
    All(Vec<Term>),
    Any(Vec<Term>),
    Not(Box<Term>),
    Text {
        needle: String,
        folded: bool,
        body: bool,
    },
    Regex(Option<Pattern>),
    Path {
        needle: String,
        folded: bool,
    },
    File {
        needle: String,
        folded: bool,
    },
    Tag(String),
    Property {
        name: String,
        value: Option<String>,
        compare: Compare,
        upto: Option<String>,
    },
    Scope {
        unit: Unit,
        of: Box<Term>,
        bare: bool,
    },
}
#[derive(Default)]
struct Needs {
    tags: bool,
    front: bool,
    units: [bool; UNITS],
}
struct Facts<'a> {
    body: &'a str,
    starts: OnceCell<Vec<usize>>,
    tags: Vec<String>,
    front: HashMap<String, Vec<String>>,
    units: [Vec<Region>; UNITS],
    budget: Cell<usize>,
}
impl Facts<'_> {
    fn starts(&self) -> &[usize] {
        self.starts.get_or_init(|| line_starts(self.body))
    }
    fn units_of(&self, unit: Unit) -> Units<'_> {
        if matches!(unit, Unit::Line) {
            Units::Lines {
                body: self.body,
                starts: self.starts(),
                at: 0,
            }
        } else {
            Units::Held(self.units[slot(unit)].iter())
        }
    }
}
enum Units<'a> {
    Lines {
        body: &'a str,
        starts: &'a [usize],
        at: usize,
    },
    Held(std::slice::Iter<'a, Region>),
}
impl Iterator for Units<'_> {
    type Item = Region;
    fn next(&mut self) -> Option<Region> {
        match self {
            Units::Lines { body, starts, at } => {
                let from = *starts.get(*at)?;
                let to = line_end(body, starts, *at);
                *at += 1;
                Some(Region { from, to })
            }
            Units::Held(rest) => rest.next().copied(),
        }
    }
}
fn slot(unit: Unit) -> usize {
    match unit {
        Unit::Line => 0,
        Unit::Block => 1,
        Unit::Section => 2,
        Unit::Task => 3,
        Unit::TaskTodo => 4,
        Unit::TaskDone => 5,
    }
}
const UNITS: usize = 6;
#[derive(Copy, Clone)]
enum Wanted {
    Any,
    Todo,
    Done,
}
impl Wanted {
    fn takes(self, done: bool) -> bool {
        match self {
            Self::Any => true,
            Self::Todo => !done,
            Self::Done => done,
        }
    }
}
fn task_state(unit: Unit) -> Option<Wanted> {
    match unit {
        Unit::Task => Some(Wanted::Any),
        Unit::TaskTodo => Some(Wanted::Todo),
        Unit::TaskDone => Some(Wanted::Done),
        Unit::Line | Unit::Block | Unit::Section => None,
    }
}
fn fold_char(one: char) -> char {
    let mut lower = one.to_lowercase();
    match (lower.next(), lower.next()) {
        (Some(only), None) if only.len_utf8() == one.len_utf8() => only,
        _ => one,
    }
}
pub(crate) fn fold(text: &str) -> String {
    if text.is_ascii() {
        return text.to_ascii_lowercase();
    }
    let mut out = String::with_capacity(text.len());
    for one in text.chars() {
        out.push(if one.is_ascii() {
            one.to_ascii_lowercase()
        } else {
            fold_char(one)
        });
    }
    out
}
fn line_starts(body: &str) -> Vec<usize> {
    let mut starts = vec![0];
    starts.extend(body.match_indices('\n').map(|(at, _)| at + 1));
    starts
}
fn line_at(starts: &[usize], offset: usize) -> usize {
    let mut low = 0;
    let mut high = starts.len().saturating_sub(1);
    while low < high {
        let middle = low + (high - low).div_ceil(2);
        if starts.get(middle).is_some_and(|start| *start <= offset) {
            low = middle;
        } else {
            high = middle.saturating_sub(1);
        }
    }
    low
}
fn is_heading(line: &str) -> bool {
    let rest = line.trim_start_matches(' ');
    if line.len() - rest.len() > 3 {
        return false;
    }
    let hashes = rest.chars().take_while(|one| *one == '#').count();
    if hashes == 0 || hashes > 6 {
        return false;
    }
    rest.chars().nth(hashes).is_none_or(char::is_whitespace)
}
fn line_end(body: &str, starts: &[usize], index: usize) -> usize {
    let Some(&next) = starts.get(index + 1) else {
        return body.len();
    };
    let start = starts.get(index).copied().unwrap_or(0);
    if next >= start + 2 && body.as_bytes().get(next - 2) == Some(&b'\r') {
        next - 2
    } else {
        next - 1
    }
}
fn units_in(body: &str, starts: &[usize], unit: Unit) -> Vec<Region> {
    let end_of = |index: usize| line_end(body, starts, index);
    let mut code = CodeBlocks::default();
    if let Some(state) = task_state(unit) {
        let mut found = Vec::new();
        for (index, &start) in starts.iter().enumerate() {
            let end = end_of(index);
            let text = body.get(start..end).unwrap_or_default();
            if code.line(text) != CodeLine::Words {
                continue;
            }
            let Some(task) = task_at(text) else {
                continue;
            };
            if !state.takes(task.done) {
                continue;
            }
            found.push(Region {
                from: start + task.marker,
                to: end,
            });
        }
        return found;
    }
    let sectioned = matches!(unit, Unit::Section);
    let mut out = Vec::new();
    let mut open: Option<usize> = None;
    for (index, &start) in starts.iter().enumerate() {
        let text = body.get(start..end_of(index)).unwrap_or_default();
        let previous = if index == 0 { start } else { end_of(index - 1) };
        let breaks = if sectioned {
            code.line(text) == CodeLine::Words && is_heading(text)
        } else {
            text.trim().is_empty()
        };
        if breaks {
            if let Some(from) = open.take() {
                out.push(Region { from, to: previous });
            }
            if sectioned {
                open = Some(start);
            }
        } else if open.is_none() {
            open = Some(start);
        }
    }
    if let Some(from) = open {
        out.push(Region {
            from,
            to: body.len(),
        });
    }
    out
}
fn front_matter(body: &str) -> HashMap<String, Vec<String>> {
    let mut out = HashMap::new();
    let Some(block) = front_matter_block(body) else {
        return out;
    };
    for line in body[block.from..block.close].lines() {
        if line.starts_with(char::is_whitespace) {
            continue;
        }
        let Some((name, _)) = crate::front_matter::key_of(line) else {
            continue;
        };
        if name.is_empty() {
            continue;
        }
        out.entry(name.to_lowercase())
            .or_insert_with(|| crate::front_matter::list(body, &block, &name));
    }
    out
}
fn literals(hay: &str, needle: &str, region: Region) -> Option<Vec<Span>> {
    if needle.is_empty() {
        return None;
    }
    let mut out = Vec::new();
    let mut at = region.from;
    while at <= region.to {
        let Some(found) = hay.get(at..region.to).and_then(|rest| rest.find(needle)) else {
            break;
        };
        let from = at + found;
        at = from + needle.len();
        out.push(Span { from, to: at });
    }
    (!out.is_empty()).then_some(out)
}
fn patterned(
    pattern: &Pattern,
    body: &str,
    region: Region,
    budget: &Cell<usize>,
) -> Option<Vec<Span>> {
    let slice = body.get(region.from..region.to)?;
    let mut found = pattern.find_within(slice, 0, budget)?;
    let mut out = Vec::new();
    loop {
        let at = if found.to == found.from {
            let letter = slice
                .get(found.from..)
                .and_then(|rest| rest.chars().next())
                .map_or(1, char::len_utf8);
            found.from + letter
        } else {
            out.push(Span {
                from: region.from + found.from,
                to: region.from + found.to,
            });
            found.to
        };
        if at > slice.len() {
            break;
        }
        let Some(next) = pattern.find_within(slice, at, budget) else {
            break;
        };
        found = next;
    }
    (!out.is_empty()).then_some(out)
}
fn clip(one: Region, other: Region) -> Option<Region> {
    let from = one.from.max(other.from);
    let to = one.to.min(other.to);
    (from <= to).then_some(Region { from, to })
}
pub(crate) fn utf16_at(text: &str, byte: usize) -> usize {
    text.get(..byte)
        .unwrap_or_default()
        .chars()
        .map(char::len_utf16)
        .sum()
}
pub struct Matcher {
    root: Term,
    needs: Needs,
}
impl Matcher {
    #[must_use]
    pub fn new(query: Query) -> Self {
        let mut needs = Needs::default();
        let root = compile(query, &mut needs);
        Self { root, needs }
    }
    #[must_use]
    pub fn hits(&self, note: &Note, most: usize) -> Vec<Hit> {
        if most == 0 {
            return Vec::new();
        }
        let facts = self.facts(note.body);
        let whole = Region {
            from: 0,
            to: note.body.len(),
        };
        let Some(mut spans) = walk(&self.root, note, &facts, whole) else {
            return Vec::new();
        };
        if spans.is_empty() {
            let past = past_front_matter(note.body, facts.starts());
            let line = (past..facts.starts().len())
                .find(|&index| {
                    !line_text(note.body, facts.starts(), index)
                        .trim()
                        .is_empty()
                })
                .unwrap_or(0);
            return vec![row(note, facts.starts(), line, &[])];
        }
        spans.sort_by_key(|span| span.from);
        let mut out: Vec<Hit> = Vec::new();
        let mut current: Vec<Span> = Vec::new();
        let mut at: Option<usize> = None;
        for span in spans {
            let line = line_at(facts.starts(), span.from);
            if at != Some(line) {
                if let Some(previous) = at {
                    out.push(row(note, facts.starts(), previous, &current));
                    if out.len() >= most {
                        return out;
                    }
                }
                current = Vec::new();
                at = Some(line);
            }
            current.push(span);
        }
        if let Some(previous) = at {
            out.push(row(note, facts.starts(), previous, &current));
        }
        out.truncate(most);
        out
    }
    fn facts<'a>(&self, body: &'a str) -> Facts<'a> {
        let wanted = self.needs.units.iter().any(|one| *one);
        let starts = if wanted {
            OnceCell::from(line_starts(body))
        } else {
            OnceCell::new()
        };
        let unit_of = |unit: Unit| {
            if self.needs.units[slot(unit)] && !matches!(unit, Unit::Line) {
                units_in(body, starts.get().map_or(&[][..], Vec::as_slice), unit)
            } else {
                Vec::new()
            }
        };
        let units = [
            unit_of(Unit::Line),
            unit_of(Unit::Block),
            unit_of(Unit::Section),
            unit_of(Unit::Task),
            unit_of(Unit::TaskTodo),
            unit_of(Unit::TaskDone),
        ];
        Facts {
            body,
            tags: if self.needs.tags {
                tags_in(body)
                    .iter()
                    .map(|tag| tag_path(tag.strip_prefix('#').unwrap_or(tag)))
                    .collect()
            } else {
                Vec::new()
            },
            front: if self.needs.front {
                front_matter(body)
            } else {
                HashMap::new()
            },
            units,
            starts,
            budget: Cell::new(budget_for(body.len())),
        }
    }
}
fn patterned_in(term: &Term) -> bool {
    match term {
        Term::Regex(_) => true,
        Term::All(of) | Term::Any(of) => of.iter().any(patterned_in),
        Term::Not(of) | Term::Scope { of, .. } => patterned_in(of),
        _ => false,
    }
}
fn walk(term: &Term, note: &Note, facts: &Facts, region: Region) -> Option<Vec<Span>> {
    match term {
        Term::All(of) => {
            let mut out = Vec::new();
            for one in of {
                out.append(&mut walk(one, note, facts, region)?);
            }
            Some(out)
        }
        Term::Any(of) => {
            let mut out = Vec::new();
            let mut answered = false;
            for one in of {
                if let Some(mut found) = walk(one, note, facts, region) {
                    answered = true;
                    out.append(&mut found);
                }
            }
            answered.then_some(out)
        }
        Term::Not(of) => {
            let found = walk(of, note, facts, region);
            let undecided = facts.budget.get() == 0 && patterned_in(of);
            (found.is_none() && !undecided).then(Vec::new)
        }
        Term::Text {
            needle,
            folded,
            body,
        } => {
            let within = if *body {
                clip(
                    Region {
                        from: words_in(note.body),
                        to: note.body.len(),
                    },
                    region,
                )?
            } else {
                region
            };
            literals(
                if *folded { note.folded() } else { note.body },
                needle,
                within,
            )
        }
        Term::Regex(pattern) => patterned(pattern.as_ref()?, note.body, region, &facts.budget),
        Term::Path { needle, folded } => holds(note.relative, needle, *folded).then(Vec::new),
        Term::File { needle, folded } => holds(note.name, needle, *folded).then(Vec::new),
        Term::Tag(wanted) => facts
            .tags
            .iter()
            .any(|tag| tag == wanted || under(tag, wanted))
            .then(Vec::new),
        Term::Property {
            name,
            value,
            compare,
            upto,
        } => {
            let held = facts.front.get(name);
            if matches!(compare, Compare::Null) {
                return held
                    .is_none_or(|all| {
                        all.iter()
                            .all(|one| matches!(one.trim(), "" | "~" | "null" | "Null" | "NULL"))
                    })
                    .then(Vec::new);
            }
            let held = held?;
            match value {
                None => Some(Vec::new()),
                Some(wanted) => held
                    .iter()
                    .any(|one| held_against(one, wanted, *compare, upto.as_deref()))
                    .then(Vec::new),
            }
        }
        Term::Scope { unit, of, bare } => {
            let mut out = Vec::new();
            let mut answered = false;
            for one in facts.units_of(*unit) {
                let Some(within) = clip(one, region) else {
                    continue;
                };
                if let Some(mut found) = walk(of, note, facts, within) {
                    answered = true;
                    if *bare {
                        out.push(Span {
                            from: within.from,
                            to: within.from,
                        });
                    } else {
                        out.append(&mut found);
                    }
                }
            }
            answered.then_some(out)
        }
    }
}
fn tag_path(tag: &str) -> String {
    tag.to_lowercase()
        .split('/')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("/")
}
fn under(tag: &str, parent: &str) -> bool {
    tag.starts_with(parent) && tag.as_bytes().get(parent.len()) == Some(&b'/')
}
fn words_in(body: &str) -> usize {
    front_matter_block(body).map_or(0, |block| (block.end + 1).min(body.len()))
}
fn past_front_matter(body: &str, starts: &[usize]) -> usize {
    let Some(block) = front_matter_block(body) else {
        return 0;
    };
    starts
        .iter()
        .position(|&start| start > block.close)
        .unwrap_or(starts.len())
}
fn a_number(said: &str) -> bool {
    let bytes = said.as_bytes();
    let mut at = usize::from(bytes.first() == Some(&b'-'));
    let digits = at;
    while matches!(bytes.get(at), Some(b'0'..=b'9')) {
        at += 1;
    }
    if at == digits {
        return false;
    }
    if bytes.get(at) == Some(&b'.') {
        at += 1;
        let after = at;
        while matches!(bytes.get(at), Some(b'0'..=b'9')) {
            at += 1;
        }
        if at == after {
            return false;
        }
    }
    at == bytes.len()
}
fn wall_clock(said: &str) -> Option<&str> {
    let bytes = said.as_bytes();
    let digits = |at: usize, many: usize| {
        (0..many).all(|step| matches!(bytes.get(at + step), Some(b'0'..=b'9')))
    };
    if !(digits(0, 4)
        && bytes.get(4) == Some(&b'-')
        && digits(5, 2)
        && bytes.get(7) == Some(&b'-')
        && digits(8, 2))
    {
        return None;
    }
    if bytes.len() == 10 {
        return Some(said);
    }
    if !matches!(bytes.get(10), Some(b'T' | b't' | b' ')) {
        return None;
    }
    if !(digits(11, 2) && bytes.get(13) == Some(&b':') && digits(14, 2)) {
        return None;
    }
    let mut at = 16;
    if bytes.get(at) == Some(&b':') && digits(at + 1, 2) {
        at += 3;
    }
    let clock = at;
    if bytes.get(at) == Some(&b'.') && digits(at + 1, 1) {
        at += 1;
        while digits(at, 1) {
            at += 1;
        }
    }
    match bytes.get(at) {
        Some(b'Z' | b'z') => at += 1,
        Some(b'+' | b'-') if digits(at + 1, 2) => {
            at += 3;
            if bytes.get(at) == Some(&b':') {
                at += 1;
            }
            if !digits(at, 2) {
                return None;
            }
            at += 2;
        }
        _ => {}
    }
    (at == bytes.len()).then(|| &said[..clock])
}
fn order(value: &str, asked: &str) -> Ordering {
    let one = value.trim();
    let other = asked.trim();
    if a_number(one) && a_number(other) {
        let here: f64 = one.parse().unwrap_or(f64::NAN);
        let there: f64 = other.parse().unwrap_or(f64::NAN);
        return here.partial_cmp(&there).unwrap_or(Ordering::Equal);
    }
    if let (Some(here), Some(there)) = (wall_clock(one), wall_clock(other)) {
        let shared = here.len().min(there.len());
        let even = |said: &str| said[..shared].replacen([' ', 't'], "T", 1);
        return even(here).cmp(&even(there));
    }
    one.to_lowercase().cmp(&other.to_lowercase())
}
fn alike(value: &str, asked: &str) -> bool {
    let one = value.trim();
    let other = asked.trim();
    let measured = (a_number(one) && a_number(other))
        || (wall_clock(one).is_some() && wall_clock(other).is_some());
    if measured {
        order(one, other) == Ordering::Equal
    } else {
        one.to_lowercase() == other.to_lowercase()
    }
}
fn held_against(value: &str, asked: &str, compare: Compare, upto: Option<&str>) -> bool {
    let ordered = !matches!(compare, Compare::Has | Compare::Is);
    if ordered && matches!(value.trim(), "" | "~" | "null" | "Null" | "NULL") {
        return false;
    }
    match compare {
        Compare::Has => holds(value, &asked.to_lowercase(), true),
        Compare::Is => alike(value, asked),
        Compare::Lt => order(value, asked) == Ordering::Less,
        Compare::Lte => order(value, asked) != Ordering::Greater,
        Compare::Gt => order(value, asked) == Ordering::Greater,
        Compare::Gte => order(value, asked) != Ordering::Less,
        Compare::Range => {
            order(value, asked) != Ordering::Less
                && order(value, upto.unwrap_or(asked)) != Ordering::Greater
        }
        Compare::Null => false,
    }
}
fn holds(hay: &str, needle: &str, folded: bool) -> bool {
    if folded {
        hay.to_lowercase().contains(needle)
    } else {
        hay.contains(needle)
    }
}
fn line_text<'a>(body: &'a str, starts: &[usize], line: usize) -> &'a str {
    let from = starts.get(line).copied().unwrap_or_default();
    let to = starts.get(line + 1).map_or(body.len(), |next| next - 1);
    body.get(from..to).unwrap_or_default()
}
fn row(note: &Note, starts: &[usize], line: usize, spans: &[Span]) -> Hit {
    let from = starts.get(line).copied().unwrap_or_default();
    let raw = line_text(note.body, starts, line);
    let lead = raw.len() - raw.trim_start_matches(is_space).len();
    let trimmed = raw.trim_matches(is_space);
    let text: String = trimmed.chars().take(LINE).collect();
    let mut ranges = Vec::new();
    for span in spans {
        let start = span.from.saturating_sub(from + lead);
        let end = span.to.saturating_sub(from + lead).min(text.len());
        if start < end {
            ranges.push(Range {
                from: utf16_at(&text, start),
                to: utf16_at(&text, end),
            });
        }
    }
    Hit {
        path: note.path.to_string(),
        name: note.name.to_string(),
        line,
        text,
        ranges,
        bare: !spans.iter().any(|span| span.from < span.to),
    }
}
fn compile(query: Query, needs: &mut Needs) -> Term {
    match query {
        Query::All { of } => Term::All(of.into_iter().map(|one| compile(one, needs)).collect()),
        Query::Any { of } => Term::Any(of.into_iter().map(|one| compile(one, needs)).collect()),
        Query::Not { of } => Term::Not(Box::new(compile(*of, needs))),
        Query::Text { text, fold: folded } => Term::Text {
            needle: if folded { fold(&text) } else { text },
            folded,
            body: false,
        },
        Query::Content { text, fold: folded } => Term::Text {
            needle: if folded { fold(&text) } else { text },
            folded,
            body: true,
        },
        Query::Regex {
            source,
            fold,
            refused,
        } => Term::Regex(if refused {
            None
        } else {
            Pattern::compile(&source, fold)
        }),
        Query::Path { text, fold: folded } => Term::Path {
            needle: if folded { text.to_lowercase() } else { text },
            folded,
        },
        Query::File { text, fold: folded } => Term::File {
            needle: if folded { text.to_lowercase() } else { text },
            folded,
        },
        Query::Tag { tag } => {
            needs.tags = true;
            Term::Tag(tag_path(&tag))
        }
        Query::Property {
            name,
            value,
            compare,
            upto,
        } => {
            needs.front = true;
            Term::Property {
                name: name.to_lowercase(),
                value,
                compare,
                upto,
            }
        }
        Query::Scope { unit, of } => {
            needs.units[slot(unit)] = true;
            let bare = matches!(&*of, Query::All { of } if of.is_empty());
            Term::Scope {
                unit,
                of: Box::new(compile(*of, needs)),
                bare,
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::{line_at, line_starts, Matcher, Note};
    use crate::query::Query;

    const NOTE: &str = "---\nstatus: done\nproject: Orden\n---\n\n# Meeting notes #work/2026\n\nAlpha met Beta on Monday.\nGamma was away.\n\n## Later\n\nBeta wrote it up. #done\n\n```\n#notatag\n```\n";
    const CLOSE: &str = "alpha here\nbeta there\n\nalpha and beta\n";
    fn matcher(json: &str) -> Matcher {
        let query: Query = serde_json::from_str(json).expect("a query the app could have sent");
        Matcher::new(query)
    }
    fn note(body: &str) -> Note<'_> {
        Note::new(
            "/space/Work/Meeting.md",
            "Work/Meeting.md",
            "Meeting.md",
            body,
        )
    }
    #[test]
    fn a_note_folds_itself_once() {
        let note = note("The Quarter Plan");
        assert_eq!(note.folded(), "the quarter plan");
        assert!(std::ptr::eq(note.folded(), note.folded()));
    }
    fn answers(json: &str, body: &str) -> bool {
        !matcher(json).hits(&note(body), 50).is_empty()
    }
    fn lines(json: &str, body: &str) -> Vec<String> {
        matcher(json)
            .hits(&note(body), 50)
            .into_iter()
            .map(|hit| hit.text)
            .collect()
    }
    fn marked(json: &str, body: &str) -> Vec<String> {
        matcher(json)
            .hits(&note(body), 50)
            .into_iter()
            .flat_map(|hit| {
                let units: Vec<u16> = hit.text.encode_utf16().collect();
                hit.ranges
                    .into_iter()
                    .map(|range| {
                        String::from_utf16_lossy(
                            units.get(range.from..range.to).unwrap_or_default(),
                        )
                    })
                    .collect::<Vec<String>>()
            })
            .collect()
    }
    fn text(word: &str) -> String {
        format!(r#"{{"kind":"text","text":"{word}","fold":true}}"#)
    }
    fn exact(word: &str) -> String {
        format!(r#"{{"kind":"text","text":"{word}","fold":false}}"#)
    }
    fn content(word: &str) -> String {
        format!(r#"{{"kind":"content","text":"{word}","fold":true}}"#)
    }
    fn all(parts: &[String]) -> String {
        format!(r#"{{"kind":"all","of":[{}]}}"#, parts.join(","))
    }
    fn any(parts: &[String]) -> String {
        format!(r#"{{"kind":"any","of":[{}]}}"#, parts.join(","))
    }
    fn without(part: &str) -> String {
        format!(r#"{{"kind":"not","of":{part}}}"#)
    }
    fn scope(unit: &str, part: &str) -> String {
        format!(r#"{{"kind":"scope","unit":"{unit}","of":{part}}}"#)
    }
    fn pattern(source: &str, fold: bool) -> String {
        format!(r#"{{"kind":"regex","source":"{source}","fold":{fold}}}"#)
    }
    #[test]
    fn a_pattern_the_page_refused_finds_nothing() {
        let refused = r#"{"kind":"regex","source":"(\\d+\\.?)+","fold":false,"refused":true}"#;
        assert!(!answers(refused, "Version 1.2.3 shipped"));
        assert!(answers(
            &pattern(r"(\\d+\\.?)+", false),
            "Version 1.2.3 shipped"
        ));
        let not = format!(r#"{{"kind":"not","of":{refused}}}"#);
        assert!(answers(&not, "Version 1.2.3 shipped"));
    }
    #[test]
    fn a_section_and_a_task_stop_at_nothing_inside_a_code_fence() {
        let body = "# One\nalpha\n```sh\n# comment\n```\nbeta\n";
        assert!(answers(
            &scope("section", &all(&[text("alpha"), text("beta")])),
            body
        ));
        assert!(!answers(
            &scope("section", &all(&[text("alpha"), text("gamma")])),
            body
        ));
        let body = "```\n- [ ] not a task\n```\n- [ ] a task\n";
        assert_eq!(lines(&scope("task", &text("task")), body), ["- [ ] a task"]);
    }
    #[test]
    fn a_line_is_shown_without_the_marks_the_web_trims_off_it() {
        assert_eq!(
            lines(&text("alpha"), "\u{feff}alpha one\n"),
            vec!["alpha one"]
        );
        assert_eq!(
            lines(&text("alpha"), "\u{85}alpha\u{a0}\n"),
            vec!["\u{85}alpha"]
        );
    }
    #[test]
    fn words_match_anywhere_folded_in_any_order_one_row_per_line() {
        assert!(answers(&text("alpha"), NOTE));
        assert!(answers(&text("ALPHA"), NOTE));
        assert!(!answers(&text("zeta"), NOTE));
        assert!(answers(&all(&[text("alpha"), text("gamma")]), NOTE));
        assert!(answers(&all(&[text("gamma"), text("alpha")]), NOTE));
        assert!(!answers(&all(&[text("alpha"), text("zeta")]), NOTE));
        assert_eq!(lines(&text("gamma"), NOTE), ["Gamma was away."]);
        assert_eq!(marked(&text("gamma"), NOTE), ["Gamma"]);
        assert_eq!(
            lines(&text("beta"), NOTE),
            ["Alpha met Beta on Monday.", "Beta wrote it up. #done"]
        );
        assert!(answers(&text("met Beta"), NOTE));
        assert!(!answers(&text("Beta met"), NOTE));
        assert!(answers(&text("ALPHA"), NOTE));
        assert!(!answers(&exact("ALPHA"), NOTE));
        assert!(answers(&exact("Alpha"), NOTE));
        let path = |one: &str| format!(r#"{{"kind":"path","text":"{one}","fold":true}}"#);
        assert!(answers(&path("Work/"), NOTE));
        assert!(answers(&path("work/"), NOTE));
        assert!(!answers(&path("Drafts/"), NOTE));
    }
    #[test]
    fn excluding_turns_a_match_into_a_miss() {
        assert!(!answers(
            &all(&[text("alpha"), without(&text("gamma"))]),
            NOTE
        ));
        assert!(answers(
            &all(&[text("alpha"), without(&text("zeta"))]),
            NOTE
        ));
        assert!(answers(&without(&text("zeta")), NOTE));
        assert!(!answers(&without(&text("alpha")), NOTE));
    }
    #[test]
    fn or_takes_either_side() {
        assert!(answers(&any(&[text("zeta"), text("gamma")]), NOTE));
        assert!(!answers(&any(&[text("zeta"), text("omega")]), NOTE));
        assert_eq!(
            lines(&any(&[text("gamma"), text("zeta")]), NOTE),
            ["Gamma was away."]
        );
    }
    #[test]
    fn file_reads_the_note_name_and_shows_a_line_it_never_says() {
        let file = |one: &str| format!(r#"{{"kind":"file","text":"{one}","fold":true}}"#);
        assert!(answers(&file("Meeting"), NOTE));
        assert!(!answers(&file("Agenda"), NOTE));
        assert_eq!(
            lines(&file("Meeting"), NOTE),
            ["# Meeting notes #work/2026"]
        );
        assert!(marked(&file("Meeting"), NOTE).is_empty());
        assert_eq!(
            lines(&file("Meeting"), "\nthe first words\n"),
            ["the first words"]
        );
        assert_eq!(lines(&file("Meeting"), "---\nstatus: done\n"), ["---"]);
    }
    #[test]
    fn content_asks_the_notes_own_words_and_not_its_front_matter() {
        assert!(answers(&text("orden"), NOTE));
        assert!(!answers(&content("orden"), NOTE));
        assert!(answers(&text("status"), NOTE));
        assert!(!answers(&content("status"), NOTE));
        assert!(answers(&content("alpha"), NOTE));
        assert!(answers(&content("alpha"), CLOSE));
        assert!(answers(&content("status"), "---\nstatus: done\n"));
    }
    #[test]
    fn content_brings_back_the_line_folded_like_any_other_word() {
        assert_eq!(lines(&content("GAMMA"), NOTE), ["Gamma was away."]);
        assert_eq!(marked(&content("gamma"), NOTE), ["Gamma"]);
        assert!(answers(
            r#"{"kind":"content","text":"Alpha","fold":false}"#,
            NOTE
        ));
        assert!(!answers(
            r#"{"kind":"content","text":"alpha","fold":false}"#,
            NOTE
        ));
    }
    #[test]
    fn a_tag_matches_itself_and_its_children() {
        let tag = |one: &str| format!(r#"{{"kind":"tag","tag":"{one}"}}"#);
        assert!(answers(&tag("done"), NOTE));
        assert!(!answers(&tag("missing"), NOTE));
        assert!(answers(&tag("work"), NOTE));
        assert!(answers(&tag("work/2026"), NOTE));
        assert!(!answers(&tag("work/2025"), NOTE));
        assert!(!answers(&tag("notatag"), NOTE));
        assert!(!answers(&tag("meeting"), NOTE));
        let tag = |one: &str| format!(r#"{{"kind":"tag","tag":"{one}"}}"#);
        assert!(answers(&tag("a/b"), "see #a//b here\n"));
        assert!(answers(&tag("a"), "see #a//b here\n"));
        assert!(answers(&tag("a//b"), "see #a/b here\n"));
    }
    #[test]
    fn front_matter_answers_for_a_key_and_for_what_it_says() {
        let key = |one: &str| format!(r#"{{"kind":"property","name":"{one}","value":null}}"#);
        let pair = |one: &str, said: &str| {
            format!(r#"{{"kind":"property","name":"{one}","value":"{said}"}}"#)
        };
        assert!(answers(&key("status"), NOTE));
        assert!(!answers(&key("due"), NOTE));
        assert!(answers(&pair("status", "done"), NOTE));
        assert!(!answers(&pair("status", "open"), NOTE));
        assert!(!answers(&key("later"), NOTE));
        assert!(!answers(&key("status"), "status: done\n"));
    }
    #[test]
    fn front_matter_answers_for_every_member_of_a_list_and_a_value_however_written() {
        let pair = |one: &str, said: &str, compare: &str| {
            format!(
                r#"{{"kind":"property","name":"{one}","value":"{said}","compare":"{compare}"}}"#
            )
        };
        let missing = |one: &str| {
            format!(r#"{{"kind":"property","name":"{one}","value":null,"compare":"null"}}"#)
        };
        let listed = "---\nauthors:\n  - Herbert\n  - Ursula\ntags: [a, b] # old\n---\n\nWords.\n";
        assert!(answers(&pair("authors", "herbert", "has"), listed));
        assert!(answers(&pair("authors", "Ursula", "is"), listed));
        assert!(!answers(&pair("authors", "Frank", "has"), listed));
        assert!(answers(&pair("tags", "a", "is"), listed));
        assert!(answers(&pair("tags", "b", "is"), listed));
        assert!(!answers(&pair("tags", "old", "has"), listed));
        assert!(!answers(&missing("authors"), listed));
        let quoted = "---\nstatus: \"done\"\nnext: done # soon\nempty:\n---\n";
        assert!(answers(&pair("status", "done", "is"), quoted));
        assert!(answers(&pair("next", "done", "is"), quoted));
        assert!(answers(&missing("empty"), quoted));
    }
    #[test]
    fn front_matter_keys_and_lists_are_read_as_the_web_search_reads_them() {
        let pair = |one: &str, said: &str, compare: &str| {
            format!(
                r#"{{"kind":"property","name":"{one}","value":"{said}","compare":"{compare}"}}"#
            )
        };
        let written = "---\n\"status\": done\nauthors: ['Doe, Jane', Other]\n---\n";
        assert!(answers(&pair("status", "done", "is"), written));
        assert!(answers(&pair("authors", "Doe, Jane", "is"), written));
        assert!(!answers(&pair("authors", "Jane'", "is"), written));
    }
    #[test]
    fn a_date_and_time_asked_for_is_held_against_one_written_with_a_space() {
        let pair = |said: &str, compare: &str| {
            format!(r#"{{"kind":"property","name":"due","value":"{said}","compare":"{compare}"}}"#)
        };
        let note = "---\ndue: 2024-01-01 11:00\n---\n";
        assert!(answers(&pair("2024-01-01T10:00", "gt"), note));
        assert!(!answers(&pair("2024-01-01T12:00", "gt"), note));
        assert!(answers(&pair("DUE", "has"), "---\ndue: Due soon\n---\n"));
    }
    #[test]
    fn a_bare_day_is_the_whole_of_that_day_against_a_time_written_on_it() {
        let pair = |said: &str, compare: &str| {
            format!(r#"{{"kind":"property","name":"due","value":"{said}","compare":"{compare}"}}"#)
        };
        let due = |said: &str| format!("---\ndue: {said}\n---\n\nWords.\n");
        assert!(answers(
            &pair("2026-11-15", "lte"),
            &due("2026-11-15 10:00")
        ));
        assert!(answers(&pair("2026-11-15", "is"), &due("2026-11-15 10:00")));
        assert!(!answers(
            &pair("2026-11-15", "gt"),
            &due("2026-11-15 10:00")
        ));
        assert!(answers(&pair("2026-11-16", "lt"), &due("2026-11-15T23:59")));
        assert!(answers(
            &pair("2026-11-15 10:00", "gte"),
            &due("2026-11-15")
        ));
        assert!(answers(
            &pair("2026-11-15 10:00", "lt"),
            &due("2026-11-15T09:00:00Z")
        ));
        assert!(answers(
            &pair("2026-11-15 10:00", "gt"),
            &due("2026-11-15t11:30:00.250+02:00")
        ));
        assert!(!answers(
            &pair("2026-11-15 10:00", "lt"),
            &due("2026-11-15 10:30")
        ));
        assert!(answers(&pair("5", "is"), "---\nn: 5.0\ndue: 5.0\n---\n"));
        assert!(!answers(&pair("5", "is"), "---\ndue: 50\n---\n"));
    }
    #[test]
    fn a_key_yaml_reads_as_null_holds_nothing() {
        let null = r#"{"kind":"property","name":"n","value":null,"compare":"null"}"#;
        for written in ["null", "Null", "NULL", "~"] {
            assert!(answers(null, &format!("---\nn: {written}\n---\n")));
        }
        assert!(!answers(null, "---\nn: nullable\n---\n"));
        let past = r#"{"kind":"property","name":"n","value":"2026-01-01","compare":"gt"}"#;
        assert!(!answers(past, "---\nn: null\n---\n"));
        let listed = r#"{"kind":"property","name":"tags","value":"b","compare":"has"}"#;
        assert!(answers(
            listed,
            "---\ntags:\n  - a\n  # later\n  - b\n---\n"
        ));
    }
    #[test]
    fn a_block_nobody_closed_holds_no_keys() {
        const OPEN: &str = "---\nstatus: done\n\n# Plan\n";
        let key = |one: &str| format!(r#"{{"kind":"property","name":"{one}","value":null}}"#);
        let pair = |one: &str, said: &str| {
            format!(r#"{{"kind":"property","name":"{one}","value":"{said}"}}"#)
        };
        let file = |one: &str| format!(r#"{{"kind":"file","text":"{one}","fold":true}}"#);
        assert!(!answers(&key("status"), OPEN));
        assert!(!answers(&pair("status", "done"), OPEN));
        assert_eq!(lines(&file("Meeting"), OPEN), ["---"]);
    }
    #[test]
    fn front_matter_is_held_against_a_number_a_date_or_a_range() {
        const NUMBERS: &str =
            "---\nduration: 4\ndue: 2026-09-01\npages: 150\nstatus: done\nempty:\n---\n\nWords.\n";
        let held = |name: &str, said: &str, compare: &str| {
            format!(
                r#"{{"kind":"property","name":"{name}","value":"{said}","compare":"{compare}"}}"#
            )
        };
        let ranged = |name: &str, from: &str, to: &str| {
            format!(
                r#"{{"kind":"property","name":"{name}","value":"{from}","compare":"range","upto":"{to}"}}"#
            )
        };
        let missing = |name: &str| {
            format!(r#"{{"kind":"property","name":"{name}","value":null,"compare":"null"}}"#)
        };
        assert!(answers(&held("duration", "5", "lt"), NUMBERS));
        assert!(!answers(&held("duration", "4", "lt"), NUMBERS));
        assert!(answers(&held("duration", "4", "lte"), NUMBERS));
        assert!(answers(&held("duration", "3", "gt"), NUMBERS));
        assert!(!answers(&held("duration", "5", "gte"), NUMBERS));
        assert!(answers(&held("due", "2026-08-31", "gt"), NUMBERS));
        assert!(answers(&held("due", "2026-10-01", "lt"), NUMBERS));
        assert!(!answers(&held("due", "2026-09-02", "gt"), NUMBERS));
        assert!(answers(&ranged("pages", "100", "200"), NUMBERS));
        assert!(answers(&ranged("pages", "150", "150"), NUMBERS));
        assert!(!answers(&ranged("pages", "151", "200"), NUMBERS));
        assert!(answers(&held("status", "don", "has"), NUMBERS));
        assert!(!answers(&held("status", "don", "is"), NUMBERS));
        assert!(answers(&held("status", "done", "is"), NUMBERS));
        assert!(answers(&missing("missing"), NUMBERS));
        assert!(!answers(&missing("status"), NUMBERS));
        assert!(answers(&missing("empty"), NUMBERS));
        assert!(answers(&held("status", "a", "gt"), NUMBERS));
        assert!(!answers(&held("status", "z", "gt"), NUMBERS));
        assert!(!answers(&held("due", "5", "gt"), NUMBERS));
        assert!(answers(&held("due", "5", "lt"), NUMBERS));
    }
    #[test]
    fn a_task_is_a_unit_and_the_row_is_the_task() {
        const TASKS: &str = "# This week\n\n- [ ] write the plan\n- [x] read the paper\n- [ ] send the ledger\n    - [X] a nested one that is done\n- not a task at all\n";
        assert_eq!(
            lines(&scope("task", &text("plan")), TASKS),
            vec!["- [ ] write the plan".to_string()]
        );
        assert_eq!(
            lines(&scope("task-todo", &text("the")), TASKS),
            vec![
                "- [ ] write the plan".to_string(),
                "- [ ] send the ledger".to_string(),
            ]
        );
        assert_eq!(
            lines(&scope("task-done", &text("the")), TASKS),
            vec!["- [x] read the paper".to_string()]
        );
        let bare = all(&[]);
        assert_eq!(
            lines(&scope("task-todo", &bare), TASKS),
            vec![
                "- [ ] write the plan".to_string(),
                "- [ ] send the ledger".to_string(),
            ]
        );
        assert_eq!(lines(&scope("task", &bare), TASKS).len(), 4);
        assert_eq!(
            lines(&scope("task-done", &text("nested")), TASKS),
            vec!["- [X] a nested one that is done".to_string()]
        );
        assert!(!answers(&scope("task", &exact("not a task")), TASKS));
        assert!(!answers(&scope("task-done", &text("x")), TASKS));
        assert_eq!(
            lines(&scope("task", &all(&[text("write"), text("plan")])), TASKS),
            vec!["- [ ] write the plan".to_string()]
        );
        assert!(!answers(
            &scope("task", &all(&[text("write"), text("ledger")])),
            TASKS
        ));
        assert!(!answers(&scope("task-todo", &bare), NOTE));
    }
    #[test]
    fn patterns_match_what_they_describe() {
        assert!(answers(&pattern("G[a-z]+a", false), NOTE));
        assert!(!answers(&pattern("Z[a-z]+a", false), NOTE));
        assert!(!answers(&pattern("gamma", false), NOTE));
        assert!(answers(&pattern("gamma", true), NOTE));
        assert_eq!(marked(&pattern("B[a-z]+a on", false), NOTE), ["Beta on"]);
        assert!(!answers(&pattern("([a-", false), NOTE));
        let body = "のnoteのanotherのnote\n";
        assert_eq!(marked(&pattern("note", false), body), ["note", "note"]);
        assert_eq!(marked(&pattern("の.", false), body), ["のn", "のa", "のn"]);
        let body = "a done\r\nb\r\n";
        assert!(answers(&scope("line", &pattern("done$", false)), body));
        assert!(!answers(&scope("line", &pattern("b.$", false)), body));
    }
    #[test]
    fn a_pattern_finds_its_match_in_a_note_of_a_few_pages() {
        let body = format!(
            "{}the zebra\n",
            format!("{}\n", "the cat sat on the mat ".repeat(20)).repeat(10)
        );
        let query = pattern("the.*zebra", false);
        assert_eq!(lines(&query, &body), ["the zebra"]);
        assert!(!answers(
            &format!(r#"{{"kind":"not","of":{query}}}"#),
            &body
        ));
    }
    #[test]
    fn a_pattern_that_runs_out_never_counts_as_missing() {
        let body = format!("{}\n", "a".repeat(30)).repeat(2000);
        let hopeless = pattern("(a+)+b", false);
        assert!(!answers(&hopeless, &body));
        assert!(!answers(
            &format!(r#"{{"kind":"not","of":{hopeless}}}"#),
            &body
        ));
        let absent = format!(r#"{{"kind":"not","of":{}}}"#, text("zzz"));
        assert!(answers(
            &format!(r#"{{"kind":"any","of":[{hopeless},{absent}]}}"#),
            &body
        ));
    }
    #[test]
    fn a_pattern_that_cannot_finish_costs_one_note_one_budget() {
        let line = format!("{}\n", "a".repeat(30));
        let body = line.repeat(2000);
        let query = scope("line", &pattern("(a+)+b", false));
        let started = std::time::Instant::now();
        assert!(!answers(&query, &body));
        let spent = started.elapsed();
        assert!(spent.as_secs() < 5, "{spent:?} for 2000 lines");
    }
    #[test]
    fn nearness_holds_terms_to_one_line_and_one_paragraph() {
        let line = scope("line", &all(&[text("alpha"), text("beta")]));
        assert!(answers(&line, CLOSE));
        assert_eq!(lines(&line, CLOSE), ["alpha and beta"]);
        assert!(!answers(
            &scope("line", &all(&[text("alpha"), text("there")])),
            CLOSE
        ));
        assert!(answers(
            &scope("block", &all(&[text("alpha"), text("there")])),
            CLOSE
        ));
        assert!(!answers(
            &scope("block", &all(&[text("there"), text("and")])),
            CLOSE
        ));
    }
    #[test]
    fn nearness_holds_terms_to_one_section() {
        let body = "# One\n\nalpha\n\nbeta\n\n# Two\n\ngamma\n";
        let together = scope("section", &all(&[text("alpha"), text("beta")]));
        let apart = scope("section", &all(&[text("beta"), text("gamma")]));
        assert!(answers(&together, body));
        assert!(!answers(&apart, body));
        let before = "alpha beta\n\n# One\n\ngamma\n";
        assert!(answers(&together, before));
        assert!(!answers(&apart, before));
    }
    #[test]
    fn nearness_excludes_within_the_line_it_is_given() {
        let one = scope("line", &all(&[text("alpha"), without(&text("beta"))]));
        assert!(answers(&one, CLOSE));
        assert!(!answers(&one, "alpha beta\n"));
    }
    #[test]
    fn a_row_trims_the_line_and_moves_the_mark_with_it() {
        assert_eq!(
            lines(&text("beta"), "   indented Beta here\n"),
            ["indented Beta here"]
        );
        assert_eq!(marked(&text("beta"), "   indented Beta here\n"), ["Beta"]);
    }
    #[test]
    fn a_row_cuts_a_very_long_line_short() {
        let body = format!("{} beta\n", "x".repeat(400));
        let hits = matcher(&text("beta")).hits(&note(&body), 10);
        let first = hits.first().expect("a hit");
        assert_eq!(first.text.chars().count(), 200);
        assert!(first.ranges.is_empty());
    }
    #[test]
    fn a_row_with_no_words_to_replace_says_so() {
        let body = "- [ ] buy milk\n- [ ] call Ana\nmilk here\n";
        let shape = |json: &str| -> Vec<serde_json::Value> {
            matcher(json)
                .hits(&note(body), 50)
                .iter()
                .map(|hit| serde_json::to_value(hit).expect("a hit as JSON"))
                .map(|hit| serde_json::json!([hit["text"], hit.get("bare").cloned()]))
                .collect()
        };
        let task_todo = scope("task-todo", &all(&[]));
        assert_eq!(
            shape(&task_todo),
            [
                serde_json::json!(["- [ ] buy milk", true]),
                serde_json::json!(["- [ ] call Ana", true]),
            ]
        );
        assert_eq!(
            shape(&all(&[task_todo, text("milk")])),
            [
                serde_json::json!(["- [ ] buy milk", null]),
                serde_json::json!(["- [ ] call Ana", true]),
                serde_json::json!(["milk here", null]),
            ]
        );
        let path = r#"{"kind":"path","text":"Meeting","fold":true}"#;
        assert_eq!(shape(path), [serde_json::json!(["- [ ] buy milk", true])]);
        let long = format!("{} beta\n", "x".repeat(400));
        let hits = matcher(&text("beta")).hits(&note(&long), 10);
        assert!(!hits.first().expect("a hit").bare);
    }
    #[test]
    fn a_row_counts_marks_and_lines_the_way_the_app_does() {
        let hits = matcher(&text("gamma")).hits(&note(NOTE), 10);
        assert_eq!(hits.first().map(|hit| hit.line), Some(8));
        let many = "beta\n".repeat(20);
        assert_eq!(matcher(&text("beta")).hits(&note(&many), 3).len(), 3);
        let hits = matcher(&text("beta")).hits(&note("\u{1f600} beta\n"), 10);
        let first = hits.first().expect("a hit");
        assert_eq!(first.ranges.first().map(|range| range.from), Some(3));
        assert_eq!(line_starts("a\nbb\n\nc"), vec![0, 2, 5, 6]);
        let starts = line_starts("a\nbb\n\nc");
        assert_eq!(line_at(&starts, 0), 0);
        assert_eq!(line_at(&starts, 1), 0);
        assert_eq!(line_at(&starts, 2), 1);
        assert_eq!(line_at(&starts, 4), 1);
        assert_eq!(line_at(&starts, 5), 2);
        assert_eq!(line_at(&starts, 6), 3);
    }
}
