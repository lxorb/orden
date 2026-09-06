import type { Completion, CompletionContext, CompletionResult } from '@codemirror/autocomplete'
import { Facet } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { blocksOf } from '@nib/markdown/links'
import { type NoteIndex, noteIndex, type NoteRef, resolveNote } from './notes'

/** What `[[` offers: the notes in the space, then the headings and blocks inside
 *  the one that was chosen.
 *
 *  Three lists, decided by what has been typed between the brackets. Nothing
 *  before a `#` is a note; after a `#` it is a heading of that note; after a `#^`
 *  it is one of its blocks - and picking a block that has no name yet is what
 *  gives it one, which is the only thing here that writes to another note and so
 *  the only thing that goes back out through a facet. */

/** Gives a block of another note a name and returns it, so a link can point at
 *  the block rather than at the note. Supplied by the app, which owns the file;
 *  on its own the editor offers only the blocks that are already named. */
export const blockNamer = Facet.define<
  (path: string, line: number) => Promise<string | null>,
  (path: string, line: number) => Promise<string | null>
>({ combine: (values) => values[0] ?? (() => Promise.resolve(null)) })

/** How many of each kind the list shows. Long enough to reach any note by
 *  typing two or three letters, short enough that the popup is a list. */
const MOST_SHOWN = 40

/** Everything between `[[` and the caret, or null when the caret is not in a
 *  link. `]]` is not required: the link is being written. */
function typing(context: CompletionContext) {
  return context.matchBefore(/\[\[[^[\]\n]*/)
}

/** Puts the text in and finishes the link, so a chosen note needs no closing
 *  brackets typed after it. Whatever `]]` is already there is stepped over
 *  rather than doubled, which is what close-brackets leaves behind. */
function insert(text: string) {
  return (view: EditorView, _completion: Completion, from: number, to: number) => {
    const closed = view.state.doc.sliceString(to, to + 2) === ']]'
    const tail = closed ? '' : ']]'
    const at = from + text.length + tail.length + (closed ? 2 : 0)

    view.dispatch({
      changes: { from, to, insert: text + tail },
      selection: { anchor: at },
      userEvent: 'input.complete',
    })
  }
}

/** The name to write for a note: its own, unless the space holds another note by
 *  that name, in which case the path says which one is meant - the shortest form
 *  that is unambiguous, as Obsidian writes it. */
function nameFor(index: NoteIndex, note: NoteRef): string {
  const same = index.notes.filter((one) => one.name.toLowerCase() === note.name.toLowerCase())
  return same.length > 1 ? note.path.replace(/\.(md|markdown|mdown|mkd)$/i, '') : note.name
}

/** A folder to read at a glance, or nothing for a note at the top of the space. */
function folderOf(path: string): string | undefined {
  const at = path.lastIndexOf('/')
  return at === -1 ? undefined : path.slice(0, at)
}

function noteOptions(index: NoteIndex, typed: string): Completion[] {
  const needle = typed.trim().toLowerCase()

  return index.notes
    .filter((note) => !needle || matches(note, needle))
    .slice(0, MOST_SHOWN)
    .map((note) => {
      const folder = folderOf(note.path)
      return {
        label: note.name,
        ...(folder === undefined ? {} : { detail: folder }),
        apply: insert(nameFor(index, note)),
        type: 'text',
      }
    })
}

/** A note matches what has been typed when its name or its path contains it.
 *  Substring rather than fuzzy: the palette's fuzzy matching is for finding a
 *  note by a few letters, and a link is being written, not searched for. */
function matches(note: NoteRef, needle: string): boolean {
  return note.name.toLowerCase().includes(needle) || note.path.toLowerCase().includes(needle)
}

function headingOptions(note: NoteRef, typed: string): Completion[] {
  const needle = typed.trim().toLowerCase()

  return note.headings
    .filter((heading) => !needle || heading.toLowerCase().includes(needle))
    .slice(0, MOST_SHOWN)
    .map((heading) => ({ label: heading, apply: insert(heading), type: 'keyword' }))
}

/** The target note's blocks. Its text is read for this rather than kept in the
 *  index: a block has no name until one is picked, so there would be nothing to
 *  index, and one note is read at the moment somebody asks about it. */
async function blockOptions(index: NoteIndex, note: NoteRef, typed: string): Promise<Completion[]> {
  const source = await index.read(note.path)
  if (source === null) return []

  const needle = typed.trim().toLowerCase()

  return blocksOf(source)
    .filter((block) => block.text !== '')
    .filter((block) => !needle || block.text.toLowerCase().includes(needle))
    .slice(0, MOST_SHOWN)
    .map((block) => ({
      label: block.text,
      apply: block.id === null ? name(note.path, block.line) : insert(`^${block.id}`),
      type: 'property',
    }))
}

/** Picks a block that has nothing to link to yet: the app names it, and the name
 *  it gives back is what goes into the link. Nothing is written into this note
 *  until that lands, so a target that could not be written leaves no link
 *  pointing at a name nothing has. */
function name(path: string, line: number) {
  return (view: EditorView, completion: Completion, from: number, to: number) => {
    void view.state
      .facet(blockNamer)(path, line)
      .then((id) => {
        if (id) insert(`^${id}`)(view, completion, from, to)
      })
      // Nothing to say to the writer: the link is still there to be finished by
      // hand, which is what inserting nothing leaves them with.
      .catch(() => undefined)
  }
}

export function wikilinkCompletions(
  context: CompletionContext,
): CompletionResult | Promise<CompletionResult | null> | null {
  const typed = typing(context)
  if (!typed) return null

  const index = context.state.facet(noteIndex)
  const inner = typed.text.slice(2)
  const hash = inner.indexOf('#')

  if (hash === -1) {
    const options = noteOptions(index, inner)
    return options.length ? { from: typed.from + 2, options, validFor: /^[^[\]\n#|]*$/ } : null
  }

  const named = inner.slice(0, hash).trim()
  // No note before the `#` means the note being written in.
  const note = named
    ? resolveNote(index, named)
    : (index.notes.find((one) => one.path === index.path) ?? null)
  if (!note) return null

  const after = inner.slice(hash + 1)
  const from = typed.from + 2 + hash + 1

  if (!after.startsWith('^')) {
    const options = headingOptions(note, after)
    return options.length ? { from, options, validFor: /^[^[\]\n|^]*$/ } : null
  }

  return blockOptions(index, note, after.slice(1)).then((options) =>
    options.length ? { from, options, validFor: /^\^[^[\]\n|]*$/ } : null,
  )
}
