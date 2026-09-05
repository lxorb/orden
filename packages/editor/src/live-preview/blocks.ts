import { syntaxTree } from '@codemirror/language'
import {
  type ChangeDesc,
  type EditorState,
  Facet,
  type Range,
  type SelectionRange,
  StateField,
  type Transaction,
} from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { TableWidget } from '../table/widget'
import { lineRevealed, overlaps } from './reveal'
import {
  DIAGRAM_LANGUAGES,
  DiagramWidget,
  MathWidget,
  recordEquationLabel,
  resetEquationLabels,
} from './render'
import { headings, TocWidget } from './toc'

/** CodeMirror only accepts block-level replacements from a state field, so the
 *  constructs that occupy whole lines live here rather than in the
 *  viewport-scoped plugin. A field has no viewport to scope to, so the walk
 *  is kept cheap two other ways: it steps over everything that is not a block
 *  (a paragraph's emphasis and links cannot hold one of these), and a
 *  transaction that only moved the caret rebuilds nothing unless the caret
 *  crossed one of the constructs found last time. */
/** Whether display equations carry a number on the right. */
export const numberEquations = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? false,
})

/** The longest a `[toc]` line can be, so paragraphs are dismissed on their
 *  length before their first line is read out of the document. */
const TOC_MAX = 16

/** Labels have to be known before any `\eqref` renders, so equations are
 *  counted in a first pass over the document. */
function collectEquationLabels(state: EditorState): Map<number, number> {
  const numbers = new Map<number, number>()
  resetEquationLabels()

  let counter = 0
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'BlockMath') return node.type.is('Block')

      counter += 1
      numbers.set(node.from, counter)

      const doc = state.doc
      const tex = doc.sliceString(doc.lineAt(node.from).to, doc.lineAt(node.to).from)
      recordEquationLabel(tex, counter)
      return false
    },
  })

  return numbers
}

/** What the field keeps: the decorations, and the lines every construct it
 *  considered sits on. The spans are what makes a caret move cheap - see
 *  `crosses` below. */
interface Blocks {
  decorations: DecorationSet
  spans: readonly { from: number; to: number }[]
  /** Whether a `[toc]` is among them. What one shows is every heading in the
   *  note, so it is the one construct that changes when a line far from it
   *  does, and the one that rules out the shortcut below. */
  toc: boolean
}

function buildBlocks(state: EditorState): Blocks {
  const ranges: Range<Decoration>[] = []
  const spans: { from: number; to: number }[] = []
  let toc = false
  const doc = state.doc
  const numbered = state.facet(numberEquations)
  const equationNumbers = numbered ? collectEquationLabels(state) : new Map<number, number>()

  const wholeLines = (from: number, to: number) => ({
    from: doc.lineAt(from).from,
    to: doc.lineAt(to).to,
  })

  /** Records where a construct is before deciding what to draw for it, so a
   *  later caret move knows this is a place worth looking at again. */
  const found = (from: number, to: number) => {
    const span = wholeLines(from, to)
    spans.push(span)
    return span
  }

  syntaxTree(state).iterate({
    enter: (node) => {
      switch (node.name) {
        case 'BlockMath': {
          const span = found(node.from, node.to)
          if (overlaps(state, node.from, node.to)) return false
          const tex = doc.sliceString(doc.lineAt(node.from).to, doc.lineAt(node.to).from).trim()
          ranges.push(
            Decoration.replace({
              widget: new MathWidget(tex, true, equationNumbers.get(node.from)),
              block: true,
            }).range(span.from, span.to),
          )
          return false
        }

        case 'FencedCode': {
          const info = node.node.getChild('CodeInfo')
          const language = info ? doc.sliceString(info.from, info.to).trim() : ''
          if (!DIAGRAM_LANGUAGES.has(language)) return false

          const span = found(node.from, node.to)
          if (overlaps(state, node.from, node.to)) return false

          const text = node.node.getChild('CodeText')
          ranges.push(
            Decoration.replace({
              widget: new DiagramWidget(text ? doc.sliceString(text.from, text.to) : '', language),
              block: true,
            }).range(span.from, span.to),
          )
          return false
        }

        case 'Paragraph': {
          // `[toc]` on its own line renders the document's headings. Anything
          // longer than that cannot be one, and is dismissed without reading
          // the line out of the document at all.
          if (node.to - node.from > TOC_MAX) return false
          const line = doc.lineAt(node.from)
          if (!/^\s*\[toc\]\s*$/i.test(line.text)) return false

          spans.push({ from: line.from, to: line.to })
          toc = true
          if (lineRevealed(state, node.from)) return false

          ranges.push(
            Decoration.replace({ widget: new TocWidget(headings(state)), block: true }).range(
              line.from,
              line.to,
            ),
          )
          return false
        }

        case 'Table': {
          // Clicks inside the widget do not move CodeMirror's selection, so the
          // rendered table stays up while its cells are edited. Source only
          // shows while the caret is genuinely in the table's text.
          const span = found(node.from, node.to)
          if (overlaps(state, node.from, node.to)) return true

          ranges.push(
            Decoration.replace({
              widget: new TableWidget(doc.sliceString(span.from, span.to), span.from, span.to),
              block: true,
            }).range(span.from, span.to),
          )
          return false
        }

        default:
          // Every construct above occupies whole lines, so only blocks are
          // worth descending into: a paragraph's emphasis, links and code
          // spans cannot hold one, and skipping them is most of the document.
          return node.type.is('Block')
      }
    },
  })

  return { decorations: Decoration.set(ranges, true), spans, toc }
}

