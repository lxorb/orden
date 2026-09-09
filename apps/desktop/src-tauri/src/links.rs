//! The links between notes, read off a whole space in one pass.
//!
//! What this exists for: the Links panel wants the backlinks of the open note,
//! the autocomplete wants every note's name and headings, and both want them for
//! a space that may hold thousands of notes. Asking the window to read each note
//! through `read_note` would be one round trip per file plus a JSON copy of every
//! note's text; here each file is read once, its links and headings are taken out
//! of it, and only that comes back.
//!
//! The grammar is Obsidian's, and it is the same grammar `@nib/markdown/links`
//! reads on the other side. Two languages cannot share one parser, so the tests
//! at the bottom are what keep the two readings from drifting: every case here
//! has a twin in `packages/markdown/src/links.test.ts`.

use serde::{Deserialize, Serialize};
use std::fs;
use tauri::AppHandle;

use crate::paths::{files_in, in_spaces, is_canvas, relative_to};

/// How much of a line is worth keeping as the context a result is read in. The
/// same as a search hit shows, so the two panels read alike.
const LINE: usize = 200;

/// One link out of a note.
#[derive(Serialize)]
pub struct Link {
    /// `wikilink` for `[[Note]]`, `markdown` for `[label](Note.md)`.
    kind: &'static str,
    /// The note it names, as written. Empty for a link inside its own note.
    target: String,
    heading: Option<String>,
    block: Option<String>,
    alias: Option<String>,
    /// `![[…]]` or `![…](…)`: the target's content rather than a link to it.
    embed: bool,
    /// The line it sits on, counting from zero.
    line: usize,
    /// The line itself, so a result reads like the note.
    text: String,
}

/// One note as the link index sees it.
#[derive(Serialize)]
pub struct Note {
    /// Path relative to the space, with `/` separators.
    path: String,
    /// The file's name without its extension, which is what a link uses.
    name: String,
    headings: Vec<String>,
    /// The `^abc123` names blocks in this note carry.
    blocks: Vec<String>,
    links: Vec<Link>,
    /// What the note's front matter says it wears in the file list, as written:
    /// `file-text`, Iconize's `LiFileText` or an emoji. None where it says
    /// nothing, which is almost every note. Read here because the pass over the
    /// space is already reading every note, and reading them a second time for
    /// one line of metadata would be a second pass over the disk.
    icon: Option<String>,
    /// The other names the note gave itself, as its front matter lists them. On
    /// the same pass and for the same reason as the icon: the space is already
    /// being read, and a link may use any of them.
    aliases: Vec<String>,
}

/// A whole space's links.
#[derive(Serialize)]
pub struct SpaceLinks {
    notes: Vec<Note>,
    /// Every file in the space that is not a note, relative to it, so
    /// `![[picture.png]]` finds a picture wherever it lives - as Obsidian does.
    files: Vec<String>,
}

/// Reads every note in a space and returns what links out of each, the headings
/// and block names inside each, and the other files beside them.
#[tauri::command]
pub fn scan_links(app: AppHandle, root: String) -> Result<SpaceLinks, String> {
    let dir = in_spaces(&app, &root)?;
    let (notes, others) = files_in(&dir);

    let mut out = Vec::with_capacity(notes.len());
    for path in notes {
        // A note that cannot be read is not a failure of the whole space: the
        // rest of it still has links worth knowing about.
        let Ok(body) = fs::read_to_string(&path) else {
            continue;
        };

        let relative = relative_to(&dir, &path);
        let name = relative
            .rsplit('/')
            .next()
            .unwrap_or(&relative)
            .rsplit_once('.')
            .map_or_else(|| relative.clone(), |(stem, _)| stem.to_string());

        out.push(Note {
            path: relative,
            name,
            headings: headings_in(&body),
            blocks: block_ids_in(&body),
            links: links_in(&body),
            icon: front_matter_value(&body, "icon"),
            aliases: front_matter_list(&body, "aliases"),
        });
    }

    // The canvases too, for the icon each one wears. A canvas is a file rather
    // than a note and stays among `files`, which is how `![[Board.canvas]]`
    // resolves; it is read here as well because every row of the tree wants the
    // icon, and a scan that skipped it would leave a canvas wearing the plain
    // mark until somebody opened it.
    for path in others.iter().filter(|path| is_canvas(path)) {
        let Ok(body) = fs::read_to_string(path) else {
            continue;
        };

        out.push(canvas_note(relative_to(&dir, path), &body));
    }

    // By path, so the order is the browser's order too: there the notes and the
    // canvases are sorted together, and the two readings have to agree.
    out.sort_by(|one, other| one.path.cmp(&other.path));

    Ok(SpaceLinks {
        notes: out,
        files: others.iter().map(|path| relative_to(&dir, path)).collect(),
    })
}

