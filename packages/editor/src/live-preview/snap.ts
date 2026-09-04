import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { SyntaxNode, Tree } from '@lezer/common'
import { INLINE_MARKS } from './decorate'
import { revealed } from './reveal'

/** Where a click lands next to concealed syntax.
 *
 *  Hidden marks have no width on screen, so a click at the right edge of the
 *  visible `code` maps to the document position just before its closing
 *  backtick - inside the span. The reveal then paints the backtick to the
 *  right of the caret, which reads as the caret having missed. Typora puts the
 *  caret outside: after the closing mark, before the opening one. This does
 *  the same for every inline construct whose marks vanish, and only for
 *  pointer selections - keyboard motion already steps over hidden syntax one
 *  atom at a time and needs no help.
 *
 *  Judged against the state before the click, because that is what was on
 *  screen: a mark that was already showing is a real character the click
 *  could aim at, and stays where it was clicked. */

/** Constructs whose marks open a whole line, like `#` does. Leaving the caret
 *  before them would put the next keystroke outside the block, so they keep
 *  the heading rule: the caret stays with the text. */
const BLOCK_PARENTS = new Set(['FrontMatter', 'FootnoteDef', 'DefinitionDetail', 'AbbrevDef'])

/** Marks that conceal themselves per construct (see decorate.ts). A fence's
 *  backticks sit on their own lines and never neighbour a click this way. */
function inlineMark(node: SyntaxNode): boolean {
  const parent = node.parent?.name ?? ''
  if (BLOCK_PARENTS.has(parent)) return false
  if (INLINE_MARKS.has(node.name)) return true
  return node.name === 'CodeMark' && parent === 'InlineCode'
}

function concealed(state: EditorState, node: SyntaxNode): boolean {
  return inlineMark(node) && !revealed(state, node)
}

function blank(state: EditorState, from: number, to: number): boolean {
  return from >= to || /^\s*$/.test(state.doc.sliceString(from, to))
}

/** The far end of the run of hidden siblings that starts with `mark`, walking
 *  `forward` or back. A link's target is several marks with a space before the
 *  title, so whitespace between two hidden siblings does not break the run. */
function runEnd(state: EditorState, mark: SyntaxNode, forward: boolean): number {
  let end = forward ? mark.to : mark.from
  for (
    let next = forward ? mark.nextSibling : mark.prevSibling;
    next && concealed(state, next);
    next = forward ? next.nextSibling : next.prevSibling
  ) {
    const gap = forward ? blank(state, end, next.from) : blank(state, next.to, end)
    if (!gap) break
    end = forward ? next.to : next.from
  }
  return end
}

function step(state: EditorState, tree: Tree, pos: number): number {
  // A hidden mark ending at the caret is the tail of an opening run.
  const before = tree.resolveInner(pos, -1)
  if (before.to === pos && concealed(state, before)) {
    const parent = before.parent!
    // Not when the caret is already at the construct's far edge: a construct
    // hidden wholesale (an image) has the caret outside on both sides.
    if (pos < parent.to && runEnd(state, before, false) === parent.from) return parent.from
  }

  // A hidden mark starting at the caret is the head of a closing run.
  const after = tree.resolveInner(pos, 1)
  if (after.from === pos && concealed(state, after)) {
    const parent = after.parent!
    if (pos > parent.from && runEnd(state, after, true) === parent.to) return parent.to
  }

  return pos
}

/** The position a pointer selection at `pos` should settle on. Nested
 *  constructs are left one at a time, so the edge of `code` inside bold ends
 *  up past the bold's closing marks as well. */
export function snapOutward(state: EditorState, pos: number): number {
  const tree = syntaxTree(state)
  for (;;) {
    const next = step(state, tree, pos)
    if (next === pos) return pos
    pos = next
  }
}

export const pointerSnap = EditorState.transactionFilter.of((transaction) => {
  const selection = transaction.selection
  if (!selection || transaction.docChanged || !transaction.isUserEvent('select.pointer')) {
    return transaction
  }
  // Only clicks. A dragged range keeps the text the pointer actually covered.
  if (selection.ranges.some((range) => !range.empty)) return transaction

  const state = transaction.startState
  let moved = false
  const ranges = selection.ranges.map((range) => {
    const pos = snapOutward(state, range.head)
    if (pos === range.head) return range
    moved = true
    // Lean towards the text the caret just crossed, so a wrapped line keeps
    // it on the same visual row as the click.
    return EditorSelection.cursor(pos, pos > range.head ? -1 : 1)
  })

  if (!moved) return transaction
  return [transaction, { selection: EditorSelection.create(ranges, selection.mainIndex) }]
})
