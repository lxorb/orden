/** Where the words go.
 *
 *  A recording writes into a note four times: the embed at the caret, a transcript
 *  arriving a piece at a time, a summary above that transcript, and the duration in
 *  the front matter. All four go through the editor that is showing the note rather
 *  than through the file on disk, for one reason: a change dispatched into the editor
 *  is one step of undo, every pane showing the note sees it at once, and the save that
 *  follows is the ordinary save. A file written underneath a note somebody has open is
 *  how two versions of a note come to exist.
 *
 *  Which means a note that is not open in any pane cannot be written into, and the
 *  caller holds what it has until it is. That is the recorder's business; here it is
 *  only ever answered honestly, as false. */

import type { EditorView } from '@nib/editor'
import { frontMatterEdit } from '@nib/markdown/front-matter'
import { views } from '../views.svelte'
import { workspace } from '../workspace.svelte'
import { recordingNoteName } from './transcript'

/** The editor showing a note, in whichever pane has it, or null when none does. */
export function viewFor(path: string): EditorView | null {
  for (const tab of workspace.tabs) {
    if (tab.note.path !== path) continue

    const view = views.of(tab.paneId)
    if (view) return view
  }

  return null
}

/** Writes at the caret, the way a picture chosen from the menu does, and leaves the
 *  caret after what was written so the next thing typed follows it. */
export function writeAtCaret(view: EditorView, text: string) {
  const range = view.state.selection.main

  view.dispatch({
    changes: { from: range.from, to: range.to, insert: text },
    selection: { anchor: range.from + text.length },
    scrollIntoView: true,
    userEvent: 'input',
  })
  view.focus()
}

/** Writes a whole note over what is there.
 *
 *  One use: a note just made to hold a meeting. The workspace writes every new note
 *  with its own name as a heading, and a meeting note is that plus its front matter
 *  and the heading its transcript arrives under; replacing it in the editor keeps the
 *  making and the shaping of it as one thing to undo. */
export function replaceAll(path: string, text: string): boolean {
  const view = viewFor(path)
  if (!view || view.state.readOnly) return false

  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
    selection: { anchor: text.length },
    userEvent: 'input.complete',
  })
  return true
}

/** Writes at the end of a note, and does not move the caret.
 *
 *  A live transcript arrives while its reader may be typing somewhere above it, and a
 *  write that took the caret with it would take the keyboard out of the sentence they
 *  are in. `scrollIntoView` is left off for the same reason. */
export function appendTo(path: string, text: string): boolean {
  const view = viewFor(path)
  if (!view || view.state.readOnly) return false

  const end = view.state.doc.length
  view.dispatch({ changes: { from: end, to: end, insert: text }, userEvent: 'input.complete' })
  return true
}

/** Writes just above the first line that reads exactly `marker`, or at the end when
 *  the note no longer holds such a line - which is what happens when somebody has been
 *  editing the note while it recorded, and is still better than not writing at all. */
export function insertAbove(path: string, marker: string, text: string): boolean {
  const view = viewFor(path)
  if (!view || view.state.readOnly) return false

  const doc = view.state.doc
  let at = doc.length

  for (let line = 1; line <= doc.lines; line++) {
    const one = doc.line(line)
    if (one.text.trim() === marker) {
      at = one.from
      break
    }
  }

  view.dispatch({ changes: { from: at, to: at, insert: text }, userEvent: 'input.complete' })
  return true
}

/** Sets one front matter key on a note: the duration, once there is one to write.
 *
 *  Through the package's own editor, which puts the key in the block that is there,
 *  opens one where there is none, and leaves every other key and every caret below it
 *  alone. */
export function setFrontMatter(path: string, field: string, value: string): boolean {
  const view = viewFor(path)
  if (!view || view.state.readOnly) return false

  const edit = frontMatterEdit(view.state.doc.toString(), field, value)
  // Null means the note already says that, which is nothing to write.
  if (!edit) return true

  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    userEvent: 'input.complete',
  })
  return true
}

/** The note a recording goes into: the one that is open, or a new one.
 *
 *  A recording is a thing somebody starts in a hurry, and "no note open" is not an
 *  answer to give them. A note that has never been saved has no path either, and a
 *  recording has to be written beside something - so that case makes a note too. */
export async function noteToRecordInto(): Promise<string | null> {
  const open = workspace.active
  if (open?.kind === 'note' && open.path) return open.path

  if (!workspace.activeSpace) return null

  await workspace.createNote(undefined, `${recordingNoteName(new Date())}.md`)
  return workspace.active?.path ?? null
}
