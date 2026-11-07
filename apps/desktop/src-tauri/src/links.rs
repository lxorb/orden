use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::fs::Metadata;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::AppHandle;

use crate::code_blocks::{CodeBlocks, CodeLine};
use crate::front_matter;
use crate::notes::{words_of, words_stamped};
use crate::paths::{files_in, in_spaces, is_canvas, is_shortcut, relative_to};
use crate::tags::tags_in;
use crate::tasks::task_at;

const LINE: usize = 200;

const LONGEST_LINK: usize = 1000;

const MOST_LINKS: usize = 5000;

const MOST_TASKS: usize = 5000;

const LONGEST_TASK: usize = 2000;

const LONGEST_DESCRIPTION: usize = 300;

#[derive(Serialize)]
pub struct Task {
    line: usize,
    indent: usize,
    mark: char,
    text: String,
    section: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    description: Option<String>,
    #[serde(skip_serializing_if = "is_zero")]
    comments: usize,
}

#[allow(clippy::trivially_copy_pass_by_ref)]
fn is_zero(count: &usize) -> bool {
    *count == 0
}

struct Open {
    indent: usize,
    task: Option<usize>,
    told: bool,
}

fn is_list_item(line: &str) -> bool {
    let rest = line.trim_start_matches([' ', '\t']);
    let after = if let Some(after) = rest.strip_prefix(['-', '*', '+']) {
        after
    } else {
        let digits = rest.bytes().take_while(u8::is_ascii_digit).count();
        if digits == 0 || digits > 9 {
            return false;
        }
        match rest[digits..].strip_prefix(['.', ')']) {
            Some(after) => after,
            None => return false,
        }
    };
    after.is_empty() || after.starts_with([' ', '\t'])
}

fn under(open: &mut Vec<Open>, tasks: &mut [Task], line: &str, task: Option<usize>, is_task: bool) {
    let words = line.trim();
    if words.is_empty() {
        return;
    }
    let indent = line.chars().count() - line.trim_start().chars().count();
    while open.last().is_some_and(|one| one.indent >= indent) {
        open.pop();
    }
    let owner = open.last_mut();

    if is_task || is_list_item(line) {
        if let Some(owner) = owner {
            if let Some(at) = owner.task {
                owner.told = true;
                if !is_task {
                    tasks[at].comments += 1;
                }
            }
        }
        open.push(Open {
            indent,
            task,
            told: false,
        });
    } else if let Some(Open {
        task: Some(at),
        told: false,
        ..
    }) = owner
    {
        let held = &mut tasks[*at];
        if held.description.is_none() {
            held.description = Some(clipped(words, LONGEST_DESCRIPTION).to_string());
        }
    }
}

#[derive(Serialize, Clone, Copy)]
pub struct Stamp {
    size: u64,
    mtime: u64,
    ctime: u64,
}

#[derive(Serialize)]
pub struct Link {
    kind: &'static str,
    target: String,
    heading: Option<String>,
    block: Option<String>,
    alias: Option<String>,
    embed: bool,
    line: usize,
    text: String,
}

#[derive(Serialize)]
pub struct Note {
    path: String,
    name: String,
    headings: Vec<String>,
    blocks: Vec<String>,
    links: Vec<Link>,
    tags: Vec<String>,
    icon: Option<String>,
    #[serde(rename = "iconColor")]
    icon_color: Option<String>,
    aliases: Vec<String>,
    url: Option<String>,
    favicon: Option<String>,
    address: Option<String>,
    cover: Option<String>,
    bare: bool,
    front: Option<String>,
    tasks: Vec<Task>,
    stamp: Option<Stamp>,
}

#[derive(Serialize)]
pub struct SpaceLinks {
    notes: Vec<Note>,
    files: Vec<String>,
}

#[tauri::command(async)]
pub fn scan_links(app: AppHandle, root: String) -> Result<SpaceLinks, String> {
    let dir = in_spaces(&app, &root)?;
    let (notes, others) = files_in(&dir);

    let mut out = Vec::with_capacity(notes.len());
    for path in notes {
        let Ok((body, meta)) = words_stamped(&path) else {
            continue;
        };

        let mut note = note_at(relative_to(&dir, &path), &body);
        note.stamp = Some(stamp_of(&meta));
        out.push(note);
    }

    for path in others.iter().filter(|path| is_canvas(path)) {
        let Ok(body) = words_of(path) else {
            continue;
        };

        out.push(canvas_note(relative_to(&dir, path), &body));
    }

    for path in others.iter().filter(|path| is_shortcut(path)) {
        let body = words_of(path).unwrap_or_default();
        out.push(shortcut_note(relative_to(&dir, path), &body));
    }

    out.sort_by(|one, other| one.path.cmp(&other.path));

    Ok(SpaceLinks {
        notes: out,
        files: others.iter().map(|path| relative_to(&dir, path)).collect(),
    })
}

fn note_at(relative: String, body: &str) -> Note {
    let file = relative.rsplit('/').next().unwrap_or(&relative);
    let stem = file.rsplit_once('.').map_or(file, |(stem, _)| stem);
    let name = stem.to_string();

    let block = front_matter::block(body);
    let words_from = block
        .as_ref()
        .map_or(0, |one| body[..one.end].matches('\n').count() + 1);
    let read = prose(body, words_from);
    let said = |key: &str| {
        block
            .as_ref()
            .and_then(|one| front_matter::value(body, one, key))
    };

    let under = block
        .as_ref()
        .map_or(body, |one| body.get(one.end..).unwrap_or(""));
    let bare = says_nothing(under, &name);

    Note {
        path: relative,
        name,
        headings: read.headings,
        blocks: read.blocks,
        links: read.links,
        tags: note_tags(body),
        icon: said("icon"),
        icon_color: said("icon-color"),
        aliases: block
            .as_ref()
            .map_or_else(Vec::new, |one| front_matter::list(body, one, "aliases")),
        url: said("url"),
        favicon: None,
        address: None,
        cover: said("cover"),
        bare,
        front: block.as_ref().and_then(|one| {
            let lines = body.get(one.from..one.close)?;
            let lines = lines.strip_suffix('\n').unwrap_or(lines);
            Some(lines.strip_suffix('\r').unwrap_or(lines).to_string())
        }),
        tasks: read.tasks,
        stamp: None,
    }
}

#[derive(Default, Deserialize)]
struct CanvasFile {
    #[serde(default)]
    nodes: Vec<CanvasCard>,
    #[serde(default)]
    orden: Option<CanvasOwn>,
    #[serde(default)]
    nib: Option<CanvasOwn>,
}

#[derive(Default, Deserialize)]
struct CanvasOwn {
    #[serde(default)]
    icon: Option<String>,
    #[serde(default, rename = "iconColor")]
    icon_color: Option<String>,
}

