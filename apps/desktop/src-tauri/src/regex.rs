use std::cell::Cell;
use std::sync::LazyLock;

pub const BUDGET: usize = 250_000;

const BUDGET_PER_BYTE: usize = 400;

const MOST_BUDGET: usize = 10_000_000;

#[must_use]
pub fn budget_for(text: usize) -> usize {
    text.saturating_mul(BUDGET_PER_BYTE)
        .clamp(BUDGET, MOST_BUDGET)
}

const PROGRAM_LIMIT: usize = 10_000;

const REPEAT_LIMIT: usize = 1_000;

const DEPTH_LIMIT: usize = 64;

const SOURCE_LIMIT: usize = 4096;

const UNSET: usize = usize::MAX;

const FIRST_LIMIT: usize = 64;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Match {
    pub from: usize,
    pub to: usize,
    pub groups: Vec<String>,
}

pub struct Pattern {
    program: Program,
    groups: usize,
    fold: bool,
    first: Option<First>,
    lead: Option<Vec<Start>>,
}

struct Lead {
    prefix: Vec<Letter>,
    run: Letter,
}

enum Start {
    Run(Lead),
    Letters(First),
}

enum Letter {
    Any,
    Char(char),
    Class(Class),
}

struct First {
    ascii: [bool; 128],
    wide: Vec<char>,
}

struct Program {
    steps: Vec<Step>,
    classes: Vec<Class>,
    cells: usize,
    backward: bool,
}

#[derive(Clone, Copy)]
enum Step {
    Char(char),
    Any,
    Class(usize),
    Start,
    End,
    Boundary(bool),
    Save(usize),
    Advanced(usize),
    Clear {
        from: usize,
        to: usize,
    },
    Split {
        first: usize,
        second: usize,
    },
    Jump(usize),
    Look {
        behind: bool,
        negated: bool,
        after: usize,
    },
    Backref(usize),
    Done,
}

#[derive(Clone, Copy)]
struct Resume {
    pc: usize,
    pos: usize,
    undo: usize,
}

struct Run<'a> {
    text: &'a str,
    cells: Vec<usize>,
    trail: Vec<(usize, usize)>,
    choices: Vec<Resume>,
    pc: usize,
    pos: usize,
    back: bool,
}

#[derive(Clone)]
struct Class {
    negated: bool,
    members: Vec<Member>,
}

#[derive(Clone, Copy)]
enum Member {
    One(char),
    Span(char, char),
    Set(Kind, bool),
}

#[derive(Clone, Copy)]
enum Kind {
    Digit,
    Word,
    Space,
}

enum Node {
    Char(char),
    Any,
    Class(Class),
    Start,
    End,
    Boundary(bool),
    Group(Option<usize>, Box<Node>),
    Look(Look, Box<Node>),
    Backref(usize),
    Named(String),
    Seq(Vec<Node>),
    Alt(Vec<Node>),
    Repeat(Box<Node>, Limits),
}

#[derive(Clone, Copy)]
struct Look {
    behind: bool,
    negated: bool,
}

#[derive(Clone, Copy)]
struct Limits {
    min: usize,
    max: Option<usize>,
    lazy: bool,
}

enum Quantifier {
    Absent,
    Broken,
    Given(Limits),
}

impl Pattern {
    #[must_use]
    pub fn compile(source: &str, fold: bool) -> Option<Pattern> {
        if source.len() > SOURCE_LIMIT {
            return None;
        }

        let src: Vec<char> = source.chars().collect();
        let mut parser = Parser {
            src: &src,
            at: 0,
            groups: 0,
            depth: 0,
            names: Vec::new(),
        };

        let mut node = parser.alternation()?;

        if parser.at != src.len() {
            return None;
        }

        let groups = parser.groups;
        called_back(&mut node, &parser.names, groups)?;
        let mut program = Program {
            steps: Vec::new(),
            classes: Vec::new(),
            cells: groups.checked_add(1)?.checked_mul(2)?,
            backward: false,
        };

        program.push(Step::Save(0))?;
        program.emit(&node)?;
        program.push(Step::Save(1))?;
        program.push(Step::Done)?;

        Some(Pattern {
            program,
            groups,
            fold,
            first: first_of(&node, fold).and_then(|chars| First::new(&chars)),
            lead: lead_of(&node, fold),
        })
    }

    #[must_use]
    pub fn find_within(&self, text: &str, at: usize, budget: &Cell<usize>) -> Option<Match> {
        let mut start = at;

        while start <= text.len() {
            start = self.next_start(text, start)?;

            if let Some(cells) = self.attempt(text, start, budget) {
                return Some(self.take(text, &cells, start));
            }

            if budget.get() == 0 {
                return None;
            }

            start = self.past_lead(text, start)?;
        }

        None
    }

    fn past_lead(&self, text: &str, start: usize) -> Option<usize> {
        let next = letter_at(text, start).map_or(Some(start + 1), |letter| {
            start.checked_add(letter.len_utf8())
        });
        let Some(starts) = &self.lead else {
            return next;
        };

        starts
            .iter()
            .filter_map(|one| match one {
                Start::Run(lead) => self.past_run(text, start, lead, next),
                Start::Letters(first) => next.and_then(|from| self.letter_from(text, from, first)),
            })
            .min()
    }

    fn past_run(
        &self,
        text: &str,
        start: usize,
        lead: &Lead,
        next: Option<usize>,
    ) -> Option<usize> {
        let mut letters = text.get(start..)?.chars();
        for wanted in &lead.prefix {
            if !letters
                .next()
                .is_some_and(|letter| self.holds(wanted, letter))
            {
                return next;
            }
        }
        let run = letters
            .take_while(|&letter| self.holds(&lead.run, letter))
            .count();
        advanced(text, start, run.checked_add(1)?)
    }

    fn letter_from(&self, text: &str, from: usize, first: &First) -> Option<usize> {
        text.get(from..)?
            .char_indices()
            .find(|&(_, letter)| first.holds(letter, self.fold))
            .and_then(|(at, _)| from.checked_add(at))
    }

    fn holds(&self, wanted: &Letter, letter: char) -> bool {
        match wanted {
            Letter::Any => !ends_line(letter),
            Letter::Char(one) if self.fold => folded(letter) == folded(*one),
            Letter::Char(one) => letter == *one,
            Letter::Class(class) => class.holds(letter, self.fold),
        }
    }

    fn next_start(&self, text: &str, from: usize) -> Option<usize> {
        let Some(first) = &self.first else {
            return Some(from);
        };

        let rest = text.get(from..)?;
        let step = rest
            .char_indices()
            .find(|&(_, c)| first.holds(c, self.fold))
            .map(|(at, _)| at)?;

        from.checked_add(step)
    }

