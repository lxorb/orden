import type { EditorView } from '@codemirror/view'
import { pressedByKey } from '../press'
import { selectionIn } from './caret'
import { renderInline } from './inline'
import type { CellAddress, Side } from './navigation'

export function showRendered(cell: HTMLElement) {
  cell.replaceChildren(renderInline(cell.dataset.source ?? ''))
}

export function showSource(cell: HTMLElement) {
  cell.replaceChildren(document.createTextNode(cell.dataset.source ?? ''))
}

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

export function collapsedAt(cell: HTMLElement, offset: number): boolean {
  const selection = selectionIn(cell)
  return selection !== null && selection.from === offset && selection.to === offset
}

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

export function button(className: string, said: string, path: string, onPress: () => void) {
  const node = document.createElement('button')
  node.className = className
  node.type = 'button'
  node.title = said
  node.setAttribute('aria-label', said)
  node.append(icon(path))
  node.addEventListener('mousedown', (event) => {
    event.preventDefault()
    onPress()
  })
  pressedByKey(node, onPress)
  return node
}