#[derive(Deserialize)]
struct CanvasCard {
    #[serde(rename = "type")]
    kind: Option<String>,
    file: Option<String>,
    subpath: Option<String>,
}

fn said(value: Option<String>) -> Option<String> {
    value
        .map(|one| one.trim().to_string())
        .filter(|one| !one.is_empty())
}

fn canvas_note(relative: String, body: &str) -> Note {
    let read: CanvasFile = serde_json::from_str(body).unwrap_or_default();
    let own = read.orden.or(read.nib).unwrap_or_default();

    let name = relative.rsplit('/').next().unwrap_or(&relative).to_string();

    let links: Vec<Link> = read
        .nodes
        .iter()
        .filter(|card| card.kind.as_deref() == Some("file"))
        .filter_map(|card| {
            let file = card.file.clone()?;
            let subpath = card.subpath.as_deref().unwrap_or_default();

            Some(Link {
                kind: "wikilink",
                target: file.clone(),
                heading: subpath
                    .strip_prefix('#')
                    .filter(|_| !subpath.starts_with("#^"))
                    .map(str::to_string),
                block: subpath.strip_prefix("#^").map(str::to_string),
                alias: None,
                embed: false,
                line: 0,
                text: file,
            })
        })
        .collect();

    Note {
        name,
        path: relative,
        headings: Vec::new(),
        blocks: Vec::new(),
        links,
        tags: Vec::new(),
        icon: said(own.icon),
        icon_color: said(own.icon_color),
        aliases: Vec::new(),
        url: None,
        favicon: None,
        address: None,
        cover: None,
        bare: false,
        front: None,
        tasks: Vec::new(),
        stamp: None,
    }
}

fn shortcut_note(relative: String, content: &str) -> Note {
    let name = relative.rsplit('/').next().unwrap_or(&relative).to_string();

    Note {
        name,
        path: relative,
        headings: Vec::new(),
        blocks: Vec::new(),
        links: Vec::new(),
        tags: Vec::new(),
        icon: key_of(content, "orden-chosen-icon").or_else(|| key_of(content, "nib-chosen-icon")),
        icon_color: key_of(content, "orden-chosen-color")
            .or_else(|| key_of(content, "nib-chosen-color")),
        aliases: Vec::new(),
        url: None,
        favicon: favicon_of(content),
        address: address_of(content),
        cover: None,
        bare: false,
        front: None,
        tasks: Vec::new(),
        stamp: None,
    }
}

fn favicon_of(content: &str) -> Option<String> {
    key_of(content, "orden-icon").or_else(|| key_of(content, "nib-icon"))
}

fn address_of(content: &str) -> Option<String> {
    key_of(content, "url").or_else(|| {
        let (_, after) = content.split_once("<key>URL</key>")?;
        let (_, after) = after.split_once("<string>")?;
        let (said, _) = after.split_once("</string>")?;
        let said = said
            .trim()
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&apos;", "'")
            .replace("&amp;", "&");
        (!said.is_empty()).then_some(said)
    })
}

fn key_of(content: &str, wanted: &str) -> Option<String> {
    content.lines().find_map(|line| {
        let (key, value) = line.split_once('=')?;
        if !key.trim().eq_ignore_ascii_case(wanted) {
            return None;
        }

        let value = value.trim();
        (!value.is_empty()).then(|| value.to_string())
    })
}

fn note_tags(body: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();

    for tag in tags_in(body) {
        let folded = tag.trim_start_matches('#').to_lowercase();
        if !folded.is_empty() && !out.contains(&folded) {
            out.push(folded);
        }
    }

    out
}

fn prose_lines(body: &str, words_from: usize, mut each: impl FnMut(usize, &str, Option<&str>)) {
    let mut code = CodeBlocks::default();

    for (index, line) in body.lines().enumerate() {
        if index < words_from || code.line(line) == CodeLine::Words {
            each(index, line, None);
        } else if let Some(name) = code.closed_name() {
            each(index, line, Some(name));
        }
    }
}

struct Prose {
    headings: Vec<String>,
    blocks: Vec<String>,
    links: Vec<Link>,
    tasks: Vec<Task>,
}

fn prose(body: &str, words_from: usize) -> Prose {
    let mut headings = Vec::new();
    let mut blocks = Vec::new();
    let mut links = Vec::new();
    let mut tasks: Vec<Task> = Vec::new();
    let mut section: Vec<(usize, String)> = Vec::new();
    let mut open: Vec<Open> = Vec::new();

    prose_lines(body, words_from, |index, line, fence_name| {
        if let Some(id) = fence_name {
            blocks.push(id.to_string());
            return;
        }

        let heading = heading_of(line);
        if let Some((level, text)) = heading {
            if index >= words_from {
                while section.last().is_some_and(|(above, _)| *above >= level) {
                    section.pop();
                }
                section.push((level, text.clone()));
                open.clear();
            }
            headings.push(text);
        } else if index >= words_from {
            let item = task_at(line);
            let mut task = None;
            if let Some(found) = &item {
                if tasks.len() < MOST_TASKS {
                    task = Some(tasks.len());
                    tasks.push(Task {
                        line: index,
                        indent: found.indent,
                        mark: found.mark,
                        text: clipped(&line[found.marker..], LONGEST_TASK).to_string(),
                        section: section.iter().map(|(_, text)| text.clone()).collect(),
                        description: None,
                        comments: 0,
                    });
                }
            }
            under(&mut open, &mut tasks, line, task, item.is_some());
        }
        if let Some(id) = block_id_of(line) {
            blocks.push(id);
        }

        if !line.as_bytes().contains(&b'[') {
            return;
        }

        if links.len() >= MOST_LINKS {
            return;
        }

        let mut found = links_on(&without_code(line), MOST_LINKS - links.len());
        if found.is_empty() {
            return;
        }

        let context: String = line.trim().chars().take(LINE).collect();
        for link in &mut found {
            link.line = index;
            link.text.clone_from(&context);
        }

        links.append(&mut found);
    });

    Prose {
        headings,
        blocks,
        links,
        tasks,
    }
}

fn clipped(text: &str, most: usize) -> &str {
    text.char_indices()
        .nth(most)
        .map_or(text, |(at, _)| &text[..at])
}

fn stamp_of(meta: &Metadata) -> Stamp {
    let millis = |time: std::io::Result<SystemTime>| {
        time.ok()
            .and_then(|one| one.duration_since(UNIX_EPOCH).ok())
            .map(|one| u64::try_from(one.as_millis()).unwrap_or(u64::MAX))
    };
    let mtime = millis(meta.modified()).unwrap_or_default();

    Stamp {
        size: meta.len(),
        mtime,
        ctime: millis(meta.created()).unwrap_or(mtime),
    }
}

