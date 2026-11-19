import { syntaxTree } from '@codemirror/language'
import { calloutOf } from '@orden/markdown/callouts'
import type { ChangeSpec, EditorState, Line } from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { frontMatterSpan } from '../live-preview/front-matter'
import { enclosing } from '../nodes'
import { above, below, gap, indentOf, itemsAround, holderQuote, leadOf, type Side } from './separation'
import type { BlockSpan } from './span'
import { writtenLine } from './span'

interface Measured {
  first: Line
  last: Line
  up: Line | null
  down: Line | null
  nests: SyntaxNode[]
  holder: string
}
function measure(state: EditorState, span: BlockSpan): Measured {
  const doc = state.doc
  const first = doc.lineAt(span.from)
  const last = doc.lineAt(Math.min(span.to, doc.length))
  const nests = itemsAround(state, first.from + indentOf(first.text) + 1)
    .filter((item) => doc.lineAt(item.from).from < first.from && item.to >= last.to)
    .reverse()
  return {
    first,
    last,
    up: writtenLine(state, first.number - 1, -1),
    down: writtenLine(state, last.number + 1, 1),
    nests,
    holder: holderQuote(first.text, span.kind === 'quote'),
  }
}
function settled(state: EditorState, pos: number): number {
  const doc = state.doc
  if (pos >= doc.length) return doc.length
  const line = doc.lineAt(pos)
  const from = pos > line.from ? line.number + 1 : line.number
  return writtenLine(state, from, 1)?.from ?? doc.length
}
const OPEN = new Set(['Document', 'BulletList', 'OrderedList'])
function strangerAt(state: EditorState, block: Measured, at: number): SyntaxNode | null {
  let found: SyntaxNode | null = null
  for (const node of enclosing(syntaxTree(state).resolveInner(at, 1))) {
    const holds = node.from <= block.first.from && node.to >= block.last.to
    if (!OPEN.has(node.name) && !holds && state.doc.lineAt(node.from).from < at) found = node
  }
  return found
}
function opensCalloutAt(state: EditorState, block: Measured, at: number): boolean {
  const doc = state.doc
  const inside = block.first.from + leadOf(block.first.text)
  for (const node of enclosing(syntaxTree(state).resolveInner(inside, 1))) {
    if (node.name !== 'Blockquote' || node.from >= inside) continue
    const first = doc.lineAt(node.from)
    if (first.from !== at) continue
    const opened = first.text.indexOf('[!')
    if (opened >= 0 && calloutOf(first.text.slice(opened))) return true
  }
  return false
}
function landingOf(state: EditorState, span: BlockSpan, block: Measured, at: number): number | null {
  if (span.kind === 'front-matter') return null
  const doc = state.doc
  let to = settled(state, at)
  const front = frontMatterSpan(state)
  if (front && to <= front.end) to = settled(state, front.after)
  const stranger = to < doc.length ? strangerAt(state, block, to) : null
  if (stranger) {
    to = to < block.first.from ? doc.lineAt(stranger.from).from : settled(state, doc.lineAt(stranger.to).to + 1)
  }
  if (to < block.first.from && opensCalloutAt(state, block, to)) return null
  const end = block.down ? block.down.from : doc.length
  return to >= block.first.from && to <= end ? null : to
}
export const landing = (state: EditorState, span: BlockSpan, at: number): number | null =>
  landingOf(state, span, measure(state, span), at)
