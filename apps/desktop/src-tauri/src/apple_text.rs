use std::collections::HashMap;
use std::io::Read;

use flate2::read::{GzDecoder, ZlibDecoder};

const OBJECT: char = '\u{fffc}';

const SOFT: char = '\u{2028}';

const PLAIN: i32 = -1;
const TITLE: i32 = 0;
const HEADING: i32 = 1;
const SUBHEADING: i32 = 2;
const CODE: i32 = 4;
const DOTTED: i32 = 100;
const DASHED: i32 = 101;
const NUMBERED: i32 = 102;
const CHECKBOX: i32 = 103;

const BOLD: i32 = 1;
const ITALIC: i32 = 2;
const BOLD_ITALIC: i32 = 3;

const SUPER: i32 = 1;
const SUB: i32 = -1;

const STEP: &str = "  ";

const DEEPEST: u32 = 32;

const MOST_BYTES: u64 = 64 * 1024 * 1024;

struct Run {
    length: usize,
    style: i32,
    indent: u32,
    done: Option<bool>,
    quote: bool,
    weight: i32,
    underlined: bool,
    struck: i32,
    baseline: i32,
    emphasis: i32,
    link: Option<String>,
    attachment: Option<(String, String)>,
}

impl Default for Run {
    fn default() -> Self {
        Self {
            length: 0,
            style: PLAIN,
            indent: 0,
            done: None,
            quote: false,
            weight: 0,
            underlined: false,
            struck: 0,
            baseline: 0,
            emphasis: 0,
            link: None,
            attachment: None,
        }
    }
}

#[derive(Default)]
pub struct Body {
    text: Vec<u16>,
    runs: Vec<Run>,
}

pub trait Parts {
    fn attachment(&mut self, id: &str, uti: &str) -> Option<String>;
}

pub fn decode(data: &[u8]) -> Option<Body> {
    let bytes = inflate(data)?;
    let note = held(&bytes, 2).and_then(|document| held(document, 3));

    let note = note.or_else(|| held(&bytes, 3))?;

    Some(note_of(note))
}

fn held(bytes: &[u8], number: u32) -> Option<&[u8]> {
    Fields::new(bytes).find_map(|(held, value)| match value {
        Value::Bytes(inside) if held == number => Some(inside),
        _ => None,
    })
}

pub fn title(body: &Body) -> Option<String> {
    let text = String::from_utf16_lossy(&body.text);

    for line in text.split(['\n', SOFT]) {
        let said = line.replace(OBJECT, "").trim().to_string();
        if !said.is_empty() {
            return Some(said);
        }
    }

    None
}

pub fn markdown(body: &Body, parts: &mut dyn Parts) -> String {
    let mut out = String::new();
    let mut fenced = false;
    let mut counted = 0_u32;
    let mut levels: Vec<(i32, u32)> = Vec::new();
    let fence = fence_for(&body.text);

    for line in lines_of(body) {
        let run = line.run().unwrap_or(&DEFAULT);
        let code = line.run().map_or(fenced, |one| one.style == CODE);

        if code != fenced {
            out.push_str(&fence);
            out.push('\n');
            fenced = code;
        }

        if !line.soft {
            let listed = matches!(run.style, DOTTED | DASHED | NUMBERED | CHECKBOX);
            let depth = usize::try_from(run.indent).unwrap_or(0);
            if listed {
                levels.truncate(depth + 1);
                levels.resize(depth + 1, (PLAIN, 0));
            } else {
                levels.clear();
            }

            counted = match levels.get_mut(depth) {
                Some(level) if listed => {
                    let next = if level.0 == NUMBERED && run.style == NUMBERED {
                        level.1 + 1
                    } else {
                        1
                    };
                    *level = (run.style, next);
                    next
                }
                _ => 1,
            };
        }

        let words = inline(&line, parts, fenced);

        if fenced {
            out.push_str(&words);
        } else {
            out.push_str(&prefix(run, line.soft, counted));
            let said = words.trim_start_matches(|one: char| one.is_whitespace() && one != '\n');
            let first = line.pieces.iter().find(|(run, said)| {
                run.attachment.is_some() || !said.replace(OBJECT, "").trim().is_empty()
            });
            let worded = first.is_some_and(|(run, _)| run.attachment.is_none());
            out.push_str(&if worded {
                opened(said)
            } else {
                said.to_string()
            });
        }

        out.push('\n');
    }

    if fenced {
        out.push_str(&fence);
        out.push('\n');
    }

    tidy(&out)
}

fn fence_for(text: &[u16]) -> String {
    let backtick = u16::from(b'`');
    let mut longest = 0_usize;
    let mut here = 0_usize;

    for one in text {
        here = if *one == backtick { here + 1 } else { 0 };
        longest = longest.max(here);
    }

    "`".repeat(longest.max(2) + 1)
}

const DEFAULT: Run = Run {
    length: 0,
    style: PLAIN,
    indent: 0,
    done: None,
    quote: false,
    weight: 0,
    underlined: false,
    struck: 0,
    baseline: 0,
    emphasis: 0,
    link: None,
    attachment: None,
};

struct Line<'a> {
    pieces: Vec<(&'a Run, String)>,
    soft: bool,
}

impl<'a> Line<'a> {
    fn run(&self) -> Option<&'a Run> {
        self.pieces.first().map(|(run, _)| *run)
    }
}

