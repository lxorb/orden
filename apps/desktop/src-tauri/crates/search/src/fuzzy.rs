use serde::Serialize;

use crate::matcher::{fold, utf16_at, Note, Range};
use crate::query::Query;

const LETTER: i32 = 16;

const RUN: i32 = 12;

const START: i32 = 8;

const FIRST: i32 = 2;

const GAP: i32 = 3;

const GAP_ON: i32 = 1;

const WORST: usize = 12;

const BOUNDARY: [char; 20] = [
    '\n', '\r', ' ', '\t', '/', '\\', '_', '-', '.', ',', ':', ';', '(', '[', '{', '#', '*', '>',
    '"', '\'',
];

const SCORED: usize = 400;

const SHOWN: usize = 200;

struct Word {
    letters: Vec<char>,
    head: char,
}

struct Span {
    from: usize,
    to: usize,
}

struct Fit {
    score: i32,
    next: Option<usize>,
}

fn letters_of(term: &str) -> Vec<char> {
    fold(term).chars().collect()
}

fn letter_at(body: &str, at: usize) -> Option<char> {
    body.get(at..).and_then(|rest| rest.chars().next())
}

fn letter_before(body: &str, at: usize) -> Option<char> {
    body.get(..at).and_then(|head| head.chars().next_back())
}

fn is_lower(letter: char) -> bool {
    let mut lower = letter.to_lowercase();
    let unchanged = lower.next() == Some(letter) && lower.next().is_none();

    let mut upper = letter.to_uppercase();
    let changes = upper.next() != Some(letter) || upper.next().is_some();

    unchanged && changes
}

fn opens(body: &str, at: usize) -> bool {
    let Some(before) = letter_before(body, at) else {
        return true;
    };

    if BOUNDARY.contains(&before) {
        return true;
    }

    is_lower(before) && !letter_at(body, at).is_some_and(is_lower)
}

fn find_from(folded: &str, letter: char, at: usize) -> Option<usize> {
    folded
        .get(at..)
        .and_then(|rest| rest.find(letter))
        .map(|found| at + found)
}

fn find_within(folded: &str, letter: char, at: usize, to: usize) -> Option<usize> {
    folded
        .get(at..to)
        .and_then(|region| region.find(letter))
        .map(|found| at + found)
}

fn cut(body: &str, from: usize, end: usize) -> usize {
    if end.saturating_sub(from) <= SCORED {
        return end;
    }

    body.get(from..end)
        .and_then(|line| line.char_indices().nth(SCORED))
        .map_or(end, |(at, _)| from + at)
}

fn walk(word: &Word, folded: &str, at: usize, to: usize, out: &mut Vec<usize>) -> bool {
    out.clear();
    out.push(at);
    let mut cursor = at + word.head.len_utf8();

    for &letter in word.letters.iter().skip(1) {
        let Some(found) = find_within(folded, letter, cursor, to) else {
            return false;
        };

        out.push(found);
        cursor = found + letter.len_utf8();
    }

    true
}

fn missed(body: &str, from: usize, to: usize) -> usize {
    body.get(from..to)
        .map_or(0, |skipped| skipped.chars().take(WORST).count())
}

fn gap(missing: usize) -> i32 {
    if missing == 0 {
        return 0;
    }

    let counted = i32::try_from(missing.min(WORST)).unwrap_or(1);
    GAP + (counted - 1) * GAP_ON
}

fn worth(body: &str, at: &[usize]) -> i32 {
    let mut score = 0;
    let mut after: Option<usize> = None;

    for (index, &position) in at.iter().enumerate() {
        score += LETTER;

        if after == Some(position) {
            score += RUN;
        } else if opens(body, position) {
            score += START * if index == 0 { FIRST } else { 1 };
        }

        if let Some(ended) = after {
            score -= gap(missed(body, ended, position));
        }

        after = Some(position + letter_at(body, position).map_or(1, char::len_utf8));
    }

    score
}

fn fit_at(
    word: &Word,
    body: &str,
    folded: &str,
    to: usize,
    first: usize,
    kept: &mut Vec<usize>,
    tried: &mut Vec<usize>,
) -> Option<Fit> {
    let mut score: Option<i32> = None;
    let mut at = Some(first);
    let mut next = Some(first);

    while let Some(start) = at {
        if start >= to {
            break;
        }

        if !walk(word, folded, start, to, tried) {
            break;
        }

        let worth_it = worth(body, tried);
        if score.is_none_or(|best| worth_it > best) {
            score = Some(worth_it);
            kept.clone_from(tried);
        }

        at = find_from(folded, word.head, start + word.head.len_utf8());
        next = at;
    }

    score.map(|score| Fit { score, next })
}