/// What a canvas file says that the index cares about.
///
/// A struct and not the whole of the JSON, so a plane of five thousand strokes is
/// read past rather than built in memory: the ink sits under `nib` beside the
/// icon, and serde walks over everything nothing here asks for.
///
/// The twin of `scanCanvas` in `apps/desktop/src/lib/scan-note.ts`. The format
/// itself is `packages/markdown/src/canvas.ts`; these are the two things a file
/// list and a Links panel need out of it.
#[derive(Default, Deserialize)]
struct CanvasFile {
    #[serde(default)]
    nodes: Vec<CanvasCard>,
    #[serde(default)]
    nib: CanvasNib,
}

/// The key the spec has no place for, which is where a canvas keeps its icon.
#[derive(Default, Deserialize)]
struct CanvasNib {
    #[serde(default)]
    icon: Option<String>,
}

/// One card, as far as this cares: the four kinds the spec names share these
/// fields, and only a `file` card points at anything.
#[derive(Deserialize)]
struct CanvasCard {
    #[serde(rename = "type")]
    kind: Option<String>,
    file: Option<String>,
    subpath: Option<String>,
}

/// A canvas as the link index sees it: the icon its `nib` key carries, and one
/// link for every card that names a file.
///
/// Nothing else. A canvas has no words of its own to index - the JSON is a
/// drawing, not prose - so there are no headings and no blocks, and nothing
/// points into one.
fn canvas_note(relative: String, body: &str) -> Note {
    let read: CanvasFile = serde_json::from_str(body).unwrap_or_default();

    let links = read
        .nodes
        .iter()
        .filter(|card| card.kind.as_deref() == Some("file"))
        .filter_map(|card| {
            let file = card.file.clone()?;
            let subpath = card.subpath.as_deref().unwrap_or_default();

            Some(Link {
                kind: "wikilink",
                target: file.clone(),
                // A card's subpath is a heading or a block, written with the `#`
                // a wikilink writes it with.
                heading: subpath
                    .strip_prefix('#')
                    .filter(|_| !subpath.starts_with("#^"))
                    .map(str::to_string),
                block: subpath.strip_prefix("#^").map(str::to_string),
                alias: None,
                embed: false,
                // A canvas has no lines, so every row reads as the card it came
                // from.
                line: 0,
                text: file,
            })
        })
        .collect();

    Note {
        // The extension is part of a canvas's name, the way it is for a PDF: a
        // link to one is written `[[Board.canvas]]`.
        name: relative.rsplit('/').next().unwrap_or(&relative).to_string(),
        path: relative,
        headings: Vec::new(),
        blocks: Vec::new(),
        links,
        // A value that is nothing but spaces is not an icon; what the words
        // themselves may say is read in the app's icons.ts.
        icon: read
            .nib
            .icon
            .map(|said| said.trim().to_string())
            .filter(|said| !said.is_empty()),
        aliases: Vec::new(),
    }
}