fn lines_of(body: &Body) -> Vec<Line<'_>> {
    let mut lines = vec![Line {
        pieces: Vec::new(),
        soft: false,
    }];
    let mut at = 0_usize;

    for run in &body.runs {
        let end = at.saturating_add(run.length).min(body.text.len());
        let said = String::from_utf16_lossy(&body.text[at..end]);
        at = end;

        let mut first = true;
        let mut soft = false;

        for part in said.split_inclusive(['\n', SOFT]) {
            if !first {
                lines.push(Line {
                    pieces: Vec::new(),
                    soft,
                });
            }
            first = false;

            soft = part.ends_with(SOFT);
            let words = part.trim_end_matches(['\n', SOFT]);

            if let Some(line) = lines.last_mut() {
                if !words.is_empty() {
                    line.pieces.push((run, words.to_string()));
                }
            }
        }

        if said.ends_with('\n') || said.ends_with(SOFT) {
            lines.push(Line {
                pieces: Vec::new(),
                soft: said.ends_with(SOFT),
            });
        }
    }

    if lines.last().is_some_and(|line| line.pieces.is_empty()) {
        lines.pop();
    }

    lines
}

fn prefix(run: &Run, soft: bool, counted: u32) -> String {
    let step = usize::try_from(run.indent).unwrap_or(0);
    let pad = STEP.repeat(step);
    let quote = if run.quote { "> " } else { "" };

    if soft {
        let listed = matches!(run.style, DOTTED | DASHED | NUMBERED | CHECKBOX);
        return format!("{quote}{pad}{}", if listed { STEP } else { "" });
    }

    match run.style {
        TITLE => format!("{quote}# "),
        HEADING => format!("{quote}## "),
        SUBHEADING => format!("{quote}### "),
        DOTTED | DASHED => format!("{quote}{pad}- "),
        NUMBERED => format!("{quote}{pad}{counted}. "),
        CHECKBOX => {
            let box_ = if run.done == Some(true) { 'x' } else { ' ' };
            format!("{quote}{pad}- [{box_}] ")
        }
        _ => format!("{quote}{pad}"),
    }
}

fn inline(line: &Line, parts: &mut dyn Parts, code: bool) -> String {
    let mut out = String::new();
    let mut pending: Option<(&Run, String)> = None;

    for (run, said) in &line.pieces {
        if let Some((id, uti)) = &run.attachment {
            if let Some((held, words)) = pending.take() {
                out.push_str(&written(held, &words, code));
            }
            if let Some(words) = parts.attachment(id, uti) {
                out.push_str(&words);
            }
            continue;
        }

        match &mut pending {
            Some((held, words)) if same_marks(held, run) => words.push_str(said),
            _ => {
                if let Some((held, words)) = pending.take() {
                    out.push_str(&written(held, &words, code));
                }
                pending = Some((run, said.clone()));
            }
        }
    }

    if let Some((held, words)) = pending {
        out.push_str(&written(held, &words, code));
    }

    out
}

fn written(run: &Run, said: &str, code: bool) -> String {
    if code {
        return said.replace(OBJECT, "");
    }

    wrapped(run, said)
}

fn same_marks(one: &Run, other: &Run) -> bool {
    one.weight == other.weight
        && one.underlined == other.underlined
        && (one.struck != 0) == (other.struck != 0)
        && one.baseline == other.baseline
        && one.link == other.link
        && (one.emphasis != 0) == (other.emphasis != 0)
}

fn wrapped(run: &Run, said: &str) -> String {
    let said = said.replace(OBJECT, "");
    if said.trim().is_empty() {
        return said;
    }

    let front = said.len() - said.trim_start().len();
    let back = said.len() - said.trim_end().len();
    let (before, rest) = said.split_at(front);
    let (words, after) = rest.split_at(rest.len() - back);

    let mut marked = escaped(words);

    marked = match run.weight {
        BOLD => format!("**{marked}**"),
        ITALIC => format!("*{marked}*"),
        BOLD_ITALIC => format!("***{marked}***"),
        _ => marked,
    };

    if run.struck != 0 {
        marked = format!("~~{marked}~~");
    }

    if run.underlined {
        marked = format!("<u>{marked}</u>");
    }

    marked = match run.baseline {
        SUPER => format!("^{marked}^"),
        SUB => format!("~{marked}~"),
        _ => marked,
    };

    if let Some(link) = &run.link {
        if link != &marked {
            marked = format!("[{marked}]({})", destination(link));
        }
    }

    if run.emphasis != 0 {
        marked = format!("=={marked}==");
    }

    format!("{before}{marked}{after}")
}

fn escaped(words: &str) -> String {
    let chars: Vec<char> = words.chars().collect();
    let mut out = String::with_capacity(words.len());
    let mut mid = false;

    for (at, &one) in chars.iter().enumerate() {
        let before = at.checked_sub(1).and_then(|back| chars.get(back)).copied();
        let after = chars.get(at + 1).copied();
        let word = |side: Option<char>| side.is_some_and(char::is_alphanumeric);
        let blank = |side: Option<char>| side.is_some_and(char::is_whitespace);

        let escape = match one {
            '\\' => after.is_none_or(|next| next.is_ascii_punctuation()),
            '_' => !(word(before) && word(after)),
            '*' => !(mid && blank(before) && blank(after)),
            '=' => before == Some(one) || after == Some(one),
            '%' => before == Some(one),
            '$' => !(blank(before) && blank(after)),
            '~' | '^' => !blank(after),
            '<' => opens_tag(after),
            '&' => {
                let named = chars[at + 1..]
                    .iter()
                    .take_while(|next| next.is_ascii_alphanumeric() || **next == '#')
                    .count();
                named > 0 && chars.get(at + 1 + named) == Some(&';')
            }
            '[' | ']' | '`' => true,
            _ => false,
        };

        if escape {
            out.push('\\');
        }
        out.push(one);
        mid |= !one.is_whitespace();
    }

    out
}

