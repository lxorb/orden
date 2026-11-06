import { syntaxTree } from '@codemirror/language'
import {
  type ChangeDesc,
  type EditorState,
  Facet,
  type Range,
  type SelectionRange,
  StateField,
  type Text,
  type Transaction,
} from '@codemirror/state'
import { Decoration, type DecorationSet, EditorView } from '@codemirror/view'
import { isExternal } from '../external'
import { fenceCode, fenceLanguage } from '../fence'
import { readChart } from '@orden/markdown/chart'
import { htmlBlockCard } from '@orden/markdown/html-block'
import { type EmbedKind, embedKind } from '@orden/markdown/links'
import { coverOf } from '@orden/markdown/cover'
import { readProperties } from '@orden/markdown/properties'
import { CoverWidget } from './cover'
import { drawnAs, propertiesMode, shownChanged } from './hidden-front-matter'
import { openedChanged, PropertiesWidget, propertiesOpen } from './properties'
import { embedOfBlock, embedWidget } from '../wikilink/embed'
import { trustChanged, trustsMarkup } from '../markup'
import { noteIndex, type NoteIndex } from '../wikilink/notes'
import { standsAlone } from '../table/navigation'
import { TableWidget } from '../table/widget'
import { dragging } from './dragging'
import { noReveal, overlaps } from './reveal'
import {
  BaseWidget,
  ChartWidget,
  DiagramWidget,
  MathWidget,
  QueryWidget,
  recordEquationLabel,
  RENDERED_LANGUAGES,
  resetEquationLabels,
} from './render'
import { headings, TocWidget } from './toc'
import { WebEmbedWidget } from './web'

export const numberEquations = Facet.define<boolean, boolean>({
  combine: (values) => values[0] ?? false,
})

const TOC_MAX = 16

const MEDIA: ReadonlySet<EmbedKind | null> = new Set<EmbedKind>(['image', 'audio', 'video'])

function mathIn(doc: Text, node: { from: number; to: number }): string {
  const first = doc.lineAt(node.from)
  const last = doc.lineAt(node.to)
  if (first.number === last.number) return doc.sliceString(node.from + 2, node.to - 2)

  return doc.sliceString(first.to, last.from)
}

function collectEquationLabels(state: EditorState): Map<number, number> {
  const numbers = new Map<number, number>()
  let counter = 0
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== 'BlockMath') return node.type.is('Block')

      counter += 1
      numbers.set(node.from, counter)

      recordEquationLabel(mathIn(state.doc, node), counter)
      return false
    },
  })

  return numbers
}

interface Blocks {
  decorations: DecorationSet
  spans: readonly { from: number; to: number }[]
  toc: boolean
  chosen: boolean
}

