import { syntaxTree } from '@codemirror/language'
import { type EditorState, Facet, type Range, type SelectionRange, StateField } from '@codemirror/state'
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
}

function buildBlocks(state: EditorState): Blocks {
  const ranges: Range<Decoration>[] = []
  const spans: { from: number; to: number }[] = []
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

  return { decorations: Decoration.set(ranges, true), spans }
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

export const blockDecorations = StateField.define<Blocks>({
  create: buildBlocks,
  update(value, transaction) {
    // The parse of a note just opened finishes in transactions of its own;
    // a block it found late has to be drawn then, not at the next click.
    const reparsed = syntaxTree(transaction.state) !== syntaxTree(transaction.startState)
    if (!transaction.docChanged && !transaction.selection && !reparsed) return value

    if (!transaction.docChanged && !reparsed) {
      const was = transaction.startState.selection.ranges
      const now = transaction.state.selection.ranges
      if (!crosses(value.spans, was) && !crosses(value.spans, now)) return value
    }

    return buildBlocks(transaction.state)
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).decorations),
  ],
})