fn opened(words: &str) -> String {
    let blank_or_end = |rest: &str| rest.chars().next().is_none_or(char::is_whitespace);

    let hashes = words.len() - words.trim_start_matches('#').len();
    if (1..=6).contains(&hashes) && blank_or_end(&words[hashes..]) {
        return format!("\\{words}");
    }

    let digits = words.len()
        - words
            .trim_start_matches(|one: char| one.is_ascii_digit())
            .len();
    if digits > 0 {
        let rest = &words[digits..];
        if let Some(after) = rest.strip_prefix(['.', ')']) {
            if blank_or_end(after) {
                return format!("{}\\{rest}", &words[..digits]);
            }
        }
        return words.to_string();
    }

    let block = words.starts_with('>')
        || (words.starts_with('-') && (blank_or_end(&words[1..]) || words[1..].starts_with('-')))
        || (words.starts_with('+') && blank_or_end(&words[1..]));
    if block {
        return format!("\\{words}");
    }

    words.to_string()
}

pub fn opens_tag(next: Option<char>) -> bool {
    next.is_some_and(|next| next.is_ascii_alphabetic() || matches!(next, '/' | '!' | '?'))
}

pub fn as_words(words: &str) -> String {
    let mut out = String::with_capacity(words.len());
    let mut slashes = 0_usize;
    let mut chars = words.chars().peekable();

    while let Some(one) = chars.next() {
        if one == '\\' {
            slashes += 1;
            continue;
        }

        let opens = one == '<' && opens_tag(chars.peek().copied());
        let kept = if opens { slashes * 2 + 1 } else { slashes };
        out.extend(std::iter::repeat_n('\\', kept));
        slashes = 0;
        out.push(one);
    }

    out.extend(std::iter::repeat_n('\\', slashes));
    out
}

pub fn destination(link: &str) -> String {
    if link.contains(|one: char| one.is_whitespace() || matches!(one, '(' | ')' | '<' | '>')) {
        let inside = link.replace('<', "%3C").replace('>', "%3E");
        return format!("<{inside}>");
    }

    link.to_string()
}

fn tidy(markdown: &str) -> String {
    let mut out = String::new();
    let mut blank = 0_u32;
    let mut fence: Option<usize> = None;

    for line in markdown.lines() {
        let ticks = line.len() - line.trim_start_matches('`').len();
        if let Some(opened) = fence {
            out.push_str(line);
            out.push('\n');
            if ticks >= opened && line.trim_end().len() == ticks {
                fence = None;
            }
            blank = 0;
            continue;
        }
        if ticks >= 3 {
            fence = Some(ticks);
        }
        let said = line.trim_end();
        if said.is_empty() {
            blank += 1;
            if blank > 1 {
                continue;
            }
        } else {
            blank = 0;
        }

        out.push_str(said);
        out.push('\n');
    }

    out.trim().to_string()
}

pub fn table(data: &[u8], parts: &mut dyn Parts) -> Option<String> {
    let bytes = inflate(data)?;
    let store = Store::of(&bytes)?;
    let root = store.objects.iter().find_map(|one| {
        one.map
            .as_ref()
            .filter(|map| store.type_is(map.kind, TABLE_TYPE))
    })?;

    let (mut rows, mut columns, mut cells) = (None, None, None);
    for (key, value) in &root.entries {
        let object = value.object.and_then(|at| store.objects.get(at));
        match store.key(*key) {
            Some(ROWS) => rows = object.and_then(|one| store.places(one)),
            Some(COLUMNS) => columns = object.and_then(|one| store.places(one)),
            Some(CELLS) => cells = object,
            _ => {}
        }
    }

    let ((rows, height), (columns, width)) = (rows?, columns?);
    if height == 0 || width == 0 {
        return None;
    }

    let mut grid = vec![vec![String::new(); width]; height];
    for (column, held) in &cells?.dictionary {
        let Some(across) = store
            .target(column)
            .and_then(|id| columns.get(&id).copied())
        else {
            continue;
        };
        let Some(column) = held.object.and_then(|at| store.objects.get(at)) else {
            continue;
        };

        for (row, cell) in &column.dictionary {
            let Some(down) = store.target(row).and_then(|id| rows.get(&id).copied()) else {
                continue;
            };
            let body = cell
                .object
                .and_then(|at| store.objects.get(at))
                .and_then(|one| one.note.as_ref());
            if let (Some(body), Some(slot)) = (
                body,
                grid.get_mut(down).and_then(|line| line.get_mut(across)),
            ) {
                *slot = cell_words(body, parts);
            }
        }
    }

    Some(grid_markdown(&grid))
}

pub fn gallery(data: &[u8]) -> Vec<String> {
    let Some(store) = inflate(data).and_then(|bytes| Store::of(&bytes)) else {
        return Vec::new();
    };

    store
        .objects
        .into_iter()
        .filter_map(|one| one.map?.entries.into_iter().next()?.1.text)
        .filter(|id| !id.is_empty())
        .collect()
}

const TABLE_TYPE: &str = "com.apple.notes.ICTable";
const ROWS: &str = "crRows";
const COLUMNS: &str = "crColumns";
const CELLS: &str = "cellColumns";

const MOST_CELLS: usize = 1024;

fn cell_words(body: &Body, parts: &mut dyn Parts) -> String {
    markdown(body, parts)
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>()
        .join("<br>")
        .replace('|', "\\|")
}

fn grid_markdown(grid: &[Vec<String>]) -> String {
    let mut out = Vec::with_capacity(grid.len() + 1);

    for (at, cells) in grid.iter().enumerate() {
        out.push(format!("| {} |", cells.join(" | ")));
        if at == 0 {
            out.push(format!("|{}", " --- |".repeat(cells.len())));
        }
    }

    out.join("\n")
}

#[derive(Default)]
struct Id {
    number: Option<u64>,
    text: Option<String>,
    object: Option<usize>,
}

struct Map {
    kind: usize,
    entries: Vec<(usize, Id)>,
}