function buildBlocks(state: EditorState, reveals = true): Blocks {
  const ranges: Range<Decoration>[] = []
  const spans: { from: number; to: number }[] = []
  let toc = false
  const doc = state.doc
  const numbered = state.facet(numberEquations)
  const shown = drawnAs(state)
  resetEquationLabels()
  const equationNumbers = numbered ? collectEquationLabels(state) : new Map<number, number>()

  const wholeLines = (from: number, to: number) => ({
    from: doc.lineAt(from).from,
    to: doc.lineAt(to).to,
  })

  const found = (from: number, to: number) => {
    const span = wholeLines(from, to)
    spans.push(span)
    return { ...span, revealed: reveals && overlaps(state, span.from, span.to) }
  }

  syntaxTree(state).iterate({
    enter: (node) => {
      switch (node.name) {
        case 'BlockMath': {
          if (!standsAlone(state, node.from)) return true

          const span = found(node.from, node.to)
          if (span.revealed) return false
          const tex = mathIn(doc, node).trim()
          ranges.push(
            Decoration.replace({
              widget: new MathWidget(tex, true, equationNumbers.get(node.from)),
              block: true,
            }).range(span.from, span.to),
          )
          return false
        }

        case 'FrontMatter': {
          const span = found(node.from, node.to)
          const source = doc.sliceString(node.from, node.to)

          const cover = coverOf(source)
          if (cover) {
            ranges.push(
              Decoration.widget({
                widget: new CoverWidget(cover),
                block: true,
                side: -1,
              }).range(span.from),
            )
          }

          if (shown === 'hidden' && node.node.getChildren('FrontMatterMark').length > 1) {
            ranges.push(Decoration.replace({ block: true }).range(span.from, span.to))
            return false
          }

          if (shown !== 'properties') return false

          if (span.revealed) return false
          if (readProperties(source) === null) return false

          ranges.push(
            Decoration.replace({
              widget: new PropertiesWidget(source, state.field(propertiesOpen, false) === true),
              block: true,
            }).range(span.from, span.to),
          )
          return false
        }

        case 'FencedCode': {
          if (!standsAlone(state, node.from)) return true
          const span = found(node.from, node.to)

          const language = fenceLanguage(state, node.node)
          if (!RENDERED_LANGUAGES.has(language)) return false
          if (span.revealed) return false

          const code = fenceCode(state, node.node)

          if (language === 'chart' && readChart(code) === null) return false

          const index = state.facet(noteIndex)
          if (ANSWERED.has(language) && !index.query) return false
          if (language === 'base' && !index.mountBase) return false

          ranges.push(
            Decoration.replace({
              widget: widgetFor(language, code, index),
              block: true,
            }).range(span.from, span.to),
          )
          return false
        }

        case 'Paragraph': {
          const embed = embedOfBlock(state, node.from, node.to)
          if (embed && !MEDIA.has(embedKind(embed.target))) {
            const span = found(node.from, node.to)
            if (span.revealed) return false

            ranges.push(
              Decoration.replace({ widget: embedWidget(state, embed), block: true }).range(
                span.from,
                span.to,
              ),
            )
            return false
          }

          if (node.to - node.from > TOC_MAX) return false
          const line = doc.lineAt(node.from)
          if (!/\[toc\]/i.test(line.text)) return false

          const span = found(line.from, line.to)
          if (!/^\s*\[toc\]\s*$/i.test(line.text)) return false

          toc = true
          if (span.revealed) return false

          ranges.push(
            Decoration.replace({ widget: new TocWidget(headings(state)), block: true }).range(
              span.from,
              span.to,
            ),
          )
          return false
        }

        case 'HTMLBlock': {
          if (!standsAlone(state, node.from) || !trustsMarkup(state)) return false

          const card = htmlBlockCard(doc.sliceString(node.from, node.to))
          if (card === null) return false

          const span = found(node.from, node.to)
          if (span.revealed) return false

          ranges.push(
            Decoration.replace({ widget: new WebEmbedWidget(card), block: true }).range(
              span.from,
              span.to,
            ),
          )
          return false
        }

        case 'Table': {
          if (!standsAlone(state, node.from)) return true

          const span = found(node.from, node.to)
          if (span.revealed) return true

          ranges.push(
            Decoration.replace({
              widget: new TableWidget(
                doc.sliceString(span.from, span.to),
                span.from,
                span.to,
                !state.readOnly,
              ),
              block: true,
            }).range(span.from, span.to),
          )
          return false
        }

        default:
          return node.type.is('Block')
      }
    },
  })

  const wholeNoteParsed = syntaxTree(state).length === doc.length

  return {
    decorations: Decoration.set(ranges, true),
    spans,
    toc,
    chosen: reveals || (wholeNoteParsed && !crosses(spans, state.selection.ranges)),
  }
}

export function buildBlockDecorations(state: EditorState): DecorationSet {
  return buildBlocks(state).decorations
}

const ANSWERED = new Set(['query', 'tasks'])

function widgetFor(language: string, code: string, index: NoteIndex) {
  if (language === 'chart') return new ChartWidget(code)
  if (ANSWERED.has(language)) return new QueryWidget(code, index, language)
  if (language === 'base') return new BaseWidget({ code }, index)
  return new DiagramWidget(code, language)
}