/** Exposed for tests: the block decorations a state would get. */
export function buildBlockDecorations(state: EditorState): DecorationSet {
  return buildBlocks(state).decorations
}

/** Whether a selection touches any of the constructs found last time. Only
 *  those care where the caret is - one hides its source while the caret is in
 *  it and shows it again on the way out - so a caret that stays clear of all
 *  of them leaves the decorations exactly as they were. Compared the way
 *  `overlaps` does, edges included. */
function crosses(spans: readonly { from: number; to: number }[], ranges: readonly SelectionRange[]) {
  return spans.some((span) =>
    ranges.some((range) => range.from <= span.to && range.to >= span.from),
  )
}

/** Characters no block construct here is made of: not a fence's backtick or
 *  tilde, not a table's bar, not a display equation's dollar, not the brackets
 *  of `[toc]`, and not a line break. Writing these into a line that is not
 *  part of one of those constructs cannot make one, unmake one, or move an end
 *  of one - it can only shift what comes after, which the decorations follow
 *  on their own. Deliberately a short list rather than a list of what to
 *  distrust: anything unaccounted for is looked at properly. */
const PROSE = /^[\p{L}\p{N} ,;'"?]*$/u

/** Whether `transaction` is prose typed clear of every construct found last
 *  time - the ordinary case, and the one worth not walking the note for. */
function onlyProse(transaction: Transaction, value: Blocks): boolean {
  if (value.toc) return false

  const before = transaction.startState
  const changes = transaction.changes
  let ordinary = true

  changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
    if (!ordinary) return
    // A line either side, so a change that ends where a construct begins is
    // still looked at properly.
    const from = before.doc.lineAt(fromA).from - 1
    const to = before.doc.lineAt(Math.min(toA, before.doc.length)).to + 1
    if (value.spans.some((span) => from <= span.to && to >= span.from)) ordinary = false
    else if (!PROSE.test(before.doc.sliceString(fromA, toA))) ordinary = false
    else if (!PROSE.test(inserted.toString())) ordinary = false
  })

  return ordinary
}

/** The same spans, where the change left them. */
function mapSpans(spans: readonly { from: number; to: number }[], changes: ChangeDesc) {
  return spans.map((span) => ({
    from: changes.mapPos(span.from, 1),
    to: changes.mapPos(span.to, -1),
  }))
}

export const blockDecorations = StateField.define<Blocks>({
  create: buildBlocks,
  update(value, transaction) {
    // The parse of a note just opened finishes in transactions of its own;
    // a block it found late has to be drawn then, not at the next click.
    const reparsed = syntaxTree(transaction.state) !== syntaxTree(transaction.startState)
    if (!transaction.docChanged && !transaction.selection && !reparsed) return value

    const was = transaction.startState.selection.ranges
    const now = transaction.state.selection.ranges

    if (!transaction.docChanged && !reparsed) {
      if (!crosses(value.spans, was) && !crosses(value.spans, now)) return value
    }

    // Prose typed away from every construct: the same constructs, further
    // along. The parse has to be no further along than the document, or a
    // block it has only just reached would be missed.
    const parsedOn =
      syntaxTree(transaction.state).length - syntaxTree(transaction.startState).length ===
      transaction.state.doc.length - transaction.startState.doc.length
    if (
      transaction.docChanged &&
      parsedOn &&
      !crosses(value.spans, was) &&
      onlyProse(transaction, value)
    ) {
      const spans = mapSpans(value.spans, transaction.changes)
      if (!crosses(spans, now)) {
        return { decorations: value.decorations.map(transaction.changes), spans, toc: false }
      }
    }

    return buildBlocks(transaction.state)
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).decorations),
  ],
})
