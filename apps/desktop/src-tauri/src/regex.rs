//! The regular expression engine behind a `/pattern/` search.
//!
//! A slash-wrapped query runs twice: in the browser over JavaScript's `RegExp`,
//! and here over the notes on disk. Both halves have to answer the same, so this
//! file implements the corner of `RegExp` syntax a search box actually uses, and
//! implements it by backtracking, because backtracking is what decides which of
//! several possible matches is the one reported. It works over `char` slices,
//! since the caller counts positions in characters rather than bytes.
//!
//! Understood: literal characters, `.`, the class escapes `\d \D \w \W \s \S`,
//! the boundaries `\b \B`, the character escapes `\n \t \r \f \v \0` and a
//! backslash before punctuation, character classes with ranges and negation, the
//! anchors `^` and `$`, capturing and non-capturing groups, alternation, and the
//! quantifiers `* + ? {n} {n,} {n,m}`, greedy or lazy.
//!
//! Not understood, and answered by refusing to compile: lookahead, lookbehind,
//! backreferences, named groups, property escapes, inline flags, a `{` that
//! opens no quantifier, and anything half typed. A pattern that does not compile
//! is one that matches nothing, which is what a query still being typed should
//! do.
//!
//! Two places part from the browser on purpose. A `.` here takes every character
//! but a newline, where the browser also holds back the carriage return and the
//! two line separators. A `]` written first inside a class is that bracket, where
//! the browser reads `[]` as a class of nothing at all. Both are the reading the
//! search field is specified against, and both are what the other half of search
//! implements.
//!
//! Matching runs on a step budget. `(a+)+b` costs exponentially many steps on a
//! line of the right shape, and a search field is exactly where such a pattern
//! gets typed, so the engine gives up rather than let the window stop answering.

/// How many machine steps one `find` may spend before it gives up. Far more than
/// any pattern a person means needs, and reached in a moment by one they do not.
const BUDGET: usize = 250_000;

/// The most instructions a compiled pattern may hold. Counted repetitions are
/// written out in full, so this is what keeps `(a{1000}){1000}` from becoming a
/// program too large to hold.
const PROGRAM_LIMIT: usize = 10_000;

/// The largest count a `{n,m}` may name, for the same reason.
const REPEAT_LIMIT: usize = 1_000;

/// How deeply groups may nest, which is what bounds the parser's recursion.
const DEPTH_LIMIT: usize = 64;

/// A cell nothing has been written to. Cells hold char indices, so the largest
/// `usize` is never one of them.
const UNSET: usize = usize::MAX;

/// One place a pattern matched, as char indices into the text it was given.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Match {
    /// Where the match starts.
    pub from: usize,
    /// One past where it ends.
    pub to: usize,
    /// What each capturing group caught, in order. A group that took part in
    /// no match is an empty string.
    pub groups: Vec<String>,
}

/// A compiled pattern, ready to be run over as many lines as the search visits.
pub struct Pattern {
    program: Program,
    groups: usize,
    fold: bool,
}

/// The instructions of a compiled pattern, the classes they point at, and how
/// many cells running them needs.
struct Program {
    steps: Vec<Step>,
    classes: Vec<Class>,
    cells: usize,
}

/// One instruction of a compiled pattern.
#[derive(Clone, Copy)]
enum Step {
    /// Match one character, compared folded when the pattern ignores case.
    Char(char),
    /// Match anything except a newline.
    Any,
    /// Match against the class held at this index.
    Class(usize),
    /// Match only at the very start of the text.
    Start,
    /// Match only at its very end.
    End,
    /// A word boundary, or for `\B` the absence of one.
    Boundary(bool),
    /// Write the current position into a cell, which is how a capture is caught
    /// and how a repetition remembers where its round began.
    Save(usize),
    /// Fail unless the position has moved on since that cell was written.
    Advanced(usize),
    /// Forget what a range of cells holds, which is how a repetition starts each
    /// round with the groups inside it empty again.
    Clear {
        /// First cell to forget.
        from: usize,
        /// Last cell to forget, itself included.
        to: usize,
    },
    /// Take `first`, and on failure come back here and take `second`.
    Split {
        /// The branch tried first, which is the greedy one.
        first: usize,
        /// The branch left for when the first one leads nowhere.
        second: usize,
    },
    /// Carry on at another instruction.
    Jump(usize),
    /// The whole pattern matched.
    Done,
}

/// A choice left behind, to be taken up when the path chosen instead fails.
#[derive(Clone, Copy)]
struct Resume {
    pc: usize,
    pos: usize,
    /// How long the trail was when this choice was left, which says how much of
    /// it to undo before taking the choice up.
    undo: usize,
}

/// One attempt at one starting point: where it is in the program and in the
/// text, what its cells hold, and what it can still fall back on.
struct Run<'a> {
    text: &'a [char],
    cells: Vec<usize>,
    /// Every cell written and what it held before, so that falling back can put
    /// the cells back as they were.
    trail: Vec<(usize, usize)>,
    choices: Vec<Resume>,
    pc: usize,
    pos: usize,
}

/// A character class, from `[abc]` to `[^\d\-_]`.
#[derive(Clone)]
struct Class {
    negated: bool,
    members: Vec<Member>,
}

/// One member of a character class.
#[derive(Clone, Copy)]
enum Member {
    /// A single character, held as written since folding happens when it is
    /// compared.
    One(char),
    /// A range written `a-z`, held unfolded because a range is tested against
    /// the text character's cases rather than the other way round.
    Span(char, char),
    /// One of the `\d \w \s` sets, and whether the negated spelling was used.
    Set(Kind, bool),
}

/// The sets a class escape stands for.
#[derive(Clone, Copy)]
enum Kind {
    /// `\d`
    Digit,
    /// `\w`
    Word,
    /// `\s`
    Space,
}

/// The tree a pattern is parsed into, before it is written out as steps.
enum Node {
    Char(char),
    Any,
    Class(Class),
    Start,
    End,
    Boundary(bool),
    /// A group, capturing under the number it was given, or `None` for `(?:`.
    Group(Option<usize>, Box<Node>),
    Seq(Vec<Node>),
    Alt(Vec<Node>),
    Repeat(Box<Node>, Limits),
}