fn ranges(body: &str, at: &[usize]) -> Vec<Span> {
    let mut out: Vec<Span> = Vec::new();

    for &position in at {
        let to = position + letter_at(body, position).map_or(1, char::len_utf8);
        match out.last_mut() {
            Some(last) if last.to == position => last.to = to,
            _ => out.push(Span { from: position, to }),
        }
    }

    out
}

#[allow(
    dead_code,
    reason = "the twin of the app's fuzzyTerms, which is what sends the terms over; the tests hold the two to the same table"
)]
#[must_use]
pub fn fuzzy_terms(query: &Query) -> Vec<String> {
    let mut out = Vec::new();
    if gather(query, &mut out) {
        out
    } else {
        Vec::new()
    }
}

fn gather(query: &Query, out: &mut Vec<String>) -> bool {
    match query {
        Query::All { of } => of.iter().all(|one| gather(one, out)),

        Query::Text { text, fold: folded } => {
            if !folded || text.chars().any(char::is_whitespace) {
                return false;
            }

            out.push(fold(text));
            true
        }

        Query::Path { .. } | Query::File { .. } | Query::Tag { .. } | Query::Property { .. } => {
            true
        }

        Query::Any { .. }
        | Query::Not { .. }
        | Query::Regex { .. }
        | Query::Scope { .. }
        | Query::Content { .. } => false,
    }
}

#[must_use]
pub fn without_words(query: &Query) -> Query {
    match query {
        Query::Text { .. } => Query::All { of: Vec::new() },

        Query::All { of } => Query::All {
            of: of
                .iter()
                .filter(|one| !matches!(one, Query::Text { .. }))
                .map(without_words)
                .collect(),
        },

        other => other.clone(),
    }
}

#[derive(Serialize, Clone)]
pub struct FuzzyHit {
    path: String,
    name: String,
    line: usize,
    text: String,
    ranges: Vec<Range>,
    score: i32,
}

impl FuzzyHit {
    #[must_use]
    pub fn score(&self) -> i32 {
        self.score
    }
}

pub struct Fuzzy {
    words: Vec<Word>,
}

impl Fuzzy {
    #[must_use]
    pub fn new(terms: &[String]) -> Self {
        Self {
            words: terms
                .iter()
                .filter_map(|term| {
                    let letters = letters_of(term);
                    let head = *letters.first()?;
                    Some(Word { letters, head })
                })
                .collect(),
        }
    }

    #[must_use]
    pub fn asks(&self) -> bool {
        !self.words.is_empty()
    }

    #[must_use]
    pub fn best(&self, note: &Note) -> Option<FuzzyHit> {
        let words = &self.words;
        if words.is_empty() {
            return None;
        }

        let body = note.body;
        let folded = note.folded();

        let mut next = Vec::with_capacity(words.len());
        for word in words {
            next.push(folded.find(word.head)?);
        }

        let mut best_score = 0;
        let mut best_line = None;
        let mut best_from = 0;
        let mut best_end = 0;
        let mut best_positions = Vec::new();

        let mut positions = Vec::new();
        let mut kept = Vec::new();
        let mut tried = Vec::new();

        let mut line = 0;
        let mut from = 0;

        while from <= body.len() {
            let broke = find_from(folded, '\n', from);
            let end = broke.unwrap_or(body.len());

            if end > from {
                let to = cut(body, from, end);
                positions.clear();
                let mut score = 0;
                let mut all = true;

                for (which, word) in words.iter().enumerate() {
                    let mut at = next[which];

                    if at < from {
                        let Some(moved) = find_from(folded, word.head, from) else {
                            return done(
                                note,
                                best_line,
                                best_from,
                                best_end,
                                best_score,
                                &best_positions,
                            );
                        };

                        at = moved;
                        next[which] = moved;
                    }

                    if at >= to {
                        all = false;
                        break;
                    }

                    let Some(found) = fit_at(word, body, folded, to, at, &mut kept, &mut tried)
                    else {
                        all = false;
                        break;
                    };

                    next[which] = found.next.unwrap_or(body.len());
                    score += found.score;
                    positions.extend_from_slice(&kept);
                }

                if all && (best_line.is_none() || score > best_score) {
                    best_score = score;
                    best_line = Some(line);
                    best_from = from;
                    best_end = end;
                    best_positions.clone_from(&positions);
                }
            }

            let Some(broke) = broke else {
                break;
            };
            from = broke + 1;
            line += 1;
        }

        done(
            note,
            best_line,
            best_from,
            best_end,
            best_score,
            &best_positions,
        )
    }
}

