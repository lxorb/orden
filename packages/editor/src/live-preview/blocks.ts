import { syntaxTree } from '@codemirror/language'
import { type EditorState, Facet, type Range, StateField } from '@codemirror/state'
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
 *  viewport-scoped plugin. All are rare enough to scan the whole document for. */
/** Whether display equations carry a number on the right. */
export const numberEquations = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? false,
})

/** Labels have to be known before any `\eqref` renders, so equations are
 *  counted in a first pass over the document. */
function collectEquationLabels(state: EditorState): Map<number, number> {
  const numbers = new Map<number, number>()
  resetEquationLabels()

  let counter = 0
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'BlockMath') return true

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

export function buildBlockDecorations(state: EditorState): DecorationSet {
  const ranges: Range<Decoration>[] = []
  const doc = state.doc
  const numbered = state.facet(numberEquations)
  const equationNumbers = numbered ? collectEquationLabels(state) : new Map<number, number>()

  const wholeLines = (from: number, to: number) => ({
    from: doc.lineAt(from).from,
    to: doc.lineAt(to).to,
  })

  syntaxTree(state).iterate({
    enter: (node) => {
      switch (node.name) {
        case 'BlockMath': {
          if (overlaps(state, node.from, node.to)) return false
          const span = wholeLines(node.from, node.to)
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
          if (overlaps(state, node.from, node.to)) return false

          const info = node.node.getChild('CodeInfo')
          const language = info ? doc.sliceString(info.from, info.to).trim() : ''
          if (!DIAGRAM_LANGUAGES.has(language)) return false

          const text = node.node.getChild('CodeText')
          const span = wholeLines(node.from, node.to)
          ranges.push(
            Decoration.replace({
              widget: new DiagramWidget(text ? doc.sliceString(text.from, text.to) : '', language),
              block: true,
            }).range(span.from, span.to),
          )
          return false
        }

        case 'Paragraph': {
          // `[toc]` on its own line renders the document's headings.
          const line = doc.lineAt(node.from)
          if (!/^\s*\[toc\]\s*$/i.test(line.text)) return true
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
          if (overlaps(state, node.from, node.to)) return true

          const span = wholeLines(node.from, node.to)
          ranges.push(
            Decoration.replace({
              widget: new TableWidget(doc.sliceString(span.from, span.to), span.from, span.to),
              block: true,
            }).range(span.from, span.to),
          )
          return false
        }

        default:
          return true
      }
    },
  })

  return Decoration.set(ranges, true)
}

export const blockDecorations = StateField.define<DecorationSet>({
  create: buildBlockDecorations,
  update(value, transaction) {
    // The parse of a note just opened finishes in transactions of its own;
    // a block it found late has to be drawn then, not at the next click.
    const reparsed = syntaxTree(transaction.state) !== syntaxTree(transaction.startState)
    if (!transaction.docChanged && !transaction.selection && !reparsed) return value
    return buildBlockDecorations(transaction.state)
  },
  provide: (field) => [
    EditorView.decorations.from(field),
    EditorView.atomicRanges.of((view) => view.state.field(field)),
  ],
})