    fn attempt(&self, text: &str, start: usize, budget: &Cell<usize>) -> Option<Vec<usize>> {
        let cells = vec![UNSET; self.program.cells];
        self.attempt_from(text, start, 0, cells, false, budget)
    }

    fn attempt_from(
        &self,
        text: &str,
        start: usize,
        pc: usize,
        cells: Vec<usize>,
        back: bool,
        budget: &Cell<usize>,
    ) -> Option<Vec<usize>> {
        let mut run = Run {
            text,
            cells,
            trail: Vec::new(),
            choices: Vec::new(),
            pc,
            pos: start,
            back,
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

    fn follow(&self, run: &mut Run, budget: &Cell<usize>) -> Option<bool> {
        loop {
            budget.set(budget.get().checked_sub(1)?);

            let Some(step) = self.program.steps.get(run.pc).copied() else {
                return Some(false);
            };

            match step {
                Step::Char(_) | Step::Any | Step::Class(_) => {
                    let read = if run.back { letter_before } else { letter_at };
                    let Some(letter) = read(run.text, run.pos) else {
                        return Some(false);
                    };
                    if !self.accepts(step, letter) {
                        return Some(false);
                    }

                    if run.back {
                        run.pos -= letter.len_utf8();
                    } else {
                        run.pos += letter.len_utf8();
                    }
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
                    if run.cells.get(cell).copied() == Some(run.pos) {
                        return Some(false);
                    }
                    run.pc += 1;
                }
                Step::Clear { from, to } => {
                    budget.set(budget.get().saturating_sub(to.saturating_sub(from)));

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
                Step::Look {
                    behind,
                    negated,
                    after,
                } => {
                    match self.looks(run, behind, budget)? {
                        Seen::Found(cells) if !negated => run.adopt(cells),
                        Seen::Missed if negated => {}
                        _ => return Some(false),
                    }
                    run.pc = after;
                }
                Step::Backref(group) => {
                    let Some(to) = self.called(run, group, budget) else {
                        return Some(false);
                    };
                    run.pos = to;
                    run.pc += 1;
                }
                Step::Done => return Some(true),
            }
        }
    }

    fn looks(&self, run: &Run, behind: bool, budget: &Cell<usize>) -> Option<Seen> {
        let body = run.pc.checked_add(1)?;
        let seen = self.attempt_from(run.text, run.pos, body, run.cells.clone(), behind, budget);
        unless_spent(seen, budget)
    }

    fn called(&self, run: &Run, group: usize, budget: &Cell<usize>) -> Option<usize> {
        let Some((from, to)) = span(&run.cells, group) else {
            return Some(run.pos);
        };
        budget.set(budget.get().saturating_sub(to - from));
        let wanted = run.text.get(from..to)?;
        let (mut letters, mut wants): (
            Box<dyn Iterator<Item = char>>,
            Box<dyn Iterator<Item = char>>,
        ) = if run.back {
            (
                Box::new(run.text.get(..run.pos)?.chars().rev()),
                Box::new(wanted.chars().rev()),
            )
        } else {
            (
                Box::new(run.text.get(run.pos..)?.chars()),
                Box::new(wanted.chars()),
            )
        };

        let mut taken = 0;
        for want in wants.by_ref() {
            let got = letters.next()?;
            let same = if self.fold {
                folded(got) == folded(want)
            } else {
                got == want
            };
            if !same {
                return None;
            }
            taken += got.len_utf8();
        }

        if run.back {
            run.pos.checked_sub(taken)
        } else {
            run.pos.checked_add(taken)
        }
    }

    fn accepts(&self, step: Step, c: char) -> bool {
        match step {
            Step::Char(wanted) => {
                if self.fold {
                    folded(c) == folded(wanted)
                } else {
                    c == wanted
                }
            }
            Step::Any => !ends_line(c),
            Step::Class(index) => self
                .program
                .classes
                .get(index)
                .is_some_and(|class| class.holds(c, self.fold)),
            _ => false,
        }
    }

    fn take(&self, text: &str, cells: &[usize], start: usize) -> Match {
        let (from, to) = span(cells, 0).unwrap_or((start, start));
        let mut groups = Vec::with_capacity(self.groups);

        for group in 1..=self.groups {
            let caught = span(cells, group)
                .and_then(|(open, close)| text.get(open..close))
                .map_or_else(String::new, str::to_owned);
            groups.push(caught);
        }

        Match { from, to, groups }
    }
}

enum Seen {
    Found(Vec<usize>),
    Missed,
}

fn unless_spent(seen: Option<Vec<usize>>, budget: &Cell<usize>) -> Option<Seen> {
    match seen {
        Some(cells) => Some(Seen::Found(cells)),
        None if budget.get() == 0 => None,
        None => Some(Seen::Missed),
    }
}

impl Run<'_> {
    fn adopt(&mut self, cells: Vec<usize>) {
        for (cell, now) in cells.into_iter().enumerate() {
            let Some(slot) = self.cells.get_mut(cell) else {
                continue;
            };
            if *slot != now {
                self.trail.push((cell, *slot));
                *slot = now;
            }
        }
    }

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

fn letter_at(text: &str, at: usize) -> Option<char> {
    text.get(at..).and_then(|rest| rest.chars().next())
}

fn letter_before(text: &str, at: usize) -> Option<char> {
    text.get(..at).and_then(|head| head.chars().next_back())
}

fn asserts(step: Step, text: &str, pos: usize) -> bool {
    match step {
        Step::Start => pos == 0,
        Step::End => pos == text.len(),
        Step::Boundary(wanted) => {
            let before = letter_before(text, pos);
            (wordish(before) != wordish(letter_at(text, pos))) == wanted
        }
        _ => false,
    }
}

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

fn wordish(c: Option<char>) -> bool {
    c.is_some_and(is_word)
}

fn is_word(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

fn ends_line(c: char) -> bool {
    matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}')
}

pub(crate) fn is_space(c: char) -> bool {
    let breaks = ends_line(c);
    let blanks = matches!(c, '\t' | '\u{b}' | '\u{c}' | ' ' | '\u{a0}' | '\u{feff}');
    let wide = matches!(c, '\u{1680}' | '\u{202f}' | '\u{205f}' | '\u{3000}');
    breaks || blanks || wide || ('\u{2000}'..='\u{200a}').contains(&c)
}

fn folded(c: char) -> char {
    let mut lower = c.to_lowercase();
    match (lower.next(), lower.next()) {
        (Some(one), None) => one,
        _ => c,
    }
}

fn raised(c: char) -> char {
    let mut upper = c.to_uppercase();
    match (upper.next(), upper.next()) {
        (Some(one), None) => one,
        _ => c,
    }
}

impl Kind {
    fn holds(self, c: char) -> bool {
        match self {
            Kind::Digit => c.is_ascii_digit(),
            Kind::Word => is_word(c),
            Kind::Space => is_space(c),
        }
    }

    fn members(self) -> &'static [char] {
        match self {
            Kind::Digit => &DIGITS,
            Kind::Word => &WORDS,
            Kind::Space => &SPACES,
        }
    }
}

static DIGITS: LazyLock<Vec<char>> = LazyLock::new(|| listed(Kind::Digit));
static WORDS: LazyLock<Vec<char>> = LazyLock::new(|| listed(Kind::Word));
static SPACES: LazyLock<Vec<char>> = LazyLock::new(|| listed(Kind::Space));

fn listed(kind: Kind) -> Vec<char> {
    let ceiling = match kind {
        Kind::Digit | Kind::Word => 0x7f,
        Kind::Space => 0xfeff,
    };

    (0..=ceiling)
        .filter_map(char::from_u32)
        .filter(|&c| kind.holds(c))
        .collect()
}

impl Class {
    fn holds(&self, c: char, fold: bool) -> bool {
        let inside = self.members.iter().any(|member| member.holds(c, fold));
        inside != self.negated
    }
}

impl Member {
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
                let range = lo..=hi;
                range.contains(&c)
                    || (fold && (range.contains(&folded(c)) || range.contains(&raised(c))))
            }
            Member::Set(kind, negated) => kind.holds(c) != negated,
        }
    }
}

