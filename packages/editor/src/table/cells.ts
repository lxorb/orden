import type { EditorView } from '@codemirror/view'
import { selectionIn } from './caret'
import { renderInline } from './inline'
import type { TableModel } from './model'
import type { CellAddress, Side } from './navigation'

export function showRendered(cell: HTMLElement) {
  cell.replaceChildren(renderInline(cell.dataset.source ?? ''))
}
export function showSource(cell: HTMLElement) {
  cell.replaceChildren(document.createTextNode(cell.dataset.source ?? ''))
}
export function posOnRow(view: EditorView, line: { from: number; to: number }, side: Side, x: number) {
  const anchor = side === 'above' ? view.coordsAtPos(line.to, -1) : view.coordsAtPos(line.from, 1)
  if (!anchor) return side === 'above' ? line.to : line.from
  const pos = view.posAtCoords({ x, y: (anchor.top + anchor.bottom) / 2 })
  return pos === null ? line.from : Math.max(line.from, Math.min(line.to, pos))
}
export function collapsedAt(cell: HTMLElement, offset: number): boolean {
  const selection = selectionIn(cell)
  return selection !== null && selection.from === offset && selection.to === offset
}
export const attached = (node: Node): boolean => node.isConnected
export const sameCell = (a: CellAddress, b: CellAddress | undefined): boolean =>
  a.row === b?.row && a.column === b.column
export function element<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string) {
  const node = document.createElement(tag)
  if (className) node.className = className
  return node
}
export const PASTE_TEXT = 'orden:paste-text'
export const WINDOWED = 150
export const AROUND = 40
export const GUESSED_ROW = 32
export function drawStill(wrap: HTMLElement, model: TableModel) {
  const cell = (tag: 'th' | 'td', text: string, row: number, column: number) => {
    const one = element(tag)
    one.dataset.row = String(row)
    one.dataset.column = String(column)
    one.dataset.source = text
    showRendered(one)
    const align = model.align[column]
    if (align) one.style.textAlign = align
    return one
  }
  const head = element('tr')
  model.header.forEach((text, column) => {
    const th = cell('th', text, -1, column)
    const width = model.pixels?.[column]
    if (width != null) th.style.width = `${width}px`
    head.append(th)
  })
  const body = element('tbody')
  const rows = model.rows.length
  const drawn = rows > WINDOWED ? 2 * AROUND : rows
  model.rows.slice(0, drawn).forEach((cells, row) => {
    const tr = element('tr')
    tr.dataset.row = String(row)
    tr.append(...cells.map((text, column) => cell('td', text, row, column)))
    body.append(tr)
  })
  if (drawn < rows) {
    const gap = element('tr', 'orden-table-gap')
    const td = element('td')
    td.colSpan = Math.max(1, model.header.length)
    td.style.height = `${(rows - drawn) * GUESSED_ROW}px`
    gap.append(td)
    body.append(gap)
  }
  const top = element('thead')
  top.append(head)
  const table = element('table', 'orden-table')
  table.append(top, body)
  const scroller = element('div', 'orden-table-scroll')
  scroller.append(table)
  wrap.replaceChildren(scroller)
}