/// How often a quantifier lets its atom repeat, and in which order it tries.
#[derive(Clone, Copy)]
struct Limits {
    min: usize,
    /// `None` for the unbounded forms, `*` `+` and `{n,}`.
    max: Option<usize>,
    lazy: bool,
}

/// What follows an atom: a quantifier, nothing, or something shaped like a
/// quantifier that this does not understand.
enum Quantifier {
    Absent,
    Broken,
    Given(Limits),
}

impl Pattern {
    /// Compiles a pattern. `None` when the source is not one this understands,
    /// which is what a half-typed query looks like.
    #[must_use]
    pub fn compile(source: &str, fold: bool) -> Option<Pattern> {
        let src: Vec<char> = source.chars().collect();
        let mut parser = Parser {
            src: &src,
            at: 0,
            groups: 0,
            depth: 0,
        };

        let node = parser.alternation()?;

        // Anything left over is a `)` with nothing to close, and the query is
        // still being typed rather than finished.
        if parser.at != src.len() {
            return None;
        }

        let groups = parser.groups;
        let mut program = Program {
            steps: Vec::new(),
            classes: Vec::new(),
            cells: groups.checked_add(1)?.checked_mul(2)?,
        };

        // Cells 0 and 1 hold the whole match, so a group's cells are its number
        // doubled, exactly as if the pattern were group zero.
        program.push(Step::Save(0))?;
        program.emit(&node)?;
        program.push(Step::Save(1))?;
        program.push(Step::Done)?;

        Some(Pattern {
            program,
            groups,
            fold,
        })
    }

    /// The leftmost match at or after `at`, searching forward.
    #[must_use]
    pub fn find(&self, text: &[char], at: usize) -> Option<Match> {
        let mut budget = BUDGET;
        let mut start = at;

        while start <= text.len() {
            if let Some(cells) = self.attempt(text, start, &mut budget) {
                return Some(self.take(text, &cells, start));
            }

            // The budget covers the whole search rather than one starting point,
            // so a pattern that cannot finish gives up here for good.
            if budget == 0 {
                return None;
            }

            start = start.checked_add(1)?;
        }

        None
    }

    /// Runs the program from one starting point, taking up the choices it left
    /// behind until one path reaches the end or none is left. `None` covers both
    /// no match and a budget that ran out, which the caller tells apart by
    /// looking at what is left of the budget.
    fn attempt(&self, text: &[char], start: usize, budget: &mut usize) -> Option<Vec<usize>> {
        let mut run = Run {
            text,
            cells: vec![UNSET; self.program.cells],
            trail: Vec::new(),
            choices: Vec::new(),
            pc: 0,
            pos: start,
        };

        loop {
            if self.follow(&mut run, budget)? {
                return Some(run.cells);
            }
            if !run.backtrack() {
                return None;
            }
        }
    }

    /// Follows one path as far as it goes: `true` when it reached the end of the
    /// pattern, `false` when it ran into something that did not match, and `None`
    /// when the budget ran out under it.
    fn follow(&self, run: &mut Run, budget: &mut usize) -> Option<bool> {
        loop {
            *budget = budget.checked_sub(1)?;

            let Some(step) = self.program.steps.get(run.pc).copied() else {
                return Some(false);
            };

            match step {
                Step::Char(_) | Step::Any | Step::Class(_) => {
                    if !run
                        .text
                        .get(run.pos)
                        .is_some_and(|&c| self.accepts(step, c))
                    {
                        return Some(false);
                    }
                    run.pos += 1;
                    run.pc += 1;
                }
                Step::Start | Step::End | Step::Boundary(_) => {
                    if !asserts(step, run.text, run.pos) {
                        return Some(false);
                    }
                    run.pc += 1;
                }
                Step::Save(cell) => {
                    let Some(slot) = run.cells.get_mut(cell) else {
                        return Some(false);
                    };
                    run.trail.push((cell, *slot));
                    *slot = run.pos;
                    run.pc += 1;
                }
                Step::Advanced(cell) => {
                    // A round that consumed nothing would go round for ever,
                    // which is what `(a*)*` does without this.
                    if run.cells.get(cell).copied() == Some(run.pos) {
                        return Some(false);
                    }
                    run.pc += 1;
                }
                Step::Clear { from, to } => {
                    for (cell, slot) in run.cells.iter_mut().enumerate().skip(from) {
                        if cell > to {
                            break;
                        }
                        run.trail.push((cell, *slot));
                        *slot = UNSET;
                    }
                    run.pc += 1;
                }
                Step::Split { first, second } => {
                    run.choices.push(Resume {
                        pc: second,
                        pos: run.pos,
                        undo: run.trail.len(),
                    });
                    run.pc = first;
                }
                Step::Jump(target) => run.pc = target,
                Step::Done => return Some(true),
            }
        }
    }

    /// Whether one of the three steps that consume a character accepts this one.
    fn accepts(&self, step: Step, c: char) -> bool {
        match step {
            Step::Char(wanted) => {
                if self.fold {
                    folded(c) == folded(wanted)
                } else {
                    c == wanted
                }
            }
            // A newline is the one thing `.` will not have, there being no flag
            // in this dialect that would let it.
            Step::Any => c != '\n',
            Step::Class(index) => self
                .program
                .classes
                .get(index)
                .is_some_and(|class| class.holds(c, self.fold)),
            _ => false,
        }
    }

    /// Reads a finished run's cells as a match. A group whose cells were never
    /// written took part in no match, and comes back as an empty string.
    fn take(&self, text: &[char], cells: &[usize], start: usize) -> Match {
        let (from, to) = span(cells, 0).unwrap_or((start, start));
        let mut groups = Vec::with_capacity(self.groups);

        for group in 1..=self.groups {
            let caught = span(cells, group)
                .and_then(|(open, close)| text.get(open..close))
                .map_or_else(String::new, |seen| seen.iter().collect());
            groups.push(caught);
        }

        Match { from, to, groups }
    }
}