struct Parser<'a> {
    src: &'a [char],
    at: usize,
    groups: usize,
    depth: usize,
    names: Vec<(String, usize)>,
}

impl Parser<'_> {
    fn peek(&self) -> Option<char> {
        self.src.get(self.at).copied()
    }

    fn ahead(&self, by: usize) -> Option<char> {
        self.src.get(self.at.checked_add(by)?).copied()
    }

    fn eat(&mut self) -> Option<char> {
        let c = self.peek()?;
        self.at += 1;
        Some(c)
    }

    fn eat_if(&mut self, c: char) -> bool {
        if self.peek() == Some(c) {
            self.at += 1;
            true
        } else {
            false
        }
    }

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

    fn term(&mut self) -> Option<Node> {
        let atom = self.atom()?;
        match self.quantifier() {
            Quantifier::Absent => Some(atom),
            Quantifier::Broken => None,
            Quantifier::Given(limits) => {
                if !repeatable(&atom) || self.quantifier_ahead() {
                    return None;
                }
                Some(Node::Repeat(Box::new(atom), limits))
            }
        }
    }

    fn quantifier_ahead(&self) -> bool {
        match self.peek() {
            Some('*' | '+' | '?') => true,
            Some('{') => self.counted_ahead(),
            _ => false,
        }
    }

    fn counted_ahead(&self) -> bool {
        let mut at = self.at.saturating_add(1);
        let digits = |from: usize| {
            self.src.get(from..).map_or(0, |rest| {
                rest.iter().take_while(|c| c.is_ascii_digit()).count()
            })
        };

        let first = digits(at);
        if first == 0 {
            return false;
        }
        at += first;
        if self.src.get(at) == Some(&',') {
            at += 1;
            at += digits(at);
        }
        self.src.get(at) == Some(&'}')
    }

    fn atom(&mut self) -> Option<Node> {
        let c = self.eat()?;
        match c {
            '.' => Some(Node::Any),
            '^' => Some(Node::Start),
            '$' => Some(Node::End),
            '(' => self.group(),
            '[' => self.class().map(Node::Class),
            '\\' => self.escape(),
            '*' | '+' | '?' => None,
            '{' => {
                self.at -= 1;
                let counted = self.counted_ahead();
                self.at += 1;
                (!counted).then_some(Node::Char('{'))
            }
            _ => Some(Node::Char(c)),
        }
    }

    fn group(&mut self) -> Option<Node> {
        let mut look = None;
        let number = if self.eat_if('?') {
            match (self.eat()?, self.peek()) {
                (':', _) => None,
                ('=', _) => {
                    look = Some(Look {
                        behind: false,
                        negated: false,
                    });
                    None
                }
                ('!', _) => {
                    look = Some(Look {
                        behind: false,
                        negated: true,
                    });
                    None
                }
                ('<', Some(mark @ ('=' | '!'))) => {
                    self.at += 1;
                    look = Some(Look {
                        behind: true,
                        negated: mark == '!',
                    });
                    None
                }
                ('<', _) => {
                    let name = self.name()?;
                    if self.names.iter().any(|(taken, _)| *taken == name) {
                        return None;
                    }
                    let given = self.capture()?;
                    self.names.push((name, given));
                    Some(given)
                }
                _ => return None,
            }
        } else {
            Some(self.capture()?)
        };

        self.depth += 1;
        if self.depth > DEPTH_LIMIT {
            return None;
        }
        let inner = self.alternation()?;
        self.depth = self.depth.saturating_sub(1);

        if !self.eat_if(')') {
            return None;
        }

        if let Some(look) = look {
            return Some(Node::Look(look, Box::new(inner)));
        }
        Some(Node::Group(number, Box::new(inner)))
    }

    fn capture(&mut self) -> Option<usize> {
        let given = self.groups;
        self.groups = self.groups.checked_add(1)?;
        Some(given)
    }

    fn name(&mut self) -> Option<String> {
        let mut name = String::new();
        loop {
            let c = self.eat()?;
            if c == '>' {
                break;
            }
            let fits = if name.is_empty() {
                c.is_alphabetic() || c == '_' || c == '$'
            } else {
                c.is_alphanumeric() || c == '_' || c == '$'
            };
            if !fits {
                return None;
            }
            name.push(c);
        }
        (!name.is_empty()).then_some(name)
    }

    fn coded(&mut self, c: char) -> Option<char> {
        match c {
            'x' => {
                let value = self.hex(2)?;
                char::from_u32(value)
            }
            'u' => {
                if self.eat_if('{') {
                    let mut value: u32 = 0;
                    let mut seen = 0;
                    while let Some(digit) = self.peek().and_then(|d| d.to_digit(16)) {
                        value = value.checked_mul(16)?.checked_add(digit)?;
                        if value > 0x10_ffff {
                            return None;
                        }
                        seen += 1;
                        self.at += 1;
                    }
                    if seen == 0 || !self.eat_if('}') {
                        return None;
                    }
                    return char::from_u32(value);
                }
                let high = self.hex(4)?;
                if !(0xd800..0xdc00).contains(&high) {
                    return char::from_u32(high);
                }
                if self.peek() != Some('\\') || self.ahead(1) != Some('u') {
                    return None;
                }
                self.at += 2;
                let low = self.hex(4)?;
                if !(0xdc00..0xe000).contains(&low) {
                    return None;
                }
                let value = 0x1_0000 + ((high - 0xd800) << 10) + (low - 0xdc00);
                char::from_u32(value)
            }
            'c' => {
                let letter = self.peek().filter(char::is_ascii_alphabetic)?;
                self.at += 1;
                char::from_u32(u32::from(letter) % 32)
            }
            _ => None,
        }
    }

    fn hex(&mut self, count: usize) -> Option<u32> {
        let mut value: u32 = 0;
        for _ in 0..count {
            let digit = self.peek()?.to_digit(16)?;
            value = value * 16 + digit;
            self.at += 1;
        }
        Some(value)
    }

    fn escape(&mut self) -> Option<Node> {
        let c = self.eat()?;

        if let Some((kind, negated)) = named_set(c) {
            return Some(one_set(kind, negated));
        }

        match c {
            'b' => Some(Node::Boundary(true)),
            'B' => Some(Node::Boundary(false)),
            '1'..='9' => {
                let mut number = usize::try_from(c.to_digit(10)?).ok()?;
                while let Some(digit) = self.peek().and_then(|d| d.to_digit(10)) {
                    number = number
                        .checked_mul(10)?
                        .checked_add(usize::try_from(digit).ok()?)?;
                    self.at += 1;
                }
                Some(Node::Backref(number))
            }
            'k' => {
                if !self.eat_if('<') {
                    return None;
                }
                self.name().map(Node::Named)
            }
            'x' | 'u' | 'c' => self.coded(c).map(Node::Char),
            _ => literal_escape(c, self.peek()).map(Node::Char),
        }
    }

    fn class(&mut self) -> Option<Class> {
        let negated = self.eat_if('^');
        let mut members = Vec::new();

        if self.eat_if(']') {
            members.push(Member::One(']'));
        }

        loop {
            let c = self.peek()?;
            if c == ']' {
                self.at += 1;
                break;
            }

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
                    if lo > hi {
                        return None;
                    }
                    members.push(Member::Span(lo, hi));
                }
                (start, end) => {
                    members.push(start);
                    members.push(Member::One('-'));
                    members.push(end);
                }
            }
        }

        Some(Class { negated, members })
    }

    fn class_atom(&mut self) -> Option<Member> {
        let c = self.eat()?;
        if c != '\\' {
            return Some(Member::One(c));
        }

        let escaped = self.eat()?;
        if let Some((kind, negated)) = named_set(escaped) {
            return Some(Member::Set(kind, negated));
        }

        if escaped == 'b' {
            return Some(Member::One('\u{8}'));
        }

        if matches!(escaped, 'x' | 'u' | 'c') {
            return self.coded(escaped).map(Member::One);
        }

        literal_escape(escaped, self.peek()).map(Member::One)
    }

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
                if !self.counted_ahead() {
                    return Quantifier::Absent;
                }
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

