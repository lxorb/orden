import { type Extension, Facet, StateEffect, StateField } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import type { LinkKind, Wikilink } from '@nib/markdown/links'

/** What the editor knows about the space around the open note, and what it does
 *  when a link is followed.
 *
 *  Both arrive through a facet the app fills in, the way an image path becomes a
 *  URL (see images.ts): the editor never reads a file, so it cannot know which
 *  notes exist or what should happen when one is opened. Everything below is the
 *  arithmetic on top of that - which note a name means, and where a link goes. */

/** One note in the space, as a link needs to see it. */
export interface NoteRef {
  /** Path relative to the space, `/`-separated: `folder/Note.md`. */
  path: string
  /** The name a link uses: the file's name without its extension. */
  name: string
  /** Every heading in the note, in the order they appear. */
  headings: readonly string[]
  /** Every block name in the note: the `^abc123` at the end of a paragraph. */
  blocks: readonly string[]
}

export interface NoteIndex {
  notes: readonly NoteRef[]
  /** The note this view is showing, so `[[#Heading]]` knows which note it means
   *  and a name that could mean two notes is read from where it was written.
   *  Relative to the space, like every path here. Null for a note with no home
   *  yet. */
  path: string | null
  /** The markdown of one note, by path. An embed and the hover preview draw
   *  their frame first and fill it in when this lands. */
  read: (path: string) => Promise<string | null>
}

const EMPTY: NoteIndex = { notes: [], path: null, read: () => Promise.resolve(null) }

export const noteIndex = Facet.define<NoteIndex, NoteIndex>({
  combine: (values) => values[0] ?? EMPTY,
})

/** The space changes while the editor is open: a note saved gains a heading, a
 *  note renamed answers to another name, and every link on screen has to be
 *  drawn again against the new answer.
 *
 *  Held in a field and replaced by an effect rather than swapped in a
 *  compartment, because reconfiguring an editor resets what the reconfiguration
 *  had nothing to do with: a note saved in the background while `[[` was being
 *  typed took the list of names away with it. An effect is an ordinary
 *  transaction and leaves everything else where it was. */
const setIndex = StateEffect.define<NoteIndex>()

const indexField = StateField.define<NoteIndex>({
  create: () => EMPTY,
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setIndex)) return effect.value
    }
    return value
  },
  provide: (field) => noteIndex.from(field),
})

export function noteIndexExtension(index: NoteIndex | undefined): Extension {
  return indexField.init(() => index ?? EMPTY)
}

/** Hands over a new index. Compared by identity where it matters, so the app
 *  should give a fresh object when something changed and the same one when
 *  nothing did. */
export function setNoteIndex(view: EditorView, index: NoteIndex) {
  view.dispatch({ effects: setIndex.of(index) })
}

/** Where a followed link goes. `path` is null when nothing in the space answers
 *  to the name, which is the app's cue to make the note and open that. */
export interface NoteJump {
  path: string | null
  /** What the link said, so a note that does not exist yet can be named. */
  target: string
  heading: string | null
  block: string | null
}

/** Follows a link. The app opens the note, scrolls to the heading or the block,
 *  or makes the note when there is none; on its own the editor does nothing,
 *  since none of that is the editor's to do. */
export const noteOpener = Facet.define<(jump: NoteJump) => void, (jump: NoteJump) => void>({
  combine: (values) => values[0] ?? (() => undefined),
})

const MARKDOWN = /\.(md|markdown|mdown|mkd)$/i

/** A path as something to compare: `/` separators, no markdown extension, and
 *  folded case. Obsidian matches a link to a note by name whatever the case,
 *  and so do the two filesystems Nib runs on. */
function comparable(path: string): string {
  return path.replace(/\\/g, '/').replace(MARKDOWN, '').toLowerCase()
}

function folderOf(path: string): string {
  const at = path.replace(/\\/g, '/').lastIndexOf('/')
  return at === -1 ? '' : path.slice(0, at)
}

/** Which of several notes a link means: the one beside the note the link was
 *  written in, then the shallowest, then the first by path.
 *
 *  Obsidian picks by nearness in the same way, and a path-qualified
 *  `[[folder/Note]]` is how an author says which one they meant. The order only
 *  has to be the same every time; nothing here guesses at intent. */
function nearest(candidates: readonly NoteRef[], from: string | null): NoteRef | null {
  const here = from === null ? null : folderOf(from)
  const depth = (path: string) => path.split('/').length
  const beside = (note: NoteRef) => (folderOf(note.path) === here ? 0 : 1)

  return (
    [...candidates].sort(
      (one, other) =>
        beside(one) - beside(other) ||
        depth(one.path) - depth(other.path) ||
        (one.path < other.path ? -1 : 1),
    )[0] ?? null
  )
}

/** The note a wikilink target names, or null when the space holds none.
 *
 *  A name matches the end of a path, which is what makes `[[Note]]` find
 *  `ideas/Note.md` and `[[ideas/Note]]` find only that one. Every match is
 *  gathered before one is chosen, rather than settling for the first reading that
 *  answers: a space with `Plan.md` and `ideas/Plan.md` in it has two answers to
 *  `[[Plan]]`, and which is meant depends on where it was written - see
 *  `nearest`. */
export function resolveNote(index: NoteIndex, target: string): NoteRef | null {
  const wanted = comparable(target.trim())
  if (!wanted) return null

  const found = index.notes.filter((note) => {
    const path = comparable(note.path)
    return path === wanted || path.endsWith(`/${wanted}`)
  })

  return found.length ? nearest(found, index.path) : null
}

/** The note a relative markdown target names: `../ideas/Plan.md` beside the note
 *  it was written in. Folded rather than resolved on disk, since the index is
 *  the only map the editor has. */
export function resolveRelative(index: NoteIndex, target: string): NoteRef | null {
  const parts = index.path === null ? [] : folderOf(index.path).split('/').filter(Boolean)

  for (const part of target.replace(/\\/g, '/').split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') parts.pop()
    else parts.push(part)
  }

  return parts.length ? resolveNote(index, parts.join('/')) : null
}

/** The note one link points at. A wikilink names a note; a markdown link names
 *  a path beside the note it was written in. Null for both when the space holds
 *  nothing by that name, and for a link into the note it was written in, which
 *  has no name to look up. */
export function resolveLink(index: NoteIndex, link: Wikilink, kind: LinkKind): NoteRef | null {
  if (!link.target) return null
  return kind === 'markdown' ? resolveRelative(index, link.target) : resolveNote(index, link.target)
}

/** Whether a link points at something the space actually holds. A link into the
 *  note it was written in always does; an unresolved one is drawn muted, and
 *  following it makes the note. */
export function resolves(index: NoteIndex, link: Wikilink, kind: LinkKind): boolean {
  return !link.target || resolveLink(index, link, kind) !== null
}

/** Where following a link would go. */
export function jumpFor(index: NoteIndex, link: Wikilink, kind: LinkKind): NoteJump {
  return {
    // An empty target means the note the link is written in.
    path: link.target ? (resolveLink(index, link, kind)?.path ?? null) : index.path,
    target: link.target,
    heading: link.heading,
    block: link.block,
  }
}