fn loose(words: &str) -> String {
    let spaced: String = words
        .chars()
        .map(|one| {
            if "<>:\"/\\|?* -".contains(one) || one.is_whitespace() {
                ' '
            } else {
                one
            }
        })
        .collect();
    let joined = spaced.split_whitespace().collect::<Vec<_>>().join(" ");
    joined
        .trim_matches(|one: char| one == '.' || one.is_whitespace())
        .to_string()
}

fn says_nothing(body: &str, name: &str) -> bool {
    let mut lines = body.lines().filter(|line| !line.trim().is_empty());
    let Some(first) = lines.next() else {
        return true;
    };
    if lines.next().is_some() {
        return false;
    }

    let name = loose(name);
    heading_of(first).is_some_and(|(_, words)| !name.is_empty() && loose(&words) == name)
}

fn heading_of(line: &str) -> Option<(usize, String)> {
    let trimmed = line.trim_start();
    if line.len() - trimmed.len() > 3 {
        return None;
    }

    let hashes = trimmed.chars().take_while(|one| *one == '#').count();
    if hashes == 0 || hashes > 6 {
        return None;
    }

    let rest = &trimmed[hashes..];
    if !rest.starts_with(' ') && !rest.starts_with('\t') {
        return None;
    }

    Some((hashes, rest.trim().trim_end_matches('#').trim().to_string()))
}

fn block_id_of(line: &str) -> Option<String> {
    let trimmed = line.trim_end_matches([' ', '\t']);
    let caret = trimmed.rfind('^')?;

    let opens = caret == 0
        || trimmed[..caret]
            .chars()
            .next_back()
            .is_some_and(|one| one == ' ' || one == '\t');
    if !opens {
        return None;
    }

    let id = &trimmed[caret + 1..];
    if id.is_empty()
        || !id
            .chars()
            .all(|one| one.is_ascii_alphanumeric() || one == '-')
    {
        return None;
    }

    Some(id.to_string())
}

fn without_code(line: &str) -> Cow<'_, str> {
    if !line.contains('`') {
        return Cow::Borrowed(line);
    }

    let letters: Vec<char> = line.chars().collect();
    let mut out = String::with_capacity(line.len());
    let mut at = 0;

    while at < letters.len() {
        if letters[at] != '`' {
            out.push(letters[at]);
            at += 1;
            continue;
        }

        let mut open_end = at;
        while open_end < letters.len() && letters[open_end] == '`' {
            open_end += 1;
        }
        let marks = open_end - at;

        let mut close = None;
        let mut scan = open_end;
        while scan < letters.len() {
            if letters[scan] == '`' {
                let mut run = scan;
                while run < letters.len() && letters[run] == '`' {
                    run += 1;
                }
                if run - scan == marks {
                    close = Some(scan);
                    break;
                }
                scan = run;
                continue;
            }
            scan += 1;
        }

        match close {
            None => {
                for one in &letters[at..] {
                    out.push(*one);
                }
                break;
            }
            Some(end) => {
                for _ in at..end + marks {
                    out.push(' ');
                }
                at = end + marks;
            }
        }
    }

    Cow::Owned(out)
}

fn links_on(line: &str, most: usize) -> Vec<Link> {
    let letters: Vec<char> = line.chars().collect();
    let ends = label_ends(&letters);
    let mut found = Vec::new();
    let mut at = 0;

    while at < letters.len() && found.len() < most {
        if letters[at] != '[' || (at > 0 && letters[at - 1] == '\\') {
            at += 1;
            continue;
        }

        let embed = at > 0 && letters[at - 1] == '!' && (at < 2 || letters[at - 2] != '\\');

        if letters.get(at + 1) == Some(&'[') {
            if let Some(end) = closing_brackets(&letters, at + 2) {
                let inner: String = letters[at + 2..end].iter().collect();
                if let Some(link) = wikilink(&inner, embed) {
                    found.push(link);
                }
                at = end + 2;
                continue;
            }
            at += 1;
            continue;
        }

        if let Some((end, label, target)) = markdown_link(&letters, at, &ends) {
            if let Some(link) = note_link(&label, &target, embed) {
                found.push(link);
            }
            at = end;
            continue;
        }

        at += 1;
    }

    found
}

fn closing_brackets(letters: &[char], from: usize) -> Option<usize> {
    let mut at = from;
    while at < letters.len() {
        match letters[at] {
            '[' => return None,
            ']' => {
                let closed = letters.get(at + 1) == Some(&']');
                return if closed && at > from { Some(at) } else { None };
            }
            _ => at += 1,
        }
    }
    None
}

const DEEPEST_PARENS: usize = 32;

fn is_blank(one: char) -> bool {
    one == '\u{FEFF}' || (one != '\u{85}' && one.is_whitespace())
}

fn label_ends(letters: &[char]) -> Vec<Option<usize>> {
    let mut ends = vec![None; letters.len()];
    let mut open: Vec<usize> = Vec::new();
    let mut at = 0;

    while at < letters.len() {
        match letters[at] {
            '\\' => at += 1,
            '[' => {
                let doubles = letters.get(at + 1) == Some(&'[');
                if doubles || (at > 0 && letters[at - 1] == '[') {
                    open.clear();
                }
                if !doubles {
                    open.push(at);
                }
            }
            ']' => {
                if let Some(from) = open.pop() {
                    ends[from] = Some(at);
                    if letters.get(at + 1) == Some(&'(') {
                        open.clear();
                    }
                }
            }
            _ => {}
        }
        at += 1;
    }

    ends
}

fn bare_target_end(letters: &[char], from: usize, stop: usize) -> Option<usize> {
    let mut depth = 0;
    let mut at = from;

    while at < stop {
        match letters[at] {
            one if is_blank(one) => break,
            '\\' => {
                at += 2;
                continue;
            }
            '(' => {
                depth += 1;
                if depth > DEEPEST_PARENS {
                    return None;
                }
            }
            ')' => {
                if depth == 0 {
                    break;
                }
                depth -= 1;
            }
            _ => {}
        }
        at += 1;
    }

    (at < stop && depth == 0).then_some(at)
}

