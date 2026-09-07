//! Running a parsed query over one note: whether it answers, and where.
//!
//! Every operator answers with the places it matched rather than with a yes,
//! which is what lets a hit emphasise the words that were found. An operator
//! that asks about the note rather than its words, `path:` and `file:` and
//! `tag:` and `[key]`, answers with no places at all, so a note found only by
//! its name still counts as found and simply has nothing to underline.
//!
//! A term is looked for inside a region, and `line:`, `block:` and `section:`
//! are nothing more than the same walk over a smaller one. That is the whole
//! of nearness here: one recursion, no second pass.
//!
//! Offsets are bytes, because that is what a `str` is indexed by and a space
//! of two thousand notes cannot afford a second copy of itself as characters.
//! Only what leaves is counted otherwise: a range inside a shown line is in
//! UTF-16 units, which is how the app measures the string it is handed. What
//! a pattern caught is not kept at all, because replacing happens in the app,
//! which has the note it is about to write in front of it anyway.
//!
//! search/match.ts is the twin of this, down to the cases its tests use.

use std::collections::HashMap;

use serde::Serialize;

use crate::query::{Query, Unit};
use crate::regex::Pattern;
use crate::tags::tags_in;

/// How much of a matching line is worth showing. The app cuts here too.
const LINE: usize = 200;

/// Where something sits in a note, in bytes.
#[derive(Clone, Copy)]
struct Region {
    from: usize,
    to: usize,
}

/// Where one match sits in the note.
struct Span {
    from: usize,
    to: usize,
}

/// Where in a shown line a match sits, in UTF-16 units.
#[derive(Serialize, Clone)]
pub struct Range {
    from: usize,
    to: usize,
}

/// One matching line, named and placed, so a result reads like the note rather
/// than merely pointing at it.
#[derive(Serialize, Clone)]
pub struct Hit {
    path: String,
    name: String,
    line: usize,
    text: String,
    ranges: Vec<Range>,
}

/// One note as the matcher reads it.
pub struct Note<'a> {
    /// What opening the hit asks for: the note's path as this machine spells it.
    pub path: &'a str,
    /// How `path:` reads the note: relative to the space, `/`-separated.
    pub relative: &'a str,
    /// The file's own name, which is what `file:` reads.
    pub name: &'a str,
    /// The words.
    pub body: &'a str,
}

/// A query with its patterns already compiled and its needles already folded,
/// so a space is walked with the work done once rather than once per note.
enum Term {
    All(Vec<Term>),
    Any(Vec<Term>),
    Not(Box<Term>),
    Text {
        needle: String,
        folded: bool,
    },
    /// None for a pattern that will not compile, which is a query still being
    /// typed rather than something to report, and matches nothing.
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
    },
    Scope {
        unit: Unit,
        of: Box<Term>,
    },
}

/// What the query asks of a note beyond its words. Anything it never asks for
/// is never worked out, which is what keeps a plain word search to one pass.
#[derive(Default)]
struct Needs {
    folded: bool,
    tags: bool,
    front: bool,
    units: [bool; 3],
}

/// One note, answered as far as the query asks.
struct Facts {
    starts: Vec<usize>,
    folded: String,
    tags: Vec<String>,
    front: HashMap<String, String>,
    units: [Vec<Region>; 3],
}

/// Which of the three unit lists a group looks in.
fn slot(unit: Unit) -> usize {
    match unit {
        Unit::Line => 0,
        Unit::Block => 1,
        Unit::Section => 2,
    }
}

/// Lowercase without changing the length, so an offset in the folded text is
/// the same offset in the note. A handful of letters lowercase into two, the
/// Turkish dotted capital I among them, and those are left as they are rather
/// than shifting every match after them along.
fn fold_char(one: char) -> char {
    let mut lower = one.to_lowercase();
    match (lower.next(), lower.next()) {
        (Some(only), None) if only.len_utf8() == one.len_utf8() => only,
        _ => one,
    }
}

fn fold(text: &str) -> String {
    text.chars().map(fold_char).collect()
}

/// Where every line of a note starts.
fn line_starts(body: &str) -> Vec<usize> {
    let mut starts = vec![0];
    starts.extend(body.match_indices('\n').map(|(at, _)| at + 1));
    starts
}

