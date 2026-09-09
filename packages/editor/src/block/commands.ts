/** What can be done to a block, as three things a menu row can call.
 *
 *  The menu itself is the app's, because every other row in it is: these are the
 *  editor's half, which is knowing which block a press landed in and changing the
 *  text. Each takes a document position rather than a block, so the caller never
 *  has to hold one across an edit.
 *
 *  All three work on the whole selection when there is one, so a selection lying
 *  across four paragraphs duplicates or deletes all four. A selection in nib is a
 *  selection of text and never a mode; the blocks it touches are simply the
 *  blocks it touches, and this is where that is read off. */

import type { ChangeSpec } from '@codemirror/state'
import type { EditorView } from '@codemirror/view'
import { blockIdOf, freeBlockId, blockIds } from '@nib/markdown/links'
import { copyBlock, cutBlock } from './move'
import { blockAt, blocksIn, type BlockSpan } from './span'

/** The blocks a press acted on: everything the selection covers when it covers
 *  more than the block that was pressed, and that one block otherwise. */
export function blocksFor(view: EditorView, pos: number): BlockSpan[] {
  const range = view.state.selection.main
  const pressed = blockAt(view.state, pos)

  if (range.empty || pos < range.from || pos > range.to) return pressed ? [pressed] : []

  const covered = blocksIn(view.state, range.from, range.to).filter(
    (span) => span.to >= range.from && span.from <= range.to,
  )

  return covered.length ? covered : pressed ? [pressed] : []
}

/** Every one of them again, under itself. */
export function duplicateBlocks(view: EditorView, pos: number): boolean {
  const spans = blocksFor(view, pos)
  if (!spans.length) return false

  // Bottom up, so a copy made below one block does not move the block above it
  // out from under its own offsets.
  const changes: ChangeSpec[] = []
  let caret: number | null = null

  for (const span of [...spans].reverse()) {
    const edit = copyBlock(view.state, span)
    changes.push(...edit.changes)
    caret ??= edit.caret
  }

  view.dispatch({
    changes,
    ...(caret === null ? {} : { selection: { anchor: caret } }),
    scrollIntoView: true,
  })
  view.focus()
  return true
}

/** Every one of them, gone. */
export function deleteBlocks(view: EditorView, pos: number): boolean {
  const spans = blocksFor(view, pos)
  if (!spans.length) return false

  const changes = [...spans].reverse().flatMap((span) => cutBlock(view.state, span).changes)

  view.dispatch({
    changes,
    selection: { anchor: Math.min(spans[0]?.from ?? 0, view.state.doc.length) },
    scrollIntoView: true,
  })
  view.focus()
  return true
}

/** What a link into this note would point at: `#A heading` for a heading, since
 *  that is what a heading is already called, and `#^name` for anything else.
 *
 *  A block that has no name is given one, which is a change to the note: the name
 *  is a marker Obsidian reads the same way, it is written at the end of the block
 *  where Obsidian writes it, and nothing shows it - see withoutBlockIds in
 *  @nib/markdown. Null when there is no block to point at. */
export function blockTarget(view: EditorView, pos: number): string | null {
  const span = blockAt(view.state, pos)
  if (!span) return null

  const doc = view.state.doc
  const first = doc.lineAt(span.from)

  if (span.kind === 'heading') {
    const words = first.text.replace(/^\s*#{1,6}\s*/, '').trim()
    return words ? `#${words}` : null
  }

  // The end of the block is where a name goes, which is where Obsidian looks for
  // one. A fence's name goes after its closing marks, not inside the code.
  const last = doc.lineAt(span.to)
  const already = blockIdOf(last.text)
  if (already) return `#^${already}`

  const taken = new Set(blockIds(doc.toString()).map((one) => one.id))
  const id = freeBlockId(taken)
  const end = last.from + last.text.trimEnd().length

  view.dispatch({ changes: { from: end, to: end, insert: ` ^${id}` } })
  return `#^${id}`
}
