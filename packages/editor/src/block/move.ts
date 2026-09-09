/** Moving a block, copying one, and taking one out.
 *
 *  All three are the same two questions, so they are answered once: how much of
 *  the note the block is, and how much space it needs where it lands.
 *
 *  Both questions are about blank lines, because in markdown a blank line is what
 *  makes two paragraphs two paragraphs, and the lack of one is what makes two
 *  list items one list. A move that helpfully added a blank line would turn a
 *  list into a page of paragraphs; one that dropped it would run two paragraphs
 *  into each other. So a block is taken out with exactly the separation that
 *  would otherwise be left doubled, and put back with the separation the place it
 *  lands in needs.
 *
 *  Nothing here dispatches: what to do with the changes is the caller's, and this
 *  can be read without an editor in front of it. */

import type { ChangeSpec, EditorState } from '@codemirror/state'
import { blockAt, type BlockKind, type BlockSpan } from './span'

/** What a block's lines are, and how far to cut to take it out.
 *
 *  The cut is the lines and the break that ends them, plus the blank line after
 *  them when there is a blank line above as well - or nothing above, which the
 *  top of a note is. What is left then has one blank line between its neighbours
 *  rather than two, or none where there were none. */
function bodyOf(state: EditorState, span: BlockSpan): { to: number; text: string } {
  const doc = state.doc
  const first = doc.lineAt(span.from)
  const last = doc.lineAt(Math.min(span.to, doc.length))
  const text = doc.sliceString(span.from, last.to)

  const above = first.number === 1 || doc.line(first.number - 1).text.trim() === ''
  const below = last.number < doc.lines && doc.line(last.number + 1).text.trim() === ''
  const end = above && below ? doc.line(last.number + 1).to : last.to

  return { to: Math.min(end + 1, doc.length), text }
}

/** What goes between two blocks: nothing but a break when both are list items,
 *  since that is what keeps them one list, and a blank line otherwise. */
function gap(one: BlockKind, other: BlockKind): string {
  return one === 'list' && other === 'list' ? '\n' : '\n\n'
}

/** The breaks a note needs at its end before something is added after them, given
 *  how many it has already. */
function tail(state: EditorState, wanted: number): string {
  const doc = state.doc
  let has = 0
  while (has < wanted && doc.sliceString(doc.length - has - 1, doc.length - has) === '\n') has++

  return '\n'.repeat(Math.max(0, wanted - has))
}

/** What a change to a block leaves behind: the edits, and where the caret goes
 *  when it was in the block that moved. */
export interface BlockEdit {
  changes: ChangeSpec[]
  /** Null when the caret was nowhere near it, which leaves it to the change set
   *  to map on its own. */
  caret: number | null
}

/** Whether dropping a block at `at` would move it anywhere. */
function movesBlock(span: BlockSpan, at: number): boolean {
  return at < span.from || at > span.to
}

/** The block, cut from where it is and put in at `at` - the first character of
 *  the block it lands in front of, or the end of the note. */
export function moveBlock(
  state: EditorState,
  span: BlockSpan,
  at: number,
  caret = state.selection.main.head,
): BlockEdit | null {
  if (!movesBlock(span, at)) return null

  const doc = state.doc
  const { to, text } = bodyOf(state, span)
  // Inside its own separation is inside itself.
  if (at > span.from && at <= to) return null

  const ending = at >= doc.length
  const landing = ending ? blockAt(state, Math.max(doc.length - 1, 0)) : blockAt(state, at)
  const between = gap(span.kind, landing?.kind ?? 'paragraph')
  const insert = ending ? tail(state, between.length) + text : text + between

  const changes: ChangeSpec[] = [
    { from: span.from, to, insert: '' },
    { from: at, to: at, insert },
  ]

  // Where the words are once both edits have landed. Moving down, the cut is
  // above the landing and takes its own length out of the offset; moving up,
  // nothing before the landing has changed.
  const landed = at > span.from ? at - (to - span.from) : at
  const inside = caret >= span.from && caret <= to
  const before = ending ? insert.length - text.length : 0

  return { changes, caret: inside ? landed + before + (caret - span.from) : null }
}

/** The block again, right under itself. */
export function copyBlock(state: EditorState, span: BlockSpan): BlockEdit {
  const { to, text } = bodyOf(state, span)
  const between = gap(span.kind, span.kind)
  const ending = to >= state.doc.length
  const insert = ending ? tail(state, between.length) + text : text + between

  return {
    changes: [{ from: to, to, insert }],
    // In the copy rather than the original: a duplicate is made to be changed.
    caret: to + (ending ? insert.length - text.length : 0),
  }
}

/** The block, gone. */
export function cutBlock(state: EditorState, span: BlockSpan): BlockEdit {
  const { to } = bodyOf(state, span)
  return { changes: [{ from: span.from, to, insert: '' }], caret: span.from }
}
