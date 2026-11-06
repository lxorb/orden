import { syntaxTree } from '@codemirror/language'
import { EditorSelection, EditorState } from '@codemirror/state'
import type { SyntaxNode, Tree } from '@lezer/common'
import { concealable } from './conceal'
import { revealed } from './reveal'

const BLOCK_PARENTS = new Set(['FrontMatter', 'FootnoteDef', 'DefinitionDetail', 'AbbrevDef'])

function inlineMark(node: SyntaxNode): boolean {
  const parent = node.parent?.name ?? ''
  if (BLOCK_PARENTS.has(parent)) return false
  if (concealable(node)) return true
  return node.name === 'CodeMark' && parent === 'InlineCode'
}

function concealed(state: EditorState, node: SyntaxNode): boolean {
  return inlineMark(node) && !revealed(state, node)
}

function blank(state: EditorState, from: number, to: number): boolean {
  return from >= to || /^\s*$/.test(state.doc.sliceString(from, to))
}

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
  const before = tree.resolveInner(pos, -1)
  const opening = before.parent
  if (opening && before.to === pos && concealed(state, before)) {
    if (pos < opening.to && runEnd(state, before, false) === opening.from) return opening.from
  }

  const after = tree.resolveInner(pos, 1)
  const closing = after.parent
  if (closing && after.from === pos && concealed(state, after)) {
    if (pos > closing.from && runEnd(state, after, true) === closing.to) return closing.to
  }

  return pos
}

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
  if (selection.ranges.some((range) => !range.empty)) return transaction

  const state = transaction.startState
  const ranges = selection.ranges.map((range) => {
    const pos = snapOutward(state, range.head)
    if (pos === range.head) return range
    return EditorSelection.cursor(pos, pos > range.head ? -1 : 1)
  })

  if (ranges.every((range, index) => range === selection.ranges[index])) return transaction
  return [transaction, { selection: EditorSelection.create(ranges, selection.mainIndex) }]
})