impl Run<'_> {
    /// Takes up the last choice left behind, putting the cells back as they were
    /// when it was left. `false` when there is no choice left, which is what
    /// makes the attempt a failure.
    fn backtrack(&mut self) -> bool {
        let Some(resume) = self.choices.pop() else {
            return false;
        };

        while self.trail.len() > resume.undo {
            let Some((cell, was)) = self.trail.pop() else {
                break;
            };
            if let Some(slot) = self.cells.get_mut(cell) {
                *slot = was;
            }
        }

        self.pc = resume.pc;
        self.pos = resume.pos;
        true
    }
}

/// Whether an assertion holds where the run stands. Neither `^` nor `$` is given
/// the multiline reading, so they are the two ends of the text the caller passed
/// and nothing else.
fn asserts(step: Step, text: &[char], pos: usize) -> bool {
    match step {
        Step::Start => pos == 0,
        Step::End => pos == text.len(),
        Step::Boundary(wanted) => {
            let before = pos.checked_sub(1).and_then(|i| text.get(i));
            (wordish(before) != wordish(text.get(pos))) == wanted
        }
        _ => false,
    }
}

/// Where a group's cells say it matched, or `None` when it matched nowhere.
fn span(cells: &[usize], group: usize) -> Option<(usize, usize)> {
    let open = group.checked_mul(2)?;
    let close = open.checked_add(1)?;
    let from = cells.get(open).copied()?;
    let to = cells.get(close).copied()?;

    if from == UNSET || to == UNSET || from > to {
        return None;
    }

    Some((from, to))
}

/// Whether the character on one side of a position counts towards `\b`. The text
/// running out is not a word character, which is what makes the start and the end
/// of the text boundaries.
fn wordish(c: Option<&char>) -> bool {
    c.is_some_and(|&c| is_word(c))
}

/// The `\w` set, which JavaScript keeps to ASCII whatever the text holds.
fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// The `\s` set as JavaScript spells it, which is neither what
/// `char::is_whitespace` answers nor a part of it.
fn is_space(c: char) -> bool {
    let breaks = matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}');
    let blanks = matches!(c, '\t' | '\u{b}' | '\u{c}' | ' ' | '\u{a0}' | '\u{feff}');
    let wide = matches!(c, '\u{1680}' | '\u{202f}' | '\u{205f}' | '\u{3000}');
    breaks || blanks || wide || ('\u{2000}'..='\u{200a}').contains(&c)
}

/// Case folding as the browser half does it: the lowercase of a character when
/// that is a single character, and the character itself when it is not.
fn folded(c: char) -> char {
    let mut lower = c.to_lowercase();
    match (lower.next(), lower.next()) {
        (Some(one), None) => one,
        _ => c,
    }
}

/// The same idea the other way round, which a case-insensitive range needs:
/// `[A-Z]` is only reached from `a` by raising it.
fn raised(c: char) -> char {
    let mut upper = c.to_uppercase();
    match (upper.next(), upper.next()) {
        (Some(one), None) => one,
        _ => c,
    }
}

impl Kind {
    /// Whether a character belongs to the set.
    fn holds(self, c: char) -> bool {
        match self {
            Kind::Digit => c.is_ascii_digit(),
            Kind::Word => is_word(c),
            Kind::Space => is_space(c),
        }
    }
}

impl Class {
    /// Whether the class accepts a character, negation included.
    fn holds(&self, c: char, fold: bool) -> bool {
        let inside = self.members.iter().any(|member| member.holds(c, fold));
        inside != self.negated
    }
}

impl Member {
    /// Whether one member of a class accepts a character.
    fn holds(self, c: char, fold: bool) -> bool {
        match self {
            Member::One(one) => {
                if fold {
                    folded(c) == folded(one)
                } else {
                    c == one
                }
            }
            Member::Span(lo, hi) => {
                // A range is written in one case and the text may arrive in the
                // other, so both cases of the character are offered to it.
                let range = lo..=hi;
                range.contains(&c)
                    || (fold && (range.contains(&folded(c)) || range.contains(&raised(c))))
            }
            Member::Set(kind, negated) => kind.holds(c) != negated,
        }
    }
}

/// A pattern being read, left to right.
struct Parser<'a> {
    src: &'a [char],
    at: usize,
    /// How many capturing groups have been opened, which is what numbers the
    /// next one.
    groups: usize,
    /// How deeply groups are nested here, which is what bounds the recursion.
    depth: usize,
}

