import { syntaxTree } from '@codemirror/language'
import {
  Annotation,
  type ChangeSpec,
  EditorSelection,
  findClusterBreak,
  EditorState,
  type Line,
  Prec,
  type SelectionRange,
  Transaction,
} from '@codemirror/state'
import { deleteCharBackward, deleteCharForward, deleteGroupBackward, deleteGroupForward } from '@codemirror/commands'
import { deleteMarkupBackward } from '@codemirror/lang-markdown'
import type { SyntaxNode } from '@lezer/common'
import { Direction, EditorView } from '@codemirror/view'
import { isExternal } from '../external'
import { type BindingSpec, boundKeymap } from '../shortcuts'
import { readHighlight } from '@orden/markdown/highlights'
import { quietMarks } from './reveal'

export const landInWords = Annotation.define<boolean>()
const QUOTE = /^(?:[ \t]*>[ \t]?)*/
const ITEM = /^[ \t]*(?:([-*+])|\d+[.)])[ \t]+(\[[ xX]\][ \t]+)?/
const HEADING = /^#{1,6}[ \t]+/
interface Run {
  from: number
  to: number
}
function markAt(state: EditorState, pos: number, name: string): boolean {
  return syntaxTree(state).resolveInner(pos, 1).name === name
}
function hiddenRun(state: EditorState, line: Line): Run | null {
  const quiet = state.facet(quietMarks)
  const quote = QUOTE.exec(line.text)?.[0] ?? ''
  const first = line.from + (line.text.length - line.text.trimStart().length)
  let start: number | null = quote && quiet && markAt(state, first, 'QuoteMark') ? 0 : null
  let at = quote.length
  const rest = line.text.slice(at)
  const item = ITEM.exec(rest)
  const heading = HEADING.exec(rest)
  if (item) {
    const mark = line.from + at + (rest.length - rest.trimStart().length)
    if ((item[1] || item[2]) && markAt(state, mark, 'ListMark')) {
      start ??= at
      at += item[0].length
    }
  } else if (heading && quiet && markAt(state, line.from + at, 'HeaderMark')) {
    start ??= at
    at += heading[0].length
  }
  if (start === null || at <= start) return null
  return { from: line.from + start, to: line.from + at }
}
function kept(before: EditorState, after: EditorState, range: SelectionRange, at: number) {
  const line = after.doc.lineAt(range.head)
  const run = hiddenRun(after, line)
  if (!run || range.head >= run.to || range.head < run.from) return range
  const was = (before.selection.ranges[at] ?? before.selection.main).head
  const sameLine = was >= line.from && was <= line.to
  if (!range.empty) {
    return sameLine && was > run.to ? EditorSelection.range(range.anchor, run.to) : range
  }
  return EditorSelection.cursor(run.to)
}
function backOutOfWords(view: EditorView, toward: Direction): boolean {
  const { state } = view
  const main = state.selection.main
  if (state.selection.ranges.length > 1 || !main.empty) return false
  if (view.textDirectionAt(main.head) !== toward) return false
  const line = state.doc.lineAt(main.head)
  const run = hiddenRun(state, line)
  if (run?.to !== main.head || line.number < 2) return false
  view.dispatch({
    selection: EditorSelection.cursor(line.from - 1),
    scrollIntoView: true,
    userEvent: 'select',
  })
  return true
}
function placed(transaction: Transaction): boolean {
  if (transaction.annotation(Transaction.userEvent) !== undefined || isExternal(transaction)) {
    return false
  }
  if (!transaction.effects.length) return false
  return transaction.newSelection.ranges.every((range) => range.empty)
}
function pushHeadingDown(view: EditorView): boolean {
  const { state } = view
  const main = state.selection.main
  if (state.selection.ranges.length > 1 || !main.empty) return false
  const line = state.doc.lineAt(main.head)
  if (!HEADING.test(line.text.replace(QUOTE, ''))) return false
  const run = hiddenRun(state, line)
  if (run?.to !== main.head || !state.sliceDoc(main.head, line.to).trim()) return false
  const quote = QUOTE.exec(line.text)?.[0] ?? ''
  view.dispatch({
    changes: { from: line.from, insert: `${quote.trimEnd()}\n` },
    selection: EditorSelection.cursor(main.head + quote.trimEnd().length + 1),
    scrollIntoView: true,
    userEvent: 'input',
  })
  return true
}
const snapped = EditorState.transactionFilter.of((transaction) => {
  const asked = transaction.annotation(landInWords) === true
  if (!asked && (transaction.docChanged || !transaction.selection)) return transaction
  if (!asked && !transaction.isUserEvent('select') && !placed(transaction)) return transaction
  const { startState, newSelection } = transaction
  const ranges = newSelection.ranges.map((range, at) => kept(startState, transaction.state, range, at))
  if (ranges.every((range, at) => range === newSelection.ranges[at])) return transaction
  return [
    transaction,
    {
      selection: EditorSelection.create(ranges, newSelection.mainIndex),
      sequential: true,
    },
  ]
})
const INLINE_MARKS = new Set(['EmphasisMark', 'StrikethroughMark', 'SubscriptMark', 'SuperscriptMark', 'HighlightMark'])
function hiddenMarkAt(state: EditorState, pos: number, side: -1 | 1): Run | null {
  const node = syntaxTree(state).resolveInner(pos, side)
  const inline = INLINE_MARKS.has(node.name) || (node.name === 'CodeMark' && node.parent?.name === 'InlineCode')
  if (!inline || (side < 0 ? node.to : node.from) !== pos) return null
  return { from: node.from, to: node.to }
}
function pastMarks(state: EditorState, pos: number, side: -1 | 1): number {
  let at = pos
  for (let mark = hiddenMarkAt(state, at, side); mark; mark = hiddenMarkAt(state, at, side)) {
    at = side < 0 ? mark.from : mark.to
  }
  return at
}
function itemWordsAt(line: Line): number | null {
  const quote = QUOTE.exec(line.text)?.[0] ?? ''
  const item = ITEM.exec(line.text.slice(quote.length))
  return item ? line.from + quote.length + item[0].length : null
}
function soleLetterOfRun(state: EditorState, from: number, to: number): boolean {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(from, 1); node; node = node.parent) {
    const inner = innerOf(node)
    if (inner?.from === from && inner.to === to) return true
  }
  return false
}
function besideMarks(view: EditorView, near: number, side: -1 | 1): boolean {
  view.dispatch({ selection: EditorSelection.cursor(near) })
  if (side > 0) return deleteCharForward(view)
  return deleteMarkupBackward(view) || deleteCharBackward(view)
}
function deleteBesideMarks(side: -1 | 1) {
  return (view: EditorView): boolean => {
    const { state } = view
    const main = state.selection.main
    if (!state.facet(quietMarks) || state.readOnly) return false
    if (state.selection.ranges.length > 1 || !main.empty) return false
    const head = main.head
    const near = pastMarks(state, head, side)
    const line = state.doc.lineAt(near)
    const edge = side < 0 ? [line.from, hiddenRun(state, line)?.to, itemWordsAt(line)] : [line.to]
    if (edge.includes(near)) return near !== head && besideMarks(view, near, side)
    const far = line.from + findClusterBreak(line.text, near - line.from, side > 0)
    const beyond = pastMarks(state, far, side)
    const whole = near === head ? pastMarks(state, head, side < 0 ? 1 : -1) : head
    const alone = beyond !== far && whole !== near && soleLetterOfRun(state, Math.min(far, near), Math.max(far, near))
    if (!alone && near === head) return false
    const [from, to] = alone ? (side < 0 ? [beyond, whole] : [whole, beyond]) : side < 0 ? [far, near] : [near, far]
    view.dispatch({
      changes: { from, to },
      scrollIntoView: true,
      userEvent: side < 0 ? 'delete.backward' : 'delete.forward',
    })
    return true
  }
}
const INLINE_RUNS = new Set([
  'Emphasis',
  'StrongEmphasis',
  'Strikethrough',
  'Highlight',
  'Subscript',
  'Superscript',
  'InlineCode',
  'InlineMath',
  'Link',
  'Image',
  'Wikilink',
  'Autolink',
  'FootnoteRef',
])
const TAG = /^<(\/?)([A-Za-z][\w-]*)/
function tagPair(state: EditorState, node: SyntaxNode, side: -1 | 1): MarkedRun | null {
  const [, closing, name] = TAG.exec(state.sliceDoc(node.from, node.to)) ?? []
  if (!name || side < 0 !== (closing === '/')) return null
  for (let other = side < 0 ? node.prevSibling : node.nextSibling; other;) {
    const [, otherClosing, otherName] = TAG.exec(state.sliceDoc(other.from, other.to)) ?? []
    if (other.name === 'HTMLTag' && otherName === name && (otherClosing === '/') !== side < 0) {
      return side < 0
        ? { from: other.from, to: node.to, inner: { from: other.to, to: node.from } }
        : { from: node.from, to: other.to, inner: { from: node.to, to: other.from } }
    }
    other = side < 0 ? other.prevSibling : other.nextSibling
  }
  return null
}
function atHiddenEdge(view: EditorView, pos: number, side: -1 | 1): boolean {
  let found = false
  for (const ranges of view.state.facet(EditorView.atomicRanges)) {
    ranges(view).between(pos, pos, (from, to) => {
      if (from < to && (side < 0 ? to : from) === pos) found = true
    })
  }
  return found
}
interface MarkedRun extends Run {
  inner: Run | null
}
const WORDY_RUNS = new Set(['Emphasis', 'StrongEmphasis', 'Strikethrough', 'Highlight', 'Subscript', 'Superscript'])
function innerOf(node: SyntaxNode): Run | null {
  const open = node.firstChild
  const close = node.lastChild
  if (!open || !close || open === close || !open.name.endsWith('Mark')) return null
  return { from: open.to, to: close.from }
}
function runAt(state: EditorState, pos: number, side: -1 | 1): MarkedRun | null {
  let run: MarkedRun | null = null
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, side); node; node = node.parent) {
    if ((side < 0 ? node.to : node.from) !== pos) break
    if (INLINE_RUNS.has(node.name)) {
      run = {
        from: node.from,
        to: node.to,
        inner: WORDY_RUNS.has(node.name) ? innerOf(node) : null,
      }
    } else if (node.name === 'HTMLTag') {
      run = tagPair(state, node, side) ?? run
    }
  }
  return run
}
const SPACE = /\s/
function wordsStart(state: EditorState, run: MarkedRun, inner: Run): number {
  if (state.sliceDoc(run.from, run.from + 2) !== '==') return inner.from
  return inner.from + readHighlight(state.sliceDoc(inner.from, inner.to)).from
}
function childrenIn(state: EditorState, run: MarkedRun, inner: Run): Run[] {
  const found: Run[] = []
  syntaxTree(state).iterate({
    from: inner.from,
    to: inner.to,
    enter: (node) => {
      if (node.from <= run.from && node.to >= run.to) return true
      if (node.to > inner.from && node.from < inner.to) found.push({ from: node.from, to: node.to })
      return false
    },
  })
  return found
}
function wordIn(state: EditorState, run: MarkedRun, side: -1 | 1): ChangeSpec[] | null {
  const inner = run.inner
  if (!inner) return null
  const start = wordsStart(state, run, inner)
  const children = childrenIn(state, run, inner)
  const spaceAt = (pos: number) => SPACE.test(state.sliceDoc(pos, pos + 1))
  if (side < 0) {
    let unit = inner.to
    while (unit > start && !spaceAt(unit - 1)) {
      unit = children.find((child) => child.to === unit)?.from ?? unit - 1
    }
    let gap = unit
    while (gap > start && spaceAt(gap - 1) && !children.some((child) => child.to === gap)) gap--
    if (gap <= start || unit === inner.to) return null
    const broken = state.sliceDoc(gap, unit).includes('\n')
    return [{ from: gap, to: inner.to }, ...(broken ? [{ from: run.to, insert: '\n' }] : [])]
  }
  let unit = start
  while (unit < inner.to && !spaceAt(unit)) {
    unit = children.find((child) => child.from === unit)?.to ?? unit + 1
  }
  let gap = unit
  while (gap < inner.to && spaceAt(gap) && !children.some((child) => child.from === gap)) gap++
  if (gap >= inner.to || unit === start) return null
  const broken = state.sliceDoc(unit, gap).includes('\n')
  return [...(broken ? [{ from: run.from, insert: '\n' }] : []), { from: start, to: gap }]
}
const HELD_RUNS = new Set([...WORDY_RUNS, 'InlineCode'])
function runHolding(state: EditorState, pos: number): MarkedRun | null {
  for (let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos); node; node = node.parent) {
    if (!HELD_RUNS.has(node.name)) continue
    const inner = innerOf(node)
    if (inner && inner.from <= pos && pos <= inner.to) return { from: node.from, to: node.to, inner }
  }
  return null
}
function spacesFrom(state: EditorState, pos: number, side: -1 | 1, edge: number): number {
  let at = pos
  while (at !== edge && SPACE.test(side < 0 ? state.sliceDoc(at - 1, at) : state.sliceDoc(at, at + 1))) {
    at += side
  }
  return at
}
function deleteWordInsideRun(view: EditorView, side: -1 | 1): boolean {
  const { state } = view
  const head = state.selection.main.head
  const run = runHolding(state, head)
  const inner = run?.inner
  if (!run || !inner) return false
  const edge = side < 0 ? inner.from : inner.to
  if (head === edge) {
    view.dispatch({ selection: EditorSelection.cursor(side < 0 ? run.from : run.to) })
    return deleteWordOutside(view, side) || (side < 0 ? deleteGroupBackward(view) : deleteGroupForward(view))
  }
  const moved = view.moveByGroup(EditorSelection.cursor(head), side > 0).head
  const reach = side < 0 ? Math.max(moved, inner.from) : Math.min(moved, inner.to)
  const before = state.sliceDoc(inner.from, side < 0 ? reach : head)
  const after = state.sliceDoc(side < 0 ? head : reach, inner.to)
  let from = side < 0 ? reach : head
  let to = side < 0 ? head : reach
  if (!before.trim() && !after.trim()) {
    from = run.from
    to = run.to
  } else if (!before.trim()) {
    from = inner.from
    to = spacesFrom(state, to, 1, inner.to)
  } else if (!after.trim()) {
    from = spacesFrom(state, from, -1, inner.from)
    to = inner.to
  }
  view.dispatch({
    changes: { from, to },
    scrollIntoView: true,
    userEvent: side < 0 ? 'delete.group.backward' : 'delete.group.forward',
  })
  return true
}
function hiddenNear(view: EditorView, from: number, to: number, side: -1 | 1): number | null {
  let edge: number | null = null
  for (const ranges of view.state.facet(EditorView.atomicRanges)) {
    ranges(view).between(from, to, (start, end) => {
      if (start >= end || end <= from || start >= to) return
      const near = side < 0 ? end : start
      if (edge === null || (side < 0 ? near > edge : near < edge)) edge = near
    })
  }
  return edge
}
const MARKED_LEAD = /^(?:[ \t]*>)*[ \t]*(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/
function markedLead(text: string): number {
  return MARKED_LEAD.exec(text)?.[0].length ?? 0
}
function deleteWordOutside(view: EditorView, side: -1 | 1): boolean {
  const { state } = view
  const head = state.selection.main.head
  const line = state.doc.lineAt(head)
  let at = head
  while (at !== (side < 0 ? line.from : line.to)) {
    const next = side < 0 ? state.sliceDoc(at - 1, at) : state.sliceDoc(at, at + 1)
    if (!/[ \t]/.test(next)) break
    at += side
  }
  const run = atHiddenEdge(view, at, side) ? runAt(state, at, side) : null
  if (run) {
    const changes = wordIn(state, run, side) ?? [side < 0 ? { from: run.from, to: head } : { from: head, to: run.to }]
    view.dispatch({
      changes,
      scrollIntoView: true,
      userEvent: side < 0 ? 'delete.group.backward' : 'delete.group.forward',
    })
    return true
  }
  const target = view.moveByGroup(EditorSelection.cursor(head), side > 0).head
  const [from, to] = side < 0 ? [target, head] : [head, target]
  const stop = from < to ? hiddenNear(view, from, to, side) : null
  if (stop === null || stop === head || stop <= line.from + markedLead(line.text)) return false
  view.dispatch({
    changes: side < 0 ? { from: stop, to: head } : { from: head, to: stop },
    scrollIntoView: true,
    userEvent: side < 0 ? 'delete.group.backward' : 'delete.group.forward',
  })
  return true
}
function deleteWordOverMarks(side: -1 | 1) {
  return (view: EditorView): boolean => {
    const { state } = view
    const main = state.selection.main
    if (state.readOnly || state.selection.ranges.length > 1 || !main.empty) return false
    if (state.facet(quietMarks) && deleteWordInsideRun(view, side)) return true
    return deleteWordOutside(view, side)
  }
}
const leadKept = EditorState.transactionFilter.of((transaction) => {
  if (!transaction.isUserEvent('delete.backward') || !transaction.docChanged) return transaction
  const { startState } = transaction
  if (startState.selection.ranges.length > 1 || !startState.selection.main.empty) return transaction
  const head = startState.selection.main.head
  const line = startState.doc.lineAt(head)
  const lead = line.from + markedLead(line.text)
  if (lead === line.from || head <= lead) return transaction
  const ranges: number[][] = []
  transaction.changes.iterChangedRanges((from, to) => ranges.push([from, to]))
  const [only] = ranges
  if (ranges.length !== 1 || only?.[0] !== line.from || only[1] !== head) return transaction
  return {
    changes: { from: lead, to: head },
    selection: EditorSelection.cursor(lead),
    scrollIntoView: true,
    userEvent: 'delete.backward',
  }
})
export const itemStartBindings: BindingSpec[] = [
  { id: 'marks.heading-down', key: 'Enter', run: pushHeadingDown, contextual: true },
  { id: 'marks.backspace', key: 'Backspace', run: deleteBesideMarks(-1), contextual: true },
  { id: 'marks.delete', key: 'Delete', run: deleteBesideMarks(1), contextual: true },
  {
    id: 'marks.delete-word-behind',
    key: 'Mod-Backspace',
    mac: 'Alt-Backspace',
    run: deleteWordOverMarks(-1),
    contextual: true,
  },
  {
    id: 'marks.delete-word-ahead',
    key: 'Mod-Delete',
    mac: 'Alt-Delete',
    run: deleteWordOverMarks(1),
    contextual: true,
  },
  {
    id: 'marks.leave-left',
    key: 'ArrowLeft',
    run: (view) => backOutOfWords(view, Direction.LTR),
    contextual: true,
  },
  {
    id: 'marks.leave-right',
    key: 'ArrowRight',
    run: (view) => backOutOfWords(view, Direction.RTL),
    contextual: true,
  },
]
export const itemStart = [snapped, leadKept, Prec.high(boundKeymap(itemStartBindings))]