#[derive(Default)]
struct Object {
    map: Option<Map>,
    dictionary: Vec<(Id, Id)>,
    order: Vec<Vec<u8>>,
    placed: Vec<(Id, Id)>,
    note: Option<Body>,
}

#[derive(Default)]
struct Store {
    objects: Vec<Object>,
    keys: Vec<String>,
    types: Vec<String>,
    uuids: Vec<Vec<u8>>,
}

impl Store {
    fn of(bytes: &[u8]) -> Option<Self> {
        let data = held(held(bytes, 2)?, 3)?;
        let mut store = Self::default();

        for (number, value) in Fields::new(data) {
            if let Value::Bytes(said) = value {
                match number {
                    3 => store.objects.push(object_of(said)),
                    4 => store.keys.push(text_of(said)),
                    5 => store.types.push(text_of(said)),
                    6 => store.uuids.push(said.to_vec()),
                    _ => {}
                }
            }
        }

        Some(store)
    }

    fn key(&self, at: usize) -> Option<&str> {
        self.keys.get(at).map(String::as_str)
    }

    fn type_is(&self, at: usize, name: &str) -> bool {
        self.types.get(at).is_some_and(|one| one == name)
    }

    fn target(&self, reference: &Id) -> Option<Vec<u8>> {
        let object = self.objects.get(reference.object?)?;
        let first = &object.map.as_ref()?.entries.first()?.1;
        let at = usize::try_from(first.number?).ok()?;
        self.uuids.get(at).cloned()
    }

    fn places(&self, object: &Object) -> Option<(HashMap<Vec<u8>, usize>, usize)> {
        let count = object.order.len();
        if count > MOST_CELLS {
            return None;
        }

        let mut places = HashMap::new();
        for (key, value) in &object.placed {
            let (Some(key), Some(value)) = (self.target(key), self.target(value)) else {
                continue;
            };
            if let Some(at) = object.order.iter().position(|one| *one == key) {
                places.insert(value, at);
            }
        }

        Some((places, count))
    }
}

fn object_of(bytes: &[u8]) -> Object {
    let mut object = Object::default();

    for (number, value) in Fields::new(bytes) {
        let Value::Bytes(said) = value else { continue };
        match number {
            6 => object.dictionary = elements_of(said),
            10 => object.note = Some(note_of(said)),
            13 => object.map = Some(map_of(said)),
            16 => ordered_of(said, &mut object),
            _ => {}
        }
    }

    object
}

fn index(said: u64) -> usize {
    usize::try_from(said).unwrap_or(usize::MAX)
}

fn map_of(bytes: &[u8]) -> Map {
    let mut map = Map {
        kind: usize::MAX,
        entries: Vec::new(),
    };

    for (number, value) in Fields::new(bytes) {
        match (number, value) {
            (1, Value::Number(said)) => map.kind = index(said),
            (3, Value::Bytes(entry)) => {
                let mut key = usize::MAX;
                let mut id = Id::default();
                for (number, value) in Fields::new(entry) {
                    match (number, value) {
                        (1, Value::Number(at)) => key = index(at),
                        (2, Value::Bytes(inside)) => id = id_of(inside),
                        _ => {}
                    }
                }
                map.entries.push((key, id));
            }
            _ => {}
        }
    }

    map
}

fn id_of(bytes: &[u8]) -> Id {
    let mut id = Id::default();

    for (number, value) in Fields::new(bytes) {
        match (number, value) {
            (2, Value::Number(said)) => id.number = Some(said),
            (4, Value::Bytes(said)) => id.text = Some(text_of(said)),
            (6, Value::Number(said)) => id.object = usize::try_from(said).ok(),
            _ => {}
        }
    }

    id
}

fn elements_of(bytes: &[u8]) -> Vec<(Id, Id)> {
    let mut elements = Vec::new();

    for (number, value) in Fields::new(bytes) {
        let (1, Value::Bytes(element)) = (number, value) else {
            continue;
        };
        let (mut key, mut value) = (Id::default(), Id::default());
        for (number, inside) in Fields::new(element) {
            match (number, inside) {
                (1, Value::Bytes(said)) => key = id_of(said),
                (2, Value::Bytes(said)) => value = id_of(said),
                _ => {}
            }
        }
        elements.push((key, value));
    }

    elements
}

fn ordered_of(bytes: &[u8], object: &mut Object) {
    let Some(ordering) = held(bytes, 1) else {
        return;
    };

    if let Some(array) = held(ordering, 1) {
        for (number, value) in Fields::new(array) {
            if let (2, Value::Bytes(attachment)) = (number, value) {
                if let Some(uuid) = held(attachment, 2) {
                    object.order.push(uuid.to_vec());
                }
            }
        }
    }

    if let Some(contents) = held(ordering, 2) {
        object.placed = elements_of(contents);
    }
}

enum Value<'a> {
    Number(u64),
    Bytes(&'a [u8]),
}

struct Fields<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Fields<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, at: 0 }
    }

    fn varint(&mut self) -> Option<u64> {
        let mut value = 0_u64;
        let mut shift = 0_u32;

        while let Some(byte) = self.bytes.get(self.at) {
            self.at += 1;
            value |= u64::from(byte & 0x7f) << shift;

            if byte & 0x80 == 0 {
                return Some(value);
            }

            shift += 7;
            if shift > 63 {
                return None;
            }
        }

        None
    }

    fn take(&mut self, count: usize) -> Option<&'a [u8]> {
        let end = self.at.checked_add(count)?;
        let taken = self.bytes.get(self.at..end)?;
        self.at = end;
        Some(taken)
    }
}