impl Parser<'_> {
    /// The character about to be read.
    fn peek(&self) -> Option<char> {
        self.src.get(self.at).copied()
    }

    /// The character `by` further along, for the two places a decision needs to
    /// see past the next one.
    fn ahead(&self, by: usize) -> Option<char> {
        self.src.get(self.at.checked_add(by)?).copied()
    }

    /// Reads the next character, `None` at the end of the pattern.
    fn eat(&mut self) -> Option<char> {
        let c = self.peek()?;
        self.at += 1;
        Some(c)
    }

    /// Reads the next character when it is the one asked for.
    fn eat_if(&mut self, c: char) -> bool {
        if self.peek() == Some(c) {
            self.at += 1;
            true
        } else {
            false
        }
    }

    /// Branches separated by `|`, in the order they were written, which is the
    /// order they are tried in.
    fn alternation(&mut self) -> Option<Node> {
        let mut branches = vec![self.sequence()?];
        while self.eat_if('|') {
            branches.push(self.sequence()?);
        }

        if branches.len() == 1 {
            return branches.pop();
        }
        Some(Node::Alt(branches))
    }

    /// One branch: terms until the branch or the group ends. An empty branch is
    /// allowed, since `(a|)` is a pattern the browser accepts.
    fn sequence(&mut self) -> Option<Node> {
        let mut terms = Vec::new();
        while let Some(c) = self.peek() {
            if c == '|' || c == ')' {
                break;
            }
            terms.push(self.term()?);
        }

        if terms.len() == 1 {
            return terms.pop();
        }
        Some(Node::Seq(terms))
    }

    /// An atom and whatever quantifier follows it.
    fn term(&mut self) -> Option<Node> {
        let atom = self.atom()?;
        match self.quantifier() {
            Quantifier::Absent => Some(atom),
            Quantifier::Broken => None,
            Quantifier::Given(limits) => {
                // A quantifier on a quantifier is not something to guess at.
                if matches!(self.peek(), Some('*' | '+' | '?' | '{')) {
                    return None;
                }
                Some(Node::Repeat(Box::new(atom), limits))
            }
        }
    }

    /// The smallest thing a quantifier can be applied to.
    fn atom(&mut self) -> Option<Node> {
        let c = self.eat()?;
        match c {
            '.' => Some(Node::Any),
            '^' => Some(Node::Start),
            '$' => Some(Node::End),
            '(' => self.group(),
            '[' => self.class().map(Node::Class),
            '\\' => self.escape(),
            // A quantifier here has nothing before it to repeat.
            '*' | '+' | '?' | '{' => None,
            _ => Some(Node::Char(c)),
        }
    }

    /// A group, capturing unless it was opened `(?:`.
    fn group(&mut self) -> Option<Node> {
        // `(?:` is the only `(?` this understands: lookahead, lookbehind, named
        // groups and inline flags all come back as a pattern that does not
        // compile.
        let number = if self.peek() == Some('?') {
            if self.ahead(1) != Some(':') {
                return None;
            }
            self.at += 2;
            None
        } else {
            let given = self.groups;
            self.groups = self.groups.checked_add(1)?;
            Some(given)
        };

        self.depth += 1;
        if self.depth > DEPTH_LIMIT {
            return None;
        }
        let inner = self.alternation()?;
        self.depth = self.depth.saturating_sub(1);

        // A group left open is a query mid-typing.
        if !self.eat_if(')') {
            return None;
        }

        Some(Node::Group(number, Box::new(inner)))
    }

    /// What a backslash outside a class makes of the character after it.
    fn escape(&mut self) -> Option<Node> {
        // A pattern ending in a lone backslash is one still being typed.
        let c = self.eat()?;

        if let Some((kind, negated)) = named_set(c) {
            return Some(one_set(kind, negated));
        }

        match c {
            'b' => Some(Node::Boundary(true)),
            'B' => Some(Node::Boundary(false)),
            _ => literal_escape(c, self.peek()).map(Node::Char),
        }
    }

    /// Everything between `[` and its `]`.
    fn class(&mut self) -> Option<Class> {
        let negated = self.eat_if('^');
        let mut members = Vec::new();

        // A `]` straight after the bracket is a plain `]`, which is the only way
        // a class of brackets can be written.
        if self.eat_if(']') {
            members.push(Member::One(']'));
        }

        loop {
            // Running out before the `]` is a class still being typed.
            let c = self.peek()?;
            if c == ']' {
                self.at += 1;
                break;
            }

            // A dash reached here opens no range: it either starts the class or
            // follows a set like `\d`, and the browser reads both as a dash.
            if c == '-' {
                self.at += 1;
                members.push(Member::One('-'));
                continue;
            }

            let first = self.class_atom()?;
            let ranged = self.peek() == Some('-') && !matches!(self.ahead(1), None | Some(']'));
            if !ranged {
                members.push(first);
                continue;
            }

            self.at += 1;
            let second = self.class_atom()?;
            match (first, second) {
                (Member::One(lo), Member::One(hi)) => {
                    // A range running backwards is an error in the browser too.
                    if lo > hi {
                        return None;
                    }
                    members.push(Member::Span(lo, hi));
                }
                // A range takes two single characters, so `[\d-x]` is a set, a
                // dash, and an x.
                (start, end) => {
                    members.push(start);
                    members.push(Member::One('-'));
                    members.push(end);
                }
            }
        }

        Some(Class { negated, members })
    }

    /// One member as written inside a class, before any range is made of it.
    fn class_atom(&mut self) -> Option<Member> {
        let c = self.eat()?;
        if c != '\\' {
            return Some(Member::One(c));
        }

        let escaped = self.eat()?;
        if let Some((kind, negated)) = named_set(escaped) {
            return Some(Member::Set(kind, negated));
        }

        // Inside a class `\b` is the backspace character rather than a word
        // boundary, which is what the browser makes of it as well.
        if escaped == 'b' {
            return Some(Member::One('\u{8}'));
        }

        literal_escape(escaped, self.peek()).map(Member::One)
    }

    /// The quantifier following an atom, if one does.
    fn quantifier(&mut self) -> Quantifier {
        let Some(c) = self.peek() else {
            return Quantifier::Absent;
        };

        let (min, max) = match c {
            '*' => {
                self.at += 1;
                (0, None)
            }
            '+' => {
                self.at += 1;
                (1, None)
            }
            '?' => {
                self.at += 1;
                (0, Some(1))
            }
            '{' => {
                let Some(counts) = self.braces() else {
                    return Quantifier::Broken;
                };
                counts
            }
            _ => return Quantifier::Absent,
        };

        Quantifier::Given(Limits {
            min,
            max,
            lazy: self.eat_if('?'),
        })
    }

    /// The `{n}`, `{n,}` and `{n,m}` forms. A `{` that opens none of them is a
    /// pattern this refuses rather than a literal brace, which is the one place
    /// it is stricter than the browser.
    fn braces(&mut self) -> Option<(usize, Option<usize>)> {
        self.at += 1;
        let min = self.number()?;

        let max = if self.eat_if(',') {
            if self.peek() == Some('}') {
                None
            } else {
                Some(self.number()?)
            }
        } else {
            Some(min)
        };

        if !self.eat_if('}') {
            return None;
        }
        if max.is_some_and(|high| high < min) {
            return None;
        }

        Some((min, max))
    }

    /// A run of digits. `None` when there are none, and when they name a count
    /// too large to write out.
    fn number(&mut self) -> Option<usize> {
        let mut value: usize = 0;
        let mut seen = false;

        while let Some(digit) = self.peek().and_then(|c| c.to_digit(10)) {
            value = value
                .checked_mul(10)?
                .checked_add(usize::try_from(digit).ok()?)?;
            if value > REPEAT_LIMIT {
                return None;
            }
            seen = true;
            self.at += 1;
        }

        if seen {
            Some(value)
        } else {
            None
        }
    }
}

