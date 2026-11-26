import { element } from './cells'
import type { CellAddress } from './navigation'

export type Axis = 'row' | 'column'
export interface ChromeHost {
  readonly dom: HTMLElement
  readonly scroller: HTMLElement
  readonly table: HTMLTableElement
  rows(): number
  columns(): number
  writable(): boolean
  focused(): CellAddress | null
  rowBox(row: number): DOMRect | null
  columnBox(column: number): DOMRect | null
  move(axis: Axis, from: number, to: number): void
  add(axis: Axis): void
  chose(axis: Axis, index: number, grip: HTMLElement): void
  lift(axis: Axis, index: number | null): void
}
const A_DRAG = 4
function glyph(path: string, box: string): SVGSVGElement {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', box)
  const shape = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  shape.setAttribute('d', path)
  svg.append(shape)
  return svg
}
function pressable(className: string, said: string, drawn: SVGSVGElement): HTMLButtonElement {
  const node = element('button', className)
  node.type = 'button'
  node.tabIndex = -1
  node.contentEditable = 'false'
  node.setAttribute('aria-label', said)
  node.append(drawn)
  return node
}
const dots = () => glyph('M3 3h.01M3 7h.01M3 11h.01M7 3h.01M7 7h.01M7 11h.01', '0 0 10 14')
const plus = () => glyph('M5 1.5v7M1.5 5h7', '0 0 10 10')
export class TableChrome {
  private readonly grips: Record<Axis, HTMLButtonElement>
  private readonly adds: Record<Axis, HTMLButtonElement>
  private readonly line = element('div', 'orden-table-drop')
  private readonly stands: Record<Axis, number> = { row: -1, column: -1 }
  private hovered: CellAddress | null = null
  private inside = false
  private carrying: (() => void) | null = null
  constructor(private readonly host: ChromeHost) {
    this.grips = {
      row: pressable('orden-table-grip orden-table-grip-row', 'Row', dots()),
      column: pressable('orden-table-grip orden-table-grip-column', 'Column', dots()),
    }
    this.adds = {
      row: pressable('orden-table-add orden-table-add-row', 'Add row', plus()),
      column: pressable('orden-table-add orden-table-add-column', 'Add column', plus()),
    }
    host.dom.append(this.grips.row, this.grips.column, this.adds.row, this.adds.column, this.line)
    for (const axis of ['row', 'column'] as const) {
      this.grips[axis].addEventListener('pointerdown', (event) => this.pressed(event, axis))
      this.adds[axis].addEventListener('mousedown', (event) => {
        event.preventDefault()
        if (event.button === 0) host.add(axis)
      })
    }
    host.dom.addEventListener('pointermove', (event) => {
      if (event.pointerType !== 'mouse' || this.carrying) return
      this.inside = true
      const cell = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-row][data-column]') : null
      if (cell && host.table.contains(cell)) {
        const at = { row: Number(cell.dataset.row), column: Number(cell.dataset.column) }
        if (at.row === this.hovered?.row && at.column === this.hovered.column) return
        this.hovered = at
      }
      this.place()
    })
    host.dom.addEventListener('pointerleave', () => {
      this.inside = false
      this.hovered = null
      this.place()
    })
    host.table.addEventListener('focusin', () => this.place())
    host.table.addEventListener('focusout', () => queueMicrotask(() => this.place()))
    host.scroller.addEventListener('scroll', () => this.place(), { passive: true })
  }
  indexOf(target: EventTarget | null): { axis: Axis; index: number } | null {
    if (!(target instanceof Node)) return null
    for (const axis of ['row', 'column'] as const) {
      if (this.grips[axis].contains(target)) return { axis, index: this.stands[axis] }
    }
    return null
  }
  destroy() {
    this.carrying?.()
  }
  place() {
    const { host } = this
    const focused = host.focused()
    const at = this.hovered ?? focused
    const near = host.writable() && (this.inside || focused !== null)
    host.dom.classList.toggle('is-near', near)
    const wrap = host.dom.getBoundingClientRect()
    const seen = host.scroller.getBoundingClientRect()
    const table = host.table.getBoundingClientRect()
    const row = near && at && at.row >= 0 && at.row < host.rows() ? host.rowBox(at.row) : null
    this.grips.row.classList.toggle('is-shown', row !== null)
    if (row && at) {
      this.stands.row = at.row
      this.grips.row.style.top = `${row.top - wrap.top + row.height / 2}px`
    }
    const column = near && at && at.column < host.columns() ? host.columnBox(at.column) : null
    const middle = column ? column.left + column.width / 2 : 0
    const reachable = column !== null && middle >= seen.left && middle <= seen.right
    this.grips.column.classList.toggle('is-shown', reachable)
    if (reachable && at) {
      this.stands.column = at.column
      this.grips.column.style.left = `${middle - wrap.left}px`
    }
    const right = Math.min(table.right, seen.right)
    this.adds.row.style.width = `${Math.max(0, right - table.left)}px`
    this.adds.row.style.top = `${table.bottom - wrap.top}px`
    this.adds.column.style.left = `${right - wrap.left}px`
    this.adds.column.style.height = `${table.height}px`
  }
  private pressed(event: PointerEvent, axis: Axis) {
    if (event.button !== 0) return
    event.preventDefault()
    const { host } = this
    const grip = this.grips[axis]
    const from = this.stands[axis]
    const start = axis === 'row' ? event.clientY : event.clientX
    const drags = event.pointerType === 'mouse'
    let slot: number | null = null
    const move = (moved: PointerEvent) => {
      if (!drags) return
      const now = axis === 'row' ? moved.clientY : moved.clientX
      if (slot === null && Math.abs(now - start) < A_DRAG) return
      if (slot === null) host.lift(axis, from)
      slot = this.slotAt(axis, now)
      host.dom.classList.add('is-moving')
      this.drawLine(axis, slot)
    }
    const done = () => {
      document.removeEventListener('pointermove', move)
      document.removeEventListener('pointerup', up)
      document.removeEventListener('pointercancel', done)
      host.dom.classList.remove('is-moving')
      host.lift(axis, null)
      this.line.classList.remove('is-shown')
      this.carrying = null
    }
    const up = () => {
      done()
      if (slot === null) host.chose(axis, from, grip)
      else {
        const to = slot > from ? slot - 1 : slot
        if (to !== from) host.move(axis, from, to)
      }
    }
    this.carrying = done
    document.addEventListener('pointermove', move)
    document.addEventListener('pointerup', up)
    document.addEventListener('pointercancel', done)
  }
  private boxes(axis: Axis): { index: number; from: number; to: number }[] {
    const { host } = this
    const count = axis === 'row' ? host.rows() : host.columns()
    const found = []
    for (let index = 0; index < count; index++) {
      const box = axis === 'row' ? host.rowBox(index) : host.columnBox(index)
      if (!box) continue
      found.push(axis === 'row' ? { index, from: box.top, to: box.bottom } : { index, from: box.left, to: box.right })
    }
    return found
  }
  private slotAt(axis: Axis, at: number): number {
    const boxes = this.boxes(axis)
    const under = boxes.find((box) => at < (box.from + box.to) / 2)
    const last = boxes[boxes.length - 1]
    return under ? under.index : last ? last.index + 1 : 0
  }
  private drawLine(axis: Axis, slot: number) {
    const { host, line } = this
    const boxes = this.boxes(axis)
    const before = boxes.find((box) => box.index === slot)
    const last = boxes[boxes.length - 1]
    const at = before ? before.from : last ? last.to : null
    if (at === null) return
    const wrap = host.dom.getBoundingClientRect()
    const seen = host.scroller.getBoundingClientRect()
    const table = host.table.getBoundingClientRect()
    const right = Math.min(table.right, seen.right)
    line.classList.add('is-shown')
    line.dataset.axis = axis
    if (axis === 'row') {
      line.style.top = `${at - wrap.top - 1}px`
      line.style.left = `${table.left - wrap.left}px`
      line.style.width = `${right - table.left}px`
      line.style.height = '2px'
    } else {
      line.style.left = `${at - wrap.left - 1}px`
      line.style.top = `${table.top - wrap.top}px`
      line.style.height = `${table.height}px`
      line.style.width = '2px'
    }
  }
}
