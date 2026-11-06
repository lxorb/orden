import { type Extension, StateEffect, StateField } from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
} from '@codemirror/view'
import { label } from '../labels'
import { NibWidget } from '../live-preview/widget'
import { landing, moveBlock } from './move'
import { blockAt, blocksIn, type BlockSpan } from './span'

interface Carrying {
  span: BlockSpan
  at: number | null
}

const lift = StateEffect.define<Carrying>()
const drop = StateEffect.define()

const carrying = StateField.define<Carrying | null>({
  create: () => null,

  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(lift)) return effect.value
      if (effect.is(drop)) return null
    }

    return transaction.docChanged ? null : value
  },

  provide: (field) =>
    EditorView.decorations.compute([field], (state) => {
      const held = state.field(field)
      if (!held) return Decoration.none

      const doc = state.doc
      const marks = []

      for (
        let number = doc.lineAt(held.span.from).number;
        number <= doc.lineAt(held.span.to).number;
        number++
      ) {
        marks.push(Decoration.line({ class: 'nib-block-lifted' }).range(doc.line(number).from))
      }

      if (held.at !== null) {
        const landing = held.at >= doc.length ? doc.line(doc.lines) : doc.lineAt(held.at)
        marks.push(
          Decoration.line({
            class: held.at >= doc.length ? 'nib-block-under' : 'nib-block-over',
          }).range(landing.from),
        )
      }

      return Decoration.set(marks, true)
    }),
})

function grip(): SVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 10 14')

  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', 'M3 3h.01M3 7h.01M3 11h.01M7 3h.01M7 7h.01M7 11h.01')
  svg.append(path)

  return svg
}

function landingAt(view: EditorView, y: number): number | null {
  const edge = view.contentDOM.getBoundingClientRect()
  const pos = view.posAtCoords({ x: edge.left + 1, y }, false)
  const block = blockAt(view.state, pos)
  if (!block) return null

  const top = view.documentTop + view.lineBlockAt(block.from).top
  const bottom = view.documentTop + view.lineBlockAt(block.to).bottom
  if (y < (top + bottom) / 2) return block.from

  const doc = view.state.doc
  let next = doc.lineAt(block.to).number + 1
  while (next <= doc.lines && doc.line(next).text.trim() === '') next++

  return next > doc.lines ? doc.length : doc.line(next).from
}

function landingFor(view: EditorView, span: BlockSpan, y: number): number | null {
  const at = landingAt(view, y)
  return at === null ? null : landing(view.state, span, at)
}

const A_DRAG = 4

class BlockHandleWidget extends NibWidget {
  override eq() {
    return true
  }

  toDOM(view: EditorView) {
    const slot = document.createElement('span')
    slot.className = 'nib-block-slot'
    slot.contentEditable = 'false'

    const mark = document.createElement('button')
    mark.type = 'button'
    mark.className = 'nib-block-handle'
    mark.setAttribute('aria-label', label('blockHandle'))
    mark.tabIndex = -1
    mark.append(grip())

    mark.addEventListener('mousedown', (event) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.button !== 0) return

      const span = blockAt(view.state, view.posAtDOM(mark))
      if (span) carry(view, mark, span, event)
    })

    slot.append(mark)
    return slot
  }

  override ignoreEvent() {
    return false
  }
}

function carry(view: EditorView, mark: HTMLElement, span: BlockSpan, start: MouseEvent) {
  let dragging = false

  const move = (event: MouseEvent) => {
    const travelled =
      Math.abs(event.clientY - start.clientY) + Math.abs(event.clientX - start.clientX)
    if (!dragging && travelled < A_DRAG) return

    dragging = true
    const at = landingFor(view, span, event.clientY)
    if (view.state.field(carrying, false)?.at === at) return

    view.dispatch({ effects: lift.of({ span, at }) })
  }

  const up = (event: MouseEvent) => {
    view.dom.ownerDocument.removeEventListener('mousemove', move)
    view.dom.ownerDocument.removeEventListener('mouseup', up)

    const held = view.state.field(carrying, false)
    view.dispatch({ effects: drop.of(null) })

    if (!dragging) {
      const { clientX, clientY } = event
      setTimeout(() => {
        mark.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX, clientY }))
      })
      return
    }

    if (held?.at == null) return
    const edit = moveBlock(view.state, held.span, held.at)
    if (!edit) return

    view.dispatch({
      changes: edit.changes,
      ...(edit.caret === null ? {} : { selection: { anchor: edit.caret } }),
      scrollIntoView: true,
    })
    view.focus()
  }

  view.dom.ownerDocument.addEventListener('mousemove', move)
  view.dom.ownerDocument.addEventListener('mouseup', up)
}

const handles = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet

    constructor(view: EditorView) {
      this.decorations = build(view)
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged) this.decorations = build(update.view)
    }
  },
  { decorations: (plugin) => plugin.decorations },
)

function build(view: EditorView): DecorationSet {
  const marks = []
  const taken = new Set<number>()

  for (const { from, to } of view.visibleRanges) {
    for (const span of blocksIn(view.state, from, to)) {
      const line = view.state.doc.lineAt(span.from).from
      if (taken.has(line)) continue

      taken.add(line)
      marks.push(Decoration.widget({ widget: new BlockHandleWidget(), side: -2 }).range(line))
    }
  }

  return Decoration.set(marks, true)
}

export function blockHandles(): Extension {
  return [carrying, handles]
}
