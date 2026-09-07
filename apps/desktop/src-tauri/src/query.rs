//! What the search field means, as a small tree.
//!
//! The field itself is parsed in the app rather than here, because the browser
//! build runs the same grammar over its own storage and one grammar cannot
//! live in two parsers. What crosses to this side is the tree that parse made,
//! which is why every shape below is nothing but serde: search/query.ts writes
//! exactly these, and matcher.rs walks them.

use serde::Deserialize;

/// How near two terms have to be for a `line:`, `block:` or `section:` group.
#[derive(Deserialize, Clone, Copy, PartialEq, Eq, Hash, Debug)]
#[serde(rename_all = "lowercase")]
pub enum Unit {
    /// Both on one line.
    Line,
    /// Both in one paragraph.
    Block,
    /// Both under one heading.
    Section,
}

/// One node of a parsed query. `fold` is case folded, which is the default
/// everywhere the reader has not said `case:`.
#[derive(Deserialize, Debug)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Query {
    /// Every branch answers, which is what a space between two words means.
    All { of: Vec<Query> },
    /// Any branch answers, which is what `OR` means.
    Any { of: Vec<Query> },
    /// The branch does not answer, which is what a leading `-` means.
    Not { of: Box<Query> },
    /// Words in the note.
    Text { text: String, fold: bool },
    /// A `/pattern/`, with the `i` flag folded into `fold`.
    Regex { source: String, fold: bool },
    /// Where the note is, relative to the space.
    Path { text: String, fold: bool },
    /// The note's own name.
    File { text: String, fold: bool },
    /// A tag without its hash. It stands for its children too.
    Tag { tag: String },
    /// Front matter: the key alone, or the key and something its value says.
    Property { name: String, value: Option<String> },
    /// The branch, looked for inside one line, paragraph or section.
    Scope { unit: Unit, of: Box<Query> },
}