function crosses(
  spans: readonly { from: number; to: number }[],
  ranges: readonly SelectionRange[],
) {
  return spans.some((span) =>
    ranges.some((range) => range.from <= span.to && range.to >= span.from),
  )
}

const PROSE = /^[\p{L}\p{N} ,;'"?]*$/u

const PUNCTUATION = /^[\p{L}\p{N}\p{P}\p{S} ]*$/u
const BLOCK_MARKS = /[`~|$[\]<>]/

function insideALine(doc: Text, at: number): boolean {
  const line = doc.lineAt(at)
  return /\p{L}/u.test(line.text.slice(0, at - line.from))
}

function onlyProse(transaction: Transaction, value: Blocks): boolean {
  if (value.toc) return false

  const before = transaction.startState
  const after = transaction.state.doc
  const changes = transaction.changes
  let ordinary = true

  changes.iterChanges((fromA, toA, fromB, _toB, inserted) => {
    if (!ordinary) return
    const from = before.doc.lineAt(fromA).from - 1
    const to = before.doc.lineAt(Math.min(toA, before.doc.length)).to + 1
    if (value.spans.some((span) => from <= span.to && to >= span.from)) {
      ordinary = false
      return
    }

    const removed = before.doc.sliceString(fromA, toA)
    const added = inserted.toString()
    const written = removed + added
    if (PROSE.test(added) && (removed === '' || PROSE.test(removed))) {
      ordinary = removed === '' || insideALine(after, fromB)
    } else {
      ordinary =
        PUNCTUATION.test(written) && !BLOCK_MARKS.test(written) && insideALine(after, fromB)
    }
  })

  return ordinary
}

function mapSpans(spans: readonly { from: number; to: number }[], changes: ChangeDesc) {
  return spans.map((span) => ({
    from: changes.mapPos(span.from, 1),
    to: changes.mapPos(span.to, -1),
  }))
}

function settingsChanged(transaction: Transaction): boolean {
  const before = transaction.startState
  const after = transaction.state
  return (
    before.facet(noReveal) !== after.facet(noReveal) ||
    before.facet(numberEquations) !== after.facet(numberEquations) ||
    before.facet(propertiesMode) !== after.facet(propertiesMode) ||
    shownChanged(before, after) ||
    openedChanged(before, after) ||
    before.facet(noteIndex) !== after.facet(noteIndex) ||
    trustChanged(before, after)
  )
}

export const blockDecorations = StateField.define<Blocks>({
  create: (state) => buildBlocks(state, false),

  update(value, transaction) {
    const moved =
      transaction.selection !== undefined &&
      !transaction.startState.selection.eq(transaction.state.selection)
    const chosen = value.chosen || transaction.docChanged || moved

    if (settingsChanged(transaction)) return buildBlocks(transaction.state, chosen)

    if (isExternal(transaction)) return buildBlocks(transaction.state, false)

    const reparsed = syntaxTree(transaction.state) !== syntaxTree(transaction.startState)

    const held = transaction.state.field(dragging, false) === true
    if (transaction.startState.field(dragging, false) === true && !held) {
      return buildBlocks(transaction.state, chosen)
    }

    if (!transaction.docChanged && !transaction.selection && !reparsed) return value

    if (held && !transaction.docChanged && !reparsed) {
      return chosen === value.chosen ? value : { ...value, chosen }
    }

    const was = transaction.startState.selection.ranges
    const now = transaction.state.selection.ranges

    if (!transaction.docChanged && !reparsed) {
      if (!crosses(value.spans, was) && !crosses(value.spans, now)) return value
    }

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
        return {
          decorations: value.decorations.map(transaction.changes),
          spans,
          toc: false,
          chosen,
        }
      }
    }

    return buildBlocks(transaction.state, chosen)
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).decorations),
  ],
})
