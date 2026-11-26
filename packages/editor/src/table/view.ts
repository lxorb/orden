import {
  type ChangeSet,
  type ChangeSpec,
  EditorSelection,
  MapMode,
  type Text,
  type StateCommand,
  type StateEffect,
  Transaction,
} from '@codemirror/state'
import type { Command, EditorView } from '@codemirror/view'
import { linkOpener, modifier } from '../links'
import { redoEdit, undoEdit } from '../shared'
import {
  AROUND,
  attached,
  collapsedAt,
  element,
  GUESSED_ROW,
  PASTE_TEXT,
  posOnRow,
  sameCell,
  showRendered,
  showSource,
  WINDOWED,
} from './cells'
import { type Axis, TableChrome } from './chrome'
import { cellEntries, columnEntries, rowEntries, type TableActs, type TableEntry } from './menu'
import {
  type CellRange,
  clamped,
  columnRange,
  coversTable,
  extended,
  filled,
  gridHtml,
  gridIn,
  gridText,
  inRect,
  rectOf,
  rowRange,
  type Way,
  wholeTable,
} from './range'
import {
  caretAtEdge,
  caretOffset,
  caretRect,
  focusOffset,
  offsetAtPoint,
  selectAtPoint,
  selectIn,
  selectionIn,
  textRows,
} from './caret'
import {
  type Align,
  columnWidth,
  columnWidths,
  duplicateColumn,
  duplicateRow,
  afterRow,
  paddedWidth,
  parseTable,
  sameModel,
  serializeRow,
  serializeTable,
  setCell,
  setPixels,
  type TableModel,
} from './model'
import {
  type CellAddress,
  type Side,
  cellAbove,
  cellAfter,
  cellBefore,
  cellBelow,
  firstCell,
  lastCell,
  lineBeside,
  type TableSpan,
  tableAt,
  changesDuring,
  tableWrite,
  writingTable,
} from './navigation'
import {
  alignedColumn,
  type Edit,
  type Focus,
  insertedColumn,
  insertedRow,
  movedColumn,
  movedRow,
  removedColumn,
  removedRow,
} from './edits'
import { sourceOffset } from './inline'
import { edited } from './widget'
import { inlineShortcut, runInCell } from './shortcuts'

