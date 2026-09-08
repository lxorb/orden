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
///
/// Cloneable because one search asks two questions of it: what the note says
/// exactly, and, when nothing answers that, what it says loosely with the bare
/// words taken out. See fuzzy.rs.
#[derive(Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Query {
    /// Every branch answers, which is what a space between two words means.
    All {
        /// The branches.
        of: Vec<Query>,
    },
    /// Any branch answers, which is what `OR` means.
    Any {
        /// The branches.
        of: Vec<Query>,
    },
    /// The branch does not answer, which is what a leading `-` means.
    Not {
        /// The branch that must not answer.
        of: Box<Query>,
    },
    /// Words in the note.
    Text {
        /// The word or the phrase, as it was typed.
        text: String,
        /// Whether case is folded.
        fold: bool,
    },
    /// A `/pattern/`.
    Regex {
        /// The pattern between the slashes.
        source: String,
        /// Whether the `i` flag was given.
        fold: bool,
    },
    /// Where the note is, relative to the space.
    Path {
        /// What the path has to hold.
        text: String,
        /// Whether case is folded.
        fold: bool,
    },
    /// The note's own name.
    File {
        /// What the name has to hold.
        text: String,
        /// Whether case is folded.
        fold: bool,
    },
    /// A tag. It stands for its children too, so `work` finds `work/2026`.
    Tag {
        /// The tag without its hash.
        tag: String,
    },
    /// Front matter: the key alone, or the key and something its value says.
    Property {
        /// The key, lowercased.
        name: String,
        /// What the value has to hold, or nothing to ask only for the key.
        value: Option<String>,
    },
    /// The branch, looked for inside one line, paragraph or section.
    Scope {
        /// How near the branch's terms have to be.
        unit: Unit,
        /// The branch, answered within one unit at a time.
        of: Box<Query>,
    },
}