impl<'a> Iterator for Fields<'a> {
    type Item = (u32, Value<'a>);

    fn next(&mut self) -> Option<Self::Item> {
        let tag = self.varint()?;
        let number = u32::try_from(tag >> 3).ok()?;

        match tag & 7 {
            0 => Some((number, Value::Number(self.varint()?))),
            1 => Some((number, Value::Number(number_of(self.take(8)?)))),
            2 => {
                let count = usize::try_from(self.varint()?).ok()?;
                Some((number, Value::Bytes(self.take(count)?)))
            }
            5 => Some((number, Value::Number(number_of(self.take(4)?)))),
            _ => None,
        }
    }
}

fn number_of(bytes: &[u8]) -> u64 {
    bytes
        .iter()
        .rev()
        .fold(0_u64, |value, byte| (value << 8) | u64::from(*byte))
}

fn signed(value: u64) -> i32 {
    let low = u32::try_from(value & 0xffff_ffff).unwrap_or(0);
    i32::from_ne_bytes(low.to_ne_bytes())
}

fn text_of(bytes: &[u8]) -> String {
    String::from_utf8_lossy(bytes).to_string()
}

fn note_of(bytes: &[u8]) -> Body {
    let mut text = Vec::new();
    let mut runs = Vec::new();

    for (number, value) in Fields::new(bytes) {
        match (number, value) {
            (2, Value::Bytes(said)) => text = text_of(said).encode_utf16().collect(),
            (5, Value::Bytes(run)) => runs.push(run_of(run)),
            _ => {}
        }
    }

    let covered = runs
        .iter()
        .fold(0_usize, |sum, run| sum.saturating_add(run.length));
    if covered < text.len() {
        runs.push(Run {
            length: text.len() - covered,
            ..Run::default()
        });
    }

    Body { text, runs }
}

fn run_of(bytes: &[u8]) -> Run {
    let mut run = Run::default();

    for (number, value) in Fields::new(bytes) {
        match (number, value) {
            (1, Value::Number(said)) => run.length = usize::try_from(said).unwrap_or(0),
            (2, Value::Bytes(said)) => paragraph_of(said, &mut run),
            (5, Value::Number(said)) => run.weight = signed(said),
            (6, Value::Number(said)) => run.underlined = said != 0,
            (7, Value::Number(said)) => run.struck = signed(said),
            (8, Value::Number(said)) => run.baseline = signed(said),
            (9, Value::Bytes(said)) => run.link = Some(text_of(said)),
            (12, Value::Bytes(said)) => run.attachment = attachment_of(said),
            (14, Value::Number(said)) => run.emphasis = signed(said),
            _ => {}
        }
    }

    run
}

fn paragraph_of(bytes: &[u8], run: &mut Run) {
    for (number, value) in Fields::new(bytes) {
        match (number, value) {
            (1, Value::Number(said)) => run.style = signed(said),
            (4, Value::Number(said)) => {
                run.indent = u32::try_from(said).unwrap_or(0).min(DEEPEST);
            }
            (5, Value::Bytes(said)) => run.done = Some(ticked(said)),
            (8, Value::Number(said)) => run.quote = said != 0,
            _ => {}
        }
    }
}

fn ticked(bytes: &[u8]) -> bool {
    for (number, value) in Fields::new(bytes) {
        if number == 2 {
            if let Value::Number(done) = value {
                return done != 0;
            }
        }
    }

    false
}

fn attachment_of(bytes: &[u8]) -> Option<(String, String)> {
    let mut id = String::new();
    let mut uti = String::new();

    for (number, value) in Fields::new(bytes) {
        match (number, value) {
            (1, Value::Bytes(said)) => id = text_of(said),
            (2, Value::Bytes(said)) => uti = text_of(said),
            _ => {}
        }
    }

    if id.is_empty() {
        return None;
    }

    Some((id, uti))
}

fn inflate(data: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();

    let read = match data.first().copied() {
        Some(0x1f) => GzDecoder::new(data)
            .take(MOST_BYTES)
            .read_to_end(&mut out)
            .ok()?,
        Some(0x78) => ZlibDecoder::new(data)
            .take(MOST_BYTES)
            .read_to_end(&mut out)
            .ok()?,
        _ => return None,
    };

    if u64::try_from(read).ok()? >= MOST_BYTES {
        return None;
    }

    Some(out)
}

#[cfg(test)]
mod tests {
    use super::{decode, markdown, tidy, title, Parts};

    struct Named;

    impl Parts for Named {
        fn attachment(&mut self, id: &str, uti: &str) -> Option<String> {
            if uti == "com.apple.notes.table" {
                return None;
            }

            Some(format!("![](assets/{id}.png)"))
        }
    }

    fn varint(mut value: u64) -> Vec<u8> {
        let mut out = Vec::new();

        loop {
            let byte = u8::try_from(value & 0x7f).unwrap_or(0);
            value >>= 7;

            if value == 0 {
                out.push(byte);
                return out;
            }

            out.push(byte | 0x80);
        }
    }

    fn number(field: u32, value: u64) -> Vec<u8> {
        let mut out = varint(u64::from(field) << 3);
        out.extend(varint(value));
        out
    }

    fn bytes(field: u32, value: &[u8]) -> Vec<u8> {
        let mut out = varint((u64::from(field) << 3) | 2);
        out.extend(varint(u64::try_from(value.len()).unwrap_or(0)));
        out.extend_from_slice(value);
        out
    }

    fn style(kind: u64, indent: u64, done: Option<bool>) -> Vec<u8> {
        let mut out = Vec::new();
        out.extend(number(1, kind));

        if indent > 0 {
            out.extend(number(4, indent));
        }

        if let Some(ticked) = done {
            out.extend(bytes(5, &number(2, u64::from(ticked))));
        }

        out
    }