export interface TableSource {
  source: string
  from: number
  to: number
}
export type Placement = 'start' | 'end' | 'all' | { x: number; edge: 'top' | 'bottom' }
export type Landing = 'start' | 'end' | { x: number }
const STEP = 20
const WAYS: Record<string, Way> = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right' }
const addressOf = (cell: HTMLElement): CellAddress => ({
  row: Number(cell.dataset.row),
  column: Number(cell.dataset.column),
})
export interface TableMenu {
  entries: TableEntry[]
  cell: HTMLElement | null
  picked: boolean
}
export class TableView {
  readonly dom: HTMLElement
  private readonly scroller: HTMLElement
  private readonly table: HTMLTableElement
  private readonly chrome: TableChrome
  private readonly box = element('div', 'orden-table-pick')
  private range: CellRange | null = null
  private claims = false
  private model: TableModel
  private source: string
  private pending: { at: CellAddress; value: string } | null = null
  private start: number | null = null
  private aligned: number[] | null = null
  private expected: { source: string; model: TableModel; widths: number[] } | null = null
  private focusAfter: Focus | null = null
  private composing = false
  private sizing: { column: number; width: number } | null = null
  private dragging: (() => void) | null = null
  private editable: boolean
  private body: HTMLTableSectionElement | null = null
  private readonly drawn = new Map<number, HTMLTableRowElement>()
  private readonly heights = new Map<number, number>()
  private shown = { from: 0, to: 0 }
  private guess = GUESSED_ROW
  private drawnFor = -1
  private fitted: number[] | null = null
  private frame = 0
  private gaps: IntersectionObserver | null = null
  private following = false
  constructor(
    readonly editor: EditorView,
    text: TableSource,
    model: TableModel,
    dom: HTMLElement,
  ) {
    this.model = model
    this.source = text.source
    this.start = text.from
    this.editable = !editor.state.readOnly
    this.dom = dom
    dom.replaceChildren()
    this.scroller = element('div', 'orden-table-scroll')
    this.table = element('table', 'orden-table')
    this.scroller.append(this.table, this.box)
    this.dom.append(this.scroller)
    this.chrome = new TableChrome({
      dom: this.dom,
      scroller: this.scroller,
      table: this.table,
      rows: () => this.model.rows.length,
      columns: () => this.model.header.length,
      writable: () => this.editable,
      focused: () => this.focusedCell()?.at ?? null,
      rowBox: (row) => this.drawn.get(row)?.getBoundingClientRect() ?? null,
      columnBox: (column) => this.headerCell(column)?.getBoundingClientRect() ?? null,
      move: (axis, from, to) => {
        this.range = null
        if (axis === 'row') this.moveRowBy(from, to - from)
        else this.moveColumnBy(from, to - from)
      },
      add: (axis) => {
        const column = this.focusedCell()?.at.column ?? 0
        this.range = null
        this.claims = true
        if (axis === 'row') this.apply(insertedRow(this.current(), this.model.rows.length - 1, column))
        else this.insertColumnAfter(this.model.header.length - 1)
      },
      chose: (axis, index, grip) => this.chose(axis, index, grip),
      resized: () => this.editor.requestMeasure(),
      lift: (axis, index) => {
        for (const cell of this.table.querySelectorAll<HTMLElement>('[data-row][data-column]')) {
          const at = addressOf(cell)
          cell.classList.toggle('is-lifted', index !== null && (axis === 'row' ? at.row : at.column) === index)
        }
      },
    })
    this.render()
  }
  span(): TableSpan | null {
    const { editor, dom } = this
    if (!editor.contentDOM.contains(dom)) return null
    const at = Math.min(editor.posAtDOM(dom), editor.state.doc.length)
    return tableAt(editor.state, editor.state.doc.lineAt(at).to)
  }
  continues(text: TableSource): boolean {
    return this.start === text.from
  }
  get tracked(): number | null {
    return this.start
  }
  get length(): number {
    return this.source.length
  }
  track(changes: ChangeSet, doc: Text) {
    const { start } = this
    if (start === null) return
    const exact = changes.mapPos(start, 1, MapMode.TrackAfter)
    if (exact !== null) {
      this.start = exact
      return
    }
    this.start = null
    const header = headerOf(this.source)
    changes.iterChanges((fromA, toA, fromB, toB) => {
      if (start < fromA || start >= toA) return
      const aimed = fromB + (start - fromA)
      let nearest: number | null = null
      for (let pos = fromB; pos < toB;) {
        const line = doc.lineAt(pos)
        if (line.to <= toB && headerOf(line.text) === header) {
          if (nearest === null || Math.abs(line.from - aimed) < Math.abs(nearest - aimed)) {
            nearest = line.from
          }
        }
        pos = line.to + 1
      }
      this.start = nearest
    })
  }
  sameTable(model: TableModel): boolean {
    return this.model.header.every((text, column) => model.header[column] === text)
  }
  private placeOf(model: TableModel): CellAddress | null {
    const { pending } = this
    if (!pending) return null
    const { row, column } = pending.at
    const written = setCell(this.model, row, column, pending.value)
    const mine = (row < 0 ? written.header : written.rows[row]) ?? []
    const cell = mine[column]?.trim()
    if (cell === undefined) return null
    if (row < 0) return model.header[column] === cell ? pending.at : null
    const whole = (cells: string[] | undefined) =>
      cells?.length === mine.length && cells.every((text, at) => text === (at === column ? cell : mine[at]))
    if (whole(model.rows[row])) return pending.at
    const found = model.rows.flatMap((cells, at) => (whole(cells) ? [at] : []))
    if (found.length === 1 && found[0] !== undefined) return { row: found[0], column }
    if (found.length > 1) return null
    return model.rows[row]?.[column] === cell ? pending.at : null
  }
  adopt(text: TableSource, model: TableModel) {
    const before = this.model
    const place = this.placeOf(model)
    const kept = place !== null
    if (place && this.pending && !sameCell(place, this.pending.at)) {
      const focused = this.focusedCell()
      if (focused && !this.focusAfter) this.focusAfter = { at: place, offset: focused.offset }
      this.pending = { at: place, value: this.pending.value }
    }
    const pending = kept ? this.pending : null
    const incoming = pending ? setCell(model, pending.at.row, pending.at.column, pending.value) : model
    const shown = sameModel(incoming, this.current())
    const expected = this.expected?.source === text.source ? this.expected : null
    this.aligned = expected ? expected.widths : null
    this.source = text.source
    this.start = text.from
    this.model = model
    if (!kept) this.clearPending()
    if (shown && this.editable === !this.editor.state.readOnly) {
      this.focusAfter = null
      return
    }
    if (this.composing && !this.focusAfter && this.editable === !this.editor.state.readOnly) {
      if (this.patch(before)) return
    }
    this.editable = !this.editor.state.readOnly
    this.render()
  }
  private patch(before: TableModel): boolean {
    const { model } = this
    const same =
      before.header.length === model.header.length &&
      before.rows.length === model.rows.length &&
      before.align.every((align, column) => model.align[column] === align)
    if (!same) return false
    const focused = this.focusedCell()?.at
    if (focused && textIn(model, focused) !== textIn(before, focused)) return false
    if (focused && movedAway(before, model, focused.row)) return false
    for (const cell of this.table.querySelectorAll<HTMLElement>('[data-row][data-column]')) {
      const at = { row: Number(cell.dataset.row), column: Number(cell.dataset.column) }
      if (sameCell(at, focused)) continue
      const text = this.shownText(at, textIn(model, at))
      if (cell.dataset.source === text) continue
      cell.dataset.source = text
      showRendered(cell)
    }
    return true
  }
  modelFor(source: string): TableModel | null {
    return this.expected?.source === source ? this.expected.model : parseTable(source)
  }
  focusState(): { at: CellAddress; offset: number } | null {
    return this.focusedCell()
  }
  destroy() {
    this.clearPending()
    this.sizing = null
    this.dragging?.()
    this.chrome.destroy()
    this.unfollow()
  }
  flush() {
    if (this.pending) this.commit(this.current())
  }
  enter(side: Side, where: Landing): boolean {
    if (where === 'start') return this.focusCell(firstCell, 'start')
    if (where === 'end') return this.focusCell(lastCell(this.model), 'end')
    const row = side === 'above' ? -1 : this.model.rows.length - 1
    const column = this.columnAt(row, where.x)
    return this.focusCell({ row, column }, { x: where.x, edge: side === 'above' ? 'top' : 'bottom' })
  }
  focusCell(at: CellAddress, placement: Placement | number): boolean {
    if (this.editor.state.readOnly) return false
    if (this.range) this.pick(null)
    const { model } = this
    const row = Math.min(at.row, model.rows.length - 1)
    this.reach(row)
    const cell = this.cellAt({ row, column: Math.min(at.column, model.header.length - 1) })
    if (!cell) return false
    cell.focus()
    const length = cell.textContent.length
    if (typeof placement === 'number') selectIn(cell, Math.min(placement, length))
    else if (placement === 'start') selectIn(cell, 0)
    else if (placement === 'end') selectIn(cell, length)
    else if (placement === 'all') selectIn(cell, 0, length)
    else {
      const rows = textRows(cell)
      const row = placement.edge === 'top' ? rows[0] : rows[rows.length - 1]
      if (!row) selectIn(cell, 0)
      else {
        const x = Math.max(row.left, Math.min(row.right - 1, placement.x))
        selectAtPoint(cell, x, (row.top + row.bottom) / 2)
      }
    }
    return true
  }
  leave(side: Side, where: Landing) {
    this.flush()
    const { editor } = this
    const span = this.span()
    if (!span) return
    const line = lineBeside(editor.state, span, side)
    let pos = line.from
    if (!line.made) {
      if (where === 'end') pos = line.to
      else if (typeof where === 'object') pos = posOnRow(editor, line, side, where.x)
    }
    const goal = typeof where === 'object' ? where.x - editor.contentDOM.getBoundingClientRect().left : undefined
    editor.dispatch({
      changes: line.changes,
      selection: EditorSelection.create([EditorSelection.cursor(pos, undefined, undefined, goal)]),
      scrollIntoView: true,
    })
    editor.focus()
  }
  private current(): TableModel {
    const { pending, model } = this
    return pending ? setCell(model, pending.at.row, pending.at.column, pending.value) : model
  }
  private commit(next: TableModel, focus?: Focus) {
    if (this.editor.state.readOnly) {
      this.clearPending()
      return
    }
    this.focusAfter = focus ?? null
    const widths = columnWidths(next)
    this.write(serializeTable(next, widths), 'input', next, widths)
    this.clearPending()
    this.focusAfter = null
  }
  private write(text: string, userEvent: string, model: TableModel, widths: number[]): boolean {
    const { editor } = this
    const from = this.span()?.from ?? this.start
    if (from === null) return false
    if (text === this.source) {
      this.aligned = widths
      return false
    }
    if (editor.state.doc.sliceString(from, from + this.source.length) !== this.source) return false
    this.keepCaretBeside(from, from + this.source.length)
    this.expected = { source: text, model, widths }
    try {
      editor.dispatch({
        changes: lineChanges(from, this.source, text),
        userEvent,
        annotations: tableWrite.of(true),
      })
    } finally {
      this.expected = null
    }
    return true
  }
  private keepCaretBeside(from: number, to: number) {
    const { state } = this.editor
    const blank = (pos: number) => !state.doc.lineAt(pos).text.trim()
    const beside = [to + 1, from - 1].find((pos) => pos >= 0 && pos <= state.doc.length && blank(pos))
    if (beside === undefined) return
    const { main } = state.selection
    if (state.selection.ranges.length === 1 && main.empty && main.head === beside) return
    this.editor.dispatch({
      selection: { anchor: beside },
      annotations: [tableWrite.of(true), Transaction.addToHistory.of(false)],
    })
  }
  private typeIn(at: CellAddress) {
    const next = this.current()
    const widths = this.aligned
    if (!widths) {
      const fresh = columnWidths(next)
      this.write(serializeTable(next, fresh), 'input.type', next, fresh)
      return
    }
    const { row, column } = at
    const before = (row < 0 ? this.model.header : this.model.rows[row])?.[column] ?? ''
    const cells = (row < 0 ? next.header : next.rows[row]) ?? []
    const now = cells[column] ?? ''
    const width = widths[column] ?? 0
    let wide = width
    if (paddedWidth(now) > width) wide = paddedWidth(now)
    else if (paddedWidth(before) >= width) wide = columnWidth(next, column)
    const sized = widths.slice()
    sized[column] = wide
    if (wide !== width) {
      this.write(serializeTable(next, sized), 'input.type', next, sized)
      return
    }
    const lines = this.source.split('\n')
    lines[row < 0 ? 0 : row + 2] = serializeRow(cells, sized) + (row < 0 ? '' : afterRow(next, row))
    this.write(lines.join('\n'), 'input.type', next, sized)
  }
  private clearPending() {
    this.pending = null
    if (edited.table === this) edited.table = null
  }
  private shownText(at: CellAddress, text: string): string {
    const { pending } = this
    return pending && sameCell(at, pending.at) ? pending.value : text
  }
  private render() {
    const { model } = this
    const focus = this.focusAfter ?? this.focusedCell()
    this.focusAfter = null
    const windowed = this.windowed()
    const head = element('thead')
    const headRow = element('tr')
    head.append(headRow)
    if (this.fitted?.length !== model.header.length) this.fitted = null
    model.header.forEach((text, column) => {
      const at = { row: -1, column }
      const th = this.cell(this.shownText(at, text), at, 'th', !this.range && sameCell(at, focus?.at))
      const grip = element('span', 'orden-table-resize')
      grip.contentEditable = 'false'
      grip.title = 'Drag to resize, double click to fit'
      grip.addEventListener('mousedown', (event) => this.startResize(event, th, column))
      grip.addEventListener('dblclick', () => {
        if (this.pixels(column) !== null) this.commit(setPixels(this.current(), column, null))
      })
      th.append(grip)
      const width = this.pixels(column) ?? (windowed ? this.fitted?.[column] : undefined)
      if (width != null) th.style.width = `${width}px`
      headRow.append(th)
    })
    const rows = model.rows.length
    if (rows !== this.drawnFor) this.heights.clear()
    this.drawnFor = rows
    this.body = element('tbody')
    this.drawn.clear()
    if (!windowed) this.shown = { from: 0, to: rows }
    else if (focus && focus.at.row >= 0) this.shown = around(focus.at.row, rows)
    else if (this.shown.from >= rows || this.shown.to - this.shown.from < 2 * AROUND)
      this.shown = { from: 0, to: Math.min(rows, 2 * AROUND) }
    else this.shown = { from: this.shown.from, to: Math.min(rows, this.shown.to) }
    this.fill(focus?.at)
    this.table.replaceChildren(head, this.body)
    this.fitWidth()
    if (windowed) this.follow()
    else this.unfollow()
    if (focus) {
      const claims = this.claims
      queueMicrotask(() => {
        if (!claims && document.activeElement === this.editor.contentDOM) return
        if (this.range) this.pick(this.range)
        else this.focusCell(focus.at, focus.offset)
      })
    }
    this.claims = false
    this.range = this.range && clamped(model, this.range)
    this.paint()
    this.chrome.place()
  }
  private fitWidth() {
    const { fitted } = this
    const fixed = this.windowed() && fitted !== null
    this.table.classList.toggle('orden-table-windowed', fixed)
    this.table.style.width = fixed
      ? `${fitted.reduce((sum, one, column) => sum + (this.pixels(column) ?? one), 0)}px`
      : ''
  }
  private fit() {
    const heads = [...this.table.querySelectorAll<HTMLElement>('thead th')]
    const widths = heads.map((th) => th.getBoundingClientRect().width)
    if (!widths.length || widths.some((one) => one <= 0)) return
    this.fitted = widths
    heads.forEach((th, column) => {
      th.style.width = `${this.pixels(column) ?? widths[column]}px`
    })
    this.fitWidth()
  }
  private pixels(column: number): number | null {
    if (this.sizing?.column === column) return this.sizing.width
    return this.model.pixels?.[column] ?? null
  }
  private windowed(): boolean {
    return this.model.rows.length > WINDOWED
  }
  private row(index: number, editing?: CellAddress): HTMLTableRowElement {
    const held = this.drawn.get(index)
    if (held) return held
    const tr = element('tr')
    tr.dataset.row = String(index)
    const cells = (this.model.rows[index] ?? []).map((text, column) => {
      const at = { row: index, column }
      return this.cell(this.shownText(at, text), at, 'td', !this.range && sameCell(at, editing))
    })
    tr.append(...cells)
    this.drawn.set(index, tr)
    return tr
  }
  private gap(from: number, to: number): HTMLTableRowElement {
    const tr = element('tr', 'orden-table-gap')
    tr.setAttribute('aria-hidden', 'true')
    const td = element('td')
    td.colSpan = Math.max(1, this.model.header.length)
    let height = 0
    for (let row = from; row < to; row++) height += this.heights.get(row) ?? this.guess
    td.style.height = `${height}px`
    tr.append(td)
    return tr
  }
  private fill(editing?: CellAddress) {
    const { body } = this
    if (!body) return
    const rows = this.model.rows.length
    const { from, to } = this.shown
    const kept = this.focusedCell()?.at.row ?? -1
    const spans: [number, number][] = [[from, to]]
    if (kept >= 0 && kept < rows && (kept < from || kept >= to)) {
      spans.push([kept, kept + 1])
      spans.sort((one, other) => one[0] - other[0])
    }
    const wanted: HTMLTableRowElement[] = []
    const showing = new Set<number>()
    let at = 0
    for (const [start, end] of spans) {
      if (start > at) wanted.push(this.gap(at, start))
      for (let index = start; index < end; index++) {
        wanted.push(this.row(index, editing))
        showing.add(index)
      }
      at = end
    }
    if (at < rows) wanted.push(this.gap(at, rows))
    for (const index of this.drawn.keys()) if (!showing.has(index)) this.drawn.delete(index)
    const held = kept >= 0 ? this.drawn.get(kept) : undefined
    for (const child of [...body.children]) if (child !== held) child.remove()
    if (!held?.isConnected) body.append(...wanted)
    else {
      const place = wanted.indexOf(held)
      held.before(...wanted.slice(0, place))
      held.after(...wanted.slice(place + 1))
    }
    if (this.gaps) {
      this.gaps.disconnect()
      for (const one of wanted) if (one.classList.contains('orden-table-gap')) this.gaps.observe(one)
    }
    if (this.range) this.paint()
  }
  private reach(row: number) {
    if (!this.windowed() || row < 0 || this.drawn.has(row)) return
    this.shown = around(row, this.model.rows.length)
    this.fill()
  }
  private follow() {
    if (this.following) {
      this.schedule()
      return
    }
    this.following = true
    document.addEventListener('scroll', this.schedule, { capture: true, passive: true })
    window.addEventListener('resize', this.schedule, { passive: true })
    if (typeof IntersectionObserver !== 'undefined') {
      this.gaps = new IntersectionObserver(this.schedule, { rootMargin: '50%' })
      for (const one of this.body?.querySelectorAll('.orden-table-gap') ?? []) this.gaps.observe(one)
    }
    this.schedule()
  }
  private unfollow() {
    if (!this.following) return
    this.following = false
    document.removeEventListener('scroll', this.schedule, { capture: true })
    window.removeEventListener('resize', this.schedule)
    this.gaps?.disconnect()
    this.gaps = null
    cancelAnimationFrame(this.frame)
    this.frame = 0
  }
  private readonly schedule = () => {
    if (this.frame) return
    this.frame = requestAnimationFrame(() => {
      this.frame = 0
      this.look()
    })
  }
  private look() {
    const { body } = this
    if (!body?.isConnected || !this.windowed()) return
    if (!this.fitted) this.fit()
    for (const [index, tr] of this.drawn) {
      const height = tr.getBoundingClientRect().height
      if (height > 0) this.heights.set(index, height)
    }
    if (this.heights.size > 0) {
      let sum = 0
      for (const one of this.heights.values()) sum += one
      this.guess = sum / this.heights.size
    }
    const box = body.getBoundingClientRect()
    if (box.height === 0) return
    const frame = this.editor.scrollDOM.getBoundingClientRect()
    const top = Math.max(frame.top, 0) - box.top
    const bottom = Math.min(frame.bottom, window.innerHeight) - box.top
    if (bottom < 0 || top > box.height) return
    const rows = this.model.rows.length
    const first = this.rowAtY(top)
    const last = this.rowAtY(bottom)
    const from = Math.max(0, Math.floor((first - AROUND) / STEP) * STEP)
    const to = Math.min(rows, Math.ceil((last + 1 + AROUND) / STEP) * STEP)
    if (from === this.shown.from && to === this.shown.to) return
    this.shown = { from, to }
    this.fill()
  }
  private rowAtY(y: number): number {
    const rows = this.model.rows.length
    let at = 0
    for (let row = 0; row < rows; row++) {
      at += this.heights.get(row) ?? this.guess
      if (at > y) return row
    }
    return rows - 1
  }
  private followedLink(event: MouseEvent): boolean {
    const asked = event.button === 1 || (event.button === 0 && (modifier(event) || this.editor.state.readOnly))
    const target = event.target instanceof Element ? event.target.closest('a[href]') : null
    const href = target?.getAttribute('href')
    if (!asked || !href) return false
    event.preventDefault()
    event.stopPropagation()
    this.editor.state.facet(linkOpener)(href, event)
    return true
  }
  private cell(text: string, at: CellAddress, tag: 'th' | 'td', editing: boolean) {
    const cell = element(tag)
    cell.contentEditable = this.editable ? 'true' : 'false'
    cell.spellcheck = true
    cell.dataset.row = String(at.row)
    cell.dataset.column = String(at.column)
    cell.dataset.source = text
    if (editing) showSource(cell)
    else showRendered(cell)
    const align = this.model.align[at.column]
    if (align) cell.style.textAlign = align
    cell.addEventListener('auxclick', (event) => {
      if (event.target instanceof Element && event.target.closest('a[href]')) event.preventDefault()
    })
    cell.addEventListener('click', (event) => {
      if (event.target instanceof Element && event.target.closest('a[href]')) event.preventDefault()
    })
    cell.addEventListener('mousedown', (event) => {
      if (this.followedLink(event)) return
      if (this.editor.state.readOnly) return
      if (event.target instanceof Element && event.target.closest('.orden-table-resize')) return
      if (event.button !== 0) {
        if (this.range && !inRect(rectOf(this.range), at)) this.pick(null)
        return
      }
      const from = event.shiftKey ? (this.range?.anchor ?? this.focusedCell()?.at) : undefined
      if (from && !sameCell(from, at)) {
        event.preventDefault()
        this.pick({ anchor: from, head: at })
        return
      }
      if (this.range) this.pick(null)
      let pressed: number | null = null
      if (document.activeElement !== cell) {
        const source = cell.dataset.source ?? ''
        const shown = offsetAtPoint(cell, event.clientX, event.clientY)
        const drawn = cell.textContent !== source
        event.preventDefault()
        cell.focus()
        if (shown === null) selectAtPoint(cell, event.clientX, event.clientY)
        else selectIn(cell, drawn ? sourceOffset(source, shown) : shown)
        pressed = caretOffset(cell)
      }
      this.trackPress(cell, at, pressed)
    })
    cell.addEventListener('focus', () => {
      if (!this.range) showSource(cell)
    })
    cell.addEventListener('blur', () => {
      this.composing = false
      queueMicrotask(() => {
        this.left(cell, at)
        const now = document.activeElement
        if (this.range && now && !this.dom.contains(now) && this.editor.dom.contains(now)) this.pick(null)
      })
    })
    cell.addEventListener('copy', (event) => this.copied(event, false))
    cell.addEventListener('cut', (event) => this.copied(event, true))
    cell.addEventListener('input', (event) => {
      if (!(event as InputEvent).isComposing) this.edited(cell, at)
    })
    cell.addEventListener('compositionstart', () => (this.composing = true))
    cell.addEventListener('compositionend', () => {
      this.composing = false
      this.edited(cell, at)
    })
    cell.addEventListener('keydown', (event) => this.keyInCell(event, cell, at))
    cell.addEventListener('beforeinput', (event) => this.inputInCell(event, cell, at))
    cell.addEventListener('paste', (event) => this.pasteInCell(event, cell, at))
    cell.addEventListener(PASTE_TEXT, (event) => {
      if (event instanceof CustomEvent && typeof event.detail === 'string') this.pasted('', event.detail, cell, at)
    })
    return cell
  }
  private edited(cell: HTMLElement, at: CellAddress) {
    if (!attached(cell)) return
    if (this.editor.state.readOnly) {
      cell.blur()
      return
    }
    this.pending = { at, value: cell.textContent }
    edited.table = this
    this.typeIn(at)
  }
  private left(cell: HTMLElement, at: CellAddress) {
    if (!attached(cell)) return
    this.flush()
    if (!attached(cell)) return
    cell.dataset.source = this.textOf(at)
    showRendered(cell)
  }
  private keyInCell(event: KeyboardEvent, cell: HTMLElement, at: CellAddress) {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the one sign Safari gives
    if (event.isComposing || event.keyCode === 229) return
    if (this.range && this.keyInRange(event, this.range)) return
    const mod = event.ctrlKey || event.metaKey
    const key = event.key
    const way = WAYS[key]
    if (way && event.shiftKey && !mod && !event.altKey) {
      const caret = focusOffset(cell)
      const length = cell.textContent.length
      const atEdge =
        way === 'left'
          ? caret === 0
          : way === 'right'
            ? caret === length
            : caretAtEdge(cell, way === 'up' ? 'top' : 'bottom')
      if (!atEdge) return
      event.preventDefault()
      this.pick(extended(this.current(), { anchor: at, head: at }, way))
      return
    }
    if ((way === 'up' || way === 'down') && event.altKey && !mod && !event.shiftKey) {
      event.preventDefault()
      event.stopPropagation()
      if (at.row >= 0) this.moveRowBy(at.row, way === 'up' ? -1 : 1)
      return
    }
    if (key === 'Tab' && !mod && !event.altKey) {
      event.preventDefault()
      const next = event.shiftKey ? cellBefore(this.model, at) : cellAfter(this.model, at)
      if (next === 'below') this.growBelow(0)
      else if (next === 'above') this.leave('above', 'end')
      else this.focusCell(next, 'all')
      return
    }
    if (key === 'Enter') {
      event.preventDefault()
      if (event.shiftKey) {
        this.typeInCell('<br>', cell, at)
        return
      }
      const next = cellBelow(this.model, at)
      if (next === 'below') this.growBelow(at.column)
      else this.focusCell(next, 'end')
      return
    }
    if (key === 'Escape') {
      event.preventDefault()
      this.leave('below', 'start')
      return
    }
    if (mod && !event.altKey) {
      const lower = key.toLowerCase()
      if (lower === 'z' && !event.shiftKey) {
        this.history(event, undoEdit, cell, at)
        return
      }
      if (lower === 'y' || (lower === 'z' && event.shiftKey)) {
        this.history(event, redoEdit, cell, at)
        return
      }
      if (lower === 'a' && !event.shiftKey) {
        event.preventDefault()
        const chosen = selectionIn(cell)
        const length = cell.textContent.length
        if (chosen?.from === 0 && chosen.to === length) this.pick(wholeTable(this.current()))
        else selectIn(cell, 0, length)
        return
      }
    }
    const inline = inlineShortcut(event)
    if (inline) {
      event.preventDefault()
      this.runInline(inline, cell, at)
      return
    }
    if (mod || event.altKey || event.shiftKey) return
    switch (key) {
      case 'ArrowUp':
        if (!caretAtEdge(cell, 'top')) return
        event.preventDefault()
        this.stepVertically(cellAbove(at), cell, 'above')
        return
      case 'ArrowDown':
        if (!caretAtEdge(cell, 'bottom')) return
        event.preventDefault()
        this.stepVertically(cellBelow(this.model, at), cell, 'below')
        return
      case 'ArrowLeft': {
        if (!collapsedAt(cell, 0)) return
        event.preventDefault()
        const previous = cellBefore(this.model, at)
        if (previous === 'above') this.leave('above', 'end')
        else if (previous !== 'below') this.focusCell(previous, 'end')
        return
      }
      case 'ArrowRight': {
        if (!collapsedAt(cell, cell.textContent.length)) return
        event.preventDefault()
        const next = cellAfter(this.model, at)
        if (next === 'below') this.leave('below', 'start')
        else if (next !== 'above') this.focusCell(next, 'start')
        return
      }
    }
  }
  private stepVertically(step: CellAddress | Side, cell: HTMLElement, side: Side) {
    const x = (caretRect() ?? cell.getBoundingClientRect()).left
    if (typeof step === 'string') this.leave(side, { x })
    else this.focusCell(step, { x, edge: side === 'above' ? 'bottom' : 'top' })
  }
  private growBelow(column: number) {
    const rows = this.model.rows.length
    this.apply(insertedRow(this.current(), rows - 1, column))
  }
  private history(event: Event, command: Command, cell: HTMLElement, at: CellAddress) {
    event.preventDefault()
    this.flush()
    this.focusAfter = { at, offset: caretOffset(cell) }
    const scroll = this.editor.scrollSnapshot()
    const made = changesDuring(this.editor, () => writingTable(() => command(this.editor)))
    const kept = made.reduce<StateEffect<unknown> | undefined>((effect, changes) => effect?.map(changes), scroll)
    if (kept) this.editor.dispatch({ effects: kept, annotations: tableWrite.of(true) })
    this.focusAfter = null
  }
  private runInline(command: StateCommand, cell: HTMLElement, at: CellAddress) {
    const selection = selectionIn(cell)
    if (!selection) return
    const result = runInCell(command, cell.textContent, selection.from, selection.to)
    if (!result) return
    cell.textContent = result.text
    selectIn(cell, result.from, result.to)
    this.edited(cell, at)
  }
  private inputInCell(event: InputEvent, cell: HTMLElement, at: CellAddress) {
    const type = event.inputType
    if (type.startsWith('format') || type === 'insertParagraph' || type === 'insertLineBreak') {
      event.preventDefault()
    } else if (type === 'historyUndo') {
      this.history(event, undoEdit, cell, at)
    } else if (type === 'historyRedo') {
      this.history(event, redoEdit, cell, at)
    }
  }
  private pasteInCell(event: ClipboardEvent, cell: HTMLElement, at: CellAddress) {
    event.preventDefault()
    const held = event.clipboardData
    this.pasted(held?.getData('text/html') ?? '', held?.getData('text/plain') ?? '', cell, at)
  }
  private pasted(html: string, text: string, cell: HTMLElement, at: CellAddress) {
    if (this.editor.state.readOnly) return
    const plain = !text.includes('\t') && !/<table\b/i.test(html) && !text.includes('|')
    if (plain && this.range) {
      this.commit(filled(this.current(), rectOf(this.range), text.trim()))
      return
    }
    if (plain) {
      this.typeInCell(text, cell, at)
      return
    }
    void import('./spread')
      .then(({ gridOf }) => gridOf(html, text))
      .catch(() => null)
      .then((grid) => {
        if (!attached(cell) || this.editor.state.readOnly) return
        const rect = this.range && rectOf(this.range)
        if (!grid) this.typeInCell(text, cell, at)
        else {
          this.range = null
          this.apply(grid(this.current(), rect ? { row: rect.top, column: rect.left } : at))
        }
      })
  }
  private typeInCell(said: string, cell: HTMLElement, at: CellAddress) {
    if (this.editor.state.readOnly) return
    const text = said.replace(/[\r\n\t]+/g, ' ')
    if (!text) return
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- no replacement reaches the browser's own undo stack
    if (document.execCommand('insertText', false, text)) return
    const selection = selectionIn(cell)
    if (!selection) return
    const before = cell.textContent
    cell.textContent = before.slice(0, selection.from) + text + before.slice(selection.to)
    selectIn(cell, selection.from + text.length)
    this.edited(cell, at)
  }
  private toggleAlign(column: number, align: NonNullable<Align>) {
    this.apply(alignedColumn(this.current(), column, align, this.focusedCell() ?? undefined))
  }
  private moveColumnBy(column: number, step: number) {
    const current = this.current()
    const edit = movedColumn(current, column, step, this.focusedCell() ?? undefined)
    if (edit.next === current) return
    this.apply(edit)
  }
  private insertColumnAfter(column: number) {
    this.apply(insertedColumn(this.current(), column))
  }
  private moveRowBy(row: number, step: number) {
    this.apply(movedRow(this.current(), row, step, this.focusedCell() ?? undefined))
  }
  private apply(edit: Edit) {
    this.commit(edit.next, edit.focus)
  }
  private chose(axis: Axis, index: number, grip: HTMLElement) {
    const model = this.current()
    this.pick(axis === 'row' ? rowRange(model, index) : columnRange(model, index))
    const box = grip.getBoundingClientRect()
    grip.dispatchEvent(
      new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.left, clientY: box.bottom + 4 }),
    )
  }
  menuAt(target: EventTarget | null): TableMenu | null {
    if (!this.editable || this.editor.state.readOnly) return null
    const acts = this.acts()
    const grip = this.chrome.indexOf(target)
    if (grip) {
      const entries = grip.axis === 'row' ? rowEntries(acts, grip.index) : columnEntries(acts, grip.index)
      return { entries, cell: null, picked: true }
    }
    const cell = target instanceof Element ? target.closest<HTMLElement>('[data-row][data-column]') : null
    if (!cell || !this.table.contains(cell)) return null
    return { entries: cellEntries(acts, addressOf(cell)), cell, picked: this.range !== null }
  }
  private acts(): TableActs {
    const whole = (next: TableModel, at: CellAddress) => {
      this.claims = true
      this.range = null
      this.commit(next, { at, offset: 0 })
    }
    const emptied = (range: CellRange) => this.commit(filled(this.current(), rectOf(range), ''))
    const shaped = (edit: Edit) => {
      this.claims = true
      this.range = null
      this.apply(edit)
    }
    return {
      model: () => this.current(),
      insertRow: (at) => shaped(insertedRow(this.current(), at - 1)),
      duplicateRow: (row) => whole(duplicateRow(this.current(), row), { row: row + 1, column: 0 }),
      clearRow: (row) => emptied(rowRange(this.current(), row)),
      deleteRow: (row) => shaped(removedRow(this.current(), row, this.focusedCell() ?? undefined)),
      insertColumn: (at) => shaped(insertedColumn(this.current(), at - 1)),
      duplicateColumn: (column) => whole(duplicateColumn(this.current(), column), { row: -1, column: column + 1 }),
      clearColumn: (column) => emptied(columnRange(this.current(), column)),
      deleteColumn: (column) => shaped(removedColumn(this.current(), column, this.focusedCell() ?? undefined)),
      align: (column, side) => this.toggleAlign(column, side),
      sort: (column, order) => {
        const drawn = this.model
        const focus = this.focusedCell() ?? undefined
        void import('./sort').then(({ sortedColumn }) => {
          if (drawn === this.model) shaped(sortedColumn(this.current(), column, order, focus))
        })
      },
    }
  }
  covered(on: boolean) {
    this.dom.classList.toggle('is-covered', on)
  }
  private pick(range: CellRange | null) {
    const was = this.range
    if (range) this.flush()
    this.range = range && clamped(this.current(), range)
    if (this.range) {
      const { head } = this.range
      this.reach(head.row)
      const cell = this.cellAt(head)
      if (cell) {
        if (document.activeElement !== cell) cell.focus({ preventScroll: true })
        cell.dataset.source = this.textOf(head)
        showRendered(cell)
        selectIn(cell, 0)
      }
    } else if (was) {
      const focused = document.activeElement
      if (focused instanceof HTMLElement && this.table.contains(focused) && focused.dataset.row !== undefined) {
        showSource(focused)
      }
    }
    this.paint()
  }
  private paint() {
    const rect = this.range && rectOf(this.range)
    this.dom.classList.toggle('is-picking', rect !== null)
    for (const cell of this.table.querySelectorAll<HTMLElement>('[data-row][data-column]')) {
      cell.classList.toggle('is-picked', rect !== null && inRect(rect, addressOf(cell)))
    }
    const first = rect && this.cellAt({ row: rect.top, column: rect.left })?.getBoundingClientRect()
    const last = rect && this.cellAt({ row: rect.bottom, column: rect.right })?.getBoundingClientRect()
    this.box.classList.toggle('is-shown', !!first && !!last)
    if (!first || !last) return
    const frame = this.scroller.getBoundingClientRect()
    this.box.style.left = `${first.left - frame.left + this.scroller.scrollLeft}px`
    this.box.style.top = `${first.top - frame.top + this.scroller.scrollTop}px`
    this.box.style.width = `${last.right - first.left}px`
    this.box.style.height = `${last.bottom - first.top}px`
  }
  private trackPress(cell: HTMLElement, at: CellAddress, pressed: number | null) {
    const move = (moved: MouseEvent) => {
      const under = document.elementFromPoint(moved.clientX, moved.clientY)
      const found = under?.closest<HTMLElement>('[data-row][data-column]')
      if (!found || !this.table.contains(found)) return
      const over = addressOf(found)
      if (!this.range && sameCell(over, at)) {
        const offset = pressed === null ? null : offsetAtPoint(cell, moved.clientX, moved.clientY)
        if (pressed !== null && offset !== null) selectIn(cell, Math.min(pressed, offset), Math.max(pressed, offset))
        return
      }
      moved.preventDefault()
      if (!sameCell(over, this.range?.head)) this.pick({ anchor: at, head: over })
    }
    const done = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', done)
      this.dragging = null
    }
    this.dragging?.()
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', done)
    this.dragging = done
  }
  private copied(event: ClipboardEvent, taken: boolean) {
    const held = event.clipboardData
    if (!this.range || !held) return
    event.preventDefault()
    const rect = rectOf(this.range)
    const grid = gridIn(this.current(), rect)
    held.setData('text/plain', gridText(grid))
    held.setData('text/html', gridHtml(grid))
    if (taken) this.commit(filled(this.current(), rect, ''))
  }
  private keyInRange(event: KeyboardEvent, range: CellRange): boolean {
    const mod = event.ctrlKey || event.metaKey
    const key = event.key
    const way = WAYS[key]
    if (way && !mod && !event.altKey) {
      event.preventDefault()
      if (event.shiftKey) this.pick(extended(this.current(), range, way))
      else this.focusCell(range.head, 'end')
      return true
    }
    if (key === 'Escape' || key === 'Enter') {
      event.preventDefault()
      this.focusCell(range.head, key === 'Enter' ? 'all' : 'end')
      return true
    }
    if (key === 'Backspace' || key === 'Delete') {
      event.preventDefault()
      this.commit(filled(this.current(), rectOf(range), ''))
      return true
    }
    if (mod && !event.altKey && key.toLowerCase() === 'a') {
      event.preventDefault()
      if (coversTable(this.current(), range)) this.selectNote()
      else this.pick(wholeTable(this.current()))
      return true
    }
    if (key === 'Tab') this.pick(null)
    else if (!mod && !event.altKey && key.length === 1) {
      const rect = rectOf(range)
      this.focusCell({ row: rect.top, column: rect.left }, 'all')
    }
    return false
  }
  private selectNote() {
    this.pick(null)
    this.flush()
    const { editor } = this
    editor.dispatch({ selection: { anchor: 0, head: editor.state.doc.length }, userEvent: 'select' })
    editor.focus()
  }
  private startResize(event: MouseEvent, header: HTMLTableCellElement, column: number) {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = header.getBoundingClientRect().width
    const factor = getComputedStyle(header).direction === 'rtl' ? -1 : 1
    const move = (moved: MouseEvent) => {
      const width = Math.round(Math.max(48, startWidth + (moved.clientX - startX) * factor))
      this.sizing = { column, width }
      header.style.width = `${width}px`
      this.fitWidth()
    }
    const finish = () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', finish)
      this.dragging = null
      const sized = this.sizing
      this.sizing = null
      if (sized) this.commit(setPixels(this.current(), sized.column, sized.width), this.focusedCell() ?? undefined)
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', finish)
    this.dragging = finish
  }
  private cellAt(at: CellAddress): HTMLElement | null {
    return this.table.querySelector<HTMLElement>(`[data-row="${at.row}"][data-column="${at.column}"]`)
  }
  private headerCell(column: number): HTMLTableCellElement | null {
    return this.table.querySelector<HTMLTableCellElement>(`th[data-column="${column}"]`)
  }
  private focusedCell(): { at: CellAddress; offset: number } | null {
    const focused = document.activeElement
    if (!(focused instanceof HTMLElement) || !this.table.contains(focused)) return null
    if (focused.dataset.row === undefined) return null
    return {
      at: { row: Number(focused.dataset.row), column: Number(focused.dataset.column) },
      offset: caretOffset(focused),
    }
  }
  private columnAt(row: number, x: number): number {
    this.reach(row)
    const columns = this.model.header.length
    for (let column = 0; column < columns; column++) {
      const cell = this.cellAt({ row, column })
      if (cell && x < cell.getBoundingClientRect().right) return column
    }
    return columns - 1
  }
  private textOf(at: CellAddress): string {
    return textIn(this.model, at)
  }
}
function around(row: number, rows: number): { from: number; to: number } {
  return {
    from: Math.max(0, Math.floor((row - AROUND) / STEP) * STEP),
    to: Math.min(rows, Math.ceil((row + 1 + AROUND) / STEP) * STEP),
  }
}
function headerOf(text: string): string {
  const [first = ''] = text.split('\n', 1)
  return first
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((cell) => cell.trim())
    .join('|')
}
function movedAway(before: TableModel, model: TableModel, row: number): boolean {
  const was = before.rows[row]
  const now = model.rows[row]
  if (!was || !now || sameCells(was, now)) return false
  return model.rows.some((cells, at) => at !== row && sameCells(cells, was))
}
function sameCells(one: readonly string[], other: readonly string[]): boolean {
  return one.length === other.length && one.every((cell, at) => cell === other[at])
}
function textIn(model: TableModel, at: CellAddress): string {
  return (at.row < 0 ? model.header[at.column] : model.rows[at.row]?.[at.column]) ?? ''
}
function lineChanges(from: number, before: string, after: string): ChangeSpec[] {
  const old = before.split('\n')
  const next = after.split('\n')
  if (old.length !== next.length) return [{ from, to: from + before.length, insert: after }]
  const changes: ChangeSpec[] = []
  let at = from
  old.forEach((line, index) => {
    const made = next[index] ?? ''
    if (line !== made) {
      let head = 0
      while (head < line.length && head < made.length && line[head] === made[head]) head++
      let tail = 0
      while (
        tail < line.length - head &&
        tail < made.length - head &&
        line[line.length - 1 - tail] === made[made.length - 1 - tail]
      )
        tail++
      changes.push({
        from: at + head,
        to: at + line.length - tail,
        insert: made.slice(head, made.length - tail),
      })
    }
    at += line.length + 1
  })
  return changes
}
