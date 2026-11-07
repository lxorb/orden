import { syntaxTree } from '@codemirror/language'
import { ChangeSet, EditorSelection, EditorState, type Text } from '@codemirror/state'
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

const WORD = /[\p{L}\p{N}]/u
const UNSPACED = /[\p{sc=Han}\p{sc=Hiragana}\p{sc=Katakana}]/u

function wordy(character: string): boolean {
  return WORD.test(character) && !UNSPACED.test(character)
}

function at(doc: Text, pos: number): string {
  return pos < 0 || pos >= doc.length ? '' : doc.sliceString(pos, pos + 1)
}

interface Drop {
  from: number
  to: number
  at: number
  text: string
}

function dropOf(state: EditorState, changes: ChangeSet): Drop | null {
  const parts: { fromA: number; toA: number; text: string }[] = []
  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    parts.push({ fromA, toA, text: inserted.toString() })
  })
  const insert = parts.filter((part) => part.fromA === part.toA && part.text)
  const remove = parts.filter((part) => part.fromA < part.toA && !part.text)
  if (insert.length !== 1 || remove.length > 1 || insert.length + remove.length !== parts.length) {
    return null
  }
  const [placed] = insert
  const [taken] = remove
  if (!placed || placed.fromA > state.doc.length) return null
  return { from: taken?.fromA ?? -1, to: taken?.toA ?? -1, at: placed.fromA, text: placed.text }
}

function lifted(doc: Text, from: number, to: number): [number, number] {
  if (from < 0) return [from, to]
  const text = doc.sliceString(from, to)
  if (!wordy(text.charAt(0)) || !wordy(text.charAt(text.length - 1))) return [from, to]
  const before = at(doc, from - 1)
  const after = at(doc, to)
  if (wordy(before) || wordy(after)) return [from, to]
  if (before === ' ' && (after === ' ' || after === '' || after === '\n' || /\p{P}/u.test(after))) {
    return [from - 1, to]
  }
  if ((before === '' || before === '\n') && after === ' ') {
    return [from, to + 1]
  }
  return [from, to]
}

export const dropSpacing = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.isUserEvent('move.drop') && !transaction.isUserEvent('input.drop')) {
    return transaction
  }
  const state = transaction.startState
  const drop = dropOf(state, transaction.changes)
  if (!drop) return transaction

  let snapped = snapOutward(state, drop.at)
  if (drop.from >= 0 && snapped > drop.from && snapped < drop.to) snapped = drop.at

  const [from, to] = lifted(state.doc, drop.from, drop.to)
  const taken = from < 0 ? ChangeSet.empty(state.doc.length) : state.changes({ from, to })
  const doc = taken.apply(state.doc)
  const low = taken.mapPos(Math.min(drop.at, snapped), -1)
  const high = taken.mapPos(Math.max(drop.at, snapped), 1)
  const place = taken.mapPos(snapped, snapped > drop.at ? 1 : -1)
  const before = at(doc, low - 1)
  const after = at(doc, high)
  const inside = wordy(before) && wordy(after) && low === high
  const lead = !inside && wordy(before) && wordy(drop.text.charAt(0)) ? ' ' : ''
  const trail = !inside && wordy(after) && wordy(drop.text.charAt(drop.text.length - 1)) ? ' ' : ''

  if (snapped === drop.at && from === drop.from && to === drop.to && !lead && !trail) {
    return transaction
  }

  const placed = ChangeSet.of([{ from: place, insert: lead + drop.text + trail }], doc.length)
  const changes = taken.compose(placed)
  const start = place + lead.length
  const end = start + drop.text.length
  const ranged = transaction.selection?.ranges.some((range) => !range.empty) ?? false
  return {
    changes,
    selection: ranged ? EditorSelection.range(start, end) : EditorSelection.cursor(end),
    userEvent: transaction.isUserEvent('move.drop') ? 'move.drop' : 'input.drop',
    effects: transaction.effects,
    scrollIntoView: transaction.scrollIntoView,
  }
})
