import { syntaxTree } from '@codemirror/language'
import type { SyntaxNode } from '@lezer/common'
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
import { CoverWidget } from './cover'
import { keptCover, keptCoverChanged } from './kept-cover'
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

interface Span {
  from: number
  to: number
}

interface Blocks {
  decorations: DecorationSet
  spans: readonly Span[]
  toc: boolean
  chosen: boolean
}

interface Scanned {
  ranges: Range<Decoration>[]
  spans: Span[]
  toc: boolean
}

function scan(
  state: EditorState,
  reveals: boolean,
  region: Span,
  equationNumbers: ReadonlyMap<number, number>,
  out: Scanned,
) {
  const { ranges, spans } = out
  const doc = state.doc
  const kept = keptCover(state)

  const wholeLines = (from: number, to: number) => ({
    from: doc.lineAt(from).from,
    to: doc.lineAt(to).to,
  })

  const found = (from: number, to: number) => {
    const span = wholeLines(from, to)
    spans.push(span)
    return { ...span, revealed: reveals && overlaps(state, span.from, span.to) }
  }

  if (kept && region.from === 0) {
    ranges.push(
      Decoration.widget({ widget: new CoverWidget(kept), block: true, side: -1 }).range(0),
    )
  }

  syntaxTree(state).iterate({
    from: region.from,
    to: region.to,
    enter: (node) => {
      if (node.to < region.from || node.from > region.to) return false
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
          const cover = kept ? null : coverOf(doc.sliceString(node.from, node.to))
          if (cover) {
            ranges.push(
              Decoration.widget({
                widget: new CoverWidget(cover),
                block: true,
                side: -1,
              }).range(span.from),
            )
          }
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
          if (!/\[toc\]/i.test(doc.sliceString(node.from, node.to))) return false
          const line = doc.lineAt(node.from)
          if (!/\[toc\]/i.test(line.text)) return false

          const span = found(line.from, line.to)
          if (!/^\s*\[toc\]\s*$/i.test(line.text)) return false

          out.toc = true
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
}

function chosenFor(state: EditorState, reveals: boolean, spans: readonly Span[]) {
  const wholeNoteParsed = syntaxTree(state).length === state.doc.length
  return reveals || (wholeNoteParsed && !crosses(spans, state.selection.ranges))
}

function buildBlocks(state: EditorState, reveals = true): Blocks {
  resetEquationLabels()
  const numbered = state.facet(numberEquations)
  const equationNumbers = numbered ? collectEquationLabels(state) : new Map<number, number>()
  const out: Scanned = { ranges: [], spans: [], toc: false }
  scan(state, reveals, { from: 0, to: state.doc.length }, equationNumbers, out)

  return {
    decorations: Decoration.set(out.ranges, true),
    spans: out.spans,
    toc: out.toc,
    chosen: chosenFor(state, reveals, out.spans),
  }
}

const LISTS = new Set(['BulletList', 'OrderedList'])

function runIn(parent: SyntaxNode, from: number, to: number): Span {
  const first = parent.childAfter(from - 1)
  const last = parent.childBefore(to + 1)
  return {
    from: first && first.from < from ? first.from : from,
    to: last && last.to > to ? last.to : to,
  }
}

function listAround(parent: SyntaxNode, from: number, to: number): SyntaxNode | null {
  const inside = parent.childAfter(from - 1)
  if (!inside || !LISTS.has(inside.name)) return null
  return inside.from < from && inside.to > to ? inside : null
}

function settle(transaction: Transaction, region: Span): Span {
  const changes = transaction.changes
  const back = changes.invertedDesc
  const oldTree = syntaxTree(transaction.startState)
  const newTree = syntaxTree(transaction.state)
  const oldEnd = transaction.startState.doc.length
  const newEnd = transaction.state.doc.length
  let from = Math.min(region.from, region.to)
  let to = Math.max(region.from, region.to)
  let newParent = newTree.topNode
  let oldParent = oldTree.topNode

  if (oldTree.length === oldEnd && newTree.length === newEnd) {
    for (;;) {
      const inNew = listAround(newParent, from, to)
      const inOld = listAround(oldParent, back.mapPos(from, -1), back.mapPos(to, 1))
      if (!inNew || inOld?.name !== inNew.name) break
      if (changes.mapPos(inOld.from, -1) !== inNew.from) break
      if (changes.mapPos(inOld.to, 1) !== inNew.to) break
      newParent = inNew
      oldParent = inOld
    }
  }

  const topLevel = newParent.parent === null
  for (;;) {
    const fresh = runIn(newParent, from, to)
    const old = runIn(oldParent, back.mapPos(fresh.from, -1), back.mapPos(fresh.to, 1))
    let nextFrom = Math.min(fresh.from, changes.mapPos(old.from, -1))
    let nextTo = Math.max(fresh.to, changes.mapPos(old.to, 1))
    if (
      topLevel &&
      (nextTo + 1 >= newTree.length || back.mapPos(nextTo, 1) + 1 >= oldTree.length)
    ) {
      nextTo = newEnd
    }
    nextFrom = Math.max(0, Math.min(nextFrom, newTree.length, changes.mapPos(oldTree.length, -1)))
    if (nextFrom === from && nextTo === to) return { from, to }
    from = nextFrom
    to = nextTo
  }
}

function merged(regions: Span[]): Span[] {
  const sorted = [...regions].sort((one, other) => one.from - other.from)
  const out: Span[] = []
  for (const region of sorted) {
    const last = out[out.length - 1]
    if (last && region.from <= last.to + 1) last.to = Math.max(last.to, region.to)
    else out.push({ ...region })
  }
  return out
}

function touched(regions: readonly Span[], from: number, to: number) {
  let low = 0
  let high = regions.length
  while (low < high) {
    const middle = (low + high) >> 1
    if ((regions[middle]?.to ?? to) < from) low = middle + 1
    else high = middle
  }
  const near = regions[low]
  return near !== undefined && near.from <= to
}

function rebuiltAround(value: Blocks, transaction: Transaction, chosen: boolean): Blocks | null {
  const state = transaction.state
  if (state.facet(numberEquations)) return null

  const oldTree = syntaxTree(transaction.startState)
  const newTree = syntaxTree(state)
  const changes = transaction.changes
  const oldEnd = changes.mapPos(oldTree.length, 1)
  if (!transaction.docChanged && oldTree !== newTree && oldEnd === newTree.length) return null

  const wanted: Span[] = []
  changes.iterChangedRanges((_fromA, _toA, fromB, toB) => wanted.push({ from: fromB, to: toB }))
  if (oldEnd !== newTree.length) {
    const from = Math.min(oldEnd, newTree.length)
    wanted.push({ from, to: state.doc.length })
  }
  if (value.toc) {
    value.decorations.between(0, transaction.startState.doc.length, (from, to, decoration) => {
      if (!((decoration.spec as { widget?: unknown }).widget instanceof TocWidget)) return
      wanted.push({ from: changes.mapPos(from, -1), to: changes.mapPos(to, 1) })
    })
  }

  const was = transaction.startState.selection.ranges
  const now = state.selection.ranges
  const spans = mapSpans(value.spans, changes)
  spans.forEach((span, at) => {
    const before = value.spans[at]
    if ((before && crosses([before], was)) || crosses([span], now)) wanted.push(span)
  })

  const regions = merged(wanted.map((region) => settle(transaction, region)))
  const first = regions[0]
  const last = regions[regions.length - 1]
  if (!first || !last) return { ...value, spans, chosen }

  const out: Scanned = { ranges: [], spans: [], toc: value.toc }
  for (const region of regions) scan(state, chosen, region, new Map(), out)

  const kept = spans.filter((span) => !touched(regions, span.from, span.to))
  const all = [...kept, ...out.spans].sort((one, other) => one.from - other.from)

  return {
    decorations: value.decorations.map(changes).update({
      filter: (from, to) => !touched(regions, from, to),
      filterFrom: first.from,
      filterTo: last.to,
      add: out.ranges,
      sort: true,
    }),
    spans: all,
    toc: out.toc,
    chosen: chosenFor(state, chosen, all),
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

function crosses(spans: readonly Span[], ranges: readonly SelectionRange[]) {
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

function mapSpans(spans: readonly Span[], changes: ChangeDesc): Span[] {
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
    keptCoverChanged(before, after) ||
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
      return rebuiltAround(value, transaction, chosen) ?? buildBlocks(transaction.state, chosen)
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

    return rebuiltAround(value, transaction, chosen) ?? buildBlocks(transaction.state, chosen)
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).decorations),
  ],
})