/// Where the front matter's own lines sit: from just past the opening fence to
/// the start of the line the closing one is on. None where the note opens with
/// anything else, which is most notes.
///
/// The block has to close, or the note opens with a rule rather than metadata.
fn front_matter_block(body: &str) -> Option<(usize, usize)> {
    let first = body.find('\n')?;
    if body[..first].trim() != "---" {
        return None;
    }

    let mut at = first + 1;
    while at <= body.len() {
        let end = body[at..].find('\n').map_or(body.len(), |one| at + one);
        if body[at..end].trim() == "---" {
            return Some((first + 1, at));
        }
        if end >= body.len() {
            break;
        }
        at = end + 1;
    }

    None
}

/// A top-level key read as a list: `key: [a, b]`, the `- a` lines written under
/// `key:`, or a single value standing for a list of one. Empty where the note
/// has no block, no such key, or nothing under it.
///
/// The twin of `frontMatterList` in `packages/markdown/src/front-matter.ts`.
fn front_matter_list(body: &str, key: &str) -> Vec<String> {
    let Some((from, close)) = front_matter_block(body) else {
        return Vec::new();
    };

    let mut at = from;
    while at < close {
        let end = body[at..]
            .find('\n')
            .map_or(close, |one| at + one)
            .min(close);

        if let Some((named, said)) = body[at..end].split_once(':') {
            // A key of the note's own stands at the left margin; an indented one
            // belongs to the key above it.
            if !named.starts_with(char::is_whitespace) && named.trim_end().eq_ignore_ascii_case(key)
            {
                let value = said.trim();
                return if value.is_empty() {
                    dash_items(body, end + 1, close)
                } else {
                    flow_items(value)
                };
            }
        }

        at = end + 1;
    }

    Vec::new()
}

/// `[One, Two]` on the key's own line, or a single value standing for a list of
/// one.
fn flow_items(value: &str) -> Vec<String> {
    if let Some(list) = value
        .strip_prefix('[')
        .and_then(|one| one.strip_suffix(']'))
    {
        return list
            .split(',')
            .filter_map(|one| unquoted(one.trim()))
            .collect();
    }

    unquoted(value).into_iter().collect()
}

/// The `- item` lines written under a key, up to the next key of the note's own
/// or anything else that is not an item.
fn dash_items(body: &str, from: usize, close: usize) -> Vec<String> {
    let mut out = Vec::new();
    let mut at = from;

    while at < close {
        let end = body[at..]
            .find('\n')
            .map_or(close, |one| at + one)
            .min(close);
        let line = body[at..end].trim();

        if !line.is_empty() {
            let Some(item) = line.strip_prefix('-') else {
                break;
            };
            // A dash with no space after it is not an item, and neither is a
            // dash on its own: `-One` is a word and `-` is a rule.
            if !item.starts_with(char::is_whitespace) {
                break;
            }
            if let Some(said) = unquoted(item.trim()) {
                out.push(said);
            }
        }

        at = end + 1;
    }

    out
}

/// A value with the quotes YAML would take off taken off, or None where nothing
/// is left of it.
fn unquoted(value: &str) -> Option<String> {
    let bare = value
        .strip_prefix('"')
        .and_then(|one| one.strip_suffix('"'))
        .or_else(|| {
            value
                .strip_prefix('\'')
                .and_then(|one| one.strip_suffix('\''))
        })
        .unwrap_or(value);

    if bare.is_empty() {
        None
    } else {
        Some(bare.to_string())
    }
}

/// A top-level `key: value` from the note's front matter, quotes stripped, or
/// None where the note has no block, no such key, or nothing after the colon.
///
/// The twin of `frontMatterValue` in `packages/markdown/src/front-matter.ts`,
/// which the browser build reads a space with; the tests at the bottom hold the
/// two to the same answers. A key indented under another one belongs to that one
/// and is not read: `paper` under `export:` is not the note's paper.
fn front_matter_value(body: &str, key: &str) -> Option<String> {
    let (from, close) = front_matter_block(body)?;

    let mut at = from;
    while at < close {
        let end = body[at..]
            .find('\n')
            .map_or(close, |one| at + one)
            .min(close);
        if let Some(said) = value_of(&body[at..end], key) {
            return Some(said);
        }
        at = end + 1;
    }

    None
}