/// The set a class escape names, and whether it was the negated spelling.
fn named_set(c: char) -> Option<(Kind, bool)> {
    match c {
        'd' => Some((Kind::Digit, false)),
        'D' => Some((Kind::Digit, true)),
        'w' => Some((Kind::Word, false)),
        'W' => Some((Kind::Word, true)),
        's' => Some((Kind::Space, false)),
        'S' => Some((Kind::Space, true)),
        _ => None,
    }
}

/// A class escape standing on its own is a class of one member.
fn one_set(kind: Kind, negated: bool) -> Node {
    Node::Class(Class {
        negated: false,
        members: vec![Member::Set(kind, negated)],
    })
}

/// The escapes that stand for a single character: the named few, and a backslash
/// before punctuation, which is that punctuation. `None` for a letter or a digit
/// that names nothing, since `\1` and `\p{L}` are patterns this cannot run rather
/// than patterns meaning `1` and `p`.
fn literal_escape(c: char, next: Option<char>) -> Option<char> {
    match c {
        'n' => Some('\n'),
        't' => Some('\t'),
        'r' => Some('\r'),
        'f' => Some('\u{c}'),
        'v' => Some('\u{b}'),
        // `\0` is the null character on its own, but `\01` is an octal escape,
        // which is not one of these.
        '0' if !next.is_some_and(|d| d.is_ascii_digit()) => Some('\0'),
        _ if !c.is_alphanumeric() => Some(c),
        _ => None,
    }
}

impl Program {
    /// Adds an instruction, refusing once the program has grown past anything a
    /// search query could mean.
    fn push(&mut self, step: Step) -> Option<usize> {
        if self.steps.len() >= PROGRAM_LIMIT {
            return None;
        }

        let at = self.steps.len();
        self.steps.push(step);
        Some(at)
    }

    /// Replaces an instruction, which is how a branch written before its target
    /// was known is given that target.
    fn patch(&mut self, at: usize, step: Step) -> Option<()> {
        *self.steps.get_mut(at)? = step;
        Some(())
    }

    /// Takes the next cell, for a repetition to remember where a round began.
    fn cell(&mut self) -> Option<usize> {
        let taken = self.cells;
        self.cells = self.cells.checked_add(1)?;
        Some(taken)
    }

    /// Writes one node of the tree out as instructions.
    fn emit(&mut self, node: &Node) -> Option<()> {
        match node {
            Node::Char(c) => {
                self.push(Step::Char(*c))?;
            }
            Node::Any => {
                self.push(Step::Any)?;
            }
            Node::Class(class) => {
                let index = self.classes.len();
                self.classes.push(class.clone());
                self.push(Step::Class(index))?;
            }
            Node::Start => {
                self.push(Step::Start)?;
            }
            Node::End => {
                self.push(Step::End)?;
            }
            Node::Boundary(wanted) => {
                self.push(Step::Boundary(*wanted))?;
            }
            Node::Group(number, inner) => {
                if let Some(index) = number {
                    let open = index.checked_add(1)?.checked_mul(2)?;
                    let close = open.checked_add(1)?;
                    self.push(Step::Save(open))?;
                    self.emit(inner)?;
                    self.push(Step::Save(close))?;
                } else {
                    self.emit(inner)?;
                }
            }
            Node::Seq(nodes) => {
                for inner in nodes {
                    self.emit(inner)?;
                }
            }
            Node::Alt(branches) => self.emit_alt(branches)?,
            Node::Repeat(inner, limits) => self.emit_repeat(inner, *limits)?,
        }

        Some(())
    }

    /// Branches, each falling through to the next when the rest of the pattern
    /// cannot go on from it.
    fn emit_alt(&mut self, branches: &[Node]) -> Option<()> {
        let last = branches.len().checked_sub(1)?;
        let mut leaving = Vec::new();

        for (index, branch) in branches.iter().enumerate() {
            if index == last {
                self.emit(branch)?;
                break;
            }

            let split = self.push(Step::Jump(0))?;
            self.emit(branch)?;
            leaving.push(self.push(Step::Jump(0))?);

            let next = self.steps.len();
            let body = split.checked_add(1)?;
            self.patch(
                split,
                Step::Split {
                    first: body,
                    second: next,
                },
            )?;
        }

        let after = self.steps.len();
        for jump in leaving {
            self.patch(jump, Step::Jump(after))?;
        }

        Some(())
    }

    /// A quantified atom. The rounds it must take are written out one after
    /// another, and whatever it may take on top of them follows.
    fn emit_repeat(&mut self, node: &Node, limits: Limits) -> Option<()> {
        // Every round starts with the groups inside the atom empty again, which
        // is what the browser reports for `(?:(a)|b)+` over "ab".
        let clear = if let Some((low, high)) = groups_in(node) {
            let from = low.checked_add(1)?.checked_mul(2)?;
            let to = high.checked_add(1)?.checked_mul(2)?.checked_add(1)?;
            Some(Step::Clear { from, to })
        } else {
            None
        };

        for _ in 0..limits.min {
            self.emit_round(node, clear)?;
        }

        if let Some(max) = limits.max {
            let spare = max.saturating_sub(limits.min);
            self.emit_optional(node, clear, spare, limits.lazy)
        } else {
            self.emit_star(node, clear, limits.lazy)
        }
    }

    /// One round of a repetition: what it forgets, then the atom itself.
    fn emit_round(&mut self, node: &Node, clear: Option<Step>) -> Option<()> {
        if let Some(step) = clear {
            self.push(step)?;
        }
        self.emit(node)
    }

