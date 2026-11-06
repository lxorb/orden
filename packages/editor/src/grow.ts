import { foldable, syntaxTree } from '@codemirror/language'
import {
  EditorSelection,
  type EditorState,
  type SelectionRange,
  type StateCommand,
  StateEffect,
  StateField,
} from '@codemirror/state'
import type { SyntaxNode } from '@lezer/common'
import { headingLevel } from './headings'
import { frontMatterSpan } from './live-preview/front-matter'
import { enclosing } from './nodes'

interface Span {
  from: number
  to: number
}

const grew = StateEffect.define<EditorSelection>()
const shrank = StateEffect.define()

const growing = StateField.define<readonly EditorSelection[]>({
  create: () => [],
  update(taken, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(grew)) return [...taken, effect.value]
      if (effect.is(shrank)) return taken.slice(0, -1)
    }
    return transaction.docChanged || transaction.selection ? [] : taken
  },
})

const BETWEEN_MARKS = new Set([
  'Emphasis',
  'StrongEmphasis',
  'Strikethrough',
  'Highlight',
  'InlineCode',
  'InlineMath',
  'Link',
  'Image',
  'Wikilink',
])

function afterLeadingMark(node: SyntaxNode): boolean {
  return headingLevel(node.name) !== null || node.name === 'Task'
}

const isMark = (node: SyntaxNode) => node.name.endsWith('Mark') || node.name === 'TaskMarker'

function inside(state: EditorState, node: SyntaxNode): Span | null {
  const marks: SyntaxNode[] = []
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (isMark(child)) marks.push(child)
  }

  const [first, second] = marks
  if (BETWEEN_MARKS.has(node.name) && first && second) return { from: first.to, to: second.from }
  if (!afterLeadingMark(node) || first?.from !== node.from) return null

  const words = state.sliceDoc(first.to, node.to)
  const from = first.to + (words.length - words.trimStart().length)
  return { from, to: Math.max(from, first.to + words.trimEnd().length) }
}

function sections(state: EditorState, range: Span, top: number): Span[] {
  const doc = state.doc
  const found: Span[] = []

  for (let number = doc.lineAt(range.from).number; number >= top; number--) {
    const line = doc.line(number)
    if (!/^ {0,3}#{1,6}(?:[ \t]|$)/.test(line.text)) continue

    const fold = foldable(state, line.from, line.to)
    const section = { from: line.from, to: fold ? fold.to : line.to }
    if (section.to < range.to) continue

    found.push(section)
    if (section.from < range.from || section.to > range.to) break
  }

  return found
}

function outwards(state: EditorState, range: SelectionRange, top: number): Span[] {
  const found: Span[] = []
  if (range.empty) {
    const word = state.wordAt(range.head)
    if (word) found.push(word)
  }

  const tree = syntaxTree(state)
  const seen = new Set<SyntaxNode>()
  for (const side of [-1, 1] as const) {
    for (const node of enclosing(tree.resolveInner(range.from, side))) {
      if (seen.has(node) || isMark(node)) continue
      seen.add(node)
      found.push({ from: node.from, to: node.to })
      const words = inside(state, node)
      if (words) found.push(words)
    }
  }

  found.push(...sections(state, range, state.doc.lineAt(top).number))
  found.push({ from: top, to: state.doc.length })
  return found
}

function grown(state: EditorState, range: SelectionRange, top: number): SelectionRange {
  let best: Span | null = null
  for (const span of outwards(state, range, top)) {
    const from = Math.max(span.from, top)
    if (from > range.from || span.to < range.to) continue
    if (span.to - from <= range.to - range.from) continue
    if (!best || span.to - from < best.to - best.from) best = { from, to: span.to }
  }

  return best ? EditorSelection.range(best.from, best.to) : range
}

export const expandSelection: StateCommand = ({ state, dispatch }) => {
  const front = frontMatterSpan(state)
  const topOf = (range: SelectionRange) => (front && range.from > front.end ? front.after : 0)
  const next = EditorSelection.create(
    state.selection.ranges.map((range) => grown(state, range, topOf(range))),
    state.selection.mainIndex,
  )
  if (next.eq(state.selection)) return false

  const effects: StateEffect<unknown>[] = [grew.of(state.selection)]
  if (state.field(growing, false) === undefined) {
    effects.unshift(StateEffect.appendConfig.of(growing))
  }

  dispatch(state.update({ selection: next, effects, scrollIntoView: true }))
  return true
}

export const shrinkSelection: StateCommand = ({ state, dispatch }) => {
  const back = state.field(growing, false)?.at(-1)
  if (!back) return false

  dispatch(state.update({ selection: back, effects: shrank.of(null), scrollIntoView: true }))
  return true
}
