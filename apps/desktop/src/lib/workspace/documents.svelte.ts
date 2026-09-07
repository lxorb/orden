/** What is open, and who is looking at it.
 *
 *  Two things, deliberately apart. A document is a note that is open: its words,
 *  its name, whether it has anything unsaved, and the live text every view of it
 *  shares (see shared.ts in the editor package). A tab is one pane's view of a
 *  document: which pane it is in, where the caret is, how far it is scrolled.
 *
 *  That is what makes the same note in two panes one note. There is one document
 *  and two tabs: typing in either reaches the same words, the dirty mark is one
 *  mark and saving saves once, while each tab keeps its own caret and its own
 *  place in the note. Nothing has to be kept in step, because there is nothing
 *  to keep in step. */

import { SharedDoc } from '@nib/editor'
import { identifier } from '../identifier'

/** What a tab holds. Almost always a note; the graph of the space is the one
 *  surface that is a tab without holding one, because a picture of the notes
 *  belongs beside them rather than in a panel. */
export type TabKind = 'note' | 'graph'

export interface DocumentStart {
  kind: TabKind
  path: string | null
  name: string
  text: string
  dirty: boolean
}

export class NoteDoc {
  /** This document within this run of the app. What the session writes down to
   *  say that two panes were showing the same note, so a restart puts them back
   *  on one document rather than on two copies of it. */
  readonly key = identifier()
  readonly kind: TabKind

  path = $state<string | null>(null)
  name = $state('')
  dirty = $state(false)

  /** The live text and the undo history, shared by every view of this note. */
  readonly live: SharedDoc

  /** The words as a string, which is what the app reads: saving, the session,
   *  the outline, an export. A copy of `live`, allowed to lag behind by one
   *  pause in the typing, because turning half a megabyte of rope into a string
   *  costs the same however small the keystroke was. `flush` brings it forward,
   *  and everything that reads the text goes through it first. */
  private words = $state('')
  private behind = false

  /** How many times the words have changed, whoever changed them: a keystroke in
   *  any pane, an undo, a note a sync brought over. What a reader that is not an
   *  editor watches - the reading view - because `words` itself only catches up
   *  when something asks for it, and a pane that is only reading never does. */
  revision = $state(0)
  /** True while text is being put in that leaves the note in step with its file,
   *  which is nothing the app has to be told about; see `replace`. */
  private quiet = false

  /** `edited` hears about every change to the words, wherever it came from: a
   *  keystroke in any pane, an undo, a picture dropped in. */
  constructor(start: DocumentStart, edited: (doc: NoteDoc) => void) {
    this.kind = start.kind
    this.path = start.path
    this.name = start.name
    this.dirty = start.dirty
    this.words = start.text
    this.live = new SharedDoc(start.text)

    this.live.onChange = () => {
      this.behind = true
      this.revision++
      if (this.quiet) return

      this.dirty = true
      edited(this)
    }
  }

  get text(): string {
    return this.words
  }

  /** Brings the words up to what the views hold. Costs one pass over the note,
   *  and nothing at all when there is nothing waiting. */
  flush() {
    if (!this.behind) return

    this.behind = false
    const text = this.live.text.toString()
    if (this.words !== text) this.words = text
  }

  /** Text put into the note from somewhere other than the editor: a version
   *  restored, a note a sync brought over, a rename that rewrote the title. It
   *  reaches every pane showing this note.
   *
   *  `dirty` says whether this leaves the note out of step with its file. A
   *  version restored does and has to be saved; a note re-read from disk does
   *  not, and text that matches the file is nothing to tell the app about. */
  replace(text: string, dirty = true) {
    this.quiet = !dirty
    this.live.replace(text)
    this.quiet = false

    this.words = text
    this.behind = false
    this.dirty = dirty
  }

  /** Words changed under the note by something other than an editor, as the
   *  ranges that changed: a replacement across the space, and putting one
   *  back. The file is written in the same breath, so this leaves the note
   *  clean, and every pane showing it keeps its caret. */
  edited(changes: readonly { from: number; to: number; insert: string }[], text: string) {
    this.quiet = true
    this.live.edit(changes)
    this.quiet = false

    this.words = text
    this.behind = false
    this.dirty = false
  }

  /** The one tab that previews a note, moving on to another one.
   *
   *  The document takes the new note on rather than being swapped for another,
   *  because a preview is never open in a second pane: nothing else is looking
   *  at these words, and the view stays where it is with the new text in it. */
  adopt(note: { path: string; name: string; text: string }) {
    this.path = note.path
    this.name = note.name
    this.arrivals++
    this.replace(note.text, false)
  }

  /** How many notes this document has held. Only the preview ever takes a second
   *  one on, and a pane that keeps an editor state per open note has to be able
   *  to tell "the same note, renamed" from "another note in the same tab": the
   *  first keeps its caret and its place, the second brings its own. */
  arrivals = $state(0)

  written(path: string, name: string) {
    this.path = path
    this.name = name
    this.dirty = false
  }
}

export class Tab {
  readonly id = identifier()

  /** The document this tab is a view of. */
  readonly note: NoteDoc

  /** Which pane the tab sits in. The pane holds no list of its own: the strip
   *  is the tabs that say they are in it, in the order they were opened. */
  paneId = $state('')

  /** Offset of the caret, pixels scrolled, and the position of the line at the
   *  top, so a note reopens where it was left rather than at the top. The line
   *  is what is put back; the pixels serve sessions from older builds. */
  cursor = $state<number | undefined>(undefined)
  scroll = $state<number | undefined>(undefined)
  anchor = $state<number | undefined>(undefined)
  /** Which line the caret is on. The editor knows it without counting, and the
   *  outline would otherwise walk the note's newlines to work it out again. */
  line = $state<number | undefined>(undefined)

  /** Whether this tab is showing the note as it reads rather than as it is
   *  written. Per tab, because a note can be read in one pane while it is being
   *  written in another, and because which face is up is about this sitting with
   *  this note - a note always opens for writing. */
  reading = $state(false)

  constructor(note: NoteDoc, paneId: string) {
    this.note = note
    this.paneId = paneId
  }

  get kind(): TabKind {
    return this.note.kind
  }

  get path(): string | null {
    return this.note.path
  }

  set path(to: string | null) {
    this.note.path = to
  }

  get name(): string {
    return this.note.name
  }

  set name(to: string) {
    this.note.name = to
  }

  /** The words, as far as the last flush. See NoteDoc above. */
  get doc(): string {
    return this.note.text
  }

  get dirty(): boolean {
    return this.note.dirty
  }

  set dirty(to: boolean) {
    this.note.dirty = to
  }
}