    /// The unbounded forms. A cell holds where the round began, so a body that
    /// can match nothing stops instead of going round for ever.
    fn emit_star(&mut self, node: &Node, clear: Option<Step>, lazy: bool) -> Option<()> {
        let cell = self.cell()?;
        let split = self.push(Step::Jump(0))?;
        self.push(Step::Save(cell))?;
        self.emit_round(node, clear)?;
        self.push(Step::Advanced(cell))?;
        self.push(Step::Jump(split))?;

        let after = self.steps.len();
        let body = split.checked_add(1)?;
        self.patch(split, branch(body, after, lazy))?;
        Some(())
    }

    /// The tail of a `{n,m}`: the rounds it may take on top of the ones it must,
    /// where skipping one skips all that follow.
    fn emit_optional(
        &mut self,
        node: &Node,
        clear: Option<Step>,
        count: usize,
        lazy: bool,
    ) -> Option<()> {
        let mut splits = Vec::new();

        for _ in 0..count {
            splits.push(self.push(Step::Jump(0))?);
            self.emit_round(node, clear)?;
        }

        let after = self.steps.len();
        for split in splits {
            let body = split.checked_add(1)?;
            self.patch(split, branch(body, after, lazy))?;
        }

        Some(())
    }
}

/// A `Split` that tries the body first, or the way out first when the quantifier
/// is lazy.
fn branch(body: usize, after: usize, lazy: bool) -> Step {
    if lazy {
        Step::Split {
            first: after,
            second: body,
        }
    } else {
        Step::Split {
            first: body,
            second: after,
        }
    }
}