/// Which line an offset is on. A search rather than a walk, because a note can
/// be long and every match asks.
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

/// A heading opens a section: up to three spaces, one to six hashes, then a
/// space. A hash with no space after it is a tag, not a heading.
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

/// The regions a `line:`, `block:` or `section:` group looks inside.
fn units_in(body: &str, starts: &[usize], unit: Unit) -> Vec<Region> {
    let end_of = |index: usize| starts.get(index + 1).map_or(body.len(), |next| next - 1);

    if matches!(unit, Unit::Line) {
        return starts
            .iter()
            .enumerate()
            .map(|(index, &from)| Region {
                from,
                to: end_of(index),
            })
            .collect();
    }

    let sectioned = matches!(unit, Unit::Section);
    let mut out = Vec::new();
    let mut open: Option<usize> = None;

    for (index, &start) in starts.iter().enumerate() {
        let text = body.get(start..end_of(index)).unwrap_or_default();
        // A block ends on the line before the blank one, and a section on the
        // line before the next heading.
        let previous = if index == 0 { start } else { end_of(index - 1) };
        let breaks = if sectioned {
            is_heading(text)
        } else {
            text.trim().is_empty()
        };

        if breaks {
            if let Some(from) = open.take() {
                out.push(Region { from, to: previous });
            }
            // A heading belongs to the section it opens; a blank line belongs
            // to nothing.
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

/// Front matter as a map, for `[key]` and `[key:value]`.
///
/// The plain `key: value` lines at the top and nothing else. A value written
/// as a list underneath its key is left out: reading YAML properly is a parser,
/// and the operator is worth a few lines, not a dependency.
fn front_matter(body: &str) -> HashMap<String, String> {
    let mut out = HashMap::new();
    let mut lines = body.lines();
    if lines.next().map(str::trim) != Some("---") {
        return out;
    }

    for line in lines {
        if line.trim() == "---" {
            break;
        }
        if line.starts_with(char::is_whitespace) {
            continue;
        }

        let Some((name, value)) = line.split_once(':') else {
            continue;
        };
        if name.trim().is_empty() {
            continue;
        }

        out.insert(name.trim().to_lowercase(), value.trim().to_string());
    }

    out
}

/// Every place a word or a phrase sits inside the region, without overlapping
/// itself, so a replacement of them all is a matter of splicing.
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

/// Every place the pattern matches inside the region. The region is what is
/// searched, so `^` and `$` mean the start and the end of a line inside
/// `line:(…)` and the start and the end of the note outside it.
///
/// The pattern reads characters, so the region is turned into some, and the
/// places it names are turned back into bytes. Only a query that holds a
/// pattern pays for that.
fn patterned(pattern: &Pattern, body: &str, region: Region) -> Option<Vec<Span>> {
    let slice = body.get(region.from..region.to)?;
    let letters: Vec<char> = slice.chars().collect();
    let mut bytes: Vec<usize> = slice.char_indices().map(|(at, _)| at).collect();
    bytes.push(slice.len());

    let mut out = Vec::new();
    let mut at = 0;

    while at <= letters.len() {
        let Some(found) = pattern.find(&letters, at) else {
            break;
        };

        // A pattern that can match nothing would sit on the same place for
        // ever, and an empty match is not a place to show.
        if found.to == found.from {
            at = found.from + 1;
            continue;
        }

        let (Some(&from), Some(&to)) = (bytes.get(found.from), bytes.get(found.to)) else {
            break;
        };

        out.push(Span {
            from: region.from + from,
            to: region.from + to,
        });
        at = found.to;
    }

    (!out.is_empty()).then_some(out)
}

/// The two regions overlapping, or None when they do not.
fn clip(one: Region, other: Region) -> Option<Region> {
    let from = one.from.max(other.from);
    let to = one.to.min(other.to);
    (from <= to).then_some(Region { from, to })
}

/// How far into a string a byte offset is, counted the way the app counts it.
fn utf16_at(text: &str, byte: usize) -> usize {
    text.get(..byte)
        .unwrap_or_default()
        .chars()
        .map(char::len_utf16)
        .sum()
}

/// A query with the work a whole space would repeat already done: patterns
/// compiled, needles folded, and a note of what each note will be asked.
pub struct Matcher {
    root: Term,
    needs: Needs,
}

impl Matcher {
    /// Reads a query in, ready to be asked about note after note.
    #[must_use]
    pub fn new(query: Query) -> Self {
        let mut needs = Needs::default();
        let root = compile(query, &mut needs);
        Self { root, needs }
    }

    /// The note's matching lines, ready for a row in the panel. Empty when the
    /// note does not answer the query at all.
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

        // Found by something no line of the note says: its path, its name, a
        // tag. The first line with words in it stands in, so the row reads
        // like a note rather than like an empty result.
        if spans.is_empty() {
            let line = (0..facts.starts.len())
                .find(|&index| !line_text(note.body, &facts.starts, index).trim().is_empty())
                .unwrap_or(0);

            return vec![row(note, &facts.starts, line, &[])];
        }

        spans.sort_by_key(|span| span.from);

        let mut out: Vec<Hit> = Vec::new();
        let mut current: Vec<Span> = Vec::new();
        let mut at: Option<usize> = None;

        for span in spans {
            let line = line_at(&facts.starts, span.from);
            if at != Some(line) {
                if let Some(previous) = at {
                    out.push(row(note, &facts.starts, previous, &current));
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
            out.push(row(note, &facts.starts, previous, &current));
        }

        out.truncate(most);
        out
    }

    fn facts(&self, body: &str) -> Facts {
        let starts = line_starts(body);
        let unit_of = |unit: Unit| {
            if self.needs.units[slot(unit)] {
                units_in(body, &starts, unit)
            } else {
                Vec::new()
            }
        };
        let units = [
            unit_of(Unit::Line),
            unit_of(Unit::Block),
            unit_of(Unit::Section),
        ];

        Facts {
            folded: if self.needs.folded {
                fold(body)
            } else {
                String::new()
            },
            tags: if self.needs.tags {
                tags_in(body)
                    .iter()
                    .map(|tag| tag.strip_prefix('#').unwrap_or(tag).to_lowercase())
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
        }
    }
}

/// Where the term answers inside the region, or None when it does not.
///
/// A free function rather than a method, because everything it needs is in
/// front of it: the query has already become a `Term`, and a matcher would be
/// carried through the recursion for nothing.
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

        Term::Not(of) => walk(of, note, facts, region).is_none().then(Vec::new),

        Term::Text { needle, folded } => literals(
            if *folded { &facts.folded } else { note.body },
            needle,
            region,
        ),

        Term::Regex(pattern) => patterned(pattern.as_ref()?, note.body, region),

        Term::Path { needle, folded } => holds(note.relative, needle, *folded).then(Vec::new),

        Term::File { needle, folded } => holds(note.name, needle, *folded).then(Vec::new),

        // A tag stands for its children too, the way Obsidian reads it, so
        // `tag:work` finds `#work/2026`.
        Term::Tag(wanted) => facts
            .tags
            .iter()
            .any(|tag| tag == wanted || under(tag, wanted))
            .then(Vec::new),

        Term::Property { name, value } => {
            let held = facts.front.get(name)?;
            match value {
                None => Some(Vec::new()),
                Some(wanted) => holds(held, wanted, true).then(Vec::new),
            }
        }

        Term::Scope { unit, of } => {
            let mut out = Vec::new();
            let mut answered = false;

            for one in &facts.units[slot(*unit)] {
                let Some(within) = clip(*one, region) else {
                    continue;
                };
                if let Some(mut found) = walk(of, note, facts, within) {
                    answered = true;
                    out.append(&mut found);
                }
            }

            answered.then_some(out)
        }
    }
}

/// Whether a tag sits under another: `work/2026` is under `work`.
fn under(tag: &str, parent: &str) -> bool {
    tag.starts_with(parent) && tag.as_bytes().get(parent.len()) == Some(&b'/')
}

/// Whether a short string holds another, folding case when asked.
fn holds(hay: &str, needle: &str, folded: bool) -> bool {
    if folded {
        hay.to_lowercase().contains(needle)
    } else {
        hay.contains(needle)
    }
}

/// One line of a note, without its newline.
fn line_text<'a>(body: &'a str, starts: &[usize], line: usize) -> &'a str {
    let from = starts.get(line).copied().unwrap_or_default();
    let to = starts.get(line + 1).map_or(body.len(), |next| next - 1);
    body.get(from..to).unwrap_or_default()
}

/// One line as a row: the words trimmed and cut short, and each match moved to
/// where it ended up in them.
fn row(note: &Note, starts: &[usize], line: usize, spans: &[Span]) -> Hit {
    let from = starts.get(line).copied().unwrap_or_default();
    let raw = line_text(note.body, starts, line);
    let lead = raw.len() - raw.trim_start().len();
    let trimmed = raw.trim();
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
    }
}