fn done(
    note: &Note,
    line: Option<usize>,
    from: usize,
    end: usize,
    score: i32,
    positions: &[usize],
) -> Option<FuzzyHit> {
    Some(row(note, line?, from, end, score, positions))
}

fn row(
    note: &Note,
    line: usize,
    from: usize,
    end: usize,
    score: i32,
    positions: &[usize],
) -> FuzzyHit {
    let raw = note.body.get(from..end).unwrap_or_default();
    let lead = raw.len() - raw.trim_start().len();
    let text: String = raw.trim().chars().take(SHOWN).collect();

    let mut found = positions.to_vec();
    found.sort_unstable();

    let mut moved: Vec<Span> = Vec::new();
    for span in ranges(note.body, &found) {
        let start = span.from.saturating_sub(from + lead);
        let to = span.to.saturating_sub(from + lead).min(text.len());
        if start >= to {
            continue;
        }

        match moved.last_mut() {
            Some(last) if last.to >= start => last.to = last.to.max(to),
            _ => moved.push(Span { from: start, to }),
        }
    }

    let ranges = moved
        .iter()
        .map(|span| Range {
            from: utf16_at(&text, span.from),
            to: utf16_at(&text, span.to),
        })
        .collect();

    FuzzyHit {
        path: note.path.to_string(),
        name: note.name.to_string(),
        line,
        text,
        ranges,
        score,
    }
}

#[cfg(test)]
mod tests {
    use std::cmp::Reverse;

    use super::{
        fit_at, fuzzy_terms, letters_of, ranges, without_words, Fuzzy, FuzzyHit, Word, SCORED,
    };
    use crate::matcher::Note;
    use crate::query::Query;