/// What one line says under `key`, or None when the line is another key, a list
/// item, or a line indented under something else.
fn value_of(line: &str, key: &str) -> Option<String> {
    let (named, said) = line.split_once(':')?;
    // A key of the note's own stands at the left margin; an indented one belongs
    // to the key above it.
    if named.starts_with(char::is_whitespace) || !named.trim_end().eq_ignore_ascii_case(key) {
        return None;
    }

    unquoted(said.trim())
}

/// Whether a line opens or closes a fenced code block.
fn is_fence(line: &str) -> bool {
    let trimmed = line.trim_start();
    line.len() - trimmed.len() <= 3 && (trimmed.starts_with("```") || trimmed.starts_with("~~~"))
}

/// Every line of a note, saying which ones are code. Both delimiters of a fence
/// count as code: neither can hold a link, a heading or a block name.
fn lines(body: &str) -> Vec<(usize, &str, bool)> {
    let mut out = Vec::new();
    let mut fenced = false;

    for (index, line) in body.lines().enumerate() {
        let fence = is_fence(line);
        if fence {
            fenced = !fenced;
        }
        out.push((index, line, fenced || fence));
    }

    out
}

/// Every ATX heading in a note, in order, as the words it shows.
fn headings_in(body: &str) -> Vec<String> {
    let mut found = Vec::new();

    for (_, line, code) in lines(body) {
        if code {
            continue;
        }
        if let Some(text) = heading_of(line) {
            found.push(text);
        }
    }

    found
}

/// The words of a heading line, or nothing when the line is not one.
fn heading_of(line: &str) -> Option<String> {
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

    // A closing run of hashes is a style of writing a heading, not part of it.
    Some(rest.trim().trim_end_matches('#').trim().to_string())
}

/// Every block name in a note: the `^abc123` at the end of a line.
fn block_ids_in(body: &str) -> Vec<String> {
    let mut found = Vec::new();

    for (_, line, code) in lines(body) {
        if code {
            continue;
        }
        if let Some(id) = block_id_of(line) {
            found.push(id);
        }
    }

    found
}