fn markdown_link(
    letters: &[char],
    at: usize,
    ends: &[Option<usize>],
) -> Option<(usize, String, String)> {
    let stop = letters.len().min(at + LONGEST_LINK);
    let skip_blanks = |from: usize| {
        let mut scan = from;
        while scan < stop && is_blank(letters[scan]) {
            scan += 1;
        }
        scan
    };

    let close = ends[at].filter(|close| *close < stop)?;
    if letters.get(close + 1) != Some(&'(') {
        return None;
    }

    let from = skip_blanks(close + 2);
    let (written, mut scan) = if letters.get(from) == Some(&'<') {
        let opened = from + 1;
        let mut end = opened;
        while end < stop && letters[end] != '>' && letters[end] != '<' {
            end += 1;
        }
        if end >= stop || letters[end] != '>' {
            return None;
        }
        (&letters[opened..end], end + 1)
    } else {
        let end = bare_target_end(letters, from, stop)?;
        if end == from {
            return None;
        }
        (&letters[from..end], end)
    };

    scan = skip_blanks(scan);
    if let Some(quote) = letters
        .get(scan)
        .copied()
        .filter(|one| matches!(one, '"' | '\''))
    {
        scan += 1;
        while scan < stop && letters[scan] != quote {
            scan += 1;
        }
        if scan >= stop {
            return None;
        }
        scan = skip_blanks(scan + 1);
    }
    if scan >= stop || letters[scan] != ')' {
        return None;
    }

    let label: String = letters[at + 1..close].iter().collect();
    Some((scan + 1, label, written.iter().collect()))
}

fn split_target(named: &str) -> (String, Option<String>, Option<String>) {
    let (target, fragment) = match named.split_once('#') {
        Some((target, rest)) => (target.trim().to_string(), rest.trim()),
        None => (named.trim().to_string(), ""),
    };

    let (heading, block) = anchors(fragment);
    (target, heading, block)
}

fn anchors(fragment: &str) -> (Option<String>, Option<String>) {
    let block = fragment.strip_prefix('^').map(str::to_string);
    let heading = if block.is_none() && !fragment.is_empty() {
        Some(fragment.to_string())
    } else {
        None
    };

    (heading, block)
}

fn wikilink(inner: &str, embed: bool) -> Option<Link> {
    let (named, alias) = match inner.split_once('|') {
        Some((named, alias)) => (
            named.strip_suffix('\\').unwrap_or(named),
            Some(alias.trim()).filter(|one| !one.is_empty()),
        ),
        None => (inner, None),
    };

    let (target, heading, block) = split_target(named);
    if target.is_empty() && heading.is_none() && block.is_none() {
        return None;
    }

    Some(Link {
        kind: "wikilink",
        target,
        heading,
        block,
        alias: alias.map(str::to_string),
        embed,
        line: 0,
        text: String::new(),
    })
}

fn note_link(label: &str, written: &str, embed: bool) -> Option<Link> {
    if !is_note_target(written) {
        return None;
    }

    let (target, fragment) = written.split_once('#').unwrap_or((written, ""));
    let (target, fragment) = (decode(target), decode_fragment(fragment));
    let (heading, block) = anchors(&fragment);
    if target.is_empty() && heading.is_none() && block.is_none() {
        return None;
    }

    Some(Link {
        kind: "markdown",
        target,
        heading,
        block,
        alias: Some(label.to_string()),
        embed,
        line: 0,
        text: String::new(),
    })
}

fn is_note_target(target: &str) -> bool {
    if target.starts_with("//") {
        return false;
    }

    let Some(colon) = target.find(':') else {
        return true;
    };

    let scheme = &target[..colon];
    !scheme.starts_with(|one: char| one.is_ascii_alphabetic())
        || !scheme
            .chars()
            .all(|one| one.is_ascii_alphanumeric() || matches!(one, '+' | '.' | '-'))
}

fn decode(target: &str) -> String {
    let bytes = target.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut at = 0;

    while at < bytes.len() {
        if let Some(byte) = escape_at(bytes, at) {
            out.push(byte);
            at += 3;
            continue;
        }
        if bytes[at] == b'\\' && bytes.get(at + 1).is_some_and(u8::is_ascii_punctuation) {
            at += 1;
        }
        out.push(bytes[at]);
        at += 1;
    }

    String::from_utf8(out).unwrap_or_else(|_| target.to_string())
}

fn decode_fragment(fragment: &str) -> String {
    let bytes = fragment.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut at = 0;

    while at < bytes.len() {
        if let Some(byte) = escape_at(bytes, at) {
            out.push(byte);
            at += 3;
        } else {
            out.push(bytes[at]);
            at += 1;
        }
    }

    String::from_utf8_lossy(&out).into_owned()
}

fn escape_at(bytes: &[u8], at: usize) -> Option<u8> {
    if bytes.get(at) != Some(&b'%') {
        return None;
    }

    let high = hex(*bytes.get(at.checked_add(1)?)?)?;
    let low = hex(*bytes.get(at.checked_add(2)?)?)?;
    Some((high << 4) | low)
}

