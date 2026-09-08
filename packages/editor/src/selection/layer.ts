/** The selection, drawn.
 *
 *  The view is asked for the rectangles it would have painted and paints none of
 *  them; what reaches the page instead is one element per block of the
 *  selection, clipped to the outline `shape.ts` traces. That keeps the layer as
 *  cheap as the stack of rectangles it replaces - one element rather than three -
 *  and it keeps every measurement in the view's own measuring phase, so a
 *  pointer dragging a selection never reads layout on its way through.
 *
 *  `drawSelection` stays underneath it. The caret, the drag handles a phone puts
 *  on a selection, and hiding the browser's own highlight are all its work and
 *  none of it changes here. Its rectangles are the measurement this layer is
 *  drawn from, and they are the one thing it no longer shows. */

import type { Extension, SelectionRange } from '@codemirror/state'
import {
  drawSelection,
  EditorView,
  type LayerMarker,
  layer,
  RectangleMarker,
} from '@codemirror/view'
import { type SelectionBlock, selectionBlocks, type SelectionRect } from './shape'

/** How round a corner is when the theme says nothing. */
const RADIUS = 6

/** The corner the theme asks for, in pixels. Read here rather than kept in the
 *  code because it belongs with the colour it rounds, and read in the measuring
 *  phase because that is where the layout the rest of this reads is already
 *  settled. */
function radiusOf(view: EditorView): number {
  const said = getComputedStyle(view.contentDOM).getPropertyValue('--selection-radius')
  const asked = Number.parseFloat(said)

  return Number.isFinite(asked) ? asked : RADIUS
}

/** What the view measures for one range. The class name never reaches a page:
 *  these rectangles are a measurement and nothing else. A rectangle with no
 *  width of its own is what the view returns for an empty range, which this is
 *  never asked for. */
function rectsFor(view: EditorView, range: SelectionRange): SelectionRect[] {
  const rects: SelectionRect[] = []

  for (const rect of RectangleMarker.forRange(view, '', range)) {
    if (rect.width === null) continue

    rects.push({ left: rect.left, top: rect.top, width: rect.width, height: rect.height })
  }

  return rects
}

/** One block of one range: a box, clipped to the block's outline.
 *
 *  A path is a string, so an element that is already there is updated rather
 *  than replaced, and the block that eased in when the selection appeared keeps
 *  following the pointer without easing again. */
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
    dom.className = 'cm-nib-selection-block'
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
  // Under the text, where the view puts its own selection: what lifts it over a
  // block with a background of its own is the theme, and blends it there. See
  // editor.css in @nib/themes.
  above: false,
  class: 'cm-nib-selection',
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

/** How long a selection takes to arrive. A block that appears eases in; one that
 *  is already there follows the pointer or the keys exactly, because a selection
 *  that lags behind the hand dragging it reads as the editor being busy, and
 *  fading on every change is a flicker for as long as the drag lasts. Reduced
 *  motion zeroes the duration with every other one. */
const style = EditorView.baseTheme({
  '.cm-nib-selection-block': {
    position: 'absolute',
    background: 'var(--selection)',
    animation: 'cm-nib-selection-in var(--dur-fast, 130ms) var(--ease-out, ease-out)',
  },

  '@keyframes cm-nib-selection-in': {
    from: { opacity: 0 },
    to: { opacity: 1 },
  },

  // The view's own rectangles: measured, never shown.
  '.cm-selectionBackground': { display: 'none' },
})

/** Everything a view needs to show its selection as one smoothed block. */
export function nibSelection(): Extension {
  return [drawSelection(), shapes, style]
}