/// The lowest and highest capture number inside a node. Groups are numbered left
/// to right, so everything inside one node is a run of numbers, which is what
/// lets a repetition forget them all at once.
fn groups_in(node: &Node) -> Option<(usize, usize)> {
    match node {
        Node::Group(number, inner) => {
            let inside = groups_in(inner);
            if let Some(index) = number {
                Some(inside.map_or((*index, *index), |(_, high)| (*index, high)))
            } else {
                inside
            }
        }
        Node::Seq(nodes) | Node::Alt(nodes) => nodes
            .iter()
            .filter_map(groups_in)
            .reduce(|a, b| (a.0.min(b.0), a.1.max(b.1))),
        Node::Repeat(inner, _) => groups_in(inner),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{Match, Pattern};

    /// The first match a pattern makes in a subject, with the text it was found
    /// in, since a match names positions rather than carrying the characters.
    fn run(source: &str, subject: &str, fold: bool, from: usize) -> Option<(Match, Vec<char>)> {
        let text: Vec<char> = subject.chars().collect();
        let found = Pattern::compile(source, fold)?.find(&text, from)?;
        Some((found, text))
    }

    /// What the first match covers.
    fn first(source: &str, subject: &str) -> Option<String> {
        let (found, text) = run(source, subject, false, 0)?;
        Some(text.get(found.from..found.to)?.iter().collect())
    }

    /// The same for a pattern that ignores case.
    fn folding(source: &str, subject: &str) -> Option<String> {
        let (found, text) = run(source, subject, true, 0)?;
        Some(text.get(found.from..found.to)?.iter().collect())
    }

    /// Where the first match at or after `from` sits.
    fn spans(source: &str, subject: &str, from: usize) -> Option<(usize, usize)> {
        let (found, _) = run(source, subject, false, from)?;
        Some((found.from, found.to))
    }

    /// What the capturing groups caught.
    fn caught(source: &str, subject: &str) -> Option<Vec<String>> {
        let (found, _) = run(source, subject, false, 0)?;
        Some(found.groups)
    }

    /// An answer spelled as a list of words, which is how the groups of a match
    /// read most clearly.
    fn words(list: &[&str]) -> Vec<String> {
        list.iter().copied().map(String::from).collect()
    }

    #[test]
    fn literal_text_matches_where_it_stands() {
        assert_eq!(spans("foo", "a foo b", 0), Some((2, 5)));
        assert_eq!(first("foo", "nothing here"), None);
        assert_eq!(spans("", "abc", 0), Some((0, 0)));
    }

    #[test]
    fn the_search_starts_where_it_is_asked_to() {
        assert_eq!(spans("a", "banana", 0), Some((1, 2)));
        assert_eq!(spans("a", "banana", 2), Some((3, 4)));
        assert_eq!(spans("a", "banana", 5), Some((5, 6)));
        assert_eq!(spans("a", "banana", 6), None);
        assert_eq!(spans("a", "banana", 99), None);
    }

    #[test]
    fn the_leftmost_start_wins_over_the_longest_match() {
        assert_eq!(first("a+", "b aa aaa").as_deref(), Some("aa"));
    }

    #[test]
    fn a_dot_takes_anything_but_a_newline() {
        assert_eq!(first("a.c", "abc").as_deref(), Some("abc"));
        assert_eq!(first("a.c", "a\nc"), None);
        assert_eq!(first(".", "\n"), None);
        assert_eq!(first(".", "\r").as_deref(), Some("\r"));
        assert_eq!(first("a.", "aä").as_deref(), Some("aä"));
    }

    #[test]
    fn a_match_counts_in_characters_rather_than_bytes() {
        let text: Vec<char> = "äöü42".chars().collect();
        let found = Pattern::compile(r"\d+", false).and_then(|p| p.find(&text, 0));
        assert_eq!(
            found,
            Some(Match {
                from: 3,
                to: 5,
                groups: Vec::new(),
            })
        );
    }

    #[test]
    fn a_class_holds_the_characters_it_lists() {
        assert_eq!(first("[abc]+", "xxcab!").as_deref(), Some("cab"));
        assert_eq!(first("[^abc]+", "abxy").as_deref(), Some("xy"));
        assert_eq!(first("[.*]+", "a.*b").as_deref(), Some(".*"));
        assert_eq!(first("[abc]", "xyz"), None);
    }

    #[test]
    fn a_class_range_runs_from_one_character_to_another() {
        assert_eq!(first("[a-f0-9]+", "zz3fq").as_deref(), Some("3f"));
        assert_eq!(first("[a-c]+", "xbcax").as_deref(), Some("bca"));
        assert_eq!(first("[^a-y]", "abz").as_deref(), Some("z"));
    }

    #[test]
    fn a_class_reads_its_brackets_and_dashes_the_way_the_browser_does() {
        assert_eq!(first("[]]", "a]b").as_deref(), Some("]"));
        assert_eq!(first("[^]]+", "]ab]").as_deref(), Some("ab"));
        assert_eq!(first("[a-]+", "-a-").as_deref(), Some("-a-"));
        assert_eq!(first(r"[\d\-_]+", "x-4_y").as_deref(), Some("-4_"));
        assert_eq!(first(r"[\w-]+", "! a-b").as_deref(), Some("a-b"));
        // A set at one end of a dash is no range, so this is a, a dash, or a
        // digit, and never the characters in between.
        assert_eq!(first(r"[a-\d]+", "qb-5").as_deref(), Some("-5"));
    }

    #[test]
    fn a_class_takes_escapes_inside_it() {
        assert_eq!(first(r"[\n\t]+", "a\n\tb").as_deref(), Some("\n\t"));
        assert_eq!(first(r"[\]]", "a]").as_deref(), Some("]"));
        assert_eq!(first(r"[\\]", r"a\b").as_deref(), Some(r"\"));
        assert_eq!(first(r"[^\d]+", "12ab").as_deref(), Some("ab"));
    }

    #[test]
    fn the_class_escapes_stand_for_their_sets() {
        assert_eq!(first(r"\d+", "ab 42 cd").as_deref(), Some("42"));
        assert_eq!(first(r"\D+", "42ab").as_deref(), Some("ab"));
        assert_eq!(first(r"\w+", " a_1!").as_deref(), Some("a_1"));
        assert_eq!(first(r"\W+", "ab!? cd").as_deref(), Some("!? "));
        assert_eq!(first(r"\s+", "a \t b").as_deref(), Some(" \t "));
        assert_eq!(first(r"\S+", "  ab ").as_deref(), Some("ab"));
    }

    #[test]
    fn the_character_escapes_stand_for_their_characters() {
        assert_eq!(first(r"\.", "a.b").as_deref(), Some("."));
        assert_eq!(first(r"\/", "a/b").as_deref(), Some("/"));
        assert_eq!(first(r"a\\b", r"a\b").as_deref(), Some(r"a\b"));
        assert_eq!(
            first(r"\(\)\[\]\{\}\+\*\?\|\$\^", "x()[]{}+*?|$^x").as_deref(),
            Some("()[]{}+*?|$^")
        );
        assert_eq!(first(r"\n", "a\nb").as_deref(), Some("\n"));
        assert_eq!(
            first(r"\t\r\f\v", "\t\r\u{c}\u{b}").as_deref(),
            Some("\t\r\u{c}\u{b}")
        );
        assert_eq!(first(r"\0", "a\0b").as_deref(), Some("\0"));
    }

    #[test]
    fn a_word_boundary_is_where_a_word_starts_or_ends() {
        assert_eq!(spans(r"\bfoo\b", "a foo bar", 0), Some((2, 5)));
        assert_eq!(first(r"\bfoo\b", "foobar"), None);
        assert_eq!(spans(r"\bfoo", "foo", 0), Some((0, 3)));
        assert_eq!(spans(r"\Bar", "bar car", 0), Some((1, 3)));
        assert_eq!(first(r"\Bfoo", "a foo"), None);
        // The boundary is judged against the whole text, not against the place
        // the search was told to start.
        assert_eq!(spans(r"\bcat", "the cat", 4), Some((4, 7)));
        assert_eq!(spans(r"\bat", "the cat", 5), None);
    }

    #[test]
    fn the_anchors_are_the_two_ends_of_the_text() {
        assert_eq!(spans("^ab", "abc", 0), Some((0, 2)));
        assert_eq!(first("^b", "ab"), None);
        assert_eq!(spans("c$", "abc", 0), Some((2, 3)));
        assert_eq!(first("b$", "abc"), None);
        assert_eq!(spans("^abc$", "abc", 0), Some((0, 3)));
        assert_eq!(spans("^$", "", 0), Some((0, 0)));
        // Without the multiline flag a line of a text is not the text.
        assert_eq!(first("^b", "a\nb"), None);
        assert_eq!(first("a$", "a\nb"), None);
        // A start further along the text is still not the start of it.
        assert_eq!(spans("^a", "aa", 1), None);
    }

    #[test]
    fn groups_are_numbered_by_their_opening_bracket() {
        assert_eq!(
            caught(r"(\w+)@(\w+)", "mail bob@host!"),
            Some(words(&["bob", "host"]))
        );
        assert_eq!(caught("((a)b)", "ab"), Some(words(&["ab", "a"])));
        assert_eq!(caught("abc", "abc"), Some(words(&[])));
    }

    #[test]
    fn a_non_capturing_group_catches_nothing() {
        assert_eq!(caught("(a)(?:b)(c)", "abc"), Some(words(&["a", "c"])));
        assert_eq!(first("(?:ab)+", "ababx").as_deref(), Some("abab"));
    }

    #[test]
    fn a_group_that_took_part_in_no_match_is_an_empty_string() {
        assert_eq!(caught("(x)|(a)", "a"), Some(words(&["", "a"])));
        assert_eq!(caught(r"(\d+)?-(\w+)", "-ab"), Some(words(&["", "ab"])));
    }

    #[test]
    fn alternation_takes_the_leftmost_branch_that_lets_the_rest_succeed() {
        assert_eq!(first("a|ab", "ab").as_deref(), Some("a"));
        assert_eq!(first("ab|a", "ab").as_deref(), Some("ab"));
        assert_eq!(first("(?:a|ab)c", "abc").as_deref(), Some("abc"));
        assert_eq!(first("|a", "a").as_deref(), Some(""));
        assert_eq!(first("(a|)", "b").as_deref(), Some(""));
        assert_eq!(first("x|y|z", "azb").as_deref(), Some("z"));
    }

    #[test]
    fn the_greedy_quantifiers_take_as_much_as_they_can() {
        assert_eq!(first("a*", "aaa").as_deref(), Some("aaa"));
        assert_eq!(first("a*", "b").as_deref(), Some(""));
        assert_eq!(first("a+", "aaa").as_deref(), Some("aaa"));
        assert_eq!(first("a+", "b"), None);
        assert_eq!(first("ba?", "b").as_deref(), Some("b"));
        assert_eq!(first("ba?", "ba").as_deref(), Some("ba"));
        assert_eq!(first("<.*>", "<a><b>").as_deref(), Some("<a><b>"));
    }

    #[test]
    fn the_counted_quantifiers_count() {
        assert_eq!(first("a{2}", "aaa").as_deref(), Some("aa"));
        assert_eq!(first("a{2}", "a"), None);
        assert_eq!(first("a{2,}", "aaaa").as_deref(), Some("aaaa"));
        assert_eq!(first("a{2,3}", "aaaa").as_deref(), Some("aaa"));
        assert_eq!(first("a{0}b", "b").as_deref(), Some("b"));
        assert_eq!(first("a{0,}", "aa").as_deref(), Some("aa"));
        assert_eq!(first("(?:ab){2}", "ababab").as_deref(), Some("abab"));
    }

    #[test]
    fn the_lazy_quantifiers_take_as_little_as_they_can() {
        assert_eq!(first("a.*?b", "axbxb").as_deref(), Some("axb"));
        assert_eq!(first("<.*?>", "<a><b>").as_deref(), Some("<a>"));
        assert_eq!(first("a+?", "aaa").as_deref(), Some("a"));
        assert_eq!(first("a??b", "ab").as_deref(), Some("ab"));
        assert_eq!(first("a{2,3}?", "aaaa").as_deref(), Some("aa"));
        assert_eq!(first("a{2,}?b", "aaab").as_deref(), Some("aaab"));
    }

    #[test]
    fn a_quantifier_gives_back_what_the_rest_of_the_pattern_needs() {
        assert_eq!(caught("(a+)(a)", "aaa"), Some(words(&["aa", "a"])));
        assert_eq!(first(r"\d+3", "12345").as_deref(), Some("123"));
    }

    #[test]
    fn a_repetition_of_something_empty_stops_instead_of_going_round() {
        assert_eq!(spans("(a*)*", "b", 0), Some((0, 0)));
        assert_eq!(spans("(?:){3,}", "a", 0), Some((0, 0)));
        assert_eq!(first("(a?)*b", "aab").as_deref(), Some("aab"));
    }

    #[test]
    fn a_round_that_matched_nothing_leaves_the_group_as_the_round_before_had_it() {
        assert_eq!(caught("(a*)*b", "aaab"), Some(words(&["aaa"])));
    }

    #[test]
    fn a_repetition_forgets_what_the_round_before_it_caught() {
        assert_eq!(caught("(?:(a)|b)+", "ab"), Some(words(&[""])));
        assert_eq!(caught("((a)|b){2}", "ab"), Some(words(&["b", ""])));
    }

    #[test]
    fn folding_matches_either_case_on_both_sides() {
        assert_eq!(folding("HELLO", "say hello").as_deref(), Some("hello"));
        assert_eq!(folding("hello", "say HELLO").as_deref(), Some("HELLO"));
        assert_eq!(first("HELLO", "hello"), None);
        assert_eq!(folding("[a-z]+", "ABC").as_deref(), Some("ABC"));
        assert_eq!(folding("[A-Z]+", "abc").as_deref(), Some("abc"));
        assert_eq!(folding("[^a]", "A"), None);
        assert_eq!(folding(r"\w+", "AbC").as_deref(), Some("AbC"));
        assert_eq!(folding("straße", "STRAßE").as_deref(), Some("STRAßE"));
    }

    #[test]
    fn a_pattern_this_does_not_understand_does_not_compile() {
        for source in [
            "(",
            ")",
            "(a",
            "a)",
            "[",
            "[a",
            "[a-",
            "a{",
            "a{,2}",
            "a{x}",
            "a{2,1}",
            "a{1001}",
            "*a",
            "+a",
            "?a",
            "{2}a",
            "a**",
            "a+*",
            "a*??",
            "a{1}{2}",
            "(?=a)",
            "(?!a)",
            "(?<=a)",
            "(?<name>a)",
            "(?i)a",
            r"\1",
            r"\p{L}",
            r"\u{0041}",
            r"\x41",
            r"\a",
            r"\01",
            "a\\",
            "[z-a]",
        ] {
            assert!(
                Pattern::compile(source, false).is_none(),
                "{source} should not compile"
            );
        }
    }

    #[test]
    fn a_pattern_this_does_understand_compiles() {
        for source in [
            "",
            "a|",
            "()",
            "(?:)",
            "[]]",
            "a{0,1000}",
            r"\d{1,3}\.\d{1,3}",
            r"^\s*(#+)\s+(.*)$",
            "((((((a))))))",
        ] {
            assert!(
                Pattern::compile(source, false).is_some(),
                "{source} should compile"
            );
        }
    }

    #[test]
    fn a_pattern_that_cannot_finish_gives_up_rather_than_hang() {
        let subject = "a".repeat(32);
        let text: Vec<char> = subject.chars().collect();
        let pattern = Pattern::compile("(a+)+b", false);
        assert!(pattern.is_some(), "the pattern itself is a fine one");

        let started = std::time::Instant::now();
        assert_eq!(pattern.and_then(|p| p.find(&text, 0)), None);
        assert!(
            started.elapsed().as_secs() < 5,
            "the step budget should have stopped this long before now"
        );
    }

    #[test]
    fn a_query_of_the_shape_search_sends_reads_the_line_it_is_given() {
        let line: Vec<char> = "  ## A heading, and a #tag".chars().collect();
        let pattern = Pattern::compile(r"^\s*(#+)\s+(.+)$", false);
        let found = pattern.and_then(|p| p.find(&line, 0));
        assert_eq!(
            found,
            Some(Match {
                from: 0,
                to: 26,
                groups: words(&["##", "A heading, and a #tag"]),
            })
        );
    }
}