/// The query with its work done: patterns compiled, needles folded, and a note
/// of everything a note will have to be asked about.
fn compile(query: Query, needs: &mut Needs) -> Term {
    match query {
        Query::All { of } => Term::All(of.into_iter().map(|one| compile(one, needs)).collect()),
        Query::Any { of } => Term::Any(of.into_iter().map(|one| compile(one, needs)).collect()),
        Query::Not { of } => Term::Not(Box::new(compile(*of, needs))),

        Query::Text { text, fold: folded } => {
            if folded {
                needs.folded = true;
            }
            Term::Text {
                needle: if folded { fold(&text) } else { text },
                folded,
            }
        }

        Query::Regex { source, fold } => Term::Regex(Pattern::compile(&source, fold)),

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
            Term::Tag(tag.to_lowercase())
        }

        Query::Property { name, value } => {
            needs.front = true;
            Term::Property {
                name: name.to_lowercase(),
                value: value.map(|one| one.to_lowercase()),
            }
        }

        Query::Scope { unit, of } => {
            needs.units[slot(unit)] = true;
            Term::Scope {
                unit,
                of: Box::new(compile(*of, needs)),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{line_at, line_starts, Matcher, Note};
    use crate::query::Query;

    /// The twin of this module is search/match.ts, and the twin of these cases
    /// is match.test.ts: the same note, the same queries, the same answers.
    const NOTE: &str = "---\nstatus: done\nproject: Nib\n---\n\n# Meeting notes #work/2026\n\nAlpha met Beta on Monday.\nGamma was away.\n\n## Later\n\nBeta wrote it up. #done\n\n```\n#notatag\n```\n";

    /// A note with nothing in it but the words a case is about.
    const CLOSE: &str = "alpha here\nbeta there\n\nalpha and beta\n";

    /// The tree the app's parser would have sent, written as the JSON that
    /// crosses the wire, so what is tested is what actually arrives.
    fn matcher(json: &str) -> Matcher {
        let query: Query = serde_json::from_str(json).expect("a query the app could have sent");
        Matcher::new(query)
    }

    fn note(body: &str) -> Note<'_> {
        Note {
            path: "/space/Work/Meeting.md",
            relative: "Work/Meeting.md",
            name: "Meeting.md",
            body,
        }
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

    /// The words each hit emphasises, sliced the way the app slices them.
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
    fn words_match_anywhere_in_the_note_folded() {
        assert!(answers(&text("alpha"), NOTE));
        assert!(answers(&text("ALPHA"), NOTE));
        assert!(!answers(&text("zeta"), NOTE));
    }

    #[test]
    fn all_the_words_have_to_match_in_any_order() {
        assert!(answers(&all(&[text("alpha"), text("gamma")]), NOTE));
        assert!(answers(&all(&[text("gamma"), text("alpha")]), NOTE));
        assert!(!answers(&all(&[text("alpha"), text("zeta")]), NOTE));
    }

    #[test]
    fn a_word_brings_back_the_line_it_was_found_on() {
        assert_eq!(lines(&text("gamma"), NOTE), ["Gamma was away."]);
        assert_eq!(marked(&text("gamma"), NOTE), ["Gamma"]);
    }

    #[test]
    fn a_word_brings_back_one_row_per_line() {
        assert_eq!(
            lines(&text("beta"), NOTE),
            ["Alpha met Beta on Monday.", "Beta wrote it up. #done"]
        );
    }

    #[test]
    fn a_phrase_matches_exactly() {
        assert!(answers(&text("met Beta"), NOTE));
        assert!(!answers(&text("Beta met"), NOTE));
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
    fn case_folds_until_it_is_told_not_to() {
        assert!(answers(&text("ALPHA"), NOTE));
        assert!(!answers(&exact("ALPHA"), NOTE));
        assert!(answers(&exact("Alpha"), NOTE));
    }

    #[test]
    fn path_reads_where_the_note_is() {
        let path = |one: &str| format!(r#"{{"kind":"path","text":"{one}","fold":true}}"#);
        assert!(answers(&path("Work/"), NOTE));
        assert!(answers(&path("work/"), NOTE));
        assert!(!answers(&path("Drafts/"), NOTE));
    }

    #[test]
    fn file_reads_the_note_name_and_shows_a_line_it_never_says() {
        let file = |one: &str| format!(r#"{{"kind":"file","text":"{one}","fold":true}}"#);
        assert!(answers(&file("Meeting"), NOTE));
        assert!(!answers(&file("Agenda"), NOTE));
        assert_eq!(lines(&file("Meeting"), NOTE), ["---"]);
        assert!(marked(&file("Meeting"), NOTE).is_empty());
    }

    #[test]
    fn a_tag_matches_itself_and_its_children() {
        let tag = |one: &str| format!(r#"{{"kind":"tag","tag":"{one}"}}"#);
        assert!(answers(&tag("done"), NOTE));
        assert!(!answers(&tag("missing"), NOTE));
        assert!(answers(&tag("work"), NOTE));
        assert!(answers(&tag("work/2026"), NOTE));
        assert!(!answers(&tag("work/2025"), NOTE));
        // Not out of a fence, and a heading is not a tag.
        assert!(!answers(&tag("notatag"), NOTE));
        assert!(!answers(&tag("meeting"), NOTE));
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
        // Only the front matter, not a colon further down, and nothing at all
        // in a note that has none.
        assert!(!answers(&key("later"), NOTE));
        assert!(!answers(&key("status"), "status: done\n"));
    }

    #[test]
    fn patterns_match_what_they_describe() {
        assert!(answers(&pattern("G[a-z]+a", false), NOTE));
        assert!(!answers(&pattern("Z[a-z]+a", false), NOTE));
        assert!(!answers(&pattern("gamma", false), NOTE));
        assert!(answers(&pattern("gamma", true), NOTE));
        assert_eq!(marked(&pattern("B[a-z]+a on", false), NOTE), ["Beta on"]);
        // One that will not compile matches nothing rather than complaining.
        assert!(!answers(&pattern("([a-", false), NOTE));
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

        // What comes before the first heading is a section of its own.
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
    fn a_row_counts_its_line_from_zero_and_stops_where_it_is_told() {
        let hits = matcher(&text("gamma")).hits(&note(NOTE), 10);
        assert_eq!(hits.first().map(|hit| hit.line), Some(8));

        let many = "beta\n".repeat(20);
        assert_eq!(matcher(&text("beta")).hits(&note(&many), 3).len(), 3);
    }

    #[test]
    fn a_mark_is_counted_the_way_the_app_counts_it() {
        // The emoji is two UTF-16 units, so a mark after one is moved by two
        // rather than by the one character it looks like.
        let hits = matcher(&text("beta")).hits(&note("\u{1f600} beta\n"), 10);
        let first = hits.first().expect("a hit");
        assert_eq!(first.ranges.first().map(|range| range.from), Some(3));
    }

    #[test]
    fn line_offsets_start_at_the_top_of_every_line() {
        assert_eq!(line_starts("a\nbb\n\nc"), vec![0, 2, 5, 6]);
    }

    #[test]
    fn line_offsets_find_the_line_an_offset_is_on() {
        let starts = line_starts("a\nbb\n\nc");
        assert_eq!(line_at(&starts, 0), 0);
        assert_eq!(line_at(&starts, 1), 0);
        assert_eq!(line_at(&starts, 2), 1);
        assert_eq!(line_at(&starts, 4), 1);
        assert_eq!(line_at(&starts, 5), 2);
        assert_eq!(line_at(&starts, 6), 3);
    }
}