/// The name a line ends by giving its block, if it gives one.
fn block_id_of(line: &str) -> Option<String> {
    let trimmed = line.trim_end_matches([' ', '\t']);
    let caret = trimmed.rfind('^')?;

    // A name starts a word, so what comes before the caret is a space or nothing.
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

/// Every link out of a note, in the order they were written.
fn links_in(body: &str) -> Vec<Link> {
    let mut found = Vec::new();

    for (index, line, code) in lines(body) {
        if code {
            continue;
        }

        // Inline code spans are blanked rather than removed, so what is left
        // still lines up with the line the context is taken from.
        let context: String = line.trim().chars().take(LINE).collect();

        for mut link in links_on(&without_code(line)) {
            link.line = index;
            link.text.clone_from(&context);
            found.push(link);
        }
    }

    found
}

/// The same line with every inline code span replaced by spaces of the same
/// length, so `[[Note]]` inside backticks is left alone and the offsets hold.
fn without_code(line: &str) -> String {
    let letters: Vec<char> = line.chars().collect();
    let mut out = String::with_capacity(line.len());
    let mut at = 0;

    while at < letters.len() {
        if letters[at] != '`' {
            out.push(letters[at]);
            at += 1;
            continue;
        }

        // A span is closed by a run of backticks as long as the one that opened
        // it, which is how `` ` `` holds a backtick.
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
            // Nothing closes it, so the backticks are text like anything else.
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

    out
}

/// Every link on one line of prose, in the order they were written.
fn links_on(line: &str) -> Vec<Link> {
    let letters: Vec<char> = line.chars().collect();
    let mut found = Vec::new();
    let mut at = 0;

    while at < letters.len() {
        // A backslash escapes the bracket, and a link nobody wrote is not one.
        if letters[at] != '[' || (at > 0 && letters[at - 1] == '\\') {
            at += 1;
            continue;
        }

        let embed = at > 0 && letters[at - 1] == '!';

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

        if let Some((end, label, target)) = markdown_link(&letters, at) {
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

/// Where the `]]` that closes a wikilink is, or nothing when the line holds no
/// such thing: a link takes one line and no brackets of its own.
fn closing_brackets(letters: &[char], from: usize) -> Option<usize> {
    let mut at = from;
    while at < letters.len() {
        match letters[at] {
            // A bracket of its own ends the search: `[[a]b]]` is not a link, and
            // neither is `[[]]`, which is what the emptiness check below says.
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

/// A `[label](target)` starting at `at`: where it ends, what it is labelled, and
/// where it points. Titles and `<>` around the target are both understood.
fn markdown_link(letters: &[char], at: usize) -> Option<(usize, String, String)> {
    let mut close = at + 1;
    while close < letters.len() && letters[close] != ']' {
        if letters[close] == '[' {
            return None;
        }
        close += 1;
    }
    if close >= letters.len() || letters.get(close + 1) != Some(&'(') {
        return None;
    }

    let mut scan = close + 2;
    while scan < letters.len() && (letters[scan] == ' ' || letters[scan] == '\t') {
        scan += 1;
    }

    let angled = letters.get(scan) == Some(&'<');
    if angled {
        scan += 1;
    }

    let mut target = String::new();
    while scan < letters.len() {
        let one = letters[scan];
        if angled && one == '>' {
            scan += 1;
            break;
        }
        if !angled && (one == ')' || one == ' ' || one == '\t') {
            break;
        }
        if one == '\n' {
            return None;
        }
        target.push(one);
        scan += 1;
    }

    // Whatever is left has to close the link, with room for a title.
    while scan < letters.len() && letters[scan] != ')' {
        scan += 1;
    }
    if scan >= letters.len() {
        return None;
    }

    let label: String = letters[at + 1..close].iter().collect();
    Some((scan + 1, label, target))
}

/// The note, heading and block a target names: `folder/Note#Heading`, or
/// `folder/Note#^blockid`.
fn split_target(named: &str) -> (String, Option<String>, Option<String>) {
    let (target, fragment) = match named.split_once('#') {
        Some((target, rest)) => (target.trim().to_string(), rest.trim()),
        None => (named.trim().to_string(), ""),
    };

    let block = fragment.strip_prefix('^').map(str::to_string);
    let heading = if block.is_none() && !fragment.is_empty() {
        Some(fragment.to_string())
    } else {
        None
    };

    (target, heading, block)
}

/// What is between the brackets, as a link. Nothing when it names nothing to
/// point at.
fn wikilink(inner: &str, embed: bool) -> Option<Link> {
    let (named, alias) = match inner.split_once('|') {
        // Everything after the first bar, so an alias may hold one itself.
        Some((named, alias)) => (named, Some(alias.trim()).filter(|one| !one.is_empty())),
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

/// A markdown link, when its target names a note rather than a page on the web.
fn note_link(label: &str, written: &str, embed: bool) -> Option<Link> {
    if !is_note_target(written) {
        return None;
    }

    let (target, heading, block) = split_target(&decode(written));
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

/// Whether a markdown target points inside the space rather than out at the web.
fn is_note_target(target: &str) -> bool {
    if target.starts_with("//") {
        return false;
    }

    let Some(colon) = target.find(':') else {
        return true;
    };

    // A scheme is letters, digits and a few marks, and starts with a letter.
    let scheme = &target[..colon];
    !scheme.starts_with(|one: char| one.is_ascii_alphabetic())
        || !scheme
            .chars()
            .all(|one| one.is_ascii_alphanumeric() || matches!(one, '+' | '.' | '-'))
}

/// A markdown target as the name it stands for: `My%20Note.md` links to
/// `My Note.md`, and the index has to recognise it as one.
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
        out.push(bytes[at]);
        at += 1;
    }

    // Not valid encoding means the characters are the name.
    String::from_utf8(out).unwrap_or_else(|_| target.to_string())
}

/// The byte a `%xx` at this position stands for, or nothing when what is there is
/// not one.
///
/// Read as bytes rather than as a slice of the note. A character wider than the
/// two bytes an escape is spelled in - `%€` in a link somebody wrote - puts the
/// second of them inside that character, and slicing a `str` between the bytes of
/// one character is a panic.
fn escape_at(bytes: &[u8], at: usize) -> Option<u8> {
    if bytes.get(at) != Some(&b'%') {
        return None;
    }

    let high = hex(*bytes.get(at.checked_add(1)?)?)?;
    let low = hex(*bytes.get(at.checked_add(2)?)?)?;
    Some((high << 4) | low)
}

/// One hexadecimal digit as its value, in either case. By hand rather than
/// through `from_str_radix`, which also takes a sign: `%+1` is not an escape.
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
        block_id_of, canvas_note, decode, front_matter_list, front_matter_value, heading_of,
        headings_in, links_in, without_code,
    };

    fn targets(body: &str) -> Vec<String> {
        links_in(body).into_iter().map(|one| one.target).collect()
    }

    /// A percent followed by a character wider than the two bytes an escape is
    /// spelled in. The two bytes after the percent are a slice of the note, and
    /// the second of them falls inside that character rather than after it.
    ///
    /// This is a note's own text, so it reaches here from a file: one written in
    /// Nib, one that arrived by sync, one somebody sent. The release build aborts
    /// on a panic, so the whole app went with the scan.
    #[test]
    fn a_percent_before_a_wide_character_is_text() {
        assert_eq!(decode("%€"), "%€");
        assert_eq!(decode("a%€b"), "a%€b");
        assert_eq!(decode("%😀 and more"), "%😀 and more");
        assert_eq!(targets("see [x](%€) now"), vec!["%€"]);

        // And the escapes that are escapes still are.
        assert_eq!(decode("My%20Note.md"), "My Note.md");
        assert_eq!(decode("100%"), "100%");
        assert_eq!(decode("%zz"), "%zz");
        assert_eq!(decode("%2f"), "/");
        assert_eq!(decode("%2F"), "/");
        // A sign is not a hexadecimal digit, whatever `from_str_radix` takes.
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
    fn a_code_span_that_never_closes_is_text() {
        assert_eq!(targets("` [[Note]]"), vec!["Note"]);
    }

    #[test]
    fn blanking_code_keeps_the_line_the_same_length() {
        let line = "a `b c` d";
        assert_eq!(without_code(line).chars().count(), line.chars().count());
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
        assert_eq!(heading_of("   # Three").as_deref(), Some("Three"));
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

    /// The front matter, which the scan reads the icon a row wears out of. Every
    /// case here has its twin in `packages/markdown/src/front-matter.test.ts`.
    fn icon(body: &str) -> Option<String> {
        front_matter_value(body, "icon")
    }

    #[test]
    fn reads_a_key_from_the_front_matter() {
        assert_eq!(
            icon("---\nicon: rocket\n---\n\n# Plan").as_deref(),
            Some("rocket")
        );
        assert_eq!(
            icon("---\ntitle: Plan\nicon: file-text\n---\n").as_deref(),
            Some("file-text")
        );
        assert_eq!(icon("---\nICON: rocket\n---\n").as_deref(), Some("rocket"));
    }

    #[test]
    fn takes_the_quotes_off_a_value() {
        assert_eq!(
            icon("---\nicon: \"rocket\"\n---\n").as_deref(),
            Some("rocket")
        );
        assert_eq!(
            icon("---\nicon: 'rocket'\n---\n").as_deref(),
            Some("rocket")
        );
    }

    #[test]
    fn reads_an_emoji_as_what_it_says() {
        assert_eq!(icon("---\nicon: 🚀\n---\n").as_deref(), Some("🚀"));
    }

    #[test]
    fn reads_nothing_where_there_is_nothing_to_read() {
        assert_eq!(icon("# Plan\n\nwords"), None);
        assert_eq!(icon("---\ntitle: Plan\n---\n"), None);
        assert_eq!(icon("---\nicon:\n---\n"), None);
        // A block that never closes is a note that opens with a rule.
        assert_eq!(icon("---\nicon: rocket\n\n# Plan"), None);
        // And a key below the block is the note's words rather than its metadata.
        assert_eq!(icon("---\ntitle: Plan\n---\n\nicon: rocket\n"), None);
    }

    #[test]
    fn a_key_indented_under_another_is_not_the_notes_own() {
        assert_eq!(icon("---\nexport:\n  icon: rocket\n---\n"), None);
    }

    /// The other names a note gives itself. Every case here has its twin in
    /// `packages/markdown/src/front-matter.test.ts`.
    fn aliases(body: &str) -> Vec<String> {
        front_matter_list(body, "aliases")
    }

    #[test]
    fn reads_a_list_written_on_the_key_s_own_line() {
        assert_eq!(
            aliases("---\naliases: [One, Two]\n---\n"),
            vec!["One".to_string(), "Two".to_string()]
        );
    }

    #[test]
    fn reads_a_list_written_under_the_key() {
        assert_eq!(
            aliases("---\naliases:\n  - One\n  - Two\n---\n"),
            vec!["One".to_string(), "Two".to_string()]
        );
        assert_eq!(
            aliases("---\naliases:\n- One\n---\n"),
            vec!["One".to_string()]
        );
    }

    #[test]
    fn reads_a_single_value_as_a_list_of_one() {
        assert_eq!(aliases("---\naliases: One\n---\n"), vec!["One".to_string()]);
    }

    #[test]
    fn takes_the_quotes_off_every_item() {
        assert_eq!(
            aliases("---\naliases: [\"One\", 'Two']\n---\n"),
            vec!["One".to_string(), "Two".to_string()]
        );
        assert_eq!(
            aliases("---\naliases:\n  - \"One two\"\n---\n"),
            vec!["One two".to_string()]
        );
    }

    #[test]
    fn stops_at_the_next_key_of_the_notes_own() {
        assert_eq!(
            aliases("---\naliases:\n  - One\ntitle: Not an alias\n---\n"),
            vec!["One".to_string()]
        );
    }

    #[test]
    fn reads_nothing_where_there_is_no_list() {
        assert!(aliases("Words.\n").is_empty());
        assert!(aliases("---\ntitle: A note\n---\n").is_empty());
        assert!(aliases("---\naliases:\n---\n").is_empty());
        assert!(aliases("---\naliases: []\n---\n").is_empty());
        assert!(aliases("---\nexport:\n  aliases: [One]\n---\n").is_empty());
    }

    /// A canvas keeps its icon under `nib`, since a JSON file has no front matter.
    /// Every case here has its twin in `apps/desktop/src/lib/scan-note.test.ts`.
    #[test]
    fn reads_the_icon_a_canvas_wears() {
        let read = canvas_note(
            "boards/Board.canvas".to_string(),
            r#"{"nodes":[],"edges":[],"nib":{"version":1,"icon":"rocket"}}"#,
        );

        assert_eq!(read.icon.as_deref(), Some("rocket"));
        assert_eq!(read.name, "Board.canvas");
        assert_eq!(read.path, "boards/Board.canvas");
    }

    #[test]
    fn a_canvas_that_says_nothing_wears_nothing() {
        let plain = canvas_note("Board.canvas".to_string(), r#"{"nodes":[],"edges":[]}"#);
        assert_eq!(plain.icon, None);

        let blank = canvas_note(
            "Board.canvas".to_string(),
            r#"{"nodes":[],"nib":{"icon":"   "}}"#,
        );
        assert_eq!(blank.icon, None);

        // A file that is not JSON at all is a canvas nobody has drawn on yet.
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
}
