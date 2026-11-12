import { codeFolding, foldable, foldedRanges, foldEffect } from '@codemirror/language'
import type { EditorState, Extension, Line, StateCommand, TransactionSpec } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { calloutOf } from '@orden/markdown/callouts'
import { CHEVRON } from '@orden/markdown/icons'
import {
  foldMovement,
  type FoldRange,
  openFolds,
  shutFolds,
  shuttingAt,
  shuttingChanged,
  stopShutting,
} from './fold-motion'
import { iconElement } from './icon'
import { OrdenWidget } from './live-preview/widget'

export type FoldLines = readonly [head: number, last: number]

const COULD_FOLD =
  /^(?:[ \t]*(?:#{1,6}[ \t]|>|[-*+][ \t]|\d+[.)][ \t]|```|~~~)|(?: {2}|\t)[ \t]*\S)/

const HEADING = /^[ \t]*#{1,6}[ \t]/

function foldAtLine(state: EditorState, line: Line): FoldRange | null {
  return foldable(state, line.from, line.to) ?? null
}

export function foldOpenedBy(state: EditorState, line: Line): FoldRange | null {
  return COULD_FOLD.test(line.text) ? foldAtLine(state, line) : null
}

function foldedAtLine(state: EditorState, line: Line): FoldRange | null {
  let found: FoldRange | null = null
  foldedRanges(state).between(line.from, line.to, (from, to) => {
    if (from >= line.from && from <= line.to && !found) found = { from, to }
  })
  return found
}

function enclosingFold(state: EditorState, pos: number): FoldRange | null {
  const start = state.doc.lineAt(pos)

  for (let number = start.number; number >= 1; number--) {
    const range = foldOpenedBy(state, state.doc.line(number))
    if (range && range.to >= pos) return range
  }

  return null
}

function caretFor(state: EditorState, ranges: readonly FoldRange[]): TransactionSpec {
  const head = state.selection.main.head
  let holder: FoldRange | null = null

  for (const range of ranges) {
    if (head <= range.from || head >= range.to) continue
    if (!holder || range.from > holder.from) holder = range
  }

  return holder ? { selection: { anchor: holder.from } } : {}
}

export const unfoldAtCaret: StateCommand = (target) => {
  const { state } = target
  const line = state.doc.lineAt(state.selection.main.head)

  if (target instanceof EditorView && shuttingAt(state, line.from, line.to)) {
    stopShutting(target)
    return true
  }

  const open = foldedAtLine(state, line)
  if (!open) return false

  openFolds(target, [open])
  return true
}

export const foldAtCaret: StateCommand = (target) => {
  const { state } = target
  const line = state.doc.lineAt(state.selection.main.head)
  if (foldedAtLine(state, line) || shuttingAt(state, line.from, line.to)) return false

  const range = enclosingFold(state, state.selection.main.head)
  if (!range) return false

  shutFolds(target, [range], caretFor(state, [range]))
  return true
}

export const toggleFold: StateCommand = (target) => unfoldAtCaret(target) || foldAtCaret(target)

export const foldHeadings: StateCommand = (target) => {
  const { state } = target
  const ranges: FoldRange[] = []

  for (let number = 1; number <= state.doc.lines; number++) {
    const line = state.doc.line(number)
    if (!HEADING.test(line.text)) continue

    const range = foldAtLine(state, line)
    if (!range) continue

    ranges.push(range)
    number = state.doc.lineAt(range.to).number
  }

  if (!ranges.length) return false

  shutFolds(target, ranges, caretFor(state, ranges))
  return true
}

interface Block extends FoldRange {
  depth: number
  folded: boolean
  hidden: boolean
}

function foldableBlocks(state: EditorState): Block[] {
  const shut: FoldRange[] = []
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    shut.push({ from, to })
  })

  const blocks: Block[] = []
  const holding: FoldRange[] = []
  const shutFrom = new Set(shut.map((one) => one.from))
  let before = 0
  let reach = -1

  for (let number = 1; number <= state.doc.lines; number++) {
    const range = foldOpenedBy(state, state.doc.line(number))
    if (!range) continue

    while (holding.length && (holding.at(-1)?.to ?? 0) < range.to) holding.pop()
    for (let next = shut[before]; next && next.from < range.from; next = shut[++before]) {
      reach = Math.max(reach, next.to)
    }

    blocks.push({
      ...range,
      depth: holding.length,
      folded: shutFrom.has(range.from),
      hidden: reach >= range.to,
    })
    holding.push(range)
  }

  return blocks
}

export const foldMore: StateCommand = (target) => {
  const { state } = target
  const open = foldableBlocks(state).filter((one) => !one.folded && !one.hidden)
  if (!open.length) return false

  const deepest = open.reduce((most, one) => Math.max(most, one.depth), 0)
  const ranges = open.filter((one) => one.depth === deepest)

  shutFolds(target, ranges, caretFor(state, ranges))
  return true
}

export const foldLess: StateCommand = (target) => {
  const shut = foldableBlocks(target.state).filter((one) => one.folded && !one.hidden)
  if (!shut.length) return false

  const shallowest = shut.reduce(
    (least, one) => Math.min(least, one.depth),
    Number.MAX_SAFE_INTEGER,
  )

  openFolds(
    target,
    shut.filter((one) => one.depth === shallowest),
  )
  return true
}

export const unfoldEverything: StateCommand = (target) => {
  const open: FoldRange[] = []
  foldedRanges(target.state).between(0, target.state.doc.length, (from, to) => {
    open.push({ from, to })
  })

  if (!open.length) return false

  openFolds(target, open)
  return true
}