fn one_set(kind: Kind, negated: bool) -> Node {
    Node::Class(Class {
        negated: false,
        members: vec![Member::Set(kind, negated)],
    })
}

fn literal_escape(c: char, next: Option<char>) -> Option<char> {
    match c {
        'n' => Some('\n'),
        't' => Some('\t'),
        'r' => Some('\r'),
        'f' => Some('\u{c}'),
        'v' => Some('\u{b}'),
        '0' if !next.is_some_and(|d| d.is_ascii_digit()) => Some('\0'),
        _ if !c.is_alphanumeric() => Some(c),
        _ => None,
    }
}

impl First {
    fn new(chars: &[char]) -> Option<First> {
        if chars.is_empty() || chars.len() > FIRST_LIMIT {
            return None;
        }

        let mut ascii = [false; 128];
        let mut wide = Vec::new();
        for &c in chars {
            let at = usize::try_from(u32::from(c)).unwrap_or(usize::MAX);
            if let Some(flag) = ascii.get_mut(at) {
                *flag = true;
            } else {
                wide.push(c);
            }
        }

        Some(First { ascii, wide })
    }

    fn holds(&self, c: char, fold: bool) -> bool {
        if self.has(c) {
            return true;
        }

        fold && (self.has(folded(c)) || self.has(raised(c)))
    }

    fn has(&self, c: char) -> bool {
        usize::try_from(u32::from(c))
            .ok()
            .and_then(|at| self.ascii.get(at))
            .copied()
            .unwrap_or_else(|| self.wide.contains(&c))
    }
}

fn first_of(node: &Node, fold: bool) -> Option<Vec<char>> {
    match node {
        Node::Char(c) => {
            let mut out = Vec::new();
            spread(&mut out, *c, fold)?;
            Some(out)
        }
        Node::Class(class) => class_first(class, fold),
        Node::Group(_, inner) => first_of(inner, fold),
        Node::Seq(nodes) => first_of(nodes.first()?, fold),
        Node::Alt(branches) => {
            let mut out = Vec::new();
            for branch in branches {
                for c in first_of(branch, fold)? {
                    add(&mut out, c)?;
                }
            }
            Some(out)
        }
        Node::Repeat(inner, limits) => {
            if limits.min == 0 {
                return None;
            }
            first_of(inner, fold)
        }
        Node::Any
        | Node::Start
        | Node::End
        | Node::Boundary(_)
        | Node::Look(..)
        | Node::Backref(_)
        | Node::Named(_) => None,
    }
}

const LONGEST_LEAD: usize = 16;

fn lead_of(node: &Node, fold: bool) -> Option<Vec<Start>> {
    let free = !calls_back(node);
    let Node::Alt(branches) = unwrapped(node, free) else {
        return Some(vec![Start::Run(run_of(node, free)?)]);
    };

    let starts = branches
        .iter()
        .map(|branch| {
            run_of(branch, free).map(Start::Run).or_else(|| {
                first_of(branch, fold)
                    .and_then(|chars| First::new(&chars))
                    .map(Start::Letters)
            })
        })
        .collect::<Option<Vec<Start>>>()?;
    starts
        .iter()
        .any(|one| matches!(one, Start::Run(_)))
        .then_some(starts)
}

fn unwrapped(node: &Node, free: bool) -> &Node {
    match node {
        Node::Group(None, inner) => unwrapped(inner, free),
        Node::Group(Some(_), inner) if free => unwrapped(inner, free),
        one => one,
    }
}

