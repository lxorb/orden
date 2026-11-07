import type { Extension, SelectionRange } from '@codemirror/state'
import {
  drawSelection,
  EditorView,
  type LayerMarker,
  layer,
  RectangleMarker,
} from '@codemirror/view'
import { type SelectionBlock, selectionBlocks, type SelectionRect } from './shape'

const RADIUS = 6

function radiusOf(view: EditorView): number {
  const said = getComputedStyle(view.contentDOM).getPropertyValue('--selection-radius')
  const asked = Number.parseFloat(said)

  return Number.isFinite(asked) ? asked : RADIUS
}

function rectsFor(view: EditorView, range: SelectionRange): SelectionRect[] {
  const rects: SelectionRect[] = []

  for (const rect of RectangleMarker.forRange(view, '', range)) {
    if (rect.width === null) continue

    rects.push({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
  }

  return rects
}

class Shape implements LayerMarker {
  constructor(private readonly block: SelectionBlock) {}

  eq(other: LayerMarker): boolean {
    if (!(other instanceof Shape)) return false

    const { left, top, width, height, path } = other.block
    return (
      left === this.block.left &&
      top === this.block.top &&
      width === this.block.width &&
      height === this.block.height &&
      path === this.block.path
    )
  }

  draw(): HTMLElement {
    const dom = document.createElement('div')
    dom.className = 'cm-orden-selection-block'
    this.place(dom)

    return dom
  }

  update(dom: HTMLElement): boolean {
    this.place(dom)

    return true
  }

  private place(dom: HTMLElement): void {
    const { left, top, width, height, path } = this.block

    dom.style.left = `${left}px`
    dom.style.top = `${top}px`
    dom.style.width = `${width}px`
    dom.style.height = `${height}px`
    dom.style.clipPath = `path('${path}')`
  }
}

const shapes = layer({
  above: false,
  class: 'cm-orden-selection',
  update: (update) => update.docChanged || update.selectionSet || update.viewportChanged,
  markers: (view) => {
    const radius = radiusOf(view)
    const markers: LayerMarker[] = []

    for (const range of view.state.selection.ranges) {
      if (range.empty) continue

      for (const block of selectionBlocks(rectsFor(view, range), radius)) {
        markers.push(new Shape(block))
      }
    }

    return markers
  },
})

const style = EditorView.baseTheme({
  '.cm-orden-selection-block': {
    position: 'absolute',
    background: 'var(--selection)',
    animation: 'cm-orden-selection-in var(--dur-fast, 130ms) var(--ease-out, ease-out)',
  },

  '@keyframes cm-orden-selection-in': {
    from: { opacity: 0 },
    to: { opacity: 1 },
  },

  '.cm-selectionBackground': { display: 'none' },
})

export function nibSelection(): Extension {
  return [drawSelection(), shapes, style]
}