export const cycleAllFolds: StateCommand = (target) =>
  unfoldEverything(target) || foldHeadings(target)

export function foldLines(state: EditorState): FoldLines[] {
  const out: FoldLines[] = []
  foldedRanges(state).between(0, state.doc.length, (from, to) => {
    out.push([state.doc.lineAt(from).number, state.doc.lineAt(to).number])
  })

  return out.sort((one, other) => one[0] - other[0] || one[1] - other[1])
}

function foldsFor(state: EditorState, lines: readonly FoldLines[]): FoldRange[] {
  const out: FoldRange[] = []

  for (const [head, last] of lines) {
    if (head < 1 || last <= head || last > state.doc.lines) continue
    out.push({ from: state.doc.line(head).to, to: state.doc.line(last).to })
  }

  return out.sort((one, other) => one.from - other.from || one.to - other.to)
}

function markerFolds(state: EditorState): FoldRange[] {
  const out: FoldRange[] = []

  let at = 0
  let past = 0
  for (const text of state.doc.iterLines()) {
    const from = at
    at += text.length + 1
    if (from < past) continue

    const opened = text.indexOf('[!')
    if (opened < 0 || !/^[ \t>]*$/.test(text.slice(0, opened))) continue
    if (!calloutOf(text.slice(opened))?.folded) continue

    const range = foldAtLine(state, state.doc.lineAt(from))
    if (!range) continue

    out.push(range)
    past = state.doc.lineAt(range.to).to + 1
  }

  return out
}

export function withFolds(state: EditorState, lines: readonly FoldLines[]): EditorState {
  const ranges = [...foldsFor(state, lines), ...markerFolds(state)].sort(
    (one, other) => one.from - other.from || one.to - other.to,
  )
  if (!ranges.length) return state

  return state.update({
    effects: ranges.map((range) => foldEffect.of(range)),
    selection: state.selection,
  }).state
}

export function sameFolds(
  one: readonly FoldLines[] | undefined,
  other: readonly FoldLines[] | undefined,
): boolean {
  const first = one ?? []
  const second = other ?? []
  if (first.length !== second.length) return false

  for (let at = 0; at < first.length; at++) {
    const mine = first[at]
    const theirs = second[at]
    if (!mine || !theirs) return false
    if (mine[0] !== theirs[0] || mine[1] !== theirs[1]) return false
  }

  return true
}

export function foldsChanged(update: ViewUpdate): boolean {
  return foldedRanges(update.startState) !== foldedRanges(update.state)
}

function chevron(): SVGElement {
  return iconElement(CHEVRON)
}

class FoldWidget extends OrdenWidget {
  constructor(private readonly folded: boolean) {
    super()
  }

  override eq(other: FoldWidget) {
    return other.folded === this.folded
  }

  override updateDOM(dom: HTMLElement) {
    const hinge = dom.firstElementChild
    if (!(hinge instanceof HTMLElement)) return false

    hinge.dataset.folded = String(this.folded)
    hinge.setAttribute('aria-label', this.folded ? 'Unfold' : 'Fold')
    return true
  }

  toDOM(view: EditorView) {
    const slot = document.createElement('span')
    slot.className = 'orden-fold'
    slot.contentEditable = 'false'

    const hinge = document.createElement('button')
    hinge.type = 'button'
    hinge.className = 'orden-fold-hinge'
    hinge.dataset.folded = String(this.folded)
    hinge.setAttribute('aria-label', this.folded ? 'Unfold' : 'Fold')
    hinge.tabIndex = -1
    hinge.append(chevron())

    hinge.addEventListener('mousedown', (event) => {
      event.preventDefault()
      const pos = view.posAtDOM(hinge)
      const line = view.state.doc.lineAt(pos)

      if (shuttingAt(view.state, line.from, line.to)) {
        stopShutting(view)
        return
      }

      const open = foldedAtLine(view.state, line)
      if (open) openFolds(view, [open])
      else {
        const range = foldAtLine(view.state, line)
        if (range) shutFolds(view, [range], caretFor(view.state, [range]))
      }
    })

    slot.append(hinge)
    return slot
  }

  override ignoreEvent() {
    return false
  }
}

function placeholder(view: EditorView, onclick: (event: Event) => void): HTMLElement {
  const more = document.createElement('span')
  more.className = 'orden-folded'
  more.setAttribute('aria-label', 'Unfold')
  more.textContent = '⋯'

  more.addEventListener('click', (event) => {
    const line = view.state.doc.lineAt(view.posAtDOM(more))
    const open = foldedAtLine(view.state, line)

    if (open) openFolds(view, [open])
    else onclick(event)
  })

  return more
}

const hinges = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = build(view)
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        foldsChanged(update) ||
        shuttingChanged(update)
      ) {
        this.decorations = build(update.view)
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

function build(view: EditorView): DecorationSet {
  const marks = []
  const { state } = view

  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to;) {
      const line = state.doc.lineAt(pos)
      const folded = !!foldedAtLine(state, line) || shuttingAt(state, line.from, line.to)

      if (folded || foldOpenedBy(state, line)) {
        marks.push(Decoration.widget({ widget: new FoldWidget(folded), side: -1 }).range(line.from))
      }

      if (line.to >= state.doc.length) break
      pos = line.to + 1
    }
  }

  return Decoration.set(marks, true)
}

export function folding(): Extension {
  return [codeFolding({ placeholderDOM: placeholder }), hinges, foldMovement()]
}