fn calls_back(node: &Node) -> bool {
    match node {
        Node::Backref(_) | Node::Named(_) => true,
        Node::Group(_, inner) | Node::Look(_, inner) | Node::Repeat(inner, _) => calls_back(inner),
        Node::Seq(nodes) | Node::Alt(nodes) => nodes.iter().any(calls_back),
        Node::Char(_)
        | Node::Any
        | Node::Class(_)
        | Node::Start
        | Node::End
        | Node::Boundary(_) => false,
    }
}

fn flattened<'a>(node: &'a Node, free: bool, out: &mut Vec<&'a Node>) {
    match node {
        Node::Seq(nodes) => {
            for one in nodes {
                flattened(one, free, out);
            }
        }
        Node::Group(None, inner) => flattened(inner, free, out),
        Node::Group(Some(_), inner) if free => flattened(inner, free, out),
        one => out.push(one),
    }
}

fn run_of(node: &Node, free: bool) -> Option<Lead> {
    let mut atoms = Vec::new();
    flattened(node, free, &mut atoms);

    let mut prefix = Vec::new();
    for one in atoms.into_iter().take(LONGEST_LEAD) {
        if let Node::Repeat(inner, Limits { max: None, .. }) = one {
            return Some(Lead {
                prefix,
                run: one_letter(inner, free)?,
            });
        }
        prefix.push(one_letter(one, free)?);
    }
    None
}

fn one_letter(node: &Node, free: bool) -> Option<Letter> {
    match node {
        Node::Any => Some(Letter::Any),
        Node::Char(c) => Some(Letter::Char(*c)),
        Node::Class(class) => Some(Letter::Class(class.clone())),
        Node::Group(None, inner) => one_letter(inner, free),
        Node::Group(Some(_), inner) if free => one_letter(inner, free),
        _ => None,
    }
}

fn advanced(text: &str, from: usize, letters: usize) -> Option<usize> {
    let rest = text.get(from..)?;
    match rest.char_indices().nth(letters) {
        Some((at, _)) => from.checked_add(at),
        None => (rest.chars().count() == letters).then_some(text.len()),
    }
}

fn repeatable(atom: &Node) -> bool {
    !matches!(
        atom,
        Node::Look(..) | Node::Start | Node::End | Node::Boundary(_)
    )
}

fn called_back(node: &mut Node, names: &[(String, usize)], groups: usize) -> Option<()> {
    match node {
        Node::Named(name) => {
            let index = names.iter().find(|(given, _)| given == name)?.1;
            *node = Node::Backref(index.checked_add(1)?);
        }
        Node::Backref(group) => {
            if *group > groups {
                return None;
            }
        }
        Node::Group(_, inner) | Node::Look(_, inner) | Node::Repeat(inner, _) => {
            called_back(inner, names, groups)?;
        }
        Node::Seq(nodes) | Node::Alt(nodes) => {
            for inner in nodes {
                called_back(inner, names, groups)?;
            }
        }
        Node::Char(_)
        | Node::Any
        | Node::Class(_)
        | Node::Start
        | Node::End
        | Node::Boundary(_) => {}
    }
    Some(())
}

fn class_first(class: &Class, fold: bool) -> Option<Vec<char>> {
    if class.negated {
        return None;
    }

    let mut out = Vec::new();
    for member in &class.members {
        match *member {
            Member::One(c) => spread(&mut out, c, fold)?,
            Member::Span(lo, hi) => {
                for value in u32::from(lo)..=u32::from(hi) {
                    let Some(c) = char::from_u32(value) else {
                        continue;
                    };
                    spread(&mut out, c, fold)?;
                }
            }
            Member::Set(kind, negated) => {
                if negated {
                    return None;
                }
                for &c in kind.members() {
                    spread(&mut out, c, fold)?;
                }
            }
        }
    }

    Some(out)
}

fn spread(out: &mut Vec<char>, c: char, fold: bool) -> Option<()> {
    add(out, c)?;
    if fold {
        add(out, folded(c))?;
        add(out, raised(c))?;
    }
    Some(())
}

fn add(out: &mut Vec<char>, c: char) -> Option<()> {
    if out.contains(&c) {
        return Some(());
    }
    if out.len() >= FIRST_LIMIT {
        return None;
    }

    out.push(c);
    Some(())
}

impl Program {
    fn push(&mut self, step: Step) -> Option<usize> {
        if self.steps.len() >= PROGRAM_LIMIT {
            return None;
        }

        let at = self.steps.len();
        self.steps.push(step);
        Some(at)
    }

    fn patch(&mut self, at: usize, step: Step) -> Option<()> {
        *self.steps.get_mut(at)? = step;
        Some(())
    }

