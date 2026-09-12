/** The note's words and the room's words, kept as one.
 *
 *  Both sides already know how to describe a change as the pieces that changed:
 *  CodeMirror as a change set, Yjs as a delta. So this is a translation and
 *  nothing more - what somebody typed here goes into the shared text as the
 *  insert or the delete it was, and what arrives from another device comes back
 *  the same way. Nothing anywhere turns the note into a string and compares it,
 *  which is what keeps a keystroke costing the keystroke rather than the note.
 *
 *  The one thing it has to get right is not echoing. A change put into the shared
 *  text carries a mark saying it came from here, and a change that arrives is
 *  applied to the note in the way the note does not report back. */

import type { ChangeSet, SharedDoc } from '@nib/editor'
import type { Replacement } from '@nib/rooms/fold'
import * as Y from 'yjs'
import { HERE } from './door'

/** A Yjs delta, as far as a note made of plain text is concerned. A rich text
 *  document would also carry attributes and embedded types; a note does not. */
interface Op {
  retain?: number
  insert?: unknown
  delete?: number
}

/** One delta as the replacements a change set is made of, in the positions the
 *  note held before any of them.
 *
 *  A retain and a delete walk along the old text; an insert does not. Which is
 *  why the two are folded into the entry before them whenever they meet at the
 *  same place: a replacement arrives as a delete and an insert, and two entries
 *  at one position are not something a change set will take. */
export function replacements(delta: readonly Op[]): Replacement[] {
  const edits: Replacement[] = []
  let at = 0

  for (const op of delta) {
    if (typeof op.retain === 'number') {
      at += op.retain
      continue
    }

    // The one before it, when the two meet at the same place and are therefore
    // halves of one replacement.
    const beside = edits.at(-1)?.to === at ? edits.at(-1) : undefined

    if (typeof op.delete === 'number') {
      if (beside) beside.to = at + op.delete
      else edits.push({ from: at, to: at + op.delete, insert: '' })

      at += op.delete
      continue
    }

    if (typeof op.insert !== 'string') continue

    if (beside) beside.insert += op.insert
    else edits.push({ from: at, to: at, insert: op.insert })
  }

  return edits
}

/** A change that was refused because the document has moved on to another file.
 *
 *  Said out loud rather than swallowed. Nothing is lost by refusing - the room
 *  about to be joined is the one these words belong to - but a binding still being
 *  asked after the document left it means something let go a beat too late, and
 *  that is worth seeing in a console rather than inferring from a note.
 *
 *  Exported for the canvas's binding, which refuses the same things for the same
 *  reason and should say so in the same words; see plane-bind.ts. */
export function moved(what: string) {
  console.warn(`nib: ${what} was refused - the document is on another note now`)
}

/** One replacement, made to the shared text. What folding a note written in while
 *  away into the room comes down to, and the piece a change set is made of. */
export function replace(text: Y.Text, change: Replacement) {
  if (change.to > change.from) text.delete(change.from, change.to - change.from)
  if (change.insert) text.insert(change.from, change.insert)
}

/** A change set as the same edits, made to the shared text.
 *
 *  Each is applied at the place it names plus however much the ones before it
 *  moved the text along, because the positions are all in terms of the note as it
 *  was before any of them. */
function apply(text: Y.Text, changes: ChangeSet) {
  let adjust = 0

  changes.iterChanges((fromA, toA, fromB, toB, inserted) => {
    replace(text, { from: fromA + adjust, to: toA + adjust, insert: inserted.toString() })
    adjust += toB - fromB - (toA - fromA)
  })
}

/** Joins a note to a room's text. Answers how to part them again.
 *
 *  `holds` is whether the document is still the file this binding was made for. A
 *  document outlives the file in it - the one tab that previews a note takes
 *  another note on rather than being swapped for another document - and the
 *  pairing of documents to rooms is worked out in an effect, which cannot be
 *  synchronous with the click that moves it. So for the beat between the two, this
 *  is the only thing that knows: a change either way is about a file that is no
 *  longer these words, and applying it would write one note over another. See
 *  room.ts, and `adopt` in workspace/documents.svelte.ts. */
export function bind(note: SharedDoc, text: Y.Text, holds: () => boolean): () => void {
  const doc = text.doc
  if (!doc) throw new Error('a shared text with no document behind it')

  note.onLocal = (changes: ChangeSet) => {
    if (!holds()) {
      moved('a change made in it')
      return
    }

    doc.transact(() => apply(text, changes), HERE)
  }

  const heard = (event: Y.YTextEvent, transaction: Y.Transaction) => {
    // Ours, on its way out. It is already in the note.
    if (transaction.origin === HERE) return
    if (!holds()) {
      moved('a change from another device')
      return
    }

    const edits = replacements(event.delta as readonly Op[])
    if (edits.length) note.arrived(edits)
  }

  text.observe(heard)

  return () => {
    text.unobserve(heard)
    note.onLocal = null
  }
}