fn hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::{
        block_id_of, canvas_note, decode, favicon_of, heading_of, note_at, note_tags, prose,
        shortcut_note, stamp_of, without_code, words_stamped, Link, LONGEST_DESCRIPTION,
        LONGEST_TASK,
    };

    fn links_in(body: &str) -> Vec<Link> {
        prose(body, 0).links
    }

    fn headings_in(body: &str) -> Vec<String> {
        prose(body, 0).headings
    }

    #[test]
    fn reads_a_note_into_what_the_index_holds() {
        let read = note_at(
            "Work/Meeting Notes.md".to_string(),
            "---\nicon: rocket\nicon-color: blue\naliases: [Standup]\n---\n\n# Later\n\nSee [[Plan]] #work ^abc123\n",
        );

        assert_eq!(read.path, "Work/Meeting Notes.md");
        assert_eq!(read.name, "Meeting Notes");
        assert_eq!(read.headings, ["Later"]);
        assert_eq!(read.blocks, ["abc123"]);
        assert_eq!(read.tags, ["work"]);
        assert_eq!(read.icon.as_deref(), Some("rocket"));
        assert_eq!(read.icon_color.as_deref(), Some("blue"));
        assert_eq!(read.aliases, ["Standup"]);
        assert!(read.url.is_none());
        assert_eq!(read.links.len(), 1);
        assert_eq!(read.links[0].target, "Plan");
    }

    #[test]
    fn a_note_that_is_a_website_says_where_it_points() {
        let read = note_at(
            "Reading/Svelte.md".to_string(),
            "---\nurl: https://svelte.dev/docs\ntitle: Svelte docs\n---\n\n# Svelte docs\n",
        );

        assert_eq!(read.url.as_deref(), Some("https://svelte.dev/docs"));
    }

    #[test]
    fn a_note_says_which_picture_is_across_the_top_of_it() {
        let read = note_at(
            "Trips/Iceland.md".to_string(),
            "---\ncover: assets/wide.jpg\ncover-position: 20\n---\n\n# Iceland\n",
        );

        assert_eq!(read.cover.as_deref(), Some("assets/wide.jpg"));
        assert!(read.icon.is_none());
    }

    #[test]
    fn and_a_note_with_no_cover_carries_none() {
        let read = note_at("Trips/Plan.md".to_string(), "# Plan\n\nWords.\n");

        assert!(read.cover.is_none());
    }

    #[test]
    fn a_note_that_says_nothing_yet_is_bare() {
        let bare = |path: &str, body: &str| note_at(path.to_string(), body).bare;

        assert!(bare("Plan.md", ""));
        assert!(bare("Plan.md", "  \n\n\t\n"));
        assert!(bare("Plan.md", "# Plan\n\n"));
        assert!(bare("Trips/Plan.md", "## Plan ##\r\n\r\n"));
        assert!(bare("Q1 costs.md", "# Q1: costs\n"));
        assert!(bare("Plan.md", "---\nicon: rocket\ntitle: Plan\n---\n\n"));
        assert!(bare("Plan.md", "---\ntitle: Plan\n---\n# Plan\n"));

        assert!(!bare("Plan.md", "# Plan\n\nWords.\n"));
        assert!(!bare("Plan.md", "# Another\n"));
        assert!(!bare("Plan.md", "Plan\n"));
        assert!(!bare("Plan.md", "# Plan\n- [ ] task\n"));
        assert!(!bare("Plan.md", "#Plan\n"));
    }

    #[test]
    fn a_website_carries_its_favicon_for_the_file_list() {
        let read = shortcut_note(
            "Reading/Svelte docs.url".to_string(),
            "[InternetShortcut]\nURL=https://svelte.dev/docs\nOrden-Icon=https://svelte.dev/favicon.png\n",
        );

        assert_eq!(read.name, "Svelte docs.url");
        assert_eq!(
            read.favicon.as_deref(),
            Some("https://svelte.dev/favicon.png")
        );
        assert_eq!(read.address.as_deref(), Some("https://svelte.dev/docs"));
        assert!(read.url.is_none());
        assert!(read.icon.is_none());
    }

    #[test]
    fn a_website_wears_the_icon_chosen_for_it() {
        let read = shortcut_note(
            "Svelte docs.url".to_string(),
            "[InternetShortcut]\r\nURL=https://svelte.dev/\r\nOrden-Icon=data:image/png;base64,AA\r\nOrden-Chosen-Icon=rocket\r\nOrden-Chosen-Color=violet\r\n",
        );

        assert_eq!(read.icon.as_deref(), Some("rocket"));
        assert_eq!(read.icon_color.as_deref(), Some("violet"));
        assert_eq!(read.favicon.as_deref(), Some("data:image/png;base64,AA"));
    }

    #[test]
    fn a_website_says_where_it_points_and_nothing_else_does() {
        let webloc = shortcut_note(
            "A.webloc".to_string(),
            "<plist><dict><key>URL</key><string>https://a.example/?x=1&amp;y=2</string></dict></plist>",
        );
        assert_eq!(
            webloc.address.as_deref(),
            Some("https://a.example/?x=1&y=2")
        );
        assert!(webloc.favicon.is_none());

        let empty = shortcut_note("B.url".to_string(), "[InternetShortcut]\n");
        assert!(empty.address.is_none());
        assert!(note_at("Plan.md".to_string(), "# Plan\n").address.is_none());
    }

    #[test]
    fn a_shortcut_with_no_mark_has_no_favicon() {
        let bare = shortcut_note(
            "A.url".to_string(),
            "[InternetShortcut]\nURL=https://a.example/\n",
        );
        assert!(bare.favicon.is_none());

        assert_eq!(
            favicon_of("orden-icon=https://a.example/i.png").as_deref(),
            Some("https://a.example/i.png")
        );
        assert!(favicon_of("Nib-Icon=   ").is_none());
        assert!(favicon_of("URL=https://a.example/").is_none());
    }

    #[test]
    fn a_notes_name_is_its_own_and_loses_only_its_extension() {
        let dotted = note_at("Work/v1.2 plan.md".to_string(), "");
        assert_eq!(dotted.name, "v1.2 plan");
        assert_eq!(note_at("Idea.md".to_string(), "").name, "Idea");
    }

    fn targets(body: &str) -> Vec<String> {
        links_in(body).into_iter().map(|one| one.target).collect()
    }

    #[test]
    fn a_percent_before_a_wide_character_is_text() {
        assert_eq!(decode("%€"), "%€");
        assert_eq!(decode("a%€b"), "a%€b");
        assert_eq!(decode("%😀 and more"), "%😀 and more");
        assert_eq!(targets("see [x](%€) now"), vec!["%€"]);

        assert_eq!(decode("My%20Note.md"), "My Note.md");
        assert_eq!(decode("100%"), "100%");
        assert_eq!(decode("%zz"), "%zz");
        assert_eq!(decode("%2f"), "/");
        assert_eq!(decode("%2F"), "/");
        assert_eq!(decode("%+1"), "%+1");
        assert_eq!(decode("%-1"), "%-1");
    }

    #[test]
    fn finds_a_wikilink_in_every_spelling() {
        assert_eq!(targets("see [[Other Note]] now"), vec!["Other Note"]);
        assert_eq!(targets("[[Note|shown]]"), vec!["Note"]);
        assert_eq!(targets("[[Note#Heading]]"), vec!["Note"]);
        assert_eq!(targets("[[folder/Note.md]]"), vec!["folder/Note.md"]);
        assert_eq!(targets("[[ Note ]]"), vec!["Note"]);
    }

    #[test]
    fn reads_what_a_wikilink_says() {
        let links = links_in("![[Note#Heading|shown]]");
        assert_eq!(links.len(), 1);
        assert_eq!(links[0].heading.as_deref(), Some("Heading"));
        assert_eq!(links[0].alias.as_deref(), Some("shown"));
        assert!(links[0].embed);

        let block = links_in("[[Note#^abc123]]");
        assert_eq!(block[0].block.as_deref(), Some("abc123"));
        assert_eq!(block[0].heading, None);
    }

    #[test]
    fn an_empty_link_is_not_one() {
        assert!(targets("[[]]").is_empty());
        assert!(targets("[[a]b]]").is_empty());
        assert!(targets("[[|only an alias]]").is_empty());
    }

    #[test]
    fn a_same_note_anchor_has_no_target() {
        let links = links_in("[[#Heading]]");
        assert_eq!(links[0].target, "");
        assert_eq!(links[0].heading.as_deref(), Some("Heading"));
    }

    #[test]
    fn an_escaped_bracket_is_text() {
        assert!(targets("\\[[Note]]").is_empty());
    }

    #[test]
    fn code_holds_no_links() {
        assert!(targets("write `[[Note]]` to link").is_empty());
        assert_eq!(targets("```\n[[Note]]\n```\n[[Real]]"), vec!["Real"]);
        assert_eq!(targets("`` ` [[Note]] `` [[Real]]"), vec!["Real"]);
    }

    #[test]
    fn a_fence_closes_only_on_its_own_mark() {
        let tilde = "```\n~~~\n```\n\nSee [[Plan]]\n- [ ] call Bob\n";
        assert_eq!(targets(tilde), vec!["Plan"]);
        assert_eq!(prose(tilde, 0).tasks.len(), 1);

        assert_eq!(targets("````md\n```\n````\n[[Plan]]"), vec!["Plan"]);
        assert_eq!(targets("```a`b\n[[Plan]]"), vec!["Plan"]);

        let shown = "~~~md\n```js\n- [ ] example\n[[Example]]\n```\n~~~\n[[Real]]\n";
        assert_eq!(targets(shown), vec!["Real"]);
        assert!(prose(shown, 0).tasks.is_empty());
    }

    #[test]
    fn a_fence_in_the_front_matter_opens_no_code() {
        let read = note_at(
            "Fenced.md".to_string(),
            "---\nscript: |\n  ```\nup: \"[[Up]]\"\n---\n- [ ] t [[L]]\n",
        );
        let targets: Vec<&str> = read.links.iter().map(|one| one.target.as_str()).collect();
        assert_eq!(targets, ["Up", "L"]);
        assert_eq!(read.tasks.len(), 1);
        assert_eq!(read.tasks[0].text, "t [[L]]");
    }

    #[test]
    fn code_in_quotes_items_and_indents_holds_nothing() {
        let quoted = "> ```\n> [[Example]]\n> - [ ] example\n> ```\n\n[[Real]]\n";
        assert_eq!(targets(quoted), vec!["Real"]);
        assert!(prose(quoted, 0).tasks.is_empty());

        let indented =
            "Words.\n\n    [[Example]]\n    - [ ] example\n    # Not a heading\n\n[[Real]]\n";
        assert_eq!(targets(indented), vec!["Real"]);
        assert!(prose(indented, 0).tasks.is_empty());

        let item = "- a\n  ```\n  [[Example]]\n  # Not a heading\n  ```\n- [[Real]]\n";
        assert_eq!(targets(item), vec!["Real"]);
        assert!(headings_in(item).is_empty());

        let tasks = prose(
            "- [ ] one\n    - [ ] two\n\t- [ ] three\n- item\n  - [ ] four\n\n  - [ ] five\n",
            0,
        )
        .tasks;
        let texts: Vec<&str> = tasks.iter().map(|task| task.text.as_str()).collect();
        assert_eq!(texts, ["one", "two", "three", "four", "five"]);
    }

    #[test]
    fn a_code_span_that_never_closes_is_text() {
        assert_eq!(targets("` [[Note]]"), vec!["Note"]);
    }

    #[test]
    fn blanking_code_keeps_the_line_the_same_length() {
        let line = "a `b c` d";
        assert_eq!(without_code(line).chars().count(), line.chars().count());
        assert!(matches!(
            without_code("see [[Note]] now"),
            std::borrow::Cow::Borrowed(_)
        ));
    }

    #[test]
    fn an_internal_markdown_link_counts_and_a_web_one_does_not() {
        assert_eq!(
            targets("see [the note](notes/Other.md) here"),
            vec!["notes/Other.md"]
        );
        assert!(targets("[x](https://x.dev) [y](mailto:a@b.dev)").is_empty());
        assert!(targets("[y](//x.dev/a)").is_empty());
    }

    #[test]
    fn an_escaped_hash_is_part_of_the_name() {
        let links = links_in("[S](C%23.md#a%20b)");
        assert_eq!(links[0].target, "C#.md");
        assert_eq!(links[0].heading.as_deref(), Some("a b"));

        assert_eq!(targets("[S](Why%3F.md)"), vec!["Why?.md"]);
        assert_eq!(targets("[S](a%2520b.md)"), vec!["a%20b.md"]);
        assert_eq!(decode("a%20b%"), "a b%");
        assert_eq!(decode("%FF.md"), "%FF.md");
        assert_eq!(links_in("[S](a.md#^b1)")[0].block.as_deref(), Some("b1"));
    }

    #[test]
    fn the_walk_agrees_with_links_ts() {
        assert_eq!(targets("[x]([[a]])"), vec!["[[a]]"]);
        assert!(targets("[x](http://a/[[b]])").is_empty());
        assert_eq!(targets("[[\\]](x)"), vec!["\\"]);
        assert_eq!(targets("| [[a\\|b]] |"), vec!["a"]);
        assert_eq!(links_in("[[a\\|b]]")[0].alias.as_deref(), Some("b"));
        assert!(targets("[x](a\u{FEFF}b.md)").is_empty());
        assert_eq!(targets("[x](a\u{85}b.md)"), vec!["a\u{85}b.md"]);
    }

    #[test]
    fn a_line_of_brackets_is_read_once() {
        let ends = super::label_ends(&"a[".repeat(50_000).chars().collect::<Vec<char>>());
        assert!(ends.iter().all(Option::is_none));

        let of = |line: &str| super::label_ends(&line.chars().collect::<Vec<char>>());
        assert_eq!(of("[a[b]c]")[0], Some(6));
        assert_eq!(of("[a[b]c]")[2], Some(4));
        assert_eq!(of("[a[b](c)d]")[0], None);
        assert_eq!(of("[a[b](c)d]")[2], Some(4));
        assert_eq!(of("[[a]")[0], None);
        assert_eq!(of("[[a]")[1], Some(3));
        assert_eq!(of("[a\\]b]")[0], Some(5));
    }

    #[test]
    fn a_markdown_link_holds_balanced_parentheses_and_brackets() {
        assert_eq!(targets("[x](a%20(1).md)"), vec!["a (1).md"]);
        assert_eq!(targets("[x](a(1).md)"), vec!["a(1).md"]);
        assert_eq!(targets("[x](a((1)).md)"), vec!["a((1)).md"]);
        assert_eq!(
            targets("[x](a(1).md \"t\") [y](b.md)"),
            vec!["a(1).md", "b.md"]
        );
        assert_eq!(targets("[x](a\\(1.md)"), vec!["a(1.md"]);

        assert!(targets("[x](a(1.md)").is_empty());
        assert_eq!(targets("[x](a)1).md)"), vec!["a"]);

        assert_eq!(links_in("[a[b]c](d.md)")[0].alias.as_deref(), Some("a[b]c"));
        assert_eq!(links_in("[a\\]b](d.md)")[0].alias.as_deref(), Some("a\\]b"));
        assert_eq!(links_in("[a[b](d.md)")[0].alias.as_deref(), Some("b"));

        assert_eq!(targets("[a[b](c.md)d](e.md)"), vec!["c.md"]);
        let image = links_in("[![i](p.png)](e.md)");
        assert_eq!(image.len(), 1);
        assert_eq!(image[0].target, "p.png");
        assert!(image[0].embed);

        let wiki = links_in("[[a]](b.md)");
        assert_eq!(wiki.len(), 1);
        assert_eq!(wiki[0].kind, "wikilink");
        assert_eq!(targets("[x [[a]] y](b.md)"), vec!["a"]);

        assert!(targets("[x](a b.md)").is_empty());
        assert!(targets("[x](<a<b>)").is_empty());
        assert!(!links_in("\\![x](a.md)")[0].embed);

        assert!(links_in(&format!("[a]({}", "(".repeat(100_000))).is_empty());
    }

    #[test]
    fn a_markdown_target_loses_its_encoding_and_keeps_its_heading() {
        let links = links_in("[x](My%20Note.md#a-heading)");
        assert_eq!(links[0].target, "My Note.md");
        assert_eq!(links[0].heading.as_deref(), Some("a-heading"));
    }

    #[test]
    fn an_angled_markdown_target_holds_spaces() {
        assert_eq!(targets("[x](<My Note.md>)"), vec!["My Note.md"]);
    }

    #[test]
    fn a_markdown_title_does_not_end_up_in_the_target() {
        assert_eq!(targets("[x](Note.md \"A title\")"), vec!["Note.md"]);
    }

    #[test]
    fn several_links_on_one_line_all_count() {
        assert_eq!(targets("[[A]] and [[B|b]] and ![[C]]"), vec!["A", "B", "C"]);
    }

    #[test]
    fn a_link_longer_than_any_link_is_not_one() {
        let target = "x".repeat(super::LONGEST_LINK);
        assert!(links_in(&format!("[a]({target}.md)")).is_empty());

        let label = "y".repeat(super::LONGEST_LINK);
        assert!(links_in(&format!("[{label}](Note.md)")).is_empty());

        let path = "x".repeat(200);
        assert_eq!(links_in(&format!("[a]({path}.md)")).len(), 1);
    }

    #[test]
    fn a_line_of_half_written_links_is_a_line_of_none() {
        assert!(links_in(&"[a](".repeat(5_000)).is_empty());
        assert!(links_in(&"[[a".repeat(5_000)).is_empty());
    }

    #[test]
    fn a_note_says_where_it_points_only_so_many_times() {
        let many = "[[A]] ".repeat(20_000);
        let found = links_in(&many);

        assert_eq!(found.len(), super::MOST_LINKS);
        assert!(found[0].text.len() <= super::LINE);
    }

    #[test]
    fn what_is_past_the_ceiling_is_the_links_and_nothing_else() {
        let body = format!("{}\n## Later\n", "[[A]] ".repeat(6000));
        let read = prose(&body, 0);

        assert_eq!(read.links.len(), super::MOST_LINKS);
        assert_eq!(read.headings, vec!["Later"]);
    }

    #[test]
    fn a_link_carries_its_line_and_the_words_around_it() {
        let links = links_in("first\nsecond [[Note]] third");
        assert_eq!(links[0].line, 1);
        assert_eq!(links[0].text, "second [[Note]] third");
    }

    #[test]
    fn finds_the_headings_and_nothing_else() {
        assert_eq!(headings_in("# One\ntext\n## Two ##"), vec!["One", "Two"]);
        assert_eq!(
            headings_in("#notatag\n####### too many"),
            Vec::<String>::new()
        );
        assert_eq!(headings_in("```\n# In code\n```"), Vec::<String>::new());
    }

    #[test]
    fn a_heading_may_be_indented_up_to_three_spaces() {
        assert_eq!(heading_of("   # Three"), Some((1, "Three".to_string())));
        assert_eq!(heading_of("    # Four"), None);
    }

    #[test]
    fn a_block_name_ends_a_line_and_starts_a_word() {
        assert_eq!(
            block_id_of("Some paragraph. ^abc123").as_deref(),
            Some("abc123")
        );
        assert_eq!(block_id_of("^on-its-own").as_deref(), Some("on-its-own"));
        assert_eq!(block_id_of("a^b"), None);
        assert_eq!(block_id_of("^abc in the middle"), None);
        assert_eq!(block_id_of("x^2^ is a superscript"), None);
    }

    #[test]
    fn reads_the_icon_a_canvas_wears() {
        let read = canvas_note(
            "boards/Board.canvas".to_string(),
            r#"{"nodes":[],"edges":[],"orden":{"version":1,"icon":"rocket"}}"#,
        );

        assert_eq!(read.icon.as_deref(), Some("rocket"));
        assert_eq!(read.name, "Board.canvas");
        assert_eq!(read.path, "boards/Board.canvas");
    }

    #[test]
    fn a_canvas_written_under_the_old_name_still_wears_its_icon() {
        let old = canvas_note(
            "Board.canvas".to_string(),
            r#"{"nodes":[],"nib":{"version":1,"icon":"rocket"}}"#,
        );
        assert_eq!(old.icon.as_deref(), Some("rocket"));

        let both = canvas_note(
            "Board.canvas".to_string(),
            r#"{"nodes":[],"orden":{"icon":"star"},"nib":{"icon":"rocket"}}"#,
        );
        assert_eq!(both.icon.as_deref(), Some("star"));
    }

    #[test]
    fn a_website_written_under_the_old_name_still_wears_its_icon() {
        let old = "[InternetShortcut]\nURL=https://a.example/\nNib-Icon=https://a.example/i.png\nNib-Chosen-Icon=rocket\nNib-Chosen-Color=violet\n";
        assert_eq!(favicon_of(old).as_deref(), Some("https://a.example/i.png"));
        let read = shortcut_note("A.url".to_string(), old);
        assert_eq!(read.icon.as_deref(), Some("rocket"));
        assert_eq!(read.icon_color.as_deref(), Some("violet"));
    }

    #[test]
    fn a_canvas_that_says_nothing_wears_nothing() {
        let plain = canvas_note("Board.canvas".to_string(), r#"{"nodes":[],"edges":[]}"#);
        assert_eq!(plain.icon, None);

        let blank = canvas_note(
            "Board.canvas".to_string(),
            r#"{"nodes":[],"orden":{"icon":"   "}}"#,
        );
        assert_eq!(blank.icon, None);

        let broken = canvas_note("Board.canvas".to_string(), "not json");
        assert_eq!(broken.icon, None);
        assert!(broken.links.is_empty());
    }

    #[test]
    fn a_card_that_names_a_file_is_a_link_out_of_the_canvas() {
        let read = canvas_note(
            "Board.canvas".to_string(),
            concat!(
                r##"{"nodes":["##,
                r##"{"id":"a","type":"file","file":"Plan.md"},"##,
                r##"{"id":"b","type":"file","file":"Plan.md","subpath":"#Later"},"##,
                r##"{"id":"c","type":"file","file":"Plan.md","subpath":"#^abc123"},"##,
                r##"{"id":"d","type":"text","text":"[[Not a link out of here]]"}"##,
                r##"],"edges":[]}"##
            ),
        );

        let targets: Vec<&str> = read.links.iter().map(|link| link.target.as_str()).collect();
        assert_eq!(targets, vec!["Plan.md", "Plan.md", "Plan.md"]);
        assert_eq!(read.links[0].heading, None);
        assert_eq!(read.links[1].heading.as_deref(), Some("Later"));
        assert_eq!(read.links[2].block.as_deref(), Some("abc123"));
        assert!(read.headings.is_empty());
    }

    #[test]
    fn the_index_keeps_each_tag_once_folded_and_without_the_hash() {
        assert_eq!(
            note_tags("#Work/Nib twice: #work/nib and #plans"),
            vec!["work/nib".to_string(), "plans".to_string()]
        );
        assert!(note_tags("nothing here").is_empty());
    }

    #[test]
    fn a_canvas_carries_no_tags() {
        let read = canvas_note(
            "Board.canvas".to_string(),
            r##"{"nodes":[{"id":"a","type":"text","text":"#work"}],"edges":[]}"##,
        );

        assert!(read.tags.is_empty());
    }

    #[test]
    fn a_note_carries_its_task_lines_and_the_sections_above_them() {
        let read = note_at(
            "Errands.md".to_string(),
            "# Home\n- [ ] Water the plants 📅 2026-10-04\n## Kitchen\n  - [/] Descale\n# Bank\n1. [x] Call ✅ 2026-10-01\n",
        );

        let tasks: Vec<_> = read
            .tasks
            .iter()
            .map(|one| {
                (
                    one.line,
                    one.indent,
                    one.mark,
                    one.text.as_str(),
                    one.section.join(" > "),
                )
            })
            .collect();
        assert_eq!(
            tasks,
            [
                (
                    1,
                    0,
                    ' ',
                    "Water the plants 📅 2026-10-04",
                    "Home".to_string()
                ),
                (3, 2, '/', "Descale", "Home > Kitchen".to_string()),
                (5, 0, 'x', "Call ✅ 2026-10-01", "Bank".to_string()),
            ]
        );
    }

    #[test]
    fn front_matter_is_raw_and_code_holds_no_tasks() {
        let read = note_at(
            "Bug.md".to_string(),
            "---\nstatus: open\n# a comment\n---\n```\n- [ ] not a task\n```\n- [ ] a task\n",
        );

        assert_eq!(read.front.as_deref(), Some("status: open\n# a comment"));
        assert_eq!(read.tasks.len(), 1);
        assert_eq!(read.tasks[0].line, 7);
        assert!(read.tasks[0].section.is_empty());

        let plain = note_at("Plain.md".to_string(), "- [ ] one\r\n");
        assert!(plain.front.is_none());
        assert_eq!(plain.tasks[0].text, "one");

        let crlf = note_at("Win.md".to_string(), "---\r\na: 1\r\n---\r\n");
        assert_eq!(crlf.front.as_deref(), Some("a: 1"));
    }

    #[test]
    fn a_task_line_is_kept_to_a_length() {
        let long = format!("- [ ] {}", "é".repeat(LONGEST_TASK + 10));
        let read = note_at("Long.md".to_string(), &long);

        assert_eq!(read.tasks[0].text.chars().count(), LONGEST_TASK);
    }

    #[test]
    fn a_task_carries_its_description_and_its_comments() {
        let note = [
            "- [ ] Call the bank",
            "  Their number is on the back.",
            "  And a second line.",
            "",
            "  - [ ] Find the old card",
            "    - a note under the sub-task",
            "  - Called, no answer.",
            "    - a bullet inside the comment",
            "  - Called again.",
            "- [ ] Water the plants",
            "Lazy words at the margin belong to nobody.",
            "- [ ] Pay rent",
            "  - [ ] One step",
            "  Words after a step are not the description.",
            "## Next",
            "  Under a heading, nobody.",
        ]
        .join("\n");
        let read = note_at("Errands.md".to_string(), &note);

        let tasks: Vec<_> = read
            .tasks
            .iter()
            .map(|one| (one.text.as_str(), one.description.as_deref(), one.comments))
            .collect();
        assert_eq!(
            tasks,
            [
                ("Call the bank", Some("Their number is on the back."), 2),
                ("Find the old card", None, 1),
                ("Water the plants", None, 0),
                ("Pay rent", None, 0),
                ("One step", None, 0),
            ]
        );
    }

    #[test]
    fn a_description_is_kept_to_a_length_and_code_is_none() {
        let long = format!("- [ ] a\n  {}\n", "é".repeat(LONGEST_DESCRIPTION + 5));
        let read = note_at("Long.md".to_string(), &long);
        let kept = read.tasks[0].description.as_deref().unwrap_or_default();
        assert_eq!(kept.chars().count(), LONGEST_DESCRIPTION);

        let code = note_at(
            "Code.md".to_string(),
            "- [ ] a\n  ```\n  not words\n  ```\n  words\r\n",
        );
        assert_eq!(code.tasks[0].description.as_deref(), Some("words"));
    }

    #[test]
    #[ignore = "a measurement, run by hand"]
    fn what_the_rows_add_to_a_scan() {
        let notes: Vec<String> = (0..5000)
            .map(|at| {
                format!(
                    "---\nstatus: open\n---\n# Note {at}\nSome words with a [[link]] in them.\n## Errands\n- [ ] Call {at} [time:: 16:00] #admin ⏫ 📅 2026-10-06\n  - [x] Find the card ✅ 2026-10-01\nAnd a closing paragraph of prose that runs on for a while.\n"
                )
            })
            .collect();

        let time = |words_from: usize| {
            let started = std::time::Instant::now();
            let found: usize = notes
                .iter()
                .map(|body| prose(body, words_from).tasks.len())
                .sum();
            (started.elapsed(), found)
        };

        let (without, none) = time(usize::MAX);
        let (with, tasks) = time(0);
        assert_eq!((none, tasks), (0, 10_000));
        println!("prose over 5,000 notes: {without:?} without tasks, {with:?} with 10,000");
    }

    #[test]
    fn a_stamp_says_the_size_and_the_times() {
        let path = std::env::temp_dir().join(format!("orden-stamp-{}.md", std::process::id()));
        std::fs::write(&path, "- [ ] a").expect("written");
        let (words, meta) = words_stamped(&path).expect("read");
        let stamp = stamp_of(&meta);
        std::fs::remove_file(&path).expect("removed");

        assert_eq!(words, "- [ ] a");
        assert_eq!(stamp.size, 7);
        assert!(stamp.mtime > 0 && stamp.ctime > 0);
    }
}