    fn run(length: u64, parts: &[Vec<u8>]) -> Vec<u8> {
        let mut body = number(1, length);
        for part in parts {
            body.extend_from_slice(part);
        }

        bytes(5, &body)
    }

    fn note(text: &str, runs: &[Vec<u8>]) -> Vec<u8> {
        let mut inner = bytes(2, text.as_bytes());
        for one in runs {
            inner.extend_from_slice(one);
        }

        zipped(&bytes(2, &bytes(3, &inner)))
    }

    fn zipped(said: &[u8]) -> Vec<u8> {
        let mut gzipped = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::fast());
        std::io::Write::write_all(&mut gzipped, said).expect("gzip");
        gzipped.finish().expect("gzip")
    }

    fn as_markdown(text: &str, runs: &[Vec<u8>]) -> String {
        let body = decode(&note(text, runs)).expect("a note");
        markdown(&body, &mut Named)
    }

    const PLAIN_LINES: &str =
        include_str!("../../../../packages/markdown/src/fixtures/plain-lines.json");

    #[test]
    fn plain_words_come_over_as_the_words_and_nothing_else() {
        let lines: Vec<serde_json::Value> = serde_json::from_str(PLAIN_LINES).expect("the lines");
        assert!(!lines.is_empty());

        for line in lines {
            let words = line["words"].as_str().expect("words");
            let written = line["markdown"].as_str().expect("markdown");
            let text = format!("Note\n{words}\n");
            let rest = u64::try_from(words.encode_utf16().count() + 1).expect("a length");
            let said = as_markdown(
                &text,
                &[run(5, &[bytes(2, &style(0, 0, None))]), run(rest, &[])],
            );

            assert_eq!(said, format!("# Note\n{written}"), "{words}");
        }
    }

    #[test]
    fn a_title_and_a_paragraph() {
        let text = "Groceries\nMilk and eggs\n";
        let said = as_markdown(
            text,
            &[run(10, &[bytes(2, &style(0, 0, None))]), run(14, &[])],
        );

        assert_eq!(said, "# Groceries\nMilk and eggs");
    }

    #[test]
    fn the_title_is_the_first_line_rather_than_the_row() {
        let body = decode(&note("Groceries\nMilk\n", &[run(15, &[])])).expect("a note");
        assert_eq!(title(&body).as_deref(), Some("Groceries"));
    }

    #[test]
    fn boxes_come_over_in_the_state_they_were_left_in() {
        let text = "Packing\nPassport\nCharger\n";
        let said = as_markdown(
            text,
            &[
                run(8, &[bytes(2, &style(0, 0, None))]),
                run(9, &[bytes(2, &style(103, 0, Some(true)))]),
                run(8, &[bytes(2, &style(103, 0, Some(false)))]),
            ],
        );

        assert_eq!(said, "# Packing\n- [x] Passport\n- [ ] Charger");
    }

    #[test]
    fn a_numbered_list_counts_itself_and_a_nested_one_is_indented() {
        let text = "One\nTwo\nUnder\n";
        let said = as_markdown(
            text,
            &[
                run(4, &[bytes(2, &style(102, 0, None))]),
                run(4, &[bytes(2, &style(102, 0, None))]),
                run(6, &[bytes(2, &style(101, 1, None))]),
            ],
        );

        assert_eq!(said, "1. One\n2. Two\n  - Under");
    }

    #[test]
    fn marks_go_around_the_words_and_not_around_the_spaces() {
        let said = as_markdown("Bold words", &[run(5, &[number(5, 1)]), run(5, &[])]);

        assert_eq!(said, "**Bold** words");
    }

    #[test]
    fn a_highlight_is_ordens_own_mark_with_no_circle_in_front_of_it() {
        let said = as_markdown("Marked", &[run(6, &[number(14, 3)])]);

        assert_eq!(said, "==Marked==");
    }

    #[test]
    fn a_link_keeps_the_words_it_was_written_on() {
        let said = as_markdown("Orden", &[run(5, &[bytes(9, b"https://orden.so")])]);

        assert_eq!(said, "[Orden](https://orden.so)");
    }

    #[test]
    fn monospaced_paragraphs_become_one_block_of_code() {
        let text = "let a = 1\nlet b = 2\nafter\n";
        let said = as_markdown(
            text,
            &[
                run(10, &[bytes(2, &style(4, 0, None))]),
                run(10, &[bytes(2, &style(4, 0, None))]),
                run(6, &[]),
            ],
        );

        assert_eq!(said, "```\nlet a = 1\nlet b = 2\n```\nafter");
    }

    #[test]
    fn an_attachment_becomes_what_the_database_says_it_is() {
        let said = as_markdown(
            "Look \u{fffc}",
            &[
                run(5, &[]),
                run(1, &[bytes(12, &attachment("abc", "public.jpeg"))]),
            ],
        );

        assert_eq!(said, "Look ![](assets/abc.png)");
    }

    #[test]
    fn an_attachment_with_nothing_behind_it_leaves_no_words() {
        let said = as_markdown(
            "\u{fffc}",
            &[run(
                1,
                &[bytes(12, &attachment("t1", "com.apple.notes.table"))],
            )],
        );

        assert_eq!(said, "");
    }

    #[test]
    fn a_return_held_with_shift_stays_in_the_same_item() {
        let text = "First\u{2028}second\n";
        let said = as_markdown(text, &[run(13, &[bytes(2, &style(101, 0, None))])]);

        assert_eq!(said, "- First\n  second");
    }

    #[test]
    fn an_emoji_is_two_units_long_the_way_notes_counts() {
        let said = as_markdown("Hi 🙂 there", &[run(5, &[number(5, 1)]), run(6, &[])]);

        assert_eq!(said, "**Hi 🙂** there");
    }

    #[test]
    fn bytes_that_are_not_a_note_are_not_read_as_one() {
        assert!(decode(b"not gzip at all").is_none());
    }