    fn query(json: &str) -> Query {
        serde_json::from_str(json).expect("a query the app could have sent")
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

    fn pattern(source: &str) -> String {
        format!(r#"{{"kind":"regex","source":"{source}","fold":false}}"#)
    }

    fn path(one: &str) -> String {
        format!(r#"{{"kind":"path","text":"{one}","fold":true}}"#)
    }

    fn file(one: &str) -> String {
        format!(r#"{{"kind":"file","text":"{one}","fold":true}}"#)
    }

    fn tag(one: &str) -> String {
        format!(r#"{{"kind":"tag","tag":"{one}"}}"#)
    }

    fn property(one: &str) -> String {
        format!(r#"{{"kind":"property","name":"{one}","value":null}}"#)
    }

    fn fit(term: &str, line: &str) -> Option<(i32, Vec<usize>)> {
        let letters = letters_of(term);
        let head = *letters.first()?;
        let word = Word { letters, head };

        let cropped = line.get(..super::cut(line, 0, line.len()))?;
        let folded = super::fold(cropped);
        let first = folded.find(head)?;

        let mut kept = Vec::new();
        let found = fit_at(
            &word,
            cropped,
            &folded,
            cropped.len(),
            first,
            &mut kept,
            &mut Vec::new(),
        )?;

        Some((found.score, kept))
    }

    fn score(term: &str, line: &str) -> Option<i32> {
        fit(term, line).map(|(score, _)| score)
    }

    fn marked(term: &str, line: &str) -> String {
        let Some((_, at)) = fit(term, line) else {
            return String::new();
        };

        ranges(line, &at)
            .iter()
            .filter_map(|span| line.get(span.from..span.to))
            .collect()
    }

    fn better<'a>(term: &str, one: &'a str, other: &'a str) -> &'a str {
        match (score(term, one), score(term, other)) {
            (None, _) => other,
            (_, None) => one,
            (Some(first), Some(second)) => {
                if first >= second {
                    one
                } else {
                    other
                }
            }
        }
    }

    fn terms(json: &str) -> Vec<String> {
        fuzzy_terms(&query(json))
    }

    const NOTE: &str = "# Meeting notes\n\nAlpha met Beta on Monday.\n\n## The quarter plan\n\nBeta wrote it up.\n";

    fn note<'a>(path: &'a str, body: &'a str) -> Note<'a> {
        Note::new(path, "Work/Meeting.md", "Meeting.md", body)
    }

    fn best(json: &str, body: &str) -> Option<FuzzyHit> {
        Fuzzy::new(&terms(json)).best(&note("/space/Work/Meeting.md", body))
    }

    fn lit(hit: &FuzzyHit) -> String {
        let units: Vec<u16> = hit.text.encode_utf16().collect();
        hit.ranges
            .iter()
            .map(|range| {
                String::from_utf16_lossy(units.get(range.from..range.to).unwrap_or_default())
            })
            .collect()
    }

    #[test]
    fn matches_its_letters_in_order_wherever_they_sit() {
        assert!(score("rdm", "read me").is_some());
        assert!(score("read", "read me").is_some());
        assert!(score("mdr", "read me").is_none());
        assert!(score("zq", "read me").is_none());
    }

    #[test]
    fn matches_a_typo_which_is_the_point() {
        assert!(score("meting", "Meeting notes").is_some());
        assert!(score("recieve", "i before e receipt").is_none());
        assert!(score("recept", "i before e receipt").is_some());
    }

    #[test]
    fn folds_case_both_ways() {
        assert_eq!(score("RDM", "read me"), score("rdm", "read me"));
        assert!(score("rdm", "READ ME").is_some());
    }

    #[test]
    fn marks_the_letters_it_found_and_nothing_else() {
        assert_eq!(marked("rdm", "read me"), "rdm");
        assert_eq!(marked("read", "read me"), "read");
    }

    #[test]
    fn is_nothing_at_all_for_an_empty_term() {
        assert!(fit("", "read me").is_none());
    }

    #[test]
    fn letters_next_to_each_other_over_letters_apart() {
        assert_eq!(
            better("run", "a run of it", "rather unusual number"),
            "a run of it"
        );
        assert_eq!(
            better("quater", "The quarter plan", "q u a t e r"),
            "The quarter plan"
        );
    }

    #[test]
    fn a_word_start_over_the_middle_of_a_word() {
        assert!(score("me", "me first") > score("me", "somewhere"));
        assert!(score("rdm", "read me") > score("rdm", "a random thing"));
    }

    #[test]
    fn a_capital_after_a_small_letter_as_a_word_start_too() {
        assert!(score("rm", "readMe") > score("rm", "rummage"));
    }

    #[test]
    fn and_where_it_sits_only_settles_a_tie() {
        assert_eq!(score("plan", "plan and plan"), score("plan", "plan"));

        let (_, at) = fit("plan", "plan and plan").expect("a fit");
        let marks = ranges("plan and plan", &at);
        assert_eq!(marks.len(), 1);
        assert_eq!(marks.first().map(|span| (span.from, span.to)), Some((0, 4)));
    }

    #[test]
    fn the_whole_word_over_the_initials_of_it() {
        assert!(score("meeting", "Meeting notes") > score("mn", "Meeting notes"));
    }

    #[test]
    fn and_picks_the_best_place_the_term_fits_not_the_first() {
        assert_eq!(marked("plan", "paper: the plan"), "plan");
    }

    #[test]
    fn bare_words_are_relaxed_folded() {
        assert_eq!(
            terms(&all(&[text("meting"), text("notes")])),
            ["meting", "notes"]
        );
        assert_eq!(terms(&text("MeTing")), ["meting"]);
    }

    #[test]
    fn and_words_narrowed_by_an_operator_that_asks_about_the_note() {
        assert_eq!(terms(&all(&[text("meting"), path("Work")])), ["meting"]);
        assert_eq!(
            terms(&all(&[
                text("meting"),
                tag("work"),
                file("a"),
                property("status")
            ])),
            ["meting"]
        );
    }

    #[test]
    fn but_nothing_the_reader_asked_to_be_exact() {
        assert!(terms(&text("a phrase")).is_empty());
        assert!(terms(&pattern("re")).is_empty());
        assert!(terms(&all(&[text("a"), without(&text("b"))])).is_empty());
        assert!(terms(&any(&[text("a"), text("b")])).is_empty());
        assert!(terms(&scope("line", &all(&[text("a"), text("b")]))).is_empty());
        assert!(terms(&exact("Alpha")).is_empty());
        assert!(terms(r#"{"kind":"content","text":"meting","fold":true}"#).is_empty());
        assert!(terms(&all(&[text("meting"), text("a phrase")])).is_empty());
    }

    #[test]
    fn and_not_an_empty_field() {
        assert!(terms(&all(&[])).is_empty());
        assert!(terms(&path("Work")).is_empty());
    }

    #[test]
    fn a_note_answers_nothing_exactly_when_the_query_was_only_words() {
        let left = without_words(&query(&all(&[text("meting"), text("notes")])));
        assert_eq!(left, Query::All { of: Vec::new() });
    }

    #[test]
    fn a_note_still_answers_the_operators_when_there_were_any() {
        let left = without_words(&query(&all(&[text("meting"), path("Work")])));
        assert_eq!(
            left,
            Query::All {
                of: vec![Query::Path {
                    text: "Work".to_string(),
                    fold: true,
                }],
            }
        );
    }

    #[test]
    fn a_note_offers_its_best_line_and_says_what_matched() {
        let found = best(&all(&[text("quater"), text("plan")]), NOTE).expect("a hit");
        assert_eq!(found.text, "## The quarter plan");
        assert_eq!(found.line, 4);
        assert!(!found.ranges.is_empty());
    }

    #[test]
    fn one_row_and_no_more_because_a_guess_is_worth_one() {
        let found = best(&text("bta"), NOTE).expect("a hit");
        assert!(found.score() > 0);
    }

    #[test]
    fn a_note_needs_every_term_on_one_line() {
        assert!(best(&all(&[text("alpha"), text("plan")]), NOTE).is_none());
        assert!(best(&all(&[text("alpha"), text("monday")]), NOTE).is_some());
    }

    #[test]
    fn a_note_answers_nothing_when_a_letter_is_missing_from_it() {
        assert!(best(&text("zzz"), NOTE).is_none());
    }

    #[test]
    fn and_nothing_at_all_when_the_query_is_not_one_to_relax() {
        assert!(best(&text("quarter plan"), NOTE).is_none());
    }

    #[test]
    fn marks_where_the_letters_are_in_the_row_not_in_the_note() {
        let found = best(&text("meting"), NOTE).expect("a hit");
        assert_eq!(found.text, "# Meeting notes");

        let units = found.text.encode_utf16().count();
        for range in &found.ranges {
            assert!(range.to <= units);
        }
        assert_eq!(lit(&found), "Meting");
    }

    fn ranked(json: &str, bodies: &[(&str, &str)]) -> Vec<String> {
        let fuzzy = Fuzzy::new(&terms(json));
        let mut found: Vec<FuzzyHit> = bodies
            .iter()
            .filter_map(|(one, body)| fuzzy.best(&note(one, body)))
            .collect();

        found.sort_by_key(|hit| Reverse(hit.score()));
        found.into_iter().map(|hit| hit.path).collect()
    }

    #[test]
    fn puts_the_note_that_says_the_words_first() {
        assert_eq!(
            ranked(
                &all(&[text("quater"), text("plan")]),
                &[
                    ("/exact.md", "The quarter plan for the year"),
                    ("/scattered.md", "q u a t e r and a plan"),
                    ("/middle.md", "inequater complan"),
                ]
            ),
            ["/exact.md", "/middle.md", "/scattered.md"]
        );
    }

    #[test]
    fn and_a_note_that_answers_nothing_is_not_in_the_list() {
        assert_eq!(
            ranked(
                &text("quater"),
                &[
                    ("/yes.md", "the quarter"),
                    ("/no.md", "nothing of the kind here"),
                ]
            ),
            ["/yes.md"]
        );
    }

    #[test]
    fn a_letter_the_note_has_not_got_is_looked_for_on_the_line_only() {
        let body = "a\n".repeat(400_000);
        let fuzzy = Fuzzy::new(&terms(&text("az")));

        let started = std::time::Instant::now();
        let found = fuzzy.best(&note("/long.md", &body));
        let spent = started.elapsed();

        assert!(found.is_none(), "no line holds the term");
        assert!(spent.as_secs() < 5, "{spent:?} for 800 KB of lines");
    }

    #[test]
    fn a_long_line_outside_ascii_is_still_scored() {
        let line = "の".repeat(SCORED);
        let body = format!("{line}\n");

        assert_eq!(super::cut(&body, 0, body.len() - 1) % "の".len(), 0);
        assert!(best(&text("のの"), &body).is_some());
    }

    #[test]
    fn a_long_line_is_scored_as_far_as_it_is_shown() {
        let line = format!("{}めも{}", "の".repeat(150), "の".repeat(300));

        let found = best(&text("めも"), &line).expect("the letters are on the line");
        assert!(found.text.contains('め'), "{}", found.text);
    }
}