function bodyAt(
  state: EditorState,
  block: Measured,
  leaving: SyntaxNode | undefined,
): { text: string; taken: number[] } {
  const doc = state.doc
  const lines = doc.sliceString(block.first.from, block.last.to).split('\n')
  const depth = leaving ? leaving.from - doc.lineAt(leaving.from).from : indentOf(block.first.text)
  const out = Math.max(0, indentOf(block.first.text) - depth)
  const taken = lines.map((line) => Math.min(out, indentOf(line)))
  return { text: lines.map((line, index) => line.slice(taken[index])).join('\n'), taken }
}
function caretIn(state: EditorState, block: Measured, taken: number[], caret: number): number {
  const doc = state.doc
  const line = doc.lineAt(caret)
  let offset = 0
  for (let number = block.first.number; number < line.number; number++)
    offset += doc.line(number).length - (taken[number - block.first.number] ?? 0) + 1
  return offset + Math.max(0, caret - line.from - (taken[line.number - block.first.number] ?? 0))
}
const breaks = (text: string): number => text.split('\n').length
function cut(state: EditorState, block: Measured): ChangeSpec & { from: number; insert: string } {
  const doc = state.doc
  const { first, last, up, down } = block
  if (up && down) {
    const upper = doc.sliceString(up.to, first.from)
    const lower = doc.sliceString(last.to, down.from)
    const wider = breaks(upper) >= breaks(lower) ? upper : lower
    const between = gap(state, above(state, up), below(state, down), wider, block.holder)
    return { from: up.to, to: down.from, insert: between }
  }
  if (down) return { from: first.from, to: down.from, insert: '' }
  if (up) return { from: up.to, to: last.to, insert: '' }
  return { from: first.from, to: last.to, insert: '' }
}
export interface BlockEdit {
  changes: ChangeSpec[]
  caret: number | null
}
export function moveBlock(
  state: EditorState,
  span: BlockSpan,
  at: number,
  caret = state.selection.main.head,
): BlockEdit | null {
  const block = measure(state, span)
  const to = landingOf(state, span, block, at)
  if (to === null) return null
  const doc = state.doc
  const staying = to < doc.length
  const downward = to > block.last.to
  const lastAbove = writtenLine(state, (staying ? doc.lineAt(to).number : doc.lines + 1) - 1, -1)
  const leaving = block.nests.filter((item) => {
    if (doc.lineAt(item.from).from >= to) return true
    if (staying && item.to >= to) return false
    return !(downward && lastAbove !== null && item.to >= lastAbove.to)
  })
  const { text, taken } = bodyAt(state, block, leaving[0])
  const own: Side = {
    items: itemsAround(state, block.last.to).filter((item) => !leaving.includes(item)),
    item: below(state, block.first).item,
    indent: indentOf(text),
    moving: true,
    quote: block.holder,
  }
  const lower = staying ? doc.lineAt(to) : null
  const upper = writtenLine(state, (lower ? lower.number : doc.lines + 1) - 1, -1)
  const existing = upper && lower ? doc.sliceString(upper.to, lower.from) : null
  const before = upper ? gap(state, above(state, upper), own, existing, block.holder) : ''
  const after = lower ? gap(state, own, below(state, lower), existing, block.holder) : ''
  const from = upper ? upper.to : (lower?.from ?? 0)
  const put = { from, to: upper && lower ? lower.from : from, insert: before + text + after }
  const changes: ChangeSpec[] = [cut(state, block), put]
  const inside = caret >= block.first.from && caret <= block.last.to
  if (!inside) return { changes, caret: null }
  const landed = state.changes(changes).mapPos(put.from, -1) + before.length
  return { changes, caret: landed + caretIn(state, block, taken, caret) }
}
export function copyBlock(state: EditorState, span: BlockSpan): BlockEdit {
  const block = measure(state, span)
  const doc = state.doc
  const text = doc.sliceString(block.first.from, block.last.to)
  const existing = block.down ? doc.sliceString(block.last.to, block.down.from) : null
  const between = gap(state, above(state, block.last), below(state, block.first), existing, block.holder)
  return {
    changes: [{ from: block.last.to, insert: between + text }],
    caret: block.last.to + between.length,
  }
}
export function cutBlock(state: EditorState, span: BlockSpan): BlockEdit {
  const change = cut(state, measure(state, span))
  return { changes: [change], caret: change.from + change.insert.length }
}