    #[test]
    fn a_note_is_found_through_the_wrapper_it_arrives_in() {
        let inner = bytes(2, "Words".as_bytes());

        let wrapped = decode(&zipped(&bytes(2, &bytes(3, &inner)))).expect("the row Notes writes");
        assert_eq!(title(&wrapped).as_deref(), Some("Words"));

        let bare = decode(&zipped(&bytes(3, &inner))).expect("a document on its own");
        assert_eq!(title(&bare).as_deref(), Some("Words"));

        assert!(decode(&zipped(&bytes(9, &inner))).is_none());
    }

    #[test]
    fn a_code_block_keeps_its_blank_lines_and_its_spaces() {
        assert_eq!(
            tidy("a\n\n\n\n```\nx  \n\n\n\ny\n```\n\n\nb  \n"),
            "a\n\n```\nx  \n\n\n\ny\n```\n\nb"
        );
    }

    #[test]
    fn a_blank_line_does_not_cut_a_block_of_code_in_two() {
        let said = as_markdown(
            "one\n\ntwo\n",
            &[
                run(4, &[bytes(2, &style(4, 0, None))]),
                run(1, &[]),
                run(4, &[bytes(2, &style(4, 0, None))]),
            ],
        );

        assert_eq!(said, "```\none\n\ntwo\n```");
    }

    #[test]
    fn a_return_held_with_shift_does_not_take_the_next_number() {
        let said = as_markdown(
            "One\u{2028}still one\nTwo\n",
            &[
                run(13, &[bytes(2, &style(102, 0, None))]),
                run(4, &[bytes(2, &style(102, 0, None))]),
            ],
        );

        assert_eq!(said, "1. One\n  still one\n2. Two");
    }

    #[test]
    fn a_depth_nobody_wrote_is_held_to_one_a_note_can_have() {
        let said = as_markdown(
            "deep\n",
            &[run(5, &[bytes(2, &style(101, u64::from(u32::MAX), None))])],
        );

        assert!(said.len() < 200, "{} characters of indent", said.len());
        assert!(said.trim_start().starts_with("- "), "{said}");
    }

    #[test]
    fn code_with_a_fence_in_it_is_fenced_with_a_longer_one() {
        let said = as_markdown(
            "```js\nx\n```\n",
            &[run(12, &[bytes(2, &style(4, 0, None))])],
        );

        assert_eq!(said, "````\n```js\nx\n```\n````");
    }

    #[test]
    fn a_nested_list_does_not_restart_the_count_around_it() {
        let said = as_markdown(
            "One\na\nb\nTwo\n",
            &[
                run(4, &[bytes(2, &style(102, 0, None))]),
                run(2, &[bytes(2, &style(102, 1, None))]),
                run(2, &[bytes(2, &style(102, 1, None))]),
                run(4, &[bytes(2, &style(102, 0, None))]),
            ],
        );

        assert_eq!(said, "1. One\n  1. a\n  2. b\n2. Two");
    }

    #[test]
    fn a_block_of_code_keeps_its_words_as_they_were_typed() {
        let said = as_markdown(
            "let a = b[0]\n",
            &[
                run(8, &[bytes(2, &style(4, 0, None))]),
                run(5, &[bytes(2, &style(4, 0, None)), number(5, 1)]),
            ],
        );

        assert_eq!(said, "```\nlet a = b[0]\n```");
    }

    #[test]
    fn runs_that_say_the_same_thing_are_marked_once() {
        let said = as_markdown(
            "Graphic designer",
            &[
                run(2, &[number(5, 1)]),
                run(5, &[number(5, 1), bytes(10, b"colour")]),
                run(9, &[number(5, 1)]),
            ],
        );

        assert_eq!(said, "**Graphic designer**");
    }

    #[test]
    fn words_past_the_last_run_are_kept() {
        let said = as_markdown(
            "Title\nand the rest\n",
            &[run(6, &[bytes(2, &style(0, 0, None))])],
        );
        assert_eq!(said, "# Title\nand the rest");

        let bare = as_markdown("No runs at all", &[]);
        assert_eq!(bare, "No runs at all");
    }

    #[test]
    fn words_that_look_like_html_are_words() {
        let said = as_markdown("<script src=x> and 1 < 2", &[run(24, &[])]);
        assert_eq!(said, "\\<script src=x> and 1 < 2");
    }

    #[test]
    fn dollars_tildes_carets_and_percent_signs_are_words() {
        let words = "Tickets $5-$10, ~5 or ~10, %%d, x^2, a $ b ~ c";
        let said = as_markdown(words, &[run(words.len() as u64, &[])]);
        assert_eq!(
            said,
            "Tickets \\$5-\\$10, \\~5 or \\~10, %\\%d, x\\^2, a $ b ~ c"
        );
    }

    #[test]
    fn a_backslash_in_front_of_html_does_not_let_it_through() {
        let said = as_markdown("\\<img src=x onerror=alert(1)>", &[run(29, &[])]);
        assert_eq!(said, "\\\\\\<img src=x onerror=alert(1)>");
    }

    #[test]
    fn where_a_link_goes_cannot_end_the_link() {
        assert_eq!(
            super::destination("https://x.test/a) <img src=x onerror=alert(1)>"),
            "<https://x.test/a) %3Cimg src=x onerror=alert(1)%3E>"
        );
        assert_eq!(super::destination("https://x.test/a"), "https://x.test/a");
    }

    #[test]
    fn a_link_with_a_space_in_it_is_still_a_link() {
        let said = as_markdown(
            "Here",
            &[run(4, &[bytes(9, b"file:///Users/me/My Notes (1).pdf")])],
        );
        assert_eq!(said, "[Here](<file:///Users/me/My Notes (1).pdf>)");
    }

