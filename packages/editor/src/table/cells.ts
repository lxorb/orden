import type { EditorView } from '@codemirror/view'
import { label, type LabelKey } from '../labels'
import { pressedByKey } from '../press'
import { selectionIn } from './caret'
import { renderInline } from './inline'
import type { CellAddress, Side } from './navigation'

/** The small pieces a rendered table is built out of: what a cell shows, where
 *  the caret ends up, and the elements the controls are made of.
 *
 *  None of them holds any of the table's state, which is why they are here and
 *  not methods on the view. Read view.ts for what drives them. */

/** A cell shows two different things depending on whether it holds the caret:
 *  markdown while it is being edited, so what is typed is what the document
 *  gets, and the rendered inline content otherwise. Swapped by these two, and
 *  the source is kept on the element so neither has to look it up. */

/** What the cell says when it is not being edited. */
export function showRendered(cell: HTMLElement) {
  cell.replaceChildren(renderInline(cell.dataset.source ?? ''))
}

/** What it says when it is. An empty text node rather than nothing, so there
 *  is somewhere for the caret to sit in an empty cell. */
export function showSource(cell: HTMLElement) {
  cell.replaceChildren(document.createTextNode(cell.dataset.source ?? ''))
}

/** The position on a line nearest to an x coordinate: on its last visual row
 *  when arriving from below, its first when arriving from above. */
export function posOnRow(
  view: EditorView,
  line: { from: number; to: number },
  side: Side,
  x: number,
) {
  const anchor = side === 'above' ? view.coordsAtPos(line.to, -1) : view.coordsAtPos(line.from, 1)
  if (!anchor) return side === 'above' ? line.to : line.from

  const pos = view.posAtCoords({ x, y: (anchor.top + anchor.bottom) / 2 })
  return pos === null ? line.from : Math.max(line.from, Math.min(line.to, pos))
}

/** Whether the caret, and nothing selected, sits at an offset in a cell. */
export function collapsedAt(cell: HTMLElement, offset: number): boolean {
  const selection = selectionIn(cell)
  return selection !== null && selection.from === offset && selection.to === offset
}

/** Whether a node is still in the document. */
export function attached(node: Node): boolean {
  return node.isConnected
}

export function sameCell(a: CellAddress, b: CellAddress | undefined): boolean {
  return a.row === b?.row && a.column === b.column
}

export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}

function icon(path: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 10 10')
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  shape.setAttribute('d', path)
  svg.append(shape)
  return svg
}

export function button(className: string, key: LabelKey, path: string, onPress: () => void) {
  const node = document.createElement('button')
  node.className = className
  node.type = 'button'
  node.title = label(key)
  node.setAttribute('aria-label', label(key))
  node.append(icon(path))
  // On mousedown, and with the default stopped, so the caret stays in
  // whichever cell holds it while the button acts. And on Enter or Space, since
  // the button is in the tab order and says its name; see press.ts.
  node.addEventListener('mousedown', (event) => {
    event.preventDefault()
    onPress()
  })
  pressedByKey(node, onPress)
  return node
}
