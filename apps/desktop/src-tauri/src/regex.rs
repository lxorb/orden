use std::cell::Cell;
use std::sync::LazyLock;

pub const BUDGET: usize = 250_000;

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
}

struct First {
    ascii: [bool; 128],
    wide: Vec<char>,
}

struct Program {
    steps: Vec<Step>,
    classes: Vec<Class>,
    cells: usize,
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
    Clear { from: usize, to: usize },
    Split { first: usize, second: usize },
    Jump(usize),
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
    Seq(Vec<Node>),
    Alt(Vec<Node>),
    Repeat(Box<Node>, Limits),
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
        };

        let node = parser.alternation()?;

        if parser.at != src.len() {
            return None;
        }

        let groups = parser.groups;
        let mut program = Program {
            steps: Vec::new(),
            classes: Vec::new(),
            cells: groups.checked_add(1)?.checked_mul(2)?,
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

            let step = letter_at(text, start).map_or(1, char::len_utf8);
            start = start.checked_add(step)?;
        }

        None
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

    fn follow(&self, run: &mut Run, budget: &Cell<usize>) -> Option<bool> {
        loop {
            budget.set(budget.get().checked_sub(1)?);

            let Some(step) = self.program.steps.get(run.pc).copied() else {
                return Some(false);
            };

            match step {
                Step::Char(_) | Step::Any | Step::Class(_) => {
                    let Some(letter) = letter_at(run.text, run.pos) else {
                        return Some(false);
                    };
                    if !self.accepts(step, letter) {
                        return Some(false);
                    }

                    run.pos += letter.len_utf8();
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
                Step::Done => return Some(true),
            }
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
            Step::Any => c != '\n',
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

impl Run<'_> {
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

fn is_space(c: char) -> bool {
    let breaks = matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}');
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
                if matches!(self.peek(), Some('*' | '+' | '?' | '{')) {
                    return None;
                }
                Some(Node::Repeat(Box::new(atom), limits))
            }
        }
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
            '*' | '+' | '?' | '{' => None,
            _ => Some(Node::Char(c)),
        }
    }

    fn group(&mut self) -> Option<Node> {
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

        if !self.eat_if(')') {
            return None;
        }

        Some(Node::Group(number, Box::new(inner)))
    }

    fn escape(&mut self) -> Option<Node> {
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
        Node::Any | Node::Start | Node::End | Node::Boundary(_) => None,
    }
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
        Node::Repeat(inner, _) => groups_in(inner),
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
        assert_eq!(first(".", "\r").as_deref(), Some("\r"));
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