    fn object(at: u64) -> Vec<u8> {
        number(6, at)
    }

    fn element(key: u64, value: u64) -> Vec<u8> {
        let mut inner = bytes(1, &object(key));
        inner.extend(bytes(2, &object(value)));
        bytes(1, &inner)
    }

    fn map(kind: u64, entries: &[(u64, Vec<u8>)]) -> Vec<u8> {
        let mut inner = number(1, kind);
        for (key, id) in entries {
            let mut entry = number(1, *key);
            entry.extend(bytes(2, id));
            inner.extend(bytes(3, &entry));
        }
        bytes(13, &inner)
    }

    fn ordered(order: &[&[u8]], elements: &[(u64, u64)]) -> Vec<u8> {
        let mut array = Vec::new();
        for (at, uuid) in order.iter().enumerate() {
            let mut attachment = number(1, u64::try_from(at).unwrap_or(0));
            attachment.extend(bytes(2, uuid));
            array.extend(bytes(2, &attachment));
        }
        let mut contents = Vec::new();
        for (key, value) in elements {
            contents.extend(element(*key, *value));
        }
        let mut ordering = bytes(1, &array);
        ordering.extend(bytes(2, &contents));
        bytes(16, &bytes(1, &ordering))
    }

    fn dictionary(elements: &[(u64, u64)]) -> Vec<u8> {
        let mut inner = Vec::new();
        for (key, value) in elements {
            inner.extend(element(*key, *value));
        }
        bytes(6, &inner)
    }

    fn cell(text: &str, marks: &[Vec<u8>]) -> Vec<u8> {
        let length = u64::try_from(text.encode_utf16().count()).unwrap_or(0);
        let mut inner = bytes(2, text.as_bytes());
        inner.extend(run(length, marks));
        bytes(10, &inner)
    }

    fn merged(objects: &[Vec<u8>], keys: &[&str], types: &[&str], uuids: &[&[u8]]) -> Vec<u8> {
        let mut data = Vec::new();
        for one in objects {
            data.extend(bytes(3, one));
        }
        for one in keys {
            data.extend(bytes(4, one.as_bytes()));
        }
        for one in types {
            data.extend(bytes(5, one.as_bytes()));
        }
        for one in uuids {
            data.extend(bytes(6, one));
        }
        zipped(&bytes(2, &bytes(3, &data)))
    }

    fn shopping() -> Vec<u8> {
        let (r0, r1, c0, c1): (&[u8], &[u8], &[u8], &[u8]) =
            (b"row-0", b"row-1", b"col-0", b"col-1");
        let uuid = |at: u64| map(1, &[(3, number(2, at))]);

        let objects = vec![
            map(0, &[(0, object(1)), (1, object(2)), (2, object(3))]),
            ordered(&[r0, r1], &[(4, 4), (5, 5)]),
            ordered(&[c1, c0], &[(6, 6), (7, 7)]),
            dictionary(&[(6, 8), (7, 9)]),
            uuid(0),
            uuid(1),
            uuid(2),
            uuid(3),
            dictionary(&[(4, 10), (5, 11)]),
            dictionary(&[(4, 12), (5, 13)]),
            cell("Item", &[]),
            cell("Milk", &[number(5, 1)]),
            cell("How much", &[]),
            cell("2 | two\nlitres", &[]),
        ];

        merged(
            &objects,
            &["crRows", "crColumns", "cellColumns", "UUIDIndex"],
            &["com.apple.notes.ICTable", "com.apple.CRDT.NSUUID"],
            &[r0, r1, c0, c1],
        )
    }

    #[test]
    fn a_table_is_a_markdown_table_with_its_columns_where_they_are_drawn() {
        let said = super::table(&shopping(), &mut Named).expect("a table");

        assert_eq!(
            said,
            "| How much | Item |\n| --- | --- |\n| 2 \\| two<br>litres | **Milk** |"
        );
    }

    #[test]
    fn a_table_in_a_note_stands_apart_from_the_lines_around_it() {
        struct Tabled;
        impl Parts for Tabled {
            fn attachment(&mut self, _id: &str, _uti: &str) -> Option<String> {
                Some("\n\n| a |\n| --- |\n| b |\n\n".to_string())
            }
        }

        let body = decode(&note(
            "Before\n\u{fffc}\nAfter",
            &[
                run(7, &[]),
                run(1, &[bytes(12, &attachment("t1", "com.apple.notes.table"))]),
                run(6, &[]),
            ],
        ))
        .expect("a note");

        assert_eq!(
            markdown(&body, &mut Tabled),
            "Before\n\n| a |\n| --- |\n| b |\n\nAfter"
        );
    }

    #[test]
    fn bytes_that_are_not_a_table_are_no_table() {
        assert!(super::table(b"not gzip", &mut Named).is_none());

        let scan = merged(
            &[map(0, &[(0, Vec::new())])],
            &["self"],
            &["com.apple.notes.gallery"],
            &[],
        );
        assert!(super::table(&scan, &mut Named).is_none());
    }

    #[test]
    fn a_scan_names_its_pages_in_order() {
        let page = |id: &str| {
            let mut said = Vec::new();
            said.extend(bytes(4, id.as_bytes()));
            map(0, &[(0, said)])
        };
        let scan = merged(
            &[page("PAGE-1"), page("PAGE-2")],
            &["self"],
            &["gallery"],
            &[],
        );

        assert_eq!(super::gallery(&scan), vec!["PAGE-1", "PAGE-2"]);
        assert!(super::gallery(b"nothing").is_empty());
    }

    fn attachment(id: &str, uti: &str) -> Vec<u8> {
        let mut out = bytes(1, id.as_bytes());
        out.extend(bytes(2, uti.as_bytes()));
        out
    }
}