    fn cell(&mut self) -> Option<usize> {
        let taken = self.cells;
        self.cells = self.cells.checked_add(1)?;
        Some(taken)
    }

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
                    let (first, last) = if self.backward {
                        (close, open)
                    } else {
                        (open, close)
                    };
                    self.push(Step::Save(first))?;
                    self.emit(inner)?;
                    self.push(Step::Save(last))?;
                } else {
                    self.emit(inner)?;
                }
            }
            Node::Look(look, inner) => {
                let behind = look.behind;
                let at = self.push(Step::Jump(0))?;
                let outer = std::mem::replace(&mut self.backward, behind);
                self.emit(inner)?;
                self.backward = outer;
                self.push(Step::Done)?;
                let after = self.steps.len();
                self.patch(
                    at,
                    Step::Look {
                        behind,
                        negated: look.negated,
                        after,
                    },
                )?;
            }
            Node::Backref(group) => {
                self.push(Step::Backref(*group))?;
            }
            Node::Named(_) => return None,
            Node::Seq(nodes) => {
                if self.backward {
                    for inner in nodes.iter().rev() {
                        self.emit(inner)?;
                    }
                } else {
                    for inner in nodes {
                        self.emit(inner)?;
                    }
                }
            }
            Node::Alt(branches) => self.emit_alt(branches)?,
            Node::Repeat(inner, limits) => self.emit_repeat(inner, *limits)?,
        }

        Some(())
    }

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

    fn emit_repeat(&mut self, node: &Node, limits: Limits) -> Option<()> {
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

    fn emit_round(&mut self, node: &Node, clear: Option<Step>) -> Option<()> {
        if let Some(step) = clear {
            self.push(step)?;
        }
        self.emit(node)
    }

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

    fn emit_optional(
        &mut self,
        node: &Node,
        clear: Option<Step>,
        count: usize,
        lazy: bool,
    ) -> Option<()> {
        let mut splits = Vec::new();

        for _ in 0..count {
            let cell = self.cell()?;
            splits.push(self.push(Step::Jump(0))?);
            self.push(Step::Save(cell))?;
            self.emit_round(node, clear)?;
            self.push(Step::Advanced(cell))?;
        }

        let after = self.steps.len();
        for split in splits {
            let body = split.checked_add(1)?;
            self.patch(split, branch(body, after, lazy))?;
        }

        Some(())
    }
}

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
        Node::Repeat(inner, _) | Node::Look(_, inner) => groups_in(inner),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{Kind, Match, Pattern, BUDGET};
    use std::cell::Cell;

    fn find(pattern: &Pattern, text: &str, at: usize) -> Option<Match> {
        pattern.find_within(text, at, &Cell::new(BUDGET))
    }

    fn run(source: &str, subject: &str, fold: bool, from: usize) -> Option<Match> {
        find(&Pattern::compile(source, fold)?, subject, from)
    }

    fn first(source: &str, subject: &str) -> Option<String> {
        let found = run(source, subject, false, 0)?;
        Some(subject.get(found.from..found.to)?.to_owned())
    }

    fn folding(source: &str, subject: &str) -> Option<String> {
        let found = run(source, subject, true, 0)?;
        Some(subject.get(found.from..found.to)?.to_owned())
    }

    fn spans(source: &str, subject: &str, from: usize) -> Option<(usize, usize)> {
        let found = run(source, subject, false, from)?;
        Some((found.from, found.to))
    }

    fn caught(source: &str, subject: &str) -> Option<Vec<String>> {
        Some(run(source, subject, false, 0)?.groups)
    }

    fn words(list: &[&str]) -> Vec<String> {
        list.iter().copied().map(String::from).collect()
    }

    fn starts(source: &str, fold: bool) -> Option<Vec<char>> {
        let first = Pattern::compile(source, fold)?.first?;
        let mut out: Vec<char> = (0..128u32)
            .filter_map(char::from_u32)
            .filter(|&c| first.has(c))
            .collect();
        out.extend(first.wide.iter().copied());
        out.sort_unstable();
        Some(out)
    }

    fn knows_start(source: &str) -> bool {
        Pattern::compile(source, false).is_some_and(|pattern| pattern.first.is_some())
    }

    fn without_filter(mut pattern: Pattern) -> Pattern {
        pattern.first = None;
        pattern
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
        assert_eq!(first(".", "\r"), None);
        assert_eq!(first("TODO.", "TODO\r\n"), None);
        assert_eq!(first(".", "\u{2028}\u{2029}"), None);
        assert_eq!(first("a.", "aä").as_deref(), Some("aä"));
    }

    #[test]
    fn a_match_counts_in_bytes_the_way_a_span_does() {
        let found = Pattern::compile(r"\d+", false).and_then(|p| find(&p, "äöü42", 0));
        assert_eq!(
            found,
            Some(Match {
                from: 6,
                to: 8,
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
    fn a_set_lists_itself_once() {
        let spaces = Kind::Space.members();

        assert!(std::ptr::eq(spaces, Kind::Space.members()));
        assert!(spaces.contains(&' ') && spaces.contains(&'\t'));
        assert!(!spaces.contains(&'a'));
        assert!(spaces.iter().all(|&one| Kind::Space.holds(one)));
        assert_eq!(Kind::Digit.members().len(), 10);
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
        assert_eq!(first("^b", "a\nb"), None);
        assert_eq!(first("a$", "a\nb"), None);
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
            "(?i)a",
            r"\1",
            r"\p{L}",
            r"\a",
            r"\01",
            r"(a)\2",
            r"\k<x>",
            "(?<x>a)(?<x>b)",
            "(?<1x>a)",
            "(?=a)*",
            r"\u{110000}",
            r"\uD83D",
            r"[\1]",
            "{2}",
            "^*",
            "$+",
            r"\b{2}",
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
    fn a_look_around_asks_without_taking() {
        assert_eq!(spans("foo(?!bar)", "foobar foobaz", 0), Some((7, 10)));
        assert_eq!(spans("foo(?=baz)", "foobar foobaz", 0), Some((7, 10)));
        assert_eq!(spans(r"(?<=\$)\d+", "a 12 $34", 0), Some((6, 8)));
        assert_eq!(spans(r"(?<!\$)\b\d+", "$12 34", 0), Some((4, 6)));
        assert_eq!(spans(r"(?<=^|\s)#\w+", "a#b #c", 0), Some((4, 6)));
        assert_eq!(spans(r"(?<=ä.)x", "äöx", 0), Some((4, 5)));
        assert_eq!(caught("(?=(a+))a", "aaa"), Some(words(&["aaa"])));
        assert_eq!(caught("(?!(b))a", "a"), Some(words(&[""])));
        assert_eq!(folding("(?<=X)y", "xY").as_deref(), Some("Y"));
    }

    #[test]
    fn a_look_behind_of_any_length_reads_back_only_as_far_as_it_needs() {
        let pattern = Pattern::compile(r"(?<=status:\s*)\w+", false);
        assert!(pattern.is_some());
        let Some(pattern) = pattern else {
            return;
        };
        let note = "status: open some text here and more\n".repeat(400);
        let budget = Cell::new(super::budget_for(note.len()));
        let mut found = 0;
        let mut at = 0;
        while let Some(hit) = pattern.find_within(&note, at, &budget) {
            found += 1;
            at = hit.to.max(hit.from + 1);
        }
        assert_eq!(found, 400);
        assert_eq!(caught(r"(?<=(\d+))x\1", "123x123"), Some(words(&["123"])));
        assert_eq!(first(r"(?<=(\d+))x\1", "123x123").as_deref(), Some("x123"));
        assert_eq!(caught(r"(?<=(a+)(a+))b", "aaab"), Some(words(&["a", "aa"])));
    }

    fn every_hit(pattern: &Pattern, text: &str, budget: usize) -> Vec<(usize, usize)> {
        let budget = Cell::new(budget);
        let mut out = Vec::new();
        let mut at = 0;
        while at <= text.len() {
            let Some(hit) = pattern.find_within(text, at, &budget) else {
                break;
            };
            out.push((hit.from, hit.to));
            let step = text[hit.to..].chars().next().map_or(1, char::len_utf8);
            at = if hit.to == hit.from {
                hit.to + step
            } else {
                hit.to
            };
        }
        out
    }

    #[test]
    fn a_pattern_led_by_a_long_run_finds_every_hit_on_long_lines() {
        let paragraphs = format!(
            "{}note TODO\n",
            format!("{}\n", "word ".repeat(400)).repeat(4)
        );
        let pairs = format!("{}\n{}TODO\n", "word ".repeat(60), "word ".repeat(59)).repeat(100);
        for (source, text, hits) in [
            (".*TODO", &paragraphs, 1),
            (r".*\bTODO", &paragraphs, 1),
            (".*TODO", &pairs, 100),
            (".+TODO", &pairs, 100),
            ("[^.]*TODO", &pairs, 1),
            (r"[^.\n]*TODO", &pairs, 100),
            (".*?TODO", &pairs, 100),
            (r"\w.*TODO", &pairs, 100),
            (r"\w.*TODO", &paragraphs, 1),
            (r"(?:wo)rd.*TODO", &pairs, 100),
            ("(.*)TODO", &pairs, 100),
            ("(.+) TODO", &paragraphs, 1),
            ("(.*)TODO(.*)", &pairs, 100),
            (".*TODO|FIXME", &pairs, 100),
            ("(.*TODO|FIXME)", &paragraphs, 1),
        ] {
            let pattern = Pattern::compile(source, false);
            assert!(pattern.is_some(), "{source}");
            let Some(pattern) = pattern else {
                return;
            };
            let found = every_hit(&pattern, text, super::budget_for(text.len()));
            assert_eq!(found.len(), hits, "{source}");
        }
    }

    #[test]
    fn skipping_past_a_leading_run_finds_what_trying_every_start_finds() {
        let texts = [
            "aab ab b\nxaab\n\nbba",
            "TODO x TODO\nword TODO word\n",
            "ccd abcd xyzd\nd",
            "ab\u{e9}\u{1d49c}b a\u{1d49c}b",
        ];
        for source in [
            ".*b",
            ".+?b",
            "[^x]*b",
            "a*b",
            "(?:.)*d",
            "[a-c]{2,}d",
            "x*$",
            ".*(?<=a)b",
            r".*\bTODO",
            r"(.*)\1",
            "(?:a|b)*b",
            ".*",
            r"\w*\u{1d49c}b",
            r"\w.*b",
            "ab+c",
            "[ab]x*b",
            r"a\w*?b",
            r"(?:a\u{1d49c}).+b",
            r"\u{e9}.*b",
            "(.*)b",
            "(a)(.*)b",
            ".*b|x",
            "a.*b|.+c",
            "(?:.*b|c)",
            "(x|.*b)",
            r"(.*)b\1",
            "(?<n>.*)b",
        ] {
            for fold in [false, true] {
                let led = Pattern::compile(source, fold);
                let plain = Pattern::compile(source, fold).map(|mut one| {
                    one.lead = None;
                    one
                });
                let (Some(led), Some(plain)) = (led, plain) else {
                    panic!("{source} should compile");
                };
                for text in texts {
                    assert_eq!(
                        every_hit(&led, text, super::BUDGET),
                        every_hit(&plain, text, super::BUDGET),
                        "{source} on {text:?}"
                    );
                }
            }
        }
    }

    #[test]
    fn a_counted_round_past_the_least_that_takes_nothing_does_not_count() {
        assert_eq!(spans("(?:^|\\w{2})?a", "aaa", 0), Some((0, 3)));
        assert_eq!(caught("(^|a)?(a+)", "aaa"), Some(words(&["a", "aa"])));
        assert_eq!(caught("(a?){1,2}", "a"), Some(words(&["a"])));
        assert_eq!(caught("([ab]??){1,2}", "ab"), Some(words(&["a"])));
    }

    #[test]
    fn calling_a_long_group_back_spends_the_budget_it_reads() {
        let subject = "a".repeat(20_000);
        let pattern = Pattern::compile(r"(a*)\1b", false);
        assert!(pattern.is_some());
        let Some(pattern) = pattern else {
            return;
        };
        let started = std::time::Instant::now();
        let budget = Cell::new(super::budget_for(subject.len()));
        assert_eq!(pattern.find_within(&subject, 0, &budget), None);
        assert!(started.elapsed().as_secs() < 3, "{:?}", started.elapsed());
    }

    #[test]
    fn a_group_is_called_back_by_number_or_by_name() {
        assert_eq!(first(r"(\w)\1", "abccd").as_deref(), Some("cc"));
        assert_eq!(folding(r"(a)\1", "aA").as_deref(), Some("aA"));
        assert_eq!(
            first(r"(?<y>\d{4})-\k<y>", "2024-2025 2024-2024").as_deref(),
            Some("2024-2024")
        );
        assert_eq!(caught(r"(?<y>\d{4})", "in 2024"), Some(words(&["2024"])));
        assert_eq!(first(r"(a)|b\1", "b").as_deref(), Some("b"));
        assert_eq!(first(r"(ä)\1", "aää").as_deref(), Some("ää"));
    }

    #[test]
    fn a_letter_can_be_written_by_its_code() {
        assert_eq!(first(r"\x41", "zA").as_deref(), Some("A"));
        assert_eq!(first(r"\u0041", "zA").as_deref(), Some("A"));
        assert_eq!(first(r"\u{1F600}", "a😀").as_deref(), Some("😀"));
        assert_eq!(first(r"\uD83D\uDE00", "a😀").as_deref(), Some("😀"));
        assert_eq!(first(r"a\cJb", "a\nb").as_deref(), Some("a\nb"));
        assert_eq!(first(r"[\x41-\x43]+", "ABCD").as_deref(), Some("ABC"));
        assert_eq!(first(r"[\u{1F600}]", "😀").as_deref(), Some("😀"));
    }

    #[test]
    fn a_brace_that_counts_nothing_is_a_brace() {
        assert_eq!(
            first(r"{{\w+}}", "say {{name}} here").as_deref(),
            Some("{{name}}")
        );
        assert_eq!(first("a{,3}", "a{,3}").as_deref(), Some("a{,3}"));
        assert_eq!(first("a{", "a{").as_deref(), Some("a{"));
        assert_eq!(first("a{x}", "a{x}").as_deref(), Some("a{x}"));
        assert_eq!(first("a{2}{", "aa{").as_deref(), Some("aa{"));
        assert_eq!(first("}", "a}").as_deref(), Some("}"));
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
        let pattern = Pattern::compile("(a+)+b", false);
        assert!(pattern.is_some(), "the pattern itself is a fine one");

        let started = std::time::Instant::now();
        assert_eq!(pattern.and_then(|p| find(&p, &subject, 0)), None);
        assert!(
            started.elapsed().as_secs() < 5,
            "the step budget should have stopped this long before now"
        );
    }

    #[test]
    fn a_pattern_longer_than_a_search_field_does_not_compile() {
        assert!(Pattern::compile(&"a".repeat(super::SOURCE_LIMIT), false).is_some());
        assert!(Pattern::compile(&"a".repeat(super::SOURCE_LIMIT + 1), false).is_none());
        assert!(Pattern::compile(&"a".repeat(4_000_000), false).is_none());
    }

    #[test]
    fn a_pattern_works_out_what_its_match_can_begin_with() {
        assert_eq!(starts("abc", false), Some(vec!['a']));
        assert_eq!(starts("Z[a-z]+q", false), Some(vec!['Z']));
        assert_eq!(starts("[a-c]x", false), Some(vec!['a', 'b', 'c']));
        assert_eq!(starts("(foo|bar)", false), Some(vec!['b', 'f']));
        assert_eq!(starts("x|y|z", false), Some(vec!['x', 'y', 'z']));
        assert_eq!(starts("a{2,3}", false), Some(vec!['a']));
        assert_eq!(starts("(?:ab)+", false), Some(vec!['a']));
        assert_eq!(starts("(a)(b)", false), Some(vec!['a']));
        assert_eq!(starts(r"\d+", false), Some(('0'..='9').collect()));
        assert_eq!(starts(r"\w", false).map(|set| set.len()), Some(63));
        assert_eq!(starts(r"\s", false).map(|set| set.len()), Some(25));
        assert_eq!(starts("ötest", false), Some(vec!['ö']));
    }

    #[test]
    fn folding_puts_both_cases_in_the_set() {
        assert_eq!(starts("beta", true), Some(vec!['B', 'b']));
        assert_eq!(
            starts("[a-c]", true),
            Some(vec!['A', 'B', 'C', 'a', 'b', 'c'])
        );
        assert_eq!(starts(r"\w", true).map(|set| set.len()), Some(63));
    }

    #[test]
    fn a_pattern_that_could_begin_anywhere_gives_no_set_away() {
        for source in [
            "",
            "^a",
            "a?b",
            ".x",
            "[^a]b",
            r"\ba",
            r"\Ba",
            r"\b",
            "$",
            "(a|.)b",
            "a*b",
            "(a|)b",
            "a{0,2}b",
            "()a",
            "(?:a|b*)c",
            r"\D",
            r"\W",
            r"\S",
            "[^abc]",
            "[ -~]x",
        ] {
            assert!(
                Pattern::compile(source, false).is_some(),
                "{source} should compile"
            );
            assert!(
                !knows_start(source),
                "{source} should give no first character away"
            );
        }
    }

    #[test]
    fn the_set_of_first_characters_changes_no_answer() {
        let cases = [
            ("Z[a-z]+q", "the lazy dog, Zooq, and a Zq"),
            ("B[a-z]+a", "Beta beta BBBa b Bxa"),
            ("(foo|bar)+baz", "xx foobarbaz yy barbaz"),
            (r"\d+\.\d+", "a 3.14 b 42 c 1.0"),
            ("[a-c]x", "zzax bx cx dx"),
            ("note", "a note of notes"),
            ("(?:ab)+", "xababy"),
            ("a{2,3}", "a aa aaaa"),
            (r"\w+@\w+", "write to bob@host now"),
            ("ötest", "aa ötest bb"),
            ("[A-Z]q", "aq Bq zq"),
            ("Ötest", "aa ötest bb"),
            (r"\s+q", "a q  q\tq\u{a0}q"),
            ("[^a]b", "xb ab"),
            ("a*b", "xxb"),
            ("^a.*$", "abc"),
        ];

        assert!(knows_start("Z[a-z]+q"), "the first case should be filtered");

        for (source, subject) in cases {
            for fold in [false, true] {
                let both = Pattern::compile(source, fold).zip(Pattern::compile(source, fold));
                assert!(both.is_some(), "{source} should compile");

                let Some((quick, plain)) = both else {
                    continue;
                };
                let plain = without_filter(plain);

                for at in 0..=subject.len() {
                    if !subject.is_char_boundary(at) {
                        continue;
                    }
                    assert_eq!(
                        find(&quick, subject, at),
                        find(&plain, subject, at),
                        "{source} over {subject:?} from {at}, with fold {fold}"
                    );
                }
            }
        }
    }

    fn roll(seed: &mut u64, ceiling: usize) -> usize {
        *seed = seed
            .wrapping_mul(6_364_136_223_846_793_005)
            .wrapping_add(1_442_695_040_888_963_407);
        let value = usize::try_from(*seed >> 33).unwrap_or(0);
        if ceiling == 0 {
            0
        } else {
            value % ceiling
        }
    }

    #[test]
    fn no_set_of_first_characters_hides_a_match() {
        let pieces = [
            "a", "b", "c", "1", "_", " ", ".", "*", "+", "?", "|", "(", ")", "(?:", "[", "]", "^",
            "$", "-", r"\d", r"\w", r"\s", r"\b", r"\.", "{2}", "{1,2}", "{0,2}", "a-c", "[^", "A",
            "Ö", "ö",
        ];
        let subjects = [
            "", "abc", "a1b2 c-_", "aAbB c", "Ö ö a", "  a1 z", "cab-cab",
        ];

        let mut seed: u64 = 0x5eed_1234;
        let mut checked = 0;

        for _ in 0..4000 {
            let mut source = String::new();
            for _ in 0..=roll(&mut seed, 5) {
                if let Some(piece) = pieces.get(roll(&mut seed, pieces.len())) {
                    source.push_str(piece);
                }
            }

            let fold = roll(&mut seed, 2) == 0;
            let Some(subject) = subjects.get(roll(&mut seed, subjects.len())) else {
                continue;
            };
            let Some((quick, plain)) =
                Pattern::compile(&source, fold).zip(Pattern::compile(&source, fold))
            else {
                continue;
            };

            let plain = without_filter(plain);
            for at in 0..=subject.len() {
                if !subject.is_char_boundary(at) {
                    continue;
                }
                assert_eq!(
                    find(&quick, subject, at),
                    find(&plain, subject, at),
                    "{source} over {subject:?} from {at}, with fold {fold}"
                );
            }
            checked += 1;
        }

        assert!(checked > 500, "only {checked} of the patterns compiled");
    }

    #[test]
    fn a_query_of_the_shape_search_sends_reads_the_line_it_is_given() {
        let line = "  ## A heading, and a #tag";
        let pattern = Pattern::compile(r"^\s*(#+)\s+(.+)$", false);
        let found = pattern.and_then(|p| find(&p, line, 0));
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
